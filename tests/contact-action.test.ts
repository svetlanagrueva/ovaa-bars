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
      lastName: "Петров",
      email: "ivan@test.com",
      message: "Здравейте, имам въпрос.",
    })

    expect(result).toEqual({ success: true })
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "info@eggorigin.com",
        replyTo: "ivan@test.com",
        subject: "Иван Петров - запитване",
        text: "Name: Иван Петров\nEmail: ivan@test.com\n\nЗдравейте, имам въпрос.",
      })
    )
  })

  it("throws when required fields are missing", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_123")

    const { sendContactMessage } = await import("@/app/actions/contact")

    await expect(
      sendContactMessage({ name: "", lastName: "Test", email: "test@test.com", message: "Hello" })
    ).rejects.toThrow("Missing required fields")

    await expect(
      sendContactMessage({ name: "Test", lastName: "", email: "test@test.com", message: "Hello" })
    ).rejects.toThrow("Missing required fields")

    await expect(
      sendContactMessage({ name: "Test", lastName: "Test", email: "", message: "Hello" })
    ).rejects.toThrow("Missing required fields")

    await expect(
      sendContactMessage({ name: "Test", lastName: "Test", email: "test@test.com", message: "" })
    ).rejects.toThrow("Missing required fields")
  })

  it("throws when RESEND_API_KEY is not set", async () => {
    vi.stubEnv("RESEND_API_KEY", "")

    const { sendContactMessage } = await import("@/app/actions/contact")

    await expect(
      sendContactMessage({
        name: "Test",
        lastName: "Test",
        email: "test@test.com",
        message: "Hello",
      })
    ).rejects.toThrow("Email service not configured")
  })
})
