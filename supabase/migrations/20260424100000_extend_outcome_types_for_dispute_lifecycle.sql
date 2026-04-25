-- Migration 20260424100000: Extend record_order_outcome for dispute lifecycle
--
-- The Stripe webhook already records `dispute_opened` (migration
-- 20260421060546). Without handlers for the resolution events, admin sees
-- the opened-dispute alert but has no local record of "dispute won / lost"
-- and no audit trail of when the funds were reinstated. This migration
-- extends the allowed outcome types so the webhook can record the full
-- dispute lifecycle.
--
-- Event mapping:
--   charge.dispute.closed            → dispute_closed
--       Fires when the dispute is resolved. `dispute.status` carries the
--       outcome: 'won', 'lost', 'warning_closed', etc. Payload includes
--       the status + reason so the timeline shows the resolution.
--
--   charge.dispute.funds_reinstated  → dispute_funds_reinstated
--       Fires only when we won AND Stripe actually restores the held
--       funds to the merchant balance. Distinct from dispute_closed
--       because the money movement can trail the resolution slightly.
--
-- Note: dispute-caused refunds (when we lose) already flow through the
-- existing `refund.created` / `charge.refunded` handlers into
-- order_refunds (source='stripe_webhook'); no new refund path needed here.

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
    'dispute_funds_reinstated'
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
