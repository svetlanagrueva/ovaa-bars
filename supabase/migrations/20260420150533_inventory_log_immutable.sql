-- Migration 20260420150533: Make inventory_log immutable at the DB layer
--
-- The ledger is append-only by design. Until now this was a convention
-- (no app code issued UPDATE/DELETE on inventory_log), but the service
-- role technically could. This migration enforces it at the schema layer.
--
-- Two-step change:
--   1. Refactor update_inventory_current from AFTER INSERT to BEFORE INSERT.
--      Instead of inserting the row and then UPDATEing before_quantity /
--      after_quantity back, set them directly on NEW. Removes the only
--      legitimate internal UPDATE path on inventory_log.
--   2. Add trg_inventory_log_immutable that raises on any UPDATE or DELETE,
--      no exceptions.
--
-- Reserve/restore RPCs insert but never update log rows, so their behavior
-- is unchanged. Admin actions (addInventoryBatch, recordStockMovement) also
-- only insert.

-- Step 1: Refactor the trigger to BEFORE INSERT with NEW field assignment.
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
    when new.type in ('order_out', 'wholesale_out', 'sample_out', 'damaged', 'adjustment_loss')
      then -new.quantity
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

-- Rebuild trigger as BEFORE INSERT so NEW field assignment takes effect.
drop trigger if exists trg_update_inventory_current on inventory_log;
create trigger trg_update_inventory_current
before insert on inventory_log
for each row execute function update_inventory_current();

-- Step 2: Block UPDATE and DELETE on the ledger.
create or replace function raise_inventory_log_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'inventory_log is append-only; % is not permitted', tg_op;
end;
$$;

create trigger trg_inventory_log_immutable_update
before update on inventory_log
for each row execute function raise_inventory_log_immutable();

create trigger trg_inventory_log_immutable_delete
before delete on inventory_log
for each row execute function raise_inventory_log_immutable();
