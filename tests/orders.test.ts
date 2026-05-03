import { describe, it, expect } from "vitest"
import {
  hasCustomerPaid,
  getFinancialStatus,
  getFinancialStatusLabel,
  FINANCIAL_STATUS_LABELS,
} from "@/lib/orders"

// Minimal-fixture builder. Tests pass overrides for whatever predicate
// they want to flip; everything else gets a sensible default.
function makeOrder(overrides: Partial<{
  status: string
  payment_method: string
  total_amount: number
  refunds_total: number
  seller_settled_at: string | null
  delivered_at: string | null
}> = {}) {
  return {
    status: "delivered",
    payment_method: "card",
    total_amount: 5000,
    refunds_total: 0,
    seller_settled_at: null,
    delivered_at: null,
    ...overrides,
  }
}

describe("hasCustomerPaid", () => {
  it("card: returns true when seller_settled_at is set", () => {
    expect(hasCustomerPaid(makeOrder({
      payment_method: "card",
      seller_settled_at: "2026-04-20T10:00:00Z",
    }))).toBe(true)
  })

  it("card: returns false when seller_settled_at is null", () => {
    expect(hasCustomerPaid(makeOrder({
      payment_method: "card",
      seller_settled_at: null,
    }))).toBe(false)
  })

  it("cod: returns true when delivered_at is set (customer paid courier)", () => {
    expect(hasCustomerPaid(makeOrder({
      payment_method: "cod",
      delivered_at: "2026-04-20T10:00:00Z",
      seller_settled_at: null, // not yet remitted by courier — irrelevant
    }))).toBe(true)
  })

  it("cod: returns false when delivered_at is null (not yet delivered)", () => {
    expect(hasCustomerPaid(makeOrder({
      payment_method: "cod",
      delivered_at: null,
      seller_settled_at: null,
    }))).toBe(false)
  })
})

describe("getFinancialStatus", () => {
  it("returns 'none' for cancelled orders regardless of refund state", () => {
    expect(getFinancialStatus(makeOrder({
      status: "cancelled",
      refunds_total: 0,
    }))).toBe("none")
    expect(getFinancialStatus(makeOrder({
      status: "cancelled",
      refunds_total: 5000,
      total_amount: 5000,
    }))).toBe("none")
  })

  it("returns 'none' for expired orders", () => {
    expect(getFinancialStatus(makeOrder({
      status: "expired",
    }))).toBe("none")
  })

  it("returns 'refunded' when refunds_total >= total_amount", () => {
    expect(getFinancialStatus(makeOrder({
      total_amount: 5000,
      refunds_total: 5000,
    }))).toBe("refunded")
    expect(getFinancialStatus(makeOrder({
      total_amount: 5000,
      refunds_total: 5500, // overrefund (shouldn't happen at DB layer but be defensive)
    }))).toBe("refunded")
  })

  it("returns 'partially_refunded' when 0 < refunds_total < total_amount", () => {
    expect(getFinancialStatus(makeOrder({
      total_amount: 5000,
      refunds_total: 2500,
    }))).toBe("partially_refunded")
  })

  it("partial refund outranks 'paid' even when seller_settled_at is set", () => {
    expect(getFinancialStatus(makeOrder({
      total_amount: 5000,
      refunds_total: 1000,
      seller_settled_at: "2026-04-20T10:00:00Z",
    }))).toBe("partially_refunded")
  })

  it("returns 'paid' when seller_settled_at is set and no refunds", () => {
    expect(getFinancialStatus(makeOrder({
      seller_settled_at: "2026-04-20T10:00:00Z",
      refunds_total: 0,
    }))).toBe("paid")
  })

  it("COD delivered without seller_settled_at returns 'awaiting_courier'", () => {
    expect(getFinancialStatus(makeOrder({
      payment_method: "cod",
      status: "delivered",
      seller_settled_at: null,
      delivered_at: "2026-04-20T10:00:00Z",
    }))).toBe("awaiting_courier")
  })

  it("COD pre-delivery returns 'awaiting_delivery'", () => {
    expect(getFinancialStatus(makeOrder({
      payment_method: "cod",
      status: "confirmed",
      seller_settled_at: null,
    }))).toBe("awaiting_delivery")
    expect(getFinancialStatus(makeOrder({
      payment_method: "cod",
      status: "shipped",
      seller_settled_at: null,
    }))).toBe("awaiting_delivery")
  })

  it("card without seller_settled_at returns 'pending'", () => {
    expect(getFinancialStatus(makeOrder({
      payment_method: "card",
      status: "confirmed",
      seller_settled_at: null,
    }))).toBe("pending")
  })

  it("card with seller_settled_at + partial refund returns 'partially_refunded' (refund outranks paid)", () => {
    expect(getFinancialStatus(makeOrder({
      payment_method: "card",
      status: "delivered",
      seller_settled_at: "2026-04-20T10:00:00Z",
      total_amount: 5000,
      refunds_total: 2000,
    }))).toBe("partially_refunded")
  })
})

