# Database Schema Notes

## Orders Table — Key Columns
- `shipping_fee` integer NOT NULL DEFAULT 0 — stored at order creation, not recalculated
- `cod_fee` integer NOT NULL DEFAULT 0 — stored at order creation
- `confirmed_at` timestamptz — set on confirmation (card webhook/success page, COD creation)
- `shipped_at` timestamptz — set when admin marks as shipped
- `delivered_at` timestamptz — set when admin marks as delivered
- `cancelled_at` timestamptz — set when admin cancels
- `cancellation_reason` text — optional, set on cancellation
- `admin_notes` jsonb NOT NULL DEFAULT '[]' — append-only array of `{text, created_at}` note entries, shown in order timeline
- `invoice_type` text CHECK ('individual', 'company') — which invoice form this order used. Required when `needs_invoice=true`.
- `paid_at` timestamptz — Card: set on webhook/success page confirmation; COD: set when admin records courier settlement
- `courier_ppp_ref` text — COD only: courier's ППП (postal money transfer) document reference
- `settlement_ref` text — COD only: courier's bank transfer reference (batch payout, multiple orders may share)
- `settlement_amount` integer — COD only: actual amount received in cents after courier commission
- `cod_confirmed_at` timestamptz — COD only: when admin recorded the pre-ship phone confirmation call (migration `20260424130000`)
- `cod_confirmed_by` text — COD only: actor identifier for the phone confirmation ('admin' pre-launch, real user id post multi-admin-auth)
- `invoice_sent_at` timestamptz — when admin confirmed the invoice was sent to the customer
- `stripe_payment_intent_id` text — Stripe PaymentIntent ID for card payments (reconciliation key for Stripe payouts)
- `stripe_receipt_url` text — Stripe-hosted payment receipt URL (card payments only, not a legal invoice)
- `order_confirmation_sent_at` timestamptz — when confirmation email was successfully sent to customer
- `delivery_email_sent_at` timestamptz — when delivery confirmation email was successfully sent
- `delivery_email_last_error` text — last error message from failed delivery email attempt (observability)
- `delivery_status_checked_at` timestamptz — last successful courier API poll for delivery status (cron cursor)

**Refund data is NOT on the orders row.** Refunds live in the `order_refunds` child table (one row per refund, many refunds per order allowed). Order-level "refund status" is a computed aggregate (`SUM(amount_cents)` vs `orders.total_amount`). Migration `20260423090000_order_refunds_normalization.sql` dropped `refunded_at`, `refund_amount`, `refund_reason`, `refund_method`, `credit_note_ref` from orders.

## Inventory Tables
- `inventory_log` — append-only movement log; `quantity` always positive (`CHECK quantity > 0`); `type` in (`batch_in`, `order_out`, `cancellation`, `wholesale_out`, `sample_out`, `damaged`, `return_in`, `adjustment_gain`, `adjustment_loss`); has `before_quantity`, `after_quantity`, `batch_id`, `expiry_date`, `order_id`, `reference_type`, `reference_id`, `created_by`, `location_id`, `idempotency_key`. **Immutable: `BEFORE UPDATE`/`BEFORE DELETE` triggers block all mutations, no service-role bypass.** Correct errors by inserting an offsetting movement.
- `inventory_current` — trigger-maintained running total, one row per SKU; never write directly

