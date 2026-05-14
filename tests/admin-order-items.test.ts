import { describe, it, expect, vi, beforeEach } from "vitest"
import { createSupabaseMock, resetSupabaseMock } from "./helpers/supabase-mock"

// Auth + heavy collaborators stubbed; this suite exercises addOrderItem and
// removeOrderItem — input validation, RPC HINT-code translation, and the
// audit-emit shape. The actual atomic UPDATE happens inside the
// add_order_item / remove_order_item RPCs, which integration-test
// coverage handles separately.
vi.mock("@/lib/admin-auth", () => ({
  createAdminSession: vi.fn(),
  validateAdminSession: vi.fn(() => Promise.resolve(true)),
  destroyAdminSession: vi.fn(),
}))
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

// getProductsWithSales is invoked by addOrderItem to resolve the live
// price. Stub it to return base prices so the test doesn't need to set up
// a product_sales table fixture.
vi.mock("@/lib/sales", () => ({
  getProductsWithSales: vi.fn(() =>
    Promise.resolve([
      { id: "egg-origin-dark-chocolate-box", sku: "EGO-DC-12", name: "Натурален Шоколад", priceInCents: 2570 },
      { id: "egg-origin-white-chocolate-raspberry-box", sku: "EGO-WCR-12", name: "Бял Шоколад с Малини", priceInCents: 2570 },
      { id: "egg-origin-mix-box", sku: "EGO-MIX-12", name: "Микс", priceInCents: 2570 },
    ]),
  ),
}))

const mockSupabase = createSupabaseMock()
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
}))

const VALID_ORDER_ID = "11111111-1111-1111-1111-111111111111"

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  vi.stubEnv("ADMIN_PASSWORD", "test-password")
  resetSupabaseMock(mockSupabase)
})

describe("addOrderItem — input validation (rejects before DB)", () => {
  it("rejects invalid order ID", async () => {
    const { addOrderItem } = await import("@/app/actions/admin")
    await expect(addOrderItem("not-a-uuid", "EGO-DC-12", 1)).rejects.toThrow("Invalid order ID")
  })

  it("rejects unknown SKU", async () => {
    const { addOrderItem } = await import("@/app/actions/admin")
    await expect(addOrderItem(VALID_ORDER_ID, "EGO-NOT-A-PRODUCT", 1)).rejects.toThrow("Невалиден SKU")
  })

  it("rejects zero quantity", async () => {
    const { addOrderItem } = await import("@/app/actions/admin")
    await expect(addOrderItem(VALID_ORDER_ID, "EGO-DC-12", 0)).rejects.toThrow(
      "Количеството трябва да е цяло число между 1 и 100",
    )
  })

  it("rejects non-integer quantity", async () => {
    const { addOrderItem } = await import("@/app/actions/admin")
    await expect(addOrderItem(VALID_ORDER_ID, "EGO-DC-12", 2.5)).rejects.toThrow(
      "Количеството трябва да е цяло число между 1 и 100",
    )
  })

  it("rejects quantity > 100", async () => {
    const { addOrderItem } = await import("@/app/actions/admin")
    await expect(addOrderItem(VALID_ORDER_ID, "EGO-DC-12", 101)).rejects.toThrow(
      "Количеството трябва да е цяло число между 1 и 100",
    )
  })
})

describe("addOrderItem — RPC error translation via HINT codes", () => {
  // The RPC returns a Postgres error with a stable hint code; the action
  // must map each hint to a friendly Bulgarian message. These tests guard
  // the wording so future RPC text changes can't silently break the UI.
  const cases: Array<{ hint: string; expected: string | RegExp }> = [
    { hint: "ORDER_NOT_FOUND", expected: "Поръчката не е намерена" },
    { hint: "ORDER_NOT_COD", expected: /само за наложен платеж/ },
    { hint: "ORDER_NOT_CONFIRMED", expected: /потвърдена/ },
    { hint: "ORDER_LOCKED_AFTER_SHIPMENT", expected: /Товарителницата вече е генерирана/ },
    { hint: "ORDER_ITEM_ALREADY_PRESENT", expected: /вече е в поръчката/ },
  ]

  for (const { hint, expected } of cases) {
    it(`translates HINT '${hint}' to Bulgarian`, async () => {
      mockSupabase.rpc = vi.fn(() => Promise.resolve({ data: null, error: { hint, message: "raw db" } })) as never
      const { addOrderItem } = await import("@/app/actions/admin")
      await expect(addOrderItem(VALID_ORDER_ID, "EGO-DC-12", 1)).rejects.toThrow(expected)
    })
  }

  it("falls back to a generic message when HINT is unknown", async () => {
    mockSupabase.rpc = vi.fn(() => Promise.resolve({ data: null, error: { hint: "WHATEVER", message: "?" } })) as never
    const { addOrderItem } = await import("@/app/actions/admin")
    await expect(addOrderItem(VALID_ORDER_ID, "EGO-DC-12", 1)).rejects.toThrow("Грешка при добавяне на артикул")
  })
})

