import { NextResponse } from "next/server"
import { Resend } from "resend"
import { stripe } from "@/lib/stripe"
import { createClient } from "@/lib/supabase/server"
import { sendOrderConfirmationEmail, notifyAdminNewOrder } from "@/lib/email-sender"
import { sanitizeError } from "@/lib/logger"
import type Stripe from "stripe"

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Fire-and-forget admin alert for events that need operator attention
// (refunds issued outside the admin UI, disputes, etc.).
function alertAdmin(subject: string, body: string) {
  if (!process.env.RESEND_API_KEY || !process.env.ADMIN_EMAIL) return
  const resend = new Resend(process.env.RESEND_API_KEY)
  resend.emails.send({
    from: process.env.EMAIL_FROM || "Egg Origin <onboarding@resend.dev>",
    to: process.env.ADMIN_EMAIL,
    subject,
    text: body,
  }).catch((err) => {
    console.error(`Failed to send admin alert "${subject}":`, sanitizeError(err))
  })
}

// Idempotent upsert of a Stripe Refund into order_refunds.
// Natural key: stripe_refund_id (unique partial index). First arrival wins,
// subsequent arrivals (retries, cross-event overlap) are no-ops.
async function upsertRefundFromStripe(refund: Stripe.Refund): Promise<void> {
  if (refund.status !== "succeeded") {
    // pending/failed/canceled refunds don't get recorded — we only track
    // money that actually moved.
    return
  }

  const paymentIntentId = typeof refund.payment_intent === "string"
    ? refund.payment_intent
    : refund.payment_intent?.id ?? null
  if (!paymentIntentId) {
    console.error(`Refund ${refund.id} has no payment_intent`)
    return
  }

  const supabase = await createClient()

  // Fast path: if the Stripe refund ID is already in our table, do nothing.
  // Covers the admin-UI-then-webhook ordering — admin recorded the refund
  // first with the Stripe ID, webhook arrival has nothing to add.
  const { data: existing } = await supabase
    .from("order_refunds")
    .select("id, order_id")
    .eq("stripe_refund_id", refund.id)
    .maybeSingle()
  if (existing) return

  // Locate the order. Stripe is our source of the refund, but we need the
  // local order to attach it to.
  const { data: order } = await supabase
    .from("orders")
    .select("id")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .single()

  if (!order) {
    console.error(`No order found for payment intent ${paymentIntentId} (refund ${refund.id})`)
    return
  }

  const { error: insertError } = await supabase
    .from("order_refunds")
    .insert({
      order_id: order.id,
      stripe_refund_id: refund.id,
      amount_cents: refund.amount,
      method: "stripe",
      source: "stripe_webhook",
      reason: refund.reason ?? "Stripe webhook: refund recorded from gateway event",
      recorded_by: "stripe-webhook",
      refunded_at: new Date(refund.created * 1000).toISOString(),
    })

  if (insertError) {
    // 23505 on stripe_refund_id means a concurrent upsert beat us. That's
    // the idempotent success case; treat as handled.
    if (insertError.code !== "23505") {
      console.error(`Failed to insert order_refunds row for refund ${refund.id}:`, sanitizeError(insertError))
    }
    return
  }

  alertAdmin(
    `Stripe refund recorded — order ${String(order.id).slice(0, 8)}`,
    `A refund of ${(refund.amount / 100).toFixed(2)} EUR was recorded for order ${order.id}.\n` +
      `Payment intent: ${paymentIntentId}\n` +
      `Stripe refund: ${refund.id}\n` +
      `Reason (gateway): ${refund.reason ?? "n/a"}\n\n` +
      `Open the order in the admin panel to add the internal reason and credit-note reference.`,
  )
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

  if (event.type === "checkout.session.expired") {
    const session = event.data.object as Stripe.Checkout.Session
    const orderId = session.metadata?.orderId
    const uuidRegex = UUID_REGEX
    if (orderId && uuidRegex.test(orderId)) {
      const supabase = await createClient()

      // Atomically claim the order by flipping pending → expired.
      // If another webhook delivery already processed this event, this update affects 0 rows and we skip.
      const { data: claimed } = await supabase
        .from("orders")
        .update({ status: "expired" })
        .eq("id", orderId)
        .eq("status", "pending")
        .select("id")

      if (claimed && claimed.length > 0) {
        const { data: items, error: itemsErr } = await supabase
          .from("order_items")
          .select("sku, quantity")
          .eq("order_id", orderId)
        if (itemsErr || !items) {
          console.error(`Failed to load order_items for expired session ${orderId}:`, sanitizeError(itemsErr))
        } else {
          for (const item of items) {
            const { error: restoreErr } = await supabase.rpc("restore_inventory", {
              p_sku: item.sku,
              p_quantity: item.quantity,
              p_order_id: orderId,
            })
            if (restoreErr) {
              console.error(`Failed to restore inventory for ${item.sku} on expired session ${orderId}:`, sanitizeError(restoreErr))
            }
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
    const uuidRegex = UUID_REGEX
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

  // ─── refund.created / charge.refunded ───────────────────────────────────
  // Either event signals a refund. refund.created is the cleaner payload —
  // it carries the full Refund object. charge.refunded is handled as a
  // fallback for deployments subscribed to the older event; both converge
  // on the same upsertRefund() path, idempotent via stripe_refund_id.
  if (event.type === "refund.created" || event.type === "refund.updated") {
    const refund = event.data.object as Stripe.Refund
    await upsertRefundFromStripe(refund)
  }

  if (event.type === "charge.refunded") {
    const charge = event.data.object as Stripe.Charge
    // On newer Stripe API versions charge.refunds is not auto-expanded.
    // List refunds explicitly and ingest each one. Upsert is idempotent, so
    // overlap with refund.created is safe.
    const refunds = await stripe.refunds.list({ charge: charge.id, limit: 10 })
    for (const refund of refunds.data) {
      await upsertRefundFromStripe(refund)
    }
  }

  // ─── payment_intent.payment_failed ──────────────────────────────────────
  // 3DS challenge failed, card declined post-authorization, etc. Without
  // this, the order would sit in `pending` and inventory stay reserved
  // until the session expired (up to 24h). Flipping to `expired` immediately
  // releases inventory.
  if (event.type === "payment_intent.payment_failed") {
    const paymentIntent = event.data.object as Stripe.PaymentIntent
    // Stripe Checkout propagates session metadata to the PaymentIntent.
    const orderId = paymentIntent.metadata?.orderId
    if (orderId && UUID_REGEX.test(orderId)) {
      const supabase = await createClient()

      const { data: claimed } = await supabase
        .from("orders")
        .update({ status: "expired" })
        .eq("id", orderId)
        .eq("status", "pending")
        .select("id")

      if (claimed && claimed.length > 0) {
        // Restore inventory for the failed order. Same pattern as the
        // checkout.session.expired handler.
        const { data: items, error: itemsErr } = await supabase
          .from("order_items")
          .select("sku, quantity")
          .eq("order_id", orderId)
        if (itemsErr || !items) {
          console.error(`Failed to load order_items for payment-failed order ${orderId}:`, sanitizeError(itemsErr))
        } else {
          for (const item of items) {
            const { error: restoreErr } = await supabase.rpc("restore_inventory", {
              p_sku: item.sku,
              p_quantity: item.quantity,
              p_order_id: orderId,
            })
            if (restoreErr) {
              console.error(`Failed to restore inventory for ${item.sku} on payment-failed order ${orderId}:`, sanitizeError(restoreErr))
            }
          }
        }

        // Audit event (keeps a record of WHY the order expired).
        const { error: outcomeErr } = await supabase.rpc("record_order_outcome", {
          p_order_id: orderId,
          p_outcome_type: "payment_failed",
          p_payload: {
            payment_intent_id: paymentIntent.id,
            failure_code: paymentIntent.last_payment_error?.code ?? null,
            failure_message: paymentIntent.last_payment_error?.message ?? null,
          },
          p_actor: "stripe-webhook",
        })
        if (outcomeErr) {
          console.error(`Failed to record payment_failed outcome for ${orderId}:`, sanitizeError(outcomeErr))
        }
      }
    }
  }

  // ─── charge.dispute.created ─────────────────────────────────────────────
  // Chargeback filed. Operator must know within minutes — Stripe typically
  // gives ~7 days to respond with evidence. Record audit event + email admin.
  if (event.type === "charge.dispute.created") {
    const dispute = event.data.object as Stripe.Dispute
    const paymentIntentId = typeof dispute.payment_intent === "string"
      ? dispute.payment_intent
      : dispute.payment_intent?.id ?? null

    if (paymentIntentId) {
      const supabase = await createClient()
      const { data: order } = await supabase
        .from("orders")
        .select("id, total_amount, email")
        .eq("stripe_payment_intent_id", paymentIntentId)
        .single()

      if (order) {
        const { error: outcomeErr } = await supabase.rpc("record_order_outcome", {
          p_order_id: order.id,
          p_outcome_type: "dispute_opened",
          p_payload: {
            dispute_id: dispute.id,
            payment_intent_id: paymentIntentId,
            amount: dispute.amount,
            reason: dispute.reason,
            status: dispute.status,
            evidence_due_by: dispute.evidence_details?.due_by ?? null,
          },
          p_actor: "stripe-webhook",
        })
        if (outcomeErr) {
          console.error(`Failed to record dispute_opened outcome for ${order.id}:`, sanitizeError(outcomeErr))
        }

        const dueBy = dispute.evidence_details?.due_by
          ? new Date(dispute.evidence_details.due_by * 1000).toISOString().slice(0, 10)
          : "unknown"
        alertAdmin(
          `⚠ Chargeback opened — order ${String(order.id).slice(0, 8)}`,
          `A chargeback (dispute) was filed on order ${order.id}.\n\n` +
            `Amount: ${(dispute.amount / 100).toFixed(2)} EUR\n` +
            `Reason: ${dispute.reason}\n` +
            `Status: ${dispute.status}\n` +
            `Evidence due by: ${dueBy}\n` +
            `Dispute ID: ${dispute.id}\n\n` +
            `Respond in the Stripe dashboard: https://dashboard.stripe.com/disputes/${dispute.id}`,
        )
      }
    }
  }

  return NextResponse.json({ received: true })
}
