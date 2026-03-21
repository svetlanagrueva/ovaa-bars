"use server"

import { headers } from "next/headers"
import { stripe } from "@/lib/stripe"
import { createClient } from "@/lib/supabase/server"
import { PRODUCTS, formatPrice } from "@/lib/products"
import { getProductsWithSales } from "@/lib/sales"
import { Resend } from "resend"
import { COD_FEE, MAX_QUANTITY, calculateShippingPrice } from "@/lib/constants"
import { getDeliveryLabel, getCarrierName } from "@/lib/delivery"

interface CartItem {
  productId: string
  quantity: number
}

interface CustomerInfo {
  firstName: string
  lastName: string
  email: string
  phone: string
  city: string
  address: string
  postalCode: string
  notes: string
}

interface InvoiceInfo {
  companyName: string
  eik: string
  vatNumber: string
  mol: string
  invoiceAddress: string
}

interface EcontOfficeData {
  id: number
  name: string
  city: string
  fullAddress: string
}

interface SpeedyOfficeData {
  id: number
  name: string
  city: string
  fullAddress: string
}

interface CheckoutData {
  cartItems: CartItem[]
  customerInfo: CustomerInfo
  deliveryMethod: string
  needsInvoice?: boolean
  invoiceInfo?: InvoiceInfo
  econtOffice?: EcontOfficeData
  speedyOffice?: SpeedyOfficeData
  promoCode?: string
}

interface CODOrderData {
  cartItems: CartItem[]
  customerInfo: CustomerInfo
  deliveryMethod: string
  needsInvoice?: boolean
  invoiceInfo?: InvoiceInfo
  econtOffice?: EcontOfficeData
  speedyOffice?: SpeedyOfficeData
  promoCode?: string
}

const NEXT_PUBLIC_ECONT_ENABLED = process.env.NEXT_PUBLIC_ECONT_ENABLED !== "false" // on by default
const NEXT_PUBLIC_SPEEDY_ENABLED = process.env.NEXT_PUBLIC_SPEEDY_ENABLED !== "false" // on by default
const VALID_DELIVERY_METHODS = [
  ...(NEXT_PUBLIC_SPEEDY_ENABLED ? ["speedy-office", "speedy-address"] : []),
  ...(NEXT_PUBLIC_ECONT_ENABLED ? ["econt-office", "econt-address"] : []),
]
const MAX_FIELD_LENGTH = 500
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_REGEX = /^\+?[\d\s\-()]{6,20}$/

// Simple in-memory rate limiter for COD orders (per IP)
const codRateLimit = new Map<string, number[]>()
const COD_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000 // 1 hour
const COD_RATE_LIMIT_MAX = 3 // max 3 COD orders per IP per hour

function checkCODRateLimit(ip: string) {
  const now = Date.now()
  const timestamps = (codRateLimit.get(ip) || []).filter(
    (t) => now - t < COD_RATE_LIMIT_WINDOW_MS
  )
  if (timestamps.length >= COD_RATE_LIMIT_MAX) {
    throw new Error("Too many orders. Please try again later.")
  }
  timestamps.push(now)
  codRateLimit.set(ip, timestamps)

  // Periodically purge stale entries to prevent memory leak
  if (codRateLimit.size > 1000) {
    for (const [key, ts] of codRateLimit) {
      const active = ts.filter((t) => now - t < COD_RATE_LIMIT_WINDOW_MS)
      if (active.length === 0) codRateLimit.delete(key)
      else codRateLimit.set(key, active)
    }
  }
}

function validateDeliveryMethod(method: string): string {
  if (!VALID_DELIVERY_METHODS.includes(method)) {
    throw new Error("Invalid delivery method")
  }
  return method
}

function validateAddressForDelivery(deliveryMethod: string, address: string) {
  if ((deliveryMethod === "speedy-address" || deliveryMethod === "econt-address") && (!address || address.trim().length === 0)) {
    throw new Error("Address is required for address delivery")
  }
}

