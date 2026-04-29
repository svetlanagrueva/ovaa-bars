-- Batch traceability (Tier 1) — minimum legally-defensible recall capability.
--
-- Legal basis:
--   EU 178/2002 Чл. 18 — one-step-back, one-step-forward traceability
--   EU 931/2011        — batch info on commercial consignments (animal-origin)
--   ЗХр Чл. 84-86      — Bulgarian transposition
--   ЗЗП recall procedure — БАБХ supervises withdrawals/recalls
--
-- Schema design:
--   product_batches    — one row per (sku, batch_number) supplier label
--   order_item_batches — populated at ship time; records "this order_item
--                        consumed N units from this batch"
--
-- Both are append-mostly: order_item_batches is fully immutable post-insert;
-- product_batches allows only the active → recalled forward transition with
-- recall metadata atomically populated. Records are tamper-evident — БАБХ
-- inspectors expect this.
--
-- Inventory layer (inventory_log/inventory_current) is unchanged. Batch
-- availability is derived on demand from inventory_log + order_item_batches.


-- ── 1. product_batches ────────────────────────────────────────────────────
create table if not exists product_batches (
  id              uuid primary key default gen_random_uuid(),
  sku             text not null,
  batch_number    text not null,
  expiry_date     date not null,                 -- food: every batch has a use-by date
  status          text not null default 'active'
                  check (status in ('active', 'recalled')),

  -- Recall metadata: required when status='recalled', forbidden when 'active'.
  -- Provides audit trail for inspectors ("when did you recall, why").
  recalled_at     timestamptz,
  recalled_by     text,
  recall_reason   text,
  notes           text,
  created_at      timestamptz not null default now(),
  created_by      text not null default 'admin',

  unique (sku, batch_number),

  constraint chk_recall_metadata check (
    (status = 'active' and recalled_at is null and recalled_by is null and recall_reason is null)
    or (status = 'recalled' and recalled_at is not null
        and recalled_by is not null and btrim(recalled_by) <> ''
        and recall_reason is not null and length(btrim(recall_reason)) >= 20)
  ),
  constraint chk_recall_reason_length check (
    recall_reason is null or length(recall_reason) <= 1000
  ),
  constraint chk_notes_length check (
    notes is null or length(notes) <= 1000
  ),
  constraint chk_batch_number_nonempty check (btrim(batch_number) <> '')
);

create index if not exists idx_product_batches_sku_status
  on product_batches(sku, status);
create index if not exists idx_product_batches_expiry
  on product_batches(sku, expiry_date) where status = 'active';
create index if not exists idx_product_batches_recalled
  on product_batches(status) where status = 'recalled';

alter table product_batches enable row level security;
create policy "Deny all on product_batches" on product_batches
  for all using (false) with check (false);


-- ── 2. order_item_batches ─────────────────────────────────────────────────
create table if not exists order_item_batches (
  id                uuid primary key default gen_random_uuid(),
  order_item_id     bigint not null references order_items(id) on delete cascade,
  product_batch_id  uuid not null references product_batches(id) on delete restrict,
  quantity          integer not null check (quantity > 0),
  confirmed_at      timestamptz not null default now(),
  confirmed_by      text not null default 'admin',

  -- One row per (order_item, batch). Multiple batches per item supported
  -- via separate rows; combining lines avoids ambiguous totals.
  unique (order_item_id, product_batch_id)
);

create index if not exists idx_order_item_batches_order_item
  on order_item_batches(order_item_id);
create index if not exists idx_order_item_batches_product_batch
  on order_item_batches(product_batch_id);

alter table order_item_batches enable row level security;
create policy "Deny all on order_item_batches" on order_item_batches
  for all using (false) with check (false);


