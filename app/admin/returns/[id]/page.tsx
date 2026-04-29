"use client"

import { useEffect, useState, use } from "react"
import Link from "next/link"
import {
  getWithdrawal,
  approveWithdrawal,
  rejectWithdrawal,
  markWithdrawalGoodsReceived,
  completeWithdrawalNoReturn,
  type Withdrawal,
  type WithdrawalEligibilityCondition,
  type WithdrawalResolutionType,
  type WithdrawalWithOrderContext,
} from "@/app/actions/admin"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

const STATUS_LABELS: Record<Withdrawal["status"], string> = {
  requested: "Подадена",
  approved: "Одобрена",
  goods_received: "Получени стоки",
  rejected: "Отказана",
  completed: "Завършена",
}

const STATUS_BADGE: Record<Withdrawal["status"], string> = {
  requested: "bg-amber-100 text-amber-800",
  approved: "bg-blue-100 text-blue-800",
  goods_received: "bg-violet-100 text-violet-800",
  rejected: "bg-red-100 text-red-800",
  completed: "bg-green-100 text-green-800",
}

export default function AdminWithdrawalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [w, setW] = useState<WithdrawalWithOrderContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  // Approve dialog
  const [approveOpen, setApproveOpen] = useState(false)
  const [returnRequired, setReturnRequired] = useState(true)

  // Reject dialog
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState("")

  // Goods received dialog
  const [goodsOpen, setGoodsOpen] = useState(false)
  const [condition, setCondition] = useState<WithdrawalEligibilityCondition>("sealed_sellable")
  const [goodsResolution, setGoodsResolution] = useState<WithdrawalResolutionType>("refund")
  const [returnTracking, setReturnTracking] = useState("")
  const [returnCourier, setReturnCourier] = useState("")

  // Завърши без връщане (Path B)
  const [noReturnOpen, setNoReturnOpen] = useState(false)
  const [pathBResolution, setPathBResolution] = useState<WithdrawalResolutionType>("refund")
  const [pathBNote, setPathBNote] = useState("")

  async function refresh() {
    setLoading(true)
    try {
      const result = await getWithdrawal(id)
      setW(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Грешка")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [id])

  if (loading) {
    return <div className="mx-auto max-w-3xl px-4 py-8 text-sm text-muted-foreground">Зареждане...</div>
  }
  if (!w) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <p className="text-sm text-red-700">{error || "Заявката не е намерена"}</p>
      </div>
    )
  }

  const eligibilityHint = (() => {
    if (w.eligibility_time_based === null) return "не може да се определи (липсва дата на доставка)"
    return w.eligibility_time_based ? "✓ В срока от 14 дни" : "✗ Извън срока от 14 дни"
  })()

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Заявка за връщане</p>
          <h1 className="mt-1 text-2xl font-bold font-mono">{w.withdrawal_ref}</h1>
          <Link href={`/admin/orders/${w.order_id}`} className="text-sm text-blue-600 hover:underline">
            ← Към поръчка #{w.order_id.slice(0, 8)}
          </Link>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs uppercase tracking-wide ${STATUS_BADGE[w.status]}`}>
          {STATUS_LABELS[w.status]}
        </span>
      </div>

      {error && <p className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">{error}</p>}

      <Card className="mb-4">
        <CardHeader><CardTitle className="text-base">Детайли</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div><span className="text-muted-foreground">Канал:</span> {w.requested_via}</div>
          <div><span className="text-muted-foreground">Имейл:</span> {w.customer_email}</div>
          {w.customer_request_text && (
            <div>
              <span className="text-muted-foreground">Текст на заявката:</span>
              <p className="mt-1 whitespace-pre-wrap rounded-md border border-border/60 bg-muted/20 p-3 text-xs">
                {w.customer_request_text}
              </p>
            </div>
          )}
          <div className="pt-2">
            <span className="text-muted-foreground">Допустимост:</span>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
              <li>Срок: {eligibilityHint}</li>
              <li>Продуктов клас: {w.eligibility_product_based || "—"}</li>
              <li>Състояние: {w.eligibility_condition || "—"}</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {w.status !== "requested" && (
        <Card className="mb-4">
          <CardHeader><CardTitle className="text-base">Решение и обработка</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {w.approved_at && (
              <div>
                <span className="text-muted-foreground">Одобрена на:</span>{" "}
                {new Date(w.approved_at).toLocaleString("bg-BG")} от {w.approved_by}
                <span className="ml-2 text-xs text-muted-foreground">
                  ({w.return_required ? "изисква връщане" : "без връщане"})
                </span>
              </div>
            )}
            {w.goods_received_at && (
              <div>
                <span className="text-muted-foreground">Получени стоки:</span>{" "}
                {new Date(w.goods_received_at).toLocaleString("bg-BG")}
                {w.return_tracking_number && (
                  <span className="ml-2 font-mono text-xs">{w.return_tracking_number}</span>
                )}
                {w.return_courier && <span className="ml-2 text-xs">({w.return_courier})</span>}
              </div>
            )}
            {w.rejected_at && (
              <div>
                <div>
                  <span className="text-muted-foreground">Отказана на:</span>{" "}
                  {new Date(w.rejected_at).toLocaleString("bg-BG")} от {w.rejected_by}
                </div>
                {w.rejection_reason && (
                  <p className="mt-1 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-900">
                    {w.rejection_reason}
                  </p>
                )}
              </div>
            )}
            {w.completed_at && (
              <div>
                <span className="text-muted-foreground">Завършена на:</span>{" "}
                {new Date(w.completed_at).toLocaleString("bg-BG")}
                {w.resolution_type && (
                  <span className="ml-2 text-xs">({w.resolution_type})</span>
                )}
              </div>
            )}
            {w.completion_note && (
              <p className="mt-1 rounded-md border border-border/60 bg-muted/20 p-3 text-xs">
                <span className="font-medium">Бележка:</span> {w.completion_note}
              </p>
            )}
            {w.refund_id && (
              <div>
                <span className="text-muted-foreground">Свързано възстановяване:</span>{" "}
                <Link href={`/admin/orders/${w.order_id}#refunds`} className="font-mono text-xs text-blue-600 hover:underline">
                  {w.refund_id.slice(0, 8)}
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Action panel */}
      <Card>
        <CardHeader><CardTitle className="text-base">Действия</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {w.status === "requested" && (
            <div className="flex gap-2">
              <Button onClick={() => setApproveOpen(true)} disabled={busy}>Одобри</Button>
              <Button variant="outline" onClick={() => setRejectOpen(true)} disabled={busy}>Отхвърли</Button>
            </div>
          )}

          {w.status === "approved" && w.return_required && (
            <div className="flex gap-2">
              <Button onClick={() => setGoodsOpen(true)} disabled={busy}>Маркирай получени стоки</Button>
              <Button variant="outline" onClick={() => setRejectOpen(true)} disabled={busy}>Отхвърли</Button>
            </div>
          )}

          {w.status === "approved" && !w.return_required && (
            <div className="flex gap-2">
              <Button onClick={() => setNoReturnOpen(true)} disabled={busy}>Завърши без връщане</Button>
              <Button variant="outline" onClick={() => setRejectOpen(true)} disabled={busy}>Отхвърли</Button>
            </div>
          )}

          {w.status === "goods_received" && (
            <div className="space-y-2 text-sm">
              <p className="text-muted-foreground">
                Стоките са получени. За завършване запишете възстановяване от
                <Link href={`/admin/orders/${w.order_id}`} className="ml-1 text-blue-600 hover:underline">
                  страницата на поръчката
                </Link>
                {" "}и я свържете с тази заявка.
              </p>
            </div>
          )}

          {(w.status === "completed" || w.status === "rejected") && (
            <p className="text-sm text-muted-foreground">Заявката е приключена.</p>
          )}
        </CardContent>
      </Card>

      {/* ── Approve dialog ─────────────────────────────────────────────── */}
      {approveOpen && (
        <Modal onClose={() => setApproveOpen(false)} title="Одобряване на заявката">
          <div className="space-y-3 text-sm">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1"
                checked={returnRequired}
                onChange={(e) => setReturnRequired(e.target.checked)}
              />
              <span>
                <strong>Изисква се връщане на стоката</strong>
                <span className="block text-xs text-muted-foreground mt-0.5">
                  Махнете отметката за goodwill случаи, когато клиентът задържа продукта.
                </span>
              </span>
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setApproveOpen(false)} disabled={busy}>Отказ</Button>
              <Button
                disabled={busy}
                onClick={async () => {
                  setError(""); setBusy(true)
                  try {
                    await approveWithdrawal(id, { returnRequired })
                    setApproveOpen(false)
                    await refresh()
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Грешка")
                  } finally { setBusy(false) }
                }}
              >
                Одобри
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Reject dialog ──────────────────────────────────────────────── */}
      {rejectOpen && (
        <Modal onClose={() => setRejectOpen(false)} title="Отказване на заявката">
          <div className="space-y-3 text-sm">
            <Label htmlFor="reject-reason">Причина за отказ (изпраща се на клиента)</Label>
            <textarea
              id="reject-reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              maxLength={1000}
              rows={4}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setRejectOpen(false)} disabled={busy}>Затвори</Button>
              <Button
                disabled={busy || !rejectReason.trim()}
                onClick={async () => {
                  setError(""); setBusy(true)
                  try {
                    await rejectWithdrawal(id, rejectReason.trim())
                    setRejectOpen(false)
                    setRejectReason("")
                    await refresh()
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Грешка")
                  } finally { setBusy(false) }
                }}
              >
                Отхвърли
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Goods received dialog ──────────────────────────────────────── */}
      {goodsOpen && (
        <Modal onClose={() => setGoodsOpen(false)} title="Маркирай получени стоки">
          <div className="space-y-3 text-sm">
            <div>
              <Label className="mb-1 block">Състояние</Label>
              <select
                value={condition}
                onChange={(e) => setCondition(e.target.value as WithdrawalEligibilityCondition)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="sealed_sellable">Запечатан, годен за продажба</option>
                <option value="opened">Отворен</option>
                <option value="damaged">Повреден</option>
                <option value="expired">С изтекъл срок</option>
                <option value="other">Друго</option>
              </select>
            </div>
            <div>
              <Label className="mb-1 block">Тип резолюция</Label>
              <select
                value={goodsResolution}
                onChange={(e) => setGoodsResolution(e.target.value as WithdrawalResolutionType)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="refund">Възстановяване</option>
                <option value="replacement">Замяна</option>
                <option value="none">Без резолюция</option>
              </select>
            </div>
            {goodsResolution === "refund" && !w.order.paid_at && (
              <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                <strong>Внимание:</strong> поръчката още не е маркирана като платена
                {w.order.payment_method === "cod"
                  ? " (наложен платеж — плащането се записва след получено плащане от куриера)"
                  : ""}.
                Запис на възстановяване няма да е възможен, докато <strong>paid_at</strong> не бъде попълнен.
                Можете да продължите, но завършването на заявката ще изисква първо да маркирате плащането.
              </p>
            )}
            <div>
              <Label htmlFor="rt" className="mb-1 block">Номер на товарителница (по избор)</Label>
              <Input id="rt" value={returnTracking} onChange={(e) => setReturnTracking(e.target.value)} maxLength={200} />
            </div>
            <div>
              <Label htmlFor="rc" className="mb-1 block">Куриер (по избор)</Label>
              <Input id="rc" value={returnCourier} onChange={(e) => setReturnCourier(e.target.value)} maxLength={100} />
            </div>
            <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              Не записвайте складови движения тук — направете го отделно от <strong>Склад → Добави движение</strong>
              ({condition === "sealed_sellable" ? "return_in" : "damaged"}).
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setGoodsOpen(false)} disabled={busy}>Отказ</Button>
              <Button
                disabled={busy}
                onClick={async () => {
                  setError(""); setBusy(true)
                  try {
                    await markWithdrawalGoodsReceived(id, {
                      eligibilityCondition: condition,
                      resolutionType: goodsResolution,
                      returnTrackingNumber: returnTracking || undefined,
                      returnCourier: returnCourier || undefined,
                    })
                    setGoodsOpen(false)
                    await refresh()
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Грешка")
                  } finally { setBusy(false) }
                }}
              >
                Запиши
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── No-return completion (Path B) ──────────────────────────────── */}
      {noReturnOpen && (
        <Modal onClose={() => setNoReturnOpen(false)} title="Завърши без връщане">
          <div className="space-y-3 text-sm">
            <p className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
              За резолюция от тип <strong>refund</strong> първо запишете възстановяването
              от страницата на поръчката (полето &quot;Свързване със заявка&quot;), след което се
              върнете тук и автоматично ще бъде завършена.
            </p>
            <div>
              <Label className="mb-1 block">Тип резолюция</Label>
              <select
                value={pathBResolution}
                onChange={(e) => setPathBResolution(e.target.value as WithdrawalResolutionType)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="refund">Възстановяване (изисква свързан refund)</option>
                <option value="replacement">Замяна</option>
                <option value="none">Без резолюция</option>
              </select>
            </div>
            <div>
              <Label htmlFor="pb-note" className="mb-1 block">Бележка за завършване (задължителна)</Label>
              <textarea
                id="pb-note"
                value={pathBNote}
                onChange={(e) => setPathBNote(e.target.value)}
                maxLength={1000}
                rows={4}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="Защо не се изисква връщане на стоката..."
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setNoReturnOpen(false)} disabled={busy}>Отказ</Button>
              <Button
                disabled={busy || !pathBNote.trim()}
                onClick={async () => {
                  setError(""); setBusy(true)
                  try {
                    await completeWithdrawalNoReturn(id, {
                      resolutionType: pathBResolution,
                      completionNote: pathBNote.trim(),
                    })
                    setNoReturnOpen(false)
                    setPathBNote("")
                    await refresh()
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Грешка")
                  } finally { setBusy(false) }
                }}
              >
                Завърши
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Modal({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="mx-4 w-full max-w-md rounded-lg bg-background p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <h3 className="mb-4 text-lg font-semibold">{title}</h3>
        {children}
      </div>
    </div>
  )
}