function validateCustomerInfo(info: CustomerInfo) {
  const required: Array<[string, string]> = [
    [info.firstName, "First name"],
    [info.lastName, "Last name"],
    [info.email, "Email"],
    [info.phone, "Phone"],
    [info.city, "City"],
  ]

  for (const [value, label] of required) {
    if (!value || value.trim().length === 0) {
      throw new Error(`${label} is required`)
    }
  }

  if (!EMAIL_REGEX.test(info.email)) {
    throw new Error("Invalid email format")
  }

  if (!PHONE_REGEX.test(info.phone)) {
    throw new Error("Invalid phone format")
  }

  // Enforce length limits on all string fields
  const fields: Array<[string, string]> = [
    [info.firstName, "First name"],
    [info.lastName, "Last name"],
    [info.email, "Email"],
    [info.phone, "Phone"],
    [info.city, "City"],
    [info.address, "Address"],
    [info.postalCode, "Postal code"],
    [info.notes, "Notes"],
  ]

  for (const [value, label] of fields) {
    if (value && value.length > MAX_FIELD_LENGTH) {
      throw new Error(`${label} is too long`)
    }
  }
}

async function validateCartItems(cartItems: CartItem[]) {
  if (!Array.isArray(cartItems) || cartItems.length === 0) {
    throw new Error("Cart is empty")
  }

  // Deduplicate by productId — sum quantities for duplicates
  const deduped = new Map<string, number>()
  for (const item of cartItems) {
    const qty = deduped.get(item.productId) || 0
    deduped.set(item.productId, qty + item.quantity)
  }

  // Fetch all sale-aware prices in a single DB call
  const allProducts = await getProductsWithSales()
  const productMap = new Map(allProducts.map((p) => [p.id, p]))

  return Array.from(deduped.entries()).map(([productId, quantity]) => {
    const product = productMap.get(productId)
    if (!product) {
      throw new Error(`Product not found: ${productId}`)
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      throw new Error(`Invalid quantity for ${product.name}: ${quantity}`)
    }
    return {
      product,
      productId,
      productName: product.name,
      quantity,
      priceInCents: product.priceInCents,
    }
  })
}

function calculateDiscount(
  discountType: string,
  discountValue: number,
  subtotal: number,
): number {
  if (discountType === "percentage") {
    return Math.round(subtotal * discountValue / 100)
  }
  // Fixed: cap at subtotal so discount never exceeds product cost
  return Math.min(discountValue, subtotal)
}

// Rate limit promo validation per IP
const promoRateLimit = new Map<string, number[]>()
const PROMO_RATE_LIMIT_WINDOW_MS = 60 * 1000
const PROMO_RATE_LIMIT_MAX = 10

export async function validatePromoCode(code: string, subtotalInCents: number) {
  if (!code || !code.trim()) {
    return { valid: false as const, error: "Въведете промо код" }
  }

  // Rate limit by IP
  const headerStore = await headers()
  const ip = headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  const now = Date.now()
  const timestamps = (promoRateLimit.get(ip) || []).filter((t) => now - t < PROMO_RATE_LIMIT_WINDOW_MS)
  if (timestamps.length >= PROMO_RATE_LIMIT_MAX) {
    return { valid: false as const, error: "Твърде много опити. Опитайте по-късно." }
  }
  timestamps.push(now)
  promoRateLimit.set(ip, timestamps)

  const supabase = await createClient()
  const nowISO = new Date().toISOString()

  const { data: promo, error } = await supabase
    .from("promo_codes")
    .select("*")
    .eq("code", code.trim().toUpperCase())
    .eq("is_active", true)
    .lte("starts_at", nowISO)
    .single()

  if (error || !promo) {
    return { valid: false as const, error: "Невалиден промо код" }
  }

  // Use generic error for expired/exhausted to prevent code enumeration
  if (promo.ends_at && new Date(promo.ends_at) <= new Date()) {
    return { valid: false as const, error: "Невалиден промо код" }
  }

  if (promo.max_uses !== null && promo.current_uses >= promo.max_uses) {
    return { valid: false as const, error: "Невалиден промо код" }
  }

  if (subtotalInCents < promo.min_order_amount) {
    return {
      valid: false as const,
      error: `Минимална поръчка: ${formatPrice(promo.min_order_amount)}`,
    }
  }

  const discountAmount = calculateDiscount(promo.discount_type, promo.discount_value, subtotalInCents)

  return {
    valid: true as const,
    code: promo.code as string,
    discountType: promo.discount_type as string,
    discountValue: promo.discount_value as number,
    discountAmount,
  }
}

