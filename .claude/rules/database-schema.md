# Database Schema Notes

## Orders Table — Key Columns
- `shipping_fee` integer NOT NULL DEFAULT 0 — stored at order creation, not recalculated
- `cod_fee` integer NOT NULL DEFAULT 0 — stored at order creation
- `confirmed_at` timestamptz — set on confirmation (card webhook/success page, COD creation)
- `shipped_at` timestamptz — set when admin marks as shipped
- `delivered_at` timestamptz — set when admin marks as delivered
- `cancelled_at` timestamptz — set when admin cancels
- `cancellation_reason` text — optional, set on cancellation
- `admin_notes` jsonb NOT NULL DEFAULT '[]' — append-only array of `{text, created_at, author}` note entries, shown in dedicated "Вътрешни бележки" card (not in timeline)
- `seller_settled_at` timestamptz — Card: set on webhook/success page confirmation; COD: set when admin records courier settlement
- `courier_ppp_ref` text — COD only: courier's ППП (postal money transfer) document reference
- `settlement_ref` text — COD only: courier's bank transfer reference (batch payout, multiple orders may share)
- `settlement_amount` integer — COD only: actual amount received in cents after courier commission
- `cod_confirmed_at` timestamptz — COD only: when admin recorded the pre-ship phone confirmation call
- `cod_confirmed_by` text — COD only: actor identifier for the phone confirmation
- `stripe_payment_intent_id` text — Stripe PaymentIntent ID for card payments (reconciliation key for Stripe payouts)
- `stripe_receipt_url` text — Stripe-hosted payment receipt URL (card payments only, not a legal invoice)
- `order_confirmation_sent_at` timestamptz — when confirmation email was successfully sent to customer
- `delivery_email_sent_at` timestamptz — when delivery confirmation email was successfully sent
- `delivery_email_last_error` text — last error message from failed delivery email attempt (observability)
- `delivery_status_checked_at` timestamptz — last successful courier API poll for delivery status (cron cursor)

**Invoice data is NOT on the orders row.** Migration `20260428072545_invoices_table.sql` dropped `needs_invoice`, `invoice_type`, `invoice_company_name`, `invoice_eik`, `invoice_vat_number`, `invoice_mol`, `invoice_address`, `invoice_number`, `invoice_date`, `invoice_sent_at` from orders. Invoice profile + issuance metadata now lives on the `invoices` child table — one row per (order, type), with type discriminating `'invoice'` (initial фактура) vs `'credit_note'` (кредитно известие).

**Refund data is NOT on the orders row.** Refunds live in the `refunds` child table (one row per refund, many refunds per order allowed). Order-level "refund status" is a computed aggregate (`SUM(amount_cents)` vs `orders.total_amount`).

## Invoices Table
- `invoices` — replaces the in-orders invoice columns; holds both initial фактури (`type='invoice'`) and кредитни известия (`type='credit_note'`). Migration `20260428072545_invoices_table.sql`. Columns: `id uuid pk`, `order_id uuid fk orders`, `type text check ('invoice', 'credit_note')`, `refund_id uuid fk refunds` (credit_note only), `references_invoice_id uuid fk invoices` (credit_note only — points to the original фактура being credited), `invoice_type text check ('individual', 'company')` (invoice only), `company_name`, `eik`, `vat_number`, `mol`, `address`, `invoice_number text`, `invoice_date timestamptz`, `sent_at timestamptz`, `due_at timestamptz` (mandatory for credit_note: refund.refunded_at + 5 days per ЗДДС Чл. 113 ал. 4), `created_at`, `updated_at`.
- Constraints — shape per type:
  - `chk_invoice_shape` — type='invoice' requires no refund/origin links + invoice_type set + non-empty address.
  - `chk_credit_note_shape` — type='credit_note' requires refund_id + references_invoice_id set, all profile fields null, due_at populated.
  - `chk_invoice_company_fields` — invoice + invoice_type='company' requires non-empty company_name + eik + mol.
  - `chk_invoice_individual_fields` — invoice + invoice_type='individual' forbids company-only fields (company_name, eik, vat_number, mol all null; legal name comes from order.first_name + last_name).
