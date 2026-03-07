import { describe, it, expect } from "vitest"
import { PRODUCTS, getProduct, getProductBySlug, formatPrice } from "@/lib/products"

describe("PRODUCTS data", () => {
  it("has 3 products", () => {
    expect(PRODUCTS).toHaveLength(3)
  })

  it("all products have required fields", () => {
    for (const product of PRODUCTS) {
      expect(product.id).toBeTruthy()
      expect(product.slug).toBeTruthy()
      expect(product.name).toBeTruthy()
      expect(product.shortDescription).toBeTruthy()
      expect(product.fullDescription).toBeTruthy()
      expect(product.priceInCents).toBeGreaterThan(0)
      expect(product.image).toBeTruthy()
      expect(product.images.length).toBeGreaterThan(0)
      expect(product.barsCount).toBeGreaterThan(0)
      expect(product.nutritionHighlights.length).toBeGreaterThan(0)
      expect(product.ingredients.length).toBeGreaterThan(0)
      expect(product.benefits.length).toBeGreaterThan(0)
    }
  })

  it("all products have valid nutrition facts", () => {
    for (const product of PRODUCTS) {
      const { calories, protein, carbs, sugar, fat, fiber } = product.nutritionFacts
      expect(calories).toBeGreaterThan(0)
      expect(protein).toBeGreaterThan(0)
      expect(carbs).toBeGreaterThanOrEqual(0)
      expect(sugar).toBeGreaterThanOrEqual(0)
      expect(fat).toBeGreaterThanOrEqual(0)
      expect(fiber).toBeGreaterThanOrEqual(0)
    }
  })

  it("all products have unique ids and slugs", () => {
    const ids = PRODUCTS.map((p) => p.id)
    const slugs = PRODUCTS.map((p) => p.slug)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(slugs).size).toBe(slugs.length)
  })
})

describe("getProduct", () => {
  it("returns product by id", () => {
    const product = getProduct("ovva-dark-chocolate-box")
    expect(product).toBeDefined()
    expect(product!.name).toBe("Dark Chocolate Box")
  })

  it("returns undefined for unknown id", () => {
    expect(getProduct("nonexistent")).toBeUndefined()
  })
})

describe("getProductBySlug", () => {
  it("returns product by slug", () => {
    const product = getProductBySlug("white-chocolate-raspberry-box")
    expect(product).toBeDefined()
    expect(product!.id).toBe("ovva-white-chocolate-raspberry-box")
  })

  it("returns undefined for unknown slug", () => {
    expect(getProductBySlug("nonexistent")).toBeUndefined()
  })
})

describe("formatPrice", () => {
  it("formats price in BGN", () => {
    expect(formatPrice(5999)).toBe("59.99 лв.")
  })

  it("formats zero", () => {
    expect(formatPrice(0)).toBe("0.00 лв.")
  })

  it("formats small amounts", () => {
    expect(formatPrice(99)).toBe("0.99 лв.")
  })

  it("formats round amounts", () => {
    expect(formatPrice(10000)).toBe("100.00 лв.")
  })
})
