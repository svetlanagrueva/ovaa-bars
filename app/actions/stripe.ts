"use server"

import { headers } from "next/headers"
import { stripe } from "@/lib/stripe"
import { createClient } from "@/lib/supabase/server"
import { PRODUCTS, formatPrice } from "@/lib/products"
import { getProductsWithSales } from "@/lib/sales"
import { COD_FEE, MAX_QUANTITY, calculateShippingPrice } from "@/lib/constants"
import { getDeliveryLabel, getCarrierName } from "@/lib/delivery"
import { sendOrderConfirmationEmail, notifyAdminNewOrder } from "@/lib/email-sender"
import { sanitizeError } from "@/lib/logger"
import { ORDER_ID_REGEX } from "@/lib/orders"
import type Stripe from "stripe"

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
  type: "individual" | "company"
  companyName: string
  eik: string
  vatNumber: string
  mol: string
  invoiceAddress: string
}

interface EcontOfficeData {
  id: number
  code: string
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
  marketingConsent?: boolean
  // Client-visible cart subtotal (pre-promo, pre-shipping) in cents. Used to
  // detect price drift between the cart UI and the server. See PRICE_DRIFT_ERROR.
  clientSubtotal: number
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
  marketingConsent?: boolean
  clientSubtotal: number
}

// Sentinel error prefixes thrown into Error.message. Client-side detection
// is via `message.startsWith(...)` in checkout/page.tsx — these strings are
// the wire contract, so keep them in sync with that file if they ever change.
// Not exported: "use server" only permits async-function exports, and nobody
// imports these by reference (both the thrower and the matcher use literals).
const PRICE_DRIFT_ERROR = "PRICE_DRIFT"
const INV_INSUFFICIENT_ERROR = "INV_INSUFFICIENT"
const INV_FAILED_ERROR = "INV_FAILED"

const VALID_DELIVERY_METHODS = ["speedy-office", "speedy-address", "econt-office"]
const MAX_FIELD_LENGTH = 500
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_REGEX = /^\+?[\d\s\-()]{6,20}$/

// Simple in-memory rate limiter for COD orders (per IP)
const codRateLimit = new Map<string, number[]>()
const COD_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000 // 1 hour
const COD_RATE_LIMIT_MAX = 30 // max 3 COD orders per IP per hour

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

function validateAddressForDelivery(deliveryMethod: string, address: string, postalCode: string) {
  if (deliveryMethod.endsWith("-address")) {
    if (!address || address.trim().length === 0) {
      throw new Error("Address is required for address delivery")
    }
    if (!postalCode || postalCode.trim().length === 0) {
      throw new Error("Postal code is required for address delivery")
    }
  }
}