- Unique partial indexes:
  - `uq_invoices_one_per_order` — one type='invoice' row per order_id.
  - `uq_invoices_one_per_refund` — one row per refund_id (refund_id NOT NULL).
  - `uq_invoices_invoice_number` — Microinvest invoice numbers globally unique when set.
- Trigger `trg_emit_invoice_audit_events` (AFTER UPDATE) — emits type-aware events: `invoice_number_set` / `credit_note_number_set` when invoice_number transitions null → non-null, and `invoice_marked_sent` / `credit_note_marked_sent` when sent_at transitions null → non-null. Payload includes `invoice_id`, `invoice_number`, `type`, `refund_id`, `invoice_date` / `sent_at`.
- Trigger `trg_set_invoices_updated_at` (BEFORE UPDATE) — auto-maintains `updated_at`.
- **Append-mostly**: `trg_invoices_immutable_delete` rejects all DELETEs; `trg_invoices_append_mostly_update` (function `enforce_invoices_append_mostly_update`) allows only forward transitions on `invoice_number` / `invoice_date` / `sent_at` (NULL → set, never reverted or re-set). Identity, profile (`invoice_type`, `company_name`, `eik`, `vat_number`, `mol`, `address`), linkage (`refund_id`, `references_invoice_id`, `order_id`, `type`), `due_at`, and `created_at` are strictly immutable. Corrections to issued documents must go through credit_note per ЗДДС Чл. 115/116. Backstop to the app-layer `.is(..., null)` guards in `setInvoiceNumber` / `markInvoiceSent`.
- **Auto-creation rule for `type='credit_note'` rows** (enforced at app layer in `lib/credit-note.ts:autoCreateCreditNoteRow`). After a refund is recorded, a credit_note row is auto-created only when **all three** hold:
  1. an `invoices` row of `type='invoice'` exists for the order
  2. that row has `invoice_number` set (фактура actually issued in Microinvest)
  3. `refunds.affects_invoiced_supply = true`
  
  Otherwise no credit_note row is created. Admin-controlled skip via `affects_invoiced_supply=false` + `credit_note_skip_reason` (audit trail for the skip decision).

## Inventory Tables
- `inventory_log` — append-only movement log; `quantity` always positive (`CHECK quantity > 0`); `type` in (`batch_in`, `order_out`, `cancellation`, `wholesale_out`, `sample_out`, `damaged`, `return_in`, `adjustment_gain`, `adjustment_loss`); has `before_quantity`, `after_quantity`, `batch_id`, `expiry_date`, `order_id`, `reference_type`, `reference_id`, `created_by`, `location_id`, `idempotency_key`. **Immutable: `BEFORE UPDATE`/`BEFORE DELETE` triggers block all mutations, no service-role bypass.** Correct errors by inserting an offsetting movement.
- `inventory_current` — trigger-maintained running total, one row per SKU; never write directly. Customer-return-damaged movements (`type='damaged' AND reference_type='return' AND order_id IS NOT NULL`) are audit-only on this table — see `inventory.md` § Customer-return damaged.

## Refunds Table (formerly `order_refunds`)
- `refunds` — child table for refunds; many per order. Renamed from `order_refunds` in migration `20260429105205`. Columns: `id uuid pk`, `order_id uuid fk orders`, `stripe_refund_id text` (unique partial idx, natural idempotency key for webhook rows), `client_idempotency_key uuid` (unique partial idx, idempotency key for admin-ui rows), `amount_cents integer > 0`, `method` ('stripe' | 'bank_transfer'), `source` ('admin_ui' | 'stripe_webhook'), `reason text`, `bank_transfer_ref text`, `affects_invoiced_supply boolean NOT NULL DEFAULT true`, `credit_note_skip_reason text`, `withdrawal_id uuid fk withdrawals` (set when refund issued from a withdrawal context, immutable once set), `recorded_by text`, `refunded_at`, `created_at`, `updated_at`.
- Constraints:
  - `chk_stripe_method_has_refund_id` — method='stripe' requires stripe_refund_id.
  - `chk_bank_transfer_method_has_ref` — method='bank_transfer' requires bank_transfer_ref.
  - `chk_skip_reason_when_skipping` — `affects_invoiced_supply=false` requires non-empty `credit_note_skip_reason`.
  - Length caps: reason ≤ 1000, bank_transfer_ref ≤ 200, credit_note_skip_reason ≤ 500.
