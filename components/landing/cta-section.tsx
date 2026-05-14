"use client"

import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { motion, useInView } from "framer-motion"
import { useRef } from "react"
import { Button } from "@/components/ui/button"

export function CtaSection() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: "-100px" })

  return (
    <section ref={ref} className="bg-primary py-12 text-primary-foreground sm:py-16 lg:py-24">
      <div className="mx-auto max-w-7xl px-5 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="mx-auto max-w-2xl text-center"
        >
          <p className="text-[10px] font-medium uppercase tracking-[0.25em] opacity-60 sm:text-[11px] sm:tracking-[0.3em]">
            Поръчай
          </p>

          <h2 className="mt-4 text-[26px] font-light leading-[1.15] tracking-[-0.03em] sm:mt-6 sm:text-4xl sm:leading-[1.05] sm:tracking-[-0.04em] md:text-5xl">
            Безплатна доставка до офис над 30 €
          </h2>

          <p className="mx-auto mt-5 text-[13px] leading-[1.7] opacity-70 sm:mt-8 sm:max-w-md sm:text-sm sm:leading-7">
            Доставка до 3 работни дни в цяла България.
          </p>

          <div className="mt-6 sm:mt-10">
            <Button
              asChild
              size="lg"
              className="h-12 w-full gap-2 rounded-full bg-primary-foreground text-[10px] uppercase tracking-[0.16em] text-primary hover:bg-primary-foreground/90 sm:h-11 sm:w-auto sm:px-6"
            >
              <Link href="/products">
                Виж продуктите
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
