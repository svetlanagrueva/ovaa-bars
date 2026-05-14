# Inventory System

## Architecture
Two-table design plus separate batch traceability layer:
- `inventory_log` — append-only event log. Every stock movement is a row with `before_quantity` / `after_quantity` snapshot columns.
- `inventory_current` — trigger-maintained running total. One row per SKU. Never write to this directly.
- `product_batches` + `order_item_batches` — Tier 1 batch traceability layer (see below). Independent of `inventory_log`; both layers must be consistent (sum of inflows from log ≈ batches; allocations recorded at ship time).

## Log entry types (`type` column)

### Automated by the app
- `batch_in` — admin adds stock; stores `batch_id`, `expiry_date`, optional `notes`. Also seeds a `product_batches` row when the (sku, batch_number) is new.
- `order_out` — stock decremented at checkout; stores `order_id`. Multiple rows per `(order_id, sku)` allowed (post-confirmation quantity edits via `edit_order_quantity` append additional rows on increase).
- `cancellation` — stock returned on cancellation or expired Stripe session; stores `order_id`. Multiple rows per `(order_id, sku)` allowed.

### Manual admin actions
- `wholesale_out` — B2B shipment. **Requires `batch_id`** for EU 931/2011 commercial-consignment compliance.
- `sample_out` — marketing samples, giveaways
- `damaged` — write-off (opened returns, expired goods, physical damage)
- `return_in` — customer return restocked (unopened, sellable condition only)
- `adjustment_gain` — reconciliation: physical count > system count
- `adjustment_loss` — reconciliation: physical count < system count

### Return handling — not all returns go back to stock
- Unopened, sellable → `return_in` (increments inventory)
- Opened → `damaged` (audit-only on inventory_current; see below)
- Expired → `damaged` (audit-only on inventory_current)
- Lost package → no inventory movement at all (refund only, no stock change)
- Damaged stock must NEVER go back to sellable inventory

## Customer-return damaged is audit-only on `inventory_current`
Migration `20260429092947` changed `update_inventory_current` to treat `damaged` rows differently by scope:
- `damaged` with `reference_type='return' AND order_id IS NOT NULL` → **audit-only**, delta is 0. The unit was already removed from sellable via `order_out` at ship time; this row records its disposition (destroyed) but does not double-decrement. before_quantity == after_quantity on these rows; UI displays as "0 (audit)".
- `damaged` otherwise (warehouse-internal write-off with `reference_type='internal'`, expiry, breakage) → real subtraction from sellable, as before.

Rationale: mirrors Shopify's bucket model (sellable + damaged as separate accounting buckets). Net change to sellable for a customer-return damaged unit is 0 — the move is sellable→damaged at ship time + return time. The previous trigger applied -1 on every `damaged` row, which combined with the order's `order_out` -1 to produce phantom -2 ("operational debt") on the dashboard.

The return cap (chk + trigger) still applies independently — customer can't return-damage more than was shipped. The cap is about goods-flow legitimacy, regardless of how the row affects the sellable bucket.

## Document linkage (НАП audit requirement)
Every inventory movement must be traceable to a justifying document. The `notes` field is not sufficient — structured references are required.

Columns on `inventory_log`:
- `reference_type` — `'order'` | `'invoice'` | `'return'` | `'internal'` — what document justifies this movement
- `reference_id` — the ID of the justifying document (order UUID, invoice number, refund UUID, internal protocol number)
- `created_by` — who recorded this movement
- `idempotency_key` — UUID per admin form submission; partial unique index rejects double-submit at DB layer

Without document linkage, the log is "notes" not an audit trail.

## Adjustment safety
`adjustment_gain` and `adjustment_loss` are the biggest audit risk (can hide theft, loss, bad accounting). They require:
- Mandatory note explaining the discrepancy
- Mandatory reason
- Should follow a physical stock count (reconciliation)

A "stock count" flow should capture: `counted_quantity`, `count_date`, then generate adjustment entries for any differences.

## Key constraints
- `quantity` is always **positive** (`CHECK quantity > 0`) — the `type` encodes the direction. Seed data and inserts must use ≥ 1.
- **`inventory_log` is immutable at the DB layer.** `BEFORE UPDATE` and `BEFORE DELETE` triggers raise unconditionally — no service-role bypass. The ledger is append-only, not just by convention. If data correction is needed, insert an offsetting movement (e.g. `adjustment_gain` / `adjustment_loss`) rather than trying to edit or delete an existing row.
- `update_inventory_current` is a `BEFORE INSERT` trigger that sets `NEW.before_quantity` / `NEW.after_quantity` directly, so no post-insert UPDATE is needed — the only write path to a log row is the initial INSERT.
- **Multiple `order_out` rows per `(order_id, sku)` are allowed.** The original `idx_inventory_log_order_out_unique` was dropped — admin post-confirmation quantity edits via `edit_order_quantity` append a new `order_out` row per increase. `restore_inventory` uses sum-based guards (sum of order_out minus sum of cancellation = net reserved), so correctness is unaffected. The cart still dedups by SKU at checkout.
- **Global-unique `idempotency_key`** for admin-initiated movements (batch_in, wholesale_out, sample_out, damaged, return_in, adjustment_*) — enforced by partial unique index. Callers generate UUID per form submission; double-submit raises unique violation, server action returns success (idempotent no-op). System-generated movements (order_out, cancellation) leave `idempotency_key` null.

