"use client"

import { useEffect, useState, useCallback } from "react"
import {
  getPromoCodes,
  createPromoCode,
  deactivatePromoCode,
  type PromoCodeRecord,
} from "@/app/actions/admin"
import { formatPrice } from "@/lib/products"
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

function getPromoStatus(promo: PromoCodeRecord): { label: string; variant: "default" | "secondary" | "destructive" | "outline" } {
  if (!promo.is_active) return { label: "Деактивиран", variant: "secondary" }
  const now = new Date()
  if (new Date(promo.starts_at) > now) return { label: "Предстоящ", variant: "outline" }
  if (promo.ends_at && new Date(promo.ends_at) <= now) return { label: "Изтекъл", variant: "secondary" }
  if (promo.max_uses !== null && promo.current_uses >= promo.max_uses) return { label: "Изчерпан", variant: "destructive" }
  return { label: "Активен", variant: "default" }
}

export default function AdminPromoCodesPage() {
  const [codes, setCodes] = useState<PromoCodeRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState("")
  const [dialogOpen, setDialogOpen] = useState(false)

  const fetchCodes = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getPromoCodes()
      setCodes(data)
    } catch {
      setError("Грешка при зареждане на промо кодовете")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchCodes()
  }, [fetchCodes])

  async function handleDeactivate(id: string) {
    setActionLoading(true)
    setError("")
    try {
      await deactivatePromoCode(id)
      await fetchCodes()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Грешка")
    } finally {
      setActionLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Промо кодове</h1>
        <CreatePromoDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onCreated={() => {
            setDialogOpen(false)
            fetchCodes()
          }}
        />
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="rounded-lg border bg-white">
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Зареждане...</div>
        ) : codes.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Няма промо кодове</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Код</TableHead>
                <TableHead>Тип</TableHead>
                <TableHead>Стойност</TableHead>
                <TableHead>Мин. поръчка</TableHead>
                <TableHead>Използвания</TableHead>
                <TableHead>Начало</TableHead>
                <TableHead>Край</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {codes.map((code) => {
                const status = getPromoStatus(code)
                return (
                  <TableRow key={code.id}>
                    <TableCell className="font-mono font-medium">{code.code}</TableCell>
                    <TableCell className="text-sm">
                      {code.discount_type === "percentage" ? "Процент" : "Фиксирана"}
                    </TableCell>
                    <TableCell className="text-sm font-medium">
                      {code.discount_type === "percentage"
                        ? `${code.discount_value}%`
                        : formatPrice(code.discount_value)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {code.min_order_amount > 0 ? formatPrice(code.min_order_amount) : "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {code.current_uses}/{code.max_uses ?? "∞"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(code.starts_at).toLocaleDateString("bg-BG", {
                        day: "2-digit", month: "2-digit", year: "numeric",
                      })}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {code.ends_at
                        ? new Date(code.ends_at).toLocaleDateString("bg-BG", {
                            day: "2-digit", month: "2-digit", year: "numeric",
                          })
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </TableCell>
                    <TableCell>
                      {code.is_active && (
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={actionLoading}
                          onClick={() => handleDeactivate(code.id)}
                        >
                          Деактивирай
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

function CreatePromoDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  const [code, setCode] = useState("")
  const [discountType, setDiscountType] = useState<"percentage" | "fixed">("percentage")
  const [discountValue, setDiscountValue] = useState("")
  const [minOrder, setMinOrder] = useState("")
  const [maxUses, setMaxUses] = useState("")
  const [endsAt, setEndsAt] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setSubmitting(true)

    try {
      const valueNum = discountType === "percentage"
        ? parseInt(discountValue)
        : Math.round(parseFloat(discountValue.replace(",", ".")) * 100)

      if (isNaN(valueNum) || valueNum <= 0) {
        throw new Error("Въведете валидна стойност")
      }

      const minOrderCents = minOrder
        ? Math.round(parseFloat(minOrder.replace(",", ".")) * 100)
        : 0

      await createPromoCode({
        code,
        discountType,
        discountValue: valueNum,
        minOrderAmount: isNaN(minOrderCents) ? 0 : minOrderCents,
        maxUses: maxUses ? parseInt(maxUses) : null,
        endsAt: endsAt ? new Date(endsAt).toISOString() : null,
      })

      setCode("")
      setDiscountValue("")
      setMinOrder("")
      setMaxUses("")
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
        <Button>Създай промо код</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Нов промо код</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="promoCode">Код *</Label>
            <Input
              id="promoCode"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="напр. ЛЯТО2026"
              className="uppercase"
              required
            />
          </div>

          <div className="space-y-2">
            <Label>Тип отстъпка</Label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={discountType}
              onChange={(e) => setDiscountType(e.target.value as "percentage" | "fixed")}
            >
              <option value="percentage">Процент (%)</option>
              <option value="fixed">Фиксирана сума (€)</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="discountValue">
              {discountType === "percentage" ? "Процент отстъпка (%) *" : "Сума на отстъпката (€) *"}
            </Label>
            <Input
              id="discountValue"
              type="text"
              inputMode="decimal"
              placeholder={discountType === "percentage" ? "напр. 15" : "напр. 5,00"}
              value={discountValue}
              onChange={(e) => setDiscountValue(e.target.value)}
              required
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="minOrder">Мин. поръчка (€)</Label>
              <Input
                id="minOrder"
                type="text"
                inputMode="decimal"
                placeholder="Без минимум"
                value={minOrder}
                onChange={(e) => setMinOrder(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="maxUses">Макс. използвания</Label>
              <Input
                id="maxUses"
                type="number"
                placeholder="Неограничено"
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="promoEndsAt">Край на валидност</Label>
            <Input
              id="promoEndsAt"
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Оставете празно за код без крайна дата
            </p>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? "Създаване..." : "Създай промо код"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