-- ── 3. product_batches: append-mostly enforcement ─────────────────────────
-- DELETE: blocked unconditionally.
-- UPDATE: only the active→recalled transition with metadata fields set.
-- Anything else raises — keeps records tamper-evident for inspections.
create or replace function enforce_product_batches_append_mostly_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- All non-status fields must remain unchanged.
  if old.id is distinct from new.id
     or old.sku is distinct from new.sku
     or old.batch_number is distinct from new.batch_number
     or old.expiry_date is distinct from new.expiry_date
     or old.created_at is distinct from new.created_at
     or old.created_by is distinct from new.created_by
     or old.notes is distinct from new.notes then
    raise exception 'product_batches is append-mostly; only status can transition active → recalled (with metadata) — other fields are immutable';
  end if;

  -- Only forward transition active → recalled is allowed.
  if old.status is distinct from new.status then
    if not (old.status = 'active' and new.status = 'recalled') then
      raise exception 'product_batches.status: only the forward transition active → recalled is allowed (got % → %)', old.status, new.status;
    end if;
    -- Recall metadata must be set in the same UPDATE.
    if new.recalled_at is null or new.recalled_by is null or new.recall_reason is null then
      raise exception 'product_batches: recalling a batch requires recalled_at, recalled_by, and recall_reason to be set in the same update';
    end if;
  else
    -- Status unchanged; recall metadata fields must also be unchanged.
    if old.recalled_at is distinct from new.recalled_at
       or old.recalled_by is distinct from new.recalled_by
       or old.recall_reason is distinct from new.recall_reason then
      raise exception 'product_batches: recall metadata can only change as part of the active → recalled transition';
    end if;
  end if;

  return new;
end;
$$;

create or replace function raise_product_batches_immutable_delete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'product_batches is append-mostly; DELETE is not permitted. Mark a batch as recalled instead.';
end;
$$;

drop trigger if exists trg_product_batches_append_mostly_update on product_batches;
create trigger trg_product_batches_append_mostly_update
  before update on product_batches
  for each row execute function enforce_product_batches_append_mostly_update();

drop trigger if exists trg_product_batches_immutable_delete on product_batches;
create trigger trg_product_batches_immutable_delete
  before delete on product_batches
  for each row execute function raise_product_batches_immutable_delete();


-- ── 4. order_item_batches: fully immutable post-insert ────────────────────
-- Allocation is locked at ship time. Mistakes corrected by reversing entries
-- (out of MVP — for now manual data repair).
create or replace function raise_order_item_batches_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'order_item_batches is immutable post-insert; % is not permitted. Allocation is locked at ship time.', tg_op;
end;
$$;

drop trigger if exists trg_order_item_batches_immutable_update on order_item_batches;
create trigger trg_order_item_batches_immutable_update
  before update on order_item_batches
  for each row execute function raise_order_item_batches_immutable();

drop trigger if exists trg_order_item_batches_immutable_delete on order_item_batches;
create trigger trg_order_item_batches_immutable_delete
  before delete on order_item_batches
  for each row execute function raise_order_item_batches_immutable();


-- ── 5. order_item_batches: batch-SKU consistency ──────────────────────────
-- The batch's sku must match the order_item's sku. Otherwise we'd record
-- "shipped from batch of SKU A" against an order line for SKU B — silently
-- corrupt traceability.
create or replace function check_order_item_batch_sku_consistency()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_item_sku text;
  v_batch_sku text;
begin
  select sku into v_item_sku from public.order_items where id = new.order_item_id;
  select sku into v_batch_sku from public.product_batches where id = new.product_batch_id;
  if v_item_sku is null or v_batch_sku is null then
    raise exception 'order_item_batches: order_item_id or product_batch_id not found';
  end if;
  if v_item_sku <> v_batch_sku then
    raise exception 'order_item_batches: batch SKU (%) does not match order_item SKU (%)', v_batch_sku, v_item_sku;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_order_item_batches_sku_consistency on order_item_batches;
create trigger trg_order_item_batches_sku_consistency
  before insert on order_item_batches
  for each row execute function check_order_item_batch_sku_consistency();


