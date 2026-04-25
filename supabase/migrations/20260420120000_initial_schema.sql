-- ══════════════════════════════════════════════════════════════════════════
-- Initial schema for the Egg Origin e-commerce site (consolidated).
-- ══════════════════════════════════════════════════════════════════════════
--
-- This file replaces the 26 incremental migrations from the db-modifications
-- branch. The pre-launch DB had no real customer data so the migration
-- series was squashed into a single canonical schema before launch. The
-- pre-squash history lives in the merge commit on the squash PR (and in
-- branches that hold the original step-by-step migration files) for any
-- forensic look-back.
--
-- Layout:
--   1. Tables (in FK dependency order)
--   2. Indexes
--   3. CHECK constraints applied after table creation (for readability)
--   4. RLS + deny-all policies (service role bypasses)
--   5. Functions
--   6. Triggers
--
-- Idempotent DDL (`create table if not exists`, `create or replace function`,
-- etc.) so reruns on a partially-applied DB don't fail loudly.
-- ══════════════════════════════════════════════════════════════════════════


-- ── 1. TABLES ───────────────────────────────────────────────────────────────

-- ─── orders ─────────────────────────────────────────────────────────────────
-- Customer-facing orders. Refund data lives in the order_refunds child table
-- (added below). Items live in order_items (added below). EGN is never
-- collected; ЗДДС does not require it for individual retail invoices.
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
  total_amount integer not null check (total_amount > 0),
  shipping_fee integer not null default 0,
  cod_fee integer not null default 0,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'shipped', 'delivered', 'cancelled', 'expired')),
  tracking_number text,
  payment_method text not null check (payment_method in ('card', 'cod')),
  logistics_partner text,
  stripe_session_id text unique,
  stripe_payment_intent_id text,
  stripe_receipt_url text,
  order_confirmation_sent_at timestamptz,
  promo_code text,
  discount_amount integer not null default 0,
  confirmed_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,

  -- Invoice (no invoice_egn — see ЗДДС note above)
  needs_invoice boolean default false,
  invoice_type text check (invoice_type in ('individual', 'company')),
  invoice_company_name text,
  invoice_eik text,
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
  settlement_amount integer,        -- COD: actual amount received after courier commission, in cents

  -- COD pre-shipment phone confirmation
  cod_confirmed_at timestamptz,
  cod_confirmed_by text,

  -- Admin
  admin_notes jsonb not null default '[]',

  -- Delivery email tracking
  delivery_email_sent_at timestamptz,
  delivery_email_last_error text,

  -- Delivery status polling cursor
  delivery_status_checked_at timestamptz,

  -- Cancellation
  cancellation_reason text,

  -- Marketing consent (unchecked by default at checkout, required for soft opt-in under ЗЕС чл. 261)
  marketing_consent boolean not null default false
);

-- ─── order_items ────────────────────────────────────────────────────────────
-- Normalized line items. Replaced the earlier orders.items JSONB.
create table if not exists order_items (
  id                 bigint generated always as identity primary key,
  order_id           uuid not null references orders(id) on delete cascade,
  line_no            integer not null,
  product_id         text not null,
  sku                text not null,
  product_name       text not null,
  quantity           integer not null check (quantity > 0),
  unit_price_cents   integer not null check (unit_price_cents >= 0),
  cancelled_quantity integer not null default 0 check (cancelled_quantity >= 0 and cancelled_quantity <= quantity),
  created_at         timestamptz not null default now(),
  constraint uq_order_items_line_no unique (order_id, line_no),
  constraint chk_order_items_product_id_nonempty check (product_id <> ''),
  constraint chk_order_items_sku_nonempty check (sku <> ''),
  constraint chk_order_items_product_name_nonempty check (product_name <> '')
);

-- ─── product_sales ──────────────────────────────────────────────────────────
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

-- ─── product_price_history ──────────────────────────────────────────────────
-- For EU Omnibus Directive compliance (lowest price in last 30 days).
create table if not exists product_price_history (
  id uuid primary key default gen_random_uuid(),
  product_id text not null,
  price_in_cents integer not null,
  recorded_at timestamptz not null default now()
);

-- ─── promo_codes ────────────────────────────────────────────────────────────
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

