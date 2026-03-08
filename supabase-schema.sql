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
  total_amount integer not null,
  status text not null default 'pending',
  payment_method text not null,
  logistics_partner text,
  stripe_session_id text unique,

  -- Invoice (optional)
  needs_invoice boolean default false,
  invoice_company_name text,
  invoice_eik text,
  invoice_vat_number text,
  invoice_mol text,
  invoice_address text,

  -- Econt delivery (optional)
  econt_office_id integer,
  econt_office_name text,
  econt_office_address text
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
