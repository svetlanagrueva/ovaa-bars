import { describe, it, expect, vi, beforeEach } from "vitest"
import { createSupabaseMock, resetSupabaseMock, createUpdateChain } from "./helpers/supabase-mock"

// ── Mocks ─────────────────────────────────────────────────────────────────

type SendArgs = { from: string; to: string; subject: string; html?: string; text?: string }
const mockResendSend = vi.fn((_args: SendArgs) =>
  Promise.resolve({ data: { id: "msg_test" }, error: null }),
)
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: mockResendSend }
  },
}))

const mockSupabase = createSupabaseMock()
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
}))

vi.mock("@/lib/env", () => ({
  requireEnv: (name: string) => process.env[name] ?? `test-${name}`,
}))

vi.mock("@/lib/unsubscribe", () => ({
  buildUnsubscribeUrl: (email: string) => `https://eggorigin.com/unsubscribe?token=fake&email=${encodeURIComponent(email)}`,
}))

type BuilderFn = (input: unknown) => { html: string; text: string }
const mockBuildReviewRequest = vi.fn<BuilderFn>(() => ({
  html: "<review-request-html />", text: "review-request-text",
}))
const mockBuildCrossSell = vi.fn<BuilderFn>(() => ({
  html: "<cross-sell-html />", text: "cross-sell-text",
}))
vi.mock("@/lib/email-template", () => ({
  buildReviewRequestEmail: (input: unknown) => mockBuildReviewRequest(input),
  buildCrossSellEmail: (input: unknown) => mockBuildCrossSell(input),
}))

import { GET } from "@/app/api/cron/marketing-emails/route"

const VALID_SECRET = "cron-shared-secret-abc123"

function makeRequest(authHeader: string | null = `Bearer ${VALID_SECRET}`): Request {
  const headers: Record<string, string> = {}
  if (authHeader !== null) headers.authorization = authHeader
  return new Request("http://localhost/api/cron/marketing-emails", {
    method: "GET",
    headers,
  })
}

function fakeJob(overrides: Record<string, unknown> = {}) {
  return {
    log_id: 101,
    order_id: "11111111-2222-3333-4444-555555555555",
    email: "customer@example.com",
    first_name: "Иван",
    items: [
      { productId: "egg-origin-dark-chocolate-box", productName: "Тъмен Шоколад", quantity: 2, priceInCents: 2570 },
    ],
    total_amount: 5140,
    payment_method: "card",
    email_type: "review_request",
    attempt_count: 0,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  resetSupabaseMock(mockSupabase)
  mockResendSend.mockClear()
  mockResendSend.mockImplementation(() =>
    Promise.resolve({ data: { id: "msg_test" }, error: null }) as never,
  )
  mockBuildReviewRequest.mockClear()
  mockBuildReviewRequest.mockImplementation(() => ({
    html: "<review-request-html />", text: "review-request-text",
  }))
  mockBuildCrossSell.mockClear()
  mockBuildCrossSell.mockImplementation(() => ({
    html: "<cross-sell-html />", text: "cross-sell-text",
  }))
  process.env.CRON_SECRET = VALID_SECRET
  process.env.RESEND_API_KEY = "re_test"
  process.env.EMAIL_FROM = "Egg Origin <noreply@eggorigin.com>"
})

// ── Auth ──────────────────────────────────────────────────────────────────

describe("Marketing-emails cron — auth", () => {
  it("rejects when CRON_SECRET env var is unset", async () => {
    delete process.env.CRON_SECRET
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
    expect(mockSupabase.rpc).not.toHaveBeenCalled()
  })

  it("rejects when Authorization header is missing", async () => {
    const res = await GET(makeRequest(null))
    expect(res.status).toBe(401)
    expect(mockSupabase.rpc).not.toHaveBeenCalled()
  })

  it("rejects when Authorization token is wrong", async () => {
    const res = await GET(makeRequest("Bearer wrong-secret-of-similar-length"))
    expect(res.status).toBe(401)
    expect(mockSupabase.rpc).not.toHaveBeenCalled()
  })

  it("rejects when Authorization header is the right shape but different length (timing-safe early-out)", async () => {
    const res = await GET(makeRequest("Bearer short"))
    expect(res.status).toBe(401)
    expect(mockSupabase.rpc).not.toHaveBeenCalled()
  })

  it("proceeds with valid Bearer secret", async () => {
    mockSupabase.rpc = vi.fn(() =>
      Promise.resolve({ data: [], error: null }),
    ) as never

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      "claim_marketing_emails",
      expect.objectContaining({ p_limit: 50 }),
    )
  })

  it("rejects when RESEND_API_KEY is unset (after auth passes)", async () => {
    delete process.env.RESEND_API_KEY
    const res = await GET(makeRequest())
    expect(res.status).toBe(500)
  })
})

// ── claim/retry/skip behavior ─────────────────────────────────────────────

