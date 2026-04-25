-- Migration 20260420151910: Order status state-machine trigger
--
-- Enforces the finalized state graph at the DB layer:
--
--   pending   → {confirmed, expired, cancelled}
--   confirmed → {shipped, cancelled}
--   shipped   → {delivered}             (no shipped → cancelled; post-shipment
--                                         exceptions via refund + outcome events)
--   delivered | cancelled | expired     → terminal
--
-- Trigger fires only when OLD.status IS DISTINCT FROM NEW.status so legacy
-- rows can still have other columns updated without passing the status check.
--
-- Data-repair path: force_status_override RPC sets a transaction-local session
-- variable that bypasses the trigger. Requires a reason (≥ 20 chars) and
-- writes a status_force_override audit event BEFORE the update, so any repair
-- is always traceable.

create or replace function enforce_order_status_transition()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_bypass text := current_setting('app.allow_status_override', true);
begin
  -- No-op when status is unchanged — other column updates on legacy rows pass through.
  if old.status is not distinct from new.status then
    return new;
  end if;

  -- Repair bypass (set by force_status_override RPC, transaction-local).
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

create trigger trg_enforce_order_status_transition
before update on orders
for each row execute function enforce_order_status_transition();

-- ─── force_status_override RPC ─────────────────────────────────────────────
-- Data-repair path. Writes an audit event, then bypasses the state-machine
-- trigger for the duration of this transaction only.
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

  -- Audit event BEFORE the update: if this insert fails the repair aborts
  -- before state is changed, preserving the invariant that every override is
  -- recorded. order_audit_events immutability triggers block any post-hoc edits.
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

  -- Transaction-local bypass (third arg = true → LOCAL). Does not leak to
  -- other transactions in the same connection.
  perform set_config('app.allow_status_override', 'true', true);

  update public.orders
  set status = p_new_status
  where id = p_order_id;

  -- Reset defensively; the transaction-local scope already clears this at commit.
  perform set_config('app.allow_status_override', 'false', true);
end;
$$;
