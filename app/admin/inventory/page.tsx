"use client"

import { useEffect, useState, useCallback } from "react"
import { Plus } from "lucide-react"
import {
  getInventoryStatus,
  addInventoryBatch,
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
  adjustment: "Корекция",
}

const TYPE_BADGE_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  batch_in: "default",
  order_out: "secondary",
  cancellation: "outline",
  adjustment: "outline",
}

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

  // Form state
  const [sku, setSku] = useState("")
  const [quantity, setQuantity] = useState("")
  const [batchId, setBatchId] = useState("")
  const [expiryDate, setExpiryDate] = useState("")
  const [notes, setNotes] = useState("")

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

  const skuToOrderId = Object.fromEntries(log.map((e) => [e.order_id, e.order_id]))
  void skuToOrderId

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
                      entry.type === "order_out" || entry.type === "adjustment" ? "text-destructive" : "text-foreground"
                    }`}>
                      {entry.type === "order_out" || entry.type === "adjustment" ? "−" : "+"}{entry.quantity}
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
