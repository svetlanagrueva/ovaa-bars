import { describe, it, expect, vi, beforeEach } from "vitest"
import { createHmac } from "crypto"

vi.mock("server-only", () => ({}))

const mockCookieStore = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
}

vi.mock("next/headers", () => ({
  cookies: vi.fn(() => Promise.resolve(mockCookieStore)),
}))

const TEST_SECRET = "test-admin-password-123"

function craftToken(createdAt: number, lastActivity: number): string {
  const payload = `${createdAt}:${lastActivity}`
  const signature = createHmac("sha256", TEST_SECRET).update(payload).digest("hex")
  return `${payload}.${signature}`
}

describe("admin session management", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    vi.stubEnv("ADMIN_PASSWORD", TEST_SECRET)
  })

  describe("createAdminSession", () => {
    it("sets cookie with correct token format and security options", async () => {
      const { createAdminSession } = await import("@/lib/admin-auth")

      await createAdminSession()

      expect(mockCookieStore.set).toHaveBeenCalledOnce()
      const [name, token, options] = mockCookieStore.set.mock.calls[0]

      expect(name).toBe("admin-session")
      expect(options.httpOnly).toBe(true)
      expect(options.sameSite).toBe("lax")
      expect(options.maxAge).toBe(60 * 30)
      expect(options.path).toBe("/")

      // Token format: createdAt:lastActivity.signature
      const dotIndex = token.lastIndexOf(".")
      expect(dotIndex).toBeGreaterThan(0)
      const payload = token.slice(0, dotIndex)
      const parts = payload.split(":")
      expect(parts).toHaveLength(2)
      // createdAt and lastActivity should be equal at creation
      expect(parts[0]).toBe(parts[1])
    })

    it("generates a valid HMAC signature", async () => {
      const { createAdminSession } = await import("@/lib/admin-auth")

      await createAdminSession()

      const token = mockCookieStore.set.mock.calls[0][1] as string
      const dotIndex = token.lastIndexOf(".")
      const payload = token.slice(0, dotIndex)
      const signature = token.slice(dotIndex + 1)

      const expectedSig = createHmac("sha256", TEST_SECRET).update(payload).digest("hex")
      expect(signature).toBe(expectedSig)
    })
  })

  describe("validateAdminSession", () => {
    it("returns true for a freshly created session", async () => {
      const { validateAdminSession } = await import("@/lib/admin-auth")

      const now = Date.now()
      const token = craftToken(now, now)
      mockCookieStore.get.mockReturnValue({ value: token })

      expect(await validateAdminSession()).toBe(true)
    })

    it("returns false when no cookie exists", async () => {
      const { validateAdminSession } = await import("@/lib/admin-auth")
      mockCookieStore.get.mockReturnValue(undefined)

      expect(await validateAdminSession()).toBe(false)
    })

    it("returns false for tampered signature", async () => {
      const { validateAdminSession } = await import("@/lib/admin-auth")

      const token = craftToken(Date.now(), Date.now())
      const tampered = token.slice(0, -6) + "abcdef"
      mockCookieStore.get.mockReturnValue({ value: tampered })

      expect(await validateAdminSession()).toBe(false)
    })

    it("returns false for token signed with wrong secret", async () => {
      const { validateAdminSession } = await import("@/lib/admin-auth")

      const now = Date.now()
      const payload = `${now}:${now}`
      const wrongSig = createHmac("sha256", "wrong-secret").update(payload).digest("hex")
      mockCookieStore.get.mockReturnValue({ value: `${payload}.${wrongSig}` })

      expect(await validateAdminSession()).toBe(false)
    })

    it("returns false when session exceeds absolute max age (8 hours)", async () => {
      const { validateAdminSession } = await import("@/lib/admin-auth")

      const nineHoursAgo = Date.now() - 9 * 60 * 60 * 1000
      const token = craftToken(nineHoursAgo, Date.now())
      mockCookieStore.get.mockReturnValue({ value: token })

      expect(await validateAdminSession()).toBe(false)
    })

    it("returns true when session is within absolute max age", async () => {
      const { validateAdminSession } = await import("@/lib/admin-auth")

      const sevenHoursAgo = Date.now() - 7 * 60 * 60 * 1000
      const token = craftToken(sevenHoursAgo, Date.now())
      mockCookieStore.get.mockReturnValue({ value: token })

      expect(await validateAdminSession()).toBe(true)
    })

    it("returns false when idle timeout exceeded (30 minutes)", async () => {
      const { validateAdminSession } = await import("@/lib/admin-auth")

      const now = Date.now()
      const thirtyOneMinutesAgo = now - 31 * 60 * 1000
      const token = craftToken(now, thirtyOneMinutesAgo)
      mockCookieStore.get.mockReturnValue({ value: token })

      expect(await validateAdminSession()).toBe(false)
    })

    it("returns true when within idle timeout", async () => {
      const { validateAdminSession } = await import("@/lib/admin-auth")

      const now = Date.now()
      const twentyMinutesAgo = now - 20 * 60 * 1000
      const token = craftToken(now, twentyMinutesAgo)
      mockCookieStore.get.mockReturnValue({ value: token })

      expect(await validateAdminSession()).toBe(true)
    })

    it("returns false for token without dot separator", async () => {
      const { validateAdminSession } = await import("@/lib/admin-auth")
      mockCookieStore.get.mockReturnValue({ value: "nodothere" })

      expect(await validateAdminSession()).toBe(false)
    })

    it("returns false for token with single timestamp (old format)", async () => {
      const { validateAdminSession } = await import("@/lib/admin-auth")

      // Old format: timestamp.signature (without colon-separated lastActivity)
      const timestamp = Date.now().toString()
      const sig = createHmac("sha256", TEST_SECRET).update(timestamp).digest("hex")
      mockCookieStore.get.mockReturnValue({ value: `${timestamp}.${sig}` })

      expect(await validateAdminSession()).toBe(false)
    })

    it("returns false for empty token", async () => {
      const { validateAdminSession } = await import("@/lib/admin-auth")
      mockCookieStore.get.mockReturnValue({ value: "" })

      expect(await validateAdminSession()).toBe(false)
    })
  })

  describe("destroyAdminSession", () => {
    it("deletes the session cookie", async () => {
      const { destroyAdminSession } = await import("@/lib/admin-auth")

      await destroyAdminSession()

      expect(mockCookieStore.delete).toHaveBeenCalledWith("admin-session")
    })
  })
})
