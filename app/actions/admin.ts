"use server"

import { createAdminSession, validateAdminSession, destroyAdminSession } from "@/lib/admin-auth"
import { createClient } from "@/lib/supabase/server"
import { PRODUCTS, formatPrice } from "@/lib/products"
import { revalidateTag } from "next/cache"
import { getDeliveryLabel } from "@/lib/delivery"
import { getEmailClient, isEmailEnabled } from "@/lib/email-client"
import { redirect } from "next/navigation"
import { createHmac, timingSafeEqual } from "crypto"
import { headers } from "next/headers"
import { createShipment as createSpeedyShipment } from "@/lib/speedy"
import { createShipment as createEcontShipment } from "@/lib/econt"
import { confirmDeliveryForOrder } from "@/lib/delivery-confirmation"
import { hasCustomerPaid } from "@/lib/orders"
import { requireEnv } from "@/lib/env"
import { stripe } from "@/lib/stripe"
import { sanitizeError } from "@/lib/logger"
import {
  sendOrderConfirmationEmail,
  sendDeliveryEmail,
  sendWithdrawalReceivedEmail,
  sendWithdrawalApprovedEmail,
  sendWithdrawalRejectedEmail,
} from "@/lib/email-sender"
import { autoCreateCreditNoteRow } from "@/lib/credit-note"
import { buildExpectedFefoPlan, isFefoCompliant } from "@/lib/batches/fefo"
import { translateRpcError } from "@/lib/rpc-errors"

// Rate limiting (in-memory, best-effort in serverless)
const MAX_LOGIN_ATTEMPTS = 5
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000 // 15 minutes
const loginAttempts = new Map<string, { count: number; firstAttempt: number }>()

export async function loginAdmin(password: string) {
  const expected = process.env.ADMIN_PASSWORD
  if (!expected) throw new Error("Admin not configured")

  // Rate limiting by IP
  const now = Date.now()
  for (const [key, entry] of loginAttempts.entries()) {
    if (now - entry.firstAttempt > RATE_LIMIT_WINDOW_MS) {
      loginAttempts.delete(key)
    }
  }

  const headersList = await headers()
  const ip = headersList.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  const attempts = loginAttempts.get(ip)
  if (attempts && attempts.count >= MAX_LOGIN_ATTEMPTS) {
    throw new Error("Твърде много опити. Опитайте по-късно.")
  }

  // Hash both values to fixed-length digests before comparing
  // This prevents leaking the password length via timing
  const passwordHash = createHmac("sha256", "password-check").update(password).digest()
  const expectedHash = createHmac("sha256", "password-check").update(expected).digest()
  const match = timingSafeEqual(passwordHash, expectedHash)

  if (!match) {
    if (attempts) {
      attempts.count++
    } else {
      loginAttempts.set(ip, { count: 1, firstAttempt: now })
    }
    throw new Error("Грешна парола")
  }

  loginAttempts.delete(ip)
  await createAdminSession()
  redirect("/admin/dashboard")
}

export async function logoutAdmin() {
  await destroyAdminSession()
  redirect("/admin/login")
}

async function requireAdmin() {
  const valid = await validateAdminSession()
  if (!valid) throw new Error("Unauthorized")
}

export interface DashboardStats {
  // `revenue` is GROSS product revenue (total_amount - shipping_fee -
  // cod_fee summed over orders whose created_at falls in the window).
  // `refunds` is SUM(refunds.amount_cents) for refunds whose refunded_at
  // falls in the same window — Shopify-style: a refund issued today
  // counts against today regardless of when the order was placed. Net
  // revenue is `revenue - refunds`, computed at the rendering layer.
  today: { orders: number; revenue: number; refunds: number }
  week: { orders: number; revenue: number; refunds: number }
  month: { orders: number; revenue: number; refunds: number }
  pendingOrders: number
  invoicesAwaiting: number
  creditNotesAwaiting: number
  awaitingSettlement: number
  inventoryDebtSkus: number
  withdrawalsPending: number
  recentOrders: Array<{
    id: string
    created_at: string
    first_name: string
    last_name: string
    total_amount: number
    status: string
    payment_method: string
  }>
}

export async function getDashboardStats(): Promise<DashboardStats> {
  await requireAdmin()
  const supabase = await createClient()

  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  const day = now.getDay()
  const diffToMonday = day === 0 ? 6 : day - 1
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffToMonday).toISOString()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  // Single SQL call for all aggregated stats
  const { data: statsData, error: statsError } = await supabase.rpc("dashboard_stats", {
    p_today_start: todayStart,
    p_week_start: weekStart,
    p_month_start: monthStart,
  })

  if (statsError) {
    console.error("Failed to fetch dashboard stats:", statsError)
    throw new Error("Failed to fetch dashboard stats")
  }

  const s = statsData || {}

  // Recent orders (last 10) — small fixed query, fine to fetch as rows
  const { data: recentOrders } = await supabase
    .from("orders")
    .select("id, created_at, first_name, last_name, total_amount, status, payment_method")
    .neq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(10)

  return {
    today: { orders: s.today_orders ?? 0, revenue: s.today_revenue ?? 0, refunds: s.today_refunds ?? 0 },
    week: { orders: s.week_orders ?? 0, revenue: s.week_revenue ?? 0, refunds: s.week_refunds ?? 0 },
    month: { orders: s.month_orders ?? 0, revenue: s.month_revenue ?? 0, refunds: s.month_refunds ?? 0 },
    pendingOrders: s.pending_orders ?? 0,
    invoicesAwaiting: s.invoices_awaiting ?? 0,
    creditNotesAwaiting: s.credit_notes_awaiting ?? 0,
    awaitingSettlement: s.awaiting_settlement ?? 0,
    inventoryDebtSkus: s.inventory_debt_skus ?? 0,
    withdrawalsPending: s.withdrawals_pending ?? 0,
    recentOrders: recentOrders || [],
  }
}

export interface OrderSummary {
  id: string
  created_at: string
  first_name: string
  last_name: string
  email: string
  phone: string
  city: string
  status: string
  payment_method: string
  total_amount: number
  logistics_partner: string
  tracking_number: string | null
  shipping_fee: number
  cod_fee: number
  discount_amount: number
  shipped_at: string | null
  delivered_at: string | null
  seller_settled_at: string | null
  // Sum of refunds.amount_cents across all refunds for the order. Surfaces
  // a "this one already had a refund" signal in the awaiting-settlement
  // worklist so admin doesn't approve courier settlement on auto-pilot.
  refunds_total: number
  // Surfaced from joined invoices row of type='invoice' (one per order at most).
  // Kept on the summary row for quick filtering / list display; the full
  // OrderDetail.invoices array carries credit_note rows too.
  invoice: OrderInvoiceSummary | null
  // Aggregate document state across all invoices rows (initial + credit_notes).
  // Computed server-side; worst-state-wins ordering so the orders list shows
  // a single accurate badge per row even when multiple docs are attached.
  invoiceState: InvoiceAggregateState
}

export type InvoiceAggregateState =
  | "none"          // no invoices row at all
  | "pending_issue" // at least one row has invoice_number IS NULL
  | "pending_send"  // all rows have invoice_number, at least one has sent_at IS NULL
  | "complete"      // all rows have both invoice_number AND sent_at

export interface OrderInvoiceSummary {
  invoice_number: string | null
  invoice_date: string | null
}

export interface OrderDetail extends OrderSummary {
  address: string
  postal_code: string
  notes: string
  items: Array<{
    id: number
    productId: string
    productName: string
    sku: string
    quantity: number
    priceInCents: number
    cancelledQuantity: number
    lineNo: number
  }>
  econt_office_id: number | null
  econt_office_code: string | null
  econt_office_name: string | null
  econt_office_address: string | null
  speedy_office_id: number | null
  speedy_office_name: string | null
  speedy_office_address: string | null
  stripe_session_id: string | null
  stripe_payment_intent_id: string | null
  stripe_receipt_url: string | null
  order_confirmation_sent_at: string | null
  delivery_email_sent_at: string | null
  promo_code: string | null
  discount_amount: number
  shipping_fee: number
  cod_fee: number
  confirmed_at: string | null
  shipped_at: string | null
  delivered_at: string | null
  cancelled_at: string | null
  admin_notes: Array<{ text: string; created_at: string; author?: string }>
  cancellation_reason: string | null
  seller_settled_at: string | null
  courier_ppp_ref: string | null
  settlement_ref: string | null
  settlement_amount: number | null
  cod_confirmed_at: string | null
  cod_confirmed_by: string | null
  refunds: OrderRefund[]
  // All invoice rows for this order — type='invoice' (at most one) plus any
  // type='credit_note' rows auto-created on refunds.
  invoices: Invoice[]
  // All withdrawal rows for this order. At most one is open at a time
  // (uq_open_withdrawal_per_order). Closed (completed/rejected) ones remain
  // for audit history.
  withdrawals: Withdrawal[]
  // Inventory movements of type return_in / damaged for this order, used by
  // the admin UI to show the kредитно-известие breakdown per refund (linked
  // via inventory_log.reference_id = refunds.id). No FK relationship
  // exists in the DB (reference_id is polymorphic text), so we fetch
  // separately and match client-side.
  inventoryReturns: OrderInventoryReturn[]
  // Domain events from order_audit_events that aren't already represented
  // by column-derived rows in the timeline (status changes, seller_settled_at,
  // shipped_at, etc. are already captured via their respective columns —
  // surfacing both would double-count). The fetch in getOrder filters to
  // an allowlist of event_types: order_items_changed, contact_info_changed,
  // email_resent, status_force_override, data_repair, the post-shipment
  // outcomes, refund_annotation_edited, payment_failed, dispute_*,
  // external_refund.
  auditEvents: OrderAuditEvent[]
}

export interface OrderAuditEvent {
  id: number
  event_type: string
  actor: string
  payload: Record<string, unknown>
  created_at: string
}

export interface OrderInventoryReturn {
  id: number
  sku: string
  quantity: number
  type: "return_in" | "damaged"
  reference_id: string | null
  created_at: string
}

export interface RefundItem {
  id: string
  refund_id: string
  order_item_id: number
  quantity: number
  amount_cents: number
  created_at: string
}

export interface OrderRefund {
  id: string
  order_id: string
  stripe_refund_id: string | null
  bank_transfer_ref: string | null
  amount_cents: number
  method: "stripe" | "bank_transfer"
  source: "admin_ui" | "stripe_webhook"
  reason: string | null
  affects_invoiced_supply: boolean
  credit_note_skip_reason: string | null
  recorded_by: string
  refunded_at: string
  created_at: string
  updated_at: string
  // Per-line allocation (NEW). Empty when refund is a custom amount only
  // (no item allocation). Webhook-originated refunds always have empty
  // items since the webhook has no item context.
  items: RefundItem[]
}

export interface Invoice {
  id: string
  order_id: string
  type: "invoice" | "credit_note"
  refund_id: string | null
  references_invoice_id: string | null
  invoice_type: "individual" | "company" | null
  company_name: string | null
  eik: string | null
  vat_number: string | null
  mol: string | null
  address: string | null
  invoice_number: string | null
  invoice_date: string | null
  sent_at: string | null
  due_at: string | null
  created_at: string
  updated_at: string
}

interface OrderQueryParams {
  status?: string
  search?: string
  dateFrom?: string
  dateTo?: string
  invoiceFilter?: string
  paymentFilter?: string
}

const ORDERS_PAGE_SIZE = 100

function escapeIlike(value: string): string {
  return value.replace(/%/g, "\\%").replace(/_/g, "\\_")
}

function applyOrderFilters(query: any, params?: OrderQueryParams) {
  const status = params?.status
  if (status && status !== "all") {
    query = query.eq("status", status)
  } else {
    // Exclude pending — these are abandoned card checkouts (order created before Stripe redirect, never confirmed by webhook)
    query = query.neq("status", "pending")
  }

  const dateFrom = params?.dateFrom
  if (dateFrom) {
    query = query.gte("created_at", `${dateFrom}T00:00:00`)
  }

  const dateTo = params?.dateTo
  if (dateTo) {
    query = query.lte("created_at", `${dateTo}T23:59:59`)
  }

  const search = params?.search?.trim().toLowerCase()
  if (search) {
    const escaped = escapeIlike(search)
    const uuidPrefix = /^#?[0-9a-f-]+$/i.test(search)
    if (uuidPrefix) {
      const cleanId = search.replace(/^#/, "")
      query = query.ilike("id", `${cleanId}%`)
    } else if (search.includes("@")) {
      query = query.ilike("email", `%${escaped}%`)
    } else {
      query = query.or(`first_name.ilike.%${escaped}%,last_name.ilike.%${escaped}%,email.ilike.%${escaped}%`)
    }
  }

  const paymentFilter = params?.paymentFilter
  if (paymentFilter === "awaiting-settlement") {
    query = query.eq("payment_method", "cod").eq("status", "delivered").is("seller_settled_at", null)
  } else if (paymentFilter === "settled") {
    query = query.eq("payment_method", "cod").not("seller_settled_at", "is", null)
  }

  return query
}

// Resolve an invoice filter to the set of order_ids whose aggregate document
// state matches. The aggregate considers BOTH initial invoices and credit_notes
// for the order — a single badge per order that surfaces the worst pending
// state across all docs (Shopify-style worst-state-wins).
//
// Filter values:
//   - all           → no filter
//   - requested     → any invoice row exists (legacy compatibility)
//   - pending_issue → at least one row has invoice_number IS NULL
//   - pending_send  → all rows have invoice_number set, at least one has
//                     sent_at IS NULL (issue done, send still owed)
//   - complete      → every row has both invoice_number AND sent_at
//
// Implementation: fetch all (order_id, invoice_number, sent_at) tuples once,
// aggregate per order_id in JS, then filter to matching ids. One roundtrip,
// scales fine at our row counts.
//
// Returns null when no filter is applied (caller should skip the .in()).
async function resolveInvoiceFilterOrderIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  invoiceFilter: string | undefined,
): Promise<string[] | null> {
  if (!invoiceFilter || invoiceFilter === "all") return null

  const { data, error } = await supabase
    .from("invoices")
    .select("order_id, invoice_number, sent_at")
  if (error) {
    console.error("Failed to resolve invoice filter:", error)
    return []
  }

  type Row = { order_id: string; invoice_number: string | null; sent_at: string | null }
  const byOrder = new Map<string, Row[]>()
  for (const r of (data ?? []) as Row[]) {
    const list = byOrder.get(r.order_id) ?? []
    list.push(r)
    byOrder.set(r.order_id, list)
  }

  const matches: string[] = []
  for (const [orderId, rows] of byOrder.entries()) {
    const state = computeInvoiceState(rows)
    // "requested" = "За обработка" = any pending work (issue OR send),
    // intentionally excluding `complete` so finished orders don't pollute
    // the work queue.
    if (invoiceFilter === "requested" && (state === "pending_issue" || state === "pending_send")) matches.push(orderId)
    else if (invoiceFilter === "pending_issue" && state === "pending_issue") matches.push(orderId)
    else if (invoiceFilter === "pending_send" && state === "pending_send") matches.push(orderId)
    else if (invoiceFilter === "complete" && state === "complete") matches.push(orderId)
  }
  return matches
}

// Worst-state-wins aggregation. Caller passes all invoice rows for one order
// (initial + any credit_notes). Empty rows → "none".
function computeInvoiceState(
  rows: Array<{ invoice_number: string | null; sent_at: string | null }>,
): InvoiceAggregateState {
  if (rows.length === 0) return "none"
  if (rows.some((r) => !r.invoice_number)) return "pending_issue"
  if (rows.some((r) => !r.sent_at)) return "pending_send"
  return "complete"
}

// Map the joined invoices array on an order summary row to the {invoice_number,
// invoice_date} shape expected on OrderSummary.invoice. The DB invariant is
// 0..1 invoices row of type='invoice' per order.
function pickInitialInvoice(
  invoices: Array<{ type: string; invoice_number: string | null; invoice_date: string | null }> | null | undefined,
): OrderInvoiceSummary | null {
  if (!invoices || invoices.length === 0) return null
  const initial = invoices.find((i) => i.type === "invoice")
  if (!initial) return null
  return {
    invoice_number: initial.invoice_number,
    invoice_date: initial.invoice_date,
  }
}

export async function getOrders(params?: OrderQueryParams & { page?: number }): Promise<{ orders: OrderSummary[]; total: number }> {
  await requireAdmin()
  const supabase = await createClient()

  const page = Math.max(0, Math.floor(Number(params?.page ?? 0)) || 0)
  const from = page * ORDERS_PAGE_SIZE
  const to = from + ORDERS_PAGE_SIZE - 1

  const invoiceOrderIds = await resolveInvoiceFilterOrderIds(supabase, params?.invoiceFilter)
  if (invoiceOrderIds !== null && invoiceOrderIds.length === 0) {
    return { orders: [], total: 0 }
  }

  let query = supabase
    .from("orders")
    .select(
      "id, created_at, first_name, last_name, email, phone, city, status, payment_method, total_amount, shipping_fee, cod_fee, discount_amount, logistics_partner, tracking_number, shipped_at, delivered_at, seller_settled_at, invoices(type, invoice_number, invoice_date, sent_at), refunds(amount_cents)",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, to)

  query = applyOrderFilters(query, params)
  if (invoiceOrderIds !== null) {
    query = query.in("id", invoiceOrderIds)
  }

  const { data, error, count } = await query

  if (error) {
    console.error("Failed to fetch orders:", error)
    throw new Error("Failed to fetch orders")
  }

  const orders: OrderSummary[] = (data ?? []).map((row: any) => {
    const { invoices, ...rest } = row
    const refundRows = ((rest as { refunds?: Array<{ amount_cents: number }> }).refunds ?? [])
    const refundsTotal = refundRows.reduce(
      (s: number, r: { amount_cents: number }) => s + (r.amount_cents ?? 0),
      0,
    )
    return {
      ...rest,
      invoice: pickInitialInvoice(invoices),
      invoiceState: computeInvoiceState(
        ((invoices ?? []) as Array<{ invoice_number: string | null; sent_at: string | null }>),
      ),
      refunds_total: refundsTotal,
    }
  })

  return { orders, total: count ?? 0 }
}

export async function getAllOrders(params?: OrderQueryParams): Promise<OrderSummary[]> {
  await requireAdmin()
  const supabase = await createClient()

  const invoiceOrderIds = await resolveInvoiceFilterOrderIds(supabase, params?.invoiceFilter)
  if (invoiceOrderIds !== null && invoiceOrderIds.length === 0) {
    return []
  }

  const results: OrderSummary[] = []
  let from = 0
  const batchSize = 1000

  while (true) {
    let query = supabase
      .from("orders")
      .select(
        "id, created_at, first_name, last_name, email, phone, city, status, payment_method, total_amount, shipping_fee, cod_fee, discount_amount, logistics_partner, tracking_number, shipped_at, delivered_at, seller_settled_at, invoices(type, invoice_number, invoice_date, sent_at), refunds(amount_cents)",
      )
      .order("created_at", { ascending: false })
      .range(from, from + batchSize - 1)

    query = applyOrderFilters(query, params)
    if (invoiceOrderIds !== null) {
      query = query.in("id", invoiceOrderIds)
    }

    const { data, error } = await query
    if (error) {
      console.error("Failed to fetch orders:", error)
      throw new Error("Failed to fetch orders")
    }

    const mapped: OrderSummary[] = (data ?? []).map((row: any) => {
      const { invoices, ...rest } = row
      const refundRows = ((rest as { refunds?: Array<{ amount_cents: number }> }).refunds ?? [])
    const refundsTotal = refundRows.reduce(
      (s: number, r: { amount_cents: number }) => s + (r.amount_cents ?? 0),
      0,
    )
    return {
      ...rest,
      invoice: pickInitialInvoice(invoices),
      invoiceState: computeInvoiceState(
        ((invoices ?? []) as Array<{ invoice_number: string | null; sent_at: string | null }>),
      ),
      refunds_total: refundsTotal,
    }
    })
    results.push(...mapped)
    if (!data || data.length < batchSize) break
    from += batchSize
  }

  return results
}

export interface InvoiceSummary {
  id: string                   // invoices.id (NOT orders.id)
  order_id: string
  type: "invoice" | "credit_note"
  invoice_number: string       // not null since list filters on issued
  invoice_date: string
  due_at: string | null
  // Joined customer info from orders
  customer_first_name: string
  customer_last_name: string
  customer_email: string
  order_total_amount: number
  // Invoice profile (null for credit_note)
  invoice_type: "individual" | "company" | null
  company_name: string | null
  eik: string | null
}

interface InvoiceQueryParams {
  search?: string
  dateFrom?: string
  dateTo?: string
  type?: "invoice" | "credit_note" | "all"
}

function applyInvoiceFilters(query: any, params?: InvoiceQueryParams) {
  const dateFrom = params?.dateFrom
  if (dateFrom) {
    query = query.gte("invoice_date", `${dateFrom}T00:00:00`)
  }

  const dateTo = params?.dateTo
  if (dateTo) {
    query = query.lte("invoice_date", `${dateTo}T23:59:59`)
  }

  const type = params?.type
  if (type === "invoice" || type === "credit_note") {
    query = query.eq("type", type)
  }

  const search = params?.search?.trim().toLowerCase()
  if (search) {
    const escaped = escapeIlike(search)
    // Invoice-number search; customer-name/email/company-name search needs a
    // joined-orders ilike which PostgREST doesn't expose easily, so fall back
    // to invoice_number search only when input is digits, and to company_name
    // (on invoices itself) otherwise. For richer search the admin UI can add
    // a separate filter, or we can switch to a Postgres full-text view.
    if (/^[a-zA-Z0-9-]+$/.test(search)) {
      query = query.ilike("invoice_number", `%${escaped}%`)
    } else {
      query = query.ilike("company_name", `%${escaped}%`)
    }
  }

  return query
}

