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
  awaitingSettlement: number
  inventoryDebtSkus: number
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
    awaitingSettlement: s.awaiting_settlement ?? 0,
    inventoryDebtSkus: s.inventory_debt_skus ?? 0,
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
  needs_invoice: boolean
  invoice_number: string | null
  invoice_date: string | null
  delivered_at: string | null
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
  needs_invoice: boolean
  invoice_type: "individual" | "company" | null
  invoice_company_name: string | null
  invoice_eik: string | null
  invoice_vat_number: string | null
  invoice_mol: string | null
  invoice_address: string | null
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
  invoice_number: string | null
  invoice_date: string | null
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
  invoice_sent_at: string | null
  paid_at: string | null
  courier_ppp_ref: string | null
  settlement_ref: string | null
  settlement_amount: number | null
  refunds: OrderRefund[]
  // Inventory movements of type return_in / damaged for this order, used by
  // the admin UI to show the kредитно-известие breakdown per refund (linked
  // via inventory_log.reference_id = order_refunds.id). No FK relationship
  // exists in the DB (reference_id is polymorphic text), so we fetch
  // separately and match client-side.
  inventoryReturns: OrderInventoryReturn[]
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
  amount_cents: number
  method: "stripe" | "bank_transfer"
  source: "admin_ui" | "stripe_webhook"
  reason: string | null
  credit_note_ref: string | null
  recorded_by: string
  refunded_at: string
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

  const invoiceFilter = params?.invoiceFilter
  if (invoiceFilter === "requested") {
    query = query.eq("needs_invoice", true)
  } else if (invoiceFilter === "issued") {
    query = query.not("invoice_number", "is", null)
  } else if (invoiceFilter === "pending") {
    query = query.eq("needs_invoice", true).is("invoice_number", null)
  }

  const paymentFilter = params?.paymentFilter
  if (paymentFilter === "awaiting-settlement") {
    query = query.eq("payment_method", "cod").eq("status", "delivered").is("paid_at", null)
  } else if (paymentFilter === "settled") {
    query = query.eq("payment_method", "cod").not("paid_at", "is", null)
  }

  return query
}

