/**
 * Shared test fixtures for order-related tests.
 */

export const validCustomerInfo = {
  firstName: "Иван",
  lastName: "Петров",
  email: "ivan@example.com",
  phone: "+359888123456",
  city: "София",
  address: "ул. Тестова 1",
  postalCode: "1000",
  notes: "",
}

export const validEcontOffice = {
  id: 42,
  code: "SOF-DRB",
  name: "София - Дружба",
  city: "София",
  fullAddress: "бул. Цариградско шосе 115",
}

export const validSpeedyOffice = {
  id: 100,
  name: "Speedy офис София",
  city: "София",
  fullAddress: "бул. Ситняково 48",
}

export const validCartItems = [{ productId: "egg-origin-dark-chocolate-box", quantity: 2 }]
// dark chocolate priceInCents=2570 × 2 = 5140
export const validCartSubtotal = 5140

export const singleCartItem = [{ productId: "egg-origin-dark-chocolate-box", quantity: 1 }]
export const singleCartSubtotal = 2570

// Synthetic 10-char lowercase-hex order id used as a stable test fixture.
// Format matches the orders.id CHECK (`^[0-9a-f]{10}$`).
export const validOrderId = "abc1234567"

// Synthetic UUID used as a stable test fixture for uuid columns
// (refunds.id, withdrawals.id, invoices.id, product_batches.id, sale/promo
// IDs, idempotency keys). Order IDs use `validOrderId` instead — they're
// 10-char hex, not uuids.
export const validUUID = "550e8400-e29b-41d4-a716-446655440000"
