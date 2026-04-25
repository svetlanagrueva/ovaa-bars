-- Migration 20260421060546: Extend record_order_outcome allowed types
--
-- Stripe webhook now handles three additional events that produce order
-- outcome audit entries:
--
--   external_refund  — charge.refunded event from Stripe (refund issued
--                       outside the admin UI, e.g. via Stripe dashboard)
--   payment_failed   — payment_intent.payment_failed event (3DS challenge
--                       failed, card declined post-authorization). Cuts the
--                       stuck-pending window from 24h (session expiry) to
--                       seconds.
--   dispute_opened   — charge.dispute.created event (chargeback filed).
--                       Operator needs to know immediately.

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
    'dispute_opened'
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
