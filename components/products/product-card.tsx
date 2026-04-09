"use client"

import Image from "next/image"
import Link from "next/link"
import { Plus, ShoppingCart } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useCartStore } from "@/lib/store/cart"
import { type Product } from "@/lib/products"
import { PriceDisplay } from "@/components/products/price-display"

interface ProductCardProps {
  product: Product
  soldOut?: boolean
}

export function ProductCard({ product, soldOut = false }: ProductCardProps) {
  const addItem = useCartStore((state) => state.addItem)

  return (
    <article className="group flex h-full flex-col">
      <Link href={`/products/${product.slug}`} className="block">
        <div className="relative overflow-hidden rounded-[20px] border border-border/60 bg-secondary transition-colors duration-300 group-hover:border-foreground/20">
          <div className="relative aspect-[1/1] sm:aspect-[4/4.2]">
            <Image
              src={product.image || "/placeholder.svg"}
              alt={product.name}
              fill
              className="object-cover transition-transform duration-500 group-hover:scale-[1.02]"
            />

            {soldOut ? (
              <Badge className="absolute left-2.5 top-2.5 rounded-full bg-background/90 px-2 py-0.5 text-[8px] font-medium uppercase tracking-[0.18em] text-muted-foreground shadow-none">
                Изчерпан
              </Badge>
            ) : product.badge ? (
              <Badge className="absolute left-2.5 top-2.5 rounded-full bg-background/90 px-2 py-0.5 text-[8px] font-medium uppercase tracking-[0.18em] text-foreground shadow-none">
                {product.badge}
              </Badge>
            ) : null}
          </div>
        </div>
      </Link>

      <div className="flex flex-1 flex-col px-0.5 pb-0.5 pt-2.5 sm:pt-3">
        <Link href={`/products/${product.slug}`} className="block">
          <h3 className="text-[13px] font-medium tracking-[0.01em] text-foreground transition-colors hover:text-muted-foreground sm:text-sm">
            {product.name}
          </h3>
        </Link>

        <p className="mt-0.5 text-[10px] tracking-[0.02em] text-muted-foreground sm:text-[11px]">
          {product.boxContents}
        </p>

        <div className="mt-auto flex items-center justify-between gap-2 pt-2.5">
          <PriceDisplay product={product} size="sm" />

          <Button
            onClick={() => {
              addItem(product)
              toast(product.name, {
                description: "Добавено в количката",
                icon: <ShoppingCart className="h-4 w-4" />,
                action: {
                  label: "Количка",
                  onClick: () => (window.location.href = "/cart"),
                },
              })
            }}
            size="sm"
            disabled={soldOut}
            className="h-9 rounded-full bg-foreground px-3 text-[10px] uppercase tracking-[0.16em] text-background transition-all duration-200 hover:opacity-90 active:scale-[0.98]"
          >
            {soldOut ? (
              "Изчерпан"
            ) : (
              <>
                <Plus className="mr-1 h-3.5 w-3.5" />
                Добави
              </>
            )}
          </Button>
        </div>
      </div>
    </article>
  )
}