"use client"

import { useEffect, useState, use } from "react"
import Link from "next/link"
import {
  getProductBatch,
  getBatchAffectedOrders,
  recallBatch,
  type ProductBatchWithAvailability,
  type BatchAffectedOrder,
} from "@/app/actions/admin"
import { PRODUCTS } from "@/lib/products"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export default function BatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [batch, setBatch] = useState<ProductBatchWithAvailability | null>(null)
  const [affected, setAffected] = useState<BatchAffectedOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [recallOpen, setRecallOpen] = useState(false)
  const [recallReason, setRecallReason] = useState("")
  const [recallBusy, setRecallBusy] = useState(false)

  async function refresh() {
    setLoading(true)
    setError("")
    try {
      const [b, a] = await Promise.all([
        getProductBatch(id),
        getBatchAffectedOrders(id),
      ])
      setBatch(b)
      setAffected(a)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Грешка")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [id])

  async function downloadCSV() {
    if (affected.length === 0) return
    const headers = [
      "Поръчка", "Статус", "Клиент", "Имейл", "Телефон", "Град",
      "Изпратена на", "Доставена на", "Количество от партида", "Товарителница",
    ]
    const rows = affected.map((a) => [
      a.order_id.slice(0, 8),
      a.order_status,
      `${a.customer_first_name} ${a.customer_last_name}`,
      a.customer_email,
      a.customer_phone,
      a.customer_city,
      a.shipped_at ? new Date(a.shipped_at).toLocaleDateString("bg-BG") : "",
      a.delivered_at ? new Date(a.delivered_at).toLocaleDateString("bg-BG") : "",
      String(a.quantity_from_batch),
      a.tracking_number ?? "",
    ])
    const csv = "﻿" + [headers, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `batch-${batch?.batch_number ?? id}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) return <div className="mx-auto max-w-3xl px-4 py-8 text-sm text-muted-foreground">Зареждане...</div>
  if (!batch) return <div className="mx-auto max-w-3xl px-4 py-8"><p className="text-sm text-red-700">{error || "Партидата не е намерена"}</p></div>

  const skuLabel = PRODUCTS.find((p) => p.sku === batch.sku)?.name ?? batch.sku
  const isRecalled = batch.status === "recalled"

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <Link href="/admin/batches" className="text-sm text-blue-600 hover:underline">
            ← Към партиди
          </Link>
          <h1 className="mt-1 text-2xl font-bold font-mono">{batch.batch_number}</h1>
          <p className="text-sm text-muted-foreground">{skuLabel} ({batch.sku})</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs uppercase tracking-wide ${isRecalled ? "bg-red-100 text-red-800" : "bg-green-100 text-green-800"}`}>
          {isRecalled ? "изтеглена" : "активна"}
        </span>
      </div>

      {error && <p className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">{error}</p>}

      <Card className="mb-4">
        <CardHeader><CardTitle className="text-base">Детайли</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div><span className="text-muted-foreground">SKU:</span> <span className="font-mono">{batch.sku}</span></div>
          <div><span className="text-muted-foreground">Партида №:</span> <span className="font-mono">{batch.batch_number}</span></div>
          <div>
            <span className="text-muted-foreground">Срок на годност:</span>{" "}
            {new Date(batch.expiry_date).toLocaleDateString("bg-BG")}
          </div>
          <div><span className="text-muted-foreground">Налични за продажба:</span> <span className="font-medium">{batch.quantity_available}</span></div>
          {isRecalled && (
            <>
              <div>
                <span className="text-muted-foreground">Изтеглена на:</span>{" "}
                {batch.recalled_at ? new Date(batch.recalled_at).toLocaleString("bg-BG") : "—"}
                {batch.recalled_by && <span className="ml-2 text-xs">от {batch.recalled_by}</span>}
              </div>
              {batch.recall_reason && (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-900">
                  <span className="font-medium">Причина за изтегляне:</span>
                  <p className="mt-1 whitespace-pre-wrap">{batch.recall_reason}</p>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Засегнати поръчки ({affected.length})</CardTitle>
            {affected.length > 0 && (
              <Button size="sm" variant="outline" onClick={downloadCSV}>Изтегли CSV</Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {affected.length === 0 ? (
            <p className="text-sm text-muted-foreground">Тази партида все още не е изпратена към клиенти.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Поръчка</TableHead>
                  <TableHead>Клиент</TableHead>
                  <TableHead>Контакт</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead className="text-right">Бр.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {affected.map((a) => (
                  <TableRow key={a.order_id}>
                    <TableCell>
                      <Link href={`/admin/orders/${a.order_id}`} className="font-mono text-xs text-blue-600 hover:underline">
                        #{a.order_id.slice(0, 8)}
                      </Link>
                      {a.shipped_at && (
                        <div className="text-[10px] text-muted-foreground">
                          изпр. {new Date(a.shipped_at).toLocaleDateString("bg-BG")}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{a.customer_first_name} {a.customer_last_name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <div>{a.customer_email}</div>
                      <div>{a.customer_phone}</div>
                    </TableCell>
                    <TableCell className="text-xs">{a.order_status}</TableCell>
                    <TableCell className="text-right text-sm font-medium">{a.quantity_from_batch}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {!isRecalled && (
        <Card>
          <CardHeader><CardTitle className="text-base">Действия</CardTitle></CardHeader>
          <CardContent>
            <Button variant="destructive" onClick={() => { setRecallReason(""); setRecallOpen(true) }}>
              Изтегли партидата от пазара
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">
              След изтегляне партидата няма да може да се ползва в нови изпращания. Действието е необратимо.
            </p>
          </CardContent>
        </Card>
      )}

      {recallOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setRecallOpen(false)}>
          <div className="mx-4 w-full max-w-md rounded-lg bg-background p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-2 text-lg font-semibold">Изтегли партидата</h3>
            <p className="mb-4 text-xs text-muted-foreground">
              Това ще маркира партидата като изтеглена. Тази партида не може да бъде ползвана в нови изпращания.
              Засегнати поръчки: <strong>{affected.length}</strong>. Свържете се с клиентите според рекъл процедурата.
            </p>
            <textarea
              value={recallReason}
              onChange={(e) => setRecallReason(e.target.value)}
              placeholder="Причина за изтеглянето (минимум 20 символа). Напр. 'Съмнения за повишена влажност в склад на доставчика, потенциална контаминация'."
              maxLength={1000}
              rows={5}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              {recallReason.trim().length}/20 символа минимум
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" disabled={recallBusy} onClick={() => setRecallOpen(false)}>Отказ</Button>
              <Button
                variant="destructive"
                disabled={recallBusy || recallReason.trim().length < 20}
                onClick={async () => {
                  setRecallBusy(true)
                  setError("")
                  try {
                    await recallBatch(id, recallReason.trim())
                    setRecallOpen(false)
                    setRecallReason("")
                    await refresh()
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Грешка")
                  } finally { setRecallBusy(false) }
                }}
              >
                Изтегли партидата
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
