import { describe, it, expect } from "vitest"
import {
  computeRefundBreakdown,
  formatBreakdownForCreditNote,
  splitVatInclusive,
  VAT_RATE_PERCENT,
} from "@/lib/refund-breakdown"

describe("refund-breakdown", () => {
  const darkChoc = { sku: "EGO-DC-12", productName: "Dark Chocolate Box", unitPriceCents: 500 }
  const whiteChoc = { sku: "EGO-WCR-12", productName: "White Choc Raspberry", unitPriceCents: 550 }

  describe("splitVatInclusive (20% VAT-inclusive math)", () => {
    it("sanity-check: VAT rate constant is 20", () => {
      expect(VAT_RATE_PERCENT).toBe(20)
    })

    it("splits 600 cents into 100 VAT + 500 net", () => {
      // 600 * 20 / 120 = 100 exactly
      expect(splitVatInclusive(600)).toEqual({ vatCents: 100, netCents: 500 })
    })

    it("splits 500 cents with rounding preserving sum", () => {
      // 500 * 20 / 120 = 83.333… → rounds to 83, net = 417
      const { vatCents, netCents } = splitVatInclusive(500)
      expect(vatCents).toBe(83)
      expect(netCents).toBe(417)
      expect(vatCents + netCents).toBe(500)
    })

    it("splits 100 cents into 17 + 83", () => {
      // 100 * 20 / 120 = 16.667 → rounds to 17
      const { vatCents, netCents } = splitVatInclusive(100)
      expect(vatCents).toBe(17)
      expect(netCents).toBe(83)
      expect(vatCents + netCents).toBe(100)
    })

    it("handles zero gracefully", () => {
      expect(splitVatInclusive(0)).toEqual({ vatCents: 0, netCents: 0 })
    })

    it("handles non-finite input defensively", () => {
      expect(splitVatInclusive(NaN)).toEqual({ vatCents: 0, netCents: 0 })
      expect(splitVatInclusive(Infinity)).toEqual({ vatCents: 0, netCents: 0 })
    })

    it("guarantees net + vat === gross for a range of values", () => {
      for (let gross = 1; gross <= 10000; gross += 7) {
        const { vatCents, netCents } = splitVatInclusive(gross)
        expect(vatCents + netCents).toBe(gross)
      }
    })
  })

  describe("computeRefundBreakdown", () => {
    it("computes a single-line breakdown when 1 unit returned at exact unit price", () => {
      const result = computeRefundBreakdown(
        500, // refund = 5.00 EUR (= 1 × dark choc)
        [{ sku: "EGO-DC-12", quantity: 1, type: "return_in" }],
        [darkChoc],
      )
      expect(result.lines).toHaveLength(1)
      expect(result.lines[0]).toMatchObject({
        sku: "EGO-DC-12",
        productName: "Dark Chocolate Box",
        quantity: 1,
        type: "return_in",
        lineGrossCents: 500,
        lineVatCents: 83,
        lineNetCents: 417,
      })
      expect(result.linesGrossCents).toBe(500)
      expect(result.refundGrossCents).toBe(500)
      expect(result.matchesLineSum).toBe(true)
    })

    it("aggregates multi-line returns across different SKUs", () => {
      const result = computeRefundBreakdown(
        1050,
        [
          { sku: "EGO-DC-12", quantity: 1, type: "return_in" },
          { sku: "EGO-WCR-12", quantity: 1, type: "return_in" },
        ],
        [darkChoc, whiteChoc],
      )
      expect(result.lines).toHaveLength(2)
      expect(result.linesGrossCents).toBe(500 + 550)
      // 500→{83,417}, 550→Math.round(550*20/120)=Math.round(91.667)=92, net=458
      expect(result.linesVatCents).toBe(83 + 92)
      expect(result.linesNetCents).toBe(1050 - (83 + 92))
      expect(result.matchesLineSum).toBe(true)
    })

    it("flags mismatch when refund amount differs from returned-lines sum", () => {
      const result = computeRefundBreakdown(
        400, // admin refunded 4.00 but customer returned 1 × 5.00 (handling fee deducted)
        [{ sku: "EGO-DC-12", quantity: 1, type: "return_in" }],
        [darkChoc],
      )
      expect(result.linesGrossCents).toBe(500)
      expect(result.refundGrossCents).toBe(400)
      expect(result.matchesLineSum).toBe(false)
    })

    it("returns empty lines when no inventory returns (goodwill refund)", () => {
      const result = computeRefundBreakdown(1000, [], [darkChoc, whiteChoc])
      expect(result.lines).toHaveLength(0)
      expect(result.linesGrossCents).toBe(0)
      expect(result.matchesLineSum).toBe(false)
      expect(result.refundGrossCents).toBe(1000)
      expect(result.refundVatCents + result.refundNetCents).toBe(1000)
    })

    it("skips returns for SKUs not in the order (defensive)", () => {
      const result = computeRefundBreakdown(
        500,
        [{ sku: "EGO-UNKNOWN", quantity: 1, type: "return_in" }],
        [darkChoc],
      )
      expect(result.lines).toHaveLength(0)
    })

    it("handles damaged disposition (type flows through)", () => {
      const result = computeRefundBreakdown(
        500,
        [{ sku: "EGO-DC-12", quantity: 1, type: "damaged" }],
        [darkChoc],
      )
      expect(result.lines[0].type).toBe("damaged")
    })

    // ── refund_items precedence ────────────────────────────────────────
    it("uses refund_items when provided, ignoring inventory_returns", () => {
      const result = computeRefundBreakdown(
        500,
        // Inventory returns claim 2 units at 10.00 — should be IGNORED
        [{ sku: "EGO-DC-12", quantity: 2, type: "return_in" }],
        [{ ...darkChoc, id: 42 }],
        // refund_items: 1 unit at 5.00 — takes precedence
        [{ orderItemId: 42, quantity: 1, amountCents: 500 }],
      )
      expect(result.source).toBe("refund_items")
      expect(result.lines).toHaveLength(1)
      expect(result.lines[0]).toMatchObject({
        sku: "EGO-DC-12",
        quantity: 1,
        type: "allocated",
        lineGrossCents: 500,
      })
    })

    it("falls back to inventory_returns when refund_items is empty", () => {
      const result = computeRefundBreakdown(
        500,
        [{ sku: "EGO-DC-12", quantity: 1, type: "return_in" }],
        [darkChoc],
        [],
      )
      expect(result.source).toBe("inventory_returns")
      expect(result.lines).toHaveLength(1)
    })

    it("source='none' when neither refund_items nor inventory_returns", () => {
      const result = computeRefundBreakdown(500, [], [darkChoc])
      expect(result.source).toBe("none")
      expect(result.lines).toHaveLength(0)
    })

    it("respects per-line amount override in refund_items (diminished value)", () => {
      // Customer returned 1 unit but admin refunded only 4.00 (handling fee)
      // — the override flows through as the line gross.
      const result = computeRefundBreakdown(
        400,
        [],
        [{ ...darkChoc, id: 42 }],
        [{ orderItemId: 42, quantity: 1, amountCents: 400 }],
      )
      expect(result.lines[0].lineGrossCents).toBe(400)
      expect(result.matchesLineSum).toBe(true)
    })

    it("skips refund_items rows with no matching orderItem (defensive)", () => {
      const result = computeRefundBreakdown(
        500,
        [],
        [{ ...darkChoc, id: 42 }],
        [{ orderItemId: 999, quantity: 1, amountCents: 500 }],
      )
      // No matching orderItem → no lines, but source still records the
      // intent ("refund_items"); fallback to inventory_returns kicks in only
      // when refundItems was explicitly empty.
      expect(result.lines).toHaveLength(0)
    })
  })

  describe("formatBreakdownForCreditNote", () => {
    const ctx = {
      orderId: "abc12345-0000-0000-0000-000000000000",
      refundedAt: "2026-04-23T12:00:00.000Z",
      method: "bank_transfer" as const,
    }

    it("includes order short id and method label", () => {
      const bd = computeRefundBreakdown(500, [{ sku: "EGO-DC-12", quantity: 1, type: "return_in" }], [darkChoc])
      const text = formatBreakdownForCreditNote(bd, ctx)
      expect(text).toContain("abc12345")
      expect(text).toContain("Банков превод")
      expect(text).toContain("Dark Chocolate Box")
      expect(text).toContain("5.00 лв")
      expect(text).toContain("0.83 лв") // VAT
      expect(text).toContain("4.17 лв") // net
    })

    it("labels Stripe method correctly", () => {
      const bd = computeRefundBreakdown(500, [], [darkChoc])
      const text = formatBreakdownForCreditNote(bd, { ...ctx, method: "stripe" })
      expect(text).toContain("Stripe")
    })

    it("marks damaged lines with [негоден/брак]", () => {
      const bd = computeRefundBreakdown(500, [{ sku: "EGO-DC-12", quantity: 1, type: "damaged" }], [darkChoc])
      const text = formatBreakdownForCreditNote(bd, ctx)
      expect(text).toContain("[негоден/брак]")
    })

    it("emits mismatch note when refund differs from line sum", () => {
      const bd = computeRefundBreakdown(400, [{ sku: "EGO-DC-12", quantity: 1, type: "return_in" }], [darkChoc])
      const text = formatBreakdownForCreditNote(bd, ctx)
      expect(text).toMatch(/различава/)
    })

    it("emits no-returns note when inventory returns list is empty", () => {
      const bd = computeRefundBreakdown(1000, [], [darkChoc])
      const text = formatBreakdownForCreditNote(bd, ctx)
      expect(text).toMatch(/без връщане на стока/)
    })

    it("does not emit mismatch note when refund matches line sum exactly", () => {
      const bd = computeRefundBreakdown(500, [{ sku: "EGO-DC-12", quantity: 1, type: "return_in" }], [darkChoc])
      const text = formatBreakdownForCreditNote(bd, ctx)
      expect(text).not.toMatch(/различава/)
      expect(text).not.toMatch(/без връщане/)
    })
  })
})
