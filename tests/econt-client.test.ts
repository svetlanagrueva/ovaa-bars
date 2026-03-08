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
