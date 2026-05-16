// Order-state helpers shared across server actions and the admin UI.

// Has the customer's money left their hands? Two payment methods, two
// answers:
//   - Card: customer's funds reach Stripe at capture time, which we mirror
//     to orders.seller_settled_at. Capture and customer-payment are the
//     same instant for cards.
//   - COD via ППП: the customer hands cash to the courier on delivery, so
//     orders.delivered_at IS the customer-paid timestamp. Courier remits
//     to seller weeks later (orders.seller_settled_at) — that's the
//     seller-side cash event, not the customer-side one.
//
// Used to gate the refund flow: an order is refundable as soon as the
// customer has paid (someone in the chain), regardless of whether the
// courier has remitted yet. For COD, this means a refund can be issued
// via bank transfer to the customer's IBAN before courier settlement —
// the two flows are independent in storage and in time.
export function hasCustomerPaid(order: {
  payment_method: string
  seller_settled_at: string | null
  delivered_at: string | null
}): boolean {
  if (order.payment_method === "card") return !!order.seller_settled_at
  return !!order.delivered_at
}

// Lightweight Shopify-style financial status, derived from the existing
// order + refunds data. Single source of truth for "where is this order
// on the money axis" — used by the orders list Плащане column, the
// order detail Възстановявания card, and any future surface (CSV
// export, dashboard tile, email template) that needs the same answer.
//
// Refund states outrank settlement states: once money has gone back to
// the customer, the refund is the most relevant payment-side fact.
//
// Priority (first match wins):
//   none              → status is cancelled or expired
//   refunded          → refunds_total >= total_amount  (fully refunded)
//   partially_refunded→ 0 < refunds_total < total_amount
//   paid              → seller_settled_at is set
//   awaiting_courier  → COD, status='delivered', not yet settled
//   awaiting_delivery → COD, status in {confirmed, shipped}
//   pending           → everything else (card, no capture yet)
export type FinancialStatus =
  | "none"
  | "refunded"
  | "partially_refunded"
  | "paid"
  | "awaiting_courier"
  | "awaiting_delivery"
  | "pending"

export function getFinancialStatus(order: {
  status: string
  payment_method: string
  total_amount: number
  refunds_total: number
  seller_settled_at: string | null
}): FinancialStatus {
  if (order.status === "cancelled" || order.status === "expired") return "none"
  if (order.refunds_total > 0 && order.refunds_total >= order.total_amount) return "refunded"
  if (order.refunds_total > 0) return "partially_refunded"
  if (order.seller_settled_at) return "paid"
  if (order.payment_method === "cod") {
    return order.status === "delivered" ? "awaiting_courier" : "awaiting_delivery"
  }
  return "pending"
}

// Bulgarian labels for the badge text. Kept alongside the helper so any
// surface that renders the status uses the same wording.
export const FINANCIAL_STATUS_LABELS: Record<FinancialStatus, string> = {
  none: "—",
  refunded: "Изцяло възстановена",
  partially_refunded: "Частично възстановена",
  paid: "Платена",
  awaiting_courier: "Чака от куриер",
  awaiting_delivery: "Очаква доставка",
  pending: "Чака плащане",
}

// Convenience: same as FINANCIAL_STATUS_LABELS[status] but applies the
// COD-specific override — "Уредена" reads more naturally than "Платена"
// when describing courier settlement on a cash-on-delivery order. Card
// orders stay "Платена".
export function getFinancialStatusLabel(order: {
  status: string
  payment_method: string
  total_amount: number
  refunds_total: number
  seller_settled_at: string | null
}): string {
  const status = getFinancialStatus(order)
  if (status === "paid" && order.payment_method === "cod") return "Уредена"
  return FINANCIAL_STATUS_LABELS[status]
}

// Lifecycle-status labels + Badge variants for orders. Used by the dashboard
// recent-orders block, the orders list, and any future place that renders an
// order's status — keep these as the single source of truth so a status-name
// rename only touches this file.
export const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: "Чакаща",
  confirmed: "Потвърдена",
  shipped: "Изпратена",
  delivered: "Доставена",
  cancelled: "Отказана",
}

export const ORDER_STATUS_BADGE_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  confirmed: "default",
  shipped: "secondary",
  delivered: "secondary",
  cancelled: "destructive",
}

// Order IDs are stored as 10-char lowercase hex (see orders.id default in
// the initial schema). Mirrors the DB `CHECK (id ~ '^[0-9a-f]{10}$')`.
// Case-insensitive so we can validate user input pasted in either case
// before passing through `.toLowerCase()` for the DB lookup.
export const ORDER_ID_REGEX = /^[0-9a-f]{10}$/i

// Display formatter: `#A1B2C3D4E5`. Use this everywhere the order id is
// shown to a human (success page, admin pages, email subjects) so the
// format is changed in one place.
export function formatOrderId(id: string): string {
  return `#${id.toUpperCase()}`
}
