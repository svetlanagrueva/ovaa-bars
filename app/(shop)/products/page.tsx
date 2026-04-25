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
    <div className="bg-background py-16 sm:py-20 lg:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-muted-foreground">
            Продукти
          </p>
          <h1 className="mt-6 text-4xl font-light leading-[1.05] tracking-[-0.04em] text-foreground sm:text-5xl">
            Чист протеин
              <span className="block text-muted-foreground">Всеки ден</span>
          </h1>
          <p className="mt-6 max-w-xl text-sm leading-7 text-muted-foreground">
            Пълноценен яйчен протеин с пълен аминокиселинен профил.
            Без добавена захар и излишни съставки. Създаден за твоето ежедневие.
          </p>
        </div>

        <div className="mt-14 grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-3 lg:gap-8">
          {PRODUCTS.map((product) => (
            <ProductCard key={product.id} product={product} soldOut={inventoryMap.has(product.id) && inventoryMap.get(product.id) === 0} />
          ))}
        </div>

        {/* Benefits Grid */}
        <div className="mt-24 border-t border-border pt-16">
          <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-muted-foreground">
            Защо Egg Origin
          </p>
          <div className="mt-8 grid gap-12 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-sm font-medium tracking-[-0.01em] text-foreground">Пълноценен Протеин</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Всички есенциални аминокиселини в прецизно балансирана формула.
              </p>
            </div>
            <div>
              <p className="text-sm font-medium tracking-[-0.01em] text-foreground">Без Добавена Захар</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Подсладен естествено, без добавени захари.
              </p>
            </div>
            <div>
              <p className="text-sm font-medium tracking-[-0.01em] text-foreground">Стабилна Енергия</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Равномерна енергия през целия ден.
              </p>
            </div>
            <div>
              <p className="text-sm font-medium tracking-[-0.01em] text-foreground">Чист Етикет</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Функционален протеин. Без излишни съставки.
              </p>
            </div>
          </div>
        </div>

        {/* Shipping Info */}
        <div className="mt-20 border-t border-border pt-14">
          <div className="flex items-center justify-center gap-4">
            <div className="h-px w-10 bg-accent/50" />
            <p className="text-center text-sm text-muted-foreground">
              Безплатна доставка до офис при поръчки над 30 €. Доставка до 2 работни дни в цяла България.
            </p>
            <div className="h-px w-10 bg-accent/50" />
          </div>
        </div>
      </div>
    </div>
  )
}
