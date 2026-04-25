-- Migration 20260424110000: Suppress status_changed audit event on force_status_override
--
-- Before this migration, a force_status_override call produced two audit events:
--   1. status_force_override — inserted by the RPC with {from, to, reason}
--   2. status_changed        — inserted by the AFTER UPDATE diff trigger
-- Both ended up in the timeline for one logical operation. The
-- status_force_override row already captures the same transition with
-- richer context (the reason), so the mechanical status_changed is pure
-- duplicate noise in the UI.
--
-- Fix: have the diff trigger check the same transaction-local bypass flag
-- that the state-machine trigger already honors
-- (`current_setting('app.allow_status_override', true) = 'true'`,
-- set by the force_status_override RPC before the UPDATE). When the flag
-- is on, skip the status_changed emission — the richer
-- status_force_override event is already in the audit log.
--
-- Scope: the bypass check is narrow, applied only to the status_changed
-- branch. Other diff branches (invoice_number_set, paid_at_recorded,
-- shipped_at_recorded, etc.) continue to emit normally even during a
-- force override — in the rare case the force-update also changes
-- those columns, those events remain meaningful and the admin deserves
-- to see them in the timeline.

create or replace function emit_order_audit_events()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_actor text := coalesce(current_setting('app.actor', true), 'admin');
  v_override_bypass text := current_setting('app.allow_status_override', true);
begin
  if old.status is distinct from new.status then
    -- Skip the mechanical status_changed when we're in a force_status_override
    -- transaction — the RPC already wrote a status_force_override event with
    -- the reason. Surfacing both would double the timeline entry for a single
    -- admin intent.
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
