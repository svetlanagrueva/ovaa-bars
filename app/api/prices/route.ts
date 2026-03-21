import { NextResponse } from "next/server"
import { getProductsWithSales } from "@/lib/sales"

export const revalidate = 60

export async function GET() {
  try {
    const products = await getProductsWithSales()
    const prices = products.map((p) => ({
      id: p.id,
      priceInCents: p.priceInCents,
      originalPriceInCents: p.originalPriceInCents,
    }))
    return NextResponse.json(prices, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    })
  } catch (err) {
    console.error("Failed to fetch prices:", err)
    return NextResponse.json([], { status: 500 })
  }
}
