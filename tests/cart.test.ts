import { describe, it, expect, beforeEach } from "vitest"
import { useCartStore } from "@/lib/store/cart"
import { PRODUCTS } from "@/lib/products"

const darkChocolate = PRODUCTS[0]
const raspberry = PRODUCTS[1]

describe("cart store", () => {
  beforeEach(() => {
    useCartStore.setState({ items: [] })
  })

  describe("addItem", () => {
    it("adds a new item with quantity 1", () => {
      useCartStore.getState().addItem(darkChocolate)
      const items = useCartStore.getState().items
      expect(items).toHaveLength(1)
      expect(items[0].product.id).toBe(darkChocolate.id)
      expect(items[0].quantity).toBe(1)
    })

    it("increments quantity for existing item", () => {
      useCartStore.getState().addItem(darkChocolate)
      useCartStore.getState().addItem(darkChocolate)
      const items = useCartStore.getState().items
      expect(items).toHaveLength(1)
      expect(items[0].quantity).toBe(2)
    })

    it("adds different products as separate items", () => {
      useCartStore.getState().addItem(darkChocolate)
      useCartStore.getState().addItem(raspberry)
      expect(useCartStore.getState().items).toHaveLength(2)
    })

    it("caps quantity at 10", () => {
      for (let i = 0; i < 12; i++) {
        useCartStore.getState().addItem(darkChocolate)
      }
      expect(useCartStore.getState().items[0].quantity).toBe(10)
    })
  })

  describe("removeItem", () => {
    it("removes an item by product id", () => {
      useCartStore.getState().addItem(darkChocolate)
      useCartStore.getState().addItem(raspberry)
      useCartStore.getState().removeItem(darkChocolate.id)
      const items = useCartStore.getState().items
      expect(items).toHaveLength(1)
      expect(items[0].product.id).toBe(raspberry.id)
    })

    it("does nothing when removing nonexistent item", () => {
      useCartStore.getState().addItem(darkChocolate)
      useCartStore.getState().removeItem("nonexistent")
      expect(useCartStore.getState().items).toHaveLength(1)
    })
  })

  describe("updateQuantity", () => {
    it("updates quantity for an item", () => {
      useCartStore.getState().addItem(darkChocolate)
      useCartStore.getState().updateQuantity(darkChocolate.id, 5)
      expect(useCartStore.getState().items[0].quantity).toBe(5)
    })

    it("removes item when quantity set to 0", () => {
      useCartStore.getState().addItem(darkChocolate)
      useCartStore.getState().updateQuantity(darkChocolate.id, 0)
      expect(useCartStore.getState().items).toHaveLength(0)
    })

    it("removes item when quantity set to negative", () => {
      useCartStore.getState().addItem(darkChocolate)
      useCartStore.getState().updateQuantity(darkChocolate.id, -1)
      expect(useCartStore.getState().items).toHaveLength(0)
    })

    it("caps quantity at 10", () => {
      useCartStore.getState().addItem(darkChocolate)
      useCartStore.getState().updateQuantity(darkChocolate.id, 15)
      expect(useCartStore.getState().items[0].quantity).toBe(1)
    })
  })

  describe("clearCart", () => {
    it("removes all items", () => {
      useCartStore.getState().addItem(darkChocolate)
      useCartStore.getState().addItem(raspberry)
      useCartStore.getState().clearCart()
      expect(useCartStore.getState().items).toHaveLength(0)
    })
  })

  describe("getTotalItems", () => {
    it("returns 0 for empty cart", () => {
      expect(useCartStore.getState().getTotalItems()).toBe(0)
    })

    it("sums quantities across items", () => {
      useCartStore.getState().addItem(darkChocolate)
      useCartStore.getState().addItem(darkChocolate)
      useCartStore.getState().addItem(raspberry)
      expect(useCartStore.getState().getTotalItems()).toBe(3)
    })
  })

  describe("getTotalPrice", () => {
    it("returns 0 for empty cart", () => {
      expect(useCartStore.getState().getTotalPrice()).toBe(0)
    })

    it("calculates total price correctly", () => {
      useCartStore.getState().addItem(darkChocolate)
      useCartStore.getState().addItem(darkChocolate)
      expect(useCartStore.getState().getTotalPrice()).toBe(darkChocolate.priceInCents * 2)
    })

    it("sums prices across different products", () => {
      useCartStore.getState().addItem(darkChocolate)
      useCartStore.getState().addItem(raspberry)
      expect(useCartStore.getState().getTotalPrice()).toBe(
        darkChocolate.priceInCents + raspberry.priceInCents
      )
    })
  })
})