- Trigger `trg_refunds_enforce_total` (BEFORE INSERT OR UPDATE; function `enforce_refunds_total`) — locks `orders` row via FOR UPDATE, sums existing refunds, rejects when `sum + new.amount_cents > orders.total_amount`. Backstop to server-action validation.
- Trigger `trg_refunds_emit_audit` (AFTER INSERT; function `emit_refund_audit`) — writes a `refunded` event to `order_audit_events` with the refund row's payload (including `affects_invoiced_supply`, `bank_transfer_ref`, `withdrawal_id`).
- Trigger `trg_refunds_emit_annotation_audit` (AFTER UPDATE; function `emit_refund_annotation_audit`) — writes a `refund_annotation_edited` event when `reason`, `bank_transfer_ref`, or `credit_note_skip_reason` actually changed, carrying per-field `{old, new}` pairs. Unchanged-field keys are stripped via `jsonb_strip_nulls`. No-op UPDATEs early-return without emitting. (Note: `credit_note_ref` was dropped — credit-note linkage now lives on `invoices.refund_id`.)
- Trigger `trg_refunds_set_updated_at` (BEFORE UPDATE; function `set_refunds_updated_at`) — auto-maintains `updated_at`.
- **Append-only**: `trg_refunds_immutable_delete` rejects all DELETEs; `trg_refunds_append_only_update` (function `enforce_refunds_append_only_update`) rejects UPDATEs that modify any field other than `reason`, `bank_transfer_ref`, `credit_note_skip_reason`, or `updated_at`. Financial fields (`amount_cents`, `method`, `source`, `stripe_refund_id`, `client_idempotency_key`, `recorded_by`, `refunded_at`, `created_at`, `order_id`, `id`, `affects_invoiced_supply`, `withdrawal_id`) are immutable once recorded. `updateRefundAnnotation` is the sole supported UPDATE path. Correction of wrongly-entered refunds requires a reversing entry (phase 2) or manual DB data repair.
- Dual idempotency keys: `stripe_refund_id` dedupes webhook arrivals; `client_idempotency_key` (UUID supplied by admin UI per form submission) dedupes double-submit from the admin browser.
- Admin-ui originated refunds supply `stripe_refund_id` up-front (admin pastes it from Stripe dashboard). Webhook-originated rows upsert by `stripe_refund_id` via the unique partial index.

## Refund Items Table
- `refund_items` — explicit per-line allocation of a refund (migration `20260429111613`). Independent of `inventory_log`: lets admin allocate a refund to specific order lines for shipping disputes, partial price reductions, or goodwill discounts where no goods physically move. Columns: `id uuid pk`, `refund_id uuid fk refunds ON DELETE CASCADE`, `order_item_id bigint fk order_items ON DELETE RESTRICT`, `quantity integer > 0`, `amount_cents integer > 0`, `created_at`. Unique constraint `uq_refund_items_per_pair` on (refund_id, order_item_id) — combine quantities at insert rather than splitting across rows.
- Trigger `trg_refund_items_order_consistency` (BEFORE INSERT) — refund's order_id and order_item's order_id must match (catches cross-order misallocation).
- Trigger `trg_refund_items_quantity_cap` (BEFORE INSERT) — `sum(refund_items.quantity for order_item) ≤ order_items.quantity`. FOR UPDATE locks the order_items row to serialize concurrent inserts.
- Trigger `trg_refund_items_amount_cap` (BEFORE INSERT) — `sum(refund_items.amount_cents for refund) ≤ refunds.amount_cents`. Items can sum to LESS than the refund total — the difference is non-allocated (e.g. shipping or goodwill portion).
- **Append-only**: `trg_refund_items_immutable_update` and `trg_refund_items_immutable_delete` reject all UPDATEs and DELETEs.
- Webhook-originated refunds (`source='stripe_webhook'`) leave `refund_items` empty by design — Stripe doesn't tell us which line was refunded.
- When `refund_items` rows exist they're the authoritative per-line allocation; otherwise the refund is treated as un-allocated (goodwill / shipping-only). The admin UI does not render a VAT/net/gross breakdown — VAT is recorded from Microinvest paste post-registration, never computed in the UI.

