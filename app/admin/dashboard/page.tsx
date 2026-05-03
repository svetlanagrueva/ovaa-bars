"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Package, FileText, Banknote, AlertTriangle } from "lucide-react"
import { getDashboardStats, type DashboardStats } from "@/app/actions/admin"
import { formatPrice } from "@/lib/products"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

const STATUS_LABELS: Record<string, string> = {
  pending: "Чакаща",
  confirmed: "Потвърдена",
  shipped: "Изпратена",
  delivered: "Доставена",
  cancelled: "Отказана",
}

const STATUS_BADGE_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  confirmed: "default",
  shipped: "secondary",
  delivered: "secondary",
  cancelled: "destructive",
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getDashboardStats()
      .then(setStats)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8">
        <h1 className="text-2xl font-bold mb-6">Табло</h1>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="h-16 animate-pulse rounded bg-secondary" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  if (!stats) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8">
        <h1 className="text-2xl font-bold mb-6">Табло</h1>
        <p className="text-muted-foreground">Грешка при зареждане на данните.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">Табло</h1>

      {/* Action items */}
      {(stats.invoicesAwaiting > 0 || stats.awaitingSettlement > 0 || stats.inventoryDebtSkus > 0 || stats.withdrawalsPending > 0) && (
        <div className="mb-6 space-y-3">
          {stats.inventoryDebtSkus > 0 && (
            <Link href="/admin/inventory" className="block">
              <div className="rounded-lg border border-red-300 bg-red-50 p-4 transition-colors hover:bg-red-100">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="h-5 w-5 text-red-700" />
                  <div>
                    <p className="text-sm font-medium text-red-900">
                      {stats.inventoryDebtSkus} {stats.inventoryDebtSkus === 1 ? "SKU в оперативен дълг" : "SKU в оперативен дълг"}
                    </p>
                    <p className="text-xs text-red-700">Отрицателна наличност — нужна е реконсилиация</p>
                  </div>
                </div>
              </div>
            </Link>
          )}
          {stats.awaitingSettlement > 0 && (
            <Link href="/admin/orders?status=delivered&paymentFilter=awaiting-settlement" className="block">
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 transition-colors hover:bg-amber-100">
                <div className="flex items-center gap-3">
                  <Banknote className="h-5 w-5 text-amber-700" />
                  <div>
                    <p className="text-sm font-medium text-amber-900">
                      {stats.awaitingSettlement} {stats.awaitingSettlement === 1 ? "поръчка чака" : "поръчки чакат"} плащане от куриер
                    </p>
                    <p className="text-xs text-amber-700">Доставени с наложен платеж, неполучено плащане</p>
                  </div>
                </div>
              </div>
            </Link>
          )}
          {stats.invoicesAwaiting > 0 && (
            <Link href="/admin/orders?invoiceFilter=pending" className="block">
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 transition-colors hover:bg-amber-100">
                <div className="flex items-center gap-3">
                  <FileText className="h-5 w-5 text-amber-700" />
                  <div>
                    <p className="text-sm font-medium text-amber-900">
                      {stats.invoicesAwaiting} {stats.invoicesAwaiting === 1 ? "фактура чака" : "фактури чакат"} издаване
                    </p>
                  </div>
                </div>
              </div>
            </Link>
          )}
          {stats.withdrawalsPending > 0 && (
            <Link href="/admin/returns" className="block">
              <div className="rounded-lg border border-blue-300 bg-blue-50 p-4 transition-colors hover:bg-blue-100">
                <div className="flex items-center gap-3">
                  <FileText className="h-5 w-5 text-blue-700" />
                  <div>
                    <p className="text-sm font-medium text-blue-900">
                      {stats.withdrawalsPending} {stats.withdrawalsPending === 1 ? "заявка за връщане в обработка" : "заявки за връщане в обработка"}
                    </p>
                    <p className="text-xs text-blue-700">Право на отказ — изисква преглед, одобрение или приключване</p>
                  </div>
                </div>
              </div>
            </Link>
          )}
        </div>
      )}

      {/* Stats cards. Headline = NET product revenue (gross − refunds in
          window); when refunds occurred we show the gross + refund breakdown
          below so the deduction is auditable, not magic. */}
      <p className="text-xs text-muted-foreground mb-2">Нетни приходи от продукти (без доставка и НП такси, след възстановявания)</p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(["today", "week", "month"] as const).map((key) => {
          const w = stats[key]
          const net = w.revenue - w.refunds
          const label = key === "today" ? "Днес" : key === "week" ? "Тази седмица" : "Този месец"
          return (
            <Card key={key}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${net < 0 ? "text-red-700" : ""}`}>
                  {formatPrice(net)}
                </div>
                <p className="text-sm text-muted-foreground">
                  {w.orders} {w.orders === 1 ? "поръчка" : "поръчки"}
                </p>
                {w.refunds > 0 && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    бруто {formatPrice(w.revenue)}
                    <span className="text-red-700"> − {formatPrice(w.refunds)} възст.</span>
                  </p>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Recent orders */}
      <Card className="mt-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Последни поръчки</CardTitle>
          <Link href="/admin/orders" className="text-sm text-blue-600 hover:underline">
            Виж всички
          </Link>
        </CardHeader>
        <CardContent>
          {stats.recentOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground">Няма поръчки</p>
          ) : (
            <div className="space-y-3">
              {stats.recentOrders.map((order) => (
                <Link
                  key={order.id}
                  href={`/admin/orders/${order.id}`}
                  className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-secondary"
                >
                  <div className="flex items-center gap-3">
                    <Package className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">
                        {order.first_name} {order.last_name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        #{order.id.slice(0, 8)} &middot;{" "}
                        {new Date(order.created_at).toLocaleDateString("bg-BG", {
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium">{formatPrice(order.total_amount)}</span>
                    <Badge variant={STATUS_BADGE_VARIANT[order.status] || "outline"}>
                      {STATUS_LABELS[order.status] || order.status}
                    </Badge>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
