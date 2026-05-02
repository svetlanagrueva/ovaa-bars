import { describe, it, expect, vi, beforeEach } from "vitest"
import { createSupabaseMock, resetSupabaseMock, mockThenableResult } from "./helpers/supabase-mock"
import { validUUID } from "./helpers/fixtures"

// Helper: minimal Stripe refund shape for the verification check.
// Defaults match the "happy path" in most recordRefund tests; individual
// tests override fields to exercise specific rejection paths.
function mockStripeRefund(overrides: {
  id?: string
  status?: "succeeded" | "pending" | "failed" | "canceled" | "requires_action"
  payment_intent?: string | null
  amount?: number
} = {}) {
  return {
    id: overrides.id ?? "re_abc123",
    status: overrides.status ?? "succeeded",
    payment_intent: overrides.payment_intent ?? "pi_test",
    amount: overrides.amount ?? 5000,
    created: Math.floor(Date.now() / 1000),
    currency: "eur",
    reason: null,
  }
}

const TEST_IDEMPOTENCY_KEY = "11111111-2222-3333-4444-555555555555"

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
const mockConfirmDeliveryForOrder: any = vi.fn(() => Promise.resolve({ confirmed: true }))
vi.mock("@/lib/delivery-confirmation", () => ({
  confirmDeliveryForOrder: (a: string, b: string, c: string) => mockConfirmDeliveryForOrder(a, b, c),
}))

