# Environment Variables

## Required
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role key (bypasses RLS)
- `STRIPE_SECRET_KEY` — Stripe secret key (sk_test_ for dev)
- `ADMIN_PASSWORD` — Admin panel login password

## Required for Shipping (Speedy/Econt)
- `SELLER_COMPANY_NAME`, `SELLER_MOL`, `SELLER_ADDRESS`, `SELLER_CITY`, `SELLER_POSTAL_CODE`, `SELLER_PHONE`, `SELLER_EMAIL`

## Optional
- `STRIPE_WEBHOOK_SECRET` — for local dev: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`
- `RESEND_API_KEY` — for sending emails (confirmation, shipping)
- `EMAIL_FROM` — sender address, e.g. "Egg Origin <noreply@eggorigin.com>"
- `ADMIN_EMAIL` — admin notification email for new orders
- `NEXT_PUBLIC_APP_URL` — defaults to http://localhost:3000
- `NEXT_PUBLIC_SPEEDY_ENABLED` — "false" to disable Speedy delivery
- `NEXT_PUBLIC_ECONT_ENABLED` — "false" to disable Econt delivery
- `NEXT_PUBLIC_GA_MEASUREMENT_ID` — Google Analytics measurement ID
- `SPEEDY_USERNAME`, `SPEEDY_PASSWORD`, `SPEEDY_API_URL` — Speedy courier API
- `ECONT_USERNAME`, `ECONT_PASSWORD`, `ECONT_API_URL` — Econt courier API

## Note
- `.env.local` still has `EMAIL_FROM` with old brand name "Ovva Sculpt" — should be updated to "Egg Origin"
