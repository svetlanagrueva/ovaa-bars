import { getEmailClient, isEmailEnabled } from "@/lib/email-client"
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
 * Common shell for fire-and-forget transactional emails: gate on
 * `isEmailEnabled`, get the email client, send with `EMAIL_FROM`, log on
 * error. Used by withdrawal notifications and the admin new-order alert
 * — sites that don't need to record a per-order timestamp on success.
 *
 * The order-bound senders below (`sendOrderConfirmationEmail`,
 * `sendDeliveryEmail`) use `sendAndRecordOrderEmail` instead, which adds
 * the post-send DB-update dance.
 */
async function sendTransactionalEmail(args: {
  to: string
  subject: string
  // Deferred so the template render only runs when the gate has passed —
  // callers that build expensive payloads should not pay for them when
  // email is disabled.
  build: () => { html?: string; text: string }
  logTag: string
}): Promise<void> {
  if (!isEmailEnabled()) return
  try {
    const { html, text } = args.build()
    const client = getEmailClient()
    await client.emails.send({
      from: requireEnv("EMAIL_FROM"),
      to: args.to,
      subject: args.subject,
      html,
      text,
    })
  } catch (err) {
    console.error(`Failed to send ${args.logTag}:`, err)
  }
}

/**
 * Order-bound transactional email with post-send DB updates:
 *   - On success: stamp `sentAtColumn` (with `.is(sentAtColumn, null)` guard
 *     so concurrent retries / cron passes don't double-write).
 *   - On send failure: if `errorColumn` is provided, record `String(err)`
 *     there (with the same `.is(sentAtColumn, null)` guard so a stale
 *     error doesn't clobber a concurrent success).
 *
 * Fire-and-forget: this function awaits the send-trigger but the post-send
 * DB writes happen asynchronously through `.then` / `.catch` so callers
 * don't pay request-time latency for the audit columns.
 */
async function sendAndRecordOrderEmail(args: {
  order: Record<string, unknown>
  subject: string
  text: string
  html: string
  sentAtColumn: string
  errorColumn?: string
  // Used in the catch-side log message (e.g., "Failed to send confirmation
  // email for order X"). Kept as a separate arg from `sentAtColumn` so the
  // log reads naturally regardless of the column name.
  logKind: string
}): Promise<void> {
  const orderId = args.order.id as string
  const client = getEmailClient()
  client.emails.send({
    from: requireEnv("EMAIL_FROM"),
    to: args.order.email as string,
    subject: args.subject,
    html: args.html,
    text: args.text,
  }).then(async () => {
    try {
      const supabase = await createClient()
      const update: Record<string, unknown> = { [args.sentAtColumn]: new Date().toISOString() }
      if (args.errorColumn) update[args.errorColumn] = null
      const { error: tsError } = await supabase
        .from("orders")
        .update(update)
        .eq("id", orderId)
        .is(args.sentAtColumn, null)
      if (tsError) {
        console.error(`Failed to record ${args.logKind} email timestamp for order ${orderId}:`, tsError)
      }
    } catch (err) {
      console.error(`Failed to record ${args.logKind} email timestamp for order ${orderId}:`, err)
    }
  }).catch(async (err) => {
    console.error(`Failed to send ${args.logKind} email for order ${orderId}:`, err)
    if (args.errorColumn) {
      try {
        const supabase = await createClient()
        await supabase
          .from("orders")
          .update({ [args.errorColumn]: String(err) })
          .eq("id", orderId)
          .is(args.sentAtColumn, null)
      } catch (dbErr) {
        console.error(`Failed to record ${args.logKind} email error for order ${orderId}:`, dbErr)
      }
    }
  })
}

/**
 * Send order confirmation email to the customer.
 * Sets order_confirmation_sent_at on success.
 * Fire-and-forget — logs errors but never throws.
 */
