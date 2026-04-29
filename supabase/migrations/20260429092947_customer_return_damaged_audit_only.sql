-- Customer-return damaged movements are audit-only on inventory_current.
--
-- Background:
--   Shopify (and other multi-bucket inventory systems) treat sellable
--   inventory and damaged inventory as separate accounting buckets. When a
--   customer-returned unit arrives damaged, the sellable bucket is unchanged
--   — the unit left sellable at ship time and never came back to it; the
--   damaged bucket increments instead. Net change to sellable: 0.
--
-- Our two-table design has only inventory_current.quantity (sellable). The
-- previous trigger applied a -1 delta on every 'damaged' row, including
-- customer-return-damaged ones, which double-counted: order_out had already
-- subtracted 1 at ship time. End-state was -2 sellable for a single physical
-- loss, surfacing as phantom "operational debt" on the dashboard.
--
-- Fix: differentiate by scope.
--   - 'damaged' with reference_type='return' AND order_id IS NOT NULL:
--     audit-only. The log row records the disposition (so we can prove what
--     happened to the goods), but inventory_current is untouched.
--   - 'damaged' otherwise (warehouse-internal write-off, expiry, breakage):
--     subtract from sellable as before.
--
-- The before/after snapshot stamps reflect this — for customer-return-damaged
-- rows, before == after. UI displays this as a 0 delta with a "audit-only"
-- label.
--
-- The return cap (chk + trigger) still applies: customer can't return-damage
-- more than was shipped. The cap is about goods-flow legitimacy, independent
-- of how the row affects sellable.

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

  -- Lock the SKU row to serialize concurrent inserts for the same SKU.
  select quantity into v_before
  from public.inventory_current
  where sku = new.sku
  for update;

  v_delta := case
    when new.type in ('batch_in', 'cancellation', 'return_in', 'adjustment_gain')
      then  new.quantity
    when new.type in ('order_out', 'wholesale_out', 'sample_out', 'adjustment_loss')
      then -new.quantity
    when new.type = 'damaged' then
      case
        -- Customer-return damaged: audit-only. The unit was already removed
        -- from sellable via order_out at ship time; this row records its
        -- disposition (destroyed) but does not double-decrement.
        when new.reference_type = 'return' and new.order_id is not null
          then 0
        -- Warehouse-internal damaged (broken in storage, expired, etc.):
        -- real subtraction from sellable.
        else -new.quantity
      end
    else null
  end;

  if v_delta is null then
    raise exception 'Unknown inventory_log type: %', new.type;
  end if;

  v_after := v_before + v_delta;

  if v_after < 0 and new.type = 'order_out' then
    raise exception 'order_out movement would drive stock for SKU % below zero (before=%, delta=%, after=%); customer reservations cannot go negative',
      new.sku, v_before, v_delta, v_after;
  end if;

  update public.inventory_current
  set quantity = v_after, updated_at = now()
  where sku = new.sku;

  -- Stamp NEW so the row is inserted with before/after already set.
  new.before_quantity := v_before;
  new.after_quantity  := v_after;

  return new;
end;
$$;
