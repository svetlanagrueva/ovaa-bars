-- refund_items: explicit per-line allocation of a refund.
--
-- Currently the credit-note breakdown is reconstructed from inventory_log
-- rows where reference_type='return' AND reference_id=<refund.id>. That
-- works only when goods physically moved. For shipping disputes, partial
-- price reductions, or goodwill discounts on specific items, there's no
-- structured way to allocate the refund to lines.
--
-- refund_items adds explicit allocation. Independent of inventory_log:
--   refunds       = money event              (1 per money movement)
--   refund_items  = line-level allocation    (NEW: 0..N per refund)
--   inventory_log = physical stock movement  (separate, optional)
--   invoices      = accounting documents
--
-- Append-only — once allocated, no edits/deletes. Corrections are reversing
-- entries (post-launch).

create table if not exists refund_items (
  id              uuid primary key default gen_random_uuid(),
  refund_id       uuid not null references refunds(id) on delete cascade,
  order_item_id   bigint not null references order_items(id) on delete restrict,
  quantity        integer not null check (quantity > 0),
  amount_cents    integer not null check (amount_cents > 0),
  created_at      timestamptz not null default now(),

  -- One allocation row per (refund, line). Combine quantities at insert
  -- rather than splitting across rows; otherwise sum-cap math gets noisier.
  constraint uq_refund_items_per_pair unique (refund_id, order_item_id)
);

create index if not exists idx_refund_items_refund_id     on refund_items(refund_id);
create index if not exists idx_refund_items_order_item_id on refund_items(order_item_id);

alter table refund_items enable row level security;
create policy "Deny all on refund_items" on refund_items
  for all using (false) with check (false);


-- ── Trigger 1: same-order consistency ─────────────────────────────────────
-- The refund_id and order_item_id must belong to the same order. Without
-- this guard, admin could allocate refund X (for order A) to line item from
-- order B — the join wouldn't fail, but the allocation would be nonsense.
create or replace function check_refund_item_order_consistency()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_refund_order_id uuid;
  v_item_order_id   uuid;
begin
  select order_id into v_refund_order_id from public.refunds where id = new.refund_id;
  select order_id into v_item_order_id   from public.order_items where id = new.order_item_id;
  if v_refund_order_id is null or v_item_order_id is null then
    raise exception 'refund_items: refund_id or order_item_id not found';
  end if;
  if v_refund_order_id <> v_item_order_id then
    raise exception 'refund_items: refund and order_item must belong to the same order';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_refund_items_order_consistency on refund_items;
create trigger trg_refund_items_order_consistency
  before insert on refund_items
  for each row execute function check_refund_item_order_consistency();


-- ── Trigger 2: quantity cap per order_item ────────────────────────────────
-- sum(refund_items.quantity for order_item_id=X) ≤ order_items.quantity.
-- Locks the order_items row to serialize concurrent inserts on the same line.
create or replace function enforce_refund_items_quantity_cap()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_order_item_qty   integer;
  v_already_refunded integer;
begin
  select quantity into v_order_item_qty
  from public.order_items
  where id = new.order_item_id
  for update;

  if v_order_item_qty is null then
    raise exception 'refund_items: order_item % not found', new.order_item_id;
  end if;

  select coalesce(sum(quantity), 0) into v_already_refunded
  from public.refund_items
  where order_item_id = new.order_item_id
    and id <> new.id;

  if v_already_refunded + new.quantity > v_order_item_qty then
    raise exception 'refund_items: total refunded quantity (% existing + % new = %) would exceed ordered quantity % for order_item %',
      v_already_refunded, new.quantity,
      v_already_refunded + new.quantity, v_order_item_qty, new.order_item_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_refund_items_quantity_cap on refund_items;
create trigger trg_refund_items_quantity_cap
  before insert on refund_items
  for each row execute function enforce_refund_items_quantity_cap();


-- ── Trigger 3: amount cap per refund ──────────────────────────────────────
-- sum(refund_items.amount_cents for refund_id=R) ≤ refunds.amount_cents.
-- The refund row's total is the master; allocations across lines must not
-- exceed it. (Items can sum to LESS than the total — the difference is
-- non-allocated, e.g. shipping or goodwill portion.)
create or replace function enforce_refund_items_amount_cap()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_refund_total integer;
  v_already_alloc integer;
begin
  select amount_cents into v_refund_total
  from public.refunds
  where id = new.refund_id
  for update;

  if v_refund_total is null then
    raise exception 'refund_items: refund % not found', new.refund_id;
  end if;

  select coalesce(sum(amount_cents), 0) into v_already_alloc
  from public.refund_items
  where refund_id = new.refund_id
    and id <> new.id;

  if v_already_alloc + new.amount_cents > v_refund_total then
    raise exception 'refund_items: allocated amount (% existing + % new = %) would exceed refund total % for refund %',
      v_already_alloc, new.amount_cents,
      v_already_alloc + new.amount_cents, v_refund_total, new.refund_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_refund_items_amount_cap on refund_items;
create trigger trg_refund_items_amount_cap
  before insert on refund_items
  for each row execute function enforce_refund_items_amount_cap();


-- ── Triggers 4 + 5: append-only enforcement ───────────────────────────────
create or replace function raise_refund_items_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'refund_items is append-only; % is not permitted. Corrections require a reversing refund.', tg_op;
end;
$$;

drop trigger if exists trg_refund_items_immutable_update on refund_items;
create trigger trg_refund_items_immutable_update
  before update on refund_items
  for each row execute function raise_refund_items_immutable();

drop trigger if exists trg_refund_items_immutable_delete on refund_items;
create trigger trg_refund_items_immutable_delete
  before delete on refund_items
  for each row execute function raise_refund_items_immutable();
