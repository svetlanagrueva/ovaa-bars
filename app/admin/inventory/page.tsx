"use client"

import { useEffect, useState, useCallback } from "react"
import { Plus, ArrowDownUp } from "lucide-react"
import {
  getInventoryStatus,
  addInventoryBatch,
  recordStockMovement,
  getProductBatches,
  type InventoryStatus,
  type InventoryLogEntry,
  type ProductBatchWithAvailability,
} from "@/app/actions/admin"
import { PRODUCTS } from "@/lib/products"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatBgDate } from "@/lib/utils"

const LOW_STOCK_THRESHOLD = 20

const TYPE_LABELS: Record<string, string> = {
  batch_in: "Входяща партида",
  order_out: "Поръчка",
  cancellation: "Отмяна",
  wholesale_out: "B2B изход",
  sample_out: "Маркетинг",
  damaged: "Брак",
  return_in: "Връщане",
  adjustment_gain: "Корекция +",
  adjustment_loss: "Корекция −",
}

const TYPE_BADGE_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  batch_in: "default",
  order_out: "secondary",
  cancellation: "outline",
  wholesale_out: "secondary",
  sample_out: "outline",
  damaged: "destructive",
  return_in: "default",
  adjustment_gain: "outline",
  adjustment_loss: "outline",
}

const OUTBOUND_TYPES = new Set(["order_out", "wholesale_out", "sample_out", "damaged", "adjustment_loss"])

const MOVEMENT_TYPE_OPTIONS = [
  { value: "wholesale_out", label: "B2B изход", refType: "invoice", refLabel: "Номер на фактура", notesRequired: false },
  { value: "sample_out", label: "Маркетинг / проби", refType: "internal", refLabel: "Номер на протокол", notesRequired: false },
  { value: "damaged", label: "Брак / повреда", refType: "internal", refLabel: "Вътрешен номер", notesRequired: true },
  { value: "return_in", label: "Връщане в наличност", refType: "return", refLabel: "Референция на връщане", notesRequired: false },
  { value: "adjustment_gain", label: "Корекция + (излишък)", refType: "internal", refLabel: "Номер на ревизия", notesRequired: true },
  { value: "adjustment_loss", label: "Корекция − (липса)", refType: "internal", refLabel: "Номер на ревизия", notesRequired: true },
] as const

function StockBadge({ quantity }: { quantity: number }) {
  if (quantity < 0) return <Badge variant="destructive">Дълг {quantity} бр.</Badge>
  if (quantity === 0) return <Badge variant="destructive">Изчерпан</Badge>
  if (quantity <= LOW_STOCK_THRESHOLD) return <Badge variant="outline" className="border-amber-400 text-amber-700">Малко — {quantity}</Badge>
  return <Badge variant="secondary">{quantity} бр.</Badge>
}

