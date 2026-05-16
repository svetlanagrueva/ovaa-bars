# Technical Decisions & Gotchas

## Next.js 16
- `revalidateTag` requires 2 arguments: `revalidateTag("tag-name", "max")` — second arg is cache profile
- `useSearchParams()` requires Suspense boundary for static prerendering — wrap page in Suspense
- Middleware file convention deprecated (warning only, still works) — "proxy" is the replacement

## Node.js
- Default nvm version is Node 12 — tests and builds require Node 22
- Use `nvm use 22` before running vitest or tsc

## Supabase
- Legacy anon/service_role keys still work — "legacy" just means newer key system exists alongside
- New secret keys work as drop-in replacement for service_role
- Default row limit (~1000) can silently truncate queries — `getAllOrders`/`getAllInvoices` paginate in batches of 1000
- `applyOrderFilters`/`applyInvoiceFilters` use `any` type for query param — Supabase query builder type is too complex for generic typing
- **No `.catch()` on query builder** — it's thenable but not a Promise subclass. Use `const { error } = await supabase.rpc(...)` everywhere; never chain `.catch()`.

## Stripe
- Webhook secret (`STRIPE_WEBHOOK_SECRET`) needed for local testing via `stripe listen`
- Test card: 4242 4242 4242 4242
- Handled webhook events: `checkout.session.completed` (confirm order, fetch receipt URL, send emails via unified sender), `checkout.session.expired` (restore inventory atomically), and the four refund events: `refund.created`, `refund.updated`, `refund.failed`, `charge.refunded` (all converge on `upsertRefundFromStripe`)
- Webhook fetches receipt URL via `stripe.paymentIntents.retrieve` with `expand: ['latest_charge']` — graceful degradation if fetch fails
- Webhook validates `amount_received` against `total_amount` and logs mismatch (no-throw guard)
- `stripe_receipt_url` is a Stripe payment receipt, NOT a Bulgarian legal document — label as "Разписка за картово плащане (Stripe)", never as фактура/касов бон

## Courier Tracking APIs
- Speedy: `POST /shipment/track` — accepts `parcels: [{ id: trackingNumber }]`, returns `operations` array with `operationCode` and `dateTime`. Code `-14` = Delivered.
- Econt: `POST /ShipmentStatusService.getShipmentStatuses.json` — accepts `shipmentNumbers: [trackingNumber]`, returns `shipmentStatuses` with `deliveryTime`, `shortDeliveryStatusEn`. Non-null `deliveryTime` or `shortDeliveryStatusEn === "Delivered"` means delivered.
- Both return `CourierShipmentStatus { delivered, deliveredAt?, rawStatus?, rawEventCode?, source }` for uniform consumption
- Courier webhooks for delivery notification are **not yet implemented** (Phase 2) — pending confirmation of event format, auth model, and retry semantics from both couriers

## Testing
- Mock setup: `vi.clearAllMocks()` clears history but not implementations — must manually reset mocks like `update`, `rpc`, `single`, `range`, `order`, `limit`, `maybeSingle`, `in`, `not`, `or`, `neq` in `beforeEach`
- `revalidateTag` must be mocked via `vi.mock("next/cache", ...)`
- Test helpers: `tests/helpers/supabase-mock.ts` — `createSupabaseMock()`, `resetSupabaseMock()`, `mockThenableResult()`, `createUpdateChain()`. Use `mockThenableResult` when the chain ends in `.select().single()`.

## Order ID format
**`orders.id` is `text` (10-char lowercase hex), not `uuid`.** Only orders — every other id column in the schema stays `uuid`.

**Why**:
- The customer-visible ID (success page, confirmation email, courier label) IS the stored ID — no slice-and-uppercase divergence between display and DB.
- Admin search bar accepts the literal `#A1B2C3D4E5` a customer reads aloud and resolves with an indexed equality, not an ilike prefix scan.
- Shorter URLs (`/admin/orders/a1b2c3d4e5`) — readable, type-able for cross-team support handoffs.

