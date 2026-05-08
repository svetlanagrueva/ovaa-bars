# Egg Origin — Bulgarian e-commerce site

Online store for **Egg Origin**, a Bulgarian protein-bar brand. Bulgarian-language UI,
EUR pricing, two delivery providers (Speedy, Econt), card + cash-on-delivery via ППП.

**Stack.** Next.js 16 (App Router) · Supabase (Postgres) · Stripe · Resend · Vercel.

**Status.** Pre-launch, single-admin auth, no real customer data yet — the DB can still
be wiped and re-applied. After first real order, migrations are forward-only.

## Compliance posture

The system is built around Bulgarian / EU regulation. Notable:

- **ЗДДС** Чл. 113-116 — invoice + credit-note issuance (Microinvest produces the documents; this app captures inputs and tracks deadlines).
- **Наредба Н-18** — card sales and ППП (postal money transfer) are exempt from касов бон. COD shipments are configured as ППП on both couriers.
- **ЗЗП** Чл. 50 (right of withdrawal) + Чл. 122-127 (complaints) — formal registers + admin state machines.
- **EU 178/2002 + EU 931/2011** — Tier 1 batch traceability with recall workflow.
- **GDPR** — three-category cookie consent, signed unsubscribe tokens, no EGN collection.

Detailed rules in [`.claude/rules/`](./.claude/rules/) — column-level schema docs, security fixes, return-policy interpretation.

## Local setup

### 1. Node + repo

```bash
git clone <this-repo>
cd pbars
nvm use 22       # required — default nvm is Node 12, project needs 22
npm install
```

### 2. Supabase

Local Supabase CLI is the recommended dev path — Postgres + Studio + Storage + Auth in Docker, all migrations auto-applied on first start. Cloud is for staging / prod.

**Local (dev).** Requires Docker Desktop running. The `supabase` CLI is in `devDependencies`, but its postinstall script fails on Node 12, so confirm `nvm use 22` is active before `npm install`.

```bash
npx supabase start         # first run pulls Docker images (~3-5 min)
```

The output prints local URLs + keys. Paste into `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=<Secret value from `supabase start`>
```

Run `npx supabase status` any time to reprint URLs and keys.

Local services:

| Service | URL |
|---|---|
| API | http://127.0.0.1:54321 |
| Studio (DB UI) | http://127.0.0.1:54323 |
| Mailpit (outgoing email) | http://127.0.0.1:54324 |
| Postgres direct | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |

Useful commands:

```bash
npx supabase status        # show URLs + keys
npx supabase stop          # shut down (Docker volumes persist data)
npx supabase db reset      # drop + re-apply all migrations from supabase/migrations/
```

**Cloud (staging / prod).**

