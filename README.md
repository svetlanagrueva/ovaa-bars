# Bulgarian E-commerce Site

*Automatically synced with your [v0.app](https://v0.app) deployments*

[![Deployed on Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-black?style=for-the-badge&logo=vercel)](https://vercel.com/srgrueva-2029s-projects/v0-bulgarian-e-commerce-site)
[![Built with v0](https://img.shields.io/badge/Built%20with-v0.app-black?style=for-the-badge)](https://v0.app/chat/uD34lyOvSvi)

## Overview

This repository will stay in sync with your deployed chats on [v0.app](https://v0.app).
Any changes you make to your deployed app will be automatically pushed to this repository from [v0.app](https://v0.app).

## Deployment

Your project is live at:

**[https://vercel.com/srgrueva-2029s-projects/v0-bulgarian-e-commerce-site](https://vercel.com/srgrueva-2029s-projects/v0-bulgarian-e-commerce-site)**

## Build your app

Continue building your app on:

**[https://v0.app/chat/uD34lyOvSvi](https://v0.app/chat/uD34lyOvSvi)**

## How It Works

1. Create and modify your project using [v0.app](https://v0.app)
2. Deploy your chats from the v0 interface
3. Changes are automatically pushed to this repository
4. Vercel deploys the latest version from this repository

## Setup
Supabase setup
1. Go to https://supabase.com and create a free project                                                                                                                       
2. Go to SQL Editor → apply each file in `supabase/migrations/` in filename order (the prefix is a UTC timestamp that defines the apply order). For a fresh setup there's typically only `20260420120000_initial_schema.sql`. See `supabase/migrations/README.md` for the workflow.
3. Go to Project Settings → API and copy:
  - Project URL → paste into NEXT_PUBLIC_SUPABASE_URL in .env.local
  - service_role secret key → paste into SUPABASE_SERVICE_ROLE_KEY

Stripe setup
1. Go to https://dashboard.stripe.com/apikeys
2. Copy the Secret key (starts with sk_test_) → paste into STRIPE_SECRET_KEY

Test card numbers (use with `sk_test_` key only):

| Card | Number | CVC | Expiry |
|---|---|---|---|
| Visa (success) | `4242 4242 4242 4242` | Any 3 digits | Any future date |
| Visa (debit) | `4000 0566 5566 5556` | Any 3 digits | Any future date |
| Mastercard | `5555 5555 5555 4444` | Any 3 digits | Any future date |
| 3D Secure | `4000 0027 6000 3184` | Any 3 digits | Any future date |
| Declined | `4000 0000 0000 0002` | Any 3 digits | Any future date |

Full list: https://docs.stripe.com/testing

Stripe webhook setup

The webhook endpoint lives at `POST /api/webhooks/stripe` and drives order confirmation, inventory restoration on abandoned/failed checkouts, refund recording, and dispute alerting. **`STRIPE_WEBHOOK_SECRET` is hard-required** (checked at server boot in `lib/env.ts`) — set it before the first deploy.

Subscribe the endpoint to these **8 events** in the Stripe Dashboard (Developers → Webhooks → Add endpoint):

| Event | Handles |
|---|---|
| `checkout.session.completed` | Primary happy path — flips the order `pending → confirmed`, sets `paid_at`, captures PaymentIntent + receipt URL, fires confirmation email to customer and new-order alert to admin. |
| `checkout.session.expired` | Customer abandoned the Stripe checkout (default 24h TTL). Flips `pending → expired` and releases the reserved inventory back to stock. |
| `payment_intent.payment_failed` | 3DS challenge failed / card declined post-authorization. Same effect as `checkout.session.expired` but fires within seconds instead of up to 24h — cuts the stuck-pending window. |
| `refund.created` | Primary refund event. Upserts `order_refunds` keyed on `stripe_refund_id` (partial unique index, idempotent). Alerts admin to annotate reason + credit-note reference. |
| `refund.updated` | Status transitions (pending → succeeded\|failed). Same handler as `refund.created`; idempotent upsert. |
| `refund.failed` | Explicit failure event. No DB write (phase 1 doesn't track money-didn't-move rows), but fires an ⚠-subject admin alert with `failure_reason` so operator can retry or contact customer. |
| `charge.refunded` | Legacy fan-in event. Newer Stripe API versions don't auto-expand `charge.refunds`, so the handler explicitly calls `stripe.refunds.list({ charge: id })` and upserts each — redundant with `refund.created` but idempotent (same `stripe_refund_id` natural key dedupes). Safe to keep subscribed as a belt-and-braces fallback. |
| `charge.dispute.created` | Chargeback filed. Writes a `dispute_opened` outcome event into `order_audit_events` with the dispute details, fires a prominent admin alert including evidence-due-by date and Stripe dispute URL. |

**Local development:**

```
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

Copy the `whsec_...` signing secret from the `stripe listen` output → `STRIPE_WEBHOOK_SECRET` in `.env.local`. The CLI forwards all events by default, no per-event subscription needed locally.

Trigger specific events for testing:

```
stripe trigger checkout.session.completed
stripe trigger refund.created
stripe trigger charge.dispute.created
```

**Production:**

1. In Stripe Dashboard → Developers → Webhooks → Add endpoint. URL: `https://<your-domain>/api/webhooks/stripe`.
2. Select the 8 events listed above.
3. Copy the endpoint signing secret (`whsec_...`) → Vercel project env → `STRIPE_WEBHOOK_SECRET`.
4. Redeploy so the new env value takes effect. `instrumentation.ts` runs `checkEnvAtBoot` and fails loudly in Vercel logs if the secret is missing.

**Admin-issued refunds:** phase 1 workflow is manual — admin issues the Stripe refund in the Stripe Dashboard (Payments → select → Refund), then pastes the `re_...` refund ID into the admin panel. The admin-panel server action calls `stripe.refunds.retrieve(id)` to verify the refund exists, `status='succeeded'`, `payment_intent` matches this order, and `amount` matches before inserting the `order_refunds` row. Phantom IDs / typos / wrong-order pastes are rejected upfront with a Bulgarian error message. See `.claude/rules/admin-panel.md` § Refunds for the two-step flow detail.

Delivery integrations

The app supports two delivery providers — **Speedy** and **Econt**. Both are behind feature flags 
and can be enabled independently.

Speedy delivery (enabled by default)

Speedy is **on by default** — no flag needed. To disable it, set `NEXT_PUBLIC_SPEEDY_ENABLED=false`.

Add your Speedy API credentials to `.env.local`:
```
# Speedy API credentials (required for office picker to work)
SPEEDY_API_URL=https://api.speedy.bg/v1
SPEEDY_USERNAME=your-username
SPEEDY_PASSWORD=your-password
```

> **Note:** Speedy does not provide public demo/sandbox credentials. You need a real Speedy API account. 
> Without valid credentials the office picker will show an error — the "Speedy до адрес" (address delivery) option 
> still works since it doesn't call the API.

Econt delivery (enabled by default)

Econt is **on by default** — no flag needed. To disable it, set `NEXT_PUBLIC_ECONT_ENABLED=false`.

Add the following to your `.env.local`:
```
# Feature flag — set to "false" to hide Econt delivery options in checkout
NEXT_PUBLIC_ECONT_ENABLED=true

# Econt API credentials
# Demo (for local development):
ECONT_API_URL=https://demo.econt.com/ee/services/
ECONT_USERNAME=iasp-dev
ECONT_PASSWORD=1Asp-dev

# Production (replace with your e-Econt credentials):
# ECONT_API_URL=https://ee.econt.com/services/
# ECONT_USERNAME=your-username
# ECONT_PASSWORD=your-password
```

Econt provides demo credentials (`iasp-dev` / `1Asp-dev`) that work out of the box for local development.

Invoice generation (Bulgarian ЗДДС)

Invoices are generated only when a customer provides company data (ЕИК/Булстат) during checkout. Individual consumers receive order confirmations only, per standard Bulgarian e-commerce practice.

Add your seller/company details to `.env.local`:
```
# Seller info (required for invoice generation)
SELLER_COMPANY_NAME=Вашата Фирма ЕООД
SELLER_EIK=123456789
SELLER_VAT_NUMBER=BG123456789
SELLER_MOL=Име Фамилия
SELLER_ADDRESS=гр. София, ул. Примерна 1
SELLER_CITY=София
SELLER_POSTAL_CODE=1000
SELLER_PHONE=+359 88 123 4567
SELLER_EMAIL=info@example.com
SELLER_IBAN=BG12AAAA12341234123412
SELLER_BANK=Банка АД
```

The database schema lives in `supabase/migrations/`. Apply migration files in filename order via Supabase SQL Editor on initial setup. See `supabase/migrations/README.md` for the full workflow and naming convention.

Admin panel

Set a password in `.env.local`:
```
ADMIN_PASSWORD=your-secret-password
```

Then visit `/admin` to log in. The admin panel lets you:
- View and filter orders by status (pending, confirmed, shipped, delivered, cancelled)
- View full order details (customer info, items, delivery, invoice)
- Mark orders as shipped (with tracking number — sends email notification to customer)
- Mark orders as delivered or cancel orders
- Download invoice PDF for orders with company data

Run the app

```
nvm use 22
npm install
npm run dev
```

Tun tests - tests run fine in CI with Node 22
```
  nvm install 22                                            
  nvm use 22
  npx vitest run

```

Then open http://localhost:3000.