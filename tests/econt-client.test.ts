import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock server-only (no-op in tests)
vi.mock("server-only", () => ({}))

// We need to control fetch globally
const mockFetch = vi.fn()
vi.stubGlobal("fetch", mockFetch)

describe("Econt client – getOffices", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("ECONT_API_URL", "https://demo.econt.com/ee/services/")
    vi.stubEnv("ECONT_USERNAME", "test-user")
    vi.stubEnv("ECONT_PASSWORD", "test-pass")
  })

  async function loadGetOffices() {
    // Re-import to pick up stubbed env vars
    const mod = await import("@/lib/econt")
    return mod.getOffices
  }

  it("sends POST request with correct URL", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ offices: [] }),
    })

    const getOffices = await loadGetOffices()
    await getOffices()

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("NomenclaturesService.getOffices.json"),
      expect.objectContaining({ method: "POST" })
    )
  })

  it("sends Basic auth header", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ offices: [] }),
    })

    const getOffices = await loadGetOffices()
    await getOffices()

    const callArgs = mockFetch.mock.calls[0]
    const headers = callArgs[1].headers
    expect(headers["Authorization"]).toMatch(/^Basic /)
    expect(headers["Content-Type"]).toBe("application/json")
  })

  it("sends countryCode BGR in body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ offices: [] }),
    })

    const getOffices = await loadGetOffices()
    await getOffices()

    const callArgs = mockFetch.mock.calls[0]
    const body = JSON.parse(callArgs[1].body)
    expect(body.countryCode).toBe("BGR")
  })

  it("includes cityName in body when provided", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ offices: [] }),
    })

    const getOffices = await loadGetOffices()
    await getOffices("София")

    const callArgs = mockFetch.mock.calls[0]
    const body = JSON.parse(callArgs[1].body)
    expect(body.cityName).toBe("София")
  })

  it("omits cityName from body when not provided", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ offices: [] }),
    })

    const getOffices = await loadGetOffices()
    await getOffices()

    const callArgs = mockFetch.mock.calls[0]
    const body = JSON.parse(callArgs[1].body)
    expect(body).not.toHaveProperty("cityName")
  })

  it("returns offices array from response", async () => {
    const fakeOffices = [
      { id: 1, name: "Офис 1", address: { city: { name: "София" }, fullAddress: "ул. Тест" } },
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
    await expect(getOffices()).rejects.toThrow("Econt API error: 500")
  })

  it("throws on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"))

    const getOffices = await loadGetOffices()
    await expect(getOffices()).rejects.toThrow("Network error")
  })
})

describe("Econt client – createShipment", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("ECONT_API_URL", "https://demo.econt.com/ee/services/")
    vi.stubEnv("ECONT_USERNAME", "test-user")
    vi.stubEnv("ECONT_PASSWORD", "test-pass")
    vi.stubEnv("SELLER_COMPANY_NAME", "Test Company")
    vi.stubEnv("SELLER_PHONE", "+359888123456")
    vi.stubEnv("SELLER_EMAIL", "test@example.com")
    vi.stubEnv("SELLER_MOL", "Test MOL")
    vi.stubEnv("SELLER_CITY", "София")
    vi.stubEnv("SELLER_POSTAL_CODE", "1000")
    vi.stubEnv("SELLER_ADDRESS", "ул. Тестова 1")
  })

  const econtShipmentResponse = {
    ok: true,
    json: () => Promise.resolve({ label: { shipmentNumber: "ECONT999", pdfURL: null } }),
  }

  async function loadCreateShipment() {
    const mod = await import("@/lib/econt")
    return mod.createShipment
  }

  it("uses moneyTransferReqAmount for COD shipments (ППП)", async () => {
    mockFetch.mockResolvedValueOnce(econtShipmentResponse)

    const createShipment = await loadCreateShipment()
    await createShipment({
      recipientName: "Ivan Petrov",
      recipientPhone: "+359888000000",
      officeCode: "1056",
      weight: 1.5,
      contents: "Протеинови барове",
      codAmount: 50,
    })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.label.services.moneyTransferReqAmount).toBe(50)
    expect(body.label.services.moneyTransferReqCurrency).toBe("EUR")
  })

  it("does not use cdAmount/cdType for COD shipments", async () => {
    mockFetch.mockResolvedValueOnce(econtShipmentResponse)

    const createShipment = await loadCreateShipment()
    await createShipment({
      recipientName: "Ivan Petrov",
      recipientPhone: "+359888000000",
      officeCode: "1056",
      weight: 1.5,
      contents: "Протеинови барове",
      codAmount: 50,
    })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.label.services.cdAmount).toBeUndefined()
    expect(body.label.services.cdType).toBeUndefined()
  })

  it("does not include services for non-COD shipments", async () => {
    mockFetch.mockResolvedValueOnce(econtShipmentResponse)

    const createShipment = await loadCreateShipment()
    await createShipment({
      recipientName: "Ivan Petrov",
      recipientPhone: "+359888000000",
      officeCode: "1056",
      weight: 1.5,
      contents: "Протеинови барове",
    })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.label.services).toBeUndefined()
  })
})
