import Image from "next/image"
import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ProductCard } from "@/components/products/product-card"
import { getProductsWithSales } from "@/lib/sales"
import { getInventoryMap } from "@/lib/inventory"

export const revalidate = 60

export default async function HomePage() {
  const [PRODUCTS, inventoryMap] = await Promise.all([
    getProductsWithSales(),
    getInventoryMap(),
  ])
  return (
    <div>
      {/* Hero Section */}
      <section className="relative bg-background">
        <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 sm:py-32 lg:px-8">
          <div className="grid items-center gap-16 lg:grid-cols-2">
            <div className="max-w-xl">
              <p className="text-[10px] font-medium uppercase tracking-[0.4em] text-muted-foreground">
                Egg Origin — Яйчен Протеин
              </p>
              <h1 className="mt-8 text-balance text-4xl font-light tracking-wide text-foreground sm:text-5xl lg:text-6xl">
                Чиста храна за{" "}
                <span className="italic">хора с цели</span>
              </h1>
              <p className="mt-8 text-pretty text-sm leading-loose tracking-wide text-muted-foreground">
                20g пълноценен яйчен протеин. Без суроватка, без добавена захар,
                без излишни съставки. Създаден за ежедневна употреба.
              </p>
              <div className="mt-12 flex flex-col gap-4 sm:flex-row">
                <Button asChild size="lg" className="gap-2 px-8 tracking-widest text-xs uppercase">
                  <Link href="/products">
                    Поръчай
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg" className="px-8 tracking-widest text-xs uppercase">
                  <Link href="/about">За нас</Link>
                </Button>
              </div>
            </div>
            <div className="relative aspect-[4/5] lg:aspect-square">
              <Image
                src="/images/hero-bg.jpg"
                alt="Egg Origin протеинови барове"
                fill
                className="object-cover"
                priority
              />
            </div>
          </div>
        </div>
      </section>

      {/* Benefits Strip */}
      <section className="border-y border-border bg-background py-12">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col items-center divide-y divide-border sm:flex-row sm:divide-x sm:divide-y-0">
            <div className="flex w-full flex-col items-center gap-1 py-6 sm:py-0 sm:px-10">
              <p className="text-3xl font-extralight tracking-tight text-foreground">20g</p>
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Яйчен Протеин</p>
            </div>
            <div className="flex w-full flex-col items-center gap-1 py-6 sm:py-0 sm:px-10">
              <p className="text-3xl font-extralight tracking-tight text-foreground">0g</p>
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Добавена Захар</p>
            </div>
            <div className="flex w-full flex-col items-center gap-1 py-6 sm:py-0 sm:px-10">
              <p className="text-3xl font-extralight tracking-tight text-foreground">100%</p>
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Чиста Етикета</p>
            </div>
            <div className="flex w-full flex-col items-center gap-1 py-6 sm:py-0 sm:px-10">
              <p className="text-3xl font-extralight tracking-tight text-foreground">Без</p>
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Лактоза</p>
            </div>
          </div>
        </div>
      </section>

      {/* Why Egg White Section */}
      <section className="bg-secondary/40 py-24 sm:py-32">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl">
            <p className="text-[10px] font-medium uppercase tracking-[0.4em] text-muted-foreground">
              Защо Яйчен Белтък
            </p>
            <h2 className="mt-6 text-3xl font-light tracking-wide text-foreground sm:text-4xl">
              По-умният избор на протеин
            </h2>
          </div>
          <div className="mx-auto mt-16 grid max-w-5xl gap-0 lg:grid-cols-3">
            <div className="border-t border-border py-10 lg:border-l lg:border-t-0 lg:px-10 lg:first:border-l-0">
              <p className="text-[10px] font-medium uppercase tracking-[0.3em] text-muted-foreground">01</p>
              <h3 className="mt-4 text-sm font-medium tracking-wide text-foreground">Пълноценен Протеин</h3>
              <p className="mt-4 text-sm leading-loose text-muted-foreground">
                Всички есенциални аминокиселини в едно. Оптимален за мускулно възстановяване и ежедневна употреба.
              </p>
            </div>
            <div className="border-t border-border py-10 lg:border-l lg:border-t-0 lg:px-10">
              <p className="text-[10px] font-medium uppercase tracking-[0.3em] text-muted-foreground">02</p>
              <h3 className="mt-4 text-sm font-medium tracking-wide text-foreground">Лесно Смилане</h3>
              <p className="mt-4 text-sm leading-loose text-muted-foreground">
                Естествено без лактоза. Без подуване, без дискомфорт — само чист резултат.
              </p>
            </div>
            <div className="border-t border-border py-10 lg:border-l lg:border-t-0 lg:px-10">
              <p className="text-[10px] font-medium uppercase tracking-[0.3em] text-muted-foreground">03</p>
              <h3 className="mt-4 text-sm font-medium tracking-wide text-foreground">Чиста Етикета</h3>
              <p className="mt-4 text-sm leading-loose text-muted-foreground">
                Без млечни продукти, без суроватка, без добавена захар. Функционален протеин — нищо повече.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Products Section */}
      <section className="bg-background py-24 sm:py-32">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.4em] text-muted-foreground">
                Продукти
              </p>
              <h2 className="mt-4 text-3xl font-light tracking-wide text-foreground sm:text-4xl">
                Избери своята кутия
              </h2>
            </div>
            <Link
              href="/products"
              className="hidden text-[10px] font-medium uppercase tracking-[0.3em] text-muted-foreground underline-offset-4 hover:text-foreground sm:block"
            >
              Виж всички
            </Link>
          </div>
          <div className="mt-12 grid grid-cols-2 gap-3 sm:gap-8 lg:grid-cols-3">
            {PRODUCTS.map((product) => (
              <ProductCard key={product.id} product={product} soldOut={inventoryMap.has(product.id) && inventoryMap.get(product.id) === 0} />
            ))}
          </div>
          <div className="mt-8 text-center sm:hidden">
            <Link href="/products" className="text-[10px] font-medium uppercase tracking-[0.3em] text-muted-foreground hover:text-foreground">
              Виж всички
            </Link>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-foreground py-24 sm:py-32">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-xl">
            <p className="text-[10px] font-medium uppercase tracking-[0.4em] text-background/50">
              Безплатна доставка до офис над 30 €
            </p>
            <h2 className="mt-8 text-3xl font-light tracking-wide text-background sm:text-4xl">
              Чист протеин.<br />
              <span className="italic">Всеки ден.</span>
            </h2>
            <p className="mt-6 text-sm leading-loose text-background/60">
              Без компромиси. Доставка до 2 работни дни в цяла България.
            </p>
            <div className="mt-10">
              <Button asChild size="lg" variant="secondary" className="gap-2 px-8 tracking-widest text-xs uppercase">
                <Link href="/products">
                  Поръчай
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
