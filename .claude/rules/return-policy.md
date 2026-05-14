# Return Policy & Consumer Rights

## Legal Framework
Bulgarian consumer protection law (ЗЗП) and EU Directive 2011/83/EU apply. The site sells protein bars (6-12 month shelf life) via distance contracts to Bulgarian consumers.

## Withdrawal Right (Право на отказ)
- **14-day withdrawal right** (Чл. 50 ЗЗП) for online purchases, no reason needed
- Period starts from the day the consumer receives the goods
- If seller fails to inform consumer about the right, period extends to **12 months + 14 days**
- **Model withdrawal form** (Приложение № 6 към ЗЗП) is legally required on the site — lives on `/returns` page Section 9

## Withdrawals — operational implementation
Backed by the `withdrawals` table (migration `20260429071812`) with formal state machine and audit trail.

- **Intake is admin-driven**: customer emails or calls; admin opens the order and registers via `Регистрирай отказ (Чл. 50 ЗЗП)` in the order detail dropdown. No public form — pre-launch volume doesn't warrant the moderation cost.
- **Hard block on non-delivered orders**: `createWithdrawal` rejects orders that aren't `status='delivered'` because the withdrawal right starts on receipt.
- **Two completion paths**:
  - Path A (return required, default): `requested → approved → goods_received → completed`
  - Path B (return NOT required, e.g. goodwill): `requested → approved → completed` directly with mandatory `completion_note`
- **`withdrawal_ref`** auto-generated as `WD-YYYY-NNNN` via DB sequence, exposed to customer in confirmation emails
- **Refund linkage**: when `resolution_type='refund'`, `withdrawals.refund_id` points to the `refunds` row. Set once, immutable. State-machine trigger validates the linkage at completion.
- **Admin UI**: `/admin/returns` (unified inbox of withdrawals + complaints) and `/admin/returns/[id]` (state-machine actions)

See `admin-panel.md` § Withdrawals for the full server-action and UI details.

## Legal Exceptions — Must Cite Both
Two exceptions from Чл. 57, ал. 1 ЗЗП apply to food products:
- **т. 4**: goods that deteriorate or expire rapidly (perishability)
- **т. 5**: sealed goods opened after delivery, unsuitable for return for hygiene/health reasons

Both must be cited together. Do not pick just one. Do not blanket-exclude all food products.

Practical clarification uses soft language: "на практика може да бъде упражнено, когато продуктът е неотворен" — not "може само ако". The law defines the exceptions; we explain the practical outcome.

The `withdrawals.eligibility_product_based` field captures this classification per-request: `'eligible' | 'perishable_or_short_shelf_life' | 'hygiene_exception' | 'unknown'`. Informational only — not a hard gate. Eligibility is determined by admin during approval based on the specific product/condition combination.

## Wording Rules (Legally Critical)
- **"право на отказ"** = the legal right (withdrawal). **"връщане"** = only the logistics step (shipping goods back)
- Return conditions framed as "Когато правото на отказ е приложимо, стоката следва да бъде:" — conditions are execution-level, not redefining the right
- 48-hour defect report is a **recommendation**, not a legal deadline — 2-year statutory guarantee unaffected
- "в състояние, позволяващо повторна продажба" is subordinate to the statutory diminished-value rule (Чл. 55, ал. 4) — cannot standalone reject a valid withdrawal
- Defect resolution: "в съответствие със законовите права на потребителя" — seller has right to repair/replace first; do NOT give unconditional consumer choice
- No invented thresholds (e.g. ">3 months shelf life") or fixed percentages (e.g. "up to 50% devaluation") without legal basis
- No self-imposed SLAs in legal text (e.g. "confirms in 2 business days") — they create breach risk

## Refund Rules
- Refund within **14 days**, same payment method (Чл. 55 ЗЗП)
- Seller may withhold refund until goods received or proof of shipment (Чл. 55, ал. 5)
- Card payments: Stripe refund to same card
- COD payments: consumer provides IBAN for bank transfer (recorded in `refunds.bank_transfer_ref`, required by DB CHECK when `method='bank_transfer'`)
- Delivery costs refunded only up to the cheapest standard option
- Consumer bears return shipping costs **only if** informed before purchase (checkout disclosure); otherwise seller pays
- Defective/incorrect/damaged goods: seller always covers return shipping

When a refund is recorded against an invoiced order (`affects_invoiced_supply=true` and the original фактура has `invoice_number` set), a `type='credit_note'` row is auto-created on `invoices` with `due_at = refund.refunded_at + 5 days` per ЗДДС Чл. 115. Admin issues the кредитно известие in Microinvest within the deadline. See `checkout-invoices.md` § Credit notes.

## EU ODR Platform — Discontinued
The EU Online Dispute Resolution platform (ec.europa.eu/consumers/odr) was shut down July 2025. Do NOT reference it anywhere. Use КЗП + Помирителни комисии only for ADR/dispute resolution.

## Complaints (рекламация)
Separate from withdrawals — defect-based, not subject to the 14-day window. Backed by the `complaints` table (ЗЗП Чл. 122-127). `complaint_ref` auto-generated as `RCL-YYYY-NNNN`. Surfaced alongside withdrawals in `/admin/returns` and order detail "Свързани заявки" card.

## Pages & Implementation
- `/returns` — dedicated 9-section return policy page (created April 2026)
- `/terms` Section 7 — dual-exception framing with cross-link to /returns
- `/terms` Section 12 — КЗП + Помирителни комисии (no EU ODR)
- Footer — "Право на отказ и връщане" link under "Правна информация"
- Checkout — return shipping cost disclosure between terms and marketing checkboxes

## Competitor Reference (April 2026)
- **FitSpo Zone** — best BG reference: correct т. 5 exception, model form with IBAN, 3-tier complaints
- **BornWinner** — uses only т. 4 (blanket food exemption) — legally risky
- **Pure Gains** — uses both exceptions correctly, simple conditions, but wrong 30-day refund timeline
- **XFuel** — generic Shopify template, no law citations — weakest compliance

## Operational Prerequisites — DONE
- ~~Withdrawal notice handling~~ — DONE: formal `withdrawals` table + admin UI at `/admin/returns`
- ~~14-day refund clock tracking~~ — DONE: countdown in admin order detail
- ~~Complaints register~~ — DONE: `complaints` table with auto-generated refs (ЗЗП Чл. 127)
- ~~Refund tracking~~ — DONE: `refunds` child table + `refund_items` for per-line allocation. Natural idempotency via `stripe_refund_id`.
- ~~Inventory expansion~~ — DONE: `recordStockMovement()` for B2B, samples, damage, returns, adjustments with document linkage
- ~~Credit note issuance~~ — DONE: auto-creation on refund (`lib/credit-note.ts`) when invoice exists + invoice_number set + `affects_invoiced_supply=true`
- ~~Batch traceability~~ — DONE: Tier 1 (`product_batches` + `order_item_batches`) for EU 178/2002 + EU 931/2011 + БАБХ recall procedure

## Outstanding (administrative, not code)
- COD refunds by IBAN — manual bank transfer
- Fiscal handling: bank transfer refunds don't trigger storno; cash refunds would need storno process (НАП)
- Microinvest workflow: admin issues фактура → pastes invoice_number; on refund, admin issues кредитно известие → pastes credit_note number into the auto-created invoices row
