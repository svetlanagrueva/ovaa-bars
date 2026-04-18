import { describe, it, expect, vi, beforeEach } from "vitest"
import { createSupabaseMock, resetSupabaseMock, mockThenableResult } from "./helpers/supabase-mock"

// Mock server-only
vi.mock("server-only", () => ({}))

// Mock Supabase
const mockSupabase = createSupabaseMock()
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
}))

// Mock email sender
const mockSendDeliveryEmail = vi.fn()
vi.mock("@/lib/email-sender", () => ({
  sendDeliveryEmail: (...args: any[]) => mockSendDeliveryEmail(...args),
}))

const validUUID = "11111111-1111-1111-1111-111111111111"

describe("delivery-confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSupabaseMock(mockSupabase)
  })

  describe("confirmDeliveryForOrder", () => {
    it("calls confirm_delivery RPC and sends email on success", async () => {
      const orderRow = { id: validUUID, first_name: "Ivan", email: "ivan@test.com", items: [] }
      mockSupabase.rpc.mockReturnValueOnce(Promise.resolve({ data: [orderRow], error: null }))

      const { confirmDeliveryForOrder } = await import("@/lib/delivery-confirmation")
      const result = await confirmDeliveryForOrder(validUUID, "2026-04-16T14:30:00Z", "admin")

      expect(result.confirmed).toBe(true)
      expect(mockSupabase.rpc).toHaveBeenCalledWith("confirm_delivery", {
        p_order_id: validUUID,
        p_delivered_at: "2026-04-16T14:30:00Z",
      })
      expect(mockSendDeliveryEmail).toHaveBeenCalledWith(orderRow)
    })

    it("returns confirmed: false when RPC returns empty array", async () => {
      mockSupabase.rpc.mockReturnValueOnce(Promise.resolve({ data: [], error: null }))

      const { confirmDeliveryForOrder } = await import("@/lib/delivery-confirmation")
      const result = await confirmDeliveryForOrder(validUUID, "2026-04-16T14:30:00Z", "speedy")

      expect(result.confirmed).toBe(false)
      expect(mockSendDeliveryEmail).not.toHaveBeenCalled()
    })

    it("throws when RPC fails", async () => {
      mockSupabase.rpc.mockReturnValueOnce(Promise.resolve({ data: null, error: { message: "DB error" } }))

      const { confirmDeliveryForOrder } = await import("@/lib/delivery-confirmation")
      await expect(
        confirmDeliveryForOrder(validUUID, "2026-04-16T14:30:00Z", "econt")
      ).rejects.toThrow("Failed to confirm delivery")
    })
  })

  describe("confirmDeliveryByTrackingNumber", () => {
    it("resolves tracking number to order and delegates to confirmDeliveryForOrder", async () => {
      // Mock the select query for tracking number lookup
      const selectChain = {
        eq: vi.fn(() => selectChain),
        limit: vi.fn(() => Promise.resolve({ data: [{ id: validUUID }], error: null })),
      }
      mockSupabase.select.mockReturnValueOnce(selectChain)

      // Mock the RPC for confirmDeliveryForOrder
      const orderRow = { id: validUUID, first_name: "Ivan", email: "ivan@test.com", items: [] }
      mockSupabase.rpc.mockReturnValueOnce(Promise.resolve({ data: [orderRow], error: null }))

      const { confirmDeliveryByTrackingNumber } = await import("@/lib/delivery-confirmation")
      const result = await confirmDeliveryByTrackingNumber("SPD123", "2026-04-16T14:30:00Z", "speedy")

      expect(result.confirmed).toBe(true)
      expect(result.orderId).toBe(validUUID)
    })

    it("returns confirmed: false when no order matches tracking number", async () => {
      const selectChain = {
        eq: vi.fn(() => selectChain),
        limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
      }
      mockSupabase.select.mockReturnValueOnce(selectChain)

      const { confirmDeliveryByTrackingNumber } = await import("@/lib/delivery-confirmation")
      const result = await confirmDeliveryByTrackingNumber("UNKNOWN", "2026-04-16T14:30:00Z", "speedy")

      expect(result.confirmed).toBe(false)
      expect(mockSupabase.rpc).not.toHaveBeenCalled()
    })

    it("returns confirmed: false and logs when multiple orders match", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
      const selectChain = {
        eq: vi.fn(() => selectChain),
        limit: vi.fn(() => Promise.resolve({
          data: [{ id: validUUID }, { id: "22222222-2222-2222-2222-222222222222" }],
          error: null,
        })),
      }
      mockSupabase.select.mockReturnValueOnce(selectChain)

      const { confirmDeliveryByTrackingNumber } = await import("@/lib/delivery-confirmation")
      const result = await confirmDeliveryByTrackingNumber("AMBIGUOUS", "2026-04-16T14:30:00Z", "econt")

      expect(result.confirmed).toBe(false)
      expect(mockSupabase.rpc).not.toHaveBeenCalled()
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Ambiguous tracking number",
        expect.objectContaining({ trackingNumber: "AMBIGUOUS" })
      )
      consoleErrorSpy.mockRestore()
    })
  })
})
