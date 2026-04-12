"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { CheckCircle, Package, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useCartStore } from "@/lib/store/cart"
import { confirmOrder } from "@/app/actions/stripe"

export default function CheckoutSuccessPage() {
  const searchParams = useSearchParams()
  const orderId = searchParams.get("order_id")
  const [status, setStatus] = useState<"loading" | "confirmed" | "error">("loading")
  const clearCart = useCartStore((state) => state.clearCart)

  useEffect(() => {
    let cancelled = false
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const confirm = async () => {
      if (!orderId || !uuidRegex.test(orderId)) {
        setStatus("error")
        return
      }
      try {
        await confirmOrder(orderId)
        if (!cancelled) {
          setStatus("confirmed")
          clearCart()
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
      <div className="bg-background py-16 sm:py-20 lg:py-24">
        <div className="mx-auto max-w-xl px-6 text-center lg:px-8">
          <div className="flex justify-center">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
          <p className="mt-6 text-lg text-muted-foreground">Потвърждаване на поръчката...</p>
        </div>
      </div>
    )
  }

  if (status === "error") {
    return (
      <div className="bg-background py-16 sm:py-20 lg:py-24">
        <div className="mx-auto max-w-xl px-6 text-center lg:px-8">
          <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-muted-foreground">
            Грешка
          </p>
          <h1 className="mt-6 text-3xl font-light leading-[1.05] tracking-[-0.04em] text-foreground sm:text-4xl">
            Възникна проблем
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            Не успяхме да потвърдим поръчката. Моля, свържете се с нас.
          </p>
          <Button asChild className="mt-8 h-11 gap-2 rounded-full bg-primary px-6 text-[10px] uppercase tracking-[0.16em] text-primary-foreground hover:opacity-90" size="lg">
            <Link href="/contact">Свържете се с нас</Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-background py-16 sm:py-20 lg:py-24">
      <div className="mx-auto max-w-xl px-6 text-center lg:px-8">
        <div className="flex justify-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
            <CheckCircle className="h-12 w-12 text-primary" />
          </div>
        </div>

        <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-muted-foreground">
          Готово
        </p>
        <h1 className="mt-6 text-4xl font-light leading-[1.05] tracking-[-0.04em] text-foreground sm:text-5xl">
          Поръчката
          <span className="block text-muted-foreground">е успешна</span>
        </h1>
        <p className="mt-6 max-w-md mx-auto text-sm leading-relaxed text-muted-foreground">
          Благодарим Ви за поръчката. Ще получите имейл с потвърждение.
        </p>

        {orderId && (
          <Card className="mt-8">
            <CardContent className="p-6">
              <div className="flex items-center justify-center gap-3 text-muted-foreground">
                <Package className="h-5 w-5" />
                <span>Номер на поръчка:</span>
              </div>
              <p className="mt-2 font-mono text-lg font-semibold text-foreground">
                #{orderId.slice(0, 8).toUpperCase()}
              </p>
            </CardContent>
          </Card>
        )}

        <div className="mt-8 space-y-4">
          <p className="text-sm text-muted-foreground">
            Очаквайте доставка в рамките на 2 работни дни.
          </p>
          <Button asChild size="lg" className="h-11 w-full gap-2 rounded-full bg-primary px-6 text-[10px] uppercase tracking-[0.16em] text-primary-foreground hover:opacity-90 sm:w-auto">
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