-- ── 6. Helper: batch_quantity_available ───────────────────────────────────
-- Derives current available units. Inventory_log is the source of truth for
-- inflows/outflows; order_item_batches tracks order-level allocation.
--
-- Rules:
--   + batch_in / return_in / adjustment_gain (matching sku + batch_number)
--   - damaged / wholesale_out / sample_out / adjustment_loss
--     (excluding damaged with reference_type='return' — that's audit-only,
--      the unit was already counted out via order_item_batches at ship time)
--   - order_item_batches.quantity for orders in confirmed/shipped/delivered
--     (cancelled releases the allocation; pending/expired never confirmed)
create or replace function batch_quantity_available(p_batch_id uuid)
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_sku          text;
  v_batch_number text;
  v_in           integer;
  v_out          integer;
  v_alloc        integer;
begin
  select sku, batch_number into v_sku, v_batch_number
  from public.product_batches
  where id = p_batch_id;

  if v_sku is null then
    return 0;
  end if;

  select coalesce(sum(quantity), 0) into v_in
  from public.inventory_log
  where sku = v_sku
    and batch_id = v_batch_number
    and type in ('batch_in', 'return_in', 'adjustment_gain');

  select coalesce(sum(quantity), 0) into v_out
  from public.inventory_log
  where sku = v_sku
    and batch_id = v_batch_number
    and type in ('damaged', 'wholesale_out', 'sample_out', 'adjustment_loss')
    and not (type = 'damaged' and reference_type = 'return');

  select coalesce(sum(oib.quantity), 0) into v_alloc
  from public.order_item_batches oib
  join public.order_items oi on oi.id = oib.order_item_id
  join public.orders      o  on o.id = oi.order_id
  where oib.product_batch_id = p_batch_id
    and o.status in ('confirmed', 'shipped', 'delivered');

  return v_in - v_out - v_alloc;
end;
$$;


-- ── 7. Helper: affected_orders_for_batch ──────────────────────────────────
-- Recall worklist. Excludes orders that never went out the door
-- (cancelled / pending / expired) — confirmed is included so admin can
-- intercept allocations before the courier label is printed.
create or replace function affected_orders_for_batch(p_batch_id uuid)
returns table (
  order_id          uuid,
  order_status      text,
  customer_email    text,
  customer_first_name text,
  customer_last_name  text,
  customer_phone   text,
  customer_city     text,
  shipped_at        timestamptz,
  delivered_at      timestamptz,
  quantity_from_batch integer,
  tracking_number   text
)
language sql
set search_path = public, pg_temp
as $$
  select
    o.id,
    o.status,
    o.email,
    o.first_name,
    o.last_name,
    o.phone,
    o.city,
    o.shipped_at,
    o.delivered_at,
    sum(oib.quantity)::integer,
    o.tracking_number
  from public.product_batches pb
  join public.order_item_batches oib on oib.product_batch_id = pb.id
  join public.order_items oi on oi.id = oib.order_item_id
  join public.orders      o  on o.id = oi.order_id
  where pb.id = p_batch_id
    and o.status in ('confirmed', 'shipped', 'delivered')
  group by o.id, o.status, o.email, o.first_name, o.last_name, o.phone,
           o.city, o.shipped_at, o.delivered_at, o.tracking_number
  order by o.shipped_at desc nulls last, o.created_at desc;
$$;


-- ── 8. Backfill from existing inventory_log batch_in rows ─────────────────
-- Pre-launch, admins have been seeding batches via the inventory page.
-- Backfill those into product_batches (one row per (sku, batch_id) pair),
-- using the earliest expiry_date and created_at observed.
insert into product_batches (sku, batch_number, expiry_date, created_at, created_by)
select
  sku,
  batch_id,
  min(expiry_date),
  min(created_at),
  'system-backfill'
from inventory_log
where type = 'batch_in'
  and batch_id is not null
  and btrim(batch_id) <> ''
  and expiry_date is not null
group by sku, batch_id
on conflict (sku, batch_number) do nothing;
