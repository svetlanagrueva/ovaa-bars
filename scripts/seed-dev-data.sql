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

-- Two more batches for EGO-DC-12 only — exercise the override paths in the
-- "Партиди" card without bloating the seed for every SKU.
--
-- Near-expiry: 3 units, expires in 5 days. FEFO will pick this first;
--              admin sees a tight expiry next to the FEFO suggestion.
-- Expired:     2 units, expired 30 days ago. Hidden from the dropdown
--              by default; revealed via "Покажи изтекли партиди" + the
--              red override checkbox + reason ≥ 20 chars.
insert into product_batches (sku, batch_number, expiry_date, status, created_by)
values ('EGO-DC-12', 'SEED-NEAR-EGO-DC-12', current_date + interval '5 days', 'active', 'seed');
insert into inventory_log (sku, type, quantity, batch_id, expiry_date, created_by)
values ('EGO-DC-12', 'batch_in', 3, 'SEED-NEAR-EGO-DC-12', current_date + interval '5 days', 'seed');

insert into product_batches (sku, batch_number, expiry_date, status, created_by)
values ('EGO-DC-12', 'SEED-EXPIRED-EGO-DC-12', current_date - interval '30 days', 'active', 'seed');
insert into inventory_log (sku, type, quantity, batch_id, expiry_date, created_by)
values ('EGO-DC-12', 'batch_in', 2, 'SEED-EXPIRED-EGO-DC-12', current_date - interval '30 days', 'seed');

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
  values ('11111111-1111-1111-1111-111111111111', v_t10,
          'pending@seed.local', 'Иван', 'Петров', '+359888000001',
          'София', 'ул. Тестова 1', '1000',
          2570, 0, 'pending', 'card', 'speedy-address');

  insert into order_items (order_id, line_no, product_id, sku, product_name, quantity, unit_price_cents)
  values ('11111111-1111-1111-1111-111111111111', 1,
          'egg-origin-dark-chocolate-box', 'EGO-DC-12', 'Тъмен Шоколад Кутия', 1, 2570);

  -- ─ Order 2: confirmed (COD, Econt office) ──────────────────────────
  insert into orders (id, created_at, confirmed_at, email, first_name, last_name, phone, city, address, postal_code,
                      total_amount, shipping_fee, cod_fee, status, payment_method, logistics_partner,
                      econt_office_id, econt_office_code, econt_office_name, econt_office_address,
                      cod_confirmed_at, cod_confirmed_by)
  values ('22222222-2222-2222-2222-222222222222', v_t10, v_t10 + interval '1 hour',
          'confirmed@seed.local', 'Мария', 'Иванова', '+359888000002',
          'София', '', '',
          5340, 500, 200, 'confirmed', 'cod', 'econt-office',
          1056, '1056', 'София Център', 'тестов адрес',
          v_t10 + interval '2 hours', 'admin');

  insert into order_items (order_id, line_no, product_id, sku, product_name, quantity, unit_price_cents)
  values
    ('22222222-2222-2222-2222-222222222222', 1, 'egg-origin-dark-chocolate-box', 'EGO-DC-12', 'Тъмен Шоколад Кутия', 1, 2570),
    ('22222222-2222-2222-2222-222222222222', 2, 'egg-origin-mix-box', 'EGO-MIX-12', 'Микс Кутия', 1, 2570);

  perform reserve_inventory('EGO-DC-12',  1, '22222222-2222-2222-2222-222222222222');
  perform reserve_inventory('EGO-MIX-12', 1, '22222222-2222-2222-2222-222222222222');

  -- ─ Order 3: shipped (card, Speedy address) ─────────────────────────
  insert into orders (id, created_at, confirmed_at, shipped_at, email, first_name, last_name, phone, city, address, postal_code,
                      total_amount, shipping_fee, status, payment_method, logistics_partner,
                      tracking_number, seller_settled_at, stripe_payment_intent_id, order_confirmation_sent_at)
  values ('33333333-3333-3333-3333-333333333333', v_t10, v_t10 + interval '1 hour', v_t10 + interval '2 days',
          'shipped@seed.local', 'Петър', 'Стоянов', '+359888000003',
          'Варна', 'ул. Тестова 3', '9000',
          2570, 0, 'shipped', 'card', 'speedy-address',
          'SEED-SP-3', v_t10 + interval '1 hour', 'pi_seed_3', v_t10 + interval '1 hour');

  insert into order_items (order_id, line_no, product_id, sku, product_name, quantity, unit_price_cents)
  values ('33333333-3333-3333-3333-333333333333', 1,
          'egg-origin-white-chocolate-raspberry-box', 'EGO-WCR-12', 'Бял Шоколад с Малини Кутия', 1, 2570);

  perform reserve_inventory('EGO-WCR-12', 1, '33333333-3333-3333-3333-333333333333');

  -- ─ Order 4: delivered (card) — ~10.5 days ago triggers cross_sell ──
  -- email window (delivered_at between -11d and -10d). For review_request
  -- testing, change delivered_at to now() - interval '3 days 12 hours'.
  insert into orders (id, created_at, confirmed_at, shipped_at, delivered_at,
                      email, first_name, last_name, phone, city, address, postal_code,
                      total_amount, shipping_fee, status, payment_method, logistics_partner,
                      tracking_number, seller_settled_at, stripe_payment_intent_id, order_confirmation_sent_at)
  values ('44444444-4444-4444-4444-444444444444',
          now() - interval '11 days', now() - interval '11 days',
          now() - interval '10 days 18 hours', now() - interval '10 days 12 hours',
          'delivered@seed.local', 'Светлана', 'Тодорова', '+359888000004',
          'Бургас', 'ул. Тестова 4', '8000',
          5140, 0, 'delivered', 'card', 'speedy-address',
          'SEED-SP-4', now() - interval '11 days', 'pi_seed_4', now() - interval '11 days');

  insert into order_items (order_id, line_no, product_id, sku, product_name, quantity, unit_price_cents)
  values ('44444444-4444-4444-4444-444444444444', 1,
          'egg-origin-dark-chocolate-box', 'EGO-DC-12', 'Тъмен Шоколад Кутия', 2, 2570);

  perform reserve_inventory('EGO-DC-12', 2, '44444444-4444-4444-4444-444444444444');

  -- ─ Order 5: cancelled (COD) — reserve + restore for clean books ────
  insert into orders (id, created_at, cancelled_at, cancellation_reason,
                      email, first_name, last_name, phone, city, address, postal_code,
                      total_amount, shipping_fee, cod_fee, status, payment_method, logistics_partner)
  values ('55555555-5555-5555-5555-555555555555', v_t10, v_t10 + interval '4 hours',
          'клиент промени мнение',
          'cancelled@seed.local', 'Георги', 'Димитров', '+359888000005',
          'Стара Загора', 'ул. Тестова 5', '6000',
          2770, 500, 200, 'cancelled', 'cod', 'speedy-address');

  insert into order_items (order_id, line_no, product_id, sku, product_name, quantity, unit_price_cents)
  values ('55555555-5555-5555-5555-555555555555', 1,
          'egg-origin-mix-box', 'EGO-MIX-12', 'Микс Кутия', 1, 2570);

  perform reserve_inventory('EGO-MIX-12', 1, '55555555-5555-5555-5555-555555555555');
  perform restore_inventory('EGO-MIX-12', 1, '55555555-5555-5555-5555-555555555555');

  -- ─ Order 6: delivered ~3.5 days ago — review_request cron window ───
  -- (delivered_at >= now - 4d AND delivered_at < now - 3d)
  insert into orders (id, created_at, confirmed_at, shipped_at, delivered_at,
                      email, first_name, last_name, phone, city, address, postal_code,
                      total_amount, shipping_fee, status, payment_method, logistics_partner,
                      tracking_number, seller_settled_at, stripe_payment_intent_id, order_confirmation_sent_at)
  values ('66666666-6666-6666-6666-666666666666',
          now() - interval '4 days', now() - interval '4 days',
          now() - interval '3 days 18 hours', now() - interval '3 days 12 hours',
          'review-window@seed.local', 'Анна', 'Колева', '+359888000006',
          'Русе', 'ул. Тестова 6', '7000',
          2570, 0, 'delivered', 'card', 'speedy-address',
          'SEED-SP-6', now() - interval '4 days', 'pi_seed_6', now() - interval '4 days');

  insert into order_items (order_id, line_no, product_id, sku, product_name, quantity, unit_price_cents)
  values ('66666666-6666-6666-6666-666666666666', 1,
          'egg-origin-white-chocolate-raspberry-box', 'EGO-WCR-12', 'Бял Шоколад с Малини Кутия', 1, 2570);

  perform reserve_inventory('EGO-WCR-12', 1, '66666666-6666-6666-6666-666666666666');

  -- ─ Order 7: delivered ~15 days ago — outside BOTH cron windows ─────
  -- Verifies the cron correctly skips orders past the cross_sell window.
  insert into orders (id, created_at, confirmed_at, shipped_at, delivered_at,
                      email, first_name, last_name, phone, city, address, postal_code,
                      total_amount, shipping_fee, status, payment_method, logistics_partner,
                      tracking_number, seller_settled_at, stripe_payment_intent_id, order_confirmation_sent_at)
  values ('77777777-7777-7777-7777-777777777777',
          now() - interval '16 days', now() - interval '16 days',
          now() - interval '15 days 12 hours', now() - interval '15 days 6 hours',
          'past-window@seed.local', 'Никола', 'Маринов', '+359888000007',
          'Плевен', 'ул. Тестова 7', '5800',
          2570, 0, 'delivered', 'card', 'speedy-address',
          'SEED-SP-7', now() - interval '16 days', 'pi_seed_7', now() - interval '16 days');

  insert into order_items (order_id, line_no, product_id, sku, product_name, quantity, unit_price_cents)
  values ('77777777-7777-7777-7777-777777777777', 1,
          'egg-origin-mix-box', 'EGO-MIX-12', 'Микс Кутия', 1, 2570);

  perform reserve_inventory('EGO-MIX-12', 1, '77777777-7777-7777-7777-777777777777');
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
--   EGO-DC-12:   5+5+3+2 in − 1 (order 2) − 2 (order 4)               = 12 sellable
--                  (3 of those expire in 5 days; 2 are already expired)
--   EGO-WCR-12:  10 in − 1 (order 3) − 1 (order 6)                    = 8 sellable
--   EGO-MIX-12:  10 in − 1 (order 2) − 0 (order 5 reserved+restored) − 1 (order 7) = 8 sellable
--
-- Test customers (all use *@seed.local so they're easy to filter):
--   pending@seed.local        — order 1, just placed
--   confirmed@seed.local      — order 2, COD, awaiting shipment
--   shipped@seed.local        — order 3, in transit
--   delivered@seed.local      — order 4, in cross_sell email window (~10.5d ago)
--   cancelled@seed.local      — order 5, admin cancelled
--   review-window@seed.local  — order 6, in review_request window (~3.5d ago)
--   past-window@seed.local    — order 7, outside both cron windows (~15d ago)
--
-- Batch testing (EGO-DC-12 has the variety):
--   SEED-A-EGO-DC-12       — 5 units, +60 days expiry (FEFO winner)
--   SEED-B-EGO-DC-12       — 5 units, +180 days expiry
--   SEED-NEAR-EGO-DC-12    — 3 units, +5 days expiry (near-expiry — earlier
--                              than SEED-A so this is the actual FEFO winner)
--   SEED-EXPIRED-EGO-DC-12 — 2 units, -30 days expiry (expired —
--                              hidden until "Покажи изтекли партиди" toggled)
-- ──────────────────────────────────────────────────────────────────────
