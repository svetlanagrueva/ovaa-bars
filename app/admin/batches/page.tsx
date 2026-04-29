"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { getProductBatches, type ProductBatchWithAvailability, type ProductBatchStatus } from "@/app/actions/admin"
import { PRODUCTS } from "@/lib/products"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const STATUS_LABELS: Record<ProductBatchStatus | "all", string> = {
  all: "Всички",
  active: "Активни",
  recalled: "Изтеглени",
}
const STATUS_BADGE: Record<ProductBatchStatus, string> = {
  active: "bg-green-100 text-green-800",
  recalled: "bg-red-100 text-red-800",
}

export default function AdminBatchesPage() {
  const [batches, setBatches] = useState<ProductBatchWithAvailability[]>([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<ProductBatchStatus | "all">("all")
  const [skuFilter, setSkuFilter] = useState<string>("all")

  const fetch = useCallback(async () => {
    setLoading(true)
    try {
      const result = await getProductBatches({
        sku: skuFilter !== "all" ? skuFilter : undefined,
        status,
      })
      setBatches(result)
    } catch {
      // session expired
    } finally {
      setLoading(false)
    }
  }, [skuFilter, status])

  useEffect(() => {
    fetch()
  }, [fetch])

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Партиди</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Проследимост на партиди (EU 178/2002, EU 931/2011). Всяка партида,
          постъпваща в склада, се регистрира тук и се проследява до клиента
          при изпращане.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">SKU</label>
          <select
            value={skuFilter}
            onChange={(e) => setSkuFilter(e.target.value)}
            className="h-8 rounded-md border border-border bg-background px-3 text-sm"
          >
            <option value="all">Всички SKU</option>
            {PRODUCTS.map((p) => (
              <option key={p.sku} value={p.sku}>
                {p.sku} — {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          {(Object.keys(STATUS_LABELS) as Array<ProductBatchStatus | "all">).map((s) => (
            <Button
              key={s}
              variant={status === s ? "default" : "outline"}
              size="sm"
              onClick={() => setStatus(s)}
            >
              {STATUS_LABELS[s]}
            </Button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border bg-white">
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Зареждане...</div>
        ) : batches.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Няма партиди за избраните филтри. Партидите се регистрират автоматично при добавяне на склад от <Link href="/admin/inventory" className="text-blue-600 hover:underline">/admin/inventory</Link>.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Партида №</TableHead>
                <TableHead>Срок на годност</TableHead>
                <TableHead className="text-right">Налични</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.map((b) => {
                const skuLabel = PRODUCTS.find((p) => p.sku === b.sku)?.name ?? b.sku
                const expiryDate = new Date(b.expiry_date)
                const daysToExpiry = Math.floor((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                return (
                  <TableRow key={b.id}>
                    <TableCell className="text-sm">
                      <div className="font-mono text-xs text-muted-foreground">{b.sku}</div>
                      <div>{skuLabel}</div>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{b.batch_number}</TableCell>
                    <TableCell className="text-sm">
                      {expiryDate.toLocaleDateString("bg-BG", {
                        day: "2-digit", month: "2-digit", year: "numeric",
                      })}
                      <div className={`text-[11px] ${daysToExpiry < 0 ? "text-red-700" : daysToExpiry < 30 ? "text-amber-700" : "text-muted-foreground"}`}>
                        {daysToExpiry < 0 ? `изтекла преди ${Math.abs(daysToExpiry)} дни` : `${daysToExpiry} дни до изтичане`}
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-sm font-medium">{b.quantity_available}</TableCell>
                    <TableCell className="text-xs">
                      <span className={`rounded-full px-2 py-1 ${STATUS_BADGE[b.status]}`}>
                        {STATUS_LABELS[b.status]}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/admin/batches/${b.id}`}
                        className="text-sm text-blue-600 hover:underline"
                      >
                        Отвори ↗
                      </Link>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
