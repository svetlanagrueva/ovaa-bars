# Admin Panel

## Structure
- `/admin/dashboard` — revenue stats, action items, recent orders
- `/admin/orders` — paginated order list with filters (status, search, date, invoice, payment)
- `/admin/orders/[id]` — order detail with timeline, Документи card, Свързани заявки, admin notes, actions
- `/admin/invoices` — paginated invoice list with search, date filter, CSV export
- `/admin/inventory` — stock level cards per SKU, add-batch dialog, movement log with SKU filter, recall candidates by SKU
- `/admin/batches` — Tier 1 batch traceability list with SKU + status filter, expiry warnings
- `/admin/batches/[id]` — batch detail with affected-orders table, CSV export, recall workflow
- `/admin/returns` — unified inbox of withdrawals + complaints (type filter)
- `/admin/returns/[id]` — withdrawal detail with state-machine actions
- `/admin/sales` — product promotions management (EU Omnibus compliant)
- `/admin/promo-codes` — promo code management
- `/admin/login` — single password auth

## Auth
- Single password stored in `ADMIN_PASSWORD` env var
- HMAC-SHA256 session tokens with dual timeout (8h absolute, 30min idle)
- IP-based rate limiting (5 attempts/15min, in-memory)
- Middleware protects all `/admin/*` routes except `/admin/login`

## Dashboard
- Revenue stats via Postgres RPC `dashboard_stats` (SQL aggregation, not in-memory)
- Shows product revenue only (excludes shipping_fee and cod_fee)
- Action items: pending orders, invoices awaiting issuance (`type='invoice' AND invoice_number IS NULL`), credit notes awaiting (`type='credit_note' AND invoice_number IS NULL`), COD orders awaiting courier settlement, withdrawals pending (open: requested|approved|goods_received), inventory debt SKUs
- Awaiting settlement links to `/admin/orders?status=delivered&paymentFilter=awaiting-settlement`
- Last 10 orders with links

## Orders
- Pagination: 100 per page, with total count
- Filters: status tabs, text search (ID/name/email), date range, invoice filter (all/requested/issued/pending), payment filter (all/awaiting-settlement/settled)
- URL params supported: `?status=pending`, `?invoiceFilter=pending`, `?paymentFilter=awaiting-settlement`
- CSV export fetches ALL matching results via `getAllOrders` (batches of 1000)
- CSV columns: ID, date, name, email, phone, city, products revenue, promo discount, shipping fee, COD fee, total, payment, delivery, status, invoice #, invoice date

## Order Detail
- Customer info, order details, product breakdown with stored fees
- Price breakdown uses stored `shipping_fee` and `cod_fee` (not recalculated from constants)
- **Exception flows behind "Още действия" dropdown** (top-right of the page header). Three actions live here as Radix Dialog modals:
  - `Запиши възстановяване` (gated on `hasCustomerPaid(order)` from `lib/orders.ts`: card → `seller_settled_at IS NOT NULL`; COD → `delivered_at IS NOT NULL`, since the customer pays the courier on delivery and a refund is owed regardless of when courier remits) — opens the refund form
  - `Регистрирай рекламация` (always available; shows count of open complaints as a badge)
  - `Регистрирай отказ (Чл. 50 ЗЗП)` (gated on `order.status='delivered'`; hard block on non-delivered with friendly Bulgarian message — withdrawal right kicks in only after receipt of goods)
  - `Следдоставно събитие` (gated on `status ∈ {shipped, delivered}`)
  - Below a separator: email resend items (`Препрати потвърждение` / `Препрати известие за изпращане` / `Препрати известие за доставка`), gated by state.
  When the dropdown has no usable items, it collapses to a single "Регистрирай рекламация" button. Outcome → refund hand-off: the "Open refund form" CTA in the outcome callout closes the outcome dialog and opens the refund dialog with prefilled values; idempotency-key + linked-context state preserved across the swap.

