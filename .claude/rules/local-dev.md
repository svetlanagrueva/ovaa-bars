# Local development

## Supabase stack (Docker, via the CLI)

The CLI is installed as a `devDependency`, but its postinstall script extracts the binary using a chmod that **fails on Node 12**. Always `nvm use 22` before `npm install`. The same Node version is required for `tsc`, vitest, and `npx supabase ...` itself.

Local services after `npx supabase start`:

| Service | URL / port |
|---|---|
| API (PostgREST + Auth + Storage gateway) | http://127.0.0.1:54321 |
| Postgres direct | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| Studio (admin UI for the local DB) | http://127.0.0.1:54323 |
| Mailpit web UI (captures outgoing email) | http://127.0.0.1:54324 |
| Mailpit SMTP | `127.0.0.1:54325` |

`smtp_port = 54325` is **uncommented** in `supabase/config.toml` — required for the Mailpit fallback below. The container is named `supabase_inbucket_pbars` even though the actual server is Mailpit (Supabase migrated, kept the legacy name).

`npx supabase db reset` drops + re-applies all migrations from `supabase/migrations/`. There's no `supabase/seed.sql` — seed data lives in `scripts/seed-dev-data.sql` and is applied separately. There's also a `scripts/reset-db.sql` (Studio-paste version) that mirrors the squashed initial migration plus a wipe-public-schema preamble.

## Email transport adapter

`lib/email-client.ts` is the single touchpoint for outbound mail. Every server action that used to do `new Resend(...)` now goes through `getEmailClient()`:

- `RESEND_API_KEY` set → wrapped Resend instance (any env)
- `NODE_ENV === "development"` and no Resend key → SMTP-to-Mailpit shim (uses `nodemailer`)
- otherwise → no-op shim that resolves with `{ data: { id: "noop" }, error: null }`

`isEmailEnabled()` is the gate to use in the early-return guards (replaces the old `if (!process.env.RESEND_API_KEY) return`). Existing tests mock the `resend` module's `Resend` class, which still works because `getEmailClient` calls `new Resend(KEY)` and wraps it; the mock is intercepted before the wrapper.

In tests `NODE_ENV === "test"` so the dev fallback isn't taken — early-return behavior is preserved.

## Prod-DB warning banner

`components/dev-prod-db-banner.tsx` mounts in `app/layout.tsx` and renders **only** when both:
- `process.env.NODE_ENV === "development"`
- `process.env.NEXT_PUBLIC_SUPABASE_URL` contains `"supabase.co"`

So production deploys never see it, and local-dev pointed at local Supabase doesn't see it either. The banner is the safety net for the case where someone toggles `.env.local` back to prod (the file has both LOCAL and PROD Supabase blocks, comment-toggled — see `.env.local`).

## Seed data

`scripts/seed-dev-data.sql` populates a fresh DB. Apply via:
```bash
docker cp scripts/seed-dev-data.sql supabase_db_pbars:/tmp/seed.sql
docker exec supabase_db_pbars psql -U postgres -d postgres -f /tmp/seed.sql
```
Or paste into Studio's SQL editor.

Contents:
- 7 orders across all statuses, all `*@seed.local`. Distinct UUID prefixes (`11111111`, `22222222`, …) so admin-UI short IDs are easy to map. Two orders aligned to the marketing-emails cron windows: order 4 in cross_sell (~10.5d), order 6 in review_request (~3.5d), order 7 outside both windows.
- Per SKU: 2 batches × 5 units (`SEED-A-*` close expiry, `SEED-B-*` far expiry). EGO-DC-12 also gets `SEED-NEAR-*` (3 units, +5 days) and `SEED-EXPIRED-*` (2 units, -30 days, created -90 days for a realistic 60-day-shelf history) to exercise the FEFO and expired-override paths.
- `SEED10` promo code (10% off, 90-day expiry, 100 max uses).
- All inventory movements use direct `INSERT INTO inventory_log` rather than `reserve_inventory` / `restore_inventory` so `created_at` matches the order's `confirmed_at` / `cancelled_at`. The trigger chain still enforces sufficient-stock invariants. The default `reserve_inventory` would have stamped them with `now()` and made the audit log read as if orders consumed stock that hadn't arrived yet.
- `marketing_consent = true` on every delivered order — the cron's WHERE clause filters them out otherwise, and the seed exists to exercise the cron. Flip to false to test the consent gate.

## Cron testing

The crons are regular HTTP routes; trigger them with:
```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/marketing-emails
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/delivery-checks
```
`CRON_SECRET` is whatever you set in `.env.local` — there's no external authority. The match is a `timingSafeEqual` on the full `Bearer <value>` header; any value works as long as both sides agree.

Against a freshly-seeded DB, the marketing cron returns `{"sent":2,"failed":0,"skipped":0}` (one review_request + one cross_sell) and both emails land in Mailpit.

## Pre-launch migration squash convention

While the site is pre-launch, intermediate migrations get folded into `20260420120000_initial_schema.sql` rather than accumulating. The pattern:
1. Edit the relevant sections of the initial schema (table defs, function bodies, trigger definitions)
2. Delete the now-redundant migration files
3. Regenerate `scripts/reset-db.sql` from the merged initial schema (the file is `head -18 scripts/reset-db.sql; cat supabase/migrations/20260420120000_initial_schema.sql` — the first 18 lines are the wipe-schema preamble + filename banner)
4. `supabase db reset` to verify the merged schema applies cleanly + tests pass

Commit message convention seen on prior squashes: `Squash N migrations into the initial schema`.
