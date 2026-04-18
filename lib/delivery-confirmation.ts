import "server-only"

import { createClient } from "@/lib/supabase/server"
import { sendDeliveryEmail } from "@/lib/email-sender"

/**
 * Atomically confirm delivery for an order. All state mutation and side effects
 * (status update, email) happen here. This is the canonical delivery path used
 * by the admin panel, delivery cron, and future webhooks.
 *
 * Idempotent: the RPC guards on status = 'shipped', so duplicate calls are no-ops.
 */
export async function confirmDeliveryForOrder(
  orderId: string,
  deliveredAt: string,
  source: "speedy" | "econt" | "admin"
): Promise<{ confirmed: boolean }> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc("confirm_delivery", {
    p_order_id: orderId,
    p_delivered_at: deliveredAt,
  })

  if (error) {
    console.error("confirm_delivery RPC failed", { orderId, source, error })
    throw new Error("Failed to confirm delivery")
  }

  const rows = Array.isArray(data) ? data : data ? [data] : []

  if (rows.length === 0) {
    return { confirmed: false }
  }

  console.log("Delivery confirmed", { orderId, source, deliveredAt })
  sendDeliveryEmail(rows[0])

  return { confirmed: true }
}

/**
 * Resolver: look up an order by tracking number and delegate to confirmDeliveryForOrder.
 * No state mutation or side effects happen here — all writes stay in confirmDeliveryForOrder.
 */
export async function confirmDeliveryByTrackingNumber(
  trackingNumber: string,
  deliveredAt: string,
  source: "speedy" | "econt"
): Promise<{ confirmed: boolean; orderId?: string }> {
  const supabase = await createClient()

  const { data: orders, error } = await supabase
    .from("orders")
    .select("id")
    .eq("tracking_number", trackingNumber)
    .eq("status", "shipped")
    .limit(2)

  if (error) {
    console.error("Failed to look up order by tracking number", { trackingNumber, source, error })
    return { confirmed: false }
  }

  if (!orders || orders.length === 0) {
    return { confirmed: false }
  }

  if (orders.length > 1) {
    console.error("Ambiguous tracking number", {
      trackingNumber,
      orderIds: orders.map((o) => o.id),
      source,
    })
    return { confirmed: false }
  }

  const orderId = orders[0].id
  const result = await confirmDeliveryForOrder(orderId, deliveredAt, source)
  return { ...result, orderId }
}
