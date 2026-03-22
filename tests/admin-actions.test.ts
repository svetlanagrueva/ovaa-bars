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

const mockSupabase: Record<string, ReturnType<typeof vi.fn>> = {
  from: vi.fn(() => mockSupabase),
  select: vi.fn(() => mockSupabase),
  insert: vi.fn(() => mockSupabase),
  update: vi.fn(() => mockUpdateChain),
  delete: vi.fn(() => mockSupabase),
  eq: vi.fn(() => mockSupabase),
  neq: vi.fn(() => mockSupabase),
  order: vi.fn(() => mockSupabase),
  range: vi.fn(() => mockSupabase),
  limit: vi.fn(() => mockSupabase),
  is: vi.fn(() => mockSupabase),
  not: vi.fn(() => mockSupabase),
  ilike: vi.fn(() => mockSupabase),
  or: vi.fn(() => mockSupabase),
  gte: vi.fn(() => mockSupabase),
  lte: vi.fn(() => mockSupabase),
  single: vi.fn(),
  rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
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
    // Reset mocks that tests override with custom implementations
    mockSupabase.update = vi.fn(() => mockUpdateChain)
    mockSupabase.rpc = vi.fn(() => Promise.resolve({ data: null, error: null }))
    mockSupabase.limit = vi.fn(() => mockSupabase)
    mockSupabase.single = vi.fn()
    mockSupabase.range = vi.fn(() => mockSupabase)
    mockSupabase.order = vi.fn(() => mockSupabase)
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
      expect(result.recentOrders).toEqual(recentOrders)
    })

    it("throws on RPC error", async () => {
      mockSupabase.rpc = vi.fn(() => Promise.resolve({ data: null, error: { message: "rpc failed" } }))

      const { getDashboardStats } = await import("@/app/actions/admin")
      await expect(getDashboardStats()).rejects.toThrow("Failed to fetch dashboard stats")
    })
  })

  describe("updateAdminNotes", () => {
    const validOrderId = "550e8400-e29b-41d4-a716-446655440000"

    it("throws Unauthorized when not authenticated", async () => {
      mockValidateAdminSession.mockResolvedValue(false)
      const { updateAdminNotes } = await import("@/app/actions/admin")

      await expect(updateAdminNotes(validOrderId, "test")).rejects.toThrow("Unauthorized")
    })

    it("rejects invalid UUID", async () => {
      const { updateAdminNotes } = await import("@/app/actions/admin")

      await expect(updateAdminNotes("bad-id", "note")).rejects.toThrow("Invalid order ID")
    })

    it("rejects notes over 5000 chars", async () => {
      const { updateAdminNotes } = await import("@/app/actions/admin")

      await expect(updateAdminNotes(validOrderId, "x".repeat(5001))).rejects.toThrow("Notes too long")
    })

    it("updates notes successfully", async () => {
      mockSupabase.update = vi.fn(() => mockThenableResult(null))

      const { updateAdminNotes } = await import("@/app/actions/admin")
      const result = await updateAdminNotes(validOrderId, "Customer called")

      expect(result).toEqual({ success: true })
    })

    it("clears notes when empty string", async () => {
      mockSupabase.update = vi.fn(() => mockThenableResult(null))

      const { updateAdminNotes } = await import("@/app/actions/admin")
      const result = await updateAdminNotes(validOrderId, "")

      expect(result).toEqual({ success: true })
    })
  })

  describe("issueInvoice", () => {
    const validOrderId = "550e8400-e29b-41d4-a716-446655440000"

    it("throws Unauthorized when not authenticated", async () => {
      mockValidateAdminSession.mockResolvedValue(false)
      const { issueInvoice } = await import("@/app/actions/admin")

      await expect(issueInvoice(validOrderId)).rejects.toThrow("Unauthorized")
    })

    it("rejects invalid UUID", async () => {
      const { issueInvoice } = await import("@/app/actions/admin")

      await expect(issueInvoice("bad-id")).rejects.toThrow("Invalid order ID")
    })

    it("throws when order already has invoice", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: validOrderId, invoice_number: "0000000001" },
        error: null,
      })

      const { issueInvoice } = await import("@/app/actions/admin")
      await expect(issueInvoice(validOrderId)).rejects.toThrow("Фактура вече е издадена")
    })

    it("throws when order not found", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: { message: "not found" },
      })

      const { issueInvoice } = await import("@/app/actions/admin")
      await expect(issueInvoice(validOrderId)).rejects.toThrow("Order not found")
    })

    it("issues invoice via RPC and returns number", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: validOrderId, invoice_number: null, email: "test@test.com", first_name: "Test" },
        error: null,
      })
      mockSupabase.rpc = vi.fn(() => Promise.resolve({ data: "0000000001", error: null }))
      // Second .single() for fetching updated order
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: validOrderId, invoice_number: "0000000001", invoice_date: new Date().toISOString() },
        error: null,
      })

      const { issueInvoice } = await import("@/app/actions/admin")
      const result = await issueInvoice(validOrderId)

      expect(result).toEqual({ invoiceNumber: "0000000001" })
      expect(mockSupabase.rpc).toHaveBeenCalledWith("issue_invoice_number", { p_order_id: validOrderId })
    })

    it("throws when RPC fails", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: validOrderId, invoice_number: null },
        error: null,
      })
      mockSupabase.rpc = vi.fn(() => Promise.resolve({ data: null, error: { message: "rpc error" } }))

      const { issueInvoice } = await import("@/app/actions/admin")
      await expect(issueInvoice(validOrderId)).rejects.toThrow("Failed to issue invoice")
    })
  })

  describe("downloadInvoicePDF", () => {
    const validOrderId = "550e8400-e29b-41d4-a716-446655440000"

    it("throws Unauthorized when not authenticated", async () => {
      mockValidateAdminSession.mockResolvedValue(false)
      const { downloadInvoicePDF } = await import("@/app/actions/admin")

      await expect(downloadInvoicePDF(validOrderId)).rejects.toThrow("Unauthorized")
    })

    it("rejects invalid UUID", async () => {
      const { downloadInvoicePDF } = await import("@/app/actions/admin")

      await expect(downloadInvoicePDF("bad-id")).rejects.toThrow("Invalid order ID")
    })

    it("returns PDF for order with invoice", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: {
          id: validOrderId,
          invoice_number: "0000000001",
          invoice_date: "2026-01-01T00:00:00Z",
          items: [{ productName: "Test", quantity: 1, priceInCents: 1000 }],
        },
        error: null,
      })

      const { downloadInvoicePDF } = await import("@/app/actions/admin")
      const result = await downloadInvoicePDF(validOrderId)

      expect(result.filename).toBe("faktura-0000000001.pdf")
      expect(result.pdfBase64).toBeTruthy()
    })

    it("returns proforma PDF for order without invoice", async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: {
          id: validOrderId,
          invoice_number: null,
          created_at: "2026-01-01T00:00:00Z",
          items: [{ productName: "Test", quantity: 1, priceInCents: 1000 }],
        },
        error: null,
      })

      const { downloadInvoicePDF } = await import("@/app/actions/admin")
      const result = await downloadInvoicePDF(validOrderId)

      expect(result.filename).toBe(`proforma-${validOrderId.slice(0, 8)}.pdf`)
      expect(result.pdfBase64).toBeTruthy()
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

  describe("deactivatePromoCode", () => {
    const validId = "550e8400-e29b-41d4-a716-446655440000"

    it("throws Unauthorized when not authenticated", async () => {
      mockValidateAdminSession.mockResolvedValue(false)
      const { deactivatePromoCode } = await import("@/app/actions/admin")

      await expect(deactivatePromoCode(validId)).rejects.toThrow("Unauthorized")
    })

    it("rejects invalid UUID", async () => {
      const { deactivatePromoCode } = await import("@/app/actions/admin")

      await expect(deactivatePromoCode("bad-id")).rejects.toThrow("Invalid promo code ID")
    })
  })

  describe("endSale", () => {
    const validId = "550e8400-e29b-41d4-a716-446655440000"

    it("throws Unauthorized when not authenticated", async () => {
      mockValidateAdminSession.mockResolvedValue(false)
      const { endSale } = await import("@/app/actions/admin")

      await expect(endSale(validId)).rejects.toThrow("Unauthorized")
    })

    it("rejects invalid UUID", async () => {
      const { endSale } = await import("@/app/actions/admin")

      await expect(endSale("bad-id")).rejects.toThrow("Invalid sale ID")
    })
  })
})