function mapInvoiceRowToSummary(row: any): InvoiceSummary {
  const order = row.orders ?? row.order ?? {}
  return {
    id: row.id,
    order_id: row.order_id,
    type: row.type,
    invoice_number: row.invoice_number,
    invoice_date: row.invoice_date,
    due_at: row.due_at,
    customer_first_name: order.first_name ?? "",
    customer_last_name: order.last_name ?? "",
    customer_email: order.email ?? "",
    order_total_amount: order.total_amount ?? 0,
    invoice_type: row.invoice_type,
    company_name: row.company_name,
    eik: row.eik,
  }
}

export async function getInvoices(params?: InvoiceQueryParams & { page?: number }): Promise<{ invoices: InvoiceSummary[]; total: number }> {
  await requireAdmin()
  const supabase = await createClient()

  const page = Math.max(0, Math.floor(Number(params?.page ?? 0)) || 0)
  const from = page * ORDERS_PAGE_SIZE
  const to = from + ORDERS_PAGE_SIZE - 1

  let query = supabase
    .from("invoices")
    .select(
      "id, order_id, type, invoice_number, invoice_date, due_at, invoice_type, company_name, eik, orders!inner(first_name, last_name, email, total_amount)",
      { count: "exact" },
    )
    .not("invoice_number", "is", null)
    .order("invoice_date", { ascending: false })
    .range(from, to)

  query = applyInvoiceFilters(query, params)

  const { data, error, count } = await query

  if (error) {
    console.error("Failed to fetch invoices:", error)
    throw new Error("Failed to fetch invoices")
  }

  return {
    invoices: (data ?? []).map(mapInvoiceRowToSummary),
    total: count ?? 0,
  }
}

export async function getAllInvoices(params?: InvoiceQueryParams): Promise<InvoiceSummary[]> {
  await requireAdmin()
  const supabase = await createClient()

  const results: InvoiceSummary[] = []
  let from = 0
  const batchSize = 1000

  while (true) {
    let query = supabase
      .from("invoices")
      .select(
        "id, order_id, type, invoice_number, invoice_date, due_at, invoice_type, company_name, eik, orders!inner(first_name, last_name, email, total_amount)",
      )
      .not("invoice_number", "is", null)
      .order("invoice_date", { ascending: false })
      .range(from, from + batchSize - 1)

    query = applyInvoiceFilters(query, params)

    const { data, error } = await query
    if (error) {
      console.error("Failed to fetch invoices:", error)
      throw new Error("Failed to fetch invoices")
    }

    results.push(...((data ?? []).map(mapInvoiceRowToSummary)))
    if (!data || data.length < batchSize) break
    from += batchSize
  }

  return results
}

export async function getOrder(orderId: string): Promise<OrderDetail> {
  await requireAdmin()

  if (!UUID_REGEX.test(orderId)) {
    throw new Error("Invalid order ID")
  }

  const supabase = await createClient()

  // Allowlist of audit event types to surface in the timeline. Events
  // already covered by column-derived rows in the UI (status_changed,
  // seller_settled_at_recorded, shipped_at_recorded, etc.) are intentionally
  // excluded to avoid double-counting in the timeline.
  const TIMELINE_EVENT_TYPES = [
    "order_items_changed",
    "contact_info_changed",
    "email_resent",
    "status_force_override",
    "data_repair",
    "delivery_refused",
    "package_lost",
    "returned",
    "recalled",
    "partial_return",
    "refund_annotation_edited",
    "external_refund",
    "payment_failed",
    "dispute_opened",
    "dispute_closed",
    "dispute_funds_reinstated",
  ]

  const [orderResult, returnsResult, auditResult, invoicesResult, withdrawalsResult] = await Promise.all([
    supabase
      .from("orders")
      .select(`
        *,
        items:order_items(
          id,
          productId:product_id,
          productName:product_name,
          sku,
          quantity,
          priceInCents:unit_price_cents,
          cancelledQuantity:cancelled_quantity,
          lineNo:line_no
        ),
        refunds(
          id,
          order_id,
          stripe_refund_id,
          bank_transfer_ref,
          amount_cents,
          method,
          source,
          reason,
          affects_invoiced_supply,
          credit_note_skip_reason,
          recorded_by,
          refunded_at,
          created_at,
          updated_at,
          items:refund_items(
            id,
            refund_id,
            order_item_id,
            quantity,
            amount_cents,
            created_at
          )
        )
      `)
      .eq("id", orderId)
      .order("refunded_at", { foreignTable: "refunds", ascending: false })
      .single(),
    // inventory_log has no FK to refunds (reference_id is polymorphic
    // text), so PostgREST can't nest it under refunds. Fetch separately and
    // let the client match by reference_id = refund.id.
    supabase
      .from("inventory_log")
      .select("id, sku, quantity, type, reference_id, created_at")
      .eq("order_id", orderId)
      .eq("reference_type", "return")
      .order("created_at", { ascending: true }),
    supabase
      .from("order_audit_events")
      .select("id, event_type, actor, payload, created_at")
      .eq("order_id", orderId)
      .in("event_type", TIMELINE_EVENT_TYPES)
      .order("created_at", { ascending: true }),
    // All invoice rows for this order (initial фактура + any кредитни известия).
    supabase
      .from("invoices")
      .select("id, order_id, type, refund_id, references_invoice_id, invoice_type, company_name, eik, vat_number, mol, address, invoice_number, invoice_date, sent_at, due_at, created_at, updated_at")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true }),
    // Withdrawals (право на отказ) for this order — open + closed history.
    supabase
      .from("withdrawals")
      .select("*")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true }),
  ])

  if (orderResult.error || !orderResult.data) {
    throw new Error("Order not found")
  }

  const returns = (returnsResult.data ?? []) as OrderInventoryReturn[]
  if (returnsResult.error) {
    // Don't block the order view on a returns fetch error — just log and
    // show an empty list. The credit-note breakdown will degrade gracefully
    // to the flat-amount view.
    console.error(`Failed to fetch inventory returns for order ${orderId}:`, returnsResult.error)
  }

  const auditEvents = (auditResult.data ?? []) as OrderAuditEvent[]
  if (auditResult.error) {
    // Same fail-open: render the order without audit events rather than
    // blocking the page. The column-derived timeline events are still
    // visible.
    console.error(`Failed to fetch audit events for order ${orderId}:`, auditResult.error)
  }

  const invoices = (invoicesResult.data ?? []) as Invoice[]
  if (invoicesResult.error) {
    console.error(`Failed to fetch invoices for order ${orderId}:`, invoicesResult.error)
  }

  const withdrawals = (withdrawalsResult.data ?? []) as Withdrawal[]
  if (withdrawalsResult.error) {
    console.error(`Failed to fetch withdrawals for order ${orderId}:`, withdrawalsResult.error)
  }

  // Surface the (at most one) initial invoice as the OrderSummary.invoice
  // shape so list-style consumers see it identically to the orders-list path.
  const initialInvoice = invoices.find((inv) => inv.type === "invoice") ?? null
  const invoiceSummary: OrderInvoiceSummary | null = initialInvoice
    ? {
        invoice_number: initialInvoice.invoice_number,
        invoice_date: initialInvoice.invoice_date,
      }
    : null

  const refundRows = (orderResult.data.refunds ?? []) as Array<{ amount_cents: number }>
  return {
    ...orderResult.data,
    invoice: invoiceSummary,
    invoiceState: computeInvoiceState(invoices),
    refunds_total: refundRows.reduce((s, r) => s + (r.amount_cents ?? 0), 0),
    invoices,
    withdrawals,
    inventoryReturns: returns,
    auditEvents,
  }
}

// Valid status transitions
const VALID_TRANSITIONS: Record<string, string[]> = {
  confirmed: ["shipped", "cancelled"],
  shipped: ["delivered"],
  pending: ["confirmed", "cancelled"],
}

export async function updateOrderStatus(
  orderId: string,
  newStatus: string,
  trackingNumber?: string,
  cancellationReason?: string,
) {
  await requireAdmin()

  if (!UUID_REGEX.test(orderId)) {
    throw new Error("Invalid order ID")
  }

  if (newStatus === "shipped" && (!trackingNumber || trackingNumber.trim().length === 0)) {
    throw new Error("Tracking number is required for shipping")
  }
  if (trackingNumber && trackingNumber.length > 200) {
    throw new Error("Tracking number is too long")
  }
  if (cancellationReason && cancellationReason.length > 1000) {
    throw new Error("Cancellation reason is too long")
  }

  const supabase = await createClient()

  // Fetch current order
  const { data: order, error: fetchError } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single()

  if (fetchError || !order) {
    throw new Error("Order not found")
  }

  // Validate transition
  const allowed = VALID_TRANSITIONS[order.status]
  if (!allowed || !allowed.includes(newStatus)) {
    throw new Error(`Cannot transition from "${order.status}" to "${newStatus}"`)
  }

  // Early return for delivered — use shared confirmation path for consistent side effects
  if (newStatus === "delivered") {
    const { confirmed } = await confirmDeliveryForOrder(orderId, new Date().toISOString(), "admin")
    if (!confirmed) {
      throw new Error("Order status was changed by another request. Please refresh and try again.")
    }
    revalidateTag("orders", "max")
    return { success: true }
  }

  // Build update payload
  const now = new Date().toISOString()
  const updateData: Record<string, unknown> = { status: newStatus }
  if (newStatus === "confirmed") {
    updateData.confirmed_at = now
  }
  if (newStatus === "shipped") {
    updateData.shipped_at = now
    if (trackingNumber) updateData.tracking_number = trackingNumber.trim()
  }
  if (newStatus === "cancelled") {
    updateData.cancelled_at = now
    if (cancellationReason) updateData.cancellation_reason = cancellationReason.trim()
  }

  // Atomic update — only update if status hasn't changed (prevents race conditions)
  const { data: updated, error: updateError } = await supabase
    .from("orders")
    .update(updateData)
    .eq("id", orderId)
    .eq("status", order.status)
    .select("id")

  if (updateError) {
    console.error("Failed to update order status:", updateError)
    throw new Error("Failed to update order status")
  }

  if (!updated || updated.length === 0) {
    throw new Error("Order status was changed by another request. Please refresh and try again.")
  }

  // Restore inventory on cancellation
  if (newStatus === "cancelled") {
    const { data: items, error: itemsErr } = await supabase
      .from("order_items")
      .select("sku, quantity")
      .eq("order_id", orderId)
    if (itemsErr || !items) {
      console.error(`Failed to load order_items for cancellation of ${orderId}:`, itemsErr)
    } else {
      for (const item of items) {
        const { error: restoreErr } = await supabase.rpc("restore_inventory", {
          p_sku: item.sku,
          p_quantity: item.quantity,
          p_order_id: orderId,
        })
        if (restoreErr) {
          console.error(`Failed to restore inventory for ${item.sku} on order ${orderId}:`, restoreErr)
        }
      }
    }
  }

  // Send shipping notification email
  if (newStatus === "shipped") {
    sendShippingEmail(order, trackingNumber!.trim())
  }

  return { success: true }
}

export interface ShipmentFormData {
  senderName: string
  senderPhone: string
  senderEmail: string
  senderAddress: string
  senderCity: string
  senderPostalCode: string
  senderOfficeCode: string
  // Display-only — surfaced in the admin shipment form alongside the code so
  // admin sees a human-readable confirmation. Not sent to the courier API
  // (only the code is). Populated from SELLER_ECONT_OFFICE_NAME env var as
  // a default; replaced by EcontOfficePicker selection in edit mode.
  senderOfficeName: string
  // Speedy sender drop-off office. When set, Speedy doesn't dispatch a
  // courier to the seller address — admin drops off at this office. Sent
  // as `sender.dropoffOfficeId` to Speedy's API. Both fields are populated
  // from SELLER_SPEEDY_OFFICE_ID / _NAME env vars or the SpeedyOfficePicker
  // in edit mode. Stored as strings to mirror the recipient fields and
  // keep the form shape uniform; coerced to number on dispatch.
  senderSpeedyOfficeId: string
  senderSpeedyOfficeName: string
  recipientName: string
  recipientPhone: string
  recipientCity: string
  recipientAddress: string
  recipientPostalCode: string
  recipientOfficeId: string
  recipientOfficeCode: string
  recipientOfficeName: string
  weight: number
  contents: string
}

// Display-only fields returned by getShipmentDefaults (not sent back to server)
export interface ShipmentDisplayInfo {
  codAmount: number
  courier: string
  deliveryType: string
}

