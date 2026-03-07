"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { Plus, Minus, Check, ShoppingBag, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useCartStore } from "@/lib/store/cart"
import { formatPrice, type Product } from "@/lib/products"
import { ProductCard } from "@/components/products/product-card"
import { MAX_QUANTITY } from "@/lib/constants"

interface ProductDetailProps {
  product: Product
  otherProducts: Product[]
}

export function ProductDetail({ product, otherProducts }: ProductDetailProps) {
  const [quantity, setQuantity] = useState(1)
  const [selectedImage, setSelectedImage] = useState(0)
  const addItemWithQuantity = useCartStore((state) => state.addItemWithQuantity)

  const handleAddToCart = () => {
    addItemWithQuantity(product, quantity)
  }

  return (
    <div className="bg-background">
      {/* Breadcrumb */}
      <div className="container mx-auto px-4 py-6">
        <Link
          href="/products"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowRight className="h-4 w-4 rotate-180" />
          Обратно към продуктите
        </Link>
      </div>

      {/* Product Section */}
      <section className="container mx-auto px-4 pb-20">
        <div className="grid gap-12 lg:grid-cols-2">
          {/* Product Images */}
          <div className="space-y-4">
            <div className="relative aspect-square overflow-hidden bg-secondary">
              <Image
                src={product.images[selectedImage] || "/placeholder.svg"}
                alt={product.name}
                fill
                className="object-contain p-8"
                priority
              />
              {product.badge && (
                <Badge className="absolute left-4 top-4 bg-primary text-primary-foreground">
                  {product.badge}
                </Badge>
              )}
            </div>
            {product.images.length > 1 && (
              <div className="flex gap-4">
                {product.images.map((image, index) => (
                  <button
                    key={index}
                    onClick={() => setSelectedImage(index)}
                    className={`relative aspect-square w-20 overflow-hidden bg-secondary transition-all ${
                      selectedImage === index ? "ring-2 ring-primary" : "opacity-60 hover:opacity-100"
                    }`}
                  >
                    <Image
                      src={image || "/placeholder.svg"}
                      alt={`${product.name} - Снимка ${index + 1}`}
                      fill
                      className="object-contain p-2"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Product Info */}
          <div className="flex flex-col">
            <h1 className="text-3xl font-light tracking-wide text-foreground lg:text-4xl">
              {product.name}
            </h1>

            <p className="mt-2 text-lg text-muted-foreground">
              {product.boxContents}
            </p>

            <div className="mt-6 flex flex-wrap gap-2">
              {product.nutritionHighlights.map((highlight) => (
                <Badge key={highlight} variant="secondary" className="text-sm">
                  {highlight}
                </Badge>
              ))}
            </div>

            <div className="mt-8 border-t border-border pt-8">
              <p className="text-3xl font-light text-foreground">
                {formatPrice(product.priceInCents)}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {formatPrice(Math.round(product.priceInCents / product.barsCount))} на бар
              </p>
            </div>

            {/* Quantity Selector */}
            <div className="mt-8 flex items-center gap-4">
              <span className="text-sm font-medium text-foreground">Количество:</span>
              <div className="flex items-center border border-border">
                <button
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  className="flex h-10 w-10 items-center justify-center text-foreground hover:bg-secondary transition-colors"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="flex h-10 w-12 items-center justify-center text-foreground">
                  {quantity}
                </span>
                <button
                  onClick={() => setQuantity(Math.min(MAX_QUANTITY, quantity + 1))}
                  className="flex h-10 w-10 items-center justify-center text-foreground hover:bg-secondary transition-colors"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Add to Cart */}
            <Button
              onClick={handleAddToCart}
              size="lg"
              className="mt-8 w-full gap-2 py-6 text-base"
            >
              <ShoppingBag className="h-5 w-5" />
              Добави в количката - {formatPrice(product.priceInCents * quantity)}
            </Button>

            {/* Description */}
            <div className="mt-12 space-y-6">
              <div>
                <h2 className="text-lg font-medium text-foreground">Описание</h2>
                <div className="mt-3 space-y-4 text-muted-foreground">
                  {product.fullDescription.split('\n\n').map((paragraph, index) => (
                    <p key={index}>{paragraph}</p>
                  ))}
                </div>
              </div>

              {/* Benefits */}
              <div className="border-t border-border pt-6">
                <h2 className="text-lg font-medium text-foreground">Предимства</h2>
                <ul className="mt-3 space-y-2">
                  {product.benefits.map((benefit) => (
                    <li key={benefit} className="flex items-start gap-3 text-muted-foreground">
                      <Check className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" />
                      {benefit}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* Nutrition & Ingredients */}
        <div className="mt-20 grid gap-8 md:grid-cols-2">
          <div className="bg-secondary p-8">
            <h2 className="text-lg font-medium text-foreground">Хранителна информация</h2>
            <p className="mt-1 text-sm text-muted-foreground">На бар</p>
            <div className="mt-6 space-y-4">
              <div className="flex justify-between border-b border-border pb-2">
                <span className="text-muted-foreground">Калории</span>
                <span className="font-medium text-foreground">{product.nutritionFacts.calories} kcal</span>
              </div>
              <div className="flex justify-between border-b border-border pb-2">
                <span className="text-muted-foreground">Протеин</span>
                <span className="font-medium text-foreground">{product.nutritionFacts.protein}g</span>
              </div>
              <div className="flex justify-between border-b border-border pb-2">
                <span className="text-muted-foreground">Въглехидрати</span>
                <span className="font-medium text-foreground">{product.nutritionFacts.carbs}g</span>
              </div>
              <div className="flex justify-between border-b border-border pb-2">
                <span className="text-muted-foreground">Захар</span>
                <span className="font-medium text-foreground">{product.nutritionFacts.sugar}g</span>
              </div>
              <div className="flex justify-between border-b border-border pb-2">
                <span className="text-muted-foreground">Мазнини</span>
                <span className="font-medium text-foreground">{product.nutritionFacts.fat}g</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Фибри</span>
                <span className="font-medium text-foreground">{product.nutritionFacts.fiber}g</span>
              </div>
            </div>
          </div>

          <div className="bg-secondary p-8">
            <h2 className="text-lg font-medium text-foreground">Съставки</h2>
            <p className="mt-1 text-sm text-muted-foreground">Формула с чиста етикета</p>
            <ul className="mt-6 space-y-3">
              {product.ingredients.map((ingredient) => (
                <li key={ingredient} className="flex items-center gap-3 text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  {ingredient}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Other Products */}
        {otherProducts.length > 0 && (
          <div className="mt-20">
            <h2 className="text-2xl font-light tracking-wide text-foreground">Може да ви хареса още</h2>
            <div className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
              {otherProducts.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
