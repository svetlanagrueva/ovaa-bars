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
- History timeline: chronological events sorted by date, includes "Плащане получено", "Фактура изпратена", and "Бележка" events, with fallback for pre-timestamp orders. `order_audit_events` is the authoritative source going forward — status changes, invoice number set, payment recorded, etc. are auto-captured by the AFTER UPDATE trigger on orders. Refund events are captured by the AFTER INSERT trigger on `order_refunds` (one audit event per refund row). Domain events (`delivery_refused`, `package_lost`, `returned`, `recalled`, `partial_return`) are explicitly written via the `record_order_outcome` RPC from admin actions. Outcome and refund events are **not cross-referenced at the DB layer** — they're separate rows in the audit log, correlated by temporal proximity in the timeline view. This follows the three-layer separation: outcome = audit, refund = money, inventory = goods.
- Order edit (contact + quantity): admin can correct wrong-address / typo-phone / "add one more box" scenarios on confirmed-but-not-shipped orders without cancel+reorder churn.
  - Contact edit: customer-info card has an inline "Редактирай" button (visible only on `status='confirmed'`). Editable fields: first_name, last_name, phone, address, postal_code, city, notes. Email is deliberately locked (case-sensitivity CHECK + it's the unsubscribe key; edit via direct DB only). `updateOrderContact` validates each provided field, trims, and atomically updates orders with `.eq('status', 'confirmed')` guard. The `emit_order_audit_events` trigger auto-emits a `contact_info_changed` event with per-field `{old, new}` pairs via `jsonb_strip_nulls` (migration `20260424140000`).
  - Quantity edit (COD only): each line in the products card has a "Редактирай" button visible only when `payment_method='cod' AND status='confirmed' AND tracking_number IS NULL`. Delegates to the `edit_order_quantity` RPC which atomically locks `order_items FOR UPDATE`, calls reserve/restore inventory for the delta, updates `order_items.quantity` + `orders.total_amount`. Fee structure (shipping, cod, discount) stays frozen on edit — admin crossing a free-shipping threshold does not get it recomputed. Card orders route through `replaces_order_id` instead (charging the delta requires a new Stripe session). `updateOrderQuantity` emits `order_items_changed` via `record_order_outcome` RPC with `{sku, product_name, old_quantity, new_quantity, delta, new_total_cents}` payload.
- COD phone confirmation: for `payment_method='cod' AND status='confirmed'` orders, a prominent amber banner prompts the admin to call the customer before shipping. A "Маркирай обаждането като потвърдено" button calls `markCodConfirmed` → sets `cod_confirmed_at` (server timestamp) + `cod_confirmed_by='admin'`, emits a `cod_confirmed` audit event via the existing `emit_order_audit_events` trigger. Once confirmed, the banner turns green and shows the timestamp. `markCodConfirmed` validates: COD payment, status=`confirmed`, not-already-confirmed (idempotent guard via `.is('cod_confirmed_at', null)` at UPDATE time for race safety).
- COD shipment soft block: when admin opens "Генерирай товарителница" on a COD order with `cod_confirmed_at IS NULL`, an inline amber warning renders next to the button AND the click triggers `window.confirm` requiring explicit override (not a hard block — emergencies still ship, but the skip is deliberate). Rationale: COD refusal rate in BG is measurably 5-25%; phone confirmation before shipping materially lowers it. Policy becomes a visible gate. Promote to hard block only if ops data shows admin skipping confirmations abusively.
- COD settlement: form in Действия card for delivered unpaid COD orders (date picker, amount, ППП ref, bank ref); green status card shown after settlement recorded
- COD settlement date picker: `min` set to delivery date, `max` set to today; server validates date is not before delivery or in the future; date stored at 23:59:59 UTC to sort after same-day events
- Card payment section: shows paid_at confirmation date (set automatically by webhook)
- Admin notes: append-only JSONB array of `{text, created_at, author}` entries; notes shown in reverse-chronological list + appear in timeline. `addAdminNote` server action calls the `add_admin_note` RPC (atomic `jsonb ||` append), which kills the read-modify-write race of the previous fetch+spread+update pattern. Author defaults to `'admin'` pre-launch.
- Actions: status transitions with validation, cancellation requires reason field
- Invoice sent tracking: "Отбележи като изпратена на клиента" button appears after invoice number is saved; sets `invoice_sent_at`
- Post-shipment outcomes (`delivery_refused`, `package_lost`, `returned`, `recalled`): recorded via `recordOrderOutcome` — a **pure outcome recorder**, single-responsibility. No refund or inventory writes happen inside this action; those are handled separately by `recordRefund` (money) and `recordStockMovement` (goods). The UI coordinates them as a **guided multi-step flow**: after a successful outcome save, a context-specific "Next step" callout appears with buttons for "Open refund form" and "Later" ("Got it" for `delivery_refused`-style deferred cases; all four outcome types can now either refund-now or defer). Each step is its own server action, independently idempotent. This preserves the three-layer separation between audit, money, and goods.
  - **Prefill from outcome context**: when the admin clicks "Отвори формата за възстановяване" in the callout, the refund form is auto-populated from the just-saved outcome — amount = full remaining balance, reason = `[<outcome label>] <outcome note>` (with optional ref), scroll + ring-highlight + focus on the amount input. The outcome note and first available reference (return / recall / courier) are preserved in component state across the outcome form's field reset so the prefill has material to work with.
  - **"Linked to outcome" banner**: when the refund form was opened from an outcome callout, a small amber banner appears at the top of the refund card showing which outcome type + ref the refund is tied to. The banner has an "Изчисти" link that strips the prefill if the admin wants to start fresh. Banner clears on full-flow completion (flow reset).
  - The linkage is **UI-only** — no DB column ties a refund row to an outcome event. Timeline correlation is temporal. The refund's free-text `reason` field carries the outcome label as a prefix for human traceability.
- Refunds: child table `order_refunds` — multiple refunds per order supported. Admin UI shows the refunds list with computed total (fully-refunded vs partially-refunded badge). **Two-step flow** in the refund card — each step is its own server action; UI does the orchestration.
  - **Step 1 — refund** (`recordRefund`): records a single row in `order_refunds`. Pure money concern, no inventory side effects. Phase 1 flow: admin issues Stripe refund in Stripe dashboard (card) or initiates bank transfer (COD), then records here. For card refunds the admin pastes the Stripe `re_...` refund ID; the unique index on `stripe_refund_id` dedupes against webhook arrivals from either direction. Client idempotency key (UUID generated per flow) guards against double-submit.
    - **Stripe verification on paste**: when `method='stripe'` and `stripeRefundId` is supplied, `recordRefund` calls `stripe.refunds.retrieve(id)` and checks four things before inserting the row: (1) the refund exists (Stripe `resource_missing` → friendly "не е намерен в Stripe" error); (2) `status === 'succeeded'` — don't log money-didn't-move events; (3) `payment_intent` matches `order.stripe_payment_intent_id` — catches paste-from-wrong-order; (4) `amount` matches `refundAmount` — catches admin typos in either field. One API call (~200ms) per admin Stripe refund in exchange for rejecting phantom / misattributed rows at source rather than at reconciliation time. Bank-transfer refunds skip the verification entirely (no gateway to check).
  - **Step 2 — stock outcome**: admin picks one of two paths:
    - *Per-SKU physical return*: per-item quantity + disposition inputs (`sellable` → `return_in`, `damaged` → `damaged`). Submit loops `recordStockMovement` calls with `reference_type='return'`, `reference_id=<refund.id>`, `orderId=<order.id>`. Each call gets its own UUID stored in component state, preserved across retries so a mid-loop failure can be retried without duplicate inserts. Progress indicator shows "done / total"; failures list which (sku, disposition) pairs failed and prompts retry.
    - *Skip with reason*: radio list — `no_return` (goodwill), `package_lost`, `customer_keeps`, `other` (+ free-text). Appends an admin_note via `add_admin_note` RPC explaining the skip. Useful audit trail for refund-fraud analysis later.
  - **Return cap**: `recordStockMovement` enforces `sum(prior returns for this order+sku) + this quantity ≤ sum(order_out for this order+sku)` when called with `referenceType='return'`, `type ∈ {return_in, damaged}`, and `orderId` set. DB trigger `trg_enforce_order_return_cap` is the backstop with matching Bulgarian wording. Warehouse-internal damage (reference_type='internal') is uncapped — see `inventory.md` § Return cap.
  - **Full-flow idempotency**: the `client_idempotency_key` UUID is regenerated only when the whole two-step flow completes (or admin clicks "Record new refund"). A retry during Step 2 re-resolves to the same refund row via `recordRefund`'s fast-path check.
  - Annotation edits: `RefundRow` component allows admin to edit `reason` and `credit_note_ref` on any row (including webhook-created rows that arrived before the admin's action). `updateRefundAnnotation` only touches the two annotation columns; financial fields stay immutable per the append-only trigger. Each actual change emits a `refund_annotation_edited` audit event (AFTER UPDATE trigger, migration `20260424120000`) carrying per-field `{old, new}` pairs, so BG tax auditors / fraud investigators can reconstruct the evolution of every credit-note reference and reason. No-op UPDATEs do not emit.
  - **Кредитно известие breakdown**: each `RefundRow` renders a VAT-20%-inclusive per-line breakdown (gross / VAT / net) derived from the linked `inventory_log` return rows (reference_type='return', reference_id=refund.id) × `order_items.unit_price_cents`. A "Копирай" button copies a formatted Bulgarian text block to clipboard — admin pastes it into Microinvest when issuing the кредитно известие. Handles the three shapes: full match (lines = refund amount), mismatch (handling-fee / partial-discount case — surfaced with an amber note), and no-returns (goodwill / shipping-only refund). Math lives in `lib/refund-breakdown.ts`, no DB schema for line allocation — data is reconstructed from existing tables. VAT rate is hardcoded 20%; if the catalog ever adds a reduced-rate product, promote to per-item `vat_rate` column.
  - Webhook path: `refund.created` / `refund.updated` / `refund.failed` / `charge.refunded` all converge on `upsertRefundFromStripe`, which branches by `refund.status`:
    - `succeeded` → insert row (idempotent via `stripe_refund_id` unique partial index); fires `alertAdmin` on new insert only.
    - `failed` → admin alert only (`⚠ Stripe refund FAILED — …` with `failure_reason` + Stripe dashboard link + "ACTION REQUIRED"); no DB write because phase 1 doesn't store rows for money that didn't move.
    - `canceled` → informational alert; no DB write.
    - `pending` / `requires_action` → silent skip; the eventual transition event (`refund.updated` or `refund.failed`) is what we act on.
  - The Stripe webhook configuration must subscribe to all four refund events (`refund.created`, `refund.updated`, `refund.failed`, `charge.refunded`) for full coverage.

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
| Delivery Confirmation | `buildDeliveryEmail()` | Transactional | On delivery — **wired via `confirmDeliveryForOrder()` + cron** |
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
- `sendDeliveryEmail()` in `lib/email-sender.ts` — delivery confirmation, fire-and-forget with retry via `delivery_email_sent_at` marker. Early returns if already sent.
- `notifyAdminNewOrder()` in `lib/email-sender.ts` — admin notification for new orders (both card and COD)
- Transactional emails have NO unsubscribe link — they are mandatory

## Automatic Delivery Confirmation (`lib/delivery-confirmation.ts`)
- All delivery paths (admin manual, cron polling, future webhooks) converge on `confirmDeliveryForOrder(orderId, deliveredAt, source)`
- Uses `confirm_delivery` RPC — atomic update WHERE `status = 'shipped'`, returns updated row. Idempotent.
- `confirmDeliveryByTrackingNumber()` is a **resolver only** — looks up order by tracking number (up to 2 rows for ambiguity detection), delegates to `confirmDeliveryForOrder()`. No state mutation.
- Admin `updateOrderStatus("delivered")` is an early-return branch that calls `confirmDeliveryForOrder(orderId, now, "admin")`

## Delivery Check Cron (`app/api/cron/delivery-checks/route.ts`)
- Daily at 18:00 UTC (~21:00 EET) via `vercel.json` (`0 18 * * *`) — Vercel Hobby tier limits crons to once daily
- Auth: `CRON_SECRET` verified with `timingSafeEqual` (same as marketing cron)
- Queries shipped orders with tracking numbers, cursor-based: `ORDER BY delivery_status_checked_at ASC NULLS FIRST`, max 20 per run
- Only checks orders shipped > 2 hours ago (no premature polling)
- Explicit courier routing: `SPEEDY_PARTNERS` / `ECONT_PARTNERS` arrays, unknown values logged and skipped
- `delivery_status_checked_at` advanced only on **successful** courier API response — API errors leave order near front for retry
- Speedy tracking: `POST /shipment/track`, operation code `-14` = delivered
- Econt tracking: `POST /ShipmentStatusService.getShipmentStatuses.json`, `deliveryTime` non-null or `shortDeliveryStatusEn === "Delivered"`
- Missing courier delivery timestamp: falls back to `new Date().toISOString()`, logs `deliveredAtSource: "courier" | "inferred"`
- Email retry pass: re-attempts delivery email for orders where `delivered_at IS NOT NULL AND delivery_email_sent_at IS NULL`, ordered `delivered_at ASC`, limit 10
- Returns `{ checked, delivered, emailRetries, failed }`

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
