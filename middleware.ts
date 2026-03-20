import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

const COOKIE_NAME = "admin-session"
const SESSION_MAX_AGE_MS = 60 * 60 * 8 * 1000 // 8 hours
const IDLE_TIMEOUT_MS = 60 * 30 * 1000 // 30 minutes
const IDLE_TIMEOUT_S = 60 * 30 // 30 minutes (for cookie maxAge)

async function hmacSign(message: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

// Token format: "createdAt:lastActivity.signature"
async function verifyToken(
  token: string,
  secret: string,
): Promise<{ valid: boolean; createdAt?: string }> {
  const dotIndex = token.lastIndexOf(".")
  if (dotIndex === -1) return { valid: false }

  const payload = token.slice(0, dotIndex)
  const signature = token.slice(dotIndex + 1)
  if (!payload || !signature) return { valid: false }

  const expected = await hmacSign(payload, secret)
  if (!timingSafeCompare(expected, signature)) return { valid: false }

  const parts = payload.split(":")
  if (parts.length !== 2) return { valid: false }

  const [createdAt, lastActivity] = parts
  const now = Date.now()

  // Absolute session lifetime
  if (now - parseInt(createdAt, 10) > SESSION_MAX_AGE_MS) return { valid: false }

  // Idle timeout — enforced server-side
  if (now - parseInt(lastActivity, 10) > IDLE_TIMEOUT_MS) return { valid: false }

  return { valid: true, createdAt }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Only protect /admin routes (except /admin/login)
  if (!pathname.startsWith("/admin") || pathname === "/admin/login") {
    return NextResponse.next()
  }

  const secret = process.env.ADMIN_PASSWORD
  if (!secret) {
    return NextResponse.redirect(new URL("/admin/login", request.url))
  }

  const token = request.cookies.get(COOKIE_NAME)?.value
  if (!token) {
    return NextResponse.redirect(new URL("/admin/login", request.url))
  }

  const result = await verifyToken(token, secret)
  if (!result.valid || !result.createdAt) {
    return NextResponse.redirect(new URL("/admin/login", request.url))
  }

  // Refresh session: update lastActivity and re-sign (rolling idle timeout)
  const now = Date.now().toString()
  const newPayload = `${result.createdAt}:${now}`
  const newSignature = await hmacSign(newPayload, secret)
  const newToken = `${newPayload}.${newSignature}`

  const response = NextResponse.next()
  response.cookies.set(COOKIE_NAME, newToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: IDLE_TIMEOUT_S,
    path: "/",
  })

  return response
}

export const config = {
  matcher: ["/admin/:path*"],
}
