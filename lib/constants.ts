// Prices in stotinki (BGN cents)
export const FREE_SHIPPING_THRESHOLD = 5000 // 50.00 лв.
export const SHIPPING_PRICE_OFFICE = 799 // 7.99 лв. (to courier office)
export const SHIPPING_PRICE_ADDRESS = 799 // 7.99 лв. (to address)
export const COD_FEE = 200 // 2.00 лв.
export const MAX_QUANTITY = 10

// Free shipping over 50 лв applies only to office delivery
export function calculateShippingPrice(subtotal: number, deliveryMethod: string): number {
  const isOffice = deliveryMethod.endsWith("-office")
  if (isOffice && subtotal >= FREE_SHIPPING_THRESHOLD) return 0
  return isOffice ? SHIPPING_PRICE_OFFICE : SHIPPING_PRICE_ADDRESS
}
