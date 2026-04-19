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
- `inventory_log` — append-only movement log; `quantity` always positive (`CHECK quantity > 0`); `type` in (`batch_in`, `order_out`, `cancellation`, `wholesale_out`, `sample_out`, `damaged`, `return_in`, `adjustment_gain`, `adjustment_loss`); has `before_quantity`, `after_quantity`, `batch_id`, `expiry_date`, `order_id`, `reference_type`, `reference_id`, `created_by`, `location_id`
- `inventory_current` — trigger-maintained running total, one row per SKU; never write directly

## Complaints Table
- `complaints` — formal complaints register (ЗЗП чл. 127). Multiple per order. `complaint_ref` UNIQUE auto-generated via DB sequence (`complaint_ref_seq`) as `RCL-YYYY-NNNN`. Has `defect_description` (required), `customer_demand` ('refund'/'replacement'/'repair'/'discount'), `status` ('open'/'resolved'/'rejected'), `resolution`, `resolved_at`, `created_by`. No `complaint_ref` pointer on orders table — query complaints table directly.

## Postgres Functions
- `dashboard_stats(p_today_start, p_week_start, p_month_start)` — returns JSON with aggregated stats (SQL-level, not in-memory), includes `awaiting_settlement` count for COD orders delivered but not yet paid
- `reserve_inventory(p_sku, p_quantity, p_order_id)` — atomically decrements stock; raises exception if insufficient
- `restore_inventory(p_sku, p_quantity, p_order_id)` — atomically increments stock (cancellation / expired session)
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

## ALTER TABLE statements for existing databases
When updating an existing database, run these in Supabase SQL Editor:
```sql
ALTER TABLE orders ADD COLUMN shipping_fee integer NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN cod_fee integer NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN confirmed_at timestamptz;
ALTER TABLE orders ADD COLUMN shipped_at timestamptz;
ALTER TABLE orders ADD COLUMN delivered_at timestamptz;
ALTER TABLE orders ADD COLUMN cancelled_at timestamptz;
ALTER TABLE orders ADD COLUMN cancellation_reason text;
ALTER TABLE orders ADD COLUMN admin_notes jsonb NOT NULL DEFAULT '[]';
ALTER TABLE orders ADD COLUMN invoice_egn text;
ALTER TABLE orders ADD COLUMN marketing_consent boolean NOT NULL DEFAULT false;
ALTER TABLE orders ADD COLUMN paid_at timestamptz;
ALTER TABLE orders ADD COLUMN courier_ppp_ref text;
ALTER TABLE orders ADD COLUMN settlement_ref text;
ALTER TABLE orders ADD COLUMN settlement_amount integer;
ALTER TABLE orders ADD COLUMN invoice_sent_at timestamptz;
ALTER TABLE orders ADD COLUMN stripe_payment_intent_id text;
ALTER TABLE orders ADD COLUMN stripe_receipt_url text;
ALTER TABLE orders ADD COLUMN order_confirmation_sent_at timestamptz;
ALTER TABLE orders ADD COLUMN delivery_email_sent_at timestamptz;
ALTER TABLE orders ADD COLUMN delivery_email_last_error text;
ALTER TABLE orders ADD COLUMN delivery_status_checked_at timestamptz;
ALTER TABLE orders ADD COLUMN refunded_at timestamptz;
ALTER TABLE orders ADD COLUMN refund_amount integer CHECK (refund_amount > 0);
ALTER TABLE orders ADD COLUMN refund_reason text;
ALTER TABLE orders ADD COLUMN refund_method text CHECK (refund_method IN ('stripe', 'bank_transfer'));
ALTER TABLE orders ADD COLUMN credit_note_ref text;

-- Inventory expansion
ALTER TABLE inventory_log ADD COLUMN reference_type text CHECK (reference_type IN ('order', 'invoice', 'return', 'internal'));
ALTER TABLE inventory_log ADD COLUMN reference_id text;
ALTER TABLE inventory_log ADD COLUMN created_by text NOT NULL DEFAULT 'system';
ALTER TABLE inventory_log ADD COLUMN location_id text NOT NULL DEFAULT 'MAIN';
ALTER TABLE inventory_log ADD CONSTRAINT chk_location_id_nonempty CHECK (location_id <> '');
ALTER TABLE inventory_log ADD CONSTRAINT chk_reference_id_nonempty CHECK (reference_type IS NULL OR (reference_id IS NOT NULL AND reference_id <> ''));
-- Update type constraint to include new movement types
ALTER TABLE inventory_log DROP CONSTRAINT inventory_log_type_check;
ALTER TABLE inventory_log ADD CONSTRAINT inventory_log_type_check CHECK (type IN ('batch_in', 'order_out', 'cancellation', 'wholesale_out', 'sample_out', 'damaged', 'return_in', 'adjustment_gain', 'adjustment_loss'));
```
Plus the `issue_invoice_number`, `dashboard_stats`, `claim_marketing_emails`, `confirm_delivery` functions, the complaints table with sequence, the updated trigger, the indexes, and the unique tracking number index.

## Status constraint — includes `expired` for abandoned checkout sessions
Valid values: `pending`, `confirmed`, `shipped`, `delivered`, `cancelled`, `expired`
```sql
ALTER TABLE orders DROP CONSTRAINT orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('pending', 'confirmed', 'shipped', 'delivered', 'cancelled', 'expired'));
```

## Setting up inventory on an existing database
Run the full `supabase-schema.sql` on a fresh DB. On an existing DB that already has the inventory tables (partial run), run only the functions + trigger block — `CREATE POLICY` will error with "already exists" if tables are there.
```sql
ALTER TABLE inventory_log ADD COLUMN IF NOT EXISTS before_quantity integer;
ALTER TABLE inventory_log ADD COLUMN IF NOT EXISTS after_quantity integer;
```
