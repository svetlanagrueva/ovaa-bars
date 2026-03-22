import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock admin-auth
const mockCreateAdminSession = vi.fn()
const mockValidateAdminSession = vi.fn(() => Promise.resolve(true))
const mockDestroyAdminSession = vi.fn()

vi.mock("@/lib/admin-auth", () => ({
  createAdminSession: (...args: unknown[]) => mockCreateAdminSession(...args),
  validateAdminSession: (...args: unknown[]) => mockValidateAdminSession(...args),
  destroyAdminSession: (...args: unknown[]) => mockDestroyAdminSession(...args),
}))

// Mock invoice modules (imported by admin actions)
vi.mock("@/lib/invoice", () => ({
  getNextInvoiceNumber: vi.fn(() => Promise.resolve("20260000000001")),
}))
vi.mock("@/lib/invoice-pdf", () => ({
  generateInvoicePDF: vi.fn(() => Promise.resolve(Buffer.from("fake-pdf"))),
}))
vi.mock("@/lib/invoice-email", () => ({
  sendInvoiceEmail: vi.fn(),
}))
vi.mock("@/lib/seller", () => ({
  getSellerConfig: vi.fn(() => ({
    companyName: "Test Co", eik: "123456789", vatNumber: "", mol: "Test",
    address: "Test St", city: "Sofia", postalCode: "1000", phone: "",
    email: "", iban: "", bank: "",
  })),
}))

// Mock Supabase — helper to create thenable query results
function mockThenableResult(data: unknown, error: unknown = null, count: number | null = null) {
  const obj: Record<string, unknown> = {
    eq: vi.fn(() => obj),
    is: vi.fn(() => obj),
    not: vi.fn(() => obj),
    ilike: vi.fn(() => obj),
    or: vi.fn(() => obj),
    gte: vi.fn(() => obj),
    lte: vi.fn(() => obj),
    select: vi.fn(() => obj),
    range: vi.fn(() => obj),
    then(resolve: (v: unknown) => void) {
      resolve({ data, error, count })
    },
  }
  return obj
}

// Update chain: .update().eq().eq().select() → thenable with { data: [...], error: null }
const mockUpdateChain = {
  eq: vi.fn(() => mockUpdateChain),
  select: vi.fn(() => mockUpdateChain),
  then(resolve: (v: unknown) => void) {
    resolve({ data: [{ id: "updated" }], error: null })
  },
}

const mockSupabase = {
  from: vi.fn(() => mockSupabase),
  select: vi.fn(() => mockSupabase),
  insert: vi.fn(() => mockSupabase),
  update: vi.fn(() => mockUpdateChain),
  eq: vi.fn(() => mockSupabase),
  order: vi.fn(() => mockSupabase),
  range: vi.fn(() => mockSupabase),
  is: vi.fn(() => mockSupabase),
  not: vi.fn(() => mockSupabase),
  ilike: vi.fn(() => mockSupabase),
  or: vi.fn(() => mockSupabase),
  gte: vi.fn(() => mockSupabase),
  lte: vi.fn(() => mockSupabase),
  single: vi.fn(),
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
}))

// Mock Resend
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: vi.fn(() => Promise.resolve({ id: "test" })) }
  },
}))

// Mock next/navigation — redirect throws like it does in Next.js
const mockRedirect = vi.fn()
vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => {
    mockRedirect(...args)
    throw new Error("NEXT_REDIRECT")
  },
}))

// Mock next/headers
let mockIp = "127.0.0.1"
vi.mock("next/headers", () => ({
  headers: vi.fn(() =>
    Promise.resolve({
      get: (name: string) => (name === "x-forwarded-for" ? mockIp : null),
    })
  ),
}))