### Документи card (replaces the previous invoice section)
Lists all `invoices` rows for the order (one type='invoice' + zero-or-more type='credit_note'). Each row has its own controls:
- "Запази номер" input + button → `setInvoiceNumber(invoiceId, invoiceNumber)` saves number and sets `invoice_date`. Works for both initial фактури and кредитни известия (the same flow because Microinvest issues both with sequential numbers).
- "Отбележи като изпратена" button (visible after invoice_number is saved) → `markInvoiceSent(invoiceId)` sets `sent_at`.
- For credit_note rows: shows reference to the original `invoice_number`, the linked refund amount, and the 5-day deadline `due_at` (refund.refunded_at + 5 days per ЗДДС Чл. 113 ал. 4).
- Initial invoice deadline: 5 days from tax event (card: created_at, COD: delivered_at).

### Свързани заявки card (renamed from "Заявки за връщане")
Unified list of withdrawals + complaints for this order in one card. Each entry shows: type (отказ / рекламация), ref (WD-YYYY-NNNN or RCL-YYYY-NNNN), status, created_at, "Отвори ↗" link. Withdrawals link to `/admin/returns/[id]`; complaints link to in-page detail.

### History timeline (История card)
Two sources merged in chronological order:
- **Column-derived events** (always rendered): "Поръчка създадена", "Потвърдена", "Изпратена", "Доставена", "Плащане получено", "Възстановяване" (per refund row), "Рекламация" (per complaint row), "Отказана", plus invoice events derived from `invoices` rows (number set, sent_at set, plus the same for credit_notes).
- **Domain events from `order_audit_events`** (server-filtered allowlist): `order_items_changed`, `contact_info_changed`, `email_resent`, `status_force_override`, `data_repair`, `delivery_refused`, `package_lost`, `returned`, `recalled`, `partial_return`, `refund_annotation_edited`, `external_refund`, `payment_failed`, `dispute_opened`, `dispute_closed`, `dispute_funds_reinstated`, `withdrawal_requested`, `withdrawal_approved`, `withdrawal_goods_received`, `withdrawal_rejected`, `withdrawal_completed`, `withdrawal_status_force_override`, `invoice_number_set`, `invoice_marked_sent`, `credit_note_number_set`, `credit_note_marked_sent`. Server filters via `.in("event_type", ...)` so column-derived event types (`status_changed`, `*_recorded`, `tracking_number_set`, `cod_confirmed`) aren't double-counted; they're already represented by their respective columns.
- **Admin notes are NOT in the timeline** — they live solely in the dedicated "Вътрешни бележки" card.
- When adding a new outcome / domain event type: 1) add to `record_order_outcome` allow-list (migration), 2) add to `TIMELINE_EVENT_TYPES` in `getOrder` if it should appear, 3) add a case to `renderAuditEvent` in `app/admin/orders/[id]/page.tsx`.

### Order edit (contact + quantity)
Admin can correct wrong-address / typo-phone / "add one more box" scenarios on confirmed-but-not-shipped orders without cancel+reorder churn.
- Contact edit: customer-info card has an inline "Редактирай" button (visible only on `status='confirmed'`). Editable fields: first_name, last_name, phone, email, address, postal_code, city, notes. Email is editable (lowercased server-side); inline warning surfaces when the new email differs because email is the unsubscribe key. `updateOrderContact` validates each provided field, trims, atomically updates with `.eq('status', 'confirmed')` guard. **The client only sends fields that actually changed** vs. the order's current values. Errors render inline above the Save / Отказ buttons via a dedicated `contactError` state. The `emit_order_audit_events` trigger auto-emits a `contact_info_changed` event with per-field `{old, new}` pairs via `jsonb_strip_nulls`.
- Quantity edit (COD only): each line in the products card has a "Редактирай" button visible only when `payment_method='cod' AND status='confirmed' AND tracking_number IS NULL`. Delegates to the `edit_order_quantity` RPC. Fee structure stays frozen on edit. Card orders route through `replaces_order_id` instead. `updateOrderQuantity` emits `order_items_changed` via `record_order_outcome`.

### COD phone confirmation
For `payment_method='cod' AND status='confirmed'` orders, a prominent amber banner prompts the admin to call the customer before shipping. "Маркирай обаждането като потвърдено" → `markCodConfirmed` sets `cod_confirmed_at` + `cod_confirmed_by='admin'`, emits a `cod_confirmed` audit event. Once confirmed, the banner turns green. Idempotent via `.is('cod_confirmed_at', null)` guard at UPDATE time.

### COD shipment soft block
When admin opens "Генерирай товарителница" on a COD order with `cod_confirmed_at IS NULL`, an inline amber warning renders next to the button AND the click triggers `window.confirm` requiring explicit override (not a hard block).

