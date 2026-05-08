-- ══════════════════════════════════════════════════════════════════════════
-- Initial schema for the Egg Origin e-commerce site (consolidated v2).
-- ══════════════════════════════════════════════════════════════════════════
--
-- This file replaces a series of incremental migrations: the original
-- 26-file series from the `db-modifications` branch (squashed into the
-- v1 initial schema on 2026-04-25) plus 12 further migrations applied
-- between 2026-04-27 and 2026-05-03 (squashed on 2026-05-06).
--
-- The site was still pre-launch at squash time so the DB had no real
-- customer data — see README.md § "Pre-launch note" for the rules. The
-- pre-squash migration files remain accessible via the merge commits on
-- the squash PRs for any forensic look-back. Once the first real customer
-- order lands, this file becomes immutable; new schema changes go in
-- their own dated file.
--
-- Layout:
--   1. Tables + sequences (in FK dependency order)
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

-- Sequences for human-readable refs minted by RPCs.
create sequence if not exists complaint_ref_seq start 1;
create sequence if not exists withdrawal_ref_seq start 1;

-- ─── orders ─────────────────────────────────────────────────────────────────
-- Customer-facing orders. Refund data lives in the refunds child table.
-- Items live in order_items. Invoice profile + issuance metadata live in
-- the invoices child table (one type='invoice' row + zero-or-more
-- type='credit_note' rows per order). EGN is never collected — ЗДДС does
-- not require it for individual retail invoices.
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

  -- Econt delivery (optional)
  econt_office_id integer,
  econt_office_code text,
  econt_office_name text,
  econt_office_address text,

  -- Speedy delivery (optional)
  speedy_office_id integer,
  speedy_office_name text,
  speedy_office_address text,

  -- Settlement tracking (when the seller has the money in hand)
  --   Card: set on Stripe webhook (capture).
  --   COD:  set when admin records courier remittance (≠ when customer
  --         paid the courier — for COD the customer-paid moment is
  --         delivered_at).
  seller_settled_at timestamptz,
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
--   - emit_invoice_audit_events trigger (invoices UPDATE)
--   - emit_refund_audit trigger (refunded events from refunds INSERT)
--   - emit_refund_annotation_audit trigger (annotation edits)
--   - emit_withdrawal_audit_events trigger (withdrawal lifecycle)
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

-- ─── refunds ────────────────────────────────────────────────────────────────
-- Child table — many refunds per order. stripe_refund_id is the natural
-- idempotency key for webhook arrivals; client_idempotency_key for admin-UI
-- submissions. Append-only for financial fields (only reason,
-- bank_transfer_ref, and credit_note_skip_reason are mutable).
--
-- The withdrawal_id FK is added below after the withdrawals table is
-- created (mutual reference: withdrawals.refund_id → refunds.id, and
-- refunds.withdrawal_id → withdrawals.id).
create table if not exists refunds (
  id                       uuid        primary key default gen_random_uuid(),
  order_id                 uuid        not null references orders(id) on delete cascade,
  stripe_refund_id         text,
  client_idempotency_key   uuid,
  amount_cents             integer     not null check (amount_cents > 0),
  method                   text        not null check (method in ('stripe', 'bank_transfer')),
  source                   text        not null check (source in ('admin_ui', 'stripe_webhook')),
  reason                   text,
  bank_transfer_ref        text,
  affects_invoiced_supply  boolean     not null default true,
  credit_note_skip_reason  text,
  withdrawal_id            uuid,                      -- FK constraint added after withdrawals table created
  recorded_by              text        not null default 'admin',
  refunded_at              timestamptz not null default now(),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint chk_stripe_method_has_refund_id
    check (method <> 'stripe' or stripe_refund_id is not null),
  constraint chk_bank_transfer_method_has_ref
    check (method <> 'bank_transfer' or bank_transfer_ref is not null),
  constraint chk_refund_reason_length
    check (reason is null or length(reason) <= 1000),
  constraint chk_bank_transfer_ref_length
    check (bank_transfer_ref is null or length(bank_transfer_ref) <= 200),
  constraint chk_skip_reason_when_skipping check (
    affects_invoiced_supply = true
    or (credit_note_skip_reason is not null and btrim(credit_note_skip_reason) <> '')
  ),
  constraint chk_skip_reason_length check (
    credit_note_skip_reason is null or length(credit_note_skip_reason) <= 500
  )
);

