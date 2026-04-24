-- Migration 20260424130000: COD phone-confirmation timestamp
--
-- Bulgarian COD operational reality: admin should call the customer to
-- verify phone number + address + intent BEFORE generating the shipment,
-- otherwise parcels get refused at the door (measurably 5-25% refusal rate
-- in this market). Until this migration that step was a policy reminder
-- in an amber banner and a note in admin-panel.md — easy to skip.
--
-- This migration turns the policy into a recorded system event:
--   cod_confirmed_at timestamptz — when the admin marked the phone call as
--                                    completed
--   cod_confirmed_by text        — actor identifier (single admin pre-launch;
--                                    becomes real user id when L14 multi-admin
--                                    auth lands)
--
-- Paired with the markCodConfirmed server action and a UI soft-block
-- warning on the generate-shipment step, the admin gets visible friction
-- when skipping the call — not a hard stop, so emergencies still ship, but
-- a deliberate override rather than an accidental skip.
--
-- Audit trail: emit_order_audit_events gains a cod_confirmed_at diff
-- branch so setting the timestamp writes a `cod_confirmed` event into
-- order_audit_events. Rebuilds the function verbatim from migration
-- 20260424110000 with the one new branch added.

alter table orders add column if not exists cod_confirmed_at timestamptz;
alter table orders add column if not exists cod_confirmed_by text;

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

  -- COD phone confirmation — admin marks the pre-shipment call as completed.
  -- Null→value transition emits once; remains idempotent because
  -- markCodConfirmed guards via .is(cod_confirmed_at, null).
  if old.cod_confirmed_at is distinct from new.cod_confirmed_at
     and new.cod_confirmed_at is not null then
    insert into public.order_audit_events (order_id, event_type, actor, payload)
    values (new.id, 'cod_confirmed', v_actor,
      jsonb_build_object(
        'cod_confirmed_at', new.cod_confirmed_at,
        'confirmed_by', new.cod_confirmed_by
      ));
  end if;

  return new;
end;
$$;
