"use client"

import Image from "next/image"
import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { motion, useInView } from "framer-motion"
import { useRef } from "react"

const moments = [
  {
    image: "/images/usage-meetings.png",
    title: "Между срещи",
    description:
      "Когато графикът е плътен, а фокусът има значение — чиста и удобна опция за междинен момент през деня.",
  },
  {
    image: "/images/usage-workout.png",
    title: "След кратка тренировка",
    description:
      "Практичен избор за динамични сутрини и бърз преход обратно към работния ритъм.",
  },
  {
    image: "/images/usage-reset.png",
    title: "В момент на баланс",
    description:
      "За по-тихите части на деня — когато търсиш лекота, яснота и предвидимост в избора си.",
  },
]

export function UsageMoments() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: "-100px" })

  return (
    <section ref={ref} className="bg-background py-16 sm:py-20 lg:py-24">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8 }}
          className="max-w-2xl"
        >
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
        </motion.div>

        <div className="mt-14 grid gap-10 md:grid-cols-3 lg:mt-16 lg:gap-8">
          {moments.map((moment, index) => (
            <motion.div
              key={moment.title}
              initial={{ opacity: 0, y: 30 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.8, delay: 0.2 + index * 0.15 }}
            >
              <div className="relative h-[220px] overflow-hidden rounded-[26px] bg-muted">
                <Image
                  src={moment.image}
                  alt={moment.title}
                  fill
                  className="object-cover"
                />
              </div>

              <h3 className="mt-6 text-base font-medium text-foreground">
                {moment.title}
              </h3>

              <p className="mt-3 text-sm leading-7 text-muted-foreground">
                {moment.description}
              </p>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={isInView ? { opacity: 1 } : {}}
          transition={{ duration: 0.8, delay: 0.6 }}
          className="mt-14"
        >
          <Link
            href="/products"
            className="inline-flex items-center gap-3 rounded-full border border-border/60 px-6 py-3 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:bg-muted/30 hover:text-accent"
          >
            Виж продуктите
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </motion.div>
      </div>
    </section>
  )
}
