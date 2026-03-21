"use server"

import { createAdminSession, validateAdminSession, destroyAdminSession } from "@/lib/admin-auth"
import { createClient } from "@/lib/supabase/server"
import { formatPrice } from "@/lib/products"
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
}

export async function getOrders(status?: string): Promise<OrderSummary[]> {
  await requireAdmin()
  const supabase = await createClient()

  let query = supabase
    .from("orders")
    .select("id, created_at, first_name, last_name, email, phone, city, status, payment_method, total_amount, logistics_partner, tracking_number")
    .order("created_at", { ascending: false })

  if (status && status !== "all") {
    query = query.eq("status", status)
  }

  const { data, error } = await query

  if (error) {
    console.error("Failed to fetch orders:", error)
    throw new Error("Failed to fetch orders")
  }

  return data || []
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
) {
  await requireAdmin()

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(orderId)) {
    throw new Error("Invalid order ID")
  }

  if (newStatus === "shipped" && (!trackingNumber || trackingNumber.trim().length === 0)) {
    throw new Error("Tracking number is required for shipping")
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
    from: process.env.EMAIL_FROM || "Ovva Sculpt <onboarding@resend.dev>",
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
Екипът на Ovva Sculpt
    `.trim(),
  }).catch(() => {
    // Non-blocking
  })
}