-- ─── inventory_log ──────────────────────────────────────────────────────────
-- Append-only audit log of every inventory movement. quantity is always
-- positive; direction encoded in `type`. Mutations are blocked by triggers
-- (see "Triggers" section below).
--
-- type:
--   batch_in         — new stock added (has batch_id, expiry_date)
--   order_out        — stock consumed by a confirmed order (has order_id)
--   cancellation     — stock restored when an order is cancelled (has order_id)
--   wholesale_out    — B2B shipment (reference_type = 'invoice')
--   sample_out       — marketing samples, giveaways (reference_type = 'internal')
--   damaged          — write-off: opened returns, expired, physical damage
--   return_in        — customer return restocked, unopened only (reference_type = 'return')
--   adjustment_gain  — reconciliation: physical count > system (notes mandatory)
--   adjustment_loss  — reconciliation: physical count < system (notes mandatory)
--
-- idempotency_key: admin-supplied UUID per form submission for non-system
-- movements (batch_in, wholesale_out, sample_out, damaged, return_in,
-- adjustment_*). System movements (order_out, cancellation) leave it null.
-- Unique partial index enforces no duplicate admin submissions at the DB.
create table if not exists inventory_log (
  id              bigint generated always as identity primary key,
  sku             text not null,
  type            text not null check (type in (
                    'batch_in', 'order_out', 'cancellation',
                    'wholesale_out', 'sample_out', 'damaged',
                    'return_in', 'adjustment_gain', 'adjustment_loss'
                  )),
  quantity        integer not null check (quantity > 0),
  batch_id        text,
  expiry_date     date,
  order_id        uuid references orders(id) on delete set null,
  notes           text,
  reference_type  text check (reference_type in ('order', 'invoice', 'return', 'internal')),
  reference_id    text,
  created_by      text not null default 'system',
  location_id     text not null default 'MAIN',
  idempotency_key text,
  before_quantity integer,  -- snapshot before this movement (set by trigger)
  after_quantity  integer,  -- snapshot after this movement (set by trigger)
  created_at      timestamptz not null default now(),
  constraint chk_location_id_nonempty check (location_id <> ''),
  constraint chk_reference_id_nonempty check (reference_type is null or (reference_id is not null and reference_id <> '')),
  -- Type↔field requirements (defense-in-depth backstop for the server actions).
  constraint chk_inventory_log_batch_in check (
    type <> 'batch_in'
    or (batch_id is not null and btrim(batch_id) <> '' and expiry_date is not null)
  ),
  constraint chk_inventory_log_order_linked check (
    type not in ('order_out', 'cancellation') or order_id is not null
  ),
  constraint chk_inventory_log_wholesale_out check (
    type <> 'wholesale_out' or (reference_type = 'invoice' and reference_id is not null)
  ),
  constraint chk_inventory_log_return_in check (
    type <> 'return_in' or (reference_type = 'return' and reference_id is not null)
  ),
  constraint chk_inventory_log_sample_out check (
    type <> 'sample_out' or (reference_type = 'internal' and reference_id is not null)
  ),
  constraint chk_inventory_log_damaged check (
    type <> 'damaged'
    or (
      notes is not null and btrim(notes) <> ''
      and reference_type in ('internal', 'return')
      and reference_id is not null
    )
  ),
  constraint chk_inventory_log_adjustments check (
    type not in ('adjustment_gain', 'adjustment_loss')
    or (
      notes is not null and btrim(notes) <> ''
      and reference_type = 'internal'
      and reference_id is not null
    )
  )
);

-- ─── inventory_current ──────────────────────────────────────────────────────
-- Trigger-maintained running total per SKU. Read this for real-time stock
-- checks; never aggregate inventory_log directly.
create table if not exists inventory_current (
  sku        text primary key,
  quantity   integer not null default 0,
  updated_at timestamptz not null default now()
);

-- ─── order_audit_events ─────────────────────────────────────────────────────
-- Unified append-only event log for orders. Populated by:
--   - emit_order_audit_events trigger (column-diff events on orders UPDATE)
--   - emit_order_refund_audit trigger (refunded events from order_refunds INSERT)
--   - emit_order_refund_annotation_audit trigger (annotation edits)
--   - record_order_outcome RPC (admin-driven domain events + Stripe webhooks)
-- Mutations blocked by triggers below.
create table if not exists order_audit_events (
  id          bigint generated always as identity primary key,
  order_id    uuid not null references orders(id),
  event_type  text not null,
  actor       text not null default 'admin',
  payload     jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  constraint chk_order_audit_event_type_nonempty check (event_type <> ''),
  constraint chk_order_audit_actor_nonempty check (actor <> '')
);

-- ─── order_refunds ──────────────────────────────────────────────────────────
-- Child table — many refunds per order. stripe_refund_id is the natural
-- idempotency key for webhook arrivals; client_idempotency_key for admin-UI
-- submissions. Append-only for financial fields (only reason / credit_note_ref
-- are mutable via updateRefundAnnotation).
create table if not exists order_refunds (
  id                       uuid        primary key default gen_random_uuid(),
  order_id                 uuid        not null references orders(id) on delete cascade,
  stripe_refund_id         text,
  client_idempotency_key   uuid,
  amount_cents             integer     not null check (amount_cents > 0),
  method                   text        not null check (method in ('stripe', 'bank_transfer')),
  source                   text        not null check (source in ('admin_ui', 'stripe_webhook')),
  reason                   text,
  credit_note_ref          text,
  recorded_by              text        not null default 'admin',
  refunded_at              timestamptz not null default now(),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint chk_stripe_method_has_refund_id
    check (method <> 'stripe' or stripe_refund_id is not null),
  constraint chk_refund_reason_length
    check (reason is null or length(reason) <= 1000),
  constraint chk_refund_credit_note_length
    check (credit_note_ref is null or length(credit_note_ref) <= 100)
);

-- ─── email_unsubscribes ─────────────────────────────────────────────────────
-- Single unsubscribe covers all marketing emails for that address.
create table if not exists email_unsubscribes (
  email text primary key,
  unsubscribed_at timestamptz not null default now()
);

-- ─── marketing_email_log ────────────────────────────────────────────────────
-- One row per (order, email_type). Status: pending → sending → sent / failed / skipped.
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

-- ─── complaints ─────────────────────────────────────────────────────────────
-- Formal complaints register (ЗЗП чл. 127). complaint_ref auto-generated as
-- RCL-YYYY-NNNN via a sequence (server-side composes the format).
create sequence if not exists complaint_ref_seq start 1;

create table if not exists complaints (
  id                  bigint generated always as identity primary key,
  order_id            uuid not null references orders(id),
  complaint_ref       text not null unique,
  reported_at         timestamptz not null default now(),
  defect_description  text not null,
  customer_demand     text not null check (customer_demand in ('refund', 'replacement', 'repair', 'discount')),
  status              text not null default 'open' check (status in ('open', 'resolved', 'rejected')),
  resolution          text,
  resolved_at         timestamptz,
  created_by          text not null,
  created_at          timestamptz not null default now(),
  constraint chk_defect_nonempty check (defect_description <> ''),
  constraint chk_created_by_nonempty check (created_by <> ''),
  constraint chk_resolved_status check (resolved_at is null or status in ('resolved', 'rejected'))
);


-- ── 2. INDEXES ──────────────────────────────────────────────────────────────

-- orders
create index if not exists idx_orders_invoice_number on orders (invoice_number)
  where invoice_number is not null;
create index if not exists idx_orders_status on orders (status);
create unique index if not exists idx_orders_tracking_number_unique
  on orders (tracking_number) where tracking_number is not null and tracking_number != '__generating__';