export default function AdminInventoryPage() {
  const [current, setCurrent] = useState<InventoryStatus[]>([])
  const [log, setLog] = useState<InventoryLogEntry[]>([])
  const [logSkuFilter, setLogSkuFilter] = useState<string>("all")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState("")

  // Batch form state
  const [sku, setSku] = useState("")
  const [quantity, setQuantity] = useState("")
  const [batchId, setBatchId] = useState("")
  const [expiryDate, setExpiryDate] = useState("")
  const [notes, setNotes] = useState("")
  const [batchIdempotencyKey, setBatchIdempotencyKey] = useState("")

  // Movement form state
  const [movDialogOpen, setMovDialogOpen] = useState(false)
  const [movLoading, setMovLoading] = useState(false)
  const [movError, setMovError] = useState("")
  const [movType, setMovType] = useState("")
  const [movSku, setMovSku] = useState("")
  const [movQty, setMovQty] = useState("")
  const [movRefId, setMovRefId] = useState("")
  const [movNotes, setMovNotes] = useState("")
  const [movBatchId, setMovBatchId] = useState("")
  const [movExpiryDate, setMovExpiryDate] = useState("")
  const [movOrderId, setMovOrderId] = useState("")
  const [movIdempotencyKey, setMovIdempotencyKey] = useState("")
  const [movAvailableBatches, setMovAvailableBatches] = useState<ProductBatchWithAvailability[]>([])
  const [movBatchesLoading, setMovBatchesLoading] = useState(false)

  // Regenerate idempotency keys on dialog open so each distinct submission
  // intent gets its own key. Double-clicks within a single dialog session
  // reuse the same key and collide at the unique index (treated as no-op).
  useEffect(() => {
    if (dialogOpen) setBatchIdempotencyKey(crypto.randomUUID())
  }, [dialogOpen])
  useEffect(() => {
    if (movDialogOpen) setMovIdempotencyKey(crypto.randomUUID())
  }, [movDialogOpen])

  // Fetch active batches for the selected SKU when the movement type can
  // attribute to a specific batch. Outbound types (wholesale_out, sample_out,
  // damaged, adjustment_loss) and adjustment_gain participate in
  // batch_quantity_available — tagging them keeps the batch ledger in sync
  // with inventory_current. return_in has its own free-text path because the
  // returned unit may pre-date the batches table.
  const BATCH_TAGGABLE_TYPES = new Set([
    "wholesale_out",
    "sample_out",
    "damaged",
    "adjustment_loss",
    "adjustment_gain",
  ])
  useEffect(() => {
    let cancelled = false
    if (!movDialogOpen || !movSku || !BATCH_TAGGABLE_TYPES.has(movType)) {
      setMovAvailableBatches([])
      return
    }
    setMovBatchesLoading(true)
    getProductBatches({ sku: movSku, status: "active" })
      .then((rows) => { if (!cancelled) setMovAvailableBatches(rows) })
      .catch(() => { if (!cancelled) setMovAvailableBatches([]) })
      .finally(() => { if (!cancelled) setMovBatchesLoading(false) })
    return () => { cancelled = true }
  // BATCH_TAGGABLE_TYPES is a stable Set literal; eslint can't see that.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movDialogOpen, movSku, movType])

  // Reset batch selection whenever SKU or type changes — a batch is tied to
  // a specific SKU, and the available list refetches.
  useEffect(() => { setMovBatchId("") }, [movSku, movType])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getInventoryStatus()
      setCurrent(data.current)
      setLog(data.log)
    } catch {
      setError("Грешка при зареждане на склада")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleAddBatch(e: React.FormEvent) {
    e.preventDefault()
    setActionLoading(true)
    setActionError("")
    try {
      await addInventoryBatch({
        sku,
        quantity: parseInt(quantity, 10),
        batchId,
        expiryDate,
        notes,
        idempotencyKey: batchIdempotencyKey,
      })
      setDialogOpen(false)
      setSku("")
      setQuantity("")
      setBatchId("")
      setExpiryDate("")
      setNotes("")
      await load()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Грешка")
    } finally {
      setActionLoading(false)
    }
  }

  const selectedMovType = MOVEMENT_TYPE_OPTIONS.find((o) => o.value === movType)

  async function handleMovement(e: React.FormEvent) {
    e.preventDefault()
    const qty = parseInt(movQty, 10)
    if (OUTBOUND_TYPES.has(movType) && Number.isFinite(qty)) {
      const currentQty = current.find((c) => c.sku === movSku)?.quantity ?? 0
      if (qty > currentQty) {
        const after = currentQty - qty
        const ok = window.confirm(
          `Внимание: тази операция ще доведе до отрицателна наличност за ${movSku}.\n\nТекуща: ${currentQty} бр.\nКоличество за изваждане: ${qty} бр.\nСлед операцията: ${after} бр. (оперативен дълг)\n\nПродължи?`,
        )
        if (!ok) return
      }
    }
    setMovLoading(true)
    setMovError("")
    try {
      await recordStockMovement({
        sku: movSku,
        type: movType as Parameters<typeof recordStockMovement>[0]["type"],
        quantity: parseInt(movQty, 10),
        referenceType: (selectedMovType?.refType ?? "internal") as "order" | "invoice" | "return" | "internal",
        referenceId: movRefId,
        notes: movNotes || undefined,
        batchId: movBatchId
          ? movBatchId
          : undefined,
        expiryDate: movType === "return_in" && movExpiryDate ? movExpiryDate : undefined,
        orderId: movType === "return_in" && movOrderId ? movOrderId : undefined,
        idempotencyKey: movIdempotencyKey,
      })
      setMovDialogOpen(false)
      setMovType("")
      setMovSku("")
      setMovQty("")
      setMovRefId("")
      setMovNotes("")
      setMovBatchId("")
      setMovExpiryDate("")
      setMovOrderId("")
      await load()
    } catch (err) {
      setMovError(err instanceof Error ? err.message : "Грешка")
    } finally {
      setMovLoading(false)
    }
  }


  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-bold mb-6">Склад</h1>
        <div className="grid gap-4 sm:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}><CardContent className="p-6"><div className="h-16 animate-pulse rounded bg-secondary" /></CardContent></Card>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-bold mb-6">Склад</h1>
        <p className="text-destructive">{error}</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Склад</h1>
        <div className="flex gap-2">
          <Dialog open={movDialogOpen} onOpenChange={setMovDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="gap-2">
                <ArrowDownUp className="h-4 w-4" />
                Движение на склад
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Движение на склад</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleMovement} className="space-y-4 mt-2">
                <div className="space-y-1.5">
                  <Label>Тип движение</Label>
                  <Select value={movType} onValueChange={setMovType} required>
                    <SelectTrigger>
                      <SelectValue placeholder="Избери тип" />
                    </SelectTrigger>
                    <SelectContent>
                      {MOVEMENT_TYPE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Продукт</Label>
                  <Select value={movSku} onValueChange={setMovSku} required>
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
                  <Label htmlFor="movQty">Количество</Label>
                  <Input id="movQty" type="number" min={1} max={100000} value={movQty} onChange={(e) => setMovQty(e.target.value)} required placeholder="напр. 10" />
                </div>
                {selectedMovType && (
                  <div className="space-y-1.5">
                    <Label htmlFor="movRef">{selectedMovType.refLabel} <span className="text-destructive">*</span></Label>
                    <Input id="movRef" value={movRefId} onChange={(e) => setMovRefId(e.target.value)} required placeholder="напр. INV-2026-001" maxLength={200} />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="movNotes">Бележки {selectedMovType?.notesRequired && <span className="text-destructive">*</span>}</Label>
                  <Input id="movNotes" value={movNotes} onChange={(e) => setMovNotes(e.target.value)} placeholder={selectedMovType?.notesRequired ? "Задължително" : "Незадължително"} maxLength={500} required={selectedMovType?.notesRequired} />
                </div>
                {movSku && BATCH_TAGGABLE_TYPES.has(movType) && (
                  <div className="space-y-1.5">
                    <Label htmlFor="movBatchPick">
                      Партида
                      {movType === "wholesale_out" && <span className="text-destructive"> *</span>}
                      {movType !== "wholesale_out" && <span className="text-muted-foreground text-xs"> (незадължително)</span>}
                    </Label>
                    <Select value={movBatchId || "__none__"} onValueChange={(v) => setMovBatchId(v === "__none__" ? "" : v)}>
                      <SelectTrigger id="movBatchPick">
                        <SelectValue placeholder={movBatchesLoading ? "Зареждане..." : "Избери партида"} />
                      </SelectTrigger>
                      <SelectContent>
                        {movType !== "wholesale_out" && (
                          <SelectItem value="__none__">Без партида</SelectItem>
                        )}
                        {movAvailableBatches.length === 0 && !movBatchesLoading && (
                          <SelectItem value="__empty__" disabled>Няма активни партиди за този SKU</SelectItem>
                        )}
                        {movAvailableBatches.map((b) => (
                          <SelectItem key={b.id} value={b.batch_number}>
                            {b.batch_number} — {b.quantity_available} бр., изтича {new Date(b.expiry_date).toLocaleDateString("bg-BG")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {movType === "wholesale_out" && (
                      <p className="text-xs text-muted-foreground">EU 931/2011 — изисква партида на търговските пратки</p>
                    )}
                    {movType !== "wholesale_out" && (
                      <p className="text-xs text-muted-foreground">Свържи движението с партида, ако знаеш от коя пратка идва — поддържа склад и партиди в синхрон.</p>
                    )}
                  </div>
                )}
                {movType === "return_in" && (
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor="movOrderId">ID на поръчка (незадължително)</Label>
                      <Input id="movOrderId" value={movOrderId} onChange={(e) => setMovOrderId(e.target.value)} placeholder="напр. 5c2d7ba0 или пълен UUID" />
                      <p className="text-xs text-muted-foreground">8-знаков префикс (както е показан в админ панела) или пълен UUID</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="movBatchId">Номер на партида (незадължително)</Label>
                      <Input id="movBatchId" value={movBatchId} onChange={(e) => setMovBatchId(e.target.value)} maxLength={100} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="movExpiry">Срок на годност</Label>
                      <Input id="movExpiry" type="date" value={movExpiryDate} onChange={(e) => setMovExpiryDate(e.target.value)} />
                      <p className="text-xs text-muted-foreground">
                        Ако партидата вече съществува в /admin/batches, не е нужно. Ако е нова — въведете срок и тя ще бъде регистрирана автоматично.
                      </p>
                    </div>
                  </>
                )}
                {movError && <p className="text-sm text-destructive">{movError}</p>}
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={() => setMovDialogOpen(false)}>Отказ</Button>
                  <Button type="submit" disabled={movLoading}>{movLoading ? "Записване..." : "Запиши"}</Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2">
                <Plus className="h-4 w-4" />
                Добави партида
              </Button>
            </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Добави нова партида</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleAddBatch} className="space-y-4 mt-2">
              <div className="space-y-1.5">
                <Label>Продукт</Label>
                <Select value={sku} onValueChange={setSku} required>
                  <SelectTrigger>
                    <SelectValue placeholder="Избери продукт" />
                  </SelectTrigger>
                  <SelectContent>
                    {PRODUCTS.map((p) => (
                      <SelectItem key={p.sku} value={p.sku}>
                        {p.name} ({p.sku})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="qty">Брой кутии</Label>
                <Input
                  id="qty"
                  type="number"
                  min={1}
                  max={100000}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  required
                  placeholder="напр. 48"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="batch">Номер на партида</Label>
                <Input
                  id="batch"
                  value={batchId}
                  onChange={(e) => setBatchId(e.target.value)}
                  required
                  placeholder="напр. BATCH-002"
                  maxLength={100}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="expiry">Срок на годност</Label>
                <Input
                  id="expiry"
                  type="date"
                  required
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="notes">Бележки</Label>
                <Input
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Незадължително"
                  maxLength={500}
                />
              </div>
              {actionError && <p className="text-sm text-destructive">{actionError}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Отказ
                </Button>
                <Button type="submit" disabled={actionLoading}>
                  {actionLoading ? "Запазване..." : "Добави"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* Current stock cards */}
      {current.length === 0 ? (
        <Card className="mb-8">
          <CardContent className="p-6 text-center text-muted-foreground text-sm">
            Няма данни за наличност. Добавете първата партида.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3 mb-8">
          {current.map((item) => (
            <Card key={item.sku}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{item.sku}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm font-medium text-foreground mb-3">{item.productName}</p>
                <StockBadge quantity={item.quantity} />
                <p className="mt-3 text-xs text-muted-foreground">
                  Обновено {new Date(item.updatedAt).toLocaleString("bg-BG", {
                    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                  })}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Movement log */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">Последни движения</CardTitle>
            {(() => {
              // SKUs that actually appear in the log — drives the filter
              // options. We don't fall back to PRODUCTS to avoid surfacing
              // inactive/unused SKUs in the dropdown.
              const skusInLog = Array.from(new Set(log.map((e) => e.sku))).sort()
              if (skusInLog.length === 0) return null
              return (
                <select
                  value={logSkuFilter}
                  onChange={(e) => setLogSkuFilter(e.target.value)}
                  className="h-8 rounded-md border border-border bg-background px-3 text-sm"
                  aria-label="Филтър по SKU"
                >
                  <option value="all">Всички SKU</option>
                  {skusInLog.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              )
            })()}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {(() => {
            const filteredLog = logSkuFilter === "all"
              ? log
              : log.filter((entry) => entry.sku === logSkuFilter)
            if (log.length === 0) {
              return <p className="p-6 text-sm text-muted-foreground">Няма движения.</p>
            }
            if (filteredLog.length === 0) {
              return <p className="p-6 text-sm text-muted-foreground">Няма движения за избрания SKU.</p>
            }
            return (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Дата</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Тип</TableHead>
                  <TableHead className="text-right">Количество</TableHead>
                  <TableHead className="text-right">Преди</TableHead>
                  <TableHead className="text-right">След</TableHead>
                  <TableHead>Партида / Поръчка</TableHead>
                  <TableHead>Реф.</TableHead>
                  <TableHead>Срок</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLog.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(entry.created_at).toLocaleString("bg-BG", {
                        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                      })}
                    </TableCell>
                    <TableCell className="text-xs font-mono">{entry.sku}</TableCell>
                    <TableCell>
                      <Badge variant={TYPE_BADGE_VARIANT[entry.type] ?? "outline"} className="text-[10px]">
                        {TYPE_LABELS[entry.type] ?? entry.type}
                      </Badge>
                    </TableCell>
                    {(() => {
                      // Customer-return damaged is audit-only on inventory_current
                      // (the unit was already removed from sellable via order_out
                      // at ship time; this row records disposition without
                      // double-decrementing). Show as a 0-delta with a clear label.
                      const isCustomerReturnDamaged =
                        entry.type === "damaged"
                        && entry.reference_type === "return"
                        && entry.order_id != null
                      if (isCustomerReturnDamaged) {
                        return (
                          <TableCell className="text-right text-sm font-medium text-muted-foreground">
                            <span title="Audit-only — стоката е била извън склада, не променя продаваемата наличност">
                              0
                              <span className="ml-1 text-[9px] uppercase tracking-wide">audit</span>
                            </span>
                          </TableCell>
                        )
                      }
                      return (
                        <TableCell className={`text-right text-sm font-medium ${
                          OUTBOUND_TYPES.has(entry.type) ? "text-destructive" : "text-foreground"
                        }`}>
                          {OUTBOUND_TYPES.has(entry.type) ? "−" : "+"}{entry.quantity}
                        </TableCell>
                      )
                    })()}
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {entry.before_quantity ?? "—"}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {entry.after_quantity ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {entry.batch_id ?? (entry.order_id
                        ? <a href={`/admin/orders/${entry.order_id}`} className="text-blue-600 hover:underline font-mono">#{entry.order_id.slice(0, 8)}</a>
                        : "—"
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {entry.reference_id
                        ? <span className="font-mono">{entry.reference_id.length > 20 ? entry.reference_id.slice(0, 20) + "…" : entry.reference_id}</span>
                        : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {entry.expiry_date
                        ? formatBgDate(entry.expiry_date)
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            )
          })()}
        </CardContent>
      </Card>
    </div>
  )
}
