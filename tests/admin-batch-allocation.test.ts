import { describe, it, expect, vi, beforeEach } from "vitest"
import { createSupabaseMock, resetSupabaseMock, mockThenableResult } from "./helpers/supabase-mock"

// Mock admin-auth — bypass session check for these unit tests
vi.mock("@/lib/admin-auth", () => ({
  createAdminSession: vi.fn(),
  validateAdminSession: vi.fn(() => Promise.resolve(true)),
  destroyAdminSession: vi.fn(),
}))

// Mock courier clients (admin.ts imports these for generateShipment)
vi.mock("@/lib/speedy", () => ({ createShipment: vi.fn() }))
vi.mock("@/lib/econt", () => ({ createShipment: vi.fn() }))
vi.mock("@/lib/delivery-confirmation", () => ({ confirmDeliveryForOrder: vi.fn() }))
vi.mock("@/lib/stripe", () => ({ stripe: { refunds: { retrieve: vi.fn() } } }))
vi.mock("@/lib/credit-note", () => ({ autoCreateCreditNoteRow: vi.fn() }))
vi.mock("resend", () => ({ Resend: class { emails = { send: vi.fn() } } }))
vi.mock("@/lib/email-sender", () => ({
  sendOrderConfirmationEmail: vi.fn(),
  sendDeliveryEmail: vi.fn(),
  notifyAdminNewOrder: vi.fn(),
  sendWithdrawalReceivedEmail: vi.fn(),
  sendWithdrawalApprovedEmail: vi.fn(),
  sendWithdrawalRejectedEmail: vi.fn(),
}))
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }))
vi.mock("next/headers", () => ({ headers: vi.fn(() => Promise.resolve({ get: () => null })) }))
vi.mock("next/navigation", () => ({ redirect: vi.fn() }))

const mockSupabase = createSupabaseMock()
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
}))

const VALID_ORDER_ID = "11111111-1111-1111-1111-111111111111"
const BATCH_A = "22222222-2222-2222-2222-222222222222"
const BATCH_B = "33333333-3333-3333-3333-333333333333"
const TODAY = new Date().toISOString().slice(0, 10)
const FUTURE = "2027-12-31"
const PAST = "2020-01-01"

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  vi.stubEnv("ADMIN_PASSWORD", "test-password")
  resetSupabaseMock(mockSupabase)
})

describe("saveBatchAllocation — input validation (rejects before DB)", () => {
  it("rejects invalid order ID", async () => {
    const { saveBatchAllocation } = await import("@/app/actions/admin")
    await expect(saveBatchAllocation("not-a-uuid", [])).rejects.toThrow("Невалиден формат на поръчка")
  })

  it("rejects empty allocations", async () => {
    const { saveBatchAllocation } = await import("@/app/actions/admin")
    await expect(saveBatchAllocation(VALID_ORDER_ID, [])).rejects.toThrow("Не са предоставени")
  })

  it("rejects invalid product batch UUID", async () => {
    const { saveBatchAllocation } = await import("@/app/actions/admin")
    await expect(
      saveBatchAllocation(VALID_ORDER_ID, [{ orderItemId: 1, productBatchId: "x", quantity: 1 }]),
    ).rejects.toThrow("Невалиден формат на партида")
  })

  it("rejects duplicate (orderItemId, batchId) pair", async () => {
    const { saveBatchAllocation } = await import("@/app/actions/admin")
    await expect(
      saveBatchAllocation(VALID_ORDER_ID, [
        { orderItemId: 1, productBatchId: BATCH_A, quantity: 1 },
        { orderItemId: 1, productBatchId: BATCH_A, quantity: 2 },
      ]),
    ).rejects.toThrow("Дублирано")
  })

  it("rejects non-positive quantity", async () => {
    const { saveBatchAllocation } = await import("@/app/actions/admin")
    await expect(
      saveBatchAllocation(VALID_ORDER_ID, [{ orderItemId: 1, productBatchId: BATCH_A, quantity: 0 }]),
    ).rejects.toThrow("положително")
  })

  it("rejects expired override flag without reason", async () => {
    const { saveBatchAllocation } = await import("@/app/actions/admin")
    await expect(
      saveBatchAllocation(VALID_ORDER_ID, [{
        orderItemId: 1, productBatchId: BATCH_A, quantity: 1,
        allowExpiredOverride: true, expiredOverrideReason: "short",
      }]),
    ).rejects.toThrow("изтекъл срок")
  })

  it("rejects expired-override reason without the flag set", async () => {
    const { saveBatchAllocation } = await import("@/app/actions/admin")
    await expect(
      saveBatchAllocation(VALID_ORDER_ID, [{
        orderItemId: 1, productBatchId: BATCH_A, quantity: 1,
        expiredOverrideReason: "this is at least twenty chars long",
      }]),
    ).rejects.toThrow("без потвърден")
  })

  it("rejects non_fefo_reason that's too short", async () => {
    const { saveBatchAllocation } = await import("@/app/actions/admin")
    await expect(
      saveBatchAllocation(VALID_ORDER_ID, [{
        orderItemId: 1, productBatchId: BATCH_A, quantity: 1,
        nonFefoReason: "too short",
      }]),
    ).rejects.toThrow("FEFO")
  })
})