## Withdrawals Table
- `withdrawals` — formal register for ЗЗП Чл. 50 (право на отказ / 14-day return) requests (migration `20260429071812`). Strict separation from complaints (рекламация — Чл. 122-127), refunds (money), inventory (goods), and invoices/credit_notes (accounting). Multiple per order over time; one open at a time. Intake is admin-driven (no public form) — customer emails or calls, admin opens the order and registers.
- Columns: `id uuid pk`, `order_id uuid fk orders`, `withdrawal_ref text unique` (WD-YYYY-NNNN, minted via `next_withdrawal_ref()` RPC + `withdrawal_ref_seq` sequence), `requested_via` ('email'|'phone'|'admin'), `customer_email text` (lowercase enforced), `customer_request_text`, `status text` ('requested'|'approved'|'goods_received'|'rejected'|'completed'), `eligibility_time_based bool`, `eligibility_product_based` ('eligible'|'perishable_or_short_shelf_life'|'hygiene_exception'|'unknown'), `eligibility_condition` ('pending_inspection'|'sealed_sellable'|'opened'|'damaged'|'expired'|'other'), `resolution_type` ('refund'|'replacement'|'none'), `rejection_reason`, `refund_id uuid fk refunds`, `return_required bool NOT NULL DEFAULT true`, `completion_note`, `return_tracking_number`, `return_courier`, `approved_at/by`, `goods_received_at`, `rejected_at/by`, `completed_at`, `created_at`, `updated_at`.
- Status machine — forward-only:
  - Path A (return required, default): `requested → approved → goods_received → completed`, plus `requested|approved → rejected`.
  - Path B (return NOT required, e.g. goodwill / customer keeps product): `requested → approved → completed` directly, plus `requested|approved → rejected`.
- Constraints:
  - `chk_rejection_reason` — `status='rejected'` requires non-empty `rejection_reason`.
  - `chk_completed_requires_resolution` — `status='completed'` requires `resolution_type IS NOT NULL`.
  - `chk_refund_resolution_has_refund_id` — `resolution_type='refund'` requires `refund_id IS NOT NULL`. Migration `20260429090323` re-scoped this to fire only at `status='completed'` (was firing too early on goods_received). NOTE: actual current scope is checked when `resolution_type='refund'` regardless of status — refund_id should be set whenever resolution is declared as refund.
  - `chk_completion_note_when_no_return` — Path B completion (return_required=false) requires non-empty `completion_note`.
  - `chk_no_reject_after_goods` — cannot reject after `goods_received_at` is set (legally messy).
- Trigger `trg_enforce_withdrawal_status_transition` (BEFORE UPDATE; function `enforce_withdrawal_status_transition`) — enforces the legal transitions above. Bypass via `current_setting('app.allow_withdrawal_status_override', true) = 'true'` (set by `force_withdrawal_status_override` RPC).
- Trigger `trg_emit_withdrawal_audit_events_insert` and `..._update` (function `emit_withdrawal_audit_events`) — emit `withdrawal_requested` on INSERT, and `withdrawal_approved` / `withdrawal_goods_received` / `withdrawal_rejected` / `withdrawal_completed` on status transitions. Suppresses status emission during force-override (the RPC writes a richer event).
- Unique partial index `uq_open_withdrawal_per_order` — one open withdrawal per order at a time (excludes closed states `rejected` and `completed`). A customer who had a closed withdrawal can file a new one.
- `force_withdrawal_status_override(p_id, p_new_status, p_reason, p_actor)` RPC — data-repair path. Validates reason ≥ 20 chars, writes `withdrawal_status_force_override` audit event, bypasses the state-machine trigger transaction-locally. Every override is auditable.
- `refunds.withdrawal_id` linkage: set once when admin records a refund from a withdrawal context. Unique partial index `uq_refunds_withdrawal_id` enforces one refund per withdrawal at most. Immutable once set (extended into the append-only enforcement).