describe("admin actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    vi.stubEnv("ADMIN_PASSWORD", "correct-password")
    mockValidateAdminSession.mockResolvedValue(true)
    // Use unique IP per test to avoid rate-limit interference
    mockIp = `test-${Math.random()}`
  })

  describe("loginAdmin", () => {
    it("creates session and redirects on correct password", async () => {
      const { loginAdmin } = await import("@/app/actions/admin")

      await expect(loginAdmin("correct-password")).rejects.toThrow("NEXT_REDIRECT")

      expect(mockCreateAdminSession).toHaveBeenCalledOnce()
      expect(mockRedirect).toHaveBeenCalledWith("/admin/orders")
    })

    it("throws on wrong password without creating session", async () => {
      const { loginAdmin } = await import("@/app/actions/admin")

      await expect(loginAdmin("wrong-password")).rejects.toThrow("Грешна парола")
      expect(mockCreateAdminSession).not.toHaveBeenCalled()
    })

    it("uses the same error message regardless of password length", async () => {
      const { loginAdmin } = await import("@/app/actions/admin")

      await expect(loginAdmin("a")).rejects.toThrow("Грешна парола")
      await expect(loginAdmin("wrong-password!!")).rejects.toThrow("Грешна парола")
      await expect(loginAdmin("a".repeat(200))).rejects.toThrow("Грешна парола")
    })

    it("rate limits after 5 failed attempts from the same IP", async () => {
      mockIp = "rate-limit-test-ip"
      const { loginAdmin } = await import("@/app/actions/admin")

      for (let i = 0; i < 5; i++) {
        await expect(loginAdmin("wrong")).rejects.toThrow("Грешна парола")
      }

      // 6th attempt should be rate limited
      await expect(loginAdmin("wrong")).rejects.toThrow("Твърде много опити")

      // Even correct password should be blocked
      await expect(loginAdmin("correct-password")).rejects.toThrow("Твърде много опити")
    })

    it("throws when ADMIN_PASSWORD is not configured", async () => {
      vi.stubEnv("ADMIN_PASSWORD", "")
      const { loginAdmin } = await import("@/app/actions/admin")

      await expect(loginAdmin("any")).rejects.toThrow("Admin not configured")
    })
  })

  describe("logoutAdmin", () => {
    it("destroys session and redirects to login", async () => {
      const { logoutAdmin } = await import("@/app/actions/admin")

      await expect(logoutAdmin()).rejects.toThrow("NEXT_REDIRECT")

      expect(mockDestroyAdminSession).toHaveBeenCalledOnce()
      expect(mockRedirect).toHaveBeenCalledWith("/admin/login")
    })
  })

  describe("getOrders", () => {
    it("throws Unauthorized when not authenticated", async () => {
      mockValidateAdminSession.mockResolvedValue(false)
      const { getOrders } = await import("@/app/actions/admin")

      await expect(getOrders()).rejects.toThrow("Unauthorized")
    })

    it("returns orders from database", async () => {
      const fakeOrders = [{ id: "order-1" }, { id: "order-2" }]
      mockSupabase.range.mockReturnValue(mockThenableResult(fakeOrders, null, 2))

      const { getOrders } = await import("@/app/actions/admin")
      const result = await getOrders()

      expect(result).toEqual({ orders: fakeOrders, total: 2 })
      expect(mockSupabase.from).toHaveBeenCalledWith("orders")
    })

    it("returns empty array when no orders exist", async () => {
      mockSupabase.range.mockReturnValue(mockThenableResult(null, null, 0))

      const { getOrders } = await import("@/app/actions/admin")
      const result = await getOrders()

      expect(result).toEqual({ orders: [], total: 0 })
    })

    it("filters by status when provided", async () => {
      const resultObj = mockThenableResult([], null, 0)
      mockSupabase.range.mockReturnValue(resultObj)

      const { getOrders } = await import("@/app/actions/admin")
      await getOrders({ status: "pending" })

      expect(resultObj.eq).toHaveBeenCalledWith("status", "pending")
    })

    it("does not filter when status is 'all'", async () => {
      const resultObj = mockThenableResult([], null, 0)
      mockSupabase.range.mockReturnValue(resultObj)

      const { getOrders } = await import("@/app/actions/admin")
      await getOrders({ status: "all" })

      expect(resultObj.eq).not.toHaveBeenCalled()
    })

    it("throws on database error", async () => {
      mockSupabase.range.mockReturnValue(
        mockThenableResult(null, { message: "db error" })
      )

      const { getOrders } = await import("@/app/actions/admin")
      await expect(getOrders()).rejects.toThrow("Failed to fetch orders")
    })
  })

  describe("getOrder", () => {
    it("throws Unauthorized when not authenticated", async () => {
      mockValidateAdminSession.mockResolvedValue(false)
      const { getOrder } = await import("@/app/actions/admin")

      await expect(getOrder("550e8400-e29b-41d4-a716-446655440000")).rejects.toThrow(
        "Unauthorized"
      )
    })

    it("rejects invalid UUID format", async () => {
      const { getOrder } = await import("@/app/actions/admin")

      await expect(getOrder("not-a-uuid")).rejects.toThrow("Invalid order ID")
      await expect(getOrder("'; DROP TABLE orders; --")).rejects.toThrow("Invalid order ID")
      await expect(getOrder("")).rejects.toThrow("Invalid order ID")
    })

    it("returns order detail for valid UUID", async () => {
      const fakeOrder = { id: "550e8400-e29b-41d4-a716-446655440000", status: "pending" }
      mockSupabase.single.mockResolvedValue({ data: fakeOrder, error: null })

      const { getOrder } = await import("@/app/actions/admin")
      const result = await getOrder("550e8400-e29b-41d4-a716-446655440000")

      expect(result).toEqual(fakeOrder)
    })

    it("throws when order not found", async () => {
      mockSupabase.single.mockResolvedValue({ data: null, error: { message: "not found" } })

      const { getOrder } = await import("@/app/actions/admin")

      await expect(
        getOrder("550e8400-e29b-41d4-a716-446655440000")
      ).rejects.toThrow("Order not found")
    })
  })

  describe("updateOrderStatus", () => {
    const validOrderId = "550e8400-e29b-41d4-a716-446655440000"

    it("throws Unauthorized when not authenticated", async () => {
      mockValidateAdminSession.mockResolvedValue(false)
      const { updateOrderStatus } = await import("@/app/actions/admin")

      await expect(updateOrderStatus(validOrderId, "confirmed")).rejects.toThrow(
        "Unauthorized"
      )
    })

    it("rejects invalid UUID format", async () => {
      const { updateOrderStatus } = await import("@/app/actions/admin")

      await expect(updateOrderStatus("bad-id", "confirmed")).rejects.toThrow(
        "Invalid order ID"
      )
    })

    it("allows valid transition: pending → confirmed", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: validOrderId, status: "pending" },
        error: null,
      })

      const { updateOrderStatus } = await import("@/app/actions/admin")
      const result = await updateOrderStatus(validOrderId, "confirmed")

      expect(result).toEqual({ success: true })
    })

    it("allows valid transition: pending → cancelled", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: validOrderId, status: "pending" },
        error: null,
      })

      const { updateOrderStatus } = await import("@/app/actions/admin")
      const result = await updateOrderStatus(validOrderId, "cancelled")

      expect(result).toEqual({ success: true })
    })

    it("rejects invalid transition: pending → delivered", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: validOrderId, status: "pending" },
        error: null,
      })

      const { updateOrderStatus } = await import("@/app/actions/admin")

      await expect(
        updateOrderStatus(validOrderId, "delivered")
      ).rejects.toThrow('Cannot transition from "pending" to "delivered"')
    })

    it("rejects invalid transition: delivered → pending", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: validOrderId, status: "delivered" },
        error: null,
      })

      const { updateOrderStatus } = await import("@/app/actions/admin")

      await expect(
        updateOrderStatus(validOrderId, "pending")
      ).rejects.toThrow('Cannot transition from "delivered" to "pending"')
    })

    it("requires tracking number when shipping", async () => {
      const { updateOrderStatus } = await import("@/app/actions/admin")

      await expect(
        updateOrderStatus(validOrderId, "shipped")
      ).rejects.toThrow("Tracking number is required")

      await expect(
        updateOrderStatus(validOrderId, "shipped", "")
      ).rejects.toThrow("Tracking number is required")

      await expect(
        updateOrderStatus(validOrderId, "shipped", "   ")
      ).rejects.toThrow("Tracking number is required")
    })

    it("allows confirmed → shipped with tracking number", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: validOrderId, status: "confirmed", items: [], email: "test@test.com" },
        error: null,
      })

      const { updateOrderStatus } = await import("@/app/actions/admin")
      const result = await updateOrderStatus(validOrderId, "shipped", "BG123456789")

      expect(result).toEqual({ success: true })
    })

    it("throws when order not found", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: { message: "not found" },
      })

      const { updateOrderStatus } = await import("@/app/actions/admin")

      await expect(
        updateOrderStatus(validOrderId, "confirmed")
      ).rejects.toThrow("Order not found")
    })
  })
})
