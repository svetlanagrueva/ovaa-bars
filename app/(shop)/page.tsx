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
      {/* Hero Section — mobile: stacked text + cropped image; desktop: full-bleed with overlay */}
      <section className="relative overflow-hidden bg-background">
        {/* Desktop hero */}
        <div className="relative hidden h-[70vh] min-h-[560px] w-full sm:block">
          <Image
            src="/images/egg-origin-hero.png"
            alt="Egg Origin протеинови барове"
            fill
            priority
            className="object-cover"
          />

          <div className="absolute inset-0 bg-gradient-to-r from-background/80 via-background/5 to-transparent" />

          <div className="relative z-10 mx-auto flex h-full max-w-7xl items-center px-6 lg:px-8">
            <div className="max-w-xl">
              <p className="text-[11px] font-medium uppercase tracking-[0.32em] text-muted-foreground">
                Egg Origin — Яйчен Протеин
              </p>

              <h1 className="mt-6 text-4xl font-light leading-[1.02] tracking-[-0.04em] text-foreground sm:text-5xl lg:text-6xl">
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
          </div>
        </div>

        {/* Mobile hero — plain text top, image peeking at bottom */}
        <div className="sm:hidden">
          <div className="bg-background px-6 pb-6 pt-14">
            <p className="text-[11px] font-medium uppercase tracking-[0.32em] text-muted-foreground">
              Egg Origin — Яйчен Протеин
            </p>

            <h1 className="mt-6 text-4xl font-light leading-[1.02] tracking-[-0.04em] text-foreground">
              Чиста храна
              <span className="block text-muted-foreground">
                за хора с цел
              </span>
            </h1>

            <p className="mt-6 max-w-md text-sm leading-7 text-muted-foreground">
              20g пълноценен яйчен протеин в прецизно създадена формула —
              без суроватка, без добавена захар и без излишни съставки.
            </p>
          </div>

          <div className="relative h-[320px] w-full overflow-hidden">
            <div className="absolute inset-x-0 top-0 z-10 h-16 bg-gradient-to-b from-background/80 via-background/5 to-transparent" />
            <Image
              src="/images/egg-origin-hero.png"
              alt="Egg Origin протеинови барове"
              fill
              priority
              className="object-cover object-right-bottom scale-[1.3]"
            />

            <div className="absolute inset-x-0 bottom-0 z-10 px-6 pb-8">
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
        </div>
      </section>

      {/* Why Egg White Section */}
      <section className="bg-background py-16 sm:py-20 lg:py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="grid gap-12 lg:grid-cols-[0.9fr_1.4fr] lg:gap-24">
            {/* Intro */}
            <div className="max-w-xl">
              <p className="text-[11px] font-medium uppercase tracking-[0.38em] text-muted-foreground">
                Защо Яйчен Белтък
              </p>

              <h2 className="mt-6 text-4xl font-light leading-[1.05] tracking-[-0.04em] text-foreground sm:text-5xl">
                По-умният избор
                <span className="block text-muted-foreground">
                  на протеин
                </span>
              </h2>

              <p className="mt-8 max-w-md text-sm leading-7 text-muted-foreground">
                Минимална формула, максимална функция. Създаден за модерен начин на
                живот с усещане за лекота, чистота и премиум грижа.
              </p>
            </div>

            {/* Cards */}
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              <div className="group rounded-[30px] border border-border/60 bg-card/60 p-8 backdrop-blur-xl transition duration-300 hover:-translate-y-1 hover:shadow-[0_20px_50px_rgba(120,100,70,0.08)]">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium tracking-[0.32em] text-muted-foreground">
                    01
                  </span>
                  <div className="h-px w-10 bg-border/60" />
                </div>

                <h3 className="mt-8 text-lg font-medium tracking-[-0.02em] text-foreground">
                  Пълноценен Протеин
                </h3>

                <p className="mt-4 text-sm leading-7 text-muted-foreground">
                  Всички есенциални аминокиселини в чиста и прецизна форма — за
                  възстановяване, баланс и устойчив тонус.
                </p>
              </div>

              <div className="group rounded-[30px] border border-border/60 bg-card/60 p-8 backdrop-blur-xl transition duration-300 hover:-translate-y-1 hover:shadow-[0_20px_50px_rgba(120,100,70,0.08)]">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium tracking-[0.32em] text-muted-foreground">
                    02
                  </span>
                  <div className="h-px w-10 bg-border/60" />
                </div>

                <h3 className="mt-8 text-lg font-medium tracking-[-0.02em] text-foreground">
                  Лесно Смилане
                </h3>

                <p className="mt-4 text-sm leading-7 text-muted-foreground">
                  Естествено без лактоза и щадящ към тялото — без тежест, само
                  комфорт и чист резултат.
                </p>
              </div>

              <div className="group rounded-[30px] border border-border/60 bg-card/60 p-8 backdrop-blur-xl transition duration-300 hover:-translate-y-1 hover:shadow-[0_20px_50px_rgba(120,100,70,0.08)] md:col-span-2 xl:col-span-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium tracking-[0.32em] text-muted-foreground">
                    03
                  </span>
                  <div className="h-px w-10 bg-border/60" />
                </div>

                <h3 className="mt-8 text-lg font-medium tracking-[-0.02em] text-foreground">
                  Чиста Формула
                </h3>

                <p className="mt-4 text-sm leading-7 text-muted-foreground">
                  Без млечни продукти, без суроватка и без излишни съставки —
                  само това, което има реална функция.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>


      {/* Usage Section */}
      <section className="bg-muted/20 py-16 sm:py-20 lg:py-24">
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

      {/* Flavor Sections */}
      <div className="bg-background">
        {/* WHITE CHOCOLATE & RASPBERRY */}
        <section className="relative overflow-hidden py-16 sm:py-20 lg:py-24">
          <div className="mx-auto grid max-w-7xl items-center gap-14 px-6 lg:grid-cols-12 lg:gap-10 lg:px-8">
            <div className="lg:col-span-5">
              <p className="text-[11px] font-medium uppercase tracking-[0.38em] text-muted-foreground">
                Почивка и Възстановяване
              </p>

              <h2 className="mt-6 text-4xl font-light leading-[1.05] tracking-[-0.04em] text-foreground sm:text-5xl lg:text-6xl">
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

              <h2 className="mt-6 text-4xl font-light leading-[1.05] tracking-[-0.04em] text-foreground sm:text-5xl lg:text-6xl">
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
              className="hidden rounded-full bg-muted/50 px-4 py-2 text-[10px] font-medium uppercase tracking-[0.3em] text-muted-foreground hover:bg-muted hover:text-foreground sm:block"
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
            <Link href="/products" className="inline-block rounded-full bg-muted/50 px-4 py-2 text-[10px] font-medium uppercase tracking-[0.3em] text-muted-foreground hover:bg-muted hover:text-foreground">
              Виж всички
            </Link>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-background py-10 sm:py-20 lg:py-24">
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
    </div>
  )
}
