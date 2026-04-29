// Refund breakdown helper for Bulgarian credit notes (кредитно известие).
//
// VAT model: all Egg Origin prices are VAT-inclusive at 20% (standard rate).
// `order_items.unit_price_cents` is the gross (VAT-included) price the
// customer paid, so line math is:
//
//   gross = qty * unit_price_cents
//   vat   = round(gross * 20 / 120)
//   net   = gross - vat     (so net + vat == gross exactly)
//
// VAT is assumed 20% everywhere. No multi-rate support; if the catalog
// grows to include reduced-rate products, promote this to a per-line
// vat_rate column in order_items and thread through.
//
// This utility is a *display* helper — it does not mutate DB state.
// Admin copies the formatted text into Microinvest when issuing a
// кредитно известие.

export const VAT_RATE_PERCENT = 20

export interface BreakdownOrderItem {
  // order_items.id — used by refund_items linkage. Optional because legacy
  // callers (no items mode) only have SKU.
  id?: number
  sku: string
  productName: string
  unitPriceCents: number
}

export interface BreakdownInventoryReturn {
  sku: string
  quantity: number
  type: "return_in" | "damaged"
}

// Explicit per-line refund allocation — when refund_items rows exist for a
// refund, they take precedence over inventory_returns as the source of the
// breakdown. Each row is a single (order_item_id, qty, amount) allocation.
export interface BreakdownRefundItem {
  orderItemId: number
  quantity: number
  amountCents: number
}

export type BreakdownLineSource = "refund_items" | "inventory_returns"

export interface BreakdownLine {
  sku: string
  productName: string
  quantity: number
  // type is informational; for refund_items source it's not meaningful (the
  // disposition is tracked separately in inventory_log). For inventory_returns
  // source it's the disposition from that row.
  type: "return_in" | "damaged" | "allocated"
  unitPriceCents: number
  lineGrossCents: number
  lineVatCents: number
  lineNetCents: number
}

export interface RefundBreakdown {
  lines: BreakdownLine[]
  linesGrossCents: number   // sum of line gross (from physical returns OR refund_items)
  linesVatCents: number
  linesNetCents: number
  refundGrossCents: number  // actual refund.amount_cents
  refundVatCents: number
  refundNetCents: number
  matchesLineSum: boolean   // linesGrossCents === refundGrossCents
  // Which source produced the lines — drives wording in the formatted text
  // and lets the UI label the breakdown precisely. "none" when no allocation
  // is available (lines is empty).
  source: BreakdownLineSource | "none"
}

// Compute VAT-inclusive split on a gross amount. Round half-to-even via
// Math.round (JS default banker's rounding isn't used; Math.round is
// round-half-away-from-zero). For fraction-of-a-cent cases both sides
// of net/vat adjust so net + vat == gross exactly.
export function splitVatInclusive(grossCents: number): { vatCents: number; netCents: number } {
  if (!Number.isFinite(grossCents)) return { vatCents: 0, netCents: 0 }
  const vatCents = Math.round((grossCents * VAT_RATE_PERCENT) / (100 + VAT_RATE_PERCENT))
  return {
    vatCents,
    netCents: grossCents - vatCents,
  }
}

// Compute the breakdown lines. Precedence:
//   1. refund_items, when present (explicit allocation; carries the actual
//      amount per line incl. any per-line override admin set)
//   2. inventory_returns, when no refund_items but physical goods returned
//   3. none, when neither exists (custom amount refund — shipping / goodwill)
export function computeRefundBreakdown(
  refundAmountCents: number,
  inventoryReturns: BreakdownInventoryReturn[],
  orderItems: BreakdownOrderItem[],
  refundItems?: BreakdownRefundItem[],
): RefundBreakdown {
  const itemBySku = new Map(orderItems.map((i) => [i.sku, i]))
  const itemById = new Map(orderItems.filter((i) => i.id != null).map((i) => [i.id!, i]))

  let lines: BreakdownLine[] = []
  let source: BreakdownLineSource | "none" = "none"

  if (refundItems && refundItems.length > 0) {
    source = "refund_items"
    for (const ri of refundItems) {
      const item = itemById.get(ri.orderItemId)
      if (!item) continue // defensive — refund_item for an order_item not in the orderItems list
      const lineGrossCents = ri.amountCents
      const { vatCents, netCents } = splitVatInclusive(lineGrossCents)
      lines.push({
        sku: item.sku,
        productName: item.productName,
        quantity: ri.quantity,
        type: "allocated",
        unitPriceCents: item.unitPriceCents,
        lineGrossCents,
        lineVatCents: vatCents,
        lineNetCents: netCents,
      })
    }
  } else if (inventoryReturns.length > 0) {
    source = "inventory_returns"
    for (const ret of inventoryReturns) {
      const item = itemBySku.get(ret.sku)
      if (!item) continue
      const lineGrossCents = item.unitPriceCents * ret.quantity
      const { vatCents, netCents } = splitVatInclusive(lineGrossCents)
      lines.push({
        sku: ret.sku,
        productName: item.productName,
        quantity: ret.quantity,
        type: ret.type,
        unitPriceCents: item.unitPriceCents,
        lineGrossCents,
        lineVatCents: vatCents,
        lineNetCents: netCents,
      })
    }
    if (lines.length === 0) source = "none"
  }

  const linesGrossCents = lines.reduce((s, l) => s + l.lineGrossCents, 0)
  const linesVatCents = lines.reduce((s, l) => s + l.lineVatCents, 0)
  const linesNetCents = linesGrossCents - linesVatCents

  const { vatCents: refundVatCents, netCents: refundNetCents } = splitVatInclusive(refundAmountCents)

  return {
    lines,
    linesGrossCents,
    linesVatCents,
    linesNetCents,
    refundGrossCents: refundAmountCents,
    refundVatCents,
    refundNetCents,
    matchesLineSum: linesGrossCents === refundAmountCents,
    source,
  }
}

