# Environment Variables

## Required
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role key (bypasses RLS)
- `STRIPE_SECRET_KEY` — Stripe secret key (sk_test_ for dev)
- `ADMIN_PASSWORD` — Admin panel login password

## Required for Shipping (Speedy/Econt)
- `SELLER_COMPANY_NAME`, `SELLER_MOL`, `SELLER_ADDRESS`, `SELLER_CITY`, `SELLER_POSTAL_CODE`, `SELLER_PHONE`, `SELLER_EMAIL`

## Required for Marketing Email Cron
- `UNSUBSCRIBE_SECRET` — HMAC key for signed unsubscribe tokens. **Required**, fails fast on first use if missing
- `CRON_SECRET` — Vercel Cron auth. Set in Vercel dashboard, auto-sent as `Authorization: Bearer` header

## Optional
- `STRIPE_WEBHOOK_SECRET` — for local dev: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`
- `RESEND_API_KEY` — for sending emails (confirmation, shipping, marketing cron)
- `EMAIL_FROM` — sender address, e.g. "Egg Origin <noreply@eggorigin.com>"
- `ADMIN_EMAIL` — admin notification email for new orders
- `NEXT_PUBLIC_APP_URL` — defaults to http://localhost:3000
- `NEXT_PUBLIC_GA_MEASUREMENT_ID` — Google Analytics measurement ID
- `NEXT_PUBLIC_META_PIXEL_ID` — Meta (Facebook) Pixel ID, numeric string. Gated on marketing cookie consent; component validates format and renders nothing on mismatch
- `SPEEDY_USERNAME`, `SPEEDY_PASSWORD`, `SPEEDY_API_URL` — Speedy courier API
- `ECONT_USERNAME`, `ECONT_PASSWORD`, `ECONT_API_URL` — Econt courier API