export async function sendOrderConfirmationEmail(order: Record<string, unknown>) {
  if (!isEmailEnabled()) return

  try {
    const supabase = await createClient()
    const orderItems = await fetchOrderItemsForEmail(supabase, order.id as string)
    if (!orderItems) return

    const subtotal = orderItems.reduce(
      (sum, item) => sum + item.priceInCents * item.quantity,
      0,
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

    await sendAndRecordOrderEmail({
      order,
      subject: `Поръчка #${(order.id as string).slice(0, 8)} - Потвърждение`,
      html,
      text,
      sentAtColumn: "order_confirmation_sent_at",
      logKind: "confirmation",
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
  if (!isEmailEnabled()) return
  if (order.delivery_email_sent_at && !options?.force) return

  try {
    const supabase = await createClient()
    const orderItems = await fetchOrderItemsForEmail(supabase, order.id as string)
    if (!orderItems) return

    const { html, text } = buildDeliveryEmail({
      orderId: order.id as string,
      firstName: order.first_name as string,
      items: orderItems,
    })

    await sendAndRecordOrderEmail({
      order,
      subject: `Поръчка #${(order.id as string).slice(0, 8)} - Доставена`,
      html,
      text,
      sentAtColumn: "delivery_email_sent_at",
      errorColumn: "delivery_email_last_error",
      logKind: "delivery",
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
  if (!isEmailEnabled() || !process.env.ADMIN_EMAIL) return

  const supabase = await createClient()
  const orderItems = await fetchOrderItemsForEmail(supabase, order.id as string)
  if (!orderItems) return

  const itemsList = orderItems
    .map((item) => `${item.productName} x ${item.quantity} - ${formatPrice(item.priceInCents * item.quantity)}`)
    .join("\n")

  await sendTransactionalEmail({
    to: process.env.ADMIN_EMAIL,
    subject: `Нова поръчка #${(order.id as string).slice(0, 8)} — ${formatPrice(order.total_amount as number)}`,
    build: () => ({ text: `
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
    `.trim() }),
    logTag: `admin notification for order ${order.id}`,
  })
}


// ── Withdrawals (право на отказ) — admin-driven transactional emails ─────────
// All three are fire-and-forget; failures are logged but don't break the
// admin action that triggered them.

export async function sendWithdrawalReceivedEmail(
  order: Record<string, unknown>,
  data: { withdrawalRef: string; customerEmail: string },
): Promise<void> {
  await sendTransactionalEmail({
    to: data.customerEmail,
    subject: `Получихме заявката Ви за връщане ${data.withdrawalRef}`,
    build: () => buildWithdrawalReceivedEmail({
      orderId: order.id as string,
      withdrawalRef: data.withdrawalRef,
    }),
    logTag: `withdrawal-received email for ${data.withdrawalRef}`,
  })
}

export async function sendWithdrawalApprovedEmail(data: {
  orderId: string
  customerEmail: string
  withdrawalRef: string
  returnRequired: boolean
}): Promise<void> {
  await sendTransactionalEmail({
    to: data.customerEmail,
    subject: `Заявката Ви ${data.withdrawalRef} е одобрена`,
    build: () => buildWithdrawalApprovedEmail({
      orderId: data.orderId,
      withdrawalRef: data.withdrawalRef,
      returnRequired: data.returnRequired,
    }),
    logTag: `withdrawal-approved email for ${data.withdrawalRef}`,
  })
}

export async function sendWithdrawalRejectedEmail(data: {
  orderId: string
  customerEmail: string
  withdrawalRef: string
  rejectionReason: string
}): Promise<void> {
  await sendTransactionalEmail({
    to: data.customerEmail,
    subject: `Заявката Ви ${data.withdrawalRef} не е одобрена`,
    build: () => buildWithdrawalRejectedEmail({
      orderId: data.orderId,
      withdrawalRef: data.withdrawalRef,
      rejectionReason: data.rejectionReason,
    }),
    logTag: `withdrawal-rejected email for ${data.withdrawalRef}`,
  })
}