## Complaints Table
- `complaints` — formal complaints register (ЗЗП чл. 127). Multiple per order. `complaint_ref` UNIQUE auto-generated via DB sequence (`complaint_ref_seq`) as `RCL-YYYY-NNNN`. Has `defect_description` (required), `customer_demand` ('refund'/'replacement'/'repair'/'discount'), `status` ('open'/'resolved'/'rejected'), `resolution`, `resolved_at`, `created_by`. No `complaint_ref` pointer on orders table — query complaints table directly. Surfaced alongside withdrawals in the unified `/admin/returns` inbox and in the order detail "Свързани заявки" card.

## Product Batches & Order Item Batches Tables
- `product_batches` — Tier 1 batch traceability (migration `20260429123326`). Implements EU 178/2002 Чл. 18 (one-step-back/forward), EU 931/2011 (B2B batch info on consignments), Bulgarian ЗХр Чл. 84-86, and БАБХ recall procedure. Columns: `id uuid pk`, `sku text`, `batch_number text`, `expiry_date date NOT NULL`, `status text` ('active'|'recalled'), `recalled_at`, `recalled_by`, `recall_reason` (≥ 20 chars when set), `notes`, `created_at`, `created_by`. Unique on (sku, batch_number).
- `chk_recall_metadata` — `status='active'` forbids recall fields; `status='recalled'` requires all three (recalled_at, non-empty recalled_by, recall_reason ≥ 20 chars). `chk_batch_number_nonempty` enforces non-empty batch_number.
- **Append-mostly**: `trg_product_batches_immutable_delete` rejects DELETE; `trg_product_batches_append_mostly_update` (function `enforce_product_batches_append_mostly_update`) allows ONLY the `active → recalled` forward transition with metadata fields populated in the same UPDATE. All other field changes raise. Tamper-evident for БАБХ inspections.
- `order_item_batches` — populated at ship time; records "this order_item consumed N units from this batch". Columns: `id uuid pk`, `order_item_id bigint fk order_items ON DELETE CASCADE`, `product_batch_id uuid fk product_batches ON DELETE RESTRICT`, `quantity integer > 0`, `confirmed_at`, `confirmed_by`. Unique on (order_item_id, product_batch_id) — multiple batches per item supported via separate rows.
- **Fully immutable post-insert**: `trg_order_item_batches_immutable_update` and `..._immutable_delete` reject all UPDATE/DELETE. Allocation is locked at ship time.
- `trg_order_item_batches_sku_consistency` (BEFORE INSERT; function `check_order_item_batch_sku_consistency`) — batch's SKU must match order_item's SKU. Catches "shipped from batch of SKU A against order line for SKU B" silent corruption.
- Backfill on creation: existing `inventory_log` `batch_in` rows seed `product_batches` (one per `(sku, batch_id)`, earliest expiry, `created_by='system-backfill'`).

## Order Audit Events Table
- `order_audit_events` — append-only unified event log for orders. `(id bigserial, order_id uuid fk, event_type text, actor text default 'admin', payload jsonb default '{}', created_at timestamptz)`. **Immutable**: `BEFORE UPDATE`/`BEFORE DELETE` triggers reject mutations; correct by appending.
- Populated by multiple paths:
  - `emit_order_audit_events` trigger on orders AFTER UPDATE — diffs OLD vs NEW for whitelisted columns (`status`, `seller_settled_at`, `shipped_at`, `delivered_at`, `cancelled_at`, `tracking_number`, `cod_confirmed_at`, and the contact group: `first_name`, `last_name`, `phone`, `email`, `address`, `postal_code`, `city`, `notes`) and emits typed events (`status_changed`, `seller_settled_at_recorded`, `shipped_at_recorded`, `delivered_at_recorded`, `cancelled`, `tracking_number_set`, `cod_confirmed`, `contact_info_changed`). Migration `20260428072545` dropped the `invoice_number_set` and `invoice_marked_sent` branches — those events now come from `emit_invoice_audit_events` on the invoices table. The `status_changed` branch is suppressed when `current_setting('app.allow_status_override', true) = 'true'` — the RPC already wrote a richer `status_force_override` event with the reason. The `contact_info_changed` branch emits ONE event per UPDATE with a `jsonb_strip_nulls`'d payload of only the fields that changed.
  - `emit_invoice_audit_events` trigger on invoices AFTER UPDATE — emits `invoice_number_set` / `credit_note_number_set` and `invoice_marked_sent` / `credit_note_marked_sent` based on `type`.
  - `emit_refund_audit` trigger on refunds AFTER INSERT — emits a `refunded` event with the new payload (includes `affects_invoiced_supply`, `bank_transfer_ref`, `withdrawal_id`).
  - `emit_refund_annotation_audit` trigger on refunds AFTER UPDATE — emits `refund_annotation_edited` with before/after `{old, new}` pairs for `reason` / `bank_transfer_ref` / `credit_note_skip_reason` changes. Early-returns on no-op UPDATEs.
  - `emit_withdrawal_audit_events` trigger on withdrawals (AFTER INSERT and AFTER UPDATE) — emits `withdrawal_requested`, `withdrawal_approved`, `withdrawal_goods_received`, `withdrawal_rejected`, `withdrawal_completed`. Suppresses status emission during `force_withdrawal_status_override`.
  - `record_order_outcome(p_order_id, p_outcome_type, p_payload, p_actor)` RPC — explicit calls for domain events that aren't column diffs. Allowed types: `delivery_refused`, `package_lost`, `returned`, `recalled`, `partial_return`, `status_force_override`, `data_repair`, `external_refund`, `payment_failed`, `dispute_opened`, `dispute_closed`, `dispute_funds_reinstated`, `order_items_changed`, `email_resent`, plus the withdrawal_* set above plus `withdrawal_status_force_override`.
