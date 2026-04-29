-- Rename order_refunds → refunds.
--
-- The "order_" prefix added noise without clarifying the table's purpose
-- — refunds are always tied to an order via order_id, so the prefix is
-- redundant. After this migration:
--   - Table:    refunds
--   - Indexes:  idx_refunds_*, uq_refunds_*
--   - Triggers: trg_refunds_*, trg_emit_refund_*
--   - Functions:enforce_refunds_*, set_refunds_*, emit_refund_*, raise_refunds_*
--   - FK targets on invoices.refund_id and withdrawals.refund_id stay valid
--     automatically (Postgres tracks FK references by OID).
--   - Error message text in trigger functions updated to read "refunds".

-- ── 1. Rename the table ────────────────────────────────────────────────────
alter table order_refunds rename to refunds;

-- ── 2. Rename indexes ─────────────────────────────────────────────────────
alter index if exists idx_order_refunds_stripe_id rename to idx_refunds_stripe_id;
alter index if exists idx_order_refunds_client_idempotency_unique rename to idx_refunds_client_idempotency_unique;
alter index if exists idx_order_refunds_order_id rename to idx_refunds_order_id;
alter index if exists idx_order_refunds_bank_transfer_ref rename to idx_refunds_bank_transfer_ref;
alter index if exists idx_order_refunds_withdrawal_id rename to idx_refunds_withdrawal_id;
alter index if exists uq_order_refunds_withdrawal_id rename to uq_refunds_withdrawal_id;

-- ── 3. Rename triggers (binding stays on the now-renamed `refunds` table) ──
alter trigger trg_enforce_refund_total on refunds rename to trg_refunds_enforce_total;
alter trigger trg_order_refunds_append_only_update on refunds rename to trg_refunds_append_only_update;
alter trigger trg_set_order_refunds_updated_at on refunds rename to trg_refunds_set_updated_at;
alter trigger trg_emit_order_refund_audit on refunds rename to trg_refunds_emit_audit;
alter trigger trg_emit_order_refund_annotation_audit on refunds rename to trg_refunds_emit_annotation_audit;
alter trigger trg_order_refunds_immutable_delete on refunds rename to trg_refunds_immutable_delete;

-- ── 4. Rename functions and update bodies that hard-coded the old name ────

-- enforce_refund_total — body references public.order_refunds. Rewrite it
-- to use the new table name and rename to enforce_refunds_total for symmetry.
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

-- Rebind the trigger to the new function and drop the old one.
drop trigger if exists trg_refunds_enforce_total on refunds;
create trigger trg_refunds_enforce_total
  before insert or update on refunds
  for each row execute function enforce_refunds_total();
drop function if exists enforce_refund_total();

-- set_order_refunds_updated_at → set_refunds_updated_at
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

drop trigger if exists trg_refunds_set_updated_at on refunds;
create trigger trg_refunds_set_updated_at
  before update on refunds
  for each row execute function set_refunds_updated_at();
drop function if exists set_order_refunds_updated_at();

-- emit_order_refund_audit → emit_refund_audit (no body table refs;
-- replacing wholesale to also pick up the post-invoice-refactor payload)
create or replace function emit_refund_audit()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_actor text := coalesce(current_setting('app.actor', true), new.recorded_by)
;
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

drop trigger if exists trg_refunds_emit_audit on refunds;
create trigger trg_refunds_emit_audit
  after insert on refunds
  for each row execute function emit_refund_audit();
drop function if exists emit_order_refund_audit();

-- emit_order_refund_annotation_audit → emit_refund_annotation_audit
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

drop trigger if exists trg_refunds_emit_annotation_audit on refunds;
create trigger trg_refunds_emit_annotation_audit
  after update on refunds
  for each row execute function emit_refund_annotation_audit();
drop function if exists emit_order_refund_annotation_audit();

-- enforce_order_refunds_append_only_update → enforce_refunds_append_only_update
-- (also updates the user-facing error message text)
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

drop trigger if exists trg_refunds_append_only_update on refunds;
create trigger trg_refunds_append_only_update
  before update on refunds
  for each row execute function enforce_refunds_append_only_update();
drop function if exists enforce_order_refunds_append_only_update();

-- raise_order_refunds_immutable_delete → raise_refunds_immutable_delete
create or replace function raise_refunds_immutable_delete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'refunds is append-only; DELETE is not permitted. To correct a mistake, create a reversing refund (phase 2) or apply a manual data repair.';
end;
$$;

drop trigger if exists trg_refunds_immutable_delete on refunds;
create trigger trg_refunds_immutable_delete
  before delete on refunds
  for each row execute function raise_refunds_immutable_delete();
drop function if exists raise_order_refunds_immutable_delete();