export async function getShipmentDefaults(orderId: string): Promise<{ form: ShipmentFormData; display: ShipmentDisplayInfo }> {
  await requireAdmin()

  if (!UUID_REGEX.test(orderId)) throw new Error("Invalid order ID")

  const supabase = await createClient()
  const { data: order, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single()

  if (error || !order) throw new Error("Order not found")

  const { data: items, error: itemsErr } = await supabase
    .from("order_items")
    .select("product_name, quantity")
    .eq("order_id", orderId)
    .order("line_no")
  if (itemsErr || !items) throw new Error("Failed to load order items")
  const contents = items.map((i) => `${i.product_name} x${i.quantity}`).join(", ")
  const partner = order.logistics_partner || ""
  const isCod = order.payment_method === "cod"
  const isOffice = partner.endsWith("-office")

  return {
    form: {
      senderName: process.env.SELLER_COMPANY_NAME || "",
      senderPhone: process.env.SELLER_PHONE || "",
      senderEmail: process.env.SELLER_EMAIL || "",
      senderAddress: process.env.SELLER_ADDRESS || "",
      senderCity: process.env.SELLER_CITY || "",
      senderPostalCode: process.env.SELLER_POSTAL_CODE || "",
      senderOfficeCode: process.env.SELLER_ECONT_OFFICE_CODE || "",
      senderOfficeName: process.env.SELLER_ECONT_OFFICE_NAME || "",
      senderSpeedyOfficeId: process.env.SELLER_SPEEDY_OFFICE_ID || "",
      senderSpeedyOfficeName: process.env.SELLER_SPEEDY_OFFICE_NAME || "",
      recipientName: `${order.first_name} ${order.last_name}`,
      recipientPhone: order.phone,
      recipientCity: order.city,
      recipientAddress: order.address || "",
      recipientPostalCode: order.postal_code || "",
      recipientOfficeId: isOffice ? String(order.speedy_office_id || "") : "",
      recipientOfficeCode: isOffice ? (order.econt_office_code || "") : "",
      recipientOfficeName: isOffice
        ? (order.speedy_office_name || order.econt_office_name || "")
        : "",
      weight: 1.0,
      contents,
    },
    display: {
      codAmount: isCod ? order.total_amount / 100 : 0,
      courier: partner.startsWith("speedy") ? "speedy" : "econt",
      deliveryType: isOffice ? "office" : "address",
    },
  }
}

export async function generateShipment(orderId: string, form: ShipmentFormData): Promise<{ trackingNumber: string }> {
  await requireAdmin()

  if (!UUID_REGEX.test(orderId)) throw new Error("Invalid order ID")
  if (!form.weight || form.weight < 0.1 || form.weight > 50) throw new Error("Теглото трябва да е между 0.1 и 50 кг")
  if (!form.recipientName.trim()) throw new Error("Името на получателя е задължително")
  if (!form.recipientPhone.trim()) throw new Error("Телефонът на получателя е задължителен")
  if (!form.contents.trim()) throw new Error("Съдържанието е задължително")
  if (form.contents.length > 200) throw new Error("Съдържанието е твърде дълго")

  const supabase = await createClient()

  // Atomic lock: set tracking_number to a placeholder to prevent concurrent shipment creation
  const { data: locked, error: lockError } = await supabase
    .from("orders")
    .update({ tracking_number: "__generating__" })
    .eq("id", orderId)
    .eq("status", "confirmed")
    .is("tracking_number", null)
    .select("id, status, tracking_number, logistics_partner, payment_method, total_amount")
    .single()

  if (lockError || !locked) {
    // Check why lock failed
    const { data: existing } = await supabase.from("orders").select("status, tracking_number").eq("id", orderId).single()
    if (!existing) throw new Error("Order not found")
    if (existing.status !== "confirmed") throw new Error("Товарителница може да се генерира само за потвърдени поръчки")
    if (existing.tracking_number) throw new Error("Тази поръчка вече има товарителница")
    throw new Error("Не може да се генерира товарителница в момента. Опитайте отново.")
  }

  // Allocation precondition: with the lock held, every order_item must have
  // batch allocations summing to its ordered quantity. The lifecycle trigger
  // freezes order_item_batches as soon as tracking_number is set (above), so
  // checking here is race-safe.
  {
    const { data: items } = await supabase
      .from("order_items")
      .select("id, sku, quantity")
      .eq("order_id", orderId)
    const itemIdsForCheck = (items ?? []).map((i) => (i as { id: number }).id)
    const { data: allocsForCheck } = itemIdsForCheck.length > 0
      ? await supabase
          .from("order_item_batches")
          .select("order_item_id, quantity")
          .in("order_item_id", itemIdsForCheck)
      : { data: [] as Array<{ order_item_id: number; quantity: number }> }

    const allocSum = new Map<number, number>()
    for (const a of allocsForCheck ?? []) {
      const row = a as { order_item_id: number; quantity: number }
      allocSum.set(row.order_item_id, (allocSum.get(row.order_item_id) ?? 0) + row.quantity)
    }
    for (const it of items ?? []) {
      const item = it as { id: number; sku: string; quantity: number }
      const allocated = allocSum.get(item.id) ?? 0
      if (allocated !== item.quantity) {
        await supabase.from("orders").update({ tracking_number: null }).eq("id", orderId).eq("tracking_number", "__generating__")
        if (allocated === 0) {
          throw new Error("Преди да изпратите пратката към куриер, разпределете партидите за всички продукти в поръчката.")
        }
        throw new Error(
          `Разпределените количества по партиди не съвпадат с количествата в поръчката (SKU ${item.sku}: разпределени ${allocated} от ${item.quantity}). Моля, проверете секцията „Партиди".`,
        )
      }
    }
  }

  const order = locked

  // Use courier/delivery type from the order, not from the form (prevent tampering)
  const partner = order.logistics_partner as string
  const courier = partner.startsWith("speedy") ? "speedy" : "econt"
  const deliveryType = partner.endsWith("-office") ? "office" : "address"

  // Use COD amount from the order, not from the form (prevent tampering)
  const isCod = order.payment_method === "cod"
  const codAmount = isCod ? order.total_amount / 100 : undefined

  let trackingNumber: string

  try {
    if (courier === "speedy") {
      const result = await createSpeedyShipment({
        recipientName: form.recipientName.trim(),
        recipientPhone: form.recipientPhone.trim(),
        officeId: deliveryType === "office" ? Number(form.recipientOfficeId) || undefined : undefined,
        address: deliveryType === "address" ? {
          siteName: form.recipientCity.trim(),
          postCode: form.recipientPostalCode.trim(),
          streetName: form.recipientAddress.trim(),
          streetNo: "",
        } : undefined,
        weight: form.weight,
        contents: form.contents,
        codAmount,
        // Optional sender drop-off-at-office. When unset, Speedy follows
        // the default courier-pickup-from-registered-address flow.
        senderOfficeId: form.senderSpeedyOfficeId
          ? Number(form.senderSpeedyOfficeId) || undefined
          : undefined,
      })
      trackingNumber = result.trackingNumber
    } else {
      const result = await createEcontShipment({
        senderName: form.senderName.trim(),
        senderPhone: form.senderPhone.trim(),
        senderEmail: form.senderEmail.trim(),
        senderOfficeCode: form.senderOfficeCode.trim() || undefined,
        senderCity: form.senderCity.trim(),
        senderAddress: form.senderAddress.trim(),
        senderPostalCode: form.senderPostalCode.trim(),
        recipientName: form.recipientName.trim(),
        recipientPhone: form.recipientPhone.trim(),
        officeCode: deliveryType === "office" ? form.recipientOfficeCode : undefined,
        address: deliveryType === "address" ? {
          city: form.recipientCity.trim(),
          postCode: form.recipientPostalCode.trim(),
          street: form.recipientAddress.trim(),
          num: "",
        } : undefined,
        weight: form.weight,
        contents: form.contents,
        codAmount,
      })
      trackingNumber = result.trackingNumber
    }
  } catch (courierError) {
    // Rollback the lock — clear the placeholder so the admin can retry
    await supabase.from("orders").update({ tracking_number: null }).eq("id", orderId).eq("tracking_number", "__generating__")
    throw courierError
  }

  // Save the real tracking number (replacing the placeholder)
  const { error: updateError } = await supabase
    .from("orders")
    .update({ tracking_number: trackingNumber })
    .eq("id", orderId)
    .eq("tracking_number", "__generating__")

  if (updateError) {
    console.error("Failed to save tracking number:", updateError)
    console.error(`ORPHANED SHIPMENT: order=${orderId} tracking=${trackingNumber} courier=${courier}`)
    throw new Error(`Товарителницата е създадена (${trackingNumber}), но не можа да бъде запазена. Въведете номера ръчно.`)
  }

  return { trackingNumber }
}

// Cancel an issued shipment label (status still 'confirmed', tracking_number
// is a real value). Clears tracking_number so the lifecycle trigger releases
// the order_item_batches lock and the admin can re-allocate / re-generate.
//
// The courier-side cancellation/void is admin-managed (call the courier or
// use their dashboard). This action is the internal half: free the lock and
// record the unlock event so the audit trail captures the moment.
export async function cancelShipment(
  orderId: string,
  reason: string,
): Promise<{ success: true; previousTrackingNumber: string }> {
  await requireAdmin()
  if (!UUID_REGEX.test(orderId)) throw new Error("Невалиден формат на поръчка")

  const trimmed = reason?.trim() ?? ""
  if (trimmed.length < 10) throw new Error("Причината трябва да е поне 10 символа")
  if (trimmed.length > 1000) throw new Error("Причината е твърде дълга")

  const supabase = await createClient()

  const { data: order, error: readErr } = await supabase
    .from("orders")
    .select("id, status, tracking_number")
    .eq("id", orderId)
    .single()
  if (readErr || !order) throw new Error("Поръчката не е намерена")
  if (order.status !== "confirmed") {
    throw new Error(`Анулиране на товарителница е възможно само за потвърдени поръчки (текущ статус: ${order.status})`)
  }
  if (!order.tracking_number) throw new Error("Поръчката няма генерирана товарителница")
  if (order.tracking_number === "__generating__") {
    throw new Error("Товарителницата се генерира в момента — изчакайте резултата")
  }

  const previousTrackingNumber = order.tracking_number as string

  // Atomic guard: only clear if the tracking number is still what we read.
  // Prevents racing against a concurrent generateShipment retry / another
  // cancelShipment / a manual DB edit.
  const { data: cleared, error: clearErr } = await supabase
    .from("orders")
    .update({ tracking_number: null })
    .eq("id", orderId)
    .eq("tracking_number", previousTrackingNumber)
    .select("id")
    .single()
  if (clearErr || !cleared) {
    throw new Error("Не може да се анулира товарителницата в момента — обновете страницата и опитайте отново")
  }

  const { error: auditErr } = await supabase.rpc("record_order_outcome", {
    p_order_id: orderId,
    p_outcome_type: "batch_allocation_unlocked_after_shipment_cancelled",
    p_payload: {
      order_id: orderId,
      previous_tracking_number: previousTrackingNumber,
      reason: trimmed,
    },
    p_actor: "admin",
  })
  if (auditErr) {
    console.error("Failed to emit batch_allocation_unlocked_after_shipment_cancelled:", sanitizeError(auditErr))
  }

  revalidateTag("product-batches", "max")
  return { success: true, previousTrackingNumber }
}

export async function addAdminNote(orderId: string, note: string) {
  await requireAdmin()

  if (!UUID_REGEX.test(orderId)) throw new Error("Invalid order ID")

  const trimmed = note.trim()
  if (!trimmed) throw new Error("Бележката е празна")
  if (trimmed.length > 2000) throw new Error("Бележката е твърде дълга")

  const supabase = await createClient()

  // Atomic append via the add_admin_note RPC — kills the read-modify-write
  // race of the previous fetch → spread → update pattern.
  const { error } = await supabase.rpc("add_admin_note", {
    p_order_id: orderId,
    p_text: trimmed,
  })

  if (error) {
    console.error("Failed to add admin note:", error)
    throw new Error(translateRpcError(error, {
      ORDER_NOT_FOUND: "Поръчката не е намерена",
    }, "Грешка при добавяне на бележка"))
  }

  return { success: true }
}

// Sets the Microinvest-assigned number on an invoices row (either type='invoice'
// or type='credit_note'). Idempotency guard via .is("invoice_number", null).
// Optional invoice_date — defaults to now (admin pasted same-day issuance);
// caller can pass an explicit date for retroactive entries.
export async function setInvoiceNumber(
  invoiceId: string,
  invoiceNumber: string,
  invoiceDate?: string,
): Promise<{ success: true }> {
  await requireAdmin()

  if (!UUID_REGEX.test(invoiceId)) throw new Error("Invalid invoice ID")

  const trimmed = invoiceNumber.trim()
  if (!trimmed || trimmed.length > 50) throw new Error("Невалиден номер на фактура")

  let dateIso: string
  if (invoiceDate) {
    const parsed = new Date(invoiceDate)
    if (isNaN(parsed.getTime())) throw new Error("Невалидна дата на фактура")
    if (parsed > new Date()) throw new Error("Датата на фактура не може да бъде в бъдещето")
    dateIso = /^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)
      ? new Date(invoiceDate + "T23:59:59.000Z").toISOString()
      : parsed.toISOString()
  } else {
    dateIso = new Date().toISOString()
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("invoices")
    .update({ invoice_number: trimmed, invoice_date: dateIso })
    .eq("id", invoiceId)
    .is("invoice_number", null)
    .select("id")

  if (error) {
    console.error("Failed to set invoice number:", error)
    throw new Error("Грешка при записване на номер на фактура")
  }

  if (!data || data.length === 0) {
    throw new Error("Документът не е намерен или вече има номер")
  }

  return { success: true }
}

// Marks an invoices row as sent to the customer. Works for both type='invoice'
// and type='credit_note'. Requires invoice_number to be set first.
export async function markInvoiceSent(invoiceId: string): Promise<{ success: true }> {
  await requireAdmin()

  if (!UUID_REGEX.test(invoiceId)) throw new Error("Invalid invoice ID")

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("invoices")
    .update({ sent_at: new Date().toISOString() })
    .eq("id", invoiceId)
    .not("invoice_number", "is", null)
    .is("sent_at", null)
    .select("id")

  if (error) {
    console.error("Failed to mark invoice as sent:", error)
    throw new Error("Грешка при записване")
  }

  if (!data || data.length === 0) {
    throw new Error("Документът няма номер или вече е отбелязан като изпратен")
  }

  return { success: true }
}

export async function recordCodSettlement(
  orderId: string,
  data: {
    courierPppRef?: string
    settlementRef?: string
    settlementAmount?: number
    settledAt: string
  },
): Promise<{ success: true }> {
  await requireAdmin()

  if (!UUID_REGEX.test(orderId)) throw new Error("Invalid order ID")

  if (data.courierPppRef && data.courierPppRef.length > 100) {
    throw new Error("ППП референцията е твърде дълга")
  }
  if (data.settlementRef && data.settlementRef.length > 100) {
    throw new Error("Референцията на превода е твърде дълга")
  }
  if (data.settlementAmount !== undefined) {
    if (!Number.isInteger(data.settlementAmount) || data.settlementAmount <= 0) {
      throw new Error("Получената сума трябва да е положително число")
    }
  }
  // Date is required: the admin must affirm WHEN the courier transferred the
  // money, not accept an implicit "today" that could silently be wrong (e.g.
  // settlement actually arrived 2 weeks ago but admin only recorded it today).
  if (!data.settledAt || !data.settledAt.trim()) {
    throw new Error("Датата на плащане е задължителна")
  }
  const parsed = new Date(data.settledAt)
  if (isNaN(parsed.getTime())) throw new Error("Невалидна дата на плащане")
  if (parsed > new Date()) throw new Error("Датата на плащане не може да е в бъдещето")

  const supabase = await createClient()

  // Verify order exists and is COD
  const { data: order, error: fetchError } = await supabase
    .from("orders")
    .select("id, payment_method, status, delivered_at")
    .eq("id", orderId)
    .single()

  if (fetchError || !order) throw new Error("Поръчката не е намерена")
  if (order.payment_method !== "cod") throw new Error("Само за поръчки с наложен платеж")
  if (order.status !== "delivered" && order.status !== "shipped") {
    throw new Error("Плащане може да се запише само за доставени поръчки")
  }

  // Date picker gives YYYY-MM-DD — set to 23:59:59 UTC so it sorts after
  // other events (creation, delivery) that happened earlier that day.
  const settledDate = new Date(data.settledAt)
  settledDate.setUTCHours(23, 59, 59, 0)
  if (order.delivered_at && settledDate < new Date(order.delivered_at)) {
    throw new Error("Датата на плащане не може да е преди доставката")
  }
  const settledAtValue = settledDate.toISOString()

  const updateData: Record<string, unknown> = {
    seller_settled_at: settledAtValue,
  }
  if (data.courierPppRef) updateData.courier_ppp_ref = data.courierPppRef.trim()
  if (data.settlementRef) updateData.settlement_ref = data.settlementRef.trim()
  if (data.settlementAmount !== undefined) updateData.settlement_amount = data.settlementAmount

  const { data: updated, error } = await supabase
    .from("orders")
    .update(updateData)
    .eq("id", orderId)
    .is("seller_settled_at", null)
    .select("id")

  if (error) {
    console.error("Failed to record COD settlement:", error)
    throw new Error("Грешка при записване на плащане")
  }

  if (!updated || updated.length === 0) {
    throw new Error("Плащането вече е записано за тази поръчка")
  }

  return { success: true }
}

// ─── COD phone confirmation ─────────────────────────────────────────────────
// Bulgarian COD operational reality: admin should call the customer to verify
// phone + address + intent before generating the shipment, or parcels get
// refused at the door. This records the moment the call was completed.
// Paired with a UI soft-block warning on generate-shipment for COD+unconfirmed
// orders. Policy becomes a recorded system event.
export async function markCodConfirmed(orderId: string): Promise<{ success: true }> {
  await requireAdmin()

  if (!UUID_REGEX.test(orderId)) throw new Error("Invalid order ID")

  const supabase = await createClient()

  // Verify order is COD and in a pre-ship state — confirming after ship is
  // meaningless (parcel already in courier hands). Shipped/delivered orders
  // can't go back for a confirmation.
  const { data: order, error: fetchError } = await supabase
    .from("orders")
    .select("id, payment_method, status, cod_confirmed_at")
    .eq("id", orderId)
    .single()

  if (fetchError || !order) throw new Error("Поръчката не е намерена")
  if (order.payment_method !== "cod") {
    throw new Error("Потвърждението на обаждането е само за поръчки с наложен платеж")
  }
  if (order.status !== "confirmed") {
    throw new Error(
      `Потвърждението важи само за потвърдени поръчки (текущ статус: ${order.status})`,
    )
  }
  if (order.cod_confirmed_at) {
    throw new Error("Обаждането вече е потвърдено за тази поръчка")
  }

  // Idempotent via .is(cod_confirmed_at, null) — a concurrent second click
  // returns zero rows and surfaces the "already confirmed" message cleanly.
  const { data: updated, error } = await supabase
    .from("orders")
    .update({
      cod_confirmed_at: new Date().toISOString(),
      cod_confirmed_by: "admin",
    })
    .eq("id", orderId)
    .is("cod_confirmed_at", null)
    .select("id")

  if (error) {
    console.error("Failed to mark COD as confirmed:", error)
    throw new Error("Грешка при потвърждаване на обаждането")
  }
  if (!updated || updated.length === 0) {
    throw new Error("Обаждането вече е потвърдено за тази поръчка")
  }

  return { success: true }
}

// ─── Order edit (contact + quantity) ────────────────────────────────────────
// Bulgarian COD reality: 10-20% of orders need post-confirmation
// corrections — wrong вход/етаж/апартамент, typo'd phone, "add one more
// box". Without these actions admin's only recourse is cancel + reorder,
// which burns customer trust and internal time. Scope is deliberately
// narrow:
//   - Contact edits: fields that admin corrects most often. email stays
//     out of the editable set pre-launch (case-sensitivity CHECK + email
//     is also the unsubscribe key, so editing affects cross-table state).
//   - Quantity edits: COD only, confirmed-but-not-shipped only. Card
//     quantity increase routes through replaces_order_id (separate
//     feature) because charging the delta requires a new Stripe session.
//   - Fee recalc is NOT done on edit (shipping / cod / discount frozen
//     at creation). Admin crossing a free-shipping threshold via edit
//     does not get shipping refunded automatically.

const CONTACT_FIELD_MAX = 500

export async function updateOrderContact(
  orderId: string,
  data: {
    firstName?: string
    lastName?: string
    phone?: string
    email?: string
    address?: string
    postalCode?: string
    city?: string
    notes?: string
  },
): Promise<{ success: true }> {
  await requireAdmin()

  if (!UUID_REGEX.test(orderId)) throw new Error("Invalid order ID")

  // Per-field validation. Only fields that were actually provided are
  // validated; undefined values pass through untouched. The client is
  // expected to send only fields that actually changed (compared to the
  // current order values), so unchanged-but-already-empty legacy data
  // doesn't trip a non-empty validation it never validated at intake.
  const PHONE_REGEX = /^\+?[\d\s\-()]{6,20}$/
  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  const updatePayload: Record<string, unknown> = {}

  if (data.firstName !== undefined) {
    const trimmed = data.firstName.trim()
    if (!trimmed) throw new Error("Името не може да е празно")
    if (trimmed.length > CONTACT_FIELD_MAX) throw new Error("Името е твърде дълго")
    updatePayload.first_name = trimmed
  }
  if (data.lastName !== undefined) {
    const trimmed = data.lastName.trim()
    if (!trimmed) throw new Error("Фамилията не може да е празна")
    if (trimmed.length > CONTACT_FIELD_MAX) throw new Error("Фамилията е твърде дълга")
    updatePayload.last_name = trimmed
  }
  if (data.phone !== undefined) {
    const trimmed = data.phone.trim()
    if (!trimmed) throw new Error("Телефонът не може да е празен")
    if (!PHONE_REGEX.test(trimmed)) throw new Error("Невалиден формат на телефон")
    updatePayload.phone = trimmed
  }
  if (data.email !== undefined) {
    // Lowercase to satisfy chk_orders_email_lowercase. Note: email is the
    // unsubscribe key — changing it decouples the order from the
    // email_unsubscribes row that was tied to the old address. Caller
    // should warn the admin in the UI.
    const trimmed = data.email.trim().toLowerCase()
    if (!trimmed) throw new Error("Имейлът не може да е празен")
    if (!EMAIL_REGEX.test(trimmed)) throw new Error("Невалиден формат на имейл")
    if (trimmed.length > CONTACT_FIELD_MAX) throw new Error("Имейлът е твърде дълъг")
    updatePayload.email = trimmed
  }
  if (data.address !== undefined) {
    const trimmed = data.address.trim()
    if (trimmed.length > CONTACT_FIELD_MAX) throw new Error("Адресът е твърде дълъг")
    updatePayload.address = trimmed
  }
  if (data.postalCode !== undefined) {
    const trimmed = data.postalCode.trim()
    if (trimmed.length > 20) throw new Error("Невалиден пощенски код")
    updatePayload.postal_code = trimmed
  }
  if (data.city !== undefined) {
    const trimmed = data.city.trim()
    if (!trimmed) throw new Error("Градът не може да е празен")
    if (trimmed.length > CONTACT_FIELD_MAX) throw new Error("Градът е твърде дълъг")
    updatePayload.city = trimmed
  }
  if (data.notes !== undefined) {
    const trimmed = data.notes
    if (trimmed.length > 2000) throw new Error("Бележките са твърде дълги")
    updatePayload.notes = trimmed
  }

  if (Object.keys(updatePayload).length === 0) {
    throw new Error("Няма промени за записване")
  }

  const supabase = await createClient()

  // Gate on status='confirmed' — editing shipped orders silently on the
  // courier side is a support nightmare; pending orders are pre-payment
  // and will be re-submitted by the customer; cancelled/expired/delivered
  // are terminal. Atomic update via `.eq("status", "confirmed")` protects
  // against a status-change race.
  const { data: updated, error } = await supabase
    .from("orders")
    .update(updatePayload)
    .eq("id", orderId)
    .eq("status", "confirmed")
    .select("id")

  if (error) {
    console.error("Failed to update order contact:", error)
    throw new Error("Грешка при записване на промените")
  }
  if (!updated || updated.length === 0) {
    // Pre-check the order to produce a specific error: might be wrong id,
    // wrong status, or nothing changed at the DB layer (values equal to old).
    const { data: existing } = await supabase
      .from("orders")
      .select("status")
      .eq("id", orderId)
      .single()
    if (!existing) throw new Error("Поръчката не е намерена")
    throw new Error(
      `Редакцията е допустима само за потвърдени поръчки (текущ статус: ${existing.status})`,
    )
  }

  return { success: true }
}

// COD-only, pre-ship-only. Delegates all the cross-table atomicity to the
// edit_order_quantity RPC (which does FOR UPDATE on order_items, reservation
// delta via reserve_inventory / restore_inventory, order_items.quantity
// update, orders.total_amount recalc — all in one transaction). Server action
// layers: pre-flight validation (friendly errors, payment method gating) and
// the order_items_changed audit emission (can't easily emit from the RPC
// because the event belongs to the admin intent, not the SQL op).
export async function updateOrderQuantity(
  orderId: string,
  sku: string,
  newQuantity: number,
): Promise<{ success: true; newTotalCents: number }> {
  await requireAdmin()

  if (!UUID_REGEX.test(orderId)) throw new Error("Invalid order ID")

  if (!sku || typeof sku !== "string") throw new Error("SKU е задължителен")
  const validSkus = PRODUCTS.map((p) => p.sku)
  if (!validSkus.includes(sku)) throw new Error("Невалиден SKU")

  if (!Number.isInteger(newQuantity) || newQuantity < 1 || newQuantity > 100) {
    throw new Error("Количеството трябва да е цяло число между 1 и 100")
  }

  const supabase = await createClient()

  // Pre-check: COD, confirmed, no tracking number yet. Tracking number
  // means shipment generation has started — editing quantity after that
  // would desync the courier label, the real cart, and the COD amount
  // the courier will collect. Not supported pre-launch.
  const { data: order, error: fetchError } = await supabase
    .from("orders")
    .select("id, payment_method, status, tracking_number")
    .eq("id", orderId)
    .single()

  if (fetchError || !order) throw new Error("Поръчката не е намерена")
  if (order.payment_method !== "cod") {
    throw new Error(
      "Редакция на количества за картови поръчки изисква нова поръчка — използвайте „Замяна на поръчка\" (replaces_order_id)",
    )
  }
  if (order.status !== "confirmed") {
    throw new Error(
      `Редакция на количества е допустима само за потвърдени поръчки (текущ статус: ${order.status})`,
    )
  }
  if (order.tracking_number) {
    throw new Error("Товарителницата вече е генерирана — не може да се променя количество")
  }

  // Capture the old quantity for the audit payload — after the RPC runs,
  // we can't distinguish old from new.
  const { data: itemRow, error: itemErr } = await supabase
    .from("order_items")
    .select("quantity, unit_price_cents, product_name")
    .eq("order_id", orderId)
    .eq("sku", sku)
    .single()

  if (itemErr || !itemRow) {
    throw new Error(`Артикулът ${sku} не е част от тази поръчка`)
  }
  const oldQuantity = itemRow.quantity as number

  // The RPC handles FOR UPDATE + reserve/restore + row updates atomically.
  // Any invariant violation (insufficient stock, over-restore) raises from
  // the nested RPC and aborts the whole transaction.
  const { data: newTotalData, error: rpcError } = await supabase.rpc("edit_order_quantity", {
    p_order_id: orderId,
    p_sku: sku,
    p_new_quantity: newQuantity,
  })

  if (rpcError) {
    const raw = rpcError.message ?? ""
    // reserve_inventory's friendly error → surface it with the product name
    if (raw.includes("Insufficient stock for SKU")) {
      throw new Error(`Няма достатъчна наличност за ${itemRow.product_name}`)
    }
    console.error("edit_order_quantity RPC failed:", rpcError)
    throw new Error("Грешка при редакция на количеството")
  }

  const newTotalCents = Number(newTotalData) || 0

  // Emit audit event via record_order_outcome. The RPC's allow-list was
  // extended with 'order_items_changed' in the same migration.
  // Non-fatal: if the audit insert fails, the quantity change is already
  // committed — log and move on, don't leak an error to the admin for
  // an audit-only concern.
  if (oldQuantity !== newQuantity) {
    const { error: auditErr } = await supabase.rpc("record_order_outcome", {
      p_order_id: orderId,
      p_outcome_type: "order_items_changed",
      p_payload: {
        sku,
        product_name: itemRow.product_name,
        old_quantity: oldQuantity,
        new_quantity: newQuantity,
        delta: newQuantity - oldQuantity,
        new_total_cents: newTotalCents,
      },
      p_actor: "admin",
    })
    if (auditErr) {
      console.error("Failed to emit order_items_changed audit:", auditErr)
    }
  }

  return { success: true, newTotalCents }
}

// ─── Email resends ──────────────────────────────────────────────────────────
// Admin can manually resend transactional emails from the order detail page.
// Common triggers: customer says "I didn't get the email", email landed in
// spam, address typo corrected via updateOrderContact.
//
// The existing helpers in lib/email-sender.ts are already fire-and-forget and
// safe to call again. Their timestamp-update guards (first-write-wins via
// .is(..., null)) preserve the original first-sent time across resends —
// the audit event is the record of the resend.
//
// Each resend writes an email_resent outcome event so the timeline shows
// which email was re-sent and when.

async function emitEmailResentAudit(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orderId: string,
  emailType: "order_confirmation" | "shipping" | "delivery",
) {
  const { error } = await supabase.rpc("record_order_outcome", {
    p_order_id: orderId,
    p_outcome_type: "email_resent",
    p_payload: { email_type: emailType },
    p_actor: "admin",
  })
  if (error) {
    console.error(`Failed to emit email_resent audit (${emailType}):`, error)
  }
}

// Dispatch table for the three customer email-resend admin actions. The
// scaffolding (auth + UUID + load order + audit + return) is shared in
// `resendOrderEmail`; each entry encodes the bits that vary:
//   - `gate(order)`: returns a Bulgarian error message string when the
//     order isn't in a sendable state, or null when it is.
//   - `send(order)`: actually fires the underlying email helper.
type ResendKind = "order_confirmation" | "shipping" | "delivery"

interface ResendSpec {
  gate: (order: Record<string, unknown>) => string | null
  send: (order: Record<string, unknown>) => Promise<void>
}

const RESEND_SPECS: Record<ResendKind, ResendSpec> = {
  order_confirmation: {
    // Don't resend for pending orders — they haven't been confirmed yet, so
    // the "order confirmation" wording would be wrong (no receipt URL for
    // card, no COD acceptance).
    gate: (order) => {
      if (order.status === "pending") {
        return "Потвърждение на поръчка се изпраща след потвърждение на плащането"
      }
      if (order.status === "cancelled" || order.status === "expired") {
        return `Не може да се изпрати потвърждение за ${order.status === "cancelled" ? "отказана" : "изтекла"} поръчка`
      }
      return null
    },
    send: (order) => sendOrderConfirmationEmail(order),
  },
  shipping: {
    // Shipping email is only meaningful once a tracking number is assigned.
    // The '__generating__' placeholder is a distinct not-yet-ready state —
    // refuse it explicitly so the rare edge case isn't silently suppressed.
    gate: (order) => {
      if (!order.tracking_number || order.tracking_number === "__generating__") {
        return "Пратката още не е генерирана — няма номер за изпращане"
      }
      return null
    },
    send: (order) => sendShippingEmail(order, order.tracking_number as string),
  },
  delivery: {
    gate: (order) => {
      if (order.status !== "delivered") {
        return `Потвърждение за доставка се изпраща само за доставени поръчки (текущ статус: ${order.status})`
      }
      return null
    },
    // force: true bypasses delivery_email_sent_at; sendDeliveryEmail's
    // own .is(..., null) guard preserves the original first-sent time.
    send: (order) => sendDeliveryEmail(order, { force: true }),
  },
}

async function resendOrderEmail(orderId: string, kind: ResendKind): Promise<{ success: true }> {
  await requireAdmin()

  if (!UUID_REGEX.test(orderId)) throw new Error("Invalid order ID")

  const supabase = await createClient()
  const { data: order, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single()

  if (error || !order) throw new Error("Поръчката не е намерена")

  const spec = RESEND_SPECS[kind]
  const gateError = spec.gate(order as Record<string, unknown>)
  if (gateError) throw new Error(gateError)

  await spec.send(order as Record<string, unknown>)
  await emitEmailResentAudit(supabase, orderId, kind)

  return { success: true }
}

// Thin async wrappers around `resendOrderEmail`. Must be `async function` —
// Next.js's "use server" directive rejects sync functions even when they
// return a Promise, so the obvious `return resendOrderEmail(...)` form
// triggers a build error.
export async function resendOrderConfirmationEmail(orderId: string): Promise<{ success: true }> {
  return resendOrderEmail(orderId, "order_confirmation")
}

export async function resendShippingEmail(orderId: string): Promise<{ success: true }> {
  return resendOrderEmail(orderId, "shipping")
}

export async function resendDeliveryEmail(orderId: string): Promise<{ success: true }> {
  return resendOrderEmail(orderId, "delivery")
}

// ─── Refund tracking ─────────────────────────────────────────────────────────
// Refunds live in the refunds child table (one row per refund, many per
// order). Single-responsibility: recordRefund writes ONLY to refunds.
// Stock movements linked to a refund are recorded by a separate server action
// (recordStockMovement) — the UI orchestrates the "refund → stock outcome"
// flow as two explicit steps, preserving the three-layer separation:
//   refund = money     (recordRefund writes here)
//   inventory = goods  (recordStockMovement writes here, with
//                       reference_type='return', reference_id=<refund.id>)
//   outcome = audit    (recordOrderOutcome writes here, separately)
//
// Idempotency for webhook-originated rows is via UNIQUE stripe_refund_id;
// admin-originated refunds supply a client_idempotency_key so a retry
// re-resolves to the same row without double-insert.
//
// Phase 1 (current): admin issues Stripe refunds in the Stripe dashboard,
// then records them here with the Stripe refund ID. COD refunds are
// bank-transfer only — admin pastes the bank's transfer reference. The
// webhook creates rows the admin hasn't recorded yet, and admin can annotate
// afterward (reason, bank_transfer_ref, credit_note_skip_reason) via
// updateRefundAnnotation.
//
// Phase 2: the admin UI will call stripe.refunds.create() directly and
// insert the row synchronously — same table, same shape, no schema change.
//
// Credit note auto-creation rule (ЗДДС Чл. 115):
//   A type='credit_note' row in invoices is auto-inserted when ALL three:
//     1. an invoices row of type='invoice' exists for the order
//     2. that invoice has invoice_number set (фактура actually issued)
//     3. data.affectsInvoicedSupply is true (default; admin can opt out
//        for goodwill / non-supply-reducing refunds)
//   When all three true but #2 is false (invoice exists without number),
//   we BLOCK the refund with a guidance message — admin must complete the
//   invoice first.

export async function recordRefund(
  orderId: string,
  data: {
    refundAmount: number
    refundReason: string
    refundMethod: "stripe" | "bank_transfer"
    refundedAt?: string
    stripeRefundId?: string
    bankTransferRef?: string
    affectsInvoicedSupply?: boolean
    creditNoteSkipReason?: string
    clientIdempotencyKey: string
    // Optional withdrawal linkage. When set, the resulting refund row carries
    // withdrawal_id, the withdrawal's refund_id is updated, and (if conditions
    // are met) the withdrawal auto-completes:
    //   Path A: withdrawal.status='goods_received' → completed
    //   Path B: withdrawal.status='approved' AND return_required=false AND
    //           completion_note set → completed
    withdrawalId?: string
    // Optional per-line allocation. When provided, refund_items rows are
    // inserted alongside the refund row. Each item:
    //   - orderItemId must belong to this order
    //   - quantity > 0
    //   - amountCents > 0; defaults to order_item.unit_price_cents * quantity
    //     if omitted (caller supplies the override for diminished-value /
    //     discount cases)
    //   - sum(amountCents) ≤ refundAmount (DB trigger enforces; caller can
    //     pre-validate for friendly errors)
    // Webhook-originated refunds always pass items=undefined (no item context).
    items?: Array<{
      orderItemId: number
      quantity: number
      amountCents?: number
    }>
  },
): Promise<{ success: true; refundId: string; creditNoteId: string | null }> {
  await requireAdmin()

  if (!UUID_REGEX.test(orderId)) throw new Error("Невалиден формат на поръчка")
  if (!UUID_REGEX.test(data.clientIdempotencyKey)) {
    throw new Error("Невалиден idempotency key")
  }

  // Validate refund amount
  if (!Number.isInteger(data.refundAmount) || data.refundAmount < 1) {
    throw new Error("Сумата за възстановяване трябва да е положително цяло число")
  }

  // Validate reason
  const trimmedReason = data.refundReason?.trim()
  if (!trimmedReason) throw new Error("Причината за възстановяване е задължителна")
  if (trimmedReason.length > 1000) throw new Error("Причината е твърде дълга")

  // Validate method
  if (data.refundMethod !== "stripe" && data.refundMethod !== "bank_transfer") {
    throw new Error("Невалиден метод на възстановяване")
  }

  // Affects-invoiced-supply flag (default true). Drives credit-note auto-creation
  // and is structured (NOT encoded in reason).
  const affectsInvoicedSupply = data.affectsInvoicedSupply ?? true

  // Skip reason required when admin opts out of credit note
  const trimmedSkipReason = data.creditNoteSkipReason?.trim() || null
  if (!affectsInvoicedSupply) {
    if (!trimmedSkipReason) {
      throw new Error("Когато не се изисква кредитно известие, посочете причина")
    }
    if (trimmedSkipReason.length > 500) {
      throw new Error("Причината за пропуск на кредитно известие е твърде дълга")
    }
  } else if (trimmedSkipReason) {
    throw new Error("Причина за пропуск може да се посочи само когато не се създава кредитно известие")
  }

  // Validate Stripe refund ID (required for method=stripe)
  const trimmedStripeRefundId = data.stripeRefundId?.trim() || null
  if (data.refundMethod === "stripe") {
    if (!trimmedStripeRefundId) {
      throw new Error("Stripe refund ID е задължителен за Stripe възстановяване")
    }
    if (!/^re_[a-zA-Z0-9]+$/.test(trimmedStripeRefundId)) {
      throw new Error("Невалиден формат на Stripe refund ID (очаква се re_...)")
    }
  }
  if (data.refundMethod === "bank_transfer" && trimmedStripeRefundId) {
    throw new Error("Банковите преводи нямат Stripe refund ID")
  }

  // Validate bank_transfer_ref (required for method=bank_transfer)
  const trimmedBankTransferRef = data.bankTransferRef?.trim() || null
  if (data.refundMethod === "bank_transfer") {
    if (!trimmedBankTransferRef) {
      throw new Error("Референцията на банков превод е задължителна за банково възстановяване")
    }
    if (trimmedBankTransferRef.length > 200) {
      throw new Error("Референцията на банков превод е твърде дълга")
    }
  }
  if (data.refundMethod === "stripe" && trimmedBankTransferRef) {
    throw new Error("Stripe възстановяванията нямат референция на банков превод")
  }

  // ── refund_items shape validation (no DB needed) ─────────────────────────
  // Catch the "obvious" input bugs (empty array, duplicates, non-positive
  // quantity/amount) before opening any DB connection. The DB-dependent
  // checks (item belongs to order, qty cap, amount cap) run later, after
  // we've fetched the order + order_items.
  if (data.items !== undefined) {
    if (!Array.isArray(data.items) || data.items.length === 0) {
      throw new Error("Списъкът с артикули е празен")
    }
    const seenItemIds = new Set<number>()
    for (const it of data.items) {
      if (!Number.isInteger(it.orderItemId) || it.orderItemId <= 0) {
        throw new Error("Невалиден артикул в поръчката")
      }
      if (seenItemIds.has(it.orderItemId)) {
        throw new Error("Един и същ артикул е посочен повече от веднъж")
      }
      seenItemIds.add(it.orderItemId)
      if (!Number.isInteger(it.quantity) || it.quantity < 1) {
        throw new Error("Количеството трябва да е положително цяло число")
      }
      if (it.amountCents !== undefined) {
        if (!Number.isInteger(it.amountCents) || it.amountCents < 1) {
          throw new Error("Сумата по артикул трябва да е положително цяло число")
        }
      }
    }
  }

  // Validate refundedAt
  let refundedAtValue: string
  if (data.refundedAt) {
    const parsed = new Date(data.refundedAt)
    if (isNaN(parsed.getTime())) throw new Error("Невалидна дата на възстановяване")
    if (parsed > new Date()) throw new Error("Датата не може да е в бъдещето")
    // Date picker YYYY-MM-DD: store at 23:59:59 UTC for timeline sorting
    if (/^\d{4}-\d{2}-\d{2}$/.test(data.refundedAt)) {
      refundedAtValue = new Date(data.refundedAt + "T23:59:59.000Z").toISOString()
    } else {
      refundedAtValue = parsed.toISOString()
    }
  } else {
    refundedAtValue = new Date().toISOString()
  }

  const supabase = await createClient()

  // Fast-path idempotency: if a refund with this client_idempotency_key
  // exists, this is a retry. Return the existing ID without re-inserting.
  const { data: existingRefunds, error: existingError } = await supabase
    .from("refunds")
    .select("id, order_id")
    .eq("client_idempotency_key", data.clientIdempotencyKey)
  if (existingError) {
    console.error("Failed to check refund idempotency:", existingError)
    throw new Error("Грешка при проверка на idempotency")
  }

  if (existingRefunds && existingRefunds.length > 0) {
    const existing = existingRefunds[0]
    if (existing.order_id !== orderId) {
      throw new Error("Idempotency key принадлежи на друга поръчка")
    }
    // Lookup any credit_note that may already be tied to this refund
    const { data: existingCN } = await supabase
      .from("invoices")
      .select("id")
      .eq("refund_id", existing.id)
      .eq("type", "credit_note")
      .maybeSingle()
    return { success: true, refundId: existing.id, creditNoteId: existingCN?.id ?? null }
  }

  // No existing row — run full validation + insert.
  const { data: order, error: fetchError } = await supabase
    .from("orders")
    .select("id, seller_settled_at, delivered_at, total_amount, stripe_payment_intent_id, payment_method, status")
    .eq("id", orderId)
    .single()

  if (fetchError || !order) throw new Error("Поръчката не е намерена")
  // Refund flow follows customer-payment, not seller-settlement. For COD
  // this means an order is refundable as soon as it's delivered (customer
  // paid courier) — courier-side settlement remains independent and can
  // happen weeks later. See lib/orders.ts:hasCustomerPaid.
  if (!hasCustomerPaid(order)) {
    throw new Error("Не може да се възстанови сума за неплатена поръчка")
  }
  if (data.refundMethod === "stripe" && !order.stripe_payment_intent_id) {
    throw new Error("Поръчката няма Stripe платеж — използвайте банков превод")
  }

  // Look up the order's initial invoice (if any) — drives the credit-note guard
  // and auto-creation. The DB invariant guarantees 0..1 type='invoice' row.
  const { data: invoiceRow, error: invoiceError } = await supabase
    .from("invoices")
    .select("id, invoice_number")
    .eq("order_id", orderId)
    .eq("type", "invoice")
    .maybeSingle()
  if (invoiceError) {
    console.error("Failed to look up invoice for refund:", invoiceError)
    throw new Error("Грешка при проверка на фактурата на поръчката")
  }

  // Guard (ЗДДС Чл. 115): if the customer requested an invoice but admin
  // hasn't issued the фактура in Microinvest yet, block refunds that would
  // require a кредитно известие. Admin must complete the invoice first.
  const hasInvoiceRow = !!invoiceRow
  const invoiceNumberSet = !!invoiceRow?.invoice_number
  if (affectsInvoicedSupply && hasInvoiceRow && !invoiceNumberSet) {
    throw new Error(
      "Първо въведете номер и дата на фактурата преди да запишете възстановяване, което я намалява.",
    )
  }

  // For Stripe refunds, verify the pasted refund ID against Stripe before
  // committing a row. A typo or paste-from-wrong-order would otherwise create
  // a phantom row pointing at a non-existent or mismatched Stripe refund,
  // discoverable only by later reconciliation or never. One API call here
  // trades ~200ms for data integrity. Four checks:
  //   1. The refund exists in Stripe (resource_missing → friendly error).
  //   2. refund.status === 'succeeded' — money actually moved. Pending or
  //      failed refunds must not be logged as money-moved events.
  //   3. refund.payment_intent matches order.stripe_payment_intent_id —
  //      the refund belongs to THIS order, not a different one the admin
  //      accidentally copied from.
  //   4. refund.amount matches data.refundAmount — admin's local total
  //      equals the Stripe-side total. Divergence signals a typo in one
  //      of the two fields.
  if (data.refundMethod === "stripe" && trimmedStripeRefundId) {
    let stripeRefund
    try {
      stripeRefund = await stripe.refunds.retrieve(trimmedStripeRefundId)
    } catch (err) {
      const code = (err as { code?: string } | null)?.code
      if (code === "resource_missing") {
        throw new Error(
          `Stripe refund ID "${trimmedStripeRefundId}" не е намерен в Stripe — проверете ID в Stripe Dashboard`,
        )
      }
      console.error(
        `Failed to retrieve Stripe refund ${trimmedStripeRefundId}:`,
        sanitizeError(err),
      )
      throw new Error("Грешка при проверка на Stripe refund — опитайте отново")
    }

    if (stripeRefund.status !== "succeeded") {
      throw new Error(
        `Stripe refund не е успешно приключил (статус: ${stripeRefund.status}). Изчакайте да приключи или проверете в Stripe Dashboard.`,
      )
    }

    const refundPI =
      typeof stripeRefund.payment_intent === "string"
        ? stripeRefund.payment_intent
        : stripeRefund.payment_intent?.id ?? null
    if (refundPI !== order.stripe_payment_intent_id) {
      throw new Error(
        `Stripe refund ID не принадлежи на тази поръчка (PaymentIntent в Stripe: ${refundPI ?? "липсва"}, очакван: ${order.stripe_payment_intent_id})`,
      )
    }

    if (stripeRefund.amount !== data.refundAmount) {
      throw new Error(
        `Сумата не съвпада със Stripe (въведено: ${(data.refundAmount / 100).toFixed(2)} лв, Stripe: ${(stripeRefund.amount / 100).toFixed(2)} лв). Проверете refund ID или сумата.`,
      )
    }
  }

  // Sum existing refunds for friendly overshoot message (trigger is backstop).
  const { data: sumRows, error: sumError } = await supabase
    .from("refunds")
    .select("amount_cents")
    .eq("order_id", orderId)
  if (sumError) {
    console.error("Failed to fetch existing refunds:", sumError)
    throw new Error("Грешка при проверка на предишни възстановявания")
  }
  const alreadyRefunded = (sumRows ?? []).reduce(
    (sum, r) => sum + (r.amount_cents ?? 0),
    0,
  )
  if (alreadyRefunded + data.refundAmount > order.total_amount) {
    const remaining = order.total_amount - alreadyRefunded
    throw new Error(
      `Сумата за възстановяване не може да надвишава остатъка по поръчката (${(remaining / 100).toFixed(2)} лв)`,
    )
  }

  // Validate refundedAt not before delivered_at. Compare by calendar date
  // (UTC), not by timestamp — same-day delivery + refund is valid even when
  // the delivery is timestamped 13:00 and the refund picker submits as
  // midnight or 23:59. Truncating to YYYY-MM-DD avoids false rejections.
  if (order.delivered_at && data.refundedAt) {
    const deliveredDay = new Date(order.delivered_at).toISOString().slice(0, 10)
    // data.refundedAt may already be YYYY-MM-DD (date picker) or full ISO.
    const refundDay = /^\d{4}-\d{2}-\d{2}$/.test(data.refundedAt)
      ? data.refundedAt
      : new Date(data.refundedAt).toISOString().slice(0, 10)
    if (refundDay < deliveredDay) {
      throw new Error("Датата на възстановяване не може да е преди датата на доставка")
    }
  }

  // Optional withdrawal linkage: when set, validate the withdrawal belongs
  // to this order and is in a state that can carry a refund (approved or
  // goods_received; never completed/rejected).
  const withdrawalIdForLink = data.withdrawalId?.trim() || null
  if (withdrawalIdForLink) {
    if (!UUID_REGEX.test(withdrawalIdForLink)) {
      throw new Error("Невалиден формат на заявка за връщане")
    }
    const { data: wd, error: wdError } = await supabase
      .from("withdrawals")
      .select("id, order_id, status, return_required, completion_note")
      .eq("id", withdrawalIdForLink)
      .single()
    if (wdError || !wd) throw new Error("Заявката за връщане не е намерена")
    if (wd.order_id !== orderId) {
      throw new Error("Заявката не принадлежи на тази поръчка")
    }
    if (!["approved", "goods_received"].includes(wd.status)) {
      throw new Error("Заявката не е в състояние, което позволява запис на възстановяване")
    }
  }

  // ── refund_items DB-dependent validation (item belongs, qty cap, sum cap) ─
  // Shape validation already ran at the top of the function. Here we resolve
  // default amounts and check sums against the order_items + existing
  // refund_items rows — the DB triggers are the last-line backstop.
  const itemsInput = data.items
  let resolvedItems: Array<{ orderItemId: number; quantity: number; amountCents: number }> = []
  if (itemsInput !== undefined) {
    // Fetch order_items for this order — used to verify each orderItemId
    // belongs here, look up unit_price_cents for defaults, and check qty caps.
    const { data: orderItems, error: itemsError } = await supabase
      .from("order_items")
      .select("id, quantity, unit_price_cents")
      .eq("order_id", orderId)
    if (itemsError || !orderItems) {
      console.error("Failed to fetch order_items for refund:", itemsError)
      throw new Error("Грешка при проверка на артикулите")
    }
    const orderItemMap = new Map(orderItems.map((oi: { id: number; quantity: number; unit_price_cents: number }) => [oi.id, oi]))

    // Existing refund_items quantities for the items in this batch — used to
    // pre-check the qty cap (sum across all refunds + this batch ≤ ordered).
    const targetIds = itemsInput.map((i) => i.orderItemId)
    const { data: existingItems, error: existingError } = await supabase
      .from("refund_items")
      .select("order_item_id, quantity")
      .in("order_item_id", targetIds)
    if (existingError) {
      console.error("Failed to fetch existing refund_items:", existingError)
      throw new Error("Грешка при проверка на съществуващи артикулни възстановявания")
    }
    const existingByItem = new Map<number, number>()
    for (const r of existingItems ?? []) {
      const row = r as { order_item_id: number; quantity: number }
      existingByItem.set(row.order_item_id, (existingByItem.get(row.order_item_id) ?? 0) + row.quantity)
    }

    // Resolve each input item: validate ownership, default amount if needed,
    // pre-check qty cap.
    let allocatedTotal = 0
    for (const it of itemsInput) {
      const oi = orderItemMap.get(it.orderItemId)
      if (!oi) {
        throw new Error(`Артикул ${it.orderItemId} не принадлежи на тази поръчка`)
      }
      const alreadyRefundedQty = existingByItem.get(it.orderItemId) ?? 0
      if (alreadyRefundedQty + it.quantity > oi.quantity) {
        throw new Error(
          `Количеството за артикул ${it.orderItemId} (${alreadyRefundedQty} вече възстановени + ${it.quantity} ново = ${alreadyRefundedQty + it.quantity}) надвишава поръчаните ${oi.quantity} бройки`,
        )
      }
      const amount = it.amountCents ?? oi.unit_price_cents * it.quantity
      allocatedTotal += amount
      resolvedItems.push({ orderItemId: it.orderItemId, quantity: it.quantity, amountCents: amount })
    }
    if (allocatedTotal > data.refundAmount) {
      throw new Error(
        `Алокираната сума по артикули (${(allocatedTotal / 100).toFixed(2)} лв) надвишава общата сума на възстановяването (${(data.refundAmount / 100).toFixed(2)} лв)`,
      )
    }
  }

  const { data: inserted, error: insertError } = await supabase
    .from("refunds")
    .insert({
      order_id: orderId,
      stripe_refund_id: trimmedStripeRefundId,
      bank_transfer_ref: trimmedBankTransferRef,
      amount_cents: data.refundAmount,
      method: data.refundMethod,
      source: "admin_ui",
      reason: trimmedReason,
      affects_invoiced_supply: affectsInvoicedSupply,
      credit_note_skip_reason: trimmedSkipReason,
      recorded_by: "admin",
      refunded_at: refundedAtValue,
      client_idempotency_key: data.clientIdempotencyKey,
      withdrawal_id: withdrawalIdForLink,
    })
    .select("id")
    .single()

  if (insertError) {
    if (insertError.code === "23505") {
      // Ambiguous — could be client_idempotency_key (concurrent retry) or
      // stripe_refund_id (webhook recorded this refund already). Fetch by
      // the client key to disambiguate.
      const { data: recovered } = await supabase
        .from("refunds")
        .select("id, order_id")
        .eq("client_idempotency_key", data.clientIdempotencyKey)
      if (recovered && recovered.length > 0 && recovered[0].order_id === orderId) {
        return { success: true, refundId: recovered[0].id, creditNoteId: null }
      }
      // Must have been the stripe_refund_id unique — same Stripe refund
      // already in the table (webhook beat us, or dupe paste).
      throw new Error("Това Stripe възстановяване вече е записано за тази поръчка")
    }
    console.error("Failed to record refund:", insertError)
    throw new Error("Грешка при записване на възстановяване")
  }

  const refundId = inserted!.id

  // Insert refund_items rows if items were provided. On any insert failure,
  // delete the refund row to keep things consistent (no orphan refund without
  // its allocation). Append-only constraints on refunds DELETE block the
  // cleanup, but only if any refund_items rows already landed — first-row
  // failure leaves the refund with no items, so the orphan would persist.
  // Workaround: best-effort cleanup; if the rollback DELETE fails, log loudly
  // and rely on admin reconciliation. Pre-launch this is acceptable; a
  // post-launch hardening would migrate to a Postgres function for atomicity.
  if (resolvedItems.length > 0) {
    const itemRows = resolvedItems.map((r) => ({
      refund_id: refundId,
      order_item_id: r.orderItemId,
      quantity: r.quantity,
      amount_cents: r.amountCents,
    }))
    const { error: itemsInsertError } = await supabase.from("refund_items").insert(itemRows)
    if (itemsInsertError) {
      console.error(
        `Failed to insert refund_items for refund ${refundId}; rolling back refund row:`,
        itemsInsertError,
      )
      // The refund row's append-only DELETE trigger will reject this; we
      // need to bypass it for rollback. Best path: configure a session
      // bypass via app.allow_refund_delete (not implemented yet), or
      // accept the orphan. For MVP, attempt the delete; if it fails we
      // log and surface the original error.
      const { error: deleteError } = await supabase
        .from("refunds")
        .delete()
        .eq("id", refundId)
      if (deleteError) {
        console.error(
          `CRITICAL: refund ${refundId} cannot be rolled back (refunds is append-only). ` +
          `Orphaned refund row exists without item allocations. Manual cleanup required.`,
          deleteError,
        )
      }
      throw new Error("Грешка при записване на артикулните позиции на възстановяването")
    }
  }

  // Auto-create credit_note row if all three conditions hold (#1 and #2 are
  // checked inside autoCreateCreditNoteRow; #3 is the affects flag).
  let creditNoteId: string | null = null
  if (affectsInvoicedSupply) {
    creditNoteId = await autoCreateCreditNoteRow(supabase, {
      orderId,
      refundId,
      refundedAt: refundedAtValue,
    })
  }

  // If linked to a withdrawal, update the withdrawal: set refund_id +
  // resolution_type='refund'. Auto-complete when conditions met:
  //   Path A: withdrawal.status='goods_received' → completed
  //   Path B: withdrawal.status='approved' AND return_required=false AND
  //           completion_note set → completed
  // Otherwise the withdrawal keeps its current status; the refund is recorded
  // but completion happens later when admin marks goods received or completes
  // via no-return path explicitly.
  if (withdrawalIdForLink) {
    const { data: wdNow } = await supabase
      .from("withdrawals")
      .select("status, return_required, completion_note")
      .eq("id", withdrawalIdForLink)
      .single()

    const wdPayload: Record<string, unknown> = {
      refund_id: refundId,
      resolution_type: "refund",
    }

    if (wdNow) {
      const canCompletePathA = wdNow.status === "goods_received"
      const canCompletePathB =
        wdNow.status === "approved" &&
        wdNow.return_required === false &&
        typeof wdNow.completion_note === "string" &&
        wdNow.completion_note.trim() !== ""
      if (canCompletePathA || canCompletePathB) {
        wdPayload.status = "completed"
        wdPayload.completed_at = new Date().toISOString()
      }
    }

    const { error: wdUpdateError } = await supabase
      .from("withdrawals")
      .update(wdPayload)
      .eq("id", withdrawalIdForLink)
    if (wdUpdateError) {
      // Money has moved; surface the error loudly but don't roll back the
      // refund. Admin can manually complete the withdrawal from the UI.
      console.error(
        `Refund ${refundId} recorded but withdrawal ${withdrawalIdForLink} update failed:`,
        wdUpdateError,
      )
    }
  }

  return { success: true, refundId, creditNoteId }
}

// Admin-annotation edits on existing refund rows.
// Mutable fields on refunds: reason, bank_transfer_ref,
// credit_note_skip_reason. Audit event emitted automatically by the
// emit_order_refund_annotation_audit trigger.
//
// To edit the credit-note number, use setInvoiceNumber(invoiceId, ...) on
// the linked credit_note row in invoices instead.
export async function updateRefundAnnotation(
  refundId: string,
  data: {
    reason?: string
    bankTransferRef?: string
    creditNoteSkipReason?: string
  },
): Promise<{ success: true }> {
  await requireAdmin()

  if (!UUID_REGEX.test(refundId)) throw new Error("Невалиден формат на възстановяване")

  const updatePayload: Record<string, unknown> = {}

  if (data.reason !== undefined) {
    const trimmed = data.reason.trim()
    if (!trimmed) throw new Error("Причината за възстановяване е задължителна")
    if (trimmed.length > 1000) throw new Error("Причината е твърде дълга")
    updatePayload.reason = trimmed
  }

  if (data.bankTransferRef !== undefined) {
    const trimmed = data.bankTransferRef.trim()
    if (trimmed.length > 200) {
      throw new Error("Референцията на банков превод е твърде дълга")
    }
    updatePayload.bank_transfer_ref = trimmed || null
  }

  if (data.creditNoteSkipReason !== undefined) {
    const trimmed = data.creditNoteSkipReason.trim()
    if (trimmed.length > 500) {
      throw new Error("Причината за пропуск на кредитно известие е твърде дълга")
    }
    updatePayload.credit_note_skip_reason = trimmed || null
  }

  if (Object.keys(updatePayload).length === 0) {
    throw new Error("Няма промени за записване")
  }

  const supabase = await createClient()
  const { data: updated, error } = await supabase
    .from("refunds")
    .update(updatePayload)
    .eq("id", refundId)
    .select("id")

  if (error) {
    console.error("Failed to update refund annotation:", error)
    throw new Error("Грешка при записване на промените")
  }

  if (!updated || updated.length === 0) {
    throw new Error("Възстановяването не е намерено")
  }

  return { success: true }
}

// ─── Complaints register (ЗЗП чл. 127) ──────────────────────────────────────

// ─── Post-shipment outcome events ───────────────────────────────────────
// Records a domain event (delivery_refused / package_lost / returned / recalled)
// via the record_order_outcome RPC and appends a human-readable summary to
// admin_notes so the event appears in the existing order timeline UI.
//
// Strictly single-responsibility: this records the *event*, nothing else.
// The order status is not rewound (per the three-layer design:
// status / refund / inventory + outcome events) and no linked refund or
// inventory writes happen here. Those are separate concerns handled by
// recordRefund (money, with its own inventoryAdjustments for returned
// goods) and recordStockMovement (pure stock). The admin UI coordinates
// them as a guided multi-step flow — one user interaction, three
// independent server actions — preserving clean separation between audit,
// money, and goods.

const OUTCOME_TYPES = ["delivery_refused", "package_lost", "returned", "recalled"] as const
type OutcomeType = (typeof OUTCOME_TYPES)[number]

const OUTCOME_LABELS: Record<OutcomeType, string> = {
  delivery_refused: "Отказана доставка",
  package_lost: "Изгубена пратка",
  returned: "Върнат продукт",
  recalled: "Изтеглен продукт",
}

export async function recordOrderOutcome(
  orderId: string,
  data: {
    outcomeType: OutcomeType
    note: string
    // Type-specific fields. Validated per outcomeType below.
    courierRef?: string
    returnRef?: string
    recallRef?: string
    recallReason?: string
    condition?: "sellable" | "damaged"
    expectedReturnAt?: string
    confirmedLostAt?: string
    receivedAt?: string
  },
): Promise<{ success: true }> {
  await requireAdmin()

  if (!UUID_REGEX.test(orderId)) throw new Error("Невалиден формат на поръчка")

  if (!OUTCOME_TYPES.includes(data.outcomeType)) {
    throw new Error("Невалиден тип събитие")
  }

  const trimmedNote = data.note?.trim()
  if (!trimmedNote || trimmedNote.length < 10) {
    throw new Error("Описанието трябва да бъде поне 10 символа")
  }
  if (trimmedNote.length > 2000) {
    throw new Error("Описанието е твърде дълго")
  }

  // Type-specific required-field validation.
  const courierRef = data.courierRef?.trim() || null
  const returnRef = data.returnRef?.trim() || null
  const recallRef = data.recallRef?.trim() || null
  const recallReason = data.recallReason?.trim() || null

  if (data.outcomeType === "package_lost" && !courierRef) {
    throw new Error("Референция на куриерска претенция е задължителна")
  }
  if (data.outcomeType === "returned") {
    if (!returnRef) throw new Error("Референция на връщане е задължителна")
    if (data.condition !== "sellable" && data.condition !== "damaged") {
      throw new Error("Укажете състояние на върнатия продукт")
    }
  }
  if (data.outcomeType === "recalled") {
    if (!recallRef) throw new Error("Референция на изтегляне е задължителна")
    if (!recallReason) throw new Error("Причината за изтегляне е задължителна")
  }

  // Date validation helpers (ISO or YYYY-MM-DD).
  const parseOptionalDate = (value: string | undefined, label: string): string | null => {
    if (!value) return null
    const date = new Date(value)
    if (isNaN(date.getTime())) throw new Error(`Невалидна дата: ${label}`)
    return date.toISOString()
  }
  const expectedReturnAt = parseOptionalDate(data.expectedReturnAt, "очаквано връщане")
  const confirmedLostAt = parseOptionalDate(data.confirmedLostAt, "изгубване")
  const receivedAt = parseOptionalDate(data.receivedAt, "получаване")

  const supabase = await createClient()

  // Order must exist and be in a post-shipment state — outcomes don't apply
  // to pending/confirmed orders (nothing's been shipped yet) or terminal
  // cancelled/expired (use normal refund flow for any late reversal).
  const { data: order, error: fetchError } = await supabase
    .from("orders")
    .select("id, status")
    .eq("id", orderId)
    .single()
  if (fetchError || !order) throw new Error("Поръчката не е намерена")
  if (order.status !== "shipped" && order.status !== "delivered") {
    throw new Error(`Това събитие може да се докладва само след изпращане (текущ статус: ${order.status})`)
  }

  const payload: Record<string, unknown> = { note: trimmedNote }
  if (courierRef) payload.courier_ref = courierRef
  if (returnRef) payload.return_ref = returnRef
  if (recallRef) payload.recall_ref = recallRef
  if (recallReason) payload.recall_reason = recallReason
  if (data.condition) payload.condition = data.condition
  if (expectedReturnAt) payload.expected_return_at = expectedReturnAt
  if (confirmedLostAt) payload.confirmed_lost_at = confirmedLostAt
  if (receivedAt) payload.received_at = receivedAt

  const { error: rpcError } = await supabase.rpc("record_order_outcome", {
    p_order_id: orderId,
    p_outcome_type: data.outcomeType,
    p_payload: payload,
    p_actor: "admin",
  })
  if (rpcError) {
    console.error("Failed to record order outcome:", rpcError)
    throw new Error("Грешка при записване на събитие")
  }

  // Bridge to the existing timeline until the admin-panel timeline reads
  // from order_audit_events directly. Human-readable summary as an admin
  // note makes the outcome visible immediately.
  const summaryParts: string[] = [OUTCOME_LABELS[data.outcomeType]]
  if (data.outcomeType === "returned" && data.condition) {
    summaryParts.push(data.condition === "sellable" ? "годно" : "негодно")
  }
  if (returnRef) summaryParts.push(`реф. ${returnRef}`)
  if (recallRef) summaryParts.push(`реф. ${recallRef}`)
  if (courierRef) summaryParts.push(`куриер ${courierRef}`)
  const summaryHeader = summaryParts.join(" — ")
  const noteBody = recallReason ? `${recallReason}\n\n${trimmedNote}` : trimmedNote
  const fullNote = `[${summaryHeader}] ${noteBody}`

  const { error: noteError } = await supabase.rpc("add_admin_note", {
    p_order_id: orderId,
    p_text: fullNote.slice(0, 2000),
  })
  if (noteError) {
    // Audit event already recorded — the note failure is non-fatal.
    console.error("Failed to append admin note for outcome:", noteError)
  }

  return { success: true }
}

export async function recordComplaint(
  orderId: string,
  data: {
    defectDescription: string
    customerDemand: "refund" | "replacement" | "repair" | "discount"
  },
): Promise<{ success: true; complaintRef: string }> {
  await requireAdmin()

  if (!UUID_REGEX.test(orderId)) throw new Error("Невалиден формат на поръчка")

  // Validate defect description
  const trimmedDefect = data.defectDescription?.trim()
  if (!trimmedDefect) throw new Error("Описанието на несъответствието е задължително")
  if (trimmedDefect.length > 2000) throw new Error("Описанието е твърде дълго")

  // Validate customer demand
  const validDemands = ["refund", "replacement", "repair", "discount"]
  if (!validDemands.includes(data.customerDemand)) {
    throw new Error("Невалидна претенция на потребителя")
  }

  // Verify order exists
  const supabase = await createClient()
  const { data: order, error: fetchError } = await supabase
    .from("orders")
    .select("id")
    .eq("id", orderId)
    .single()

  if (fetchError || !order) throw new Error("Поръчката не е намерена")

  // Generate complaint ref atomically via DB sequence
  const { data: seqData, error: seqError } = await supabase
    .rpc("nextval_text", { seq_name: "complaint_ref_seq" })

  // Fallback: if RPC doesn't exist, use a direct query approach
  let seqNum: number
  if (seqError) {
    // Direct SQL via rpc isn't available for nextval — use a raw approach
    const { data: rawSeq, error: rawErr } = await supabase
      .from("complaints")
      .select("id")
      .order("id", { ascending: false })
      .limit(1)
    seqNum = rawSeq && rawSeq.length > 0 ? (rawSeq[0].id as number) + 1 : 1
    if (rawErr) seqNum = Date.now() // last resort
  } else {
    seqNum = parseInt(seqData as string, 10) || Date.now()
  }

  const year = new Date().getFullYear()
  const complaintRef = `RCL-${year}-${String(seqNum).padStart(4, "0")}`

  // Insert complaint
  const { error: insertError } = await supabase.from("complaints").insert({
    order_id: orderId,
    complaint_ref: complaintRef,
    defect_description: trimmedDefect,
    customer_demand: data.customerDemand,
    status: "open",
    created_by: "admin",
  })

  if (insertError) {
    console.error("Failed to record complaint:", insertError)
    // If unique constraint violation, likely a race — retry with different number
    if (insertError.code === "23505") {
      throw new Error("Дублиран номер на рекламация. Моля, опитайте отново.")
    }
    throw new Error("Грешка при записване на рекламация")
  }

  return { success: true, complaintRef }
}

export async function resolveComplaint(
  complaintId: number,
  data: {
    status: "resolved" | "rejected"
    resolution: string
  },
): Promise<{ success: true }> {
  await requireAdmin()

  if (!Number.isInteger(complaintId) || complaintId < 1) {
    throw new Error("Невалиден идентификатор на рекламация")
  }

  const trimmedResolution = data.resolution?.trim()
  if (!trimmedResolution) throw new Error("Решението е задължително")
  if (trimmedResolution.length > 1000) throw new Error("Решението е твърде дълго")

  if (data.status !== "resolved" && data.status !== "rejected") {
    throw new Error("Невалиден статус")
  }

  const supabase = await createClient()
  const { data: updated, error } = await supabase
    .from("complaints")
    .update({
      status: data.status,
      resolution: trimmedResolution,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", complaintId)
    .eq("status", "open")
    .select("id")

  if (error) {
    console.error("Failed to resolve complaint:", error)
    throw new Error("Грешка при приключване на рекламация")
  }

  if (!updated || updated.length === 0) {
    throw new Error("Рекламацията не е намерена или вече е приключена")
  }

  return { success: true }
}

// ─── Complaint queries ───────────────────────────────────────────────────────

interface ComplaintQueryParams {
  status?: string
  page?: number
}

export async function getComplaints(
  params?: ComplaintQueryParams,
): Promise<{ complaints: Complaint[]; total: number }> {
  await requireAdmin()
  const supabase = await createClient()

  const page = Math.max(0, Math.floor(Number(params?.page ?? 0)) || 0)
  const from = page * ORDERS_PAGE_SIZE
  const to = from + ORDERS_PAGE_SIZE - 1

  let query = supabase
    .from("complaints")
    .select("*", { count: "exact" })
    .order("reported_at", { ascending: false })
    .range(from, to)

  if (params?.status && params.status !== "all") {
    query = query.eq("status", params.status)
  }

  const { data, error, count } = await query
  if (error) {
    console.error("Failed to fetch complaints:", error)
    throw new Error("Грешка при зареждане на рекламациите")
  }

  return { complaints: (data ?? []) as Complaint[], total: count ?? 0 }
}

export async function getOrderComplaints(orderId: string): Promise<Complaint[]> {
  await requireAdmin()

  if (!UUID_REGEX.test(orderId)) throw new Error("Невалиден формат на поръчка")

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("complaints")
    .select("*")
    .eq("order_id", orderId)
    .order("reported_at", { ascending: false })

  if (error) {
    console.error("Failed to fetch complaints:", error)
    throw new Error("Грешка при зареждане на рекламации")
  }

  return (data || []) as Complaint[]
}


// ─── Withdrawals (право на отказ; ЗЗП Чл. 50) ───────────────────────────────
// Admin-driven intake: customer contacts via email/phone; admin classifies and
// creates the withdrawal here. State machine + audit triggers live in the DB
// migration; these server actions are thin wrappers that prepare payloads,
// run validation, and surface friendly errors.

interface CreateWithdrawalInput {
  requestedVia: WithdrawalRequestedVia
  customerEmail: string
  customerRequestText?: string
}

export async function createWithdrawal(
  orderId: string,
  data: CreateWithdrawalInput,
): Promise<{ success: true; withdrawalId: string; withdrawalRef: string }> {
  await requireAdmin()

  if (!UUID_REGEX.test(orderId)) throw new Error("Невалиден формат на поръчка")

  const requestedVia = data.requestedVia
  if (!["email", "phone", "admin"].includes(requestedVia)) {
    throw new Error("Невалиден канал на заявка")
  }

  const trimmedEmail = data.customerEmail?.trim().toLowerCase() ?? ""
  if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    throw new Error("Невалиден имейл адрес на клиента")
  }

  const trimmedText = data.customerRequestText?.trim() || null
  if (trimmedText && trimmedText.length > 2000) {
    throw new Error("Текстът на заявката е твърде дълъг")
  }

  const supabase = await createClient()

  // Fetch order data for eligibility computation. The order must exist;
  // delivered_at drives the time-based eligibility check.
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, delivered_at, status")
    .eq("id", orderId)
    .single()

  if (orderError || !order) {
    throw new Error("Поръчката не е намерена")
  }

  // ЗЗП Чл. 50 — the withdrawal right matures only after the customer
  // physically receives the goods. Pre-delivery cancellation is a different
  // flow (regular order cancellation): the customer's contract hasn't yet
  // been fully performed, so there's no completed sale to "withdraw" from.
  // Hard-block creation for non-delivered orders to keep the register clean
  // and point admin at the correct flow.
  if (order.status !== "delivered") {
    throw new Error(
      "Право на отказ важи след доставка. За отмяна на потвърдена поръчка използвайте Действия → Отказ.",
    )
  }

  // Time-based eligibility: requested_at <= delivered_at + 14 days.
  // delivered_at is set since status='delivered' (chk_delivered_after_shipped
  // ensures the timestamp is populated when status flips).
  let eligibilityTimeBased: boolean | null = null
  if (order.delivered_at) {
    const deadline = new Date(order.delivered_at).getTime() + 14 * 24 * 60 * 60 * 1000
    eligibilityTimeBased = Date.now() <= deadline
  }

  // Atomic WD-YYYY-NNNN minted server-side from the sequence
  const { data: refData, error: refError } = await supabase.rpc("next_withdrawal_ref")
  if (refError || !refData) {
    console.error("Failed to mint withdrawal_ref:", refError)
    throw new Error("Грешка при генериране на референция")
  }
  const withdrawalRef = String(refData)

  const { data: inserted, error: insertError } = await supabase
    .from("withdrawals")
    .insert({
      order_id: orderId,
      withdrawal_ref: withdrawalRef,
      requested_via: requestedVia,
      customer_email: trimmedEmail,
      customer_request_text: trimmedText,
      eligibility_time_based: eligibilityTimeBased,
      // All Egg Origin SKUs are protein bars (perishable + sealed-food).
      // The right exists, but Чл. 57 т.4+5 limits practical exercise.
      eligibility_product_based: "perishable_or_short_shelf_life",
      eligibility_condition: "pending_inspection",
    })
    .select("id, withdrawal_ref")
    .single()

  if (insertError) {
    if (insertError.code === "23505") {
      // uq_open_withdrawal_per_order — admin tried to register a 2nd open
      // withdrawal on the same order.
      throw new Error("За тази поръчка вече има отворена заявка за връщане")
    }
    console.error("Failed to insert withdrawal:", insertError)
    throw new Error("Грешка при записване на заявката")
  }

  // Fire-and-forget customer ack email
  const orderRecord = order as Record<string, unknown>
  void sendWithdrawalReceivedEmail(orderRecord, {
    withdrawalRef: inserted.withdrawal_ref,
    customerEmail: trimmedEmail,
  })

  revalidateTag("withdrawals", "max")
  return { success: true, withdrawalId: inserted.id, withdrawalRef: inserted.withdrawal_ref }
}

export async function approveWithdrawal(
  withdrawalId: string,
  data: { returnRequired: boolean },
): Promise<{ success: true }> {
  await requireAdmin()
  if (!UUID_REGEX.test(withdrawalId)) throw new Error("Невалиден формат на заявка")

  const supabase = await createClient()
  const { data: updated, error } = await supabase
    .from("withdrawals")
    .update({
      status: "approved",
      approved_at: new Date().toISOString(),
      approved_by: "admin",
      return_required: data.returnRequired,
    })
    .eq("id", withdrawalId)
    .eq("status", "requested")
    .select("id, order_id, customer_email, withdrawal_ref, return_required")
    .single()

  if (error || !updated) {
    if (error?.code) console.error("Failed to approve withdrawal:", error)
    throw new Error("Заявката не може да бъде одобрена (възможно е да не е в статус requested)")
  }

  // Customer-facing email branches on return_required
  void sendWithdrawalApprovedEmail({
    orderId: updated.order_id,
    customerEmail: updated.customer_email,
    withdrawalRef: updated.withdrawal_ref,
    returnRequired: updated.return_required,
  })

  revalidateTag("withdrawals", "max")
  return { success: true }
}

export async function rejectWithdrawal(
  withdrawalId: string,
  reason: string,
): Promise<{ success: true }> {
  await requireAdmin()
  if (!UUID_REGEX.test(withdrawalId)) throw new Error("Невалиден формат на заявка")

  const trimmed = reason?.trim()
  if (!trimmed) throw new Error("Причината за отказ е задължителна")
  if (trimmed.length > 1000) throw new Error("Причината е твърде дълга")

  const supabase = await createClient()
  // CHECK chk_no_reject_after_goods enforces this at DB level too.
  const { data: updated, error } = await supabase
    .from("withdrawals")
    .update({
      status: "rejected",
      rejection_reason: trimmed,
      rejected_at: new Date().toISOString(),
      rejected_by: "admin",
    })
    .eq("id", withdrawalId)
    .in("status", ["requested", "approved"])
    .is("goods_received_at", null)
    .select("id, order_id, customer_email, withdrawal_ref")
    .single()

  if (error || !updated) {
    if (error?.code) console.error("Failed to reject withdrawal:", error)
    throw new Error("Заявката не може да бъде отхвърлена в текущото състояние")
  }

  void sendWithdrawalRejectedEmail({
    orderId: updated.order_id,
    customerEmail: updated.customer_email,
    withdrawalRef: updated.withdrawal_ref,
    rejectionReason: trimmed,
  })

  revalidateTag("withdrawals", "max")
  return { success: true }
}

export async function markWithdrawalGoodsReceived(
  withdrawalId: string,
  data: {
    eligibilityCondition: WithdrawalEligibilityCondition
    resolutionType?: WithdrawalResolutionType
    returnTrackingNumber?: string
    returnCourier?: string
  },
): Promise<{ success: true }> {
  await requireAdmin()
  if (!UUID_REGEX.test(withdrawalId)) throw new Error("Невалиден формат на заявка")

  const allowedConditions: WithdrawalEligibilityCondition[] = [
    "sealed_sellable", "opened", "damaged", "expired", "other",
  ]
  if (!allowedConditions.includes(data.eligibilityCondition)) {
    throw new Error("Невалидно състояние на върнатата стока")
  }

  const allowedResolutions: WithdrawalResolutionType[] = ["refund", "replacement", "none"]
  if (data.resolutionType && !allowedResolutions.includes(data.resolutionType)) {
    throw new Error("Невалиден тип резолюция")
  }

  const tracking = data.returnTrackingNumber?.trim() || null
  if (tracking && tracking.length > 200) throw new Error("Номерът на товарителницата е твърде дълъг")
  const courier = data.returnCourier?.trim() || null
  if (courier && courier.length > 100) throw new Error("Името на куриера е твърде дълго")

  const supabase = await createClient()
  const { error } = await supabase
    .from("withdrawals")
    .update({
      status: "goods_received",
      eligibility_condition: data.eligibilityCondition,
      resolution_type: data.resolutionType ?? null,
      return_tracking_number: tracking,
      return_courier: courier,
      goods_received_at: new Date().toISOString(),
    })
    .eq("id", withdrawalId)
    .eq("status", "approved")

  if (error) {
    console.error("Failed to mark goods received:", error)
    throw new Error("Заявката не може да бъде преместена в 'получени стоки'")
  }

  revalidateTag("withdrawals", "max")
  return { success: true }
}

export async function completeWithdrawalNoReturn(
  withdrawalId: string,
  data: {
    resolutionType: WithdrawalResolutionType
    completionNote: string
  },
): Promise<{ success: true }> {
  await requireAdmin()
  if (!UUID_REGEX.test(withdrawalId)) throw new Error("Невалиден формат на заявка")

  if (!["refund", "replacement", "none"].includes(data.resolutionType)) {
    throw new Error("Невалиден тип резолюция")
  }

  const trimmedNote = data.completionNote?.trim()
  if (!trimmedNote) throw new Error("Бележката за завършване е задължителна за path B")
  if (trimmedNote.length > 1000) throw new Error("Бележката е твърде дълга")

  // For Refund path B, refund must be linked first. Admin uses recordRefund
  // (which writes refund_id on the withdrawal); this action is for
  // replacement/none. If admin tries with resolution_type=refund but refund_id
  // is null, the state-machine trigger raises.
  const supabase = await createClient()
  const { error } = await supabase
    .from("withdrawals")
    .update({
      status: "completed",
      resolution_type: data.resolutionType,
      completion_note: trimmedNote,
      completed_at: new Date().toISOString(),
    })
    .eq("id", withdrawalId)
    .eq("status", "approved")
    .eq("return_required", false)

  if (error) {
    console.error("Failed to complete withdrawal (no-return path):", error)
    throw new Error(translateRpcError(error, {
      WITHDRAWAL_REFUND_ID_REQUIRED: "За резолюция от тип 'refund' първо запишете възстановяване",
    }, "Заявката не може да бъде завършена в текущото състояние"))
  }

  revalidateTag("withdrawals", "max")
  return { success: true }
}

interface WithdrawalQueryParams {
  status?: string
  page?: number
}

export async function getWithdrawals(
  params?: WithdrawalQueryParams,
): Promise<{ withdrawals: Withdrawal[]; total: number }> {
  await requireAdmin()
  const supabase = await createClient()

  const page = Math.max(0, Math.floor(Number(params?.page ?? 0)) || 0)
  const from = page * ORDERS_PAGE_SIZE
  const to = from + ORDERS_PAGE_SIZE - 1

  let query = supabase
    .from("withdrawals")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to)

  if (params?.status && params.status !== "all") {
    query = query.eq("status", params.status)
  }

  const { data, error, count } = await query
  if (error) {
    console.error("Failed to fetch withdrawals:", error)
    throw new Error("Грешка при зареждане на заявките")
  }

  return { withdrawals: (data ?? []) as Withdrawal[], total: count ?? 0 }
}

export interface WithdrawalWithOrderContext extends Withdrawal {
  order: {
    status: string
    payment_method: string
    seller_settled_at: string | null
    delivered_at: string | null
  }
}

export async function getWithdrawal(withdrawalId: string): Promise<WithdrawalWithOrderContext> {
  await requireAdmin()
  if (!UUID_REGEX.test(withdrawalId)) throw new Error("Невалиден формат на заявка")

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("withdrawals")
    .select("*, order:orders(status, payment_method, seller_settled_at, delivered_at)")
    .eq("id", withdrawalId)
    .single()

  if (error || !data) {
    throw new Error("Заявката не е намерена")
  }

  return data as WithdrawalWithOrderContext
}

export async function getOrderWithdrawals(orderId: string): Promise<Withdrawal[]> {
  await requireAdmin()
  if (!UUID_REGEX.test(orderId)) throw new Error("Невалиден формат на поръчка")

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("withdrawals")
    .select("*")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false })

  if (error) {
    console.error("Failed to fetch order withdrawals:", error)
    throw new Error("Грешка при зареждане на заявките за поръчката")
  }

  return (data ?? []) as Withdrawal[]
}


