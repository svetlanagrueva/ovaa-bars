-- ──────────────────────────────────────────────────────────────────────────
-- dashboard_stats: surface refund aggregates so net revenue is visible
-- ──────────────────────────────────────────────────────────────────────────
--
-- Background. The previous dashboard_stats returned only gross product
-- revenue (sum of total_amount - shipping_fee - cod_fee per window).
-- Refunds were ignored — meaning a fully-refunded order still counted
-- toward today's revenue. After live operations begin this would
-- overstate cash actually retained.
--
-- Three new keys: today_refunds, week_refunds, month_refunds. Each is
-- SUM(refunds.amount_cents) over refunds whose refunded_at falls in the
-- window. Choosing refunded_at (not order.created_at) means refunds
-- show up in the period they were issued — same convention Shopify
-- uses for "Returns" / "Net sales" reports. Useful operational signal:
-- "today the seller refunded N €" is what admin needs at a glance,
-- regardless of when the underlying orders were placed.
--
-- Net revenue is derived on the page (gross - refunds). Keeping the
-- subtraction at the rendering layer means the RPC stays a thin SQL
-- aggregator and the gross + refund components remain inspectable.

create or replace function dashboard_stats(
  p_today_start timestamptz,
  p_week_start timestamptz,
  p_month_start timestamptz
)
returns json
language plpgsql
set search_path = public, pg_temp
as $$
declare
  result json;
begin
  select json_build_object(
    'today_orders', coalesce(sum(case when created_at >= p_today_start then 1 else 0 end), 0),
    'today_revenue', coalesce(sum(case when created_at >= p_today_start then total_amount - coalesce(shipping_fee, 0) - coalesce(cod_fee, 0) else 0 end), 0),
    'week_orders', coalesce(sum(case when created_at >= p_week_start then 1 else 0 end), 0),
    'week_revenue', coalesce(sum(case when created_at >= p_week_start then total_amount - coalesce(shipping_fee, 0) - coalesce(cod_fee, 0) else 0 end), 0),
    'month_orders', coalesce(count(*), 0),
    'month_revenue', coalesce(sum(total_amount - coalesce(shipping_fee, 0) - coalesce(cod_fee, 0)), 0),
    'pending_orders', (select count(*) from orders where status = 'pending'),
    'invoices_awaiting', (select count(*) from invoices i
                          join orders o on o.id = i.order_id
                          where i.type = 'invoice' and i.invoice_number is null
                            and o.status <> 'cancelled'),
    'credit_notes_awaiting', (select count(*) from invoices
                              where type = 'credit_note' and invoice_number is null),
    'awaiting_settlement', (select count(*) from orders where payment_method = 'cod' and delivered_at is not null and seller_settled_at is null and status = 'delivered'),
    'inventory_debt_skus', (select count(*) from inventory_current where quantity < 0),
    'withdrawals_pending', (select count(*) from withdrawals where status in ('requested', 'approved', 'goods_received')),
    -- Refund aggregates by refunded_at window. Match Shopify's "Returns"
    -- convention: a refund issued today counts against today, regardless
    -- of when the original order was placed.
    'today_refunds', (select coalesce(sum(amount_cents), 0) from refunds where refunded_at >= p_today_start),
    'week_refunds', (select coalesce(sum(amount_cents), 0) from refunds where refunded_at >= p_week_start),
    'month_refunds', (select coalesce(sum(amount_cents), 0) from refunds where refunded_at >= p_month_start)
  ) into result
  from orders
  where created_at >= p_month_start and status != 'cancelled';

  return result;
end;
$$;
