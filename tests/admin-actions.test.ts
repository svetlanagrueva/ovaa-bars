import { describe, it, expect, vi, beforeEach } from "vitest"
import { createSupabaseMock, resetSupabaseMock, mockThenableResult } from "./helpers/supabase-mock"
import { validUUID } from "./helpers/fixtures"

// Mock admin-auth
const mockCreateAdminSession = vi.fn()
const mockValidateAdminSession = vi.fn(() => Promise.resolve(true))
const mockDestroyAdminSession = vi.fn()

vi.mock("@/lib/admin-auth", () => ({
  createAdminSession: () => mockCreateAdminSession(),
  validateAdminSession: () => mockValidateAdminSession(),
  destroyAdminSession: () => mockDestroyAdminSession(),
}))

// Mock courier clients (imported by admin actions via generateShipment)
const mockSpeedyCreateShipment = vi.fn((_params?: any) => Promise.resolve({ trackingNumber: "SPEEDY123", shipmentId: "1" }))
const mockEcontCreateShipment = vi.fn((_params?: any) => Promise.resolve({ trackingNumber: "ECONT123", pdfUrl: null }))
vi.mock("@/lib/speedy", () => ({
  createShipment: (params: any) => mockSpeedyCreateShipment(params),
}))
vi.mock("@/lib/econt", () => ({
  createShipment: (params: any) => mockEcontCreateShipment(params),
}))

// Mock delivery confirmation (imported by admin actions for delivered status)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockConfirmDeliveryForOrder: any = vi.fn(() => Promise.resolve({ confirmed: true }))
vi.mock("@/lib/delivery-confirmation", () => ({
  confirmDeliveryForOrder: (a: string, b: string, c: string) => mockConfirmDeliveryForOrder(a, b, c),
}))

// Mock Supabase
const mockSupabase = createSupabaseMock()

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
  redirect: (...args: any[]) => {
    mockRedirect(...args)
    throw new Error("NEXT_REDIRECT")
  },
}))