async function sendShippingEmail(order: Record<string, unknown>, trackingNumber: string) {
  if (!isEmailEnabled()) return

  const supabase = await createClient()
  const { data: orderItems, error: itemsErr } = await supabase
    .from("order_items")
    .select("product_name, quantity, unit_price_cents")
    .eq("order_id", order.id as string)
    .order("line_no")
  if (itemsErr || !orderItems) {
    console.error(`Failed to load order_items for shipping email on ${order.id}:`, itemsErr)
    return
  }

  const resend = getEmailClient()
  const deliveryLabel = getDeliveryLabel(order.logistics_partner as string)

  const itemsList = orderItems
    .map((item) => `${item.product_name} x ${item.quantity} - ${formatPrice(item.unit_price_cents * item.quantity)}`)
    .join("\n")

  const econtOfficeLine = order.econt_office_name ? `\nОфис: ${order.econt_office_name}\n${order.econt_office_address || ""}` : ""
  const speedyOfficeLine = order.speedy_office_name ? `\nОфис: ${order.speedy_office_name}\n${order.speedy_office_address || ""}` : ""

  resend.emails.send({
    from: requireEnv("EMAIL_FROM"),
    to: order.email as string,
    subject: `Поръчка #${(order.id as string).slice(0, 8)} - Изпратена`,
    text: `
Здравейте ${order.first_name},

Вашата поръчка беше изпратена!

Детайли на поръчката:
${itemsList}

Обща сума: ${formatPrice(order.total_amount as number)}

Доставка: ${deliveryLabel}${econtOfficeLine}${speedyOfficeLine}
Номер на пратка: ${trackingNumber}

Ще получите пратката си в рамките на 1-3 работни дни.

Поздрави,
Екипът на Egg Origin
    `.trim(),
  }).catch((err) => {
    console.error(`Failed to send shipping email for order ${order.id}:`, err)
  })
}