## Order Refunds Table
- `order_refunds` — child table for refunds; many per order. Columns: `id uuid pk`, `order_id uuid fk orders`, `stripe_refund_id text` (unique partial idx, natural idempotency key for webhook rows), `client_idempotency_key uuid` (unique partial idx, idempotency key for admin-ui rows), `amount_cents integer > 0`, `method` ('stripe' | 'bank_transfer'), `source` ('admin_ui' | 'stripe_webhook'), `reason text`, `credit_note_ref text`, `recorded_by text`, `refunded_at`, `created_at`, `updated_at`.
- Constraints: `chk_stripe_method_has_refund_id` — method='stripe' requires stripe_refund_id. Reason ≤ 1000 chars, credit_note_ref ≤ 100 chars.
- Trigger `enforce_refund_total` (BEFORE INSERT OR UPDATE) — locks `orders` row via FOR UPDATE, sums existing refunds, rejects when `sum + new.amount_cents > orders.total_amount`. Backstop to server-action validation.
- Trigger `emit_order_refund_audit` (AFTER INSERT) — writes a `refunded` event to `order_audit_events` with the refund row's payload.
- Trigger `emit_order_refund_annotation_audit` (AFTER UPDATE) — writes a `refund_annotation_edited` event when `reason` or `credit_note_ref` actually changed, carrying per-field `{old, new}` pairs (migration `20260424120000`). Unchanged-field keys are stripped via `jsonb_strip_nulls` so a reason-only edit doesn't emit a noisy credit_note_ref=null pair. Together with the AFTER INSERT `refunded` event this gives each refund row a complete audit trail. No-op UPDATEs (where neither annotation field changed) early-return without emitting.
- Trigger `set_order_refunds_updated_at` (BEFORE UPDATE) — auto-maintains `updated_at`.
- **Append-only**: `trg_order_refunds_immutable_delete` rejects all DELETEs; `trg_order_refunds_append_only_update` rejects UPDATEs that modify any field other than `reason`, `credit_note_ref`, or `updated_at`. Financial fields (`amount_cents`, `method`, `source`, `stripe_refund_id`, `client_idempotency_key`, `recorded_by`, `refunded_at`, `created_at`, `order_id`, `id`) are immutable once recorded. `updateRefundAnnotation` is the sole supported UPDATE path. Correction of wrongly-entered refunds requires a reversing entry (phase 2) or manual DB data repair.
- Dual idempotency keys: `stripe_refund_id` dedupes webhook arrivals; `client_idempotency_key` (UUID supplied by admin UI per form submission) dedupes double-submit from the admin browser (e.g. network-retry re-fire of the same form). A single refund operation may produce both (admin-ui row carries both its client key and the Stripe refund id it was given).
- Admin-ui originated refunds supply `stripe_refund_id` up-front (admin pastes it from Stripe dashboard). Webhook-originated rows upsert by `stripe_refund_id` via the unique partial index. Either arrival order results in exactly one row.

## Refund → Inventory linkage
`recordRefund` and `recordStockMovement` are **separate server actions**, called sequentially by the admin UI's two-step refund flow — not bundled internally. This preserves the three-layer separation: refund = money (`order_refunds`), inventory = goods (`inventory_log`), outcome = audit (`order_audit_events`).

When the admin's Step 2 submission writes return-scoped stock movements, each call to `recordStockMovement` produces an `inventory_log` row with:
- `type='return_in'` (sellable disposition) or `type='damaged'` (damaged disposition)
- `reference_type='return'`, `reference_id=<refund.id>` (cross-reference to `order_refunds.id`)
- `order_id=<order.id>` (enables the order-scoped return cap)
- `idempotency_key=<UUID>` — fresh UUID generated by the UI per (sku, disposition) pair, preserved in component state across retries so a mid-loop failure can be retried without duplicate inserts

**Return cap** enforces `sum(prior return-scoped movements for (order_id, sku)) + new.quantity ≤ sum(order_out for (order_id, sku))` when `orderId + reference_type='return' + type ∈ {return_in, damaged}`. App-layer validation in `recordStockMovement` runs first for friendly Bulgarian errors; DB trigger `trg_enforce_order_return_cap` (migration `20260423210000`) is the backstop with matching wording. Warehouse-internal damage (`reference_type='internal'`, no `orderId`) bypasses the cap — see `inventory.md` § Return cap for the scope rules.

## Complaints Table
- `complaints` — formal complaints register (ЗЗП чл. 127). Multiple per order. `complaint_ref` UNIQUE auto-generated via DB sequence (`complaint_ref_seq`) as `RCL-YYYY-NNNN`. Has `defect_description` (required), `customer_demand` ('refund'/'replacement'/'repair'/'discount'), `status` ('open'/'resolved'/'rejected'), `resolution`, `resolved_at`, `created_by`. No `complaint_ref` pointer on orders table — query complaints table directly.