### COD settlement
Form in Действия card for delivered unpaid COD orders (date picker, amount, ППП ref, bank ref); green status card shown after settlement recorded. Date picker `min` set to delivery date, `max` set to today; server validates date is not before delivery or in the future; date stored at 23:59:59 UTC.

### Card payment section
Shows the seller-settled (`seller_settled_at`) date — set automatically by the Stripe webhook on capture.

### Admin notes
Append-only JSONB array of `{text, created_at, author}` entries; reverse-chronological list. `addAdminNote` calls the `add_admin_note` RPC (atomic `jsonb ||` append). Author defaults to `'admin'` pre-launch.

### Actions
Status transitions with validation, cancellation requires reason field.

### Post-shipment outcomes
`delivery_refused`, `package_lost`, `returned`, `recalled` recorded via `recordOrderOutcome` — a **pure outcome recorder**, single-responsibility. No refund or inventory writes inside this action; those are handled separately by `recordRefund` (money) and `recordStockMovement` (goods). The UI coordinates them as a **guided multi-step flow**:
- After a successful outcome save, a context-specific "Next step" callout appears with buttons for "Open refund form" and "Later" / "Got it".
- **Prefill from outcome context**: clicking "Отвори формата за възстановяване" auto-populates the refund form — amount = full remaining balance, reason = `[<outcome label>] <outcome note>`, scroll + ring-highlight + focus.
- **"Linked to outcome" banner** in the refund form when opened from an outcome callout. The banner has an "Изчисти" link to strip the prefill.
- Linkage is **UI-only** — no DB column ties a refund row to an outcome event. Timeline correlation is temporal.

## Refund flow

### Two-step flow
**Step 1 — refund** (`recordRefund`): records a single row in `refunds`. Pure money concern, no inventory side effects. Phase 1 flow: admin issues Stripe refund in Stripe dashboard (card) or initiates bank transfer (COD), then records here. For card refunds the admin pastes the Stripe `re_...` refund ID; the unique index on `stripe_refund_id` dedupes against webhook arrivals from either direction. Client idempotency key (UUID) guards against double-submit.

- **Stripe verification on paste**: when `method='stripe'` and `stripeRefundId` is supplied, `recordRefund` calls `stripe.refunds.retrieve(id)` and checks: (1) refund exists; (2) `status==='succeeded'`; (3) `payment_intent` matches `order.stripe_payment_intent_id`; (4) `amount` matches `refundAmount`. One API call (~200ms) per admin Stripe refund.
- **affects_invoiced_supply** (defaults true): when the refund cancels/reduces an invoiced supply, a credit_note row should be auto-created. Admin can opt out by unchecking + providing a `credit_note_skip_reason` (audit trail for why no кредитно известие).
- **bank_transfer_ref**: required when `method='bank_transfer'` (DB CHECK enforces).
- **withdrawal_id**: optional dropdown linking the refund to a specific withdrawal. Set once, immutable.
- **Auto-creation of credit_note row**: after refund insert, `lib/credit-note.ts:autoCreateCreditNoteRow` checks the three conditions (invoice exists + invoice_number set + affects_invoiced_supply=true). If all true, inserts an `invoices` row with `type='credit_note'`, `refund_id`, `references_invoice_id`, `due_at = refunded_at + 5 days`. If any fails, no credit_note is created.

**Step 2 — refund mode + stock outcome**:
- **Mode "По артикули" (per-line allocation)**: admin picks specific order lines + quantities for the refund. Inserts `refund_items` rows. Independent of inventory — supports cases like shipping disputes, partial price reductions on specific items, or goodwill discounts where no goods physically move. Optionally followed by per-SKU disposition (`sellable` → `return_in`, `damaged` → audit-only `damaged`) which inserts `inventory_log` rows with `reference_type='return'`, `reference_id=<refund.id>`, `order_id=<order.id>`. Each call gets its own UUID stored in component state, preserved across retries.
- **Mode "Допълнителна сума само" (additional amount only, no items)**: refund row records the money; no `refund_items` rows; admin may still add disposition rows. Useful for shipping-only refunds and goodwill bumps that don't tie to a specific line.
- **Skip with reason**: radio list — `no_return` (goodwill), `package_lost`, `customer_keeps`, `other` (+ free-text). Appends an admin_note via `add_admin_note` RPC. Useful audit trail for refund-fraud analysis.

