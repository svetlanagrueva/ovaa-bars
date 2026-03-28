"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Package, FileText, Clock } from "lucide-react"
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
      {stats.invoicesAwaiting > 0 && (
        <div className="mb-6">
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
        </div>
      )}

      {/* Stats cards */}
      <p className="text-xs text-muted-foreground mb-2">Приходи от продукти (без доставка и НП такси)</p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Днес</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatPrice(stats.today.revenue)}</div>
            <p className="text-sm text-muted-foreground">
              {stats.today.orders} {stats.today.orders === 1 ? "поръчка" : "поръчки"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Тази седмица</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatPrice(stats.week.revenue)}</div>
            <p className="text-sm text-muted-foreground">
              {stats.week.orders} {stats.week.orders === 1 ? "поръчка" : "поръчки"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Този месец</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatPrice(stats.month.revenue)}</div>
            <p className="text-sm text-muted-foreground">
              {stats.month.orders} {stats.month.orders === 1 ? "поръчка" : "поръчки"}
            </p>
          </CardContent>
        </Card>
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
