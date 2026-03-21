import { Badge } from "@/components/ui/badge"
import { formatPrice, isOnSale, getDiscountPercentage, type Product } from "@/lib/products"

interface PriceDisplayProps {
  product: Product
  quantity?: number
  showPerBar?: boolean
  size?: "sm" | "lg"
}

export function PriceDisplay({ product, quantity = 1, showPerBar = false, size = "sm" }: PriceDisplayProps) {
  const onSale = isOnSale(product)
  const discount = getDiscountPercentage(product)
  const isLarge = size === "lg"

  return (
    <div>
      <div className="flex items-center gap-2">
        {onSale && (
          <Badge variant="destructive" className="text-xs">
            -{discount}%
          </Badge>
        )}
        {onSale && (
          <span className={`line-through text-muted-foreground ${isLarge ? "text-xl" : "text-sm"}`}>
            {formatPrice(product.originalPriceInCents! * quantity)}
          </span>
        )}
        <span className={`font-bold ${onSale ? "text-destructive" : "text-foreground"} ${isLarge ? "text-3xl font-light" : "text-xl"}`}>
          {formatPrice(product.priceInCents * quantity)}
        </span>
      </div>
      {showPerBar && (
        <p className="mt-1 text-sm text-muted-foreground">
          {onSale && (
            <span className="line-through mr-1">
              {formatPrice(Math.round(product.originalPriceInCents! / product.barsCount))}
            </span>
          )}
          {formatPrice(Math.round(product.priceInCents / product.barsCount))} на бар
        </p>
      )}
    </div>
  )
}