// Mock @/lib/stripe — importing it pulls in `server-only`, which refuses
// to load outside a Next.js server context. Only the refunds surface is
// used by admin.ts; stub that with jest-fn so individual tests can override.
vi.mock("@/lib/stripe", () => ({
  stripe: {
    refunds: {
      retrieve: vi.fn(),
    },
  },
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

// Mock email-sender — admin actions import these helpers for manual resends.
// We verify the server action calls them with the right args; the helpers
// themselves are fire-and-forget and tested separately.
const mockSendOrderConfirmationEmail: any = vi.fn(() => Promise.resolve())
const mockSendDeliveryEmail: any = vi.fn(() => Promise.resolve())
vi.mock("@/lib/email-sender", () => ({
  sendOrderConfirmationEmail: (...args: unknown[]) => mockSendOrderConfirmationEmail(...args),
  sendDeliveryEmail: (...args: unknown[]) => mockSendDeliveryEmail(...args),
  notifyAdminNewOrder: vi.fn(() => Promise.resolve()),
  sendWithdrawalReceivedEmail: vi.fn(() => Promise.resolve()),
  sendWithdrawalApprovedEmail: vi.fn(() => Promise.resolve()),
  sendWithdrawalRejectedEmail: vi.fn(() => Promise.resolve()),
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
      // getOrders now joins invoices(type, invoice_number, invoice_date) and
      // surfaces them as `invoice` on each summary row.
      const fakeOrders = [
        { id: "order-1", invoices: [] },
        { id: "order-2", invoices: [{ type: "invoice", invoice_number: "F-1", invoice_date: "2026-04-01" }] },
      ]
      mockSupabase.range.mockReturnValue(mockThenableResult(fakeOrders, null, 2))

      const { getOrders } = await import("@/app/actions/admin")
      const result = await getOrders()

      expect(result.total).toBe(2)
      expect(result.orders).toHaveLength(2)
      expect(result.orders[0]).toEqual({
        id: "order-1",
        invoice: null,
        invoiceState: "none",
        refunds_total: 0,
      })
      expect(result.orders[1]).toEqual({
        id: "order-2",
        invoice: { invoice_number: "F-1", invoice_date: "2026-04-01" },
        // Fake invoice has invoice_number set but no sent_at → pending_send.
        invoiceState: "pending_send",
        refunds_total: 0,
      })
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

    it("returns order detail with empty inventoryReturns + auditEvents for valid UUID", async () => {
      // getOrder fans out five parallel queries:
      //   1. orders JOIN (uses .single)
      //   2. inventory_log returns (thenable)
      //   3. order_audit_events (thenable)
      //   4. invoices for this order (thenable)
      //   5. withdrawals for this order (thenable)
      const fakeOrder = { id: validUUID, status: "pending" }
      mockSupabase.single.mockResolvedValue({ data: fakeOrder, error: null })
      let callIndex = 0
      mockSupabase.from = vi.fn(() => {
        callIndex += 1
        if (callIndex >= 2) return mockThenableResult([], null) as never
        return mockSupabase as never
      })

      const { getOrder } = await import("@/app/actions/admin")
      const result = await getOrder(validUUID)

      expect(result).toEqual({
        ...fakeOrder,
        invoice: null,
        invoiceState: "none",
        refunds_total: 0,
        invoices: [],
        withdrawals: [],
        inventoryReturns: [],
        auditEvents: [],
      })
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

    it("calls add_admin_note RPC with trimmed text", async () => {
      mockSupabase.rpc = vi.fn(() => Promise.resolve({ data: null, error: null }))

      const { addAdminNote } = await import("@/app/actions/admin")
      const result = await addAdminNote(validOrderId, "  Second note  ")

      expect(result).toEqual({ success: true })
      expect(mockSupabase.rpc).toHaveBeenCalledWith("add_admin_note", {
        p_order_id: validOrderId,
        p_text: "Second note",
      })
    })

    it("throws when RPC reports order not found", async () => {
      mockSupabase.rpc = vi.fn(() => Promise.resolve({
        data: null,
        error: { message: "Order <uuid> not found" },
      }))

      const { addAdminNote } = await import("@/app/actions/admin")
      await expect(addAdminNote(validOrderId, "note")).rejects.toThrow("Поръчката не е намерена")
    })

    it("throws generic error on other RPC failures", async () => {
      mockSupabase.rpc = vi.fn(() => Promise.resolve({
        data: null,
        error: { message: "connection refused" },
      }))

      const { addAdminNote } = await import("@/app/actions/admin")
      await expect(addAdminNote(validOrderId, "note")).rejects.toThrow("Грешка при добавяне на бележка")
    })
  })

  describe("getInvoices", () => {
    it("throws Unauthorized when not authenticated", async () => {
      mockValidateAdminSession.mockResolvedValue(false)
      const { getInvoices } = await import("@/app/actions/admin")

      await expect(getInvoices()).rejects.toThrow("Unauthorized")
    })

    it("returns paginated invoices", async () => {
      // Now returns rows from invoices joined with orders for customer info.
      // mapInvoiceRowToSummary flattens the join structure.
      const fakeRows = [
        {
          id: "inv-1",
          order_id: "order-1",
          type: "invoice",
          invoice_number: "F-2026-0001",
          invoice_date: "2026-04-01",
          due_at: null,
          invoice_type: "individual",
          company_name: null,
          eik: null,
          orders: { first_name: "Иван", last_name: "Петров", email: "i@example.com", total_amount: 5000 },
        },
      ]
      mockSupabase.range.mockReturnValue(mockThenableResult(fakeRows, null, 1))

      const { getInvoices } = await import("@/app/actions/admin")
      const result = await getInvoices()

      expect(result.total).toBe(1)
      expect(result.invoices).toHaveLength(1)
      expect(result.invoices[0]).toMatchObject({
        id: "inv-1",
        order_id: "order-1",
        type: "invoice",
        invoice_number: "F-2026-0001",
        customer_first_name: "Иван",
        customer_email: "i@example.com",
      })
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
      const fakeOrders = Array.from({ length: 5 }, (_, i) => ({ id: `order-${i}`, invoices: [] }))
      mockSupabase.range.mockReturnValue(mockThenableResult(fakeOrders))

      const { getAllOrders } = await import("@/app/actions/admin")
      const result = await getAllOrders()

      expect(result).toHaveLength(5)
      expect(result[0]).toEqual({
        id: "order-0",
        invoice: null,
        invoiceState: "none",
        refunds_total: 0,
      })
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
      const fakeRows = [
        {
          id: "inv-1",
          order_id: "order-1",
          type: "invoice",
          invoice_number: "F-1",
          invoice_date: "2026-04-01",
          due_at: null,
          invoice_type: "individual",
          company_name: null,
          eik: null,
          orders: { first_name: "X", last_name: "Y", email: "z@e.com", total_amount: 100 },
        },
      ]
      mockSupabase.range.mockReturnValue(mockThenableResult(fakeRows))

      const { getAllInvoices } = await import("@/app/actions/admin")
      const result = await getAllInvoices()

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({ id: "inv-1", type: "invoice", invoice_number: "F-1" })
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
      mockSupabase.limit = vi.fn(() => mockThenableResult([]))
      mockSupabase.update = vi.fn(() => mockThenableResult(null))
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
    // markInvoiceSent now takes the invoices.id (not orders.id) and works
    // for both type='invoice' and type='credit_note' rows.
    const validInvoiceId = validUUID

    it("throws Unauthorized when not authenticated", async () => {
      mockValidateAdminSession.mockResolvedValue(false)
      const { markInvoiceSent } = await import("@/app/actions/admin")

      await expect(markInvoiceSent(validInvoiceId)).rejects.toThrow("Unauthorized")
    })

    it("rejects invalid UUID", async () => {
      const { markInvoiceSent } = await import("@/app/actions/admin")

      await expect(markInvoiceSent("bad-id")).rejects.toThrow("Invalid invoice ID")
    })

    it("marks invoice as sent successfully", async () => {
      const updateChain = {
        eq: vi.fn(() => updateChain),
        not: vi.fn(() => updateChain),
        is: vi.fn(() => updateChain),
        select: vi.fn(() => updateChain),
        then(resolve: (v: unknown) => void) {
          resolve({ data: [{ id: validInvoiceId }], error: null })
        },
      }
      mockSupabase.update = vi.fn(() => updateChain)

      const { markInvoiceSent } = await import("@/app/actions/admin")
      const result = await markInvoiceSent(validInvoiceId)

      expect(result).toEqual({ success: true })
      expect(mockSupabase.update).toHaveBeenCalledWith(
        expect.objectContaining({ sent_at: expect.any(String) })
      )
    })

    it("throws when invoice has no number or already sent", async () => {
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
      await expect(markInvoiceSent(validInvoiceId)).rejects.toThrow("няма номер или вече е отбелязан")
    })
  })

  describe("markCodConfirmed", () => {
    const validOrderId = validUUID

    it("throws Unauthorized when not authenticated", async () => {
      mockValidateAdminSession.mockResolvedValue(false)
      const { markCodConfirmed } = await import("@/app/actions/admin")
      await expect(markCodConfirmed(validOrderId)).rejects.toThrow("Unauthorized")
    })

    it("rejects invalid UUID", async () => {
      const { markCodConfirmed } = await import("@/app/actions/admin")
      await expect(markCodConfirmed("not-a-uuid")).rejects.toThrow("Invalid order ID")
    })

    it("rejects non-COD orders", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: {
          id: validOrderId,
          payment_method: "card",
          status: "confirmed",
          cod_confirmed_at: null,
        },
        error: null,
      })
      const { markCodConfirmed } = await import("@/app/actions/admin")
      await expect(markCodConfirmed(validOrderId)).rejects.toThrow("само за поръчки с наложен платеж")
    })

    it("rejects orders not in 'confirmed' status", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: {
          id: validOrderId,
          payment_method: "cod",
          status: "shipped",
          cod_confirmed_at: null,
        },
        error: null,
      })
      const { markCodConfirmed } = await import("@/app/actions/admin")
      await expect(markCodConfirmed(validOrderId)).rejects.toThrow("само за потвърдени поръчки")
    })

    it("rejects when already confirmed (idempotent guard in pre-check)", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: {
          id: validOrderId,
          payment_method: "cod",
          status: "confirmed",
          cod_confirmed_at: "2026-04-24T10:00:00Z",
        },
        error: null,
      })
      const { markCodConfirmed } = await import("@/app/actions/admin")
      await expect(markCodConfirmed(validOrderId)).rejects.toThrow("вече е потвърдено")
    })

    it("marks cod_confirmed_at + cod_confirmed_by='admin' and returns success", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: {
          id: validOrderId,
          payment_method: "cod",
          status: "confirmed",
          cod_confirmed_at: null,
        },
        error: null,
      })
      // Update chain resolves with one affected row (the happy-path return from .select())
      const updateChain = {
        eq: vi.fn(() => updateChain),
        is: vi.fn(() => updateChain),
        select: vi.fn(() => updateChain),
        then(resolve: (v: unknown) => void) {
          resolve({ data: [{ id: validOrderId }], error: null })
        },
      }
      const updateSpy = vi.fn(() => updateChain)
      mockSupabase.update = updateSpy as any

      const { markCodConfirmed } = await import("@/app/actions/admin")
      const result = await markCodConfirmed(validOrderId)
      expect(result).toEqual({ success: true })
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          cod_confirmed_at: expect.any(String),
          cod_confirmed_by: "admin",
        }),
      )
    })

    it("rejects when concurrent update beats us (.is(cod_confirmed_at,null) guard)", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: {
          id: validOrderId,
          payment_method: "cod",
          status: "confirmed",
          cod_confirmed_at: null,
        },
        error: null,
      })
      // Simulate a second concurrent click racing with us: the pre-check passed
      // because the other request hadn't committed yet, but our UPDATE ...
      // WHERE cod_confirmed_at IS NULL finds zero rows because the other
      // request already set the timestamp. The idempotent-guard path surfaces
      // as the same "already confirmed" message.
      const updateChain = {
        eq: vi.fn(() => updateChain),
        is: vi.fn(() => updateChain),
        select: vi.fn(() => updateChain),
        then(resolve: (v: unknown) => void) {
          resolve({ data: [], error: null })
        },
      }
      mockSupabase.update = vi.fn(() => updateChain) as any

      const { markCodConfirmed } = await import("@/app/actions/admin")
      await expect(markCodConfirmed(validOrderId)).rejects.toThrow("вече е потвърдено")
    })
  })

  describe("updateOrderContact", () => {
    const validOrderId = validUUID

    it("throws Unauthorized when not authenticated", async () => {
      mockValidateAdminSession.mockResolvedValue(false)
      const { updateOrderContact } = await import("@/app/actions/admin")
      await expect(updateOrderContact(validOrderId, { phone: "+359888111222" })).rejects.toThrow("Unauthorized")
    })

    it("rejects invalid UUID", async () => {
      const { updateOrderContact } = await import("@/app/actions/admin")
      await expect(updateOrderContact("bad-id", { phone: "+359888111222" })).rejects.toThrow("Invalid order ID")
    })

    it("rejects empty payload", async () => {
      const { updateOrderContact } = await import("@/app/actions/admin")
      await expect(updateOrderContact(validOrderId, {})).rejects.toThrow("Няма промени")
    })

    it("rejects empty trimmed firstName", async () => {
      const { updateOrderContact } = await import("@/app/actions/admin")
      await expect(updateOrderContact(validOrderId, { firstName: "   " })).rejects.toThrow("Името не може")
    })

    it("rejects malformed phone", async () => {
      const { updateOrderContact } = await import("@/app/actions/admin")
      await expect(updateOrderContact(validOrderId, { phone: "not-a-phone!" })).rejects.toThrow("Невалиден формат на телефон")
    })

    it("updates only the provided fields and calls .eq('status','confirmed')", async () => {
      const updateChain = {
        eq: vi.fn(() => updateChain),
        select: vi.fn(() => updateChain),
        then(resolve: (v: unknown) => void) {
          resolve({ data: [{ id: validOrderId }], error: null })
        },
      }
      const updateSpy = vi.fn(() => updateChain)
      mockSupabase.update = updateSpy as any

      const { updateOrderContact } = await import("@/app/actions/admin")
      const result = await updateOrderContact(validOrderId, {
        firstName: "  Ivan  ",
        phone: "+359 888 111 222",
      })

      expect(result).toEqual({ success: true })
      // Trimmed + only provided fields appear
      expect(updateSpy).toHaveBeenCalledWith({
        first_name: "Ivan",
        phone: "+359 888 111 222",
      })
      // Status gate enforced atomically
      expect(updateChain.eq).toHaveBeenCalledWith("status", "confirmed")
    })

    it("surfaces status-mismatch error with the current status", async () => {
      // Zero rows affected by the .eq("status", "confirmed") update
      const updateChain = {
        eq: vi.fn(() => updateChain),
        select: vi.fn(() => updateChain),
        then(resolve: (v: unknown) => void) {
          resolve({ data: [], error: null })
        },
      }
      mockSupabase.update = vi.fn(() => updateChain) as any
      // Follow-up .single() returns the order with its actual status
      mockSupabase.single.mockResolvedValueOnce({
        data: { status: "shipped" },
        error: null,
      })

      const { updateOrderContact } = await import("@/app/actions/admin")
      await expect(
        updateOrderContact(validOrderId, { phone: "+359888111222" }),
      ).rejects.toThrow(/потвърдени поръчки.*shipped/)
    })

    it("rejects empty trimmed email", async () => {
      const { updateOrderContact } = await import("@/app/actions/admin")
      await expect(
        updateOrderContact(validOrderId, { email: "   " }),
      ).rejects.toThrow("Имейлът не може да е празен")
    })

    it("rejects malformed email", async () => {
      const { updateOrderContact } = await import("@/app/actions/admin")
      await expect(
        updateOrderContact(validOrderId, { email: "not-an-email" }),
      ).rejects.toThrow("Невалиден формат на имейл")
    })

    it("normalizes email to lowercase before update (chk_orders_email_lowercase)", async () => {
      const updateChain = {
        eq: vi.fn(() => updateChain),
        select: vi.fn(() => updateChain),
        then(resolve: (v: unknown) => void) {
          resolve({ data: [{ id: validOrderId }], error: null })
        },
      }
      const updateSpy = vi.fn(() => updateChain)
      mockSupabase.update = updateSpy as any

      const { updateOrderContact } = await import("@/app/actions/admin")
      await updateOrderContact(validOrderId, { email: "  Foo.BAR@Example.COM  " })

      expect(updateSpy).toHaveBeenCalledWith({ email: "foo.bar@example.com" })
    })
  })

  describe("updateOrderQuantity", () => {
    const validOrderId = validUUID

    it("throws Unauthorized when not authenticated", async () => {
      mockValidateAdminSession.mockResolvedValue(false)
      const { updateOrderQuantity } = await import("@/app/actions/admin")
      await expect(updateOrderQuantity(validOrderId, "EGO-DC-12", 2)).rejects.toThrow("Unauthorized")
    })

    it("rejects invalid UUID", async () => {
      const { updateOrderQuantity } = await import("@/app/actions/admin")
      await expect(updateOrderQuantity("bad-id", "EGO-DC-12", 2)).rejects.toThrow("Invalid order ID")
    })

    it("rejects invalid SKU", async () => {
      const { updateOrderQuantity } = await import("@/app/actions/admin")
      await expect(updateOrderQuantity(validOrderId, "NOT-A-SKU", 2)).rejects.toThrow("Невалиден SKU")
    })

    it("rejects quantity out of bounds", async () => {
      const { updateOrderQuantity } = await import("@/app/actions/admin")
      await expect(updateOrderQuantity(validOrderId, "EGO-DC-12", 0)).rejects.toThrow("между 1 и 100")
      await expect(updateOrderQuantity(validOrderId, "EGO-DC-12", 101)).rejects.toThrow("между 1 и 100")
    })

    it("rejects card orders (routes through replaces_order_id instead)", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: validOrderId, payment_method: "card", status: "confirmed", tracking_number: null },
        error: null,
      })

      const { updateOrderQuantity } = await import("@/app/actions/admin")
      await expect(updateOrderQuantity(validOrderId, "EGO-DC-12", 3)).rejects.toThrow("картови поръчки")
    })

    it("rejects non-'confirmed' status", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: validOrderId, payment_method: "cod", status: "shipped", tracking_number: "TRK123" },
        error: null,
      })

      const { updateOrderQuantity } = await import("@/app/actions/admin")
      await expect(updateOrderQuantity(validOrderId, "EGO-DC-12", 3)).rejects.toThrow(/потвърдени поръчки/)
    })

    it("rejects orders with tracking_number already set", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: validOrderId, payment_method: "cod", status: "confirmed", tracking_number: "SPEEDY123" },
        error: null,
      })

      const { updateOrderQuantity } = await import("@/app/actions/admin")
      await expect(updateOrderQuantity(validOrderId, "EGO-DC-12", 3)).rejects.toThrow("Товарителницата вече е генерирана")
    })

    it("rejects SKU not in the order", async () => {
      mockSupabase.single
        .mockResolvedValueOnce({
          data: { id: validOrderId, payment_method: "cod", status: "confirmed", tracking_number: null },
          error: null,
        })
        .mockResolvedValueOnce({
          data: null,
          error: { message: "not found" },
        })

      const { updateOrderQuantity } = await import("@/app/actions/admin")
      await expect(updateOrderQuantity(validOrderId, "EGO-DC-12", 3)).rejects.toThrow("не е част от тази поръчка")
    })

    it("calls edit_order_quantity RPC + emits order_items_changed audit on change", async () => {
      mockSupabase.single
        .mockResolvedValueOnce({
          data: { id: validOrderId, payment_method: "cod", status: "confirmed", tracking_number: null },
          error: null,
        })
        .mockResolvedValueOnce({
          data: { quantity: 2, unit_price_cents: 500, product_name: "Dark Chocolate Box" },
          error: null,
        })

      const rpcSpy = vi.fn<(name: string, args: unknown) => Promise<unknown>>((name) => {
        if (name === "edit_order_quantity") return Promise.resolve({ data: 1500, error: null })
        return Promise.resolve({ data: null, error: null })
      })
      mockSupabase.rpc = rpcSpy as never

      const { updateOrderQuantity } = await import("@/app/actions/admin")
      const result = await updateOrderQuantity(validOrderId, "EGO-DC-12", 4)

      expect(result).toEqual({ success: true, newTotalCents: 1500 })

      // First RPC: edit_order_quantity with new quantity
      const editCall = rpcSpy.mock.calls.find((c) => c[0] === "edit_order_quantity")
      expect(editCall).toBeDefined()
      expect(editCall![1]).toMatchObject({
        p_order_id: validOrderId,
        p_sku: "EGO-DC-12",
        p_new_quantity: 4,
      })

      // Second RPC: record_order_outcome with the audit payload
      const auditCall = rpcSpy.mock.calls.find((c) => c[0] === "record_order_outcome")
      expect(auditCall).toBeDefined()
      const auditArgs = auditCall![1] as { p_outcome_type: string; p_payload: Record<string, unknown> }
      expect(auditArgs.p_outcome_type).toBe("order_items_changed")
      expect(auditArgs.p_payload).toMatchObject({
        sku: "EGO-DC-12",
        old_quantity: 2,
        new_quantity: 4,
        delta: 2,
        new_total_cents: 1500,
      })
    })

    it("surfaces a friendly error when reserve_inventory runs out of stock", async () => {
      mockSupabase.single
        .mockResolvedValueOnce({
          data: { id: validOrderId, payment_method: "cod", status: "confirmed", tracking_number: null },
          error: null,
        })
        .mockResolvedValueOnce({
          data: { quantity: 2, unit_price_cents: 500, product_name: "Dark Chocolate Box" },
          error: null,
        })

      mockSupabase.rpc = vi.fn((name: string) => {
        if (name === "edit_order_quantity") {
          return Promise.resolve({
            data: null,
            error: { message: "Insufficient stock for SKU EGO-DC-12. Available: 1, requested: 2" },
          })
        }
        return Promise.resolve({ data: null, error: null })
      }) as never

      const { updateOrderQuantity } = await import("@/app/actions/admin")
      await expect(updateOrderQuantity(validOrderId, "EGO-DC-12", 4)).rejects.toThrow(
        /Няма достатъчна наличност за Dark Chocolate Box/,
      )
    })

    it("no-op edit (same quantity) does not emit audit", async () => {
      mockSupabase.single
        .mockResolvedValueOnce({
          data: { id: validOrderId, payment_method: "cod", status: "confirmed", tracking_number: null },
          error: null,
        })
        .mockResolvedValueOnce({
          data: { quantity: 3, unit_price_cents: 500, product_name: "Dark Chocolate Box" },
          error: null,
        })

      const rpcSpy = vi.fn<(name: string, args: unknown) => Promise<unknown>>((name) => {
        if (name === "edit_order_quantity") return Promise.resolve({ data: 1800, error: null })
        return Promise.resolve({ data: null, error: null })
      })
      mockSupabase.rpc = rpcSpy as never

      const { updateOrderQuantity } = await import("@/app/actions/admin")
      await updateOrderQuantity(validOrderId, "EGO-DC-12", 3) // same as current

      // edit_order_quantity still called (server-side handles the no-op
      // defensively) but audit is skipped.
      const editCall = rpcSpy.mock.calls.find((c) => c[0] === "edit_order_quantity")
      expect(editCall).toBeDefined()
      const auditCall = rpcSpy.mock.calls.find((c) => c[0] === "record_order_outcome")
      expect(auditCall).toBeUndefined()
    })
  })

  describe("resendOrderConfirmationEmail", () => {
    const validOrderId = validUUID

    it("throws Unauthorized when not authenticated", async () => {
      mockValidateAdminSession.mockResolvedValue(false)
      const { resendOrderConfirmationEmail } = await import("@/app/actions/admin")
      await expect(resendOrderConfirmationEmail(validOrderId)).rejects.toThrow("Unauthorized")
    })

    it("rejects invalid UUID", async () => {
      const { resendOrderConfirmationEmail } = await import("@/app/actions/admin")
      await expect(resendOrderConfirmationEmail("bad-id")).rejects.toThrow("Invalid order ID")
    })

    it("rejects when order is not found", async () => {
      mockSupabase.single.mockResolvedValueOnce({ data: null, error: { message: "nope" } })
      const { resendOrderConfirmationEmail } = await import("@/app/actions/admin")
      await expect(resendOrderConfirmationEmail(validOrderId)).rejects.toThrow("Поръчката не е намерена")
    })

    it("rejects pending orders (confirmation wording would be wrong)", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: validOrderId, status: "pending" },
        error: null,
      })
      const { resendOrderConfirmationEmail } = await import("@/app/actions/admin")
      await expect(resendOrderConfirmationEmail(validOrderId)).rejects.toThrow(/след потвърждение на плащането/)
    })

    it("rejects cancelled orders", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: validOrderId, status: "cancelled" },
        error: null,
      })
      const { resendOrderConfirmationEmail } = await import("@/app/actions/admin")
      await expect(resendOrderConfirmationEmail(validOrderId)).rejects.toThrow(/отказана/)
    })

    it("calls sendOrderConfirmationEmail + emits email_resent audit", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: validOrderId, status: "confirmed", first_name: "Ivan", email: "ivan@example.com" },
        error: null,
      })

      const rpcSpy = vi.fn(() => Promise.resolve({ data: null, error: null }))
      mockSupabase.rpc = rpcSpy as never

      const { resendOrderConfirmationEmail } = await import("@/app/actions/admin")
      const result = await resendOrderConfirmationEmail(validOrderId)

      expect(result).toEqual({ success: true })
      expect(mockSendOrderConfirmationEmail).toHaveBeenCalledOnce()
      expect(rpcSpy).toHaveBeenCalledWith("record_order_outcome", expect.objectContaining({
        p_order_id: validOrderId,
        p_outcome_type: "email_resent",
        p_payload: { email_type: "order_confirmation" },
        p_actor: "admin",
      }))
    })
  })

  describe("resendShippingEmail", () => {
    const validOrderId = validUUID

    it("throws Unauthorized when not authenticated", async () => {
      mockValidateAdminSession.mockResolvedValue(false)
      const { resendShippingEmail } = await import("@/app/actions/admin")
      await expect(resendShippingEmail(validOrderId)).rejects.toThrow("Unauthorized")
    })

    it("rejects invalid UUID", async () => {
      const { resendShippingEmail } = await import("@/app/actions/admin")
      await expect(resendShippingEmail("bad-id")).rejects.toThrow("Invalid order ID")
    })

    it("rejects when order is not found", async () => {
      mockSupabase.single.mockResolvedValueOnce({ data: null, error: { message: "nope" } })
      const { resendShippingEmail } = await import("@/app/actions/admin")
      await expect(resendShippingEmail(validOrderId)).rejects.toThrow("Поръчката не е намерена")
    })

    it("rejects orders with no tracking number", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: validOrderId, status: "confirmed", tracking_number: null },
        error: null,
      })
      const { resendShippingEmail } = await import("@/app/actions/admin")
      await expect(resendShippingEmail(validOrderId)).rejects.toThrow("Пратката още не е генерирана")
    })

    it("rejects orders with placeholder tracking", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: validOrderId, status: "confirmed", tracking_number: "__generating__" },
        error: null,
      })
      const { resendShippingEmail } = await import("@/app/actions/admin")
      await expect(resendShippingEmail(validOrderId)).rejects.toThrow("Пратката още не е генерирана")
    })

    it("sends shipping email + emits email_resent audit when tracking exists", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: {
          id: validOrderId,
          status: "shipped",
          tracking_number: "SPEEDY12345",
          email: "ivan@example.com",
          first_name: "Ivan",
          total_amount: 1000,
          logistics_partner: "speedy-office",
        },
        error: null,
      })

      mockSupabase.order.mockReturnValue(mockThenableResult({
        data: [{ product_name: "Dark Chocolate Box", quantity: 1, unit_price_cents: 1000 }],
        error: null,
      }) as never)

      const rpcSpy = vi.fn(() => Promise.resolve({ data: null, error: null }))
      mockSupabase.rpc = rpcSpy as never

      const { resendShippingEmail } = await import("@/app/actions/admin")
      const result = await resendShippingEmail(validOrderId)

      expect(result).toEqual({ success: true })
      expect(rpcSpy).toHaveBeenCalledWith("record_order_outcome", expect.objectContaining({
        p_order_id: validOrderId,
        p_outcome_type: "email_resent",
        p_payload: { email_type: "shipping" },
        p_actor: "admin",
      }))
    })
  })

  describe("resendDeliveryEmail", () => {
    const validOrderId = validUUID

    it("throws Unauthorized when not authenticated", async () => {
      mockValidateAdminSession.mockResolvedValue(false)
      const { resendDeliveryEmail } = await import("@/app/actions/admin")
      await expect(resendDeliveryEmail(validOrderId)).rejects.toThrow("Unauthorized")
    })

    it("rejects invalid UUID", async () => {
      const { resendDeliveryEmail } = await import("@/app/actions/admin")
      await expect(resendDeliveryEmail("bad-id")).rejects.toThrow("Invalid order ID")
    })

    it("rejects when order is not found", async () => {
      mockSupabase.single.mockResolvedValueOnce({ data: null, error: { message: "nope" } })
      const { resendDeliveryEmail } = await import("@/app/actions/admin")
      await expect(resendDeliveryEmail(validOrderId)).rejects.toThrow("Поръчката не е намерена")
    })

    it("rejects orders that aren't delivered yet", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: validOrderId, status: "shipped" },
        error: null,
      })
      const { resendDeliveryEmail } = await import("@/app/actions/admin")
      await expect(resendDeliveryEmail(validOrderId)).rejects.toThrow(/само за доставени поръчки/)
    })

    it("calls sendDeliveryEmail with force=true + emits email_resent audit", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: {
          id: validOrderId,
          status: "delivered",
          delivery_email_sent_at: "2026-04-20T12:00:00Z",
          first_name: "Ivan",
          email: "ivan@example.com",
        },
        error: null,
      })

      const rpcSpy = vi.fn(() => Promise.resolve({ data: null, error: null }))
      mockSupabase.rpc = rpcSpy as never

      const { resendDeliveryEmail } = await import("@/app/actions/admin")
      const result = await resendDeliveryEmail(validOrderId)

      expect(result).toEqual({ success: true })
      // Must be called with force: true so the delivery_email_sent_at early
      // return in the helper is bypassed — otherwise resending an already-
      // sent email would be a silent no-op.
      expect(mockSendDeliveryEmail).toHaveBeenCalledWith(
        expect.objectContaining({ id: validOrderId }),
        { force: true },
      )
      expect(rpcSpy).toHaveBeenCalledWith("record_order_outcome", expect.objectContaining({
        p_order_id: validOrderId,
        p_outcome_type: "email_resent",
        p_payload: { email_type: "delivery" },
        p_actor: "admin",
      }))
    })
  })

  describe("recordCodSettlement", () => {
    const validOrderId = validUUID

    it("throws Unauthorized when not authenticated", async () => {
      mockValidateAdminSession.mockResolvedValue(false)
      const { recordCodSettlement } = await import("@/app/actions/admin")

      await expect(recordCodSettlement(validOrderId, { settledAt: "2026-04-20" })).rejects.toThrow("Unauthorized")
    })

    it("rejects invalid UUID", async () => {
      const { recordCodSettlement } = await import("@/app/actions/admin")

      await expect(recordCodSettlement("bad-id", { settledAt: "2026-04-20" })).rejects.toThrow("Invalid order ID")
    })

    it("rejects non-COD orders", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: validOrderId, payment_method: "card", status: "delivered" },
        error: null,
      })

      const { recordCodSettlement } = await import("@/app/actions/admin")
      await expect(recordCodSettlement(validOrderId, { settledAt: "2026-04-20" })).rejects.toThrow("наложен платеж")
    })

    it("rejects settlement for non-delivered orders", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: validOrderId, payment_method: "cod", status: "confirmed" },
        error: null,
      })

      const { recordCodSettlement } = await import("@/app/actions/admin")
      await expect(recordCodSettlement(validOrderId, { settledAt: "2026-04-20" })).rejects.toThrow("доставени поръчки")
    })

    it("rejects ППП ref over 100 chars", async () => {
      const { recordCodSettlement } = await import("@/app/actions/admin")

      await expect(
        recordCodSettlement(validOrderId, { settledAt: "2026-04-20", courierPppRef: "x".repeat(101) })
      ).rejects.toThrow("ППП референцията е твърде дълга")
    })

    it("rejects settlement ref over 100 chars", async () => {
      const { recordCodSettlement } = await import("@/app/actions/admin")

      await expect(
        recordCodSettlement(validOrderId, { settledAt: "2026-04-20", settlementRef: "x".repeat(101) })
      ).rejects.toThrow("Референцията на превода е твърде дълга")
    })

    it("rejects non-positive settlement amount", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: validOrderId, payment_method: "cod", status: "delivered" },
        error: null,
      })

      const { recordCodSettlement } = await import("@/app/actions/admin")

      await expect(
        recordCodSettlement(validOrderId, { settledAt: "2026-04-20", settlementAmount: 0 })
      ).rejects.toThrow("положително число")

      mockSupabase.single.mockResolvedValueOnce({
        data: { id: validOrderId, payment_method: "cod", status: "delivered" },
        error: null,
      })

      await expect(
        recordCodSettlement(validOrderId, { settledAt: "2026-04-20", settlementAmount: -100 })
      ).rejects.toThrow("положително число")
    })

    it("rejects non-integer settlement amount", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: validOrderId, payment_method: "cod", status: "delivered" },
        error: null,
      })

      const { recordCodSettlement } = await import("@/app/actions/admin")

      await expect(
        recordCodSettlement(validOrderId, { settledAt: "2026-04-20", settlementAmount: 49.50 })
      ).rejects.toThrow("положително число")
    })

    it("records settlement successfully with all fields", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: validOrderId, payment_method: "cod", status: "delivered" },
        error: null,
      })

      const { recordCodSettlement } = await import("@/app/actions/admin")
      const result = await recordCodSettlement(validOrderId, {
        settledAt: "2026-04-20",
        courierPppRef: "PPP-12345",
        settlementRef: "BT-2026-04-001",
        settlementAmount: 4850,
      })

      expect(result).toEqual({ success: true })
      expect(mockSupabase.update).toHaveBeenCalledWith(
        expect.objectContaining({
          seller_settled_at: expect.any(String),
          courier_ppp_ref: "PPP-12345",
          settlement_ref: "BT-2026-04-001",
          settlement_amount: 4850,
        })
      )
    })

    it("records settlement with only seller_settled_at when no optional fields provided", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: validOrderId, payment_method: "cod", status: "delivered" },
        error: null,
      })

      const { recordCodSettlement } = await import("@/app/actions/admin")
      const result = await recordCodSettlement(validOrderId, { settledAt: "2026-04-20" })

      expect(result).toEqual({ success: true })
      expect(mockSupabase.update).toHaveBeenCalledWith(
        expect.objectContaining({
          seller_settled_at: expect.any(String),
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
      await expect(recordCodSettlement(validOrderId, { settledAt: "2026-04-20" })).rejects.toThrow("Поръчката не е намерена")
    })

    it("requires seller_settled_at — rejects when missing", async () => {
      const { recordCodSettlement } = await import("@/app/actions/admin")
      await expect(
        recordCodSettlement(validUUID, { settledAt: "" } as any)
      ).rejects.toThrow("Датата на плащане е задължителна")
    })

    it("rejects future seller_settled_at date", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: validOrderId, payment_method: "cod", status: "delivered" },
        error: null,
      })

      const { recordCodSettlement } = await import("@/app/actions/admin")
      await expect(
        recordCodSettlement(validOrderId, { settledAt: "2099-01-01" })
      ).rejects.toThrow("не може да е в бъдещето")
    })

    it("rejects invalid seller_settled_at date", async () => {
      const { recordCodSettlement } = await import("@/app/actions/admin")
      await expect(
        recordCodSettlement(validOrderId, { settledAt: "not-a-date" })
      ).rejects.toThrow("Невалидна дата на плащане")
    })

    it("uses provided seller_settled_at date at end of day UTC", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: validOrderId, payment_method: "cod", status: "delivered" },
        error: null,
      })

      const { recordCodSettlement } = await import("@/app/actions/admin")
      await recordCodSettlement(validOrderId, { settledAt: "2026-04-10" })

      const updateArg = (mockSupabase.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(updateArg.seller_settled_at).toBe("2026-04-10T23:59:59.000Z")
    })

    it("rejects seller_settled_at before delivery date", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: validOrderId, payment_method: "cod", status: "delivered", delivered_at: "2026-04-15T10:00:00.000Z" },
        error: null,
      })

      const { recordCodSettlement } = await import("@/app/actions/admin")
      await expect(
        recordCodSettlement(validOrderId, { settledAt: "2026-04-14" })
      ).rejects.toThrow("преди доставката")
    })

    it("rejects when settlement already recorded (idempotency guard)", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: validOrderId, payment_method: "cod", status: "delivered" },
        error: null,
      })
      // Update returns empty array — seller_settled_at IS NULL guard didn't match (already paid)
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
        recordCodSettlement(validOrderId, { settledAt: "2026-04-20", settlementAmount: 5000 })
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
        recordCodSettlement(validOrderId, { settledAt: "2026-04-20", settlementAmount: 5000 })
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
        },
        error: null,
      })
      mockSupabase.order.mockReturnValueOnce(mockThenableResult([
        { product_name: "Dark Chocolate", quantity: 2 },
      ]))

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
        },
        error: null,
      })
      mockSupabase.order.mockReturnValueOnce(mockThenableResult([
        { product_name: "Mix Box", quantity: 1 },
      ]))

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
      senderOfficeName: "Sofia Center 1",
      senderSpeedyOfficeId: "",
      senderSpeedyOfficeName: "",
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

  describe("recordStockMovement", () => {
    it("throws Unauthorized when not authenticated", async () => {
      mockValidateAdminSession.mockResolvedValue(false)
      const { recordStockMovement } = await import("@/app/actions/admin")

      await expect(
        recordStockMovement({
          idempotencyKey: TEST_IDEMPOTENCY_KEY,
          sku: "EGO-DC-12",
          type: "wholesale_out",
          quantity: 5,
          referenceType: "invoice",
          referenceId: "INV-001",
        }),
      ).rejects.toThrow("Unauthorized")
    })

    it("rejects invalid SKU", async () => {
      const { recordStockMovement } = await import("@/app/actions/admin")

      await expect(
        recordStockMovement({
          idempotencyKey: TEST_IDEMPOTENCY_KEY,
          sku: "INVALID-SKU",
          type: "wholesale_out",
          quantity: 5,
          referenceType: "invoice",
          referenceId: "INV-001",
        }),
      ).rejects.toThrow("Невалиден SKU")
    })

    it("rejects non-positive quantity", async () => {
      const { recordStockMovement } = await import("@/app/actions/admin")

      await expect(
        recordStockMovement({
          idempotencyKey: TEST_IDEMPOTENCY_KEY,
          sku: "EGO-DC-12",
          type: "wholesale_out",
          quantity: 0,
          referenceType: "invoice",
          referenceId: "INV-001",
        }),
      ).rejects.toThrow("цяло число между 1 и 100 000")
    })

    it("rejects non-integer quantity", async () => {
      const { recordStockMovement } = await import("@/app/actions/admin")

      await expect(
        recordStockMovement({
          idempotencyKey: TEST_IDEMPOTENCY_KEY,
          sku: "EGO-DC-12",
          type: "wholesale_out",
          quantity: 2.5,
          referenceType: "invoice",
          referenceId: "INV-001",
        }),
      ).rejects.toThrow("цяло число между 1 и 100 000")
    })

    it("rejects type ↔ referenceType mismatch", async () => {
      const { recordStockMovement } = await import("@/app/actions/admin")

      await expect(
        recordStockMovement({
          idempotencyKey: TEST_IDEMPOTENCY_KEY,
          sku: "EGO-DC-12",
          type: "wholesale_out",
          quantity: 5,
          referenceType: "internal",
          referenceId: "PROT-001",
        }),
      ).rejects.toThrow('Невалиден тип референция "internal" за движение "wholesale_out"')
    })

    it("rejects empty referenceId", async () => {
      const { recordStockMovement } = await import("@/app/actions/admin")

      await expect(
        recordStockMovement({
          idempotencyKey: TEST_IDEMPOTENCY_KEY,
          sku: "EGO-DC-12",
          type: "wholesale_out",
          quantity: 5,
          referenceType: "invoice",
          referenceId: "   ",
        }),
      ).rejects.toThrow("Референцията е задължителна")
    })

    it("requires notes for adjustment_loss", async () => {
      const { recordStockMovement } = await import("@/app/actions/admin")

      await expect(
        recordStockMovement({
          idempotencyKey: TEST_IDEMPOTENCY_KEY,
          sku: "EGO-DC-12",
          type: "adjustment_loss",
          quantity: 2,
          referenceType: "internal",
          referenceId: "COUNT-001",
        }),
      ).rejects.toThrow("Бележката е задължителна")
    })

    it("requires notes for damaged", async () => {
      const { recordStockMovement } = await import("@/app/actions/admin")

      await expect(
        recordStockMovement({
          idempotencyKey: TEST_IDEMPOTENCY_KEY,
          sku: "EGO-DC-12",
          type: "damaged",
          quantity: 1,
          referenceType: "internal",
          referenceId: "DMG-001",
        }),
      ).rejects.toThrow("Бележката е задължителна")
    })

    it("accepts optional batchId on outflow types so the batch ledger stays in sync", async () => {
      // sample_out / damaged-internal / adjustment_loss / adjustment_gain
      // all accept an optional batch_id — the row participates in
      // batch_quantity_available so admin can keep inventory_current and the
      // batches view consistent. Untagged rows still affect inventory_current.
      mockSupabase.insert.mockReturnValueOnce(mockThenableResult(null, null) as never)
      const { recordStockMovement } = await import("@/app/actions/admin")

      const result = await recordStockMovement({
        idempotencyKey: TEST_IDEMPOTENCY_KEY,
        sku: "EGO-DC-12",
        type: "sample_out",
        quantity: 1,
        referenceType: "internal",
        referenceId: "SAMPLE-2026-001",
        notes: "Влогер sample",
        batchId: "BATCH-001",
      })

      expect(result).toEqual({ success: true })
      expect(mockSupabase.insert).toHaveBeenCalledWith(
        expect.objectContaining({ batch_id: "BATCH-001", type: "sample_out" }),
      )
    })

    it("rejects wholesale_out without batchId (EU 931/2011)", async () => {
      const { recordStockMovement } = await import("@/app/actions/admin")

      await expect(
        recordStockMovement({
          idempotencyKey: TEST_IDEMPOTENCY_KEY,
          sku: "EGO-DC-12",
          type: "wholesale_out",
          quantity: 10,
          referenceType: "invoice",
          referenceId: "INV-2026-001",
          notes: "B2B delivery to gym",
          // batchId missing — should reject
        }),
      ).rejects.toThrow("задължителен за оптови продажби")
    })

    it("records wholesale_out successfully with batchId", async () => {
      const { recordStockMovement } = await import("@/app/actions/admin")

      const result = await recordStockMovement({
        idempotencyKey: TEST_IDEMPOTENCY_KEY,
        sku: "EGO-DC-12",
        type: "wholesale_out",
        quantity: 10,
        referenceType: "invoice",
        referenceId: "INV-2026-001",
        notes: "B2B delivery to gym",
        batchId: "BATCH-001",
      })

      expect(result).toEqual({ success: true })
      expect(mockSupabase.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          sku: "EGO-DC-12",
          type: "wholesale_out",
          quantity: 10,
          reference_type: "invoice",
          reference_id: "INV-2026-001",
          created_by: "admin",
        }),
      )
    })

    it("records return_in with batchId and orderId", async () => {
      // Order-scoped return: the new return-cap validation fires here,
      // requiring order_items + prior-returns mocks. Two thenable queries
      // precede the insert.
      const calls: unknown[] = [
        mockThenableResult([{ sku: "EGO-DC-12", quantity: 3 }], null), // order_items
        mockThenableResult([], null),                                   // prior returns
        mockSupabase,                                                    // inventory_log insert
      ]
      let idx = 0
      mockSupabase.from = vi.fn(() => {
        const ret = calls[idx] ?? mockSupabase
        idx += 1
        return ret as never
      })

      const { recordStockMovement } = await import("@/app/actions/admin")

      const result = await recordStockMovement({
        idempotencyKey: TEST_IDEMPOTENCY_KEY,
        sku: "EGO-DC-12",
        type: "return_in",
        quantity: 1,
        referenceType: "return",
        referenceId: "RET-001",
        batchId: "BATCH-003",
        orderId: validUUID,
      })

      expect(result).toEqual({ success: true })
      expect(mockSupabase.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "return_in",
          batch_id: "BATCH-003",
          order_id: validUUID,
          reference_type: "return",
        }),
      )
    })

    // ─── Return-cap coverage ─────────────────────────────────────────
    // Narrow scope: applies only when orderId + reference_type='return'
    // + type in {return_in, damaged}. Other movements bypass.

    it("rejects return-scoped movement for SKU not in the order", async () => {
      const calls: unknown[] = [
        mockThenableResult([{ sku: "EGO-WCR-12", quantity: 2 }], null), // order_items — different SKU
        mockThenableResult([], null),
      ]
      let idx = 0
      mockSupabase.from = vi.fn(() => {
        const ret = calls[idx] ?? mockSupabase
        idx += 1
        return ret as never
      })

      const { recordStockMovement } = await import("@/app/actions/admin")
      await expect(
        recordStockMovement({
          idempotencyKey: TEST_IDEMPOTENCY_KEY,
          sku: "EGO-DC-12",
          type: "return_in",
          quantity: 1,
          referenceType: "return",
          referenceId: "refund-abc",
          orderId: validUUID,
        }),
      ).rejects.toThrow("не е част от тази поръчка")
    })

    it("rejects over-restock with the friendly Bulgarian message", async () => {
      const calls: unknown[] = [
        mockThenableResult([{ sku: "EGO-DC-12", quantity: 2 }], null),  // shipped 2
        mockThenableResult([{ quantity: 2 }], null),                     // already returned 2
      ]
      let idx = 0
      mockSupabase.from = vi.fn(() => {
        const ret = calls[idx] ?? mockSupabase
        idx += 1
        return ret as never
      })

      const { recordStockMovement } = await import("@/app/actions/admin")
      await expect(
        recordStockMovement({
          idempotencyKey: TEST_IDEMPOTENCY_KEY,
          sku: "EGO-DC-12",
          type: "return_in",
          quantity: 1, // prior 2 + 1 > shipped 2
          referenceType: "return",
          referenceId: "refund-abc",
          orderId: validUUID,
        }),
      ).rejects.toThrow("Не можете да върнете/бракувате повече бройки")
    })

    it("return_in + damaged under 'return' scope share the cap", async () => {
      // Shipped 3, already damaged 1, attempt to return_in 3 → 1+3 > 3 → rejects.
      const calls: unknown[] = [
        mockThenableResult([{ sku: "EGO-DC-12", quantity: 3 }], null),
        mockThenableResult([{ quantity: 1 }], null),
      ]
      let idx = 0
      mockSupabase.from = vi.fn(() => {
        const ret = calls[idx] ?? mockSupabase
        idx += 1
        return ret as never
      })

      const { recordStockMovement } = await import("@/app/actions/admin")
      await expect(
        recordStockMovement({
          idempotencyKey: TEST_IDEMPOTENCY_KEY,
          sku: "EGO-DC-12",
          type: "return_in",
          quantity: 3,
          referenceType: "return",
          referenceId: "refund-abc",
          orderId: validUUID,
        }),
      ).rejects.toThrow("Не можете да върнете")
    })

    it("warehouse-internal damaged bypasses the cap (no orderId / reference_type='internal')", async () => {
      // Default mockSupabase routing — no thenables set up; insert succeeds.
      // Critical: recordStockMovement must NOT attempt to load order_items
      // when orderId is absent, or we'd see an unexpected from() call.
      const fromSpy = vi.fn(() => mockSupabase)
      mockSupabase.from = fromSpy

      const { recordStockMovement } = await import("@/app/actions/admin")
      const result = await recordStockMovement({
        idempotencyKey: TEST_IDEMPOTENCY_KEY,
        sku: "EGO-DC-12",
        type: "damaged",
        quantity: 100, // far more than any order — cap MUST NOT apply
        referenceType: "internal",
        referenceId: "SPOIL-2026-04",
        notes: "Batch discovered spoiled in warehouse",
      })

      expect(result).toEqual({ success: true })
      // Single from() call — the inventory_log insert only. No order_items
      // fetch, no prior-returns fetch.
      expect(fromSpy).toHaveBeenCalledTimes(1)
      expect(fromSpy).toHaveBeenCalledWith("inventory_log")
    })

    it("damaged with orderId + reference_type='return' enforces the cap", async () => {
      // The admin marks goods as damaged through the return flow — still
      // counts against the shipped cap because goods came out of the order.
      const calls: unknown[] = [
        mockThenableResult([{ sku: "EGO-DC-12", quantity: 2 }], null),
        mockThenableResult([{ quantity: 2 }], null),
      ]
      let idx = 0
      mockSupabase.from = vi.fn(() => {
        const ret = calls[idx] ?? mockSupabase
        idx += 1
        return ret as never
      })

      const { recordStockMovement } = await import("@/app/actions/admin")
      await expect(
        recordStockMovement({
          idempotencyKey: TEST_IDEMPOTENCY_KEY,
          sku: "EGO-DC-12",
          type: "damaged",
          quantity: 1,
          referenceType: "return",
          referenceId: "refund-abc",
          orderId: validUUID,
          notes: "Opened on arrival",
        }),
      ).rejects.toThrow("Не можете да върнете")
    })

    it("exact-match returns succeed (shipped 3, prior 2, returning 1)", async () => {
      const calls: unknown[] = [
        mockThenableResult([{ sku: "EGO-DC-12", quantity: 3 }], null),
        mockThenableResult([{ quantity: 2 }], null),
        mockSupabase, // insert
      ]
      let idx = 0
      mockSupabase.from = vi.fn(() => {
        const ret = calls[idx] ?? mockSupabase
        idx += 1
        return ret as never
      })

      const { recordStockMovement } = await import("@/app/actions/admin")
      const result = await recordStockMovement({
        idempotencyKey: TEST_IDEMPOTENCY_KEY,
        sku: "EGO-DC-12",
        type: "return_in",
        quantity: 1,
        referenceType: "return",
        referenceId: "refund-abc",
        orderId: validUUID,
      })

      expect(result).toEqual({ success: true })
    })
  })

  describe("recordRefund", () => {
    const validOrderId = validUUID
    const validClientKey = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"

    // recordRefund DB-call sequence (post invoices-table refactor):
    //   1. refunds .eq(client_idempotency_key=…) — idempotency check
    //   2. orders .single() — order row
    //   3. invoices .maybeSingle() — invoice lookup (drives credit-note guard)
    //   4. refunds .eq(order_id=…) — existing-sum query
    //   5. refunds .insert().single() — inserted refund row
    //   When affects_invoiced_supply=true (default), autoCreateCreditNoteRow runs:
    //   6. invoices .maybeSingle() — re-fetch invoice
    //   7. invoices .insert().single() — credit_note row (only when invoice has number)
    function setupRecordRefundMocks(options: {
      order?: Record<string, unknown>
      invoiceLookup?: { id: string; invoice_number: string | null } | null
      existingByIdempotencyKey?: Array<{ id: string; order_id: string }>
      existingRefunds?: Array<{ amount_cents: number }>
      insertResult?: { data: { id: string } | null; error: unknown }
      expectCreditNoteInsert?: boolean
      creditNoteInsertResult?: { data: { id: string } | null; error: unknown }
    } = {}) {
      const defaultOrder = {
        id: validOrderId,
        seller_settled_at: "2026-04-01T00:00:00Z",
        delivered_at: null,
        total_amount: 5000,
        stripe_payment_intent_id: "pi_test",
        payment_method: "card",
      }
      const invoiceLookup = options.invoiceLookup ?? null

      // .single() queue — orders fetch, then refunds insert, then
      // (optionally) invoices insert when expectCreditNoteInsert.
      mockSupabase.single
        .mockResolvedValueOnce({ data: options.order ?? defaultOrder, error: null })
        .mockResolvedValueOnce({
          data: options.insertResult?.data ?? { id: "refund-id-xyz" },
          error: options.insertResult?.error ?? null,
        })
      if (options.expectCreditNoteInsert) {
        mockSupabase.single.mockResolvedValueOnce({
          data: options.creditNoteInsertResult?.data ?? { id: "cn-id-xyz" },
          error: options.creditNoteInsertResult?.error ?? null,
        })
      }

      // .maybeSingle() queue — first invoice lookup in recordRefund, second
      // in autoCreateCreditNoteRow. Both return the same shape; the second
      // call is only made when affects_invoiced_supply=true (default).
      mockSupabase.maybeSingle = vi.fn()
        .mockResolvedValueOnce({ data: invoiceLookup, error: null })
        .mockResolvedValueOnce({ data: invoiceLookup, error: null }) as any

      const calls: unknown[] = [
        // 1. idempotency check
        mockThenableResult(options.existingByIdempotencyKey ?? [], null),
        // 2. orders fetch
        mockSupabase,
        // 3. invoices lookup (recordRefund)
        mockSupabase,
        // 4. existing refunds sum
        mockThenableResult(options.existingRefunds ?? [], null),
        // 5. refunds insert
        mockSupabase,
        // 6. invoices lookup (autoCreateCreditNoteRow) — runs when affects=true
        mockSupabase,
      ]
      if (options.expectCreditNoteInsert) {
        // 7. invoices insert (credit_note)
        calls.push(mockSupabase)
      }

      let idx = 0
      mockSupabase.from = vi.fn(() => {
        const ret = calls[idx] ?? mockSupabase
        idx += 1
        return ret as never
      }) as any
    }

    it("throws Unauthorized when not authenticated", async () => {
      mockValidateAdminSession.mockResolvedValue(false)
      const { recordRefund } = await import("@/app/actions/admin")

      await expect(
        recordRefund(validOrderId, {
          refundAmount: 1000,
          refundReason: "Customer withdrawal",
          refundMethod: "bank_transfer",
          bankTransferRef: "BT-2026-0001",
          clientIdempotencyKey: validClientKey,
        }),
      ).rejects.toThrow("Unauthorized")
    })

    it("rejects invalid order UUID", async () => {
      const { recordRefund } = await import("@/app/actions/admin")
      await expect(
        recordRefund("bad-id", {
          refundAmount: 1000,
          refundReason: "Test",
          refundMethod: "bank_transfer",
          bankTransferRef: "BT-2026-0001",
          clientIdempotencyKey: validClientKey,
        }),
      ).rejects.toThrow("Невалиден формат на поръчка")
    })

    it("rejects invalid clientIdempotencyKey UUID", async () => {
      const { recordRefund } = await import("@/app/actions/admin")
      await expect(
        recordRefund(validOrderId, {
          refundAmount: 1000,
          refundReason: "Test",
          refundMethod: "bank_transfer",
          clientIdempotencyKey: "not-a-uuid",
        }),
      ).rejects.toThrow("Невалиден idempotency key")
    })

    it("rejects non-positive refund amount", async () => {
      const { recordRefund } = await import("@/app/actions/admin")
      await expect(
        recordRefund(validOrderId, {
          refundAmount: 0,
          refundReason: "Test",
          refundMethod: "bank_transfer",
          bankTransferRef: "BT-2026-0001",
          clientIdempotencyKey: validClientKey,
        }),
      ).rejects.toThrow("положително цяло число")
    })

    it("rejects empty refund reason", async () => {
      const { recordRefund } = await import("@/app/actions/admin")
      await expect(
        recordRefund(validOrderId, {
          refundAmount: 1000,
          refundReason: "  ",
          refundMethod: "bank_transfer",
          bankTransferRef: "BT-2026-0001",
          clientIdempotencyKey: validClientKey,
        }),
      ).rejects.toThrow("Причината за възстановяване е задължителна")
    })

    it("rejects invalid refund method", async () => {
      const { recordRefund } = await import("@/app/actions/admin")
      await expect(
        recordRefund(validOrderId, {
          refundAmount: 1000,
          refundReason: "Test",
          refundMethod: "cash" as any,
          clientIdempotencyKey: validClientKey,
        }),
      ).rejects.toThrow("Невалиден метод на възстановяване")
    })

    it("rejects stripe method without stripe refund ID", async () => {
      const { recordRefund } = await import("@/app/actions/admin")
      await expect(
        recordRefund(validOrderId, {
          refundAmount: 1000,
          refundReason: "Test",
          refundMethod: "stripe",
          clientIdempotencyKey: validClientKey,
        }),
      ).rejects.toThrow("Stripe refund ID е задължителен")
    })

    it("rejects malformed stripe refund ID", async () => {
      const { recordRefund } = await import("@/app/actions/admin")
      await expect(
        recordRefund(validOrderId, {
          refundAmount: 1000,
          refundReason: "Test",
          refundMethod: "stripe",
          stripeRefundId: "not-a-stripe-id",
          clientIdempotencyKey: validClientKey,
        }),
      ).rejects.toThrow("Невалиден формат на Stripe refund ID")
    })

    it("rejects stripe refund ID on bank_transfer method", async () => {
      const { recordRefund } = await import("@/app/actions/admin")
      await expect(
        recordRefund(validOrderId, {
          refundAmount: 1000,
          refundReason: "Test",
          refundMethod: "bank_transfer",
          stripeRefundId: "re_abc123",
          clientIdempotencyKey: validClientKey,
        }),
      ).rejects.toThrow("нямат Stripe refund ID")
    })

    it("rejects when order not paid", async () => {
      setupRecordRefundMocks({
        order: { id: validOrderId, seller_settled_at: null, total_amount: 5000, needs_invoice: false, stripe_payment_intent_id: null, payment_method: "card" },
      })

      const { recordRefund } = await import("@/app/actions/admin")
      await expect(
        recordRefund(validOrderId, {
          refundAmount: 1000,
          refundReason: "Test",
          refundMethod: "bank_transfer",
          bankTransferRef: "BT-2026-0001",
          clientIdempotencyKey: validClientKey,
        }),
      ).rejects.toThrow("неплатена поръчка")
    })

    it("rejects Stripe refund when order has no Stripe PaymentIntent", async () => {
      setupRecordRefundMocks({
        order: { id: validOrderId, seller_settled_at: "2026-04-01T00:00:00Z", total_amount: 5000, needs_invoice: false, stripe_payment_intent_id: null, payment_method: "card" },
      })

      const { recordRefund } = await import("@/app/actions/admin")
      await expect(
        recordRefund(validOrderId, {
          refundAmount: 1000,
          refundReason: "Customer withdrawal",
          refundMethod: "stripe",
          stripeRefundId: "re_abc123",
          clientIdempotencyKey: validClientKey,
        }),
      ).rejects.toThrow("няма Stripe платеж")
    })

    it("rejects refund amount exceeding remaining balance", async () => {
      setupRecordRefundMocks({
        order: { id: validOrderId, seller_settled_at: "2026-04-01T00:00:00Z", total_amount: 5000, needs_invoice: false, stripe_payment_intent_id: null, payment_method: "card" },
        existingRefunds: [],
      })

      const { recordRefund } = await import("@/app/actions/admin")
      await expect(
        recordRefund(validOrderId, {
          refundAmount: 6000,
          refundReason: "Test",
          refundMethod: "bank_transfer",
          bankTransferRef: "BT-2026-0001",
          clientIdempotencyKey: validClientKey,
        }),
      ).rejects.toThrow("остатъка")
    })

    it("rejects when sum of existing + new refund exceeds total", async () => {
      setupRecordRefundMocks({
        order: { id: validOrderId, seller_settled_at: "2026-04-01T00:00:00Z", total_amount: 5000, needs_invoice: false, stripe_payment_intent_id: null, payment_method: "card" },
        existingRefunds: [{ amount_cents: 3000 }, { amount_cents: 1500 }],
      })

      const { recordRefund } = await import("@/app/actions/admin")
      await expect(
        recordRefund(validOrderId, {
          refundAmount: 1000, // 3000 + 1500 + 1000 = 5500 > 5000
          refundReason: "Test",
          refundMethod: "bank_transfer",
          bankTransferRef: "BT-2026-0001",
          clientIdempotencyKey: validClientKey,
        }),
      ).rejects.toThrow("остатъка")
    })

    it("blocks refund when invoice exists but invoice_number not yet set", async () => {
      // Guard from ЗДДС Чл. 115: refund that would require кредитно известие
      // can't proceed if the original фактура hasn't been issued in Microinvest.
      setupRecordRefundMocks({
        order: {
          id: validOrderId,
          seller_settled_at: "2026-04-01T00:00:00Z",
          total_amount: 5000,
          stripe_payment_intent_id: "pi_test",
          payment_method: "card",
        },
        invoiceLookup: { id: "inv-id-xyz", invoice_number: null },
        existingRefunds: [],
      })

      const { recordRefund } = await import("@/app/actions/admin")
      await expect(
        recordRefund(validOrderId, {
          refundAmount: 5000,
          refundReason: "Customer withdrawal",
          refundMethod: "bank_transfer",
          bankTransferRef: "BT-2026-0001",
          clientIdempotencyKey: validClientKey,
        }),
      ).rejects.toThrow("Първо въведете номер и дата на фактурата")
    })

    it("records bank_transfer refund successfully with client key", async () => {
      setupRecordRefundMocks({ existingRefunds: [] })
      const insertSpy = vi.fn(() => mockSupabase)
      mockSupabase.insert = insertSpy

      const { recordRefund } = await import("@/app/actions/admin")
      const result = await recordRefund(validOrderId, {
        refundAmount: 5000,
        refundReason: "14-day withdrawal",
        refundMethod: "bank_transfer",
        bankTransferRef: "BT-2026-0001",
        clientIdempotencyKey: validClientKey,
      })

      expect(result).toEqual({ success: true, refundId: "refund-id-xyz", creditNoteId: null })
      expect(insertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          order_id: validOrderId,
          amount_cents: 5000,
          method: "bank_transfer",
          source: "admin_ui",
          reason: "14-day withdrawal",
          stripe_refund_id: null,
          client_idempotency_key: validClientKey,
        }),
      )
    })

    it("records stripe refund successfully with refund ID", async () => {
      setupRecordRefundMocks({ existingRefunds: [] })
      const insertSpy = vi.fn(() => mockSupabase)
      mockSupabase.insert = insertSpy
      const { stripe } = await import("@/lib/stripe")
      vi.mocked(stripe.refunds.retrieve).mockResolvedValueOnce(
        mockStripeRefund({ id: "re_1AbCdEfGh", payment_intent: "pi_test", amount: 5000 }) as never,
      )

      const { recordRefund } = await import("@/app/actions/admin")
      await recordRefund(validOrderId, {
        refundAmount: 5000,
        refundReason: "14-day withdrawal",
        refundMethod: "stripe",
        stripeRefundId: "re_1AbCdEfGh",
        clientIdempotencyKey: validClientKey,
      })

      expect(insertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "stripe",
          stripe_refund_id: "re_1AbCdEfGh",
          source: "admin_ui",
          client_idempotency_key: validClientKey,
        }),
      )
    })

    it("idempotent retry returns existing refund without re-inserting", async () => {
      // Fast-path idempotency: when the client_idempotency_key matches an
      // existing refund, we return its ID + look up any linked credit_note.
      mockSupabase.maybeSingle = vi.fn().mockResolvedValueOnce({ data: null, error: null }) as any
      const calls: unknown[] = [
        mockThenableResult([{ id: "already-saved-id", order_id: validOrderId }], null), // 1. idempotency hit
        mockSupabase,  // 2. credit_note lookup (.maybeSingle)
      ]
      let idx = 0
      mockSupabase.from = vi.fn(() => {
        const ret = calls[idx] ?? mockSupabase
        idx += 1
        return ret as never
      }) as any
      const insertSpy = vi.fn(() => mockSupabase)
      mockSupabase.insert = insertSpy

      const { recordRefund } = await import("@/app/actions/admin")
      const result = await recordRefund(validOrderId, {
        refundAmount: 5000,
        refundReason: "14-day withdrawal",
        refundMethod: "bank_transfer",
        bankTransferRef: "BT-2026-0001",
        clientIdempotencyKey: validClientKey,
      })

      expect(result).toEqual({
        success: true,
        refundId: "already-saved-id",
        creditNoteId: null,
      })
      // No insert on refunds since row already exists
      expect(insertSpy).not.toHaveBeenCalled()
    })

    it("rejects idempotency key that belongs to a different order", async () => {
      setupRecordRefundMocks({
        existingByIdempotencyKey: [{ id: "some-id", order_id: "00000000-0000-0000-0000-000000000001" }],
      })

      const { recordRefund } = await import("@/app/actions/admin")
      await expect(
        recordRefund(validOrderId, {
          refundAmount: 1000,
          refundReason: "Test",
          refundMethod: "bank_transfer",
          bankTransferRef: "BT-2026-0001",
          clientIdempotencyKey: validClientKey,
        }),
      ).rejects.toThrow("друга поръчка")
    })

    it("recovers existing refund ID when 23505 from concurrent retry", async () => {
      // First idempotency lookup returns empty (race: other client not yet committed).
      // Insert throws 23505. We re-query by client_idempotency_key and find the row.
      const recoveredRows = [{ id: "recovered-id", order_id: validOrderId }]
      const defaultOrder = {
        id: validOrderId,
        seller_settled_at: "2026-04-01T00:00:00Z",
        delivered_at: null,
        total_amount: 5000,
        stripe_payment_intent_id: "pi_test",
        payment_method: "card",
      }
      mockSupabase.single.mockResolvedValueOnce({ data: defaultOrder, error: null })
      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: { code: "23505", message: "duplicate key on client_idempotency_key" },
      })
      mockSupabase.maybeSingle = vi.fn().mockResolvedValueOnce({ data: null, error: null }) as any
      const calls: unknown[] = [
        mockThenableResult([], null),                       // 1. idempotency check (empty)
        mockSupabase,                                        // 2. orders fetch
        mockSupabase,                                        // 3. invoice lookup (.maybeSingle)
        mockThenableResult([], null),                        // 4. sum
        mockSupabase,                                        // 5. insert (fails 23505)
        mockThenableResult(recoveredRows, null),             // 6. recovery fetch
      ]
      let idx = 0
      mockSupabase.from = vi.fn(() => {
        const ret = calls[idx] ?? mockSupabase
        idx += 1
        return ret as never
      }) as any

      const { recordRefund } = await import("@/app/actions/admin")
      const result = await recordRefund(validOrderId, {
        refundAmount: 1000,
        refundReason: "Test",
        refundMethod: "bank_transfer",
        bankTransferRef: "BT-2026-0001",
        clientIdempotencyKey: validClientKey,
      })
      expect(result.refundId).toBe("recovered-id")
    })

    it("translates 23505 with no idempotency-key match to duplicate-stripe-refund error", async () => {
      // Insert fails 23505 (presumably on stripe_refund_id) but recovery by
      // client_idempotency_key returns empty — meaning the other unique
      // index fired. Surface the Stripe-specific error.
      const defaultOrder = {
        id: validOrderId,
        seller_settled_at: "2026-04-01T00:00:00Z",
        delivered_at: null,
        total_amount: 5000,
        stripe_payment_intent_id: "pi_test",
        payment_method: "card",
      }
      mockSupabase.single.mockResolvedValueOnce({ data: defaultOrder, error: null })
      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: { code: "23505", message: "duplicate key on stripe_refund_id" },
      })
      mockSupabase.maybeSingle = vi.fn().mockResolvedValueOnce({ data: null, error: null }) as any
      const calls: unknown[] = [
        mockThenableResult([], null),                  // 1. idempotency
        mockSupabase,                                   // 2. orders fetch
        mockSupabase,                                   // 3. invoice lookup
        mockThenableResult([], null),                   // 4. sum
        mockSupabase,                                   // 5. insert (fails)
        mockThenableResult([], null),                   // 6. recovery (empty)
      ]
      let idx = 0
      mockSupabase.from = vi.fn(() => {
        const ret = calls[idx] ?? mockSupabase
        idx += 1
        return ret as never
      }) as any

      const { stripe } = await import("@/lib/stripe")
      vi.mocked(stripe.refunds.retrieve).mockResolvedValueOnce(
        mockStripeRefund({ id: "re_abc123", payment_intent: "pi_test", amount: 1000 }) as never,
      )

      const { recordRefund } = await import("@/app/actions/admin")
      await expect(
        recordRefund(validOrderId, {
          refundAmount: 1000,
          refundReason: "Test",
          refundMethod: "stripe",
          stripeRefundId: "re_abc123",
          clientIdempotencyKey: validClientKey,
        }),
      ).rejects.toThrow("вече е записано")
    })

    // ─── Stripe refund-ID verification (pre-insert) ─────────────────────

    it("rejects when Stripe refund ID doesn't exist in Stripe", async () => {
      setupRecordRefundMocks({ existingRefunds: [] })
      const { stripe } = await import("@/lib/stripe")
      vi.mocked(stripe.refunds.retrieve).mockRejectedValueOnce(
        Object.assign(new Error("No such refund"), { code: "resource_missing" }),
      )

      const { recordRefund } = await import("@/app/actions/admin")
      await expect(
        recordRefund(validOrderId, {
          refundAmount: 5000,
          refundReason: "Test",
          refundMethod: "stripe",
          stripeRefundId: "re_typo999",
          clientIdempotencyKey: validClientKey,
        }),
      ).rejects.toThrow("не е намерен в Stripe")
    })

    it("rejects when Stripe refund's payment_intent doesn't match the order", async () => {
      setupRecordRefundMocks({ existingRefunds: [] })
      const { stripe } = await import("@/lib/stripe")
      // Valid refund, but belongs to a different payment intent.
      vi.mocked(stripe.refunds.retrieve).mockResolvedValueOnce(
        mockStripeRefund({
          id: "re_otherOrder",
          payment_intent: "pi_different_order",
          amount: 5000,
        }) as never,
      )

      const { recordRefund } = await import("@/app/actions/admin")
      await expect(
        recordRefund(validOrderId, {
          refundAmount: 5000,
          refundReason: "Test",
          refundMethod: "stripe",
          stripeRefundId: "re_otherOrder",
          clientIdempotencyKey: validClientKey,
        }),
      ).rejects.toThrow("не принадлежи на тази поръчка")
    })

    it("rejects when Stripe refund amount doesn't match admin-entered amount", async () => {
      setupRecordRefundMocks({ existingRefunds: [] })
      const { stripe } = await import("@/lib/stripe")
      vi.mocked(stripe.refunds.retrieve).mockResolvedValueOnce(
        mockStripeRefund({
          id: "re_amountMismatch",
          payment_intent: "pi_test",
          amount: 1500, // Stripe says 15.00, admin types 25.00
        }) as never,
      )

      const { recordRefund } = await import("@/app/actions/admin")
      await expect(
        recordRefund(validOrderId, {
          refundAmount: 2500,
          refundReason: "Test",
          refundMethod: "stripe",
          stripeRefundId: "re_amountMismatch",
          clientIdempotencyKey: validClientKey,
        }),
      ).rejects.toThrow("Сумата не съвпада със Stripe")
    })

    it("rejects when Stripe refund is still pending", async () => {
      setupRecordRefundMocks({ existingRefunds: [] })
      const { stripe } = await import("@/lib/stripe")
      vi.mocked(stripe.refunds.retrieve).mockResolvedValueOnce(
        mockStripeRefund({
          id: "re_pending",
          status: "pending",
          payment_intent: "pi_test",
          amount: 5000,
        }) as never,
      )

      const { recordRefund } = await import("@/app/actions/admin")
      await expect(
        recordRefund(validOrderId, {
          refundAmount: 5000,
          refundReason: "Test",
          refundMethod: "stripe",
          stripeRefundId: "re_pending",
          clientIdempotencyKey: validClientKey,
        }),
      ).rejects.toThrow("не е успешно приключил")
    })

    it("rejects when Stripe API returns a non-missing error", async () => {
      setupRecordRefundMocks({ existingRefunds: [] })
      const { stripe } = await import("@/lib/stripe")
      vi.mocked(stripe.refunds.retrieve).mockRejectedValueOnce(
        Object.assign(new Error("timeout"), { code: "api_connection_error" }),
      )

      const { recordRefund } = await import("@/app/actions/admin")
      await expect(
        recordRefund(validOrderId, {
          refundAmount: 5000,
          refundReason: "Test",
          refundMethod: "stripe",
          stripeRefundId: "re_transient",
          clientIdempotencyKey: validClientKey,
        }),
      ).rejects.toThrow("Грешка при проверка на Stripe refund")
    })

    it("bank_transfer refunds skip Stripe verification", async () => {
      setupRecordRefundMocks({ existingRefunds: [] })
      const { stripe } = await import("@/lib/stripe")
      const retrieveSpy = vi.mocked(stripe.refunds.retrieve)
      retrieveSpy.mockClear()

      const { recordRefund } = await import("@/app/actions/admin")
      const result = await recordRefund(validOrderId, {
        refundAmount: 5000,
        refundReason: "COD refund",
        refundMethod: "bank_transfer",
        bankTransferRef: "BT-2026-0001",
        clientIdempotencyKey: validClientKey,
      })

      expect(result.success).toBe(true)
      // No Stripe API call at all for bank-transfer refunds.
      expect(retrieveSpy).not.toHaveBeenCalled()
    })

    it("rejects future refundedAt date", async () => {
      const { recordRefund } = await import("@/app/actions/admin")
      await expect(
        recordRefund(validOrderId, {
          refundAmount: 1000,
          refundReason: "Test",
          refundMethod: "bank_transfer",
          bankTransferRef: "BT-2026-0001",
          refundedAt: "2099-01-01",
          clientIdempotencyKey: validClientKey,
        }),
      ).rejects.toThrow("не може да е в бъдещето")
    })

    // ── refund_items input validation ────────────────────────────────────
    describe("refund_items", () => {
      it("rejects empty items array", async () => {
        const { recordRefund } = await import("@/app/actions/admin")
        await expect(
          recordRefund(validOrderId, {
            refundAmount: 1000,
            refundReason: "Test",
            refundMethod: "bank_transfer",
            bankTransferRef: "BT-1",
            clientIdempotencyKey: validClientKey,
            items: [],
          }),
        ).rejects.toThrow("празен")
      })

      it("rejects duplicate orderItemId in input batch", async () => {
        const { recordRefund } = await import("@/app/actions/admin")
        await expect(
          recordRefund(validOrderId, {
            refundAmount: 1000,
            refundReason: "Test",
            refundMethod: "bank_transfer",
            bankTransferRef: "BT-1",
            clientIdempotencyKey: validClientKey,
            items: [
              { orderItemId: 1, quantity: 1 },
              { orderItemId: 1, quantity: 1 },
            ],
          }),
        ).rejects.toThrow("повече от веднъж")
      })

      it("rejects non-positive quantity", async () => {
        const { recordRefund } = await import("@/app/actions/admin")
        await expect(
          recordRefund(validOrderId, {
            refundAmount: 1000,
            refundReason: "Test",
            refundMethod: "bank_transfer",
            bankTransferRef: "BT-1",
            clientIdempotencyKey: validClientKey,
            items: [{ orderItemId: 1, quantity: 0 }],
          }),
        ).rejects.toThrow("положително")
      })

      it("rejects items whose order_item_id is not on this order", async () => {
        // setupRecordRefundMocks gives the basic chain. We inject empty
        // order_items + empty existing refund_items so the lookup queries
        // both succeed but the validation finds no matching line.
        setupRecordRefundMocks({ existingRefunds: [] })
        const calls: unknown[] = [
          mockThenableResult([], null),                           // 1. idempotency
          mockSupabase,                                            // 2. orders fetch
          mockSupabase,                                            // 3. invoices lookup
          mockThenableResult([], null),                            // 4. existing refunds sum
          mockThenableResult([], null),                            // 5. order_items fetch (empty — orderItemId 999 won't match)
          mockThenableResult([], null),                            // 6. existing refund_items
        ]
        let idx = 0
        mockSupabase.from = vi.fn(() => {
          const ret = calls[idx] ?? mockSupabase
          idx += 1
          return ret as never
        }) as any

        const { recordRefund } = await import("@/app/actions/admin")
        await expect(
          recordRefund(validOrderId, {
            refundAmount: 1000,
            refundReason: "Test",
            refundMethod: "bank_transfer",
            bankTransferRef: "BT-1",
            clientIdempotencyKey: validClientKey,
            items: [{ orderItemId: 999, quantity: 1, amountCents: 500 }],
          }),
        ).rejects.toThrow("не принадлежи")
      })

      it("rejects when allocated total exceeds refund amount", async () => {
        const calls: unknown[] = [
          mockThenableResult([], null),                            // 1. idempotency
          mockSupabase,                                            // 2. orders fetch
          mockSupabase,                                            // 3. invoices lookup
          mockThenableResult([], null),                            // 4. existing refunds sum
          mockThenableResult([{ id: 1, quantity: 5, unit_price_cents: 1000 }], null), // 5. order_items
          mockThenableResult([], null),                            // 6. existing refund_items
        ]
        mockSupabase.single
          .mockResolvedValueOnce({
            data: { id: validOrderId, seller_settled_at: "2026-04-01T00:00:00Z", delivered_at: null, total_amount: 5000, stripe_payment_intent_id: "pi_test", payment_method: "card" },
            error: null,
          })
        mockSupabase.maybeSingle = vi.fn().mockResolvedValueOnce({ data: null, error: null }) as any
        let idx = 0
        mockSupabase.from = vi.fn(() => {
          const ret = calls[idx] ?? mockSupabase
          idx += 1
          return ret as never
        }) as any

        const { recordRefund } = await import("@/app/actions/admin")
        await expect(
          recordRefund(validOrderId, {
            refundAmount: 1000, // 10.00 lv refund
            refundReason: "Test",
            refundMethod: "bank_transfer",
            bankTransferRef: "BT-1",
            clientIdempotencyKey: validClientKey,
            // 2 × 1000 = 2000 cents allocation > 1000 refund amount
            items: [{ orderItemId: 1, quantity: 2, amountCents: 2000 }],
          }),
        ).rejects.toThrow("надвишава общата сума")
      })

      it("rejects quantity exceeding ordered quantity (pre-flight)", async () => {
        const calls: unknown[] = [
          mockThenableResult([], null),                            // 1. idempotency
          mockSupabase,                                            // 2. orders fetch
          mockSupabase,                                            // 3. invoices lookup
          mockThenableResult([], null),                            // 4. existing refunds sum
          mockThenableResult([{ id: 1, quantity: 2, unit_price_cents: 1000 }], null),
          // already refunded 2/2; next refund of 1 unit overflows
          mockThenableResult([{ order_item_id: 1, quantity: 2 }], null),
        ]
        mockSupabase.single
          .mockResolvedValueOnce({
            data: { id: validOrderId, seller_settled_at: "2026-04-01T00:00:00Z", delivered_at: null, total_amount: 5000, stripe_payment_intent_id: "pi_test", payment_method: "card" },
            error: null,
          })
        mockSupabase.maybeSingle = vi.fn().mockResolvedValueOnce({ data: null, error: null }) as any
        let idx = 0
        mockSupabase.from = vi.fn(() => {
          const ret = calls[idx] ?? mockSupabase
          idx += 1
          return ret as never
        }) as any

        const { recordRefund } = await import("@/app/actions/admin")
        await expect(
          recordRefund(validOrderId, {
            refundAmount: 1000,
            refundReason: "Test",
            refundMethod: "bank_transfer",
            bankTransferRef: "BT-1",
            clientIdempotencyKey: validClientKey,
            items: [{ orderItemId: 1, quantity: 1, amountCents: 1000 }],
          }),
        ).rejects.toThrow("надвишава поръчаните")
      })
    })
  })

  describe("updateRefundAnnotation", () => {
    const validRefundId = validUUID

    it("throws Unauthorized when not authenticated", async () => {
      mockValidateAdminSession.mockResolvedValue(false)
      const { updateRefundAnnotation } = await import("@/app/actions/admin")

      await expect(
        updateRefundAnnotation(validRefundId, { reason: "new reason" }),
      ).rejects.toThrow("Unauthorized")
    })

    it("rejects invalid UUID", async () => {
      const { updateRefundAnnotation } = await import("@/app/actions/admin")

      await expect(
        updateRefundAnnotation("bad-id", { reason: "r" }),
      ).rejects.toThrow("Невалиден формат на възстановяване")
    })

    it("rejects empty reason when reason is being set", async () => {
      const { updateRefundAnnotation } = await import("@/app/actions/admin")

      await expect(
        updateRefundAnnotation(validRefundId, { reason: "   " }),
      ).rejects.toThrow("задължителна")
    })

    it("rejects when no fields supplied", async () => {
      const { updateRefundAnnotation } = await import("@/app/actions/admin")

      await expect(
        updateRefundAnnotation(validRefundId, {}),
      ).rejects.toThrow("Няма промени")
    })

    it("updates reason and creditNoteRef", async () => {
      const updateSpy = vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => Promise.resolve({ data: [{ id: validRefundId }], error: null })),
        })),
      }))
      mockSupabase.update = updateSpy as any

      const { updateRefundAnnotation } = await import("@/app/actions/admin")
      const result = await updateRefundAnnotation(validRefundId, {
        reason: "Customer exchanged for different flavor",
        bankTransferRef: "BT-2026-0042",
      })

      expect(result).toEqual({ success: true })
      expect(updateSpy).toHaveBeenCalledWith({
        reason: "Customer exchanged for different flavor",
        bank_transfer_ref: "BT-2026-0042",
      })
    })

    it("clears bankTransferRef when given empty string", async () => {
      const updateSpy = vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => Promise.resolve({ data: [{ id: validRefundId }], error: null })),
        })),
      }))
      mockSupabase.update = updateSpy as any

      const { updateRefundAnnotation } = await import("@/app/actions/admin")
      await updateRefundAnnotation(validRefundId, { bankTransferRef: "" })

      expect(updateSpy).toHaveBeenCalledWith({ bank_transfer_ref: null })
    })
  })

  describe("recordOrderOutcome", () => {
    const validOrderId = validUUID

    it("throws Unauthorized when not authenticated", async () => {
      mockValidateAdminSession.mockResolvedValue(false)
      const { recordOrderOutcome } = await import("@/app/actions/admin")

      await expect(
        recordOrderOutcome(validOrderId, {
          outcomeType: "delivery_refused",
          note: "Customer refused at door",
        }),
      ).rejects.toThrow("Unauthorized")
    })

    it("rejects unknown outcome type", async () => {
      const { recordOrderOutcome } = await import("@/app/actions/admin")

      await expect(
        recordOrderOutcome(validOrderId, { outcomeType: "bogus" as any, note: "x".repeat(20) }),
      ).rejects.toThrow("Невалиден тип събитие")
    })

    it("rejects note shorter than 10 chars", async () => {
      const { recordOrderOutcome } = await import("@/app/actions/admin")

      await expect(
        recordOrderOutcome(validOrderId, { outcomeType: "delivery_refused", note: "short" }),
      ).rejects.toThrow("поне 10 символа")
    })

    it("rejects package_lost without courier ref", async () => {
      const { recordOrderOutcome } = await import("@/app/actions/admin")

      await expect(
        recordOrderOutcome(validOrderId, {
          outcomeType: "package_lost",
          note: "Courier confirmed the package is lost in transit",
        }),
      ).rejects.toThrow("куриерска претенция")
    })

    it("rejects returned without condition", async () => {
      const { recordOrderOutcome } = await import("@/app/actions/admin")

      await expect(
        recordOrderOutcome(validOrderId, {
          outcomeType: "returned",
          note: "Customer returned the goods unopened",
          returnRef: "RET-42",
        }),
      ).rejects.toThrow("състояние")
    })

    it("rejects outcome for orders not in shipped/delivered state", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: validOrderId, status: "pending" },
        error: null,
      })

      const { recordOrderOutcome } = await import("@/app/actions/admin")
      await expect(
        recordOrderOutcome(validOrderId, {
          outcomeType: "delivery_refused",
          note: "Customer refused at the door",
        }),
      ).rejects.toThrow("може да се докладва само след изпращане")
    })

    it("records delivery_refused on a shipped order", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: validOrderId, status: "shipped" },
        error: null,
      })
      const rpcSpy = vi.fn(() => Promise.resolve({ data: null, error: null }))
      mockSupabase.rpc = rpcSpy

      const { recordOrderOutcome } = await import("@/app/actions/admin")
      const result = await recordOrderOutcome(validOrderId, {
        outcomeType: "delivery_refused",
        note: "Customer refused at the door; package being returned",
        courierRef: "RETURN-ABC",
      })

      expect(result).toEqual({ success: true })
      // First RPC: record_order_outcome
      expect(rpcSpy).toHaveBeenNthCalledWith(1, "record_order_outcome", expect.objectContaining({
        p_order_id: validOrderId,
        p_outcome_type: "delivery_refused",
        p_payload: expect.objectContaining({ note: expect.stringContaining("Customer refused") }),
      }))
      // Second RPC: add_admin_note (the bridge summary)
      expect(rpcSpy).toHaveBeenNthCalledWith(2, "add_admin_note", expect.objectContaining({
        p_order_id: validOrderId,
        p_text: expect.stringContaining("Отказана доставка"),
      }))
    })
  })

  describe("recordComplaint", () => {
    const validOrderId = validUUID

    it("throws Unauthorized when not authenticated", async () => {
      mockValidateAdminSession.mockResolvedValue(false)
      const { recordComplaint } = await import("@/app/actions/admin")

      await expect(
        recordComplaint(validOrderId, {
          defectDescription: "Damaged packaging",
          customerDemand: "refund",
        }),
      ).rejects.toThrow("Unauthorized")
    })

    it("rejects invalid UUID", async () => {
      const { recordComplaint } = await import("@/app/actions/admin")

      await expect(
        recordComplaint("bad-id", {
          defectDescription: "Damaged packaging",
          customerDemand: "refund",
        }),
      ).rejects.toThrow("Невалиден формат на поръчка")
    })

    it("rejects empty defect description", async () => {
      const { recordComplaint } = await import("@/app/actions/admin")

      await expect(
        recordComplaint(validOrderId, {
          defectDescription: "  ",
          customerDemand: "refund",
        }),
      ).rejects.toThrow("Описанието на несъответствието е задължително")
    })

    it("rejects defect description over 2000 chars", async () => {
      const { recordComplaint } = await import("@/app/actions/admin")

      await expect(
        recordComplaint(validOrderId, {
          defectDescription: "x".repeat(2001),
          customerDemand: "refund",
        }),
      ).rejects.toThrow("Описанието е твърде дълго")
    })

    it("rejects invalid customer demand", async () => {
      const { recordComplaint } = await import("@/app/actions/admin")

      await expect(
        recordComplaint(validOrderId, {
          defectDescription: "Broken seal",
          customerDemand: "free_stuff" as any,
        }),
      ).rejects.toThrow("Невалидна претенция на потребителя")
    })

    it("records complaint with auto-generated ref", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: validOrderId },
        error: null,
      })
      // Mock RPC for sequence (will fail, triggering fallback)
      mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: { message: "function not found" } })

      const { recordComplaint } = await import("@/app/actions/admin")
      const result = await recordComplaint(validOrderId, {
        defectDescription: "Product arrived damaged",
        customerDemand: "replacement",
      })

      expect(result.success).toBe(true)
      expect(result.complaintRef).toMatch(/^RCL-\d{4}-\d{4,}$/)
      expect(mockSupabase.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          order_id: validOrderId,
          defect_description: "Product arrived damaged",
          customer_demand: "replacement",
          status: "open",
          created_by: "admin",
        }),
      )
    })
  })

  describe("resolveComplaint", () => {
    it("throws Unauthorized when not authenticated", async () => {
      mockValidateAdminSession.mockResolvedValue(false)
      const { resolveComplaint } = await import("@/app/actions/admin")

      await expect(
        resolveComplaint(1, { status: "resolved", resolution: "Replaced product" }),
      ).rejects.toThrow("Unauthorized")
    })

    it("rejects invalid complaint ID", async () => {
      const { resolveComplaint } = await import("@/app/actions/admin")

      await expect(
        resolveComplaint(0, { status: "resolved", resolution: "Test" }),
      ).rejects.toThrow("Невалиден идентификатор")
    })

    it("rejects empty resolution", async () => {
      const { resolveComplaint } = await import("@/app/actions/admin")

      await expect(
        resolveComplaint(1, { status: "resolved", resolution: "  " }),
      ).rejects.toThrow("Решението е задължително")
    })

    it("rejects invalid status", async () => {
      const { resolveComplaint } = await import("@/app/actions/admin")

      await expect(
        resolveComplaint(1, { status: "closed" as any, resolution: "Test" }),
      ).rejects.toThrow("Невалиден статус")
    })

    it("resolves complaint successfully", async () => {
      const { resolveComplaint } = await import("@/app/actions/admin")
      const result = await resolveComplaint(1, {
        status: "resolved",
        resolution: "Product replaced, customer satisfied",
      })

      expect(result).toEqual({ success: true })
      expect(mockSupabase.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "resolved",
          resolution: "Product replaced, customer satisfied",
          resolved_at: expect.any(String),
        }),
      )
    })

    it("rejects when complaint already resolved", async () => {
      const updateChain = {
        eq: vi.fn(() => updateChain),
        select: vi.fn(() => updateChain),
        then(resolve: (v: unknown) => void) {
          resolve({ data: [], error: null })
        },
      }
      mockSupabase.update = vi.fn(() => updateChain)

      const { resolveComplaint } = await import("@/app/actions/admin")
      await expect(
        resolveComplaint(1, { status: "resolved", resolution: "Test" }),
      ).rejects.toThrow("вече е приключена")
    })
  })

  describe("getRecallCandidates", () => {
    const validSku = "EGO-DC-12"

    // The server action builds a chain .from(…).select(…).eq(sku, …).in(status, …)
    // and conditionally appends .gte(…).lte(…) for date filters, then awaits
    // it. To let the final await resolve, pivot at `.eq` — swap in a
    // self-referential thenable so every subsequent call stays on it and
    // the `await` resolves with the supplied rows. Returns the thenable so
    // tests can assert on its specific spies (not the base mock's spies,
    // which stop getting called after the pivot).
    function setupChain(rows: unknown[], error: unknown = null) {
      const chain = mockThenableResult(rows, error)
      mockSupabase.eq = vi.fn(() => chain) as never
      return chain
    }

    it("throws Unauthorized when not authenticated", async () => {
      mockValidateAdminSession.mockResolvedValue(false)
      const { getRecallCandidates } = await import("@/app/actions/admin")
      await expect(getRecallCandidates(validSku)).rejects.toThrow("Unauthorized")
    })

    it("rejects invalid SKU", async () => {
      const { getRecallCandidates } = await import("@/app/actions/admin")
      await expect(getRecallCandidates("NOT-A-SKU")).rejects.toThrow("Невалиден SKU")
    })

    it("rejects malformed from-date", async () => {
      const { getRecallCandidates } = await import("@/app/actions/admin")
      await expect(getRecallCandidates(validSku, "04/01/2026")).rejects.toThrow("Невалидна начална дата")
    })

    it("rejects malformed to-date", async () => {
      const { getRecallCandidates } = await import("@/app/actions/admin")
      await expect(getRecallCandidates(validSku, "2026-04-01", "04/30/2026")).rejects.toThrow("Невалидна крайна дата")
    })

    it("rejects from-date after to-date", async () => {
      const { getRecallCandidates } = await import("@/app/actions/admin")
      await expect(getRecallCandidates(validSku, "2026-04-30", "2026-04-01")).rejects.toThrow(
        "не може да е след крайната",
      )
    })

    it("returns empty array when no orders match", async () => {
      setupChain([])
      const { getRecallCandidates } = await import("@/app/actions/admin")
      const result = await getRecallCandidates(validSku)
      expect(result).toEqual([])
    })

    it("filters by sku, status in (confirmed, shipped, delivered), and flattens the joined order shape", async () => {
      const rows = [
        {
          quantity: 2,
          sku: validSku,
          orders: {
            id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            created_at: "2026-04-10T10:00:00Z",
            shipped_at: "2026-04-11T10:00:00Z",
            delivered_at: null,
            status: "shipped",
            first_name: "Ivan",
            last_name: "Petrov",
            email: "ivan@example.com",
            phone: "+359888111222",
            city: "София",
            address: "ул. Витоша 1",
            postal_code: "1000",
            tracking_number: "SPEEDY-1",
            logistics_partner: "speedy-office",
          },
        },
        {
          quantity: 3,
          sku: validSku,
          orders: {
            id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
            created_at: "2026-04-12T10:00:00Z",
            shipped_at: "2026-04-13T10:00:00Z",
            delivered_at: "2026-04-14T15:00:00Z",
            status: "delivered",
            first_name: "Maria",
            last_name: "Ivanova",
            email: "maria@example.com",
            phone: "+359888333444",
            city: "Пловдив",
            address: null,
            postal_code: null,
            tracking_number: "ECONT-1",
            logistics_partner: "econt-office",
          },
        },
      ]
      const chain = setupChain(rows)

      const { getRecallCandidates } = await import("@/app/actions/admin")
      const result = await getRecallCandidates(validSku)

      // Query targets order_items, filters by sku, joins status via !inner.
      expect(mockSupabase.from).toHaveBeenCalledWith("order_items")
      expect(mockSupabase.eq).toHaveBeenCalledWith("sku", validSku)
      expect(chain.in).toHaveBeenCalledWith("orders.status", ["confirmed", "shipped", "delivered"])

      // Two candidates, flattened from the nested orders relation.
      expect(result).toHaveLength(2)
      // Sort order: confirmed → shipped → delivered. Both here are shipped
      // and delivered, so shipped (Ivan) sorts before delivered (Maria).
      expect(result[0]).toMatchObject({
        orderId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        shortId: "aaaaaaaa",
        status: "shipped",
        firstName: "Ivan",
        quantity: 2,
        trackingNumber: "SPEEDY-1",
      })
      expect(result[1]).toMatchObject({
        orderId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        status: "delivered",
        quantity: 3,
        address: null,
        postalCode: null,
      })
    })

    it("applies gte/lte when both dates are supplied", async () => {
      const chain = setupChain([])
      const { getRecallCandidates } = await import("@/app/actions/admin")
      await getRecallCandidates(validSku, "2026-04-01", "2026-04-30")

      expect(chain.gte).toHaveBeenCalledWith(
        "orders.created_at",
        "2026-04-01T00:00:00.000Z",
      )
      expect(chain.lte).toHaveBeenCalledWith(
        "orders.created_at",
        "2026-04-30T23:59:59.999Z",
      )
    })

    it("skips gte/lte when no dates are supplied", async () => {
      const chain = setupChain([])
      const { getRecallCandidates } = await import("@/app/actions/admin")
      await getRecallCandidates(validSku)

      expect(chain.gte).not.toHaveBeenCalled()
      expect(chain.lte).not.toHaveBeenCalled()
    })

    it("sorts confirmed before shipped before delivered", async () => {
      const baseOrder = {
        first_name: "Test", last_name: "User", email: "t@e.com", phone: "+359888",
        city: "Sofia", address: "addr", postal_code: "1000",
        tracking_number: null, logistics_partner: null,
      }
      const rows = [
        { quantity: 1, sku: validSku, orders: { ...baseOrder, id: "11111111-1111-1111-1111-111111111111", created_at: "2026-04-14T10:00:00Z", shipped_at: "2026-04-15T10:00:00Z", delivered_at: "2026-04-16T10:00:00Z", status: "delivered" } },
        { quantity: 1, sku: validSku, orders: { ...baseOrder, id: "22222222-2222-2222-2222-222222222222", created_at: "2026-04-10T10:00:00Z", shipped_at: null, delivered_at: null, status: "confirmed" } },
        { quantity: 1, sku: validSku, orders: { ...baseOrder, id: "33333333-3333-3333-3333-333333333333", created_at: "2026-04-12T10:00:00Z", shipped_at: "2026-04-13T10:00:00Z", delivered_at: null, status: "shipped" } },
      ]
      setupChain(rows)

      const { getRecallCandidates } = await import("@/app/actions/admin")
      const result = await getRecallCandidates(validSku)

      expect(result.map((r) => r.status)).toEqual(["confirmed", "shipped", "delivered"])
    })

    it("surfaces DB errors with a friendly message", async () => {
      setupChain([], { message: "connection reset" })
      const { getRecallCandidates } = await import("@/app/actions/admin")
      await expect(getRecallCandidates(validSku)).rejects.toThrow("Грешка при извличане")
    })
  })

  // ─── Withdrawals (право на отказ) ─────────────────────────────────────────
  describe("withdrawals", () => {
    const validOrderId = validUUID
    const validWithdrawalId = "11111111-1111-1111-1111-111111111111"

    describe("createWithdrawal", () => {
      it("rejects invalid order UUID", async () => {
        const { createWithdrawal } = await import("@/app/actions/admin")
        await expect(
          createWithdrawal("bad-id", {
            requestedVia: "email",
            customerEmail: "x@x.com",
          }),
        ).rejects.toThrow("Невалиден формат на поръчка")
      })

      it("rejects invalid requestedVia", async () => {
        const { createWithdrawal } = await import("@/app/actions/admin")
        await expect(
          createWithdrawal(validOrderId, {
            requestedVia: "fax" as never,
            customerEmail: "x@x.com",
          }),
        ).rejects.toThrow("Невалиден канал на заявка")
      })

      it("rejects invalid customer email", async () => {
        const { createWithdrawal } = await import("@/app/actions/admin")
        await expect(
          createWithdrawal(validOrderId, {
            requestedVia: "email",
            customerEmail: "not-an-email",
          }),
        ).rejects.toThrow("Невалиден имейл адрес")
      })

      it("rejects request_text > 2000 chars", async () => {
        const { createWithdrawal } = await import("@/app/actions/admin")
        await expect(
          createWithdrawal(validOrderId, {
            requestedVia: "email",
            customerEmail: "x@x.com",
            customerRequestText: "a".repeat(2001),
          }),
        ).rejects.toThrow("твърде дълъг")
      })

      it("rejects creation on non-delivered orders (Чл. 50 only matures after delivery)", async () => {
        for (const status of ["pending", "confirmed", "shipped", "cancelled", "expired"]) {
          mockSupabase.single.mockResolvedValueOnce({
            data: { id: validOrderId, delivered_at: null, status },
            error: null,
          })
          const { createWithdrawal } = await import("@/app/actions/admin")
          await expect(
            createWithdrawal(validOrderId, {
              requestedVia: "email",
              customerEmail: "x@x.com",
            }),
          ).rejects.toThrow("Право на отказ важи след доставка")
        }
      })

      it("creates a withdrawal and returns ref + id", async () => {
        // .single() returns: order fetch, then withdrawal insert
        mockSupabase.single
          .mockResolvedValueOnce({
            data: { id: validOrderId, delivered_at: "2026-04-20T00:00:00Z", status: "delivered" },
            error: null,
          })
          .mockResolvedValueOnce({
            data: { id: validWithdrawalId, withdrawal_ref: "WD-2026-0001" },
            error: null,
          })
        // RPC for next_withdrawal_ref
        mockSupabase.rpc = vi.fn(() => Promise.resolve({ data: "WD-2026-0001", error: null })) as any

        const { createWithdrawal } = await import("@/app/actions/admin")
        const result = await createWithdrawal(validOrderId, {
          requestedVia: "email",
          customerEmail: "x@x.com",
          customerRequestText: "I changed my mind",
        })

        expect(result.success).toBe(true)
        expect(result.withdrawalId).toBe(validWithdrawalId)
        expect(result.withdrawalRef).toBe("WD-2026-0001")
      })

      it("translates 23505 to friendly 'open withdrawal exists' message", async () => {
        mockSupabase.single
          .mockResolvedValueOnce({
            data: { id: validOrderId, delivered_at: null, status: "delivered" },
            error: null,
          })
          .mockResolvedValueOnce({
            data: null,
            error: { code: "23505", message: "duplicate key on uq_open_withdrawal_per_order" },
          })
        mockSupabase.rpc = vi.fn(() => Promise.resolve({ data: "WD-2026-0001", error: null })) as any

        const { createWithdrawal } = await import("@/app/actions/admin")
        await expect(
          createWithdrawal(validOrderId, { requestedVia: "email", customerEmail: "x@x.com" }),
        ).rejects.toThrow("вече има отворена заявка")
      })
    })

    describe("approveWithdrawal", () => {
      it("rejects invalid UUID", async () => {
        const { approveWithdrawal } = await import("@/app/actions/admin")
        await expect(approveWithdrawal("bad-id", { returnRequired: true })).rejects.toThrow(
          "Невалиден формат",
        )
      })

      it("approves a requested withdrawal", async () => {
        mockSupabase.single.mockResolvedValueOnce({
          data: {
            id: validWithdrawalId,
            order_id: validOrderId,
            customer_email: "x@x.com",
            withdrawal_ref: "WD-2026-0001",
            return_required: true,
          },
          error: null,
        })

        const { approveWithdrawal } = await import("@/app/actions/admin")
        const result = await approveWithdrawal(validWithdrawalId, { returnRequired: true })
        expect(result).toEqual({ success: true })
      })
    })

    describe("rejectWithdrawal", () => {
      it("requires non-empty reason", async () => {
        const { rejectWithdrawal } = await import("@/app/actions/admin")
        await expect(rejectWithdrawal(validWithdrawalId, "  ")).rejects.toThrow("задължителна")
      })

      it("rejects with reason", async () => {
        mockSupabase.single.mockResolvedValueOnce({
          data: {
            id: validWithdrawalId,
            order_id: validOrderId,
            customer_email: "x@x.com",
            withdrawal_ref: "WD-2026-0001",
          },
          error: null,
        })

        const { rejectWithdrawal } = await import("@/app/actions/admin")
        const result = await rejectWithdrawal(validWithdrawalId, "Customer outside 14-day window")
        expect(result).toEqual({ success: true })
      })
    })

    describe("markWithdrawalGoodsReceived", () => {
      it("rejects invalid eligibility condition", async () => {
        const { markWithdrawalGoodsReceived } = await import("@/app/actions/admin")
        await expect(
          markWithdrawalGoodsReceived(validWithdrawalId, {
            eligibilityCondition: "bogus" as never,
          }),
        ).rejects.toThrow("Невалидно състояние")
      })

      it("flips status with valid condition", async () => {
        const updateChain = {
          eq: vi.fn(() => updateChain),
          then(resolve: (v: unknown) => void) {
            resolve({ data: null, error: null })
          },
        }
        mockSupabase.update = vi.fn(() => updateChain) as any

        const { markWithdrawalGoodsReceived } = await import("@/app/actions/admin")
        const result = await markWithdrawalGoodsReceived(validWithdrawalId, {
          eligibilityCondition: "sealed_sellable",
          resolutionType: "refund",
          returnTrackingNumber: "1Z999AA1234567890",
          returnCourier: "Speedy",
        })
        expect(result).toEqual({ success: true })
      })
    })

    describe("completeWithdrawalNoReturn", () => {
      it("requires completion_note", async () => {
        const { completeWithdrawalNoReturn } = await import("@/app/actions/admin")
        await expect(
          completeWithdrawalNoReturn(validWithdrawalId, {
            resolutionType: "none",
            completionNote: "  ",
          }),
        ).rejects.toThrow("задължителна")
      })

      it("accepts replacement resolution + note", async () => {
        const updateChain = {
          eq: vi.fn(() => updateChain),
          then(resolve: (v: unknown) => void) {
            resolve({ data: null, error: null })
          },
        }
        mockSupabase.update = vi.fn(() => updateChain) as any

        const { completeWithdrawalNoReturn } = await import("@/app/actions/admin")
        const result = await completeWithdrawalNoReturn(validWithdrawalId, {
          resolutionType: "replacement",
          completionNote: "Goodwill replacement shipped on a fresh order",
        })
        expect(result).toEqual({ success: true })
      })
    })
  })

  // ─── Batch traceability ─────────────────────────────────────────────────
  describe("batch traceability", () => {
    const validBatchId = "11111111-1111-1111-1111-111111111111"
    const validOrderId = validUUID

    describe("recallBatch", () => {
      it("rejects invalid UUID", async () => {
        const { recallBatch } = await import("@/app/actions/admin")
        await expect(
          recallBatch("bad-id", "Контаминация в склада на доставчика"),
        ).rejects.toThrow("Невалиден формат")
      })

      it("rejects reason shorter than 20 characters", async () => {
        const { recallBatch } = await import("@/app/actions/admin")
        await expect(
          recallBatch(validBatchId, "къса"),
        ).rejects.toThrow("поне 20 символа")
      })

      it("rejects reason longer than 1000 characters", async () => {
        const { recallBatch } = await import("@/app/actions/admin")
        await expect(
          recallBatch(validBatchId, "x".repeat(1001)),
        ).rejects.toThrow("твърде дълга")
      })

      it("recalls successfully with sufficient reason", async () => {
        // Update returns one row; affected_orders RPC returns empty array.
        const updateChain = {
          eq: vi.fn(() => updateChain),
          select: vi.fn(() => updateChain),
          then(resolve: (v: unknown) => void) {
            resolve({ data: [{ id: validBatchId }], error: null })
          },
        }
        mockSupabase.update = vi.fn(() => updateChain) as any
        mockSupabase.rpc = vi.fn(() => Promise.resolve({ data: [], error: null })) as any

        const { recallBatch } = await import("@/app/actions/admin")
        const result = await recallBatch(
          validBatchId,
          "Съмнения за повишена влажност в склад на доставчика, потенциална контаминация",
        )
        expect(result.success).toBe(true)
        expect(result.affectedOrdersCount).toBe(0)
      })
    })

    describe("confirmShipmentBatches", () => {
      it("rejects when order is not in confirmed state", async () => {
        mockSupabase.single.mockResolvedValueOnce({
          data: { id: validOrderId, status: "delivered" },
          error: null,
        })
        const { confirmShipmentBatches } = await import("@/app/actions/admin")
        await expect(
          confirmShipmentBatches(validOrderId, [
            { orderItemId: 1, productBatchId: validBatchId, quantity: 1 },
          ]),
        ).rejects.toThrow("потвърдени поръчки")
      })

      it("rejects when allocations don't sum to ordered quantity", async () => {
        mockSupabase.single.mockResolvedValueOnce({
          data: { id: validOrderId, status: "confirmed" },
          error: null,
        })
        const calls: unknown[] = [
          mockSupabase, // 1. orders fetch (uses .single)
          mockThenableResult([{ id: 1, sku: "EGO-MIX-12", quantity: 3 }], null), // 2. order_items
          mockThenableResult([], null), // 3. existing allocations
        ]
        let idx = 0
        mockSupabase.from = vi.fn(() => {
          const ret = calls[idx] ?? mockSupabase
          idx += 1
          return ret as never
        }) as any

        const { confirmShipmentBatches } = await import("@/app/actions/admin")
        await expect(
          confirmShipmentBatches(validOrderId, [
            { orderItemId: 1, productBatchId: validBatchId, quantity: 2 },
          ]),
        ).rejects.toThrow("трябва да съвпадне с поръчаното")
      })

      it("rejects allocation against an inactive (recalled) batch", async () => {
        mockSupabase.single.mockResolvedValueOnce({
          data: { id: validOrderId, status: "confirmed" },
          error: null,
        })
        const calls: unknown[] = [
          mockSupabase,
          mockThenableResult([{ id: 1, sku: "EGO-MIX-12", quantity: 1 }], null),
          mockThenableResult([], null),
          mockThenableResult(
            [{ id: validBatchId, sku: "EGO-MIX-12", status: "recalled", batch_number: "LOT-X" }],
            null,
          ),
        ]
        let idx = 0
        mockSupabase.from = vi.fn(() => {
          const ret = calls[idx] ?? mockSupabase
          idx += 1
          return ret as never
        }) as any

        const { confirmShipmentBatches } = await import("@/app/actions/admin")
        await expect(
          confirmShipmentBatches(validOrderId, [
            { orderItemId: 1, productBatchId: validBatchId, quantity: 1 },
          ]),
        ).rejects.toThrow("не е активна")
      })

      it("rejects allocation when batch SKU doesn't match item SKU", async () => {
        mockSupabase.single.mockResolvedValueOnce({
          data: { id: validOrderId, status: "confirmed" },
          error: null,
        })
        const calls: unknown[] = [
          mockSupabase,
          mockThenableResult([{ id: 1, sku: "EGO-MIX-12", quantity: 1 }], null),
          mockThenableResult([], null),
          mockThenableResult(
            [{ id: validBatchId, sku: "EGO-DC-12", status: "active", batch_number: "LOT-Y" }],
            null,
          ),
        ]
        let idx = 0
        mockSupabase.from = vi.fn(() => {
          const ret = calls[idx] ?? mockSupabase
          idx += 1
          return ret as never
        }) as any

        const { confirmShipmentBatches } = await import("@/app/actions/admin")
        await expect(
          confirmShipmentBatches(validOrderId, [
            { orderItemId: 1, productBatchId: validBatchId, quantity: 1 },
          ]),
        ).rejects.toThrow("не съвпада със SKU на артикула")
      })
    })
  })
})
