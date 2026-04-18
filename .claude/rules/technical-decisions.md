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
- Handled webhook events: `checkout.session.completed` (confirm order, fetch receipt URL, send emails via unified sender) and `checkout.session.expired` (restore inventory atomically)
- Webhook fetches receipt URL via `stripe.paymentIntents.retrieve` with `expand: ['latest_charge']` — graceful degradation if fetch fails
- Webhook validates `amount_received` against `total_amount` and logs mismatch (no-throw guard)
- `stripe_receipt_url` is a Stripe payment receipt, NOT a Bulgarian legal document — label as "Разписка за картово плащане (Stripe)", never as фактура/касов бон

## Courier Tracking APIs
- Speedy: `POST /shipment/track` — accepts `parcels: [{ id: trackingNumber }]`, returns `operations` array with `operationCode` and `dateTime`. Code `-14` = Delivered.
- Econt: `POST /ShipmentStatusService.getShipmentStatuses.json` — accepts `shipmentNumbers: [trackingNumber]`, returns `shipmentStatuses` with `deliveryTime`, `shortDeliveryStatusEn`. Non-null `deliveryTime` or `shortDeliveryStatusEn === "Delivered"` means delivered.
- Both return `CourierShipmentStatus { delivered, deliveredAt?, rawStatus?, rawEventCode?, source }` for uniform consumption
- Courier webhooks for delivery notification are **not yet implemented** (Phase 2) — pending confirmation of event format, auth model, and retry semantics from both couriers

## Testing
- 362 tests, 16 test files
- Mock setup: `vi.clearAllMocks()` clears history but not implementations — must manually reset mocks like `update`, `rpc`, `single`, `range`, `order`, `limit` in `beforeEach`
- `revalidateTag` must be mocked via `vi.mock("next/cache", ...)`

## Security Fixes Applied
- `setInvoiceNumber` overwrite protection: `.is("invoice_number", null)` guard prevents replacing existing numbers
- Search SQL wildcard injection: `escapeIlike()` escapes `%` and `_`
- Invoice billing data validated server-side (EIK format, required fields, lengths)
- `trackingNumber` max 200 chars, `cancellationReason` max 1000 chars
- CSV export batches through all results (prevents Supabase row limit truncation)
- Email templates: all user data HTML-escaped via `escapeHtml()` in `lib/email-template.ts`
- Unsubscribe tokens: HMAC-SHA256 signed payloads (`email|timestamp`), verified with `timingSafeEqual`, 90-day expiry
- Cron auth: `CRON_SECRET` verified with `timingSafeEqual` (constant-time), not string `===`
- Unsubscribe API: rate-limited (10 req/15min per IP), token length capped at 500
- Email case sensitivity: all unsubscribe checks use `lower()` in SQL, API stores lowercase
- Marketing email concurrency: `FOR UPDATE SKIP LOCKED` in Postgres, `claimed_at` for stale detection (not `created_at`)
- `getBaseUrl()` shared via `lib/constants.ts` — single source of truth for absolute URLs
- `recordCodSettlement` idempotency: `.is("paid_at", null)` prevents double-recording; validates order is COD + delivered/shipped; `paidAt` date cannot be before delivery or in future
- `markInvoiceSent` idempotency: `.is("invoice_sent_at", null)` + `.not("invoice_number", "is", null)` guards
- `addAdminNote` append-only: fetches existing JSONB array, appends new `{text, created_at}` entry; max 2000 chars per note

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
