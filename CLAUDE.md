# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
nvm use 22                      # Required — default nvm is Node 12, project needs 22
npm run dev                     # Dev server (http://localhost:3000)
npm run build                   # Production build
npm run test                    # Run all tests (vitest)
npx vitest run tests/admin-actions.test.ts  # Single test file
npx vitest run -t "rejects invalid UUID"    # Single test by name
npx tsc --noEmit                # Type-check without emitting
npm run lint                    # ESLint
npm run format                  # Prettier
```

Local Stripe testing requires `stripe listen --forward-to localhost:3000/api/webhooks/stripe`.

Database schema is managed via migrations in `supabase/migrations/` — see that directory's `README.md` for the workflow. Never edit an applied migration; write a new one.

## Architecture

**Next.js 16 + Supabase + Stripe** e-commerce app for a Bulgarian protein bar brand (Egg Origin). Bulgarian-language UI, EUR pricing.

### Data flow

Products are defined as a **static TypeScript array** in `lib/products.ts` (3 SKUs). Active sales from `product_sales` DB table override prices at runtime via `lib/sales.ts`. Inventory is tracked in Postgres (`inventory_current` table, trigger-maintained from `inventory_log`). The Supabase client in `lib/supabase/server.ts` uses the **service role key** (bypasses RLS) — all DB access is server-side only.

### Server actions (`app/actions/`)

All mutation logic lives in three server action files:
- **`stripe.ts`** — checkout session creation, COD order creation, order confirmation, cart inventory checks, promo code validation. Both card and COD flows create orders here.
- **`admin.ts`** — order management, status transitions, shipment generation, invoice tracking, COD settlement recording, inventory batches, sales/promo CRUD. Every function calls `requireAdmin()` first.
- **`contact.ts`** — contact form submission.

### Payment flows

**Card:** `createCheckoutSession` → Stripe redirect → `checkout.session.completed` webhook confirms order + sets `seller_settled_at` → `confirmOrder` on success page is a fallback (both use `.eq("status", "pending")` for idempotency).

**COD:** `createCODOrder` → order created as `confirmed` immediately (no pending step) → admin ships → admin marks delivered → admin records courier settlement via `recordCodSettlement` (sets `seller_settled_at`). COD orders have a `cod_fee` and the courier collects via ППП (postal money transfer).

### Admin panel (`/admin/*`)

Protected by custom HMAC-SHA256 session auth in `middleware.ts` (not Supabase auth). Single shared password via `ADMIN_PASSWORD` env var. Session tokens have 8h absolute + 30min idle timeout.

Key admin pages: dashboard (stats + action items), orders (filters: status/search/date/invoice/payment), order detail (timeline, status transitions, shipment generation, settlement, notes), inventory, sales, promo codes.

### Courier integration

Speedy (`lib/speedy.ts`) and Econt (`lib/econt.ts`) — Bulgarian delivery carriers. Office picker components fetch office lists from `/api/speedy/offices` and `/api/econt/offices`. Shipment generation in `generateShipment` calls the carrier API and stores the tracking number.

### Client-side state

Zustand cart store (`lib/store/cart.ts`) with localStorage persistence. Syncs prices from `/api/prices` endpoint. Max 10 items per product.

## Key patterns

- **Idempotent writes**: Status transitions use `.eq("status", currentStatus)` to prevent races. Settlement uses `.is("seller_settled_at", null)`. Invoice number uses `.is("invoice_number", null)`.
- **Fail-open inventory**: `getInventoryMap()` returns empty Map on DB error — products show as available, not sold out.
- **Supabase query builder is thenable, not a Promise**: Never chain `.catch()` on it. Always use `const { error } = await supabase.rpc(...)`.
- **Admin notes are append-only JSONB**: `admin_notes` is `jsonb default '[]'`, each entry is `{text, created_at, author}`. `addAdminNote` calls the `add_admin_note` RPC which does atomic `jsonb ||` append — never fetch-modify-update the array from app code.
- **PII-safe error logging**: when logging a Supabase error or any object that may contain user data, wrap it with `sanitizeError` from `@/lib/logger`. `console.error("Failed to X:", sanitizeError(err))` extracts only code/hint/name and redacts email + Bulgarian phone patterns from the message. Static-message + ID-only logs don't need it.
- **Env var validation**: `instrumentation.ts` runs `checkEnvAtBoot()` from `lib/env.ts` at server startup. Hard-required vars (Supabase, Stripe secret + webhook secret, admin password, UNSUBSCRIBE_SECRET, CRON_SECRET) throw and abort boot. Soft-expected vars (Resend, seller info, courier creds) log at error level in prod / warn level in dev so Vercel logs surface setup gaps on first deploy. For per-call runtime use, `requireEnv(name)` throws a typed `MissingEnvError`.

## Testing

330 tests across 15 files. Tests use a chainable Supabase mock (`tests/helpers/supabase-mock.ts`) with `createSupabaseMock()`, `resetSupabaseMock()`, `mockThenableResult()`, and `createUpdateChain()`. Call `resetSupabaseMock` in `beforeEach` — `vi.clearAllMocks()` alone doesn't reset the chain returns.

## Detailed rules

The `.claude/rules/` directory has 9 topic-specific rule files covering: database schema, admin panel, checkout/invoices, inventory, branding, design system, environment variables, technical decisions, and analytics/tracking. These are auto-loaded and contain column-level DB documentation, UI patterns, security fixes, and compliance notes.
