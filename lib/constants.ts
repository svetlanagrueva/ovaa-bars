// Prices in eurocents
export const FREE_SHIPPING_THRESHOLD = 3000 // 30.00 €
export const SHIPPING_PRICE_OFFICE = 300 // 3.00 € (to courier office)
export const SHIPPING_PRICE_ADDRESS = 360 // 3.60 € (to address)
export const COD_FEE = 200 // 2.00 €
export const MAX_QUANTITY = 10

// Free shipping over 30 € applies only to office delivery
export function calculateShippingPrice(subtotal: number, deliveryMethod: string): number {
  const isOffice = deliveryMethod.endsWith("-office")
  if (isOffice && subtotal >= FREE_SHIPPING_THRESHOLD) return 0
  return isOffice ? SHIPPING_PRICE_OFFICE : SHIPPING_PRICE_ADDRESS
}
