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
    <section ref={ref} className="bg-primary py-20 text-primary-foreground md:py-28 lg:py-32">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8 }}
          className="mx-auto max-w-2xl text-center"
        >
          <p className="text-[11px] font-medium uppercase tracking-[0.3em] opacity-60">
            Поръчай
          </p>

          <h2 className="mt-6 text-4xl font-light leading-[1.05] tracking-[-0.04em] md:text-5xl">
            Безплатна доставка до офис над 30 €
          </h2>

          <p className="mx-auto mt-8 max-w-md text-sm leading-7 opacity-70">
            Доставка до 3 работни дни в цяла България.
          </p>

          <div className="mt-8 sm:mt-10">
            <Button
              asChild
              size="lg"
              className="h-11 gap-2 rounded-full bg-primary-foreground px-6 text-[10px] uppercase tracking-[0.16em] text-primary hover:bg-primary-foreground/90"
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
