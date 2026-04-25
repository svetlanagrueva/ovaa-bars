import Link from "next/link"
import { ProductCard } from "@/components/products/product-card"
import { type Product } from "@/lib/products"

interface ProductsSectionProps {
  products: Product[]
  inventoryMap: Record<string, number>
}

export function ProductsSection({ products, inventoryMap }: ProductsSectionProps) {
  return (
    <section className="bg-card py-12 sm:py-16 lg:py-24">
      <div className="mx-auto max-w-7xl px-5 sm:px-6 lg:px-8">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.25em] text-muted-foreground sm:text-[11px] sm:tracking-[0.3em]">
              Продукти
            </p>
            <h2 className="mt-3 text-[24px] font-light tracking-[-0.02em] text-foreground sm:mt-4 sm:text-3xl lg:text-4xl">
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

        <div className="mt-6 grid grid-cols-2 gap-3 sm:mt-10 sm:gap-5 lg:grid-cols-3 lg:gap-6">
          {products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              soldOut={product.id in inventoryMap && inventoryMap[product.id] === 0}
            />
          ))}
        </div>

        <div className="mt-8 sm:hidden">
          <Link
            href="/products"
            className="inline-flex w-full items-center justify-center gap-3 rounded-full border border-border/60 px-6 py-3 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:bg-muted/30 hover:text-accent"
          >
            Виж всички
          </Link>
        </div>
      </div>
    </section>
  )
}
