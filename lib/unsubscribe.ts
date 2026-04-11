import { createHmac, timingSafeEqual } from "crypto"
import { getBaseUrl } from "@/lib/constants"

let _cachedSecret: string | null = null

function getSecret(): string {
  if (_cachedSecret) return _cachedSecret
  const s = process.env.UNSUBSCRIBE_SECRET
  if (!s) throw new Error("UNSUBSCRIBE_SECRET env var is required")
  _cachedSecret = s
  return s
}

export function generateUnsubscribeToken(email: string): string {
  const payload = `${email.toLowerCase()}|${Math.floor(Date.now() / 1000)}`
  const payloadB64 = Buffer.from(payload).toString("base64url")
  const sig = createHmac("sha256", getSecret()).update(payload).digest("base64url")
  return `${payloadB64}.${sig}`
}

export function verifyUnsubscribeToken(
  token: string,
  maxAgeDays = 90
): { email: string } | null {
  const dotIndex = token.indexOf(".")
  if (dotIndex === -1) return null

  const payloadB64 = token.slice(0, dotIndex)
  const sig = token.slice(dotIndex + 1)
  if (!payloadB64 || !sig) return null

  const payload = Buffer.from(payloadB64, "base64url").toString()
  const expectedSig = createHmac("sha256", getSecret()).update(payload).digest("base64url")

  // Constant-time comparison — prevent timing attacks
  const sigBuf = Buffer.from(sig)
  const expectedBuf = Buffer.from(expectedSig)
  if (sigBuf.length !== expectedBuf.length) return null
  if (!timingSafeEqual(sigBuf, expectedBuf)) return null

  const pipeIndex = payload.lastIndexOf("|")
  if (pipeIndex === -1) return null

  const email = payload.slice(0, pipeIndex)
  const ts = Number(payload.slice(pipeIndex + 1))
  if (!email || !ts || isNaN(ts)) return null

  // Check expiry
  if (Date.now() / 1000 - ts > maxAgeDays * 86400) return null

  return { email }
}

export function buildUnsubscribeUrl(email: string): string {
  const token = generateUnsubscribeToken(email)
  return `${getBaseUrl()}/unsubscribe?token=${token}`
}
