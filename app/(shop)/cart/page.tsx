"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { Minus, Plus, Trash2, ShoppingBag, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useCartStore } from "@/lib/store/cart"
import { formatPrice, isOnSale } from "@/lib/products"
import { FREE_SHIPPING_THRESHOLD, SHIPPING_PRICE_OFFICE } from "@/lib/constants"
import { checkCartInventory } from "@/app/actions/stripe"

export default function CartPage() {
  const [mounted, setMounted] = useState(false)
  const [stockWarnings, setStockWarnings] = useState<Array<{ productName: string; available: number; requested: number }>>([])
  const { items, updateQuantity, removeItem, getTotalPrice } = useCartStore()

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted || items.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStockWarnings([])
      return
    }
    let cancelled = false
    checkCartInventory(items.map((i) => ({ productId: i.product.id, quantity: i.quantity }))).then(
      (warnings) => { if (!cancelled) setStockWarnings(warnings) }
    )
    return () => { cancelled = true }
  }, [mounted, items])

  const totalPrice = getTotalPrice()
  const shippingPrice = totalPrice >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_PRICE_OFFICE
  const finalPrice = totalPrice + shippingPrice

  if (!mounted) {
    return (
      <div className="bg-background py-16 sm:py-20 lg:py-24">
        <div className="mx-auto max-w-3xl px-6 lg:px-8">
          <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-muted-foreground">
            Количка
          </p>
          <h1 className="mt-6 text-4xl font-light leading-[1.05] tracking-[-0.04em] text-foreground sm:text-5xl">
            Вашата
            <span className="block text-muted-foreground">количка</span>
          </h1>
          <div className="mt-12 animate-pulse">
            <div className="h-32 rounded-[26px] bg-secondary" />
          </div>
        </div>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="bg-background py-16 sm:py-20 lg:py-24">
        <div className="mx-auto max-w-3xl px-6 text-center lg:px-8">
          <div className="flex justify-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-secondary">
              <ShoppingBag className="h-10 w-10 text-muted-foreground" />
            </div>
          </div>
          <p className="mt-8 text-[11px] font-medium uppercase tracking-[0.3em] text-muted-foreground">
            Количка
          </p>
          <h1 className="mt-4 text-4xl font-light leading-[1.05] tracking-[-0.04em] text-foreground sm:text-5xl">
            Количката
            <span className="block text-muted-foreground">е празна</span>
          </h1>
          <p className="mx-auto mt-6 max-w-md text-sm leading-7 text-muted-foreground">
            Добавете продукти, за да продължите с поръчката
          </p>
          <div className="mt-10">
            <Button
              asChild
              size="lg"
              className="h-11 gap-2 rounded-full bg-primary px-6 text-[10px] uppercase tracking-[0.16em] text-primary-foreground hover:opacity-90"
            >
              <Link href="/products">
                Разгледай продуктите
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-background py-16 sm:py-20 lg:py-24">
      <div className="mx-auto max-w-3xl px-6 lg:px-8">
        <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-muted-foreground">
          Количка
        </p>
        <h1 className="mt-6 text-4xl font-light leading-[1.05] tracking-[-0.04em] text-foreground sm:text-5xl">
          Вашата
          <span className="block text-muted-foreground">количка</span>
        </h1>

        {/* Custom card pattern from design-system.md instead of <Card> for richer hover/transition effects */}
        <div className="mt-12 space-y-4">
          {items.map((item) => (
            <div
              key={item.product.id}
              className="group relative overflow-hidden rounded-[26px] border border-border/40 bg-card/80 p-6 transition-all duration-500 hover:border-accent/30"
            >
              <div className="absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
              <div className="flex gap-4 sm:gap-6">
                <div className="relative h-24 w-24 flex-shrink-0 overflow-hidden rounded-[16px] bg-secondary sm:h-28 sm:w-28">
                  <Image
                    src={item.product.image || "/placeholder.svg"}
                    alt={item.product.name}
                    fill
                    className="object-cover"
                  />
                </div>
                <div className="flex flex-1 flex-col">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-base font-medium tracking-[-0.01em] text-foreground">{item.product.name}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {isOnSale(item.product) && (
                          <span className="line-through mr-2">
                            {formatPrice(item.product.originalPriceInCents!)}
                          </span>
                        )}
                        {formatPrice(item.product.priceInCents)} / кутия
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground transition-colors hover:bg-transparent hover:text-destructive"
                      onClick={() => removeItem(item.product.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="sr-only">Премахни</span>
                    </Button>
                  </div>
                  <div className="mt-auto flex items-center justify-between pt-4">
                    <div className="flex items-center gap-3">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8 rounded-full border-border/60 bg-transparent"
                        onClick={() => updateQuantity(item.product.id, item.quantity - 1)}
                      >
                        <Minus className="h-3 w-3" />
                        <span className="sr-only">Намали</span>
                      </Button>
                      <span className="w-8 text-center text-sm font-medium text-foreground">{item.quantity}</span>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8 rounded-full border-border/60 bg-transparent"
                        onClick={() => updateQuantity(item.product.id, item.quantity + 1)}
                      >
                        <Plus className="h-3 w-3" />
                        <span className="sr-only">Увеличи</span>
                      </Button>
                    </div>
                    <span className="text-base font-medium text-foreground">
                      {formatPrice(item.product.priceInCents * item.quantity)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Summary */}
        <div className="mt-8 rounded-[26px] border border-border/40 bg-card/80 p-8">
          <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-muted-foreground">
            Обобщение
          </p>
          <div className="mt-6 space-y-4">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Междинна сума</span>
              <span className="text-foreground">{formatPrice(totalPrice)}</span>
            </div>
            {items.some((item) => isOnSale(item.product)) && (
              <div className="flex justify-between text-sm text-green-600">
                <span>Спестявате</span>
                <span>-{formatPrice(items.reduce((s, item) =>
                  s + (isOnSale(item.product)
                    ? (item.product.originalPriceInCents! - item.product.priceInCents) * item.quantity
                    : 0), 0))}
                </span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Доставка</span>
              <span className="text-foreground">
                {shippingPrice === 0 ? "Безплатна" : formatPrice(shippingPrice)}
              </span>
            </div>
            {totalPrice < FREE_SHIPPING_THRESHOLD && (
              <p className="text-xs text-muted-foreground">
                Добавете още {formatPrice(FREE_SHIPPING_THRESHOLD - totalPrice)} за безплатна доставка до офис на куриер
              </p>
            )}
            <div className="h-px bg-border/60" />
            <div className="flex items-center justify-between pt-2">
              <span className="text-sm font-medium text-foreground">Общо</span>
              <span className="text-2xl font-light tracking-[-0.02em] text-foreground">{formatPrice(finalPrice)}</span>
            </div>
          </div>
          {stockWarnings.length > 0 && (
            <div className="mt-6 space-y-1 rounded-[16px] bg-destructive/10 p-4">
              {stockWarnings.map((w) => (
                <p key={w.productName} className="text-xs text-destructive">
                  {w.available === 0 ? `${w.productName} е изчерпан` : `Недостатъчна наличност на ${w.productName}. Налични ${w.available}бр.`}
                </p>
              ))}
            </div>
          )}
          <div className="mt-8">
            {stockWarnings.length === 0 ? (
              <Button
                asChild
                size="lg"
                className="h-11 w-full gap-2 rounded-full bg-primary text-[10px] uppercase tracking-[0.16em] text-primary-foreground hover:opacity-90"
              >
                <Link href="/checkout">
                  Към плащане
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            ) : (
              <Button
                disabled
                size="lg"
                className="h-11 w-full gap-2 rounded-full text-[10px] uppercase tracking-[0.16em]"
              >
                Към плащане
                <ArrowRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
