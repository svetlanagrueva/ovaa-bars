"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { Search, Download } from "lucide-react"
import { getInvoices, getAllInvoices, downloadInvoicePDF, type InvoiceSummary } from "@/app/actions/admin"
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
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [csvLoading, setCsvLoading] = useState(false)

  const filters = { search, dateFrom, dateTo }

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
  }, [search, dateFrom, dateTo, page])

  useEffect(() => {
    const timeout = setTimeout(fetchInvoices, search ? 300 : 0)
    return () => clearTimeout(timeout)
  }, [fetchInvoices])

  function clearFilters() {
    setSearch("")
    setDateFrom("")
    setDateTo("")
    setPage(0)
  }

  const totalPages = Math.ceil(total / 100)

  async function downloadCSV() {
    if (total === 0) return
    setCsvLoading(true)
    try {
      const allInvoices = await getAllInvoices(filters)

      const headers = ["Фактура №", "Дата", "Клиент", "Имейл", "Фирма", "ЕИК", "Сума", "Поръчка"]
      const rows = allInvoices.map((inv) => [
        inv.invoice_number,
        new Date(inv.invoice_date).toLocaleDateString("bg-BG"),
        `${inv.first_name} ${inv.last_name}`,
        inv.email,
        inv.invoice_company_name || "",
        inv.invoice_eik || "",
        (inv.total_amount / 100).toFixed(2),
        inv.id.slice(0, 8),
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
      // Error exporting
    } finally {
      setCsvLoading(false)
    }
  }

  async function handleDownload(orderId: string) {
    setDownloadingId(orderId)
    try {
      const { pdfBase64, filename } = await downloadInvoicePDF(orderId)
      const blob = new Blob(
        [Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0))],
        { type: "application/pdf" }
      )
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      // Error downloading
    } finally {
      setDownloadingId(null)
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

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Label htmlFor="search" className="text-sm text-muted-foreground">Търсене</Label>
          <div className="relative mt-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="search"
              placeholder="Номер, име, имейл или фирма..."
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
        {(search || dateFrom || dateTo) && (
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
                <TableHead>Номер</TableHead>
                <TableHead>Дата</TableHead>
                <TableHead>Клиент</TableHead>
                <TableHead>Фирма</TableHead>
                <TableHead>Сума</TableHead>
                <TableHead>Поръчка</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-mono text-sm">#{inv.invoice_number}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(inv.invoice_date).toLocaleDateString("bg-BG", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                    })}
                  </TableCell>
                  <TableCell>
                    <div className="text-sm font-medium">{inv.first_name} {inv.last_name}</div>
                    <div className="text-xs text-muted-foreground">{inv.email}</div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {inv.invoice_company_name || <span className="text-muted-foreground">—</span>}
                    {inv.invoice_eik && (
                      <div className="text-xs text-muted-foreground">ЕИК: {inv.invoice_eik}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm font-medium">{formatPrice(inv.total_amount)}</TableCell>
                  <TableCell>
                    <Link
                      href={`/admin/orders/${inv.id}`}
                      className="font-mono text-sm text-blue-600 hover:underline"
                    >
                      #{inv.id.slice(0, 8)}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={downloadingId === inv.id}
                      onClick={() => handleDownload(inv.id)}
                    >
                      {downloadingId === inv.id ? "..." : "PDF"}
                    </Button>
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