create index if not exists idx_orders_created_at on orders (created_at desc);
create index if not exists idx_orders_needs_invoice on orders (needs_invoice)
  where needs_invoice = true and invoice_number is null;
create index if not exists idx_orders_delivered_at
  on orders (delivered_at) where delivered_at is not null;

-- order_items
create index if not exists idx_order_items_order_id on order_items (order_id);
create index if not exists idx_order_items_sku on order_items (sku);

-- product_sales — at most one active sale per product
create unique index if not exists idx_product_sales_one_active
  on product_sales (product_id) where is_active = true;

-- product_price_history
create index if not exists idx_price_history_lookup
  on product_price_history (product_id, recorded_at desc);

-- promo_codes — at most one active code per uppercase value
create unique index if not exists idx_promo_codes_unique_active
  on promo_codes (upper(code)) where is_active = true;

-- inventory_log
create index if not exists idx_inventory_log_sku        on inventory_log (sku);
create index if not exists idx_inventory_log_created_at on inventory_log (created_at desc);
create index if not exists idx_inventory_log_order_id   on inventory_log (order_id) where order_id is not null;
create unique index if not exists idx_inventory_log_idempotency_key_unique
  on inventory_log (idempotency_key) where idempotency_key is not null;

-- order_audit_events
create index if not exists idx_order_audit_events_order_id on order_audit_events (order_id, created_at);
create index if not exists idx_order_audit_events_event_type on order_audit_events (event_type);

-- order_refunds
create unique index if not exists idx_order_refunds_stripe_id
  on order_refunds (stripe_refund_id) where stripe_refund_id is not null;
create unique index if not exists idx_order_refunds_client_idempotency_unique
  on order_refunds (client_idempotency_key) where client_idempotency_key is not null;
create index if not exists idx_order_refunds_order_id on order_refunds (order_id, refunded_at desc);

-- marketing_email_log
create index if not exists idx_marketing_email_log_claimable
  on marketing_email_log (status) where status in ('pending', 'failed');

-- complaints
create index if not exists idx_complaints_order_id on complaints (order_id);
create index if not exists idx_complaints_status on complaints (status) where status = 'open';


-- ── 3. CHECK CONSTRAINTS ON ORDERS ──────────────────────────────────────────

-- Email lowercase (aligns orders.email with email_unsubscribes keying)
alter table orders add constraint chk_orders_email_lowercase
  check (email = lower(email));

-- COD surcharge belongs only on COD orders (one-way: card MUST have cod_fee=0)
alter table orders add constraint chk_cod_fee_implies_cod
  check (cod_fee = 0 or payment_method = 'cod');

-- Timestamp monotonicity invariants
alter table orders add constraint chk_shipped_after_confirmed
  check (
    shipped_at is null
    or (confirmed_at is not null and shipped_at >= confirmed_at)
  );
alter table orders add constraint chk_delivered_after_shipped
  check (
    delivered_at is null
    or (shipped_at is not null and delivered_at >= shipped_at - interval '1 hour')
  );

-- Delivery mode consistency
-- econt-address is deliberately excluded — not a supported delivery option.
alter table orders add constraint chk_logistics_partner_enum
  check (
    logistics_partner is null
    or logistics_partner in ('econt-office', 'speedy-office', 'speedy-address')
  );
alter table orders add constraint chk_delivery_fields_consistent check (
  logistics_partner is null
  or (
    logistics_partner = 'econt-office'
    and econt_office_id is not null
    and econt_office_code is not null
    and econt_office_name is not null
    and econt_office_address is not null
    and speedy_office_id is null
    and speedy_office_name is null
    and speedy_office_address is null
  )
  or (
    logistics_partner = 'speedy-office'
    and speedy_office_id is not null
    and speedy_office_name is not null
    and speedy_office_address is not null
    and econt_office_id is null
    and econt_office_code is null
    and econt_office_name is null
    and econt_office_address is null
  )
  or (
    logistics_partner = 'speedy-address'
    and address is not null and address <> ''
    and postal_code is not null and postal_code <> ''
    and econt_office_id is null
    and econt_office_code is null
    and econt_office_name is null
    and econt_office_address is null
    and speedy_office_id is null
    and speedy_office_name is null
    and speedy_office_address is null
  )
);

