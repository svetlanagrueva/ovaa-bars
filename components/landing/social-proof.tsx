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
    <section className="bg-background py-12 sm:py-16 lg:py-24">
      <div className="mx-auto max-w-7xl px-5 sm:px-6 lg:px-8">
        {/* Mobile: stacked layout */}
        <div className="lg:hidden">
          <p className="text-[10px] font-medium uppercase tracking-[0.25em] text-muted-foreground sm:text-[11px] sm:tracking-[0.3em]">
            Последвай ни
          </p>

          <h3 className="mt-3 text-[22px] font-light tracking-[-0.02em] text-foreground sm:mt-4 sm:text-2xl">
            Балансирай ежедневието
          </h3>

          <p className="mt-3 text-[13px] leading-[1.7] text-muted-foreground sm:mt-4 sm:max-w-sm sm:text-sm sm:leading-7">
            Виж как Egg Origin се вписва в ежедневието на хора с фокус,
            движение и баланс.
          </p>

          {/* Mobile: 3 clickable images linking to Instagram */}
          <div className="mt-6 grid grid-cols-3 gap-2 sm:gap-3">
            {SOCIAL_IMAGES.slice(0, 4).map((src, i) => (
              <Link
                key={i}
                href="https://instagram.com"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Instagram"
                className={`group aspect-square overflow-hidden rounded-full bg-muted sm:rounded-[20px] ${i === 3 ? "hidden sm:block" : ""}`}
              >
                <img
                  src={src}
                  alt=""
                  className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
                />
              </Link>
            ))}
          </div>
        </div>

        {/* Desktop: side-by-side layout */}
        <div className="hidden items-center gap-10 lg:grid lg:grid-cols-12">
          <div className="lg:col-span-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-muted-foreground">
              Последвай ни
            </p>

            <h3 className="mt-4 text-2xl font-light tracking-[-0.02em] text-foreground">
              Балансирай ежедневието
            </h3>

            <p className="mt-4 max-w-sm text-sm leading-7 text-muted-foreground">
              Виж как Egg Origin се вписва в ежедневието на хора с фокус,
              движение и баланс.
            </p>

            <Link
              href="https://instagram.com"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 inline-flex items-center gap-3 rounded-full border border-border/60 px-6 py-3 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:bg-muted/30 hover:text-accent"
            >
              Instagram →
            </Link>
          </div>

          <div className="grid grid-cols-4 gap-3 lg:col-span-8">
            {SOCIAL_IMAGES.map((src, i) => (
              <Link
                key={i}
                href="https://instagram.com"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Instagram"
                className="group aspect-square overflow-hidden rounded-full bg-muted"
              >
                <img
                  src={src}
                  alt=""
                  className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                />
              </Link>
            ))}
          </div>
        </div>

        {/* Trust badges */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="mt-8 flex flex-wrap justify-center gap-4 sm:mt-12"
        >
          <a
            href="https://www.trustpilot.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-full items-center justify-center gap-3 rounded-full border border-border/60 px-6 py-3 transition-colors hover:bg-muted/30 sm:w-auto"
          >
            <div className="flex items-center gap-1">
              {[...Array(5)].map((_, i) => (
                <svg
                  key={i}
                  className="h-4 w-4 fill-current text-trustpilot-green"
                  viewBox="0 0 24 24"
                >
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
              ))}
            </div>
            <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Отлично в Trustpilot
            </span>
          </a>
        </motion.div>
      </div>
    </section>
  )
}
