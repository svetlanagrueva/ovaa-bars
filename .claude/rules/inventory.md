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

## Refund ≠ Return (important distinction)
Refund tracking (refunded_at, refund_amount on orders table) and inventory tracking (inventory_log) are separate concerns:
- Returned item, sellable → refund YES + return_in (stock increments)
- Returned item, damaged → refund YES + damaged (stock does NOT increment)
- Lost package → refund YES + no inventory movement
- These must not be coupled blindly — the admin decides independently whether to refund and whether to restock

## Postgres Functions
- `reserve_inventory(p_sku, p_quantity, p_order_id)` — atomically decrements; **raises exception** if insufficient stock
- `restore_inventory(p_sku, p_quantity, p_order_id)` — atomically increments (cancellation / session expiry)

## Calling pattern — CRITICAL
Supabase query builder is thenable but **not a Promise subclass** — it has no `.catch()` method. Always use:
```typescript
const { error } = await supabase.rpc("restore_inventory", { p_sku, p_quantity, p_order_id })
if (error) console.error("Failed to restore inventory:", error)
```
Never chain `.catch()` on a Supabase call — throws `TypeError: supabase.rpc(...).catch is not a function`.

## Fail-open pattern
`getInventoryMap()` in `lib/inventory.ts` returns an **empty Map** on DB error — not a map of zeros.
- `inventoryMap.has(id) === false` → treat product as available (DB error / unknown state)
- `inventoryMap.has(id) && inventoryMap.get(id) === 0` → confirmed sold out

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
- Server actions: `getInventoryStatus()` (fetches `inventory_current` + last 50 log entries in parallel), `addInventoryBatch()`
- Stock badge colours: red = 0, amber ≤ 20, green > 20
- Movement log shows: date, SKU, type badge, ±quantity, before/after, batch ID or order link, expiry date

## Running inventory SQL on a new database
Tables, functions, trigger, and RLS policies are all in `supabase-schema.sql`. Run the full file. If tables already exist (partial run), run only the functions + trigger block — policies will error with "already exists" otherwise.
