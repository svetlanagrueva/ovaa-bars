-- Migration 20260424120000: Audit annotation edits on order_refunds
--
-- order_refunds rows are append-only for financial fields — the
-- trg_order_refunds_append_only_update trigger (migration 20260423200000)
-- rejects UPDATEs that touch anything other than `reason`,
-- `credit_note_ref`, and the auto-bumped `updated_at`. `updateRefundAnnotation`
-- is the sole supported UPDATE path.
--
-- Until this migration, annotation edits left NO trail. An admin changing
-- `credit_note_ref` from CN-2026-0042 to CN-2026-0099 bumped `updated_at`
-- but erased the prior value. For Bulgarian tax audit (credit-note
-- reference traceability), fraud forensics (challenged "reason" text), or
-- plain accidental-overwrite recovery, we need before/after history.
--
-- This migration adds an AFTER UPDATE trigger that emits a
-- `refund_annotation_edited` event into `order_audit_events`. The payload
-- carries the refund_id plus per-field {old, new} entries — but ONLY for
-- fields that actually changed (`jsonb_strip_nulls` drops unchanged-field
-- keys so a reason-only edit doesn't surface a noisy credit_note_ref=null
-- pair).
--
-- When neither annotation field changed (no-op UPDATE), the trigger early-
-- returns without emitting — the auto-bumped `updated_at` alone isn't
-- worth auditing.
--
-- Attribution: reads `current_setting('app.actor', true)` first, falling
-- back to `new.recorded_by`. Same pattern as `emit_order_refund_audit`
-- so the two triggers agree on actor attribution when multi-admin auth
-- lands (L14) and server actions start calling `set_config('app.actor', …)`.
--
-- Together with the existing AFTER INSERT `refunded` event, this gives
-- each refund row a complete audit trail: one `refunded` event at
-- creation + one `refund_annotation_edited` per subsequent annotation
-- change.

create or replace function emit_order_refund_annotation_audit()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_actor text := coalesce(current_setting('app.actor', true), new.recorded_by);
begin
  -- Early return when nothing audit-worthy changed. Without this the
  -- updated_at auto-bump (which fires before us) would make every UPDATE
  -- look like "something happened" to downstream naive filters.
  if old.reason is not distinct from new.reason
     and old.credit_note_ref is not distinct from new.credit_note_ref then
    return new;
  end if;

  insert into public.order_audit_events (order_id, event_type, actor, payload)
  values (
    new.order_id,
    'refund_annotation_edited',
    v_actor,
    jsonb_strip_nulls(jsonb_build_object(
      'refund_id', new.id,
      'reason', case
        when old.reason is distinct from new.reason
          then jsonb_build_object('old', old.reason, 'new', new.reason)
        else null
      end,
      'credit_note_ref', case
        when old.credit_note_ref is distinct from new.credit_note_ref
          then jsonb_build_object('old', old.credit_note_ref, 'new', new.credit_note_ref)
        else null
      end
    ))
  );
  return new;
end;
$$;

create trigger trg_emit_order_refund_annotation_audit
after update on order_refunds
for each row execute function emit_order_refund_annotation_audit();
