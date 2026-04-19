// Meta Pixel client helpers. All public helpers gate on `isMetaPixelEnabled()`.
// Event identity (eventID) and dedupe markers are established here so Phase 2
// server-side Conversions API can dedupe with the same keys.

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void
  }
}

let disabled = false

export function setMetaPixelDisabled(value: boolean) {
  disabled = value
}

export function isMetaPixelEnabled(): boolean {
  return typeof window !== "undefined" && !!window.fbq && !disabled
}

function track(
  event: string,
  params?: Record<string, unknown>,
  options?: { eventID?: string },
) {
  if (process.env.NODE_ENV !== "production") {
    console.debug("[meta-pixel]", event, params, options)
  }
  if (!isMetaPixelEnabled()) return
  if (options?.eventID) {
    window.fbq!("track", event, params ?? {}, { eventID: options.eventID })
  } else {
    window.fbq!("track", event, params ?? {})
  }
}

// Shared identifier contract — single source of truth
// - content_ids: product SKU (matches inventory keying)
// - currency: EUR
// - value: total monetary value in EUR (not cents)
// - contents[].item_price: unit price in EUR (not line total)

export interface PixelLineItem {
  sku: string
  quantity: number
  unitPriceCents: number
}

function centsToEur(cents: number): number {
  return Number((cents / 100).toFixed(2))
}

function toContents(items: PixelLineItem[]) {
  return items.map((item) => ({
    id: item.sku,
    quantity: item.quantity,
    item_price: centsToEur(item.unitPriceCents),
  }))
}

function sumValue(items: PixelLineItem[]): number {
  const totalCents = items.reduce(
    (sum, item) => sum + item.unitPriceCents * item.quantity,
    0,
  )
  return centsToEur(totalCents)
}

export function trackViewContent(params: { sku: string; priceInCents: number }) {
  track("ViewContent", {
    content_ids: [params.sku],
    content_type: "product",
    currency: "EUR",
    value: centsToEur(params.priceInCents),
  })
}

export function trackAddToCart(params: {
  sku: string
  priceInCents: number
  quantity: number
}) {
  track("AddToCart", {
    content_ids: [params.sku],
    content_type: "product",
    currency: "EUR",
    value: centsToEur(params.priceInCents * params.quantity),
    contents: [
      {
        id: params.sku,
        quantity: params.quantity,
        item_price: centsToEur(params.priceInCents),
      },
    ],
  })
}

// Canonical cart hash — deterministic input so sessionStorage dedupe is stable.
// Input shape documented here; do not change without updating call sites.
//   items sorted by sku ASC → "sku:qty:unitPriceCents" joined by "|"
// Excludes any presentation-only state (selection, animation, discounts shown at summary).
// Uses djb2 hash — small, stable, no crypto dependency.
export function cartHash(items: PixelLineItem[]): string {
  const canonical = [...items]
    .sort((a, b) => a.sku.localeCompare(b.sku))
    .map((i) => `${i.sku}:${i.quantity}:${i.unitPriceCents}`)
    .join("|")
  let hash = 5381
  for (let i = 0; i < canonical.length; i++) {
    hash = ((hash << 5) + hash + canonical.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(36)
}

const IC_MARKER_PREFIX = "eo-ic-fired:"

export function trackInitiateCheckout(items: PixelLineItem[]) {
  if (typeof window === "undefined") return
  if (items.length === 0) return

  const hash = cartHash(items)
  const markerKey = IC_MARKER_PREFIX + hash
  try {
    if (sessionStorage.getItem(markerKey)) return
    sessionStorage.setItem(markerKey, "1")
  } catch {
    // sessionStorage can throw in privacy modes — proceed without dedupe rather than miss the event
  }

  track("InitiateCheckout", {
    content_ids: items.map((i) => i.sku),
    content_type: "product",
    contents: toContents(items),
    currency: "EUR",
    value: sumValue(items),
    num_items: items.reduce((sum, i) => sum + i.quantity, 0),
  })
}

const PURCHASE_MARKER_PREFIX = "eo-purchase-fired:"

// Retry window for the narrow race where the success-page effect fires
// before the layout's <Script> has injected the fbq shim. 50 × 100ms = 5s.
const PURCHASE_RETRY_ATTEMPTS = 50
const PURCHASE_RETRY_INTERVAL_MS = 100

export function trackPurchase(params: {
  orderId: string
  totalCents: number
  items: PixelLineItem[]
}) {
  if (typeof window === "undefined") return

  const payload = {
    content_ids: params.items.map((i) => i.sku),
    content_type: "product",
    contents: toContents(params.items),
    currency: "EUR",
    value: centsToEur(params.totalCents),
    num_items: params.items.reduce((sum, i) => sum + i.quantity, 0),
  }
  const eventID = "purchase-" + params.orderId
  const markerKey = PURCHASE_MARKER_PREFIX + params.orderId

  // Attempt to fire. Returns true when work is done (fired or already-fired)
  // so the caller can stop retrying. Returns false when fbq isn't ready yet.
  const fire = (): boolean => {
    // Gate the marker write on pixel readiness. If fbq isn't available
    // (consent not granted, disabled flag set, or shim not yet injected),
    // do NOT burn the at-most-once marker on a no-op.
    if (!isMetaPixelEnabled()) return false

    try {
      if (localStorage.getItem(markerKey)) return true
      // DO NOT MOVE — at-most-once by design (plan v3 §5).
      // Writing the marker before fbq means a blocked/failed fbq call will not
      // retry for this order in this browser. The isMetaPixelEnabled() guard
      // above ensures we don't mark on a pure no-op. Phase 2 CAPI provides the
      // authoritative server-side Purchase with the same eventID if the client
      // event is still lost (e.g. connect.facebook.net blocked by adblocker).
      localStorage.setItem(markerKey, "1")
    } catch {
      // localStorage can throw in privacy modes — accept possible duplicate
      // rather than miss the event.
    }

    track("Purchase", payload, { eventID })
    return true
  }

  if (fire()) return

  let attempts = 0
  const interval = setInterval(() => {
    attempts++
    if (fire() || attempts >= PURCHASE_RETRY_ATTEMPTS) {
      clearInterval(interval)
    }
  }, PURCHASE_RETRY_INTERVAL_MS)
}
