"use client"

import Image from "next/image"
import Link from "next/link"
import { Plus, ArrowRight, ShoppingCart } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter } from "@/components/ui/card"
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
    <Card className="group overflow-hidden border-border transition-colors hover:border-foreground/30">
      <Link href={`/products/${product.slug}`} className="block">
        <div className="relative aspect-square overflow-hidden bg-secondary sm:aspect-[3/4]">
          <Image
            src={product.image || "/placeholder.svg"}
            alt={product.name}
            fill
            className="object-cover transition-transform duration-300 group-hover:scale-105"
          />
          {soldOut ? (
            <Badge className="absolute left-3 top-3 bg-muted text-muted-foreground text-[9px] font-medium uppercase tracking-[0.2em]">
              Изчерпан
            </Badge>
          ) : product.badge && (
            <Badge className="absolute left-3 top-3 bg-primary text-primary-foreground text-[9px] font-medium uppercase tracking-[0.2em]">
              {product.badge}
            </Badge>
          )}
        </div>
      </Link>
      <CardContent className="p-3 sm:p-5">
        <Link href={`/products/${product.slug}`}>
          <h3 className="text-sm font-medium tracking-wide text-foreground transition-colors hover:text-muted-foreground sm:text-base">
            {product.name}
          </h3>
        </Link>
        <p className="mt-1 text-[11px] tracking-wide text-muted-foreground sm:text-xs">
          {product.boxContents}
        </p>
        <div className="mt-2 hidden flex-wrap gap-1.5 sm:flex">
          {product.nutritionHighlights.map((highlight) => (
            <Badge key={highlight} variant="secondary" className="text-[10px] font-normal tracking-wide">
              {highlight}
            </Badge>
          ))}
        </div>
      </CardContent>
      <CardFooter className="flex flex-col gap-3 border-t border-border p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <PriceDisplay product={product} size="sm" />
        <div className="flex w-full gap-2 sm:w-auto">
          <Button
            variant="outline"
            size="sm"
            asChild
            className="hidden sm:flex"
          >
            <Link href={`/products/${product.slug}`}>
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button
            onClick={() => {
              addItem(product)
              toast(product.name, {
                description: "Добавено в количката",
                icon: <ShoppingCart className="h-4 w-4" />,
                action: {
                  label: "Количка",
                  onClick: () => window.location.href = "/cart",
                },
              })
            }}
            size="sm"
            disabled={soldOut}
            className="w-full gap-1.5 text-[11px] uppercase tracking-[0.15em] sm:w-auto"
          >
            {soldOut ? (
              "Изчерпан"
            ) : (
              <>
                <Plus className="h-3.5 w-3.5" />
                Добави
              </>
            )}
          </Button>
        </div>
      </CardFooter>
    </Card>
  )
}
