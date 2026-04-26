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
      <section className="py-12 sm:py-16 lg:py-24">
        <div className="mx-auto max-w-7xl px-5 sm:px-6 lg:px-8">
          <div className="grid items-center gap-8 sm:gap-10 lg:grid-cols-2 lg:gap-16">
            <div className="order-2 max-w-xl lg:order-1">
              <p className="text-[10px] font-medium uppercase tracking-[0.25em] text-muted-foreground sm:text-[11px] sm:tracking-[0.3em]">
                Нашата История
              </p>
              <h1 className="mt-4 text-[32px] font-light leading-[1.1] tracking-[-0.03em] text-foreground sm:mt-6 sm:text-4xl sm:leading-[1.05] sm:tracking-[-0.04em] lg:text-5xl">
                Протеин
                <span className="block text-muted-foreground">преосмислен</span>
              </h1>
              <div className="mt-6 flex items-center gap-4 sm:mt-10">
                <div className="h-px w-10 bg-accent/50" />
                <span className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground sm:text-[11px] sm:tracking-[0.3em]">
                  Чистота / Функция / Баланс
                </span>
              </div>
              <p className="mt-6 text-[13px] leading-[1.7] text-muted-foreground sm:mt-8 sm:text-sm sm:leading-7">
                Egg Origin започна с едно ясно убеждение: функционалното хранене трябва да бъде чисто,
                прецизно и създадено за динамичното ежедневие на съвременния човек. Създадохме продукт за хора,
                които съчетават тренировки, работа и активен начин на живот с дисциплина и намерение —
                за които представянето има значение във всеки момент от деня, не само във фитнеса.
                Нашата мисия е проста: да предложим висококачествен протеин в изчистен формат,
                който естествено се вписва във всяка модерна рутина.

              </p>
              <p className="mt-4 text-[13px] leading-[1.7] text-muted-foreground sm:text-sm sm:leading-7">
                Egg Origin не е просто протеинов бар. Това е инструмент за хора, които подхождат към тренировките, работата и живота с яснота и намерение.
              </p>
            </div>
            <div className="order-1 relative aspect-[4/5] overflow-hidden rounded-[20px] sm:rounded-[26px] lg:order-2">
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
      <section className="relative overflow-hidden py-12 sm:py-16 lg:py-24">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute inset-0 bg-secondary/30" />
        </div>
        <div className="relative mx-auto max-w-7xl px-5 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-[10px] font-medium uppercase tracking-[0.25em] text-muted-foreground sm:text-[11px] sm:tracking-[0.3em]">
              Нашата Философия
            </p>
            <h2 className="mt-4 text-[28px] font-light leading-[1.1] tracking-[-0.03em] text-foreground sm:mt-6 sm:text-4xl sm:leading-[1.05] sm:tracking-[-0.04em] lg:text-5xl">
              По-малко е повече
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-[13px] leading-[1.7] text-muted-foreground sm:mt-8 sm:text-sm sm:leading-7">
              Вярваме в прозрачността. Всяка съставка в Egg Origin има своята цел.
              Без изкуствени подсладители и излишни добавки.
              Само това, от което тялото ти има нужда.
            </p>
          </div>
        </div>
      </section>

      {/* Values Section */}
      <section className="py-12 sm:py-16 lg:py-24">
        <div className="mx-auto max-w-7xl px-5 sm:px-6 lg:px-8">
          <p className="text-[10px] font-medium uppercase tracking-[0.25em] text-muted-foreground sm:text-[11px] sm:tracking-[0.3em]">
            Нашите Ценности
          </p>
          <div className="mt-8 grid gap-3 sm:mt-12 sm:gap-5 lg:mt-14 lg:grid-cols-3 lg:gap-6">
            <div className="group relative overflow-hidden rounded-[18px] border border-border/40 bg-card/80 p-6 transition-all duration-500 hover:border-accent/30 hover:shadow-lg hover:shadow-accent/[0.05] sm:rounded-[26px] sm:p-8 md:p-9">
              <div className="absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
              <span className="text-[10px] font-medium tracking-[0.2em] text-muted-foreground sm:text-[11px] sm:tracking-[0.3em]">
                01
                <span className="ml-2 inline-block h-px w-4 bg-accent/30 transition-all duration-300 group-hover:w-8 group-hover:bg-accent/50" />
              </span>
              <h3 className="mt-4 text-[15px] font-medium tracking-[-0.01em] text-foreground sm:mt-6 sm:text-base lg:text-lg">
                Качеството на Първо Място
              </h3>
              <p className="mt-2 text-[13px] leading-[1.6] text-muted-foreground sm:mt-3 sm:text-sm sm:leading-7">
                Използваме яйчен протеин от най-високо качество, съчетан с
                внимателно подбрани съставки.
              </p>
            </div>

            <div className="group relative overflow-hidden rounded-[18px] border border-border/40 bg-card/80 p-6 transition-all duration-500 hover:border-accent/30 hover:shadow-lg hover:shadow-accent/[0.05] sm:rounded-[26px] sm:p-8 md:p-9">
              <div className="absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
              <span className="text-[10px] font-medium tracking-[0.2em] text-muted-foreground sm:text-[11px] sm:tracking-[0.3em]">
                02
                <span className="ml-2 inline-block h-px w-4 bg-accent/30 transition-all duration-300 group-hover:w-8 group-hover:bg-accent/50" />
              </span>
              <h3 className="mt-4 text-[15px] font-medium tracking-[-0.01em] text-foreground sm:mt-6 sm:text-base lg:text-lg">
                Прозрачност
              </h3>
              <p className="mt-2 text-[13px] leading-[1.6] text-muted-foreground sm:mt-3 sm:text-sm sm:leading-7">
                Вярваме, че заслужавате да знаете точно какво ядете.
                Без консерванти, изкуствени оцветители и овкусители.
              </p>
            </div>

            <div className="group relative overflow-hidden rounded-[18px] border border-border/40 bg-card/80 p-6 transition-all duration-500 hover:border-accent/30 hover:shadow-lg hover:shadow-accent/[0.05] sm:rounded-[26px] sm:p-8 md:p-9">
              <div className="absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
              <span className="text-[10px] font-medium tracking-[0.2em] text-muted-foreground sm:text-[11px] sm:tracking-[0.3em]">
                03
                <span className="ml-2 inline-block h-px w-4 bg-accent/30 transition-all duration-300 group-hover:w-8 group-hover:bg-accent/50" />
              </span>
              <h3 className="mt-4 text-[15px] font-medium tracking-[-0.01em] text-foreground sm:mt-6 sm:text-base lg:text-lg">
                Създаден с цел
              </h3>
              <p className="mt-2 text-[13px] leading-[1.6] text-muted-foreground sm:mt-3 sm:text-sm sm:leading-7">
                Egg Origin е продукт, създаден за хора, които избират съзнателно и изискват най-доброто за себе си.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="relative overflow-hidden py-12 sm:py-16 lg:py-24">
        <div className="absolute inset-0 bg-foreground" />
        <div className="relative mx-auto max-w-7xl px-5 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-[10px] font-medium uppercase tracking-[0.25em] text-background/60 sm:text-[11px] sm:tracking-[0.3em]">
              Готови ли сте
            </p>
            <h2 className="mt-4 text-[28px] font-light leading-[1.1] tracking-[-0.03em] text-background sm:mt-6 sm:text-4xl sm:leading-[1.05] sm:tracking-[-0.04em] lg:text-5xl">
              Усетете
              <span className="block text-background/60">разликата</span>
            </h2>
            <p className="mx-auto mt-5 max-w-md text-[13px] leading-[1.7] text-background/70 sm:mt-6 sm:text-sm sm:leading-7">
              Опитайте Egg Origin и открийте какъв е вкусът на чистия протеин.
            </p>
            <div className="mt-6 sm:mt-10">
              <Button
                asChild
                size="lg"
                className="h-12 w-full gap-2 rounded-full bg-background text-[10px] uppercase tracking-[0.16em] text-foreground hover:bg-background/90 sm:h-11 sm:w-auto sm:px-6"
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