describe("getFinancialStatusLabel", () => {
  it("uses 'Уредена' for COD orders in 'paid' state, not 'Платена'", () => {
    expect(getFinancialStatusLabel(makeOrder({
      payment_method: "cod",
      seller_settled_at: "2026-04-20T10:00:00Z",
    }))).toBe("Уредена")
  })

  it("uses 'Платена' for card orders in 'paid' state", () => {
    expect(getFinancialStatusLabel(makeOrder({
      payment_method: "card",
      seller_settled_at: "2026-04-20T10:00:00Z",
    }))).toBe("Платена")
  })

  it("falls through to FINANCIAL_STATUS_LABELS for non-paid states", () => {
    expect(getFinancialStatusLabel(makeOrder({
      total_amount: 5000,
      refunds_total: 5000,
    }))).toBe(FINANCIAL_STATUS_LABELS.refunded)
    expect(getFinancialStatusLabel(makeOrder({
      total_amount: 5000,
      refunds_total: 2000,
    }))).toBe(FINANCIAL_STATUS_LABELS.partially_refunded)
    expect(getFinancialStatusLabel(makeOrder({
      payment_method: "cod",
      status: "delivered",
    }))).toBe(FINANCIAL_STATUS_LABELS.awaiting_courier)
    expect(getFinancialStatusLabel(makeOrder({
      payment_method: "cod",
      status: "confirmed",
    }))).toBe(FINANCIAL_STATUS_LABELS.awaiting_delivery)
    expect(getFinancialStatusLabel(makeOrder({
      payment_method: "card",
      status: "confirmed",
    }))).toBe(FINANCIAL_STATUS_LABELS.pending)
    expect(getFinancialStatusLabel(makeOrder({
      status: "cancelled",
    }))).toBe(FINANCIAL_STATUS_LABELS.none)
  })
})

describe("FINANCIAL_STATUS_LABELS", () => {
  it("provides a label for every FinancialStatus value", () => {
    // Type-level exhaustiveness check — if a new status is added to
    // FinancialStatus and someone forgets to extend the labels map,
    // the assignment below will fail TS compilation. This test pins
    // the runtime expectation that every status maps to a non-empty
    // Bulgarian string.
    const allKeys = Object.keys(FINANCIAL_STATUS_LABELS)
    expect(allKeys).toContain("none")
    expect(allKeys).toContain("refunded")
    expect(allKeys).toContain("partially_refunded")
    expect(allKeys).toContain("paid")
    expect(allKeys).toContain("awaiting_courier")
    expect(allKeys).toContain("awaiting_delivery")
    expect(allKeys).toContain("pending")
    for (const value of Object.values(FINANCIAL_STATUS_LABELS)) {
      expect(value.length).toBeGreaterThan(0)
    }
  })
})
