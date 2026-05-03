import { describe, it, expect, vi, beforeEach } from "vitest"
import { createSupabaseMock, resetSupabaseMock, mockThenableResult } from "./helpers/supabase-mock"

// ── Mocks ─────────────────────────────────────────────────────────────────

type StatusFn = (trackingNumber: string) => Promise<{ delivered: boolean; deliveredAt?: string | null; rawStatus?: string; rawEventCode?: string; source: string }>
const mockSpeedyStatus = vi.fn<StatusFn>()
const mockEcontStatus = vi.fn<StatusFn>()
vi.mock("@/lib/speedy", () => ({
  getShipmentStatus: (n: string) => mockSpeedyStatus(n),
}))
vi.mock("@/lib/econt", () => ({
  getShipmentStatus: (n: string) => mockEcontStatus(n),
}))

type ConfirmDeliveryFn = (trackingNumber: string, deliveredAt: string, courier: string) => Promise<{ ok: boolean }>
const mockConfirmDelivery = vi.fn<ConfirmDeliveryFn>(() => Promise.resolve({ ok: true }))
vi.mock("@/lib/delivery-confirmation", () => ({
  confirmDeliveryByTrackingNumber: (a: string, b: string, c: string) => mockConfirmDelivery(a, b, c),
}))

const mockSendDeliveryEmail = vi.fn((_order: unknown) => Promise.resolve())
vi.mock("@/lib/email-sender", () => ({
  sendDeliveryEmail: (order: unknown) => mockSendDeliveryEmail(order),
}))

const mockSupabase = createSupabaseMock()
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
}))

import { GET } from "@/app/api/cron/delivery-checks/route"

const VALID_SECRET = "cron-delivery-secret-xyz"

function makeRequest(authHeader: string | null = `Bearer ${VALID_SECRET}`): Request {
  const headers: Record<string, string> = {}
  if (authHeader !== null) headers.authorization = authHeader
  return new Request("http://localhost/api/cron/delivery-checks", {
    method: "GET",
    headers,
  })
}

// The candidate-shipped query terminates as a thenable on `.limit(20)`,
// and the email-retry query terminates on `.limit(10)`. Tests queue both
// returns via `mockSupabase.limit.mockReturnValueOnce(thenable)` in order.
function armCandidatesAndEmails(opts: {
  candidates: unknown[]
  emailPending?: unknown[]
}) {
  // 1st .limit(): candidate query
  mockSupabase.limit.mockReturnValueOnce(
    mockThenableResult(opts.candidates, null) as never,
  )
  // 2nd .limit(): email-retry query
  mockSupabase.limit.mockReturnValueOnce(
    mockThenableResult(opts.emailPending ?? [], null) as never,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  resetSupabaseMock(mockSupabase)
  mockSpeedyStatus.mockReset()
  mockEcontStatus.mockReset()
  mockConfirmDelivery.mockReset()
  mockConfirmDelivery.mockImplementation(() => Promise.resolve({ ok: true }) as never)
  mockSendDeliveryEmail.mockReset()
  mockSendDeliveryEmail.mockImplementation(() => Promise.resolve())
  process.env.CRON_SECRET = VALID_SECRET
})

// ── Auth ──────────────────────────────────────────────────────────────────

describe("Delivery-checks cron — auth", () => {
  it("rejects when CRON_SECRET env var is unset", async () => {
    delete process.env.CRON_SECRET
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
    expect(mockSupabase.from).not.toHaveBeenCalled()
  })

  it("rejects when Authorization header is missing", async () => {
    const res = await GET(makeRequest(null))
    expect(res.status).toBe(401)
  })

  it("rejects when Authorization token is wrong (same length, different content)", async () => {
    // Match length so the inequality is detected by timingSafeEqual itself,
    // not the early-exit length check.
    const fake = `Bearer ${"x".repeat(VALID_SECRET.length)}`
    const res = await GET(makeRequest(fake))
    expect(res.status).toBe(401)
  })

  it("rejects when Authorization token is the wrong length (early-out before timingSafeEqual)", async () => {
    const res = await GET(makeRequest("Bearer way-too-short"))
    expect(res.status).toBe(401)
  })

  it("proceeds with valid Bearer secret", async () => {
    armCandidatesAndEmails({ candidates: [], emailPending: [] })
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ checked: 0, delivered: 0, emailRetries: 0, failed: 0 })
  })
})

