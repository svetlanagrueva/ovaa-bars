# Admin Panel

## Structure
- `/admin/dashboard` — revenue stats, action items, recent orders
- `/admin/orders` — paginated order list with filters (status, search, date, invoice)
- `/admin/orders/[id]` — order detail with history timeline, invoice management, admin notes, actions
- `/admin/invoices` — paginated invoice list with search, date filter, PDF download
- `/admin/inventory` — stock level cards per SKU, add-batch dialog, movement log
- `/admin/sales` — product promotions management (EU Omnibus compliant)
- `/admin/promo-codes` — promo code management
- `/admin/login` — single password auth

## Auth
- Single password stored in `ADMIN_PASSWORD` env var
- HMAC-SHA256 session tokens with dual timeout (8h absolute, 30min idle)
- IP-based rate limiting (5 attempts/15min, in-memory)
- Middleware protects all `/admin/*` routes except `/admin/login`

## Dashboard
- Revenue stats via Postgres RPC function `dashboard_stats` (SQL aggregation, not in-memory)
- Shows product revenue only (excludes shipping_fee and cod_fee)
- Action items: pending orders, invoices awaiting issuance, COD orders awaiting courier settlement
- Awaiting settlement links to `/admin/orders?status=delivered&paymentFilter=awaiting-settlement`
- Last 10 orders with links

## Orders
- Pagination: 100 per page, with total count
- Filters: status tabs, text search (ID/name/email), date range, invoice filter (all/requested/issued/pending), payment filter (all/awaiting-settlement/settled)
- URL params supported: `?status=pending`, `?invoiceFilter=pending`, `?paymentFilter=awaiting-settlement` (for dashboard links)
- CSV export fetches ALL matching results via `getAllOrders` (batches of 1000)
- CSV columns: ID, date, name, email, phone, city, products revenue, promo discount, shipping fee, COD fee, total, payment, delivery, status, invoice #, invoice date

## Order Detail
- Customer info, order details, product breakdown with stored fees
- Price breakdown uses stored `shipping_fee` and `cod_fee` (not recalculated from constants)
- Invoice section: issue invoice (with confirmation dialog), download PDF (invoice or proforma)
- Invoice deadline: 5 days from payment (card: created_at, COD: delivered_at)
- History timeline: chronological events sorted by date, includes "Плащане получено", "Фактура изпратена", and "Бележка" events, with fallback for pre-timestamp orders
- COD settlement: form in Действия card for delivered unpaid COD orders (date picker, amount, ППП ref, bank ref); green status card shown after settlement recorded
- COD settlement date picker: `min` set to delivery date, `max` set to today; server validates date is not before delivery or in the future; date stored at 23:59:59 UTC to sort after same-day events
- Card payment section: shows paid_at confirmation date (set automatically by webhook)
- Admin notes: append-only JSONB array of `{text, created_at}` entries; notes shown in reverse-chronological list + appear in timeline; `addAdminNote` server action appends, never overwrites
- Actions: status transitions with validation, cancellation requires reason field
- Invoice sent tracking: "Отбележи като изпратена на клиента" button appears after invoice number is saved; sets `invoice_sent_at`

## Invoice Management
- Invoices are generated externally via Microinvest Invoice Pro
- Admin enters invoice number manually in order detail page (text input + save button)
- Server action `setInvoiceNumber(orderId, invoiceNumber)` saves the number and sets `invoice_date`
- Admin invoices page shows list of orders with invoice numbers (search, filter, CSV export)
- No PDF generation or invoice emailing in the codebase

## Inventory Panel (`/admin/inventory`)
- Stock cards per SKU: red badge = 0, amber ≤ 20, green > 20
- "Добави партида" dialog: product dropdown, quantity, batch ID, expiry date, notes — inserts `batch_in` row into `inventory_log`
- Movement log table: date, SKU, type badge, ±quantity, before/after columns, batch ID or order link, expiry date
- Server actions: `getInventoryStatus()`, `addInventoryBatch()` (validates SKU against PRODUCTS list)
- Cancellation from order detail automatically calls `restore_inventory` RPC — stock updates immediately

## Email Notifications
- Admin gets email on new orders (card and COD) if `ADMIN_EMAIL` env var is set
- All email failures logged with order ID to Vercel function logs

