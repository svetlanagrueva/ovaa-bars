import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import {
  cartHash,
  isMetaPixelEnabled,
  setMetaPixelDisabled,
  trackAddToCart,
  trackInitiateCheckout,
  trackPurchase,
  trackViewContent,
} from "@/lib/meta-pixel"

describe("cartHash", () => {
  it("is stable regardless of item order", () => {
    const a = cartHash([
      { sku: "EGO-DC-12", quantity: 1, unitPriceCents: 2570 },
      { sku: "EGO-WCR-12", quantity: 2, unitPriceCents: 2570 },
    ])
    const b = cartHash([
      { sku: "EGO-WCR-12", quantity: 2, unitPriceCents: 2570 },
      { sku: "EGO-DC-12", quantity: 1, unitPriceCents: 2570 },
    ])
    expect(a).toBe(b)
  })

  it("changes when quantity changes", () => {
    const a = cartHash([{ sku: "EGO-DC-12", quantity: 1, unitPriceCents: 2570 }])
    const b = cartHash([{ sku: "EGO-DC-12", quantity: 2, unitPriceCents: 2570 }])
    expect(a).not.toBe(b)
  })

  it("changes when unit price changes", () => {
    const a = cartHash([{ sku: "EGO-DC-12", quantity: 1, unitPriceCents: 2570 }])
    const b = cartHash([{ sku: "EGO-DC-12", quantity: 1, unitPriceCents: 2400 }])
    expect(a).not.toBe(b)
  })

  it("changes when sku set changes", () => {
    const a = cartHash([{ sku: "EGO-DC-12", quantity: 1, unitPriceCents: 2570 }])
    const b = cartHash([{ sku: "EGO-WCR-12", quantity: 1, unitPriceCents: 2570 }])
    expect(a).not.toBe(b)
  })

  it("returns a non-empty string for empty input", () => {
    expect(cartHash([])).toBeTypeOf("string")
  })
})

describe("meta-pixel event helpers (disabled)", () => {
  const fbq = vi.fn()

  beforeEach(() => {
    fbq.mockClear()
    sessionStorage.clear()
    localStorage.clear()
    ;(window as unknown as { fbq?: typeof fbq }).fbq = fbq
    setMetaPixelDisabled(true)
  })

  afterEach(() => {
    delete (window as unknown as { fbq?: typeof fbq }).fbq
    setMetaPixelDisabled(false)
  })

  it("isMetaPixelEnabled is false when disabled flag is set", () => {
    expect(isMetaPixelEnabled()).toBe(false)
  })

  it("no helper calls fbq when disabled", () => {
    trackViewContent({ sku: "EGO-DC-12", priceInCents: 2570 })
    trackAddToCart({ sku: "EGO-DC-12", priceInCents: 2570, quantity: 1 })
    trackInitiateCheckout([
      { sku: "EGO-DC-12", quantity: 1, unitPriceCents: 2570 },
    ])
    trackPurchase({
      orderId: "00000000-0000-0000-0000-000000000001",
      totalCents: 2570,
      items: [{ sku: "EGO-DC-12", quantity: 1, unitPriceCents: 2570 }],
    })
    expect(fbq).not.toHaveBeenCalled()
  })
})

