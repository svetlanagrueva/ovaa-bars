"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { Search } from "lucide-react"
import { getInvoices, downloadInvoicePDF, type InvoiceSummary } from "@/app/actions/admin"
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
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  const fetchInvoices = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getInvoices({ search, dateFrom, dateTo })
      setInvoices(data)
    } catch {
      // Session expired
    } finally {
      setLoading(false)
    }
  }, [search, dateFrom, dateTo])

  useEffect(() => {
    const timeout = setTimeout(fetchInvoices, search ? 300 : 0)
    return () => clearTimeout(timeout)
  }, [fetchInvoices])

  function clearFilters() {
    setSearch("")
    setDateFrom("")
    setDateTo("")
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
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Фактури</h1>
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
    </div>
  )
}
