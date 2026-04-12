import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"

export const metadata: Metadata = {
  title: "За нас - Egg Origin",
  description: "Научете повече за Egg Origin и нашата мисия да създаваме протеинови барове с яйчен белтък.",
}

export default function AboutPage() {
  return (
    <div>
      {/* Hero Section */}
      <section className="py-16 sm:py-20 lg:py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
            <div className="max-w-xl">
              <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-muted-foreground">
                Нашата История
              </p>
              <h1 className="mt-6 text-4xl font-light leading-[1.05] tracking-[-0.04em] text-foreground sm:text-5xl">
                Протеин
                <span className="block text-muted-foreground">преосмислен</span>
              </h1>
              <div className="mt-10 flex items-center gap-4">
                <div className="h-px w-10 bg-accent/50" />
                <span className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
                  Чистота / Функция / Баланс
                </span>
              </div>
              <p className="mt-8 text-sm leading-7 text-muted-foreground">
                Egg Origin започна с едно ясно убеждение: функционалното хранене трябва да бъде чисто,
                прецизно и създадено за динамичното ежедневие на съвременния човек. Създадохме продукт за хора,
                които съчетават тренировки, работа и активен начин на живот с дисциплина и намерение —
                за които представянето има значение във всеки момент от деня, не само във фитнеса.
                Нашата мисия е проста: да предложим висококачествен протеин в изчистен формат,
                който естествено се вписва във всяка модерна рутина.

              </p>
              <p className="mt-4 text-sm leading-7 text-muted-foreground">
                Egg Origin не е просто протеинов бар. Това е инструмент за хора, които подхождат към тренировките, работата и живота с яснота и намерение.
              </p>
            </div>
            <div className="relative aspect-[4/5] overflow-hidden rounded-[26px]">
              <Image
                src="/images/egg-origin-white-hero.png"
                alt="Egg Origin"
                fill
                className="object-cover"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Philosophy Section */}
      <section className="relative overflow-hidden py-16 sm:py-20 lg:py-24">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute inset-0 bg-secondary/30" />
        </div>
        <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-muted-foreground">
              Нашата Философия
            </p>
            <h2 className="mt-6 text-4xl font-light leading-[1.05] tracking-[-0.04em] text-foreground sm:text-5xl">
              По-малко е повече
            </h2>
            <p className="mt-8 max-w-xl mx-auto text-sm leading-7 text-muted-foreground">
              Вярваме в прозрачността. Всяка съставка в Egg Origin има своята цел.
              Без изкуствени подсладители и излишни добавки.
              Само чисто и функционално хранене, създадено за ежедневна употреба.
            </p>
          </div>
        </div>
      </section>

      {/* Values Section */}
      <section className="py-16 sm:py-20 lg:py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-muted-foreground">
            Нашите Ценности
          </p>
          <div className="mt-12 grid gap-4 sm:gap-5 lg:mt-14 lg:grid-cols-3 lg:gap-6">
            <div className="group relative overflow-hidden rounded-[26px] border border-border/40 bg-card/80 p-8 transition-all duration-500 hover:border-accent/30 hover:shadow-lg hover:shadow-accent/[0.05] md:p-9">
              <div className="absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
              <span className="text-[11px] font-medium tracking-[0.3em] text-muted-foreground">
                01
                <span className="ml-2 inline-block h-px w-4 bg-accent/30 transition-all duration-300 group-hover:w-8 group-hover:bg-accent/50" />
              </span>
              <h3 className="mt-6 text-base font-medium tracking-[-0.01em] text-foreground sm:text-lg">
                Качеството на Първо Място
              </h3>
              <p className="mt-3 text-sm leading-7 text-muted-foreground">
                Използваме яйчен протеин от най-високо качество, съчетан с
                внимателно подбрани съставки.
              </p>
            </div>

            <div className="group relative overflow-hidden rounded-[26px] border border-border/40 bg-card/80 p-8 transition-all duration-500 hover:border-accent/30 hover:shadow-lg hover:shadow-accent/[0.05] md:p-9">
              <div className="absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
              <span className="text-[11px] font-medium tracking-[0.3em] text-muted-foreground">
                02
                <span className="ml-2 inline-block h-px w-4 bg-accent/30 transition-all duration-300 group-hover:w-8 group-hover:bg-accent/50" />
              </span>
              <h3 className="mt-6 text-base font-medium tracking-[-0.01em] text-foreground sm:text-lg">
                Прозрачност
              </h3>
              <p className="mt-3 text-sm leading-7 text-muted-foreground">
                Вярваме, че заслужавате да знаете точно какво ядете.
                Без консерванти, изкуствени оцветители и овкусители.
              </p>
            </div>

            <div className="group relative overflow-hidden rounded-[26px] border border-border/40 bg-card/80 p-8 transition-all duration-500 hover:border-accent/30 hover:shadow-lg hover:shadow-accent/[0.05] md:p-9">
              <div className="absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
              <span className="text-[11px] font-medium tracking-[0.3em] text-muted-foreground">
                03
                <span className="ml-2 inline-block h-px w-4 bg-accent/30 transition-all duration-300 group-hover:w-8 group-hover:bg-accent/50" />
              </span>
              <h3 className="mt-6 text-base font-medium tracking-[-0.01em] text-foreground sm:text-lg">
                Създаден с цел
              </h3>
              <p className="mt-3 text-sm leading-7 text-muted-foreground">
                Egg Origin е продукт, създаден за хора, които подхождат съзнателно към храненето си.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="relative overflow-hidden py-16 sm:py-20 lg:py-24">
        <div className="absolute inset-0 bg-foreground" />
        <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-background/60">
              Готови ли сте
            </p>
            <h2 className="mt-6 text-4xl font-light leading-[1.05] tracking-[-0.04em] text-background sm:text-5xl">
              Усетете
              <span className="block text-background/60">разликата</span>
            </h2>
            <p className="mt-6 max-w-md mx-auto text-sm leading-7 text-background/70">
              Опитайте Egg Origin и открийте какъв е вкусът на чистия протеин.
            </p>
            <div className="mt-10">
              <Button
                asChild
                size="lg"
                className="h-11 gap-2 rounded-full bg-background px-6 text-[10px] uppercase tracking-[0.16em] text-foreground hover:bg-background/90"
              >
                <Link href="/products">
                  Купи сега
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
