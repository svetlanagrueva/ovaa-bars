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
  sku: string
  productName: string
  unitPriceCents: number
}

export interface BreakdownInventoryReturn {
  sku: string
  quantity: number
  type: "return_in" | "damaged"
}

export interface BreakdownLine {
  sku: string
  productName: string
  quantity: number
  type: "return_in" | "damaged"
  unitPriceCents: number
  lineGrossCents: number
  lineVatCents: number
  lineNetCents: number
}

export interface RefundBreakdown {
  lines: BreakdownLine[]
  linesGrossCents: number   // sum of line gross (from physical returns)
  linesVatCents: number
  linesNetCents: number
  refundGrossCents: number  // actual refund.amount_cents
  refundVatCents: number
  refundNetCents: number
  matchesLineSum: boolean   // linesGrossCents === refundGrossCents
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

export function computeRefundBreakdown(
  refundAmountCents: number,
  inventoryReturns: BreakdownInventoryReturn[],
  orderItems: BreakdownOrderItem[],
): RefundBreakdown {
  const itemBySku = new Map(orderItems.map((i) => [i.sku, i]))

  const lines: BreakdownLine[] = []
  for (const ret of inventoryReturns) {
    const item = itemBySku.get(ret.sku)
    if (!item) continue // defensive — inventory return for sku not on this order
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
    parts.push("Върнати артикули:")
    breakdown.lines.forEach((line, idx) => {
      const label = line.type === "damaged" ? " [негоден/брак]" : ""
      parts.push(
        `  ${idx + 1}. ${line.productName} (SKU: ${line.sku})${label}` +
          ` — ${line.quantity} бр. × ${formatCents(line.unitPriceCents)} лв` +
          ` = ${formatCents(line.lineGrossCents)} лв`,
      )
    })
    parts.push(
      `  Общо върнати: ${formatCents(breakdown.linesGrossCents)} лв` +
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
