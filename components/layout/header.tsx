"use client"

import Link from "next/link"
import { ShoppingCart, Menu, X } from "lucide-react"
import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { useCartStore } from "@/lib/store/cart"

export function Header() {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const totalItems = useCartStore((state) => state.getTotalItems())

  useEffect(() => {
    setMounted(true)
  }, [])

  const navLinks = [
    { href: "/", label: "Начало" },
    { href: "/products", label: "Продукти" },
    { href: "/about", label: "За нас" },
    { href: "/contact", label: "Контакти" },
  ]

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center">
          <span className="text-sm font-bold tracking-[0.35em] uppercase text-foreground">Egg</span>
          <span className="text-sm font-light tracking-[0.35em] uppercase text-foreground"> Origin</span>
        </Link>

        <nav className="hidden items-center gap-10 md:flex">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-4">
          <Link href="/cart" className="relative">
            <Button
              variant={mounted && totalItems > 0 ? "default" : "outline"}
              size="sm"
              className="relative gap-2 px-4 text-[11px] uppercase tracking-[0.15em]"
            >
              <ShoppingCart className="h-4 w-4" />
              {mounted && totalItems > 0 ? (
                <span className="font-medium">{totalItems}</span>
              ) : (
                <span className="hidden sm:inline">Количка</span>
              )}
            </Button>
          </Link>

          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
          >
            {isMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            <span className="sr-only">Меню</span>
          </Button>
        </div>
      </div>

      {isMenuOpen && (
        <div className="border-t border-border bg-background md:hidden">
          <nav className="flex flex-col px-4 py-4">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="py-3 text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
                onClick={() => setIsMenuOpen(false)}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </header>
  )
}
