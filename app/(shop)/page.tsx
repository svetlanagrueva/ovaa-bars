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
              <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-muted-foreground">
                Egg Origin — Яйчен Протеин
              </p>

              {/* Decorative duplicate — real h1 is in mobile block (mobile-first indexing) */}
              <p className="mt-6 text-4xl font-light leading-[1.02] tracking-[-0.04em] text-foreground sm:text-5xl lg:text-6xl" role="presentation">
                Чиста храна
                <span className="block text-muted-foreground">
                  за хора с цел
                </span>
              </p>

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
            <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-muted-foreground">
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
              className="object-cover object-right-bottom scale-[1.3]"
            />

            <div className="absolute inset-x-0 bottom-0 z-10 px-6 pb-8">
              <div className="inline-block rounded-full bg-background/40 p-1 backdrop-blur-sm">
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
      </section>

      {/* Benefits Strip */}
      <section className="bg-muted/20 pb-10 pt-10 sm:pb-14 sm:pt-14">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="flex flex-col items-center gap-8 sm:flex-row sm:justify-center sm:gap-24 lg:gap-36">
            <div className="text-center">
              <p className="text-3xl font-extralight tracking-tight text-foreground">20g</p>
              <p className="mt-1 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Яйчен Протеин</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-extralight tracking-tight text-foreground">0g</p>
              <p className="mt-1 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Добавена Захар</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-extralight tracking-tight text-foreground">100%</p>
              <p className="mt-1 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Чиста Етикета</p>
            </div>
          </div>
        </div>
      </section>

      {/* Why Egg White Section */}
      <section className="relative overflow-hidden py-16 sm:py-20 lg:py-24">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <img
            src="/images/egg-white-texture.png"
            alt=""
            aria-hidden="true"
            className="absolute left-1/2 top-1/2 h-[140%] w-[140%] max-w-none -translate-x-1/2 -translate-y-1/2 object-cover opacity-[0.8]"
          />
          <div className="absolute inset-0 bg-background/72" />
        </div>

        <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-muted-foreground">
              Защо Яйчен Белтък
            </p>

            <h2 className="mt-6 text-4xl font-light leading-[1.05] tracking-[-0.04em] text-foreground sm:text-5xl">
              По-умният избор
              <span className="block text-muted-foreground">
                на протеин
              </span>
            </h2>

            <p className="mt-6 max-w-xl text-sm leading-7 text-muted-foreground">
              Минимална формула, максимална функция. Създаден за модерен начин на
              живот с усещане за лекота, чистота и премиум грижа.
            </p>
          </div>

          <div className="mt-12 grid gap-4 sm:gap-5 lg:mt-14 lg:grid-cols-3 lg:gap-6">
            <div className="rounded-[26px] border border-border/50 bg-background/70 p-6 backdrop-blur-[2px] sm:p-7">
              <span className="text-[11px] font-medium tracking-[0.3em] text-muted-foreground">
                01
              </span>

              <h3 className="mt-6 text-base font-medium tracking-[-0.01em] text-foreground sm:text-lg">
                Пълноценен Протеин
              </h3>

              <p className="mt-3 text-sm leading-7 text-muted-foreground">
                Всички есенциални аминокиселини в прецизно балансирана форма — за
                възстановяване, баланс и устойчив тонус.
              </p>
            </div>

            <div className="rounded-[26px] border border-border/50 bg-background/70 p-6 backdrop-blur-[2px] sm:p-7">
              <span className="text-[11px] font-medium tracking-[0.3em] text-muted-foreground">
                02
              </span>

              <h3 className="mt-6 text-base font-medium tracking-[-0.01em] text-foreground sm:text-lg">
                Стабилна Енергия
              </h3>

              <p className="mt-3 text-sm leading-7 text-muted-foreground">
                Създаден да поддържа баланс и яснота — в синхрон с ежедневния ти
                ритъм.
              </p>
            </div>

            <div className="rounded-[26px] border border-border/50 bg-background/70 p-6 backdrop-blur-[2px] sm:p-7">
              <span className="text-[11px] font-medium tracking-[0.3em] text-muted-foreground">
                03
              </span>

              <h3 className="mt-6 text-base font-medium tracking-[-0.01em] text-foreground sm:text-lg">
                Чиста Формула
              </h3>

              <p className="mt-3 text-sm leading-7 text-muted-foreground">
                Без млечни продукти, без суроватка и без излишни съставки — само
                това, което има реална функция.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Usage Section */}
      <section className="bg-muted/20 py-16 sm:py-20 lg:py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-muted-foreground">
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
              <div className="relative h-[220px] overflow-hidden rounded-[26px] bg-muted">
                <Image
                  src="/images/usage-meetings.png"
                  alt="Минимална работна среда с тихо премиум излъчване"
                  fill
                  className="object-cover"
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
              <div className="relative h-[220px] overflow-hidden rounded-[26px] bg-muted">
                <Image
                  src="/images/usage-workout.png"
                  alt="Кратък post-workout момент с минималистична performance естетика"
                  fill
                  className="object-cover"
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
              <div className="relative h-[220px] overflow-hidden rounded-[26px] bg-muted">
                <Image
                  src="/images/usage-reset.png"
                  alt="Спокоен момент на баланс в меки неутрални тонове"
                  fill
                  className="object-cover"
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

          <div className="mt-12">
            <Link
              href="/products"
              className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.3em] text-muted-foreground hover:text-foreground"
            >
              Виж продуктите
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </section>

      {/* Flavor Sections */}
      <div className="bg-background">
        {/* WHITE CHOCOLATE & RASPBERRY */}
        <section className="relative overflow-hidden py-8 sm:py-10 lg:py-12">
          <div className="mx-auto max-w-7xl px-6 lg:px-8">
            <div className="flex flex-col gap-6 lg:grid lg:grid-cols-12 lg:items-center lg:gap-10">
              {/* Heading — mobile order-1, desktop in left col */}
              <div className="order-1 lg:col-span-5 lg:row-span-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-muted-foreground">
                  Почивка и Възстановяване
                </p>

                <h2 className="mt-6 text-4xl font-light leading-[1.05] tracking-[-0.04em] text-foreground sm:text-5xl">
                  Бял шоколад
                  <span className="block text-muted-foreground">
                    & малина
                  </span>
                </h2>

                <p className="mt-8 hidden max-w-md text-sm leading-7 text-muted-foreground lg:block">
                  По-лека, по-мека енергия — създадена за баланс, възстановяване и
                  ежедневен ритъм без излишна тежест.
                </p>

                <div className="mt-10 hidden items-center gap-4 lg:flex">
                  <div className="h-px w-10 bg-border" />
                  <span className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
                    Лекота / Баланс / Нежност
                  </span>
                </div>

                <div className="mt-10 hidden lg:block">
                  <Button
                    asChild
                    size="lg"
                    className="h-11 gap-2 rounded-full bg-foreground px-6 text-[10px] uppercase tracking-[0.16em] text-background hover:opacity-90"
                  >
                    <Link href="/products/white-chocolate-raspberry-box">
                      Виж продукта
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </div>

              {/* Tagline — mobile only, order-2 */}
              <div className="order-2 flex items-center gap-4 lg:hidden">
                <div className="h-px w-10 bg-border" />
                <span className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
                  Лекота / Баланс / Нежност
                </span>
              </div>

              {/* Image — mobile order-3, desktop right col */}
              <div className="order-3 lg:col-span-7">
                <div className="relative h-[320px] overflow-hidden rounded-[26px] bg-muted sm:h-[380px] lg:h-[420px]">
                  <Image
                    src="/images/egg-origin-white-hero.png"
                    alt="Egg Origin White Chocolate & Raspberry"
                    fill
                    className="object-cover"
                  />
                </div>
              </div>

              {/* Body text — mobile only, order-4 */}
              <div className="order-4 lg:hidden">
                <p className="max-w-md text-sm leading-7 text-muted-foreground">
                  По-лека, по-мека енергия — създадена за баланс, възстановяване и
                  ежедневен ритъм без излишна тежест.
                </p>
              </div>

              {/* CTA — mobile only, order-5 */}
              <div className="order-5 lg:hidden">
                <Button
                  asChild
                  size="lg"
                  className="h-11 gap-2 rounded-full bg-foreground px-6 text-[10px] uppercase tracking-[0.16em] text-background hover:opacity-90"
                >
                  <Link href="/products/white-chocolate-raspberry-box">
                    Виж продукта
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="h-px bg-border/60" />
        </div>

        {/* DARK CHOCOLATE */}
        <section className="relative overflow-hidden py-8 sm:py-10 lg:py-12">
          <div className="mx-auto max-w-7xl px-6 lg:px-8">
            <div className="flex flex-col gap-6 lg:grid lg:grid-cols-12 lg:items-center lg:gap-10">
              {/* Heading — mobile order-1, desktop in right col */}
              <div className="order-1 lg:order-2 lg:col-span-4 lg:col-start-9 lg:row-span-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-muted-foreground">
                  Стабилно прeдставяне
                </p>

                <h2 className="mt-6 text-4xl font-light leading-[1.05] tracking-[-0.04em] text-foreground sm:text-5xl">
                  Тъмен
                  <span className="block text-muted-foreground">
                    Шоколад
                  </span>
                </h2>

                <p className="mt-8 hidden max-w-md text-sm leading-7 text-muted-foreground lg:block">
                  По-плътно, по-структурирано присъствие — за фокус, постоянство и
                  тиха увереност в ежедневното представяне.
                </p>

                <div className="mt-10 hidden items-center gap-4 lg:flex">
                  <div className="h-px w-10 bg-border" />
                  <span className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
                    Фокус / Дисциплина / Увереност
                  </span>
                </div>

                <div className="mt-10 hidden lg:block">
                  <Button
                    asChild
                    size="lg"
                    className="h-11 gap-2 rounded-full bg-foreground px-6 text-[10px] uppercase tracking-[0.16em] text-background hover:opacity-90"
                  >
                    <Link href="/products/dark-chocolate-box">
                      Виж продукта
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </div>

              {/* Tagline — mobile only, order-2 */}
              <div className="order-2 flex items-center gap-4 lg:hidden">
                <div className="h-px w-10 bg-border" />
                <span className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
                  Фокус / Дисциплина / Увереност
                </span>
              </div>

              {/* Image — mobile order-3, desktop left col */}
              <div className="order-3 lg:order-1 lg:col-span-7">
                <div className="relative h-[320px] overflow-hidden rounded-[26px] bg-muted sm:h-[380px] lg:h-[420px]">
                  <Image
                    src="/images/egg-origin-dark-hero.png"
                    alt="Egg Origin Dark Chocolate"
                    fill
                    className="object-cover"
                  />
                </div>
              </div>

              {/* Body text — mobile only, order-4 */}
              <div className="order-4 lg:hidden">
                <p className="max-w-md text-sm leading-7 text-muted-foreground">
                  По-плътно, по-структурирано присъствие — за фокус, постоянство и
                  тиха увереност в ежедневното представяне.
                </p>
              </div>

              {/* CTA — mobile only, order-5 */}
              <div className="order-5 lg:hidden">
                <Button
                  asChild
                  size="lg"
                  className="h-11 gap-2 rounded-full bg-foreground px-6 text-[10px] uppercase tracking-[0.16em] text-background hover:opacity-90"
                >
                  <Link href="/products/dark-chocolate-box">
                    Виж продукта
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Products Section */}
      <section className="bg-background pt-8 pb-16 sm:pt-10 sm:pb-20 lg:pt-12 lg:pb-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.3em] text-muted-foreground">
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

      {/* Social Proof Section */}
