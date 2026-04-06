import { formatPrice, isOnSale, getDiscountPercentage, type Product } from "@/lib/products"

interface PriceDisplayProps {
  product: Product
  quantity?: number
  showPerBar?: boolean
  size?: "sm" | "lg"
}

export function PriceDisplay({
  product,
  quantity = 1,
  showPerBar = false,
  size = "sm",
}: PriceDisplayProps) {
  const onSale = isOnSale(product)
  const isLarge = size === "lg"

  return (
    <div>
      <div className={isLarge ? "flex items-center gap-2" : "relative"}>
        {onSale && (
          <span className={`line-through text-muted-foreground ${isLarge ? "text-lg" : "absolute bottom-full text-[10px] leading-none mb-0.5"}`}>
            {formatPrice(product.originalPriceInCents! * quantity)}
          </span>
        )}

        <span
          className={`tracking-[0.01em] text-foreground ${
            isLarge ? "text-2xl font-light" : "text-sm font-medium"
          }`}
        >
          {formatPrice(product.priceInCents * quantity)}
        </span>
      </div>

      {showPerBar && (
        <p className="mt-1 text-[11px] tracking-[0.02em] text-muted-foreground">
          {formatPrice(Math.round(product.priceInCents / product.barsCount))} на бар
        </p>
      )}
    </div>
  )
}