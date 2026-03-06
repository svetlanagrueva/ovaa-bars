import type { Metadata } from "next"
import { ProductCard } from "@/components/products/product-card"
import { PRODUCTS } from "@/lib/products"

export const metadata: Metadata = {
  title: "Products - Ovva Sculpt",
  description: "Shop Ovva Sculpt clean-label egg white protein bars. High protein, no whey, no added sugar.",
}

export default function ProductsPage() {
  return (
    <div className="bg-background py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <p className="text-xs font-medium uppercase tracking-[0.3em] text-muted-foreground">
            Our Products
          </p>
          <h1 className="mt-4 text-3xl font-light tracking-tight text-foreground sm:text-4xl">
            Clean protein, elevated
          </h1>
          <p className="mt-6 text-base leading-relaxed text-muted-foreground">
            Each Ovva Sculpt bar delivers 20g of complete egg white protein with all essential amino acids. 
            No whey, no added sugar, no unnecessary ingredients - just functional nutrition for everyday use.
          </p>
        </div>

        <div className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {PRODUCTS.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>

        {/* Benefits Grid */}
        <div className="mt-24 border-t border-border pt-16">
          <p className="text-xs font-medium uppercase tracking-[0.3em] text-muted-foreground">
            Why Ovva Sculpt
          </p>
          <div className="mt-8 grid gap-12 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-sm font-medium text-foreground">Complete Protein</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Egg white protein contains all essential amino acids for optimal muscle recovery.
              </p>
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">No Added Sugar</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Sweetened naturally without any added sugars. Perfect for a clean diet.
              </p>
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Easy Digestion</p>
              <p className="mt-2 text-sm text-muted-foreground">
                No bloating or discomfort. Egg white is naturally lactose-free.
              </p>
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Clean Label</p>
              <p className="mt-2 text-sm text-muted-foreground">
                No dairy, no whey, no unnecessary ingredients. Just functional protein.
              </p>
            </div>
          </div>
        </div>

        {/* Shipping Info */}
        <div className="mt-16 border-t border-border pt-8 text-center">
          <p className="text-sm text-muted-foreground">
            Free shipping on orders over 50 лв. Delivery within 2 business days across Bulgaria.
          </p>
        </div>
      </div>
    </div>
  )
}