**Return cap**: `recordStockMovement` enforces `sum(prior returns for order+sku) + this quantity ≤ sum(order_out for order+sku)` when `referenceType='return' + type ∈ {return_in, damaged} + orderId` set. DB trigger `trg_enforce_order_return_cap` is the backstop with matching Bulgarian wording.

**Refund cap**: `enforce_refunds_total` trigger — sum across all refund rows cannot exceed `orders.total_amount`. Backstop to server-action validation.

**Refund_items caps**: `enforce_refund_items_quantity_cap` (per order_item: sum ≤ ordered quantity) + `enforce_refund_items_amount_cap` (per refund: sum ≤ refund amount). Items can sum to LESS than refund total — the difference is non-allocated.

**Full-flow idempotency**: `client_idempotency_key` UUID regenerated only when the whole flow completes (or admin clicks "Record new refund"). A retry during Step 2 re-resolves to the same refund row.

### Annotation edits
`RefundRow` allows admin to edit `reason`, `bank_transfer_ref`, `credit_note_skip_reason` on any row (including webhook-created rows). `updateRefundAnnotation` only touches those three columns; financial fields stay immutable per the append-only trigger. Each actual change emits a `refund_annotation_edited` audit event with per-field `{old, new}` pairs. No-op UPDATEs do not emit. (`credit_note_ref` was dropped — credit-note linkage now lives on `invoices.refund_id`.)

### Кредитно известие breakdown — not in the UI
The refund row does not compute or display a VAT/net/gross breakdown. Business is not VAT-registered; once it is, VAT amounts on credit notes will be pasted from Microinvest into the linked `invoices` row (type='credit_note'), never computed in the admin UI. Principle: system suggests, Microinvest decides, DB records, reports query.

### Webhook path (Stripe refunds)
`refund.created` / `refund.updated` / `refund.failed` / `charge.refunded` all converge on `upsertRefundFromStripe`, which branches by `refund.status`:
- `succeeded` → insert row (idempotent via `stripe_refund_id` unique partial index); fires `alertAdmin` on new insert only.
- `failed` → admin alert only (`⚠ Stripe refund FAILED — …`); no DB write because phase 1 doesn't store rows for money that didn't move.
- `canceled` → informational alert; no DB write.
- `pending` / `requires_action` → silent skip.

Webhook-originated refunds default `affects_invoiced_supply=true` and leave `refund_items` empty. The Stripe webhook configuration must subscribe to all four refund events for full coverage.

## Withdrawals (право на отказ — Чл. 50 ЗЗП)

### Intake
Admin-driven only — no public form. Customer emails or calls; admin opens the order, classifies, and registers via `Регистрирай отказ` in the "Още действия" dropdown. Hard block when order isn't delivered (withdrawal right starts on receipt). Soft warn when goods_received timestamp is logged on an unpaid order (allowed but unusual).

### Server actions
- `createWithdrawal(orderId, data)` — mints WD-YYYY-NNNN via `next_withdrawal_ref()` RPC, inserts withdrawal row at `status='requested'`. Validates ambiguous-email cases (creates anyway with the email admin entered; doesn't try to deduplicate to the order's email).
- `approveWithdrawal(id, { eligibility_*, return_required, ... })` — `requested → approved`. Sets `approved_at`, `approved_by`, plus `eligibility_*` classifications. `return_required` defaults true (Path A); set false for Path B (goodwill / customer keeps product).
- `markWithdrawalGoodsReceived(id, { eligibility_condition, return_tracking_number?, return_courier? })` — `approved → goods_received`. Path A only.
- `rejectWithdrawal(id, reason)` — `requested|approved → rejected`. Requires non-empty reason. Cannot reject after `goods_received_at` is set (DB CHECK).
- `completeWithdrawalNoReturn(id, { resolution_type, completion_note, refund_id? })` — Path B `approved → completed` for non-refund resolutions (replacement, none) or when admin already has a refund_id. Requires non-empty completion_note + resolution_type.
- **Auto-complete on refund**: when `recordRefund` is called with `withdrawalId` set, after inserting the refund row it updates the withdrawal with `refund_id` + `resolution_type='refund'`, and additionally flips status to `completed` if either condition holds:
  - Path A: `withdrawal.status='goods_received'` → completed
  - Path B: `withdrawal.status='approved' AND return_required=false AND completion_note IS NOT NULL` → completed
  
  Otherwise the withdrawal keeps its current status (refund recorded; completion happens later when admin marks goods received or completes via no-return path). If the withdrawal UPDATE fails after the refund has been inserted, the refund is NOT rolled back — money has moved; admin completes the withdrawal manually from the UI. Failure logged with both IDs for triage.
