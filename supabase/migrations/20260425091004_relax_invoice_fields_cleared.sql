-- Migration 20260425091004: Allow admin to record an invoice number on
-- orders where needs_invoice=false.
--
-- Real-world ops: customer didn't tick the "I want an invoice" box at
-- checkout, then changes their mind on the phone-confirm call. Admin
-- issues the invoice externally in Microinvest with whatever profile
-- the customer dictates over the phone, and just wants to record the
-- invoice number against the order so it shows up in the timeline,
-- export, and 5-day deadline tracking.
--
-- The previous chk_invoice_fields_cleared (migration 20260420161754)
-- forbade ANY invoice_* field from being set when needs_invoice=false,
-- including invoice_number / invoice_date / invoice_sent_at. That was
-- correct for the customer-facing flow it was designed for: when a
-- customer toggles the checkbox off after typing identifier data,
-- their typed-and-then-untyped data shouldn't persist. But it's too
-- strict for admin operations:
--
--   * invoice_number and invoice_date are admin-controlled, issued by
--     Microinvest, never touched by the customer-facing form. There's
--     no stale-data risk if admin sets them.
--   * The profile fields (type, company_name, eik, vat_number, mol,
--     address) ARE customer data; the original CHECK still applies to
--     them because those represent customer consent.
--   * invoice_sent_at follows invoice_number — once admin has emitted
--     the invoice, sending it to the customer is independent of the
--     original needs_invoice state.
--
-- Resolution: keep the profile-clearing constraint, but drop the
-- number/date/sent_at clauses from it. Admin can record an invoice
-- number on any order; the customer-facing flow is unaffected.

alter table orders drop constraint if exists chk_invoice_fields_cleared;

alter table orders add constraint chk_invoice_fields_cleared check (
  needs_invoice = true
  or (
    invoice_type is null
    and invoice_company_name is null
    and invoice_eik is null
    and invoice_vat_number is null
    and invoice_mol is null
    and invoice_address is null
  )
);