-- ─── withdrawals ────────────────────────────────────────────────────────────
-- Право на отказ (Чл. 50 ЗЗП) register. Strict separation from complaints
-- (рекламация — Чл. 122-127), refunds (money), inventory (goods), and
-- invoices/credit_notes (accounting). Intake is admin-driven (no public
-- form): customer emails or calls, admin opens the order, classifies, and
-- registers the withdrawal here.
--
-- Status machine (forward-only; data-repair via force_withdrawal_status_override):
--
--   Path A (return required, default):
--     requested → approved → goods_received → completed
--                          ↘ rejected
--
--   Path B (return NOT required, e.g. goodwill / customer keeps product):
--     requested → approved → completed
--                          ↘ rejected
create table if not exists withdrawals (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references orders(id) on delete restrict,
  withdrawal_ref  text not null unique,         -- WD-YYYY-NNNN

  -- Intake
  requested_via   text not null default 'email'
                  check (requested_via in ('email', 'phone', 'admin')),
  customer_email  text not null,
  customer_request_text text,

  -- Status machine
  status text not null default 'requested' check (status in (
    'requested', 'approved', 'goods_received', 'rejected', 'completed'
  )),

  -- Eligibility (3 dimensions; informational, not a hard gate)
  eligibility_time_based     boolean,
  eligibility_product_based  text check (eligibility_product_based in (
    'eligible', 'perishable_or_short_shelf_life', 'hygiene_exception', 'unknown'
  )),
  eligibility_condition      text check (eligibility_condition in (
    'pending_inspection', 'sealed_sellable', 'opened', 'damaged', 'expired', 'other'
  )) default 'pending_inspection',

  -- Resolution
  resolution_type   text check (resolution_type in ('refund', 'replacement', 'none')),
  rejection_reason  text,
  refund_id         uuid references refunds(id) on delete restrict,

  -- Path B: skip-the-return
  return_required  boolean not null default true,
  completion_note  text,

  -- Optional return logistics
  return_tracking_number text,
  return_courier         text,

  -- Admin lifecycle
  approved_at        timestamptz,
  approved_by        text,
  goods_received_at  timestamptz,
  rejected_at        timestamptz,
  rejected_by        text,
  completed_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint chk_withdrawal_ref_format check (withdrawal_ref ~ '^WD-\d{4}-\d{4,}$'),
  constraint chk_customer_email_lowercase check (customer_email = lower(customer_email)),

  -- Rejection requires a reason
  constraint chk_rejection_reason check (
    status <> 'rejected'
    or (rejection_reason is not null and btrim(rejection_reason) <> '')
  ),

  -- Completion requires a resolution declared
  constraint chk_completed_requires_resolution check (
    status <> 'completed' or resolution_type is not null
  ),

  -- When resolution is refund, the refund linkage is mandatory
  constraint chk_refund_resolution_has_refund_id check (
    coalesce(resolution_type, '') <> 'refund' or refund_id is not null
  ),

  -- Path B (no-return completion) requires an explicit completion_note
  constraint chk_completion_note_when_no_return check (
    status <> 'completed'
    or return_required = true
    or (completion_note is not null and btrim(completion_note) <> '')
  ),

  -- Cannot reject after physically receiving goods (legally messy)
  constraint chk_no_reject_after_goods check (
    not (status = 'rejected' and goods_received_at is not null)
  ),

  -- Length caps
  constraint chk_request_text_length check (
    customer_request_text is null or length(customer_request_text) <= 2000
  ),
  constraint chk_rejection_reason_length check (
    rejection_reason is null or length(rejection_reason) <= 1000
  ),
  constraint chk_completion_note_length check (
    completion_note is null or length(completion_note) <= 1000
  ),
  constraint chk_return_tracking_length check (
    return_tracking_number is null or length(return_tracking_number) <= 200
  ),
  constraint chk_return_courier_length check (
    return_courier is null or length(return_courier) <= 100
  )
);

-- Now that withdrawals exists, close the cycle: refunds.withdrawal_id FK.
-- Set once when admin issues a refund from a withdrawal context. Immutable
-- once set (extended into the append-only enforcement on refunds).
alter table refunds
  add constraint refunds_withdrawal_id_fkey
  foreign key (withdrawal_id) references withdrawals(id) on delete restrict;

