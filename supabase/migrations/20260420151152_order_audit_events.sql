-- Migration 20260420151152: order_audit_events table + diff trigger + outcome RPC
--
-- Unified append-only event log for orders. Two populators:
--
--   1. emit_order_audit_events — AFTER UPDATE trigger on orders. Diffs OLD
--      vs NEW for a whitelist of audited columns and emits a typed event per
--      detected change. Columns outside the whitelist (e.g. stripe_receipt_url)
--      don't spam the log.
--
--   2. record_order_outcome — RPC called explicitly by admin server actions
--      for domain events that aren't column diffs: delivery_refused,
--      package_lost, returned, recalled, partial_return.
--
-- Actor:
--   Read from current_setting('app.actor', true), defaulting to 'admin'.
--   Pre-launch single-admin model — when per-user auth lands (L14), server
--   actions will set the session variable to the real user identifier via
--   set_config('app.actor', $1, true).
--
-- Immutability:
--   Same pattern as inventory_log — BEFORE UPDATE/DELETE triggers reject
--   mutations. Correction happens by appending a new event, never editing.

create table if not exists order_audit_events (
  id          bigint generated always as identity primary key,
  order_id    uuid not null references orders(id),
  event_type  text not null,
  actor       text not null default 'admin',
  payload     jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  constraint chk_order_audit_event_type_nonempty check (event_type <> ''),
  constraint chk_order_audit_actor_nonempty check (actor <> '')
);

create index if not exists idx_order_audit_events_order_id
  on order_audit_events (order_id, created_at);

create index if not exists idx_order_audit_events_event_type
  on order_audit_events (event_type);

alter table order_audit_events enable row level security;
create policy "Deny all on order_audit_events" on order_audit_events
  for all using (false) with check (false);

-- ─── Immutability ──────────────────────────────────────────────────────────
create or replace function raise_order_audit_events_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'order_audit_events is append-only; % is not permitted', tg_op;
end;
$$;

create trigger trg_order_audit_events_immutable_update
before update on order_audit_events
for each row execute function raise_order_audit_events_immutable();

create trigger trg_order_audit_events_immutable_delete
before delete on order_audit_events
for each row execute function raise_order_audit_events_immutable();

-- ─── Diff trigger on orders ────────────────────────────────────────────────
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

  if old.refunded_at is distinct from new.refunded_at and new.refunded_at is not null then
    insert into public.order_audit_events (order_id, event_type, actor, payload)
    values (new.id, 'refunded', v_actor,
      jsonb_build_object(
        'refunded_at', new.refunded_at,
        'refund_amount', new.refund_amount,
        'refund_method', new.refund_method,
        'refund_reason', new.refund_reason,
        'credit_note_ref', new.credit_note_ref
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

create trigger trg_order_audit_events
after update on orders
for each row execute function emit_order_audit_events();

-- ─── Explicit outcome RPC ──────────────────────────────────────────────────
-- Called by admin server actions for domain events that aren't column diffs.
-- Each outcome_type has a documented payload shape (see .claude/rules/admin-panel.md).
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
    'data_repair'
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
