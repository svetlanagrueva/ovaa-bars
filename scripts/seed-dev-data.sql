-- ══════════════════════════════════════════════════════════════════════════
-- LOCAL DEV SEED — populates a fresh DB with sample data for testing the
-- admin UI without going through real checkout flows.
--
-- Run AFTER `supabase db reset` (or against any fresh DB). Re-running on
-- top of existing seed data will fail on PK conflicts — wipe + reseed
-- instead. The inventory_log table is append-only at the trigger level,
-- so partial re-runs aren't really safe.
--
-- Usage:
--   docker cp scripts/seed-dev-data.sql supabase_db_pbars:/tmp/seed.sql
--   docker exec supabase_db_pbars psql -U postgres -d postgres -f /tmp/seed.sql
--
-- Or paste into Supabase Studio SQL Editor (http://127.0.0.1:54323).
-- ══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. Inventory: 2 batches per SKU × 5 units = 10 units per SKU ──────
-- Batch A: closer expiry (FEFO winner)
-- Batch B: later expiry
do $$
declare
  v_sku text;
  v_skus text[] := array[
    'EGO-DC-12',   -- Тъмен Шоколад Кутия
    'EGO-WCR-12',  -- Бял Шоколад с Малини Кутия
    'EGO-MIX-12'   -- Микс Кутия
  ];
begin
  foreach v_sku in array v_skus loop
    -- Earlier-expiry batch (FEFO picks first)
    insert into product_batches (sku, batch_number, expiry_date, status, created_by)
    values (v_sku, 'SEED-A-' || v_sku, current_date + interval '60 days', 'active', 'seed');

    insert into inventory_log (sku, type, quantity, batch_id, expiry_date, created_by)
    values (v_sku, 'batch_in', 5, 'SEED-A-' || v_sku, current_date + interval '60 days', 'seed');

    -- Later-expiry batch
    insert into product_batches (sku, batch_number, expiry_date, status, created_by)
    values (v_sku, 'SEED-B-' || v_sku, current_date + interval '180 days', 'active', 'seed');

    insert into inventory_log (sku, type, quantity, batch_id, expiry_date, created_by)
    values (v_sku, 'batch_in', 5, 'SEED-B-' || v_sku, current_date + interval '180 days', 'seed');
  end loop;
end;
$$;

-- ── 2. Orders: 5 in different statuses, made ~10 days ago ─────────────
-- Stock-deducting orders use reserve_inventory RPC for correct
-- inventory_log + inventory_current bookkeeping.
do $$
declare
  v_t10 timestamptz := now() - interval '10 days';
  v_order_id uuid;
begin
  -- ─ Order 1: pending (card) — no stock movement ─────────────────────
  insert into orders (id, created_at, email, first_name, last_name, phone, city, address, postal_code,
                      total_amount, shipping_fee, status, payment_method, logistics_partner)
  values ('aaaaaaaa-0001-0001-0001-000000000001', v_t10,
          'pending@seed.local', 'Иван', 'Петров', '+359888000001',
          'София', 'ул. Тестова 1', '1000',
          2570, 0, 'pending', 'card', 'speedy-address');

  insert into order_items (order_id, line_no, product_id, sku, product_name, quantity, unit_price_cents)
  values ('aaaaaaaa-0001-0001-0001-000000000001', 1,
          'egg-origin-dark-chocolate-box', 'EGO-DC-12', 'Тъмен Шоколад Кутия', 1, 2570);

  -- ─ Order 2: confirmed (COD, Econt office) ──────────────────────────
  insert into orders (id, created_at, confirmed_at, email, first_name, last_name, phone, city, address, postal_code,
                      total_amount, shipping_fee, cod_fee, status, payment_method, logistics_partner,
                      econt_office_id, econt_office_code, econt_office_name, econt_office_address,
                      cod_confirmed_at, cod_confirmed_by)
  values ('aaaaaaaa-0002-0002-0002-000000000002', v_t10, v_t10 + interval '1 hour',
          'confirmed@seed.local', 'Мария', 'Иванова', '+359888000002',
          'София', '', '',
          5340, 500, 200, 'confirmed', 'cod', 'econt-office',
          1056, '1056', 'София Център', 'тестов адрес',
          v_t10 + interval '2 hours', 'admin');

  insert into order_items (order_id, line_no, product_id, sku, product_name, quantity, unit_price_cents)
  values
    ('aaaaaaaa-0002-0002-0002-000000000002', 1, 'egg-origin-dark-chocolate-box', 'EGO-DC-12', 'Тъмен Шоколад Кутия', 1, 2570),
    ('aaaaaaaa-0002-0002-0002-000000000002', 2, 'egg-origin-mix-box', 'EGO-MIX-12', 'Микс Кутия', 1, 2570);

  perform reserve_inventory('EGO-DC-12',  1, 'aaaaaaaa-0002-0002-0002-000000000002');
  perform reserve_inventory('EGO-MIX-12', 1, 'aaaaaaaa-0002-0002-0002-000000000002');

  -- ─ Order 3: shipped (card, Speedy address) ─────────────────────────
  insert into orders (id, created_at, confirmed_at, shipped_at, email, first_name, last_name, phone, city, address, postal_code,
                      total_amount, shipping_fee, status, payment_method, logistics_partner,
                      tracking_number, seller_settled_at, stripe_payment_intent_id, order_confirmation_sent_at)
  values ('aaaaaaaa-0003-0003-0003-000000000003', v_t10, v_t10 + interval '1 hour', v_t10 + interval '2 days',
          'shipped@seed.local', 'Петър', 'Стоянов', '+359888000003',
          'Варна', 'ул. Тестова 3', '9000',
          2570, 0, 'shipped', 'card', 'speedy-address',
          'SEED-SP-3', v_t10 + interval '1 hour', 'pi_seed_3', v_t10 + interval '1 hour');

  insert into order_items (order_id, line_no, product_id, sku, product_name, quantity, unit_price_cents)
  values ('aaaaaaaa-0003-0003-0003-000000000003', 1,
          'egg-origin-white-chocolate-raspberry-box', 'EGO-WCR-12', 'Бял Шоколад с Малини Кутия', 1, 2570);

  perform reserve_inventory('EGO-WCR-12', 1, 'aaaaaaaa-0003-0003-0003-000000000003');

  -- ─ Order 4: delivered (card) — ~10.5 days ago triggers cross_sell ──
  -- email window (delivered_at between -11d and -10d). For review_request
  -- testing, change delivered_at to now() - interval '3 days 12 hours'.
  insert into orders (id, created_at, confirmed_at, shipped_at, delivered_at,
                      email, first_name, last_name, phone, city, address, postal_code,
                      total_amount, shipping_fee, status, payment_method, logistics_partner,
                      tracking_number, seller_settled_at, stripe_payment_intent_id, order_confirmation_sent_at)
  values ('aaaaaaaa-0004-0004-0004-000000000004',
          now() - interval '11 days', now() - interval '11 days',
          now() - interval '10 days 18 hours', now() - interval '10 days 12 hours',
          'delivered@seed.local', 'Светлана', 'Тодорова', '+359888000004',
          'Бургас', 'ул. Тестова 4', '8000',
          5140, 0, 'delivered', 'card', 'speedy-address',
          'SEED-SP-4', now() - interval '11 days', 'pi_seed_4', now() - interval '11 days');

  insert into order_items (order_id, line_no, product_id, sku, product_name, quantity, unit_price_cents)
  values ('aaaaaaaa-0004-0004-0004-000000000004', 1,
          'egg-origin-dark-chocolate-box', 'EGO-DC-12', 'Тъмен Шоколад Кутия', 2, 2570);

  perform reserve_inventory('EGO-DC-12', 2, 'aaaaaaaa-0004-0004-0004-000000000004');

  -- ─ Order 5: cancelled (COD) — reserve + restore for clean books ────
  insert into orders (id, created_at, cancelled_at, cancellation_reason,
                      email, first_name, last_name, phone, city, address, postal_code,
                      total_amount, shipping_fee, cod_fee, status, payment_method, logistics_partner)
  values ('aaaaaaaa-0005-0005-0005-000000000005', v_t10, v_t10 + interval '4 hours',
          'клиент промени мнение',
          'cancelled@seed.local', 'Георги', 'Димитров', '+359888000005',
          'Стара Загора', 'ул. Тестова 5', '6000',
          2770, 500, 200, 'cancelled', 'cod', 'speedy-address');

  insert into order_items (order_id, line_no, product_id, sku, product_name, quantity, unit_price_cents)
  values ('aaaaaaaa-0005-0005-0005-000000000005', 1,
          'egg-origin-mix-box', 'EGO-MIX-12', 'Микс Кутия', 1, 2570);

  perform reserve_inventory('EGO-MIX-12', 1, 'aaaaaaaa-0005-0005-0005-000000000005');
  perform restore_inventory('EGO-MIX-12', 1, 'aaaaaaaa-0005-0005-0005-000000000005');
end;
$$;

-- ── 3. Promo code ─────────────────────────────────────────────────────
insert into promo_codes (code, discount_type, discount_value, min_order_amount,
                         max_uses, starts_at, ends_at, is_active)
values ('SEED10', 'percentage', 10, 0,
        100, now(), now() + interval '90 days', true);

commit;

-- ──────────────────────────────────────────────────────────────────────
-- Net inventory after seed:
--   EGO-DC-12:   10 in − 1 (order 2) − 2 (order 4) = 7 sellable
--   EGO-WCR-12:  10 in − 1 (order 3)               = 9 sellable
--   EGO-MIX-12:  10 in − 1 (order 2) − 1 (order 5 reserved+restored = 0) = 9 sellable
--
-- Test customers (all use *@seed.local so they're easy to filter):
--   pending@seed.local      — order 1, just placed
--   confirmed@seed.local    — order 2, COD, awaiting shipment
--   shipped@seed.local      — order 3, in transit
--   delivered@seed.local    — order 4, in cross_sell email window
--   cancelled@seed.local    — order 5, admin cancelled
-- ──────────────────────────────────────────────────────────────────────
