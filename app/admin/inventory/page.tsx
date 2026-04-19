"use client"

import { useEffect, useState, useCallback } from "react"
import { Plus, ArrowDownUp } from "lucide-react"
import {
  getInventoryStatus,
  addInventoryBatch,
  recordStockMovement,
  type InventoryStatus,
  type InventoryLogEntry,
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
  if (quantity === 0) return <Badge variant="destructive">Изчерпан</Badge>
  if (quantity <= LOW_STOCK_THRESHOLD) return <Badge variant="outline" className="border-amber-400 text-amber-700">Малко — {quantity}</Badge>
  return <Badge variant="secondary">{quantity} бр.</Badge>
}

export default function AdminInventoryPage() {
  const [current, setCurrent] = useState<InventoryStatus[]>([])
  const [log, setLog] = useState<InventoryLogEntry[]>([])
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
        batchId: movType === "return_in" && movBatchId ? movBatchId : undefined,
        expiryDate: movType === "return_in" && movExpiryDate ? movExpiryDate : undefined,
        orderId: movType === "return_in" && movOrderId ? movOrderId : undefined,
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
                    <Label htmlFor="movRef">{selectedMovType.refLabel}</Label>
                    <Input id="movRef" value={movRefId} onChange={(e) => setMovRefId(e.target.value)} required placeholder="напр. INV-2026-001" maxLength={200} />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="movNotes">Бележки {selectedMovType?.notesRequired && <span className="text-destructive">*</span>}</Label>
                  <Input id="movNotes" value={movNotes} onChange={(e) => setMovNotes(e.target.value)} placeholder={selectedMovType?.notesRequired ? "Задължително" : "Незадължително"} maxLength={500} required={selectedMovType?.notesRequired} />
                </div>
                {movType === "return_in" && (
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor="movOrderId">ID на поръчка (незадължително)</Label>
                      <Input id="movOrderId" value={movOrderId} onChange={(e) => setMovOrderId(e.target.value)} placeholder="UUID на поръчката" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="movBatchId">Номер на партида (незадължително)</Label>
                      <Input id="movBatchId" value={movBatchId} onChange={(e) => setMovBatchId(e.target.value)} maxLength={100} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="movExpiry">Срок на годност (незадължително)</Label>
                      <Input id="movExpiry" type="date" value={movExpiryDate} onChange={(e) => setMovExpiryDate(e.target.value)} />
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
          <CardTitle className="text-base">Последни движения</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {log.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">Няма движения.</p>
          ) : (
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
                {log.map((entry) => (
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
                    <TableCell className={`text-right text-sm font-medium ${
                      OUTBOUND_TYPES.has(entry.type) ? "text-destructive" : "text-foreground"
                    }`}>
                      {OUTBOUND_TYPES.has(entry.type) ? "−" : "+"}{entry.quantity}
                    </TableCell>
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
                        ? new Date(entry.expiry_date).toLocaleDateString("bg-BG", { day: "2-digit", month: "2-digit", year: "numeric" })
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
