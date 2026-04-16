-- Run this in your Supabase project: SQL Editor → New query → Paste & Run

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),

  -- Customer info
  email text not null,
  first_name text not null,
  last_name text not null,
  phone text not null,
  city text not null,
  address text default '',
  postal_code text default '',
  notes text default '',

  -- Order details
  items jsonb not null,
  total_amount integer not null check (total_amount > 0),
  shipping_fee integer not null default 0,
  cod_fee integer not null default 0,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'shipped', 'delivered', 'cancelled', 'expired')),
  tracking_number text,
  payment_method text not null check (payment_method in ('card', 'cod')),
  logistics_partner text,
  stripe_session_id text unique,
  promo_code text,
  discount_amount integer not null default 0,
  confirmed_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,

  -- Invoice
  needs_invoice boolean default false,
  invoice_company_name text,
  invoice_eik text,
  invoice_egn text,
  invoice_vat_number text,
  invoice_mol text,
  invoice_address text,
  invoice_number text unique,
  invoice_date timestamptz,
  invoice_sent_at timestamptz,

  -- Econt delivery (optional)
  econt_office_id integer,
  econt_office_code text,
  econt_office_name text,
  econt_office_address text,

  -- Speedy delivery (optional)
  speedy_office_id integer,
  speedy_office_name text,
  speedy_office_address text,

  -- Payment tracking
  paid_at timestamptz,              -- Card: set on Stripe webhook; COD: set when courier settlement received
  courier_ppp_ref text,             -- COD: courier's postal money transfer (ППП) document reference
  settlement_ref text,              -- COD: courier's bank transfer reference (batch payout)
  settlement_amount integer,        -- COD: actual amount received after courier commission, in stotinki

  -- Admin
  admin_notes text,

  -- Cancellation
  cancellation_reason text,

  -- Marketing consent (unchecked by default at checkout, required for soft opt-in under ЗЕС чл. 261)
  marketing_consent boolean not null default false
);

-- Enable Row Level Security
alter table orders enable row level security;

-- Only allow inserts from server actions (service role bypasses RLS).
-- The anon key should NOT be able to read/update orders directly.
-- Server actions use the service role key via Supabase server client.
-- These restrictive policies block direct anon access:

create policy "Deny public reads" on orders
  for select using (false);

create policy "Deny public updates" on orders
  for update using (false);

create policy "Deny public inserts" on orders
  for insert with check (false);

create policy "Deny public deletes" on orders
  for delete using (false);

-- IMPORTANT: Server actions use the SUPABASE_SERVICE_ROLE_KEY to bypass RLS.
-- See .env.local and lib/supabase/server.ts.

-- Invoice number index (invoice numbers are now entered manually via external software)
create index if not exists idx_orders_invoice_number on orders (invoice_number)
  where invoice_number is not null;

create index if not exists idx_orders_status on orders (status);
create index if not exists idx_orders_created_at on orders (created_at desc);
create index if not exists idx_orders_needs_invoice on orders (needs_invoice)
  where needs_invoice = true and invoice_number is null;

-- Dashboard stats (computed server-side for scalability)
create or replace function dashboard_stats(
  p_today_start timestamptz,
  p_week_start timestamptz,
  p_month_start timestamptz
)
returns json
language plpgsql
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
    'invoices_awaiting', (select count(*) from orders where needs_invoice = true and invoice_number is null and status != 'cancelled')
  ) into result
  from orders
  where created_at >= p_month_start and status != 'cancelled';

  return result;
end;
$$;

-- Product sales (admin-managed promotions)
create table if not exists product_sales (
  id uuid primary key default gen_random_uuid(),
  product_id text not null,
  sale_price_in_cents integer not null check (sale_price_in_cents > 0),
  original_price_in_cents integer not null check (original_price_in_cents > 0),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint chk_sale_price check (sale_price_in_cents < original_price_in_cents)
);

-- Partial unique index: at most one active sale per product
create unique index if not exists idx_product_sales_one_active
  on product_sales (product_id) where is_active = true;

alter table product_sales enable row level security;
create policy "Deny public reads on sales" on product_sales for select using (false);
create policy "Deny public inserts on sales" on product_sales for insert with check (false);
create policy "Deny public updates on sales" on product_sales for update using (false);
create policy "Deny public deletes on sales" on product_sales for delete using (false);

-- Price history for EU Omnibus Directive compliance
create table if not exists product_price_history (
  id uuid primary key default gen_random_uuid(),
  product_id text not null,
  price_in_cents integer not null,
  recorded_at timestamptz not null default now()
);

create index if not exists idx_price_history_lookup
  on product_price_history (product_id, recorded_at desc);

alter table product_price_history enable row level security;
create policy "Deny public reads on price history" on product_price_history for select using (false);
create policy "Deny public inserts on price history" on product_price_history for insert with check (false);

-- Promo codes
create table if not exists promo_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  discount_type text not null check (discount_type in ('percentage', 'fixed')),
  discount_value integer not null check (discount_value > 0),
  min_order_amount integer not null default 0,
  max_uses integer,
  current_uses integer not null default 0,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint chk_percentage check (discount_type != 'percentage' or discount_value <= 100)
);

