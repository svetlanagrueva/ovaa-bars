-- ──────────────────────────────────────────────────────────────────────────
-- Rename orders.paid_at → orders.seller_settled_at (semantic split)
-- ──────────────────────────────────────────────────────────────────────────
--
-- Background. orders.paid_at was dual-purpose:
--   - Card: when Stripe captured (≈ when seller has the money)
--   - COD:  when courier remitted to seller (≠ when customer paid; the
--           customer paid the courier weeks earlier on delivery)
--
-- For COD this conflated "customer paid us" with "we have the money in our
-- bank." A real bug already came from this: the refund gate originally
-- read `!order.paid_at`, blocking refunds for COD orders the customer had
-- paid but the courier hadn't yet remitted. We patched it with a
-- `(payment_method = 'cod' && status = 'delivered')` workaround — that
-- patch is workaround for the missing semantic.
--
-- Resolution after reviewing Shopify's model: don't add a separate
-- customer_paid_at column. For COD the customer-paid moment IS
-- delivered_at (cash and parcel exchange hands at the same instant via
-- ППП), so it's already in the schema. Just rename the existing column
-- to its true meaning ("seller has been settled with") and let
-- application code derive customer-paid by combining with delivered_at.
--
-- Column rename only — no backfill needed (values unchanged). All triggers
-- and RPCs that referenced paid_at are redefined below to reference
-- seller_settled_at.
--
-- Audit-log historical events with event_type='paid_at_recorded' remain
-- in order_audit_events (the table is immutable). New events fire as
-- 'seller_settled_at_recorded'. The TIMELINE_EVENT_TYPES whitelist
-- excludes both — this branch is covered by a column-derived "Плащане
-- получено" row that reads from orders.seller_settled_at directly, so
-- the rename is invisible in the timeline UX.

-- ── 1. Rename the column ──────────────────────────────────────────────────
alter table orders rename column paid_at to seller_settled_at;

-- ── 2. Redefine emit_order_audit_events (latest body from
--      20260428072545_invoices_table.sql, with paid_at → seller_settled_at
--      and event_type 'paid_at_recorded' → 'seller_settled_at_recorded') ──
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

-- ── 3. Redefine dashboard_stats (latest body from
--      20260429071812_withdrawals_table.sql, with paid_at →
--      seller_settled_at in the awaiting_settlement predicate) ────────────
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
    'withdrawals_pending', (select count(*) from withdrawals where status in ('requested', 'approved', 'goods_received'))
  ) into result
  from orders
  where created_at >= p_month_start and status != 'cancelled';

  return result;
end;
$$;
