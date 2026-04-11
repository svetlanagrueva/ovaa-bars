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
- 296 tests, 13 test files
- Mock setup: `vi.clearAllMocks()` clears history but not implementations — must manually reset mocks like `update`, `rpc`, `single`, `range`, `order`, `limit` in `beforeEach`
- `revalidateTag` must be mocked via `vi.mock("next/cache", ...)`

## Security Fixes Applied
- `setInvoiceNumber` overwrite protection: `.is("invoice_number", null)` guard prevents replacing existing numbers
- Search SQL wildcard injection: `escapeIlike()` escapes `%` and `_`
- Invoice billing data validated server-side (EIK format, required fields, lengths)
- `trackingNumber` max 200 chars, `cancellationReason` max 1000 chars
- CSV export batches through all results (prevents Supabase row limit truncation)
