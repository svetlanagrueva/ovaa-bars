import { NextResponse } from "next/server"
import { stripe } from "@/lib/stripe"
import { createClient } from "@/lib/supabase/server"
import { formatPrice } from "@/lib/products"
import { Resend } from "resend"
import type Stripe from "stripe"

function getDeliveryLabel(deliveryMethod: string): string {
  switch (deliveryMethod) {
    case "speedy-office": return "До офис на Speedy"
    case "speedy-address": return "Speedy до адрес"
    case "econt-office": return "До офис на Еконт"
    case "econt-address": return "Еконт до адрес"
    default: return deliveryMethod
  }
}

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
    if (!orderId) {
      console.error("Stripe webhook: no orderId in session metadata")
      return NextResponse.json({ error: "No orderId in metadata" }, { status: 400 })
    }

    const supabase = await createClient()

    // Atomically update only pending orders to avoid double-processing
    const { data: order, error } = await supabase
      .from("orders")
      .update({ status: "confirmed" })
      .eq("id", orderId)
      .eq("status", "pending")
      .select()
      .single()

    if (error || !order) {
      // Order may already be confirmed by the success page — not an error
      return NextResponse.json({ received: true })
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

      resend.emails.send({
        from: process.env.EMAIL_FROM || "Ovva Sculpt <onboarding@resend.dev>",
        to: order.email,
        subject: `Поръчка #${order.id.slice(0, 8)} - Потвърждение`,
        text: `
Здравейте ${order.first_name},

Благодарим Ви за поръчката!

Детайли на поръчката:
${itemsList}

Обща сума: ${formatPrice(order.total_amount)}

Доставка: ${deliveryLabel}
Град: ${order.city}
${order.address ? `Адрес: ${order.address}` : ""}

Ще получите известие, когато поръчката Ви бъде изпратена.

Поздрави,
Екипът на Ovva Sculpt
        `.trim(),
      }).catch(() => {
        // Non-blocking
      })
    }
  }

  return NextResponse.json({ received: true })
}