// ── Sale management ──────────────────────────────────────────────

export interface SaleRecord {
  id: string
  product_id: string
  sale_price_in_cents: number
  original_price_in_cents: number
  starts_at: string
  ends_at: string | null
  is_active: boolean
  created_at: string
}

export async function getSales(): Promise<SaleRecord[]> {
  await requireAdmin()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("product_sales")
    .select("*")
    .order("created_at", { ascending: false })

  if (error) {
    console.error("Failed to fetch sales:", error)
    throw new Error("Failed to fetch sales")
  }

  return data || []
}

async function getLowestPrice30Days(productId: string): Promise<number> {
  const baseProduct = PRODUCTS.find((p) => p.id === productId)
  if (!baseProduct) throw new Error("Product not found")

  const supabase = await createClient()
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const { data: pastSales } = await supabase
    .from("product_sales")
    .select("sale_price_in_cents")
    .eq("product_id", productId)
    .gte("created_at", thirtyDaysAgo)
    .order("sale_price_in_cents", { ascending: true })
    .limit(1)

  const basePrice = baseProduct.priceInCents
  const saleMin = pastSales?.[0]?.sale_price_in_cents ?? Infinity

  return Math.min(basePrice, saleMin)
}

export async function createSale(data: {
  productId: string
  salePriceInCents: number
  startsAt?: string
  endsAt?: string | null
}) {
  await requireAdmin()

  const product = PRODUCTS.find((p) => p.id === data.productId)
  if (!product) throw new Error("Продуктът не е намерен")

  if (!Number.isInteger(data.salePriceInCents) || data.salePriceInCents <= 0) {
    throw new Error("Промоционалната цена трябва да е положително число")
  }

  if (data.salePriceInCents >= product.priceInCents) {
    throw new Error(
      `Промоционалната цена (${formatPrice(data.salePriceInCents)}) трябва да е по-ниска от базовата (${formatPrice(product.priceInCents)})`
    )
  }

  if (data.endsAt) {
    const endsAtDate = new Date(data.endsAt)
    if (isNaN(endsAtDate.getTime())) {
      throw new Error("Невалидна крайна дата")
    }
    if (endsAtDate <= new Date()) {
      throw new Error("Крайната дата трябва да е в бъдещето")
    }
  }

  // EU Omnibus: original price must be the lowest in the last 30 days
  const lowestPrice = await getLowestPrice30Days(data.productId)

  const supabase = await createClient()

  // Deactivate any existing active sale for this product
  const { error: deactivateError } = await supabase
    .from("product_sales")
    .update({ is_active: false })
    .eq("product_id", data.productId)
    .eq("is_active", true)

  if (deactivateError) {
    console.error("Failed to deactivate existing sale:", deactivateError)
    throw new Error("Грешка при деактивиране на текущата промоция")
  }

  const { error } = await supabase.from("product_sales").insert({
    product_id: data.productId,
    sale_price_in_cents: data.salePriceInCents,
    original_price_in_cents: lowestPrice,
    starts_at: data.startsAt ?? new Date().toISOString(),
    ends_at: data.endsAt ?? null,
    is_active: true,
  })

  if (error) {
    console.error("Failed to create sale:", error)
    throw new Error("Грешка при създаване на промоцията")
  }

  revalidateTag("active-sales", "max")
  return { success: true }
}

