-- Migration 20260424140000: Order edit support (contact + COD quantity)
--
-- Three changes unlocking post-confirmation order edits:
--
-- 1. Drop `idx_inventory_log_order_out_unique` — allows multiple order_out
--    rows per (order_id, sku). The original index (migration 20260420144423)
--    encoded a product-model assumption that "cart dedups by SKU, one line
--    per SKU." Admin quantity edits violate that: each increase emits a new
--    order_out reservation, each decrease a cancellation. That migration
--    explicitly called out "treat a cart model change as a migration-
--    triggering event" — this IS that event.
--
--    Correctness is unaffected because restore_inventory (migration
--    20260420144423) uses sum-based guards: sum(order_out) - sum(cancellation)
--    for (order_id, sku) gives the net reserved, so multiple ledger rows
--    converge to the same answer.
--
-- 2. New `edit_order_quantity` RPC — atomic per-SKU quantity edit. Handles:
--    - Increase → call reserve_inventory for the delta (appends a new
--      order_out row). Raises on insufficient stock.
--    - Decrease → call restore_inventory for the delta (appends a
--      cancellation row). Raises if decrement would exceed reservations.
--    - Updates order_items.quantity and orders.total_amount atomically.
--    - FOR UPDATE on the order_items row serializes concurrent edits.
--    - Fee structure (shipping_fee, cod_fee, discount_amount) stays frozen
--      at order creation — recalculating them on edit would require
--      re-running promo logic + shipping-band lookups and creates surprise
--      side effects. If admin wants those recomputed, cancel + reorder.
--
-- 3. emit_order_audit_events gains a `contact_info_changed` branch — diffs
--    all contact/shipping fields (first_name, last_name, phone, email,
--    address, postal_code, city, notes) and emits ONE event per UPDATE with
--    a jsonb_strip_nulls'd payload listing only fields that changed. Same
--    pattern as the refund annotation audit (migration 20260424120000).
--
--    record_order_outcome allow-list adds `order_items_changed` —
--    edit_order_quantity emits this via the server action (can't emit from
--    the RPC easily because the audit event logically belongs to the admin
--    intent, not the SQL operation).

-- ── 1. Drop the order_out uniqueness index ──────────────────────────────
drop index if exists idx_inventory_log_order_out_unique;

-- ── 2. edit_order_quantity RPC ──────────────────────────────────────────
create or replace function edit_order_quantity(
  p_order_id uuid,
  p_sku      text,
  p_new_quantity integer
)
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_current_qty integer;
  v_unit_price  integer;
  v_items_subtotal integer;
  v_shipping_fee integer;
  v_cod_fee integer;
  v_discount integer;
  v_new_total integer;
begin
  if p_new_quantity is null or p_new_quantity < 1 then
    raise exception 'Quantity must be a positive integer';
  end if;

  -- Lock the order_items row so concurrent edits serialize through us.
  select quantity, unit_price_cents
    into v_current_qty, v_unit_price
    from public.order_items
    where order_id = p_order_id and sku = p_sku
    for update;

  if v_current_qty is null then
    raise exception 'SKU % not found on order %', p_sku, p_order_id;
  end if;

  if v_current_qty = p_new_quantity then
    -- No-op. Return current total without touching anything else.
    select total_amount into v_new_total from public.orders where id = p_order_id;
    return v_new_total;
  end if;

  -- Reservation delta. reserve_inventory / restore_inventory both raise on
  -- invariant violation (insufficient stock / over-restore), which aborts
  -- the transaction and rolls back the order_items + orders updates below.
  if p_new_quantity > v_current_qty then
    perform public.reserve_inventory(p_sku, p_new_quantity - v_current_qty, p_order_id);
  else
    perform public.restore_inventory(p_sku, v_current_qty - p_new_quantity, p_order_id);
  end if;

  update public.order_items
    set quantity = p_new_quantity
    where order_id = p_order_id and sku = p_sku;

  -- Recompute total_amount from scratch. Subtotal over all lines plus the
  -- frozen fees. Keeps shipping / cod / discount unchanged — see migration
  -- header for rationale.
  select coalesce(sum(quantity * unit_price_cents), 0)
    into v_items_subtotal
    from public.order_items
    where order_id = p_order_id;

  select shipping_fee, cod_fee, discount_amount
    into v_shipping_fee, v_cod_fee, v_discount
    from public.orders
    where id = p_order_id;

  v_new_total := v_items_subtotal
    + coalesce(v_shipping_fee, 0)
    + coalesce(v_cod_fee, 0)
    - coalesce(v_discount, 0);

  -- Defend against a pathological discount/fee configuration driving the
  -- total below the schema's total_amount > 0 constraint. Unlikely in
  -- practice (discount is validated at checkout to not exceed subtotal),
  -- but cheap to guard.
  if v_new_total < 1 then
    v_new_total := 1;
  end if;

  update public.orders
    set total_amount = v_new_total
    where id = p_order_id;

  return v_new_total;
end;
$$;

-- ── 3. emit_order_audit_events: add contact_info_changed branch ─────────
create or replace function emit_order_audit_events()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_actor text := coalesce(current_setting('app.actor', true), 'admin');
  v_override_bypass text := current_setting('app.allow_status_override', true);
  v_contact_payload jsonb;
