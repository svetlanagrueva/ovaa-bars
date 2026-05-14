import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock server-only (no-op in tests)
vi.mock("server-only", () => ({}))

// We need to control fetch globally
const mockFetch = vi.fn()
vi.stubGlobal("fetch", mockFetch)

describe("Speedy client – getOffices", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("SPEEDY_API_URL", "https://api.speedy.bg/v1")
    vi.stubEnv("SPEEDY_USERNAME", "test-user")
    vi.stubEnv("SPEEDY_PASSWORD", "test-pass")
  })

  async function loadGetOffices() {
    // Re-import to pick up stubbed env vars
    const mod = await import("@/lib/speedy")
    return mod.getOffices
  }

  it("sends POST request to correct URL", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ offices: [] }),
    })

    const getOffices = await loadGetOffices()
    await getOffices()

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/location/office"),
      expect.objectContaining({ method: "POST" })
    )
  })

  it("sends userName and password in request body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ offices: [] }),
    })

    const getOffices = await loadGetOffices()
    await getOffices()

    const callArgs = mockFetch.mock.calls[0]
    const body = JSON.parse(callArgs[1].body)
    expect(body.userName).toBe("test-user")
    expect(body.password).toBe("test-pass")
  })

  it("sends countryId 100 (Bulgaria) in body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ offices: [] }),
    })

    const getOffices = await loadGetOffices()
    await getOffices()

    const callArgs = mockFetch.mock.calls[0]
    const body = JSON.parse(callArgs[1].body)
    expect(body.countryId).toBe(100)
  })

  it("sends language BG in body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ offices: [] }),
    })

    const getOffices = await loadGetOffices()
    await getOffices()

    const callArgs = mockFetch.mock.calls[0]
    const body = JSON.parse(callArgs[1].body)
    expect(body.language).toBe("BG")
  })

  it("includes siteName in body when provided", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ offices: [] }),
    })

    const getOffices = await loadGetOffices()
    await getOffices("София")

    const callArgs = mockFetch.mock.calls[0]
    const body = JSON.parse(callArgs[1].body)
    expect(body.siteName).toBe("София")
  })

  it("omits siteName from body when not provided", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ offices: [] }),
    })

    const getOffices = await loadGetOffices()
    await getOffices()

    const callArgs = mockFetch.mock.calls[0]
    const body = JSON.parse(callArgs[1].body)
    expect(body).not.toHaveProperty("siteName")
  })

  it("returns offices array from response", async () => {
    const fakeOffices = [
      { id: 1, name: "Офис 1", address: { siteName: "София", fullAddressString: "ул. Тест" } },
    ]
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ offices: fakeOffices }),
    })

    const getOffices = await loadGetOffices()
    const result = await getOffices()

    expect(result).toEqual(fakeOffices)
  })

  it("returns empty array when response has no offices field", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    })

    const getOffices = await loadGetOffices()
    const result = await getOffices()

    expect(result).toEqual([])
  })

  it("throws on non-OK response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    })

    const getOffices = await loadGetOffices()
    await expect(getOffices()).rejects.toThrow("Speedy API error: 500")
  })

  it("throws on API error in response body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ error: { message: "Invalid credentials" }, offices: [] }),
    })

    const getOffices = await loadGetOffices()
    await expect(getOffices()).rejects.toThrow("Speedy API error: Invalid credentials")
  })

  it("throws on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"))

    const getOffices = await loadGetOffices()
    await expect(getOffices()).rejects.toThrow("Network error")
  })
})