1. Create a project at [supabase.com](https://supabase.com).
2. Apply migrations from `supabase/migrations/` in filename order (timestamp prefix defines order). Open Supabase Studio → SQL Editor → paste each file → run. Workflow detail in [`supabase/migrations/README.md`](./supabase/migrations/README.md).
3. Settings → API:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **service_role secret** → `SUPABASE_SERVICE_ROLE_KEY`

**Switching local ↔ prod.** Keep both blocks in `.env.local`, comment-toggle to switch:

```
# LOCAL — from `npx supabase start`
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=sb_secret_local_value

# PROD — uncomment to debug against prod data
# NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
# SUPABASE_SERVICE_ROLE_KEY=sb_secret_prod_value
```

A red banner mounts at the top of every page when `NODE_ENV === "development"` and the URL points at `*.supabase.co` — visible reminder that writes hit prod data. Source: [`components/dev-prod-db-banner.tsx`](./components/dev-prod-db-banner.tsx).

### 3. Stripe

1. [Stripe Dashboard → API keys](https://dashboard.stripe.com/apikeys) → copy the test secret key (`sk_test_...`) → `STRIPE_SECRET_KEY`.
2. Local webhook forwarding (in a separate terminal):

   ```bash
   stripe listen --forward-to localhost:3000/api/webhooks/stripe
   ```

   Copy the `whsec_...` from the CLI output → `STRIPE_WEBHOOK_SECRET` in `.env.local`.

3. Test cards:

   | Card | Number | CVC | Expiry |
   |---|---|---|---|
   | Visa (success) | `4242 4242 4242 4242` | Any 3 digits | Any future date |
   | 3D Secure | `4000 0027 6000 3184` | Any 3 digits | Any future date |
   | Declined | `4000 0000 0000 0002` | Any 3 digits | Any future date |

   Full list: [stripe.com/docs/testing](https://docs.stripe.com/testing).

### 4. Resend (email)

Required for customer order/shipping/delivery emails, marketing cron, and admin alerts.
In **development** without `RESEND_API_KEY`, all email paths fall back to the local Mailpit captured by `npx supabase start` (browse at http://127.0.0.1:54324). 
In **production** without a key, emails silently no-op.

The transport selection lives in [`lib/email-client.ts`](./lib/email-client.ts) — every call site goes through `getEmailClient()` rather than `new Resend(...)` directly.

1. [resend.com](https://resend.com) → API Keys → create → `RESEND_API_KEY`.
2. Verify your sender domain (DKIM/SPF) before launch — without it, Gmail/Outlook will SPF-fail and silently drop.
3. Set the From header used by every send:

   ```
   EMAIL_FROM=Egg Origin <noreply@eggorigin.com>
   ```

### 5. Couriers

**Speedy.** No public sandbox — needs real credentials.

```
SPEEDY_API_URL=https://api.speedy.bg/v1
SPEEDY_USERNAME=...
SPEEDY_PASSWORD=...
```

Optional drop-off office config:

```
SELLER_SPEEDY_OFFICE_ID=12345
SELLER_SPEEDY_OFFICE_NAME=София-Лозенец
```

**Econt.** Has public demo credentials.

```
ECONT_API_URL=https://demo.econt.com/ee/services/
ECONT_USERNAME=iasp-dev
ECONT_PASSWORD=1Asp-dev

# Production:
# ECONT_API_URL=https://ee.econt.com/services/
# ECONT_USERNAME=...
# ECONT_PASSWORD=...
```

Optional drop-off office config:

```
SELLER_ECONT_OFFICE_CODE=...
SELLER_ECONT_OFFICE_NAME=...
```

Toggle providers via `NEXT_PUBLIC_SPEEDY_ENABLED` / `NEXT_PUBLIC_ECONT_ENABLED`. Both are on by default.

### 6. Seller info (used on invoices, emails, official pages)

```
SELLER_COMPANY_NAME=Вашата Фирма ЕООД
SELLER_EIK=123456789
SELLER_VAT_NUMBER=BG123456789
SELLER_MOL=Име Фамилия
SELLER_ADDRESS=гр. София, ул. Примерна 1
SELLER_CITY=София
SELLER_POSTAL_CODE=1000
SELLER_PHONE=+359 88 123 4567
SELLER_EMAIL=info@eggorigin.com
SELLER_IBAN=BG12AAAA12341234123412
SELLER_BANK=Банка АД
```

### 7. Admin auth + secrets

```
ADMIN_PASSWORD=<strong-shared-password>
ADMIN_EMAIL=alerts@example.com   # admin notification destination

UNSUBSCRIBE_SECRET=<random-base64>   # HMAC for marketing unsubscribe tokens
CRON_SECRET=<random>                 # auth header for Vercel Cron
```

### 8. Optional analytics

```
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_GA_MEASUREMENT_ID=G-...
NEXT_PUBLIC_META_PIXEL_ID=123456789012345
```

Both gated on cookie consent. See [`.claude/rules/analytics-tracking.md`](./.claude/rules/analytics-tracking.md).

> **Canonical env-var list** with hard-required vs soft-required and per-call usage:
> [`.claude/rules/env-vars.md`](./.claude/rules/env-vars.md). `instrumentation.ts` runs `checkEnvAtBoot()`
> at server start and aborts boot on missing hard-required vars.

## Run + verify

```bash
nvm use 22
npm run dev               # http://localhost:3000
npx tsc --noEmit          # type-check
npm run lint              # ESLint
npm run format            # Prettier
npm run test              # 570 tests across 21 files
npm run build             # production build
```

## Admin panel

Visit `/admin` and log in with `ADMIN_PASSWORD`. Session: HMAC-SHA256, 8h absolute / 30min idle.

Pages (Bulgarian UI throughout):

- **`/admin/dashboard`** — revenue stats, action items (invoices awaiting issuance, credit notes awaiting, COD orders awaiting courier settlement, withdrawals pending, inventory debt SKUs).
- **`/admin/orders`** — filterable list (status / search / date / invoice doc-state / payment status). Columns surface order lifecycle, courier lifecycle (Чака етикет / Изпратена / Закъсняла / Доставена), payment status with COD aging (gray <14d → amber → red ≥30d), and a refund-total signal when refunds exist.
- **`/admin/orders/[id]`** — order detail with timeline (column-derived + audit events), Документи card (initial invoice + credit notes), Свързани заявки (withdrawals + complaints), refund flow, COD settlement form, batch picker for shipments, post-shipment outcome flow (delivery refused / package lost / returned / recalled), email resend.
- **`/admin/invoices`** — paginated invoice list with CSV export.
- **`/admin/inventory`** — stock cards per SKU, add-batch dialog, manual movement log (B2B, samples, damage, returns, adjustments). Movement log filterable by SKU.
- **`/admin/batches`** — Tier 1 batch list (active / recalled). Each batch detail page shows affected orders + recall workflow + post-recall write-off helper.
- **`/admin/returns`** — unified inbox of withdrawals (Чл. 50 ЗЗП — отказ) + complaints (Чл. 122-127 ЗЗП — рекламация). State machines for each.
- **`/admin/sales`** — product sales (EU Omnibus-compliant via static base prices in `lib/products.ts`).
- **`/admin/promo-codes`** — promo codes.

## Stripe webhooks

Endpoint: `POST /api/webhooks/stripe`. Subscribe these **10 events** in the dashboard (Developers → Webhooks → Add endpoint):

| Event | Handles |
|---|---|
| `checkout.session.completed` | Happy path — `pending → confirmed`, sets `seller_settled_at`, captures PaymentIntent + receipt URL, sends customer confirmation + admin alert. |
| `checkout.session.expired` | Customer abandoned (default 24h TTL). `pending → expired`, restores reserved inventory atomically. |
| `payment_intent.payment_failed` | 3DS challenge failed / card declined post-authorization. Same effect as expired but fires within seconds. |
| `refund.created` / `refund.updated` | Upserts `refunds` keyed on `stripe_refund_id` (idempotent partial unique index). Alerts admin. |
| `refund.failed` | Admin alert only — no DB write (phase 1 doesn't track money-didn't-move rows). |
| `charge.refunded` | Legacy fan-in. Handler explicitly calls `stripe.refunds.list` and upserts each — redundant with `refund.created` but idempotent. Belt-and-braces. |
| `charge.dispute.created` | Chargeback. Writes `dispute_opened` audit event + admin alert with evidence-due-by date. |
| `charge.dispute.closed` | Resolution. Writes `dispute_closed` event with `won` / `lost` / `warning_closed` status. |
| `charge.dispute.funds_reinstated` | We won and Stripe restored funds. Distinct from `closed.won` because money movement trails resolution. |

In production: copy the endpoint signing secret (`whsec_...`) → Vercel project env → `STRIPE_WEBHOOK_SECRET`. `instrumentation.ts` fails boot if missing.

**Admin-issued refunds** are manual: admin issues the Stripe refund from the dashboard, then pastes the `re_...` ID into the admin panel. The server action verifies via `stripe.refunds.retrieve(id)` (4-way check: exists, succeeded, payment_intent matches, amount matches) before inserting the `refunds` row. See [`.claude/rules/admin-panel.md`](./.claude/rules/admin-panel.md) § Refund flow.

Trigger events locally:

```bash
stripe trigger checkout.session.completed
stripe trigger refund.created
stripe trigger charge.dispute.created
```

## Cron (Vercel)

Defined in [`vercel.json`](./vercel.json):

| Path | Schedule | Purpose |
|---|---|---|
| `/api/cron/delivery-checks` | `0 18 * * *` (18:00 UTC ≈ 21:00 EET) | Polls Speedy + Econt tracking APIs, marks shipped → delivered, retries failed delivery emails. |
| `/api/cron/marketing-emails` | `0 7 * * *` (07:00 UTC ≈ 10:00 EET) | Sends review-request (3d after delivery) + cross-sell (10d after delivery). Single Postgres RPC `claim_marketing_emails` does find + claim + reclaim-stale + insert in one call. |

Both authenticate via `Authorization: Bearer $CRON_SECRET` (verified with `timingSafeEqual`). Vercel injects this header automatically when invoking scheduled crons.

## Migrations

```
supabase/migrations/
  20260420120000_initial_schema.sql        # consolidated initial schema (squashed pre-launch)
  20260427140328_drop_product_price_history.sql
  20260428072545_invoices_table.sql
  20260429071812_withdrawals_table.sql
  ... etc.
```

Workflow + naming convention in [`supabase/migrations/README.md`](./supabase/migrations/README.md). Apply via Supabase Studio SQL Editor in filename order. Pre-launch: DB can be dropped + re-applied. Post-launch: forward-only, never edit applied migrations.

## Repo conventions

- **Source of truth for project state**: [`CLAUDE.md`](./CLAUDE.md) + [`.claude/rules/`](./.claude/rules/).
- **Commits + PRs**: small, focused, one logical change per commit. Append `Co-Authored-By` for AI-pair commits.
- **Migrations**: never edit an applied file; write a new one with a fresh UTC timestamp.
- **Feature flags**: `NEXT_PUBLIC_SPEEDY_ENABLED`, `NEXT_PUBLIC_ECONT_ENABLED` for delivery providers.

## Architecture highlights

- **Server actions** in `app/actions/` — `stripe.ts` (checkout + COD creation + confirmation), `admin.ts` (everything admin-only, gated by `requireAdmin()`), `contact.ts` (contact form).
- **Single Supabase client** in `lib/supabase/server.ts` — uses service-role key, bypasses RLS, server-side only.
- **Inventory** = two tables: append-only `inventory_log` + trigger-maintained `inventory_current`.
- **Payment lifecycle** distinguishes `delivered_at` (customer-paid moment for COD; cash hands over to courier) from `seller_settled_at` (we have the money — Stripe capture for card, courier remittance for COD). See [`lib/orders.ts:hasCustomerPaid`](./lib/orders.ts).
- **Audit trail** on `order_audit_events` is immutable (BEFORE UPDATE/DELETE triggers raise). Same pattern on `refunds`, `refund_items`, `inventory_log`, `invoices` (the last one as of migration `20260502124726`).
- **Tier 1 batch traceability**: `product_batches` (append-mostly) + `order_item_batches` (fully immutable post-insert) + `affected_orders_for_batch` RPC for recalls.