<section className="bg-muted/20 py-14 sm:py-16 lg:py-20">
  <div className="mx-auto max-w-7xl px-6 lg:px-8">
    <div className="grid items-center gap-10 lg:grid-cols-12 lg:gap-10">

      {/* Left */}
      <div className="lg:col-span-4">
        <p className="text-[11px] font-medium uppercase tracking-[0.38em] text-muted-foreground">
          Общност
        </p>

        <h3 className="mt-4 text-2xl font-light text-foreground">
          Изгради своя ритъм
        </h3>

        <p className="mt-4 max-w-sm text-sm leading-7 text-muted-foreground">
          Виж как Egg Origin се вписва в ежедневието на хора с фокус,
          движение и баланс.
        </p>

        <Link
          href="https://instagram.com"
          className="mt-6 inline-block text-[11px] uppercase tracking-[0.28em] text-muted-foreground hover:text-foreground"
        >
          Instagram →
        </Link>
      </div>

      {/* Right - images */}
      <div className="grid grid-cols-3 gap-3 lg:col-span-8 lg:grid-cols-4">
        {[
          "/images/social-1.jpg",
          "/images/social-2.jpg",
          "/images/social-3.jpg",
          "/images/social-4.jpg",
        ].map((src, i) => (
          <div
            key={i}
            className="aspect-square overflow-hidden rounded-full bg-muted"
          >
            <img
              src={src}
              alt=""
              className="h-full w-full object-cover"
            />
          </div>
        ))}
      </div>
    </div>

    {/* Trustpilot */}
    <div className="mt-12 flex justify-center">
      <Link
        href="#"
        className="inline-flex items-center gap-3 rounded-full border border-border/60 px-6 py-3 transition-colors hover:bg-muted/30"
      >
        <Image
          src="/images/trustpilot-logo.png"
          alt="Trustpilot"
          width={120}
          height={30}
          className="h-8 w-auto"
        />
        <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Оцени ни
        </span>
      </Link>
    </div>
  </div>
</section>

      {/* CTA Section */}
      <section className="relative overflow-hidden bg-muted/40 px-6 py-16 sm:px-10 sm:py-24 lg:px-0 lg:py-28">
        <div className="mx-auto max-w-7xl lg:px-8">
          <div className="relative">
            <Image
              src="/images/enso-arc.png"
              alt=""
              width={520}
              height={520}
              className="pointer-events-none absolute -right-6 -top-58 opacity-[0.06] [filter:grayscale(1)]"
              aria-hidden="true"
            />

            <div className="relative max-w-2xl">
              <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-muted-foreground">
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