function validateCustomerInfo(info: CustomerInfo, deliveryMethod?: string) {
  const required: Array<[string, string]> = [
    [info.firstName, "First name"],
    [info.lastName, "Last name"],
    [info.email, "Email"],
    [info.phone, "Phone"],
  ]

  const isAddressDelivery = deliveryMethod?.endsWith("-address") ?? false
  if (isAddressDelivery || (info.city && info.city.trim().length > 0)) {
    required.push([info.city, "City"])
  }

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

// Insert into `orders` with an automatic retry on 10-char PK collision.
// orders.id is `lower(encode(gen_random_bytes(5), 'hex'))` — 16^10 ≈ 1.1T
// values, birthday probability ~10⁻⁸ at 10k rows. The loop is a backstop,
// not a hot path. Postgres unique_violation surfaces as code '23505'.
async function insertOrderWithRetry<T extends { id: string }>(
  attempt: () => PromiseLike<{ data: T | null; error: { code?: string; message?: string } | null }>,
  context: string,
): Promise<T> {
  for (let i = 0; i < 3; i++) {
    const { data, error } = await attempt()
    if (!error && data) return data
    if (error && error.code !== "23505") {
      console.error(`Failed to create order (${context}):`, sanitizeError(error))
      throw new Error("Failed to create order")
    }
    // PK collision — retry with a freshly-defaulted id.
  }
  throw new Error(`Failed to create order after 3 collision retries (${context})`)
}

// Insert one order_items row per validated cart line. line_no is the 1-based
// position in validatedItems; caller is expected to have deduped by productId.
// If this throws, caller must delete the parent order row (cascade cleans up).
async function insertOrderItems(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orderId: string,
  validatedItems: Array<{
    product: { sku: string }
    productId: string
    productName: string
    quantity: number
    priceInCents: number
  }>,
): Promise<void> {
  const rows = validatedItems.map((item, idx) => ({
    order_id: orderId,
    line_no: idx + 1,
    product_id: item.productId,
    sku: item.product.sku,
    product_name: item.productName,
    quantity: item.quantity,
    unit_price_cents: item.priceInCents,
  }))
  const { error } = await supabase.from("order_items").insert(rows)
  if (error) {
    throw new Error(`Failed to create order items: ${error.message}`)
  }
}

// Reserve inventory for all items in an order. Rolls back already-reserved
// items if any single reservation fails (e.g. insufficient stock mid-loop).
// Errors from the RPC are re-thrown with a sentinel prefix the UI can detect;
// the raw RPC message ("Insufficient stock for SKU EGO-DC-12. Available: ...")
// would leak internal SKU codes and English phrasing to the shopper.
async function reserveInventoryForOrder(
  supabase: Awaited<ReturnType<typeof createClient>>,
  items: Array<{ sku: string; quantity: number; productName: string }>,
  orderId: string,
): Promise<void> {
  const reserved: Array<{ sku: string; quantity: number; productName: string }> = []
  try {
    for (const item of items) {
      const { error } = await supabase.rpc("reserve_inventory", {
        p_sku: item.sku,
        p_quantity: item.quantity,
        p_order_id: orderId,
      })
      if (error) {
        const raw = error.message ?? ""
        if (raw.includes("Insufficient stock for SKU")) {
          throw new Error(`${INV_INSUFFICIENT_ERROR}: ${item.productName}`)
        }
        console.error(`Reserve failed for order ${orderId}:`, sanitizeError(error))
        throw new Error(`${INV_FAILED_ERROR}: ${item.productName}`)
      }
      reserved.push(item)
    }
  } catch (err) {
    for (const r of reserved) {
      const { error: restoreErr } = await supabase.rpc("restore_inventory", {
        p_sku: r.sku,
        p_quantity: r.quantity,
        p_order_id: orderId,
      })
      if (restoreErr) {
        console.error(`CRITICAL: Failed to restore inventory for ${r.sku} during rollback of order ${orderId}:`, sanitizeError(restoreErr))
      }
    }
    throw err
  }
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

// Soft stock check for checkout page load — no lock, no decrement.
// Returns items with insufficient stock so the UI can warn before any payment attempt.
// Advisory only: the hard check happens inside reserve_inventory at checkout time.
export async function checkCartInventory(
  cartItems: Array<{ productId: string; quantity: number }>
): Promise<Array<{ productName: string; available: number; requested: number }>> {
  if (!Array.isArray(cartItems) || cartItems.length === 0) return []

  const itemsWithSku = cartItems.flatMap((item) => {
    // Validate quantity before trusting it
    if (!Number.isInteger(item.quantity) || item.quantity < 1) return []
    const product = PRODUCTS.find((p) => p.id === item.productId)
    return product ? [{ sku: product.sku, name: product.name, quantity: item.quantity }] : []
  })

  if (itemsWithSku.length === 0) return []

  const supabase = await createClient()
  const { data: stockLevels, error } = await supabase
    .from("inventory_current")
    .select("sku, quantity")
    .in("sku", itemsWithSku.map((i) => i.sku))

  if (error) {
    // Fail open: a transient DB error should not block checkout.
    console.error("Failed to check cart inventory:", error)
    return []
  }

  const stockMap = new Map((stockLevels || []).map((s) => [s.sku, s.quantity as number]))

  return itemsWithSku
    .filter((item) => stockMap.has(item.sku) && (stockMap.get(item.sku) ?? 0) < item.quantity)
    .map((item) => ({
      productName: item.name,
      // Clamp to 0 for customer display. Negative stock reflects operational
      // debt (seller oversold / discovered shortage) and isn't meaningful to a
      // shopper; they just need to see "0 available" vs their requested qty.
      available: Math.max(0, stockMap.get(item.sku) ?? 0),
      requested: item.quantity,
    }))
}

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

function validateInvoiceInfo(needsInvoice: boolean | undefined, invoiceInfo: InvoiceInfo | undefined) {
  if (!needsInvoice) return
  if (!invoiceInfo) return

  if (invoiceInfo.type !== "individual" && invoiceInfo.type !== "company") {
    throw new Error("Невалиден тип фактура")
  }

  if (invoiceInfo.type === "company") {
    if (!invoiceInfo.companyName?.trim()) {
      throw new Error("Името на фирмата е задължително за фактура")
    }
    if (!invoiceInfo.eik?.trim() || !/^\d{9,13}$/.test(invoiceInfo.eik.trim())) {
      throw new Error("ЕИК трябва да бъде 9 или 13 цифри")
    }
    if (invoiceInfo.vatNumber?.trim() && !/^BG\d{9,13}$/.test(invoiceInfo.vatNumber.trim())) {
      throw new Error("Невалиден ДДС номер (формат: BG + ЕИК)")
    }
    if (invoiceInfo.companyName.length > MAX_FIELD_LENGTH) {
      throw new Error("Името на фирмата е твърде дълго")
    }
    // МОЛ (representing person) is required only for companies — individual
    // invoices use the order's first_name + last_name as the legal name.
    if (!invoiceInfo.mol?.trim()) {
      throw new Error("МОЛ е задължително за фактура на фирма")
    }
  }

  if (!invoiceInfo.invoiceAddress?.trim()) {
    throw new Error("Адресът е задължителен за фактура")
  }
}

// Inserts the type='invoice' row for an order that requested invoicing.
// Caller is responsible for rolling back the orders row on failure.
async function insertInvoiceForOrder(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orderId: string,
  invoiceInfo: InvoiceInfo,
): Promise<void> {
  const isCompany = invoiceInfo.type === "company"
  const { error } = await supabase.from("invoices").insert({
    order_id: orderId,
    type: "invoice",
    invoice_type: invoiceInfo.type,
    company_name: isCompany ? invoiceInfo.companyName.trim() : null,
    eik: isCompany ? invoiceInfo.eik.trim() : null,
    vat_number: isCompany && invoiceInfo.vatNumber?.trim()
      ? invoiceInfo.vatNumber.trim()
      : null,
    mol: isCompany ? invoiceInfo.mol.trim() : null,
    address: invoiceInfo.invoiceAddress.trim(),
  })
  if (error) {
    console.error("Failed to insert invoices row:", sanitizeError(error))
    throw new Error("Failed to create invoice record")
  }
}

export async function createCheckoutSession(data: CheckoutData) {
  const { cartItems, customerInfo, needsInvoice, invoiceInfo, econtOffice, speedyOffice } = data

  const deliveryMethod = validateDeliveryMethod(data.deliveryMethod)
  validateCustomerInfo(customerInfo, deliveryMethod)
  validateInvoiceInfo(needsInvoice, invoiceInfo)
  validateAddressForDelivery(deliveryMethod, customerInfo.address, customerInfo.postalCode || "")
  validateOfficeData("Econt", deliveryMethod, "econt-office", econtOffice)
  validateOfficeData("Speedy", deliveryMethod, "speedy-office", speedyOffice)
  const validatedItems = await validateCartItems(cartItems)

  const subtotal = validatedItems.reduce(
    (sum, item) => sum + item.priceInCents * item.quantity,
    0
  )

  // Price drift guard: the client submits what it displayed at the moment the
  // user clicked submit. If server-live prices differ (admin edited a sale,
  // promotion expired, product price changed), reject before taking payment.
  if (data.clientSubtotal !== subtotal) {
    throw new Error(
      `${PRICE_DRIFT_ERROR}: cart showed ${data.clientSubtotal} cents but server computed ${subtotal} cents`,
    )
  }

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

  const order = await insertOrderWithRetry(
    () =>
      supabase
        .from("orders")
        .insert({
          email: customerInfo.email.trim().toLowerCase(),
          first_name: customerInfo.firstName,
          last_name: customerInfo.lastName,
          phone: customerInfo.phone,
          city: customerInfo.city,
          address: customerInfo.address || "",
          postal_code: customerInfo.postalCode || "",
          notes: customerInfo.notes || "",
          logistics_partner: deliveryMethod,
          total_amount: totalAmount,
          shipping_fee: shippingPrice,
          cod_fee: 0,
          status: "pending",
          payment_method: "card",
          econt_office_id: econtOffice?.id ?? null,
          econt_office_code: econtOffice?.code ?? null,
          econt_office_name: econtOffice?.name ?? null,
          econt_office_address: econtOffice?.fullAddress ?? null,
          speedy_office_id: speedyOffice?.id ?? null,
          speedy_office_name: speedyOffice?.name ?? null,
          speedy_office_address: speedyOffice?.fullAddress ?? null,
          promo_code: promo?.code ?? null,
          discount_amount: discountAmount,
          marketing_consent: data.marketingConsent || false,
        })
        .select()
        .single(),
    "card",
  )

  // Persist order_items rows. Cascade on orders delete cleans them up on rollback.
  try {
    await insertOrderItems(supabase, order.id, validatedItems)
  } catch (itemsErr) {
    await supabase.from("orders").delete().eq("id", order.id)
    throw itemsErr
  }

  // Persist invoices row when customer requested an invoice. Rollback the
  // order on failure — DB has on-delete-restrict from invoices to orders, but
  // since the invoice insert failed there's no row blocking the delete.
  if (needsInvoice && invoiceInfo) {
    try {
      await insertInvoiceForOrder(supabase, order.id, invoiceInfo)
    } catch (invoiceErr) {
      await supabase.from("orders").delete().eq("id", order.id)
      throw invoiceErr
    }
  }

  // Reserve inventory — if insufficient stock, clean up the order and surface the error
  try {
    await reserveInventoryForOrder(
      supabase,
      validatedItems.map((i) => ({ sku: i.product.sku, quantity: i.quantity, productName: i.productName })),
      order.id,
    )
  } catch (inventoryErr) {
    await supabase.from("orders").delete().eq("id", order.id)
    throw inventoryErr
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
      customer_email: customerInfo.email.trim().toLowerCase(),
      metadata: {
        orderId: order.id,
      },
    })
  } catch (err) {
    // Stripe session creation failed — restore inventory then clean up orphaned resources
    for (const item of validatedItems) {
      await supabase.rpc("restore_inventory", {
        p_sku: item.product.sku,
        p_quantity: item.quantity,
        p_order_id: order.id,
      })
    }
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
    console.error("Failed to store stripe_session_id:", sanitizeError(updateError))
    // Don't block the redirect — the webhook can still confirm the order
    // via session.metadata.orderId without needing the stored session ID.
  }

  return { url: session.url }
}

