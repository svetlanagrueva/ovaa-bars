-- Move invoice columns from orders to a dedicated invoices table that holds
-- both initial фактури (type='invoice') and кредитни известия (type='credit_note').
--
-- Legal basis:
--   ЗДДС Чл. 113 — фактура required for invoiced supplies (issued in Microinvest)
--   ЗДДС Чл. 115 — кредитно известие required when tax base changes or supply
--                 is cancelled for an invoiced order; must reference the
--                 original фактура number; due within 5 days of the event
--   ЗСч  Чл. 6  — every business operation needs a primary accounting document;
--                 for non-VAT-registered traders this is the basis for credit
--                 notes on invoiced refunds
--
-- Auto-creation rule for credit_note rows (enforced at app layer):
--   Refund recorded → always inserts an order_refunds row.
--   Credit_note row is auto-created only if all three:
--     1. an invoices row of type='invoice' exists for the order
--     2. that row has invoice_number set (фактура actually issued in Microinvest)
--     3. order_refunds.affects_invoiced_supply = true
--
-- Pre-launch refactor — DB has no real data, columns are dropped without
-- backfill. Post-launch this would need a multi-step migration with column
-- backfill before drop.


-- ── 1. invoices table ───────────────────────────────────────────────────────
create table if not exists invoices (
  id                     uuid primary key default gen_random_uuid(),
  order_id               uuid not null references orders(id) on delete restrict,
  type                   text not null check (type in ('invoice', 'credit_note')),

  -- Credit note linkage (only set for type='credit_note')
  refund_id              uuid references order_refunds(id) on delete restrict,
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

  -- Type='invoice' shape: no refund/origin links; profile required (address minimum,
  -- mode-specific extras handled by separate constraints below).
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

-- One initial invoice per order
create unique index if not exists uq_invoices_one_per_order
  on invoices (order_id) where type = 'invoice';

-- One credit note per refund
create unique index if not exists uq_invoices_one_per_refund
  on invoices (refund_id) where refund_id is not null;

-- Microinvest invoice numbers globally unique when set
create unique index if not exists uq_invoices_invoice_number
  on invoices (invoice_number) where invoice_number is not null;

-- Lookup indexes
create index if not exists idx_invoices_order_id on invoices (order_id);
create index if not exists idx_invoices_type on invoices (type);
create index if not exists idx_invoices_pending
  on invoices (type) where invoice_number is null;
create index if not exists idx_invoices_due_at
  on invoices (due_at) where due_at is not null and invoice_number is null;

alter table invoices enable row level security;
create policy "Deny all on invoices" on invoices for all using (false) with check (false);


-- ── 2. invoices triggers ────────────────────────────────────────────────────

-- Maintain updated_at
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

drop trigger if exists trg_set_invoices_updated_at on invoices;
create trigger trg_set_invoices_updated_at
  before update on invoices
  for each row execute function set_invoices_updated_at();

-- Emit audit events on issuance (number_set) and on sent_at recording.
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

drop trigger if exists trg_emit_invoice_audit_events on invoices;
create trigger trg_emit_invoice_audit_events
  after update on invoices
  for each row execute function emit_invoice_audit_events();


-- ── 3. orders: drop invoice columns + their CHECK constraints + indexes ────
alter table orders drop constraint if exists chk_invoice_needs_fields;
alter table orders drop constraint if exists chk_invoice_company_fields;
alter table orders drop constraint if exists chk_invoice_individual_fields;
alter table orders drop constraint if exists chk_invoice_fields_cleared;

drop index if exists idx_orders_invoice_number;
drop index if exists idx_orders_needs_invoice;

alter table orders drop column if exists needs_invoice;
alter table orders drop column if exists invoice_type;
alter table orders drop column if exists invoice_company_name;
alter table orders drop column if exists invoice_eik;
alter table orders drop column if exists invoice_vat_number;
alter table orders drop column if exists invoice_mol;
alter table orders drop column if exists invoice_address;
alter table orders drop column if exists invoice_number;
alter table orders drop column if exists invoice_date;
alter table orders drop column if exists invoice_sent_at;


-- ── 4. order_refunds: drop credit_note_ref + add structured fields ─────────
alter table order_refunds drop constraint if exists chk_refund_credit_note_length;
alter table order_refunds drop column if exists credit_note_ref;

alter table order_refunds add column if not exists bank_transfer_ref text;
alter table order_refunds add column if not exists affects_invoiced_supply boolean not null default true;
alter table order_refunds add column if not exists credit_note_skip_reason text;

-- bank_transfer_ref required when method='bank_transfer'
alter table order_refunds add constraint chk_bank_transfer_method_has_ref
  check (method <> 'bank_transfer' or bank_transfer_ref is not null);
alter table order_refunds add constraint chk_bank_transfer_ref_length
  check (bank_transfer_ref is null or length(bank_transfer_ref) <= 200);

-- skip reason required when admin opts out of credit note
alter table order_refunds add constraint chk_skip_reason_when_skipping check (
  affects_invoiced_supply = true
  or (credit_note_skip_reason is not null and btrim(credit_note_skip_reason) <> '')
);
alter table order_refunds add constraint chk_skip_reason_length check (
  credit_note_skip_reason is null or length(credit_note_skip_reason) <= 500
);

create index if not exists idx_order_refunds_bank_transfer_ref
  on order_refunds (bank_transfer_ref) where bank_transfer_ref is not null;


-- ── 5. orders: replace emit_order_audit_events trigger function ────────────
-- Drop invoice_number_set and invoice_marked_sent branches — those events now
-- come from emit_invoice_audit_events on the invoices table.
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


-- ── 6. order_refunds: replace annotation-edit trigger ──────────────────────
-- Track diffs for the new mutable set: reason, bank_transfer_ref,
-- credit_note_skip_reason. credit_note_ref dropped (column removed).
create or replace function emit_order_refund_annotation_audit()
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


-- ── 7. order_refunds: extend append-only enforcement ───────────────────────
-- Mutable: reason, bank_transfer_ref, credit_note_skip_reason, updated_at.
-- Immutable: id, order_id, stripe_refund_id, client_idempotency_key,
-- amount_cents, method, source, recorded_by, refunded_at, created_at,
-- affects_invoiced_supply.
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
     or old.created_at is distinct from new.created_at
     or old.affects_invoiced_supply is distinct from new.affects_invoiced_supply then
    raise exception 'order_refunds financial fields are immutable; only reason, bank_transfer_ref, and credit_note_skip_reason may be edited';
  end if;
  return new;
end;
$$;


-- ── 8. dashboard_stats: add credit_notes_awaiting; switch to invoices table ─
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
    'awaiting_settlement', (select count(*) from orders where payment_method = 'cod' and delivered_at is not null and paid_at is null and status = 'delivered'),
    'inventory_debt_skus', (select count(*) from inventory_current where quantity < 0)
  ) into result
  from orders
  where created_at >= p_month_start and status != 'cancelled';

  return result;
end;
$$;