create unique index if not exists idx_promo_codes_unique_active
  on promo_codes (upper(code)) where is_active = true;

alter table promo_codes enable row level security;
create policy "Deny public reads on promo codes" on promo_codes for select using (false);
create policy "Deny public inserts on promo codes" on promo_codes for insert with check (false);
create policy "Deny public updates on promo codes" on promo_codes for update using (false);
create policy "Deny public deletes on promo codes" on promo_codes for delete using (false);

-- ─── Inventory ────────────────────────────────────────────────────────────────

-- Append-only audit log of all inventory movements.
-- type:
--   batch_in    — new stock added (has batch_id, expiry_date)
--   order_out   — stock consumed by a confirmed order (has order_id)
--   cancellation — stock restored when an order is cancelled (has order_id)
--   adjustment  — manual correction (has notes)
-- quantity is always positive; direction is encoded in type.
create table if not exists inventory_log (
  id          bigint generated always as identity primary key,
  sku         text not null,
  type        text not null check (type in ('batch_in', 'order_out', 'adjustment', 'cancellation')),
  quantity    integer not null check (quantity > 0),
  batch_id    text,
  expiry_date date,
  order_id         uuid references orders(id) on delete set null,
  notes            text,
  before_quantity  integer,  -- stock level before this movement (set by trigger)
  after_quantity   integer,  -- stock level after this movement (set by trigger)
  created_at       timestamptz not null default now()
);

create index if not exists idx_inventory_log_sku        on inventory_log (sku);
create index if not exists idx_inventory_log_created_at on inventory_log (created_at desc);
create index if not exists idx_inventory_log_order_id   on inventory_log (order_id) where order_id is not null;

-- Running total per SKU — updated by trigger on every inventory_log insert.
-- Read this table for real-time stock checks (never aggregate inventory_log directly).
create table if not exists inventory_current (
  sku        text primary key,
  quantity   integer not null default 0,
  updated_at timestamptz not null default now()
);

-- Trigger: keep inventory_current in sync with every inventory_log insert
create or replace function update_inventory_current()
returns trigger as $$
declare
  v_before integer;
  v_delta  integer;
  v_after  integer;
begin
  insert into inventory_current (sku, quantity, updated_at)
  values (new.sku, 0, now())
  on conflict (sku) do nothing;

  select quantity into v_before
  from inventory_current
  where sku = new.sku;

  v_delta := case
    when new.type in ('batch_in', 'cancellation') then  new.quantity
    when new.type in ('order_out', 'adjustment')  then -new.quantity
  end;

  v_after := v_before + v_delta;

  update inventory_current
  set quantity = v_after, updated_at = now()
  where sku = new.sku;

  -- Write before/after back to the log row so each entry is self-contained
  update inventory_log
  set before_quantity = v_before, after_quantity = v_after
  where id = new.id;

  return new;
end;
$$ language plpgsql;

create or replace trigger trg_update_inventory_current
after insert on inventory_log
for each row execute function update_inventory_current();

alter table inventory_log     enable row level security;
alter table inventory_current enable row level security;
create policy "Deny public reads on inventory_log"       on inventory_log     for select using (false);
create policy "Deny public inserts on inventory_log"     on inventory_log     for insert with check (false);
create policy "Deny public reads on inventory_current"   on inventory_current for select using (false);
create policy "Deny public inserts on inventory_current" on inventory_current for insert with check (false);
create policy "Deny public updates on inventory_current" on inventory_current for update using (false);

-- Atomically reserve stock for an order.
-- Locks the inventory_current row, checks availability, then inserts an order_out
-- log entry (which triggers the decrement via trg_update_inventory_current).
-- Raises an exception if stock is insufficient — caller should catch and reject the order.
create or replace function reserve_inventory(
  p_sku      text,
  p_quantity integer,
  p_order_id uuid
)
returns integer  -- returns remaining quantity after reservation
language plpgsql
as $$
declare
  v_current integer;
begin
  -- Lock row to prevent concurrent reservations from both seeing sufficient stock
  select quantity into v_current
  from inventory_current
  where sku = p_sku
  for update;

  if v_current is null then
    raise exception 'SKU % not found in inventory', p_sku;
  end if;

  if v_current < p_quantity then
    raise exception 'Insufficient stock for SKU %. Available: %, requested: %',
      p_sku, v_current, p_quantity;
  end if;

  -- Insert movement — trigger updates inventory_current automatically
  insert into inventory_log (sku, type, quantity, order_id)
  values (p_sku, 'order_out', p_quantity, p_order_id);

  return v_current - p_quantity;
end;
$$;

-- Restore stock when an order is cancelled.
-- No lock needed — adding stock back cannot cause overselling.
create or replace function restore_inventory(
  p_sku      text,
  p_quantity integer,
  p_order_id uuid
)
returns integer  -- returns quantity after restoration
language plpgsql
as $$
begin
  insert into inventory_log (sku, type, quantity, order_id)
  values (p_sku, 'cancellation', p_quantity, p_order_id);

  return (select quantity from inventory_current where sku = p_sku);
