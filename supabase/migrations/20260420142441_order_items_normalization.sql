-- Migration 20260420142441: Normalize orders.items JSONB into order_items table
-- Pre-launch: no data to migrate. This migration drops orders.items and creates
-- the proper child table. Subsequent app code reads/writes via order_items.

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

create index if not exists idx_order_items_order_id on order_items (order_id);
create index if not exists idx_order_items_sku on order_items (sku);

alter table order_items enable row level security;
create policy "Deny all on order_items" on order_items
  for all using (false) with check (false);

-- Drop the obsolete JSONB column.
alter table orders drop column if exists items;

-- Rebuild claim_marketing_emails RPC: items are now reconstructed from
-- order_items via jsonb_agg so downstream callers keep the same payload shape
-- (productId, productName, quantity, priceInCents).
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
