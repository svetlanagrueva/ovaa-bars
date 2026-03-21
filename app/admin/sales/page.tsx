"use client"

import { useEffect, useState, useCallback } from "react"
import {
  getSales,
  createSale,
  endSale,
  type SaleRecord,
} from "@/app/actions/admin"
import { PRODUCTS, formatPrice } from "@/lib/products"
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

const products = PRODUCTS.map((p) => ({ id: p.id, name: p.name, priceInCents: p.priceInCents }))

function getSaleStatus(sale: SaleRecord): { label: string; variant: "default" | "secondary" | "destructive" | "outline" } {
  if (!sale.is_active) return { label: "Приключила", variant: "secondary" }
  const now = new Date()
  if (new Date(sale.starts_at) > now) return { label: "Предстояща", variant: "outline" }
  if (sale.ends_at && new Date(sale.ends_at) <= now) return { label: "Изтекла", variant: "secondary" }
  return { label: "Активна", variant: "default" }
}

function getProductName(productId: string): string {
  return products.find((p) => p.id === productId)?.name || productId
}

export default function AdminSalesPage() {
  const [sales, setSales] = useState<SaleRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState("")
  const [dialogOpen, setDialogOpen] = useState(false)

  const fetchSales = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getSales()
      setSales(data)
    } catch {
      setError("Грешка при зареждане на промоциите")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSales()
  }, [fetchSales])

  async function handleEndSale(saleId: string) {
    setActionLoading(true)
    setError("")
    try {
      await endSale(saleId)
      await fetchSales()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Грешка")
    } finally {
      setActionLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Промоции</h1>
        <div className="flex gap-2">
          <CreateSaleDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            onCreated={() => {
              setDialogOpen(false)
              fetchSales()
            }}
          />
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="rounded-lg border bg-white">
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Зареждане...</div>
        ) : sales.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Няма промоции</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Продукт</TableHead>
                <TableHead>Базова цена</TableHead>
                <TableHead>Промо цена</TableHead>
                <TableHead>Отстъпка</TableHead>
                <TableHead>Начало</TableHead>
                <TableHead>Край</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sales.map((sale) => {
                const status = getSaleStatus(sale)
                const discount = Math.round(
                  ((sale.original_price_in_cents - sale.sale_price_in_cents) /
                    sale.original_price_in_cents) *
                    100
                )
                return (
                  <TableRow key={sale.id}>
                    <TableCell className="font-medium">{getProductName(sale.product_id)}</TableCell>
                    <TableCell className="text-sm">{formatPrice(sale.original_price_in_cents)}</TableCell>
                    <TableCell className="text-sm font-medium text-destructive">
                      {formatPrice(sale.sale_price_in_cents)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="destructive" className="text-xs">-{discount}%</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(sale.starts_at).toLocaleDateString("bg-BG", {
                        day: "2-digit", month: "2-digit", year: "numeric",
                        hour: "2-digit", minute: "2-digit",
                      })}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {sale.ends_at
                        ? new Date(sale.ends_at).toLocaleDateString("bg-BG", {
                            day: "2-digit", month: "2-digit", year: "numeric",
                            hour: "2-digit", minute: "2-digit",
                          })
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </TableCell>
                    <TableCell>
                      {sale.is_active && (
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={actionLoading}
                          onClick={() => handleEndSale(sale.id)}
                        >
                          Спри
                        </Button>
                      )}
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

function CreateSaleDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  const [productId, setProductId] = useState(products[0]?.id || "")
  const [salePrice, setSalePrice] = useState("")
  const [endsAt, setEndsAt] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  const selectedProduct = products.find((p) => p.id === productId)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setSubmitting(true)

    try {
      const salePriceInCents = Math.round(parseFloat(salePrice.replace(",", ".")) * 100)
      if (isNaN(salePriceInCents) || salePriceInCents <= 0) {
        throw new Error("Въведете валидна цена")
      }

      await createSale({
        productId,
        salePriceInCents,
        endsAt: endsAt ? new Date(endsAt).toISOString() : null,
      })

      setSalePrice("")
      setEndsAt("")
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Грешка при създаване")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>Създай промоция</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Нова промоция</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Продукт</Label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({formatPrice(p.priceInCents)})
                </option>
              ))}
            </select>
          </div>

          {selectedProduct && (
            <div className="rounded-md bg-secondary p-3 text-sm">
              <div className="text-muted-foreground">
                Базова цена: <span className="font-medium text-foreground">{formatPrice(selectedProduct.priceInCents)}</span>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="salePrice">Промоционална цена (€) *</Label>
            <Input
              id="salePrice"
              type="text"
              inputMode="decimal"
              placeholder="напр. 19,99"
              value={salePrice}
              onChange={(e) => setSalePrice(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="endsAt">Край на промоцията</Label>
            <Input
              id="endsAt"
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Оставете празно за промоция без крайна дата
            </p>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? "Създаване..." : "Създай промоция"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
