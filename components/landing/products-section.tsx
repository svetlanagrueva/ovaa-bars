import Link from "next/link"
import { ProductCard } from "@/components/products/product-card"
import { type Product } from "@/lib/products"

interface ProductsSectionProps {
  products: Product[]
  inventoryMap: Record<string, number>
}

export function ProductsSection({ products, inventoryMap }: ProductsSectionProps) {
  return (
    <section className="bg-background pt-8 pb-16 sm:pt-10 sm:pb-20 lg:pt-12 lg:pb-24">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-muted-foreground">
              Продукти
            </p>
            <h2 className="mt-4 text-3xl font-light tracking-wide text-foreground sm:text-4xl">
              Избери своя вкус
            </h2>
          </div>
          <Link
            href="/products"
            className="hidden items-center gap-3 rounded-full border border-border/60 px-6 py-3 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:bg-muted/30 hover:text-accent sm:inline-flex"
          >
            Виж всички
          </Link>
        </div>

        <div className="mt-10 grid grid-cols-2 gap-3 sm:mt-12 sm:gap-5 lg:grid-cols-3 lg:gap-6">
          {products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              soldOut={product.id in inventoryMap && inventoryMap[product.id] === 0}
            />
          ))}
        </div>

        <div className="mt-8 text-center sm:hidden">
          <Link
            href="/products"
            className="inline-flex items-center gap-3 rounded-full border border-border/60 px-6 py-3 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:bg-muted/30 hover:text-accent"
          >
            Виж всички
          </Link>
        </div>
      </div>
    </section>
  )
}
