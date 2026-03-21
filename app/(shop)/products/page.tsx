import type { Metadata } from "next"
import { ProductCard } from "@/components/products/product-card"
import { getProductsWithSales } from "@/lib/sales"

export const metadata: Metadata = {
  title: "Продукти - Egg Origin",
  description: "Протеинови барове Egg Origin с яйчен белтък. Високо съдържание на протеин, без суроватка, без добавена захар.",
}

export const revalidate = 60

export default async function ProductsPage() {
  const PRODUCTS = await getProductsWithSales()
  return (
    <div className="bg-background py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <p className="text-xs font-medium uppercase tracking-[0.3em] text-muted-foreground">
            Нашите Продукти
          </p>
          <h1 className="mt-4 text-3xl font-light tracking-tight text-foreground sm:text-4xl">
            Чист протеин, на ново ниво
          </h1>
          <p className="mt-6 text-base leading-relaxed text-muted-foreground">
            Всеки бар Egg Origin съдържа 20g пълноценен яйчен протеин с всички есенциални аминокиселини.
            Без суроватка, без добавена захар, без излишни съставки - само функционално хранене за ежедневна употреба.
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
            Защо Egg Origin
          </p>
          <div className="mt-8 grid gap-12 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-sm font-medium text-foreground">Пълноценен Протеин</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Яйчният протеин съдържа всички есенциални аминокиселини за оптимално мускулно възстановяване.
              </p>
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Без Добавена Захар</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Подсладен естествено, без добавени захари. Перфектен за чисто хранене.
              </p>
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Лесно Смилане</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Без подуване и дискомфорт. Яйчният белтък е естествено без лактоза.
              </p>
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Чиста Етикета</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Без млечни продукти, без суроватка, без излишни съставки. Само функционален протеин.
              </p>
            </div>
          </div>
        </div>

        {/* Shipping Info */}
        <div className="mt-16 border-t border-border pt-8 text-center">
          <p className="text-sm text-muted-foreground">
            Безплатна доставка до офис при поръчки над 30 €. Доставка до 2 работни дни в цяла България.
          </p>
        </div>
      </div>
    </div>
  )
}
