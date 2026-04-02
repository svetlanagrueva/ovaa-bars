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
                <span className="italic">хора с цел</span>
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
          </div>
        </div>
      </section>

            {/* Why Egg White Section */}
<section className="bg-background py-24 sm:py-32">
  <div className="mx-auto max-w-7xl px-6 lg:px-8">
    <div className="grid gap-12 lg:grid-cols-12 lg:gap-10">
      {/* Left column — heading + material image */}
      <div className="lg:col-span-4">
        <div className="max-w-md">
          <p className="text-[11px] font-medium uppercase tracking-[0.38em] text-muted-foreground">
            Защо Яйчен Белтък
          </p>

          <h2 className="mt-6 text-4xl font-light leading-[1.05] tracking-[-0.04em] text-foreground sm:text-5xl">
            По-умният избор
            <span className="block text-muted-foreground">
              на протеин
            </span>
          </h2>

          <p className="mt-8 text-sm leading-7 text-muted-foreground">
            Прецизно създаден за хора, които търсят чистота, лекота и
            функционалност в ежедневния си ритъм.
          </p>
        </div>

        {/* Material image — desktop only */}
        <div className="mt-12 hidden lg:block">
          <div className="overflow-hidden rounded-[28px] bg-muted">
            <img
              src="/images/egg-origin-material.png"
              alt="Минималистичен материален детайл в меки шампански тонове"
              className="h-[360px] w-full object-cover"
            />
          </div>
        </div>
      </div>

      {/* Right column — anchor image + 3 benefits */}
      <div className="lg:col-span-8">
        <div className="grid gap-8 sm:gap-10">
          {/* Anchor image */}
          <div>
            <div className="overflow-hidden rounded-[24px] bg-muted sm:rounded-[28px] lg:rounded-[32px]">
              <img
                src="/images/egg-origin-anchor.png"
                alt="Минимална performance среда с премиум и тихо излъчване"
                className="h-[240px] w-full object-cover object-[40%_50%] sm:h-[320px] lg:h-[420px]"
              />
            </div>
          </div>

          {/* 3 benefits */}
          <div className="grid gap-8 sm:gap-10 md:grid-cols-3 md:gap-6">
            {/* Benefit 1 */}
            <div>
              <div className="flex items-center gap-6">
                <span className="text-xs tracking-[0.3em] text-muted-foreground">
                  01
                </span>
                <div className="h-px flex-1 bg-border/60" />
              </div>

              <h3 className="mt-7 text-base font-medium text-foreground">
                Пълноценен Протеин
              </h3>

              <p className="mt-4 max-w-sm text-sm leading-7 text-muted-foreground">
                Всички есенциални аминокиселини в прецизно балансирана форма.
              </p>
            </div>

            {/* Benefit 2 */}
            <div>
              <div className="flex items-center gap-6">
                <span className="text-xs tracking-[0.3em] text-muted-foreground">
                  02
                </span>
                <div className="h-px flex-1 bg-border/60" />
              </div>

              <h3 className="mt-7 text-base font-medium text-foreground">
                Стабилна енергия
              </h3>

              <p className="mt-4 max-w-sm text-sm leading-7 text-muted-foreground">
                Създаден да поддържа баланс и яснота — в синхрон с ежедневния ти ритъм.
              </p>
            </div>

            {/* Benefit 3 */}
            <div>
              <div className="flex items-center gap-6">
                <span className="text-xs tracking-[0.3em] text-muted-foreground">
                  03
                </span>
                <div className="h-px flex-1 bg-border/60" />
              </div>

              <h3 className="mt-7 text-base font-medium text-foreground">
                Чиста Формула
              </h3>

              <p className="mt-4 max-w-sm text-sm leading-7 text-muted-foreground">
                Без излишни съставки — само функционален протеин с ясна
                роля в твоята система.
              </p>
            </div>
          </div>
        </div>
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
      <section className="overflow-hidden bg-foreground py-24 sm:py-32">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="relative mx-auto max-w-xl">
            <Image
              src="/images/enso-arc.png"
              alt=""
              width={600}
              height={600}
              className="pointer-events-none absolute bottom-[-10rem] right-[-1.9rem] opacity-[0.11] mix-blend-screen [filter:invert(1)_sepia(0.6)_hue-rotate(315deg)_saturate(1.2)] sm:bottom-[-21rem] sm:right-[-7rem]"
              aria-hidden="true"
            />
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
