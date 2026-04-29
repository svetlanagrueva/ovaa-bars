"use server"

import { createAdminSession, validateAdminSession, destroyAdminSession } from "@/lib/admin-auth"
import { createClient } from "@/lib/supabase/server"
import { PRODUCTS, formatPrice } from "@/lib/products"
import { revalidateTag } from "next/cache"
import { getDeliveryLabel } from "@/lib/delivery"
import { Resend } from "resend"
import { redirect } from "next/navigation"
import { createHmac, timingSafeEqual } from "crypto"
import { headers } from "next/headers"
import { createShipment as createSpeedyShipment } from "@/lib/speedy"
import { createShipment as createEcontShipment } from "@/lib/econt"
import { confirmDeliveryForOrder } from "@/lib/delivery-confirmation"
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
  today: { orders: number; revenue: number }
  week: { orders: number; revenue: number }
  month: { orders: number; revenue: number }
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
    today: { orders: s.today_orders ?? 0, revenue: s.today_revenue ?? 0 },
    week: { orders: s.week_orders ?? 0, revenue: s.week_revenue ?? 0 },
    month: { orders: s.month_orders ?? 0, revenue: s.month_revenue ?? 0 },
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
  delivered_at: string | null
  // Surfaced from joined invoices row of type='invoice' (one per order at most).
  // Kept on the summary row for quick filtering / list display; the full
  // OrderDetail.invoices array carries credit_note rows too.
  invoice: OrderInvoiceSummary | null
}

export interface OrderInvoiceSummary {
  invoice_number: string | null
  invoice_date: string | null
}

export interface OrderDetail extends OrderSummary {
  address: string
  postal_code: string
  notes: string
  items: Array<{
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
  paid_at: string | null
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
  // via inventory_log.reference_id = order_refunds.id). No FK relationship
  // exists in the DB (reference_id is polymorphic text), so we fetch
  // separately and match client-side.
  inventoryReturns: OrderInventoryReturn[]
  // Domain events from order_audit_events that aren't already represented
  // by column-derived rows in the timeline (status changes, paid_at,
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
    query = query.eq("payment_method", "cod").eq("status", "delivered").is("paid_at", null)
  } else if (paymentFilter === "settled") {
    query = query.eq("payment_method", "cod").not("paid_at", "is", null)
  }

  return query
}

