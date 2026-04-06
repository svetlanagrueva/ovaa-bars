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
        <div className="mx-auto max-w-7xl px-6 py-14 sm:px-6 sm:py-18 lg:px-8 lg:py-22">
          <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-14">
            <div className="max-w-xl">
              <p className="text-[11px] font-medium uppercase tracking-[0.32em] text-muted-foreground">
                Egg Origin — Яйчен Протеин
              </p>

              <h1 className="mt-6 text-balance text-4xl font-light leading-[1.02] tracking-[-0.04em] text-foreground sm:text-5xl lg:text-6xl">
                Чиста храна
                <span className="block text-muted-foreground">
                  за хора с цел
                </span>
              </h1>

              <p className="mt-6 max-w-md text-sm leading-7 text-muted-foreground">
                20g пълноценен яйчен протеин в прецизно създадена формула —
                без суроватка, без добавена захар и без излишни съставки.
              </p>

              <div className="mt-10 flex flex-col gap-3 sm:flex-row">
                <Button
                  asChild
                  size="lg"
                  className="h-11 gap-2 rounded-full bg-foreground px-6 text-[10px] uppercase tracking-[0.16em] text-background hover:opacity-90"
                >
                  <Link href="/products">
                    Виж продуктите
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </div>

            <div className="relative aspect-[4/5] overflow-hidden rounded-[28px] bg-muted sm:rounded-[32px] lg:aspect-square">
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

      {/* Why Egg White Section */}
      <section className="bg-background pb-4 pt-16 sm:pt-20 lg:pt-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="grid gap-10 lg:grid-cols-12 lg:gap-10">
            {/* Left column — heading + material image (desktop only) */}
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

                <p className="mt-6 text-sm leading-7 text-muted-foreground sm:mt-8">
                  Прецизно създаден за хора, които търсят чистота, лекота и
                  функционалност в ежедневния си ритъм.
                </p>
              </div>

              {/* Material image — desktop only */}
              <div className="mt-12 hidden lg:block">
                <div className="overflow-hidden rounded-[28px] bg-muted">
                  <img
                    src="/images/egg-origin-material.png"
                    alt="Минималистичен материален детайл с двата вкуса в меки неутрални тонове"
                    className="h-[360px] w-full object-cover"
                  />
                </div>
              </div>
            </div>

            {/* Right column — anchor image + benefits */}
            <div className="lg:col-span-8">
              <div className="grid gap-6 sm:gap-8 lg:gap-8">
                {/* Anchor image */}
                <div>
                  <div className="overflow-hidden rounded-[24px] bg-muted sm:rounded-[28px] lg:rounded-[32px]">
                    <img
                      src="/images/egg-origin-anchor.png"
                      alt="Минимална performance среда с премиум и тихо излъчване"
                      className="h-[200px] w-full object-cover object-[40%_50%] sm:h-[260px] lg:h-[420px]"
                    />
                  </div>
                </div>

                {/* Mobile benefits — compact stacked list */}
                <div className="space-y-6 lg:hidden">
                  <div className="border-t border-border/60 pt-6">
                    <span className="text-xs tracking-[0.3em] text-muted-foreground">
                      01
                    </span>
                    <h3 className="mt-3 text-base font-medium text-foreground">
                      Пълноценен Протеин
                    </h3>
                    <p className="mt-2 text-sm leading-7 text-muted-foreground">
                      Всички есенциални аминокиселини в прецизно балансирана форма.
                    </p>
                  </div>

                  <div className="border-t border-border/60 pt-6">
                    <span className="text-xs tracking-[0.3em] text-muted-foreground">
                      02
                    </span>
                    <h3 className="mt-3 text-base font-medium text-foreground">
                      Стабилна енергия
                    </h3>
                    <p className="mt-2 text-sm leading-7 text-muted-foreground">
                      Създаден да поддържа баланс и яснота — в синхрон с ежедневния ти ритъм.
                    </p>
                  </div>

                  <div className="border-t border-border/60 pt-6">
                    <span className="text-xs tracking-[0.3em] text-muted-foreground">
                      03
                    </span>
                    <h3 className="mt-3 text-base font-medium text-foreground">
                      Чиста Формула
                    </h3>
                    <p className="mt-2 text-sm leading-7 text-muted-foreground">
                      Без излишни съставки — само функционален протеин с ясна роля в твоята система.
                    </p>
                  </div>
                </div>

                {/* Desktop benefits — unified spec row */}
                <div className="hidden border-t border-border/60 lg:grid lg:grid-cols-3">
                  <div className="py-8 pr-6 xl:py-10">
                    <span className="text-xs tracking-[0.3em] text-muted-foreground">
                      01
                    </span>

                    <h3 className="mt-5 text-base font-medium text-foreground">
                      Пълноценен Протеин
                    </h3>

                    <p className="mt-3 max-w-sm text-sm leading-7 text-muted-foreground">
                      Всички есенциални аминокиселини в прецизно балансирана форма.
                    </p>
                  </div>

                  <div className="border-l border-border/60 px-6 py-8 xl:py-10">
                    <span className="text-xs tracking-[0.3em] text-muted-foreground">
                      02
                    </span>

                    <h3 className="mt-5 text-base font-medium text-foreground">
                      Стабилна енергия
                    </h3>

                    <p className="mt-3 max-w-sm text-sm leading-7 text-muted-foreground">
                      Създаден да поддържа баланс и яснота — в синхрон с ежедневния ти ритъм.
                    </p>
                  </div>

                  <div className="border-l border-border/60 py-8 pl-6 xl:py-10">
                    <span className="text-xs tracking-[0.3em] text-muted-foreground">
                      03
                    </span>

                    <h3 className="mt-5 text-base font-medium text-foreground">
                      Чиста Формула
                    </h3>

                    <p className="mt-3 max-w-sm text-sm leading-7 text-muted-foreground">
                      Без излишни съставки — само функционален протеин с ясна роля в твоята система.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Usage Section */}
      <section className="bg-background py-16 sm:py-20 lg:py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-[11px] font-medium uppercase tracking-[0.38em] text-muted-foreground">
              Как се вписва в деня ти
            </p>

            <h2 className="mt-6 text-4xl font-light leading-[1.05] tracking-[-0.04em] text-foreground sm:text-5xl">
              Създаден за ритъма
              <span className="block text-muted-foreground">
                на модерния професионалист
              </span>
            </h2>

            <p className="mt-6 max-w-xl text-sm leading-7 text-muted-foreground">
              От натоварени сутрини до по-тихи моменти на баланс — Egg Origin е
              създаден да бъде естествена част от ежедневието ти.
            </p>
          </div>

          <div className="mt-12 grid gap-8 sm:gap-10 lg:grid-cols-3 lg:gap-8">
            {/* Moment 1 */}
            <div>
              <div className="overflow-hidden rounded-[24px] bg-muted">
                <img
                  src="/images/usage-meetings.png"
                  alt="Минимална работна среда с тихо премиум излъчване"
                  className="h-[220px] w-full object-cover"
                />
              </div>

              <h3 className="mt-5 text-base font-medium text-foreground">
                Между срещи
              </h3>

              <p className="mt-3 text-sm leading-7 text-muted-foreground">
                Когато графикът е плътен, а фокусът има значение — чиста и удобна
                опция за междинен момент през деня.
              </p>
            </div>

            {/* Moment 2 */}
            <div>
              <div className="overflow-hidden rounded-[24px] bg-muted">
                <img
                  src="/images/usage-workout.png"
                  alt="Кратък post-workout момент с минималистична performance естетика"
                  className="h-[220px] w-full object-cover"
                />
              </div>

              <h3 className="mt-5 text-base font-medium text-foreground">
                След кратка тренировка
              </h3>

              <p className="mt-3 text-sm leading-7 text-muted-foreground">
                Практичен избор за динамични сутрини и бърз преход обратно към
                работния ритъм.
              </p>
            </div>

            {/* Moment 3 */}
            <div>
              <div className="overflow-hidden rounded-[24px] bg-muted">
                <img
                  src="/images/usage-reset.png"
                  alt="Спокоен момент на баланс в меки неутрални тонове"
                  className="h-[220px] w-full object-cover"
                />
              </div>

              <h3 className="mt-5 text-base font-medium text-foreground">
                В момент на баланс
              </h3>

              <p className="mt-3 text-sm leading-7 text-muted-foreground">
                За по-тихите части на деня — когато търсиш лекота, яснота и
                предвидимост в избора си.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Products Section */}
      <section className="bg-background py-16 sm:py-20 lg:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.4em] text-muted-foreground">
                Продукти
              </p>
              <h2 className="mt-4 text-3xl font-light tracking-wide text-foreground sm:text-4xl">
                Избери своя вкус
              </h2>
            </div>
            <Link
              href="/products"
              className="hidden text-[10px] font-medium uppercase tracking-[0.3em] text-muted-foreground underline-offset-4 hover:text-foreground sm:block"
            >
              Виж всички
            </Link>
          </div>
          <div className="mt-10 grid grid-cols-2 gap-3 sm:mt-12 sm:gap-5 lg:grid-cols-3 lg:gap-6">
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
      <section className="bg-background py-16 sm:py-20 lg:py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="relative overflow-hidden rounded-[28px] border border-border/60 bg-muted/40 px-6 py-12 sm:rounded-[32px] sm:px-10 sm:py-16 lg:px-14 lg:py-20">
            <Image
              src="/images/enso-arc.png"
              alt=""
              width={520}
              height={520}
              className="pointer-events-none absolute -right-16 -top-20 opacity-[0.06] [filter:grayscale(1)]"
              aria-hidden="true"
            />

            <div className="relative max-w-2xl">
              <p className="text-[11px] font-medium uppercase tracking-[0.38em] text-muted-foreground">
                Безплатна доставка до офис над 30 €
              </p>

              <h2 className="mt-6 text-4xl font-light leading-[1.05] tracking-[-0.04em] text-foreground sm:text-5xl">
                Чист протеин.
                <span className="block text-muted-foreground">
                  Всеки ден.
                </span>
              </h2>

              <p className="mt-6 max-w-md text-sm leading-7 text-muted-foreground">
                Без компромиси. Доставка до 2 работни дни в цяла България.
              </p>

              <div className="mt-8 sm:mt-10">
                <Button
                  asChild
                  size="lg"
                  className="h-11 rounded-full bg-foreground px-6 text-[10px] uppercase tracking-[0.16em] text-background transition-opacity hover:opacity-90"
                >
                  <Link href="/products">
                    Поръчай
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>
      {/* Benefits Strip */}
      <section className="border-y border-border bg-background pb-4 py-12">
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
      {/* Flavor Sections */}
      <div className="bg-background">
        {/* WHITE CHOCOLATE & RASPBERRY */}
        <section className="relative overflow-hidden py-16 sm:py-20 lg:py-24">
          <div className="mx-auto grid max-w-7xl items-center gap-14 px-6 lg:grid-cols-12 lg:gap-10 lg:px-8">
            <div className="lg:col-span-5">
              <p className="text-[11px] font-medium uppercase tracking-[0.38em] text-muted-foreground">
                Почивка и Възстановяване
              </p>

              <h2 className="font-serif mt-6 text-4xl leading-[0.98] tracking-[-0.03em] text-foreground sm:text-5xl lg:text-6xl">
                Бял шоколад
                <span className="block text-muted-foreground">
                  & малина
                </span>
              </h2>

              <p className="mt-8 max-w-md text-[15px] leading-7 text-muted-foreground">
                По-лека, по-мека енергия — създадена за баланс, възстановяване и
                ежедневен ритъм без излишна тежест.
              </p>

              <div className="mt-10 flex items-center gap-4">
                <div className="h-px w-10 bg-border" />
                <span className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">
                   Лекота / Баланс / Нежност
                </span>
              </div>
            </div>

            <div className="lg:col-span-7">
              <div className="overflow-hidden rounded-[32px] bg-muted">
                <img
                  src="/images/egg-origin-white-hero.png"
                  alt="Egg Origin White Chocolate & Raspberry"
                  className="h-[460px] w-full object-cover sm:h-[520px]"
                />
              </div>
            </div>
          </div>
        </section>

        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="h-px bg-border/60" />
        </div>

        {/* DARK CHOCOLATE */}
        <section className="relative overflow-hidden py-16 sm:py-20 lg:py-24">
          <div className="mx-auto grid max-w-7xl items-center gap-14 px-6 lg:grid-cols-12 lg:gap-10 lg:px-8">
            <div className="order-2 lg:order-1 lg:col-span-7">
              <div className="overflow-hidden rounded-[32px] bg-muted">
                <img
                  src="/images/egg-origin-dark-hero.png"
                  alt="Egg Origin Dark Chocolate"
                  className="h-[460px] w-full object-cover sm:h-[520px]"
                />
              </div>
            </div>

            <div className="order-1 lg:order-2 lg:col-span-4 lg:col-start-9">
              <p className="text-[11px] font-medium uppercase tracking-[0.38em] text-muted-foreground">
                Стабилно прeдставяне
              </p>

              <h2 className="font-serif mt-6 text-4xl leading-[0.98] tracking-[-0.03em] text-foreground sm:text-5xl lg:text-6xl">
                Тъмен
                <span className="block text-muted-foreground">
                  Шоколад
                </span>
              </h2>

              <p className="mt-8 max-w-md text-[15px] leading-7 text-muted-foreground">
                По-плътно, по-структурирано присъствие — за фокус, постоянство и
                тиха увереност в ежедневното представяне.
              </p>

              <div className="mt-10 flex items-center gap-4">
                <div className="h-px w-10 bg-border" />
                <span className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">
                  Фокус / Дисциплина / Увереност
                </span>
              </div>
            </div>
          </div>
        </section>
      </div>

    </div>
  )
}
