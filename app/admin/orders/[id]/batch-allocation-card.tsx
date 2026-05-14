"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  getBatchAllocationView,
  saveBatchAllocation,
  clearBatchAllocation,
  type BatchAllocationView,
  type BatchAllocationViewBatch,
  type SaveBatchAllocationRow,
} from "@/app/actions/admin"
import { buildExpectedFefoPlan, isFefoCompliant } from "@/lib/batches/fefo"
import { formatBgDate } from "@/lib/utils"

interface RowState {
  productBatchId: string
  quantity: string
  nonFefoReason: string
  expiredOverrideReason: string
  allowExpiredOverride: boolean
}

interface LineState {
  orderItemId: number
  sku: string
  productName: string
  orderedQuantity: number
  rows: RowState[]
}

function seedLineFromFefo(
  line: BatchAllocationView["lines"][number],
  batches: BatchAllocationViewBatch[],
): RowState[] {
  const skuBatches = batches.filter((b) => b.sku === line.sku && !b.isExpired)
  const plan = buildExpectedFefoPlan({
    orderedQty: line.orderedQuantity,
    batches: skuBatches.map((b) => ({
      id: b.productBatchId,
      expiryDate: b.expiryDate,
      createdAt: "",
      availableQty: b.quantityAvailable,
    })),
  })
  const rows: RowState[] = []
  for (const [batchId, qty] of plan.allocations) {
    rows.push({
      productBatchId: batchId,
      quantity: String(qty),
      nonFefoReason: "",
      expiredOverrideReason: "",
      allowExpiredOverride: false,
    })
  }
  if (rows.length === 0) {
    rows.push({ productBatchId: "", quantity: "", nonFefoReason: "", expiredOverrideReason: "", allowExpiredOverride: false })
  }
  return rows
}

function seedLineFromSaved(line: BatchAllocationView["lines"][number]): RowState[] {
  return line.saved.map((s) => ({
    productBatchId: s.productBatchId,
    quantity: String(s.quantity),
    nonFefoReason: s.nonFefoReason ?? "",
    expiredOverrideReason: s.expiredOverrideReason ?? "",
    allowExpiredOverride: !!s.expiredOverrideReason,
  }))
}