end;
$$;

-- ─── Seed data ────────────────────────────────────────────────────────────────
-- Uncomment and update quantities + batch details to reflect actual stock
-- before running on a fresh database. The trigger will populate inventory_current
-- automatically from these inserts.
--
-- insert into inventory_log (sku, type, quantity, batch_id, expiry_date, notes) values
--   ('EGO-DC-12',  'batch_in', 0, 'BATCH-001', '2026-12-31', 'Initial stock'),
--   ('EGO-WCR-12', 'batch_in', 0, 'BATCH-001', '2026-12-31', 'Initial stock'),
--   ('EGO-MIX-12', 'batch_in', 0, 'BATCH-001', '2026-12-31', 'Initial stock');


-- ─── Marketing Email System ──────────────────────────────────────────────────

-- Unsubscribe registry — keyed by email, not per-order.
-- A single unsubscribe covers all marketing emails for that address.
create table if not exists email_unsubscribes (
  email text primary key,
  unsubscribed_at timestamptz not null default now()
);

alter table email_unsubscribes enable row level security;
create policy "Deny all on email_unsubscribes" on email_unsubscribes
  for all using (false) with check (false);

-- Sent email log — one row per (order, email_type).
-- The unique constraint prevents duplicate sends.
-- Status lifecycle: pending → sending → sent / failed / skipped
create table if not exists marketing_email_log (
  id bigint generated always as identity primary key,
  order_id uuid not null references orders(id) on delete cascade,
  email_type text not null check (email_type in ('review_request', 'cross_sell')),
  email text not null,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  provider_message_id text,
  attempt_count integer not null default 0,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  error_message text,
  constraint uq_marketing_email_log unique (order_id, email_type)
);

create index if not exists idx_marketing_email_log_claimable
  on marketing_email_log (status) where status in ('pending', 'failed');

alter table marketing_email_log enable row level security;
create policy "Deny all on marketing_email_log" on marketing_email_log
  for all using (false) with check (false);

-- Index on orders for cron candidate queries
create index if not exists idx_orders_delivered_at
  on orders (delivered_at) where delivered_at is not null;

-- ─── claim_marketing_emails RPC ──────────────────────────────────────────────
-- Single function: find candidates → insert as pending → reclaim stale → claim
-- Returns only the rows this worker claimed (FOR UPDATE SKIP LOCKED).

create or replace function claim_marketing_emails(p_now timestamptz, p_limit integer default 50)
returns table (
  log_id bigint,
  order_id uuid,
  email text,
  first_name text,
  items jsonb,
  total_amount integer,
  payment_method text,
  email_type text,
  attempt_count integer
) language plpgsql as $$
begin
  -- Step 1: Reclaim stale sending rows (crashed workers)
  -- Uses claimed_at, not created_at — a row created yesterday but claimed 5s ago is NOT stale
  update marketing_email_log
  set status = 'failed', error_message = 'stale sending row reclaimed', claimed_at = null
  where status = 'sending'
    and claimed_at < p_now - interval '10 minutes';

  -- Step 2: Insert new candidates as pending (idempotent via ON CONFLICT)
  insert into marketing_email_log (order_id, email_type, email)
  select o.id, c.email_type, o.email
  from (
    -- Review request: delivered 3-4 days ago
    select o2.id as order_id, 'review_request'::text as email_type
    from orders o2
    where o2.status = 'delivered'
      and o2.marketing_consent = true
      and o2.delivered_at >= p_now - interval '4 days'
      and o2.delivered_at < p_now - interval '3 days'

    union all

    -- Cross-sell: delivered 10-11 days ago
    select o2.id as order_id, 'cross_sell'::text as email_type
    from orders o2
    where o2.status = 'delivered'
      and o2.marketing_consent = true
      and o2.delivered_at >= p_now - interval '11 days'
      and o2.delivered_at < p_now - interval '10 days'
  ) c
  join orders o on o.id = c.order_id
  where not exists (select 1 from email_unsubscribes u where u.email = lower(o.email))
  on conflict (order_id, email_type) do nothing;

  -- Step 3: Atomically claim rows (pending or retryable failed) → sending
  return query
  with claimed as (
    update marketing_email_log l
    set status = 'sending',
        attempt_count = l.attempt_count + 1,
        claimed_at = p_now,
        last_attempt_at = p_now
    where l.id in (
      select l2.id from marketing_email_log l2
      where l2.status in ('pending', 'failed')
        and (l2.status = 'pending' or l2.attempt_count < 3)
        -- re-check unsubscribe at claim time
        and not exists (select 1 from email_unsubscribes u where u.email = lower(l2.email))
      order by l2.created_at
      limit p_limit
      for update skip locked
    )
    returning l.*
  )
  select c.id, c.order_id, o.email, o.first_name, o.items, o.total_amount, o.payment_method,
         c.email_type, c.attempt_count
  from claimed c
  join orders o on o.id = c.order_id;
end;
$$;