**Mechanics**:
- DEFAULT `lower(encode(gen_random_bytes(5), 'hex'))`; CHECK `^[0-9a-f]{10}$`. Stored lowercase; **uppercased only at the display boundary** via `formatOrderId(id)` from `lib/orders.ts`.
- 16^10 ≈ 1.1T values → birthday collision at 10k orders is ~10⁻⁸. The three INSERT paths (`createCheckoutSession`, `createCODOrder`, and any future order-mint path) wrap the insert in `insertOrderWithRetry` in `app/actions/stripe.ts` — up to 3 retries on Postgres `23505` (unique_violation) with a fresh default; any other error throws immediately. Cheap belt-and-suspenders.
- Validation regex: `ORDER_ID_REGEX = /^[0-9a-f]{10}$/i` exported from `lib/orders.ts`. **Don't reuse `UUID_REGEX` on order IDs** — it lives in `app/actions/admin.ts` for the other entity IDs (refunds, withdrawals, batches, invoices, sales, promo codes, idempotency keys).
- 8 FK columns inherit the type swap: `order_items.order_id`, `inventory_log.order_id`, `order_audit_events.order_id`, `refunds.order_id`, `withdrawals.order_id`, `invoices.order_id`, `marketing_email_log.order_id`, `complaints.order_id` — all `text`.
- RPC parameter type is `text` everywhere: `reserve_inventory`, `restore_inventory`, `record_order_outcome`, `force_status_override`, `add_admin_note`, `edit_order_quantity`, `add_order_item`, `remove_order_item`, `confirm_delivery`, `save_batch_allocation`; return-table columns `affected_orders_for_batch.order_id` and `claim_marketing_emails.out_order_id` are `text` as well.

**When writing tests**: use `validOrderId` (10-char hex) from `tests/helpers/fixtures.ts` for order IDs; `validUUID` stays a real UUID for refund/withdrawal/batch/invoice/sale/promo/idempotency columns. Mixing them silently fails the validators.

**When emitting display strings**: use `formatOrderId(id)` from `lib/orders.ts` — it's the single source of truth for the `#XXXXXXXXXX` format. JSX, email subjects, email bodies, webhook alerts all go through this helper. Don't inline `#${id.toUpperCase()}`.

**When validating order-id input from outside (URL params, Stripe metadata, search box)**: `ORDER_ID_REGEX.test(orderId)` after `.trim().toLowerCase().replace(/^#/, "")` if the input might be uppercased or prefixed.

## Architecture: Three/Four-Layer Separation
The most important pattern in the codebase. Refunds, returns, and complaints are NOT bundled into a single "process a return" action. They are decomposed into independently-callable layers:

