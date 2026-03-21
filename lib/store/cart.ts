"use client"

import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { Product } from "@/lib/products"
import { MAX_QUANTITY } from "@/lib/constants"

export interface CartItem {
  product: Product
  quantity: number
}

interface CartState {
  items: CartItem[]
  addItem: (product: Product) => void
  addItemWithQuantity: (product: Product, quantity: number) => void
  removeItem: (productId: string) => void
  updateQuantity: (productId: string, quantity: number) => void
  clearCart: () => void
  getTotalItems: () => number
  getTotalPrice: () => number
  syncPrices: () => Promise<boolean>
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],

      addItem: (product: Product) => {
        get().addItemWithQuantity(product, 1)
      },

      addItemWithQuantity: (product: Product, qty: number) => {
        const items = get().items
        const existingItem = items.find((item) => item.product.id === product.id)
        const currentQty = existingItem?.quantity ?? 0
        const newQty = Math.min(MAX_QUANTITY, currentQty + qty)

        if (newQty === currentQty) return

        if (existingItem) {
          set({
            items: items.map((item) =>
              item.product.id === product.id
                ? { ...item, quantity: newQty }
                : item
            ),
          })
        } else {
          set({ items: [...items, { product, quantity: Math.min(MAX_QUANTITY, qty) }] })
        }
      },

      removeItem: (productId: string) => {
        set({ items: get().items.filter((item) => item.product.id !== productId) })
      },

      updateQuantity: (productId: string, quantity: number) => {
        if (quantity <= 0) {
          get().removeItem(productId)
          return
        }
        if (quantity > MAX_QUANTITY) return
        set({
          items: get().items.map((item) =>
            item.product.id === productId ? { ...item, quantity } : item
          ),
        })
      },

      clearCart: () => set({ items: [] }),

      getTotalItems: () => {
        return get().items.reduce((total, item) => total + item.quantity, 0)
      },

      getTotalPrice: () => {
        return get().items.reduce(
          (total, item) => total + item.product.priceInCents * item.quantity,
          0
        )
      },

      syncPrices: async () => {
        try {
          const res = await fetch("/api/prices")
          if (!res.ok) return false

          const prices: Array<{ id: string; priceInCents: number; originalPriceInCents?: number }> =
            await res.json()
          const priceMap = new Map(prices.map((p) => [p.id, p]))

          const items = get().items
          let changed = false
          const updated = items.map((item) => {
            const current = priceMap.get(item.product.id)
            if (!current) return item
            if (
              current.priceInCents !== item.product.priceInCents ||
              current.originalPriceInCents !== item.product.originalPriceInCents
            ) {
              changed = true
              return {
                ...item,
                product: {
                  ...item.product,
                  priceInCents: current.priceInCents,
                  originalPriceInCents: current.originalPriceInCents,
                },
              }
            }
            return item
          })
          if (changed) set({ items: updated })
          return changed
        } catch {
          return false
        }
      },
    }),
    {
      name: "egg-origin-cart",
    }
  )
)