export async function endSale(saleId: string) {
  await requireAdmin()

  if (!UUID_REGEX.test(saleId)) throw new Error("Invalid sale ID")

  const supabase = await createClient()

  const { data: updated, error } = await supabase
    .from("product_sales")
    .update({ is_active: false, ends_at: new Date().toISOString() })
    .eq("id", saleId)
    .eq("is_active", true)
    .select("id")

  if (error) {
    console.error("Failed to end sale:", error)
    throw new Error("Грешка при спиране на промоцията")
  }

  if (!updated || updated.length === 0) {
    throw new Error("Промоцията вече е спряна")
  }

  revalidateTag("active-sales", "max")
  return { success: true }
}

// ── Promo code management ────────────────────────────────────────

export interface PromoCodeRecord {
  id: string
  code: string
  discount_type: string
  discount_value: number
  min_order_amount: number
  max_uses: number | null
  current_uses: number
  starts_at: string
  ends_at: string | null
  is_active: boolean
  created_at: string
}

export async function getPromoCodes(): Promise<PromoCodeRecord[]> {
  await requireAdmin()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("promo_codes")
    .select("*")
    .order("created_at", { ascending: false })

  if (error) {
    console.error("Failed to fetch promo codes:", error)
    throw new Error("Failed to fetch promo codes")
  }

  return data || []
}

const PROMO_CODE_REGEX = /^[A-Z0-9\-_]{2,30}$/

export async function createPromoCode(input: {
  code: string
  discountType: "percentage" | "fixed"
  discountValue: number
  minOrderAmount: number
  maxUses: number | null
  startsAt?: string
  endsAt?: string | null
}) {
  await requireAdmin()

  const code = input.code.trim().toUpperCase()
  if (!PROMO_CODE_REGEX.test(code)) {
    throw new Error("Кодът трябва да е 2-30 символа (букви, цифри, тирета)")
  }

  if (!Number.isInteger(input.discountValue) || input.discountValue <= 0) {
    throw new Error("Стойността на отстъпката трябва да е положително число")
  }

  if (input.discountType === "percentage" && input.discountValue > 100) {
    throw new Error("Процентната отстъпка не може да надвишава 100%")
  }

  if (input.minOrderAmount < 0) {
    throw new Error("Минималната сума не може да е отрицателна")
  }

  if (input.maxUses !== null && input.maxUses <= 0) {
    throw new Error("Максималният брой използвания трябва да е положително число")
  }

  if (input.endsAt) {
    const endsAtDate = new Date(input.endsAt)
    if (isNaN(endsAtDate.getTime())) throw new Error("Невалидна крайна дата")
    if (endsAtDate <= new Date()) throw new Error("Крайната дата трябва да е в бъдещето")
  }

  const supabase = await createClient()

  const { error } = await supabase.from("promo_codes").insert({
    code,
    discount_type: input.discountType,
    discount_value: input.discountValue,
    min_order_amount: input.minOrderAmount,
    max_uses: input.maxUses,
    starts_at: input.startsAt ?? new Date().toISOString(),
    ends_at: input.endsAt ?? null,
    is_active: true,
  })

  if (error) {
    if (error.code === "23505") {
      throw new Error("Вече съществува активен код с това име")
    }
    console.error("Failed to create promo code:", error)
    throw new Error("Грешка при създаване на промо код")
  }

  return { success: true }
}

export async function deactivatePromoCode(promoId: string) {
  await requireAdmin()

  if (!UUID_REGEX.test(promoId)) throw new Error("Invalid promo code ID")

  const supabase = await createClient()

  const { data: updated, error } = await supabase
    .from("promo_codes")
    .update({ is_active: false })
    .eq("id", promoId)
    .eq("is_active", true)
    .select("id")

  if (error) {
    console.error("Failed to deactivate promo code:", error)
    throw new Error("Грешка при деактивиране на промо кода")
  }

  if (!updated || updated.length === 0) {
    throw new Error("Промо кодът вече е деактивиран")
  }

  return { success: true }
}

// ─── Inventory ────────────────────────────────────────────────────────────────

export interface InventoryStatus {
  sku: string
  productName: string
  quantity: number
  updatedAt: string
}

export interface InventoryLogEntry {
  id: number
  sku: string
  type: string
  quantity: number
  batch_id: string | null
  expiry_date: string | null
  order_id: string | null
  notes: string | null
  reference_type: string | null
  reference_id: string | null
  created_by: string
  location_id: string
  before_quantity: number | null
  after_quantity: number | null
  created_at: string
}

export interface Complaint {
  id: number
  order_id: string
  complaint_ref: string
  reported_at: string
  defect_description: string
  customer_demand: string
  status: string
  resolution: string | null
  resolved_at: string | null
  created_by: string
}

// ─── Batch traceability (EU 178/2002 Чл. 18; EU 931/2011) ──────────────────
export type ProductBatchStatus = "active" | "recalled"

export interface ProductBatch {
  id: string
  sku: string
  batch_number: string
  expiry_date: string
  status: ProductBatchStatus
  recalled_at: string | null
  recalled_by: string | null
  recall_reason: string | null
  notes: string | null
  created_at: string
  created_by: string
}

export interface ProductBatchWithAvailability extends ProductBatch {
  quantity_available: number
}

export interface OrderItemBatch {
  id: string
  order_item_id: number
  product_batch_id: string
  quantity: number
  confirmed_at: string
  confirmed_by: string
}

export interface BatchAffectedOrder {
  order_id: string
  order_status: string
  customer_email: string
  customer_first_name: string
  customer_last_name: string
  customer_phone: string
  customer_city: string
  shipped_at: string | null
  delivered_at: string | null
  quantity_from_batch: number
  tracking_number: string | null
}

// ─── Withdrawals (право на отказ; ЗЗП Чл. 50) ───────────────────────────────
export type WithdrawalStatus =
  | "requested"
  | "approved"
  | "goods_received"
  | "rejected"
  | "completed"

export type WithdrawalRequestedVia = "email" | "phone" | "admin"

export type WithdrawalEligibilityProductBased =
  | "eligible"
  | "perishable_or_short_shelf_life"
  | "hygiene_exception"
  | "unknown"

export type WithdrawalEligibilityCondition =
  | "pending_inspection"
  | "sealed_sellable"
  | "opened"
  | "damaged"
  | "expired"
  | "other"

export type WithdrawalResolutionType = "refund" | "replacement" | "none"

