-- Fix emit_order_refund_audit referencing the dropped credit_note_ref column.
--
-- Migration 20260428072545_invoices_table.sql:
--   - dropped order_refunds.credit_note_ref (moved to invoices.invoice_number
--     where type='credit_note')
--   - replaced emit_order_refund_annotation_audit (AFTER UPDATE) to reflect
--     the new mutable-fields set
--   - BUT missed emit_order_refund_audit (AFTER INSERT), which still emits
--     `new.credit_note_ref` in its 'refunded' event payload → 42703
--     "record 'new' has no field 'credit_note_ref'" on every refund insert.
--
-- This fix updates the AFTER INSERT function to drop credit_note_ref from the
-- payload and add the new structured fields (bank_transfer_ref,
-- affects_invoiced_supply, withdrawal_id) so audit consumers see the same
-- shape they'd see if they joined order_refunds at the time of the event.

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
      'refund_id',                new.id,
      'amount_cents',             new.amount_cents,
      'method',                   new.method,
      'source',                   new.source,
      'stripe_refund_id',         new.stripe_refund_id,
      'bank_transfer_ref',        new.bank_transfer_ref,
      'reason',                   new.reason,
      'affects_invoiced_supply',  new.affects_invoiced_supply,
      'withdrawal_id',            new.withdrawal_id
    ));
  return new;
end;
$$;