// Mock next/cache
vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
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
    resetSupabaseMock(mockSupabase)
  })

  describe("loginAdmin", () => {
    it("creates session and redirects on correct password", async () => {
      const { loginAdmin } = await import("@/app/actions/admin")

      await expect(loginAdmin("correct-password")).rejects.toThrow("NEXT_REDIRECT")

      expect(mockCreateAdminSession).toHaveBeenCalledOnce()
      expect(mockRedirect).toHaveBeenCalledWith("/admin/dashboard")
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

      await expect(getOrder(validUUID)).rejects.toThrow(
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
      const fakeOrder = { id: validUUID, status: "pending" }
      mockSupabase.single.mockResolvedValue({ data: fakeOrder, error: null })

      const { getOrder } = await import("@/app/actions/admin")
      const result = await getOrder(validUUID)

      expect(result).toEqual(fakeOrder)
    })

    it("throws when order not found", async () => {
      mockSupabase.single.mockResolvedValue({ data: null, error: { message: "not found" } })

      const { getOrder } = await import("@/app/actions/admin")

      await expect(
        getOrder(validUUID)
      ).rejects.toThrow("Order not found")
    })
  })

  describe("updateOrderStatus", () => {
    const validOrderId = validUUID

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
        data: { id: validOrderId, status: "pending", items: [] },
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

    it("rejects tracking number over 200 chars", async () => {
      const { updateOrderStatus } = await import("@/app/actions/admin")

      await expect(
        updateOrderStatus(validOrderId, "shipped", "x".repeat(201))
      ).rejects.toThrow("Tracking number is too long")
    })

    it("rejects cancellation reason over 1000 chars", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: validOrderId, status: "confirmed" },
        error: null,
      })

      const { updateOrderStatus } = await import("@/app/actions/admin")

      await expect(
        updateOrderStatus(validOrderId, "cancelled", undefined, "x".repeat(1001))
      ).rejects.toThrow("Cancellation reason is too long")
    })
  })

  describe("getDashboardStats", () => {
    it("throws Unauthorized when not authenticated", async () => {
      mockValidateAdminSession.mockResolvedValue(false)
      const { getDashboardStats } = await import("@/app/actions/admin")

      await expect(getDashboardStats()).rejects.toThrow("Unauthorized")
    })

    it("returns stats from RPC and recent orders", async () => {
      const mockRpcResult = {
        today_orders: 3, today_revenue: 5000,
        week_orders: 10, week_revenue: 20000,
        month_orders: 25, month_revenue: 50000,
        pending_orders: 2, invoices_awaiting: 1,
        awaiting_settlement: 4,
      }
      mockSupabase.rpc = vi.fn(() => Promise.resolve({ data: mockRpcResult, error: null }))
      const recentOrders = [{ id: "order-1" }, { id: "order-2" }]
      mockSupabase.limit = vi.fn(() => mockThenableResult(recentOrders))

      const { getDashboardStats } = await import("@/app/actions/admin")
      const result = await getDashboardStats()

      expect(result.today).toEqual({ orders: 3, revenue: 5000 })
      expect(result.week).toEqual({ orders: 10, revenue: 20000 })
      expect(result.month).toEqual({ orders: 25, revenue: 50000 })
      expect(result.pendingOrders).toBe(2)
      expect(result.invoicesAwaiting).toBe(1)
      expect(result.awaitingSettlement).toBe(4)
      expect(result.recentOrders).toEqual(recentOrders)
    })

    it("defaults awaitingSettlement to 0 when not in RPC result", async () => {
      const mockRpcResult = {
        today_orders: 0, today_revenue: 0,
        week_orders: 0, week_revenue: 0,
        month_orders: 0, month_revenue: 0,
        pending_orders: 0, invoices_awaiting: 0,
      }
      mockSupabase.rpc = vi.fn(() => Promise.resolve({ data: mockRpcResult, error: null }))
      mockSupabase.limit = vi.fn(() => mockThenableResult([]))

      const { getDashboardStats } = await import("@/app/actions/admin")
      const result = await getDashboardStats()

      expect(result.awaitingSettlement).toBe(0)
    })

    it("throws on RPC error", async () => {
      mockSupabase.rpc = vi.fn(() => Promise.resolve({ data: null, error: { message: "rpc failed" } }))

      const { getDashboardStats } = await import("@/app/actions/admin")
      await expect(getDashboardStats()).rejects.toThrow("Failed to fetch dashboard stats")
    })
  })

  describe("addAdminNote", () => {
    const validOrderId = validUUID

    it("throws Unauthorized when not authenticated", async () => {
      mockValidateAdminSession.mockResolvedValue(false)
      const { addAdminNote } = await import("@/app/actions/admin")

      await expect(addAdminNote(validOrderId, "test")).rejects.toThrow("Unauthorized")
    })

    it("rejects invalid UUID", async () => {
      const { addAdminNote } = await import("@/app/actions/admin")

      await expect(addAdminNote("bad-id", "note")).rejects.toThrow("Invalid order ID")
    })

    it("rejects empty note", async () => {
      const { addAdminNote } = await import("@/app/actions/admin")

      await expect(addAdminNote(validOrderId, "")).rejects.toThrow("Бележката е празна")
      await expect(addAdminNote(validOrderId, "   ")).rejects.toThrow("Бележката е празна")
    })

    it("rejects note over 2000 chars", async () => {
      const { addAdminNote } = await import("@/app/actions/admin")

      await expect(addAdminNote(validOrderId, "x".repeat(2001))).rejects.toThrow("Бележката е твърде дълга")
    })

    it("appends note to existing notes", async () => {
      const existingNotes = [{ text: "First note", created_at: "2026-04-15T10:00:00.000Z" }]
      mockSupabase.single.mockResolvedValueOnce({
        data: { admin_notes: existingNotes },
        error: null,
      })
      mockSupabase.update = vi.fn(() => mockThenableResult(null))

      const { addAdminNote } = await import("@/app/actions/admin")
      const result = await addAdminNote(validOrderId, "Second note")

      expect(result).toEqual({ success: true })
      expect(mockSupabase.update).toHaveBeenCalledWith({
        admin_notes: [
          ...existingNotes,
          expect.objectContaining({ text: "Second note", created_at: expect.any(String) }),
        ],
      })
    })

    it("creates first note when admin_notes is empty array", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { admin_notes: [] },
        error: null,
      })
      mockSupabase.update = vi.fn(() => mockThenableResult(null))

      const { addAdminNote } = await import("@/app/actions/admin")
      const result = await addAdminNote(validOrderId, "First note")

      expect(result).toEqual({ success: true })
      expect(mockSupabase.update).toHaveBeenCalledWith({
        admin_notes: [expect.objectContaining({ text: "First note" })],
      })
    })

    it("throws when order not found", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: { message: "not found" },
      })

      const { addAdminNote } = await import("@/app/actions/admin")
      await expect(addAdminNote(validOrderId, "note")).rejects.toThrow("Поръчката не е намерена")
    })
  })

  describe("getInvoices", () => {
    it("throws Unauthorized when not authenticated", async () => {
      mockValidateAdminSession.mockResolvedValue(false)
      const { getInvoices } = await import("@/app/actions/admin")

      await expect(getInvoices()).rejects.toThrow("Unauthorized")
    })

    it("returns paginated invoices", async () => {
      const fakeInvoices = [{ id: "inv-1", invoice_number: "0000000001" }]
      mockSupabase.range.mockReturnValue(mockThenableResult(fakeInvoices, null, 1))

      const { getInvoices } = await import("@/app/actions/admin")
      const result = await getInvoices()

      expect(result).toEqual({ invoices: fakeInvoices, total: 1 })
    })

    it("throws on database error", async () => {
      mockSupabase.range.mockReturnValue(mockThenableResult(null, { message: "db error" }))

      const { getInvoices } = await import("@/app/actions/admin")
      await expect(getInvoices()).rejects.toThrow("Failed to fetch invoices")
    })
  })

  describe("getSales", () => {
    it("throws Unauthorized when not authenticated", async () => {
      mockValidateAdminSession.mockResolvedValue(false)
      const { getSales } = await import("@/app/actions/admin")

      await expect(getSales()).rejects.toThrow("Unauthorized")
    })

    it("returns sales from database", async () => {
      const fakeSales = [{ id: "sale-1", product_id: "prod-1" }]
      mockSupabase.order.mockReturnValue(mockThenableResult(fakeSales))

      const { getSales } = await import("@/app/actions/admin")
      const result = await getSales()

      expect(result).toEqual(fakeSales)
    })
  })

  describe("getPromoCodes", () => {
    it("throws Unauthorized when not authenticated", async () => {
      mockValidateAdminSession.mockResolvedValue(false)
      const { getPromoCodes } = await import("@/app/actions/admin")

      await expect(getPromoCodes()).rejects.toThrow("Unauthorized")
    })

    it("returns promo codes from database", async () => {
      const fakeCodes = [{ id: "code-1", code: "SAVE10" }]
      mockSupabase.order.mockReturnValue(mockThenableResult(fakeCodes))

      const { getPromoCodes } = await import("@/app/actions/admin")
      const result = await getPromoCodes()

      expect(result).toEqual(fakeCodes)
    })
  })

  describe("endSale", () => {
    const validId = validUUID

    it("throws Unauthorized when not authenticated", async () => {
      mockValidateAdminSession.mockResolvedValue(false)
      const { endSale } = await import("@/app/actions/admin")

      await expect(endSale(validId)).rejects.toThrow("Unauthorized")
    })

    it("rejects invalid UUID", async () => {
      const { endSale } = await import("@/app/actions/admin")

      await expect(endSale("bad-id")).rejects.toThrow("Invalid sale ID")
    })

    it("ends an active sale", async () => {
      const endUpdateChain = {
        eq: vi.fn(() => endUpdateChain),
        select: vi.fn(() => endUpdateChain),
        then(resolve: (v: unknown) => void) {
          resolve({ data: [{ id: validId }], error: null })
        },
      }
      mockSupabase.update = vi.fn(() => endUpdateChain)

      const { endSale } = await import("@/app/actions/admin")
      const result = await endSale(validId)

      expect(result).toEqual({ success: true })
    })

    it("throws when sale already ended", async () => {
      const endUpdateChain = {
        eq: vi.fn(() => endUpdateChain),
        select: vi.fn(() => endUpdateChain),
        then(resolve: (v: unknown) => void) {
          resolve({ data: [], error: null })
        },
      }
      mockSupabase.update = vi.fn(() => endUpdateChain)

      const { endSale } = await import("@/app/actions/admin")
      await expect(endSale(validId)).rejects.toThrow("Промоцията вече е спряна")
    })
  })

  describe("getAllOrders", () => {
    it("throws Unauthorized when not authenticated", async () => {
      mockValidateAdminSession.mockResolvedValue(false)
      const { getAllOrders } = await import("@/app/actions/admin")

      await expect(getAllOrders()).rejects.toThrow("Unauthorized")
    })

    it("returns all orders in a single batch", async () => {
      const fakeOrders = Array.from({ length: 5 }, (_, i) => ({ id: `order-${i}` }))
      mockSupabase.range.mockReturnValue(mockThenableResult(fakeOrders))

      const { getAllOrders } = await import("@/app/actions/admin")
      const result = await getAllOrders()

      expect(result).toEqual(fakeOrders)
    })

    it("paginates through multiple batches", async () => {
      const batch1 = Array.from({ length: 1000 }, (_, i) => ({ id: `order-${i}` }))
      const batch2 = Array.from({ length: 200 }, (_, i) => ({ id: `order-${1000 + i}` }))

      let callCount = 0
      mockSupabase.range.mockImplementation(() => {
        callCount++
        return mockThenableResult(callCount === 1 ? batch1 : batch2)
      })

      const { getAllOrders } = await import("@/app/actions/admin")
      const result = await getAllOrders()

      expect(result.length).toBe(1200)
      expect(callCount).toBe(2)
    })

    it("throws on database error", async () => {
      mockSupabase.range.mockReturnValue(mockThenableResult(null, { message: "db error" }))

      const { getAllOrders } = await import("@/app/actions/admin")
      await expect(getAllOrders()).rejects.toThrow("Failed to fetch orders")
    })
  })

  describe("getAllInvoices", () => {
    it("throws Unauthorized when not authenticated", async () => {
      mockValidateAdminSession.mockResolvedValue(false)
      const { getAllInvoices } = await import("@/app/actions/admin")

      await expect(getAllInvoices()).rejects.toThrow("Unauthorized")
    })

    it("returns all invoices in a single batch", async () => {
      const fakeInvoices = [{ id: "inv-1", invoice_number: "0000000001" }]
      mockSupabase.range.mockReturnValue(mockThenableResult(fakeInvoices))

      const { getAllInvoices } = await import("@/app/actions/admin")
      const result = await getAllInvoices()

      expect(result).toEqual(fakeInvoices)
    })

    it("throws on database error", async () => {
      mockSupabase.range.mockReturnValue(mockThenableResult(null, { message: "db error" }))

      const { getAllInvoices } = await import("@/app/actions/admin")
      await expect(getAllInvoices()).rejects.toThrow("Failed to fetch invoices")
    })
  })

  describe("createSale", () => {
    it("throws Unauthorized when not authenticated", async () => {
      mockValidateAdminSession.mockResolvedValue(false)
      const { createSale } = await import("@/app/actions/admin")

      await expect(createSale({
        productId: "egg-origin-dark-chocolate-box",
        salePriceInCents: 2000,
      })).rejects.toThrow("Unauthorized")
    })

    it("rejects unknown product", async () => {
      const { createSale } = await import("@/app/actions/admin")

      await expect(createSale({
        productId: "nonexistent-product",
        salePriceInCents: 2000,
      })).rejects.toThrow("Продуктът не е намерен")
    })

    it("rejects non-positive sale price", async () => {
      const { createSale } = await import("@/app/actions/admin")

      await expect(createSale({
        productId: "egg-origin-dark-chocolate-box",
        salePriceInCents: 0,
      })).rejects.toThrow("положително число")

      await expect(createSale({
        productId: "egg-origin-dark-chocolate-box",
        salePriceInCents: -100,
      })).rejects.toThrow("положително число")
    })

    it("rejects non-integer sale price", async () => {
      const { createSale } = await import("@/app/actions/admin")

      await expect(createSale({
        productId: "egg-origin-dark-chocolate-box",
        salePriceInCents: 19.99,
      })).rejects.toThrow("положително число")
    })

    it("rejects sale price >= base price", async () => {
      const { createSale } = await import("@/app/actions/admin")

      await expect(createSale({
        productId: "egg-origin-dark-chocolate-box",
        salePriceInCents: 2570, // same as base
      })).rejects.toThrow("по-ниска от базовата")

      await expect(createSale({
        productId: "egg-origin-dark-chocolate-box",
        salePriceInCents: 3000, // higher than base
      })).rejects.toThrow("по-ниска от базовата")
    })

    it("rejects end date in the past", async () => {
      const { createSale } = await import("@/app/actions/admin")

      await expect(createSale({
        productId: "egg-origin-dark-chocolate-box",
        salePriceInCents: 2000,
        endsAt: "2020-01-01T00:00:00Z",
      })).rejects.toThrow("в бъдещето")
    })

    it("rejects invalid end date", async () => {
      const { createSale } = await import("@/app/actions/admin")

      await expect(createSale({
        productId: "egg-origin-dark-chocolate-box",
        salePriceInCents: 2000,
        endsAt: "not-a-date",
      })).rejects.toThrow("Невалидна крайна дата")
    })

    it("creates sale successfully", async () => {
      // Mock getLowestPrice30Days chain (history + pastSales)
      mockSupabase.limit = vi.fn()
        .mockReturnValueOnce(mockThenableResult([]))  // price history
        .mockReturnValueOnce(mockThenableResult([]))  // past sales
      // Mock deactivate existing sale
      mockSupabase.update = vi.fn(() => mockThenableResult(null))
      // Mock insert price history + insert sale
      mockSupabase.insert = vi.fn(() => mockThenableResult(null))

      const { createSale } = await import("@/app/actions/admin")
      const result = await createSale({
        productId: "egg-origin-dark-chocolate-box",
        salePriceInCents: 2000,
      })

      expect(result).toEqual({ success: true })
    })
  })

  describe("createPromoCode", () => {
    const validInput = {
      code: "SAVE10",
      discountType: "percentage" as const,
      discountValue: 10,
      minOrderAmount: 0,
      maxUses: null,
    }

    it("throws Unauthorized when not authenticated", async () => {
      mockValidateAdminSession.mockResolvedValue(false)
      const { createPromoCode } = await import("@/app/actions/admin")

      await expect(createPromoCode(validInput)).rejects.toThrow("Unauthorized")
    })

    it("rejects invalid code format", async () => {
      const { createPromoCode } = await import("@/app/actions/admin")

      await expect(createPromoCode({ ...validInput, code: "a" })).rejects.toThrow("2-30 символа")
      await expect(createPromoCode({ ...validInput, code: "invalid code!" })).rejects.toThrow("2-30 символа")
      await expect(createPromoCode({ ...validInput, code: "" })).rejects.toThrow("2-30 символа")
    })

    it("accepts valid code formats", async () => {
      mockSupabase.insert = vi.fn(() => mockThenableResult(null))
      const { createPromoCode } = await import("@/app/actions/admin")

      const result = await createPromoCode({ ...validInput, code: "AB" })
      expect(result).toEqual({ success: true })
    })

    it("rejects non-positive discount value", async () => {
      const { createPromoCode } = await import("@/app/actions/admin")

      await expect(createPromoCode({ ...validInput, discountValue: 0 })).rejects.toThrow("положително число")
      await expect(createPromoCode({ ...validInput, discountValue: -5 })).rejects.toThrow("положително число")
    })

    it("rejects percentage discount over 100", async () => {
      const { createPromoCode } = await import("@/app/actions/admin")

      await expect(createPromoCode({ ...validInput, discountValue: 101 })).rejects.toThrow("100%")
    })

    it("allows fixed discount over 100", async () => {
      mockSupabase.insert = vi.fn(() => mockThenableResult(null))
      const { createPromoCode } = await import("@/app/actions/admin")

      const result = await createPromoCode({ ...validInput, discountType: "fixed", discountValue: 500 })
      expect(result).toEqual({ success: true })
    })

    it("rejects negative min order amount", async () => {
      const { createPromoCode } = await import("@/app/actions/admin")

      await expect(createPromoCode({ ...validInput, minOrderAmount: -1 })).rejects.toThrow("отрицателна")
    })

    it("rejects non-positive max uses", async () => {
      const { createPromoCode } = await import("@/app/actions/admin")

      await expect(createPromoCode({ ...validInput, maxUses: 0 })).rejects.toThrow("положително число")
      await expect(createPromoCode({ ...validInput, maxUses: -1 })).rejects.toThrow("положително число")
    })

    it("allows null max uses (unlimited)", async () => {
      mockSupabase.insert = vi.fn(() => mockThenableResult(null))
      const { createPromoCode } = await import("@/app/actions/admin")

      const result = await createPromoCode({ ...validInput, maxUses: null })
      expect(result).toEqual({ success: true })
    })

    it("rejects end date in the past", async () => {
      const { createPromoCode } = await import("@/app/actions/admin")

      await expect(createPromoCode({ ...validInput, endsAt: "2020-01-01T00:00:00Z" })).rejects.toThrow("в бъдещето")
    })

    it("throws on duplicate code", async () => {
      mockSupabase.insert = vi.fn(() => mockThenableResult(null, { code: "23505", message: "duplicate" }))
      const { createPromoCode } = await import("@/app/actions/admin")

      await expect(createPromoCode(validInput)).rejects.toThrow("Вече съществува активен код")
    })

    it("throws on generic DB error", async () => {
      mockSupabase.insert = vi.fn(() => mockThenableResult(null, { code: "other", message: "db error" }))
      const { createPromoCode } = await import("@/app/actions/admin")

      await expect(createPromoCode(validInput)).rejects.toThrow("Грешка при създаване")
    })

    it("creates promo code successfully", async () => {
      mockSupabase.insert = vi.fn(() => mockThenableResult(null))
      const { createPromoCode } = await import("@/app/actions/admin")

      const result = await createPromoCode(validInput)
      expect(result).toEqual({ success: true })
    })
  })

  describe("deactivatePromoCode", () => {
    const validId = validUUID

    it("throws Unauthorized when not authenticated", async () => {
      mockValidateAdminSession.mockResolvedValue(false)
      const { deactivatePromoCode } = await import("@/app/actions/admin")

      await expect(deactivatePromoCode(validId)).rejects.toThrow("Unauthorized")
    })

    it("rejects invalid UUID", async () => {
      const { deactivatePromoCode } = await import("@/app/actions/admin")

      await expect(deactivatePromoCode("bad-id")).rejects.toThrow("Invalid promo code ID")
    })

    it("deactivates an active code", async () => {
      const deactivateChain = {
        eq: vi.fn(() => deactivateChain),
        select: vi.fn(() => deactivateChain),
        then(resolve: (v: unknown) => void) {
          resolve({ data: [{ id: validId }], error: null })
        },
      }
      mockSupabase.update = vi.fn(() => deactivateChain)

      const { deactivatePromoCode } = await import("@/app/actions/admin")
      const result = await deactivatePromoCode(validId)

      expect(result).toEqual({ success: true })
    })

    it("throws when code already deactivated", async () => {
      const deactivateChain = {
        eq: vi.fn(() => deactivateChain),
        select: vi.fn(() => deactivateChain),
        then(resolve: (v: unknown) => void) {
          resolve({ data: [], error: null })
        },
      }
      mockSupabase.update = vi.fn(() => deactivateChain)

      const { deactivatePromoCode } = await import("@/app/actions/admin")
      await expect(deactivatePromoCode(validId)).rejects.toThrow("Промо кодът вече е деактивиран")
    })
  })

  describe("markInvoiceSent", () => {
    const validOrderId = validUUID

    it("throws Unauthorized when not authenticated", async () => {
      mockValidateAdminSession.mockResolvedValue(false)
      const { markInvoiceSent } = await import("@/app/actions/admin")

      await expect(markInvoiceSent(validOrderId)).rejects.toThrow("Unauthorized")
    })

    it("rejects invalid UUID", async () => {
      const { markInvoiceSent } = await import("@/app/actions/admin")

      await expect(markInvoiceSent("bad-id")).rejects.toThrow("Invalid order ID")
    })

    it("marks invoice as sent successfully", async () => {
      const updateChain = {
        eq: vi.fn(() => updateChain),
        not: vi.fn(() => updateChain),
        is: vi.fn(() => updateChain),
        select: vi.fn(() => updateChain),
        then(resolve: (v: unknown) => void) {
          resolve({ data: [{ id: validOrderId }], error: null })
        },
      }
      mockSupabase.update = vi.fn(() => updateChain)

      const { markInvoiceSent } = await import("@/app/actions/admin")
      const result = await markInvoiceSent(validOrderId)

      expect(result).toEqual({ success: true })
      expect(mockSupabase.update).toHaveBeenCalledWith(
        expect.objectContaining({ invoice_sent_at: expect.any(String) })
      )
    })

    it("throws when order has no invoice or already sent", async () => {
      const updateChain = {
        eq: vi.fn(() => updateChain),
        not: vi.fn(() => updateChain),
        is: vi.fn(() => updateChain),
        select: vi.fn(() => updateChain),
        then(resolve: (v: unknown) => void) {
          resolve({ data: [], error: null })
        },
      }
      mockSupabase.update = vi.fn(() => updateChain)

      const { markInvoiceSent } = await import("@/app/actions/admin")
      await expect(markInvoiceSent(validOrderId)).rejects.toThrow("няма фактура или вече е отбелязана")
    })
  })

  describe("recordCodSettlement", () => {
    const validOrderId = validUUID

    it("throws Unauthorized when not authenticated", async () => {
      mockValidateAdminSession.mockResolvedValue(false)
      const { recordCodSettlement } = await import("@/app/actions/admin")

      await expect(recordCodSettlement(validOrderId, {})).rejects.toThrow("Unauthorized")
    })

    it("rejects invalid UUID", async () => {
      const { recordCodSettlement } = await import("@/app/actions/admin")

      await expect(recordCodSettlement("bad-id", {})).rejects.toThrow("Invalid order ID")
    })

    it("rejects non-COD orders", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: validOrderId, payment_method: "card", status: "delivered" },
        error: null,
      })

      const { recordCodSettlement } = await import("@/app/actions/admin")
      await expect(recordCodSettlement(validOrderId, {})).rejects.toThrow("наложен платеж")
    })

    it("rejects settlement for non-delivered orders", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: validOrderId, payment_method: "cod", status: "confirmed" },
        error: null,
      })

      const { recordCodSettlement } = await import("@/app/actions/admin")
      await expect(recordCodSettlement(validOrderId, {})).rejects.toThrow("доставени поръчки")
    })

    it("rejects ППП ref over 100 chars", async () => {
      const { recordCodSettlement } = await import("@/app/actions/admin")

      await expect(
        recordCodSettlement(validOrderId, { courierPppRef: "x".repeat(101) })
      ).rejects.toThrow("ППП референцията е твърде дълга")
    })

    it("rejects settlement ref over 100 chars", async () => {
      const { recordCodSettlement } = await import("@/app/actions/admin")

      await expect(
        recordCodSettlement(validOrderId, { settlementRef: "x".repeat(101) })
      ).rejects.toThrow("Референцията на превода е твърде дълга")
    })

    it("rejects non-positive settlement amount", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: validOrderId, payment_method: "cod", status: "delivered" },
        error: null,
      })

      const { recordCodSettlement } = await import("@/app/actions/admin")

      await expect(
        recordCodSettlement(validOrderId, { settlementAmount: 0 })
      ).rejects.toThrow("положително число")

      mockSupabase.single.mockResolvedValueOnce({
        data: { id: validOrderId, payment_method: "cod", status: "delivered" },
        error: null,
      })

      await expect(
        recordCodSettlement(validOrderId, { settlementAmount: -100 })
      ).rejects.toThrow("положително число")
    })

    it("rejects non-integer settlement amount", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: validOrderId, payment_method: "cod", status: "delivered" },
        error: null,
      })

      const { recordCodSettlement } = await import("@/app/actions/admin")

      await expect(
        recordCodSettlement(validOrderId, { settlementAmount: 49.50 })
      ).rejects.toThrow("положително число")
    })

    it("records settlement successfully with all fields", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: validOrderId, payment_method: "cod", status: "delivered" },
        error: null,
      })

      const { recordCodSettlement } = await import("@/app/actions/admin")
      const result = await recordCodSettlement(validOrderId, {
        courierPppRef: "PPP-12345",
        settlementRef: "BT-2026-04-001",
        settlementAmount: 4850,
      })

      expect(result).toEqual({ success: true })
      expect(mockSupabase.update).toHaveBeenCalledWith(
        expect.objectContaining({
          paid_at: expect.any(String),
          courier_ppp_ref: "PPP-12345",
          settlement_ref: "BT-2026-04-001",
          settlement_amount: 4850,
        })
      )
    })

    it("records settlement with only paid_at when no optional fields provided", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: validOrderId, payment_method: "cod", status: "delivered" },
        error: null,
      })

      const { recordCodSettlement } = await import("@/app/actions/admin")
      const result = await recordCodSettlement(validOrderId, {})

      expect(result).toEqual({ success: true })
      expect(mockSupabase.update).toHaveBeenCalledWith(
        expect.objectContaining({
          paid_at: expect.any(String),
        })
      )
      // Should NOT include optional fields when not provided
      const updateArg = (mockSupabase.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(updateArg).not.toHaveProperty("courier_ppp_ref")
      expect(updateArg).not.toHaveProperty("settlement_ref")
      expect(updateArg).not.toHaveProperty("settlement_amount")
    })

    it("throws when order not found", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: { message: "not found" },
      })

      const { recordCodSettlement } = await import("@/app/actions/admin")
      await expect(recordCodSettlement(validOrderId, {})).rejects.toThrow("Поръчката не е намерена")
    })

    it("rejects future paid_at date", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: validOrderId, payment_method: "cod", status: "delivered" },
        error: null,
      })

      const { recordCodSettlement } = await import("@/app/actions/admin")
      await expect(
        recordCodSettlement(validOrderId, { paidAt: "2099-01-01" })
      ).rejects.toThrow("не може да е в бъдещето")
    })

    it("rejects invalid paid_at date", async () => {
      const { recordCodSettlement } = await import("@/app/actions/admin")
      await expect(
        recordCodSettlement(validOrderId, { paidAt: "not-a-date" })
      ).rejects.toThrow("Невалидна дата на плащане")
    })

    it("uses provided paid_at date at end of day UTC", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: validOrderId, payment_method: "cod", status: "delivered" },
        error: null,
      })

      const { recordCodSettlement } = await import("@/app/actions/admin")
      await recordCodSettlement(validOrderId, { paidAt: "2026-04-10" })

      const updateArg = (mockSupabase.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(updateArg.paid_at).toBe("2026-04-10T23:59:59.000Z")
    })

    it("rejects paid_at before delivery date", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: validOrderId, payment_method: "cod", status: "delivered", delivered_at: "2026-04-15T10:00:00.000Z" },
        error: null,
      })

      const { recordCodSettlement } = await import("@/app/actions/admin")
      await expect(
        recordCodSettlement(validOrderId, { paidAt: "2026-04-14" })
      ).rejects.toThrow("преди доставката")
    })

    it("rejects when settlement already recorded (idempotency guard)", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: validOrderId, payment_method: "cod", status: "delivered" },
        error: null,
      })
      // Update returns empty array — paid_at IS NULL guard didn't match (already paid)
      const updateChain = {
        eq: vi.fn(() => updateChain),
        is: vi.fn(() => updateChain),
        select: vi.fn(() => updateChain),
        then(resolve: (v: unknown) => void) {
          resolve({ data: [], error: null })
        },
      }
      mockSupabase.update = vi.fn(() => updateChain)

      const { recordCodSettlement } = await import("@/app/actions/admin")
      await expect(
        recordCodSettlement(validOrderId, { settlementAmount: 5000 })
      ).rejects.toThrow("Плащането вече е записано")
    })

    it("throws on database update error", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: validOrderId, payment_method: "cod", status: "delivered" },
        error: null,
      })
      const updateChain = {
        eq: vi.fn(() => updateChain),
        is: vi.fn(() => updateChain),
        select: vi.fn(() => updateChain),
        then(resolve: (v: unknown) => void) {
          resolve({ data: null, error: { message: "DB error" } })
        },
      }
      mockSupabase.update = vi.fn(() => updateChain)

      const { recordCodSettlement } = await import("@/app/actions/admin")
      await expect(
        recordCodSettlement(validOrderId, { settlementAmount: 5000 })
      ).rejects.toThrow("Грешка при записване на плащане")
    })
  })

  describe("updateOrderStatus — timestamps and side effects", () => {
    const validOrderId = validUUID

    it("sets shipped_at and tracking_number when marking as shipped", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: {
          id: validOrderId, status: "confirmed",
          items: [{ productName: "Test", quantity: 1, priceInCents: 1000 }],
          email: "test@test.com", first_name: "Test",
        },
        error: null,
      })

      const { updateOrderStatus } = await import("@/app/actions/admin")
      await updateOrderStatus(validOrderId, "shipped", "BG123")

      expect(mockSupabase.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "shipped",
          shipped_at: expect.any(String),
          tracking_number: "BG123",
        })
      )
    })

    it("delegates to confirmDeliveryForOrder when marking as delivered", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: {
          id: validOrderId, status: "shipped",
          payment_method: "card", needs_invoice: false,
        },
        error: null,
      })
      mockConfirmDeliveryForOrder.mockResolvedValueOnce({ confirmed: true })

      const { updateOrderStatus } = await import("@/app/actions/admin")
      await updateOrderStatus(validOrderId, "delivered")

      expect(mockConfirmDeliveryForOrder).toHaveBeenCalledWith(
        validOrderId,
        expect.any(String),
        "admin"
      )
    })

    it("throws when confirmDeliveryForOrder returns not confirmed", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: {
          id: validOrderId, status: "shipped",
          payment_method: "card", needs_invoice: false,
        },
        error: null,
      })
      mockConfirmDeliveryForOrder.mockResolvedValueOnce({ confirmed: false })

      const { updateOrderStatus } = await import("@/app/actions/admin")
      await expect(
        updateOrderStatus(validOrderId, "delivered")
      ).rejects.toThrow("Order status was changed by another request")
    })

    it("sets cancelled_at and reason when cancelling", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: validOrderId, status: "confirmed", items: [] },
        error: null,
      })

      const { updateOrderStatus } = await import("@/app/actions/admin")
      await updateOrderStatus(validOrderId, "cancelled", undefined, "Customer requested")

      expect(mockSupabase.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "cancelled",
          cancelled_at: expect.any(String),
          cancellation_reason: "Customer requested",
        })
      )
    })

    it("sets confirmed_at when confirming", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: validOrderId, status: "pending" },
        error: null,
      })

      const { updateOrderStatus } = await import("@/app/actions/admin")
      await updateOrderStatus(validOrderId, "confirmed")

      expect(mockSupabase.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "confirmed",
          confirmed_at: expect.any(String),
        })
      )
    })
  })

  describe("getShipmentDefaults", () => {
    it("throws Unauthorized when not authenticated", async () => {
      mockValidateAdminSession.mockResolvedValue(false)
      const { getShipmentDefaults } = await import("@/app/actions/admin")

      await expect(getShipmentDefaults(validUUID)).rejects.toThrow("Unauthorized")
    })

    it("rejects invalid UUID", async () => {
      const { getShipmentDefaults } = await import("@/app/actions/admin")

      await expect(getShipmentDefaults("bad-id")).rejects.toThrow("Invalid order ID")
    })

    it("returns form data and display info for Econt office order", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: {
          id: validUUID,
          first_name: "Ivan",
          last_name: "Petrov",
          phone: "+359888123456",
          city: "Sofia",
          address: "ul. Test 1",
          postal_code: "1000",
          logistics_partner: "econt-office",
          payment_method: "cod",
          total_amount: 5000,
          econt_office_code: "1056",
          econt_office_name: "Sofia Mladost 1",
          speedy_office_id: null,
          speedy_office_name: null,
          items: [{ productName: "Dark Chocolate", quantity: 2 }],
        },
        error: null,
      })

      const { getShipmentDefaults } = await import("@/app/actions/admin")
      const result = await getShipmentDefaults(validUUID)

      expect(result.form.recipientName).toBe("Ivan Petrov")
      expect(result.form.recipientOfficeCode).toBe("1056")
      expect(result.form.recipientOfficeName).toBe("Sofia Mladost 1")
      expect(result.form.weight).toBe(1.0)
      expect(result.form.contents).toContain("Dark Chocolate x2")
      expect(result.display.courier).toBe("econt")
      expect(result.display.deliveryType).toBe("office")
      expect(result.display.codAmount).toBe(50)
    })

    it("returns form data for Speedy address order", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: {
          id: validUUID,
          first_name: "Maria",
          last_name: "Ivanova",
          phone: "+359899111222",
          city: "Plovdiv",
          address: "ul. Central 5",
          postal_code: "4000",
          logistics_partner: "speedy-address",
          payment_method: "card",
          total_amount: 2570,
          econt_office_code: null,
          econt_office_name: null,
          speedy_office_id: null,
          speedy_office_name: null,
          items: [{ productName: "Mix Box", quantity: 1 }],
        },
        error: null,
      })

      const { getShipmentDefaults } = await import("@/app/actions/admin")
      const result = await getShipmentDefaults(validUUID)

      expect(result.form.recipientName).toBe("Maria Ivanova")
      expect(result.form.recipientCity).toBe("Plovdiv")
      expect(result.form.recipientAddress).toBe("ul. Central 5")
      expect(result.display.courier).toBe("speedy")
      expect(result.display.deliveryType).toBe("address")
      expect(result.display.codAmount).toBe(0)
    })
  })

  describe("generateShipment", () => {
    const validForm: import("@/app/actions/admin").ShipmentFormData = {
      senderName: "Test Co",
      senderPhone: "0888111222",
      senderEmail: "test@test.com",
      senderAddress: "Test St 1",
      senderCity: "Sofia",
      senderPostalCode: "1000",
      senderOfficeCode: "1056",
      recipientName: "Ivan Petrov",
      recipientPhone: "+359888123456",
      recipientCity: "Sofia",
      recipientAddress: "ul. Test 1",
      recipientPostalCode: "1000",
      recipientOfficeId: "100",
      recipientOfficeCode: "1056",
      recipientOfficeName: "Sofia Mladost 1",
      weight: 1.5,
      contents: "Dark Chocolate x2",
    }

    it("throws Unauthorized when not authenticated", async () => {
      mockValidateAdminSession.mockResolvedValue(false)
      const { generateShipment } = await import("@/app/actions/admin")

      await expect(generateShipment(validUUID, validForm)).rejects.toThrow("Unauthorized")
    })

    it("rejects invalid UUID", async () => {
      const { generateShipment } = await import("@/app/actions/admin")

      await expect(generateShipment("bad-id", validForm)).rejects.toThrow("Invalid order ID")
    })

    it("rejects weight below 0.1 kg", async () => {
      const { generateShipment } = await import("@/app/actions/admin")

      await expect(generateShipment(validUUID, { ...validForm, weight: 0.05 })).rejects.toThrow("между 0.1 и 50")
    })

    it("rejects weight above 50 kg", async () => {
      const { generateShipment } = await import("@/app/actions/admin")

      await expect(generateShipment(validUUID, { ...validForm, weight: 51 })).rejects.toThrow("между 0.1 и 50")
    })

    it("rejects empty recipient name", async () => {
      const { generateShipment } = await import("@/app/actions/admin")

      await expect(generateShipment(validUUID, { ...validForm, recipientName: "" })).rejects.toThrow("Името на получателя")
    })

    it("rejects empty recipient phone", async () => {
      const { generateShipment } = await import("@/app/actions/admin")

      await expect(generateShipment(validUUID, { ...validForm, recipientPhone: "  " })).rejects.toThrow("Телефонът на получателя")
    })

    it("rejects empty contents", async () => {
      const { generateShipment } = await import("@/app/actions/admin")

      await expect(generateShipment(validUUID, { ...validForm, contents: "" })).rejects.toThrow("Съдържанието е задължително")
    })

    it("rejects contents over 200 chars", async () => {
      const { generateShipment } = await import("@/app/actions/admin")

      await expect(generateShipment(validUUID, { ...validForm, contents: "x".repeat(201) })).rejects.toThrow("Съдържанието е твърде дълго")
    })

    it("creates Econt shipment for econt-office order", async () => {
      // Lock succeeds
      const lockChain = {
        eq: vi.fn(() => lockChain),
        is: vi.fn(() => lockChain),
        select: vi.fn(() => lockChain),
        single: vi.fn(() => Promise.resolve({
          data: {
            id: validUUID, status: "confirmed", tracking_number: "__generating__",
            logistics_partner: "econt-office", payment_method: "card", total_amount: 2570,
          },
          error: null,
        })),
      }
      mockSupabase.update = vi.fn(() => lockChain)
      mockEcontCreateShipment.mockResolvedValueOnce({ trackingNumber: "ECONT999", pdfUrl: null })

      const { generateShipment } = await import("@/app/actions/admin")
      const result = await generateShipment(validUUID, validForm)

      expect(result.trackingNumber).toBe("ECONT999")
      expect(mockEcontCreateShipment).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientName: "Ivan Petrov",
          officeCode: "1056",
          weight: 1.5,
        })
      )
    })

    it("creates Speedy shipment for speedy-office order", async () => {
      const lockChain = {
        eq: vi.fn(() => lockChain),
        is: vi.fn(() => lockChain),
        select: vi.fn(() => lockChain),
        single: vi.fn(() => Promise.resolve({
          data: {
            id: validUUID, status: "confirmed", tracking_number: "__generating__",
            logistics_partner: "speedy-office", payment_method: "cod", total_amount: 5000,
          },
          error: null,
        })),
      }
      mockSupabase.update = vi.fn(() => lockChain)
      mockSpeedyCreateShipment.mockResolvedValueOnce({ trackingNumber: "SPD456", shipmentId: "2" })

      const { generateShipment } = await import("@/app/actions/admin")
      const result = await generateShipment(validUUID, validForm)

      expect(result.trackingNumber).toBe("SPD456")
      expect(mockSpeedyCreateShipment).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientName: "Ivan Petrov",
          officeId: 100,
          codAmount: 50, // 5000 / 100
        })
      )
    })

    it("uses COD amount from order, not from form", async () => {
      const lockChain = {
        eq: vi.fn(() => lockChain),
        is: vi.fn(() => lockChain),
        select: vi.fn(() => lockChain),
        single: vi.fn(() => Promise.resolve({
          data: {
            id: validUUID, status: "confirmed", tracking_number: "__generating__",
            logistics_partner: "econt-office", payment_method: "cod", total_amount: 3000,
          },
          error: null,
        })),
      }
      mockSupabase.update = vi.fn(() => lockChain)

      const { generateShipment } = await import("@/app/actions/admin")
      await generateShipment(validUUID, validForm)

      // COD amount should be 30.00 EUR (from order.total_amount / 100), not whatever the form has
      expect(mockEcontCreateShipment).toHaveBeenCalledWith(
        expect.objectContaining({ codAmount: 30 })
      )
    })

    it("does not pass COD for card payments", async () => {
      const lockChain = {
        eq: vi.fn(() => lockChain),
        is: vi.fn(() => lockChain),
        select: vi.fn(() => lockChain),
        single: vi.fn(() => Promise.resolve({
          data: {
            id: validUUID, status: "confirmed", tracking_number: "__generating__",
            logistics_partner: "econt-office", payment_method: "card", total_amount: 3000,
          },
          error: null,
        })),
      }
      mockSupabase.update = vi.fn(() => lockChain)

      const { generateShipment } = await import("@/app/actions/admin")
      await generateShipment(validUUID, validForm)

      expect(mockEcontCreateShipment).toHaveBeenCalledWith(
        expect.objectContaining({ codAmount: undefined })
      )
    })

    it("rejects when order is not confirmed", async () => {
      // Lock fails (status is not confirmed)
      const lockChain = {
        eq: vi.fn(() => lockChain),
        is: vi.fn(() => lockChain),
        select: vi.fn(() => lockChain),
        single: vi.fn(() => Promise.resolve({ data: null, error: { message: "no rows" } })),
      }
      mockSupabase.update = vi.fn(() => lockChain)
      // Fallback check returns shipped status
      mockSupabase.single.mockResolvedValueOnce({
        data: { status: "shipped", tracking_number: null },
        error: null,
      })

      const { generateShipment } = await import("@/app/actions/admin")
      await expect(generateShipment(validUUID, validForm)).rejects.toThrow("потвърдени поръчки")
    })

    it("rejects when order already has tracking number", async () => {
      const lockChain = {
        eq: vi.fn(() => lockChain),
        is: vi.fn(() => lockChain),
        select: vi.fn(() => lockChain),
        single: vi.fn(() => Promise.resolve({ data: null, error: { message: "no rows" } })),
      }
      mockSupabase.update = vi.fn(() => lockChain)
      mockSupabase.single.mockResolvedValueOnce({
        data: { status: "confirmed", tracking_number: "EXISTING123" },
        error: null,
      })

      const { generateShipment } = await import("@/app/actions/admin")
      await expect(generateShipment(validUUID, validForm)).rejects.toThrow("вече има товарителница")
    })

    it("rolls back lock when courier API fails", async () => {
      const lockChain = {
        eq: vi.fn(() => lockChain),
        is: vi.fn(() => lockChain),
        select: vi.fn(() => lockChain),
        single: vi.fn(() => Promise.resolve({
          data: {
            id: validUUID, status: "confirmed", tracking_number: "__generating__",
            logistics_partner: "econt-office", payment_method: "card", total_amount: 2570,
          },
          error: null,
        })),
      }
      mockSupabase.update = vi.fn(() => lockChain)
      mockEcontCreateShipment.mockRejectedValueOnce(new Error("Econt API timeout"))

      const { generateShipment } = await import("@/app/actions/admin")
      await expect(generateShipment(validUUID, validForm)).rejects.toThrow("Econt API timeout")

      // Verify rollback was called — update was called at least twice (lock + rollback)
      expect(mockSupabase.update).toHaveBeenCalledTimes(2)
      // Second call should set tracking_number to null
      expect(mockSupabase.update).toHaveBeenLastCalledWith({ tracking_number: null })
    })

    it("reports orphaned shipment when DB save fails", async () => {
      const callCount = { n: 0 }
      const lockChain = {
        eq: vi.fn(() => lockChain),
        is: vi.fn(() => lockChain),
        select: vi.fn(() => lockChain),
        single: vi.fn(() => Promise.resolve({
          data: {
            id: validUUID, status: "confirmed", tracking_number: "__generating__",
            logistics_partner: "econt-office", payment_method: "card", total_amount: 2570,
          },
          error: null,
        })),
      }
      mockSupabase.update = vi.fn(() => {
        callCount.n++
        if (callCount.n === 1) return lockChain // lock succeeds
        // Save fails (second update call)
        return mockThenableResult(null, { message: "DB timeout" })
      })

      const { generateShipment } = await import("@/app/actions/admin")
      await expect(generateShipment(validUUID, validForm)).rejects.toThrow("не можа да бъде запазена")
    })
  })
})