- Actor: `coalesce(current_setting('app.actor', true), 'admin')`. Single-admin pre-launch. When per-user auth lands, server actions will set `app.actor` via `set_config('app.actor', $1, true)` at request start.

## Postgres Functions
- `dashboard_stats(p_today_start, p_week_start, p_month_start)` — returns JSON with aggregated stats. Includes `pending_orders`, `invoices_awaiting` (joined to orders, `type='invoice' AND invoice_number IS NULL AND order.status<>'cancelled'`), `credit_notes_awaiting` (`type='credit_note' AND invoice_number IS NULL`), `awaiting_settlement`, `inventory_debt_skus`, `withdrawals_pending` (statuses `requested|approved|goods_received`).
- `reserve_inventory(p_sku, p_quantity, p_order_id)` — atomically decrements stock; raises exception if insufficient.
- `restore_inventory(p_sku, p_quantity, p_order_id)` — atomically increments stock (cancellation / expired session / partial cancel). Sum-based guard: `sum(restored) + p_quantity` must not exceed `sum(reserved)` for `(sku, order_id)`. Multiple cancellation rows per `(sku, order_id)` allowed.
- `claim_marketing_emails(p_now, p_limit)` — find candidates + insert pending + reclaim stale + claim work, all in one call. Uses `FOR UPDATE SKIP LOCKED`.
- `confirm_delivery(p_order_id, p_delivered_at)` — atomically marks order as delivered WHERE `status = 'shipped'`. Idempotent.
- `record_order_outcome(p_order_id, p_outcome_type, p_payload, p_actor)` — inserts a domain event into `order_audit_events`. Validates outcome_type against the allowed set above.
- `edit_order_quantity(p_order_id, p_sku, p_new_quantity)` — atomic per-SKU quantity edit for COD orders. FOR UPDATE locks the `order_items` row, calls `reserve_inventory` / `restore_inventory` for the delta, updates `order_items.quantity` + `orders.total_amount`. Fee structure (shipping, cod, discount) NOT recalculated — admin must cancel + reorder if fees need to change.
- `add_admin_note(p_order_id, p_text, p_author)` — atomic `admin_notes || jsonb_build_object(...)` append. Validates non-empty text ≤ 2000 chars.
- `force_status_override(p_order_id, p_new_status, p_reason, p_actor)` — orders state-machine bypass for data repair. Validates reason ≥ 20 chars, writes `status_force_override` audit event.
- `force_withdrawal_status_override(p_id, p_new_status, p_reason, p_actor)` — withdrawals state-machine bypass for data repair. Validates reason ≥ 20 chars, writes `withdrawal_status_force_override` audit event.
- `next_withdrawal_ref()` — atomic helper for the app layer to mint the next `WD-YYYY-NNNN` ref, avoiding races between concurrent admin clicks.
- `batch_quantity_available(p_batch_id uuid)` — derives current available units of a batch from `inventory_log` (in: batch_in/return_in/adjustment_gain; out: damaged/wholesale_out/sample_out/adjustment_loss, EXCLUDING customer-return-damaged) minus `order_item_batches` allocated to confirmed/shipped/delivered orders. Cancelled releases the allocation.
- `affected_orders_for_batch(p_batch_id uuid)` — returns recall worklist (orders containing the batch in `confirmed|shipped|delivered` status) with contact + tracking fields. Sort: shipped_at desc, then created_at desc.
- `enforce_order_status_transition()`, `emit_order_audit_events()`, `emit_invoice_audit_events()`, `emit_refund_audit()`, `emit_refund_annotation_audit()`, `enforce_refunds_total()`, `enforce_refunds_append_only_update()`, `set_refunds_updated_at()`, `set_invoices_updated_at()`, `set_withdrawals_updated_at()`, `enforce_withdrawal_status_transition()`, `emit_withdrawal_audit_events()`, `enforce_product_batches_append_mostly_update()`, `check_order_item_batch_sku_consistency()`, `enforce_refund_items_quantity_cap()`, `enforce_refund_items_amount_cap()`, `check_refund_item_order_consistency()`, `update_inventory_current()`, `raise_*_immutable*()` — trigger functions, not callable via RPC.

