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
      "Когато графикът е натоварен и имаш нужда от нещо леко между срещи.",
  },
  {
    image: "/images/usage-workout.png",
    title: "След кратка тренировка",
    description:
      "За динамичните сутрини, когато енергията има значение.",
  },
  {
    image: "/images/usage-reset.png",
    title: "В момент на баланс",
    description:
      "Твоето време за отдих. Прецизно хранене за лекота и вътрешен баланс.",
  },
]

export function UsageMoments() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: "-100px" })

  return (
    <section ref={ref} className="bg-card py-12 sm:py-16 lg:py-24">
      <div className="mx-auto max-w-7xl px-5 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="max-w-2xl"
        >
          <p className="text-[10px] font-medium uppercase tracking-[0.25em] text-muted-foreground sm:text-[11px] sm:tracking-[0.3em]">
            Как се вписва в деня ти
          </p>

          <h2 className="mt-4 text-[28px] font-light leading-[1.1] tracking-[-0.03em] text-foreground sm:mt-6 sm:text-4xl sm:leading-[1.05] sm:tracking-[-0.04em] lg:text-5xl">
            Създаден за ритъма
            <span className="block text-muted-foreground">
              на твоя ден
            </span>
          </h2>

          <p className="mt-4 text-[13px] leading-[1.7] text-muted-foreground sm:mt-6 sm:max-w-xl sm:text-sm sm:leading-7">
            От динамичните сутрини до моментите на пауза — Egg Origin е част от ежедневието ти.
          </p>
        </motion.div>

        {/* Mobile: horizontal scroll */}
        <div className="-mx-5 mt-8 sm:hidden">
          <div className="flex gap-4 overflow-x-auto px-5 pb-4 snap-x snap-mandatory scrollbar-hide">
            {moments.map((moment, index) => (
              <motion.div
                key={moment.title}
                initial={{ opacity: 0, x: 20 }}
                animate={isInView ? { opacity: 1, x: 0 } : {}}
                transition={{ duration: 0.6, delay: 0.1 + index * 0.1 }}
                className="w-[280px] flex-shrink-0 snap-start"
              >
                <div className="group relative aspect-[4/3] overflow-hidden rounded-[20px] bg-muted">
                  <Image
                    src={moment.image}
                    alt={moment.title}
                    fill
                    className="object-cover"
                  />
                </div>

                <h3 className="mt-4 text-[15px] font-medium tracking-[-0.01em] text-foreground">
                  {moment.title}
                </h3>

                <p className="mt-2 text-[13px] leading-[1.6] text-muted-foreground">
                  {moment.description}
                </p>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Desktop: grid */}
        <div className="mt-14 hidden gap-8 sm:grid md:grid-cols-3 lg:mt-16">
          {moments.map((moment, index) => (
            <motion.div
              key={moment.title}
              initial={{ opacity: 0, y: 30 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.8, delay: 0.2 + index * 0.15 }}
            >
              <div className="group relative h-[260px] overflow-hidden rounded-[26px] bg-muted">
                <Image
                  src={moment.image}
                  alt={moment.title}
                  fill
                  className="object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                />
              </div>

              <h3 className="mt-6 text-base font-medium tracking-[-0.01em] text-foreground sm:text-lg">
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
          className="mt-10 sm:mt-14"
        >
          <Link
            href="/products"
            className="inline-flex w-full items-center justify-center gap-3 rounded-full border border-border/60 px-6 py-3 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:bg-muted/30 hover:text-accent sm:w-auto"
          >
            Виж продуктите
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </motion.div>
      </div>
    </section>
  )
}
