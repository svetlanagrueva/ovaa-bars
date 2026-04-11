import { NextResponse } from "next/server"
import { timingSafeEqual } from "crypto"
import { createClient } from "@/lib/supabase/server"
import { Resend } from "resend"
import { buildReviewRequestEmail, buildCrossSellEmail } from "@/lib/email-template"
import { buildUnsubscribeUrl } from "@/lib/unsubscribe"

export const maxDuration = 60

interface ClaimedJob {
  log_id: number
  order_id: string
  email: string
  first_name: string
  items: Array<{ productId: string; productName: string; quantity: number; priceInCents: number }>
  total_amount: number
  payment_method: string
  email_type: string
  attempt_count: number
}

function buildEmailForJob(job: ClaimedJob, unsubscribeUrl: string): { html: string; text: string; subject: string } | null {
  const shortId = job.order_id.slice(0, 8)

  if (job.email_type === "review_request") {
    const { html, text } = buildReviewRequestEmail({
      orderId: job.order_id,
      firstName: job.first_name,
      items: job.items,
      unsubscribeUrl,
    })
    return { html, text, subject: `Как Ви се стори поръчка #${shortId}?` }
  }

  if (job.email_type === "cross_sell") {
    const purchasedProductIds = job.items.map((i) => i.productId)
    const { html, text } = buildCrossSellEmail({
      firstName: job.first_name,
      purchasedProductIds,
      unsubscribeUrl,
    })
    return { html, text, subject: "Време е за презареждане!" }
  }

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

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: "RESEND_API_KEY not configured" }, { status: 500 })
  }

  const supabase = await createClient()
  const resend = new Resend(process.env.RESEND_API_KEY)

  // Single RPC: find candidates, insert pending, reclaim stale, claim work
  const { data: jobs, error: rpcError } = await supabase.rpc("claim_marketing_emails", {
    p_now: new Date().toISOString(),
    p_limit: 50,
  })

  if (rpcError) {
    console.error("claim_marketing_emails RPC failed:", rpcError)
    return NextResponse.json({ error: "RPC failed" }, { status: 500 })
  }

  if (!jobs || jobs.length === 0) {
    return NextResponse.json({ sent: 0, failed: 0, skipped: 0 })
  }

  let sent = 0
  let failed = 0
  let skipped = 0

  for (const job of jobs as ClaimedJob[]) {
    const unsubscribeUrl = buildUnsubscribeUrl(job.email)

    const emailContent = buildEmailForJob(job, unsubscribeUrl)
    if (!emailContent) {
      console.error(`Skipping unknown email type: ${job.email_type} for log_id ${job.log_id}`)
      const { error: skipError } = await supabase
        .from("marketing_email_log")
        .update({ status: "skipped", error_message: `Unknown email type: ${job.email_type}`, claimed_at: null })
        .eq("id", job.log_id)
      if (skipError) console.error(`Failed to update log row ${job.log_id} to skipped:`, skipError)
      skipped++
      continue
    }

    try {
      const { html, text, subject } = emailContent

      const result = await resend.emails.send({
        from: process.env.EMAIL_FROM || "Egg Origin <onboarding@resend.dev>",
        to: job.email,
        subject,
        html,
        text,
      })

      const { error: updateError } = await supabase
        .from("marketing_email_log")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          provider_message_id: result.data?.id || null,
          claimed_at: null,
          error_message: null,
        })
        .eq("id", job.log_id)

      if (updateError) {
        console.error(`Failed to update log row ${job.log_id} to sent:`, updateError)
      }

      sent++
    } catch (err) {
      console.error(`Failed to send ${job.email_type} to ${job.email}:`, err)

      const { error: updateError } = await supabase
        .from("marketing_email_log")
        .update({
          status: "failed",
          error_message: String(err),
          claimed_at: null,
        })
        .eq("id", job.log_id)

      if (updateError) {
        console.error(`Failed to update log row ${job.log_id} to failed:`, updateError)
      }

      failed++
    }
  }

  console.log(`Marketing email cron completed: sent=${sent} failed=${failed} skipped=${skipped}`)
  return NextResponse.json({ sent, failed, skipped })
}
