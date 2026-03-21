import "server-only"
import { createClient } from "@/lib/supabase/server"
import { PRODUCTS, type Product } from "@/lib/products"

export interface ActiveSale {
  id: string
  product_id: string
  sale_price_in_cents: number
  original_price_in_cents: number
  starts_at: string
  ends_at: string | null
  is_active: boolean
  created_at: string
}

/**
 * Fetch currently active sales from the database.
 * A sale is active when: is_active=true AND starts_at <= now AND (ends_at is null OR ends_at > now)
 */
export async function getActiveSales(): Promise<ActiveSale[]> {
  try {
    const supabase = await createClient()
    const now = new Date().toISOString()

    const { data, error } = await supabase
      .from("product_sales")
      .select("*")
      .eq("is_active", true)
      .lte("starts_at", now)
      .or(`ends_at.is.null,ends_at.gt.${now}`)

    if (error) {
      console.error("Failed to fetch active sales:", error)
      return []
    }

    return data ?? []
  } catch (err) {
    console.error("Error fetching active sales:", err)
    return []
  }
}

/**
 * Merge active sale prices into the static PRODUCTS array.
 * If a product has an active sale, its priceInCents is overridden
 * and originalPriceInCents is set for UI display.
 */
export async function getProductsWithSales(): Promise<Product[]> {
  const sales = await getActiveSales()
  const saleMap = new Map(sales.map((s) => [s.product_id, s]))

  return PRODUCTS.map((product) => {
    const sale = saleMap.get(product.id)
    if (sale) {
      return {
        ...product,
        priceInCents: sale.sale_price_in_cents,
        originalPriceInCents: sale.original_price_in_cents,
      }
    }
    return { ...product, originalPriceInCents: undefined }
  })
}

export async function getProductWithSale(id: string): Promise<Product | undefined> {
  const products = await getProductsWithSales()
  return products.find((p) => p.id === id)
}

export async function getProductBySlugWithSale(slug: string): Promise<Product | undefined> {
  const products = await getProductsWithSales()
  return products.find((p) => p.slug === slug)
}
