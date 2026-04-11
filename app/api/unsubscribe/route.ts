import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { verifyUnsubscribeToken } from "@/lib/unsubscribe"
import { createClient } from "@/lib/supabase/server"

// In-memory rate limiter (per IP, same pattern as contact form)
const rateLimit = new Map<string, number[]>()
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000 // 15 minutes
const RATE_LIMIT_MAX = 10 // 10 attempts per IP per 15 min

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const timestamps = (rateLimit.get(ip) || []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS
  )
  if (timestamps.length >= RATE_LIMIT_MAX) return false
  timestamps.push(now)
  rateLimit.set(ip, timestamps)

  if (rateLimit.size > 1000) {
    for (const [key, ts] of rateLimit) {
      const active = ts.filter((t) => now - t < RATE_LIMIT_WINDOW_MS)
      if (active.length === 0) rateLimit.delete(key)
      else rateLimit.set(key, active)
    }
  }
  return true
}

export async function POST(request: Request) {
  const headerStore = await headers()
  const ip = headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: "Твърде много опити. Моля, опитайте по-късно." },
      { status: 429 }
    )
  }

  let body: { token?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const { token } = body
  if (!token || typeof token !== "string" || token.length > 500) {
    return NextResponse.json({ error: "Token is required" }, { status: 400 })
  }

  const result = verifyUnsubscribeToken(token)
  if (!result) {
    return NextResponse.json(
      { error: "Невалиден или изтекъл линк" },
      { status: 400 }
    )
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from("email_unsubscribes")
    .upsert({ email: result.email.toLowerCase() }, { onConflict: "email", ignoreDuplicates: true })

  if (error) {
    console.error("Failed to unsubscribe:", error)
    return NextResponse.json(
      { error: "Възникна грешка. Моля, опитайте отново." },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true })
}
