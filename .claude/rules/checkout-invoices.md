# Checkout & Invoice Flow

## Checkout Invoice Section
- "Искам фактура" checkbox (unchecked by default)
- Two tabs when checked: Физическо лице / Юридическо лице
- Физическо лице fields: address, city, postal code (legal name comes from order's `first_name + last_name`; **no MOL field, no EGN** — not required for retail invoices under ЗДДС)
- Юридическо лице fields: company name, EIK/Булстат, ДДС номер (optional), МОЛ name, registered address, city, postal code

## Server-Side Validation (`validateInvoiceInfo` in stripe.ts)
- `type` must be `individual` or `company`
- Company: EIK 9-13 digits, VAT format BG+digits (optional), company name required, MOL required
- Individual: only address required (legal name pulled from the order's first_name + last_name)
- Field length limits enforced

## Invoice Data Storage — invoices table (NOT orders columns)
Migration `20260428072545_invoices_table.sql` moved invoice data off the orders row into a dedicated `invoices` table that holds both initial фактури and кредитни известия.

- `invoices.type='invoice'` row inserted at order creation when customer requested a фактура (`createCheckoutSession` and `createCODOrder` paths in `app/actions/stripe.ts`). Insert-or-rollback semantics: if order insert succeeds but invoice insert fails, the order is rolled back (atomicity at app layer).
- Profile fields on the invoices row: `invoice_type` (individual|company), `company_name`, `eik`, `vat_number`, `mol`, `address`. CHECK constraints enforce shape per `invoice_type`.
- Issuance metadata (set later by admin): `invoice_number`, `invoice_date`, `sent_at`. `due_at` for credit_note rows tracks the 5-day deadline.
- The order row no longer has `needs_invoice` / any `invoice_*` fields. To check whether an order has an invoice, look up `invoices` by `order_id` with `type='invoice'`.

## Invoice Generation (issuance)
- Invoices are generated externally using **Microinvest Invoice Pro** (not in-app)
- Admin enters the invoice number manually in the order detail Документи card (per-row input, since multiple invoices may exist: one initial + zero-or-more credit_notes)
- Server action: `setInvoiceNumber(invoiceId, invoiceNumber)` — saves the number, sets `invoice_date`. Idempotent: `.is('invoice_number', null)` guard prevents overwrite. Works for both `type='invoice'` and `type='credit_note'`.
- Server action: `markInvoiceSent(invoiceId)` — sets `sent_at`. Guards: `.is('sent_at', null)` + `.not('invoice_number', 'is', null)`.
- No PDF generation or invoice emailing in the codebase.

## Credit notes (кредитни известия) — auto-created
ЗДДС Чл. 115 requires a кредитно известие when the tax base of an invoiced supply changes (refund, partial cancellation, etc.) and references the original фактура.

After a refund insert (`recordRefund`), `lib/credit-note.ts:autoCreateCreditNoteRow` evaluates three conditions:
1. An `invoices` row of `type='invoice'` exists for the order.
2. That row has `invoice_number` set (фактура actually issued in Microinvest).
3. `refunds.affects_invoiced_supply = true`.

If all three hold, a row is inserted with:
- `type='credit_note'`
- `refund_id` = the new refund's id
- `references_invoice_id` = the original invoice's id
- `due_at = refund.refunded_at + 5 days` (per ЗДДС Чл. 113 ал. 4)
- All profile fields null (DB CHECK `chk_credit_note_shape` enforces)

Admin then enters the credit_note number (issued in Microinvest with sequential numbering) via the same `setInvoiceNumber(invoiceId, ...)` action used for the original фактура.

If any of the three conditions fails (no invoice row, invoice not yet issued, or `affects_invoiced_supply=false`), no credit_note is created. The `affects_invoiced_supply=false` path requires a non-empty `credit_note_skip_reason` (DB CHECK `chk_skip_reason_when_skipping` enforces) — audit trail for why no кредитно известие was issued.

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
- Neither card (Stripe) nor COD (ППП) requires a касов бон — both are non-cash per Наредба Н-18 Чл. 3
- COD courier APIs are explicitly configured for ППП (see `technical-decisions.md` → Courier API section)
- Business is not VAT registered — invoices only issued on customer request
- Pre-launch НАП requirement: file Чл. 52м e-shop registration (administrative, not code)

## Delivery Confirmation
- All delivery paths converge on `confirmDeliveryForOrder()` in `lib/delivery-confirmation.ts`
- `confirm_delivery` RPC atomically sets `status = 'delivered'` + `delivered_at`, guarded by `status = 'shipped'`
- Delivery email sent via `sendDeliveryEmail()` — fire-and-forget, records `delivery_email_sent_at` on success, `delivery_email_last_error` on failure
- Cron (`/api/cron/delivery-checks`) polls courier APIs daily at 18:00 UTC as primary detection path
- Admin manual "mark as delivered" also uses the shared path — no duplicate side-effect logic
- Duplicate delivery emails are accepted as harmless; `delivery_email_sent_at` early-return prevents most avoidable duplicates

## Bulgarian Tax Compliance
- Invoice (фактура) must be issued within **5 days of tax event** (ЗДДС Чл. 113 ал. 4)
  - Card payments: tax event = payment date (created_at)
  - COD payments: tax event = delivery date (delivered_at)
- Credit note (кредитно известие) must be issued within **5 days of refund** (ЗДДС Чл. 115). Tracked via `invoices.due_at = refund.refunded_at + 5 days`.
- Sequential invoice/credit_note numbering with no gaps (ЗДДС Чл. 78) — Microinvest manages the sequence; admin pastes each number into the corresponding invoices row.
- EU Omnibus Directive: sale price must be lower than lowest price in last 30 days. Compliance preserved via static base prices in `lib/products.ts` + active-sales lookup in `lib/sales.ts`. Migration `20260427140328` dropped the redundant `product_price_history` table — base prices being static makes a price-history table unnecessary for compliance computation.