// ── Candidate processing ──────────────────────────────────────────────────

describe("Delivery-checks cron — candidate query + cursor", () => {
  it("returns 500 when the candidate query errors", async () => {
    mockSupabase.limit.mockReturnValueOnce(
      mockThenableResult(null, { message: "DB down" }) as never,
    )
    const res = await GET(makeRequest())
    expect(res.status).toBe(500)
  })

  it("calls Speedy for speedy-office candidates and confirms delivery when courier reports delivered", async () => {
    armCandidatesAndEmails({
      candidates: [
        { id: "ord-1", tracking_number: "SPEEDY-1", logistics_partner: "speedy-office" },
      ],
    })
    mockSpeedyStatus.mockResolvedValueOnce({
      delivered: true,
      deliveredAt: "2026-04-25T10:00:00.000Z",
      rawStatus: "delivered",
      rawEventCode: "-14",
      source: "speedy",
    })

    const res = await GET(makeRequest())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({ checked: 1, delivered: 1, emailRetries: 0, failed: 0 })

    expect(mockSpeedyStatus).toHaveBeenCalledWith("SPEEDY-1")
    expect(mockEcontStatus).not.toHaveBeenCalled()

    // Cursor advanced for this order
    const updateCalls = (mockSupabase.update as ReturnType<typeof vi.fn>).mock.calls
    expect(updateCalls.some((c) => "delivery_status_checked_at" in (c[0] as object))).toBe(true)

    // Delivery confirmation called with courier-reported timestamp
    expect(mockConfirmDelivery).toHaveBeenCalledWith(
      "SPEEDY-1",
      "2026-04-25T10:00:00.000Z",
      "speedy",
    )
  })

  it("routes econt-office to Econt status and skips delivery confirmation when not yet delivered", async () => {
    armCandidatesAndEmails({
      candidates: [
        { id: "ord-2", tracking_number: "ECONT-1", logistics_partner: "econt-office" },
      ],
    })
    mockEcontStatus.mockResolvedValueOnce({
      delivered: false,
      rawStatus: "in_transit",
      source: "econt",
    })

    const res = await GET(makeRequest())
    const body = await res.json()
    expect(body).toEqual({ checked: 1, delivered: 0, emailRetries: 0, failed: 0 })

    expect(mockEcontStatus).toHaveBeenCalledWith("ECONT-1")
    expect(mockSpeedyStatus).not.toHaveBeenCalled()
    expect(mockConfirmDelivery).not.toHaveBeenCalled()

    // Cursor still advanced even when not delivered (successful API call counts).
    const updateCalls = (mockSupabase.update as ReturnType<typeof vi.fn>).mock.calls
    expect(updateCalls.some((c) => "delivery_status_checked_at" in (c[0] as object))).toBe(true)
  })

  it("infers deliveredAt to 'now' when courier doesn't report a timestamp", async () => {
    armCandidatesAndEmails({
      candidates: [
        { id: "ord-3", tracking_number: "SPEEDY-2", logistics_partner: "speedy-address" },
      ],
    })
    mockSpeedyStatus.mockResolvedValueOnce({
      delivered: true,
      deliveredAt: null,
      rawStatus: "delivered",
      source: "speedy",
    })

    await GET(makeRequest())

    expect(mockConfirmDelivery).toHaveBeenCalledTimes(1)
    const args = mockConfirmDelivery.mock.calls[0]
    expect(args[0]).toBe("SPEEDY-2")
    expect(typeof args[1]).toBe("string")
    expect((args[1] as string).length).toBeGreaterThan(10) // ISO timestamp
    expect(args[2]).toBe("speedy")
  })

  it("does NOT advance cursor when courier API throws — order stays near front for retry", async () => {
    armCandidatesAndEmails({
      candidates: [
        { id: "ord-4", tracking_number: "SPEEDY-3", logistics_partner: "speedy-office" },
      ],
    })
    mockSpeedyStatus.mockRejectedValueOnce(new Error("Speedy 502 bad gateway"))
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    const res = await GET(makeRequest())
    const body = await res.json()
    expect(body).toEqual({ checked: 0, delivered: 0, emailRetries: 0, failed: 1 })

    // No cursor-advance update fired (only updates would be deliveryconfirmation
    // which we mocked away). Cursor for retry is preserved.
    const updateCalls = (mockSupabase.update as ReturnType<typeof vi.fn>).mock.calls
    expect(
      updateCalls.filter((c) => "delivery_status_checked_at" in (c[0] as object)),
    ).toHaveLength(0)
    errSpy.mockRestore()
  })

  it("skips orders with unknown logistics_partner without contacting any courier", async () => {
    armCandidatesAndEmails({
      candidates: [
        { id: "ord-5", tracking_number: "WAT-1", logistics_partner: "future-courier-x" },
      ],
    })
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

    const res = await GET(makeRequest())
    const body = await res.json()
    expect(body).toEqual({ checked: 0, delivered: 0, emailRetries: 0, failed: 0 })

    expect(mockSpeedyStatus).not.toHaveBeenCalled()
    expect(mockEcontStatus).not.toHaveBeenCalled()
    expect(mockConfirmDelivery).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it("processes a mixed batch: 1 delivered + 1 not-delivered + 1 errored + 1 unknown-partner", async () => {
    armCandidatesAndEmails({
      candidates: [
        { id: "ord-A", tracking_number: "SPEEDY-A", logistics_partner: "speedy-office" },
        { id: "ord-B", tracking_number: "ECONT-B", logistics_partner: "econt-office" },
        { id: "ord-C", tracking_number: "SPEEDY-C", logistics_partner: "speedy-address" },
        { id: "ord-D", tracking_number: "WAT-D",   logistics_partner: "future-courier" },
      ],
    })
    mockSpeedyStatus
      .mockResolvedValueOnce({ delivered: true,  deliveredAt: "2026-04-25T08:00:00Z", rawStatus: "delivered", source: "speedy" }) // A
      .mockRejectedValueOnce(new Error("Speedy down")) // C
    mockEcontStatus.mockResolvedValueOnce({ delivered: false, rawStatus: "in_transit", source: "econt" }) // B
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

    const res = await GET(makeRequest())
    const body = await res.json()
    expect(body).toEqual({ checked: 2, delivered: 1, emailRetries: 0, failed: 1 })

    errSpy.mockRestore()
    warnSpy.mockRestore()
  })
})

// ── Email retry pass ──────────────────────────────────────────────────────

describe("Delivery-checks cron — email retry pass", () => {
  it("calls sendDeliveryEmail for each delivered order with delivery_email_sent_at IS NULL", async () => {
    armCandidatesAndEmails({
      candidates: [],
      emailPending: [
        { id: "ord-X", email: "x@example.com", first_name: "X", delivered_at: "2026-04-20T10:00:00Z" },
        { id: "ord-Y", email: "y@example.com", first_name: "Y", delivered_at: "2026-04-21T10:00:00Z" },
      ],
    })

    const res = await GET(makeRequest())
    const body = await res.json()
    expect(body).toEqual({ checked: 0, delivered: 0, emailRetries: 2, failed: 0 })

    expect(mockSendDeliveryEmail).toHaveBeenCalledTimes(2)
    expect(mockSendDeliveryEmail).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: "ord-X" }))
    expect(mockSendDeliveryEmail).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: "ord-Y" }))
  })

  it("returns emailRetries=0 when there are no pending emails", async () => {
    armCandidatesAndEmails({ candidates: [], emailPending: [] })

    const res = await GET(makeRequest())
    const body = await res.json()
    expect(body.emailRetries).toBe(0)
    expect(mockSendDeliveryEmail).not.toHaveBeenCalled()
  })
})