describe("meta-pixel event helpers (enabled)", () => {
  const fbq = vi.fn()

  beforeEach(() => {
    fbq.mockClear()
    sessionStorage.clear()
    localStorage.clear()
    ;(window as unknown as { fbq?: typeof fbq }).fbq = fbq
    setMetaPixelDisabled(false)
  })

  afterEach(() => {
    delete (window as unknown as { fbq?: typeof fbq }).fbq
  })

  it("no helper calls fbq when window.fbq is missing", () => {
    delete (window as unknown as { fbq?: typeof fbq }).fbq
    trackAddToCart({ sku: "EGO-DC-12", priceInCents: 2570, quantity: 1 })
    expect(fbq).not.toHaveBeenCalled()
  })

  it("ViewContent payload shape", () => {
    trackViewContent({ sku: "EGO-DC-12", priceInCents: 2570 })
    expect(fbq).toHaveBeenCalledWith("track", "ViewContent", {
      content_ids: ["EGO-DC-12"],
      content_type: "product",
      currency: "EUR",
      value: 25.7,
    })
  })

  it("AddToCart payload shape — value is line total, item_price is unit", () => {
    trackAddToCart({ sku: "EGO-DC-12", priceInCents: 2570, quantity: 2 })
    expect(fbq).toHaveBeenCalledWith("track", "AddToCart", {
      content_ids: ["EGO-DC-12"],
      content_type: "product",
      currency: "EUR",
      value: 51.4,
      contents: [{ id: "EGO-DC-12", quantity: 2, item_price: 25.7 }],
    })
  })

  it("InitiateCheckout fires once per distinct cart hash (session)", () => {
    const items = [{ sku: "EGO-DC-12", quantity: 1, unitPriceCents: 2570 }]
    trackInitiateCheckout(items)
    trackInitiateCheckout(items)
    expect(fbq).toHaveBeenCalledTimes(1)
  })

  it("InitiateCheckout re-fires when cart contents change", () => {
    trackInitiateCheckout([{ sku: "EGO-DC-12", quantity: 1, unitPriceCents: 2570 }])
    trackInitiateCheckout([{ sku: "EGO-DC-12", quantity: 2, unitPriceCents: 2570 }])
    expect(fbq).toHaveBeenCalledTimes(2)
  })

  it("InitiateCheckout is a no-op on empty cart", () => {
    trackInitiateCheckout([])
    expect(fbq).not.toHaveBeenCalled()
  })

  it("Purchase passes eventID for dedupe with CAPI", () => {
    trackPurchase({
      orderId: "00000000-0000-0000-0000-000000000001",
      totalCents: 2570,
      items: [{ sku: "EGO-DC-12", quantity: 1, unitPriceCents: 2570 }],
    })
    expect(fbq).toHaveBeenCalledWith(
      "track",
      "Purchase",
      expect.objectContaining({
        content_ids: ["EGO-DC-12"],
        currency: "EUR",
        value: 25.7,
        num_items: 1,
      }),
      { eventID: "purchase-00000000-0000-0000-0000-000000000001" },
    )
  })

  it("Purchase deduplicates by orderId via localStorage", () => {
    const params = {
      orderId: "00000000-0000-0000-0000-000000000001",
      totalCents: 2570,
      items: [{ sku: "EGO-DC-12", quantity: 1, unitPriceCents: 2570 }],
    }
    trackPurchase(params)
    trackPurchase(params)
    expect(fbq).toHaveBeenCalledTimes(1)
  })

  it("Purchase marker is written before fbq (at-most-once)", () => {
    const orderId = "00000000-0000-0000-0000-000000000001"
    fbq.mockImplementationOnce(() => {
      // localStorage marker must already exist by the time fbq is called
      expect(localStorage.getItem("eo-purchase-fired:" + orderId)).toBe("1")
    })
    trackPurchase({
      orderId,
      totalCents: 2570,
      items: [{ sku: "EGO-DC-12", quantity: 1, unitPriceCents: 2570 }],
    })
    expect(fbq).toHaveBeenCalledTimes(1)
  })
})

describe("trackPurchase — fbq-not-ready race handling", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    sessionStorage.clear()
    localStorage.clear()
    delete (window as unknown as { fbq?: unknown }).fbq
    setMetaPixelDisabled(false)
  })

  afterEach(() => {
    vi.useRealTimers()
    delete (window as unknown as { fbq?: unknown }).fbq
  })

  it("does NOT write the marker when fbq is missing (preserves retry)", () => {
    const orderId = "00000000-0000-0000-0000-000000000002"
    trackPurchase({
      orderId,
      totalCents: 2570,
      items: [{ sku: "EGO-DC-12", quantity: 1, unitPriceCents: 2570 }],
    })
    // Purely a no-op: no marker, no fbq call. A future retry can still fire.
    expect(localStorage.getItem("eo-purchase-fired:" + orderId)).toBeNull()
  })

  it("retries and fires once fbq becomes available", () => {
    const orderId = "00000000-0000-0000-0000-000000000003"
    trackPurchase({
      orderId,
      totalCents: 2570,
      items: [{ sku: "EGO-DC-12", quantity: 1, unitPriceCents: 2570 }],
    })

    // Simulate the layout's <Script> injecting the fbq shim mid-flight.
    const fbq = vi.fn()
    ;(window as unknown as { fbq?: typeof fbq }).fbq = fbq

    // Advance past one poll tick (100ms).
    vi.advanceTimersByTime(200)

    expect(fbq).toHaveBeenCalledWith(
      "track",
      "Purchase",
      expect.objectContaining({ value: 25.7 }),
      { eventID: "purchase-" + orderId },
    )
    expect(localStorage.getItem("eo-purchase-fired:" + orderId)).toBe("1")
  })

  it("gives up after the retry window without writing the marker", () => {
    const orderId = "00000000-0000-0000-0000-000000000004"
    trackPurchase({
      orderId,
      totalCents: 2570,
      items: [{ sku: "EGO-DC-12", quantity: 1, unitPriceCents: 2570 }],
    })

    // 50 × 100ms + buffer = past the retry window.
    vi.advanceTimersByTime(10_000)

    // Nothing fired; no marker burned — Phase 2 CAPI is the authority.
    expect(localStorage.getItem("eo-purchase-fired:" + orderId)).toBeNull()
  })
})
