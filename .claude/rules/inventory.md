# Inventory System

## Architecture
Two-table design:
- `inventory_log` — append-only event log. Every stock movement is a row with `before_quantity` / `after_quantity` snapshot columns.
- `inventory_current` — trigger-maintained running total. One row per SKU. Never write to this directly.

## Log entry types (`type` column)

### Existing (automated by the app)
- `batch_in` — admin adds stock; stores `batch_id`, `expiry_date`, optional `notes`
- `reserve` — stock decremented at checkout; stores `order_id`
- `restore` — stock returned on cancellation or expired Stripe session; stores `order_id`

### Planned (manual admin actions)
- `wholesale_out` — B2B shipment
- `sample_out` — marketing samples, giveaways
- `damaged` — write-off (opened returns, expired goods, physical damage)
- `return_in` — customer return restocked (unopened, sellable condition only)
- `adjustment_gain` — reconciliation: physical count > system count
- `adjustment_loss` — reconciliation: physical count < system count

### Return handling — not all returns go back to stock
- Unopened, sellable → `return_in` (increments inventory)
- Opened → `damaged` (does NOT increment — written off)
- Expired → `damaged` (does NOT increment)
- Lost package → no inventory movement at all (refund only, no stock change)
- Damaged stock must NEVER go back to sellable inventory

## Document linkage (НАП audit requirement)
Every inventory movement must be traceable to a justifying document. The `notes` field is not sufficient — structured references are required.