async function applyAndValidatePromo(
  promoCode: string | undefined,
  subtotalInCents: number,
): Promise<{ code: string; discountAmount: number } | null> {
  if (!promoCode?.trim()) return null

  const supabase = await createClient()
  const now = new Date().toISOString()

  // Atomic: fetch, validate, and increment in one query
  // Only increment if still active, within dates, and under max_uses
  const { data: promo, error } = await supabase
    .from("promo_codes")
    .select("*")
    .eq("code", promoCode.trim().toUpperCase())
    .eq("is_active", true)
    .lte("starts_at", now)
    .single()

  if (error || !promo) {
    throw new Error("Невалиден промо код")
  }

  if (promo.ends_at && new Date(promo.ends_at) <= new Date()) {
    throw new Error("Промо кодът е изтекъл")
  }

  if (promo.max_uses !== null && promo.current_uses >= promo.max_uses) {
    throw new Error("Промо кодът е изчерпан")
  }

  if (subtotalInCents < promo.min_order_amount) {
    throw new Error(`Минимална поръчка: ${formatPrice(promo.min_order_amount)}`)
  }

  // Atomic increment with max_uses guard — prevents race condition
  const incrementFilter = supabase
    .from("promo_codes")
    .update({ current_uses: promo.current_uses + 1 })
    .eq("id", promo.id)
    .eq("current_uses", promo.current_uses) // optimistic lock

  if (promo.max_uses !== null) {
    incrementFilter.lt("current_uses", promo.max_uses)
  }

  const { data: updated } = await incrementFilter.select("id")

  if (!updated || updated.length === 0) {
    throw new Error("Промо кодът е изчерпан")
  }

  const discountAmount = calculateDiscount(promo.discount_type, promo.discount_value, subtotalInCents)

  return { code: promo.code, discountAmount }
}

function validateOfficeData(
  label: string,
  deliveryMethod: string,
  requiredMethod: string,
  office?: EcontOfficeData | SpeedyOfficeData,
) {
  if (deliveryMethod !== requiredMethod) return

  if (!office || !office.name) {
    throw new Error(`${label} office is required for office delivery`)
  }
  if (typeof office.id !== "number" || office.id < 0 || !Number.isFinite(office.id)) {
    throw new Error(`Invalid ${label} office data`)
  }
  if (office.name.length > 200) {
    throw new Error(`Invalid ${label} office data`)
  }
  if (office.city && office.city.length > 200) {
    throw new Error(`Invalid ${label} office data`)
  }
  if (office.fullAddress && office.fullAddress.length > 500) {
    throw new Error(`Invalid ${label} office data`)
  }
}

