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
- Handled webhook events: `checkout.session.completed` (confirm order, send emails) and `checkout.session.expired` (restore inventory atomically)

## Testing
- 330 tests, 14 test files
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

## Checkout — City Field
- City field is only shown for address delivery or when office picker fails to load
- Server-side validation: city is only required for address deliveries (`speedy-address` / `econt-address`)
- Office pickers expose `onError` callback to parent; checkout tracks `officePickerError` state

## Checkout — Phone Validation
- Phone input has HTML5 `pattern` attribute matching server-side `PHONE_REGEX`
- Server validation errors mapped to Bulgarian user-friendly messages in the catch block
