-- Drop product_price_history.
--
-- The table only carried snapshots of the static base price from
-- lib/products.ts at sale-creation time, so it never contributed information
-- beyond what PRODUCTS + product_sales already provide. EU Omnibus compliance
-- (Чл. 64а ЗЗП) is preserved by min(current base price, lowest sale price in
-- last 30 days) — see getLowestPrice30Days in app/actions/admin.ts.
--
-- Cascade drops the index (idx_price_history_lookup) and RLS policies tied to
-- the table.

drop table if exists product_price_history cascade;
