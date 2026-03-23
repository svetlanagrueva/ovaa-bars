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
}

export function ProductCard({ product }: ProductCardProps) {
  const addItem = useCartStore((state) => state.addItem)

  return (
    <Card className="group overflow-hidden border-border transition-colors hover:border-foreground/30">
      <Link href={`/products/${product.slug}`} className="block">
        <div className="relative aspect-[3/4] overflow-hidden bg-secondary">
          <Image
            src={product.image || "/placeholder.svg"}
            alt={product.name}
            fill
            className="object-cover transition-transform duration-300 group-hover:scale-105"
          />
          {product.badge && (
            <Badge className="absolute left-3 top-3 bg-primary text-primary-foreground text-[9px] font-medium uppercase tracking-[0.2em]">
              {product.badge}
            </Badge>
          )}
        </div>
      </Link>
      <CardContent className="p-5">
        <Link href={`/products/${product.slug}`}>
          <h3 className="text-base font-medium tracking-wide text-foreground transition-colors hover:text-muted-foreground">
            {product.name}
          </h3>
        </Link>
        <p className="mt-1 text-xs tracking-wide text-muted-foreground">
          {product.boxContents}
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {product.nutritionHighlights.map((highlight) => (
            <Badge key={highlight} variant="secondary" className="text-[10px] font-normal tracking-wide">
              {highlight}
            </Badge>
          ))}
        </div>
      </CardContent>
      <CardFooter className="flex items-center justify-between border-t border-border p-5">
        <PriceDisplay product={product} size="sm" />
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            asChild
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
            className="gap-1.5 text-[11px] uppercase tracking-[0.15em]"
          >
            <Plus className="h-3.5 w-3.5" />
            Добави
          </Button>
        </div>
      </CardFooter>
    </Card>
  )
}