## Order Audit Events Table
- `order_audit_events` — append-only unified event log for orders. `(id bigserial, order_id uuid fk, event_type text, actor text default 'admin', payload jsonb default '{}', created_at timestamptz)`. **Immutable**: `BEFORE UPDATE`/`BEFORE DELETE` triggers reject mutations; correct by appending.
- Populated by two paths:
  - `emit_order_audit_events` trigger on orders AFTER UPDATE — diffs OLD vs NEW for whitelisted columns (`status`, `invoice_number`, `invoice_sent_at`, `paid_at`, `shipped_at`, `delivered_at`, `cancelled_at`, `tracking_number`, `cod_confirmed_at`, and the contact group: `first_name`, `last_name`, `phone`, `email`, `address`, `postal_code`, `city`, `notes`) and emits typed events (`status_changed`, `invoice_number_set`, `paid_at_recorded`, `shipped_at_recorded`, `delivered_at_recorded`, `cancelled`, `tracking_number_set`, `invoice_marked_sent`, `cod_confirmed`, `contact_info_changed`). The `status_changed` branch is suppressed when `current_setting('app.allow_status_override', true) = 'true'` — i.e. when `force_status_override` set the bypass — because the RPC already wrote a richer `status_force_override` event with the reason (migration `20260424110000`). The `contact_info_changed` branch emits ONE event per UPDATE with a `jsonb_strip_nulls`'d payload of only the fields that changed (migration `20260424140000`). `order_items_changed` is emitted explicitly from `updateOrderQuantity` via `record_order_outcome` rather than by a trigger (the event belongs to admin intent, not the mechanical UPDATE).
  - `emit_order_refund_audit` trigger on order_refunds AFTER INSERT — emits a `refunded` event (separate trigger since refunds are a child table, not order columns).
  - `emit_order_refund_annotation_audit` trigger on order_refunds AFTER UPDATE — emits `refund_annotation_edited` with before/after `{old, new}` pairs for `reason` / `credit_note_ref` changes. Early-returns on no-op UPDATEs.
  - `record_order_outcome(p_order_id, p_outcome_type, p_payload, p_actor)` RPC — explicit calls for domain events that aren't column diffs. Admin-driven: `delivery_refused`, `package_lost`, `returned`, `recalled`, `partial_return`, `status_force_override`, `data_repair`, `order_items_changed`, `email_resent`. Webhook-driven: `external_refund`, `payment_failed`, `dispute_opened`, `dispute_closed`, `dispute_funds_reinstated`.
- Actor: `coalesce(current_setting('app.actor', true), 'admin')`. Single-admin pre-launch. When per-user auth lands (L14), server actions will set `app.actor` via `set_config('app.actor', $1, true)` at request start.

