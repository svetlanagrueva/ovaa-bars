-- Migration 20260423210000: Enforce per-order return cap on inventory_log
--
-- A customer order ships N units of a given SKU (one or more `order_out`
-- rows linked by order_id). Physical returns and return-related write-offs
-- MUST NOT exceed that shipped quantity. Without this guard, a support
-- admin could accidentally restock more than was sent out — inventory
-- overstated, audit trail broken.
--
-- Scope of the cap (narrow, deliberate):
--   NEW.order_id IS NOT NULL
--   AND NEW.reference_type = 'return'
--   AND NEW.type IN ('return_in', 'damaged')
--
-- Why this specific combination:
--   * `return_in` with reference_type='return' — customer sent goods back,
--     sellable condition. Counts against the shipped cap.
--   * `damaged` with reference_type='return' — customer sent goods back,
--     unsellable condition. Counts against the shipped cap (still came
--     out of the same order).
--   * `damaged` with reference_type='internal' — warehouse spoilage,
--     breakage, or expiry write-off. Unrelated to any customer order.
--     MUST NOT be capped (we might discover 50 units went bad in storage
--     even though we only ever shipped 30 of that SKU).
--   * `adjustment_gain` / `adjustment_loss` (reference_type='internal')
--     — reconciliation from physical counts. Also unrelated to any order.
--     MUST NOT be capped.
--
-- Append-only dependency:
--   This migration adds a BEFORE INSERT trigger only. UPDATE and DELETE
--   on inventory_log are already rejected by trg_inventory_log_immutable_update
--   and trg_inventory_log_immutable_delete (migration 20260420150533).
--   A BEFORE INSERT guard is therefore sufficient — an already-capped row
--   cannot be rewritten into a non-capped one after the fact. Corrections
--   to inventory history happen by APPENDING a new row (typically
--   adjustment_gain / adjustment_loss with reference_type='internal'),
--   which this cap does not constrain.
--
-- Error message:
--   Matches the wording used by recordStockMovement's app-layer validation
--   so the admin sees consistent Bulgarian copy regardless of which layer
--   caught the violation. Includes the numeric specifics (shipped / prior /
--   attempted) for debuggability.

create or replace function enforce_order_return_cap()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_shipped integer;
  v_prior_returns integer;
begin
  -- Narrow guard: only fire for return-scoped movements tied to an order.
  -- All other inventory movements pass through untouched.
  if new.order_id is null
     or new.reference_type is distinct from 'return'
     or new.type not in ('return_in', 'damaged') then
    return new;
  end if;

  -- Sum what the customer actually received on this order for this SKU.
  -- reserve_inventory inserts one order_out per (order_id, sku); a unique
  -- partial index enforces that. So coalesce is cheap defense.
  select coalesce(sum(quantity), 0)
    into v_shipped
    from public.inventory_log
    where order_id = new.order_id
      and sku = new.sku
      and type = 'order_out';

  if v_shipped = 0 then
    raise exception 'Не можете да върнете/бракувате артикул, който не е бил изпратен по тази поръчка (SKU %)',
      new.sku;
  end if;

  -- Sum already-recorded return-scoped movements for this SKU/order.
  -- Excludes warehouse-internal damage (reference_type='internal'),
  -- which is deliberately uncapped (see migration header).
  select coalesce(sum(quantity), 0)
    into v_prior_returns
    from public.inventory_log
    where order_id = new.order_id
      and sku = new.sku
      and reference_type = 'return'
      and type in ('return_in', 'damaged');

  if v_prior_returns + new.quantity > v_shipped then
    raise exception 'Не можете да върнете/бракувате повече бройки от изпратените за този артикул по тази поръчка (SKU %, изпратени %, вече върнати %, опит за %)',
      new.sku, v_shipped, v_prior_returns, new.quantity;
  end if;

  return new;
end;
$$;

create trigger trg_enforce_order_return_cap
before insert on inventory_log
for each row execute function enforce_order_return_cap();