// Resolve an invoice filter (`requested` | `issued` | `pending`) to the set of
// order_ids whose type='invoice' row matches. Returned to the caller so it
// can attach `.in("id", ...)` to the orders query (PostgREST can't filter a
// parent table by an embedded resource's column directly without changing
// join semantics, so we resolve the id list in a separate query).
//
// Returns null when no filter is applied (caller should skip the .in()).
async function resolveInvoiceFilterOrderIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  invoiceFilter: string | undefined,
): Promise<string[] | null> {
  if (!invoiceFilter || invoiceFilter === "all") return null

  let invQuery: any = supabase.from("invoices").select("order_id").eq("type", "invoice")
  if (invoiceFilter === "issued") {
    invQuery = invQuery.not("invoice_number", "is", null)
  } else if (invoiceFilter === "pending") {
    invQuery = invQuery.is("invoice_number", null)
  }
  // "requested" → just type='invoice', no further filter

  const { data, error } = await invQuery
  if (error) {
    console.error("Failed to resolve invoice filter:", error)
    return []
  }
  return (data ?? []).map((r: { order_id: string }) => r.order_id)
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
      "id, created_at, first_name, last_name, email, phone, city, status, payment_method, total_amount, shipping_fee, cod_fee, discount_amount, logistics_partner, tracking_number, delivered_at, invoices(type, invoice_number, invoice_date)",
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
    return { ...rest, invoice: pickInitialInvoice(invoices) }
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
        "id, created_at, first_name, last_name, email, phone, city, status, payment_method, total_amount, shipping_fee, cod_fee, discount_amount, logistics_partner, tracking_number, delivered_at, invoices(type, invoice_number, invoice_date)",
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
      return { ...rest, invoice: pickInitialInvoice(invoices) }
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

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(orderId)) {
    throw new Error("Invalid order ID")
  }

  const supabase = await createClient()

  // Allowlist of audit event types to surface in the timeline. Events
  // already covered by column-derived rows in the UI (status_changed,
  // paid_at_recorded, shipped_at_recorded, etc.) are intentionally
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
          productId:product_id,
          productName:product_name,
          sku,
          quantity,
          priceInCents:unit_price_cents,
          cancelledQuantity:cancelled_quantity,
          lineNo:line_no
        ),
        refunds:order_refunds(
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
          updated_at
        )
      `)
      .eq("id", orderId)
      .order("refunded_at", { foreignTable: "order_refunds", ascending: false })
      .single(),
    // inventory_log has no FK to order_refunds (reference_id is polymorphic
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

  return {
    ...orderResult.data,
    invoice: invoiceSummary,
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

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(orderId)) {
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

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(orderId)) throw new Error("Invalid order ID")

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

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(orderId)) throw new Error("Invalid order ID")
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

export async function addAdminNote(orderId: string, note: string) {
  await requireAdmin()

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(orderId)) throw new Error("Invalid order ID")

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
    if (error.message?.includes("not found")) {
      throw new Error("Поръчката не е намерена")
    }
    console.error("Failed to add admin note:", error)
    throw new Error("Грешка при добавяне на бележка")
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

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(invoiceId)) throw new Error("Invalid invoice ID")

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

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(invoiceId)) throw new Error("Invalid invoice ID")

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
    paidAt: string
  },
): Promise<{ success: true }> {
  await requireAdmin()

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(orderId)) throw new Error("Invalid order ID")

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
  if (!data.paidAt || !data.paidAt.trim()) {
    throw new Error("Датата на плащане е задължителна")
  }
  const parsed = new Date(data.paidAt)
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
  const paidDate = new Date(data.paidAt)
  paidDate.setUTCHours(23, 59, 59, 0)
  if (order.delivered_at && paidDate < new Date(order.delivered_at)) {
    throw new Error("Датата на плащане не може да е преди доставката")
  }
  const paidAtValue = paidDate.toISOString()

  const updateData: Record<string, unknown> = {
    paid_at: paidAtValue,
  }
  if (data.courierPppRef) updateData.courier_ppp_ref = data.courierPppRef.trim()
  if (data.settlementRef) updateData.settlement_ref = data.settlementRef.trim()
  if (data.settlementAmount !== undefined) updateData.settlement_amount = data.settlementAmount

  const { data: updated, error } = await supabase
    .from("orders")
    .update(updateData)
    .eq("id", orderId)
    .is("paid_at", null)
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

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(orderId)) throw new Error("Invalid order ID")

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

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(orderId)) throw new Error("Invalid order ID")

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

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(orderId)) throw new Error("Invalid order ID")

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

export async function resendOrderConfirmationEmail(
  orderId: string,
): Promise<{ success: true }> {
  await requireAdmin()

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(orderId)) throw new Error("Invalid order ID")

  const supabase = await createClient()
  const { data: order, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single()

  if (error || !order) throw new Error("Поръчката не е намерена")

  // Don't resend for pending orders — they haven't been confirmed yet, so the
  // "order confirmation" wording would be wrong (no receipt URL for card,
  // no COD acceptance).
  if (order.status === "pending") {
    throw new Error("Потвърждение на поръчка се изпраща след потвърждение на плащането")
  }
  if (order.status === "cancelled" || order.status === "expired") {
    throw new Error(
      `Не може да се изпрати потвърждение за ${order.status === "cancelled" ? "отказана" : "изтекла"} поръчка`,
    )
  }

  await sendOrderConfirmationEmail(order as Record<string, unknown>)
  await emitEmailResentAudit(supabase, orderId, "order_confirmation")

  return { success: true }
}

export async function resendShippingEmail(
  orderId: string,
): Promise<{ success: true }> {
  await requireAdmin()

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(orderId)) throw new Error("Invalid order ID")

  const supabase = await createClient()
  const { data: order, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single()

  if (error || !order) throw new Error("Поръчката не е намерена")

  // Shipping email is only meaningful once a tracking number is assigned.
  // status='shipped' implies tracking_number was set (generate-shipment
  // atomically moves the status), but the placeholder value is a distinct
  // not-yet-ready state — rare edge case, refuse it explicitly.
  if (!order.tracking_number || order.tracking_number === "__generating__") {
    throw new Error("Пратката още не е генерирана — няма номер за изпращане")
  }

  await sendShippingEmail(order as Record<string, unknown>, order.tracking_number as string)
  await emitEmailResentAudit(supabase, orderId, "shipping")

  return { success: true }
}

export async function resendDeliveryEmail(
  orderId: string,
): Promise<{ success: true }> {
  await requireAdmin()

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(orderId)) throw new Error("Invalid order ID")

  const supabase = await createClient()
  const { data: order, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single()

  if (error || !order) throw new Error("Поръчката не е намерена")

  if (order.status !== "delivered") {
    throw new Error(
      `Потвърждение за доставка се изпраща само за доставени поръчки (текущ статус: ${order.status})`,
    )
  }

  // force: true bypasses the delivery_email_sent_at early-return so the email
  // actually fires. The timestamp update inside sendDeliveryEmail keeps its
  // .is(..., null) guard, so the original first-sent time is preserved.
  await sendDeliveryEmail(order as Record<string, unknown>, { force: true })
  await emitEmailResentAudit(supabase, orderId, "delivery")

  return { success: true }
}

// ─── Refund tracking ─────────────────────────────────────────────────────────
// Refunds live in the order_refunds child table (one row per refund, many per
// order). Single-responsibility: recordRefund writes ONLY to order_refunds.
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
  },
): Promise<{ success: true; refundId: string; creditNoteId: string | null }> {
  await requireAdmin()

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(orderId)) throw new Error("Невалиден формат на поръчка")
  if (!uuidRegex.test(data.clientIdempotencyKey)) {
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
    .from("order_refunds")
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
    .select("id, paid_at, delivered_at, total_amount, stripe_payment_intent_id")
    .eq("id", orderId)
    .single()

  if (fetchError || !order) throw new Error("Поръчката не е намерена")
  if (!order.paid_at) throw new Error("Не може да се възстанови сума за неплатена поръчка")
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
    .from("order_refunds")
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
    if (!uuidRegex.test(withdrawalIdForLink)) {
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

  const { data: inserted, error: insertError } = await supabase
    .from("order_refunds")
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
        .from("order_refunds")
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
// Mutable fields on order_refunds: reason, bank_transfer_ref,
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

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(refundId)) throw new Error("Невалиден формат на възстановяване")

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
    .from("order_refunds")
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

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(orderId)) throw new Error("Невалиден формат на поръчка")

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

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(orderId)) throw new Error("Невалиден формат на поръчка")

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

export async function getOrderComplaints(orderId: string): Promise<Complaint[]> {
  await requireAdmin()

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(orderId)) throw new Error("Невалиден формат на поръчка")

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
    if (error.message?.includes("refund_id is required")) {
      throw new Error("За резолюция от тип 'refund' първо запишете възстановяване")
    }
    throw new Error("Заявката не може да бъде завършена в текущото състояние")
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
    paid_at: string | null
    delivered_at: string | null
  }
}

export async function getWithdrawal(withdrawalId: string): Promise<WithdrawalWithOrderContext> {
  await requireAdmin()
  if (!UUID_REGEX.test(withdrawalId)) throw new Error("Невалиден формат на заявка")

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("withdrawals")
    .select("*, order:orders(status, payment_method, paid_at, delivered_at)")
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
  if (!process.env.RESEND_API_KEY) return

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

  const resend = new Resend(process.env.RESEND_API_KEY)
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

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(saleId)) throw new Error("Invalid sale ID")

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

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(promoId)) throw new Error("Invalid promo code ID")

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

  // Validate batchId/expiryDate — only for return_in
  if (data.batchId && data.type !== "return_in") {
    throw new Error("Номер на партида е допустим само за връщане")
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
  if (data.orderId && data.type !== "return_in" && data.type !== "damaged") {
    throw new Error("Поръчка може да се свърже само при връщане или брак след връщане")
  }
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (data.orderId && !uuidRegex.test(data.orderId)) {
    throw new Error("Невалиден формат на поръчка")
  }

  const supabase = await createClient()

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
    data.orderId &&
    data.referenceType === "return" &&
    (data.type === "return_in" || data.type === "damaged")

  if (isOrderReturn) {
    const { data: orderItems, error: itemsErr } = await supabase
      .from("order_items")
      .select("sku, quantity")
      .eq("order_id", data.orderId!)
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
      .eq("order_id", data.orderId!)
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
    order_id: data.orderId || null,
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
