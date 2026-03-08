import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock the server-only import (no-op in tests)
vi.mock("server-only", () => ({}))

// Mock the econt lib
const mockGetOffices = vi.fn()
vi.mock("@/lib/econt", () => ({
  getOffices: (...args: unknown[]) => mockGetOffices(...args),
}))

// Import after mocks
import { GET } from "@/app/api/econt/offices/route"
import { NextRequest } from "next/server"

function makeRequest(url = "http://localhost:3000/api/econt/offices", ip = "1.2.3.4") {
  return new NextRequest(url, {
    headers: { "x-forwarded-for": ip },
  })
}

describe("GET /api/econt/offices", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns slim office payload", async () => {
    mockGetOffices.mockResolvedValueOnce([
      {
        id: 1,
        name: "Офис Дружба",
        address: { city: { name: "София" }, fullAddress: "бул. Цариградско 115" },
      },
      {
        id: 2,
        name: "Офис Център",
        address: { city: { name: "Пловдив" }, fullAddress: "ул. Княз Борис 20" },
      },
    ])

    const res = await GET(makeRequest())
    const data = await res.json()

    expect(data.offices).toHaveLength(2)
    expect(data.offices[0]).toEqual({
      id: 1,
      name: "Офис Дружба",
      city: "София",
      fullAddress: "бул. Цариградско 115",
    })
    // Verify no extra fields leak through
    expect(data.offices[0]).not.toHaveProperty("phones")
    expect(data.offices[0]).not.toHaveProperty("address")
  })

  it("passes city query param to getOffices", async () => {
    mockGetOffices.mockResolvedValueOnce([])

    await GET(makeRequest("http://localhost:3000/api/econt/offices?city=София"))

    expect(mockGetOffices).toHaveBeenCalledWith("София")
  })

  it("passes undefined when no city param", async () => {
    mockGetOffices.mockResolvedValueOnce([])

    await GET(makeRequest())

    expect(mockGetOffices).toHaveBeenCalledWith(undefined)
  })

  it("returns 502 when Econt API fails", async () => {
    mockGetOffices.mockRejectedValueOnce(new Error("Econt API error: 500"))

    const res = await GET(makeRequest())
    const data = await res.json()

    expect(res.status).toBe(502)
    expect(data.offices).toEqual([])
    expect(data.error).toBe("Failed to fetch offices")
  })

  it("handles offices with missing address gracefully", async () => {
    mockGetOffices.mockResolvedValueOnce([
      {
        id: 3,
        name: "Офис без адрес",
        address: null,
      },
    ])

    const res = await GET(makeRequest())
    const data = await res.json()

    expect(data.offices[0]).toEqual({
      id: 3,
      name: "Офис без адрес",
      city: "",
      fullAddress: "",
    })
  })

  it("rate limits after 30 requests from same IP", async () => {
    mockGetOffices.mockResolvedValue([])

    const ip = "rate-limit-test-ip"

    // Send 30 requests — all should succeed
    for (let i = 0; i < 30; i++) {
      const res = await GET(makeRequest(undefined, ip))
      expect(res.status).toBe(200)
    }

    // 31st request should be rate limited
    const res = await GET(makeRequest(undefined, ip))
    expect(res.status).toBe(429)

    const data = await res.json()
    expect(data.error).toBe("Too many requests")
    expect(data.offices).toEqual([])
  })

  it("allows requests from different IPs independently", async () => {
    mockGetOffices.mockResolvedValue([])

    // Fill up rate limit for IP-A
    for (let i = 0; i < 30; i++) {
      await GET(makeRequest(undefined, "ip-a"))
    }

    // IP-B should still work
    const res = await GET(makeRequest(undefined, "ip-b"))
    expect(res.status).toBe(200)
  })
})
