# Environment Variables

## Required
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role key (bypasses RLS)
- `STRIPE_SECRET_KEY` — Stripe secret key (sk_test_ for dev)
- `STRIPE_WEBHOOK_SECRET` — Stripe webhook signing secret (used by `app/api/webhooks/stripe`; set from `stripe listen` in dev, from the Stripe dashboard in prod)
- `ADMIN_PASSWORD` — Admin panel login password
- `EMAIL_FROM` — sender address, e.g. `"Egg Origin <noreply@eggorigin.com>"`. **Hard-required** at boot because every `Resend.emails.send()` call references it — unset means no customer emails reach inboxes (the prior `onboarding@resend.dev` fallback DKIM/SPF-fails at Gmail/Outlook).

## Required for Shipping (Speedy/Econt)
- `SELLER_COMPANY_NAME`, `SELLER_MOL`, `SELLER_ADDRESS`, `SELLER_CITY`, `SELLER_POSTAL_CODE`, `SELLER_PHONE`, `SELLER_EMAIL`

## Required for Marketing Email Cron
- `UNSUBSCRIBE_SECRET` — HMAC key for signed unsubscribe tokens. **Required**, fails fast on first use if missing
- `CRON_SECRET` — Vercel Cron auth. Set in Vercel dashboard, auto-sent as `Authorization: Bearer` header

## Optional
- `RESEND_API_KEY` — for sending emails (confirmation, shipping, marketing cron). If unset, all email paths early-return silently; `EMAIL_FROM` is never read.
- `ADMIN_EMAIL` — admin notification email for new orders
- `NEXT_PUBLIC_APP_URL` — defaults to http://localhost:3000
- `NEXT_PUBLIC_GA_MEASUREMENT_ID` — Google Analytics measurement ID
- `NEXT_PUBLIC_META_PIXEL_ID` — Meta (Facebook) Pixel ID, numeric string. Gated on marketing cookie consent; component validates format and renders nothing on mismatch
- `SPEEDY_USERNAME`, `SPEEDY_PASSWORD`, `SPEEDY_API_URL` — Speedy courier API
- `ECONT_USERNAME`, `ECONT_PASSWORD`, `ECONT_API_URL` — Econt courier API
- `SELLER_ECONT_OFFICE_CODE` — default Econt drop-off office code; pre-fills the sender field in the admin shipment form (per-shipment override available). When set, Econt routes the shipment through that office instead of dispatching a courier to the sender address.
- `SELLER_ECONT_OFFICE_NAME` — display-only label for the same office; shown alongside the code in the shipment form so admin can verify the right office at a glance. Not sent to the courier API.
- `SELLER_SPEEDY_OFFICE_ID` — default Speedy drop-off office ID (numeric, as a string). When set, the shipment form pre-fills the sender as drop-off-at-office; sent to Speedy as `sender.dropoffOfficeId`. Mutually exclusive with the default address-pickup behavior — the Speedy account must be configured for drop-off mode for this to be accepted.
- `SELLER_SPEEDY_OFFICE_NAME` — display-only label for the same office. Not sent to Speedy.