- **Request layer**: `complaints` (рекламация — ЗЗП Чл. 122-127) + `withdrawals` (отказ — ЗЗП Чл. 50). What the customer asked for and why.
- **Money layer**: `refunds` + `refund_items`. What was refunded and to which lines.
- **Goods layer**: `inventory_log`. What physically moved (or didn't).
- **Accounting layer**: `invoices` (type='invoice' or 'credit_note'). What was documented for tax/legal.
- **Audit layer**: `order_audit_events`. What happened, when, by whom.

Each layer has its own server action (`recordRefund`, `recordStockMovement`, `recordComplaint`, `createWithdrawal`, `setInvoiceNumber`, etc.). The UI orchestrates them as a guided multi-step flow — the actions don't bundle internally. Benefits: independent idempotency, partial-failure recovery, clear audit boundaries, regulators get distinct documents.

Cross-layer linkage is by ID reference (e.g. `refunds.withdrawal_id`, `inventory_log.reference_id` pointing to refund.id, `invoices.refund_id`) — never by inlined data.

## Tier 1 Batch Traceability
Migration `20260429123326_batch_traceability.sql`. **Why we built this even at 3 SKUs**:
- EU 178/2002 Чл. 18 requires one-step-back/one-step-forward traceability for all food businesses, regardless of size.
- EU 931/2011 mandates batch info on B2B consignments of animal-origin products (including egg-derived).
- Bulgarian ЗХр Чл. 84-86 transposes both. БАБХ inspectors expect a precise audit trail per batch.
- Over-approximation by SKU+date works for customer-outreach UX but doesn't satisfy the regulator.
- B2B is on the roadmap; doing this Tier 1 now is cheaper than retrofitting later.

**Design choices**:
- Append-mostly: `product_batches` allows only `active → recalled` forward UPDATE. All other field changes raise. DELETE blocked. Tamper-evident.
- Fully immutable: `order_item_batches` rejects all UPDATE/DELETE post-insert. Allocation locked at ship time.
- Decoupled from inventory_log: the two layers are independent. `inventory_log.batch_in` rows still record receipts; `product_batches` records the supplier-label batch identity. They can be reconciled by sum but neither is a write-through to the other.
- Helper RPCs `batch_quantity_available` and `affected_orders_for_batch` derive on demand — no materialized batch_current table.
- Customer-return-damaged is excluded from `batch_quantity_available` outflows because those movements are also audit-only at SKU level (matches the inventory_current treatment).

**FEFO at ship time**: `suggestBatchesForShipment(orderId)` picks earliest-expiring active batches with available quantity. Admin can override per-batch in the picker dialog. `confirmShipmentBatches(orderId, allocations)` validates per-SKU sum equality with order_items.quantity, all selected batches `active` and same SKU as the line, no overcommit vs `batch_quantity_available`.

## Refund Items (per-line allocation)
Migration `20260429111613_refund_items_table.sql`. Adds explicit per-line monetary allocation independent of `inventory_log`. Used when a refund covers a price reduction or shipping dispute where no goods physically move.

**Decisions**:
- **Discount handling**: Option A for MVP — refund_items records the post-discount line amount; admin enters the actual cents refunded per line. Promo-discount allocation is implicit.
- **Atomicity**: app-level rollback in the `recordRefund` server action. The DB triggers (quantity cap, amount cap) are backstops; the action validates first and returns friendly errors before hitting DB.
- **Mixed mode in UI**: a single "По артикули" mode optionally with a "Допълнителна сума само" lump (the difference between sum of items and the refund total — for shipping or goodwill). Avoids three confusing modes.
- **Webhook refunds**: webhook-originated rows leave `refund_items` empty by design — Stripe doesn't tell us which line was refunded.
- **Append-only**: no edits or deletes on refund_items; corrections via reversing entries (post-launch) or manual data repair.
- **Webhook idempotency** unchanged — `stripe_refund_id` unique partial index dedupes regardless of refund_items presence.

**Allocation authority**: when `refund_items` rows exist they're the authoritative per-line allocation; otherwise the refund is treated as un-allocated (goodwill / shipping-only). The admin UI does NOT render a VAT/net/gross breakdown — VAT is recorded from Microinvest paste post-registration, never computed in the UI.

## Withdrawals State Machine
Migration `20260429071812_withdrawals_table.sql`. **Decisions**:
- **No public form**. Intake is admin-driven only — customer emails or calls; admin opens the order and registers. Pre-launch volume doesn't warrant the moderation cost of a public form.
- **Two completion paths**: Path A (return required, default) and Path B (return NOT required — goodwill / customer keeps product). Path B avoids the "goods_received fiction" of pretending we received goods we didn't.
- **Forward-only state machine** with a force-override RPC for data repair (mirrors orders state machine). Every override leaves a `withdrawal_status_force_override` audit event with the admin-supplied reason ≥ 20 chars.
- **One open per order** via partial unique index — closed states (rejected, completed) excluded so customers can file a new withdrawal after a closed one.
- **No reject after goods_received** (DB CHECK) — legally messy. Path is `requested|approved → rejected` only.
- **Refund linkage** via `refunds.withdrawal_id` (immutable once set; one refund per withdrawal max). State-machine trigger validates `refund_id IS NOT NULL` when `resolution_type='refund'` at completion.
- **Hard block on non-delivered orders**: withdrawal right (Чл. 50 ЗЗП) starts on receipt of goods. `createWithdrawal` rejects if order isn't delivered, with a friendly Bulgarian message.
- **Soft warn on unpaid orders**: at goods_received, surface a warning if the order isn't paid (refund-without-payment is unusual but allowed).
- **Ambiguous email**: `customer_email` defaults to `order.email` but is editable. Admin can register a withdrawal with a different email if the customer reached out from a different address.

## Security Fixes Applied
- `setInvoiceNumber` overwrite protection: `.is("invoice_number", null)` guard prevents replacing existing numbers
- Search SQL wildcard injection: `escapeIlike()` escapes `%` and `_`
- Invoice billing data validated server-side (EIK format, required fields, lengths)
- `trackingNumber` max 200 chars, `cancellationReason` max 1000 chars, `recall_reason` ≥ 20 chars + ≤ 1000, `withdrawal.completion_note` ≤ 1000, `force_*_override` reason ≥ 20 chars
- CSV export batches through all results (prevents Supabase row limit truncation)
- Email templates: all user data HTML-escaped via `escapeHtml()` in `lib/email-template.ts`
- Unsubscribe tokens: HMAC-SHA256 signed payloads (`email|timestamp`), verified with `timingSafeEqual`, 90-day expiry
- Cron auth: `CRON_SECRET` verified with `timingSafeEqual` (constant-time), not string `===`
- Unsubscribe API: rate-limited (10 req/15min per IP), token length capped at 500
- Email case sensitivity: all unsubscribe checks use `lower()` in SQL, API stores lowercase
- Marketing email concurrency: `FOR UPDATE SKIP LOCKED` in Postgres, `claimed_at` for stale detection (not `created_at`)
- `getBaseUrl()` shared via `lib/constants.ts` — single source of truth for absolute URLs
- `recordCodSettlement` idempotency: `.is("seller_settled_at", null)` prevents double-recording; validates order is COD + delivered/shipped; `settledAt` date cannot be before delivery or in future
- `markInvoiceSent` idempotency: `.is("sent_at", null)` + `.not("invoice_number", "is", null)` guards on the invoices row
- `addAdminNote` append-only: calls the `add_admin_note` RPC which does atomic `jsonb ||` append; max 2000 chars per note. Row-level serialization prevents concurrent-note loss.
- `refunds` append-only: financial fields immutable; only `reason`, `bank_transfer_ref`, `credit_note_skip_reason`, `updated_at` mutable
- `refund_items` append-only: no UPDATE/DELETE; corrections via reversing entries
- `inventory_log` append-only: BEFORE UPDATE/DELETE triggers raise unconditionally
- `invoices` append-mostly: forward-only transitions on `invoice_number` / `invoice_date` / `sent_at` (NULL → set); identity, profile, linkage, `due_at`, `created_at` strictly immutable; DELETE rejected. Corrections to issued documents go through credit_note per ЗДДС Чл. 115/116.
- `product_batches` append-mostly: only `active → recalled` forward UPDATE; recall metadata required in same UPDATE
- `order_item_batches` status-conditional: mutable while parent order's `tracking_number IS NULL`; locked the moment a tracking number lands (covers the `'__generating__'` placeholder). `cancelShipment` clears tracking and re-opens edits, emitting `batch_allocation_unlocked_after_shipment_cancelled`.
- Stripe refund verification on paste: 4-way check (exists, succeeded, payment_intent matches, amount matches) — rejects phantom / misattributed rows at source

## Contact Form
- Fields: Име (name), Фамилия (lastName), Имейл (email), Съобщение (message) — no subject field
- Email subject auto-generated as `${name} ${lastName} - запитване`
- Server action: `sendContactMessage()` in `app/actions/contact.ts`

## Delivery Methods
- Exactly 3 valid options, enforced in `VALID_DELIVERY_METHODS` (stripe.ts) and checkout UI: `econt-office`, `speedy-office`, `speedy-address`
- `econt-address` is deliberately excluded — not a supported delivery option
- `logistics_partner` is unconstrained text in Postgres; validation is application-layer only (stripe.ts)
- Admin shipment generation routes on string matching: `startsWith("speedy")` → Speedy API, else → Econt API; `endsWith("-office")` → office delivery, else → address delivery
- Speedy address delivery uses `siteName` + `postCode` (not numeric `siteId`) to identify the delivery site
- `tracking_number` has a unique partial index (excludes null and `__generating__` placeholder)

## Courier API — ППП (Postal Money Transfer) Configuration
- COD shipments must be configured as ППП (пощенски паричен превод), not generic cash-on-delivery
- **Speedy**: `processingType: "POSTAL_MONEY_TRANSFER"` (not `"CASH"`)
- **Econt**: `moneyTransferReqAmount` / `moneyTransferReqCurrency` (not `cdAmount` / `cdType`)
- The касов бон exemption under Наредба Н-18 Чл. 3 depends on the payment being ППП — generic COD values may not qualify
- Contract verification with both couriers is still needed to confirm these API values map to ППП in their systems

## Checkout — City Field
- City field is only shown for address delivery or when office picker fails to load
- Server-side validation: city is only required for address deliveries (`speedy-address`)
- Office pickers expose `onError` callback to parent; checkout tracks `officePickerError` state

## Checkout — Phone Validation
- Phone input has HTML5 `pattern` attribute matching server-side `PHONE_REGEX`
- Server validation errors mapped to Bulgarian user-friendly messages in the catch block
