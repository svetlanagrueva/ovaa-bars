import { createClient } from "@/lib/supabase/server"
import { PRODUCTS } from "@/lib/products"

// Returns a map of productId → current stock quantity.
// Used by server components to determine sold-out state before rendering.
// Missing SKUs (not yet seeded) default to 0.
export async function getInventoryMap(): Promise<Map<string, number>> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("inventory_current")
    .select("sku, quantity")

  if (error) {
    // Fail open: a transient DB error should not mark the entire shop as sold-out.
    // Callers treat missing entries as available via inventoryMap.has() guard.
    console.error("Failed to fetch inventory:", error)
    return new Map()
  }

  const skuToQty = new Map((data || []).map((r) => [r.sku, r.quantity as number]))

  const result = new Map<string, number>()
  for (const product of PRODUCTS) {
    result.set(product.id, skuToQty.get(product.sku) ?? 0)
  }
  return result
}
