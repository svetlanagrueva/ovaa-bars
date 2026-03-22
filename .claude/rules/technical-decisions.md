# Technical Decisions & Gotchas

## Next.js 16
- `revalidateTag` requires 2 arguments: `revalidateTag("tag-name", "max")` — second arg is cache profile
- `useSearchParams()` requires Suspense boundary for static prerendering — wrap page in Suspense
- Middleware file convention deprecated (warning only, still works) — "proxy" is the replacement
- `serverExternalPackages: ["pdfkit"]` required in next.config.mjs for font file resolution

## PDFKit
- Needs static (non-variable) TTF fonts with full glyph sets
- Roboto fonts from `googlefonts/roboto-2` repo (static builds, ~500KB each, full Cyrillic)
- Font files at `public/fonts/Roboto-Regular.ttf` and `public/fonts/Roboto-Bold.ttf`
- Google Fonts CDN serves subset fonts (missing glyphs) — don't use for PDF generation

## Node.js
- Default nvm version is Node 12 — tests and builds require Node 22
- Use `nvm use 22` before running vitest or tsc

## Supabase
- Legacy anon/service_role keys still work — "legacy" just means newer key system exists alongside
- New secret keys work as drop-in replacement for service_role
- Default row limit (~1000) can silently truncate queries — `getAllOrders`/`getAllInvoices` paginate in batches of 1000
- `applyOrderFilters`/`applyInvoiceFilters` use `any` type for query param — Supabase query builder type is too complex for generic typing

## Stripe
- Webhook secret (`STRIPE_WEBHOOK_SECRET`) needed for local testing via `stripe listen`
- Test card: 4242 4242 4242 4242
- Only `checkout.session.completed` event is handled in webhook

## Testing
- 244 tests, 13 test files
- admin.ts coverage: 85% statements, 89% functions
- Overall coverage: 78%
- Remaining gaps: stripe.ts (58%), cart.ts (57%)
- Mock setup: `vi.clearAllMocks()` clears history but not implementations — must manually reset mocks like `update`, `rpc`, `single`, `range`, `order`, `limit` in `beforeEach`
- `revalidateTag` must be mocked via `vi.mock("next/cache", ...)`

## Security Fixes Applied
- `issueInvoice` race condition: atomic via Postgres function + `.is("invoice_number", null)` guard
- Search SQL wildcard injection: `escapeIlike()` escapes `%` and `_`
- Invoice billing data validated server-side (EIK format, required fields, lengths)
- `trackingNumber` max 200 chars, `cancellationReason` max 1000 chars
- Confirmation dialog before issuing invoice (irreversible)
- CSV export batches through all results (prevents Supabase row limit truncation)
