import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"

export const metadata: Metadata = {
  title: "За нас - Egg Origin",
  description: "Научете повече за Egg Origin и нашата мисия да създаваме протеинови барове с яйчен белтък и чиста етикета.",
}

export default function AboutPage() {
  return (
    <div className="bg-background">
      {/* Hero Section */}
      <section className="py-16 sm:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid items-center gap-16 lg:grid-cols-2">
            <div className="max-w-xl">
              <p className="text-xs font-medium uppercase tracking-[0.3em] text-muted-foreground">
                Нашата История
              </p>
              <h1 className="mt-6 text-4xl font-light tracking-tight text-foreground sm:text-5xl">
                Протеин, преосмислен
              </h1>
              <p className="mt-8 text-base leading-relaxed text-muted-foreground">
                Egg Origin се роди от едно просто убеждение: протеиновите барове трябва да бъдат
                функционално хранене, а не бонбони в дегизировка. Създадохме бар с чиста етикета,
                който доставя пълноценен протеин без компромиси.
              </p>
              <p className="mt-4 text-base leading-relaxed text-muted-foreground">
                Използването на яйчен протеин вместо суроватка означава по-лесно смилане,
                без подуване и всички есенциални аминокиселини, от които тялото ви се нуждае.
                Без млечни продукти, без добавена захар, без излишни съставки.
              </p>
            </div>
            <div className="relative aspect-[4/5]">
              <Image
                src="/images/hero-bg.jpg"
                alt="Egg Origin"
                fill
                className="object-cover"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Philosophy Section */}
      <section className="border-y border-border bg-secondary/30 py-24 sm:py-32">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-xs font-medium uppercase tracking-[0.3em] text-muted-foreground">
              Нашата Философия
            </p>
            <h2 className="mt-6 text-3xl font-light tracking-tight text-foreground sm:text-4xl">
              По-малко е повече
            </h2>
            <p className="mt-8 text-base leading-relaxed text-muted-foreground">
              Вярваме в прозрачността. Всяка съставка в Egg Origin има своята цел.
              Без пълнители, без изкуствени подсладители, без сложни химикали.
              Само чисто, функционално хранене, създадено за ежедневна употреба.
            </p>
          </div>
        </div>
      </section>

      {/* Values Section */}
      <section className="py-24 sm:py-32">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <p className="text-xs font-medium uppercase tracking-[0.3em] text-muted-foreground">
            Нашите Ценности
          </p>
          <div className="mt-12 grid gap-16 lg:grid-cols-3">
            <div>
              <div className="mb-6 h-px w-12 bg-foreground" />
              <h3 className="text-sm font-medium uppercase tracking-wider text-foreground">Качеството на Първо Място</h3>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                Използваме яйчен протеин от най-високо качество, съчетан с
                внимателно подбрани съставки. Всяка партида е тествана за чистота и консистентност.
              </p>
            </div>
            <div>
              <div className="mb-6 h-px w-12 bg-foreground" />
              <h3 className="text-sm font-medium uppercase tracking-wider text-foreground">Прозрачност</h3>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                Вярваме, че заслужавате да знаете точно какво ядете.
                Нашата чиста етикета означава без скрити съставки, без дребен шрифт, без изненади.
              </p>
            </div>
            <div>
              <div className="mb-6 h-px w-12 bg-foreground" />
              <h3 className="text-sm font-medium uppercase tracking-wider text-foreground">Функция Пред Показност</h3>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                Egg Origin не се опитва да бъде бонбон. Това е функционален протеин,
                създаден за хора, които се грижат какво влиза в тялото им.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-foreground py-24 sm:py-32">
        <div className="mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
          <h2 className="text-3xl font-light tracking-tight text-background sm:text-4xl">
            Усетете разликата
          </h2>
          <p className="mx-auto mt-6 max-w-md text-sm text-background/70">
            Опитайте Egg Origin и открийте какъв е вкусът на чистия протеин.
          </p>
          <div className="mt-10">
            <Button asChild size="lg" variant="secondary" className="gap-2 px-8">
              <Link href="/products">
                Купи сега
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}
