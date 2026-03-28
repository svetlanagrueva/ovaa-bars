# Database Schema Notes

## Orders Table — Key Columns Added This Session
- `shipping_fee` integer NOT NULL DEFAULT 0 — stored at order creation, not recalculated
- `cod_fee` integer NOT NULL DEFAULT 0 — stored at order creation
- `confirmed_at` timestamptz — set on confirmation (card webhook/success page, COD creation)
- `shipped_at` timestamptz — set when admin marks as shipped
- `delivered_at` timestamptz — set when admin marks as delivered
- `cancelled_at` timestamptz — set when admin cancels
- `cancellation_reason` text — optional, set on cancellation
- `admin_notes` text — internal admin notes, not visible to customer
- `invoice_egn` text — EGN for individual (физическо лице) invoices

## Postgres Functions
- `next_invoice_number()` — legacy, no longer used directly
- `issue_invoice_number(p_order_id uuid)` — atomic: allocates next number + assigns to order in single transaction
- `dashboard_stats(p_today_start, p_week_start, p_month_start)` — returns JSON with aggregated stats (SQL-level, not in-memory)

## Indexes
- `idx_orders_invoice_number` — partial index on invoice_number WHERE NOT NULL
- `idx_orders_status` — on status column
- `idx_orders_created_at` — on created_at DESC
- `idx_orders_needs_invoice` — partial index WHERE needs_invoice = true AND invoice_number IS NULL

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
```
Plus the `issue_invoice_number` and `dashboard_stats` functions, and the indexes.

## Status constraint — add `expired` for abandoned checkout sessions
```sql
ALTER TABLE orders DROP CONSTRAINT orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('pending', 'confirmed', 'shipped', 'delivered', 'cancelled', 'expired'));
```
And the full inventory tables + functions + trigger from `supabase-schema.sql`.