## Marketing Email Tables
- `email_unsubscribes` — `email text PRIMARY KEY`, RLS deny-all. Keyed by lowercase email.
- `marketing_email_log` — `UNIQUE(order_id, email_type)`, status: `pending/sending/sent/failed/skipped`
  - `claimed_at` for stale detection (not `created_at`), `last_attempt_at`, `provider_message_id`, `attempt_count`
  - Partial index on `status IN ('pending', 'failed')`

## Indexes (selected)
- `idx_orders_status` — on status column
- `idx_orders_created_at` — on created_at DESC
- `idx_orders_delivered_at` — partial index on delivered_at WHERE NOT NULL (marketing cron)
- `idx_orders_tracking_number_unique` — unique partial index on tracking_number WHERE NOT NULL AND != '__generating__'
- `idx_invoices_order_id`, `idx_invoices_type`, `idx_invoices_pending` (WHERE invoice_number IS NULL), `idx_invoices_due_at` (WHERE due_at IS NOT NULL AND invoice_number IS NULL), `uq_invoices_one_per_order`, `uq_invoices_one_per_refund`, `uq_invoices_invoice_number`
- `idx_refunds_*` and `uq_refunds_withdrawal_id` — renamed from `idx_order_refunds_*` in migration `20260429105205`
- `uq_open_withdrawal_per_order`, `idx_withdrawals_status` (partial), `idx_withdrawals_order_id`, `idx_withdrawals_created_at`
- `idx_refund_items_refund_id`, `idx_refund_items_order_item_id`
- `idx_product_batches_sku_status`, `idx_product_batches_expiry` (partial WHERE active), `idx_product_batches_recalled` (partial)
- `idx_order_item_batches_order_item`, `idx_order_item_batches_product_batch`
- `idx_marketing_email_log_claimable` — partial index on status WHERE IN ('pending', 'failed')
- `idx_inventory_log_idempotency_key_unique` — unique partial index on idempotency_key WHERE NOT NULL.
- ~~`idx_inventory_log_order_out_unique`~~ — dropped to support admin post-confirmation quantity edits. Multiple `order_out` rows per (order_id, sku) are allowed.

## Status constraint
Valid values in `orders.status`: `pending`, `confirmed`, `shipped`, `delivered`, `cancelled`, `expired`.

## Sanity CHECKs on orders
- `chk_cod_fee_implies_cod` — `cod_fee > 0 ⇒ payment_method = 'cod'`. One-way only: card orders must have cod_fee=0; COD orders may have 0 (free-COD promo) or positive.
- `chk_orders_email_lowercase` — `email = lower(email)`. Prevents case-variance divergence from `email_unsubscribes` (which already keys by lowercase). App normalizes via `.trim().toLowerCase()` in the three insert paths in stripe.ts; CHECK is defense-in-depth.

