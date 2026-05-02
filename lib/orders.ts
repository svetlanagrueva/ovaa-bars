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