## Postgres Functions
- `dashboard_stats(p_today_start, p_week_start, p_month_start)` — returns JSON with aggregated stats (SQL-level, not in-memory), includes `awaiting_settlement` count for COD orders delivered but not yet paid
- `reserve_inventory(p_sku, p_quantity, p_order_id)` — atomically decrements stock; raises exception if insufficient
- `restore_inventory(p_sku, p_quantity, p_order_id)` — atomically increments stock (cancellation / expired session / partial cancel). Sum-based guard: `sum(restored) + p_quantity` must not exceed `sum(reserved)` for `(sku, order_id)`. Raises if no matching `order_out` exists, or if the invariant would be violated. Multiple cancellation rows per `(sku, order_id)` are allowed (supports partial cancellation).
- `claim_marketing_emails(p_now, p_limit)` — find candidates + insert pending + reclaim stale + claim work, all in one call. Uses `FOR UPDATE SKIP LOCKED` for concurrency. Filters unsubscribes via `NOT EXISTS` with `lower()`.
- `confirm_delivery(p_order_id, p_delivered_at)` — atomically marks order as delivered WHERE `status = 'shipped'`, returns updated row. Idempotent — no-op if order is not shipped.
- `record_order_outcome(p_order_id, p_outcome_type, p_payload, p_actor)` — inserts a domain event into `order_audit_events`. Validates outcome_type against the allowed set (migrations `20260420151152`, `20260421060546`, `20260424100000`, `20260424140000`, `20260424150000`). Current allowed set: `delivery_refused`, `package_lost`, `returned`, `recalled`, `partial_return`, `status_force_override`, `data_repair`, `external_refund`, `payment_failed`, `dispute_opened`, `dispute_closed`, `dispute_funds_reinstated`, `order_items_changed`, `email_resent`.
- `edit_order_quantity(p_order_id, p_sku, p_new_quantity)` — atomic per-SKU quantity edit for COD orders (migration `20260424140000`). FOR UPDATE locks the `order_items` row, calls `reserve_inventory` / `restore_inventory` for the delta, updates `order_items.quantity` + `orders.total_amount` in the same transaction. Inventory invariant violations (insufficient stock, over-restore) raise from the nested RPCs and roll back. Fee structure (shipping_fee, cod_fee, discount_amount) is intentionally NOT recalculated — admin must cancel + reorder if fees need to change. Returns the new total_amount.
- `emit_order_audit_events()` — trigger function (not callable via RPC). AFTER UPDATE on orders; diffs audited columns and inserts typed events.
- `add_admin_note(p_order_id, p_text, p_author)` — atomic `admin_notes || jsonb_build_object(...)` append. Validates non-empty text ≤ 2000 chars and non-empty author. Replaces the previous fetch-modify-update pattern; row-level serialization prevents concurrent-note loss.
- `force_status_override(p_order_id, p_new_status, p_reason, p_actor)` — data-repair RPC. Validates reason ≥ 20 chars, writes `status_force_override` audit event, bypasses the state-machine trigger transaction-locally, updates status. Every override is auditable.
- `enforce_order_status_transition()` — trigger function (not callable via RPC). BEFORE UPDATE on orders; raises on illegal transitions unless `current_setting('app.allow_status_override', true) = 'true'`.

## Marketing Email Tables
- `email_unsubscribes` — `email text PRIMARY KEY`, RLS deny-all. Keyed by lowercase email.
- `marketing_email_log` — `UNIQUE(order_id, email_type)`, status: `pending/sending/sent/failed/skipped`
  - `claimed_at` for stale detection (not `created_at`), `last_attempt_at`, `provider_message_id`, `attempt_count`
  - Partial index on `status IN ('pending', 'failed')`

## Indexes
- `idx_orders_invoice_number` — partial index on invoice_number WHERE NOT NULL
- `idx_orders_status` — on status column
- `idx_orders_created_at` — on created_at DESC
- `idx_orders_needs_invoice` — partial index WHERE needs_invoice = true AND invoice_number IS NULL
- `idx_orders_delivered_at` — partial index on delivered_at WHERE NOT NULL (marketing cron)
- `idx_marketing_email_log_claimable` — partial index on status WHERE IN ('pending', 'failed')
- `idx_orders_tracking_number_unique` — unique partial index on tracking_number WHERE NOT NULL AND != '__generating__'
- ~~`idx_inventory_log_order_out_unique`~~ — dropped in migration `20260424140000` to support admin post-confirmation quantity edits. Multiple `order_out` rows per (order_id, sku) are now allowed (one per increase-edit); `restore_inventory`'s sum-based guards handle the math.
- `idx_inventory_log_idempotency_key_unique` — unique partial index on idempotency_key WHERE NOT NULL. Rejects duplicate admin-movement submissions at the DB layer.

## Status constraint
Valid values in `orders.status`: `pending`, `confirmed`, `shipped`, `delivered`, `cancelled`, `expired`.

## Invoice mode consistency
- `chk_invoice_needs_fields` — `needs_invoice=true` requires `invoice_type`, non-empty `invoice_mol`, non-empty `invoice_address`.
- `chk_invoice_company_fields` — `invoice_type='company'` requires non-empty `invoice_company_name` and `invoice_eik`.
- `chk_invoice_individual_fields` — `invoice_type='individual'` forbids company-only identifiers (`invoice_eik`, `invoice_vat_number`, `invoice_company_name` all null). Individual invoices carry only name (`invoice_mol`) and address.
- `chk_invoice_fields_cleared` — `needs_invoice=false` requires ALL invoice_* fields to be null. Prevents stale identifier data when a customer toggles the invoice checkbox off after typing.

