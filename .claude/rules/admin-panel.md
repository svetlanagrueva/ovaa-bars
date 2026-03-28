# Admin Panel

## Structure
- `/admin/dashboard` — revenue stats, action items, recent orders
- `/admin/orders` — paginated order list with filters (status, search, date, invoice)
- `/admin/orders/[id]` — order detail with history timeline, invoice management, admin notes, actions
- `/admin/invoices` — paginated invoice list with search, date filter, PDF download
- `/admin/inventory` — stock level cards per SKU, add-batch dialog, movement log
- `/admin/sales` — product promotions management (EU Omnibus compliant)
- `/admin/promo-codes` — promo code management
- `/admin/login` — single password auth

## Auth
- Single password stored in `ADMIN_PASSWORD` env var
- HMAC-SHA256 session tokens with dual timeout (8h absolute, 30min idle)
- IP-based rate limiting (5 attempts/15min, in-memory)
- Middleware protects all `/admin/*` routes except `/admin/login`

## Dashboard
- Revenue stats via Postgres RPC function `dashboard_stats` (SQL aggregation, not in-memory)
- Shows product revenue only (excludes shipping_fee and cod_fee)
- Action items: pending orders, invoices awaiting issuance
- Last 10 orders with links

## Orders
- Pagination: 100 per page, with total count
- Filters: status tabs, text search (ID/name/email), date range, invoice filter (all/requested/issued/pending)
- URL params supported: `?status=pending`, `?invoiceFilter=pending` (for dashboard links)
- CSV export fetches ALL matching results via `getAllOrders` (batches of 1000)
- CSV columns: ID, date, name, email, phone, city, products revenue, promo discount, shipping fee, COD fee, total, payment, delivery, status, invoice #, invoice date

## Order Detail
- Customer info, order details, product breakdown with stored fees
- Price breakdown uses stored `shipping_fee` and `cod_fee` (not recalculated from constants)
- Invoice section: issue invoice (with confirmation dialog), download PDF (invoice or proforma)
- Invoice deadline: 5 days from payment (card: created_at, COD: delivered_at)
- History timeline: chronological events sorted by date, with fallback for pre-timestamp orders
- Admin notes: editable text field, saved to `admin_notes` column
- Actions: status transitions with validation, cancellation requires reason field

## Invoice Issuing
- Atomic via Postgres function `issue_invoice_number` (single transaction: allocate number + assign to order)
- Confirmation dialog before issuing (irreversible)
- Race condition protected: `.is("invoice_number", null)` guard
- PDF generated after number is secured
- Customer emailed automatically

## Inventory Panel (`/admin/inventory`)
- Stock cards per SKU: red badge = 0, amber ≤ 20, green > 20
- "Добави партида" dialog: product dropdown, quantity, batch ID, expiry date, notes — inserts `batch_in` row into `inventory_log`
- Movement log table: date, SKU, type badge, ±quantity, before/after columns, batch ID or order link, expiry date
- Server actions: `getInventoryStatus()`, `addInventoryBatch()` (validates SKU against PRODUCTS list)
- Cancellation from order detail automatically calls `restore_inventory` RPC — stock updates immediately

## Email Notifications
- Admin gets email on new orders (card and COD) if `ADMIN_EMAIL` env var is set
- All email failures logged with order ID to Vercel function logs