export interface OrderTrackingItem {
  sku: string
  quantity: number
  priceInCents: number
}

export interface ConfirmOrderResult {
  status: "confirmed"
  totalCents: number
  items: OrderTrackingItem[]
}

async function fetchTrackingItems(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orderId: string,
): Promise<OrderTrackingItem[]> {
  const { data, error } = await supabase
    .from("order_items")
    .select("sku, quantity, unit_price_cents")
    .eq("order_id", orderId)
    .order("line_no")
  if (error || !data) {
    console.error(`[fetchTrackingItems] Failed to fetch order_items for ${orderId}:`, error)
    return []
  }
  return data.map((row) => ({
    sku: row.sku,
    quantity: row.quantity,
    priceInCents: row.unit_price_cents,
  }))
}

export async function confirmOrder(orderId: string): Promise<ConfirmOrderResult> {
  if (!ORDER_ID_REGEX.test(orderId)) {
    throw new Error("Invalid order ID")
  }

  const supabase = await createClient()

  const { data: existingOrder, error: fetchError } = await supabase
    .from("orders")
    .select("id, status, payment_method, stripe_session_id, total_amount")
    .eq("id", orderId)
    .single()

  if (fetchError || !existingOrder) {
    // Use generic message to avoid leaking whether an order ID exists
    throw new Error("Unable to confirm order")
  }

  if (existingOrder.status === "confirmed") {
    return {
      status: "confirmed",
      totalCents: existingOrder.total_amount ?? 0,
      items: await fetchTrackingItems(supabase, orderId),
    }
  }

  // For card payments, verify the Stripe session and fetch receipt URL
  let receiptUrl: string | null = null
  let paymentIntentId: string | null = null
  if (existingOrder.payment_method === "card") {
    if (!existingOrder.stripe_session_id) {
      throw new Error("Unable to confirm order")
    }
    const session = await stripe.checkout.sessions.retrieve(existingOrder.stripe_session_id)
    if (session.payment_status !== "paid") {
      throw new Error("Unable to confirm order")
    }

    // Fetch receipt URL from PaymentIntent → Charge
    if (session.payment_intent) {
      paymentIntentId = session.payment_intent as string
      try {
        const paymentIntent = await stripe.paymentIntents.retrieve(
          paymentIntentId,
          { expand: ["latest_charge"] }
        )
        receiptUrl = (paymentIntent.latest_charge as Stripe.Charge)?.receipt_url ?? null
      } catch (err) {
        console.error(`Failed to retrieve PaymentIntent for order ${orderId}:`, err)
      }
    }
  }

  const now = new Date().toISOString()
  const updatePayload: Record<string, unknown> = { status: "confirmed", confirmed_at: now }
  // Card payments are paid at confirmation; COD is paid later when courier settles
  if (existingOrder.payment_method === "card") {
    updatePayload.seller_settled_at = now
    if (paymentIntentId) updatePayload.stripe_payment_intent_id = paymentIntentId
    if (receiptUrl) updatePayload.stripe_receipt_url = receiptUrl
  }

  const { data: updatedOrder, error: updateError } = await supabase
    .from("orders")
    .update(updatePayload)
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
      return {
        status: "confirmed",
        totalCents: existingOrder.total_amount ?? 0,
        items: await fetchTrackingItems(supabase, orderId),
      }
    }

    console.error("Failed to update order:", updateError)
    throw new Error("Failed to confirm order")
  }

  // Send confirmation email only after successful status update
  sendOrderConfirmationEmail(updatedOrder)

  return {
    status: "confirmed",
    totalCents: updatedOrder.total_amount ?? 0,
    items: await fetchTrackingItems(supabase, orderId),
  }
}

