import "server-only"
import { cookies } from "next/headers"
import { createHmac, timingSafeEqual } from "crypto"

const COOKIE_NAME = "admin-session"
const SESSION_MAX_AGE = 60 * 60 * 8 // 8 hours (absolute max)
const IDLE_TIMEOUT = 60 * 30 // 30 minutes of inactivity

function getSecret(): string {
  const password = process.env.ADMIN_PASSWORD
  if (!password) throw new Error("ADMIN_PASSWORD env var is not set")
  return password
}

function sign(value: string): string {
  return createHmac("sha256", getSecret()).update(value).digest("hex")
}

function verify(value: string, signature: string): boolean {
  const expected = sign(value)
  if (expected.length !== signature.length) return false
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
}

// Token format: "createdAt:lastActivity.signature"
// createdAt  — checked against SESSION_MAX_AGE (absolute limit)
// lastActivity — checked against IDLE_TIMEOUT (inactivity limit)

export async function createAdminSession() {
  const now = Date.now().toString()
  const payload = `${now}:${now}`
  const signature = sign(payload)
  const token = `${payload}.${signature}`

  const cookieStore = await cookies()
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: IDLE_TIMEOUT,
    path: "/",
  })
}

export async function validateAdminSession(): Promise<boolean> {
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  if (!token) return false

  const dotIndex = token.lastIndexOf(".")
  if (dotIndex === -1) return false

  const payload = token.slice(0, dotIndex)
  const signature = token.slice(dotIndex + 1)
  if (!payload || !signature) return false

  if (!verify(payload, signature)) return false

  const parts = payload.split(":")
  if (parts.length !== 2) return false

  const [createdAt, lastActivity] = parts
  const now = Date.now()

  // Absolute session lifetime
  if (now - parseInt(createdAt, 10) > SESSION_MAX_AGE * 1000) return false

  // Idle timeout — enforced server-side in addition to cookie maxAge
  if (now - parseInt(lastActivity, 10) > IDLE_TIMEOUT * 1000) return false

  return true
}

export async function destroyAdminSession() {
  const cookieStore = await cookies()
  cookieStore.delete(COOKIE_NAME)
}