Planned columns on `inventory_log`:
- `reference_type` — `'order'` | `'invoice'` | `'return'` | `'internal'` — what document justifies this movement
- `reference_id` — the ID of the justifying document (order UUID, invoice number, return ref, internal protocol number)
- `created_by` — who recorded this movement (even if it's always the same admin for now, accountability is a legal requirement)

Without document linkage, the log is "notes" not an audit trail.

## Adjustment safety
`adjustment_gain` and `adjustment_loss` are the biggest audit risk (can hide theft, loss, bad accounting). They require:
- Mandatory note explaining the discrepancy
- Mandatory reason
- Should follow a physical stock count (reconciliation)

A "stock count" flow should capture: `counted_quantity`, `count_date`, then generate adjustment entries for any differences.

## Key constraints
- `quantity` is always **positive** (`CHECK quantity > 0`) — the `type` encodes the direction. Seed data and inserts must use ≥ 1.
- **`inventory_log` is immutable at the DB layer.** `BEFORE UPDATE` and `BEFORE DELETE` triggers (`trg_inventory_log_immutable_update`, `trg_inventory_log_immutable_delete`) raise unconditionally — no service-role bypass. The ledger is append-only, not just by convention. If data correction is needed, insert an offsetting movement (e.g. `adjustment_gain` / `adjustment_loss`) rather than trying to edit or delete an existing row.
- `update_inventory_current` is a `BEFORE INSERT` trigger that sets `NEW.before_quantity` / `NEW.after_quantity` directly, so no post-insert UPDATE is needed — the only write path to a log row is the initial INSERT.
- **Multiple `order_out` rows per `(order_id, sku)` are allowed.** The original `idx_inventory_log_order_out_unique` (migration `20260420144423`) enforced one row per order+SKU, encoding the "cart dedups by SKU" checkout-time assumption. Migration `20260424140000` drops the index — admin post-confirmation quantity edits via `edit_order_quantity` append a new `order_out` row per increase, so multiple rows for one (order_id, sku) is now a legitimate ledger state. `restore_inventory` already uses sum-based guards (sum of order_out minus sum of cancellation = net reserved), so correctness is unaffected. The cart itself still dedups by SKU at checkout (`lib/store/cart.ts:addItemWithQuantity`); the relaxation is only about the ledger supporting post-checkout edits.
- **Global-unique `idempotency_key`** for admin-initiated movements (batch_in, wholesale_out, sample_out, damaged, return_in, adjustment_*) — enforced by partial unique index. Callers generate UUID per form submission; double-submit raises unique violation, server action returns success (idempotent no-op). System-generated movements (order_out, cancellation) leave `idempotency_key` null.

## Refund ≠ Return (important distinction)
Refund tracking (refunded_at, refund_amount on orders table) and inventory tracking (inventory_log) are separate concerns:
- Returned item, sellable → refund YES + return_in (stock increments)
- Returned item, damaged → refund YES + damaged (stock does NOT increment)
- Lost package → refund YES + no inventory movement
- These must not be coupled blindly — the admin decides independently whether to refund and whether to restock

## Postgres Functions
- `reserve_inventory(p_sku, p_quantity, p_order_id)` — atomically decrements; **raises exception** if insufficient stock
- `restore_inventory(p_sku, p_quantity, p_order_id)` — atomically increments (cancellation / session expiry / partial cancel). Uses **sum-based guard**: `sum(cancellation quantities) + p_quantity` must not exceed `sum(order_out quantities)` for `(sku, order_id)`. Allows multiple cancellation rows per `(sku, order_id)` to support future partial-cancellation flow. **Raises** if no `order_out` exists, or if the sum invariant would be violated. Locks `inventory_current` row to serialize concurrent restores.

## Calling pattern — CRITICAL
Supabase query builder is thenable but **not a Promise subclass** — it has no `.catch()` method. Always use:
```typescript
const { error } = await supabase.rpc("restore_inventory", { p_sku, p_quantity, p_order_id })
if (error) console.error("Failed to restore inventory:", error)
```
Never chain `.catch()` on a Supabase call — throws `TypeError: supabase.rpc(...).catch is not a function`.

## Return cap (order-scoped, narrow)
A customer order ships N units of a SKU via `order_out` rows. Physical returns and return-related write-offs MUST NOT exceed N per `(order_id, sku)`.

**Scope — all four conditions must hold:**
- `order_id IS NOT NULL`
- `reference_type = 'return'`
- `type IN ('return_in', 'damaged')`
- (plus the movement is being inserted; UPDATE/DELETE blocked by append-only)

**Deliberately NOT capped:**
- `damaged` with `reference_type='internal'` — warehouse spoilage, breakage, expiry write-off. Unrelated to any customer order; could discover 50 units went bad in storage even if only 30 were ever shipped.
- `adjustment_gain` / `adjustment_loss` — per-SKU reconciliation from physical counts, not per-order returns.
- Any `return_in` / `damaged` without `order_id` — orphaned return handling (e.g. B2B returns).

**Where enforced:**
1. App-layer (primary): `recordStockMovement` in `app/actions/admin.ts` runs when the scope conditions match. Fetches `order_items` + sums prior return-scoped movements, rejects with a friendly Bulgarian message: `Не можете да върнете/бракувате повече бройки от изпратените за този артикул по тази поръчка (SKU X, изпратени N, вече върнати M, опит за K)`.
2. DB trigger (backstop): `trg_enforce_order_return_cap` in migration `20260423210000_enforce_order_return_cap.sql`. BEFORE INSERT only — relies on the `inventory_log` append-only triggers (migration `20260420150533_inventory_log_immutable.sql`) blocking UPDATE/DELETE so an already-capped row can't later become non-capped. Same Bulgarian wording as app-layer for consistent UX regardless of which layer catches the violation.

**Correction path:**
Since inventory_log is append-only, you cannot edit a bad row. Corrections are new rows:
- Over-returned by mistake → insert an offsetting `adjustment_loss` with `reference_type='internal'` (cap doesn't apply — adjustments aren't return-scoped).
- Missed a valid return → just append another `return_in` row for the remaining quantity (the cap permits it if under the shipped quantity).

## Non-negative stock policy (ledger vs snapshot distinction)
`inventory_log` is the **ledger** — append-only, reflects reality including operational debt, backdated corrections, discovered shortages. `inventory_current` is the **operational snapshot** used for sold-out decisions.

Policy (enforced by `update_inventory_current` trigger):
- `order_out` movements **cannot** drive `inventory_current.quantity < 0`. The trigger raises an exception. This is a backstop to `reserve_inventory`'s sufficiency check — customer-facing reservations must never go negative.
- Admin-initiated decrements (`wholesale_out`, `sample_out`, `damaged`, `adjustment_loss`) **may** drive quantity below zero. The DB's job is to record what happened truthfully; "we're short 5 units" is a valid state reflecting operational debt.

Negative `inventory_current` is surfaced in admin UI (red "Дълг" badge in inventory panel, counter "SKU в оперативен дълг" on dashboard). Admin reconciles via `batch_in` or `adjustment_gain`.

## Fail-open pattern
`getInventoryMap()` in `lib/inventory.ts` returns an **empty Map** on DB error — not a map of zeros.
- `inventoryMap.has(id) === false` → treat product as available (DB error / unknown state)
- `inventoryMap.has(id) && inventoryMap.get(id) <= 0` → confirmed sold out (zero OR negative — negative stock reads as sold out in customer-facing UI)

This prevents false sold-out UI on transient failures. Always use the `has()` guard before `get()`.

## Sold-out UI
- Product cards, product detail, homepage, products page: `soldOut` prop passed from server component
- Cart page: calls `checkCartInventory` server action on mount and when items change; uses `let cancelled = false` cleanup to avoid stale state
- `checkCartInventory` validates quantity (positive integer), fails open on DB error (returns `[]`)

## Webhook idempotency (expired Stripe sessions)
`checkout.session.expired` atomically updates `status = 'expired'` WHERE `status = 'pending'` before restoring inventory. Only the first webhook delivery wins; duplicates skip the restore. `expired` is a valid value in the orders status constraint.

## SKU ↔ Product mapping
`PRODUCTS` in `lib/products.ts` has a `sku` field. Inventory is keyed by SKU; the app maps product IDs → SKUs via this list. `addInventoryBatch` validates the incoming SKU against `PRODUCTS` before inserting.

## Admin Inventory Panel
- Route: `/admin/inventory`
- Server actions: `getInventoryStatus()` (fetches `inventory_current` + last 50 log entries in parallel), `addInventoryBatch()`, `getRecallCandidates()`
- Stock badge colours: red = 0, amber ≤ 20, green > 20
- Movement log shows: date, SKU, type badge, ±quantity, before/after, batch ID or order link, expiry date

## Recall traceability (approximation)
`getRecallCandidates(sku, fromDate?, toDate?)` queries `order_items !inner orders` for a SKU + non-terminal status (`confirmed`, `shipped`, `delivered`) + optional `orders.created_at` range. Returns flattened rows with all contact fields needed for customer outreach (name, email, phone, address, tracking). See `admin-panel.md` § "Recall / batch traceability export" for the UI + CSV shape.

**Scope deliberately over-approximate by SKU, not by batch.** We don't track which batch shipped to which order — no batch consumption ledger at ship time. So a recall on "batch X" returns ALL orders containing that SKU in the date window; admin does phone-level triage. This is fine at current volume (three SKUs, low order rate). If volume grows enough that the false-positive rate on recall lists becomes expensive, the upgrade path is a `shipped_batch_allocations` table populated FIFO at ship time — additive schema change, doesn't invalidate anything here.

## Running inventory SQL on a new database
Inventory tables, functions, trigger, and RLS policies are part of the initial schema migration at `supabase/migrations/20260420120000_initial_schema.sql`. On a fresh DB, apply all migrations in `supabase/migrations/` in filename order (see that directory's README.md for the workflow). For schema changes post-initial, add a new migration file rather than editing an existing one.
