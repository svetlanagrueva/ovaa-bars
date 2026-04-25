import Image from "next/image"
import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { getProductsWithSales } from "@/lib/sales"
import { getInventoryMap } from "@/lib/inventory"
import { SocialProof } from "@/components/landing/social-proof"
import { BenefitsStrip } from "@/components/landing/benefits-strip"
import { UsageMoments } from "@/components/landing/usage-moments"
import { ProductsSection } from "@/components/landing/products-section"
import { CtaSection } from "@/components/landing/cta-section"

export const revalidate = 60

const HERO = {
  eyebrow: "Egg Origin — Яйчен Протеин",
  heading: "Чиста храна",
  headingSub: "за хора с цел",
  body: "20g пълноценен яйчен протеин в прецизно създадена формула — без суроватка, без добавена захар и без излишни съставки.",
  cta: "Виж продуктите",
}

const FLAVORS = {
  white: {
    eyebrow: "Почивка и Възстановяване",
    title: "Бял шоколад",
    titleSub: "& малина",
    body: "Балансирана свежест от истински малини, обвита в копринен бял шоколад. За моментите, в които презареждаш с мисъл за себе си.",
    tagline: "Лекота / Баланс / Нежност",
    image: "/images/egg-origin-white-hero.png",
    href: "/products/white-chocolate-raspberry-box",
  },
  dark: {
    eyebrow: "Стабилно представяне",
    title: "Натурален ",
    titleSub: "Шоколад",
    body: "Елегантно съчетание на натурално какао и висококачествен яйчен протеин. За тези, които не правят компромис с резултатите.",
    tagline: "Фокус / Дисциплина / Увереност",
    image: "/images/egg-origin-dark-hero.png",
    href: "/products/dark-chocolate-box",
  },
}

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
                {HERO.eyebrow}
              </p>

              {/* Decorative duplicate — real h1 is in mobile block (mobile-first indexing) */}
              <p className="mt-6 text-4xl font-light leading-[1.02] tracking-[-0.04em] text-foreground sm:text-5xl lg:text-6xl" role="presentation">
                {HERO.heading}
                <span className="block text-muted-foreground">
                  {HERO.headingSub}
                </span>
              </p>

              <p className="mt-6 max-w-md text-sm leading-7 text-muted-foreground">
                {HERO.body}
              </p>

              <div className="mt-10 flex flex-col gap-3 sm:flex-row">
                <Button
                  asChild
                  size="lg"
                  className="h-11 gap-2 rounded-full bg-primary px-6 text-[10px] uppercase tracking-[0.16em] text-primary-foreground hover:opacity-90"
                >
                  <Link href="/products">
                    {HERO.cta}
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
              {HERO.eyebrow}
            </p>

            <h1 className="mt-6 text-4xl font-light leading-[1.02] tracking-[-0.04em] text-foreground">
              {HERO.heading}
              <span className="block text-muted-foreground">
                {HERO.headingSub}
              </span>
            </h1>

            <p className="mt-6 max-w-md text-sm leading-7 text-muted-foreground">
              {HERO.body}
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
                  className="h-11 gap-2 rounded-full bg-primary px-6 text-[10px] uppercase tracking-[0.16em] text-primary-foreground hover:opacity-90"
                >
                  <Link href="/products">
                    {HERO.cta}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Benefits Strip */}
      <BenefitsStrip />

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
            <div className="group relative overflow-hidden rounded-[26px] border border-border/40 bg-card/80 p-8 transition-all duration-500 hover:border-accent/30 hover:shadow-lg hover:shadow-accent/[0.05] md:p-9">
              <div className="absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
              <span className="text-[11px] font-medium tracking-[0.3em] text-muted-foreground">
                01
                <span className="ml-2 inline-block h-px w-4 bg-accent/30 transition-all duration-300 group-hover:w-8 group-hover:bg-accent/50" />
              </span>

              <h3 className="mt-6 text-base font-medium tracking-[-0.01em] text-foreground sm:text-lg">
                Пълноценен Протеин
              </h3>

              <p className="mt-3 text-sm leading-7 text-muted-foreground">
                Пълен аминокиселинен профил в добре балансирана формула.
              </p>
            </div>

            <div className="group relative overflow-hidden rounded-[26px] border border-border/40 bg-card/80 p-8 transition-all duration-500 hover:border-accent/30 hover:shadow-lg hover:shadow-accent/[0.05] md:p-9">
              <div className="absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
              <span className="text-[11px] font-medium tracking-[0.3em] text-muted-foreground">
                02
                <span className="ml-2 inline-block h-px w-4 bg-accent/30 transition-all duration-300 group-hover:w-8 group-hover:bg-accent/50" />
              </span>

              <h3 className="mt-6 text-base font-medium tracking-[-0.01em] text-foreground sm:text-lg">
                Стабилна Енергия
              </h3>

              <p className="mt-3 text-sm leading-7 text-muted-foreground">
                 Равномерна енергия през целия ден. В синхрон с ежедневния ти
                ритъм.
              </p>
            </div>

            <div className="group relative overflow-hidden rounded-[26px] border border-border/40 bg-card/80 p-8 transition-all duration-500 hover:border-accent/30 hover:shadow-lg hover:shadow-accent/[0.05] md:p-9">
              <div className="absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
              <span className="text-[11px] font-medium tracking-[0.3em] text-muted-foreground">
                03
                <span className="ml-2 inline-block h-px w-4 bg-accent/30 transition-all duration-300 group-hover:w-8 group-hover:bg-accent/50" />
              </span>

              <h3 className="mt-6 text-base font-medium tracking-[-0.01em] text-foreground sm:text-lg">
                Чиста Формула
              </h3>

              <p className="mt-3 text-sm leading-7 text-muted-foreground">
                Функционален протеин. Без излишни съставки.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Usage Section */}
      <UsageMoments />

      {/* Flavor Sections */}
      <div className="bg-background">
        {/* WHITE CHOCOLATE & RASPBERRY */}
        <section className="relative overflow-hidden py-8 sm:py-10 lg:py-12">
          <div className="mx-auto max-w-7xl px-6 lg:px-8">
            <div className="flex flex-col gap-6 lg:grid lg:grid-cols-12 lg:items-center lg:gap-10">
              <div className="order-1 lg:col-span-5 lg:row-span-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-muted-foreground">
                  {FLAVORS.white.eyebrow}
                </p>

                <h2 className="mt-6 text-4xl font-light leading-[1.05] tracking-[-0.04em] text-foreground sm:text-5xl">
                  {FLAVORS.white.title}
                  <span className="block text-muted-foreground">{FLAVORS.white.titleSub}</span>
                </h2>

                <p className="mt-8 hidden max-w-md text-sm leading-7 text-muted-foreground lg:block">
                  {FLAVORS.white.body}
                </p>

                <div className="mt-10 hidden items-center gap-4 lg:flex">
                  <div className="h-px w-10 bg-accent/50" />
                  <span className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
                    {FLAVORS.white.tagline}
                  </span>
                </div>

                <div className="mt-10 hidden lg:block">
                  <Button
                    asChild
                    size="lg"
                    className="h-11 gap-2 rounded-full bg-primary px-6 text-[10px] uppercase tracking-[0.16em] text-primary-foreground hover:opacity-90"
                  >
                    <Link href={FLAVORS.white.href}>
                      Виж продукта
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </div>

              <div className="order-2 flex items-center gap-4 lg:hidden">
                <div className="h-px w-10 bg-accent/50" />
                <span className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
                  {FLAVORS.white.tagline}
                </span>
              </div>

              <div className="order-3 lg:col-span-7">
                <div className="relative h-[320px] overflow-hidden rounded-[26px] bg-muted sm:h-[380px] lg:h-[420px]">
                  <Image
                    src={FLAVORS.white.image}
                    alt={`Egg Origin ${FLAVORS.white.title} ${FLAVORS.white.titleSub}`}
                    fill
                    className="object-cover"
                  />
                </div>
              </div>

              <div className="order-4 lg:hidden">
                <p className="max-w-md text-sm leading-7 text-muted-foreground">
                  {FLAVORS.white.body}
                </p>
              </div>

              <div className="order-5 lg:hidden">
                <Button
                  asChild
                  size="lg"
                  className="h-11 gap-2 rounded-full bg-primary px-6 text-[10px] uppercase tracking-[0.16em] text-primary-foreground hover:opacity-90"
                >
                  <Link href={FLAVORS.white.href}>
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
              <div className="order-1 lg:order-2 lg:col-span-4 lg:col-start-9 lg:row-span-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-muted-foreground">
                  {FLAVORS.dark.eyebrow}
                </p>

                <h2 className="mt-6 text-4xl font-light leading-[1.05] tracking-[-0.04em] text-foreground sm:text-5xl">
                  {FLAVORS.dark.title}
                  <span className="block text-muted-foreground">{FLAVORS.dark.titleSub}</span>
                </h2>

                <p className="mt-8 hidden max-w-md text-sm leading-7 text-muted-foreground lg:block">
                  {FLAVORS.dark.body}
                </p>

                <div className="mt-10 hidden items-center gap-4 lg:flex">
                  <div className="h-px w-10 bg-accent/50" />
                  <span className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
                    {FLAVORS.dark.tagline}
                  </span>
                </div>

                <div className="mt-10 hidden lg:block">
                  <Button
                    asChild
                    size="lg"
                    className="h-11 gap-2 rounded-full bg-primary px-6 text-[10px] uppercase tracking-[0.16em] text-primary-foreground hover:opacity-90"
                  >
                    <Link href={FLAVORS.dark.href}>
                      Виж продукта
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </div>

              <div className="order-2 flex items-center gap-4 lg:hidden">
                <div className="h-px w-10 bg-accent/50" />
                <span className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
                  {FLAVORS.dark.tagline}
                </span>
              </div>

              <div className="order-3 lg:order-1 lg:col-span-7">
                <div className="relative h-[320px] overflow-hidden rounded-[26px] bg-muted sm:h-[380px] lg:h-[420px]">
                  <Image
                    src={FLAVORS.dark.image}
                    alt={`Egg Origin ${FLAVORS.dark.title} ${FLAVORS.dark.titleSub}`}
                    fill
                    className="object-cover"
                  />
                </div>
              </div>

              <div className="order-4 lg:hidden">
                <p className="max-w-md text-sm leading-7 text-muted-foreground">
                  {FLAVORS.dark.body}
                </p>
              </div>

              <div className="order-5 lg:hidden">
                <Button
                  asChild
                  size="lg"
                  className="h-11 gap-2 rounded-full bg-primary px-6 text-[10px] uppercase tracking-[0.16em] text-primary-foreground hover:opacity-90"
                >
                  <Link href={FLAVORS.dark.href}>
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
      <ProductsSection products={PRODUCTS} inventoryMap={Object.fromEntries(inventoryMap)} />

      {/* Social Proof Section */}
      <SocialProof />

      {/* CTA Section */}
      <CtaSection />
    </div>
  )
}
