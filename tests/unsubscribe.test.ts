import { describe, it, expect, vi, beforeEach } from "vitest"

vi.stubEnv("UNSUBSCRIBE_SECRET", "test-secret-key-for-unit-tests")

describe("unsubscribe tokens", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("generates and verifies a valid token", async () => {
    const { generateUnsubscribeToken, verifyUnsubscribeToken } = await import("@/lib/unsubscribe")

    const token = generateUnsubscribeToken("Test@Example.com")
    expect(token).toContain(".")
    expect(token.split(".")).toHaveLength(2)

    const result = verifyUnsubscribeToken(token)
    expect(result).not.toBeNull()
    expect(result!.email).toBe("test@example.com") // lowercased
  })

  it("rejects a tampered token", async () => {
    const { generateUnsubscribeToken, verifyUnsubscribeToken } = await import("@/lib/unsubscribe")

    const token = generateUnsubscribeToken("user@test.com")
    const tampered = token.slice(0, -3) + "xxx"

    expect(verifyUnsubscribeToken(tampered)).toBeNull()
  })

  it("rejects a token with no dot separator", async () => {
    const { verifyUnsubscribeToken } = await import("@/lib/unsubscribe")

    expect(verifyUnsubscribeToken("nodothere")).toBeNull()
  })

  it("rejects an empty string", async () => {
    const { verifyUnsubscribeToken } = await import("@/lib/unsubscribe")

    expect(verifyUnsubscribeToken("")).toBeNull()
  })

  it("rejects an expired token", async () => {
    const { verifyUnsubscribeToken } = await import("@/lib/unsubscribe")
    const { createHmac } = await import("crypto")

    // Manually build a token with a timestamp 91 days ago
    const email = "old@test.com"
    const ts = Math.floor(Date.now() / 1000) - 91 * 86400
    const payload = `${email}|${ts}`
    const payloadB64 = Buffer.from(payload).toString("base64url")
    const sig = createHmac("sha256", "test-secret-key-for-unit-tests")
      .update(payload)
      .digest("base64url")
    const expiredToken = `${payloadB64}.${sig}`

    expect(verifyUnsubscribeToken(expiredToken)).toBeNull()
  })

  it("accepts a token within expiry window", async () => {
    const { verifyUnsubscribeToken } = await import("@/lib/unsubscribe")
    const { createHmac } = await import("crypto")

    // Token from 89 days ago — still valid
    const email = "recent@test.com"
    const ts = Math.floor(Date.now() / 1000) - 89 * 86400
    const payload = `${email}|${ts}`
    const payloadB64 = Buffer.from(payload).toString("base64url")
    const sig = createHmac("sha256", "test-secret-key-for-unit-tests")
      .update(payload)
      .digest("base64url")
    const validToken = `${payloadB64}.${sig}`

    const result = verifyUnsubscribeToken(validToken)
    expect(result).not.toBeNull()
    expect(result!.email).toBe("recent@test.com")
  })

  it("builds a complete unsubscribe URL", async () => {
    const { buildUnsubscribeUrl } = await import("@/lib/unsubscribe")

    const url = buildUnsubscribeUrl("user@test.com")
    expect(url).toMatch(/^http:\/\/localhost:3000\/unsubscribe\?token=.+\..+$/)
  })

  it("throws when UNSUBSCRIBE_SECRET is missing", async () => {
    vi.stubEnv("UNSUBSCRIBE_SECRET", "")

    // Force re-import to clear cached secret
    vi.resetModules()
    const { generateUnsubscribeToken } = await import("@/lib/unsubscribe")

    expect(() => generateUnsubscribeToken("test@test.com")).toThrow(
      "UNSUBSCRIBE_SECRET env var is required"
    )
  })
})
