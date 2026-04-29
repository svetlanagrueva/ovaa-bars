import { Resend } from "resend"
import { formatPrice } from "@/lib/products"
import {
  buildOrderConfirmationEmail,
  buildDeliveryEmail,
  buildWithdrawalReceivedEmail,
  buildWithdrawalApprovedEmail,
  buildWithdrawalRejectedEmail,
} from "@/lib/email-template"
import { createClient } from "@/lib/supabase/server"
import { requireEnv } from "@/lib/env"

/**
 * Load order items in the shape email templates expect.
 * Returns null on DB error so callers can bail early.
 */
async function fetchOrderItemsForEmail(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orderId: string,
): Promise<Array<{ productId: string; productName: string; quantity: number; priceInCents: number }> | null> {
  const { data, error } = await supabase
    .from("order_items")
    .select("product_id, product_name, quantity, unit_price_cents")
    .eq("order_id", orderId)
    .order("line_no")
  if (error || !data) {
    console.error(`[email-sender] Failed to fetch order_items for ${orderId}:`, error)
    return null
  }
  return data.map((row) => ({
    productId: row.product_id,
    productName: row.product_name,
    quantity: row.quantity,
    priceInCents: row.unit_price_cents,
  }))
}

/**
 * Send order confirmation email to the customer.
 * Sets order_confirmation_sent_at on success.
 * Fire-and-forget — logs errors but never throws.
 */
