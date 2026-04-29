-- Withdrawals (право на отказ) — formal register for ЗЗП Чл. 50 requests.
--
-- Strict separation from complaints (рекламация — Чл. 122-127), refunds
-- (money), inventory (goods), and invoices/credit_notes (accounting).
--
-- Intake is admin-driven (no public form): customer emails or calls,
-- admin opens the order, classifies, and registers the withdrawal here.
--
-- Status machine (forward-only; data-repair via force_withdrawal_status_override):
--
--   Path A (return required, default):
--     requested → approved → goods_received → completed
--                          ↘ rejected
--
--   Path B (return NOT required, e.g. goodwill / customer keeps product):
--     requested → approved → completed
--                          ↘ rejected
--
-- Auto-completion rules (enforced by the trigger):
--   - approved → completed: only when return_required=false AND
--     completion_note is set AND resolution_type is set AND
--     (resolution_type<>'refund' OR refund_id IS NOT NULL).
--   - goods_received → completed: only when resolution_type is set AND
--     (resolution_type<>'refund' OR refund_id IS NOT NULL).
--   - any → rejected: only while goods_received_at IS NULL (CHECK).


-- ── 1. withdrawals table ───────────────────────────────────────────────────

create sequence if not exists withdrawal_ref_seq start 1;

-- Atomic helper for the app layer to mint the next WD-YYYY-NNNN ref. Called
-- from createWithdrawal to avoid a race between two concurrent admin clicks.
create or replace function next_withdrawal_ref()
returns text
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_n bigint;
begin
  v_n := nextval('public.withdrawal_ref_seq');
  return 'WD-' || to_char(now(), 'YYYY') || '-' || lpad(v_n::text, 4, '0');
end;
$$;

create table if not exists withdrawals (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references orders(id) on delete restrict,
  withdrawal_ref  text not null unique,         -- WD-YYYY-NNNN

  -- Intake
  requested_via   text not null default 'email'
                  check (requested_via in ('email', 'phone', 'admin')),
  customer_email  text not null,
  customer_request_text text,

  -- Status machine
  status text not null default 'requested' check (status in (
    'requested', 'approved', 'goods_received', 'rejected', 'completed'
  )),

  -- Eligibility (3 dimensions; informational, not a hard gate)
  eligibility_time_based     boolean,
  eligibility_product_based  text check (eligibility_product_based in (
    'eligible', 'perishable_or_short_shelf_life', 'hygiene_exception', 'unknown'
  )),
  eligibility_condition      text check (eligibility_condition in (
    'pending_inspection', 'sealed_sellable', 'opened', 'damaged', 'expired', 'other'
  )) default 'pending_inspection',

  -- Resolution
  resolution_type   text check (resolution_type in ('refund', 'replacement', 'none')),
  rejection_reason  text,
  refund_id         uuid references order_refunds(id) on delete restrict,

  -- Path B: skip-the-return
  return_required  boolean not null default true,
  completion_note  text,

  -- Optional return logistics
  return_tracking_number text,
  return_courier         text,

  -- Admin lifecycle
  approved_at        timestamptz,
  approved_by        text,
  goods_received_at  timestamptz,
  rejected_at        timestamptz,
  rejected_by        text,
  completed_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- ── Constraints ─────────────────────────────────────────────────────────
  constraint chk_withdrawal_ref_format check (withdrawal_ref ~ '^WD-\d{4}-\d{4,}$'),
  constraint chk_customer_email_lowercase check (customer_email = lower(customer_email)),

  -- Rejection requires a reason
  constraint chk_rejection_reason check (
    status <> 'rejected'
    or (rejection_reason is not null and btrim(rejection_reason) <> '')
  ),

  -- Completion requires a resolution declared
  constraint chk_completed_requires_resolution check (
    status <> 'completed' or resolution_type is not null
  ),

  -- When resolution is refund, the refund linkage is mandatory
  constraint chk_refund_resolution_has_refund_id check (
    coalesce(resolution_type, '') <> 'refund' or refund_id is not null
  ),

  -- Path B (no-return completion) requires an explicit completion_note
  constraint chk_completion_note_when_no_return check (
    status <> 'completed'
    or return_required = true
    or (completion_note is not null and btrim(completion_note) <> '')
  ),

  -- Cannot reject after physically receiving goods (legally messy)
  constraint chk_no_reject_after_goods check (
    not (status = 'rejected' and goods_received_at is not null)
  ),

  -- Length caps
  constraint chk_request_text_length check (
    customer_request_text is null or length(customer_request_text) <= 2000
  ),
  constraint chk_rejection_reason_length check (
    rejection_reason is null or length(rejection_reason) <= 1000
  ),
  constraint chk_completion_note_length check (
    completion_note is null or length(completion_note) <= 1000
  ),
  constraint chk_return_tracking_length check (
    return_tracking_number is null or length(return_tracking_number) <= 200
  ),
  constraint chk_return_courier_length check (
    return_courier is null or length(return_courier) <= 100
  )
);

