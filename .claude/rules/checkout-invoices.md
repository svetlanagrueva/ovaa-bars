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
- `invoice_number` — manually entered by admin (generated externally via Microinvest Invoice Pro)
- `invoice_date` — set when admin saves the invoice number

## Invoice Generation
- Invoices are generated externally using **Microinvest Invoice Pro** (not in-app)
- Admin enters the invoice number manually in the order detail page
- No PDF generation or invoice emailing in the codebase
- Server action: `setInvoiceNumber(orderId, invoiceNumber)` saves the number

## COD Order Flow
- Created as `confirmed` immediately (no pending step)
- `confirmed_at` set at creation
- Cart cleared on success page (NOT in checkout — prevents empty-cart redirect race condition)
- `confirmOrder` on success page handles both card and COD (returns early for already-confirmed COD)

## Payment Lifecycle & Settlement
- `paid_at` tracks when the seller actually received money
- Card: `paid_at` set automatically on Stripe webhook (`checkout.session.completed`) and success page fallback
- Card: `stripe_receipt_url` fetched from PaymentIntent → Charge, included in confirmation email as "Разписка за картово плащане (Stripe)"
- Card: `stripe_payment_intent_id` stored for Stripe payout reconciliation
- `order_confirmation_sent_at` set after confirmation email is successfully sent
- COD: `paid_at` set manually by admin when courier settlement is recorded
- COD settlement fields: `courier_ppp_ref` (ППП document), `settlement_ref` (bank transfer ref), `settlement_amount` (actual amount after courier commission)
- Receivable tracking: `delivered_at IS NOT NULL AND paid_at IS NULL` = open receivable from courier
- Server action: `recordCodSettlement(orderId, { courierPppRef, settlementRef, settlementAmount, paidAt })`
  - Validates: order must be COD, status must be delivered or shipped, `paidAt` cannot be before delivery or in future
  - Idempotency: `.is("paid_at", null)` prevents double-recording
  - Date picker value stored at 23:59:59 UTC; defaults to `new Date()` if omitted
- Server action: `markInvoiceSent(orderId)` — sets `invoice_sent_at`, guards on invoice_number existing and not already sent
- Neither card (Stripe) nor COD (ППП) requires a касов бон — both are non-cash per Наредба Н-18 Чл. 3
- COD courier APIs are explicitly configured for ППП (see `technical-decisions.md` → Courier API section for field values)
- Business is not VAT registered — invoices only issued on customer request (`needs_invoice`)
- Pre-launch НАП requirement: file Чл. 52м e-shop registration (administrative, not code)

## Bulgarian Tax Compliance
- Invoice must be issued within 5 days of tax event
- Card payments: tax event = payment date (created_at)
- COD payments: tax event = delivery date (delivered_at)
- Sequential invoice numbering with no gaps (ZDDS Art. 78)
- EU Omnibus Directive: sale price must be lower than lowest price in last 30 days
