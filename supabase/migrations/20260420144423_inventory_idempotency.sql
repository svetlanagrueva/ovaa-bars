-- Migration 20260420144423: Inventory movement idempotency
--
-- Two complementary mechanisms:
--   1. Order-linked movements (order_out) get uniqueness on (order_id, sku).
--      cancellation rows intentionally NOT constrained — partial-cancel flow
--      (post-launch) will record multiple cancellation rows per (sku, order)
--      summing to <= reserved. restore_inventory enforces that invariant.
--   2. Admin-initiated movements (batch_in, wholesale_out, sample_out, damaged,
--      return_in, adjustment_*) get a global-unique idempotency_key. Callers
--      generate a UUID per form submission; a double-submit raises at the DB
--      layer instead of creating a duplicate movement.
--
-- order_out uniqueness encodes the product-model assumption that carts dedupe
-- by SKU (one line per SKU, quantity aggregated). If the product model ever
-- introduces SKU variants, split fulfillment, or bundled items that flatten
-- to the same SKU, this constraint becomes a hidden limitation — treat a cart
-- model change as a migration-triggering event.

create unique index if not exists idx_inventory_log_order_out_unique
  on inventory_log (order_id, sku)
  where type = 'order_out' and order_id is not null;

alter table inventory_log add column if not exists idempotency_key text;

create unique index if not exists idx_inventory_log_idempotency_key_unique
  on inventory_log (idempotency_key)
  where idempotency_key is not null;

-- Rewrite restore_inventory with sum-based guard. The previous "no cancellation
-- row exists" guard is too strict for partial cancellation. New invariant:
--   sum(cancellation quantities) for (sku, order) never exceeds sum(order_out
--   quantities) for (sku, order).
create or replace function restore_inventory(
  p_sku      text,
  p_quantity integer,
  p_order_id uuid
)
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_reserved integer;
  v_already_restored integer;
begin
  -- Serialize concurrent restores on the same SKU (mirrors reserve_inventory).
  perform 1 from public.inventory_current where sku = p_sku for update;

  select coalesce(sum(quantity), 0) into v_reserved
  from public.inventory_log
  where sku = p_sku and order_id = p_order_id and type = 'order_out';

  if v_reserved = 0 then
    raise exception 'No reservation found for SKU % on order %', p_sku, p_order_id;
  end if;

  select coalesce(sum(quantity), 0) into v_already_restored
  from public.inventory_log
  where sku = p_sku and order_id = p_order_id and type = 'cancellation';

  if v_already_restored + p_quantity > v_reserved then
    raise exception 'Restore quantity % plus already-restored % would exceed reserved % for SKU % on order %',
      p_quantity, v_already_restored, v_reserved, p_sku, p_order_id;
  end if;

  insert into public.inventory_log (sku, type, quantity, order_id)
  values (p_sku, 'cancellation', p_quantity, p_order_id);

  return (select quantity from public.inventory_current where sku = p_sku);
end;
$$;
