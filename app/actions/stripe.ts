"use server"

import { stripe } from "@/lib/stripe"
import { createClient } from "@/lib/supabase/server"
import { PRODUCTS } from "@/lib/products"
import { Resend } from "resend"

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

interface CheckoutData {
  cartItems: CartItem[]
  customerInfo: CustomerInfo
  deliveryMethod: string
  shippingPrice: number
  needsInvoice?: boolean
  invoiceInfo?: InvoiceInfo
}

interface CODOrderData {
  cartItems: CartItem[]
  customerInfo: CustomerInfo
  deliveryMethod: string
  shippingPrice: number
  codFee: number
  needsInvoice?: boolean
  invoiceInfo?: InvoiceInfo
}

export async function createCheckoutSession(data: CheckoutData) {
  const { cartItems, customerInfo, deliveryMethod, shippingPrice, needsInvoice, invoiceInfo } = data

  // Validate cart items and calculate total on server
  const lineItems = cartItems.map((item) => {
    const product = PRODUCTS.find((p) => p.id === item.productId)
    if (!product) {
      throw new Error(`Product not found: ${item.productId}`)
    }
    return {
      price_data: {
        currency: "bgn",
        product_data: {
          name: product.name,
          description: product.description,
        },
        unit_amount: product.priceInCents,
      },
      quantity: item.quantity,
    }
  })

  // Add shipping as a line item if not free
  if (shippingPrice > 0) {
    lineItems.push({
      price_data: {
        currency: "bgn",
        product_data: {
          name: "Доставка (Speedy)",
          description: deliveryMethod === "speedy-office" ? "До офис на Speedy" : "До адрес",
        },
        unit_amount: shippingPrice,
      },
      quantity: 1,
    })
  }

  // Create order in database
  const supabase = await createClient()
  
  const orderItems = cartItems.map((item) => {
    const product = PRODUCTS.find((p) => p.id === item.productId)!
    return {
      productId: item.productId,
      productName: product.name,
      quantity: item.quantity,
      priceInCents: product.priceInCents,
    }
  })

  const totalAmount = orderItems.reduce(
    (sum, item) => sum + item.priceInCents * item.quantity,
    0
  ) + shippingPrice

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
    })
    .select()
    .single()

  if (orderError) {
    console.error("Failed to create order:", orderError)
    throw new Error("Failed to create order")
  }

  // Create Stripe checkout session
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL 
    ? `https://${process.env.VERCEL_URL}` 
    : "http://localhost:3000"

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    line_items: lineItems,
    mode: "payment",
    success_url: `${baseUrl}/checkout/success?order_id=${order.id}`,
    cancel_url: `${baseUrl}/checkout?canceled=true`,
    customer_email: customerInfo.email,
    metadata: {
      orderId: order.id,
    },
  })

  return { url: session.url }
}

export async function confirmOrder(orderId: string) {
  const supabase = await createClient()

  // Update order status
  const { data: order, error: updateError } = await supabase
    .from("orders")
    .update({ status: "confirmed" })
    .eq("id", orderId)
    .select()
    .single()

  if (updateError) {
    console.error("Failed to update order:", updateError)
    throw new Error("Failed to confirm order")
  }

  // Send confirmation email (non-blocking)
  try {
    if (process.env.RESEND_API_KEY) {
      const resend = new Resend(process.env.RESEND_API_KEY)
      
      const orderItems = order.items as Array<{
        productName: string
        quantity: number
        priceInCents: number
      }>

      const itemsList = orderItems
        .map((item) => `${item.productName} x ${item.quantity} - ${(item.priceInCents * item.quantity / 100).toFixed(2)} лв.`)
        .join("\n")

      const deliveryLabel = order.logistics_partner?.startsWith("speedy") 
        ? (order.logistics_partner === "speedy-office" ? "До офис на Speedy" : "Speedy до адрес")
        : (order.logistics_partner === "econt-office" ? "До офис на Еконт" : "Еконт до адрес")

      await resend.emails.send({
        from: "Ovva Sculpt <onboarding@resend.dev>",
        to: order.email,
        subject: `Order #${order.id.slice(0, 8)} - Confirmation`,
        text: `
Hi ${order.first_name},

Thank you for your order!

Order details:
${itemsList}

Total: ${(order.total_amount / 100).toFixed(2)} лв.

Delivery: ${deliveryLabel}
City: ${order.city}
${order.address ? `Address: ${order.address}` : ""}

You will receive a notification when your order is shipped.

Best,
Ovva Sculpt Team
        `.trim(),
      })
    }
  } catch {
    // Email sending failed - log but don't block order confirmation
    // In production, verify your domain at resend.com/domains to send to all recipients
  }

  return order
}