export function BatchAllocationCard({ orderId, onSaved }: { orderId: string; onSaved?: () => void }) {
  const [view, setView] = useState<BatchAllocationView | null>(null)
  const [lines, setLines] = useState<LineState[]>([])
  const [showExpired, setShowExpired] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  // Lock pattern: form is read-only after a saved state lands. "Редактирай"
  // unlocks it; "Запази" locks it again. Initial-load state is decided in load()
  // based on whether the order has any saved allocation rows yet.
  const [editMode, setEditMode] = useState(false)

  useEffect(() => {
    void (async () => {
      const v = await load(false)
      // First-time visitors with no saved rows start in edit mode so they
      // can save the FEFO seed without an extra click. Otherwise the form
      // is locked until the admin clicks "Редактирай".
      setEditMode(!v?.lines.some((l) => l.saved.length > 0))
    })()
  }, [orderId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function load(preferFefoSeed: boolean) {
    try {
      setLoading(true)
      setError("")
      const v = await getBatchAllocationView(orderId)
      setView(v)
      const seeded: LineState[] = v.lines.map((l) => ({
        orderItemId: l.orderItemId,
        sku: l.sku,
        productName: l.productName,
        orderedQuantity: l.orderedQuantity,
        rows: !preferFefoSeed && l.saved.length > 0
          ? seedLineFromSaved(l)
          : seedLineFromFefo(l, v.batches),
      }))
      setLines(seeded)
      return v
    } catch (err) {
      setError(err instanceof Error ? err.message : "Грешка при зареждане")
      return null
    } finally {
      setLoading(false)
    }
  }

  function batchesForSku(sku: string): BatchAllocationViewBatch[] {
    if (!view) return []
    return view.batches.filter((b) => b.sku === sku && (showExpired || !b.isExpired))
  }

  function findBatch(productBatchId: string): BatchAllocationViewBatch | undefined {
    return view?.batches.find((b) => b.productBatchId === productBatchId)
  }

  function updateRow(orderItemId: number, idx: number, patch: Partial<RowState>) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.orderItemId !== orderItemId) return l
        const rows = [...l.rows]
        rows[idx] = { ...rows[idx], ...patch }
        return { ...l, rows }
      }),
    )
    setSuccess("")
  }

  function addRow(orderItemId: number) {
    setLines((prev) =>
      prev.map((l) =>
        l.orderItemId === orderItemId
          ? {
              ...l,
              rows: [...l.rows, { productBatchId: "", quantity: "", nonFefoReason: "", expiredOverrideReason: "", allowExpiredOverride: false }],
            }
          : l,
      ),
    )
  }

  function removeRow(orderItemId: number, idx: number) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.orderItemId !== orderItemId) return l
        const rows = l.rows.filter((_, i) => i !== idx)
        return { ...l, rows: rows.length === 0 ? [{ productBatchId: "", quantity: "", nonFefoReason: "", expiredOverrideReason: "", allowExpiredOverride: false }] : rows }
      }),
    )
  }

  function lineSum(line: LineState): number {
    return line.rows.reduce((s, r) => s + (parseInt(r.quantity, 10) || 0), 0)
  }

  function isLineFefoCompliant(line: LineState): boolean {
    if (!view) return true
    // Quantity already covered by expired-override rows. The expired-batch
    // override is its own warning; once the admin has acknowledged it for
    // a quantity, that quantity isn't subject to FEFO ordering — pulling
    // expired stock IS the oldest-out choice. So we only run FEFO over the
    // remaining quantity that needs to come from active+non-expired stock.
    const expiredOverrideQty = line.rows.reduce((s, r) => {
      if (!rowExpired(r)) return s
      return s + (parseInt(r.quantity, 10) || 0)
    }, 0)
    const remaining = line.orderedQuantity - expiredOverrideQty
    if (remaining <= 0) return true

    const skuActiveNonExpired = view.batches.filter((b) => b.sku === line.sku && !b.isExpired)
    const expected = buildExpectedFefoPlan({
      orderedQty: remaining,
      batches: skuActiveNonExpired.map((b) => ({
        id: b.productBatchId,
        expiryDate: b.expiryDate,
        createdAt: "",
        availableQty: b.quantityAvailable,
      })),
    }).allocations
    const validIds = new Set(skuActiveNonExpired.map((b) => b.productBatchId))
    const saved = new Map<string, number>()
    for (const r of line.rows) {
      if (!r.productBatchId) continue
      if (!validIds.has(r.productBatchId)) continue
      const q = parseInt(r.quantity, 10) || 0
      if (q > 0) saved.set(r.productBatchId, (saved.get(r.productBatchId) ?? 0) + q)
    }
    return isFefoCompliant(saved, expected)
  }

  function rowExpired(row: RowState): boolean {
    const b = findBatch(row.productBatchId)
    return !!b?.isExpired
  }

  async function handleAutoFefo() {
    setSuccess("")
    await load(true)
    setEditMode(true)
  }

  async function handleSave() {
    if (!view) return
    setError("")
    setSuccess("")

    // Local validation: per-line sum equality, every row has a batch + qty
    for (const l of lines) {
      const sum = lineSum(l)
      if (sum !== l.orderedQuantity) {
        setError(`SKU ${l.sku}: разпределени ${sum}, поръчани ${l.orderedQuantity}`)
        return
      }
      for (const r of l.rows) {
        if (!r.productBatchId) {
          setError(`SKU ${l.sku}: има ред без избрана партида`)
          return
        }
        const q = parseInt(r.quantity, 10) || 0
        if (q < 1) {
          setError(`SKU ${l.sku}: количеството трябва да е поне 1`)
          return
        }
      }
    }

    // Build the save payload. If a line is non-FEFO, propagate its
    // (single) reason onto every row of that line so the server's
    // "at least one row has a reason" check passes regardless of
    // which row the user wrote it on.
    const payload: SaveBatchAllocationRow[] = []
    for (const l of lines) {
      const lineCompliant = isLineFefoCompliant(l)
      const aggregateNonFefoReason = l.rows.map((r) => r.nonFefoReason.trim()).find((s) => s.length >= 20) ?? ""
      if (!lineCompliant && aggregateNonFefoReason.length === 0) {
        setError(`SKU ${l.sku}: избрана е партида с по-късен срок при налична по-ранна. Въведете причина (поне 20 символа).`)
        return
      }
      for (const r of l.rows) {
        const expired = rowExpired(r)
        if (expired && (!r.allowExpiredOverride || r.expiredOverrideReason.trim().length < 20)) {
          const b = findBatch(r.productBatchId)
          setError(`Партида ${b?.batchNumber ?? r.productBatchId} е с изтекъл срок. Потвърдете отказа от срока и въведете причина (поне 20 символа).`)
          return
        }
        payload.push({
          orderItemId: l.orderItemId,
          productBatchId: r.productBatchId,
          quantity: parseInt(r.quantity, 10),
          nonFefoReason: !lineCompliant ? aggregateNonFefoReason : undefined,
          allowExpiredOverride: expired ? r.allowExpiredOverride : undefined,
          expiredOverrideReason: expired ? r.expiredOverrideReason.trim() : undefined,
        })
      }
    }

    setSaving(true)
    try {
      const result = await saveBatchAllocation(orderId, payload)
      onSaved?.()
      await load(false)
      setEditMode(false)
      setSuccess(`Запазени ${result.saved} реда. Разпределението е записано.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Грешка при запазване")
    } finally {
      setSaving(false)
    }
  }

  async function handleClear() {
    if (!confirm("Изтриване на разпределението на партидите за тази поръчка?")) return
    setError("")
    setSuccess("")
    setSaving(true)
    try {
      const result = await clearBatchAllocation(orderId)
      await load(true)
      setEditMode(true)
      if (result.cleared > 0) setSuccess(`Изтрити ${result.cleared} реда`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Грешка при изчистване")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Card className="mt-6">
        <CardHeader><CardTitle className="text-base">Партиди</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">Зареждане…</CardContent>
      </Card>
    )
  }

  const hasAnySaved = view?.lines.some((l) => l.saved.length > 0) ?? false

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="text-base">Партиди</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void handleAutoFefo()} disabled={saving || !editMode}>
            {hasAnySaved ? "Преизчисли по FEFO" : "Автоматично разпредели по FEFO"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void handleClear()} disabled={saving || !editMode}>
            Изтрий разпределението
          </Button>
          <label className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={showExpired} onChange={(e) => setShowExpired(e.target.checked)} />
            Покажи изтекли партиди
          </label>
        </div>

        {error && <p className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-900">{error}</p>}
        {success && <p className="rounded-md border border-green-300 bg-green-50 p-2 text-xs text-green-900">{success}</p>}

        {lines.map((line) => {
          const sum = lineSum(line)
          const compliant = isLineFefoCompliant(line)
          const skuOptions = batchesForSku(line.sku)
          return (
            <div key={line.orderItemId} className="rounded-md border border-border bg-muted/20 p-3 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{line.productName}</span>
                <span className={sum === line.orderedQuantity ? "text-green-700" : "text-amber-700"}>
                  {sum}/{line.orderedQuantity} разпределени
                </span>
              </div>

              {line.rows.map((row, idx) => {
                const expired = rowExpired(row)
                const batch = findBatch(row.productBatchId)
                return (
                  <div key={idx} className="rounded-md border border-border/60 bg-background p-2 space-y-2 text-xs">
                    <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-center">
                      <select
                        value={row.productBatchId}
                        onChange={(e) => updateRow(line.orderItemId, idx, { productBatchId: e.target.value, allowExpiredOverride: false, expiredOverrideReason: "" })}
                        disabled={!editMode}
                        className="h-8 rounded-md border border-border bg-background px-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <option value="">— избери партида —</option>
                        {skuOptions.map((b) => (
                          <option key={b.productBatchId} value={b.productBatchId}>
                            {b.batchNumber} · изт. {formatBgDate(b.expiryDate)} · налични {b.quantityAvailable}
                            {b.isExpired ? " · ИЗТЕКЛА" : ""}
                          </option>
                        ))}
                      </select>
                      <Input
                        type="number"
                        min={1}
                        max={batch ? batch.quantityAvailable : undefined}
                        value={row.quantity}
                        onChange={(e) => updateRow(line.orderItemId, idx, { quantity: e.target.value })}
                        disabled={!editMode}
                        className="h-8 w-20 text-xs"
                        placeholder="бр."
                      />
                      <button
                        type="button"
                        onClick={() => removeRow(line.orderItemId, idx)}
                        disabled={!editMode}
                        className="text-muted-foreground hover:text-red-700 px-1 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-muted-foreground"
                        aria-label="Премахни ред"
                      >
                        ✕
                      </button>
                    </div>
                    {expired && (
                      <div className="space-y-1.5 rounded-md border border-red-300 bg-red-50 p-2">
                        <label className="inline-flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={row.allowExpiredOverride}
                            onChange={(e) => updateRow(line.orderItemId, idx, { allowExpiredOverride: e.target.checked })}
                            disabled={!editMode}
                          />
                          <span className="text-red-900">Разбирам, че партидата е с изтекъл срок</span>
                        </label>
                        {row.allowExpiredOverride && (
                          <Textarea
                            value={row.expiredOverrideReason}
                            onChange={(e) => updateRow(line.orderItemId, idx, { expiredOverrideReason: e.target.value })}
                            placeholder="Причина за използване на изтекла партида (поне 20 символа)…"
                            rows={2}
                            disabled={!editMode}
                            className="text-xs"
                          />
                        )}
                      </div>
                    )}
                  </div>
                )
              })}

              <Button
                variant="ghost"
                size="sm"
                onClick={() => addRow(line.orderItemId)}
                disabled={!editMode}
                className="text-xs"
              >
                + Добави партида
              </Button>

              {!compliant && (
                <div className="space-y-1.5 rounded-md border border-amber-300 bg-amber-50 p-2">
                  <p className="text-xs text-amber-900">
                    Избрана е партида с по-късен срок при налична по-ранна. Въведете причина:
                  </p>
                  <Textarea
                    value={line.rows[0]?.nonFefoReason ?? ""}
                    onChange={(e) => updateRow(line.orderItemId, 0, { nonFefoReason: e.target.value })}
                    placeholder="Причина за отклонение от FEFO (поне 20 символа)…"
                    rows={2}
                    disabled={!editMode}
                    className="text-xs"
                  />
                </div>
              )}
            </div>
          )
        })}

        <div className="flex gap-2 pt-2">
          <Button
            variant="outline"
            onClick={() => { setEditMode(true); setSuccess("") }}
            disabled={editMode || saving}
          >
            Редактирай
          </Button>
          <Button onClick={() => void handleSave()} disabled={!editMode || saving}>
            {saving ? "Записване…" : "Запази разпределението"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