export interface Withdrawal {
  id: string
  order_id: string
  withdrawal_ref: string
  requested_via: WithdrawalRequestedVia
  customer_email: string
  customer_request_text: string | null
  status: WithdrawalStatus
  eligibility_time_based: boolean | null
  eligibility_product_based: WithdrawalEligibilityProductBased | null
  eligibility_condition: WithdrawalEligibilityCondition | null
  resolution_type: WithdrawalResolutionType | null
  rejection_reason: string | null
  refund_id: string | null
  return_required: boolean
  completion_note: string | null
  return_tracking_number: string | null
  return_courier: string | null
  approved_at: string | null
  approved_by: string | null
  goods_received_at: string | null
  rejected_at: string | null
  rejected_by: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export async function getInventoryStatus(): Promise<{ current: InventoryStatus[]; log: InventoryLogEntry[] }> {
  await requireAdmin()
  const supabase = await createClient()

  const [currentResult, logResult] = await Promise.all([
    supabase.from("inventory_current").select("sku, quantity, updated_at").order("sku"),
    supabase.from("inventory_log").select("*").order("created_at", { ascending: false }).limit(50),
  ])

  if (currentResult.error) {
    console.error("Failed to fetch inventory_current:", currentResult.error)
    throw new Error("Грешка при зареждане на склада")
  }

  const skuToName = Object.fromEntries(PRODUCTS.map((p) => [p.sku, p.name]))

  const current: InventoryStatus[] = (currentResult.data || []).map((row) => ({
    sku: row.sku,
    productName: skuToName[row.sku] ?? row.sku,
    quantity: row.quantity,
    updatedAt: row.updated_at,
  }))

  return {
    current,
    log: (logResult.data || []) as InventoryLogEntry[],
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function addInventoryBatch(data: {
  sku: string
  quantity: number
  batchId: string
  expiryDate: string
  notes: string
  idempotencyKey: string
}): Promise<{ success: true }> {
  await requireAdmin()

  const validSkus = PRODUCTS.map((p) => p.sku)
  if (!validSkus.includes(data.sku)) throw new Error("Невалиден SKU")
  if (!Number.isInteger(data.quantity) || data.quantity < 1 || data.quantity > 100000) {
    throw new Error("Количеството трябва да е между 1 и 100 000")
  }
  if (!data.batchId?.trim()) throw new Error("Номерът на партидата е задължителен")
  if (data.batchId.length > 100) throw new Error("Номерът на партидата е твърде дълъг")
  if (!data.expiryDate) throw new Error("Срокът на годност е задължителен")
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.expiryDate)) {
    throw new Error("Невалидна дата на годност")
  }
  if (data.notes && data.notes.length > 500) throw new Error("Бележката е твърде дълга")
  if (!UUID_REGEX.test(data.idempotencyKey)) throw new Error("Невалиден idempotency key")

  const supabase = await createClient()
  const { error } = await supabase.from("inventory_log").insert({
    sku: data.sku,
    type: "batch_in",
    quantity: data.quantity,
    batch_id: data.batchId.trim(),
    expiry_date: data.expiryDate,
    notes: data.notes?.trim() || null,
    reference_type: "internal" as const,
    reference_id: data.batchId.trim(),
    created_by: "admin",
    idempotency_key: data.idempotencyKey,
  })

  if (error) {
    // 23505 = unique_violation on idempotency_key; treat as idempotent no-op.
    // The original submission already recorded this movement.
    if (error.code === "23505") {
      return { success: true }
    }
    console.error("Failed to insert inventory batch:", error)
    throw new Error("Грешка при добавяне на наличност")
  }

  // Seed product_batches for the Tier 1 traceability layer. Unique on
  // (sku, batch_number) — repeat batch_in rows for the same supplier label
  // (top-up of an existing batch) reuse the existing product_batches row.
  const { error: batchErr } = await supabase
    .from("product_batches")
    .upsert(
      {
        sku: data.sku,
        batch_number: data.batchId.trim(),
        expiry_date: data.expiryDate,
        status: "active",
        notes: data.notes?.trim() || null,
        created_by: "admin",
      },
      { onConflict: "sku,batch_number", ignoreDuplicates: true },
    )
  if (batchErr) {
    console.error("Failed to seed product_batches:", batchErr)
    // inventory_log already committed; surface a soft warning rather than
    // re-throwing so the admin sees the stock count update. The batches
    // page will be missing this row until manually reseeded.
  }

  revalidateTag("inventory", "max")
  revalidateTag("product-batches", "max")

  return { success: true }
}

// ─── Manual stock movement (B2B, samples, damage, returns, adjustments) ──────

const MANUAL_MOVEMENT_TYPES = [
  "wholesale_out",
  "sample_out",
  "damaged",
  "return_in",
  "adjustment_gain",
  "adjustment_loss",
] as const
type ManualMovementType = (typeof MANUAL_MOVEMENT_TYPES)[number]

const ALLOWED_REFERENCE_TYPES: Record<ManualMovementType, string[]> = {
  wholesale_out: ["invoice"],
  sample_out: ["internal"],
  damaged: ["internal", "return"],
  return_in: ["return"],
  adjustment_gain: ["internal"],
  adjustment_loss: ["internal"],
}

const NOTES_REQUIRED_TYPES: ManualMovementType[] = [
  "adjustment_gain",
  "adjustment_loss",
  "damaged",
]

export async function recordStockMovement(data: {
  sku: string
  type: ManualMovementType
  quantity: number
  referenceType: "order" | "invoice" | "return" | "internal"
  referenceId: string
  notes?: string
  batchId?: string
  expiryDate?: string
  orderId?: string
  idempotencyKey: string
}): Promise<{ success: true }> {
  await requireAdmin()

  if (!UUID_REGEX.test(data.idempotencyKey)) throw new Error("Невалиден idempotency key")

  // Validate SKU
  const validSkus = PRODUCTS.map((p) => p.sku)
  if (!validSkus.includes(data.sku)) throw new Error("Невалиден SKU")

  // Validate type
  if (!MANUAL_MOVEMENT_TYPES.includes(data.type)) {
    throw new Error("Невалиден тип движение")
  }

  // Validate quantity
  if (!Number.isInteger(data.quantity) || data.quantity < 1 || data.quantity > 100000) {
    throw new Error("Количеството трябва да е цяло число между 1 и 100 000")
  }

  // Validate reference_type ↔ type combination
  const allowed = ALLOWED_REFERENCE_TYPES[data.type]
  if (!allowed.includes(data.referenceType)) {
    throw new Error(
      `Невалиден тип референция "${data.referenceType}" за движение "${data.type}". Позволени: ${allowed.join(", ")}`,
    )
  }

  // Validate referenceId
  const trimmedRefId = data.referenceId?.trim()
  if (!trimmedRefId) throw new Error("Референцията е задължителна")
  if (trimmedRefId.length > 200) throw new Error("Референцията е твърде дълга")

  // Validate notes (mandatory for certain types)
  const trimmedNotes = data.notes?.trim() || null
  if (NOTES_REQUIRED_TYPES.includes(data.type) && !trimmedNotes) {
    throw new Error("Бележката е задължителна за този тип движение")
  }
  if (trimmedNotes && trimmedNotes.length > 500) {
    throw new Error("Бележката е твърде дълга")
  }

  // Validate batchId/expiryDate.
  //   - return_in: batch + expiry allowed (re-stocking with original batch info)
  //   - wholesale_out: batch_id REQUIRED (EU 931/2011 — commercial consignments
  //     to other businesses must reference batch/lot). Provides legal traceability
  //     for B2B sales without requiring full Tier 1 batch tables.
  //   - sample_out / damaged / adjustment_loss / adjustment_gain: batch_id OPTIONAL.
  //     When provided, the row participates in batch_quantity_available so the
  //     two ledgers stay in sync. Untagged rows still affect inventory_current.
  //   - expiry_date stays return_in-only (the original batch's expiry travels
  //     with the returned unit; other types reference an existing batch via id).
  if (data.type === "wholesale_out" && !data.batchId?.trim()) {
    throw new Error(
      "Номер на партида е задължителен за оптови продажби (EU 931/2011 — изисква партида на търговските пратки)",
    )
  }
  if (data.expiryDate && data.type !== "return_in") {
    throw new Error("Срок на годност е допустим само за връщане")
  }
  const trimmedBatchId = data.batchId?.trim() || null
  if (trimmedBatchId && trimmedBatchId.length > 100) {
    throw new Error("Номерът на партидата е твърде дълъг")
  }
  if (data.expiryDate && !/^\d{4}-\d{2}-\d{2}$/.test(data.expiryDate)) {
    throw new Error("Невалидна дата на годност")
  }

  // Validate orderId — allowed on return_in (sellable return) and damaged
  // (damaged return). On other movement types, order_id wouldn't have
  // meaningful semantics under the current reference_type rules.
  const shortIdRegex = /^[0-9a-f]{8}$/i
  let resolvedOrderId: string | undefined = data.orderId?.trim() || undefined
  if (resolvedOrderId && data.type !== "return_in" && data.type !== "damaged") {
    throw new Error("Поръчка може да се свърже само при връщане или брак след връщане")
  }
  if (resolvedOrderId && !UUID_REGEX.test(resolvedOrderId) && !shortIdRegex.test(resolvedOrderId)) {
    throw new Error("Невалиден формат на поръчка (очаква се UUID или 8-знаков префикс)")
  }

  const supabase = await createClient()

  if (resolvedOrderId && shortIdRegex.test(resolvedOrderId)) {
    const prefix = resolvedOrderId.toLowerCase()
    const { data: matches, error: lookupErr } = await supabase
      .from("orders")
      .select("id")
      .gte("id", `${prefix}-0000-0000-0000-000000000000`)
      .lte("id", `${prefix}-ffff-ffff-ffff-ffffffffffff`)
      .limit(2)
    if (lookupErr) throw new Error("Грешка при търсене на поръчка")
    if (!matches || matches.length === 0) throw new Error("Поръчка с този ID не е намерена")
    if (matches.length > 1) throw new Error("Префиксът съответства на повече от една поръчка — въведете пълния ID")
    resolvedOrderId = matches[0].id as string
  }

  // Order-scoped return cap: when the movement is tied to a specific
  // customer order return (order_id + reference_type='return' +
  // return_in|damaged), validate:
  //   (a) the SKU was actually part of that order
  //   (b) sum(prior return-scoped movements for this (order, sku)) +
  //       this quantity ≤ sum(order_out quantities for this (order, sku))
  // Matches the DB trigger enforce_order_return_cap (migration
  // 20260423210000) — same cap, same Bulgarian wording. App-layer runs
  // first for friendlier UX; trigger is the backstop.
  //
  // Warehouse-internal damage (reference_type='internal', no orderId)
  // deliberately bypasses this — you can write off spoilage or breakage
  // unrelated to any customer shipment. Adjustments (gain/loss) also
  // bypass — they're per-SKU reconciliation, not per-order returns.
  const isOrderReturn =
    resolvedOrderId &&
    data.referenceType === "return" &&
    (data.type === "return_in" || data.type === "damaged")

  if (isOrderReturn) {
    const { data: orderItems, error: itemsErr } = await supabase
      .from("order_items")
      .select("sku, quantity")
      .eq("order_id", resolvedOrderId!)
    if (itemsErr) {
      console.error("Failed to load order_items for return-cap validation:", itemsErr)
      throw new Error("Грешка при проверка на артикулите на поръчката")
    }
    const orderSkuQty = (orderItems ?? []).find((i) => i.sku === data.sku)?.quantity ?? 0
    if (orderSkuQty === 0) {
      throw new Error(`SKU ${data.sku} не е част от тази поръчка`)
    }

    // Sum prior return-scoped movements (return_in + damaged with
    // reference_type='return') for this (order_id, sku).
    const { data: priorReturns, error: priorErr } = await supabase
      .from("inventory_log")
      .select("quantity")
      .eq("order_id", resolvedOrderId!)
      .eq("sku", data.sku)
      .eq("reference_type", "return")
      .in("type", ["return_in", "damaged"])
    if (priorErr) {
      console.error("Failed to load prior returns:", priorErr)
      throw new Error("Грешка при проверка на предишни връщания")
    }
    const priorQty = (priorReturns ?? []).reduce((s, r) => s + (r.quantity as number), 0)

    if (priorQty + data.quantity > orderSkuQty) {
      // Wording matches the DB trigger verbatim so the admin sees
      // consistent Bulgarian copy whichever layer rejects the insert.
      throw new Error(
        `Не можете да върнете/бракувате повече бройки от изпратените за този артикул по тази поръчка (SKU ${data.sku}, изпратени ${orderSkuQty}, вече върнати ${priorQty}, опит за ${data.quantity})`,
      )
    }
  }

  const { error } = await supabase.from("inventory_log").insert({
    sku: data.sku,
    type: data.type,
    quantity: data.quantity,
    reference_type: data.referenceType,
    reference_id: trimmedRefId,
    notes: trimmedNotes,
    batch_id: trimmedBatchId,
    expiry_date: data.expiryDate || null,
    order_id: resolvedOrderId || null,
    created_by: "admin",
    idempotency_key: data.idempotencyKey,
  })

  if (error) {
    // Idempotency key collision — same operation already recorded.
    if (error.code === "23505") {
      return { success: true }
    }
    console.error("Failed to record stock movement:", error)
    throw new Error("Грешка при записване на движение")
  }

  // Inflows that introduce a labeled unit (return_in, adjustment_gain) should
  // create a product_batches row when admin supplied both batch_number and
  // expiry — same pattern as addInventoryBatch. Outflows reference existing
  // batches via the picker and never need to seed. If expiry is missing we
  // skip the seed silently (the inventory_log row still records the movement).
  const isInflowWithBatch =
    (data.type === "return_in" || data.type === "adjustment_gain") &&
    trimmedBatchId &&
    data.expiryDate
  if (isInflowWithBatch) {
    const { error: batchErr } = await supabase
      .from("product_batches")
      .upsert(
        {
          sku: data.sku,
          batch_number: trimmedBatchId,
          expiry_date: data.expiryDate,
          status: "active",
          created_by: "admin",
        },
        { onConflict: "sku,batch_number", ignoreDuplicates: true },
      )
    if (batchErr) {
      console.error("Failed to seed product_batches from inflow movement:", batchErr)
      // inventory_log already committed; surface a soft warning rather than
      // re-throwing so the admin sees the stock count update. The batch
      // page will be missing this row until manually reseeded.
    }
  }

  revalidateTag("inventory", "max")
  // Movements with a batch_id participate in batch_quantity_available, so
  // bump that tag too (and the inflow path above may have inserted a row).
  if (trimmedBatchId) revalidateTag("product-batches", "max")

  return { success: true }
}

// ─── Recall / batch traceability export ─────────────────────────────────────
// Food-safety recall workflow: given a SKU (and optional date range), list
// all orders containing that SKU that might need customer contact.
//
// Pre-launch, we don't track batch → order mapping (would need FIFO batch
// consumption). So the recall set is always "all orders with this SKU in
// the date range" — an over-approximation. Admin does the final triage
// by phone. This is acceptable for our volume; if we ever ship enough to
// make the over-approximation expensive, we add a per-order batch
// allocation at ship time.
//
// Status scope: `confirmed`, `shipped`, `delivered`. Covers the three
// audiences:
//   - confirmed: not yet shipped → can be cancelled + refunded
//   - shipped: in transit → notify, ask customer not to consume
//   - delivered: possibly consumed → notify, offer refund/replacement,
//     ask about symptoms if food-safety issue
// Excluded: pending (no payment = no goods reserved), cancelled, expired
// (terminal — no goods at risk).

export interface RecallCandidate {
  orderId: string
  shortId: string
  createdAt: string
  shippedAt: string | null
  deliveredAt: string | null
  status: "confirmed" | "shipped" | "delivered"
  firstName: string
  lastName: string
  email: string
  phone: string
  city: string
  address: string | null
  postalCode: string | null
  quantity: number
  trackingNumber: string | null
  logisticsPartner: string | null
}

export async function getRecallCandidates(
  sku: string,
  fromDate?: string,
  toDate?: string,
): Promise<RecallCandidate[]> {
  await requireAdmin()

  const validSkus = PRODUCTS.map((p) => p.sku)
  if (!validSkus.includes(sku)) throw new Error("Невалиден SKU")

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/
  if (fromDate && !dateRegex.test(fromDate)) throw new Error("Невалидна начална дата")
  if (toDate && !dateRegex.test(toDate)) throw new Error("Невалидна крайна дата")
  if (fromDate && toDate && fromDate > toDate) {
    throw new Error("Началната дата не може да е след крайната")
  }

  const supabase = await createClient()

  // Query from order_items so the SKU filter hits the right column. The
  // !inner join restricts to items whose parent order matches the
  // status + date filters. cardinality is many-to-one (one order per
  // item) — PostgREST returns `orders` as a single object, not an array.
  let query = supabase
    .from("order_items")
    .select(`
      quantity,
      sku,
      orders!inner (
        id,
        created_at,
        shipped_at,
        delivered_at,
        status,
        first_name,
        last_name,
        email,
        phone,
        city,
        address,
        postal_code,
        tracking_number,
        logistics_partner
      )
    `)
    .eq("sku", sku)
    .in("orders.status", ["confirmed", "shipped", "delivered"])

  if (fromDate) {
    query = query.gte("orders.created_at", `${fromDate}T00:00:00.000Z`)
  }
  if (toDate) {
    // End-of-day inclusive: orders placed any time on the to-date are
    // included. Matches how admins mentally read "до 2026-04-24".
    query = query.lte("orders.created_at", `${toDate}T23:59:59.999Z`)
  }

  const { data, error } = await query
  if (error) {
    console.error("Failed to fetch recall candidates:", error)
    throw new Error("Грешка при извличане на кандидати за изтегляне")
  }

  type OrderShape = {
    id: string
    created_at: string
    shipped_at: string | null
    delivered_at: string | null
    status: "confirmed" | "shipped" | "delivered"
    first_name: string
    last_name: string
    email: string
    phone: string
    city: string
    address: string | null
    postal_code: string | null
    tracking_number: string | null
    logistics_partner: string | null
  }
  type ItemShape = { quantity: number; sku: string; orders: OrderShape | OrderShape[] }

  const rows = (data ?? []) as unknown as ItemShape[]

  const candidates: RecallCandidate[] = rows.map((row) => {
    // PostgREST sometimes types the to-one relation as an array in the
    // generated types. At runtime it's a single object when the FK is
    // to-one; handle both for safety.
    const o = Array.isArray(row.orders) ? row.orders[0] : row.orders
    return {
      orderId: o.id,
      shortId: o.id.slice(0, 8),
      createdAt: o.created_at,
      shippedAt: o.shipped_at,
      deliveredAt: o.delivered_at,
      status: o.status,
      firstName: o.first_name,
      lastName: o.last_name,
      email: o.email,
      phone: o.phone,
      city: o.city,
      address: o.address,
      postalCode: o.postal_code,
      quantity: row.quantity,
      trackingNumber: o.tracking_number,
      logisticsPartner: o.logistics_partner,
    }
  })

  // Sort delivered last, shipped middle, confirmed first (so admin works
  // through escalating risk in the same order they'd dial the phone).
  const statusOrder: Record<RecallCandidate["status"], number> = {
    confirmed: 0,
    shipped: 1,
    delivered: 2,
  }
  candidates.sort((a, b) => {
    const cmp = statusOrder[a.status] - statusOrder[b.status]
    if (cmp !== 0) return cmp
    return (b.createdAt || "").localeCompare(a.createdAt || "")
  })

  return candidates
}


// ─── Batch traceability (EU 178/2002, EU 931/2011) ──────────────────────────
// Tier 1 batch tracking: product_batches + order_item_batches populated at
// ship time. Inventory layer (inventory_log/inventory_current) unchanged.
//
// Layer split:
//   - inventory_log     : SKU-level movements (existing)
//   - product_batches   : supplier-batch metadata (NEW; sku, batch_number, expiry, status)
//   - order_item_batches: per-shipment per-line allocation (NEW; tied to order_item)
//
// Both new tables are append-mostly: order_item_batches is fully immutable
// post-insert; product_batches allows only the active → recalled forward
// transition with metadata atomically populated.

export async function getProductBatches(params?: {
  sku?: string
  status?: ProductBatchStatus | "all"
}): Promise<ProductBatchWithAvailability[]> {
  await requireAdmin()
  const supabase = await createClient()

  let query = supabase
    .from("product_batches")
    .select("*")
    .order("expiry_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true })

  if (params?.sku) {
    query = query.eq("sku", params.sku)
  }
  if (params?.status && params.status !== "all") {
    query = query.eq("status", params.status)
  }

  const { data, error } = await query
  if (error) {
    console.error("Failed to fetch product_batches:", error)
    throw new Error("Грешка при зареждане на партидите")
  }

  // Compute available quantity per batch via the helper RPC. Issued in
  // parallel; the call count is bounded by total batches (small) so a
  // SQL lateral join isn't worth the schema change.
  const batches = (data ?? []) as ProductBatch[]
  const availabilities = await Promise.all(
    batches.map(async (b) => {
      const { data: qty, error: qtyError } = await supabase.rpc("batch_quantity_available", { p_batch_id: b.id })
      if (qtyError) console.error(`Failed to compute availability for batch ${b.id}:`, qtyError)
      return typeof qty === "number" ? qty : 0
    }),
  )
  return batches.map((b, i) => ({ ...b, quantity_available: availabilities[i] }))
}

export async function getProductBatch(id: string): Promise<ProductBatchWithAvailability> {
  await requireAdmin()
  if (!UUID_REGEX.test(id)) throw new Error("Невалиден формат на партида")

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("product_batches")
    .select("*")
    .eq("id", id)
    .single()

  if (error || !data) throw new Error("Партидата не е намерена")

  const { data: qty } = await supabase.rpc("batch_quantity_available", { p_batch_id: id })
  return { ...(data as ProductBatch), quantity_available: typeof qty === "number" ? qty : 0 }
}

// ─── Batch allocation lifecycle (admin-driven) ──────────────────────────────
// Allocation is split from shipment generation:
//   1. Admin opens the order detail "Партиди" card (confirmed + no tracking)
//   2. Auto-FEFO seeds the form; admin reviews / overrides; saves
//   3. Admin generates the courier label — the existing rows are now locked
//      by the lifecycle trigger in 20260509120000
//
// The save path goes through `save_batch_allocation` RPC for atomic
// delete+insert under FOR UPDATE locks (orders + product_batches). FEFO
// compliance and expired-batch override are app-validated for friendly
// errors; the RPC is the safety net for sum equality + availability +
// concurrent-save races.

export interface BatchAllocationLine {
  orderItemId: number
  sku: string
  productName: string
  orderedQuantity: number
  allocations: Array<{
    productBatchId: string
    batchNumber: string
    expiryDate: string
    quantity: number
    nonFefoReason: string | null
    expiredOverrideReason: string | null
  }>
}

export interface FefoAutoSuggestion {
  orderItemId: number
  sku: string
  productName: string
  orderedQuantity: number
  allocations: Array<{
    productBatchId: string
    batchNumber: string
    expiryDate: string
    quantity: number
    quantityAvailable: number
  }>
  shortfall: number
}

export interface SaveBatchAllocationRow {
  orderItemId: number
  productBatchId: string
  quantity: number
  nonFefoReason?: string
  allowExpiredOverride?: boolean
  expiredOverrideReason?: string
}

export async function getBatchAllocation(orderId: string): Promise<BatchAllocationLine[]> {
  await requireAdmin()
  if (!UUID_REGEX.test(orderId)) throw new Error("Невалиден формат на поръчка")

  const supabase = await createClient()

  const { data: orderItems, error: itemsError } = await supabase
    .from("order_items")
    .select("id, sku, product_name, quantity")
    .eq("order_id", orderId)
    .order("line_no", { ascending: true })
  if (itemsError || !orderItems) throw new Error("Грешка при зареждане на артикулите")

  const itemIds = orderItems.map((i) => i.id)
  const { data: allocs, error: allocError } = await supabase
    .from("order_item_batches")
    .select("order_item_id, product_batch_id, quantity, non_fefo_reason, expired_override_reason")
    .in("order_item_id", itemIds)
  if (allocError) throw new Error("Грешка при зареждане на разпределенията")

  const referencedBatchIds = Array.from(new Set((allocs ?? []).map((a) => (a as { product_batch_id: string }).product_batch_id)))
  const batchById = new Map<string, { batch_number: string; expiry_date: string }>()
  if (referencedBatchIds.length > 0) {
    const { data: batches } = await supabase
      .from("product_batches")
      .select("id, batch_number, expiry_date")
      .in("id", referencedBatchIds)
    for (const b of batches ?? []) {
      const row = b as { id: string; batch_number: string; expiry_date: string }
      batchById.set(row.id, { batch_number: row.batch_number, expiry_date: row.expiry_date })
    }
  }

  const allocsByItem = new Map<number, Array<{ product_batch_id: string; quantity: number; non_fefo_reason: string | null; expired_override_reason: string | null }>>()
  for (const a of allocs ?? []) {
    const row = a as { order_item_id: number; product_batch_id: string; quantity: number; non_fefo_reason: string | null; expired_override_reason: string | null }
    if (!allocsByItem.has(row.order_item_id)) allocsByItem.set(row.order_item_id, [])
    allocsByItem.get(row.order_item_id)!.push(row)
  }

  return orderItems.map((oi) => {
    const item = oi as { id: number; sku: string; product_name: string; quantity: number }
    const lineAllocs = allocsByItem.get(item.id) ?? []
    return {
      orderItemId: item.id,
      sku: item.sku,
      productName: item.product_name,
      orderedQuantity: item.quantity,
      allocations: lineAllocs.map((a) => {
        const meta = batchById.get(a.product_batch_id)
        return {
          productBatchId: a.product_batch_id,
          batchNumber: meta?.batch_number ?? "?",
          expiryDate: meta?.expiry_date ?? "",
          quantity: a.quantity,
          nonFefoReason: a.non_fefo_reason,
          expiredOverrideReason: a.expired_override_reason,
        }
      }),
    }
  })
}

export interface BatchAllocationViewBatch {
  productBatchId: string
  sku: string
  batchNumber: string
  expiryDate: string
  quantityAvailable: number
  isExpired: boolean
}

export interface BatchAllocationView {
  lines: Array<{
    orderItemId: number
    sku: string
    productName: string
    orderedQuantity: number
    saved: Array<{
      productBatchId: string
      quantity: number
      nonFefoReason: string | null
      expiredOverrideReason: string | null
    }>
  }>
  batches: BatchAllocationViewBatch[]
}

// Single round-trip read for the order-detail "Партиди" card.
// Returns: per-line ordered + saved allocation, plus the full pool of
// active batches (expired included, flagged) for SKUs in the order.
// The client computes the FEFO seed using lib/batches/fefo.ts.
export async function getBatchAllocationView(orderId: string): Promise<BatchAllocationView> {
  await requireAdmin()
  if (!UUID_REGEX.test(orderId)) throw new Error("Невалиден формат на поръчка")

  const supabase = await createClient()

  const { data: orderItems, error: itemsErr } = await supabase
    .from("order_items")
    .select("id, sku, product_name, quantity")
    .eq("order_id", orderId)
    .order("line_no", { ascending: true })
  if (itemsErr || !orderItems) throw new Error("Грешка при зареждане на артикулите")

  const itemIds = orderItems.map((i) => i.id)
  const { data: existingAllocs } = await supabase
    .from("order_item_batches")
    .select("order_item_id, product_batch_id, quantity, non_fefo_reason, expired_override_reason")
    .in("order_item_id", itemIds)

  const allocsByItem = new Map<number, Array<{ product_batch_id: string; quantity: number; non_fefo_reason: string | null; expired_override_reason: string | null }>>()
  for (const a of existingAllocs ?? []) {
    const row = a as { order_item_id: number; product_batch_id: string; quantity: number; non_fefo_reason: string | null; expired_override_reason: string | null }
    if (!allocsByItem.has(row.order_item_id)) allocsByItem.set(row.order_item_id, [])
    allocsByItem.get(row.order_item_id)!.push(row)
  }

  const skus = Array.from(new Set(orderItems.map((i) => i.sku)))
  const { data: rawBatches } = await supabase
    .from("product_batches")
    .select("id, sku, batch_number, expiry_date, status")
    .in("sku", skus)
    .eq("status", "active")
    .order("expiry_date", { ascending: true })

  const todayIso = new Date().toISOString().slice(0, 10)
  const rawBatchRows = (rawBatches ?? []) as Array<{ id: string; sku: string; batch_number: string; expiry_date: string; status: string }>
  const availabilities = await Promise.all(
    rawBatchRows.map((b) => supabase.rpc("batch_quantity_available", { p_batch_id: b.id })),
  )
  const batches: BatchAllocationViewBatch[] = rawBatchRows.map((row, i) => ({
    productBatchId: row.id,
    sku: row.sku,
    batchNumber: row.batch_number,
    expiryDate: row.expiry_date,
    quantityAvailable: typeof availabilities[i].data === "number" ? availabilities[i].data : 0,
    isExpired: row.expiry_date < todayIso,
  }))

  return {
    lines: orderItems.map((oi) => {
      const item = oi as { id: number; sku: string; product_name: string; quantity: number }
      const saved = (allocsByItem.get(item.id) ?? []).map((a) => ({
        productBatchId: a.product_batch_id,
        quantity: a.quantity,
        nonFefoReason: a.non_fefo_reason,
        expiredOverrideReason: a.expired_override_reason,
      }))
      return {
        orderItemId: item.id,
        sku: item.sku,
        productName: item.product_name,
        orderedQuantity: item.quantity,
        saved,
      }
    }),
    batches,
  }
}

export async function autoAllocateFefo(orderId: string): Promise<FefoAutoSuggestion[]> {
  await requireAdmin()
  if (!UUID_REGEX.test(orderId)) throw new Error("Невалиден формат на поръчка")

  const supabase = await createClient()

  const { data: orderItems, error } = await supabase
    .from("order_items")
    .select("id, sku, product_name, quantity")
    .eq("order_id", orderId)
    .order("line_no", { ascending: true })
  if (error || !orderItems) throw new Error("Грешка при зареждане на артикулите")

  const todayIso = new Date().toISOString().slice(0, 10)
  const skus = Array.from(new Set(orderItems.map((i) => i.sku)))
  const { data: batches } = await supabase
    .from("product_batches")
    .select("id, sku, batch_number, expiry_date, created_at")
    .in("sku", skus)
    .eq("status", "active")
    .gte("expiry_date", todayIso)

  const batchesBySku = new Map<string, Array<{ id: string; batch_number: string; expiry_date: string; created_at: string }>>()
  for (const b of batches ?? []) {
    const row = b as { id: string; sku: string; batch_number: string; expiry_date: string; created_at: string }
    if (!batchesBySku.has(row.sku)) batchesBySku.set(row.sku, [])
    batchesBySku.get(row.sku)!.push(row)
  }

  const batchRows = (batches ?? []) as Array<{ id: string }>
  const availResults = await Promise.all(
    batchRows.map((b) => supabase.rpc("batch_quantity_available", { p_batch_id: b.id })),
  )
  const availByBatch = new Map<string, number>(
    batchRows.map((b, i) => [b.id, typeof availResults[i].data === "number" ? availResults[i].data : 0]),
  )

  // Drawdown across lines that share batches (e.g., two lines of the same SKU)
  const drawdown = new Map<string, number>()
  const result: FefoAutoSuggestion[] = []

  for (const item of orderItems) {
    const oi = item as { id: number; sku: string; product_name: string; quantity: number }
    const skuBatches = batchesBySku.get(oi.sku) ?? []
    const batchInput = skuBatches.map((b) => ({
      id: b.id,
      expiryDate: b.expiry_date,
      createdAt: b.created_at,
      availableQty: Math.max(0, (availByBatch.get(b.id) ?? 0) - (drawdown.get(b.id) ?? 0)),
    }))

    const plan = buildExpectedFefoPlan({ orderedQty: oi.quantity, batches: batchInput })

    const allocations: FefoAutoSuggestion["allocations"] = []
    for (const [batchId, qty] of plan.allocations) {
      const batch = skuBatches.find((b) => b.id === batchId)!
      allocations.push({
        productBatchId: batchId,
        batchNumber: batch.batch_number,
        expiryDate: batch.expiry_date,
        quantity: qty,
        quantityAvailable: availByBatch.get(batchId) ?? 0,
      })
      drawdown.set(batchId, (drawdown.get(batchId) ?? 0) + qty)
    }

    result.push({
      orderItemId: oi.id,
      sku: oi.sku,
      productName: oi.product_name,
      orderedQuantity: oi.quantity,
      allocations,
      shortfall: plan.remainingQty,
    })
  }

  return result
}

export async function saveBatchAllocation(
  orderId: string,
  rows: SaveBatchAllocationRow[],
): Promise<{ success: true; saved: number }> {
  await requireAdmin()
  if (!UUID_REGEX.test(orderId)) throw new Error("Невалиден формат на поръчка")
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("Не са предоставени разпределения")
  }

  // Input shape validation
  const seen = new Set<string>()
  for (const r of rows) {
    if (!Number.isInteger(r.orderItemId) || r.orderItemId <= 0) {
      throw new Error("Невалиден артикул в поръчката")
    }
    if (!UUID_REGEX.test(r.productBatchId)) {
      throw new Error("Невалиден формат на партида")
    }
    if (!Number.isInteger(r.quantity) || r.quantity < 1) {
      throw new Error("Количеството трябва да е положително цяло число")
    }
    const key = `${r.orderItemId}-${r.productBatchId}`
    if (seen.has(key)) {
      throw new Error("Дублирано разпределение за един и същ артикул и партида")
    }
    seen.add(key)
    if (r.allowExpiredOverride) {
      const reason = r.expiredOverrideReason?.trim() ?? ""
      if (reason.length < 20 || reason.length > 1000) {
        throw new Error("Партидата е с изтекъл срок. За да продължите, потвърдете отказа от срока и въведете причина (поне 20 символа).")
      }
    } else if (r.expiredOverrideReason) {
      throw new Error("Не може да се запише причина за изтекъл срок без потвърден отказ от срока")
    }
    if (r.nonFefoReason) {
      const reason = r.nonFefoReason.trim()
      if (reason.length < 20 || reason.length > 1000) {
        throw new Error("Причината за отклонение от FEFO трябва да е между 20 и 1000 символа")
      }
    }
  }

  const supabase = await createClient()

  const { data: orderItems, error: itemsError } = await supabase
    .from("order_items")
    .select("id, sku, quantity")
    .eq("order_id", orderId)
    .order("line_no", { ascending: true })
  if (itemsError || !orderItems) throw new Error("Грешка при зареждане на артикулите")

  const itemMap = new Map<number, { id: number; sku: string; quantity: number }>()
  for (const oi of orderItems) {
    itemMap.set(oi.id, oi as { id: number; sku: string; quantity: number })
  }
  for (const r of rows) {
    if (!itemMap.has(r.orderItemId)) {
      throw new Error(`Артикул ${r.orderItemId} не принадлежи на тази поръчка`)
    }
  }

  // Load referenced batches + same-SKU active+non-expired set (for FEFO check)
  const referencedBatchIds = Array.from(new Set(rows.map((r) => r.productBatchId)))
  const skus = Array.from(new Set(orderItems.map((oi) => oi.sku)))
  const { data: skuBatches } = await supabase
    .from("product_batches")
    .select("id, sku, batch_number, expiry_date, created_at, status")
    .in("sku", skus)

  const batchById = new Map<string, { id: string; sku: string; batch_number: string; expiry_date: string; created_at: string; status: string }>()
  for (const b of skuBatches ?? []) {
    const row = b as { id: string; sku: string; batch_number: string; expiry_date: string; created_at: string; status: string }
    batchById.set(row.id, row)
  }
  for (const id of referencedBatchIds) {
    if (!batchById.has(id)) throw new Error(`Партидата ${id} не е намерена`)
  }

  const todayIso = new Date().toISOString().slice(0, 10)

  // Per-row expired-batch override gate
  for (const r of rows) {
    const batch = batchById.get(r.productBatchId)!
    if (batch.expiry_date < todayIso && !r.allowExpiredOverride) {
      throw new Error(`Партида ${batch.batch_number} е с изтекъл срок. За да продължите, потвърдете отказа от срока и въведете причина (поне 20 символа).`)
    }
  }

  // FEFO check needs availability per active+non-expired batch — fetched in parallel.
  const fefoCandidates = Array.from(batchById.values()).filter(
    (b) => b.status === "active" && b.expiry_date >= todayIso,
  )
  const fefoAvailabilities = await Promise.all(
    fefoCandidates.map((b) => supabase.rpc("batch_quantity_available", { p_batch_id: b.id })),
  )
  const fefoBatchesBySku = new Map<string, Array<{ id: string; expiryDate: string; createdAt: string; availableQty: number }>>()
  fefoCandidates.forEach((b, i) => {
    if (!fefoBatchesBySku.has(b.sku)) fefoBatchesBySku.set(b.sku, [])
    fefoBatchesBySku.get(b.sku)!.push({
      id: b.id,
      expiryDate: b.expiry_date,
      createdAt: b.created_at,
      availableQty: typeof fefoAvailabilities[i].data === "number" ? fefoAvailabilities[i].data : 0,
    })
  })

  const rowsByItem = new Map<number, SaveBatchAllocationRow[]>()
  for (const r of rows) {
    if (!rowsByItem.has(r.orderItemId)) rowsByItem.set(r.orderItemId, [])
    rowsByItem.get(r.orderItemId)!.push(r)
  }

  // Per-line: sum equality + FEFO compliance (or non-FEFO reason on at least one row)
  let allLinesCompliant = true
  for (const [orderItemId, lineRows] of rowsByItem) {
    const item = itemMap.get(orderItemId)!
    const total = lineRows.reduce((sum, r) => sum + r.quantity, 0)
    if (total !== item.quantity) {
      throw new Error(`Разпределените количества по партиди не съвпадат с количествата в поръчката (SKU ${item.sku}: разпределени ${total}, поръчани ${item.quantity}).`)
    }

    const expected = buildExpectedFefoPlan({
      orderedQty: item.quantity,
      batches: fefoBatchesBySku.get(item.sku) ?? [],
    }).allocations

    const activeNonExpiredIds = new Set((fefoBatchesBySku.get(item.sku) ?? []).map((b) => b.id))
    const saved = new Map<string, number>()
    for (const r of lineRows) {
      if (activeNonExpiredIds.has(r.productBatchId)) {
        saved.set(r.productBatchId, (saved.get(r.productBatchId) ?? 0) + r.quantity)
      }
    }

    if (!isFefoCompliant(saved, expected)) {
      allLinesCompliant = false
      const hasReason = lineRows.some((r) => r.nonFefoReason && r.nonFefoReason.trim().length >= 20)
      if (!hasReason) {
        throw new Error(`Избрана е партида с по-късен срок при налична по-ранна за SKU ${item.sku}. Моля, въведете причина (поне 20 символа).`)
      }
    }
  }

  // RPC: atomic delete + insert with FOR UPDATE locks + sum/availability re-check
  const { error: rpcError } = await supabase.rpc("save_batch_allocation", {
    p_order_id: orderId,
    p_allocations: rows.map((r) => ({
      order_item_id: r.orderItemId,
      product_batch_id: r.productBatchId,
      quantity: r.quantity,
      non_fefo_reason: r.nonFefoReason ?? null,
      expired_override_reason: r.expiredOverrideReason ?? null,
    })),
  })
  if (rpcError) {
    console.error("save_batch_allocation RPC failed:", sanitizeError(rpcError))
    throw new Error(translateRpcError(rpcError, {
      BATCH_ALLOCATION_LOCKED: "Партидите вече са заключени след генериране на товарителница",
      ORDER_NOT_CONFIRMED: "Поръчката не е в статус „потвърдена\"",
      ORDER_NOT_FOUND: "Поръчката не е намерена",
      BATCH_INSUFFICIENT_AVAILABILITY: "Партидата няма достатъчна наличност",
      BATCH_ALLOCATION_SUM_MISMATCH: "Разпределените количества не съвпадат с поръчаното",
      BATCH_NOT_ACTIVE: "Партидата не е активна",
    }, "Грешка при записване на разпределението"))
  }

  // Audit: one batch_allocation_saved + per-row override events
  const hasExpiredOverride = rows.some((r) => r.allowExpiredOverride === true)
  const payload = {
    order_id: orderId,
    fefo_compliant: allLinesCompliant,
    has_expired_override: hasExpiredOverride,
    items: Array.from(rowsByItem.entries()).map(([orderItemId, lineRows]) => {
      const item = itemMap.get(orderItemId)!
      return {
        order_item_id: orderItemId,
        sku: item.sku,
        ordered_qty: item.quantity,
        allocations: lineRows.map((r) => ({
          product_batch_id: r.productBatchId,
          qty: r.quantity,
          expiry_date: batchById.get(r.productBatchId)!.expiry_date,
        })),
      }
    }),
  }

  const { error: auditErr } = await supabase.rpc("record_order_outcome", {
    p_order_id: orderId,
    p_outcome_type: "batch_allocation_saved",
    p_payload: payload,
    p_actor: "admin",
  })
  if (auditErr) console.error("Failed to emit batch_allocation_saved:", sanitizeError(auditErr))

  // Per-row override events fire in parallel — they're independent and the
  // sequential `await` chain was N round-trips of pure latency. The
  // Supabase query builder is thenable so `await Promise.all(...)` works
  // even though the elements aren't Promise subclasses.
  const overrideCalls: Array<PromiseLike<unknown>> = []
  for (const r of rows) {
    if (r.nonFefoReason && r.nonFefoReason.trim().length >= 20) {
      overrideCalls.push(supabase.rpc("record_order_outcome", {
        p_order_id: orderId,
        p_outcome_type: "batch_allocation_overridden_fefo",
        p_payload: { order_item_id: r.orderItemId, product_batch_id: r.productBatchId, reason: r.nonFefoReason },
        p_actor: "admin",
      }))
    }
    if (r.allowExpiredOverride && r.expiredOverrideReason && r.expiredOverrideReason.trim().length >= 20) {
      overrideCalls.push(supabase.rpc("record_order_outcome", {
        p_order_id: orderId,
        p_outcome_type: "batch_allocation_overridden_expired",
        p_payload: { order_item_id: r.orderItemId, product_batch_id: r.productBatchId, reason: r.expiredOverrideReason },
        p_actor: "admin",
      }))
    }
  }
  if (overrideCalls.length > 0) await Promise.all(overrideCalls)

  revalidateTag("product-batches", "max")
  return { success: true, saved: rows.length }
}

export async function clearBatchAllocation(orderId: string): Promise<{ success: true; cleared: number }> {
  await requireAdmin()
  if (!UUID_REGEX.test(orderId)) throw new Error("Невалиден формат на поръчка")

  const supabase = await createClient()

  const { data: orderItems, error: itemsErr } = await supabase
    .from("order_items").select("id").eq("order_id", orderId)
  if (itemsErr || !orderItems) throw new Error("Грешка при зареждане на артикулите")
  const itemIds = orderItems.map((i) => i.id)
  if (itemIds.length === 0) return { success: true, cleared: 0 }

  const { error: delError, count } = await supabase
    .from("order_item_batches")
    .delete({ count: "exact" })
    .in("order_item_id", itemIds)

  if (delError) {
    console.error("clearBatchAllocation failed:", sanitizeError(delError))
    throw new Error(translateRpcError(delError, {
      BATCH_ALLOCATION_LOCKED: "Партидите вече са заключени след генериране на товарителница",
    }, "Грешка при изчистване на разпределението"))
  }

  if ((count ?? 0) > 0) {
    await supabase.rpc("record_order_outcome", {
      p_order_id: orderId,
      p_outcome_type: "batch_allocation_cleared",
      p_payload: { order_id: orderId, cleared_count: count ?? 0 },
      p_actor: "admin",
    })
  }

  revalidateTag("product-batches", "max")
  return { success: true, cleared: count ?? 0 }
}

// Recall a batch. Forward transition only (active → recalled). DB trigger
// enforces metadata atomicity; we set everything in the same UPDATE.
export async function recallBatch(
  batchId: string,
  reason: string,
): Promise<{ success: true; affectedOrdersCount: number }> {
  await requireAdmin()
  if (!UUID_REGEX.test(batchId)) throw new Error("Невалиден формат на партида")

  const trimmed = reason?.trim()
  if (!trimmed || trimmed.length < 20) {
    throw new Error("Причината за изтегляне трябва да е поне 20 символа")
  }
  if (trimmed.length > 1000) throw new Error("Причината е твърде дълга")

  const supabase = await createClient()
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from("product_batches")
    .update({
      status: "recalled",
      recalled_at: now,
      recalled_by: "admin",
      recall_reason: trimmed,
    })
    .eq("id", batchId)
    .eq("status", "active")  // idempotency guard
    .select("id")

  if (error) {
    console.error("Failed to recall batch:", error)
    throw new Error("Грешка при изтегляне на партидата")
  }
  if (!data || data.length === 0) {
    throw new Error("Партидата не е намерена или вече е изтеглена")
  }

  // Count affected orders for the success response (admin sees the worklist size)
  const { data: affected } = await supabase.rpc("affected_orders_for_batch", { p_batch_id: batchId })
  const affectedOrdersCount = Array.isArray(affected) ? affected.length : 0

  revalidateTag("product-batches", "max")
  return { success: true, affectedOrdersCount }
}

export async function getBatchAffectedOrders(batchId: string): Promise<BatchAffectedOrder[]> {
  await requireAdmin()
  if (!UUID_REGEX.test(batchId)) throw new Error("Невалиден формат на партида")

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("affected_orders_for_batch", { p_batch_id: batchId })
  if (error) {
    console.error("Failed to fetch affected orders:", error)
    throw new Error("Грешка при зареждане на засегнатите поръчки")
  }
  return (data ?? []) as BatchAffectedOrder[]
}
