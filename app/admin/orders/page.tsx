"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { getOrders, logoutAdmin, type OrderSummary } from "@/app/actions/admin"
import { formatPrice } from "@/lib/products"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

const STATUS_LABELS: Record<string, string> = {
  all: "Всички",
  pending: "Чакащи",
  confirmed: "Потвърдени",
  shipped: "Изпратени",
  delivered: "Доставени",
  cancelled: "Отказани",
}

const STATUS_BADGE_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  confirmed: "default",
  shipped: "secondary",
  delivered: "secondary",
  cancelled: "destructive",
}

const PAYMENT_LABELS: Record<string, string> = {
  card: "Карта",
  cod: "Наложен платеж",
}

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<OrderSummary[]>([])
  const [status, setStatus] = useState("all")
  const [loading, setLoading] = useState(true)

  const fetchOrders = useCallback(async (filter: string) => {
    setLoading(true)
    try {
      const data = await getOrders(filter)
      setOrders(data)
    } catch {
      // Session expired — redirect handled by middleware
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchOrders(status)
  }, [status, fetchOrders])

  function handleStatusChange(value: string) {
    setStatus(value)
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Поръчки</h1>
        <form action={logoutAdmin}>
          <Button variant="outline" size="sm" type="submit">
            Изход
          </Button>
        </form>
      </div>

      <Tabs value={status} onValueChange={handleStatusChange}>
        <TabsList>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <TabsTrigger key={value} value={value}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="mt-4 rounded-lg border bg-white">
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Зареждане...</div>
        ) : orders.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Няма поръчки</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Поръчка</TableHead>
                <TableHead>Дата</TableHead>
                <TableHead>Клиент</TableHead>
                <TableHead>Град</TableHead>
                <TableHead>Сума</TableHead>
                <TableHead>Плащане</TableHead>
                <TableHead>Доставка</TableHead>
                <TableHead>Статус</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell>
                    <Link
                      href={`/admin/orders/${order.id}`}
                      className="font-mono text-sm text-blue-600 hover:underline"
                    >
                      #{order.id.slice(0, 8)}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(order.created_at).toLocaleDateString("bg-BG", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </TableCell>
                  <TableCell>
                    <div className="text-sm font-medium">{order.first_name} {order.last_name}</div>
                    <div className="text-xs text-muted-foreground">{order.email}</div>
                  </TableCell>
                  <TableCell className="text-sm">{order.city}</TableCell>
                  <TableCell className="text-sm font-medium">{formatPrice(order.total_amount)}</TableCell>
                  <TableCell className="text-sm">{PAYMENT_LABELS[order.payment_method] || order.payment_method}</TableCell>
                  <TableCell className="text-sm">{order.logistics_partner?.replace("-", " ") || "—"}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE_VARIANT[order.status] || "outline"}>
                      {STATUS_LABELS[order.status] || order.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
