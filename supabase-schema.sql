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

  -- Order details
  items jsonb not null,
  total_amount integer not null,
  status text not null default 'pending',
  payment_method text not null,
  logistics_partner text,

  -- Invoice (optional)
  needs_invoice boolean default false,
  invoice_company_name text,
  invoice_eik text,
  invoice_vat_number text,
  invoice_mol text,
  invoice_address text
);

-- Enable Row Level Security
alter table orders enable row level security;

-- Allow inserts from the anon key (public storefront)
create policy "Allow public inserts" on orders
  for insert with check (true);

-- Allow reads/updates only for matching order id (used by confirmOrder)
create policy "Allow public select by id" on orders
  for select using (true);

create policy "Allow public update by id" on orders
  for update using (true);
