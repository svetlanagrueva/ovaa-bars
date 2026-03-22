import { NextResponse } from "next/server"
import { stripe } from "@/lib/stripe"
import { createClient } from "@/lib/supabase/server"
import { formatPrice } from "@/lib/products"
import { getDeliveryLabel } from "@/lib/delivery"
import { generateInvoicePDF } from "@/lib/invoice-pdf"
import { sendInvoiceEmail } from "@/lib/invoice-email"
import { getSellerConfig } from "@/lib/seller"
import { Resend } from "resend"
import type Stripe from "stripe"

export async function POST(request: Request) {
  const body = await request.text()
  const signature = request.headers.get("stripe-signature")

  if (!signature || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Missing signature or webhook secret" }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET)
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session

    if (session.payment_status !== "paid") {
      return NextResponse.json({ received: true })
    }

    const orderId = session.metadata?.orderId
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!orderId || !uuidRegex.test(orderId)) {
      console.error("Stripe webhook: missing or invalid orderId in session metadata")
      return NextResponse.json({ error: "Invalid orderId in metadata" }, { status: 400 })
    }

    const supabase = await createClient()

    // Atomically update only pending orders to avoid double-processing
    const { data: order, error } = await supabase
      .from("orders")
      .update({ status: "confirmed", confirmed_at: new Date().toISOString() })
      .eq("id", orderId)
      .eq("status", "pending")
      .select()
      .single()

    if (error || !order) {
      // Order may already be confirmed by the success page — not an error
      return NextResponse.json({ received: true })
    }

    // Generate invoice only when customer requested one (provided company data)
    if (order.needs_invoice && order.invoice_eik) {
      try {
        const { data: invoiceNumber, error: rpcError } = await supabase.rpc("issue_invoice_number", {
          p_order_id: orderId,
        })

        if (!rpcError && invoiceNumber) {
          const seller = getSellerConfig()
          const pdfBuffer = await generateInvoicePDF({
            type: "invoice",
            invoiceNumber,
            invoiceDate: new Date(),
            order,
            seller,
          })

          sendInvoiceEmail({
            to: order.email,
            firstName: order.first_name,
            orderId: order.id,
            invoiceNumber,
            type: "invoice",
            pdfBuffer,
          })
        }
      } catch (invoiceError) {
        console.error("Failed to generate invoice:", invoiceError)
      }
    }

    // Notify admin
    if (process.env.RESEND_API_KEY && process.env.ADMIN_EMAIL) {
      const adminResend = new Resend(process.env.RESEND_API_KEY)
      const adminItems = (order.items as Array<{ productName: string; quantity: number; priceInCents: number }>)
        .map((item) => `${item.productName} x ${item.quantity} - ${formatPrice(item.priceInCents * item.quantity)}`)
        .join("\n")

      adminResend.emails.send({
        from: process.env.EMAIL_FROM || "Egg Origin <onboarding@resend.dev>",
        to: process.env.ADMIN_EMAIL,
        subject: `Нова поръчка #${order.id.slice(0, 8)} — ${formatPrice(order.total_amount)}`,
        text: `
Нова поръчка!

Поръчка: #${order.id.slice(0, 8)}
Клиент: ${order.first_name} ${order.last_name}
Имейл: ${order.email}
Телефон: ${order.phone}
Град: ${order.city}
Плащане: Карта

Продукти:
${adminItems}

Обща сума: ${formatPrice(order.total_amount)}

Виж в админ панела:
${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/admin/orders/${order.id}
        `.trim(),
      }).catch((err) => {
        console.error(`Failed to send admin notification for order ${orderId}:`, err)
      })
    }

    // Send confirmation email
    if (process.env.RESEND_API_KEY) {
      const resend = new Resend(process.env.RESEND_API_KEY)
      const orderItems = order.items as Array<{
        productName: string
        quantity: number
        priceInCents: number
      }>

      const itemsList = orderItems
        .map((item) => `${item.productName} x ${item.quantity} - ${formatPrice(item.priceInCents * item.quantity)}`)
        .join("\n")

      const deliveryLabel = getDeliveryLabel(order.logistics_partner)
      const econtOfficeLine = order.econt_office_name ? `\nОфис: ${order.econt_office_name}\n${order.econt_office_address || ""}` : ""
      const speedyOfficeLine = order.speedy_office_name ? `\nОфис: ${order.speedy_office_name}\n${order.speedy_office_address || ""}` : ""

      resend.emails.send({
        from: process.env.EMAIL_FROM || "Egg Origin <onboarding@resend.dev>",
        to: order.email,
        subject: `Поръчка #${order.id.slice(0, 8)} - Потвърждение`,
        text: `
Здравейте ${order.first_name},

Благодарим Ви за поръчката!

Детайли на поръчката:
${itemsList}

Обща сума: ${formatPrice(order.total_amount)}

Доставка: ${deliveryLabel}${econtOfficeLine}${speedyOfficeLine}
Град: ${order.city}
${order.address ? `Адрес: ${order.address}` : ""}

Ще получите известие, когато поръчката Ви бъде изпратена.

Поздрави,
Екипът на Egg Origin
        `.trim(),
      }).catch((err) => {
        console.error(`Failed to send confirmation email for order ${orderId}:`, err)
      })
    }
  }

  return NextResponse.json({ received: true })
}
