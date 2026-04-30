"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { Download } from "lucide-react"
import {
  getProductBatches,
  getRecallCandidates,
  type ProductBatchWithAvailability,
  type ProductBatchStatus,
  type RecallCandidate,
} from "@/app/actions/admin"
import { PRODUCTS } from "@/lib/products"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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

  // SKU-level recall (over-approximate by SKU). Used when the precise
  // affected-orders list on a batch detail isn't enough — pre-Tier-1
  // historical orders, suspected supplier-wide issues, broad outreach.
  const [recallSku, setRecallSku] = useState("")
  const [recallFrom, setRecallFrom] = useState("")
  const [recallTo, setRecallTo] = useState("")
  const [recallLoading, setRecallLoading] = useState(false)
  const [recallError, setRecallError] = useState("")
  const [recallResult, setRecallResult] = useState<RecallCandidate[] | null>(null)

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

  // Two-step recall flow: "Покажи" fetches + displays preview counts;
  // "CSV" re-uses the same results to build the download. Running the
  // query twice (once for preview, once for CSV) would be wasteful and
  // could return different rows if orders changed between clicks.
  async function handleRecallSearch(e: React.FormEvent) {
    e.preventDefault()
    setRecallLoading(true)
    setRecallError("")
    setRecallResult(null)
    try {
      const results = await getRecallCandidates(
        recallSku,
        recallFrom || undefined,
        recallTo || undefined,
      )
      setRecallResult(results)
    } catch (err) {
      setRecallError(err instanceof Error ? err.message : "Грешка при търсенето")
    } finally {
      setRecallLoading(false)
    }
  }

  function handleRecallDownload() {
    if (!recallResult || recallResult.length === 0) return
    const headers = [
      "ID", "Създадена", "Статус", "Изпратена", "Доставена",
      "Име", "Имейл", "Телефон", "Град", "Адрес", "Пощ. код",
      "Брой", "Товарителница", "Куриер",
    ]
    const statusLabel: Record<RecallCandidate["status"], string> = {
      confirmed: "Потвърдена",
      shipped: "Изпратена",
      delivered: "Доставена",
    }
    const rows = recallResult.map((r) => [
      r.shortId,
      new Date(r.createdAt).toLocaleDateString("bg-BG"),
      statusLabel[r.status],
      r.shippedAt ? new Date(r.shippedAt).toLocaleDateString("bg-BG") : "",
      r.deliveredAt ? new Date(r.deliveredAt).toLocaleDateString("bg-BG") : "",
      `${r.firstName} ${r.lastName}`,
      r.email,
      r.phone,
      r.city,
      r.address ?? "",
      r.postalCode ?? "",
      String(r.quantity),
      r.trackingNumber ?? "",
      r.logisticsPartner ?? "",
    ])
    const csv = "﻿" + [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `recall-${recallSku}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

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

      {/* Over-approximate recall by SKU. Lives here (alongside the
          per-batch detail flow) because it's another path to the same
          end goal: a customer-contact CSV when a batch is suspect. Used
          when the precise per-batch list on /admin/batches/[id] isn't
          enough (pre-Tier-1 orders without order_item_batches rows,
          suspected supplier-wide issues, broad outreach). */}
      <Card className="mt-8">
        <CardHeader>
          <CardTitle className="text-base">Изтегляне от пазара по SKU</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-xs text-muted-foreground">
            Когато не знаеш конкретната партида, или искаш да достигнеш до всички клиенти на SKU за избран период (потвърдени, изпратени, доставени поръчки) — тук получаваш списък за контакт по телефон и имейл. За точно изтегляне на конкретна партида използвай страницата на партидата по-горе.
          </p>
          <form onSubmit={handleRecallSearch} className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label>Продукт</Label>
              <Select value={recallSku} onValueChange={setRecallSku} required>
                <SelectTrigger>
                  <SelectValue placeholder="Избери продукт" />
                </SelectTrigger>
                <SelectContent>
                  {PRODUCTS.map((p) => (
                    <SelectItem key={p.sku} value={p.sku}>{p.name} ({p.sku})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="recallFrom">От дата</Label>
              <Input id="recallFrom" type="date" value={recallFrom} onChange={(e) => setRecallFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="recallTo">До дата</Label>
              <Input id="recallTo" type="date" value={recallTo} onChange={(e) => setRecallTo(e.target.value)} />
            </div>
            <Button type="submit" disabled={recallLoading || !recallSku}>
              {recallLoading ? "Търсене..." : "Покажи"}
            </Button>
          </form>

          {recallError && <p className="mt-3 text-sm text-destructive">{recallError}</p>}

          {recallResult !== null && (
            <div className="mt-4 rounded-md border border-border/60 bg-secondary/30 p-3">
              {recallResult.length === 0 ? (
                <p className="text-sm text-muted-foreground">Няма поръчки за този SKU в избрания интервал.</p>
              ) : (
                <>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm">
                      Намерени <span className="font-medium">{recallResult.length}</span> поръчки,{" "}
                      общо <span className="font-medium">{recallResult.reduce((s, r) => s + r.quantity, 0)}</span> бр.
                      {" · "}
                      <span className="text-muted-foreground text-xs">
                        {(["confirmed", "shipped", "delivered"] as const).map((st) => {
                          const n = recallResult.filter((r) => r.status === st).length
                          if (n === 0) return null
                          const lbl = st === "confirmed" ? "потвърдени" : st === "shipped" ? "изпратени" : "доставени"
                          return <span key={st} className="ml-2">{n} {lbl}</span>
                        })}
                      </span>
                    </div>
                    <Button size="sm" variant="outline" className="gap-2" onClick={handleRecallDownload}>
                      <Download className="h-4 w-4" />
                      Експорт CSV
                    </Button>
                  </div>
                  {recallResult.length > 10 && (
                    <p className="mb-2 text-xs text-muted-foreground">
                      Показват се първите 10 реда. Пълният списък е в CSV файла.
                    </p>
                  )}
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-[11px]">ID</TableHead>
                          <TableHead className="text-[11px]">Статус</TableHead>
                          <TableHead className="text-[11px]">Създадена</TableHead>
                          <TableHead className="text-[11px]">Клиент</TableHead>
                          <TableHead className="text-[11px]">Телефон</TableHead>
                          <TableHead className="text-[11px] text-right">Бр.</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {recallResult.slice(0, 10).map((r) => (
                          <TableRow key={r.orderId}>
                            <TableCell className="text-xs font-mono">
                              <Link href={`/admin/orders/${r.orderId}`} className="text-blue-600 hover:underline">
                                #{r.shortId}
                              </Link>
                            </TableCell>
                            <TableCell className="text-xs">
                              <Badge variant="outline" className="text-[10px]">
                                {r.status === "confirmed" ? "Потвърдена" : r.status === "shipped" ? "Изпратена" : "Доставена"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {new Date(r.createdAt).toLocaleDateString("bg-BG")}
                            </TableCell>
                            <TableCell className="text-xs">{r.firstName} {r.lastName}</TableCell>
                            <TableCell className="text-xs font-mono">{r.phone}</TableCell>
                            <TableCell className="text-xs text-right font-medium">{r.quantity}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
