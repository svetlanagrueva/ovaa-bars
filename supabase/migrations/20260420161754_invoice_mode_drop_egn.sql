-- Migration 20260420161754: Invoice mode schema + drop invoice_egn
--
-- Two changes:
--
-- 1. Drop orders.invoice_egn entirely. Bulgarian tax law (ЗДДС) does NOT
--    require EGN on individual invoices unless the buyer claims tax deduction
--    — which individual retail buyers cannot do. We will never collect EGN.
--    Privacy wins: no national ID number ever touches the DB.
--
-- 2. Add invoice_type column with consistency CHECKs covering the
--    relationships between needs_invoice, invoice_type, and identifier fields.
--
-- Pre-launch: no data to migrate. Direct ALTER.

alter table orders drop column if exists invoice_egn;

alter table orders add column invoice_type text
  check (invoice_type in ('individual', 'company'));

-- needs_invoice=true requires invoice_type, mol, and a mailing address.
alter table orders add constraint chk_invoice_needs_fields check (
  needs_invoice = false
  or (
    invoice_type is not null
    and invoice_mol is not null and btrim(invoice_mol) <> ''
    and invoice_address is not null and btrim(invoice_address) <> ''
  )
);

-- Company invoices require EIK + company name. No EGN (we dropped the column).
alter table orders add constraint chk_invoice_company_fields check (
  needs_invoice = false
  or invoice_type <> 'company'
  or (
    invoice_company_name is not null and btrim(invoice_company_name) <> ''
    and invoice_eik is not null and btrim(invoice_eik) <> ''
  )
);

-- Individual invoices must NOT have company-only identifiers. Name comes from
-- invoice_mol; address from invoice_address (both required above).
alter table orders add constraint chk_invoice_individual_fields check (
  needs_invoice = false
  or invoice_type <> 'individual'
  or (
    invoice_eik is null
    and invoice_vat_number is null
    and invoice_company_name is null
  )
);

-- When needs_invoice is false, all invoice_* fields must be null. Prevents
-- stale identifier data from accumulating when a customer toggles the
-- "I want an invoice" checkbox off after typing.
alter table orders add constraint chk_invoice_fields_cleared check (
  needs_invoice = true
  or (
    invoice_type is null
    and invoice_company_name is null
    and invoice_eik is null
    and invoice_vat_number is null
    and invoice_mol is null
    and invoice_address is null
    and invoice_number is null
    and invoice_date is null
    and invoice_sent_at is null
  )
);