export async function createCheckoutSession(data: CheckoutData) {
  const { cartItems, customerInfo, needsInvoice, invoiceInfo, econtOffice, speedyOffice } = data

  validateCustomerInfo(customerInfo)
  const deliveryMethod = validateDeliveryMethod(data.deliveryMethod)
  validateAddressForDelivery(deliveryMethod, customerInfo.address)
  validateOfficeData("Econt", deliveryMethod, "econt-office", econtOffice)
  validateOfficeData("Speedy", deliveryMethod, "speedy-office", speedyOffice)
  const validatedItems = await validateCartItems(cartItems)

  const subtotal = validatedItems.reduce(
    (sum, item) => sum + item.priceInCents * item.quantity,
    0
  )
  const shippingPrice = calculateShippingPrice(subtotal, deliveryMethod)

  // Apply promo code if provided
  const promo = await applyAndValidatePromo(data.promoCode, subtotal)
  const discountAmount = promo?.discountAmount ?? 0
  const totalAmount = Math.max(1, subtotal - discountAmount + shippingPrice)

  const lineItems = validatedItems.map((item) => ({
    price_data: {
      currency: "eur",
      product_data: {
        name: item.product.name,
        description: item.product.shortDescription,
      },
      unit_amount: item.product.priceInCents,
    },
    quantity: item.quantity,
  }))

  if (shippingPrice > 0) {
    lineItems.push({
      price_data: {
        currency: "eur",
        product_data: {
          name: `Доставка (${getCarrierName(deliveryMethod)})`,
          description: getDeliveryLabel(deliveryMethod),
        },
        unit_amount: shippingPrice,
      },
      quantity: 1,
    })
  }

  const supabase = await createClient()

  const orderItems = validatedItems.map((item) => ({
    productId: item.productId,
    productName: item.productName,
    quantity: item.quantity,
    priceInCents: item.priceInCents,
  }))

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      email: customerInfo.email,
      first_name: customerInfo.firstName,
      last_name: customerInfo.lastName,
      phone: customerInfo.phone,
      city: customerInfo.city,
      address: customerInfo.address || "",
      postal_code: customerInfo.postalCode || "",
      notes: customerInfo.notes || "",
      logistics_partner: deliveryMethod,
      items: orderItems,
      total_amount: totalAmount,
      status: "pending",
      payment_method: "card",
      needs_invoice: needsInvoice || false,
      invoice_company_name: invoiceInfo?.companyName || null,
      invoice_eik: invoiceInfo?.eik || null,
      invoice_vat_number: invoiceInfo?.vatNumber || null,
      invoice_mol: invoiceInfo?.mol || null,
      invoice_address: invoiceInfo?.invoiceAddress || null,
      econt_office_id: econtOffice?.id ?? null,
      econt_office_name: econtOffice?.name ?? null,
      econt_office_address: econtOffice?.fullAddress ?? null,
      speedy_office_id: speedyOffice?.id ?? null,
      speedy_office_name: speedyOffice?.name ?? null,
      speedy_office_address: speedyOffice?.fullAddress ?? null,
      promo_code: promo?.code ?? null,
      discount_amount: discountAmount,
    })
    .select()
    .single()

  if (orderError) {
    console.error("Failed to create order:", orderError)
    throw new Error("Failed to create order")
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")

  let session
  let stripeCouponId: string | undefined
  try {
    // Create Stripe coupon for promo discount if applicable
    let stripeDiscounts: { coupon: string }[] | undefined
    if (discountAmount > 0) {
      const coupon = await stripe.coupons.create({
        amount_off: discountAmount,
        currency: "eur",
        duration: "once",
        name: promo?.code ?? "Discount",
      })
      stripeCouponId = coupon.id
      stripeDiscounts = [{ coupon: coupon.id }]
    }

    session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: lineItems,
      mode: "payment",
      ...(stripeDiscounts ? { discounts: stripeDiscounts } : {}),
      success_url: `${baseUrl}/checkout/success?order_id=${order.id}`,
      cancel_url: `${baseUrl}/checkout?canceled=true`,
      customer_email: customerInfo.email,
      metadata: {
        orderId: order.id,
      },
    })
  } catch (err) {
    // Stripe session creation failed — clean up orphaned resources
    await supabase.from("orders").delete().eq("id", order.id).eq("status", "pending")
    if (stripeCouponId) {
      await stripe.coupons.del(stripeCouponId).catch(() => {})
    }
    throw err
  }

  // Store the Stripe session ID on the order for later verification
  const { error: updateError } = await supabase
    .from("orders")
    .update({ stripe_session_id: session.id })
    .eq("id", order.id)

  if (updateError) {
    console.error("Failed to store stripe_session_id:", updateError)
    // Don't block the redirect — the webhook can still confirm the order
    // via session.metadata.orderId without needing the stored session ID.
  }

  return { url: session.url }
}

