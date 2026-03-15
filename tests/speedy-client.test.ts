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
