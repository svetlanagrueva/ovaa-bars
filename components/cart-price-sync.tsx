"use client"

import { useEffect, useRef } from "react"
import { toast } from "sonner"
import { useCartStore } from "@/lib/store/cart"

export function CartPriceSync() {
  const syncPrices = useCartStore((state) => state.syncPrices)
  const itemCount = useCartStore((state) => state.items.length)
  const hasSynced = useRef(false)

  useEffect(() => {
    if (hasSynced.current || itemCount === 0) return
    hasSynced.current = true

    syncPrices().then((changed) => {
      if (changed) {
        toast.info("Цените бяха актуализирани", {
          description: "Някои цени са се променили.",
        })
      }
    })
  }, [syncPrices, itemCount])

  return null
}
