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
2. Go to SQL Editor → paste the contents of supabase-schema.sql → click Run
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

Admin panel

Set a password in `.env.local`:
```
ADMIN_PASSWORD=your-secret-password
```

Then visit `/admin` to log in. The admin panel lets you:
- View and filter orders by status (pending, confirmed, shipped, delivered, cancelled)
- View full order details (customer info, items, delivery, invoice)
- Mark orders as shipped (with tracking number — sends email notification to customer)
- Mark orders as delivered
- Cancel orders

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