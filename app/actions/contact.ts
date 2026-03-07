"use server"

import { headers } from "next/headers"
import { Resend } from "resend"

interface ContactData {
  name: string
  email: string
  subject: string
  message: string
}

// Simple in-memory rate limiter for contact form (per IP)
const contactRateLimit = new Map<string, number[]>()
const CONTACT_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000 // 15 minutes
const CONTACT_RATE_LIMIT_MAX = 5 // max 5 messages per IP per 15 min

function checkContactRateLimit(ip: string) {
  const now = Date.now()
  const timestamps = (contactRateLimit.get(ip) || []).filter(
    (t) => now - t < CONTACT_RATE_LIMIT_WINDOW_MS
  )
  if (timestamps.length >= CONTACT_RATE_LIMIT_MAX) {
    throw new Error("Too many messages. Please try again later.")
  }
  timestamps.push(now)
  contactRateLimit.set(ip, timestamps)

  // Periodically purge stale entries to prevent memory leak
  if (contactRateLimit.size > 1000) {
    for (const [key, ts] of contactRateLimit) {
      const active = ts.filter((t) => now - t < CONTACT_RATE_LIMIT_WINDOW_MS)
      if (active.length === 0) contactRateLimit.delete(key)
      else contactRateLimit.set(key, active)
    }
  }
}

export async function sendContactMessage(data: ContactData) {
  const { name, email, subject, message } = data

  if (!name || !email || !message) {
    throw new Error("Missing required fields")
  }

  if (!process.env.RESEND_API_KEY) {
    throw new Error("Email service not configured")
  }

  // Rate limit by IP
  const headerStore = await headers()
  const ip = headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  checkContactRateLimit(ip)

  const resend = new Resend(process.env.RESEND_API_KEY)

  await resend.emails.send({
    from: process.env.EMAIL_FROM || "Ovva Sculpt <onboarding@resend.dev>",
    to: "info@ovvasculpt.com",
    replyTo: email,
    subject: subject ? `Contact: ${subject}` : `Contact from ${name}`,
    text: `Name: ${name}\nEmail: ${email}\n\n${message}`,
  })

  return { success: true }
}