describe("Speedy client – createShipment", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("SPEEDY_API_URL", "https://api.speedy.bg/v1")
    vi.stubEnv("SPEEDY_USERNAME", "test-user")
    vi.stubEnv("SPEEDY_PASSWORD", "test-pass")
    vi.stubEnv("SELLER_PHONE", "+359888123456")
    vi.stubEnv("SELLER_COMPANY_NAME", "Test Company")
    vi.stubEnv("SELLER_EMAIL", "test@example.com")
  })

  const speedyShipmentResponse = {
    ok: true,
    json: () => Promise.resolve({ id: 12345, parcels: [{ id: "SPD999" }] }),
    text: () => Promise.resolve(""),
  }

  async function loadCreateShipment() {
    const mod = await import("@/lib/speedy")
    return mod.createShipment
  }

  it("uses POSTAL_MONEY_TRANSFER processingType for COD shipments", async () => {
    mockFetch.mockResolvedValueOnce(speedyShipmentResponse)

    const createShipment = await loadCreateShipment()
    await createShipment({
      recipientName: "Ivan Petrov",
      recipientPhone: "+359888000000",
      officeId: 100,
      weight: 1.5,
      contents: "Протеинови барове",
      codAmount: 50,
    })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.service.additionalServices.cod.processingType).toBe("POSTAL_MONEY_TRANSFER")
    expect(body.service.additionalServices.cod.amount).toBe(50)
  })

  it("does not include COD services for non-COD shipments", async () => {
    mockFetch.mockResolvedValueOnce(speedyShipmentResponse)

    const createShipment = await loadCreateShipment()
    await createShipment({
      recipientName: "Ivan Petrov",
      recipientPhone: "+359888000000",
      officeId: 100,
      weight: 1.5,
      contents: "Протеинови барове",
    })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.service.additionalServices).toBeUndefined()
  })

  it("sets recipient as payer for COD shipments", async () => {
    mockFetch.mockResolvedValueOnce(speedyShipmentResponse)

    const createShipment = await loadCreateShipment()
    await createShipment({
      recipientName: "Ivan Petrov",
      recipientPhone: "+359888000000",
      officeId: 100,
      weight: 1.5,
      contents: "Протеинови барове",
      codAmount: 50,
    })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.payment.courierServicePayer).toBe("RECIPIENT")
  })

  it("sets sender as payer for non-COD shipments", async () => {
    mockFetch.mockResolvedValueOnce(speedyShipmentResponse)

    const createShipment = await loadCreateShipment()
    await createShipment({
      recipientName: "Ivan Petrov",
      recipientPhone: "+359888000000",
      officeId: 100,
      weight: 1.5,
      contents: "Протеинови барове",
    })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.payment.courierServicePayer).toBe("SENDER")
  })
})

describe("Speedy client – getShipmentStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("SPEEDY_API_URL", "https://api.speedy.bg/v1")
    vi.stubEnv("SPEEDY_USERNAME", "test-user")
    vi.stubEnv("SPEEDY_PASSWORD", "test-pass")
  })

  async function loadGetShipmentStatus() {
    const mod = await import("@/lib/speedy")
    return mod.getShipmentStatus
  }

  it("sends POST to /shipment/track with tracking number", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ parcels: [{ operations: [] }] }),
    })

    const getShipmentStatus = await loadGetShipmentStatus()
    await getShipmentStatus("SPD123")

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/shipment/track"),
      expect.objectContaining({ method: "POST" })
    )
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.parcels).toEqual([{ id: "SPD123" }])
    expect(body.userName).toBe("test-user")
  })

  it("returns delivered: true for operation code -14", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        parcels: [{
          operations: [
            { operationCode: 1, operationDescription: "Приета", dateTime: "2026-04-15T10:00:00" },
            { operationCode: -14, operationDescription: "Доставена", dateTime: "2026-04-16T14:30:00" },
          ],
        }],
      }),
    })

    const getShipmentStatus = await loadGetShipmentStatus()
    const result = await getShipmentStatus("SPD123")

    expect(result.delivered).toBe(true)
    expect(result.deliveredAt).toBe("2026-04-16T14:30:00")
    expect(result.rawEventCode).toBe(-14)
    expect(result.source).toBe("speedy")
  })

  it("returns delivered: false for non-delivery operation code", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        parcels: [{
          operations: [
            { operationCode: 1, operationDescription: "Приета", dateTime: "2026-04-15T10:00:00" },
          ],
        }],
      }),
    })

    const getShipmentStatus = await loadGetShipmentStatus()
    const result = await getShipmentStatus("SPD123")

    expect(result.delivered).toBe(false)
    expect(result.deliveredAt).toBeUndefined()
    expect(result.source).toBe("speedy")
  })

  it("returns delivered: false when no operations", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ parcels: [{ operations: [] }] }),
    })

    const getShipmentStatus = await loadGetShipmentStatus()
    const result = await getShipmentStatus("SPD123")

    expect(result.delivered).toBe(false)
    expect(result.source).toBe("speedy")
  })

  it("throws on API error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    })

    const getShipmentStatus = await loadGetShipmentStatus()
    await expect(getShipmentStatus("SPD123")).rejects.toThrow("Speedy tracking API error: 500")
  })
})
