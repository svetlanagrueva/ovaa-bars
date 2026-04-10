import type { Metadata } from "next"
import { ProductCard } from "@/components/products/product-card"
import { getProductsWithSales } from "@/lib/sales"
import { getInventoryMap } from "@/lib/inventory"

export const metadata: Metadata = {
  title: "Продукти - Egg Origin",
  description: "Протеинови барове Egg Origin с яйчен белтък. Високо съдържание на протеин, без суроватка, без добавена захар.",
}

export const revalidate = 60

export default async function ProductsPage() {
  const [PRODUCTS, inventoryMap] = await Promise.all([
    getProductsWithSales(),
    getInventoryMap(),
  ])
  return (
    <div className="bg-background">
      {/* Hero Section */}
      <section className="py-16 sm:py-20 lg:py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-muted-foreground">
              Продукти
            </p>
            <h1 className="mt-6 text-4xl font-light leading-[1.05] tracking-[-0.04em] text-foreground sm:text-5xl">
              Чист протеин
              <span className="block text-muted-foreground">Всеки ден</span>
            </h1>
            <p className="mt-6 max-w-xl text-sm leading-7 text-muted-foreground">
              Пълноценен яйчен протеин с всички есенциални аминокиселини.
              Без добавена захар и излишни съставки. Създаден за твоето ежедневие.
            </p>
          </div>

          <div className="mt-14 grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-3 lg:gap-8">
            {PRODUCTS.map((product) => (
              <ProductCard key={product.id} product={product} soldOut={inventoryMap.has(product.id) && inventoryMap.get(product.id) === 0} />
            ))}
          </div>
        </div>
      </section>

      {/* Benefits Grid */}
      <section className="border-t border-border/60 py-16 sm:py-20 lg:py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-muted-foreground">
            Защо Egg Origin
          </p>
          <div className="mt-12 grid gap-4 sm:gap-5 lg:mt-14 lg:grid-cols-4 lg:gap-6">
            <div className="group relative overflow-hidden rounded-[26px] border border-border/40 bg-card/80 p-8 backdrop-blur-md transition-all duration-500 hover:border-accent/30 hover:shadow-lg hover:shadow-accent/[0.05]">
              <div className="absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
              <span className="text-[11px] font-medium tracking-[0.3em] text-muted-foreground">
                01
                <span className="ml-2 inline-block h-px w-4 bg-accent/30 transition-all duration-300 group-hover:w-8 group-hover:bg-accent/50" />
              </span>
              <h3 className="mt-6 text-base font-medium tracking-[-0.01em] text-foreground">
                Пълноценен Протеин
              </h3>
              <p className="mt-3 text-sm leading-7 text-muted-foreground">
                Всички есенциални аминокиселини в прецизно балансирана форма.
              </p>
            </div>

            <div className="group relative overflow-hidden rounded-[26px] border border-border/40 bg-card/80 p-8 backdrop-blur-md transition-all duration-500 hover:border-accent/30 hover:shadow-lg hover:shadow-accent/[0.05]">
              <div className="absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
              <span className="text-[11px] font-medium tracking-[0.3em] text-muted-foreground">
                02
                <span className="ml-2 inline-block h-px w-4 bg-accent/30 transition-all duration-300 group-hover:w-8 group-hover:bg-accent/50" />
              </span>
              <h3 className="mt-6 text-base font-medium tracking-[-0.01em] text-foreground">
                Без Добавена Захар
              </h3>
              <p className="mt-3 text-sm leading-7 text-muted-foreground">
                Подсладен естествено, без добавени захари.
              </p>
            </div>

            <div className="group relative overflow-hidden rounded-[26px] border border-border/40 bg-card/80 p-8 backdrop-blur-md transition-all duration-500 hover:border-accent/30 hover:shadow-lg hover:shadow-accent/[0.05]">
              <div className="absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
              <span className="text-[11px] font-medium tracking-[0.3em] text-muted-foreground">
                03
                <span className="ml-2 inline-block h-px w-4 bg-accent/30 transition-all duration-300 group-hover:w-8 group-hover:bg-accent/50" />
              </span>
              <h3 className="mt-6 text-base font-medium tracking-[-0.01em] text-foreground">
                Стабилна Енергия
              </h3>
              <p className="mt-3 text-sm leading-7 text-muted-foreground">
                Равномерна енергия през целия ден.
              </p>
            </div>

            <div className="group relative overflow-hidden rounded-[26px] border border-border/40 bg-card/80 p-8 backdrop-blur-md transition-all duration-500 hover:border-accent/30 hover:shadow-lg hover:shadow-accent/[0.05]">
              <div className="absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
              <span className="text-[11px] font-medium tracking-[0.3em] text-muted-foreground">
                04
                <span className="ml-2 inline-block h-px w-4 bg-accent/30 transition-all duration-300 group-hover:w-8 group-hover:bg-accent/50" />
              </span>
              <h3 className="mt-6 text-base font-medium tracking-[-0.01em] text-foreground">
                Чист Етикет
              </h3>
              <p className="mt-3 text-sm leading-7 text-muted-foreground">
                Функционален протеин. Без излишни съставки.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Shipping Info */}
      <section className="border-t border-border/60 py-12 sm:py-16">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="flex items-center justify-center gap-4">
            <div className="h-px w-10 bg-accent/50" />
            <p className="text-center text-sm text-muted-foreground">
              Безплатна доставка до офис при поръчки над 30 EUR. Доставка до 2 работни дни в цяла България.
            </p>
            <div className="h-px w-10 bg-accent/50" />
          </div>
        </div>
      </section>
    </div>
  )
}