export async function confirmOrder(orderId: string) {
  // Validate orderId is a UUID
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(orderId)) {
    throw new Error("Invalid order ID")
  }

  const supabase = await createClient()

  const { data: existingOrder, error: fetchError } = await supabase
    .from("orders")
    .select("id, status, payment_method, stripe_session_id")
    .eq("id", orderId)
    .single()

  if (fetchError || !existingOrder) {
    // Use generic message to avoid leaking whether an order ID exists
    throw new Error("Unable to confirm order")
  }

  if (existingOrder.status === "confirmed") {
    return { status: "confirmed" as const }
  }

  // For card payments, verify the Stripe session before confirming
  if (existingOrder.payment_method === "card") {
    if (!existingOrder.stripe_session_id) {
      throw new Error("Unable to confirm order")
    }
    const session = await stripe.checkout.sessions.retrieve(existingOrder.stripe_session_id)
    if (session.payment_status !== "paid") {
      throw new Error("Unable to confirm order")
    }
  }

  const { data: updatedOrder, error: updateError } = await supabase
    .from("orders")
    .update({ status: "confirmed" })
    .eq("id", orderId)
    .eq("status", "pending")
    .select()
    .single()

  if (updateError || !updatedOrder) {
    // Another request (e.g. webhook) may have already confirmed this order.
    // Re-check status before treating as an error.
    const { data: recheckOrder } = await supabase
      .from("orders")
      .select("status")
      .eq("id", orderId)
      .single()

    if (recheckOrder?.status === "confirmed") {
      return { status: "confirmed" as const }
    }

    console.error("Failed to update order:", updateError)
    throw new Error("Failed to confirm order")
  }

  // Send confirmation email only after successful status update
  sendConfirmationEmail(updatedOrder)

  return { status: "confirmed" as const }
}

export async function createCODOrder(data: CODOrderData) {
  const { cartItems, customerInfo, needsInvoice, invoiceInfo, econtOffice, speedyOffice } = data

  validateCustomerInfo(customerInfo)
  const deliveryMethod = validateDeliveryMethod(data.deliveryMethod)
  validateAddressForDelivery(deliveryMethod, customerInfo.address)
  validateOfficeData("Econt", deliveryMethod, "econt-office", econtOffice)
  validateOfficeData("Speedy", deliveryMethod, "speedy-office", speedyOffice)

  // Rate limit COD orders to prevent spam
  const headerStore = await headers()
  const ip = headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  checkCODRateLimit(ip)

  const validatedItems = await validateCartItems(cartItems)

  const subtotal = validatedItems.reduce(
    (sum, item) => sum + item.priceInCents * item.quantity,
    0
  )
  const shippingPrice = calculateShippingPrice(subtotal, deliveryMethod)
  const codFee = COD_FEE

  // Apply promo code if provided
  const promo = await applyAndValidatePromo(data.promoCode, subtotal)
  const discountAmount = promo?.discountAmount ?? 0
  const totalAmount = Math.max(1, subtotal - discountAmount + shippingPrice + codFee)

  const supabase = await createClient()

  const orderItems = validatedItems.map((item) => ({
    productId: item.productId,
    productName: item.productName,
    quantity: item.quantity,
    priceInCents: item.priceInCents,
  }))

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      email: customerInfo.email,
      first_name: customerInfo.firstName,
      last_name: customerInfo.lastName,
      phone: customerInfo.phone,
      city: customerInfo.city,
      address: customerInfo.address || "",
      postal_code: customerInfo.postalCode || "",
      notes: customerInfo.notes || "",
      logistics_partner: deliveryMethod,
      items: orderItems,
      total_amount: totalAmount,
      status: "confirmed",
      payment_method: "cod",
      needs_invoice: needsInvoice || false,
      invoice_company_name: invoiceInfo?.companyName || null,
      invoice_eik: invoiceInfo?.eik || null,
      invoice_vat_number: invoiceInfo?.vatNumber || null,
      invoice_mol: invoiceInfo?.mol || null,
      invoice_address: invoiceInfo?.invoiceAddress || null,
      econt_office_id: econtOffice?.id ?? null,
      econt_office_name: econtOffice?.name ?? null,
      econt_office_address: econtOffice?.fullAddress ?? null,
      speedy_office_id: speedyOffice?.id ?? null,
      speedy_office_name: speedyOffice?.name ?? null,
      speedy_office_address: speedyOffice?.fullAddress ?? null,
      promo_code: promo?.code ?? null,
      discount_amount: discountAmount,
    })
    .select()
    .single()

  if (orderError) {
    console.error("Failed to create COD order:", orderError)
    throw new Error("Failed to create order")
  }

  // Send confirmation email
  sendCODConfirmationEmail(order, shippingPrice, codFee, deliveryMethod)

  return { success: true, orderId: order.id }
}

