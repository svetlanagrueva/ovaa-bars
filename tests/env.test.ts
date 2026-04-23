import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { checkEnvAtBoot, requireEnv, MissingEnvError } from "@/lib/env"

// Full set of required vars — test must populate all of these for the "happy
// path" tests and delete individual ones to exercise specific failures.
const HARD_REQUIRED = [
  "ADMIN_PASSWORD",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "UNSUBSCRIBE_SECRET",
  "CRON_SECRET",
  "EMAIL_FROM",
] as const

const EXPECTED_SOFT = [
  "RESEND_API_KEY",
  "ADMIN_EMAIL",
  "SPEEDY_USERNAME",
  "SPEEDY_PASSWORD",
  "ECONT_USERNAME",
  "ECONT_PASSWORD",
  "SELLER_COMPANY_NAME",
  "SELLER_MOL",
  "SELLER_ADDRESS",
  "SELLER_CITY",
  "SELLER_POSTAL_CODE",
  "SELLER_PHONE",
  "SELLER_EMAIL",
] as const

const snapshot: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const name of [...HARD_REQUIRED, ...EXPECTED_SOFT]) {
    snapshot[name] = process.env[name]
    process.env[name] = `test-${name.toLowerCase()}`
  }
})

afterEach(() => {
  for (const [name, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

describe("checkEnvAtBoot", () => {
  it("passes when all vars are set", () => {
    expect(() => checkEnvAtBoot()).not.toThrow()
  })

  it("throws MissingEnvError listing every missing hard-required var", () => {
    delete process.env.ADMIN_PASSWORD
    delete process.env.STRIPE_WEBHOOK_SECRET

    try {
      checkEnvAtBoot()
      throw new Error("should have thrown")
    } catch (err) {
      expect(err).toBeInstanceOf(MissingEnvError)
      expect((err as MissingEnvError).names).toEqual([
        "ADMIN_PASSWORD",
        "STRIPE_WEBHOOK_SECRET",
      ])
    }
  })

  it("warns (does not throw) when only soft-expected vars are missing", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const prevVercelEnv = process.env.VERCEL_ENV
    // Leave NODE_ENV as-is (vitest's "test") so warn path fires
    delete process.env.VERCEL_ENV
    delete process.env.RESEND_API_KEY
    delete process.env.ADMIN_EMAIL

    expect(() => checkEnvAtBoot()).not.toThrow()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("RESEND_API_KEY"))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("ADMIN_EMAIL"))
    expect(errSpy).not.toHaveBeenCalled()

    if (prevVercelEnv !== undefined) process.env.VERCEL_ENV = prevVercelEnv
    warnSpy.mockRestore()
    errSpy.mockRestore()
  })

  it("logs missing soft vars at error level in production (via VERCEL_ENV)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const prevVercelEnv = process.env.VERCEL_ENV
    process.env.VERCEL_ENV = "production"
    delete process.env.RESEND_API_KEY

    checkEnvAtBoot()
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("RESEND_API_KEY"))
    expect(warnSpy).not.toHaveBeenCalled()

    if (prevVercelEnv !== undefined) process.env.VERCEL_ENV = prevVercelEnv
    else delete process.env.VERCEL_ENV
    warnSpy.mockRestore()
    errSpy.mockRestore()
  })
})

describe("requireEnv", () => {
  it("returns the value when set", () => {
    process.env.FOO = "bar"
    expect(requireEnv("FOO")).toBe("bar")
    delete process.env.FOO
  })

  it("throws MissingEnvError when unset or empty", () => {
    delete process.env.MISSING_VAR
    expect(() => requireEnv("MISSING_VAR")).toThrow(MissingEnvError)

    process.env.EMPTY_VAR = ""
    expect(() => requireEnv("EMPTY_VAR")).toThrow(MissingEnvError)
    delete process.env.EMPTY_VAR
  })
})
