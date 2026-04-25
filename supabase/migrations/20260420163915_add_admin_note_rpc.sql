-- Migration 20260420163915: add_admin_note RPC (atomic JSONB append)
--
-- The previous server-action implementation fetched admin_notes, appended a
-- new entry in JS, then UPDATEd the full array. Two concurrent addAdminNote
-- calls would both read the same array, both append their note locally, and
-- both write back — last write wins, one note silently lost.
--
-- This RPC replaces that read-modify-write pattern with a single atomic
-- `admin_notes || jsonb_build_object(...)` UPDATE. Each call appends exactly
-- one entry; concurrent calls serialize safely at the row level.
--
-- Author field: new entries include author for attribution. Single-admin
-- pre-launch defaults to 'admin'; when per-user auth lands (L14), callers
-- will pass the real user identifier.

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
