"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { Plus, Minus, Check, ShoppingBag, ShoppingCart, ArrowRight } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useCartStore } from "@/lib/store/cart"
import { formatPrice, isOnSale, type Product } from "@/lib/products"
import { PriceDisplay } from "@/components/products/price-display"
import { ProductCard } from "@/components/products/product-card"
import { MAX_QUANTITY } from "@/lib/constants"

interface ProductDetailProps {
  product: Product
  otherProducts: Product[]
  soldOut?: boolean
  otherProductsSoldOut?: Record<string, boolean>
}

export function ProductDetail({ product, otherProducts, soldOut = false, otherProductsSoldOut = {} }: ProductDetailProps) {
  const [quantity, setQuantity] = useState(1)
  const [selectedImage, setSelectedImage] = useState(0)
  const addItemWithQuantity = useCartStore((state) => state.addItemWithQuantity)

  const handleAddToCart = () => {
    addItemWithQuantity(product, quantity)
    toast(product.name, {
      description: `${quantity > 1 ? quantity + " x " : ""}Добавено в количката`,
      icon: <ShoppingCart className="h-4 w-4" />,
      action: {
        label: "Количка",
        onClick: () => window.location.href = "/cart",
      },
    })
  }

  return (
    <div className="bg-background">
      {/* Breadcrumb */}
      <div className="mx-auto max-w-7xl px-5 py-5 sm:px-6 sm:py-6 lg:px-8">
        <Link
          href="/products"
          className="inline-flex items-center gap-2 text-[13px] text-muted-foreground hover:text-accent transition-colors sm:text-sm"
        >
          <ArrowRight className="h-3.5 w-3.5 rotate-180" />
          Обратно към продуктите
        </Link>
      </div>

      {/* Product Section */}
      <section className="mx-auto max-w-7xl px-5 pb-12 sm:px-6 sm:pb-16 lg:px-8 lg:pb-24">
        <div className="grid gap-8 sm:gap-12 lg:grid-cols-2">
          {/* Product Images */}
          <div className="space-y-3 sm:space-y-4">
            <div className="relative aspect-[3/4] overflow-hidden rounded-[20px] bg-secondary sm:rounded-none">
              <Image
                src={product.images[selectedImage] || "/placeholder.svg"}
                alt={product.name}
                fill
                className="object-contain"
                priority
              />
              {soldOut ? (
                <Badge className="absolute left-4 top-4 bg-muted text-muted-foreground text-[9px] font-medium uppercase tracking-[0.2em]">
                  Изчерпан
                </Badge>
              ) : product.badge && (
                <Badge className="absolute left-4 top-4 bg-primary text-primary-foreground text-[9px] font-medium uppercase tracking-[0.2em]">
                  {product.badge}
                </Badge>
              )}
            </div>
            {product.images.length > 1 && (
              <div className="flex gap-3 sm:gap-4">
                {product.images.map((image, index) => (
                  <button
                    key={index}
                    onClick={() => setSelectedImage(index)}
                    className={`relative aspect-square w-16 overflow-hidden rounded-[12px] bg-secondary transition-all sm:w-20 sm:rounded-none ${
                      selectedImage === index ? "ring-2 ring-primary" : "opacity-60 hover:opacity-100"
                    }`}
                  >
                    <Image
                      src={image || "/placeholder.svg"}
                      alt={`${product.name} - Снимка ${index + 1}`}
                      fill
                      className="object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Product Info */}
          <div className="flex flex-col">
            <h1 className="text-[32px] font-light leading-[1.1] tracking-[-0.03em] text-foreground sm:text-4xl sm:leading-[1.05] sm:tracking-[-0.04em] lg:text-5xl">
              {product.name}
            </h1>

            <p className="mt-2 text-[13px] tracking-wide text-muted-foreground sm:text-sm">
              {product.boxContents}
            </p>

            <div className="mt-5 flex flex-wrap gap-2 sm:mt-6">
              {product.nutritionHighlights.map((highlight) => (
                <Badge key={highlight} variant="secondary" className="text-[10px] font-normal tracking-wide">
                  {highlight}
                </Badge>
              ))}
            </div>

            <div className="mt-6 border-t border-border pt-6 sm:mt-8 sm:pt-8">
              <PriceDisplay product={product} size="lg" showPerBar />
            </div>

            {/* Quantity Selector */}
            <div className="mt-6 flex items-center gap-4 sm:mt-8">
              <span className="text-[13px] font-medium text-foreground sm:text-sm">Количество:</span>
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
            {soldOut ? (
              <Button
                size="lg"
                disabled
                className="mt-6 h-12 w-full gap-2 rounded-full text-[10px] uppercase tracking-[0.16em] sm:mt-8 sm:h-auto sm:rounded-md sm:py-6 sm:text-base sm:tracking-normal sm:normal-case"
              >
                Изчерпан
              </Button>
            ) : (
              <Button
                onClick={handleAddToCart}
                size="lg"
                className="mt-6 h-12 w-full gap-2 rounded-full text-[10px] uppercase tracking-[0.16em] sm:mt-8 sm:h-auto sm:rounded-md sm:py-6 sm:text-base sm:tracking-normal sm:normal-case"
              >
                <ShoppingBag className="h-5 w-5" />
                Добави в количката - {formatPrice(product.priceInCents * quantity)}
              </Button>
            )}

              {/* Description */}
            <div className="mt-10 space-y-6 sm:mt-12">
              <div>
                <h2 className="text-base font-medium tracking-[-0.01em] text-foreground sm:text-lg">Описание</h2>
                <div className="mt-3 space-y-3 text-[13px] leading-[1.7] text-muted-foreground sm:space-y-4 sm:text-sm sm:leading-7">
                  {product.fullDescription.split('\n\n').map((paragraph, index) => (
                    <p key={index}>{paragraph}</p>
                  ))}
                </div>
              </div>

              {/* Benefits */}
              <div className="border-t border-border pt-6">
                <h2 className="text-base font-medium tracking-[-0.01em] text-foreground sm:text-lg">Предимства</h2>
                <ul className="mt-3 space-y-2">
                  {product.benefits.map((benefit) => (
                    <li key={benefit} className="flex items-start gap-3 text-[13px] text-muted-foreground sm:text-sm">
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
        <div className="mt-14 grid gap-3 sm:mt-20 sm:gap-8 md:grid-cols-2">
          <div className="rounded-[18px] bg-secondary p-6 sm:rounded-none sm:p-8">
            <h2 className="text-base font-medium tracking-[-0.01em] text-foreground sm:text-lg">Хранителна информация</h2>
            <div className="mt-2 h-px w-12 bg-accent/50" />
            <p className="mt-3 text-[13px] text-muted-foreground sm:text-sm">На бар</p>
            <div className="mt-5 space-y-3 text-[13px] sm:mt-6 sm:space-y-4 sm:text-sm">
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

          <div className="rounded-[18px] bg-secondary p-6 sm:rounded-none sm:p-8">
            <h2 className="text-base font-medium tracking-[-0.01em] text-foreground sm:text-lg">Съставки</h2>
            <div className="mt-2 h-px w-12 bg-accent/50" />
            <p className="mt-3 text-[13px] text-muted-foreground sm:text-sm">Формула с натурални съставки</p>
            <ul className="mt-5 space-y-2.5 text-[13px] sm:mt-6 sm:space-y-3 sm:text-sm">
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
          <div className="mt-14 sm:mt-20">
            <h2 className="text-[22px] font-light tracking-[-0.02em] text-foreground sm:text-2xl">Може да ви хареса още</h2>
            <div className="mt-6 grid grid-cols-2 gap-3 sm:mt-8 sm:gap-5 lg:grid-cols-3 lg:gap-8">
              {otherProducts.map((p) => (
                <ProductCard key={p.id} product={p} soldOut={otherProductsSoldOut[p.id]} />
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