-- ─── invoices ───────────────────────────────────────────────────────────────
-- Holds both initial фактури (type='invoice') and кредитни известия
-- (type='credit_note'). Replaces the in-orders invoice columns.
--
-- Legal basis:
--   ЗДДС Чл. 113 — фактура required for invoiced supplies (issued in Microinvest)
--   ЗДДС Чл. 115 — кредитно известие required when tax base changes or
--                  supply is cancelled for an invoiced order; must reference
--                  the original фактура number; due within 5 days
--   ЗДДС Чл. 116 — corrections to issued documents go through credit_note,
--                  never via in-place edit
--   ЗСч Чл. 6   — every business operation needs a primary accounting
--                  document; for non-VAT-registered traders this is the
--                  basis for credit notes on invoiced refunds
--
-- Append-mostly: identity, profile, linkage, and due_at strictly immutable;
-- invoice_number / invoice_date / sent_at are forward-only (NULL → set,
-- never reverted, never re-set). DELETE blocked.
create table if not exists invoices (
  id                     uuid primary key default gen_random_uuid(),
  order_id               uuid not null references orders(id) on delete restrict,
  type                   text not null check (type in ('invoice', 'credit_note')),

  -- Credit note linkage (only set for type='credit_note')
  refund_id              uuid references refunds(id) on delete restrict,
  references_invoice_id  uuid references invoices(id) on delete restrict,

  -- Profile (only meaningful for type='invoice'; null for credit_note)
  invoice_type   text check (invoice_type in ('individual', 'company')),
  company_name   text,
  eik            text,
  vat_number     text,
  mol            text,                -- only for company; individual name comes from order
  address        text,

  -- Issuance metadata (admin enters from Microinvest)
  invoice_number text,
  invoice_date   timestamptz,
  sent_at        timestamptz,

  -- Deadline (mandatory for credit_note: refund.refunded_at + 5 days per ЗДДС Чл. 113 ал. 4)
  due_at         timestamptz,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- Type='invoice' shape: no refund/origin links; profile required (address
  -- minimum, mode-specific extras handled by separate constraints below).
  constraint chk_invoice_shape check (
    type <> 'invoice' or (
      refund_id is null
      and references_invoice_id is null
      and invoice_type is not null
      and address is not null and btrim(address) <> ''
    )
  ),

  -- Type='credit_note' shape: refund + origin required, profile fields null,
  -- due_at populated.
  constraint chk_credit_note_shape check (
    type <> 'credit_note' or (
      refund_id is not null
      and references_invoice_id is not null
      and invoice_type is null
      and company_name is null
      and eik is null
      and vat_number is null
      and mol is null
      and address is null
      and due_at is not null
    )
  ),

  -- Company invoices: company_name + eik + mol required; vat_number optional.
  constraint chk_invoice_company_fields check (
    type <> 'invoice' or invoice_type <> 'company' or (
      company_name is not null and btrim(company_name) <> ''
      and eik is not null and btrim(eik) <> ''
      and mol is not null and btrim(mol) <> ''
    )
  ),

  -- Individual invoices: forbid all company-only fields (mol included — the
  -- legal name on the invoice comes from the order's first_name + last_name).
  constraint chk_invoice_individual_fields check (
    type <> 'invoice' or invoice_type <> 'individual' or (
      company_name is null
      and eik is null
      and vat_number is null
      and mol is null
    )
  ),

  -- Length caps
  constraint chk_invoices_invoice_number_length check (invoice_number is null or length(invoice_number) <= 50),
  constraint chk_invoices_company_name_length check (company_name is null or length(company_name) <= 200),
  constraint chk_invoices_eik_length check (eik is null or length(eik) <= 13),
  constraint chk_invoices_vat_number_length check (vat_number is null or length(vat_number) <= 15),
  constraint chk_invoices_mol_length check (mol is null or length(mol) <= 200),
  constraint chk_invoices_address_length check (address is null or length(address) <= 500)
);

-- ─── refund_items ───────────────────────────────────────────────────────────
-- Explicit per-line allocation of a refund. Independent of inventory_log:
-- lets admin allocate a refund to specific order lines for shipping
-- disputes, partial price reductions, or goodwill discounts where no goods
-- physically move.
--
-- When refund_items rows exist they're the authoritative per-line
-- allocation; otherwise the refund is treated as un-allocated. Append-only.
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

-- ─── product_batches ────────────────────────────────────────────────────────
-- Tier 1 batch traceability — minimum legally-defensible recall capability.
--
-- Legal basis:
--   EU 178/2002 Чл. 18 — one-step-back, one-step-forward traceability
--   EU 931/2011        — batch info on commercial consignments (animal-origin)
--   ЗХр Чл. 84-86      — Bulgarian transposition
--   ЗЗП recall procedure — БАБХ supervises withdrawals/recalls
--
-- Append-mostly: only the active → recalled forward transition is allowed;
-- recall metadata must be set in the same UPDATE. DELETE blocked. Tamper-
-- evident for БАБХ inspections.
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

-- ─── order_item_batches ─────────────────────────────────────────────────────
-- Populated at ship time; records "this order_item consumed N units from
-- this batch". Fully immutable post-insert — allocation is locked at ship
-- time.
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
-- Formal complaints register (ЗЗП Чл. 122-127). complaint_ref auto-generated
-- as RCL-YYYY-NNNN via complaint_ref_seq (server-side composes the format).
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
create index if not exists idx_orders_status on orders (status);
create unique index if not exists idx_orders_tracking_number_unique
  on orders (tracking_number) where tracking_number is not null and tracking_number != '__generating__';
create index if not exists idx_orders_created_at on orders (created_at desc);
create index if not exists idx_orders_delivered_at
  on orders (delivered_at) where delivered_at is not null;

-- order_items
create index if not exists idx_order_items_order_id on order_items (order_id);
create index if not exists idx_order_items_sku on order_items (sku);

-- product_sales — at most one active sale per product
create unique index if not exists idx_product_sales_one_active
  on product_sales (product_id) where is_active = true;

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

-- refunds
create unique index if not exists idx_refunds_stripe_id
  on refunds (stripe_refund_id) where stripe_refund_id is not null;
create unique index if not exists idx_refunds_client_idempotency_unique
  on refunds (client_idempotency_key) where client_idempotency_key is not null;
create index if not exists idx_refunds_order_id on refunds (order_id, refunded_at desc);
create index if not exists idx_refunds_bank_transfer_ref
  on refunds (bank_transfer_ref) where bank_transfer_ref is not null;
create index if not exists idx_refunds_withdrawal_id
  on refunds (withdrawal_id) where withdrawal_id is not null;
-- One refund per withdrawal at most (preserves 1:1 invariant)
create unique index if not exists uq_refunds_withdrawal_id
  on refunds (withdrawal_id) where withdrawal_id is not null;

-- invoices
create unique index if not exists uq_invoices_one_per_order
  on invoices (order_id) where type = 'invoice';
create unique index if not exists uq_invoices_one_per_refund
  on invoices (refund_id) where refund_id is not null;
create unique index if not exists uq_invoices_invoice_number
  on invoices (invoice_number) where invoice_number is not null;
create index if not exists idx_invoices_order_id on invoices (order_id);
create index if not exists idx_invoices_type on invoices (type);
create index if not exists idx_invoices_pending
  on invoices (type) where invoice_number is null;
create index if not exists idx_invoices_due_at
  on invoices (due_at) where due_at is not null and invoice_number is null;

-- withdrawals
-- One open withdrawal per order at a time; closed-state rows excluded so a
-- customer who had a rejected/completed withdrawal can file a new one.
create unique index if not exists uq_open_withdrawal_per_order
  on withdrawals (order_id)
  where status in ('requested', 'approved', 'goods_received');
create index if not exists idx_withdrawals_status
  on withdrawals (status)
  where status in ('requested', 'approved', 'goods_received');
create index if not exists idx_withdrawals_order_id on withdrawals (order_id);
create index if not exists idx_withdrawals_created_at on withdrawals (created_at desc);

-- refund_items
create index if not exists idx_refund_items_refund_id     on refund_items (refund_id);
create index if not exists idx_refund_items_order_item_id on refund_items (order_item_id);

-- product_batches
create index if not exists idx_product_batches_sku_status
  on product_batches (sku, status);
create index if not exists idx_product_batches_expiry
  on product_batches (sku, expiry_date) where status = 'active';
create index if not exists idx_product_batches_recalled
  on product_batches (status) where status = 'recalled';

-- order_item_batches
create index if not exists idx_order_item_batches_order_item
  on order_item_batches (order_item_id);
create index if not exists idx_order_item_batches_product_batch
  on order_item_batches (product_batch_id);

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


-- ── 4. RLS + POLICIES ───────────────────────────────────────────────────────
-- Server actions use SUPABASE_SERVICE_ROLE_KEY which bypasses RLS. The anon
-- key (used from the browser) is denied everything by these policies.
alter table orders                enable row level security;
alter table order_items           enable row level security;
alter table product_sales         enable row level security;
alter table promo_codes           enable row level security;
alter table inventory_log         enable row level security;
alter table inventory_current     enable row level security;
alter table order_audit_events    enable row level security;
alter table refunds               enable row level security;
alter table invoices              enable row level security;
alter table withdrawals           enable row level security;
alter table refund_items          enable row level security;
alter table product_batches       enable row level security;
alter table order_item_batches    enable row level security;
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

create policy "Deny all on refunds" on refunds
  for all using (false) with check (false);

create policy "Deny all on invoices" on invoices
  for all using (false) with check (false);

create policy "Deny all on withdrawals" on withdrawals
  for all using (false) with check (false);

create policy "Deny all on refund_items" on refund_items
  for all using (false) with check (false);

create policy "Deny all on product_batches" on product_batches
  for all using (false) with check (false);

create policy "Deny all on order_item_batches" on order_item_batches
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
--
-- order_out is hard-blocked from going negative; admin decrements may go
-- negative (operational debt, surfaced as red "Дълг" badge in the admin UI).
--
-- Customer-return damaged is treated specially: 'damaged' rows with
-- reference_type='return' AND order_id IS NOT NULL are audit-only — the
-- unit was already removed from sellable via order_out at ship time, so
-- this row records its disposition (destroyed) without double-decrementing.
-- Mirrors Shopify's two-bucket model (sellable + damaged as separate
-- accounting buckets).
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
    when new.type in ('order_out', 'wholesale_out', 'sample_out', 'adjustment_loss')
      then -new.quantity
    when new.type = 'damaged' then
      case
        -- Customer-return damaged: audit-only. The unit was already removed
        -- from sellable via order_out at ship time; this row records its
        -- disposition (destroyed) but does not double-decrement.
        when new.reference_type = 'return' and new.order_id is not null
          then 0
        -- Warehouse-internal damaged (broken in storage, expired, etc.):
        -- real subtraction from sellable.
        else -new.quantity
      end
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
--
-- Note: invoice events come from emit_invoice_audit_events on the invoices
-- table, not from here.
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

  if old.seller_settled_at is distinct from new.seller_settled_at
     and new.seller_settled_at is not null then
    insert into public.order_audit_events (order_id, event_type, actor, payload)
    values (new.id, 'seller_settled_at_recorded', v_actor,
      jsonb_build_object(
        'seller_settled_at', new.seller_settled_at,
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
    'email_resent',
    -- Withdrawals (emitted by emit_withdrawal_audit_events trigger; here so
    -- record_order_outcome accepts them too if ever called manually)
    'withdrawal_requested',
    'withdrawal_approved',
    'withdrawal_goods_received',
    'withdrawal_rejected',
    'withdrawal_completed',
    'withdrawal_status_force_override'
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
-- Returns headline numbers + action-item counters. Refund aggregates are
-- by refunded_at window (Shopify convention: a refund issued today counts
-- against today, regardless of when the original order was placed). Net
-- revenue is derived on the page (gross - refunds).
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
    'invoices_awaiting', (select count(*) from invoices i
                          join orders o on o.id = i.order_id
                          where i.type = 'invoice' and i.invoice_number is null
                            and o.status <> 'cancelled'),
    'credit_notes_awaiting', (select count(*) from invoices
                              where type = 'credit_note' and invoice_number is null),
    'awaiting_settlement', (select count(*) from orders where payment_method = 'cod' and delivered_at is not null and seller_settled_at is null and status = 'delivered'),
    'inventory_debt_skus', (select count(*) from inventory_current where quantity < 0),
    'withdrawals_pending', (select count(*) from withdrawals where status in ('requested', 'approved', 'goods_received')),
    -- Refund aggregates by refunded_at window. Match Shopify's "Returns"
    -- convention: a refund issued today counts against today, regardless
    -- of when the original order was placed.
    'today_refunds', (select coalesce(sum(amount_cents), 0) from refunds where refunded_at >= p_today_start),
    'week_refunds', (select coalesce(sum(amount_cents), 0) from refunds where refunded_at >= p_week_start),
    'month_refunds', (select coalesce(sum(amount_cents), 0) from refunds where refunded_at >= p_month_start)
  ) into result
  from orders
  where created_at >= p_month_start and status != 'cancelled';

  return result;
end;
$$;

-- ─── Refunds: enforce_refunds_total trigger function ────────────────────────
-- Locks orders row to serialize concurrent inserts. Sums existing refunds
-- (excluding self on UPDATE) and rejects when sum + new exceeds total.
create or replace function enforce_refunds_total()
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
  from public.refunds
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
create or replace function set_refunds_updated_at()
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
create or replace function emit_refund_audit()
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
      'refund_id',                new.id,
      'amount_cents',             new.amount_cents,
      'method',                   new.method,
      'source',                   new.source,
      'stripe_refund_id',         new.stripe_refund_id,
      'bank_transfer_ref',        new.bank_transfer_ref,
      'reason',                   new.reason,
      'affects_invoiced_supply',  new.affects_invoiced_supply,
      'withdrawal_id',            new.withdrawal_id
    ));
  return new;