describe("saveBatchAllocation — DB-driven flows", () => {
  function setupSingleLineHappyPath() {
    // 1. order_items lookup → 1 line, 5 ordered
    // 2. product_batches lookup → batches A (early) + B (later)
    // 3. batch_quantity_available RPC → A=3, B=10
    // 4. save_batch_allocation RPC → ok
    // 5. record_order_outcome RPC → ok
    mockSupabase.order = vi.fn(() => mockThenableResult([
      { id: 1, sku: "EO-DARK-12", quantity: 5, product_name: "Dark" },
    ]))
    mockSupabase.in = vi.fn(() => mockThenableResult([
      { id: BATCH_A, sku: "EO-DARK-12", batch_number: "A", expiry_date: "2026-06-01", created_at: "2026-04-01T00:00:00Z", status: "active" },
      { id: BATCH_B, sku: "EO-DARK-12", batch_number: "B", expiry_date: "2027-01-01", created_at: "2026-04-15T00:00:00Z", status: "active" },
    ]))
    mockSupabase.rpc = vi.fn((name: string, args: unknown) => {
      if (name === "batch_quantity_available") {
        const params = args as { p_batch_id: string }
        return Promise.resolve({ data: params.p_batch_id === BATCH_A ? 3 : 10, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    })
  }

  it("happy path — FEFO-compliant split calls save_batch_allocation RPC with mapped payload", async () => {
    setupSingleLineHappyPath()
    const { saveBatchAllocation } = await import("@/app/actions/admin")

    const result = await saveBatchAllocation(VALID_ORDER_ID, [
      { orderItemId: 1, productBatchId: BATCH_A, quantity: 3 },
      { orderItemId: 1, productBatchId: BATCH_B, quantity: 2 },
    ])

    expect(result).toEqual({ success: true, saved: 2 })
    expect(mockSupabase.rpc).toHaveBeenCalledWith("save_batch_allocation", expect.objectContaining({
      p_order_id: VALID_ORDER_ID,
      p_allocations: expect.arrayContaining([
        expect.objectContaining({
          order_item_id: 1, product_batch_id: BATCH_A, quantity: 3,
        }),
        expect.objectContaining({
          order_item_id: 1, product_batch_id: BATCH_B, quantity: 2,
        }),
      ]),
    }))
    expect(mockSupabase.rpc).toHaveBeenCalledWith("record_order_outcome", expect.objectContaining({
      p_outcome_type: "batch_allocation_saved",
      p_payload: expect.objectContaining({ fefo_compliant: true, has_expired_override: false }),
    }))
  })

  it("rejects allocation that doesn't sum to ordered qty", async () => {
    setupSingleLineHappyPath()
    const { saveBatchAllocation } = await import("@/app/actions/admin")

    await expect(
      saveBatchAllocation(VALID_ORDER_ID, [
        { orderItemId: 1, productBatchId: BATCH_A, quantity: 3 },
        // Missing 2 from B → only 3/5 allocated
      ]),
    ).rejects.toThrow("не съвпадат")
  })

  it("rejects non-FEFO selection without reason", async () => {
    setupSingleLineHappyPath()
    const { saveBatchAllocation } = await import("@/app/actions/admin")

    // Skip earlier batch A (3 available), go straight to B
    await expect(
      saveBatchAllocation(VALID_ORDER_ID, [
        { orderItemId: 1, productBatchId: BATCH_B, quantity: 5 },
      ]),
    ).rejects.toThrow(/по-късен срок/)
  })

  it("accepts non-FEFO selection with a long-enough reason and emits override audit event", async () => {
    setupSingleLineHappyPath()
    const { saveBatchAllocation } = await import("@/app/actions/admin")

    await saveBatchAllocation(VALID_ORDER_ID, [
      { orderItemId: 1, productBatchId: BATCH_B, quantity: 5,
        nonFefoReason: "Customer requested specific batch number for compliance reasons" },
    ])

    expect(mockSupabase.rpc).toHaveBeenCalledWith("record_order_outcome", expect.objectContaining({
      p_outcome_type: "batch_allocation_overridden_fefo",
      p_payload: expect.objectContaining({ order_item_id: 1, product_batch_id: BATCH_B }),
    }))
  })

  it("translates RPC 'locked' error into Bulgarian message", async () => {
    setupSingleLineHappyPath()
    // Override RPC: batch_quantity_available still A=3, B=10 so FEFO passes,
    // but save_batch_allocation returns the locked error.
    mockSupabase.rpc = vi.fn((name: string, args: unknown) => {
      if (name === "save_batch_allocation") {
        return Promise.resolve({ data: null, error: { message: "Allocation is locked (tracking_number is set)" } })
      }
      if (name === "batch_quantity_available") {
        const params = args as { p_batch_id: string }
        return Promise.resolve({ data: params.p_batch_id === BATCH_A ? 3 : 10, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    })
    const { saveBatchAllocation } = await import("@/app/actions/admin")

    await expect(
      saveBatchAllocation(VALID_ORDER_ID, [
        { orderItemId: 1, productBatchId: BATCH_A, quantity: 3 },
        { orderItemId: 1, productBatchId: BATCH_B, quantity: 2 },
      ]),
    ).rejects.toThrow("заключени")
  })
})

describe("cancelShipment", () => {
  it("rejects invalid order ID", async () => {
    const { cancelShipment } = await import("@/app/actions/admin")
    await expect(cancelShipment("not-a-uuid", "valid reason here")).rejects.toThrow("Невалиден формат на поръчка")
  })

  it("rejects too-short reason", async () => {
    const { cancelShipment } = await import("@/app/actions/admin")
    await expect(cancelShipment(VALID_ORDER_ID, "short")).rejects.toThrow("поне 10")
  })

  it("rejects when order status isn't 'confirmed'", async () => {
    mockSupabase.single = vi.fn(() => Promise.resolve({
      data: { id: VALID_ORDER_ID, status: "shipped", tracking_number: "SP123456" }, error: null,
    }))
    const { cancelShipment } = await import("@/app/actions/admin")
    await expect(cancelShipment(VALID_ORDER_ID, "valid reason here")).rejects.toThrow("потвърдени")
  })

  it("rejects when tracking_number is null", async () => {
    mockSupabase.single = vi.fn(() => Promise.resolve({
      data: { id: VALID_ORDER_ID, status: "confirmed", tracking_number: null }, error: null,
    }))
    const { cancelShipment } = await import("@/app/actions/admin")
    await expect(cancelShipment(VALID_ORDER_ID, "valid reason here")).rejects.toThrow("няма генерирана")
  })

  it("rejects when tracking_number is the __generating__ placeholder", async () => {
    mockSupabase.single = vi.fn(() => Promise.resolve({
      data: { id: VALID_ORDER_ID, status: "confirmed", tracking_number: "__generating__" }, error: null,
    }))
    const { cancelShipment } = await import("@/app/actions/admin")
    await expect(cancelShipment(VALID_ORDER_ID, "valid reason here")).rejects.toThrow(/генерира/)
  })

  it("happy path: clears tracking_number and emits unlock audit event", async () => {
    // Initial read returns a real tracking number
    mockSupabase.single = vi.fn(() => Promise.resolve({
      data: { id: VALID_ORDER_ID, status: "confirmed", tracking_number: "SP123456" }, error: null,
    }))
    // The conditional UPDATE returns the row indicating success.
    // The action chains .update().eq().eq().select().single(), so the chained
    // chain mock's `.single` is what gets awaited.
    const updateChain = {
      eq: vi.fn(() => updateChain),
      select: vi.fn(() => updateChain),
      single: vi.fn(() => Promise.resolve({ data: { id: VALID_ORDER_ID }, error: null })),
    }
    mockSupabase.update = vi.fn(() => updateChain) as never

    const { cancelShipment } = await import("@/app/actions/admin")
    const result = await cancelShipment(VALID_ORDER_ID, "wrong recipient address, regenerating")

    expect(result).toEqual({ success: true, previousTrackingNumber: "SP123456" })
    expect(mockSupabase.update).toHaveBeenCalledWith(expect.objectContaining({ tracking_number: null }))
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      "record_order_outcome",
      expect.objectContaining({
        p_outcome_type: "batch_allocation_unlocked_after_shipment_cancelled",
        p_payload: expect.objectContaining({
          previous_tracking_number: "SP123456",
          reason: "wrong recipient address, regenerating",
        }),
      }),
    )
  })

  it("rejects when the conditional UPDATE finds no row (race with another writer)", async () => {
    mockSupabase.single = vi.fn(() => Promise.resolve({
      data: { id: VALID_ORDER_ID, status: "confirmed", tracking_number: "SP123456" }, error: null,
    }))
    const updateChain = {
      eq: vi.fn(() => updateChain),
      select: vi.fn(() => updateChain),
      single: vi.fn(() => Promise.resolve({ data: null, error: null })),
    }
    mockSupabase.update = vi.fn(() => updateChain) as never

    const { cancelShipment } = await import("@/app/actions/admin")
    await expect(cancelShipment(VALID_ORDER_ID, "valid reason here")).rejects.toThrow("обновете страницата")
  })
})

describe("clearBatchAllocation", () => {
  it("rejects invalid order ID", async () => {
    const { clearBatchAllocation } = await import("@/app/actions/admin")
    await expect(clearBatchAllocation("not-a-uuid")).rejects.toThrow("Невалиден формат на поръчка")
  })

  it("returns 0 cleared when order has no items", async () => {
    mockSupabase.eq = vi.fn(() => mockThenableResult([]))
    const { clearBatchAllocation } = await import("@/app/actions/admin")
    const result = await clearBatchAllocation(VALID_ORDER_ID)
    expect(result).toEqual({ success: true, cleared: 0 })
    // No audit emit for no-op
    expect(mockSupabase.rpc).not.toHaveBeenCalledWith("record_order_outcome", expect.anything())
  })

  it("translates lifecycle-trigger error into Bulgarian", async () => {
    mockSupabase.eq = vi.fn(() => mockThenableResult([{ id: 1 }]))
    mockSupabase.delete = vi.fn(() => ({
      in: vi.fn(() => Promise.resolve({
        error: { message: "Cannot modify batch allocation after shipment generation (tracking_number is set)" },
        count: null,
      })),
    }))
    const { clearBatchAllocation } = await import("@/app/actions/admin")
    await expect(clearBatchAllocation(VALID_ORDER_ID)).rejects.toThrow("заключени")
  })
})
