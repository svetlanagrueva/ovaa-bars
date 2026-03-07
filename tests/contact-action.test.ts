import { describe, it, expect, vi, beforeEach } from "vitest"

const mockSend = vi.fn(() => Promise.resolve({ id: "test-email" }))

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: mockSend }
  },
}))

vi.mock("next/headers", () => ({
  headers: vi.fn(() => Promise.resolve({
    get: (name: string) => name === "x-forwarded-for" ? "127.0.0.1" : null,
  })),
}))

describe("sendContactMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it("sends email with correct parameters", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_123")

    const { sendContactMessage } = await import("@/app/actions/contact")

    const result = await sendContactMessage({
      name: "Иван",
      email: "ivan@test.com",
      subject: "Въпрос",
      message: "Здравейте, имам въпрос.",
    })

    expect(result).toEqual({ success: true })
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "info@ovvasculpt.com",
        replyTo: "ivan@test.com",
        subject: "Contact: Въпрос",
      })
    )
  })

  it("uses name in subject when no subject provided", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_123")

    const { sendContactMessage } = await import("@/app/actions/contact")

    await sendContactMessage({
      name: "Мария",
      email: "maria@test.com",
      subject: "",
      message: "Здравейте!",
    })

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Contact from Мария",
      })
    )
  })

  it("throws when required fields are missing", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_123")

    const { sendContactMessage } = await import("@/app/actions/contact")

    await expect(
      sendContactMessage({ name: "", email: "test@test.com", subject: "", message: "Hello" })
    ).rejects.toThrow("Missing required fields")

    await expect(
      sendContactMessage({ name: "Test", email: "", subject: "", message: "Hello" })
    ).rejects.toThrow("Missing required fields")

    await expect(
      sendContactMessage({ name: "Test", email: "test@test.com", subject: "", message: "" })
    ).rejects.toThrow("Missing required fields")
  })

  it("throws when RESEND_API_KEY is not set", async () => {
    vi.stubEnv("RESEND_API_KEY", "")

    const { sendContactMessage } = await import("@/app/actions/contact")

    await expect(
      sendContactMessage({
        name: "Test",
        email: "test@test.com",
        subject: "",
        message: "Hello",
      })
    ).rejects.toThrow("Email service not configured")
  })
})
