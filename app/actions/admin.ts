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
    quantity: number
    priceInCents: number
  }>
  needs_invoice: boolean
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
  admin_notes: string | null
  cancellation_reason: string | null
  invoice_egn: string | null
  invoice_sent_at: string | null
  paid_at: string | null
  courier_ppp_ref: string | null
  settlement_ref: string | null
  settlement_amount: number | null
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

  const page = params?.page ?? 0
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

  const page = params?.page ?? 0
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

  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single()

  if (error || !data) {
    throw new Error("Order not found")
  }

  return data
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
  if (newStatus === "delivered") {
    updateData.delivered_at = now
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
    const items = order.items as Array<{ productId: string; quantity: number }>
    for (const item of items) {
      const product = PRODUCTS.find((p) => p.id === item.productId)
      if (!product) {
        console.error(`Cannot restore inventory: unknown productId ${item.productId}`)
        continue
      }
      const { error: restoreErr } = await supabase.rpc("restore_inventory", {
        p_sku: product.sku,
        p_quantity: item.quantity,
        p_order_id: orderId,
      })
      if (restoreErr) {
        console.error(`Failed to restore inventory for ${product.sku} on order ${orderId}:`, restoreErr)
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
  const items = order.items as Array<{ productName: string; quantity: number }>
  const contents = items.map((i) => `${i.productName} x${i.quantity}`).join(", ")
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

export async function updateAdminNotes(orderId: string, notes: string) {
  await requireAdmin()

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(orderId)) throw new Error("Invalid order ID")
  if (notes.length > 5000) throw new Error("Notes too long")

  const supabase = await createClient()
  const { error } = await supabase
    .from("orders")
    .update({ admin_notes: notes.trim() || null })
    .eq("id", orderId)

  if (error) {
    console.error("Failed to update admin notes:", error)
    throw new Error("Failed to update notes")
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
    paidAt?: string
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
  if (data.paidAt) {
    const parsed = new Date(data.paidAt)
    if (isNaN(parsed.getTime())) throw new Error("Невалидна дата на плащане")
    if (parsed > new Date()) throw new Error("Датата на плащане не може да е в бъдещето")
  }

  const supabase = await createClient()

  // Verify order exists and is COD
  const { data: order, error: fetchError } = await supabase
    .from("orders")
    .select("id, payment_method, status, delivered_at")
    .eq("id", orderId)
    .single()

  if (fetchError || !order) throw new Error("Поръчката не е намерена")
  if (order.payment_method !== "cod") throw new Error("Само за поръчки с наложен платеж")

  let paidAtValue: string
  if (data.paidAt) {
    // Date picker gives YYYY-MM-DD — set to 23:59:59 UTC so it sorts after
    // other events (creation, delivery) that happened earlier that day
    const d = new Date(data.paidAt)
    d.setUTCHours(23, 59, 59, 0)
    // Settlement cannot be before delivery
    if (order.delivered_at && d < new Date(order.delivered_at)) {
      throw new Error("Датата на плащане не може да е преди доставката")
    }
    paidAtValue = d.toISOString()
  } else {
    paidAtValue = new Date().toISOString()
  }

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

function sendShippingEmail(order: Record<string, unknown>, trackingNumber: string) {
  if (!process.env.RESEND_API_KEY) return

  const resend = new Resend(process.env.RESEND_API_KEY)
  const deliveryLabel = getDeliveryLabel(order.logistics_partner as string)
  const orderItems = order.items as Array<{
    productName: string
    quantity: number
    priceInCents: number
  }>

  const itemsList = orderItems
    .map((item) => `${item.productName} x ${item.quantity} - ${formatPrice(item.priceInCents * item.quantity)}`)
    .join("\n")

  const econtOfficeLine = order.econt_office_name ? `\nОфис: ${order.econt_office_name}\n${order.econt_office_address || ""}` : ""
  const speedyOfficeLine = order.speedy_office_name ? `\nОфис: ${order.speedy_office_name}\n${order.speedy_office_address || ""}` : ""

  resend.emails.send({
    from: process.env.EMAIL_FROM || "Egg Origin <onboarding@resend.dev>",
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
  before_quantity: number | null
  after_quantity: number | null
  created_at: string
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

export async function addInventoryBatch(data: {
  sku: string
  quantity: number
  batchId: string
  expiryDate: string
  notes: string
}): Promise<{ success: true }> {
  await requireAdmin()

  const validSkus = PRODUCTS.map((p) => p.sku)
  if (!validSkus.includes(data.sku)) throw new Error("Невалиден SKU")
  if (!Number.isInteger(data.quantity) || data.quantity < 1 || data.quantity > 100000) {
    throw new Error("Количеството трябва да е между 1 и 100 000")
  }
  if (!data.batchId?.trim()) throw new Error("Номерът на партидата е задължителен")
  if (data.batchId.length > 100) throw new Error("Номерът на партидата е твърде дълъг")
  if (data.expiryDate && !/^\d{4}-\d{2}-\d{2}$/.test(data.expiryDate)) {
    throw new Error("Невалидна дата на годност")
  }
  if (data.notes && data.notes.length > 500) throw new Error("Бележката е твърде дълга")

  const supabase = await createClient()
  const { error } = await supabase.from("inventory_log").insert({
    sku: data.sku,
    type: "batch_in",
    quantity: data.quantity,
    batch_id: data.batchId.trim(),
    expiry_date: data.expiryDate || null,
    notes: data.notes?.trim() || null,
  })

  if (error) {
    console.error("Failed to insert inventory batch:", error)
    throw new Error("Грешка при добавяне на наличност")
  }

  return { success: true }
}

