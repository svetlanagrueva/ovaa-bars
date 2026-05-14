import { NextResponse } from "next/server"
import { timingSafeEqual } from "crypto"
import { createClient } from "@/lib/supabase/server"
import { getShipmentStatus as getSpeedyStatus } from "@/lib/speedy"
import { getShipmentStatus as getEcontStatus } from "@/lib/econt"
import { confirmDeliveryByTrackingNumber } from "@/lib/delivery-confirmation"
import { sendDeliveryEmail } from "@/lib/email-sender"

export const maxDuration = 60

const SPEEDY_PARTNERS = ["speedy-office", "speedy-address"]
const ECONT_PARTNERS = ["econt-office"]

function getCourier(partner: string): "speedy" | "econt" | null {
  if (SPEEDY_PARTNERS.includes(partner)) return "speedy"
  if (ECONT_PARTNERS.includes(partner)) return "econt"
  return null
}

export async function GET(request: Request) {
  // Auth: Vercel Cron sends Authorization: Bearer <CRON_SECRET>
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error("CRON_SECRET env var is not set")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const authHeader = request.headers.get("authorization") || ""
  const expected = `Bearer ${cronSecret}`
  const authBuf = Buffer.from(authHeader)
  const expectedBuf = Buffer.from(expected)
  if (authBuf.length !== expectedBuf.length || !timingSafeEqual(authBuf, expectedBuf)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabase = await createClient()

  // Find shipped orders to check, cursor-based: oldest-checked first, never-checked prioritized
  const { data: candidates, error: queryError } = await supabase
    .from("orders")
    .select("id, tracking_number, logistics_partner")
    .eq("status", "shipped")
    .not("tracking_number", "is", null)
    .neq("tracking_number", "__generating__")
    .lt("shipped_at", new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
    .order("delivery_status_checked_at", { ascending: true, nullsFirst: true })
    .limit(20)

  if (queryError) {
    console.error("Delivery check query failed:", queryError)
    return NextResponse.json({ error: "Query failed" }, { status: 500 })
  }

  let checked = 0
  let delivered = 0
  let failed = 0

  for (const order of candidates || []) {
    const courier = getCourier(order.logistics_partner)
    if (!courier) {
      console.warn("Unknown logistics partner, skipping", {
        orderId: order.id,
        partner: order.logistics_partner,
      })
      continue
    }

    try {
      const getStatus = courier === "speedy" ? getSpeedyStatus : getEcontStatus
      const status = await getStatus(order.tracking_number)

      // Advance cursor only on successful API response
      await supabase
        .from("orders")
        .update({ delivery_status_checked_at: new Date().toISOString() })
        .eq("id", order.id)

      checked++

      if (status.delivered) {
        const deliveredAt = status.deliveredAt ?? new Date().toISOString()
        const deliveredAtSource = status.deliveredAt ? "courier" : "inferred"
        console.log("Delivery detected", {
          orderId: order.id,
          deliveredAt,
          deliveredAtSource,
          courier,
          rawStatus: status.rawStatus,
          rawEventCode: status.rawEventCode,
        })

        await confirmDeliveryByTrackingNumber(order.tracking_number, deliveredAt, courier)
        delivered++
      } else {
        console.log("Not yet delivered", {
          orderId: order.id,
          courier,
          rawStatus: status.rawStatus,
          rawEventCode: status.rawEventCode,
        })
      }
    } catch (err) {
      // Do NOT advance delivery_status_checked_at — order stays near front for retry
      console.error("Delivery check failed", {
        orderId: order.id,
        courier,
        trackingNumber: order.tracking_number,
        error: String(err),
      })
      failed++
    }
  }

  // Email retry pass: re-attempt delivery emails that failed previously
  let emailRetries = 0
  const { data: emailPending } = await supabase
    .from("orders")
    .select("*")
    .not("delivered_at", "is", null)
    .is("delivery_email_sent_at", null)
    .order("delivered_at", { ascending: true })
    .limit(10)

  for (const order of emailPending || []) {
    sendDeliveryEmail(order)
    emailRetries++
  }

  console.log(`Delivery check cron completed: checked=${checked} delivered=${delivered} emailRetries=${emailRetries} failed=${failed}`)
  return NextResponse.json({ checked, delivered, emailRetries, failed })
}