-- One open withdrawal per order at a time. Closed-state rows are excluded so
-- a customer who had a rejected/completed withdrawal can file a new one.
create unique index if not exists uq_open_withdrawal_per_order
  on withdrawals(order_id)
  where status in ('requested', 'approved', 'goods_received');

create index if not exists idx_withdrawals_status
  on withdrawals(status)
  where status in ('requested', 'approved', 'goods_received');

create index if not exists idx_withdrawals_order_id on withdrawals(order_id);
create index if not exists idx_withdrawals_created_at on withdrawals(created_at desc);

alter table withdrawals enable row level security;
create policy "Deny all on withdrawals" on withdrawals
  for all using (false) with check (false);


-- ── 2. order_refunds: add withdrawal_id linkage ───────────────────────────
-- Set once when admin issues a refund from a withdrawal context. Immutable
-- once set (extended into the append-only enforcement below).
alter table order_refunds add column if not exists withdrawal_id uuid
  references withdrawals(id) on delete restrict;

create index if not exists idx_order_refunds_withdrawal_id
  on order_refunds(withdrawal_id) where withdrawal_id is not null;

-- One refund per withdrawal at most (preserves 1:1 invariant)
create unique index if not exists uq_order_refunds_withdrawal_id
  on order_refunds(withdrawal_id) where withdrawal_id is not null;


-- ── 3. updated_at trigger ─────────────────────────────────────────────────
create or replace function set_withdrawals_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_set_withdrawals_updated_at on withdrawals;
create trigger trg_set_withdrawals_updated_at
  before update on withdrawals
  for each row execute function set_withdrawals_updated_at();


-- ── 4. State-machine trigger ──────────────────────────────────────────────
-- BEFORE UPDATE on withdrawals. Fires only when status actually changes.
-- Bypass via current_setting('app.allow_withdrawal_status_override', true) =
-- 'true' (set by force_withdrawal_status_override RPC).
create or replace function enforce_withdrawal_status_transition()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_bypass text := current_setting('app.allow_withdrawal_status_override', true);
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  if v_bypass = 'true' then
    return new;
  end if;

  -- Legal transitions
  if old.status = 'requested' and new.status in ('approved', 'rejected') then
    return new;
  end if;

  if old.status = 'approved' and new.status in ('goods_received', 'rejected') then
    return new;
  end if;

  -- Path B: approved → completed when return_required=false + completion_note
  -- + resolution declared. Refund linkage required when resolution_type='refund'.
  if old.status = 'approved' and new.status = 'completed' then
    if new.return_required then
      raise exception 'Withdrawal cannot complete from approved when return_required=true. Mark goods_received first.';
    end if;
    if new.completion_note is null or btrim(new.completion_note) = '' then
      raise exception 'completion_note is required to complete a withdrawal without goods receipt';
    end if;
    if new.resolution_type is null then
      raise exception 'resolution_type is required to complete a withdrawal';
    end if;
    if new.resolution_type = 'refund' and new.refund_id is null then
      raise exception 'refund_id is required when resolution_type=refund';
    end if;
    return new;
  end if;

  if old.status = 'goods_received' and new.status = 'completed' then
    if new.resolution_type is null then
      raise exception 'resolution_type is required to complete a withdrawal';
    end if;
    if new.resolution_type = 'refund' and new.refund_id is null then
      raise exception 'refund_id is required when resolution_type=refund';
    end if;
    return new;
  end if;

  raise exception 'Illegal withdrawal status transition: % → %. Use force_withdrawal_status_override for data repair.',
    old.status, new.status;
end;
$$;

