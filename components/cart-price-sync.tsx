"use client"

import { useEffect } from "react"
import { useCartStore } from "@/lib/store/cart"

export function CartPriceSync() {
  const syncPrices = useCartStore((state) => state.syncPrices)

  useEffect(() => {
    syncPrices()
  }, [syncPrices])

  return null
}