## Refund ≠ Return (important distinction)
Refund tracking (`refunds` table) and inventory tracking (`inventory_log`) are separate concerns:
- Returned item, sellable → refund YES + return_in (stock increments)
- Returned item, damaged → refund YES + damaged (audit-only, sellable unchanged)
- Lost package → refund YES + no inventory movement
- These must not be coupled blindly — the admin decides independently whether to refund and whether to restock

`refund_items` adds an explicit per-line monetary allocation layer — independent of inventory. Used when a refund covers a price reduction or shipping dispute where no goods physically move. See `database-schema.md` § Refund Items Table.

## Postgres Functions
- `reserve_inventory(p_sku, p_quantity, p_order_id)` — atomically decrements; **raises exception** if insufficient stock
- `restore_inventory(p_sku, p_quantity, p_order_id)` — atomically increments (cancellation / session expiry / partial cancel). Uses **sum-based guard**: `sum(cancellation quantities) + p_quantity` must not exceed `sum(order_out quantities)` for `(sku, order_id)`. Allows multiple cancellation rows per `(sku, order_id)`. **Raises** if no `order_out` exists, or if the sum invariant would be violated. Locks `inventory_current` row to serialize concurrent restores.
- `batch_quantity_available(p_batch_id uuid)` — derives current available units of a batch from `inventory_log` (in: batch_in/return_in/adjustment_gain matching sku+batch_number; out: damaged/wholesale_out/sample_out/adjustment_loss matching sku+batch_number, EXCLUDING customer-return-damaged) minus `order_item_batches` allocated to confirmed/shipped/delivered orders. Cancelled releases the allocation.
- `affected_orders_for_batch(p_batch_id uuid)` — returns recall worklist (orders containing the batch in `confirmed|shipped|delivered` status) with contact + tracking fields. Sort: shipped_at desc, then created_at desc.

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
- `damaged` with `reference_type='internal'` — warehouse spoilage, breakage, expiry write-off. Unrelated to any customer order.
- `adjustment_gain` / `adjustment_loss` — per-SKU reconciliation from physical counts, not per-order returns.
- Any `return_in` / `damaged` without `order_id` — orphaned return handling (e.g. B2B returns).

**Where enforced:**
1. App-layer (primary): `recordStockMovement` in `app/actions/admin.ts` runs when the scope conditions match. Fetches `order_items` + sums prior return-scoped movements, rejects with: `Не можете да върнете/бракувате повече бройки от изпратените за този артикул по тази поръчка (SKU X, изпратени N, вече върнати M, опит за K)`.
2. DB trigger (backstop): `trg_enforce_order_return_cap`. BEFORE INSERT only — relies on the inventory_log append-only triggers blocking UPDATE/DELETE.

**Correction path:**
Since inventory_log is append-only, you cannot edit a bad row. Corrections are new rows:
- Over-returned by mistake → insert an offsetting `adjustment_loss` with `reference_type='internal'` (cap doesn't apply).
- Missed a valid return → just append another `return_in` row for the remaining quantity.

## Non-negative stock policy (ledger vs snapshot distinction)
`inventory_log` is the **ledger** — append-only, reflects reality including operational debt, backdated corrections, discovered shortages. `inventory_current` is the **operational snapshot** used for sold-out decisions.

Policy (enforced by `update_inventory_current` trigger):
- `order_out` movements **cannot** drive `inventory_current.quantity < 0`. The trigger raises an exception. Backstop to `reserve_inventory`'s sufficiency check.
- Admin-initiated decrements (`wholesale_out`, `sample_out`, `damaged`-internal, `adjustment_loss`) **may** drive quantity below zero. The DB's job is to record what happened truthfully.
- Customer-return-damaged (`damaged` + `reference_type='return'` + `order_id` set) → audit-only, delta=0 (see § Customer-return damaged is audit-only).

Negative `inventory_current` is surfaced in admin UI (red "Дълг" badge in inventory panel, counter "SKU в оперативен дълг" on dashboard). Admin reconciles via `batch_in` or `adjustment_gain`.

## Fail-open pattern
`getInventoryMap()` in `lib/inventory.ts` returns an **empty Map** on DB error — not a map of zeros.
- `inventoryMap.has(id) === false` → treat product as available (DB error / unknown state)
- `inventoryMap.has(id) && inventoryMap.get(id) <= 0` → confirmed sold out (zero OR negative reads as sold out in customer-facing UI)

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
- Server actions: `getInventoryStatus()` (fetches `inventory_current` + last 50 log entries in parallel), `addInventoryBatch()`, `getRecallCandidates()`, `recordStockMovement()`
- Stock badge colours: red = 0, amber ≤ 20, green > 20
- Movement log shows: date, SKU, type badge, ±quantity (or "0 (audit)" for customer-return damaged), before/after, batch ID or order link, expiry date
- Movement log filter: by SKU dropdown (Последни движения card)

## Tier 1 Batch Traceability
**Implements EU 178/2002 Чл. 18 (one-step-back/forward), EU 931/2011 (B2B batch info on consignments), Bulgarian ЗХр Чл. 84-86, БАБХ recall procedure.**

Migration `20260429123326_batch_traceability.sql` adds two tables:
- `product_batches` — one row per (sku, batch_number) supplier label. Append-mostly: only `active → recalled` forward UPDATE allowed; metadata fields (sku, batch_number, expiry_date, created_at, created_by, notes) are immutable. DELETE blocked. Recall metadata (recalled_at, recalled_by, recall_reason ≥ 20 chars) must be set in the same UPDATE that flips status. Tamper-evident for БАБХ inspections.
- `order_item_batches` — populated by the admin allocation flow before courier-label generation. Records "this order_item consumed N units from this batch". **Status-conditional immutability**: mutable while the parent order's `tracking_number IS NULL`, locked the moment a tracking number lands (covers `'__generating__'` so a courier-label retry can't race a concurrent edit). `cancelShipment` clears the tracking number and re-opens edits. `order_item_batches.product_batch_id` SKU must match `order_items.sku`. See `database-schema.md` § Product Batches & Order Item Batches Tables for the lifecycle trigger and the override-reason columns (`non_fefo_reason`, `expired_override_reason`).