describe("addOrderItem — happy path", () => {
  it("calls add_order_item with resolved price + emits audit with action='added'", async () => {
    // First rpc call → add_order_item returns new total. Second → audit emit.
    mockSupabase.rpc = vi.fn((name: string) => {
      if (name === "add_order_item") return Promise.resolve({ data: 8910, error: null })
      return Promise.resolve({ data: null, error: null })
    }) as never

    const { addOrderItem } = await import("@/app/actions/admin")
    const result = await addOrderItem(VALID_ORDER_ID, "EGO-DC-12", 2)

    expect(result).toEqual({ success: true, newTotalCents: 8910, unitPriceCents: 2570 })

    const calls = (mockSupabase.rpc as ReturnType<typeof vi.fn>).mock.calls
    const addCall = calls.find((c) => c[0] === "add_order_item")
    expect(addCall).toBeDefined()
    expect(addCall![1]).toMatchObject({
      p_order_id: VALID_ORDER_ID,
      p_sku: "EGO-DC-12",
      p_quantity: 2,
      p_unit_price_cents: 2570,
      p_product_name: "Натурален Шоколад",
    })

    const auditCall = calls.find((c) => c[0] === "record_order_outcome")
    expect(auditCall).toBeDefined()
    expect(auditCall![1]).toMatchObject({
      p_outcome_type: "order_items_changed",
      p_payload: expect.objectContaining({
        action: "added",
        sku: "EGO-DC-12",
        product_name: "Натурален Шоколад",
        quantity: 2,
        unit_price_cents: 2570,
        new_total_cents: 8910,
      }),
    })
  })
})

describe("removeOrderItem — input validation", () => {
  it("rejects invalid order ID", async () => {
    const { removeOrderItem } = await import("@/app/actions/admin")
    await expect(removeOrderItem("not-a-uuid", "EGO-DC-12")).rejects.toThrow("Invalid order ID")
  })

  it("rejects empty SKU", async () => {
    const { removeOrderItem } = await import("@/app/actions/admin")
    await expect(removeOrderItem(VALID_ORDER_ID, "")).rejects.toThrow("SKU е задължителен")
  })

  it("rejects reason > 1000 chars", async () => {
    const { removeOrderItem } = await import("@/app/actions/admin")
    await expect(
      removeOrderItem(VALID_ORDER_ID, "EGO-DC-12", "x".repeat(1001)),
    ).rejects.toThrow("Причината е твърде дълга")
  })
})

describe("removeOrderItem — RPC error translation via HINT codes", () => {
  const cases: Array<{ hint: string; expected: string | RegExp }> = [
    { hint: "ORDER_NOT_FOUND", expected: "Поръчката не е намерена" },
    { hint: "ORDER_NOT_COD", expected: /само за наложен платеж/ },
    { hint: "ORDER_NOT_CONFIRMED", expected: /потвърдена/ },
    { hint: "ORDER_LOCKED_AFTER_SHIPMENT", expected: /не може да се премахват/ },
    { hint: "ORDER_ITEM_NOT_FOUND", expected: /не е в поръчката/ },
    { hint: "CANNOT_REMOVE_LAST_ITEM", expected: /последният артикул/ },
  ]

  for (const { hint, expected } of cases) {
    it(`translates HINT '${hint}' to Bulgarian`, async () => {
      // The pre-delete read for the audit shape returns a fake item row;
      // the remove RPC then raises with the hint we want to test.
      mockSupabase.single = vi.fn(() =>
        Promise.resolve({ data: { quantity: 1, product_name: "X", unit_price_cents: 2570 }, error: null }),
      )
      mockSupabase.rpc = vi.fn(() =>
        Promise.resolve({ data: null, error: { hint, message: "raw db" } }),
      ) as never

      const { removeOrderItem } = await import("@/app/actions/admin")
      await expect(removeOrderItem(VALID_ORDER_ID, "EGO-DC-12")).rejects.toThrow(expected)
    })
  }
})

describe("removeOrderItem — happy path", () => {
  function setupHappyPath() {
    // Pre-delete read of the order_items row for audit-shape capture.
    mockSupabase.single = vi.fn(() =>
      Promise.resolve({
        data: { quantity: 3, product_name: "Натурален Шоколад", unit_price_cents: 2570 },
        error: null,
      }),
    )
    // remove_order_item RPC returns the new total.
    mockSupabase.rpc = vi.fn((name: string) => {
      if (name === "remove_order_item") return Promise.resolve({ data: 4500, error: null })
      return Promise.resolve({ data: null, error: null })
    }) as never
  }

  it("emits audit with action='removed' and item shape captured pre-delete", async () => {
    setupHappyPath()
    const { removeOrderItem } = await import("@/app/actions/admin")

    const result = await removeOrderItem(VALID_ORDER_ID, "EGO-DC-12")
    expect(result).toEqual({ success: true, newTotalCents: 4500, removedQuantity: 3 })

    const auditCall = (mockSupabase.rpc as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0] === "record_order_outcome",
    )
    expect(auditCall).toBeDefined()
    expect(auditCall![1]).toMatchObject({
      p_outcome_type: "order_items_changed",
      p_payload: expect.objectContaining({
        action: "removed",
        sku: "EGO-DC-12",
        product_name: "Натурален Шоколад",
        removed_quantity: 3,
        new_total_cents: 4500,
        reason: null,
      }),
    })
  })

  it("appends an admin_note when reason is supplied", async () => {
    setupHappyPath()
    const { removeOrderItem } = await import("@/app/actions/admin")

    await removeOrderItem(VALID_ORDER_ID, "EGO-DC-12", "клиентът се отказа от един артикул")

    const noteCall = (mockSupabase.rpc as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0] === "add_admin_note",
    )
    expect(noteCall).toBeDefined()
    expect(noteCall![1]).toMatchObject({
      p_text: expect.stringContaining("Премахнат артикул: Натурален Шоколад × 3"),
    })
    expect(noteCall![1].p_text).toContain("клиентът се отказа")
  })

  it("does NOT append an admin_note when reason is omitted", async () => {
    setupHappyPath()
    const { removeOrderItem } = await import("@/app/actions/admin")

    await removeOrderItem(VALID_ORDER_ID, "EGO-DC-12")

    const noteCalls = (mockSupabase.rpc as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[0] === "add_admin_note",
    )
    expect(noteCalls).toHaveLength(0)
  })
})