end;
$$;

-- ─── Refunds: emit 'refund_annotation_edited' on UPDATE ─────────────────────
-- Early-returns on no-op UPDATEs (auto-bumped updated_at alone isn't worth
-- auditing). Per-field {old, new} payload via jsonb_strip_nulls.
create or replace function emit_refund_annotation_audit()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_actor text := coalesce(current_setting('app.actor', true), new.recorded_by);
begin
  if old.reason is not distinct from new.reason
     and old.bank_transfer_ref is not distinct from new.bank_transfer_ref
     and old.credit_note_skip_reason is not distinct from new.credit_note_skip_reason then
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
      'bank_transfer_ref', case
        when old.bank_transfer_ref is distinct from new.bank_transfer_ref
          then jsonb_build_object('old', old.bank_transfer_ref, 'new', new.bank_transfer_ref)
        else null
      end,
      'credit_note_skip_reason', case
        when old.credit_note_skip_reason is distinct from new.credit_note_skip_reason
          then jsonb_build_object('old', old.credit_note_skip_reason, 'new', new.credit_note_skip_reason)
        else null
      end
    ))
  );
  return new;
end;
$$;

-- ─── Refunds: append-only enforcement ───────────────────────────────────────
-- UPDATE allowed only for reason / bank_transfer_ref / credit_note_skip_reason
-- / updated_at. DELETE never. withdrawal_id is set once at insert and immutable.
create or replace function enforce_refunds_append_only_update()
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
     or old.created_at is distinct from new.created_at
     or old.affects_invoiced_supply is distinct from new.affects_invoiced_supply
     or old.withdrawal_id is distinct from new.withdrawal_id then
    raise exception 'refunds financial fields are immutable; only reason, bank_transfer_ref, and credit_note_skip_reason may be edited';
  end if;
  return new;