export async function sendOrderConfirmationEmail(order: Record<string, unknown>) {
  if (!process.env.RESEND_API_KEY) return

  try {
    const supabase = await createClient()
    const orderItems = await fetchOrderItemsForEmail(supabase, order.id as string)
    if (!orderItems) return

    const resend = new Resend(process.env.RESEND_API_KEY)

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
      from: requireEnv("EMAIL_FROM"),
      to: order.email as string,
      subject: `Поръчка #${(order.id as string).slice(0, 8)} - Потвърждение`,
      html,
      text,
    }).then(async () => {
      // Record that the confirmation email was sent. Idempotency guard:
      // .is("order_confirmation_sent_at", null) — first writer wins, retries no-op.
      try {
        const supabase = await createClient()
        const { error: tsError } = await supabase
          .from("orders")
          .update({ order_confirmation_sent_at: new Date().toISOString() })
          .eq("id", order.id as string)
          .is("order_confirmation_sent_at", null)
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
 * Send delivery confirmation email to the customer.
 * Fire-and-forget — logs errors but never throws.
 * Records delivery_email_sent_at on success, delivery_email_last_error on failure.
 *
 * `options.force`: bypass the `delivery_email_sent_at` early-return so admin
 * can manually resend. The timestamp update still uses `.is(..., null)`
 * (first-write-wins), so the original first-sent time is preserved.
 */
export async function sendDeliveryEmail(
  order: Record<string, unknown>,
  options?: { force?: boolean },
) {
  if (!process.env.RESEND_API_KEY) return
  if (order.delivery_email_sent_at && !options?.force) return

  try {
    const supabase = await createClient()
    const orderItems = await fetchOrderItemsForEmail(supabase, order.id as string)
    if (!orderItems) return

    const resend = new Resend(process.env.RESEND_API_KEY)

    const { html, text } = buildDeliveryEmail({
      orderId: order.id as string,
      firstName: order.first_name as string,
      items: orderItems,
    })

    resend.emails.send({
      from: requireEnv("EMAIL_FROM"),
      to: order.email as string,
      subject: `Поръчка #${(order.id as string).slice(0, 8)} - Доставена`,
      html,
      text,
    }).then(async () => {
      // Idempotency guard: .is("delivery_email_sent_at", null) — overlapping
      // cron runs or retries cannot double-write the success timestamp.
      try {
        const supabase = await createClient()
        const { error: tsError } = await supabase
          .from("orders")
          .update({ delivery_email_sent_at: new Date().toISOString(), delivery_email_last_error: null })
          .eq("id", order.id as string)
          .is("delivery_email_sent_at", null)
        if (tsError) {
          console.error(`Failed to record delivery email timestamp for order ${order.id}:`, tsError)
        }
      } catch (err) {
        console.error(`Failed to record delivery email timestamp for order ${order.id}:`, err)
      }
    }).catch(async (err) => {
      console.error(`Failed to send delivery email for order ${order.id}:`, err)
      // Only record the error if success hasn't been recorded concurrently —
      // avoids overwriting a successful send's state with an error from a
      // stale attempt.
      try {
        const supabase = await createClient()
        await supabase
          .from("orders")
          .update({ delivery_email_last_error: String(err) })
          .eq("id", order.id as string)
          .is("delivery_email_sent_at", null)
      } catch (dbErr) {
        console.error(`Failed to record delivery email error for order ${order.id}:`, dbErr)
      }
    })
  } catch (err) {
    console.error(`Failed to build delivery email for order ${order.id}:`, err)
  }
}

/**
 * Send admin notification email about a new order.
 * Fire-and-forget — logs errors but never throws.
 */
export async function notifyAdminNewOrder(order: Record<string, unknown>, paymentMethod: string) {
  if (!process.env.RESEND_API_KEY || !process.env.ADMIN_EMAIL) return

  const supabase = await createClient()
  const orderItems = await fetchOrderItemsForEmail(supabase, order.id as string)
  if (!orderItems) return

  const resend = new Resend(process.env.RESEND_API_KEY)
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


// ── Withdrawals (право на отказ) — admin-driven transactional emails ─────────
// All three are fire-and-forget; failures are logged but don't break the
// admin action that triggered them.

export async function sendWithdrawalReceivedEmail(
  order: Record<string, unknown>,
  data: { withdrawalRef: string; customerEmail: string },
): Promise<void> {
  if (!process.env.RESEND_API_KEY) return
  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const { html, text } = buildWithdrawalReceivedEmail({
      orderId: order.id as string,
      withdrawalRef: data.withdrawalRef,
    })
    await resend.emails.send({
      from: requireEnv("EMAIL_FROM"),
      to: data.customerEmail,
      subject: `Получихме заявката Ви за връщане ${data.withdrawalRef}`,
      html,
      text,
    })
  } catch (err) {
    console.error(`Failed to send withdrawal-received email for ${data.withdrawalRef}:`, err)
  }
}

export async function sendWithdrawalApprovedEmail(data: {
  orderId: string
  customerEmail: string
  withdrawalRef: string
  returnRequired: boolean
}): Promise<void> {
  if (!process.env.RESEND_API_KEY) return
  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const { html, text } = buildWithdrawalApprovedEmail({
      orderId: data.orderId,
      withdrawalRef: data.withdrawalRef,
      returnRequired: data.returnRequired,
    })
    await resend.emails.send({
      from: requireEnv("EMAIL_FROM"),
      to: data.customerEmail,
      subject: `Заявката Ви ${data.withdrawalRef} е одобрена`,
      html,
      text,
    })
  } catch (err) {
    console.error(`Failed to send withdrawal-approved email for ${data.withdrawalRef}:`, err)
  }
}

export async function sendWithdrawalRejectedEmail(data: {
  orderId: string
  customerEmail: string
  withdrawalRef: string
  rejectionReason: string
}): Promise<void> {
  if (!process.env.RESEND_API_KEY) return
  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const { html, text } = buildWithdrawalRejectedEmail({
      orderId: data.orderId,
      withdrawalRef: data.withdrawalRef,
      rejectionReason: data.rejectionReason,
    })
    await resend.emails.send({
      from: requireEnv("EMAIL_FROM"),
      to: data.customerEmail,
      subject: `Заявката Ви ${data.withdrawalRef} не е одобрена`,
      html,
      text,
    })
  } catch (err) {
    console.error(`Failed to send withdrawal-rejected email for ${data.withdrawalRef}:`, err)
  }
}
