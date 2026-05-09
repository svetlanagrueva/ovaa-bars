-- Server-side support for the batch-allocation admin flow:
--
--   1. save_batch_allocation RPC — atomic delete+insert with row locks on
--      the order and referenced product_batches. Re-validates sum equality
--      and per-batch availability inside the transaction so the order's
--      own previous allocation isn't double-counted (DELETE before
--      availability check) and concurrent saves on the same batch are
--      serialized.
--
--   2. record_order_outcome allowlist extended with the five new event
--      types emitted by the batch-allocation flow.
--
-- The lifecycle trigger from 20260509120000 still applies: any modification
-- to order_item_batches when the parent order has tracking_number set
-- (incl. '__generating__') raises.

begin;

-- ── 1. save_batch_allocation RPC ────────────────────────────────────────
create or replace function public.save_batch_allocation(
  p_order_id    uuid,
  p_allocations jsonb
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_status   text;
  v_tracking text;
  v_avail    integer;
  rec        record;
begin
  -- 1. Lock parent order, assert preconditions
  select status, tracking_number into v_status, v_tracking
  from public.orders where id = p_order_id for update;

  if not found then
    raise exception 'Order not found';
  end if;
  if v_status <> 'confirmed' then
    raise exception 'Order status is %, must be confirmed to allocate batches', v_status;
  end if;
  if v_tracking is not null then
    raise exception 'Allocation is locked (tracking_number is set)';
  end if;

  -- 2. Lock referenced product_batches so concurrent saves serialize on
  --    the batch row (prevents two orders over-drawing the same batch)
  perform 1
  from public.product_batches
  where id in (
    select distinct (a->>'product_batch_id')::uuid
    from jsonb_array_elements(p_allocations) a
  )
  for update;

  -- 3. DELETE existing allocation rows for this order — releases their
  --    contribution to batch_quantity_available before we re-validate
  delete from public.order_item_batches
  where order_item_id in (
    select id from public.order_items where order_id = p_order_id
  );

  -- 4. Per-batch validation: status='active' + availability
  for rec in
    select
      (a->>'product_batch_id')::uuid                  as batch_id,
      sum((a->>'quantity')::integer)::integer         as requested
    from jsonb_array_elements(p_allocations) a
    group by 1
  loop
    if not exists (
      select 1 from public.product_batches
      where id = rec.batch_id and status = 'active'
    ) then
      raise exception 'Batch % is not active', rec.batch_id;
    end if;

    -- batch_quantity_available now reflects state without this order's prior rows
    select public.batch_quantity_available(rec.batch_id) into v_avail;
    if rec.requested > v_avail then
      raise exception 'Batch % availability % less than requested %',
        rec.batch_id, v_avail, rec.requested;
    end if;
  end loop;

  -- 5. Per-line sum equality (allocated == ordered)
  for rec in
    with incoming as (
      select
        (a->>'order_item_id')::bigint           as order_item_id,
        sum((a->>'quantity')::integer)::integer as total_qty
      from jsonb_array_elements(p_allocations) a
      group by 1
    )
    select
      oi.id, oi.sku,
      oi.quantity                          as ordered,
      coalesce(i.total_qty, 0)::integer    as allocated
    from public.order_items oi
    left join incoming i on i.order_item_id = oi.id
    where oi.order_id = p_order_id
  loop
    if rec.allocated <> rec.ordered then
      raise exception 'SKU %: allocated % but ordered %', rec.sku, rec.allocated, rec.ordered;
    end if;
  end loop;

  -- 6. INSERT new rows. Existing triggers backstop SKU consistency and the
  --    lifecycle lock (the lifecycle one is a no-op here since we already
  --    asserted tracking_number IS NULL with the FOR UPDATE lock above).
  insert into public.order_item_batches (
    order_item_id, product_batch_id, quantity, confirmed_by,
    non_fefo_reason, expired_override_reason
  )
  select
    (a->>'order_item_id')::bigint,
    (a->>'product_batch_id')::uuid,
    (a->>'quantity')::integer,
    coalesce(current_setting('app.actor', true), 'admin'),
    nullif(a->>'non_fefo_reason', ''),
    nullif(a->>'expired_override_reason', '')
  from jsonb_array_elements(p_allocations) a;
end;
$$;

-- ── 2. Extend record_order_outcome allowlist ────────────────────────────
create or replace function public.record_order_outcome(
  p_order_id     uuid,
  p_outcome_type text,
  p_payload      jsonb default '{}',
  p_actor        text  default 'admin'
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if p_outcome_type not in (
    'delivery_refused',
    'package_lost',
    'returned',
    'recalled',
    'partial_return',
    'status_force_override',
    'data_repair',
    'external_refund',
    'payment_failed',
    'dispute_opened',
    'dispute_closed',
    'dispute_funds_reinstated',
    'order_items_changed',
    'email_resent',
    'withdrawal_requested',
    'withdrawal_approved',
    'withdrawal_goods_received',
    'withdrawal_rejected',
    'withdrawal_completed',
    'withdrawal_status_force_override',
    -- Batch allocation events (added 2026-05-09)
    'batch_allocation_saved',
    'batch_allocation_overridden_fefo',
    'batch_allocation_overridden_expired',
    'batch_allocation_cleared',
    'batch_allocation_unlocked_after_shipment_cancelled'
  ) then
    raise exception 'Unknown outcome type: %', p_outcome_type;
  end if;

  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'actor is required';
  end if;

  insert into public.order_audit_events (order_id, event_type, actor, payload)
  values (p_order_id, p_outcome_type, p_actor, p_payload);
end;
$$;

commit;
