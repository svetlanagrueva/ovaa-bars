import { NextResponse } from "next/server"
import { stripe } from "@/lib/stripe"
import { createClient } from "@/lib/supabase/server"
import { sendOrderConfirmationEmail, notifyAdminNewOrder } from "@/lib/email-sender"
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

  if (event.type === "checkout.session.expired") {
    const session = event.data.object as Stripe.Checkout.Session
    const orderId = session.metadata?.orderId
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (orderId && uuidRegex.test(orderId)) {
      const supabase = await createClient()

      // Atomically claim the order by flipping pending → expired.
      // If another webhook delivery already processed this event, this update affects 0 rows and we skip.
      const { data: claimed } = await supabase
        .from("orders")
        .update({ status: "expired" })
        .eq("id", orderId)
        .eq("status", "pending")
        .select("items")

      if (claimed && claimed.length > 0) {
        const { PRODUCTS } = await import("@/lib/products")
        const items = claimed[0].items as Array<{ productId: string; quantity: number }>
        for (const item of items) {
          const product = PRODUCTS.find((p) => p.id === item.productId)
          if (!product) continue
          const { error: restoreErr } = await supabase.rpc("restore_inventory", {
            p_sku: product.sku,
            p_quantity: item.quantity,
            p_order_id: orderId,
          })
          if (restoreErr) {
            console.error(`Failed to restore inventory for ${product.sku} on expired session ${orderId}:`, restoreErr)
          }
        }
      }
    }
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

    // Fetch Stripe receipt URL from PaymentIntent → Charge
    let receiptUrl: string | null = null
    let paymentIntentId: string | null = null
    if (session.payment_intent) {
      paymentIntentId = session.payment_intent as string
      try {
        const paymentIntent = await stripe.paymentIntents.retrieve(
          paymentIntentId,
          { expand: ["latest_charge"] }
        )
        receiptUrl = (paymentIntent.latest_charge as Stripe.Charge)?.receipt_url ?? null

        // Amount validation guard — log if Stripe charged a different amount
        const amountReceived = paymentIntent.amount_received
        // amount_received is available after fetching; compare with order total below
        if (amountReceived) {
          const { data: orderCheck } = await supabase
            .from("orders")
            .select("total_amount")
            .eq("id", orderId)
            .single()
          if (orderCheck && amountReceived !== orderCheck.total_amount) {
            console.error(`AMOUNT MISMATCH: order=${orderId} expected=${orderCheck.total_amount} stripe_received=${amountReceived}`)
          }
        }
      } catch (err) {
        console.error(`Failed to retrieve PaymentIntent for order ${orderId}:`, err)
      }
    }

    // Atomically update only pending orders to avoid double-processing
    const now = new Date().toISOString()
    const updateData: Record<string, unknown> = {
      status: "confirmed",
      confirmed_at: now,
      paid_at: now,
    }
    if (paymentIntentId) updateData.stripe_payment_intent_id = paymentIntentId
    if (receiptUrl) updateData.stripe_receipt_url = receiptUrl

    const { data: order, error } = await supabase
      .from("orders")
      .update(updateData)
      .eq("id", orderId)
      .eq("status", "pending")
      .select()
      .single()

    if (error || !order) {
      // Order may already be confirmed by the success page — not an error
      return NextResponse.json({ received: true })
    }

    notifyAdminNewOrder(order, "card")
    sendOrderConfirmationEmail(order)
  }

  return NextResponse.json({ received: true })
}
