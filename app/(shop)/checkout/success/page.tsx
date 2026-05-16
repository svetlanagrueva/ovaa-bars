"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { CheckCircle, Package, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useCartStore } from "@/lib/store/cart"
import { confirmOrder } from "@/app/actions/stripe"
import { trackPurchase } from "@/lib/meta-pixel"
import { ORDER_ID_REGEX, formatOrderId } from "@/lib/orders"

export default function CheckoutSuccessPage() {
  const searchParams = useSearchParams()
  const orderId = searchParams.get("order_id")
  const [status, setStatus] = useState<"loading" | "confirmed" | "error">("loading")
  const clearCart = useCartStore((state) => state.clearCart)

  useEffect(() => {
    let cancelled = false
    const confirm = async () => {
      if (!orderId || !ORDER_ID_REGEX.test(orderId)) {
        setStatus("error")
        return
      }
      try {
        const result = await confirmOrder(orderId)
        if (!cancelled) {
          setStatus("confirmed")
          clearCart()
          trackPurchase({
            orderId,
            totalCents: result.totalCents,
            items: result.items.map((item) => ({
              sku: item.sku,
              quantity: item.quantity,
              unitPriceCents: item.priceInCents,
            })),
          })
        }
      } catch {
        if (!cancelled) {
          setStatus("error")
        }
      }
    }
    confirm()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId])

  if (status === "loading") {
    return (
      <div className="bg-background py-12 sm:py-16 lg:py-24">
        <div className="mx-auto max-w-xl px-5 text-center sm:px-6 lg:px-8">
          <div className="flex justify-center">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
          <p className="mt-6 text-base text-muted-foreground sm:text-lg">Потвърждаване на поръчката...</p>
        </div>
      </div>
    )
  }

  if (status === "error") {
    return (
      <div className="bg-background py-12 sm:py-16 lg:py-24">
        <div className="mx-auto max-w-xl px-5 text-center sm:px-6 lg:px-8">
          <p className="text-[10px] font-medium uppercase tracking-[0.25em] text-muted-foreground sm:text-[11px] sm:tracking-[0.3em]">
            Грешка
          </p>
          <h1 className="mt-4 text-[28px] font-light leading-[1.1] tracking-[-0.03em] text-foreground sm:mt-6 sm:text-3xl sm:leading-[1.05] sm:tracking-[-0.04em] lg:text-4xl">
            Възникна проблем
          </h1>
          <p className="mt-4 text-[13px] leading-[1.7] text-muted-foreground sm:text-sm sm:leading-7">
            Не успяхме да потвърдим поръчката. Моля, свържете се с нас.
          </p>
          <Button asChild className="mt-6 h-12 w-full gap-2 rounded-full bg-primary text-[10px] uppercase tracking-[0.16em] text-primary-foreground hover:opacity-90 sm:mt-8 sm:h-11 sm:w-auto sm:px-6" size="lg">
            <Link href="/contact">Свържете се с нас</Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-background py-12 sm:py-16 lg:py-24">
      <div className="mx-auto max-w-xl px-5 text-center sm:px-6 lg:px-8">
        <div className="flex justify-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
            <CheckCircle className="h-12 w-12 text-primary" />
          </div>
        </div>

        <p className="mt-6 text-[10px] font-medium uppercase tracking-[0.25em] text-muted-foreground sm:mt-8 sm:text-[11px] sm:tracking-[0.3em]">
          Готово
        </p>
        <h1 className="mt-4 text-[32px] font-light leading-[1.1] tracking-[-0.03em] text-foreground sm:mt-6 sm:text-4xl sm:leading-[1.05] sm:tracking-[-0.04em] lg:text-5xl">
          Поръчката
          <span className="block text-muted-foreground">е успешна</span>
        </h1>
        <p className="mx-auto mt-4 max-w-md text-[13px] leading-[1.7] text-muted-foreground sm:mt-6 sm:text-sm sm:leading-7">
          Благодарим Ви за поръчката. Ще получите имейл с потвърждение.
        </p>

        {orderId && (
          <Card className="mt-6 sm:mt-8">
            <CardContent className="p-6">
              <div className="flex items-center justify-center gap-3 text-[13px] text-muted-foreground sm:text-sm">
                <Package className="h-5 w-5" />
                <span>Номер на поръчка:</span>
              </div>
              <p className="mt-2 font-mono text-lg font-semibold text-foreground">
                {formatOrderId(orderId)}
              </p>
            </CardContent>
          </Card>
        )}

        <div className="mt-6 space-y-4 sm:mt-8">
          <p className="text-[13px] text-muted-foreground sm:text-sm">
            Очаквайте доставка в рамките на 3 работни дни.
          </p>
          <Button asChild size="lg" className="h-12 w-full gap-2 rounded-full bg-primary text-[10px] uppercase tracking-[0.16em] text-primary-foreground hover:opacity-90 sm:h-11 sm:w-auto sm:px-6">
            <Link href="/products">
              Продължи пазаруването
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
