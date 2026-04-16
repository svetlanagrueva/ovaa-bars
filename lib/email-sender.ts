import { Resend } from "resend"
import { formatPrice } from "@/lib/products"
import { buildOrderConfirmationEmail } from "@/lib/email-template"
import { createClient } from "@/lib/supabase/server"

/**
 * Send order confirmation email to the customer.
 * Sets order_confirmation_sent_at on success.
 * Fire-and-forget — logs errors but never throws.
 */
export function sendOrderConfirmationEmail(order: Record<string, unknown>) {
  if (!process.env.RESEND_API_KEY) return

  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const orderItems = order.items as Array<{
      productId: string
      productName: string
      quantity: number
      priceInCents: number
    }>

    const subtotal = orderItems.reduce(
      (sum, item) => sum + item.priceInCents * item.quantity,
      0
    )

    const { html, text } = buildOrderConfirmationEmail({
      orderId: order.id as string,
      firstName: order.first_name as string,
      items: orderItems,
      subtotal,
      shippingFee: (order.shipping_fee as number) || 0,
      codFee: (order.cod_fee as number) || 0,
      discountAmount: (order.discount_amount as number) || 0,
      promoCode: (order.promo_code as string) || null,
      totalAmount: order.total_amount as number,
      paymentMethod: order.payment_method as "card" | "cod",
      date: (order.created_at as string) || new Date().toISOString(),
      stripeReceiptUrl: (order.stripe_receipt_url as string) || null,
    })

    resend.emails.send({
      from: process.env.EMAIL_FROM || "Egg Origin <onboarding@resend.dev>",
      to: order.email as string,
      subject: `Поръчка #${(order.id as string).slice(0, 8)} - Потвърждение`,
      html,
      text,
    }).then(async () => {
      // Record that the confirmation email was sent
      try {
        const supabase = await createClient()
        const { error: tsError } = await supabase
          .from("orders")
          .update({ order_confirmation_sent_at: new Date().toISOString() })
          .eq("id", order.id as string)
        if (tsError) {
          console.error(`Failed to record confirmation email timestamp for order ${order.id}:`, tsError)
        }
      } catch (err) {
        console.error(`Failed to record confirmation email timestamp for order ${order.id}:`, err)
      }
    }).catch((err) => {
      console.error(`Failed to send confirmation email for order ${order.id}:`, err)
    })
  } catch (err) {
    console.error(`Failed to build confirmation email for order ${order.id}:`, err)
  }
}

/**
 * Send admin notification email about a new order.
 * Fire-and-forget — logs errors but never throws.
 */
export function notifyAdminNewOrder(order: Record<string, unknown>, paymentMethod: string) {
  if (!process.env.RESEND_API_KEY || !process.env.ADMIN_EMAIL) return

  const resend = new Resend(process.env.RESEND_API_KEY)
  const orderItems = order.items as Array<{ productName: string; quantity: number; priceInCents: number }>
  const itemsList = orderItems
    .map((item) => `${item.productName} x ${item.quantity} - ${formatPrice(item.priceInCents * item.quantity)}`)
    .join("\n")

  resend.emails.send({
    from: process.env.EMAIL_FROM || "Egg Origin <onboarding@resend.dev>",
    to: process.env.ADMIN_EMAIL,
    subject: `Нова поръчка #${(order.id as string).slice(0, 8)} — ${formatPrice(order.total_amount as number)}`,
    text: `
Нова поръчка!

Поръчка: #${(order.id as string).slice(0, 8)}
Клиент: ${order.first_name} ${order.last_name}
Имейл: ${order.email}
Телефон: ${order.phone}
Град: ${order.city}
Плащане: ${paymentMethod === "card" ? "Карта" : "Наложен платеж"}

Продукти:
${itemsList}

Обща сума: ${formatPrice(order.total_amount as number)}

Виж в админ панела:
${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/admin/orders/${order.id}
    `.trim(),
  }).catch((err) => {
    console.error(`Failed to send admin notification for order ${order.id}:`, err)
  })
}