**EGN is never collected.** Bulgarian tax law (ЗДДС) does not require EGN on individual retail invoices; the `invoice_egn` column was dropped in migration `20260420161754_invoice_mode_drop_egn.sql`. No national ID number touches the DB.

## Delivery mode consistency (`chk_logistics_partner_enum` + `chk_delivery_fields_consistent`)
- `logistics_partner` must be one of `econt-office`, `speedy-office`, `speedy-address`, or NULL (grandfathered). `econt-address` is deliberately unsupported.
- Each mode requires its partner-specific columns be populated and the other partner's columns be null:
  - `econt-office` → all 4 `econt_office_*` columns set; all 3 `speedy_office_*` columns null.
  - `speedy-office` → all 3 `speedy_office_*` columns set; all 4 `econt_office_*` columns null.
  - `speedy-address` → `address` and `postal_code` non-empty; no office fields on either partner.
- `city` stays `NOT NULL` independently (office modes populate it from the chosen office).
- Server-side validation in `validateAddressForDelivery` (stripe.ts) enforces non-empty `address` and `postal_code` for `speedy-address` before the CHECK sees the insert.

## Sanity CHECKs on orders
- `chk_cod_fee_implies_cod` — `cod_fee > 0 ⇒ payment_method = 'cod'`. One-way only: card orders must have cod_fee=0; COD orders may have 0 (free-COD promo) or positive.
- `chk_orders_email_lowercase` — `email = lower(email)`. Prevents case-variance divergence from `email_unsubscribes` (which already keys by lowercase). App normalizes via `.trim().toLowerCase()` in the three insert paths in stripe.ts; CHECK is defense-in-depth.

## Timestamp invariants
- `chk_shipped_after_confirmed` — `shipped_at IS NULL OR (confirmed_at IS NOT NULL AND shipped_at >= confirmed_at)`. Strict: both timestamps are set by the app, no cross-clock drift.
- `chk_delivered_after_shipped` — `delivered_at IS NULL OR (shipped_at IS NOT NULL AND delivered_at >= shipped_at - interval '1 hour')`. 1h tolerance absorbs courier clock drift (delivery timestamps come from the courier API; fast same-day flows can produce small negative deltas). Still rejects obviously wrong writes where delivered_at predates shipped_at by more than an hour.

**Deliberately not encoded:** `paid_at >= confirmed_at` and refund-vs-payment chronology — too strict for legitimate edge cases (pre-capture Stripe refunds, COD settlement entered long after delivery, etc.). Those relationships live in business-logic validation in the refund / settlement server actions, not as DB chronology checks.

## Status state machine (enforced by `trg_enforce_order_status_transition`)
BEFORE UPDATE trigger on orders; fires only when `OLD.status IS DISTINCT FROM NEW.status`. Legal transitions:

- `pending   → {confirmed, expired, cancelled}`
- `confirmed → {shipped, cancelled}`
- `shipped   → {delivered}` (no `shipped → cancelled` — post-shipment exceptions via refund flow + outcome events like `delivery_refused` / `package_lost`)
- `delivered`, `cancelled`, `expired` — terminal

Data-repair path: `force_status_override(p_order_id, p_new_status, p_reason, p_actor)` RPC. Validates status value, requires `p_reason` ≥ 20 chars, writes a `status_force_override` audit event, then sets transaction-local `app.allow_status_override = 'true'` to bypass the trigger. Any legacy-state correction leaves an audit trail.

## Setting up the database
Apply migrations from `supabase/migrations/` in filename order — see that directory's `README.md` for the workflow. The initial schema migration (`20260420120000_initial_schema.sql`) is the first file; subsequent schema changes are separate migration files. Never edit an applied migration, always add a new one.
