"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { Minus, Plus, Trash2, ShoppingBag, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useCartStore } from "@/lib/store/cart"

export default function CartPage() {
  const [mounted, setMounted] = useState(false)
  const { items, updateQuantity, removeItem, getTotalPrice } = useCartStore()

  useEffect(() => {
    setMounted(true)
  }, [])

  const formatPrice = (cents: number) => {
    return (cents / 100).toFixed(2).replace(".", ",") + " лв."
  }

  const totalPrice = getTotalPrice()
  const shippingPrice = totalPrice >= 5000 ? 0 : 599 // Free shipping over 50 BGN
  const finalPrice = totalPrice + shippingPrice

  if (!mounted) {
    return (
      <div className="bg-background py-12 sm:py-16">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          <h1 className="text-3xl font-light tracking-wide text-foreground">Количка</h1>
          <div className="mt-8 animate-pulse">
            <div className="h-32 rounded-lg bg-secondary" />
          </div>
        </div>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="bg-background py-12 sm:py-16">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6 lg:px-8">
          <div className="flex justify-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-secondary">
              <ShoppingBag className="h-10 w-10 text-muted-foreground" />
            </div>
          </div>
          <h1 className="mt-6 text-2xl font-light text-foreground">Количката е празна</h1>
          <p className="mt-2 text-muted-foreground">
            Добавете продукти, за да продължите с поръчката
          </p>
          <Button asChild className="mt-8" size="lg">
            <Link href="/products">
              Разгледай продуктите
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-background py-12 sm:py-16">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-light tracking-wide text-foreground">Количка</h1>

        <div className="mt-8 space-y-4">
          {items.map((item) => (
            <Card key={item.product.id}>
              <CardContent className="p-4">
                <div className="flex gap-4">
                  <div className="relative h-24 w-24 flex-shrink-0 overflow-hidden rounded-lg bg-secondary">
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
                        <h3 className="font-semibold text-foreground">{item.product.name}</h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {formatPrice(item.product.priceInCents)} / кутия
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => removeItem(item.product.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                        <span className="sr-only">Премахни</span>
                      </Button>
                    </div>
                    <div className="mt-auto flex items-center justify-between pt-2">
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8 bg-transparent"
                          onClick={() => updateQuantity(item.product.id, item.quantity - 1)}
                        >
                          <Minus className="h-3 w-3" />
                          <span className="sr-only">Намали</span>
                        </Button>
                        <span className="w-8 text-center font-medium">{item.quantity}</span>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8 bg-transparent"
                          onClick={() => updateQuantity(item.product.id, item.quantity + 1)}
                        >
                          <Plus className="h-3 w-3" />
                          <span className="sr-only">Увеличи</span>
                        </Button>
                      </div>
                      <span className="font-semibold text-foreground">
                        {formatPrice(item.product.priceInCents * item.quantity)}
                      </span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Summary */}
        <Card className="mt-8">
          <CardContent className="p-6">
            <h2 className="text-lg font-medium text-foreground">Обобщение</h2>
            <div className="mt-4 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Междинна сума</span>
                <span className="text-foreground">{formatPrice(totalPrice)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Доставка</span>
                <span className="text-foreground">
                  {shippingPrice === 0 ? "Безплатна" : formatPrice(shippingPrice)}
                </span>
              </div>
              {totalPrice < 5000 && (
                <p className="text-xs text-muted-foreground">
                  Добавете още {formatPrice(5000 - totalPrice)} за безплатна доставка
                </p>
              )}
              <div className="border-t border-border pt-3">
                <div className="flex justify-between">
                  <span className="font-medium text-foreground">Общо</span>
                  <span className="text-xl font-bold text-foreground">{formatPrice(finalPrice)}</span>
                </div>
              </div>
            </div>
            <Button asChild className="mt-6 w-full" size="lg">
              <Link href="/checkout">
                Към плащане
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
