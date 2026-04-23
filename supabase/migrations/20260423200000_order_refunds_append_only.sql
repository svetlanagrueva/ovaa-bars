-- Migration 20260423200000: append-only semantics for order_refunds
--
-- order_refunds rows represent actual money movements — they are part of the
-- financial audit trail alongside inventory_log and order_audit_events. Prior
-- to this migration rows were mutable and deletable by the service role,
-- leaving a gap where a bad admin action or future bulk update could silently
-- rewrite or erase refund history.
--
-- This migration tightens two axes:
--
--   1. DELETE is rejected unconditionally. For corrections, the phase-2 plan
--      is a reversing-refund mechanism (negative-amount row); pre-phase-2 a
--      mistake requires manual DB intervention. Matches inventory_log and
--      order_audit_events immutability.
--
--   2. UPDATE is allowed only on annotation fields (reason, credit_note_ref)
--      plus the auto-maintained updated_at. Every other column — amount,
--      method, source, stripe_refund_id, client_idempotency_key, recorded_by,
--      refunded_at, created_at, order_id, id — is immutable once the row is
--      recorded. updateRefundAnnotation is the sole supported UPDATE path.
--
-- Trigger ordering (BEFORE UPDATE, alphabetical by name):
--   1. trg_enforce_refund_total        (sum guard)
--   2. trg_order_refunds_append_only_update  (this migration)
--   3. trg_set_order_refunds_updated_at (auto-bump)
--
-- The append-only trigger fires before set_order_refunds_updated_at, so at
-- check time old.updated_at = new.updated_at (no change yet). The list below
-- does not include updated_at, so the automatic bump that follows is always
-- allowed.

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
     or old.created_at is distinct from new.created_at then
    raise exception 'order_refunds financial fields are immutable; only reason and credit_note_ref may be edited (via updateRefundAnnotation)';
  end if;
  return new;
end;
$$;

create or replace function raise_order_refunds_immutable_delete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'order_refunds is append-only; DELETE is not permitted. To correct a mistake, create a reversing refund (phase 2) or apply a manual data repair.';
end;
$$;

create trigger trg_order_refunds_append_only_update
before update on order_refunds
for each row execute function enforce_order_refunds_append_only_update();

create trigger trg_order_refunds_immutable_delete
before delete on order_refunds
for each row execute function raise_order_refunds_immutable_delete();