end;
$$;

create or replace function raise_refunds_immutable_delete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'refunds is append-only; DELETE is not permitted. To correct a mistake, create a reversing refund (phase 2) or apply a manual data repair.';
end;
$$;

-- ─── Invoices: maintain updated_at ──────────────────────────────────────────
create or replace function set_invoices_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ─── Invoices: emit audit events on issuance / sent_at ──────────────────────
-- Type-aware: invoice_number_set vs credit_note_number_set; invoice_marked_sent
-- vs credit_note_marked_sent. All events keyed by order_id so the order
-- timeline aggregates them.
create or replace function emit_invoice_audit_events()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_actor text := coalesce(current_setting('app.actor', true), 'admin');
  v_event_number_set text;
  v_event_marked_sent text;
begin
  if new.type = 'invoice' then
    v_event_number_set  := 'invoice_number_set';
    v_event_marked_sent := 'invoice_marked_sent';
  else
    v_event_number_set  := 'credit_note_number_set';
    v_event_marked_sent := 'credit_note_marked_sent';
  end if;

  if old.invoice_number is distinct from new.invoice_number
     and new.invoice_number is not null then
    insert into public.order_audit_events (order_id, event_type, actor, payload)
    values (new.order_id, v_event_number_set, v_actor,
      jsonb_build_object(
        'invoice_id',     new.id,
        'invoice_number', new.invoice_number,
        'invoice_date',   new.invoice_date,
        'type',           new.type,
        'refund_id',      new.refund_id
      ));
  end if;

  if old.sent_at is distinct from new.sent_at and new.sent_at is not null then
    insert into public.order_audit_events (order_id, event_type, actor, payload)
    values (new.order_id, v_event_marked_sent, v_actor,
      jsonb_build_object(
        'invoice_id',     new.id,
        'invoice_number', new.invoice_number,
        'sent_at',        new.sent_at,
        'type',           new.type,
        'refund_id',      new.refund_id
      ));
  end if;

  return new;
