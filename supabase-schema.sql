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
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'shipped', 'delivered', 'cancelled')),
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

  -- Econt delivery (optional)
  econt_office_id integer,
  econt_office_name text,
  econt_office_address text,

  -- Speedy delivery (optional)
  speedy_office_id integer,
  speedy_office_name text,
  speedy_office_address text,

  -- Cancellation
  cancellation_reason text
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

-- Invoice numbering (sequential, gap-free — required by Bulgarian law)
create table if not exists invoice_counter (
  id integer primary key default 1 check (id = 1),
  current_number bigint not null default 0
);

insert into invoice_counter (id, current_number)
values (1, 0)
on conflict (id) do nothing;

create or replace function next_invoice_number()
returns bigint
language plpgsql
as $$
declare
  next_num bigint;
begin
  update invoice_counter
  set current_number = current_number + 1
  where id = 1
  returning current_number into next_num;
  return next_num;
end;
$$;

create index if not exists idx_orders_invoice_number on orders (invoice_number)
  where invoice_number is not null;

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
