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
    <Card className="group overflow-hidden transition-shadow hover:shadow-lg">
      <Link href={`/products/${product.slug}`} className="block">
        <div className="relative aspect-square overflow-hidden bg-secondary">
          <Image
            src={product.image || "/placeholder.svg"}
            alt={product.name}
            fill
            className="object-contain p-4 transition-transform duration-300 group-hover:scale-105"
          />
          {product.badge && (
            <Badge className="absolute left-3 top-3 bg-primary text-primary-foreground">
              {product.badge}
            </Badge>
          )}
        </div>
      </Link>
      <CardContent className="p-4">
        <Link href={`/products/${product.slug}`}>
          <h3 className="text-lg font-semibold text-foreground hover:text-primary transition-colors">
            {product.name}
          </h3>
        </Link>
        <p className="mt-1 text-sm text-muted-foreground">
          {product.boxContents}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {product.nutritionHighlights.map((highlight) => (
            <Badge key={highlight} variant="secondary" className="text-xs">
              {highlight}
            </Badge>
          ))}
        </div>
      </CardContent>
      <CardFooter className="flex items-center justify-between p-4 pt-0">
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
            className="gap-2"
          >
            <Plus className="h-4 w-4" />
            Добави
          </Button>
        </div>
      </CardFooter>
    </Card>
  )
}