end;
$$;

-- ─── Invoices: append-mostly enforcement ────────────────────────────────────
-- Identity, profile, linkage, and due_at strictly immutable post-insert.
-- invoice_number / invoice_date / sent_at are forward-only (NULL → set,
-- never reverted, never re-set). Once a фактура or кредитно известие has a
-- number, that number is the document's identity in Microinvest's sequence
-- and can't be silently rewritten. Backstop to the app-layer .is(..., null)
-- guards in setInvoiceNumber / markInvoiceSent.
create or replace function enforce_invoices_append_mostly_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.id is distinct from new.id
     or old.order_id is distinct from new.order_id
     or old.type is distinct from new.type
     or old.refund_id is distinct from new.refund_id
     or old.references_invoice_id is distinct from new.references_invoice_id
     or old.invoice_type is distinct from new.invoice_type
     or old.company_name is distinct from new.company_name
     or old.eik is distinct from new.eik
     or old.vat_number is distinct from new.vat_number
     or old.mol is distinct from new.mol
     or old.address is distinct from new.address
     or old.due_at is distinct from new.due_at
     or old.created_at is distinct from new.created_at then
    raise exception 'invoices identity, profile, and linkage fields are immutable post-insert; corrections to issued documents go through credit_note (ЗДДС Чл. 115)';
  end if;

  if old.invoice_number is not null
     and new.invoice_number is distinct from old.invoice_number then
    raise exception 'invoices.invoice_number is immutable once set; issue a credit_note for corrections';
  end if;
  if old.invoice_date is not null
     and new.invoice_date is distinct from old.invoice_date then
    raise exception 'invoices.invoice_date is immutable once set';
  end if;
  if old.sent_at is not null
     and new.sent_at is distinct from old.sent_at then
    raise exception 'invoices.sent_at is immutable once set';
  end if;

  return new;
end;
$$;

create or replace function raise_invoices_immutable_delete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'invoices is append-mostly; DELETE is not permitted. Issued documents can only be corrected via credit_note (ЗДДС Чл. 115).';
end;
$$;

-- ─── Withdrawals: next_withdrawal_ref RPC ───────────────────────────────────
-- Atomic helper for the app layer to mint the next WD-YYYY-NNNN ref. Called
-- from createWithdrawal to avoid a race between two concurrent admin clicks.
create or replace function next_withdrawal_ref()
returns text
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_n bigint;
begin
  v_n := nextval('public.withdrawal_ref_seq');
  return 'WD-' || to_char(now(), 'YYYY') || '-' || lpad(v_n::text, 4, '0');
end;
$$;

-- ─── Withdrawals: maintain updated_at ───────────────────────────────────────
create or replace function set_withdrawals_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ─── Withdrawals: state-machine trigger ─────────────────────────────────────
-- BEFORE UPDATE on withdrawals. Fires only when status actually changes.
-- Bypass via current_setting('app.allow_withdrawal_status_override', true) =
-- 'true' (set by force_withdrawal_status_override RPC).
create or replace function enforce_withdrawal_status_transition()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_bypass text := current_setting('app.allow_withdrawal_status_override', true);
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  if v_bypass = 'true' then
    return new;
  end if;

  -- Legal transitions
  if old.status = 'requested' and new.status in ('approved', 'rejected') then
    return new;
  end if;

  if old.status = 'approved' and new.status in ('goods_received', 'rejected') then
    return new;
  end if;

  -- Path B: approved → completed when return_required=false + completion_note
  -- + resolution declared. Refund linkage required when resolution_type='refund'.
  if old.status = 'approved' and new.status = 'completed' then
    if new.return_required then
      raise exception 'Withdrawal cannot complete from approved when return_required=true. Mark goods_received first.';
    end if;
    if new.completion_note is null or btrim(new.completion_note) = '' then
      raise exception 'completion_note is required to complete a withdrawal without goods receipt';
    end if;
    if new.resolution_type is null then
      raise exception 'resolution_type is required to complete a withdrawal';
    end if;
    if new.resolution_type = 'refund' and new.refund_id is null then
      raise exception 'refund_id is required when resolution_type=refund';
    end if;
    return new;
  end if;

  if old.status = 'goods_received' and new.status = 'completed' then
    if new.resolution_type is null then
      raise exception 'resolution_type is required to complete a withdrawal';
    end if;
    if new.resolution_type = 'refund' and new.refund_id is null then
      raise exception 'refund_id is required when resolution_type=refund';
    end if;
    return new;
  end if;

  raise exception 'Illegal withdrawal status transition: % → %. Use force_withdrawal_status_override for data repair.',
    old.status, new.status;
end;
$$;