- `getWithdrawals(filter)` / `getWithdrawal(id)` / `getOrderWithdrawals(orderId)` — read paths. The first two power `/admin/returns` and `/admin/returns/[id]`.

### `/admin/returns` inbox
Unified list of withdrawals + complaints with type filter (all / withdrawal / complaint) and status tabs. `getWithdrawals` and `getComplaints` server actions return rows; UI merges by `created_at desc`. Each entry links to its detail page.

### `/admin/returns/[id]` (withdrawal detail)
- Header: ref + status badge + order link
- Eligibility classification card (3 dimensions: time_based, product_based, condition)
- State-machine action buttons rendered conditionally by current status — each opens a Radix Dialog with required fields (eligibility, condition, completion_note, etc.). Hide-form-after-success pattern: after approval/rejection/completion, the form view is replaced by a success message + "Регистрирай ново действие" button to avoid stale UI state.
- Refund linkage section: if `refund_id IS NOT NULL`, shows the linked refund row.
- Audit trail derived from `order_audit_events` filtered to withdrawal_* event types.

### Force-override path
`force_withdrawal_status_override(p_id, p_new_status, p_reason, p_actor)` RPC for data repair. Validates reason ≥ 20 chars, writes `withdrawal_status_force_override` audit event, bypasses the state-machine trigger transaction-locally. Not surfaced in the routine UI — used via direct DB interaction or future admin tooling.

## Complaints (рекламация — ЗЗП Чл. 122-127)
- Server actions: `recordComplaint(orderId, { defect_description, customer_demand })`, `resolveComplaint(complaintId, { resolution })`, `getComplaints(filter)`, `getOrderComplaints(orderId)`
- Auto-generated `complaint_ref` as `RCL-YYYY-NNNN` via DB sequence
- Surfaced in `/admin/returns` (unified inbox) and order detail "Свързани заявки" card
- Hide-form-after-success pattern in the registration dialog (matches withdrawals)

## Invoice Management
- Invoices generated externally via Microinvest Invoice Pro
- Admin enters invoice number manually in order detail Документи card (text input + save button per row)
- Server actions: `setInvoiceNumber(invoiceId, invoiceNumber)` saves the number and sets `invoice_date`; `markInvoiceSent(invoiceId)` records `sent_at`. Both work for `type='invoice'` and `type='credit_note'` rows.
- Invoice creation: an `invoices` row with `type='invoice'` is inserted at order creation time when the customer requested a фактура (createCheckoutSession + createCODOrder paths in stripe.ts). Insert-or-rollback semantics: if the order insert succeeds but the invoice insert fails, the order is rolled back (atomicity preserved at app layer).
- Credit_note rows auto-created by `lib/credit-note.ts:autoCreateCreditNoteRow` after refund insert. See § Refund flow.
- Admin invoices page (`/admin/invoices`) shows list of issued invoices (search, filter, CSV export)
- No PDF generation or invoice emailing in the codebase

## Inventory Panel (`/admin/inventory`)
- Stock cards per SKU: red badge = 0, amber ≤ 20, green > 20
- "Добави партида" dialog: product dropdown, quantity, batch ID, expiry date, notes — inserts `batch_in` row into `inventory_log` (and seeds `product_batches` if new (sku, batch_number))
- "Запиши движение" (record stock movement) dialog for manual types: `wholesale_out` (B2B; **batch_id required**), `sample_out`, `damaged` (warehouse-internal), `return_in` (B2B / orphaned), `adjustment_gain`, `adjustment_loss`. Customer-return movements go through the refund flow, not here.
- Movement log table: filter by SKU dropdown ("Последни движения"). Columns: date, SKU, type badge, ±quantity (or "0 (audit)" for customer-return-damaged), before/after, batch ID or order link, expiry date
- Server actions: `getInventoryStatus()`, `addInventoryBatch()`, `recordStockMovement()`, `getRecallCandidates()`
- Cancellation from order detail automatically calls `restore_inventory` RPC