## Customer Email Templates (`lib/email-template.ts`)
All templates share a common HTML shell with EGG ORIGIN header, seller address footer, and plain-text fallback.

| Template | Function | Type | When |
|---|---|---|---|
| Order Confirmation | `buildOrderConfirmationEmail()` | Transactional | On order submit — **wired up** |
| Shipping Notification | `buildShippingEmail()` | Transactional | When admin marks shipped — template ready, not wired |
| Delivery Confirmation | `buildDeliveryEmail()` | Transactional | When admin marks delivered — template ready, not wired |
| Review Request | `buildReviewRequestEmail()` | Marketing | 3 days after delivery — **wired via cron** |
| Cross-sell | `buildCrossSellEmail()` | Marketing | 10 days after delivery — **wired via cron** |
| Abandoned Cart | `buildAbandonedCartEmail()` | Marketing | Template ready, not wired to cron |

### Security & Compliance
- All user data HTML-escaped via `escapeHtml()` before interpolation (prevents XSS/injection)
- Marketing emails include per-recipient HMAC-signed unsubscribe link (footer + plain text)
- Unsubscribe URL is HTML-escaped in `emailShell` href
- Seller physical address in all email footers (CAN-SPAM / GDPR)
- Hidden preheader text for inbox preview on all templates
- UTM parameters on all clickable links (`utm_source=email&utm_campaign=<name>&utm_content=<label>`)
- `sendOrderConfirmationEmail()` in `lib/email-sender.ts` is the single unified sender for both card and COD orders (extracted from stripe.ts, used by both webhook and server actions)
- `notifyAdminNewOrder()` in `lib/email-sender.ts` — admin notification for new orders (both card and COD)
- Transactional emails have NO unsubscribe link — they are mandatory

## Marketing Email Cron (`app/api/cron/marketing-emails/route.ts`)
- Daily cron at 07:00 UTC (~10:00 EET) via `vercel.json`
- Auth: `CRON_SECRET` verified with `timingSafeEqual` (constant-time)
- Single Postgres RPC `claim_marketing_emails(p_now, p_limit)` does everything in one DB call:
  - Finds candidates (1-day date windows on `delivered_at`)
  - Filters unsubscribed via `NOT EXISTS` with `lower()` for case-insensitive match
  - Inserts new log rows as `pending` (`ON CONFLICT DO NOTHING`)
  - Reclaims stale `sending` rows (crashed workers, `claimed_at > 10min`)
  - Atomically claims rows `pending/failed → sending` via `FOR UPDATE SKIP LOCKED`
- App loops over claimed rows, sends via Resend, updates log: `sent`/`failed`/`skipped`
- Clears `claimed_at` on finalization (sent, failed, skipped)
- Max 50 emails per run, sequential sending (respects Resend rate limits)
- `provider_message_id` stored for Resend dashboard cross-reference
- Failed rows retry up to 3 attempts (`attempt_count`)

## Unsubscribe System
- **Token:** Signed payload (`email|timestamp`) with HMAC-SHA256 via `UNSUBSCRIBE_SECRET` (required, no fallback)
- **Token verification:** `timingSafeEqual`, 90-day expiry, email extracted from token (not URL param)
- **Page:** `app/(shop)/unsubscribe/page.tsx` — confirmation page, POSTs only after user clicks "Да, отпиши ме"
- **API:** `POST /api/unsubscribe` — sole mutation point, rate-limited (10 req/15min per IP), token length capped at 500
- **DB:** `email_unsubscribes` table keyed by lowercase email, RLS denies all public access
- **Layout:** `noindex, nofollow` metadata

## Marketing Email Database Tables
- `email_unsubscribes` — `email text PRIMARY KEY`, `unsubscribed_at timestamptz`
- `marketing_email_log` — `(order_id, email_type) UNIQUE`, status lifecycle: `pending → sending → sent/failed/skipped`
  - Columns: `provider_message_id`, `attempt_count`, `claimed_at`, `last_attempt_at`, `sent_at`, `error_message`
  - Partial index on `status IN ('pending', 'failed')` for claim queries
- RPC: `claim_marketing_emails(p_now, p_limit)` — find + insert + reclaim + claim in one call