-- Invoice mode consistency
-- needs_invoice=true requires invoice_type, mol, address.
alter table orders add constraint chk_invoice_needs_fields check (
  needs_invoice = false
  or (
    invoice_type is not null
    and invoice_mol is not null and btrim(invoice_mol) <> ''
    and invoice_address is not null and btrim(invoice_address) <> ''
  )
);
-- Company invoices require EIK + company name. (No EGN — column doesn't exist.)
alter table orders add constraint chk_invoice_company_fields check (
  needs_invoice = false
  or invoice_type <> 'company'
  or (
    invoice_company_name is not null and btrim(invoice_company_name) <> ''
    and invoice_eik is not null and btrim(invoice_eik) <> ''
  )
);
-- Individual invoices must NOT carry company-only identifiers.
alter table orders add constraint chk_invoice_individual_fields check (
  needs_invoice = false
  or invoice_type <> 'individual'
  or (
    invoice_eik is null
    and invoice_vat_number is null
    and invoice_company_name is null
  )
);
-- needs_invoice=false → profile fields cleared. invoice_number / _date /
-- _sent_at are intentionally NOT in this list — those are admin-controlled
-- (issued in Microinvest, recorded against any order regardless of original
-- consent), and orthogonal to checkout-time profile capture.
alter table orders add constraint chk_invoice_fields_cleared check (
  needs_invoice = true
  or (
    invoice_type is null
    and invoice_company_name is null
    and invoice_eik is null
    and invoice_vat_number is null
    and invoice_mol is null
    and invoice_address is null
  )
);


-- ── 4. RLS + POLICIES ───────────────────────────────────────────────────────
-- Server actions use SUPABASE_SERVICE_ROLE_KEY which bypasses RLS. The anon
-- key (used from the browser) is denied everything by these policies.
alter table orders                enable row level security;
alter table order_items           enable row level security;
alter table product_sales         enable row level security;
alter table product_price_history enable row level security;
alter table promo_codes           enable row level security;
alter table inventory_log         enable row level security;
alter table inventory_current     enable row level security;
alter table order_audit_events    enable row level security;
alter table order_refunds         enable row level security;
alter table email_unsubscribes    enable row level security;
alter table marketing_email_log   enable row level security;
alter table complaints            enable row level security;

create policy "Deny public reads" on orders for select using (false);
create policy "Deny public updates" on orders for update using (false);
create policy "Deny public inserts" on orders for insert with check (false);
create policy "Deny public deletes" on orders for delete using (false);

create policy "Deny all on order_items" on order_items
  for all using (false) with check (false);

create policy "Deny public reads on sales" on product_sales for select using (false);
create policy "Deny public inserts on sales" on product_sales for insert with check (false);
create policy "Deny public updates on sales" on product_sales for update using (false);
create policy "Deny public deletes on sales" on product_sales for delete using (false);

create policy "Deny public reads on price history" on product_price_history for select using (false);
create policy "Deny public inserts on price history" on product_price_history for insert with check (false);

create policy "Deny public reads on promo codes" on promo_codes for select using (false);
create policy "Deny public inserts on promo codes" on promo_codes for insert with check (false);
create policy "Deny public updates on promo codes" on promo_codes for update using (false);
create policy "Deny public deletes on promo codes" on promo_codes for delete using (false);

create policy "Deny public reads on inventory_log"       on inventory_log     for select using (false);
create policy "Deny public inserts on inventory_log"     on inventory_log     for insert with check (false);
create policy "Deny public reads on inventory_current"   on inventory_current for select using (false);
create policy "Deny public inserts on inventory_current" on inventory_current for insert with check (false);
create policy "Deny public updates on inventory_current" on inventory_current for update using (false);

create policy "Deny all on order_audit_events" on order_audit_events
  for all using (false) with check (false);

create policy "Deny all on order_refunds" on order_refunds
  for all using (false) with check (false);

create policy "Deny all on email_unsubscribes" on email_unsubscribes
  for all using (false) with check (false);

create policy "Deny all on marketing_email_log" on marketing_email_log
  for all using (false) with check (false);

create policy "Deny all on complaints" on complaints
  for all using (false) with check (false);


-- ── 5. FUNCTIONS ────────────────────────────────────────────────────────────

-- ─── Inventory: update_inventory_current ────────────────────────────────────
-- BEFORE INSERT trigger function. Sets NEW.before_quantity / .after_quantity
-- so a single INSERT writes the complete log row (no second UPDATE — that
-- preserves inventory_log immutability with no service-role bypass).
-- order_out is hard-blocked from going negative; admin decrements may go
-- negative (operational debt, surfaced as red "Дълг" badge in the admin UI).
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

-- ─── Inventory: append-only enforcement ─────────────────────────────────────
create or replace function raise_inventory_log_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'inventory_log is append-only; % is not permitted', tg_op;
end;
$$;

-- ─── Inventory: reserve_inventory ───────────────────────────────────────────
-- Atomically decrement stock for an order. Locks the inventory_current row,
-- checks availability, then inserts an order_out log entry. Raises on
-- insufficient stock — caller catches and rejects the order.
create or replace function reserve_inventory(
  p_sku      text,
  p_quantity integer,
  p_order_id uuid
)
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_current integer;
begin
  select quantity into v_current
  from public.inventory_current
  where sku = p_sku
  for update;

  if v_current is null then
    raise exception 'SKU % not found in inventory', p_sku;
  end if;

  if v_current < p_quantity then
    raise exception 'Insufficient stock for SKU %. Available: %, requested: %',
      p_sku, v_current, p_quantity;
  end if;

  insert into public.inventory_log (sku, type, quantity, order_id)
  values (p_sku, 'order_out', p_quantity, p_order_id);

  return v_current - p_quantity;
end;
$$;

-- ─── Inventory: restore_inventory ───────────────────────────────────────────
-- Sum-based guard: sum(cancellation) + p_quantity must not exceed
-- sum(order_out) for (sku, order_id). Allows multiple cancellation rows per
-- (sku, order_id) — supports partial cancellation and admin quantity edits.
create or replace function restore_inventory(
  p_sku      text,
  p_quantity integer,
  p_order_id uuid
)
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_reserved integer;
  v_already_restored integer;
begin
  perform 1 from public.inventory_current where sku = p_sku for update;

  select coalesce(sum(quantity), 0) into v_reserved
  from public.inventory_log
  where sku = p_sku and order_id = p_order_id and type = 'order_out';

  if v_reserved = 0 then
    raise exception 'No reservation found for SKU % on order %', p_sku, p_order_id;
  end if;

  select coalesce(sum(quantity), 0) into v_already_restored
  from public.inventory_log
  where sku = p_sku and order_id = p_order_id and type = 'cancellation';

  if v_already_restored + p_quantity > v_reserved then
    raise exception 'Restore quantity % plus already-restored % would exceed reserved % for SKU % on order %',
      p_quantity, v_already_restored, v_reserved, p_sku, p_order_id;
  end if;

  insert into public.inventory_log (sku, type, quantity, order_id)
  values (p_sku, 'cancellation', p_quantity, p_order_id);

  return (select quantity from public.inventory_current where sku = p_sku);
end;
$$;

-- ─── Inventory: enforce_order_return_cap ────────────────────────────────────
-- BEFORE INSERT guard: physical returns and return-related write-offs must
-- not exceed shipped quantity per (order_id, sku). Narrowly scoped — only
-- fires for return_in / damaged with reference_type='return' AND order_id
-- set. Warehouse-internal damage and per-SKU adjustments are NOT capped.
create or replace function enforce_order_return_cap()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_shipped integer;
  v_prior_returns integer;
begin
  if new.order_id is null
     or new.reference_type is distinct from 'return'
     or new.type not in ('return_in', 'damaged') then
    return new;
  end if;

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

-- ─── Orders: emit_order_audit_events ────────────────────────────────────────
-- AFTER UPDATE diff trigger. Emits one event per detected column change in
-- the audited whitelist. status_changed is suppressed during force-status-
-- override transactions (the RPC writes a richer status_force_override event).
-- contact_info_changed bundles all per-field {old,new} pairs into ONE event
-- with jsonb_strip_nulls dropping unchanged-field keys.
create or replace function emit_order_audit_events()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_actor text := coalesce(current_setting('app.actor', true), 'admin');
  v_override_bypass text := current_setting('app.allow_status_override', true);
  v_contact_payload jsonb;
begin
  if old.status is distinct from new.status then
    if coalesce(v_override_bypass, '') <> 'true' then
      insert into public.order_audit_events (order_id, event_type, actor, payload)
      values (new.id, 'status_changed', v_actor,
        jsonb_build_object('from', old.status, 'to', new.status));
    end if;
  end if;

  if old.invoice_number is distinct from new.invoice_number
     and new.invoice_number is not null then
    insert into public.order_audit_events (order_id, event_type, actor, payload)
    values (new.id, 'invoice_number_set', v_actor,
      jsonb_build_object(
        'invoice_number', new.invoice_number,
        'invoice_date', new.invoice_date
      ));
  end if;

  if old.invoice_sent_at is distinct from new.invoice_sent_at
     and new.invoice_sent_at is not null then
    insert into public.order_audit_events (order_id, event_type, actor, payload)
    values (new.id, 'invoice_marked_sent', v_actor,
      jsonb_build_object('invoice_sent_at', new.invoice_sent_at));
  end if;

  if old.paid_at is distinct from new.paid_at and new.paid_at is not null then
    insert into public.order_audit_events (order_id, event_type, actor, payload)
    values (new.id, 'paid_at_recorded', v_actor,
      jsonb_build_object(
        'paid_at', new.paid_at,
        'payment_method', new.payment_method,
        'courier_ppp_ref', new.courier_ppp_ref,
        'settlement_ref', new.settlement_ref,
        'settlement_amount', new.settlement_amount
      ));
  end if;

  if old.shipped_at is distinct from new.shipped_at and new.shipped_at is not null then
    insert into public.order_audit_events (order_id, event_type, actor, payload)
    values (new.id, 'shipped_at_recorded', v_actor,
      jsonb_build_object(
        'shipped_at', new.shipped_at,
        'tracking_number', new.tracking_number,
        'logistics_partner', new.logistics_partner
      ));
  end if;

  if old.delivered_at is distinct from new.delivered_at
     and new.delivered_at is not null then
    insert into public.order_audit_events (order_id, event_type, actor, payload)
    values (new.id, 'delivered_at_recorded', v_actor,
      jsonb_build_object('delivered_at', new.delivered_at));
  end if;

  if old.cancelled_at is distinct from new.cancelled_at
     and new.cancelled_at is not null then
    insert into public.order_audit_events (order_id, event_type, actor, payload)
    values (new.id, 'cancelled', v_actor,
      jsonb_build_object(
        'cancelled_at', new.cancelled_at,
        'reason', new.cancellation_reason
      ));
  end if;

  if old.tracking_number is distinct from new.tracking_number
     and new.tracking_number is not null
     and new.tracking_number <> '__generating__' then
    insert into public.order_audit_events (order_id, event_type, actor, payload)
    values (new.id, 'tracking_number_set', v_actor,
      jsonb_build_object('tracking_number', new.tracking_number));
  end if;

  if old.cod_confirmed_at is distinct from new.cod_confirmed_at
     and new.cod_confirmed_at is not null then
    insert into public.order_audit_events (order_id, event_type, actor, payload)
    values (new.id, 'cod_confirmed', v_actor,
      jsonb_build_object(
        'cod_confirmed_at', new.cod_confirmed_at,
        'confirmed_by', new.cod_confirmed_by
      ));
  end if;

  if old.first_name is distinct from new.first_name
     or old.last_name is distinct from new.last_name
     or old.phone is distinct from new.phone
     or old.email is distinct from new.email
     or old.address is distinct from new.address
     or old.postal_code is distinct from new.postal_code
     or old.city is distinct from new.city
     or old.notes is distinct from new.notes then
    v_contact_payload := jsonb_strip_nulls(jsonb_build_object(
      'first_name',  case when old.first_name is distinct from new.first_name
        then jsonb_build_object('old', old.first_name, 'new', new.first_name) else null end,
      'last_name',   case when old.last_name is distinct from new.last_name
        then jsonb_build_object('old', old.last_name, 'new', new.last_name) else null end,
      'phone',       case when old.phone is distinct from new.phone
        then jsonb_build_object('old', old.phone, 'new', new.phone) else null end,
      'email',       case when old.email is distinct from new.email
        then jsonb_build_object('old', old.email, 'new', new.email) else null end,
      'address',     case when old.address is distinct from new.address
        then jsonb_build_object('old', old.address, 'new', new.address) else null end,
      'postal_code', case when old.postal_code is distinct from new.postal_code
        then jsonb_build_object('old', old.postal_code, 'new', new.postal_code) else null end,
      'city',        case when old.city is distinct from new.city
        then jsonb_build_object('old', old.city, 'new', new.city) else null end,
      'notes',       case when old.notes is distinct from new.notes
        then jsonb_build_object('old', old.notes, 'new', new.notes) else null end
    ));

    insert into public.order_audit_events (order_id, event_type, actor, payload)
    values (new.id, 'contact_info_changed', v_actor, v_contact_payload);
  end if;

  return new;
end;
$$;

-- ─── Orders: append-only enforcement on order_audit_events ──────────────────
create or replace function raise_order_audit_events_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'order_audit_events is append-only; % is not permitted', tg_op;
end;
$$;

-- ─── Orders: record_order_outcome RPC ───────────────────────────────────────
-- Explicit calls for domain events that aren't column diffs. Allow-list
-- enforced — adding a new outcome type requires a migration to extend it.
create or replace function record_order_outcome(
  p_order_id uuid,
  p_outcome_type text,
  p_payload jsonb default '{}',
  p_actor text default 'admin'
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if p_outcome_type not in (
    'delivery_refused',
    'package_lost',
    'returned',
    'recalled',
    'partial_return',
    'status_force_override',
    'data_repair',
    'external_refund',
    'payment_failed',
    'dispute_opened',
    'dispute_closed',
    'dispute_funds_reinstated',
    'order_items_changed',
    'email_resent'
  ) then
    raise exception 'Unknown outcome type: %', p_outcome_type;
  end if;

  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'actor is required';
  end if;

  insert into public.order_audit_events (order_id, event_type, actor, payload)
  values (p_order_id, p_outcome_type, p_actor, p_payload);
end;
$$;

-- ─── Orders: state-machine trigger ──────────────────────────────────────────
-- BEFORE UPDATE on orders. Fires only when status actually changes. Bypass
-- via current_setting('app.allow_status_override', true) = 'true' (set
-- transaction-locally by force_status_override RPC).
create or replace function enforce_order_status_transition()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_bypass text := current_setting('app.allow_status_override', true);
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  if v_bypass = 'true' then
    return new;
  end if;

  if not (
    (old.status = 'pending'   and new.status in ('confirmed', 'expired', 'cancelled'))
    or (old.status = 'confirmed' and new.status in ('shipped', 'cancelled'))
    or (old.status = 'shipped'   and new.status = 'delivered')
  ) then
    raise exception 'Illegal order status transition: % → %. Use force_status_override for data repair.',
      old.status, new.status;
  end if;

  return new;
end;
$$;

-- ─── Orders: force_status_override RPC ──────────────────────────────────────
-- Data-repair path. Audited (≥20-char reason required) before the bypass.
create or replace function force_status_override(
  p_order_id uuid,
  p_new_status text,
  p_reason text,
  p_actor text default 'admin'
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_old_status text;
begin
  if p_new_status not in ('pending', 'confirmed', 'shipped', 'delivered', 'cancelled', 'expired') then
    raise exception 'Invalid status: %', p_new_status;
  end if;

  if p_reason is null or length(btrim(p_reason)) < 20 then
    raise exception 'force_status_override requires a reason of at least 20 characters explaining the repair';
  end if;

  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'actor is required';
  end if;

  select status into v_old_status from public.orders where id = p_order_id;
  if v_old_status is null then
    raise exception 'Order % not found', p_order_id;
  end if;

  -- Audit BEFORE update so a failed insert aborts the repair pre-state-change.
  insert into public.order_audit_events (order_id, event_type, actor, payload)
  values (
    p_order_id,
    'status_force_override',
    p_actor,
    jsonb_build_object(
      'from', v_old_status,
      'to', p_new_status,
      'reason', p_reason
    )
  );

  perform set_config('app.allow_status_override', 'true', true);

  update public.orders
  set status = p_new_status
  where id = p_order_id;

  perform set_config('app.allow_status_override', 'false', true);
end;
$$;

-- ─── Orders: add_admin_note RPC ─────────────────────────────────────────────
-- Atomic JSONB append. Replaces a prior fetch-modify-update pattern that
-- silently dropped concurrent notes. Row-level lock serializes appenders.
create or replace function add_admin_note(
  p_order_id uuid,
  p_text text,
  p_author text default 'admin'
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_trimmed text := btrim(coalesce(p_text, ''));
begin
  if v_trimmed = '' then
    raise exception 'admin note text is required';
  end if;
  if length(v_trimmed) > 2000 then
    raise exception 'admin note exceeds 2000 character limit';
  end if;
  if p_author is null or btrim(p_author) = '' then
    raise exception 'author is required';
  end if;

  update public.orders
  set admin_notes = admin_notes || jsonb_build_object(
    'text', v_trimmed,
    'created_at', now(),
    'author', p_author
  )
  where id = p_order_id;

  if not found then
    raise exception 'Order % not found', p_order_id;
  end if;
end;
$$;

-- ─── Orders: edit_order_quantity RPC ────────────────────────────────────────
-- Atomic per-SKU quantity edit. FOR UPDATE on order_items, calls reserve /
-- restore_inventory for the delta, updates order_items.quantity and
-- orders.total_amount in one transaction. Fee structure (shipping_fee,
-- cod_fee, discount_amount) stays frozen — admin must cancel + reorder if
-- fees need recomputing.
create or replace function edit_order_quantity(
  p_order_id uuid,
  p_sku      text,
  p_new_quantity integer
)
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_current_qty integer;
  v_unit_price  integer;
  v_items_subtotal integer;
  v_shipping_fee integer;
  v_cod_fee integer;
  v_discount integer;
  v_new_total integer;
begin
  if p_new_quantity is null or p_new_quantity < 1 then
    raise exception 'Quantity must be a positive integer';
  end if;

  select quantity, unit_price_cents
    into v_current_qty, v_unit_price
    from public.order_items
    where order_id = p_order_id and sku = p_sku
    for update;

  if v_current_qty is null then
    raise exception 'SKU % not found on order %', p_sku, p_order_id;
  end if;

  if v_current_qty = p_new_quantity then
    select total_amount into v_new_total from public.orders where id = p_order_id;
    return v_new_total;
  end if;

  if p_new_quantity > v_current_qty then
    perform public.reserve_inventory(p_sku, p_new_quantity - v_current_qty, p_order_id);
  else
    perform public.restore_inventory(p_sku, v_current_qty - p_new_quantity, p_order_id);
  end if;

  update public.order_items
    set quantity = p_new_quantity
    where order_id = p_order_id and sku = p_sku;

  select coalesce(sum(quantity * unit_price_cents), 0)
    into v_items_subtotal
    from public.order_items
    where order_id = p_order_id;

  select shipping_fee, cod_fee, discount_amount
    into v_shipping_fee, v_cod_fee, v_discount
    from public.orders
    where id = p_order_id;

  v_new_total := v_items_subtotal
    + coalesce(v_shipping_fee, 0)
    + coalesce(v_cod_fee, 0)
    - coalesce(v_discount, 0);

  if v_new_total < 1 then
    v_new_total := 1;
  end if;

  update public.orders
    set total_amount = v_new_total
    where id = p_order_id;

  return v_new_total;
end;
$$;

-- ─── Orders: confirm_delivery RPC ───────────────────────────────────────────
-- Atomic delivered-status update. Idempotent — guard on status='shipped'.
create or replace function confirm_delivery(p_order_id uuid, p_delivered_at timestamptz)
returns setof orders
language sql
set search_path = public, pg_temp
as $$
  update public.orders
  set status = 'delivered', delivered_at = p_delivered_at
  where id = p_order_id and status = 'shipped'
  returning *;
$$;

-- ─── Orders: dashboard_stats RPC ────────────────────────────────────────────
create or replace function dashboard_stats(
  p_today_start timestamptz,
  p_week_start timestamptz,
  p_month_start timestamptz
)
returns json
language plpgsql
set search_path = public, pg_temp
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
    'invoices_awaiting', (select count(*) from orders where needs_invoice = true and invoice_number is null and status != 'cancelled'),
    'awaiting_settlement', (select count(*) from orders where payment_method = 'cod' and delivered_at is not null and paid_at is null and status = 'delivered'),
    'inventory_debt_skus', (select count(*) from inventory_current where quantity < 0)
  ) into result
  from orders
  where created_at >= p_month_start and status != 'cancelled';

  return result;
end;
$$;

-- ─── Refunds: enforce_refund_total trigger function ─────────────────────────
-- Locks orders row to serialize concurrent inserts. Sums existing refunds
-- (excluding self on UPDATE) and rejects when sum + new exceeds total.
create or replace function enforce_refund_total()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_order_total integer;
  v_already_refunded integer;
begin
  select total_amount into v_order_total
  from public.orders
  where id = new.order_id
  for update;

  if v_order_total is null then
    raise exception 'Order % not found', new.order_id;
  end if;

  select coalesce(sum(amount_cents), 0) into v_already_refunded
  from public.order_refunds
  where order_id = new.order_id
    and id <> new.id;

  if v_already_refunded + new.amount_cents > v_order_total then
    raise exception 'Total refunds (% existing + % new = %) would exceed order total %',
      v_already_refunded, new.amount_cents,
      v_already_refunded + new.amount_cents, v_order_total;
  end if;

  return new;
end;
$$;

-- ─── Refunds: maintain updated_at ───────────────────────────────────────────
create or replace function set_order_refunds_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ─── Refunds: emit 'refunded' event on INSERT ───────────────────────────────
create or replace function emit_order_refund_audit()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_actor text := coalesce(current_setting('app.actor', true), new.recorded_by);
begin
  insert into public.order_audit_events (order_id, event_type, actor, payload)
  values (new.order_id, 'refunded', v_actor,
    jsonb_build_object(
      'refund_id',        new.id,
      'amount_cents',     new.amount_cents,
      'method',           new.method,
      'source',           new.source,
      'stripe_refund_id', new.stripe_refund_id,
      'reason',           new.reason,
      'credit_note_ref',  new.credit_note_ref
    ));
  return new;
end;
$$;

-- ─── Refunds: emit 'refund_annotation_edited' on UPDATE ─────────────────────
-- Early-returns on no-op UPDATEs (auto-bumped updated_at alone isn't worth
-- auditing). Per-field {old, new} payload via jsonb_strip_nulls.
create or replace function emit_order_refund_annotation_audit()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_actor text := coalesce(current_setting('app.actor', true), new.recorded_by);
begin
  if old.reason is not distinct from new.reason
     and old.credit_note_ref is not distinct from new.credit_note_ref then
    return new;
  end if;

  insert into public.order_audit_events (order_id, event_type, actor, payload)
  values (
    new.order_id,
    'refund_annotation_edited',
    v_actor,
    jsonb_strip_nulls(jsonb_build_object(
      'refund_id', new.id,
      'reason', case
        when old.reason is distinct from new.reason
          then jsonb_build_object('old', old.reason, 'new', new.reason)
        else null
      end,
      'credit_note_ref', case
        when old.credit_note_ref is distinct from new.credit_note_ref
          then jsonb_build_object('old', old.credit_note_ref, 'new', new.credit_note_ref)
        else null
      end
    ))
  );
  return new;
end;
$$;

-- ─── Refunds: append-only enforcement ───────────────────────────────────────
-- UPDATE allowed only for reason / credit_note_ref / updated_at. DELETE never.
create or replace function enforce_order_refunds_append_only_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.id is distinct from new.id
     or old.order_id is distinct from new.order_id
     or old.stripe_refund_id is distinct from new.stripe_refund_id
     or old.client_idempotency_key is distinct from new.client_idempotency_key
     or old.amount_cents is distinct from new.amount_cents
     or old.method is distinct from new.method
     or old.source is distinct from new.source
     or old.recorded_by is distinct from new.recorded_by
     or old.refunded_at is distinct from new.refunded_at
     or old.created_at is distinct from new.created_at then
    raise exception 'order_refunds financial fields are immutable; only reason and credit_note_ref may be edited (via updateRefundAnnotation)';
  end if;
  return new;
end;
$$;

create or replace function raise_order_refunds_immutable_delete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'order_refunds is append-only; DELETE is not permitted. To correct a mistake, create a reversing refund (phase 2) or apply a manual data repair.';
end;
$$;

-- ─── Marketing: claim_marketing_emails RPC ──────────────────────────────────
-- Single function: reclaim stale → insert candidates → claim work. Items
-- payload is reconstructed from order_items via jsonb_agg so the cron's
-- email helpers see the same shape they did before order_items normalization.
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
) language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Step 1: Reclaim stale sending rows (crashed workers)
  update public.marketing_email_log
  set status = 'failed', error_message = 'stale sending row reclaimed', claimed_at = null
  where status = 'sending'
    and claimed_at < p_now - interval '10 minutes';

  -- Step 2: Insert new candidates as pending (idempotent via ON CONFLICT)
  insert into public.marketing_email_log (order_id, email_type, email)
  select o.id, c.email_type, o.email
  from (
    select o2.id as order_id, 'review_request'::text as email_type
    from public.orders o2
    where o2.status = 'delivered'
      and o2.marketing_consent = true
      and o2.delivered_at >= p_now - interval '4 days'
      and o2.delivered_at < p_now - interval '3 days'

    union all

    select o2.id as order_id, 'cross_sell'::text as email_type
    from public.orders o2
    where o2.status = 'delivered'
      and o2.marketing_consent = true
      and o2.delivered_at >= p_now - interval '11 days'
      and o2.delivered_at < p_now - interval '10 days'
  ) c
  join public.orders o on o.id = c.order_id
  where not exists (select 1 from public.email_unsubscribes u where u.email = lower(o.email))
  on conflict (order_id, email_type) do nothing;

  -- Step 3: Atomically claim rows → sending
  return query
  with claimed as (
    update public.marketing_email_log l
    set status = 'sending',
        attempt_count = l.attempt_count + 1,
        claimed_at = p_now,
        last_attempt_at = p_now
    where l.id in (
      select l2.id from public.marketing_email_log l2
      where l2.status in ('pending', 'failed')
        and (l2.status = 'pending' or l2.attempt_count < 3)
        and not exists (select 1 from public.email_unsubscribes u where u.email = lower(l2.email))
      order by l2.created_at
      limit p_limit
      for update skip locked
    )
    returning l.*
  )
  select c.id,
         c.order_id,
         o.email,
         o.first_name,
         coalesce(
           (select jsonb_agg(
                    jsonb_build_object(
                      'productId',     oi.product_id,
                      'productName',   oi.product_name,
                      'quantity',      oi.quantity,
                      'priceInCents',  oi.unit_price_cents
                    )
                    order by oi.line_no
                  )
            from public.order_items oi
            where oi.order_id = o.id),
           '[]'::jsonb
         ) as items,
         o.total_amount,
         o.payment_method,
         c.email_type,
         c.attempt_count
  from claimed c
  join public.orders o on o.id = c.order_id;
end;
$$;


-- ── 6. TRIGGERS ─────────────────────────────────────────────────────────────

-- inventory_log
drop trigger if exists trg_update_inventory_current on inventory_log;
create trigger trg_update_inventory_current
  before insert on inventory_log
  for each row execute function update_inventory_current();

drop trigger if exists trg_inventory_log_immutable_update on inventory_log;
create trigger trg_inventory_log_immutable_update
  before update on inventory_log
  for each row execute function raise_inventory_log_immutable();

drop trigger if exists trg_inventory_log_immutable_delete on inventory_log;
create trigger trg_inventory_log_immutable_delete
  before delete on inventory_log
  for each row execute function raise_inventory_log_immutable();

drop trigger if exists trg_enforce_order_return_cap on inventory_log;
create trigger trg_enforce_order_return_cap
  before insert on inventory_log
  for each row execute function enforce_order_return_cap();

-- orders
drop trigger if exists trg_order_audit_events on orders;
create trigger trg_order_audit_events
  after update on orders
  for each row execute function emit_order_audit_events();

drop trigger if exists trg_enforce_order_status_transition on orders;
create trigger trg_enforce_order_status_transition
  before update on orders
  for each row execute function enforce_order_status_transition();

-- order_audit_events
drop trigger if exists trg_order_audit_events_immutable_update on order_audit_events;
create trigger trg_order_audit_events_immutable_update
  before update on order_audit_events
  for each row execute function raise_order_audit_events_immutable();

drop trigger if exists trg_order_audit_events_immutable_delete on order_audit_events;
create trigger trg_order_audit_events_immutable_delete
  before delete on order_audit_events
  for each row execute function raise_order_audit_events_immutable();

-- order_refunds — order matters: enforce_refund_total runs first, then
-- append-only check, then updated_at bump (alphabetical by trigger name).
drop trigger if exists trg_enforce_refund_total on order_refunds;
create trigger trg_enforce_refund_total
  before insert or update on order_refunds
  for each row execute function enforce_refund_total();

drop trigger if exists trg_order_refunds_append_only_update on order_refunds;
create trigger trg_order_refunds_append_only_update
  before update on order_refunds
  for each row execute function enforce_order_refunds_append_only_update();

drop trigger if exists trg_set_order_refunds_updated_at on order_refunds;
create trigger trg_set_order_refunds_updated_at
  before update on order_refunds
  for each row execute function set_order_refunds_updated_at();

drop trigger if exists trg_emit_order_refund_audit on order_refunds;
create trigger trg_emit_order_refund_audit
  after insert on order_refunds
  for each row execute function emit_order_refund_audit();

drop trigger if exists trg_emit_order_refund_annotation_audit on order_refunds;
create trigger trg_emit_order_refund_annotation_audit
  after update on order_refunds
  for each row execute function emit_order_refund_annotation_audit();

drop trigger if exists trg_order_refunds_immutable_delete on order_refunds;
create trigger trg_order_refunds_immutable_delete
  before delete on order_refunds
  for each row execute function raise_order_refunds_immutable_delete();
