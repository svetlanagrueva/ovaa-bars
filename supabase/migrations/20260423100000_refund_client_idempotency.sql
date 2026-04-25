-- Migration 20260423100000: client idempotency for order_refunds
--
-- Fixes two gaps in the refund flow:
--
--   1. Bank-transfer refunds had no idempotency key. stripe_refund_id is the
--      natural key for gateway-issued refunds, but bank-transfer rows had
--      nothing unique — a double-submit (network retry, admin tab duplicate)
--      could create two identical rows.
--
--   2. Inventory-wiring atomicity. When recordRefund also inserts inventory_log
--      rows (return_in / damaged), those rows use deterministic
--      idempotency_key values of the form `<client_key>-<sku>-<disposition>`,
--      which piggybacks on the same client UUID. Without a stable
--      client-supplied key on the refund itself, the rest of the chain can't
--      compose correctly.
--
-- The admin UI generates a single UUID per form submission and sends it with
-- every related insert. The server action checks this key up-front: if a row
-- already exists, it's a retry — return the existing refund id without
-- re-inserting (and re-attempt the inventory inserts, which are idempotent
-- via their own deterministic keys).

alter table order_refunds add column if not exists client_idempotency_key uuid;

-- Partial unique index: webhook-originated rows (no client UUID) don't
-- participate; admin-ui rows all carry one and must collide on retry.
create unique index if not exists idx_order_refunds_client_idempotency_unique
  on order_refunds (client_idempotency_key)
  where client_idempotency_key is not null;
