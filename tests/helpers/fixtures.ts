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

export const singleCartItem = [{ productId: "egg-origin-dark-chocolate-box", quantity: 1 }]

export const validUUID = "550e8400-e29b-41d4-a716-446655440000"
