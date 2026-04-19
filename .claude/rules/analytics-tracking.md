# Analytics & Tracking

## Cookie consent — three categories
Defined in `components/cookie-consent.tsx`. `CookiePreferences` shape:
- `essential: true` — always-on, non-toggleable (cart in localStorage, the consent key itself)
- `analytics: boolean` — Vercel Analytics + Google Analytics
- `marketing: boolean` — Meta Pixel

**Separate categories are deliberate** — GDPR best practice. Do not bundle marketing under analytics.

Stored JSON-only in `localStorage` under `egg-origin-cookie-consent`. `getCookiePreferences()` returns `null` for missing/malformed input and coerces truthy values to booleans. There is no legacy-string migration — site went live with the JSON shape.

### Consent change events
`savePreferences()` dispatches `window.dispatchEvent(new Event("cookie-consent-change"))`. Tracking components listen to BOTH:
- `storage` — cross-tab sync (`localStorage` change from another tab)
- `cookie-consent-change` — same-tab sync (custom event)

Any new tracking integration must gate on `hasCategoryConsent(category)` and listen to both events so it responds to opt-in/opt-out mid-session.

The floating Cookie icon (bottom-left, `fixed bottom-16 left-4`) reopens the banner after initial choice — keep it available on every page that mounts `<CookieConsentBanner />`.

## Google Analytics + Vercel Analytics (`components/analytics.tsx`)
- Uses `@next/third-parties/google` (`GoogleAnalytics` component) + `@vercel/analytics/next` (`Analytics` component) — first-party Next.js integrations, no manual script tag
- `ConditionalAnalytics` renders nothing until `hasCategoryConsent("analytics")` is true, then mounts both
- GA id from `NEXT_PUBLIC_GA_MEASUREMENT_ID`; rendered only when set
- Vercel Analytics does not use cross-site tracking cookies (documented in `/privacy#cookies`)
- No manual event tracking in app code — everything is automatic pageviews via the `<GoogleAnalytics>` integration

## Meta Pixel (`components/meta-pixel.tsx` + `lib/meta-pixel.ts`)

### Component
- Manual `next/script` injection (`strategy="afterInteractive"`) — no `@next/third-parties` integration exists for Meta
- Gated on `hasCategoryConsent("marketing")` — same listener pattern as `ConditionalAnalytics`
- Pixel id validated with `/^\d{5,20}$/`; renders nothing on empty or malformed value
- **No `<noscript>` fallback** — bypasses client-side consent model, deliberately omitted
- **No bootstrap PageView** — loader calls `fbq('init', id)` only. A single `usePathname` effect is the sole PageView source. This avoids double-fire on first load.
- Pathname-only PageView keying is intentional — query-string changes (filters, UTM, variants) do not refire PageView. Comment in component documents this.
- **Revisit when any of these ship**: collection pages with filter/sort in the URL (`/products?filter=...`), pagination via query param, product variants encoded in query, or any campaign-landing pages where UTM-only changes should count as a new view. Change the effect dep from `pathname` to `pathname + searchParams` and update the last-fired-path ref to track the full key.
- Mounted in `app/(shop)/layout.tsx` alongside `<ConditionalAnalytics />`. `(shop)` is the intentional tracking boundary; admin is outside.

### Consent lifecycle
- Opt-in mid-session → component renders, `<Script>` mounts, init runs, pathname effect fires PageView for current route
- Opt-out mid-session → component unmounts, `setMetaPixelDisabled(true)` flips module flag, all event helpers no-op. Meta globals are NOT torn down — documented as "stops future events in this session" (best-effort)

### Helpers (`lib/meta-pixel.ts`)
All public helpers gate on `isMetaPixelEnabled()`:
```ts
typeof window !== "undefined" && !!window.fbq && !disabled
```
Single source of truth — do not duplicate flag checks at call sites.

Dev debug wrapper: `track()` logs via `console.debug("[meta-pixel]", ...)` in non-production; silent in production.

