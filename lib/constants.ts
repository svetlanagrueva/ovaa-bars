// Social media
export const INSTAGRAM_URL = "https://www.instagram.com/eggorigin"
export const TIKTOK_URL = "https://www.tiktok.com/@eggorigin"

// Prices in eurocents
export const FREE_SHIPPING_THRESHOLD = 3000 // 30.00 €
export const SHIPPING_PRICE_OFFICE = 300 // 3.00 € (to courier office)
export const SHIPPING_PRICE_ADDRESS = 360 // 3.60 € (to address)
// COD fee was historically 2 € — dropped 2026-05-03 (no longer charged
// to the customer for choosing наложен платеж). The DB column + checkout
// + admin price-breakdown logic stays in place so historical orders that
// were placed with a fee still display it correctly; new orders are
// created with cod_fee = 0 because COD_FEE is now zero.
export const COD_FEE = 0
export const MAX_QUANTITY = 10

// Base URL for absolute links (emails, callbacks)
export function getBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
  )
}

// Free shipping over 30 € applies only to office delivery
export function calculateShippingPrice(subtotal: number, deliveryMethod: string): number {
  const isOffice = deliveryMethod.endsWith("-office")
  if (isOffice && subtotal >= FREE_SHIPPING_THRESHOLD) return 0
  return isOffice ? SHIPPING_PRICE_OFFICE : SHIPPING_PRICE_ADDRESS
}
