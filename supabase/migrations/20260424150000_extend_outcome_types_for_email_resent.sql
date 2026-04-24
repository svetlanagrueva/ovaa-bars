-- Migration 20260424150000: Extend record_order_outcome for email resends
--
-- Admin can manually resend the customer-facing transactional emails
-- (order confirmation / shipping notification / delivery confirmation)
-- from the order detail page. Each resend writes an `email_resent`
-- audit event with a payload describing which email was sent:
--
--   { "email_type": "order_confirmation" | "shipping" | "delivery" }
--
-- Why an outcome event and not a column diff:
--   - `order_confirmation_sent_at` and `delivery_email_sent_at` are
--     first-write-wins timestamps. A resend deliberately does not update
--     them (we keep the original "first successfully sent" timestamp as
--     the authoritative record). So the column-diff audit trigger would
--     not fire for a resend. Without an explicit event, the resend would
--     leave no trace.
--   - The admin intent — "I asked for this email to be sent again" — is
--     a discrete operational fact, best recorded as its own event.
--
-- Shipping email has no column at all (`shipping_email_sent_at` does
-- not exist — the first send is fire-and-forget, success is not
-- persisted). The audit event is the only record that a shipping email
-- was dispatched at all, original or resent. That's acceptable because
-- resends are rare and the "did the customer get their email" question
-- is answered by the Resend dashboard, not the DB.

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
    'email_resent'
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
