# Database Schema Notes

## Orders Table — Key Columns
- `shipping_fee` integer NOT NULL DEFAULT 0 — stored at order creation, not recalculated
- `cod_fee` integer NOT NULL DEFAULT 0 — stored at order creation
- `confirmed_at` timestamptz — set on confirmation (card webhook/success page, COD creation)
- `shipped_at` timestamptz — set when admin marks as shipped
- `delivered_at` timestamptz — set when admin marks as delivered
- `cancelled_at` timestamptz — set when admin cancels
- `cancellation_reason` text — optional, set on cancellation
- `admin_notes` text — internal admin notes, not visible to customer
- `invoice_egn` text — EGN for individual (физическо лице) invoices
- `paid_at` timestamptz — Card: set on webhook/success page confirmation; COD: set when admin records courier settlement
- `courier_ppp_ref` text — COD only: courier's ППП (postal money transfer) document reference
- `settlement_ref` text — COD only: courier's bank transfer reference (batch payout, multiple orders may share)
- `settlement_amount` integer — COD only: actual amount received in stotinki after courier commission
- `invoice_sent_at` timestamptz — when admin confirmed the invoice was sent to the customer

## Inventory Tables
- `inventory_log` — append-only movement log; `quantity` always positive (`CHECK quantity > 0`); `type` in (`batch_in`, `reserve`, `restore`); has `before_quantity`, `after_quantity`, `batch_id`, `expiry_date`, `order_id`
- `inventory_current` — trigger-maintained running total, one row per SKU; never write directly

## Postgres Functions
- `dashboard_stats(p_today_start, p_week_start, p_month_start)` — returns JSON with aggregated stats (SQL-level, not in-memory)
- `reserve_inventory(p_sku, p_quantity, p_order_id)` — atomically decrements stock; raises exception if insufficient
- `restore_inventory(p_sku, p_quantity, p_order_id)` — atomically increments stock (cancellation / expired session)
- `claim_marketing_emails(p_now, p_limit)` — find candidates + insert pending + reclaim stale + claim work, all in one call. Uses `FOR UPDATE SKIP LOCKED` for concurrency. Filters unsubscribes via `NOT EXISTS` with `lower()`.

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
ALTER TABLE orders ADD COLUMN admin_notes text;
ALTER TABLE orders ADD COLUMN invoice_egn text;
ALTER TABLE orders ADD COLUMN marketing_consent boolean NOT NULL DEFAULT false;
ALTER TABLE orders ADD COLUMN paid_at timestamptz;
ALTER TABLE orders ADD COLUMN courier_ppp_ref text;
ALTER TABLE orders ADD COLUMN settlement_ref text;
ALTER TABLE orders ADD COLUMN settlement_amount integer;
ALTER TABLE orders ADD COLUMN invoice_sent_at timestamptz;
```
Plus the `issue_invoice_number`, `dashboard_stats`, and `claim_marketing_emails` functions, and the indexes.

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
