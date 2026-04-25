-- Migration 20260423090000: Normalize refund data into order_refunds child table
--
-- Before this migration, refund data lived as columns on orders (refunded_at,
-- refund_amount, refund_reason, refund_method, credit_note_ref), with
-- idempotency guarded by `.is(refunded_at, null)`. That guard allowed exactly
-- ONE refund per order — silently blocking:
--   1. Second partial refunds (common in real support flows)
--   2. Admin-ui-vs-webhook races when refund originates from Stripe dashboard
--   3. Chargeback-driven refund colliding with an in-progress admin record
--
-- The new model — aligned with Shopify / WooCommerce / Stripe docs:
--   * order_refunds is a child table, one row per refund
--   * stripe_refund_id is the natural idempotency key across admin and webhook
--   * reason and credit_note_ref are always admin-editable regardless of
--     which code path created the row
--   * order-level "refund status" is a computed aggregate, not a flag column
--
-- Pre-launch, no data to migrate. Direct drop of old columns + CHECKs is safe.

-- ─── Child table ───────────────────────────────────────────────────────────
create table if not exists order_refunds (
  id                uuid        primary key default gen_random_uuid(),
  order_id          uuid        not null references orders(id) on delete cascade,
  stripe_refund_id  text,                           -- Natural idempotency key for webhook-originated rows
  amount_cents      integer     not null check (amount_cents > 0),
  method            text        not null check (method in ('stripe', 'bank_transfer')),
  source            text        not null check (source in ('admin_ui', 'stripe_webhook')),
  reason            text,                           -- Admin-editable free text
  credit_note_ref   text,                           -- Admin-editable кредитно известие reference
  recorded_by       text        not null default 'admin',
  refunded_at       timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint chk_stripe_method_has_refund_id
    check (method <> 'stripe' or stripe_refund_id is not null),
  constraint chk_refund_reason_length
    check (reason is null or length(reason) <= 1000),
  constraint chk_refund_credit_note_length
    check (credit_note_ref is null or length(credit_note_ref) <= 100)
);

-- stripe_refund_id is the idempotency key. Partial unique because bank
-- transfer refunds have no Stripe object to key on.
create unique index if not exists idx_order_refunds_stripe_id
  on order_refunds (stripe_refund_id)
  where stripe_refund_id is not null;

-- For admin UI list + aggregate queries on a single order.
create index if not exists idx_order_refunds_order_id
  on order_refunds (order_id, refunded_at desc);

alter table order_refunds enable row level security;
create policy "Deny all on order_refunds" on order_refunds
  for all using (false) with check (false);

-- ─── Trigger: total refunds must not exceed order.total_amount ─────────────
-- Server actions validate this up-front for user-facing errors; this trigger
-- is a backstop ensuring any insert path (future automation, direct SQL)
-- cannot break the invariant.
--
-- Locks the target order row via FOR UPDATE so concurrent inserts on the
-- same order serialize — second insert sees the first's committed sum.
create or replace function enforce_refund_total()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_order_total integer;
  v_already_refunded integer;
begin
  select total_amount into v_order_total
  from public.orders
  where id = new.order_id
  for update;

  if v_order_total is null then
    raise exception 'Order % not found', new.order_id;
  end if;

  select coalesce(sum(amount_cents), 0) into v_already_refunded
  from public.order_refunds
  where order_id = new.order_id
    and id <> new.id;  -- exclude self on UPDATE path

  if v_already_refunded + new.amount_cents > v_order_total then
    raise exception 'Total refunds (% existing + % new = %) would exceed order total %',
      v_already_refunded, new.amount_cents,
      v_already_refunded + new.amount_cents, v_order_total;
  end if;

  return new;
end;
$$;

create trigger trg_enforce_refund_total
before insert or update on order_refunds
for each row execute function enforce_refund_total();

-- ─── Trigger: maintain updated_at on UPDATE ────────────────────────────────
create or replace function set_order_refunds_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_set_order_refunds_updated_at
before update on order_refunds
for each row execute function set_order_refunds_updated_at();

-- ─── Trigger: emit 'refunded' event into order_audit_events on INSERT ──────
-- Only INSERT emits — annotation edits (UPDATE reason / credit_note_ref) are
-- not money movements and don't warrant a timeline entry. If per-edit audit
-- is needed later, the UPDATE path can route through a separate event type.
create or replace function emit_order_refund_audit()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_actor text := coalesce(current_setting('app.actor', true), new.recorded_by);
begin
  insert into public.order_audit_events (order_id, event_type, actor, payload)
  values (new.order_id, 'refunded', v_actor,
    jsonb_build_object(
      'refund_id',        new.id,
      'amount_cents',     new.amount_cents,
      'method',           new.method,
      'source',           new.source,
      'stripe_refund_id', new.stripe_refund_id,
      'reason',           new.reason,
      'credit_note_ref',  new.credit_note_ref
    ));
  return new;
end;
$$;

create trigger trg_emit_order_refund_audit
after insert on order_refunds
for each row execute function emit_order_refund_audit();

-- ─── Update emit_order_audit_events to drop refunded_at branch ─────────────
-- refunded_at column is about to be dropped; the diff trigger must stop
-- referencing it or the DROP COLUMN at the end of this migration fails.
create or replace function emit_order_audit_events()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_actor text := coalesce(current_setting('app.actor', true), 'admin');
begin
  if old.status is distinct from new.status then
    insert into public.order_audit_events (order_id, event_type, actor, payload)
    values (new.id, 'status_changed', v_actor,
      jsonb_build_object('from', old.status, 'to', new.status));
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

  -- Tracking number set independently of status (__generating__ placeholder flow).
  -- Skip the placeholder value itself — only the real tracking number gets a log entry.
  if old.tracking_number is distinct from new.tracking_number
     and new.tracking_number is not null
     and new.tracking_number <> '__generating__' then
    insert into public.order_audit_events (order_id, event_type, actor, payload)
    values (new.id, 'tracking_number_set', v_actor,
      jsonb_build_object('tracking_number', new.tracking_number));
  end if;

  return new;
end;
$$;

-- ─── Drop dead refund columns and CHECKs from orders ──────────────────────
alter table orders drop constraint if exists chk_refund_amount_le_total;
alter table orders drop constraint if exists chk_refund_method_stripe_requires_pi;

alter table orders drop column if exists refunded_at;
alter table orders drop column if exists refund_amount;
alter table orders drop column if exists refund_reason;
alter table orders drop column if exists refund_method;
alter table orders drop column if exists credit_note_ref;
