# Checkout & Invoice Flow

## Checkout Invoice Section
- "Искам фактура" checkbox (unchecked by default)
- Two tabs when checked: Физическо лице / Юридическо лице
- Физическо лице fields: name, EGN (10 digits), address, city, postal code
- Юридическо лице fields: company name, EIK/Булстат, ДДС номер, МОЛ name, registered address, city, postal code

## Server-Side Validation (`validateInvoiceInfo` in stripe.ts)
- Company: EIK must be 9-13 digits, VAT format BG+digits, company name required
- Individual: EGN must be 10 digits (if provided)
- Both: MOL/name and address required
- Field length limits enforced

## Invoice Data Storage
- `needs_invoice` boolean on order
- `invoice_company_name`, `invoice_eik`, `invoice_vat_number`, `invoice_mol`, `invoice_address`, `invoice_egn` columns
- `invoice_number` (sequential, gap-free via `issue_invoice_number` Postgres function)
- `invoice_date` (set atomically with number)

## COD Order Flow
- Created as `confirmed` immediately (no pending step)
- `confirmed_at` set at creation
- Cart cleared on success page (NOT in checkout — prevents empty-cart redirect race condition)
- `confirmOrder` on success page handles both card and COD (returns early for already-confirmed COD)

## Bulgarian Tax Compliance
- Invoice must be issued within 5 days of tax event
- Card payments: tax event = payment date (created_at)
- COD payments: tax event = delivery date (delivered_at)
- Sequential invoice numbering with no gaps (ZDDS Art. 78)
- EU Omnibus Directive: sale price must be lower than lowest price in last 30 days
