"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { Search } from "lucide-react"
import { getOrders, type OrderSummary } from "@/app/actions/admin"
import { formatPrice } from "@/lib/products"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
  const [search, setSearch] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")

  const fetchOrders = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getOrders({ status, search, dateFrom, dateTo })
      setOrders(data)
    } catch {
      // Session expired — redirect handled by middleware
    } finally {
      setLoading(false)
    }
  }, [status, search, dateFrom, dateTo])

  useEffect(() => {
    const timeout = setTimeout(fetchOrders, search ? 300 : 0)
    return () => clearTimeout(timeout)
  }, [fetchOrders])

  function handleStatusChange(value: string) {
    setStatus(value)
  }

  function clearFilters() {
    setSearch("")
    setDateFrom("")
    setDateTo("")
    setStatus("all")
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Поръчки</h1>
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

      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Label htmlFor="search" className="text-sm text-muted-foreground">Търсене</Label>
          <div className="relative mt-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="search"
              placeholder="ID, име или имейл..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
        <div>
          <Label htmlFor="dateFrom" className="text-sm text-muted-foreground">От дата</Label>
          <Input
            id="dateFrom"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="dateTo" className="text-sm text-muted-foreground">До дата</Label>
          <Input
            id="dateTo"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="mt-1"
          />
        </div>
        {(search || dateFrom || dateTo) && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Изчисти
          </Button>
        )}
      </div>

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
                <TableHead>Фактура</TableHead>
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
                  <TableCell className="text-sm">
                    {order.invoice_number ? (
                      <span className="font-mono text-xs">#{order.invoice_number}</span>
                    ) : order.needs_invoice ? (
                      (() => {
                        const isPaid = order.payment_method === "card" || order.status === "delivered"
                        if (!isPaid) return <Badge variant="outline" className="text-xs">Поискана</Badge>
                        const taxDate = new Date(order.created_at)
                        const deadline = new Date(taxDate.getTime() + 5 * 24 * 60 * 60 * 1000)
                        const daysLeft = Math.ceil((deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                        return (
                          <Badge
                            variant={daysLeft <= 0 ? "destructive" : "outline"}
                            className={`text-xs ${daysLeft > 0 && daysLeft <= 2 ? "border-amber-400 text-amber-700" : ""}`}
                          >
                            {daysLeft <= 0 ? "Просрочена!" : `${daysLeft}д`}
                          </Badge>
                        )
                      })()
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
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