### Recall / batch traceability export (over-approximate by SKU)
Lives in `/admin/inventory` → "Изтегляне от пазара / рекол" card. Useful for: pre-Tier 1 historical orders, suspected supplier issue without confirmed batch number, broad customer outreach.
- SKU dropdown (required), optional from/to date range, status filter to non-terminal (`confirmed`, `shipped`, `delivered`)
- "Покажи" runs the fetch; "Експорт CSV" builds the full list with BOM + Bulgarian header labels. Filename: `recall-<sku>-<date>.csv`.
- Sort: `confirmed` first, `shipped` second, `delivered` third (escalating-risk order).

## Batches Panel (`/admin/batches`)
- List page: SKU filter dropdown + status tabs (Всички / Активни / Изтеглени)
- Each row: SKU + product name, batch number (font-mono), expiry date with "X дни до изтичане" (red if expired, amber if < 30 days), available quantity (derived via `batch_quantity_available`), status badge, link to detail
- Empty-state copy points to `/admin/inventory` (where batches are first seeded via "Добави партида")

### Batch detail (`/admin/batches/[id]`)
- Header: batch_number + sku label + status badge
- "Детайли" card: SKU, batch №, expiry date, available quantity, recall metadata if recalled (recalled_at, recalled_by, recall_reason — all required by DB CHECK)
- "Засегнати поръчки" card: table with columns поръчка / клиент / контакт / статус / бр. (calls `affected_orders_for_batch` RPC). "Изтегли CSV" button when populated. CSV: order id, status, name, email, phone, city, shipped_at, delivered_at, quantity_from_batch, tracking_number.
- "Действия" card (active batches only): "Изтегли партидата от пазара" button → opens recall dialog with reason textarea (≥ 20 chars enforced both client-side and DB CHECK). Calls `recallBatch(id, reason)` server action. The DB trigger requires status flip + recalled_at + recalled_by + recall_reason in a single UPDATE; the server action fills all four.

### "Партиди" card (allocation as a fulfillment step, separate from courier-label generation)
Lives on `/admin/orders/[id]` (component: `app/admin/orders/[id]/batch-allocation-card.tsx`). Visible only when `status='confirmed' AND tracking_number IS NULL` — once a tracking number lands, the lifecycle trigger on `order_item_batches` freezes the rows and the card hides.

Flow:
- On mount, `getBatchAllocationView(orderId)` returns saved rows + the full pool of active batches per SKU (expired flagged via `isExpired`). If no saved rows exist, the card seeds the form using `buildExpectedFefoPlan` from `lib/batches/fefo.ts`. The seed runs client-side from the same view payload (no extra RPC).
- **Edit/Save lock UI**: card lands in view mode when there's a saved allocation — "Редактирай" enables, "Запази" disabled, all inputs/dropdowns/+Add/✕Remove disabled. Click "Редактирай" → form unlocks, "Запази" enables. Click "Запази" → save fires, form re-locks, success banner persists until the next edit. First-time visitors with no saved rows land in edit mode (FEFO seed is ready to save in one click).
- Per-line UI: header shows ordered/allocated counter; rows are `<batch dropdown · qty input · ✕>`; "+ Добави партида" splits across batches; "Покажи изтекли партиди" toggle reveals expired batches in the dropdown (hidden by default). Selecting an expired batch surfaces a red override box (checkbox + reason textarea, ≥ 20 chars). A non-FEFO selection surfaces an amber reason textarea (≥ 20 chars, blocking).
- Save: `saveBatchAllocation(orderId, rows)` validates per-line sum equality, FEFO compliance (compares against the expected plan from `isFefoCompliant`, requires non_fefo_reason on at least one row of a non-compliant line), expired-batch override + reason. Calls the `save_batch_allocation` RPC (atomic delete+insert under FOR UPDATE locks on the order + referenced batches). Emits `batch_allocation_saved` audit event with `{ fefo_compliant, has_expired_override, items: [...] }` payload, plus per-row `batch_allocation_overridden_fefo` / `batch_allocation_overridden_expired`.
- Other action buttons: "Преизчисли по FEFO" reloads with a fresh FEFO seed (drops local edits) and forces edit mode. "Изтрий разпределението" calls `clearBatchAllocation(orderId)` (DELETE on order_item_batches + `batch_allocation_cleared` audit), drops to edit mode.

