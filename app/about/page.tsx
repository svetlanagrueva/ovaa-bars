import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"

export const metadata: Metadata = {
  title: "About - Ovva Sculpt",
  description: "Learn about Ovva Sculpt and our mission to create clean-label protein bars made with egg white protein.",
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
                Our Story
              </p>
              <h1 className="mt-6 text-4xl font-light tracking-tight text-foreground sm:text-5xl">
                Protein, reimagined
              </h1>
              <p className="mt-8 text-base leading-relaxed text-muted-foreground">
                Ovva Sculpt was born from a simple belief: protein bars should be 
                functional nutrition, not candy in disguise. We created a clean-label 
                bar that delivers complete protein without compromise.
              </p>
              <p className="mt-4 text-base leading-relaxed text-muted-foreground">
                Using egg white protein instead of whey means easier digestion, 
                no bloating, and all the essential amino acids your body needs. 
                No dairy, no added sugar, no unnecessary ingredients.
              </p>
            </div>
            <div className="relative aspect-[4/5]">
              <Image
                src="/images/hero-bg.jpg"
                alt="Ovva Sculpt"
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
              Our Philosophy
            </p>
            <h2 className="mt-6 text-3xl font-light tracking-tight text-foreground sm:text-4xl">
              Less is more
            </h2>
            <p className="mt-8 text-base leading-relaxed text-muted-foreground">
              We believe in transparency. Every ingredient in Ovva Sculpt serves a purpose. 
              No fillers, no artificial sweeteners, no complex chemicals you can&apos;t pronounce. 
              Just clean, functional nutrition designed for everyday use.
            </p>
          </div>
        </div>
      </section>

      {/* Values Section */}
      <section className="py-24 sm:py-32">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <p className="text-xs font-medium uppercase tracking-[0.3em] text-muted-foreground">
            What We Stand For
          </p>
          <div className="mt-12 grid gap-16 lg:grid-cols-3">
            <div>
              <div className="mb-6 h-px w-12 bg-foreground" />
              <h3 className="text-sm font-medium uppercase tracking-wider text-foreground">Quality First</h3>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                We source the highest quality egg white protein and pair it with 
                carefully selected ingredients. Every batch is tested for purity and consistency.
              </p>
            </div>
            <div>
              <div className="mb-6 h-px w-12 bg-foreground" />
              <h3 className="text-sm font-medium uppercase tracking-wider text-foreground">Transparency</h3>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                We believe you deserve to know exactly what you&apos;re eating. 
                Our clean label means no hidden ingredients, no fine print, no surprises.
              </p>
            </div>
            <div>
              <div className="mb-6 h-px w-12 bg-foreground" />
              <h3 className="text-sm font-medium uppercase tracking-wider text-foreground">Function Over Flash</h3>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                Ovva Sculpt isn&apos;t trying to be a candy bar. It&apos;s functional protein 
                designed for people who care about what goes into their bodies.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-foreground py-24 sm:py-32">
        <div className="mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
          <h2 className="text-3xl font-light tracking-tight text-background sm:text-4xl">
            Experience the difference
          </h2>
          <p className="mx-auto mt-6 max-w-md text-sm text-background/70">
            Try Ovva Sculpt and discover what clean protein really tastes like.
          </p>
          <div className="mt-10">
            <Button asChild size="lg" variant="secondary" className="gap-2 px-8">
              <Link href="/products">
                Shop Now
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}
