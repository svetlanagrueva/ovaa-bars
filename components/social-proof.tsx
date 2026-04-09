"use client"

import Link from "next/link"
import Image from "next/image"
import { motion } from "framer-motion"

const SOCIAL_IMAGES = [
  "/images/social-1.jpg",
  "/images/social-2.jpg",
  "/images/social-3.jpg",
  "/images/social-4.jpg",
]

export function SocialProof() {
  return (
    <section className="bg-muted/20 py-14 sm:py-16 lg:py-20">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="grid items-center gap-10 lg:grid-cols-12 lg:gap-10">
          {/* Left */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="lg:col-span-4"
          >
            <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-muted-foreground">
              Общност
            </p>

            <h3 className="mt-4 text-2xl font-light text-foreground">
              Изгради своя ритъм
            </h3>

            <p className="mt-4 max-w-sm text-sm leading-7 text-muted-foreground">
              Виж как Egg Origin се вписва в ежедневието на хора с фокус,
              движение и баланс.
            </p>

            <Link
              href="https://instagram.com"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 inline-block text-[11px] uppercase tracking-[0.3em] text-muted-foreground transition-colors hover:text-foreground"
            >
              Instagram →
            </Link>
          </motion.div>

          {/* Right - images */}
          <div className="grid grid-cols-3 gap-3 lg:col-span-8 lg:grid-cols-4">
            {SOCIAL_IMAGES.map((src, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className={`aspect-square overflow-hidden rounded-full bg-muted ${i === 3 ? "hidden lg:block" : ""}`}
              >
                <img
                  src={src}
                  alt=""
                  className="h-full w-full object-cover"
                />
              </motion.div>
            ))}
          </div>
        </div>

        {/* Trust badges */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="mt-12 flex flex-wrap justify-center gap-4"
        >
          <div className="inline-flex items-center gap-3 rounded-full border border-border/60 px-6 py-3">
            <div className="flex items-center gap-1">
              {[...Array(5)].map((_, i) => (
                <svg
                  key={i}
                  className="h-4 w-4 fill-current text-[#00b67a]"
                  viewBox="0 0 24 24"
                >
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
              ))}
            </div>
            <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Отлично в Trustpilot
            </span>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