### Shipment dialog — read-only allocation summary
When admin clicks "Генерирай товарителница", the dialog calls `getBatchAllocation(orderId)` and renders a read-only table of saved allocations (SKU / батч № / qty / expiry). "Редактирай разпределението" link closes the dialog and scrolls to the `data-batch-allocation-card` container on the page. Submit just calls `generateShipment(orderId, form)` — there's no longer a `confirmShipmentBatches` step in the submit handler.

`generateShipment` includes a precondition check: after acquiring the `tracking_number = '__generating__'` lock, it verifies per-SKU sum equality between `order_item_batches` and `order_items.quantity`. On mismatch it rolls back the lock and throws a friendly Bulgarian error (`"Преди да изпратите пратката към куриер, разпределете партидите за всички продукти в поръчката."`).

### Cancel shipment
After a shipment is generated, the order detail Actions card surfaces "Анулирай товарителницата" (visible when `status='confirmed' AND tracking_number IS NOT NULL AND tracking_number != '__generating__'`). Inline reason input (≥ 10 chars) + native `confirm()`. Calls `cancelShipment(orderId, reason)` which:
- Atomically clears `tracking_number` with an `.eq("tracking_number", previousTrackingNumber)` guard (race-safe against concurrent retry / double-cancel)
- Emits `batch_allocation_unlocked_after_shipment_cancelled` with `{ previous_tracking_number, reason }`
- Returns `{ success, previousTrackingNumber }`

Courier-side cancellation (calling Speedy/Econt to void the label) is **admin-managed externally** — the action is the internal half. Once `tracking_number` is null again, the lifecycle trigger releases the `order_item_batches` lock and the "Партиди" card re-renders.


## Email Notifications
- Admin gets email on new orders (card and COD) if `ADMIN_EMAIL` env var is set
- All email failures logged with order ID to Vercel function logs

## Customer Email Templates (`lib/email-template.ts`)
All templates share a common HTML shell with EGG ORIGIN header, seller address footer, and plain-text fallback.

| Template | Function | Type | When |
|---|---|---|---|
| Order Confirmation | `buildOrderConfirmationEmail()` | Transactional | On order submit — **wired** |
| Shipping Notification | `buildShippingEmail()` | Transactional | When admin marks shipped — template ready, not wired |
| Delivery Confirmation | `buildDeliveryEmail()` | Transactional | On delivery — **wired via `confirmDeliveryForOrder()` + cron** |
| Withdrawal Received | `buildWithdrawalReceivedEmail()` | Transactional | After `createWithdrawal` |
| Withdrawal Approved | `buildWithdrawalApprovedEmail()` | Transactional | After `approveWithdrawal` (branches on return_required) |
| Withdrawal Rejected | `buildWithdrawalRejectedEmail()` | Transactional | After `rejectWithdrawal` |
| Review Request | `buildReviewRequestEmail()` | Marketing | 3 days after delivery — **wired via cron** |
| Cross-sell | `buildCrossSellEmail()` | Marketing | 10 days after delivery — **wired via cron** |
| Abandoned Cart | `buildAbandonedCartEmail()` | Marketing | Template ready, not wired to cron |

### Security & Compliance
- All user data HTML-escaped via `escapeHtml()` before interpolation (prevents XSS/injection)
- Marketing emails include per-recipient HMAC-signed unsubscribe link (footer + plain text)
- Seller physical address in all email footers (CAN-SPAM / GDPR)
- Hidden preheader text for inbox preview
- UTM parameters on all clickable links
- `sendOrderConfirmationEmail()` in `lib/email-sender.ts` is the unified sender for both card and COD orders
- `sendDeliveryEmail()` — fire-and-forget with retry via `delivery_email_sent_at` marker; bypassed via `{ force: true }` for admin resends
- `notifyAdminNewOrder()` — admin notification for new orders
- Withdrawal senders: `sendWithdrawalReceivedEmail`, `sendWithdrawalApprovedEmail`, `sendWithdrawalRejectedEmail`
- Transactional emails have NO unsubscribe link — they are mandatory