describe("Marketing-emails cron — RPC + send loop", () => {
  function mockClaimReturns(jobs: unknown[]) {
    mockSupabase.rpc = vi.fn(() =>
      Promise.resolve({ data: jobs, error: null }),
    ) as never
  }

  it("returns 500 when claim_marketing_emails RPC errors", async () => {
    mockSupabase.rpc = vi.fn(() =>
      Promise.resolve({ data: null, error: { message: "RPC down" } }),
    ) as never

    const res = await GET(makeRequest())
    expect(res.status).toBe(500)
    expect(mockResendSend).not.toHaveBeenCalled()
  })

  it("returns zero counts when no jobs are claimed", async () => {
    mockClaimReturns([])

    const res = await GET(makeRequest())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({ sent: 0, failed: 0, skipped: 0 })
    expect(mockResendSend).not.toHaveBeenCalled()
  })

  it("sends review_request emails and updates marketing_email_log to status='sent'", async () => {
    mockClaimReturns([fakeJob({ log_id: 101, email_type: "review_request" })])

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ sent: 1, failed: 0, skipped: 0 })

    expect(mockBuildReviewRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "11111111-2222-3333-4444-555555555555",
        firstName: "Иван",
        unsubscribeUrl: expect.stringContaining("/unsubscribe"),
      }),
    )
    expect(mockResendSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "customer@example.com",
        subject: expect.stringContaining("11111111"),
        html: "<review-request-html />",
      }),
    )

    // Log row marked sent with provider_message_id from Resend
    const updateCalls = (mockSupabase.update as ReturnType<typeof vi.fn>).mock.calls
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0][0]).toEqual(
      expect.objectContaining({
        status: "sent",
        provider_message_id: "msg_test",
        claimed_at: null,
        error_message: null,
      }),
    )
  })

  it("routes cross_sell email_type to the cross-sell template with purchasedProductIds", async () => {
    mockClaimReturns([fakeJob({
      log_id: 202,
      email_type: "cross_sell",
      items: [
        { productId: "egg-origin-dark-chocolate-box", productName: "Тъмен", quantity: 1, priceInCents: 2570 },
        { productId: "egg-origin-white-chocolate-raspberry-box", productName: "Бял", quantity: 1, priceInCents: 2570 },
      ],
    })])

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)

    expect(mockBuildCrossSell).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: "Иван",
        purchasedProductIds: [
          "egg-origin-dark-chocolate-box",
          "egg-origin-white-chocolate-raspberry-box",
        ],
        unsubscribeUrl: expect.any(String),
      }),
    )
    expect(mockResendSend).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Време е за презареждане!",
        html: "<cross-sell-html />",
      }),
    )
  })

  it("marks unknown email_type as 'skipped' without calling Resend", async () => {
    mockClaimReturns([fakeJob({ log_id: 303, email_type: "unknown_type_xyz" })])

    const res = await GET(makeRequest())
    const body = await res.json()
    expect(body).toEqual({ sent: 0, failed: 0, skipped: 1 })
    expect(mockResendSend).not.toHaveBeenCalled()

    const updateCalls = (mockSupabase.update as ReturnType<typeof vi.fn>).mock.calls
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0][0]).toEqual(
      expect.objectContaining({
        status: "skipped",
        error_message: expect.stringContaining("Unknown email type"),
        claimed_at: null,
      }),
    )
  })

  it("marks Resend failure as status='failed' with the error message and continues processing", async () => {
    mockClaimReturns([
      fakeJob({ log_id: 401, email_type: "review_request" }),
      fakeJob({ log_id: 402, email_type: "review_request", email: "ok@example.com" }),
    ])
    // First send fails, second succeeds — proves the loop continues past failure.
    mockResendSend
      .mockImplementationOnce(() => Promise.reject(new Error("Resend 503 service unavailable")))
      .mockImplementationOnce(() =>
        Promise.resolve({ data: { id: "msg_b" }, error: null }) as never,
      )
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    const res = await GET(makeRequest())
    const body = await res.json()
    expect(body).toEqual({ sent: 1, failed: 1, skipped: 0 })

    const updateCalls = (mockSupabase.update as ReturnType<typeof vi.fn>).mock.calls
    expect(updateCalls).toHaveLength(2)
    expect(updateCalls[0][0]).toEqual(
      expect.objectContaining({
        status: "failed",
        error_message: expect.stringContaining("Resend 503"),
        claimed_at: null,
      }),
    )
    expect(updateCalls[1][0]).toEqual(
      expect.objectContaining({ status: "sent", provider_message_id: "msg_b" }),
    )
    errSpy.mockRestore()
  })

  it("counts mixed sent/failed/skipped across one batch", async () => {
    mockClaimReturns([
      fakeJob({ log_id: 1, email_type: "review_request" }),
      fakeJob({ log_id: 2, email_type: "cross_sell" }),
      fakeJob({ log_id: 3, email_type: "garbage_type" }),
      fakeJob({ log_id: 4, email_type: "review_request" }),
    ])
    mockResendSend
      .mockImplementationOnce(() => Promise.resolve({ data: { id: "a" }, error: null }) as never)
      .mockImplementationOnce(() => Promise.resolve({ data: { id: "b" }, error: null }) as never)
      .mockImplementationOnce(() => Promise.reject(new Error("Resend 500")))
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    const res = await GET(makeRequest())
    const body = await res.json()
    expect(body).toEqual({ sent: 2, failed: 1, skipped: 1 })
    errSpy.mockRestore()
  })

  it("forwards the Bulgarian subject 'Как Ви се стори поръчка #...' for review_request", async () => {
    mockClaimReturns([fakeJob({ email_type: "review_request" })])

    await GET(makeRequest())

    expect(mockResendSend).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringMatching(/^Как Ви се стори поръчка #[0-9a-f]{8}\?$/),
      }),
    )
  })
})
