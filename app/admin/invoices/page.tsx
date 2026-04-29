"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { Search, Download } from "lucide-react"
import { getInvoices, getAllInvoices, type InvoiceSummary } from "@/app/actions/admin"
import { formatPrice } from "@/lib/products"
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

export default function AdminInvoicesPage() {
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [csvLoading, setCsvLoading] = useState(false)
  const [error, setError] = useState("")
  const [type, setType] = useState<"all" | "invoice" | "credit_note">("all")

  const filters = { search, dateFrom, dateTo, type }

  const fetchInvoices = useCallback(async () => {
    setLoading(true)
    try {
      const result = await getInvoices({ ...filters, page })
      setInvoices(result.invoices)
      setTotal(result.total)
    } catch {
      // Session expired
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, dateFrom, dateTo, type, page])

  useEffect(() => {
    const timeout = setTimeout(fetchInvoices, search ? 300 : 0)
    return () => clearTimeout(timeout)
  }, [fetchInvoices, search])

  function clearFilters() {
    setSearch("")
    setDateFrom("")
    setDateTo("")
    setType("all")
    setPage(0)
  }

  const totalPages = Math.ceil(total / 100)

  async function downloadCSV() {
    if (total === 0) return
    setCsvLoading(true)
    try {
      const allInvoices = await getAllInvoices(filters)

      const headers = ["Тип", "Документ №", "Дата", "Клиент", "Имейл", "Фирма", "ЕИК", "Сума", "Поръчка"]
      const rows = allInvoices.map((inv) => [
        inv.type === "credit_note" ? "Кредитно известие" : "Фактура",
        inv.invoice_number,
        new Date(inv.invoice_date).toLocaleDateString("bg-BG"),
        `${inv.customer_first_name} ${inv.customer_last_name}`,
        inv.customer_email,
        inv.company_name || "",
        inv.eik || "",
        (inv.order_total_amount / 100).toFixed(2),
        inv.order_id.slice(0, 8),
      ])

      const csvContent = "\uFEFF" + [headers, ...rows]
        .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
        .join("\n")

      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `invoices-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setError("Грешка при експорт на CSV")
    } finally {
      setCsvLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Фактури</h1>
        <Button variant="outline" size="sm" onClick={downloadCSV} disabled={total === 0 || csvLoading}>
          <Download className="mr-2 h-4 w-4" />
          {csvLoading ? "Експорт..." : `CSV (${total})`}
        </Button>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-900">
          {error}
          <button className="ml-2 underline" onClick={() => setError("")}>Затвори</button>
        </div>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Label htmlFor="search" className="text-sm text-muted-foreground">Търсене</Label>
          <div className="relative mt-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="search"
              placeholder="Номер на документ или име на фирма..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0) }}
              className="pl-9"
            />
          </div>
        </div>
        <div>
          <Label htmlFor="type" className="text-sm text-muted-foreground">Тип</Label>
          <select
            id="type"
            value={type}
            onChange={(e) => { setType(e.target.value as "all" | "invoice" | "credit_note"); setPage(0) }}
            className="mt-1 h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="all">Всички</option>
            <option value="invoice">Фактури</option>
            <option value="credit_note">Кредитни известия</option>
          </select>
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
        {(search || dateFrom || dateTo || type !== "all") && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Изчисти
          </Button>
        )}
      </div>

      <div className="mt-4 rounded-lg border bg-white">
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Зареждане...</div>
        ) : invoices.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Няма издадени фактури</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Тип</TableHead>
                <TableHead>Номер</TableHead>
                <TableHead>Дата</TableHead>
                <TableHead>Клиент</TableHead>
                <TableHead>Фирма</TableHead>
                <TableHead>Сума</TableHead>
                <TableHead>Поръчка</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="text-xs">
                    {inv.type === "credit_note" ? (
                      <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-800">КИ</span>
                    ) : (
                      <span className="rounded-full bg-blue-100 px-2 py-1 text-blue-800">Фактура</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-sm">#{inv.invoice_number}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(inv.invoice_date).toLocaleDateString("bg-BG", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                    })}
                  </TableCell>
                  <TableCell>
                    <div className="text-sm font-medium">{inv.customer_first_name} {inv.customer_last_name}</div>
                    <div className="text-xs text-muted-foreground">{inv.customer_email}</div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {inv.company_name || <span className="text-muted-foreground">—</span>}
                    {inv.eik && (
                      <div className="text-xs text-muted-foreground">ЕИК: {inv.eik}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm font-medium">{formatPrice(inv.order_total_amount)}</TableCell>
                  <TableCell>
                    <Link
                      href={`/admin/orders/${inv.order_id}`}
                      className="font-mono text-sm text-blue-600 hover:underline"
                    >
                      #{inv.order_id.slice(0, 8)}
                    </Link>
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
            {total} {total === 1 ? "фактура" : "фактури"} — страница {page + 1} от {totalPages}
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
          {total} {total === 1 ? "фактура" : "фактури"}
        </p>
      )}
    </div>
  )
}