drop trigger if exists trg_enforce_withdrawal_status_transition on withdrawals;
create trigger trg_enforce_withdrawal_status_transition
  before update on withdrawals
  for each row execute function enforce_withdrawal_status_transition();


-- ── 5. force_withdrawal_status_override RPC ───────────────────────────────
create or replace function force_withdrawal_status_override(
  p_id uuid,
  p_new_status text,
  p_reason text,
  p_actor text default 'admin'
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_order_id uuid;
  v_old_status text;
begin
  if p_new_status not in ('requested', 'approved', 'goods_received', 'rejected', 'completed') then
    raise exception 'Invalid withdrawal status: %', p_new_status;
  end if;

  if p_reason is null or length(btrim(p_reason)) < 20 then
    raise exception 'force_withdrawal_status_override requires a reason of at least 20 characters explaining the repair';
  end if;

  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'actor is required';
  end if;

  select status, order_id into v_old_status, v_order_id
  from public.withdrawals where id = p_id;

  if v_old_status is null then
    raise exception 'Withdrawal % not found', p_id;
  end if;

  -- Audit BEFORE the bypass so a failed insert aborts the repair.
  insert into public.order_audit_events (order_id, event_type, actor, payload)
  values (
    v_order_id,
    'withdrawal_status_force_override',
    p_actor,
    jsonb_build_object(
      'withdrawal_id', p_id,
      'from', v_old_status,
      'to', p_new_status,
      'reason', p_reason
    )
  );

  perform set_config('app.allow_withdrawal_status_override', 'true', true);

  update public.withdrawals
  set status = p_new_status
  where id = p_id;

  perform set_config('app.allow_withdrawal_status_override', 'false', true);
end;
$$;


-- ── 6. Audit emission trigger ─────────────────────────────────────────────
-- Emits typed events into order_audit_events on INSERT and on status
-- transitions. Suppresses status_changed during force-override (the RPC
-- already wrote a richer event).
create or replace function emit_withdrawal_audit_events()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_actor text := coalesce(current_setting('app.actor', true), 'admin');
  v_override text := current_setting('app.allow_withdrawal_status_override', true);
begin
  if tg_op = 'INSERT' then
    insert into public.order_audit_events (order_id, event_type, actor, payload)
    values (new.order_id, 'withdrawal_requested', v_actor,
      jsonb_build_object(
        'withdrawal_id',  new.id,
        'withdrawal_ref', new.withdrawal_ref,
        'requested_via',  new.requested_via,
        'customer_email', new.customer_email
      ));
    return new;
  end if;

  -- UPDATE
  if old.status is distinct from new.status and coalesce(v_override, '') <> 'true' then
    if new.status = 'approved' then
      insert into public.order_audit_events (order_id, event_type, actor, payload)
      values (new.order_id, 'withdrawal_approved', v_actor,
        jsonb_build_object(
          'withdrawal_id',   new.id,
          'withdrawal_ref',  new.withdrawal_ref,
          'return_required', new.return_required,
          'approved_by',     new.approved_by,
          'approved_at',     new.approved_at
        ));
    elsif new.status = 'goods_received' then
      insert into public.order_audit_events (order_id, event_type, actor, payload)
      values (new.order_id, 'withdrawal_goods_received', v_actor,
        jsonb_build_object(
          'withdrawal_id',         new.id,
          'withdrawal_ref',        new.withdrawal_ref,
          'eligibility_condition', new.eligibility_condition,
          'resolution_type',       new.resolution_type,
          'goods_received_at',     new.goods_received_at,
          'return_tracking_number',new.return_tracking_number,
          'return_courier',        new.return_courier
        ));
    elsif new.status = 'rejected' then
      insert into public.order_audit_events (order_id, event_type, actor, payload)
      values (new.order_id, 'withdrawal_rejected', v_actor,
        jsonb_build_object(
          'withdrawal_id',     new.id,
          'withdrawal_ref',    new.withdrawal_ref,
          'rejection_reason',  new.rejection_reason,
          'rejected_by',       new.rejected_by,
          'rejected_at',       new.rejected_at
        ));
    elsif new.status = 'completed' then
      insert into public.order_audit_events (order_id, event_type, actor, payload)
      values (new.order_id, 'withdrawal_completed', v_actor,
        jsonb_build_object(
          'withdrawal_id',    new.id,
          'withdrawal_ref',   new.withdrawal_ref,
          'resolution_type',  new.resolution_type,
          'refund_id',        new.refund_id,
          'return_required',  new.return_required,
          'completion_note',  new.completion_note,
          'completed_at',     new.completed_at
        ));
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_emit_withdrawal_audit_events_insert on withdrawals;
create trigger trg_emit_withdrawal_audit_events_insert
  after insert on withdrawals
  for each row execute function emit_withdrawal_audit_events();

drop trigger if exists trg_emit_withdrawal_audit_events_update on withdrawals;
create trigger trg_emit_withdrawal_audit_events_update
  after update on withdrawals
  for each row execute function emit_withdrawal_audit_events();


-- ── 7. record_order_outcome allow-list — add withdrawal_* events ──────────
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
    'order_items_changed',
    'email_resent',
    -- Withdrawals (emitted by emit_withdrawal_audit_events trigger; here so
    -- record_order_outcome accepts them too if ever called manually)
    'withdrawal_requested',
    'withdrawal_approved',
    'withdrawal_goods_received',
    'withdrawal_rejected',
    'withdrawal_completed',
    'withdrawal_status_force_override'
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


-- ── 8. order_refunds append-only — make withdrawal_id immutable ───────────
-- Existing immutable list extended with withdrawal_id (set once when refund
-- inserts; never reassigned). Keeps the 1:1 invariant audit-clean.
create or replace function enforce_order_refunds_append_only_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.id is distinct from new.id
     or old.order_id is distinct from new.order_id
     or old.stripe_refund_id is distinct from new.stripe_refund_id
     or old.client_idempotency_key is distinct from new.client_idempotency_key
     or old.amount_cents is distinct from new.amount_cents
     or old.method is distinct from new.method
     or old.source is distinct from new.source
     or old.recorded_by is distinct from new.recorded_by
     or old.refunded_at is distinct from new.refunded_at
     or old.created_at is distinct from new.created_at
     or old.affects_invoiced_supply is distinct from new.affects_invoiced_supply
     or old.withdrawal_id is distinct from new.withdrawal_id then
    raise exception 'order_refunds financial fields are immutable; only reason, bank_transfer_ref, and credit_note_skip_reason may be edited';
  end if;
  return new;
end;
$$;


-- ── 9. dashboard_stats — extend with withdrawals_pending ──────────────────
create or replace function dashboard_stats(
  p_today_start timestamptz,
  p_week_start timestamptz,
  p_month_start timestamptz
)
returns json
language plpgsql
set search_path = public, pg_temp
as $$
declare
  result json;
begin
  select json_build_object(
    'today_orders', coalesce(sum(case when created_at >= p_today_start then 1 else 0 end), 0),
    'today_revenue', coalesce(sum(case when created_at >= p_today_start then total_amount - coalesce(shipping_fee, 0) - coalesce(cod_fee, 0) else 0 end), 0),
    'week_orders', coalesce(sum(case when created_at >= p_week_start then 1 else 0 end), 0),
    'week_revenue', coalesce(sum(case when created_at >= p_week_start then total_amount - coalesce(shipping_fee, 0) - coalesce(cod_fee, 0) else 0 end), 0),
    'month_orders', coalesce(count(*), 0),
    'month_revenue', coalesce(sum(total_amount - coalesce(shipping_fee, 0) - coalesce(cod_fee, 0)), 0),
    'pending_orders', (select count(*) from orders where status = 'pending'),
    'invoices_awaiting', (select count(*) from invoices i
                          join orders o on o.id = i.order_id
                          where i.type = 'invoice' and i.invoice_number is null
                            and o.status <> 'cancelled'),
    'credit_notes_awaiting', (select count(*) from invoices
                              where type = 'credit_note' and invoice_number is null),
    'awaiting_settlement', (select count(*) from orders where payment_method = 'cod' and delivered_at is not null and paid_at is null and status = 'delivered'),
    'inventory_debt_skus', (select count(*) from inventory_current where quantity < 0),
    'withdrawals_pending', (select count(*) from withdrawals where status in ('requested', 'approved', 'goods_received'))
  ) into result
  from orders
  where created_at >= p_month_start and status != 'cancelled';

  return result;
end;
$$;