export async function createCODOrder(data: CODOrderData) {
  const { cartItems, customerInfo, deliveryMethod, shippingPrice, codFee, needsInvoice, invoiceInfo } = data

  const supabase = await createClient()
  
  const orderItems = cartItems.map((item) => {
    const product = PRODUCTS.find((p) => p.id === item.productId)
    if (!product) {
      throw new Error(`Product not found: ${item.productId}`)
    }
    return {
      productId: item.productId,
      productName: product.name,
      quantity: item.quantity,
      priceInCents: product.priceInCents,
    }
  })

  const totalAmount = orderItems.reduce(
    (sum, item) => sum + item.priceInCents * item.quantity,
    0
  ) + shippingPrice + codFee

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
      logistics_partner: deliveryMethod,
      items: orderItems,
      total_amount: totalAmount,
      status: "confirmed", // COD orders are immediately confirmed
      payment_method: "cod",
      needs_invoice: needsInvoice || false,
      invoice_company_name: invoiceInfo?.companyName || null,
      invoice_eik: invoiceInfo?.eik || null,
      invoice_vat_number: invoiceInfo?.vatNumber || null,
      invoice_mol: invoiceInfo?.mol || null,
      invoice_address: invoiceInfo?.invoiceAddress || null,
    })
    .select()
    .single()

  if (orderError) {
    console.error("Failed to create COD order:", orderError)
    throw new Error("Failed to create order")
  }

  // Send confirmation email (non-blocking)
  try {
    if (process.env.RESEND_API_KEY) {
      const resend = new Resend(process.env.RESEND_API_KEY)
      
      const itemsList = orderItems
        .map((item) => `${item.productName} x ${item.quantity} - ${(item.priceInCents * item.quantity / 100).toFixed(2)} лв.`)
        .join("\n")

      const deliveryLabel = deliveryMethod.startsWith("speedy") 
        ? (deliveryMethod === "speedy-office" ? "До офис на Speedy" : "Speedy до адрес")
        : (deliveryMethod === "econt-office" ? "До офис на Еконт" : "Еконт до адрес")

      await resend.emails.send({
        from: "Ovva Sculpt <onboarding@resend.dev>",
        to: order.email,
        subject: `Order #${order.id.slice(0, 8)} - Confirmation`,
        text: `
Hi ${order.first_name},

Thank you for your order!

Order details:
${itemsList}

Shipping: ${shippingPrice === 0 ? "Free" : (shippingPrice / 100).toFixed(2) + " лв."}
Cash on delivery fee: ${(codFee / 100).toFixed(2)} лв.

Total to pay on delivery: ${(order.total_amount / 100).toFixed(2)} лв.

Delivery method: ${deliveryLabel}
City: ${order.city}
${order.address ? `Address: ${order.address}` : ""}

You will receive a notification when your order is shipped.

Best,
Ovva Sculpt Team
        `.trim(),
      })
    }
  } catch {
    // Email sending failed - log but don't block order completion
    // In production, verify your domain at resend.com/domains to send to all recipients
  }

  return { success: true, orderId: order.id }
}
