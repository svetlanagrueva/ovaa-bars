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
  const [isConfirmed, setIsConfirmed] = useState(false)
  const clearCart = useCartStore((state) => state.clearCart)

  useEffect(() => {
    const confirm = async () => {
      if (orderId && !isConfirmed) {
        try {
          await confirmOrder(orderId)
          setIsConfirmed(true)
          clearCart()
        } catch (error) {
          console.error("Failed to confirm order:", error)
        }
      }
    }
    confirm()
  }, [orderId, isConfirmed, clearCart])

  return (
    <div className="bg-background py-16 sm:py-24">
      <div className="mx-auto max-w-xl px-4 text-center sm:px-6 lg:px-8">
        <div className="flex justify-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
            <CheckCircle className="h-12 w-12 text-primary" />
          </div>
        </div>

        <h1 className="mt-6 text-3xl font-bold tracking-tight text-foreground">
          Поръчката е успешна!
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
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
            Очаквайте доставка в рамките на 2 работни дни чрез Speedy.
          </p>
          <Button asChild size="lg" className="w-full sm:w-auto">
            <Link href="/products">
              Продължи пазаруването
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