function formatCents(cents: number): string {
  return (cents / 100).toFixed(2)
}

// Format the breakdown as pasteable text for the admin to drop into
// Microinvest when issuing the кредитно известие. Bulgarian language,
// matches the invoice-issuance workflow the admin already uses.
//
// When the sum of returned-line gross matches the refund amount, the
// output shows a single unified breakdown. When they differ (e.g. admin
// refunded less than the returned goods' value to cover a handling fee,
// or refunded shipping without any physical return), two sections are
// shown — one for physical returns, one for the refund total — so the
// admin can pick which shape to put on the credit note.
export function formatBreakdownForCreditNote(
  breakdown: RefundBreakdown,
  ctx: { orderId: string; refundedAt: string; method: "stripe" | "bank_transfer" },
): string {
  const orderShort = ctx.orderId.slice(0, 8)
  const date = new Date(ctx.refundedAt).toLocaleDateString("bg-BG", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
  const methodLabel = ctx.method === "stripe" ? "Stripe" : "Банков превод"

  const parts: string[] = []
  parts.push(`Кредитно известие към поръчка #${orderShort}`)
  parts.push(`Дата: ${date}`)
  parts.push(`Метод: ${methodLabel}`)
  parts.push("")

  if (breakdown.lines.length > 0) {
    parts.push(
      breakdown.source === "refund_items"
        ? "Артикули по възстановяването:"
        : "Върнати артикули:",
    )
    breakdown.lines.forEach((line, idx) => {
      const label = line.type === "damaged" ? " [негоден/брак]" : ""
      parts.push(
        `  ${idx + 1}. ${line.productName} (SKU: ${line.sku})${label}` +
          ` — ${line.quantity} бр. × ${formatCents(line.unitPriceCents)} лв` +
          ` = ${formatCents(line.lineGrossCents)} лв`,
      )
    })
    const totalLabel = breakdown.source === "refund_items"
      ? "Общо по артикули"
      : "Общо върнати"
    parts.push(
      `  ${totalLabel}: ${formatCents(breakdown.linesGrossCents)} лв` +
        ` (в т.ч. ДДС 20%: ${formatCents(breakdown.linesVatCents)} лв,` +
        ` без ДДС: ${formatCents(breakdown.linesNetCents)} лв)`,
    )
    parts.push("")
  }

  parts.push(`Сума по възстановяване: ${formatCents(breakdown.refundGrossCents)} лв`)
  parts.push(`  В т.ч. ДДС 20%: ${formatCents(breakdown.refundVatCents)} лв`)
  parts.push(`  Без ДДС: ${formatCents(breakdown.refundNetCents)} лв`)

  if (breakdown.lines.length > 0 && !breakdown.matchesLineSum) {
    parts.push("")
    const diffCents = breakdown.refundGrossCents - breakdown.linesGrossCents
    const sign = diffCents < 0 ? "−" : "+"
    parts.push(
      `Забележка: сумата на възстановяването се различава от стойността на върнатите артикули` +
        ` със ${sign}${formatCents(Math.abs(diffCents))} лв` +
        ` (напр. такса за обработка, частична отстъпка, доставка).`,
    )
  } else if (breakdown.lines.length === 0) {
    parts.push("")
    parts.push(
      "Забележка: няма физически върнати артикули — възстановяване без връщане на стока" +
        " (напр. goodwill, доставка, частична отстъпка).",
    )
  }

  return parts.join("\n")
}
