"use client"

import { Suspense } from "react"
import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Search, Download } from "lucide-react"
import { getOrders, getAllOrders, type OrderSummary } from "@/app/actions/admin"
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

export default function AdminOrdersPageWrapper() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-7xl px-4 py-8"><p className="text-muted-foreground">Зареждане...</p></div>}>
      <AdminOrdersPage />
    </Suspense>
  )
}

function AdminOrdersPage() {
  const searchParams = useSearchParams()

  const [orders, setOrders] = useState<OrderSummary[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [status, setStatus] = useState(searchParams.get("status") || "all")
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [invoiceFilter, setInvoiceFilter] = useState(searchParams.get("invoiceFilter") || "all")
  const [csvLoading, setCsvLoading] = useState(false)

  const filters = { status, search, dateFrom, dateTo, invoiceFilter }

  const fetchOrders = useCallback(async () => {
    setLoading(true)
    try {
      const result = await getOrders({ ...filters, page })
      setOrders(result.orders)
      setTotal(result.total)
    } catch {
      // Session expired — redirect handled by middleware
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, search, dateFrom, dateTo, invoiceFilter, page])

  useEffect(() => {
    const timeout = setTimeout(fetchOrders, search ? 300 : 0)
    return () => clearTimeout(timeout)
  }, [fetchOrders])

  function handleStatusChange(value: string) {
    setStatus(value)
    setPage(0)
  }

  const totalPages = Math.ceil(total / 100)

  function clearFilters() {
    setSearch("")
    setDateFrom("")
    setDateTo("")
    setStatus("all")
    setInvoiceFilter("all")
    setPage(0)
  }

  async function downloadCSV() {
    if (total === 0) return
    setCsvLoading(true)
    try {
      const allOrders = await getAllOrders(filters)

      const headers = ["ID", "Дата", "Име", "Имейл", "Телефон", "Град", "Продукти", "Промо отстъпка", "Доставка такса", "НП такса", "Общо", "Плащане", "Доставка", "Статус", "Фактура №", "Фактура дата"]
      const rows = allOrders.map((o) => {
        const productRevenue = o.total_amount - (o.shipping_fee || 0) - (o.cod_fee || 0) + (o.discount_amount || 0)
        return [
          o.id.slice(0, 8),
          new Date(o.created_at).toLocaleDateString("bg-BG"),
          `${o.first_name} ${o.last_name}`,
          o.email,
          o.phone,
          o.city,
          (productRevenue / 100).toFixed(2),
          o.discount_amount ? `-${(o.discount_amount / 100).toFixed(2)}` : "0.00",
          ((o.shipping_fee || 0) / 100).toFixed(2),
          ((o.cod_fee || 0) / 100).toFixed(2),
          (o.total_amount / 100).toFixed(2),
          o.payment_method === "card" ? "Карта" : "Наложен платеж",
          o.logistics_partner || "",
          STATUS_LABELS[o.status] || o.status,
          o.invoice_number || "",
          o.invoice_date ? new Date(o.invoice_date).toLocaleDateString("bg-BG") : "",
        ]
      })

      const csvContent = "\uFEFF" + [headers, ...rows]
        .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
        .join("\n")

      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      alert("Грешка при експорт на CSV")
    } finally {
      setCsvLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Поръчки</h1>
        <Button variant="outline" size="sm" onClick={downloadCSV} disabled={total === 0 || csvLoading}>
          <Download className="mr-2 h-4 w-4" />
          {csvLoading ? "Експорт..." : `CSV (${total})`}
        </Button>
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
              onChange={(e) => { setSearch(e.target.value); setPage(0) }}
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
            onChange={(e) => { setDateFrom(e.target.value); setPage(0) }}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="dateTo" className="text-sm text-muted-foreground">До дата</Label>
          <Input
            id="dateTo"
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(0) }}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="invoiceFilter" className="text-sm text-muted-foreground">Фактура</Label>
          <select
            id="invoiceFilter"
            value={invoiceFilter}
            onChange={(e) => { setInvoiceFilter(e.target.value); setPage(0) }}
            className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
          >
            <option value="all">Всички</option>
            <option value="requested">Поискана</option>
            <option value="issued">Издадена</option>
            <option value="pending">Чака издаване</option>
          </select>
        </div>
        {(search || dateFrom || dateTo || invoiceFilter !== "all") && (
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
                        const taxDate = order.payment_method === "cod" && order.delivered_at
                          ? new Date(order.delivered_at)
                          : new Date(order.created_at)
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

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {total} {total === 1 ? "поръчка" : "поръчки"} — страница {page + 1} от {totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              Назад
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages - 1}
              onClick={() => setPage(page + 1)}
            >
              Напред
            </Button>
          </div>
        </div>
      )}

      {totalPages <= 1 && total > 0 && (
        <p className="mt-4 text-sm text-muted-foreground">
          {total} {total === 1 ? "поръчка" : "поръчки"}
        </p>
      )}
    </div>
  )
}
