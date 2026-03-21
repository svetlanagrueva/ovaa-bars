-- Product sales table for admin-managed promotions
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
  on product_sales (product_id)
  where is_active = true;

alter table product_sales enable row level security;
create policy "Deny public reads" on product_sales for select using (false);
create policy "Deny public inserts" on product_sales for insert with check (false);
create policy "Deny public updates" on product_sales for update using (false);
create policy "Deny public deletes" on product_sales for delete using (false);

-- Price history for EU Omnibus Directive compliance (lowest price in 30 days)
create table if not exists product_price_history (
  id uuid primary key default gen_random_uuid(),
  product_id text not null,
  price_in_cents integer not null,
  recorded_at timestamptz not null default now()
);

create index if not exists idx_price_history_lookup
  on product_price_history (product_id, recorded_at desc);

alter table product_price_history enable row level security;
create policy "Deny public reads" on product_price_history for select using (false);
create policy "Deny public inserts" on product_price_history for insert with check (false);