**EGN is never collected.** Bulgarian tax law (ЗДДС) does not require EGN on individual retail invoices; the `invoice_egn` column was dropped in migration `20260420161754_invoice_mode_drop_egn.sql` (predates the move to invoices table). No national ID number touches the DB.

## Delivery mode consistency (`chk_logistics_partner_enum` + `chk_delivery_fields_consistent`)
- `logistics_partner` must be one of `econt-office`, `speedy-office`, `speedy-address`, or NULL (grandfathered). `econt-address` is deliberately unsupported.
- Each mode requires its partner-specific columns be populated and the other partner's columns be null:
  - `econt-office` → all 4 `econt_office_*` columns set; all 3 `speedy_office_*` columns null.
  - `speedy-office` → all 3 `speedy_office_*` columns set; all 4 `econt_office_*` columns null.
  - `speedy-address` → `address` and `postal_code` non-empty; no office fields on either partner.
- `city` stays `NOT NULL` independently (office modes populate it from the chosen office).
- Server-side validation in `validateAddressForDelivery` (stripe.ts) enforces non-empty `address` and `postal_code` for `speedy-address` before the CHECK sees the insert.

## Timestamp invariants
- `chk_shipped_after_confirmed` — `shipped_at IS NULL OR (confirmed_at IS NOT NULL AND shipped_at >= confirmed_at)`. Strict: both timestamps are set by the app, no cross-clock drift.
- `chk_delivered_after_shipped` — `delivered_at IS NULL OR (shipped_at IS NOT NULL AND delivered_at >= shipped_at - interval '1 hour')`. 1h tolerance absorbs courier clock drift.

**Deliberately not encoded:** `seller_settled_at >= confirmed_at` and refund-vs-payment chronology — too strict for legitimate edge cases. Those relationships live in business-logic validation in the refund / settlement server actions.

## Status state machine (enforced by `trg_enforce_order_status_transition`)
BEFORE UPDATE trigger on orders; fires only when `OLD.status IS DISTINCT FROM NEW.status`. Legal transitions:

- `pending   → {confirmed, expired, cancelled}`
- `confirmed → {shipped, cancelled}`
- `shipped   → {delivered}` (no `shipped → cancelled` — post-shipment exceptions via refund flow + outcome events like `delivery_refused` / `package_lost`)
- `delivered`, `cancelled`, `expired` — terminal

Data-repair path: `force_status_override(p_order_id, p_new_status, p_reason, p_actor)` RPC. Validates status value, requires `p_reason` ≥ 20 chars, writes a `status_force_override` audit event, then sets transaction-local `app.allow_status_override = 'true'` to bypass the trigger.

## Refund → Inventory linkage
`recordRefund` and `recordStockMovement` are **separate server actions**, called sequentially by the admin UI's two-step refund flow — not bundled internally. This preserves the four-layer separation: request (`complaints` / `withdrawals`) → money (`refunds` / `refund_items`) → goods (`inventory_log`) → accounting (`invoices`) → audit (`order_audit_events`).

When the admin's Step 2 submission writes return-scoped stock movements, each call to `recordStockMovement` produces an `inventory_log` row with:
- `type='return_in'` (sellable disposition) or `type='damaged'` (damaged disposition)
- `reference_type='return'`, `reference_id=<refund.id>` (cross-reference to `refunds.id`)
- `order_id=<order.id>` (enables the order-scoped return cap)
- `idempotency_key=<UUID>` — fresh UUID generated by the UI per (sku, disposition) pair, preserved across retries

**Return cap** enforces `sum(prior return-scoped movements for (order_id, sku)) + new.quantity ≤ sum(order_out for (order_id, sku))` when `orderId + reference_type='return' + type ∈ {return_in, damaged}`. App-layer validation in `recordStockMovement` runs first for friendly Bulgarian errors; DB trigger `trg_enforce_order_return_cap` is the backstop with matching wording.

## Setting up the database
Apply migrations from `supabase/migrations/` in filename order — see that directory's `README.md` for the workflow. The initial schema migration (`20260420120000_initial_schema.sql`) is the first file; subsequent schema changes are separate migration files. Never edit an applied migration, always add a new one.
