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
      <div className={isLarge ? "flex items-center gap-1" : "flex flex-col"}>
        <span
          className={`tabular-nums tracking-[0.01em] ${onSale ? "text-accent-price" : "text-foreground"} ${
            isLarge ? "text-2xl font-medium" : "text-sm font-semibold"
          }`}
        >
          {formatPrice(product.priceInCents * quantity)}
        </span>
        {onSale && (
          <span className={`font-normal text-foreground/50 ${isLarge ? "text-lg" : "text-xs"}`}>
            <span className="line-through">{formatPrice(product.originalPriceInCents! * quantity)}</span>
          </span>
        )}
      </div>

      {showPerBar && (
        <p className="mt-1 text-[11px] tracking-[0.02em] text-muted-foreground">
          {formatPrice(Math.round(product.priceInCents / product.barsCount))} на бар
        </p>
      )}
    </div>
  )
}