export async function createCODOrder(data: CODOrderData) {
  const { cartItems, customerInfo, needsInvoice, invoiceInfo, econtOffice, speedyOffice } = data

  const deliveryMethod = validateDeliveryMethod(data.deliveryMethod)
  validateCustomerInfo(customerInfo, deliveryMethod)
  validateInvoiceInfo(needsInvoice, invoiceInfo)
  validateAddressForDelivery(deliveryMethod, customerInfo.address, customerInfo.postalCode || "")
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

  if (data.clientSubtotal !== subtotal) {
    throw new Error(
      `${PRICE_DRIFT_ERROR}: cart showed ${data.clientSubtotal} cents but server computed ${subtotal} cents`,
    )
  }

  const shippingPrice = calculateShippingPrice(subtotal, deliveryMethod)
  const codFee = COD_FEE

  // Apply promo code if provided
  const promo = await applyAndValidatePromo(data.promoCode, subtotal)
  const discountAmount = promo?.discountAmount ?? 0
  const totalAmount = Math.max(1, subtotal - discountAmount + shippingPrice + codFee)

  const supabase = await createClient()

  const order = await insertOrderWithRetry(
    () =>
      supabase
        .from("orders")
        .insert({
          email: customerInfo.email.trim().toLowerCase(),
          first_name: customerInfo.firstName,
          last_name: customerInfo.lastName,
          phone: customerInfo.phone,
          city: customerInfo.city,
          address: customerInfo.address || "",
          postal_code: customerInfo.postalCode || "",
          notes: customerInfo.notes || "",
          logistics_partner: deliveryMethod,
          total_amount: totalAmount,
          shipping_fee: shippingPrice,
          cod_fee: codFee,
          status: "confirmed",
          confirmed_at: new Date().toISOString(),
          payment_method: "cod",
          econt_office_id: econtOffice?.id ?? null,
          econt_office_code: econtOffice?.code ?? null,
          econt_office_name: econtOffice?.name ?? null,
          econt_office_address: econtOffice?.fullAddress ?? null,
          speedy_office_id: speedyOffice?.id ?? null,
          speedy_office_name: speedyOffice?.name ?? null,
          speedy_office_address: speedyOffice?.fullAddress ?? null,
          promo_code: promo?.code ?? null,
          discount_amount: discountAmount,
          marketing_consent: data.marketingConsent || false,
        })
        .select()
        .single(),
    "cod",
  )

  // Persist order_items rows. Cascade on orders delete cleans them up on rollback.
  try {
    await insertOrderItems(supabase, order.id, validatedItems)
  } catch (itemsErr) {
    await supabase.from("orders").delete().eq("id", order.id)
    throw itemsErr
  }

  // Persist invoices row when customer requested an invoice.
  if (needsInvoice && invoiceInfo) {
    try {
      await insertInvoiceForOrder(supabase, order.id, invoiceInfo)
    } catch (invoiceErr) {
      await supabase.from("orders").delete().eq("id", order.id)
      throw invoiceErr
    }
  }

  // Reserve inventory — if insufficient stock, clean up the order and surface the error
  try {
    await reserveInventoryForOrder(
      supabase,
      validatedItems.map((i) => ({ sku: i.product.sku, quantity: i.quantity, productName: i.productName })),
      order.id,
    )
  } catch (inventoryErr) {
    await supabase.from("orders").delete().eq("id", order.id)
    throw inventoryErr
  }

  // Send confirmation email and notify admin
  sendOrderConfirmationEmail(order)
  notifyAdminNewOrder(order, "cod")

  return { success: true, orderId: order.id }
}

// Non-blocking email helpers

// sendOrderConfirmationEmail and notifyAdminNewOrder are imported from lib/email-sender.ts