begin
  if old.status is distinct from new.status then
    if coalesce(v_override_bypass, '') <> 'true' then
      insert into public.order_audit_events (order_id, event_type, actor, payload)
      values (new.id, 'status_changed', v_actor,
        jsonb_build_object('from', old.status, 'to', new.status));
    end if;
  end if;

  if old.invoice_number is distinct from new.invoice_number
     and new.invoice_number is not null then
    insert into public.order_audit_events (order_id, event_type, actor, payload)
    values (new.id, 'invoice_number_set', v_actor,
      jsonb_build_object(
        'invoice_number', new.invoice_number,
        'invoice_date', new.invoice_date
      ));
  end if;

  if old.invoice_sent_at is distinct from new.invoice_sent_at
     and new.invoice_sent_at is not null then
    insert into public.order_audit_events (order_id, event_type, actor, payload)
    values (new.id, 'invoice_marked_sent', v_actor,
      jsonb_build_object('invoice_sent_at', new.invoice_sent_at));
  end if;

  if old.paid_at is distinct from new.paid_at and new.paid_at is not null then
    insert into public.order_audit_events (order_id, event_type, actor, payload)
    values (new.id, 'paid_at_recorded', v_actor,
      jsonb_build_object(
        'paid_at', new.paid_at,
        'payment_method', new.payment_method,
        'courier_ppp_ref', new.courier_ppp_ref,
        'settlement_ref', new.settlement_ref,
        'settlement_amount', new.settlement_amount
      ));
  end if;

  if old.shipped_at is distinct from new.shipped_at and new.shipped_at is not null then
    insert into public.order_audit_events (order_id, event_type, actor, payload)
    values (new.id, 'shipped_at_recorded', v_actor,
      jsonb_build_object(
        'shipped_at', new.shipped_at,
        'tracking_number', new.tracking_number,
        'logistics_partner', new.logistics_partner
      ));
  end if;

  if old.delivered_at is distinct from new.delivered_at
     and new.delivered_at is not null then
    insert into public.order_audit_events (order_id, event_type, actor, payload)
    values (new.id, 'delivered_at_recorded', v_actor,
      jsonb_build_object('delivered_at', new.delivered_at));
  end if;

  if old.cancelled_at is distinct from new.cancelled_at
     and new.cancelled_at is not null then
    insert into public.order_audit_events (order_id, event_type, actor, payload)
    values (new.id, 'cancelled', v_actor,
      jsonb_build_object(
        'cancelled_at', new.cancelled_at,
        'reason', new.cancellation_reason
      ));
  end if;

  if old.tracking_number is distinct from new.tracking_number
     and new.tracking_number is not null
     and new.tracking_number <> '__generating__' then
    insert into public.order_audit_events (order_id, event_type, actor, payload)
    values (new.id, 'tracking_number_set', v_actor,
      jsonb_build_object('tracking_number', new.tracking_number));
  end if;

  if old.cod_confirmed_at is distinct from new.cod_confirmed_at
     and new.cod_confirmed_at is not null then
    insert into public.order_audit_events (order_id, event_type, actor, payload)
    values (new.id, 'cod_confirmed', v_actor,
      jsonb_build_object(
        'cod_confirmed_at', new.cod_confirmed_at,
        'confirmed_by', new.cod_confirmed_by
      ));
  end if;

  -- Contact / shipping-address edits. One event per UPDATE with
  -- per-field {old, new} pairs for only the fields that actually changed.
  -- jsonb_strip_nulls drops the unchanged-field keys.
  if old.first_name is distinct from new.first_name
     or old.last_name is distinct from new.last_name
     or old.phone is distinct from new.phone
     or old.email is distinct from new.email
     or old.address is distinct from new.address
     or old.postal_code is distinct from new.postal_code
     or old.city is distinct from new.city
     or old.notes is distinct from new.notes then
    v_contact_payload := jsonb_strip_nulls(jsonb_build_object(
      'first_name',  case when old.first_name is distinct from new.first_name
        then jsonb_build_object('old', old.first_name, 'new', new.first_name) else null end,
      'last_name',   case when old.last_name is distinct from new.last_name
        then jsonb_build_object('old', old.last_name, 'new', new.last_name) else null end,
      'phone',       case when old.phone is distinct from new.phone
        then jsonb_build_object('old', old.phone, 'new', new.phone) else null end,
      'email',       case when old.email is distinct from new.email
        then jsonb_build_object('old', old.email, 'new', new.email) else null end,
      'address',     case when old.address is distinct from new.address
        then jsonb_build_object('old', old.address, 'new', new.address) else null end,
      'postal_code', case when old.postal_code is distinct from new.postal_code
        then jsonb_build_object('old', old.postal_code, 'new', new.postal_code) else null end,
      'city',        case when old.city is distinct from new.city
        then jsonb_build_object('old', old.city, 'new', new.city) else null end,
      'notes',       case when old.notes is distinct from new.notes
        then jsonb_build_object('old', old.notes, 'new', new.notes) else null end
    ));

    insert into public.order_audit_events (order_id, event_type, actor, payload)
    values (new.id, 'contact_info_changed', v_actor, v_contact_payload);
  end if;

  return new;
end;
$$;

-- ── 4. record_order_outcome: extend allow-list with order_items_changed ─
create or replace function record_order_outcome(
  p_order_id uuid,
  p_outcome_type text,
  p_payload jsonb default '{}',
  p_actor text default 'admin'
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
    'order_items_changed'
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