export async function getOrders(params?: OrderQueryParams & { page?: number }): Promise<{ orders: OrderSummary[]; total: number }> {
  await requireAdmin()
  const supabase = await createClient()

  const page = Math.max(0, Math.floor(Number(params?.page ?? 0)) || 0)
  const from = page * ORDERS_PAGE_SIZE
  const to = from + ORDERS_PAGE_SIZE - 1

  let query = supabase
    .from("orders")
    .select("id, created_at, first_name, last_name, email, phone, city, status, payment_method, total_amount, shipping_fee, cod_fee, discount_amount, logistics_partner, tracking_number, needs_invoice, invoice_number, invoice_date, delivered_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to)

  query = applyOrderFilters(query, params)

  const { data, error, count } = await query

  if (error) {
    console.error("Failed to fetch orders:", error)
    throw new Error("Failed to fetch orders")
  }

  return { orders: data || [], total: count ?? 0 }
}

export async function getAllOrders(params?: OrderQueryParams): Promise<OrderSummary[]> {
  await requireAdmin()
  const supabase = await createClient()

  const results: OrderSummary[] = []
  let from = 0
  const batchSize = 1000

  while (true) {
    let query = supabase
      .from("orders")
      .select("id, created_at, first_name, last_name, email, phone, city, status, payment_method, total_amount, shipping_fee, cod_fee, discount_amount, logistics_partner, tracking_number, needs_invoice, invoice_number, invoice_date, delivered_at")
      .order("created_at", { ascending: false })
      .range(from, from + batchSize - 1)

    query = applyOrderFilters(query, params)

    const { data, error } = await query
    if (error) {
      console.error("Failed to fetch orders:", error)
      throw new Error("Failed to fetch orders")
    }

    results.push(...(data || []))
    if (!data || data.length < batchSize) break
    from += batchSize
  }

  return results
}

export interface InvoiceSummary {
  id: string
  created_at: string
  first_name: string
  last_name: string
  email: string
  total_amount: number
  invoice_number: string
  invoice_date: string
  invoice_company_name: string | null
  invoice_eik: string | null
  needs_invoice: boolean
}

interface InvoiceQueryParams {
  search?: string
  dateFrom?: string
  dateTo?: string
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

  const search = params?.search?.trim().toLowerCase()
  if (search) {
    const escaped = escapeIlike(search)
    if (/^\d+$/.test(search)) {
      query = query.ilike("invoice_number", `%${escaped}%`)
    } else {
      query = query.or(`first_name.ilike.%${escaped}%,last_name.ilike.%${escaped}%,email.ilike.%${escaped}%,invoice_company_name.ilike.%${escaped}%`)
    }
  }

  return query
}

export async function getInvoices(params?: InvoiceQueryParams & { page?: number }): Promise<{ invoices: InvoiceSummary[]; total: number }> {
  await requireAdmin()
  const supabase = await createClient()

  const page = Math.max(0, Math.floor(Number(params?.page ?? 0)) || 0)
  const from = page * ORDERS_PAGE_SIZE
  const to = from + ORDERS_PAGE_SIZE - 1

  let query = supabase
    .from("orders")
    .select("id, created_at, first_name, last_name, email, total_amount, invoice_number, invoice_date, invoice_company_name, invoice_eik, needs_invoice", { count: "exact" })
    .not("invoice_number", "is", null)
    .order("invoice_date", { ascending: false })
    .range(from, to)

  query = applyInvoiceFilters(query, params)

  const { data, error, count } = await query

  if (error) {
    console.error("Failed to fetch invoices:", error)
    throw new Error("Failed to fetch invoices")
  }

  return { invoices: (data || []) as InvoiceSummary[], total: count ?? 0 }
}

export async function getAllInvoices(params?: InvoiceQueryParams): Promise<InvoiceSummary[]> {
  await requireAdmin()
  const supabase = await createClient()

  const results: InvoiceSummary[] = []
  let from = 0
  const batchSize = 1000

  while (true) {
    let query = supabase
      .from("orders")
      .select("id, created_at, first_name, last_name, email, total_amount, invoice_number, invoice_date, invoice_company_name, invoice_eik, needs_invoice")
      .not("invoice_number", "is", null)
      .order("invoice_date", { ascending: false })
      .range(from, from + batchSize - 1)

    query = applyInvoiceFilters(query, params)

    const { data, error } = await query
    if (error) {
      console.error("Failed to fetch invoices:", error)
      throw new Error("Failed to fetch invoices")
    }

    results.push(...((data || []) as InvoiceSummary[]))
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

  const [orderResult, returnsResult] = await Promise.all([
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
          amount_cents,
          method,
          source,
          reason,
          credit_note_ref,
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

  return { ...orderResult.data, inventoryReturns: returns }
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

export async function setInvoiceNumber(orderId: string, invoiceNumber: string): Promise<{ success: true }> {
  await requireAdmin()

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(orderId)) throw new Error("Invalid order ID")

  const trimmed = invoiceNumber.trim()
  if (!trimmed || trimmed.length > 50) throw new Error("Невалиден номер на фактура")

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("orders")
    .update({ invoice_number: trimmed, invoice_date: new Date().toISOString() })
    .eq("id", orderId)
    .is("invoice_number", null)
    .select("id")

  if (error) {
    console.error("Failed to set invoice number:", error)
    throw new Error("Грешка при записване на номер на фактура")
  }

  if (!data || data.length === 0) {
    throw new Error("Поръчката не е намерена или вече има фактура")
  }

  return { success: true }
}

export async function markInvoiceSent(orderId: string): Promise<{ success: true }> {
  await requireAdmin()

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(orderId)) throw new Error("Invalid order ID")

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("orders")
    .update({ invoice_sent_at: new Date().toISOString() })
    .eq("id", orderId)
    .not("invoice_number", "is", null)
    .is("invoice_sent_at", null)
    .select("id")

  if (error) {
    console.error("Failed to mark invoice as sent:", error)
    throw new Error("Грешка при записване")
  }

  if (!data || data.length === 0) {
    throw new Error("Поръчката няма фактура или вече е отбелязана като изпратена")
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

// ─── Refund tracking ─────────────────────────────────────────────────────────
// Refunds live in the order_refunds child table (one row per refund, many per
// order). Idempotency for webhook-originated rows is via UNIQUE
// stripe_refund_id; admin-originated Stripe refunds supply the same ID so
// either arrival order results in exactly one row.
//
// Phase 1 (current): admin issues Stripe refunds in the Stripe dashboard, then
// records them here with the Stripe refund ID. COD refunds are bank-transfer
// only, no gateway ID. The webhook creates rows the admin hasn't recorded yet
// and admin can annotate afterward (reason, credit_note_ref) via
// updateRefundAnnotation.
//
// Phase 2: the admin UI will call stripe.refunds.create() directly and insert
// the row synchronously — same table, same shape, no schema change needed.

export type RefundDisposition = "sellable" | "damaged"

export interface RefundInventoryAdjustment {
  sku: string
  quantity: number
  disposition: RefundDisposition
}

export async function recordRefund(
  orderId: string,
  data: {
    refundAmount: number
    refundReason: string
    refundMethod: "stripe" | "bank_transfer"
    refundedAt?: string
    creditNoteRef?: string
    stripeRefundId?: string
    clientIdempotencyKey: string
    inventoryAdjustments?: RefundInventoryAdjustment[]
  },
): Promise<{ success: true; refundId: string; inventoryMovements: number }> {
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

  // Validate creditNoteRef
  const trimmedCreditNote = data.creditNoteRef?.trim() || null
  if (trimmedCreditNote && trimmedCreditNote.length > 100) {
    throw new Error("Референцията на кредитното известие е твърде дълга")
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

  // Validate inventory adjustments shape (cross-SKU checks happen after we
  // fetch order_items so we can verify SKU membership + quantity bounds).
  const adjustments = data.inventoryAdjustments ?? []
  const seenPairs = new Set<string>()
  for (const adj of adjustments) {
    if (!adj.sku || typeof adj.sku !== "string") {
      throw new Error("SKU е задължителен за движение на склад")
    }
    if (!Number.isInteger(adj.quantity) || adj.quantity < 1) {
      throw new Error(`Количеството за SKU ${adj.sku} трябва да е положително цяло число`)
    }
    if (adj.disposition !== "sellable" && adj.disposition !== "damaged") {
      throw new Error(`Невалидно разпореждане за SKU ${adj.sku}`)
    }
    const key = `${adj.sku}::${adj.disposition}`
    if (seenPairs.has(key)) {
      throw new Error(`Дублиран запис за SKU ${adj.sku} с разпореждане ${adj.disposition}`)
    }
    seenPairs.add(key)
  }

  const supabase = await createClient()

  // Fast-path idempotency: if a refund with this client_idempotency_key
  // exists, this is a retry. Return the existing ID without re-inserting
  // (the inventory inserts below still re-run, but are themselves
  // idempotent via deterministic idempotency_key values).
  const { data: existingRefunds, error: existingError } = await supabase
    .from("order_refunds")
    .select("id, order_id")
    .eq("client_idempotency_key", data.clientIdempotencyKey)
  if (existingError) {
    console.error("Failed to check refund idempotency:", existingError)
    throw new Error("Грешка при проверка на idempotency")
  }

  let refundId: string
  let refundInserted = false

  if (existingRefunds && existingRefunds.length > 0) {
    const existing = existingRefunds[0]
    if (existing.order_id !== orderId) {
      throw new Error("Idempotency key принадлежи на друга поръчка")
    }
    refundId = existing.id
  } else {
    // No existing row — run full validation + insert.
    const { data: order, error: fetchError } = await supabase
      .from("orders")
      .select("id, paid_at, delivered_at, total_amount, needs_invoice, invoice_number, stripe_payment_intent_id")
      .eq("id", orderId)
      .single()

    if (fetchError || !order) throw new Error("Поръчката не е намерена")
    if (!order.paid_at) throw new Error("Не може да се възстанови сума за неплатена поръчка")
    if (data.refundMethod === "stripe" && !order.stripe_payment_intent_id) {
      throw new Error("Поръчката няма Stripe платеж — използвайте банков превод")
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

    // Validate refundedAt not before delivered_at
    if (order.delivered_at && data.refundedAt) {
      const deliveredDate = new Date(order.delivered_at)
      const refundDate = new Date(data.refundedAt)
      if (refundDate < deliveredDate) {
        throw new Error("Датата на възстановяване не може да е преди датата на доставка")
      }
    }

    // Conditional credit_note_ref validation: invoice issued → credit note required
    if (order.needs_invoice && order.invoice_number && !trimmedCreditNote) {
      throw new Error("За поръчка с издадена фактура е необходима референция на кредитно известие")
    }
    // If no invoice was issued, silently drop credit_note_ref (not an error).
    const creditNoteRefForInsert =
      order.needs_invoice && order.invoice_number ? trimmedCreditNote : null

    // Cross-SKU validation for adjustments — fetch order items + prior
    // returns to bound total returned per SKU.
    if (adjustments.length > 0) {
      const { data: orderItems, error: itemsErr } = await supabase
        .from("order_items")
        .select("sku, quantity")
        .eq("order_id", orderId)
      if (itemsErr || !orderItems) {
        console.error("Failed to load order items for adjustment validation:", itemsErr)
        throw new Error("Грешка при проверка на артикулите")
      }
      const orderedBySku = new Map<string, number>()
      for (const item of orderItems) {
        orderedBySku.set(item.sku, (orderedBySku.get(item.sku) ?? 0) + item.quantity)
      }
      for (const adj of adjustments) {
        if (!orderedBySku.has(adj.sku)) {
          throw new Error(`SKU ${adj.sku} не е част от тази поръчка`)
        }
      }

      const { data: priorReturns, error: priorErr } = await supabase
        .from("inventory_log")
        .select("sku, quantity, type")
        .eq("order_id", orderId)
        .in("type", ["return_in", "damaged"])
      if (priorErr) {
        console.error("Failed to load prior returns:", priorErr)
        throw new Error("Грешка при проверка на предишни връщания")
      }
      const priorBySku = new Map<string, number>()
      for (const r of priorReturns ?? []) {
        priorBySku.set(r.sku, (priorBySku.get(r.sku) ?? 0) + (r.quantity as number))
      }

      const thisBatchBySku = new Map<string, number>()
      for (const adj of adjustments) {
        thisBatchBySku.set(adj.sku, (thisBatchBySku.get(adj.sku) ?? 0) + adj.quantity)
      }
      for (const [sku, thisQty] of thisBatchBySku) {
        const ordered = orderedBySku.get(sku) ?? 0
        const prior = priorBySku.get(sku) ?? 0
        if (prior + thisQty > ordered) {
          throw new Error(
            `Не може да се върнат повече бройки от поръчаните за SKU ${sku} (поръчани ${ordered}, вече върнати ${prior}, опит за връщане сега ${thisQty})`,
          )
        }
      }
    }

    const { data: inserted, error: insertError } = await supabase
      .from("order_refunds")
      .insert({
        order_id: orderId,
        stripe_refund_id: trimmedStripeRefundId,
        amount_cents: data.refundAmount,
        method: data.refundMethod,
        source: "admin_ui",
        reason: trimmedReason,
        credit_note_ref: creditNoteRefForInsert,
        recorded_by: "admin",
        refunded_at: refundedAtValue,
        client_idempotency_key: data.clientIdempotencyKey,
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
          refundId = recovered[0].id
        } else {
          // Must have been the stripe_refund_id unique — same Stripe refund
          // already in the table (webhook beat us, or dupe paste).
          throw new Error("Това Stripe възстановяване вече е записано за тази поръчка")
        }
      } else {
        console.error("Failed to record refund:", insertError)
        throw new Error("Грешка при записване на възстановяване")
      }
    } else {
      refundId = inserted!.id
      refundInserted = true
    }
  }

  // Insert inventory movements. Deterministic idempotency_key keeps this
  // safe to re-run on retry: the first run populates, subsequent runs
  // collide (23505) and are treated as no-ops.
  let inventoryMovements = 0
  for (const adj of adjustments) {
    const idempotencyKey = `${data.clientIdempotencyKey}-${adj.sku}-${adj.disposition}`
    const type = adj.disposition === "sellable" ? "return_in" : "damaged"
    // 'damaged' requires non-empty notes (chk_inventory_log_damaged).
    const notes = adj.disposition === "damaged"
      ? `Повреден при връщане (refund ${refundId.slice(0, 8)}): ${trimmedReason}`.slice(0, 500)
      : null

    const { error: invError } = await supabase
      .from("inventory_log")
      .insert({
        sku: adj.sku,
        type,
        quantity: adj.quantity,
        order_id: orderId,
        reference_type: "return",
        reference_id: refundId,
        notes,
        created_by: "admin",
        idempotency_key: idempotencyKey,
      })

    if (invError) {
      if (invError.code === "23505") {
        // Already inserted on a prior attempt — idempotent no-op.
        continue
      }
      // Don't fail the whole operation: the refund is recorded. Admin can
      // reconcile inventory manually if needed. Log so the error surfaces.
      console.error(
        `Failed to insert inventory movement for refund ${refundId} (sku=${adj.sku}, disposition=${adj.disposition}):`,
        invError,
      )
      continue
    }
    inventoryMovements++
  }

  return {
    success: true,
    refundId,
    inventoryMovements: refundInserted ? inventoryMovements : 0,
  }
}

// Admin-annotation edits on existing refund rows (reason, credit_note_ref).
// Typically used to annotate webhook-originated refunds that arrived before
// the admin had a chance to record intent. Does NOT emit an audit event —
// annotations are not money movements.
export async function updateRefundAnnotation(
  refundId: string,
  data: {
    reason?: string
    creditNoteRef?: string
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

  if (data.creditNoteRef !== undefined) {
    const trimmed = data.creditNoteRef.trim()
    if (trimmed.length > 100) {
      throw new Error("Референцията на кредитното известие е твърде дълга")
    }
    updatePayload.credit_note_ref = trimmed || null
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
// The main order status is NOT rewound — per the three-layer design
// (status / refund / inventory + outcome events), post-shipment exceptions
// are recorded alongside the status, not in place of it.
//
// Optional linked actions — when the admin knows upfront that an outcome
// requires money and/or stock movement, the same call can also record a
// refund (which in turn can carry inventoryAdjustments). All three writes
// share the same clientIdempotencyKey so a retry collapses to no-ops:
//   1. refund row (idempotent via client_idempotency_key)
//   2. inventory_log rows (idempotent via deterministic derived keys)
//   3. outcome event (appended even on retry — cheap, harmless; the
//      payload is enriched with the refund_id returned from step 1)
// Outcome-only flows (admin logs delivery_refused but the parcel hasn't
// come back yet) stay supported: omit `refund`, nothing changes.

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
    // Optional linked refund. When provided, a refund row is recorded
    // before the outcome event and its id is included in the outcome
    // payload for cross-reference. inventoryAdjustments ride along on
    // the refund (same wiring as admin-UI refund flow). Required:
    // clientIdempotencyKey (shared across refund + derived inventory keys).
    refund?: {
      refundAmount: number
      refundReason: string
      refundMethod: "stripe" | "bank_transfer"
      refundedAt?: string
      creditNoteRef?: string
      stripeRefundId?: string
      inventoryAdjustments?: RefundInventoryAdjustment[]
    }
    clientIdempotencyKey?: string
  },
): Promise<{ success: true; refundId?: string; inventoryMovements?: number }> {
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

  // If a refund is being recorded alongside, the client must supply the
  // idempotency key up-front — it's shared across refund + inventory writes.
  if (data.refund && !data.clientIdempotencyKey) {
    throw new Error("Липсва idempotency key за възстановяването")
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

  // Step 1: if a refund is requested, record it first. Do it before the
  // outcome event so the outcome payload can reference the refund_id.
  // recordRefund handles its own inventory_log inserts via adjustments.
  // A validation failure inside recordRefund bubbles up before we pollute
  // the audit log with an outcome event referencing a non-existent refund.
  let refundId: string | undefined
  let inventoryMovements: number | undefined
  if (data.refund) {
    const refundResult = await recordRefund(orderId, {
      refundAmount: data.refund.refundAmount,
      refundReason: data.refund.refundReason,
      refundMethod: data.refund.refundMethod,
      refundedAt: data.refund.refundedAt,
      creditNoteRef: data.refund.creditNoteRef,
      stripeRefundId: data.refund.stripeRefundId,
      clientIdempotencyKey: data.clientIdempotencyKey!,
      inventoryAdjustments: data.refund.inventoryAdjustments,
    })
    refundId = refundResult.refundId
    inventoryMovements = refundResult.inventoryMovements
  }

  // Step 2: record the outcome event.
  const payload: Record<string, unknown> = { note: trimmedNote }
  if (courierRef) payload.courier_ref = courierRef
  if (returnRef) payload.return_ref = returnRef
  if (recallRef) payload.recall_ref = recallRef
  if (recallReason) payload.recall_reason = recallReason
  if (data.condition) payload.condition = data.condition
  if (expectedReturnAt) payload.expected_return_at = expectedReturnAt
  if (confirmedLostAt) payload.confirmed_lost_at = confirmedLostAt
  if (receivedAt) payload.received_at = receivedAt
  if (refundId) payload.refund_id = refundId
  if (inventoryMovements !== undefined) payload.inventory_movements_count = inventoryMovements

  const { error: rpcError } = await supabase.rpc("record_order_outcome", {
    p_order_id: orderId,
    p_outcome_type: data.outcomeType,
    p_payload: payload,
    p_actor: "admin",
  })
  if (rpcError) {
    console.error("Failed to record order outcome:", rpcError)
    // The refund (if any) is already persisted — throwing here would leave
    // it orphaned from the outcome event. We still throw so the admin UI
    // surfaces the failure; the refund timeline entry ('refunded' audit
    // event from the AFTER INSERT trigger) documents that money moved.
    throw new Error("Грешка при записване на събитие")
  }

  // Step 3: bridge to the existing timeline until it reads order_audit_events
  // directly. Human-readable summary as an admin note makes the outcome
  // visible immediately, now also noting the linked refund amount.
  const summaryParts: string[] = [OUTCOME_LABELS[data.outcomeType]]
  if (data.outcomeType === "returned" && data.condition) {
    summaryParts.push(data.condition === "sellable" ? "годно" : "негодно")
  }
  if (returnRef) summaryParts.push(`реф. ${returnRef}`)
  if (recallRef) summaryParts.push(`реф. ${recallRef}`)
  if (courierRef) summaryParts.push(`куриер ${courierRef}`)
  if (data.refund) {
    summaryParts.push(`възст. ${(data.refund.refundAmount / 100).toFixed(2)} лв`)
  }
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

  return { success: true, refundId, inventoryMovements }
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

  // Check price history
  const { data: history } = await supabase
    .from("product_price_history")
    .select("price_in_cents")
    .eq("product_id", productId)
    .gte("recorded_at", thirtyDaysAgo)
    .order("price_in_cents", { ascending: true })
    .limit(1)

  // Check past sale prices
  const { data: pastSales } = await supabase
    .from("product_sales")
    .select("sale_price_in_cents")
    .eq("product_id", productId)
    .gte("created_at", thirtyDaysAgo)
    .order("sale_price_in_cents", { ascending: true })
    .limit(1)

  const basePrice = baseProduct.priceInCents
  const historyMin = history?.[0]?.price_in_cents ?? Infinity
  const saleMin = pastSales?.[0]?.sale_price_in_cents ?? Infinity

  return Math.min(basePrice, historyMin, saleMin)
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

  // Record current base price in history for future Omnibus calculations
  await supabase.from("product_price_history").insert({
    product_id: data.productId,
    price_in_cents: product.priceInCents,
  })

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

  // Validate orderId — only for return_in
  if (data.orderId && data.type !== "return_in") {
    throw new Error("Поръчка може да се свърже само при връщане")
  }
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (data.orderId && !uuidRegex.test(data.orderId)) {
    throw new Error("Невалиден формат на поръчка")
  }

  const supabase = await createClient()
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

