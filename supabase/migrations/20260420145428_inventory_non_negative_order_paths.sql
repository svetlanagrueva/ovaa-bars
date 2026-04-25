-- Migration 20260420145428: Enforce non-negative stock for order-linked paths
--
-- The update_inventory_current trigger now rejects order_out movements that
-- would drive inventory_current.quantity below zero. This is a backstop to
-- reserve_inventory's existing sufficiency check.
--
-- Admin-initiated decrements (wholesale_out, sample_out, damaged,
-- adjustment_loss) are intentionally allowed to go negative — they record
-- operational debt (discovered shortage, backdated write-off) that the system
-- must be able to reflect truthfully. Negative inventory_current is surfaced
-- in admin UI as "Дълг" (debt), not blocked at the DB layer.

-- Also expose a counter for SKUs in operational debt (negative stock) in the
-- dashboard stats RPC so admin sees the signal to reconcile.
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
    'invoices_awaiting', (select count(*) from orders where needs_invoice = true and invoice_number is null and status != 'cancelled'),
    'awaiting_settlement', (select count(*) from orders where payment_method = 'cod' and delivered_at is not null and paid_at is null and status = 'delivered'),
    'inventory_debt_skus', (select count(*) from inventory_current where quantity < 0)
  ) into result
  from orders
  where created_at >= p_month_start and status != 'cancelled';

  return result;
end;
$$;

create or replace function update_inventory_current()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_before integer;
  v_delta  integer;
  v_after  integer;
begin
  insert into public.inventory_current (sku, quantity, updated_at)
  values (new.sku, 0, now())
  on conflict (sku) do nothing;

  select quantity into v_before
  from public.inventory_current
  where sku = new.sku;

  v_delta := case
    when new.type in ('batch_in', 'cancellation', 'return_in', 'adjustment_gain')
      then  new.quantity
    when new.type in ('order_out', 'wholesale_out', 'sample_out', 'damaged', 'adjustment_loss')
      then -new.quantity
    else
      null  -- will be caught below
  end;

  if v_delta is null then
    raise exception 'Unknown inventory_log type: %', new.type;
  end if;

  v_after := v_before + v_delta;

  -- Customer-facing reservations must never drive stock negative.
  -- reserve_inventory enforces this with FOR UPDATE + sufficiency check;
  -- this trigger is a backstop that rejects any order_out slipping past.
  if v_after < 0 and new.type = 'order_out' then
    raise exception 'order_out movement would drive stock for SKU % below zero (before=%, delta=%, after=%); customer reservations cannot go negative',
      new.sku, v_before, v_delta, v_after;
  end if;

  update public.inventory_current
  set quantity = v_after, updated_at = now()
  where sku = new.sku;

  update public.inventory_log
  set before_quantity = v_before, after_quantity = v_after
  where id = new.id;

  return new;
end;
$$;