### Manual resends (in the "Още действия" dropdown)
Admin can manually resend the three customer-facing transactional emails from the order detail page. Common triggers: customer says "I didn't get the email", email landed in spam, address was corrected via `updateOrderContact`.
- Server actions: `resendOrderConfirmationEmail`, `resendShippingEmail`, `resendDeliveryEmail`. Each validates admin, validates order state, calls the underlying helper, emits an `email_resent` audit event.
- Items gated by state rules: confirmation visible post-pending, shipping once `tracking_number` is set (not `__generating__`), delivery once `status='delivered'`.
- Feedback: `window.confirm` → transient banner near header (green ✓ auto-clears in ~4s; red error banner persists with "Затвори" link).
- Timestamp preservation: helpers keep their `.is(..., null)` guards on the success timestamp update, so the original first-sent time is preserved across resends.

## Automatic Delivery Confirmation (`lib/delivery-confirmation.ts`)
- All delivery paths (admin manual, cron polling, future webhooks) converge on `confirmDeliveryForOrder(orderId, deliveredAt, source)`
- Uses `confirm_delivery` RPC — atomic update WHERE `status = 'shipped'`, returns updated row. Idempotent.
- `confirmDeliveryByTrackingNumber()` is a **resolver only** — looks up order by tracking number, delegates to `confirmDeliveryForOrder()`. No state mutation.
- Admin `updateOrderStatus("delivered")` is an early-return branch that calls `confirmDeliveryForOrder(orderId, now, "admin")`

## Delivery Check Cron (`app/api/cron/delivery-checks/route.ts`)
- Daily at 18:00 UTC (~21:00 EET) via `vercel.json` (`0 18 * * *`) — Vercel Hobby tier limits crons to once daily
- Auth: `CRON_SECRET` verified with `timingSafeEqual`
- Queries shipped orders with tracking numbers, cursor-based: `ORDER BY delivery_status_checked_at ASC NULLS FIRST`, max 20 per run
- Only checks orders shipped > 2 hours ago
- Explicit courier routing: `SPEEDY_PARTNERS` / `ECONT_PARTNERS` arrays
- `delivery_status_checked_at` advanced only on **successful** courier API response
- Speedy tracking: `POST /shipment/track`, operation code `-14` = delivered
- Econt tracking: `POST /ShipmentStatusService.getShipmentStatuses.json`
- Email retry pass: re-attempts delivery email for orders where `delivered_at IS NOT NULL AND delivery_email_sent_at IS NULL`
- Returns `{ checked, delivered, emailRetries, failed }`

## Marketing Email Cron (`app/api/cron/marketing-emails/route.ts`)
- Daily cron at 07:00 UTC (~10:00 EET) via `vercel.json`
- Auth: `CRON_SECRET` verified with `timingSafeEqual`
- Single Postgres RPC `claim_marketing_emails(p_now, p_limit)` does everything in one DB call
- App loops over claimed rows, sends via Resend, updates log: `sent`/`failed`/`skipped`
- Max 50 emails per run, sequential sending
- `provider_message_id` stored for Resend dashboard cross-reference
- Failed rows retry up to 3 attempts (`attempt_count`)

## Unsubscribe System
- **Token:** Signed payload (`email|timestamp`) with HMAC-SHA256 via `UNSUBSCRIBE_SECRET` (required, no fallback)
- **Token verification:** `timingSafeEqual`, 90-day expiry
- **Page:** `app/(shop)/unsubscribe/page.tsx` — confirmation page
- **API:** `POST /api/unsubscribe` — sole mutation point, rate-limited (10 req/15min per IP), token length capped at 500
- **DB:** `email_unsubscribes` table keyed by lowercase email, RLS denies all public access
- **Layout:** `noindex, nofollow` metadata

## Marketing Email Database Tables
- `email_unsubscribes` — `email text PRIMARY KEY`, `unsubscribed_at timestamptz`
- `marketing_email_log` — `(order_id, email_type) UNIQUE`, status lifecycle: `pending → sending → sent/failed/skipped`
  - Columns: `provider_message_id`, `attempt_count`, `claimed_at`, `last_attempt_at`, `sent_at`, `error_message`
  - Partial index on `status IN ('pending', 'failed')` for claim queries
- RPC: `claim_marketing_emails(p_now, p_limit)` — find + insert + reclaim + claim in one call
