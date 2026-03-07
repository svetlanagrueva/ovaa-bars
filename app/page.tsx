import Image from "next/image"
import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ProductCard } from "@/components/products/product-card"
import { PRODUCTS } from "@/lib/products"

export default function HomePage() {
  return (
    <div>
      {/* Hero Section */}
      <section className="relative bg-background">
        <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 sm:py-32 lg:px-8">
          <div className="grid items-center gap-16 lg:grid-cols-2">
            <div className="max-w-xl">
              <p className="text-xs font-medium uppercase tracking-[0.3em] text-muted-foreground">
                Чист Протеин
              </p>
              <h1 className="mt-6 text-balance text-4xl font-light tracking-tight text-foreground sm:text-5xl lg:text-6xl">
                Пълноценен протеин,{" "}
                <span className="italic">без компромиси</span>
              </h1>
              <p className="mt-8 text-pretty text-base leading-relaxed text-muted-foreground">
                Ovva Sculpt е протеинов бар с яйчен белтък - 
                пълноценен животински протеин с всички есенциални аминокиселини. 
                Високо съдържание на протеин, без суроватка, без добавена захар.
              </p>
              <div className="mt-10 flex flex-col gap-4 sm:flex-row">
                <Button asChild size="lg" className="gap-2 px-8">
                  <Link href="/products">
                    Купи сега
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg" className="px-8">
                  <Link href="/about">Нашата история</Link>
                </Button>
              </div>
            </div>
            <div className="relative aspect-[4/5] lg:aspect-square">
              <Image
                src="/images/hero-bg.jpg"
                alt="Ovva Sculpt protein bars"
                fill
                className="object-cover"
                priority
              />
            </div>
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="border-y border-border bg-secondary/30 py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-8 text-center sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <p className="text-2xl font-light text-foreground">20g</p>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Яйчен Протеин</p>
            </div>
            <div className="space-y-2">
              <p className="text-2xl font-light text-foreground">0g</p>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Добавена Захар</p>
            </div>
            <div className="space-y-2">
              <p className="text-2xl font-light text-foreground">100%</p>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Чиста Етикета</p>
            </div>
            <div className="space-y-2">
              <p className="text-2xl font-light text-foreground">Лесно</p>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Смилане</p>
            </div>
          </div>
        </div>
      </section>

      {/* Why Egg White Section */}
      <section className="bg-background py-24 sm:py-32">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-medium uppercase tracking-[0.3em] text-muted-foreground">
              Защо Яйчен Белтък
            </p>
            <h2 className="mt-6 text-3xl font-light tracking-tight text-foreground sm:text-4xl">
              По-умният избор на протеин
            </h2>
          </div>
          <div className="mx-auto mt-16 grid max-w-5xl gap-12 lg:grid-cols-3">
            <div className="text-center">
              <div className="mx-auto mb-6 h-px w-12 bg-foreground" />
              <h3 className="text-sm font-medium uppercase tracking-wider text-foreground">Пълноценен Протеин</h3>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                Яйчният белтък съдържа всички есенциални аминокиселини, от които тялото ви се нуждае, 
                което го прави пълноценен източник на протеин за възстановяване и ежедневно хранене.
              </p>
            </div>
            <div className="text-center">
              <div className="mx-auto mb-6 h-px w-12 bg-foreground" />
              <h3 className="text-sm font-medium uppercase tracking-wider text-foreground">Лесно Смилане</h3>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                За разлика от суроватъчния протеин, яйчният белтък е естествено без лактоза и по-лесен за смилане. 
                Без подуване, без дискомфорт - само чисто хранене.
              </p>
            </div>
            <div className="text-center">
              <div className="mx-auto mb-6 h-px w-12 bg-foreground" />
              <h3 className="text-sm font-medium uppercase tracking-wider text-foreground">Без Излишни Съставки</h3>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                Формула с чиста етикета - без млечни продукти, без суроватка, без добавена захар. 
                Само функционален протеин, създаден за ежедневна употреба.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Products Section */}
      <section className="bg-secondary/30 py-24 sm:py-32">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.3em] text-muted-foreground">
                Нашите Продукти
              </p>
              <h2 className="mt-4 text-3xl font-light tracking-tight text-foreground sm:text-4xl">
                Избери своята кутия
              </h2>
            </div>
            <Link 
              href="/products" 
              className="hidden text-sm font-medium text-foreground underline underline-offset-4 hover:text-muted-foreground sm:block"
            >
              Виж всички
            </Link>
          </div>
          <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {PRODUCTS.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
          <div className="mt-8 sm:hidden">
            <Button asChild variant="outline" className="w-full">
              <Link href="/products">Виж всички продукти</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-foreground py-24 sm:py-32">
        <div className="mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
          <p className="text-xs font-medium uppercase tracking-[0.3em] text-background/60">
            Безплатна доставка над 50 лв
          </p>
          <h2 className="mt-6 text-3xl font-light tracking-tight text-background sm:text-4xl">
            Готови да заредите деня си?
          </h2>
          <p className="mx-auto mt-6 max-w-md text-sm text-background/70">
            Пълноценен протеин без компромиси. Поръчайте сега и усетете разликата с Ovva Sculpt.
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
