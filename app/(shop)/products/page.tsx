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
    <div className="bg-background py-12 sm:py-16 lg:py-24">
      <div className="mx-auto max-w-7xl px-5 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <p className="text-[10px] font-medium uppercase tracking-[0.25em] text-muted-foreground sm:text-[11px] sm:tracking-[0.3em]">
            Продукти
          </p>
          <h1 className="mt-4 text-[32px] font-light leading-[1.1] tracking-[-0.03em] text-foreground sm:mt-6 sm:text-4xl sm:leading-[1.05] sm:tracking-[-0.04em] lg:text-5xl">
            Чист протеин
              <span className="block text-muted-foreground">Всеки ден</span>
          </h1>
          <p className="mt-4 text-[13px] leading-[1.7] text-muted-foreground sm:mt-6 sm:max-w-xl sm:text-sm sm:leading-7">
            Пълноценен яйчен протеин с пълен аминокиселинен профил.
            Без добавена захар и излишни съставки. Създаден за твоето ежедневие.
          </p>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-3 sm:mt-12 sm:gap-5 lg:grid-cols-3 lg:gap-8">
          {PRODUCTS.map((product) => (
            <ProductCard key={product.id} product={product} soldOut={inventoryMap.has(product.id) && inventoryMap.get(product.id) === 0} />
          ))}
        </div>

        {/* Benefits Grid */}
        <div className="mt-16 border-t border-border pt-12 sm:mt-20 sm:pt-14 lg:mt-24 lg:pt-16">
          <p className="text-[10px] font-medium uppercase tracking-[0.25em] text-muted-foreground sm:text-[11px] sm:tracking-[0.3em]">
            Защо Egg Origin
          </p>
          <div className="mt-6 grid gap-8 sm:mt-8 sm:grid-cols-2 sm:gap-12 lg:grid-cols-4">
            <div>
              <p className="text-sm font-medium tracking-[-0.01em] text-foreground">Пълноценен Протеин</p>
              <p className="mt-2 text-[13px] leading-[1.6] text-muted-foreground sm:text-sm">
                Всички есенциални аминокиселини в прецизно балансирана формула.
              </p>
            </div>
            <div>
              <p className="text-sm font-medium tracking-[-0.01em] text-foreground">Без Добавена Захар</p>
              <p className="mt-2 text-[13px] leading-[1.6] text-muted-foreground sm:text-sm">
                Подсладен естествено, без добавени захари.
              </p>
            </div>
            <div>
              <p className="text-sm font-medium tracking-[-0.01em] text-foreground">Стабилна Енергия</p>
              <p className="mt-2 text-[13px] leading-[1.6] text-muted-foreground sm:text-sm">
                Равномерна енергия през целия ден.
              </p>
            </div>
            <div>
              <p className="text-sm font-medium tracking-[-0.01em] text-foreground">Чист Етикет</p>
              <p className="mt-2 text-[13px] leading-[1.6] text-muted-foreground sm:text-sm">
                Функционален протеин. Без излишни съставки.
              </p>
            </div>
          </div>
        </div>

        {/* Shipping Info */}
        <div className="mt-14 border-t border-border pt-10 sm:mt-20 sm:pt-14">
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center sm:gap-4">
            <div className="hidden h-px w-10 bg-accent/50 sm:block" />
            <p className="text-center text-[13px] leading-[1.6] text-muted-foreground sm:text-sm">
              Безплатна доставка до офис при поръчки над 30 €. Доставка до 3 работни дни в цяла България.
            </p>
            <div className="hidden h-px w-10 bg-accent/50 sm:block" />
          </div>
        </div>
      </div>
    </div>
  )
}
