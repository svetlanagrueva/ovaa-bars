# Database Schema Notes

## Orders Table — Key Columns
- `shipping_fee` integer NOT NULL DEFAULT 0 — stored at order creation, not recalculated
- `cod_fee` integer NOT NULL DEFAULT 0 — stored at order creation
- `confirmed_at` timestamptz — set on confirmation (card webhook/success page, COD creation)
- `shipped_at` timestamptz — set when admin marks as shipped
- `delivered_at` timestamptz — set when admin marks as delivered
- `cancelled_at` timestamptz — set when admin cancels
- `cancellation_reason` text — optional, set on cancellation
- `admin_notes` jsonb NOT NULL DEFAULT '[]' — append-only array of `{text, created_at}` note entries, shown in order timeline
- `invoice_egn` text — EGN for individual (физическо лице) invoices
- `paid_at` timestamptz — Card: set on webhook/success page confirmation; COD: set when admin records courier settlement
- `courier_ppp_ref` text — COD only: courier's ППП (postal money transfer) document reference
- `settlement_ref` text — COD only: courier's bank transfer reference (batch payout, multiple orders may share)
- `settlement_amount` integer — COD only: actual amount received in cents after courier commission
- `invoice_sent_at` timestamptz — when admin confirmed the invoice was sent to the customer
- `stripe_payment_intent_id` text — Stripe PaymentIntent ID for card payments (reconciliation key for Stripe payouts)
- `stripe_receipt_url` text — Stripe-hosted payment receipt URL (card payments only, not a legal invoice)
- `order_confirmation_sent_at` timestamptz — when confirmation email was successfully sent to customer
- `delivery_email_sent_at` timestamptz — when delivery confirmation email was successfully sent
- `delivery_email_last_error` text — last error message from failed delivery email attempt (observability)
- `delivery_status_checked_at` timestamptz — last successful courier API poll for delivery status (cron cursor)
- `refunded_at` timestamptz — when refund was recorded by admin. Idempotency guard. Semantics: money has been sent.
- `refund_amount` integer CHECK (> 0) — amount refunded in cents. May differ from total_amount (partial refund).
- `refund_reason` text — free text reason for refund
- `refund_method` text CHECK ('stripe', 'bank_transfer') — how refund was issued
- `credit_note_ref` text — кредитно известие reference. Required when invoice was issued for the order.

## Inventory Tables
- `inventory_log` — append-only movement log; `quantity` always positive (`CHECK quantity > 0`); `type` in (`batch_in`, `order_out`, `cancellation`, `wholesale_out`, `sample_out`, `damaged`, `return_in`, `adjustment_gain`, `adjustment_loss`); has `before_quantity`, `after_quantity`, `batch_id`, `expiry_date`, `order_id`, `reference_type`, `reference_id`, `created_by`, `location_id`, `idempotency_key`. **Immutable: `BEFORE UPDATE`/`BEFORE DELETE` triggers block all mutations, no service-role bypass.** Correct errors by inserting an offsetting movement.
- `inventory_current` — trigger-maintained running total, one row per SKU; never write directly

## Complaints Table
- `complaints` — formal complaints register (ЗЗП чл. 127). Multiple per order. `complaint_ref` UNIQUE auto-generated via DB sequence (`complaint_ref_seq`) as `RCL-YYYY-NNNN`. Has `defect_description` (required), `customer_demand` ('refund'/'replacement'/'repair'/'discount'), `status` ('open'/'resolved'/'rejected'), `resolution`, `resolved_at`, `created_by`. No `complaint_ref` pointer on orders table — query complaints table directly.

## Postgres Functions
- `dashboard_stats(p_today_start, p_week_start, p_month_start)` — returns JSON with aggregated stats (SQL-level, not in-memory), includes `awaiting_settlement` count for COD orders delivered but not yet paid
- `reserve_inventory(p_sku, p_quantity, p_order_id)` — atomically decrements stock; raises exception if insufficient
- `restore_inventory(p_sku, p_quantity, p_order_id)` — atomically increments stock (cancellation / expired session / partial cancel). Sum-based guard: `sum(restored) + p_quantity` must not exceed `sum(reserved)` for `(sku, order_id)`. Raises if no matching `order_out` exists, or if the invariant would be violated. Multiple cancellation rows per `(sku, order_id)` are allowed (supports partial cancellation).
- `claim_marketing_emails(p_now, p_limit)` — find candidates + insert pending + reclaim stale + claim work, all in one call. Uses `FOR UPDATE SKIP LOCKED` for concurrency. Filters unsubscribes via `NOT EXISTS` with `lower()`.
- `confirm_delivery(p_order_id, p_delivered_at)` — atomically marks order as delivered WHERE `status = 'shipped'`, returns updated row. Idempotent — no-op if order is not shipped.

## Marketing Email Tables
- `email_unsubscribes` — `email text PRIMARY KEY`, RLS deny-all. Keyed by lowercase email.
- `marketing_email_log` — `UNIQUE(order_id, email_type)`, status: `pending/sending/sent/failed/skipped`
  - `claimed_at` for stale detection (not `created_at`), `last_attempt_at`, `provider_message_id`, `attempt_count`
  - Partial index on `status IN ('pending', 'failed')`

## Indexes
- `idx_orders_invoice_number` — partial index on invoice_number WHERE NOT NULL
- `idx_orders_status` — on status column
- `idx_orders_created_at` — on created_at DESC
- `idx_orders_needs_invoice` — partial index WHERE needs_invoice = true AND invoice_number IS NULL
- `idx_orders_delivered_at` — partial index on delivered_at WHERE NOT NULL (marketing cron)
- `idx_marketing_email_log_claimable` — partial index on status WHERE IN ('pending', 'failed')
- `idx_orders_tracking_number_unique` — unique partial index on tracking_number WHERE NOT NULL AND != '__generating__'
- `idx_inventory_log_order_out_unique` — unique partial index on (order_id, sku) WHERE type='order_out'. Encodes "cart dedups by SKU" assumption; changing the cart model requires dropping this index.
- `idx_inventory_log_idempotency_key_unique` — unique partial index on idempotency_key WHERE NOT NULL. Rejects duplicate admin-movement submissions at the DB layer.

## Status constraint
Valid values in `orders.status`: `pending`, `confirmed`, `shipped`, `delivered`, `cancelled`, `expired`.

## Setting up the database
Apply migrations from `supabase/migrations/` in filename order — see that directory's `README.md` for the workflow. The initial schema migration (`20260420120000_initial_schema.sql`) is the first file; subsequent schema changes are separate migration files. Never edit an applied migration, always add a new one.