**Why not "approximation by SKU"**: even with 3 SKUs and low volume, the legal regime requires a defensible audit trail per batch — БАБХ inspectors expect to ask "which orders received batch X?" and get a precise answer. Over-approximation by SKU+date works for customer-outreach UX but doesn't satisfy the regulator. We chose Tier 1 anyway because B2B is on the roadmap and EU 931/2011 batch-on-consignment is mandatory for animal-origin food (eggs).

**Allocation flow** (now a fulfillment step, separate from courier-label generation):
- Admin opens the order detail "Партиди" card while the order is still confirmed + has no tracking number. The card auto-seeds via `buildExpectedFefoPlan` from `lib/batches/fefo.ts`.
- `saveBatchAllocation(orderId, rows)` (TS, in `app/actions/admin.ts`) does input + FEFO-compliance + expired-override validation, then calls the `save_batch_allocation` RPC for the atomic delete+insert under `FOR UPDATE` locks on the parent order and the referenced product_batches. Re-validates inside the transaction: order status='confirmed', tracking_number IS NULL, per-SKU sum equality with `order_items.quantity`, all selected batches `active`, no overcommit vs `batch_quantity_available` (DELETE happens before the availability check so the order's prior allocation isn't double-counted).
- The "Генерирай товарителница" dialog now shows a read-only allocation summary; submit just calls `generateShipment` which has a precondition check (per-SKU sum equality) and rolls back the `__generating__` lock with a friendly Bulgarian error on mismatch.
- Inventory is NOT moved here — `inventory_log` already recorded `order_out` at order creation. The batch table is accounting-of-allocation, decoupled from sellable count.

**Recall workflow** (admin clicks "Изтегли партидата от пазара"):
- `recallBatch(batchId, reason)` validates `reason ≥ 20 chars`, sets `status='recalled'`, `recalled_at=now()`, `recalled_by`, `recall_reason` in one UPDATE (the trigger requires all three together).
- `getBatchAffectedOrders(batchId)` returns the affected-orders list (calls `affected_orders_for_batch` RPC) for admin contact / CSV export.
- A recalled batch cannot be selected in new shipment allocations (filtered by `status='active'`).

**Backfill on creation**: existing `inventory_log batch_in` rows seeded `product_batches` (one per `(sku, batch_id)`, earliest expiry, `created_by='system-backfill'`).

## Recall traceability — precise (Tier 1) vs over-approximate fallback
Two paths exist and serve different needs:

1. **Precise via batches** (`/admin/batches/[id]` → "Засегнати поръчки"):
   - Calls `affected_orders_for_batch(p_batch_id)` RPC.
   - Returns only orders with `order_item_batches` rows for the specific batch in `confirmed|shipped|delivered` status.
   - Authoritative for legal/regulator-facing recall.

2. **Over-approximate by SKU** (`/admin/inventory` → "Изтегляне от пазара / рекол"):
   - `getRecallCandidates(sku, fromDate?, toDate?)` — queries `order_items !inner orders` for the SKU + non-terminal status + optional date window.
   - Returns ALL orders containing the SKU; admin does phone-level triage.
   - Useful for: pre-Tier 1 historical orders without `order_item_batches` rows; suspected supplier issue without a confirmed batch number; broad customer outreach during early stages of a recall.

The CSV from the recall card has BOM + Bulgarian header labels. Filename: `recall-<sku>-<date>.csv`. Sort: `confirmed` first, `shipped` second, `delivered` third (escalating-risk order).

## Running inventory SQL on a new database
Inventory tables, functions, triggers, and RLS policies are part of the initial schema migration at `supabase/migrations/20260420120000_initial_schema.sql`. The customer-return damaged handling, batch traceability, and refund-items tables are subsequent migrations. Apply all migrations in `supabase/migrations/` in filename order — see that directory's README.md.
