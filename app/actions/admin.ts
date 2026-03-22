"use server"

import { createAdminSession, validateAdminSession, destroyAdminSession } from "@/lib/admin-auth"
import { createClient } from "@/lib/supabase/server"
import { PRODUCTS, formatPrice } from "@/lib/products"
import { revalidateTag } from "next/cache"
import { getDeliveryLabel } from "@/lib/delivery"
import { getNextInvoiceNumber } from "@/lib/invoice"
import { generateInvoicePDF } from "@/lib/invoice-pdf"
import { sendInvoiceEmail } from "@/lib/invoice-email"
import { getSellerConfig } from "@/lib/seller"
import { Resend } from "resend"
import { redirect } from "next/navigation"
import { createHmac, timingSafeEqual } from "crypto"
import { headers } from "next/headers"

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
  redirect("/admin/orders")
}

export async function logoutAdmin() {
  await destroyAdminSession()
  redirect("/admin/login")
}

async function requireAdmin() {
  const valid = await validateAdminSession()
  if (!valid) throw new Error("Unauthorized")
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
  delivered_at: string | null
  cancellation_reason: string | null
  invoice_egn: string | null
}

interface OrderQueryParams {
  status?: string
  search?: string
  dateFrom?: string
  dateTo?: string
  invoiceFilter?: string
}

const ORDERS_PAGE_SIZE = 100

function escapeIlike(value: string): string {
  return value.replace(/%/g, "\\%").replace(/_/g, "\\_")
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyOrderFilters(query: any, params?: OrderQueryParams) {
  const status = params?.status
  if (status && status !== "all") {
    query = query.eq("status", status)
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
    .select("id, created_at, first_name, last_name, email, phone, city, status, payment_method, total_amount, logistics_partner, tracking_number, needs_invoice, invoice_number, invoice_date, delivered_at", { count: "exact" })
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
      .select("id, created_at, first_name, last_name, email, phone, city, status, payment_method, total_amount, logistics_partner, tracking_number, needs_invoice, invoice_number, invoice_date, delivered_at")
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  const updateData: Record<string, unknown> = { status: newStatus }
  if (newStatus === "shipped" && trackingNumber) {
    updateData.tracking_number = trackingNumber.trim()
  }
  if (newStatus === "delivered") {
    updateData.delivered_at = new Date().toISOString()
  }
  if (newStatus === "cancelled" && cancellationReason) {
    updateData.cancellation_reason = cancellationReason.trim()
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

  // Send shipping notification email
  if (newStatus === "shipped") {
    sendShippingEmail(order, trackingNumber!.trim())
  }

  // Generate invoice for COD orders with company data, on delivery (tax event = payment)
  if (newStatus === "delivered" && order.payment_method === "cod" && order.needs_invoice && order.invoice_eik && !order.invoice_number) {
    try {
      const invoiceNumber = await getNextInvoiceNumber()
      const seller = getSellerConfig()
      const pdfBuffer = await generateInvoicePDF({
        type: "invoice",
        invoiceNumber,
        invoiceDate: new Date(),
        order,
        seller,
      })

      await supabase
        .from("orders")
        .update({
          invoice_number: invoiceNumber,
          invoice_date: new Date().toISOString(),
        })
        .eq("id", orderId)

      sendInvoiceEmail({
        to: order.email as string,
        firstName: order.first_name as string,
        orderId: order.id as string,
        invoiceNumber,
        type: "invoice",
        pdfBuffer,
      })
    } catch (invoiceError) {
      console.error("Failed to generate invoice for COD delivery:", invoiceError)
    }
  }

  return { success: true }
}

export async function issueInvoice(orderId: string): Promise<{ invoiceNumber: string }> {
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
  if (order.invoice_number) throw new Error("Фактура вече е издадена за тази поръчка")

  const invoiceNumber = await getNextInvoiceNumber()
  const invoiceDate = new Date()
  const seller = getSellerConfig()

  const pdfBuffer = await generateInvoicePDF({
    type: "invoice",
    invoiceNumber,
    invoiceDate,
    order,
    seller,
  })

  const { data: updated, error: updateError } = await supabase
    .from("orders")
    .update({
      invoice_number: invoiceNumber,
      invoice_date: invoiceDate.toISOString(),
    })
    .eq("id", orderId)
    .is("invoice_number", null)
    .select("id")

  if (updateError) {
    console.error("Failed to save invoice:", updateError)
    throw new Error("Failed to save invoice")
  }

  if (!updated || updated.length === 0) {
    throw new Error("Фактура вече е издадена за тази поръчка")
  }

  // Send invoice email to customer
  sendInvoiceEmail({
    to: order.email,
    firstName: order.first_name,
    orderId: order.id,
    invoiceNumber,
    type: "invoice",
    pdfBuffer,
  })

  return { invoiceNumber }
}

export async function downloadInvoicePDF(orderId: string): Promise<{ pdfBase64: string; filename: string }> {
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

  const seller = getSellerConfig()
  const hasInvoice = !!order.invoice_number
  const invoiceNumber = order.invoice_number || `PRF-${order.id.slice(0, 8).toUpperCase()}`
  const type = hasInvoice ? "invoice" as const : "proforma" as const

  const pdfBuffer = await generateInvoicePDF({
    type,
    invoiceNumber,
    invoiceDate: order.invoice_date ? new Date(order.invoice_date) : new Date(order.created_at),
    order,
    seller,
  })

  const filename = hasInvoice
    ? `faktura-${invoiceNumber}.pdf`
    : `proforma-${order.id.slice(0, 8)}.pdf`

  return { pdfBase64: pdfBuffer.toString("base64"), filename }
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
  }).catch(() => {
    // Non-blocking
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

