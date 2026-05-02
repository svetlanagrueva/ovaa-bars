-- ──────────────────────────────────────────────────────────────────────────
-- invoices: append-mostly + non-deletable (ЗДДС Чл. 116 backstop)
-- ──────────────────────────────────────────────────────────────────────────
--
-- Background. Every other financial table in the schema has DB-level
-- immutability triggers (refunds, refund_items, inventory_log,
-- order_audit_events, order_item_batches, plus product_batches' append-
-- mostly transition). Invoices were the lone exception — only an updated_at
-- trigger and an audit-events emitter, no UPDATE/DELETE protection.
--
-- App layer guards exist (setInvoiceNumber uses .is("invoice_number", null),
-- markInvoiceSent uses .is("sent_at", null)), but they're convention not
-- backstop. A migration mistake or service-role manual SQL could mutate
-- issued invoice numbers, dates, or sent_at — silently breaking the audit
-- trail required by ЗДДС Чл. 116 (corrections to issued documents go
-- through credit_note, never via in-place edit).
--
-- This migration adds:
--   1. trg_invoices_append_mostly_update — BEFORE UPDATE trigger that allows
--      only forward transitions on invoice_number / invoice_date / sent_at
--      (NULL → set, never reverted, never re-set to a different value).
--      Identity, profile, and linkage fields strictly immutable.
--   2. trg_invoices_immutable_delete — BEFORE DELETE trigger that rejects
--      unconditionally. Wrong invoices get corrected via credit_note (Чл.
--      115), never deleted.
--
-- updated_at remains mutable (set by the existing trg_set_invoices_updated_at
-- trigger). The new trigger doesn't compare it.

create or replace function enforce_invoices_append_mostly_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Identity, profile, and linkage are strictly immutable post-insert.
  if old.id is distinct from new.id
     or old.order_id is distinct from new.order_id
     or old.type is distinct from new.type
     or old.refund_id is distinct from new.refund_id
     or old.references_invoice_id is distinct from new.references_invoice_id
     or old.invoice_type is distinct from new.invoice_type
     or old.company_name is distinct from new.company_name
     or old.eik is distinct from new.eik
     or old.vat_number is distinct from new.vat_number
     or old.mol is distinct from new.mol
     or old.address is distinct from new.address
     or old.due_at is distinct from new.due_at
     or old.created_at is distinct from new.created_at then
    raise exception 'invoices identity, profile, and linkage fields are immutable post-insert; corrections to issued documents go through credit_note (ЗДДС Чл. 115)';
  end if;

  -- Issuance + send fields are forward-only: NULL → set, never reverted,
  -- never re-set. Once a фактура or кредитно известие has a number, that
  -- number is the document's identity in Microinvest's sequence and can't
  -- be silently rewritten.
  if old.invoice_number is not null
     and new.invoice_number is distinct from old.invoice_number then
    raise exception 'invoices.invoice_number is immutable once set; issue a credit_note for corrections';
  end if;
  if old.invoice_date is not null
     and new.invoice_date is distinct from old.invoice_date then
    raise exception 'invoices.invoice_date is immutable once set';
  end if;
  if old.sent_at is not null
     and new.sent_at is distinct from old.sent_at then
    raise exception 'invoices.sent_at is immutable once set';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_invoices_append_mostly_update on invoices;
create trigger trg_invoices_append_mostly_update
  before update on invoices
  for each row execute function enforce_invoices_append_mostly_update();

create or replace function raise_invoices_immutable_delete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'invoices is append-mostly; DELETE is not permitted. Issued documents can only be corrected via credit_note (ЗДДС Чл. 115).';
end;
$$;

drop trigger if exists trg_invoices_immutable_delete on invoices;
create trigger trg_invoices_immutable_delete
  before delete on invoices
  for each row execute function raise_invoices_immutable_delete();