-- ─── Withdrawals: force_withdrawal_status_override RPC ──────────────────────
create or replace function force_withdrawal_status_override(
  p_id uuid,
  p_new_status text,
  p_reason text,
  p_actor text default 'admin'
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_order_id uuid;
  v_old_status text;
begin
  if p_new_status not in ('requested', 'approved', 'goods_received', 'rejected', 'completed') then
    raise exception 'Invalid withdrawal status: %', p_new_status;
  end if;

  if p_reason is null or length(btrim(p_reason)) < 20 then
    raise exception 'force_withdrawal_status_override requires a reason of at least 20 characters explaining the repair';
  end if;

  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'actor is required';
  end if;

  select status, order_id into v_old_status, v_order_id
  from public.withdrawals where id = p_id;

  if v_old_status is null then
    raise exception 'Withdrawal % not found', p_id;
  end if;

  -- Audit BEFORE the bypass so a failed insert aborts the repair.
  insert into public.order_audit_events (order_id, event_type, actor, payload)
  values (
    v_order_id,
    'withdrawal_status_force_override',
    p_actor,
    jsonb_build_object(
      'withdrawal_id', p_id,
      'from', v_old_status,
      'to', p_new_status,
      'reason', p_reason
    )
  );

  perform set_config('app.allow_withdrawal_status_override', 'true', true);

  update public.withdrawals
  set status = p_new_status
  where id = p_id;

  perform set_config('app.allow_withdrawal_status_override', 'false', true);
end;
$$;

-- ─── Withdrawals: audit emission trigger ────────────────────────────────────
-- Emits typed events into order_audit_events on INSERT and on status
-- transitions. Suppresses status_changed during force-override (the RPC
-- already wrote a richer event).
create or replace function emit_withdrawal_audit_events()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_actor text := coalesce(current_setting('app.actor', true), 'admin');
  v_override text := current_setting('app.allow_withdrawal_status_override', true);
begin
  if tg_op = 'INSERT' then
    insert into public.order_audit_events (order_id, event_type, actor, payload)
    values (new.order_id, 'withdrawal_requested', v_actor,
      jsonb_build_object(
        'withdrawal_id',  new.id,
        'withdrawal_ref', new.withdrawal_ref,
        'requested_via',  new.requested_via,
        'customer_email', new.customer_email
      ));
    return new;
  end if;

  -- UPDATE
  if old.status is distinct from new.status and coalesce(v_override, '') <> 'true' then
    if new.status = 'approved' then
      insert into public.order_audit_events (order_id, event_type, actor, payload)
      values (new.order_id, 'withdrawal_approved', v_actor,
        jsonb_build_object(
          'withdrawal_id',   new.id,
          'withdrawal_ref',  new.withdrawal_ref,
          'return_required', new.return_required,
          'approved_by',     new.approved_by,
          'approved_at',     new.approved_at
        ));
    elsif new.status = 'goods_received' then
      insert into public.order_audit_events (order_id, event_type, actor, payload)
      values (new.order_id, 'withdrawal_goods_received', v_actor,
        jsonb_build_object(
          'withdrawal_id',         new.id,
          'withdrawal_ref',        new.withdrawal_ref,
          'eligibility_condition', new.eligibility_condition,
          'resolution_type',       new.resolution_type,
          'goods_received_at',     new.goods_received_at,
          'return_tracking_number',new.return_tracking_number,
          'return_courier',        new.return_courier
        ));
    elsif new.status = 'rejected' then
      insert into public.order_audit_events (order_id, event_type, actor, payload)
      values (new.order_id, 'withdrawal_rejected', v_actor,
        jsonb_build_object(
          'withdrawal_id',     new.id,
          'withdrawal_ref',    new.withdrawal_ref,
          'rejection_reason',  new.rejection_reason,
          'rejected_by',       new.rejected_by,
          'rejected_at',       new.rejected_at
        ));
    elsif new.status = 'completed' then
      insert into public.order_audit_events (order_id, event_type, actor, payload)
      values (new.order_id, 'withdrawal_completed', v_actor,
        jsonb_build_object(
          'withdrawal_id',    new.id,
          'withdrawal_ref',   new.withdrawal_ref,
          'resolution_type',  new.resolution_type,
          'refund_id',        new.refund_id,
          'return_required',  new.return_required,
          'completion_note',  new.completion_note,
          'completed_at',     new.completed_at
        ));
    end if;
  end if;

  return new;
end;
$$;

-- ─── Refund items: same-order consistency ───────────────────────────────────
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

-- ─── Refund items: quantity cap per order_item ──────────────────────────────
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

-- ─── Refund items: amount cap per refund ────────────────────────────────────
-- sum(refund_items.amount_cents for refund_id=R) ≤ refunds.amount_cents.
-- Items can sum to LESS than the total — the difference is non-allocated
-- (e.g. shipping or goodwill portion).
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

-- ─── Refund items: append-only enforcement ──────────────────────────────────
create or replace function raise_refund_items_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'refund_items is append-only; % is not permitted. Corrections require a reversing refund.', tg_op;
end;
$$;

-- ─── Product batches: append-mostly enforcement ─────────────────────────────
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

-- ─── Order item batches: fully immutable post-insert ────────────────────────
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

-- ─── Order item batches: batch-SKU consistency ──────────────────────────────
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

-- ─── Batch helpers: batch_quantity_available ────────────────────────────────
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

-- ─── Batch helpers: affected_orders_for_batch ───────────────────────────────
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
#variable_conflict use_column
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

-- refunds — order matters: enforce_refunds_total runs first, then
-- append-only check, then updated_at bump (alphabetical by trigger name).
drop trigger if exists trg_refunds_enforce_total on refunds;
create trigger trg_refunds_enforce_total
  before insert or update on refunds
  for each row execute function enforce_refunds_total();

drop trigger if exists trg_refunds_append_only_update on refunds;
create trigger trg_refunds_append_only_update
  before update on refunds
  for each row execute function enforce_refunds_append_only_update();

drop trigger if exists trg_refunds_set_updated_at on refunds;
create trigger trg_refunds_set_updated_at
  before update on refunds
  for each row execute function set_refunds_updated_at();

drop trigger if exists trg_refunds_emit_audit on refunds;
create trigger trg_refunds_emit_audit
  after insert on refunds
  for each row execute function emit_refund_audit();

drop trigger if exists trg_refunds_emit_annotation_audit on refunds;
create trigger trg_refunds_emit_annotation_audit
  after update on refunds
  for each row execute function emit_refund_annotation_audit();

drop trigger if exists trg_refunds_immutable_delete on refunds;
create trigger trg_refunds_immutable_delete
  before delete on refunds
  for each row execute function raise_refunds_immutable_delete();

-- invoices
drop trigger if exists trg_set_invoices_updated_at on invoices;
create trigger trg_set_invoices_updated_at
  before update on invoices
  for each row execute function set_invoices_updated_at();

drop trigger if exists trg_emit_invoice_audit_events on invoices;
create trigger trg_emit_invoice_audit_events
  after update on invoices
  for each row execute function emit_invoice_audit_events();

drop trigger if exists trg_invoices_append_mostly_update on invoices;
create trigger trg_invoices_append_mostly_update
  before update on invoices
  for each row execute function enforce_invoices_append_mostly_update();

drop trigger if exists trg_invoices_immutable_delete on invoices;
create trigger trg_invoices_immutable_delete
  before delete on invoices
  for each row execute function raise_invoices_immutable_delete();

-- withdrawals
drop trigger if exists trg_set_withdrawals_updated_at on withdrawals;
create trigger trg_set_withdrawals_updated_at
  before update on withdrawals
  for each row execute function set_withdrawals_updated_at();

drop trigger if exists trg_enforce_withdrawal_status_transition on withdrawals;
create trigger trg_enforce_withdrawal_status_transition
  before update on withdrawals
  for each row execute function enforce_withdrawal_status_transition();

drop trigger if exists trg_emit_withdrawal_audit_events_insert on withdrawals;
create trigger trg_emit_withdrawal_audit_events_insert
  after insert on withdrawals
  for each row execute function emit_withdrawal_audit_events();

drop trigger if exists trg_emit_withdrawal_audit_events_update on withdrawals;
create trigger trg_emit_withdrawal_audit_events_update
  after update on withdrawals
  for each row execute function emit_withdrawal_audit_events();

-- refund_items
drop trigger if exists trg_refund_items_order_consistency on refund_items;
create trigger trg_refund_items_order_consistency
  before insert on refund_items
  for each row execute function check_refund_item_order_consistency();

drop trigger if exists trg_refund_items_quantity_cap on refund_items;
create trigger trg_refund_items_quantity_cap
  before insert on refund_items
  for each row execute function enforce_refund_items_quantity_cap();

drop trigger if exists trg_refund_items_amount_cap on refund_items;
create trigger trg_refund_items_amount_cap
  before insert on refund_items
  for each row execute function enforce_refund_items_amount_cap();

drop trigger if exists trg_refund_items_immutable_update on refund_items;
create trigger trg_refund_items_immutable_update
  before update on refund_items
  for each row execute function raise_refund_items_immutable();

drop trigger if exists trg_refund_items_immutable_delete on refund_items;
create trigger trg_refund_items_immutable_delete
  before delete on refund_items
  for each row execute function raise_refund_items_immutable();

-- product_batches
drop trigger if exists trg_product_batches_append_mostly_update on product_batches;
create trigger trg_product_batches_append_mostly_update
  before update on product_batches
  for each row execute function enforce_product_batches_append_mostly_update();

drop trigger if exists trg_product_batches_immutable_delete on product_batches;
create trigger trg_product_batches_immutable_delete
  before delete on product_batches
  for each row execute function raise_product_batches_immutable_delete();

-- order_item_batches
drop trigger if exists trg_order_item_batches_immutable_update on order_item_batches;
create trigger trg_order_item_batches_immutable_update
  before update on order_item_batches
  for each row execute function raise_order_item_batches_immutable();

drop trigger if exists trg_order_item_batches_immutable_delete on order_item_batches;
create trigger trg_order_item_batches_immutable_delete
  before delete on order_item_batches
  for each row execute function raise_order_item_batches_immutable();

drop trigger if exists trg_order_item_batches_sku_consistency on order_item_batches;
create trigger trg_order_item_batches_sku_consistency
  before insert on order_item_batches
  for each row execute function check_order_item_batch_sku_consistency();