// Non-blocking email helpers

function sendConfirmationEmail(order: Record<string, unknown>) {
  if (!process.env.RESEND_API_KEY) return

  const resend = new Resend(process.env.RESEND_API_KEY)
  const orderItems = order.items as Array<{
    productName: string
    quantity: number
    priceInCents: number
  }>

  const itemsList = orderItems
    .map((item) => `${item.productName} x ${item.quantity} - ${formatPrice(item.priceInCents * item.quantity)}`)
    .join("\n")

  const deliveryLabel = getDeliveryLabel(order.logistics_partner as string)
  const econtOfficeLine = order.econt_office_name ? `\nОфис: ${order.econt_office_name}\n${order.econt_office_address || ""}` : ""
  const speedyOfficeLine = order.speedy_office_name ? `\nОфис: ${order.speedy_office_name}\n${order.speedy_office_address || ""}` : ""

  resend.emails.send({
    from: process.env.EMAIL_FROM || "Egg Origin <onboarding@resend.dev>",
    to: order.email as string,
    subject: `Поръчка #${(order.id as string).slice(0, 8)} - Потвърждение`,
    text: `
Здравейте ${order.first_name},

Благодарим Ви за поръчката!

Детайли на поръчката:
${itemsList}

Обща сума: ${formatPrice(order.total_amount as number)}

Доставка: ${deliveryLabel}${econtOfficeLine}${speedyOfficeLine}
Град: ${order.city}
${order.address ? `Адрес: ${order.address}` : ""}

Ще получите известие, когато поръчката Ви бъде изпратена.

Поздрави,
Екипът на Egg Origin
    `.trim(),
  }).catch(() => {
    // Email sending failed — don't block order confirmation
  })
}

function sendCODConfirmationEmail(
  order: Record<string, unknown>,
  shippingPrice: number,
  codFee: number,
  deliveryMethod: string,
) {
  if (!process.env.RESEND_API_KEY) return

  const resend = new Resend(process.env.RESEND_API_KEY)
  const orderItems = order.items as Array<{
    productName: string
    quantity: number
    priceInCents: number
  }>

  const itemsList = orderItems
    .map((item) => `${item.productName} x ${item.quantity} - ${formatPrice(item.priceInCents * item.quantity)}`)
    .join("\n")

  const deliveryLabel = getDeliveryLabel(deliveryMethod)
  const econtOfficeLine = order.econt_office_name ? `\nОфис: ${order.econt_office_name}\n${order.econt_office_address || ""}` : ""
  const speedyOfficeLine = order.speedy_office_name ? `\nОфис: ${order.speedy_office_name}\n${order.speedy_office_address || ""}` : ""

  resend.emails.send({
    from: process.env.EMAIL_FROM || "Egg Origin <onboarding@resend.dev>",
    to: order.email as string,
    subject: `Поръчка #${(order.id as string).slice(0, 8)} - Потвърждение`,
    text: `
Здравейте ${order.first_name},

Благодарим Ви за поръчката!

Детайли на поръчката:
${itemsList}

Доставка: ${shippingPrice === 0 ? "Безплатна" : formatPrice(shippingPrice)}
Наложен платеж: ${formatPrice(codFee)}

Сума за плащане при доставка: ${formatPrice(order.total_amount as number)}

Начин на доставка: ${deliveryLabel}${econtOfficeLine}${speedyOfficeLine}
Град: ${order.city}
${order.address ? `Адрес: ${order.address}` : ""}

Ще получите известие, когато поръчката Ви бъде изпратена.

Поздрави,
Екипът на Egg Origin
    `.trim(),
  }).catch(() => {
    // Email sending failed — don't block order completion
  })
}