### Shared identifier contract (do not drift across events)
- `content_ids`: product `sku` (matches inventory keying, stable across carts/orders)
- `content_type: "product"`
- `currency: "EUR"`
- `value`: **total monetary value in EUR**, `Number((cents / 100).toFixed(2))` — NOT cents
- `contents[].item_price`: **unit price in EUR** (NOT line total)

### Event surface
| Event | Where | Dedupe |
|---|---|---|
| `ViewContent` | `components/products/product-detail.tsx` effect keyed on `product.sku` | None — React effect dedupes by dep |
| `AddToCart` | `components/products/product-card.tsx` and `product-detail.tsx` **UI click handlers** (NOT `lib/store/cart.ts`) | None |
| `InitiateCheckout` | `app/(shop)/checkout/page.tsx` mount effect | Canonical cart hash + `sessionStorage` marker `eo-ic-fired:<hash>` |
| `Purchase` | `app/(shop)/checkout/success/page.tsx` after `confirmOrder()` resolves | `eventID = "purchase-" + orderId` + `localStorage` marker `eo-purchase-fired:<orderId>` |

### AddToCart placement — do not move into the cart store
Zustand `persist` rehydrates through `addItem` on mount and `cart-price-sync` can re-enter the store action. Event must stay at the UI button `onClick` to guarantee it reflects a real user action, not hydration/replay.

### Canonical cart hash (`cartHash()` in `lib/meta-pixel.ts`)
Deterministic input — do not drift without updating every call site:
- Items sorted by `sku` ASC
- Each item formatted as `"sku:quantity:unitPriceCents"`, joined with `|`
- Hashed with djb2, base36 stringified
- Excludes any presentation-only state

Changes to the hash input invalidate existing sessionStorage markers and can cause either missed or duplicate `InitiateCheckout` events.

### Purchase — at-most-once by design with bounded retry
`trackPurchase()` writes the `localStorage` marker **before** calling `fbq`, but only after gating on `isMetaPixelEnabled()`. This prevents burning the at-most-once marker on a no-op (e.g., fbq shim not yet injected, disabled flag set). If fbq isn't ready, the helper polls every 100ms for up to 5 seconds — this handles the narrow race where the success-page effect runs before the layout's `<Script>` has injected the shim. After the retry window, the event is dropped for this browser. Phase 2 CAPI provides the authoritative server-side `Purchase` with the same `eventID` for adblocker / permanent-drop cases.

The `DO NOT MOVE` comment on the `localStorage.setItem` call enforces the marker-before-send ordering. Never move it below the `track()` call — that would make the semantics at-least-once and allow duplicates on transient errors.

### `confirmOrder` return shape
Extended to return `{ status, totalCents, items }` so the success page can populate Purchase with currency/value/contents. `items` is an `OrderTrackingItem[]` with `sku` (resolved from static `PRODUCTS` list via `productId`), `quantity`, `priceInCents`. SKU is NOT stored on the `orders.items` JSONB — resolving from `PRODUCTS` keeps the schema stable.

## Phase 2 — Conversions API (not implemented)
- Server-side `Purchase` from Stripe webhook + `createCODOrder`
- Must use same `eventID = "purchase-" + orderId` as client-side pixel for dedupe
- Requires `META_CAPI_ACCESS_TOKEN` env var
- Advanced Matching (hashed email/phone in `fbq('init', id, userData)`) is deferred to the same phase

## Testing
Unit tests in `tests/cookie-consent.test.ts` and `tests/meta-pixel.test.ts`:
- Parser edge cases: missing keys, malformed JSON, non-object JSON, null, truthy coercion
- `isMetaPixelEnabled()` gates: no-op when `window.fbq` missing or disabled flag set
- Event payload shapes, value/item_price EUR semantics
- Cart hash stability (order-independent), changes on quantity/price/sku edits
- Purchase `eventID` format + localStorage marker written pre-send
- `InitiateCheckout` dedupe per hash, empty-cart no-op

Manual verification via Facebook Pixel Helper + Events Manager Test Events — not automated.

## Scope boundary
`(shop)` layout is the pixel mount point. Admin (`app/admin/*`) is outside — no tracking in admin. If marketing landing pages are added outside `(shop)`, the pixel component must be moved up to `app/layout.tsx`.