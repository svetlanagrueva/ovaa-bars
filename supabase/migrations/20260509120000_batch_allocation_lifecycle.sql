-- Batch allocation lifecycle change.
--
-- Until now, order_item_batches was fully immutable post-insert under the
-- assumption that allocation happens at the same moment as shipment. The
-- new admin UI splits allocation from shipment generation, so rows must be
-- mutable while the order is still being prepared, and lock once the
-- courier label is requested.
--
-- Lifecycle:
--   parent order tracking_number IS NULL          → editable
--   parent order tracking_number = '__generating__'  → locked (courier in-flight)
--   parent order tracking_number = real value     → locked (shipped)
--
-- Locking on the '__generating__' sentinel as well as the real value
-- prevents a race where one admin requests a label while another edits
-- the allocation under it.

begin;

-- 1. Drop the old blanket immutability triggers + their function
drop trigger if exists trg_order_item_batches_immutable_update on public.order_item_batches;
drop trigger if exists trg_order_item_batches_immutable_delete on public.order_item_batches;
drop function if exists public.raise_order_item_batches_immutable();

-- 2. New lifecycle trigger function — locks rows once parent order has a tracking number
create or replace function public.enforce_order_item_batches_locked_after_shipment()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_order_item_id   bigint;
  v_tracking_number text;
begin
  v_order_item_id := case
    when tg_op = 'DELETE' then old.order_item_id
    else new.order_item_id
  end;

  select o.tracking_number
  into v_tracking_number
  from public.orders o
  join public.order_items oi on oi.order_id = o.id
  where oi.id = v_order_item_id;

  if v_tracking_number is not null then
    raise exception 'Cannot modify batch allocation after shipment generation (tracking_number is set)';
  end if;

  return case
    when tg_op = 'DELETE' then old
    else new
  end;
end;
$$;

-- 3. Single trigger covers INSERT/UPDATE/DELETE — INSERT included as backstop
--    so a save against an already-locked order can't sneak rows in.
create trigger trg_order_item_batches_locked
before insert or update or delete on public.order_item_batches
for each row
execute function public.enforce_order_item_batches_locked_after_shipment();

-- 4. Reason columns for FEFO deviation + expired-batch override audit trail
alter table public.order_item_batches
  add column non_fefo_reason         text,
  add column expired_override_reason text,
  add constraint chk_non_fefo_reason_length check (
    non_fefo_reason is null
    or char_length(non_fefo_reason) between 20 and 1000
  ),
  add constraint chk_expired_override_reason_length check (
    expired_override_reason is null
    or char_length(expired_override_reason) between 20 and 1000
  );

commit;
