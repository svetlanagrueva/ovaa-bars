"use client"

import { motion, useInView } from "framer-motion"
import { useRef } from "react"

const benefits = [
  { value: 20, suffix: "g", label: "Яйчен Протеин" },
  { value: 0, suffix: "g", label: "Добавена Захар" },
  { value: 100, suffix: "%", label: "Натурални Съставки" },
]

function ArcSeparator() {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 32 32"
      fill="none"
      className="hidden text-accent/40 md:block"
    >
      <circle
        cx="16"
        cy="16"
        r="4"
        fill="currentColor"
      />
    </svg>
  )
}

export function BenefitsStrip() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: "-50px" })

  return (
    <section ref={ref} className="relative overflow-hidden bg-card py-8 sm:py-12 lg:py-16">
      {/* Subtle gradient overlay */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-accent/[0.03] to-transparent" />

      {/* Top accent line */}
      <div className="absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/30 to-transparent" />

      {/* Bottom accent line */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-accent/30 to-transparent" />

      <div className="relative mx-auto max-w-7xl px-5 sm:px-6 lg:px-8">
        {/* Mobile: horizontal row with dividers */}
        <div className="flex items-center justify-between gap-2 sm:hidden">
          {benefits.map((benefit, index) => (
            <motion.div
              key={benefit.label}
              initial={{ opacity: 0 }}
              animate={isInView ? { opacity: 1 } : {}}
              transition={{ duration: 0.8, delay: index * 0.15 }}
              className="flex-1 text-center"
            >
              <p className="text-2xl font-extralight tracking-tight text-foreground">
                {benefit.value}{benefit.suffix}
              </p>
              <p className="mt-1 text-[9px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                {benefit.label}
              </p>
            </motion.div>
          ))}
        </div>

        {/* Desktop: original layout */}
        <div className="hidden sm:flex sm:flex-row sm:items-center sm:justify-center sm:gap-16 lg:gap-24">
          {benefits.map((benefit, index) => (
            <div key={benefit.label} className="flex items-center gap-16 lg:gap-24">
              <motion.div
                initial={{ opacity: 0 }}
                animate={isInView ? { opacity: 1 } : {}}
                transition={{ duration: 1, delay: index * 0.35, ease: [0.22, 1, 0.36, 1]}}
                className="group text-center"
              >
                <p className="text-4xl font-extralight tracking-tight text-foreground transition-colors duration-300 group-hover:text-accent">
                  {benefit.value}{benefit.suffix}
                </p>

                <div className="mx-auto mt-3 h-px w-12 bg-accent/40" />

                <p className="mt-3 text-[11px] font-medium uppercase tracking-[0.3em] text-muted-foreground">
                  {benefit.label}
                </p>
              </motion.div>

              {index < benefits.length - 1 && <ArcSeparator />}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
