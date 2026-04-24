"use client"

import { useEffect, useMemo, useState, use } from "react"
import Link from "next/link"
import { getOrder, updateOrderStatus, setInvoiceNumber, markInvoiceSent, addAdminNote, generateShipment, getShipmentDefaults, recordCodSettlement, recordRefund, updateRefundAnnotation, recordStockMovement, recordComplaint, resolveComplaint, recordOrderOutcome, getOrderComplaints, type OrderDetail, type OrderRefund, type OrderInventoryReturn, type Complaint, type ShipmentFormData, type ShipmentDisplayInfo } from "@/app/actions/admin"
import { computeRefundBreakdown, formatBreakdownForCreditNote } from "@/lib/refund-breakdown"
import { formatPrice } from "@/lib/products"
import { getDeliveryLabel } from "@/lib/delivery"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { SpeedyOfficePicker, type SpeedyOfficeOption } from "@/components/delivery/speedy-office-picker"
import { EcontOfficePicker, type EcontOfficeOption } from "@/components/delivery/econt-office-picker"

const STATUS_LABELS: Record<string, string> = {
  pending: "Чакаща",
  confirmed: "Потвърдена",
  shipped: "Изпратена",
  delivered: "Доставена",
  cancelled: "Отказана",
}

const STATUS_BADGE_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  confirmed: "default",
  shipped: "secondary",
  delivered: "secondary",
  cancelled: "destructive",
}

export default function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const [order, setOrder] = useState<OrderDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [trackingNumber, setTrackingNumber] = useState("")
  const [cancellationReason, setCancellationReason] = useState("")
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState("")
  const [manualInvoiceNumber, setManualInvoiceNumber] = useState("")
  const [shipmentForm, setShipmentForm] = useState<ShipmentFormData | null>(null)
  const [shipmentDisplay, setShipmentDisplay] = useState<ShipmentDisplayInfo | null>(null)
  const [shipmentOpen, setShipmentOpen] = useState(false)
  const [shipmentLoading, setShipmentLoading] = useState(false)
  const [shipmentSuccess, setShipmentSuccess] = useState<string | null>(null)
  const [selectedOfficeNumericId, setSelectedOfficeNumericId] = useState<number | null>(null)
  const [officePickerError, setOfficePickerError] = useState(false)
  const [newNote, setNewNote] = useState("")
  const [notesSaving, setNotesSaving] = useState(false)
  const [settlementPppRef, setSettlementPppRef] = useState("")
  const [settlementRef, setSettlementRef] = useState("")
  const [settlementAmountInput, setSettlementAmountInput] = useState("")
  const [settlementPaidAt, setSettlementPaidAt] = useState(() => new Date().toISOString().slice(0, 10))
  const [settlementLoading, setSettlementLoading] = useState(false)
  const [settlementSaved, setSettlementSaved] = useState(false)

  // Refund state — Step 1 form fields
  const [refundAmount, setRefundAmount] = useState("")
  const [refundReason, setRefundReason] = useState("")
  const [refundMethod, setRefundMethod] = useState<"stripe" | "bank_transfer">("stripe")
  const [refundDate, setRefundDate] = useState("")
  const [refundCreditNote, setRefundCreditNote] = useState("")
  const [refundStripeId, setRefundStripeId] = useState("")
  const [refundLoading, setRefundLoading] = useState(false)
  // client_idempotency_key for the refund insert. Regenerated after the
  // whole "refund → stock outcome" flow completes (not just after the refund
  // step), so a retry during Step 2 still resolves to the same refund row.
  const [refundClientKey, setRefundClientKey] = useState<string>(() => crypto.randomUUID())

  // Two-step state machine. 'form' = refund form visible; 'stock' = refund
  // saved, stock-outcome panel visible; 'complete' = both done, dismiss banner.
  type RefundStep = "form" | "stock" | "complete"
  const [refundStep, setRefundStep] = useState<RefundStep>("form")
  const [savedRefundId, setSavedRefundId] = useState<string | null>(null)
  const [savedRefundAmountCents, setSavedRefundAmountCents] = useState<number>(0)

  // Step 2 — per-SKU stock-outcome form state.
  const [stockQty, setStockQty] = useState<Record<string, string>>({})
  const [stockDisposition, setStockDisposition] = useState<Record<string, "sellable" | "damaged">>({})
  // Per-(sku,disposition) UUID used as recordStockMovement idempotency key.
  // Generated when entering Step 2, preserved across retries, cleared on
  // flow completion so a new refund gets new keys.
  const [stockKeys, setStockKeys] = useState<Record<string, string>>({})
  const [stockLoading, setStockLoading] = useState(false)
  const [stockProgress, setStockProgress] = useState<{
    done: number
    total: number
    failed: Array<{ sku: string; disposition: string; message: string }>
  } | null>(null)

  // Step 2 alternative: skip-with-reason.
  type SkipReason = "" | "no_return" | "package_lost" | "customer_keeps" | "other"
  const [skipReason, setSkipReason] = useState<SkipReason>("")
  const [skipOtherNote, setSkipOtherNote] = useState("")
  const [skipLoading, setSkipLoading] = useState(false)

  // Complaint state
  const [complaints, setComplaints] = useState<Complaint[]>([])
  const [complaintDefect, setComplaintDefect] = useState("")
  const [complaintDemand, setComplaintDemand] = useState("")
  const [complaintLoading, setComplaintLoading] = useState(false)
  const [complaintResult, setComplaintResult] = useState("")
  const [resolveId, setResolveId] = useState<number | null>(null)
  const [resolveResolution, setResolveResolution] = useState("")
  const [resolveStatus, setResolveStatus] = useState<"resolved" | "rejected">("resolved")
  const [resolveLoading, setResolveLoading] = useState(false)

  // Post-shipment outcome state
  type OutcomeType = "" | "delivery_refused" | "package_lost" | "returned" | "recalled"
  const [outcomeType, setOutcomeType] = useState<OutcomeType>("")
  const [outcomeNote, setOutcomeNote] = useState("")
  const [outcomeCourierRef, setOutcomeCourierRef] = useState("")
  const [outcomeReturnRef, setOutcomeReturnRef] = useState("")
  const [outcomeRecallRef, setOutcomeRecallRef] = useState("")
  const [outcomeRecallReason, setOutcomeRecallReason] = useState("")
  const [outcomeCondition, setOutcomeCondition] = useState<"sellable" | "damaged" | "">("")
  const [outcomeLoading, setOutcomeLoading] = useState(false)
  const [outcomeSaved, setOutcomeSaved] = useState(false)
  // Which outcome type was just saved — drives the post-save "next step"
  // callout (different outcomes suggest different follow-ups).
  const [outcomeSavedType, setOutcomeSavedType] = useState<Exclude<OutcomeType, "">|"">("")
  // Context from the just-saved outcome, preserved across the outcome form's
  // field reset so the callout's "Open refund form" shortcut can prefill
  // the refund form. Cleared when the refund flow is dismissed or completed.
  const [savedOutcomeNote, setSavedOutcomeNote] = useState<string>("")
  const [savedOutcomeRef, setSavedOutcomeRef] = useState<string>("")
  // Set when the refund form was opened FROM an outcome callout. Drives
  // the "linked to outcome X" banner at the top of the refund card so
  // the admin sees the provenance of the prefilled values. Cleared on
  // flow reset.
  const [outcomeLinkedContext, setOutcomeLinkedContext] = useState<{
    outcomeType: Exclude<OutcomeType, "">
    ref: string
  } | null>(null)

  useEffect(() => {
    getOrder(id)
      .then((o) => {
        setOrder(o)
        setRefundMethod(o.payment_method === "card" ? "stripe" : "bank_transfer")
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
    getOrderComplaints(id)
      .then(setComplaints)
      .catch(() => {})
  }, [id])

  async function handleStatusUpdate(newStatus: string) {
    setActionError("")
    setActionLoading(true)
    try {
      await updateOrderStatus(
        id,
        newStatus,
        newStatus === "shipped" ? trackingNumber : undefined,
        newStatus === "cancelled" ? cancellationReason : undefined,
      )
      // Refresh order data
      const updated = await getOrder(id)
      setOrder(updated)
      setTrackingNumber("")
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to update")
    } finally {
      setActionLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <p className="text-muted-foreground">Зареждане...</p>
      </div>
    )
  }

  if (error || !order) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <p className="text-red-600">{error || "Поръчката не е намерена"}</p>
        <Link href="/admin/orders" className="mt-4 inline-block text-sm text-blue-600 hover:underline">
          &larr; Обратно към поръчките
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6">
        <Link href="/admin/orders" className="text-sm text-blue-600 hover:underline">
          &larr; Обратно към поръчките
        </Link>
      </div>

      <div className="mb-6 flex items-center gap-3">
        <h1 className="text-2xl font-bold">Поръчка #{order.id.slice(0, 8)}</h1>
        <Badge variant={STATUS_BADGE_VARIANT[order.status] || "outline"}>
          {STATUS_LABELS[order.status] || order.status}
        </Badge>
      </div>

      {order.payment_method === "cod" && order.status === "confirmed" && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">
            Обади се на клиента за потвърждение преди изпращане
          </p>
          <a
            href={`tel:${order.phone}`}
            className="mt-1 inline-block text-sm font-bold text-amber-900 underline"
          >
            {order.phone}
          </a>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {/* Customer info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Клиент</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div><span className="text-muted-foreground">Име:</span> {order.first_name} {order.last_name}</div>
            <div><span className="text-muted-foreground">Имейл:</span> {order.email}</div>
            <div><span className="text-muted-foreground">Телефон:</span> {order.phone}</div>
            <div><span className="text-muted-foreground">Град:</span> {order.city}</div>
            {order.address && <div><span className="text-muted-foreground">Адрес:</span> {order.address}</div>}
            {order.postal_code && <div><span className="text-muted-foreground">Пощенски код:</span> {order.postal_code}</div>}
            {order.notes && <div><span className="text-muted-foreground">Бележки:</span> {order.notes}</div>}
          </CardContent>
        </Card>

        {/* Order info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Детайли</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div><span className="text-muted-foreground">Дата:</span> {new Date(order.created_at).toLocaleDateString("bg-BG", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
            <div><span className="text-muted-foreground">Плащане:</span> {order.payment_method === "card" ? "Карта" : "Наложен платеж"}</div>
            <div><span className="text-muted-foreground">Доставка:</span> {getDeliveryLabel(order.logistics_partner)}</div>
            {order.econt_office_name && (
              <div><span className="text-muted-foreground">Офис Еконт:</span> {order.econt_office_name} — {order.econt_office_address}</div>
            )}
            {order.speedy_office_name && (
              <div><span className="text-muted-foreground">Офис Speedy:</span> {order.speedy_office_name} — {order.speedy_office_address}</div>
            )}
            {order.tracking_number && (
              <div><span className="text-muted-foreground">Номер на товарителница:</span> <span className="font-mono">{order.tracking_number}</span></div>
            )}
          </CardContent>
        </Card>

        {/* Items */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Продукти</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {order.items.map((item, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span>{item.productName} x {item.quantity}</span>
                  <span className="font-medium">{formatPrice(item.priceInCents * item.quantity)}</span>
                </div>
              ))}
              {(() => {
                const subtotal = order.items.reduce((s, item) => s + item.priceInCents * item.quantity, 0)
                return (
                  <>
                    <div className="border-t pt-2 flex items-center justify-between text-sm text-muted-foreground">
                      <span>Междинна сума</span>
                      <span>{formatPrice(subtotal)}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      <span>Доставка ({getDeliveryLabel(order.logistics_partner)})</span>
                      <span>{order.shipping_fee === 0 ? "Безплатна" : formatPrice(order.shipping_fee)}</span>
                    </div>
                    {order.cod_fee > 0 && (
                      <div className="flex items-center justify-between text-sm text-muted-foreground">
                        <span>Наложен платеж</span>
                        <span>{formatPrice(order.cod_fee)}</span>
                      </div>
                    )}
                    {order.promo_code && order.discount_amount > 0 && (
                      <div className="flex items-center justify-between text-sm text-green-600">
                        <span>Промо код: {order.promo_code}</span>
                        <span>-{formatPrice(order.discount_amount)}</span>
                      </div>
                    )}
                    <div className="border-t pt-2 flex items-center justify-between font-medium">
                      <span>Общо</span>
                      <span>{formatPrice(order.total_amount)}</span>
                    </div>
                  </>
                )
              })()}
            </div>
          </CardContent>
        </Card>

        {/* Invoice */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Фактура</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {order.invoice_number ? (
              <div><span className="text-muted-foreground">Номер:</span> <span className="font-mono">{order.invoice_number}</span></div>
            ) : order.needs_invoice ? (
              (() => {
                // Tax event: card = payment at checkout (created_at), COD = delivery
                const taxEventDate = order.payment_method === "cod"
                  ? (order.delivered_at ? new Date(order.delivered_at) : null)
                  : new Date(order.created_at)
                const deadline = taxEventDate ? new Date(taxEventDate.getTime() + 5 * 24 * 60 * 60 * 1000) : null
                const now = new Date()
                const daysLeft = deadline ? Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null

                return (
                  <div className="space-y-2">
                    <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
                      Клиентът е поискал фактура
                    </div>
                    {daysLeft !== null && (
                      <div className={`rounded-md px-3 py-2 text-sm font-medium ${
                        daysLeft <= 0
                          ? "border border-red-300 bg-red-50 text-red-900"
                          : daysLeft <= 2
                            ? "border border-amber-300 bg-amber-50 text-amber-900"
                            : "border border-border bg-secondary text-foreground"
                      }`}>
                        {daysLeft <= 0
                          ? `Срокът за издаване е изтекъл! (${deadline!.toLocaleDateString("bg-BG")})`
                          : `Остават ${daysLeft} ${daysLeft === 1 ? "ден" : "дни"} за издаване (до ${deadline!.toLocaleDateString("bg-BG")})`
                        }
                      </div>
                    )}
                    {order.payment_method === "cod" && order.status !== "delivered" && (
                      <div className="text-xs text-muted-foreground">
                        Срокът започва след доставка (наложен платеж)
                      </div>
                    )}
                  </div>
                )
              })()
            ) : (
              <div className="text-muted-foreground">Фактура не е поискана</div>
            )}
            {order.invoice_date && (
              <div><span className="text-muted-foreground">Дата:</span> {new Date(order.invoice_date).toLocaleDateString("bg-BG", { day: "2-digit", month: "2-digit", year: "numeric" })}</div>
            )}
            {order.invoice_type && (
              <div><span className="text-muted-foreground">Тип:</span> {order.invoice_type === "company" ? "Юридическо лице" : "Физическо лице"}</div>
            )}
            {order.invoice_company_name && <div><span className="text-muted-foreground">Фирма:</span> {order.invoice_company_name}</div>}
            {order.invoice_eik && <div><span className="text-muted-foreground">ЕИК:</span> {order.invoice_eik}</div>}
            {order.invoice_vat_number && <div><span className="text-muted-foreground">ДДС номер:</span> {order.invoice_vat_number}</div>}
            {order.invoice_mol && <div><span className="text-muted-foreground">МОЛ:</span> {order.invoice_mol}</div>}
            {order.invoice_address && <div><span className="text-muted-foreground">Адрес:</span> {order.invoice_address}</div>}
            {order.invoice_number ? (
              <div className="space-y-2 pt-2">
                <div><span className="text-muted-foreground">Фактура №:</span> <span className="font-medium">{order.invoice_number}</span></div>
                {order.invoice_sent_at ? (
                  <div className="text-xs text-muted-foreground">
                    Изпратена на клиента на {new Date(order.invoice_sent_at).toLocaleDateString("bg-BG", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={actionLoading}
                    onClick={async () => {
                      setActionError("")
                      setActionLoading(true)
                      try {
                        await markInvoiceSent(id)
                        const updated = await getOrder(id)
                        setOrder(updated)
                      } catch (err) {
                        setActionError(err instanceof Error ? err.message : "Грешка")
                      } finally {
                        setActionLoading(false)
                      }
                    }}
                  >
                    Отбележи като изпратена на клиента
                  </Button>
                )}
              </div>
            ) : (
              <div className="flex gap-2 pt-2">
                <Input
                  placeholder="Номер на фактура"
                  value={manualInvoiceNumber}
                  onChange={(e) => setManualInvoiceNumber(e.target.value)}
                  className="h-8 w-48"
                />
                <Button
                  size="sm"
                  disabled={actionLoading || !manualInvoiceNumber.trim()}
                  onClick={async () => {
                    setActionError("")
                    setActionLoading(true)
                    try {
                      await setInvoiceNumber(id, manualInvoiceNumber)
                      const updated = await getOrder(id)
                      setOrder(updated)
                      setManualInvoiceNumber("")
                    } catch (err) {
                      setActionError(err instanceof Error ? err.message : "Грешка при записване на фактура")
                    } finally {
                      setActionLoading(false)
                    }
                  }}
                >
                  Запази
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* COD Payment status (when already settled) */}
      {order.payment_method === "cod" && order.paid_at && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">Плащане (наложен платеж)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-green-900">
              Плащането е получено на {new Date(order.paid_at).toLocaleDateString("bg-BG", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
            </div>
            {order.courier_ppp_ref && (
              <div><span className="text-muted-foreground">ППП референция:</span> <span className="font-mono">{order.courier_ppp_ref}</span></div>
            )}
            {order.settlement_ref && (
              <div><span className="text-muted-foreground">Банков превод:</span> <span className="font-mono">{order.settlement_ref}</span></div>
            )}
            {order.settlement_amount != null && (
              <div>
                <span className="text-muted-foreground">Получена сума:</span> <span className="font-medium">{formatPrice(order.settlement_amount)}</span>
                {order.settlement_amount !== order.total_amount && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    (комисия куриер: {formatPrice(order.total_amount - order.settlement_amount)})
                  </span>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Card Payment */}
      {order.payment_method === "card" && order.paid_at && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">Плащане (карта)</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <div className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-green-900">
              Платено на {new Date(order.paid_at).toLocaleDateString("bg-BG", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Refunds list */}
      {order.refunds.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">Възстановявания</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {(() => {
              const totalRefunded = order.refunds.reduce((sum, r) => sum + r.amount_cents, 0)
              const fullyRefunded = totalRefunded >= order.total_amount
              return (
                <div className="rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-blue-900">
                  {fullyRefunded ? "Изцяло възстановена" : "Частично възстановена"}:{" "}
                  <span className="font-medium">{formatPrice(totalRefunded)}</span>
                  {" / "}
                  <span>{formatPrice(order.total_amount)}</span>
                </div>
              )
            })()}
            {order.refunds.map((r) => (
              <RefundRow
                key={r.id}
                refund={r}
                orderId={order.id}
                orderItems={order.items}
                inventoryReturns={order.inventoryReturns.filter(ret => ret.reference_id === r.id)}
                onSaved={async () => {
                  const refreshed = await getOrder(id)
                  setOrder(refreshed)
                }}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {/* History */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">История</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative space-y-0">
            {(() => {
              // For orders created before timestamps were added, fall back to created_at
              const confirmedFallback = !order.confirmed_at && order.status !== "pending" ? order.created_at : null
              const events = [
                { label: "Поръчка създадена", date: order.created_at },
                { label: "Потвърдена", date: order.confirmed_at || confirmedFallback },
                { label: "Фактура издадена", date: order.invoice_date, detail: order.invoice_number ? `#${order.invoice_number}` : undefined },
                { label: "Фактура изпратена", date: order.invoice_sent_at },
                { label: "Изпратена", date: order.shipped_at, detail: order.tracking_number || undefined },
                { label: "Доставена", date: order.delivered_at },
                { label: "Плащане получено", date: order.paid_at, detail: order.settlement_ref ? `Ref: ${order.settlement_ref}` : undefined },
                ...order.refunds.map((r) => ({
                  label: "Възстановяване",
                  date: r.refunded_at,
                  detail: `${formatPrice(r.amount_cents)} (${r.method === "stripe" ? "Stripe" : "Банков превод"})`,
                })),
                ...complaints.filter(c => c.reported_at).map(c => ({ label: "Рекламация", date: c.reported_at, detail: `#${c.complaint_ref}` })),
                { label: "Отказана", date: order.cancelled_at, detail: order.cancellation_reason ? (order.cancellation_reason.length > 80 ? order.cancellation_reason.slice(0, 80) + "…" : order.cancellation_reason) : undefined },
                ...order.admin_notes.map((note) => ({
                  label: "Бележка",
                  date: note.created_at,
                  detail: note.text.length > 80 ? note.text.slice(0, 80) + "…" : note.text,
                })),
              ]
                .filter((e) => e.date)
                .sort((a, b) => new Date(a.date!).getTime() - new Date(b.date!).getTime())

              return events.map((event, i) => (
                <div key={i} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className="h-3 w-3 rounded-full border-2 border-primary bg-primary" />
                    {i < events.length - 1 && <div className="w-px flex-1 bg-border" />}
                  </div>
                  <div className="pb-5">
                    <p className="text-sm font-medium text-foreground">
                      {event.label}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(event.date!).toLocaleDateString("bg-BG", {
                        day: "2-digit", month: "2-digit", year: "numeric",
                        hour: "2-digit", minute: "2-digit",
                      })}
                    </p>
                    {event.detail && (
                      <p className="mt-0.5 text-xs text-muted-foreground font-mono">{event.detail}</p>
                    )}
                  </div>
                </div>
              ))
            })()}
          </div>
        </CardContent>
      </Card>

      {/* Admin Notes */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Вътрешни бележки</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <textarea
              className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              rows={2}
              placeholder="Добави бележка..."
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && newNote.trim()) {
                  e.preventDefault()
                  document.getElementById("add-note-btn")?.click()
                }
              }}
            />
            <Button
              id="add-note-btn"
              variant="outline"
              size="sm"
              className="self-end"
              disabled={notesSaving || !newNote.trim()}
              onClick={async () => {
                setNotesSaving(true)
                try {
                  await addAdminNote(id, newNote)
                  const updated = await getOrder(id)
                  setOrder(updated)
                  setNewNote("")
                } catch {
                  setActionError("Грешка при добавяне на бележка")
                } finally {
                  setNotesSaving(false)
                }
              }}
            >
              {notesSaving ? "..." : "Добави"}
            </Button>
          </div>
          {order.admin_notes.length > 0 && (
            <div className="mt-3 space-y-2">
              {[...order.admin_notes].reverse().map((note, i) => (
                <div key={i} className="rounded-md border border-border bg-secondary/50 px-3 py-2">
                  <p className="text-sm">{note.text}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {new Date(note.created_at).toLocaleDateString("bg-BG", {
                      day: "2-digit", month: "2-digit", year: "numeric",
                      hour: "2-digit", minute: "2-digit",
                    })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Действия</CardTitle>
        </CardHeader>
        <CardContent>
          {actionError && (
            <p className="mb-4 text-sm text-red-600">{actionError}</p>
          )}

          {order.status === "confirmed" && (
            <div className="space-y-4">
              {!order.tracking_number && (order.logistics_partner?.startsWith("speedy") || order.logistics_partner?.startsWith("econt")) && (
                <>
                  {!shipmentOpen ? (
                    <Button
                      variant="outline"
                      onClick={async () => {
                        setActionError("")
                        try {
                          const { form, display } = await getShipmentDefaults(id)
                          setShipmentForm(form)
                          setShipmentDisplay(display)
                          setSelectedOfficeNumericId(
                            display.courier === "speedy" ? order.speedy_office_id : order.econt_office_id
                          )
                          setOfficePickerError(false)
                          setShipmentOpen(true)
                        } catch (err) {
                          setActionError(err instanceof Error ? err.message : "Грешка")
                        }
                      }}
                    >
                      Генерирай товарителница ({order.logistics_partner?.startsWith("speedy") ? "Speedy" : "Еконт"})
                    </Button>
                  ) : shipmentForm && (
                    <div className="rounded-lg border border-border p-4 space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold">
                          Товарителница — {shipmentDisplay?.courier === "speedy" ? "Speedy" : "Еконт"} ({shipmentDisplay?.deliveryType === "office" ? "до офис" : "до адрес"})
                        </h3>
                        <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => { setShipmentOpen(false); setSelectedOfficeNumericId(null); setOfficePickerError(false) }}>Затвори</button>
                      </div>

                      {/* Sender */}
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Подател</p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div>
                            <label className="mb-1 block text-xs text-muted-foreground">Име / Фирма</label>
                            <Input value={shipmentForm.senderName} onChange={(e) => setShipmentForm({ ...shipmentForm, senderName: e.target.value })} />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs text-muted-foreground">Телефон</label>
                            <Input value={shipmentForm.senderPhone} onChange={(e) => setShipmentForm({ ...shipmentForm, senderPhone: e.target.value })} />
                          </div>
                        </div>
                        {shipmentDisplay?.courier === "econt" && shipmentForm.senderOfficeCode ? (
                          <div>
                            <label className="mb-1 block text-xs text-muted-foreground">Офис код (Еконт)</label>
                            <Input value={shipmentForm.senderOfficeCode} onChange={(e) => setShipmentForm({ ...shipmentForm, senderOfficeCode: e.target.value })} />
                          </div>
                        ) : (
                          <div className="grid gap-2 sm:grid-cols-3">
                            <div>
                              <label className="mb-1 block text-xs text-muted-foreground">Град</label>
                              <Input value={shipmentForm.senderCity} onChange={(e) => setShipmentForm({ ...shipmentForm, senderCity: e.target.value })} />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs text-muted-foreground">Адрес</label>
                              <Input value={shipmentForm.senderAddress} onChange={(e) => setShipmentForm({ ...shipmentForm, senderAddress: e.target.value })} />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs text-muted-foreground">Пощ. код</label>
                              <Input value={shipmentForm.senderPostalCode} onChange={(e) => setShipmentForm({ ...shipmentForm, senderPostalCode: e.target.value })} />
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Receiver */}
                      <div className="space-y-2 border-t pt-3">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Получател</p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div>
                            <label className="mb-1 block text-xs text-muted-foreground">Име</label>
                            <Input value={shipmentForm.recipientName} onChange={(e) => setShipmentForm({ ...shipmentForm, recipientName: e.target.value })} />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs text-muted-foreground">Телефон</label>
                            <Input value={shipmentForm.recipientPhone} onChange={(e) => setShipmentForm({ ...shipmentForm, recipientPhone: e.target.value })} />
                          </div>
                        </div>
                        {shipmentDisplay?.deliveryType === "office" ? (
                          <div className="space-y-3">
                            {shipmentDisplay?.courier === "speedy" ? (
                              <SpeedyOfficePicker
                                selectedOfficeId={selectedOfficeNumericId}
                                onSelect={(office: SpeedyOfficeOption) => {
                                  setSelectedOfficeNumericId(office.id)
                                  setShipmentForm({ ...shipmentForm, recipientOfficeId: String(office.id), recipientOfficeName: office.name })
                                }}
                                onError={setOfficePickerError}
                              />
                            ) : (
                              <EcontOfficePicker
                                selectedOfficeId={selectedOfficeNumericId}
                                onSelect={(office: EcontOfficeOption) => {
                                  setSelectedOfficeNumericId(office.id)
                                  setShipmentForm({ ...shipmentForm, recipientOfficeCode: office.code, recipientOfficeName: office.name })
                                }}
                                onError={setOfficePickerError}
                              />
                            )}
                            {officePickerError && (
                              <p className="text-sm text-red-600">
                                Офисите не могат да бъдат заредени. Използвайте ръчно въвеждане на товарителница.
                              </p>
                            )}
                            <div className="grid gap-2 sm:grid-cols-3">
                              <div>
                                <label className="mb-1 block text-xs text-muted-foreground">
                                  Офис {shipmentDisplay?.courier === "speedy" ? "ID" : "код"}
                                </label>
                                <Input
                                  value={shipmentDisplay?.courier === "speedy" ? shipmentForm.recipientOfficeId : shipmentForm.recipientOfficeCode}
                                  disabled
                                  className="bg-secondary"
                                />
                              </div>
                              <div className="sm:col-span-2">
                                <label className="mb-1 block text-xs text-muted-foreground">Име на офис</label>
                                <Input value={shipmentForm.recipientOfficeName} disabled className="bg-secondary" />
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="grid gap-2 sm:grid-cols-3">
                            <div>
                              <label className="mb-1 block text-xs text-muted-foreground">Град</label>
                              <Input value={shipmentForm.recipientCity} onChange={(e) => setShipmentForm({ ...shipmentForm, recipientCity: e.target.value })} />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs text-muted-foreground">Адрес</label>
                              <Input value={shipmentForm.recipientAddress} onChange={(e) => setShipmentForm({ ...shipmentForm, recipientAddress: e.target.value })} />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs text-muted-foreground">Пощ. код</label>
                              <Input value={shipmentForm.recipientPostalCode} onChange={(e) => setShipmentForm({ ...shipmentForm, recipientPostalCode: e.target.value })} />
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Shipment details */}
                      <div className="space-y-2 border-t pt-3">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Пратка</p>
                        <div className="grid gap-2 sm:grid-cols-3">
                          <div>
                            <label className="mb-1 block text-xs text-muted-foreground">Тегло (кг)</label>
                            <Input type="number" step="0.1" min="0.1" max="50" value={shipmentForm.weight} onChange={(e) => setShipmentForm({ ...shipmentForm, weight: parseFloat(e.target.value) || 0 })} />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs text-muted-foreground">Съдържание</label>
                            <Input value={shipmentForm.contents} onChange={(e) => setShipmentForm({ ...shipmentForm, contents: e.target.value })} />
                          </div>
                          {(shipmentDisplay?.codAmount ?? 0) > 0 && (
                            <div>
                              <label className="mb-1 block text-xs text-muted-foreground">Наложен платеж (EUR)</label>
                              <Input value={shipmentDisplay!.codAmount.toFixed(2)} disabled className="bg-secondary" />
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex gap-2 pt-2">
                        <Button
                          disabled={shipmentLoading || officePickerError}
                          onClick={async () => {
                            setShipmentLoading(true)
                            setActionError("")
                            try {
                              const { trackingNumber: tn } = await generateShipment(id, shipmentForm)
                              setTrackingNumber(tn)
                              setShipmentOpen(false)
                              setSelectedOfficeNumericId(null)
                              setOfficePickerError(false)
                              const updated = await getOrder(id)
                              setOrder(updated)
                              setShipmentSuccess(tn)
                            } catch (err) {
                              setActionError(err instanceof Error ? err.message : "Грешка при генериране на товарителница")
                            } finally {
                              setShipmentLoading(false)
                            }
                          }}
                        >
                          {shipmentLoading ? "Генериране..." : "Изпрати към куриера"}
                        </Button>
                        <Button variant="ghost" onClick={() => { setShipmentOpen(false); setSelectedOfficeNumericId(null); setOfficePickerError(false) }}>Отказ</Button>
                      </div>
                    </div>
                  )}
                </>
              )}
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label className="mb-1 block text-sm font-medium">Номер на товарителница</label>
                  <Input
                    placeholder={order.tracking_number || "Въведете номер на товарителница"}
                    value={trackingNumber}
                    onChange={(e) => setTrackingNumber(e.target.value)}
                  />
                </div>
                <Button
                  onClick={() => handleStatusUpdate("shipped")}
                  disabled={actionLoading || !trackingNumber.trim()}
                >
                  {actionLoading ? "Обработка..." : "Маркирай като изпратена"}
                </Button>
              </div>
              <div className="border-t pt-4 space-y-2">
                <label className="block text-sm font-medium">Причина за отказ</label>
                <Input
                  placeholder="Въведете причина..."
                  value={cancellationReason}
                  onChange={(e) => setCancellationReason(e.target.value)}
                />
                <Button
                  variant="destructive"
                  onClick={() => handleStatusUpdate("cancelled")}
                  disabled={actionLoading}
                >
                  Откажи поръчката
                </Button>
                {order.payment_method === "card" && (
                  <p className="text-xs text-muted-foreground">Плащане с карта — не забравяйте да издадете възстановяване в <a href="https://dashboard.stripe.com/payments" target="_blank" rel="noreferrer" className="underline">Stripe Dashboard</a>.</p>
                )}
              </div>
            </div>
          )}

          {order.status === "shipped" && (
            <Button
              onClick={() => handleStatusUpdate("delivered")}
              disabled={actionLoading}
            >
              {actionLoading ? "Обработка..." : "Маркирай като доставена"}
            </Button>
          )}

          {order.status === "pending" && (
            <div className="space-y-4">
              <Button
                onClick={() => handleStatusUpdate("confirmed")}
                disabled={actionLoading}
              >
                {actionLoading ? "Обработка..." : "Потвърди"}
              </Button>
              <div className="border-t pt-4 space-y-2">
                <label className="block text-sm font-medium">Причина за отказ</label>
                <Input
                  placeholder="Въведете причина..."
                  value={cancellationReason}
                  onChange={(e) => setCancellationReason(e.target.value)}
                />
                <Button
                  variant="destructive"
                  onClick={() => handleStatusUpdate("cancelled")}
                  disabled={actionLoading}
                >
                  Откажи
                </Button>
                {order.payment_method === "card" && (
                  <p className="text-xs text-muted-foreground">Плащане с карта — не забравяйте да издадете възстановяване в <a href="https://dashboard.stripe.com/payments" target="_blank" rel="noreferrer" className="underline">Stripe Dashboard</a>.</p>
                )}
              </div>
            </div>
          )}

          {order.status === "delivered" && (
            order.payment_method === "cod" && !order.paid_at ? (
              <div className="space-y-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Плащане (наложен платеж)</p>
                <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
                  Очаква се плащане от куриер
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">Дата на плащане *</label>
                    <Input
                      type="date"
                      required
                      value={settlementPaidAt}
                      min={order.delivered_at ? new Date(order.delivered_at).toISOString().slice(0, 10) : undefined}
                      max={new Date().toISOString().slice(0, 10)}
                      onChange={(e) => { setSettlementPaidAt(e.target.value); setSettlementSaved(false) }}
                      className="h-8"
                    />
                    <p className="mt-1 text-[10px] text-muted-foreground">Действителната дата на банковия превод от куриера — не днешна дата по подразбиране.</p>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">Получена сума (лв)</label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0.01"
                      placeholder={(order.total_amount / 100).toFixed(2)}
                      value={settlementAmountInput}
                      onChange={(e) => { setSettlementAmountInput(e.target.value); setSettlementSaved(false) }}
                      className="h-8"
                    />
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">ППП референция</label>
                    <Input
                      placeholder="Номер на ППП"
                      value={settlementPppRef}
                      onChange={(e) => { setSettlementPppRef(e.target.value); setSettlementSaved(false) }}
                      className="h-8"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">Банков превод (ref)</label>
                    <Input
                      placeholder="Референция на превод"
                      value={settlementRef}
                      onChange={(e) => { setSettlementRef(e.target.value); setSettlementSaved(false) }}
                      className="h-8"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Button
                    size="sm"
                    disabled={settlementLoading || !settlementPaidAt}
                    onClick={async () => {
                      setSettlementLoading(true)
                      setActionError("")
                      try {
                        const amountFloat = settlementAmountInput ? parseFloat(settlementAmountInput) : undefined
                        const amountCents = amountFloat ? Math.round(amountFloat * 100) : undefined
                        await recordCodSettlement(id, {
                          courierPppRef: settlementPppRef.trim() || undefined,
                          settlementRef: settlementRef.trim() || undefined,
                          settlementAmount: amountCents,
                          paidAt: settlementPaidAt,
                        })
                        const updated = await getOrder(id)
                        setOrder(updated)
                        setSettlementSaved(true)
                      } catch (err) {
                        setActionError(err instanceof Error ? err.message : "Грешка при записване на плащане")
                      } finally {
                        setSettlementLoading(false)
                      }
                    }}
                  >
                    {settlementLoading ? "Записване..." : "Запиши плащане"}
                  </Button>
                  {settlementSaved && <span className="text-xs text-muted-foreground">Записано</span>}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Няма налични действия за тази поръчка.</p>
            )
          )}

          {order.status === "cancelled" && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-destructive">Поръчката е отказана</p>
              {order.cancellation_reason && (
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Причина:</span> {order.cancellation_reason}
                </p>
              )}
            </div>
          )}

          {/* Two-step refund flow. Step 1 records the refund row; Step 2
              separately records any physical stock outcome (per-SKU
              recordStockMovement calls) OR captures a "no stock movement"
              reason via addAdminNote. Each server action stays
              single-responsibility; the UI does the coordination.
              id="refund-card" is the scroll/focus target from the outcome
              card's guided-flow "next step" callout. */}
          {(() => {
            const alreadyRefunded = order.refunds.reduce((s, r) => s + r.amount_cents, 0)
            const remainingCents = order.total_amount - alreadyRefunded
            if (!order.paid_at) return null

            const resetFlow = () => {
              setRefundAmount("")
              setRefundReason("")
              setRefundCreditNote("")
              setRefundStripeId("")
              setStockQty({})
              setStockDisposition({})
              setStockKeys({})
              setStockProgress(null)
              setSkipReason("")
              setSkipOtherNote("")
              setSavedRefundId(null)
              setSavedRefundAmountCents(0)
              setOutcomeLinkedContext(null)
              setSavedOutcomeNote("")
              setSavedOutcomeRef("")
              setRefundStep("form")
              // New UUIDs only on full flow completion — retries during
              // Step 2 keep the same key so recordRefund idempotency holds.
              setRefundClientKey(crypto.randomUUID())
            }

            const outcomeLabels: Record<"delivery_refused" | "package_lost" | "returned" | "recalled", string> = {
              delivery_refused: "Отказана доставка",
              package_lost: "Изгубена пратка",
              returned: "Върнат продукт",
              recalled: "Изтеглен продукт",
            }

            return (
              <div id="refund-card" className="space-y-3 border-t pt-4 mt-4 rounded-md transition-shadow">
                {/* "Linked to outcome" banner — surfaces provenance when the
                    form was opened from the outcome callout and the values
                    are prefilled. Visible on Step 1 only (Step 2/complete
                    have their own status indicators). Dismissible — some
                    admins may want to strip the prefill and start fresh. */}
                {refundStep === "form" && outcomeLinkedContext && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <div className="flex items-start justify-between gap-3">
                      <span>
                        Възстановяване, свързано с: <strong>{outcomeLabels[outcomeLinkedContext.outcomeType]}</strong>
                        {outcomeLinkedContext.ref && <span className="ml-1">(реф. <span className="font-mono">{outcomeLinkedContext.ref}</span>)</span>}
                        . Сумата и причината са попълнени от събитието — редактирайте ги свободно.
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setOutcomeLinkedContext(null)
                          setRefundAmount("")
                          setRefundReason("")
                        }}
                        className="shrink-0 text-[11px] underline hover:no-underline"
                      >
                        Изчисти
                      </button>
                    </div>
                  </div>
                )}
                {/* ─── Step 1: refund form ─────────────────────────────── */}
                {refundStep === "form" && (
                  <>
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Стъпка 1 — запиши възстановяване</p>
                      <p className="text-xs text-muted-foreground">
                        Остава за възстановяване: <span className="font-medium text-foreground">{formatPrice(remainingCents)}</span>
                      </p>
                    </div>
                    {remainingCents <= 0 && (
                      <p className="text-xs text-muted-foreground">Цялата сума по поръчката е възстановена.</p>
                    )}
                    {remainingCents > 0 && (
                      <>
                        {order.delivered_at && (() => {
                          const deadline = new Date(new Date(order.delivered_at).getTime() + 14 * 24 * 60 * 60 * 1000)
                          const daysLeft = Math.ceil((deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                          return (
                            <div className={`rounded-md px-3 py-2 text-sm ${
                              daysLeft <= 0 ? "border border-muted bg-secondary text-muted-foreground"
                              : daysLeft <= 3 ? "border border-amber-300 bg-amber-50 text-amber-900"
                              : "border border-border bg-secondary text-foreground"
                            }`}>
                              {daysLeft <= 0
                                ? `14-дневният срок за отказ е изтекъл (${deadline.toLocaleDateString("bg-BG")})`
                                : `Остават ${daysLeft} ${daysLeft === 1 ? "ден" : "дни"} от правото на отказ (до ${deadline.toLocaleDateString("bg-BG")})`
                              }
                            </div>
                          )
                        })()}
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div>
                            <label className="mb-1 block text-xs text-muted-foreground">Дата</label>
                            <Input type="date" value={refundDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setRefundDate(e.target.value)} className="h-8" />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs text-muted-foreground">Сума (€)</label>
                            <Input type="number" step="0.01" min="0.01" max={(remainingCents / 100).toFixed(2)} placeholder={(remainingCents / 100).toFixed(2)} value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} className="h-8" />
                          </div>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div>
                            <label className="mb-1 block text-xs text-muted-foreground">Метод</label>
                            <select value={refundMethod} onChange={(e) => setRefundMethod(e.target.value as "stripe" | "bank_transfer")} className="h-8 w-full rounded-md border border-border bg-background px-3 text-sm">
                              <option value="stripe">Stripe</option>
                              <option value="bank_transfer">Банков превод</option>
                            </select>
                          </div>
                          {order.needs_invoice && order.invoice_number && (
                            <div>
                              <label className="mb-1 block text-xs text-muted-foreground">Кредитно известие №</label>
                              <Input value={refundCreditNote} onChange={(e) => setRefundCreditNote(e.target.value)} placeholder="Задължително" className="h-8" maxLength={100} />
                            </div>
                          )}
                        </div>
                        {refundMethod === "stripe" && (
                          <div>
                            <label className="mb-1 block text-xs text-muted-foreground">Stripe refund ID (от Stripe Dashboard)</label>
                            <Input value={refundStripeId} onChange={(e) => setRefundStripeId(e.target.value)} placeholder="re_..." className="h-8 font-mono" maxLength={100} />
                          </div>
                        )}
                        <div>
                          <label className="mb-1 block text-xs text-muted-foreground">Причина</label>
                          <Input value={refundReason} onChange={(e) => setRefundReason(e.target.value)} placeholder="Право на отказ / рекламация / ..." className="h-8" maxLength={1000} />
                        </div>

                        <div className="flex items-center gap-3">
                          <Button size="sm" disabled={refundLoading || !refundReason.trim() || (refundMethod === "stripe" && !refundStripeId.trim())} onClick={async () => {
                            setRefundLoading(true)
                            setActionError("")
                            try {
                              const amountFloat = refundAmount ? parseFloat(refundAmount) : remainingCents / 100
                              const amountCents = Math.round(amountFloat * 100)
                              const result = await recordRefund(id, {
                                refundAmount: amountCents,
                                refundReason: refundReason.trim(),
                                refundMethod,
                                refundedAt: refundDate || undefined,
                                creditNoteRef: refundCreditNote.trim() || undefined,
                                stripeRefundId: refundMethod === "stripe" ? refundStripeId.trim() : undefined,
                                clientIdempotencyKey: refundClientKey,
                              })
                              const updated = await getOrder(id)
                              setOrder(updated)
                              setSavedRefundId(result.refundId)
                              setSavedRefundAmountCents(amountCents)
                              setRefundStep("stock")
                            } catch (err) {
                              setActionError(err instanceof Error ? err.message : "Грешка при записване на възстановяване")
                            } finally {
                              setRefundLoading(false)
                            }
                          }}>
                            {refundLoading ? "Записване..." : "Запиши възстановяване"}
                          </Button>
                        </div>
                        {order.payment_method === "card" && (
                          <p className="text-xs text-muted-foreground">
                            Издайте възстановяване в{" "}
                            <a href={order.stripe_payment_intent_id ? `https://dashboard.stripe.com/payments/${order.stripe_payment_intent_id}` : "https://dashboard.stripe.com/payments"} target="_blank" rel="noreferrer" className="underline">Stripe Dashboard</a>
                            {", копирайте refund ID (re_...) и го попълнете тук. Ако webhook вече е записал възстановяването, редактирайте го от списъка по-горе."}
                          </p>
                        )}
                        {order.payment_method === "cod" && (
                          <p className="text-xs text-muted-foreground">Направете банков превод към IBAN на клиента и след това запишете тук.</p>
                        )}
                      </>
                    )}
                  </>
                )}

                {/* ─── Step 2: stock outcome ────────────────────────────── */}
                {refundStep === "stock" && savedRefundId && (
                  <>
                    <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-900">
                      ✓ Възстановяване {formatPrice(savedRefundAmountCents)} записано. <span className="text-[11px] opacity-75">(#{savedRefundId.slice(0, 8)})</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Стъпка 2 — запиши стоково движение</p>
                    </div>

                    {/* Path A: per-SKU physical return */}
                    <div className="rounded-md border border-border px-3 py-3">
                      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Физически върнати артикули</p>
                      <p className="mb-2 text-[11px] text-muted-foreground">Отбележете количеството и състоянието на върнатите артикули. Нулеви стойности не създават движение.</p>
                      <div className="space-y-2">
                        {order.items.map((item) => {
                          const qtyStr = stockQty[item.sku] ?? ""
                          const disposition = stockDisposition[item.sku] ?? "sellable"
                          return (
                            <div key={item.sku} className="flex items-center gap-2 text-sm">
                              <div className="min-w-0 flex-1">
                                <div className="truncate">{item.productName}</div>
                                <div className="text-[11px] text-muted-foreground">Поръчани: {item.quantity} · <span className="font-mono">{item.sku}</span></div>
                              </div>
                              <Input
                                type="number"
                                min="0"
                                max={item.quantity}
                                step="1"
                                placeholder="0"
                                value={qtyStr}
                                onChange={(e) => setStockQty({ ...stockQty, [item.sku]: e.target.value })}
                                className="h-8 w-20"
                              />
                              <select
                                value={disposition}
                                onChange={(e) => setStockDisposition({ ...stockDisposition, [item.sku]: e.target.value as "sellable" | "damaged" })}
                                className="h-8 rounded-md border border-border bg-background px-2 text-xs"
                              >
                                <option value="sellable">Годен за продажба</option>
                                <option value="damaged">Негоден (брак)</option>
                              </select>
                            </div>
                          )
                        })}
                      </div>
                      {stockProgress && (
                        <div className="mt-3 rounded-md bg-muted/30 px-3 py-2 text-xs">
                          Запис: {stockProgress.done} / {stockProgress.total}
                          {stockProgress.failed.length > 0 && (
                            <div className="mt-1 text-red-700">
                              Грешки ({stockProgress.failed.length}): {stockProgress.failed.map((f) => `${f.sku}/${f.disposition}`).join(", ")}.
                              Натиснете „Запиши стоково движение&rdquo; отново, за да опитате останалите (вече записаните няма да се дублират).
                            </div>
                          )}
                        </div>
                      )}
                      <div className="mt-3">
                        <Button
                          size="sm"
                          disabled={stockLoading || skipLoading}
                          onClick={async () => {
                            const movements = order.items
                              .map((item) => {
                                const qtyStr = stockQty[item.sku] ?? ""
                                const qty = qtyStr ? parseInt(qtyStr, 10) : 0
                                if (!qty || qty < 1) return null
                                return {
                                  sku: item.sku,
                                  quantity: qty,
                                  disposition: (stockDisposition[item.sku] ?? "sellable") as "sellable" | "damaged",
                                }
                              })
                              .filter((m): m is NonNullable<typeof m> => m !== null)
                            if (movements.length === 0) {
                              setActionError('Въведете поне едно количество, или изберете „Няма физическо връщане" по-долу')
                              return
                            }
                            setStockLoading(true)
                            setActionError("")
                            // Generate UUIDs per (sku, disposition) if not already
                            // present. Preserved across retries so failures in
                            // the middle of the loop can be safely retried.
                            const keysDraft: Record<string, string> = { ...stockKeys }
                            for (const m of movements) {
                              const k = `${m.sku}::${m.disposition}`
                              if (!keysDraft[k]) keysDraft[k] = crypto.randomUUID()
                            }
                            setStockKeys(keysDraft)

                            const failed: Array<{ sku: string; disposition: string; message: string }> = []
                            let done = 0
                            setStockProgress({ done: 0, total: movements.length, failed: [] })
                            for (const m of movements) {
                              const k = `${m.sku}::${m.disposition}`
                              try {
                                await recordStockMovement({
                                  sku: m.sku,
                                  type: m.disposition === "sellable" ? "return_in" : "damaged",
                                  quantity: m.quantity,
                                  referenceType: "return",
                                  referenceId: savedRefundId,
                                  notes: m.disposition === "damaged"
                                    ? `Повреден при връщане (refund ${savedRefundId.slice(0, 8)})`
                                    : undefined,
                                  orderId: id,
                                  idempotencyKey: keysDraft[k],
                                })
                                done += 1
                                setStockProgress({ done, total: movements.length, failed: [...failed] })
                              } catch (err) {
                                failed.push({
                                  sku: m.sku,
                                  disposition: m.disposition,
                                  message: err instanceof Error ? err.message : "Грешка",
                                })
                                setStockProgress({ done, total: movements.length, failed: [...failed] })
                              }
                            }
                            setStockLoading(false)
                            if (failed.length === 0) {
                              const refreshed = await getOrder(id)
                              setOrder(refreshed)
                              setRefundStep("complete")
                            } else {
                              setActionError(failed[0].message)
                            }
                          }}
                        >
                          {stockLoading ? "Записване..." : "Запиши стоково движение"}
                        </Button>
                      </div>
                    </div>

                    {/* Path B: skip with reason */}
                    <div className="rounded-md border border-border px-3 py-3">
                      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Или — няма физическо връщане</p>
                      <div className="space-y-1 text-sm">
                        {([
                          ["no_return", "Goodwill възстановяване — не се очаква връщане"],
                          ["package_lost", "Изгубена пратка"],
                          ["customer_keeps", "Клиентът задържа стоката"],
                          ["other", "Друго"],
                        ] as const).map(([val, label]) => (
                          <label key={val} className="flex items-center gap-2">
                            <input
                              type="radio"
                              name="skipReason"
                              value={val}
                              checked={skipReason === val}
                              onChange={(e) => setSkipReason(e.target.value as SkipReason)}
                            />
                            <span>{label}</span>
                          </label>
                        ))}
                        {skipReason === "other" && (
                          <Input
                            value={skipOtherNote}
                            onChange={(e) => setSkipOtherNote(e.target.value)}
                            placeholder="Уточнете…"
                            className="h-8 mt-2"
                            maxLength={500}
                          />
                        )}
                      </div>
                      <div className="mt-3">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={skipLoading || stockLoading || !skipReason || (skipReason === "other" && !skipOtherNote.trim())}
                          onClick={async () => {
                            setSkipLoading(true)
                            setActionError("")
                            const reasonLabel: Record<Exclude<SkipReason, "">, string> = {
                              no_return: "Goodwill — не се очаква връщане",
                              package_lost: "Изгубена пратка",
                              customer_keeps: "Клиентът задържа стоката",
                              other: `Друго: ${skipOtherNote.trim()}`,
                            }
                            const label = skipReason ? reasonLabel[skipReason] : ""
                            try {
                              await addAdminNote(
                                id,
                                `[Възстановяване #${savedRefundId.slice(0, 8)}] Стоково движение пропуснато: ${label}`.slice(0, 2000),
                              )
                              const refreshed = await getOrder(id)
                              setOrder(refreshed)
                              setRefundStep("complete")
                            } catch (err) {
                              setActionError(err instanceof Error ? err.message : "Грешка при записване")
                            } finally {
                              setSkipLoading(false)
                            }
                          }}
                        >
                          {skipLoading ? "Записване..." : "Потвърди пропускане"}
                        </Button>
                      </div>
                    </div>
                  </>
                )}

                {/* ─── Step 3: complete ─────────────────────────────────── */}
                {refundStep === "complete" && (
                  <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm">
                    <p className="font-medium text-green-900">✓ Възстановяване и стоково движение приключени.</p>
                    <div className="mt-2">
                      <Button size="sm" variant="outline" onClick={resetFlow}>
                        Запиши ново възстановяване
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )
          })()}

          {/* Complaints section */}
          <div className="space-y-3 border-t pt-4 mt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Рекламации</p>
            {complaints.length > 0 && (
              <div className="space-y-2">
                {complaints.map((c) => (
                  <div key={c.id} className="rounded-md border border-border p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-medium">{c.complaint_ref}</span>
                      <Badge variant={c.status === "open" ? "outline" : c.status === "resolved" ? "default" : "destructive"} className="text-[10px]">
                        {c.status === "open" ? "Отворена" : c.status === "resolved" ? "Приключена" : "Отхвърлена"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{c.defect_description.length > 100 ? c.defect_description.slice(0, 100) + "…" : c.defect_description}</p>
                    <p className="mt-1 text-xs"><span className="text-muted-foreground">Претенция:</span> {
                      { refund: "Възстановяване", replacement: "Замяна", repair: "Ремонт", discount: "Отстъпка" }[c.customer_demand] ?? c.customer_demand
                    }</p>
                    {c.resolution && <p className="mt-1 text-xs"><span className="text-muted-foreground">Решение:</span> {c.resolution}</p>}
                    {c.status === "open" && (
                      resolveId === c.id ? (
                        <div className="mt-2 space-y-2">
                          <select value={resolveStatus} onChange={(e) => setResolveStatus(e.target.value as "resolved" | "rejected")} className="h-7 rounded-md border border-border bg-background px-2 text-xs">
                            <option value="resolved">Приключена</option>
                            <option value="rejected">Отхвърлена</option>
                          </select>
                          <Input value={resolveResolution} onChange={(e) => setResolveResolution(e.target.value)} placeholder="Решение (задължително)" className="h-7 text-xs" maxLength={1000} />
                          <div className="flex gap-2">
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setResolveId(null)}>Отказ</Button>
                            <Button size="sm" className="h-7 text-xs" disabled={resolveLoading || !resolveResolution.trim()} onClick={async () => {
                              setResolveLoading(true)
                              try {
                                await resolveComplaint(c.id, { status: resolveStatus, resolution: resolveResolution.trim() })
                                const updated = await getOrderComplaints(id)
                                setComplaints(updated)
                                setResolveId(null)
                                setResolveResolution("")
                              } catch (err) {
                                setActionError(err instanceof Error ? err.message : "Грешка")
                              } finally {
                                setResolveLoading(false)
                              }
                            }}>
                              {resolveLoading ? "..." : "Запиши"}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button size="sm" variant="outline" className="mt-2 h-7 text-xs" onClick={() => setResolveId(c.id)}>Приключи</Button>
                      )
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="space-y-2">
              <Input value={complaintDefect} onChange={(e) => setComplaintDefect(e.target.value)} placeholder="Описание на несъответствието" className="h-8" maxLength={2000} />
              <select value={complaintDemand} onChange={(e) => setComplaintDemand(e.target.value)} className="h-8 w-full rounded-md border border-border bg-background px-3 text-sm">
                <option value="">Претенция на потребителя...</option>
                <option value="refund">Възстановяване на сумата</option>
                <option value="replacement">Замяна</option>
                <option value="repair">Ремонт</option>
                <option value="discount">Отстъпка</option>
              </select>
              <div className="flex items-center gap-3">
                <Button size="sm" variant="outline" disabled={complaintLoading || !complaintDefect.trim() || !complaintDemand} onClick={async () => {
                  setComplaintLoading(true)
                  setComplaintResult("")
                  setActionError("")
                  try {
                    const result = await recordComplaint(id, {
                      defectDescription: complaintDefect.trim(),
                      customerDemand: complaintDemand as "refund" | "replacement" | "repair" | "discount",
                    })
                    setComplaintResult(result.complaintRef)
                    setComplaintDefect("")
                    setComplaintDemand("")
                    const updated = await getOrderComplaints(id)
                    setComplaints(updated)
                  } catch (err) {
                    setActionError(err instanceof Error ? err.message : "Грешка при записване на рекламация")
                  } finally {
                    setComplaintLoading(false)
                  }
                }}>
                  {complaintLoading ? "Записване..." : "Регистрирай рекламация"}
                </Button>
              </div>
              {complaintResult && (
                <div className="rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-900">
                  <p className="font-medium">Рекламация регистрирана: {complaintResult}</p>
                  <p className="mt-1 text-xs">Предоставете този номер на клиента като потвърждение за регистрация на рекламацията.</p>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Post-shipment outcome events — only for shipped/delivered orders */}
      {(order.status === "shipped" || order.status === "delivered") && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-base">Следдоставни събития</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-muted-foreground">
              Докладвайте изключение, без да променяте статуса на поръчката. Статусът остава какъвто е — паричните и физическите потоци се записват отделно (възстановяване, връщане в склада, брак).
            </p>
            <div className="space-y-2">
              <select
                value={outcomeType}
                onChange={(e) => {
                  setOutcomeType(e.target.value as OutcomeType)
                  setOutcomeSaved(false)
                }}
                className="h-8 w-full rounded-md border border-border bg-background px-3 text-sm"
              >
                <option value="">Тип събитие...</option>
                <option value="delivery_refused">Отказана доставка</option>
                <option value="package_lost">Изгубена пратка</option>
                <option value="returned">Върнат продукт</option>
                <option value="recalled">Изтеглен продукт</option>
              </select>

              {outcomeType === "package_lost" && (
                <Input
                  value={outcomeCourierRef}
                  onChange={(e) => setOutcomeCourierRef(e.target.value)}
                  placeholder="Референция на куриерска претенция *"
                  className="h-8"
                  maxLength={100}
                />
              )}
              {outcomeType === "delivery_refused" && (
                <Input
                  value={outcomeCourierRef}
                  onChange={(e) => setOutcomeCourierRef(e.target.value)}
                  placeholder="Референция на куриера (незадължително)"
                  className="h-8"
                  maxLength={100}
                />
              )}
              {outcomeType === "returned" && (
                <>
                  <Input
                    value={outcomeReturnRef}
                    onChange={(e) => setOutcomeReturnRef(e.target.value)}
                    placeholder="Референция на връщане *"
                    className="h-8"
                    maxLength={100}
                  />
                  <select
                    value={outcomeCondition}
                    onChange={(e) => setOutcomeCondition(e.target.value as "sellable" | "damaged" | "")}
                    className="h-8 w-full rounded-md border border-border bg-background px-3 text-sm"
                  >
                    <option value="">Състояние *</option>
                    <option value="sellable">Годно за продажба</option>
                    <option value="damaged">Негодно (брак)</option>
                  </select>
                </>
              )}
              {outcomeType === "recalled" && (
                <>
                  <Input
                    value={outcomeRecallRef}
                    onChange={(e) => setOutcomeRecallRef(e.target.value)}
                    placeholder="Референция на изтегляне *"
                    className="h-8"
                    maxLength={100}
                  />
                  <Input
                    value={outcomeRecallReason}
                    onChange={(e) => setOutcomeRecallReason(e.target.value)}
                    placeholder="Причина за изтегляне *"
                    className="h-8"
                    maxLength={500}
                  />
                </>
              )}

              <textarea
                value={outcomeNote}
                onChange={(e) => setOutcomeNote(e.target.value)}
                placeholder="Описание (поне 10 символа) *"
                rows={3}
                maxLength={2000}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />

              <Button
                size="sm"
                variant="outline"
                disabled={outcomeLoading || !outcomeType || outcomeNote.trim().length < 10}
                onClick={async () => {
                  if (!outcomeType) return
                  setOutcomeLoading(true)
                  setOutcomeSaved(false)
                  setActionError("")
                  const submittedType = outcomeType
                  try {
                    await recordOrderOutcome(id, {
                      outcomeType: submittedType,
                      note: outcomeNote.trim(),
                      courierRef: outcomeCourierRef.trim() || undefined,
                      returnRef: outcomeReturnRef.trim() || undefined,
                      recallRef: outcomeRecallRef.trim() || undefined,
                      recallReason: outcomeRecallReason.trim() || undefined,
                      condition: outcomeCondition || undefined,
                    })
                    setOutcomeSaved(true)
                    setOutcomeSavedType(submittedType)
                    // Stash the note + first available reference for the
                    // callout-to-refund-form prefill. Must happen BEFORE
                    // clearing the input state below.
                    setSavedOutcomeNote(outcomeNote.trim())
                    setSavedOutcomeRef(
                      (outcomeReturnRef.trim() ||
                        outcomeRecallRef.trim() ||
                        outcomeCourierRef.trim()) ?? "",
                    )
                    setOutcomeType("")
                    setOutcomeNote("")
                    setOutcomeCourierRef("")
                    setOutcomeReturnRef("")
                    setOutcomeRecallRef("")
                    setOutcomeRecallReason("")
                    setOutcomeCondition("")
                    // Reload order so the new admin note shows in the timeline.
                    const refreshed = await getOrder(id)
                    setOrder(refreshed)
                  } catch (err) {
                    setActionError(err instanceof Error ? err.message : "Грешка при записване на събитие")
                  } finally {
                    setOutcomeLoading(false)
                  }
                }}
              >
                {outcomeLoading ? "Записване..." : "Запиши събитие"}
              </Button>

              {/* Guided-flow post-save callout. Outcome is recorded
                  standalone; this nudges the admin to the refund form
                  (which already handles money + inventory together via
                  recordRefund's inventoryAdjustments). Each server action
                  stays single-responsibility; the UI does the coordination. */}
              {outcomeSaved && outcomeSavedType && (() => {
                const alreadyRefunded = order.refunds.reduce((s, r) => s + r.amount_cents, 0)
                const remainingCents = order.total_amount - alreadyRefunded
                const hasRemaining = remainingCents > 0

                // Map outcome type → Bulgarian label for the linked banner
                // shown in the refund card once prefill has happened.
                const outcomeLabels: Record<Exclude<OutcomeType, "">, string> = {
                  delivery_refused: "Отказана доставка",
                  package_lost: "Изгубена пратка",
                  returned: "Върнат продукт",
                  recalled: "Изтеглен продукт",
                }

                // Opens the refund card with values prefilled from the just-saved
                // outcome: full remaining balance as amount, reason as
                // "[<outcome label>] <note>" with optional reference. Focuses
                // the amount input so the admin can tweak or Tab through.
                const openLinkedRefund = () => {
                  if (!outcomeSavedType) return
                  const amountStr = (remainingCents / 100).toFixed(2)
                  setRefundAmount(amountStr)
                  const label = outcomeLabels[outcomeSavedType]
                  const refPart = savedOutcomeRef ? ` (реф. ${savedOutcomeRef})` : ""
                  const reasonText = `[${label}${refPart}] ${savedOutcomeNote}`.slice(0, 1000)
                  setRefundReason(reasonText)
                  setOutcomeLinkedContext({
                    outcomeType: outcomeSavedType,
                    ref: savedOutcomeRef,
                  })
                  // Make sure the flow is at Step 1 (form) even if the admin
                  // was in the middle of a different refund flow somehow.
                  setRefundStep("form")

                  const el = document.getElementById("refund-card")
                  if (el) {
                    el.scrollIntoView({ behavior: "smooth", block: "start" })
                    el.classList.add("ring-2", "ring-accent/60")
                    setTimeout(() => el.classList.remove("ring-2", "ring-accent/60"), 2000)
                  }
                  // Focus the amount input after the scroll settles. The
                  // type=number input is first in the form order below
                  // the date picker; focus the number one so the admin can
                  // immediately tweak or Tab through.
                  setTimeout(() => {
                    const input = document.querySelector<HTMLInputElement>(
                      '#refund-card input[type="number"]',
                    )
                    input?.focus()
                    input?.select()
                  }, 500)

                  setOutcomeSavedType("")
                }

                const guidance: Record<Exclude<OutcomeType, "">, {
                  summary: string
                  refundNow: boolean // show "Open refund form" primary CTA
                  refundLater: boolean // show "По-късно" / "Разбрах" dismiss
                }> = {
                  delivery_refused: {
                    // Parcel still inbound; usually admin refunds AFTER it arrives
                    // and they've confirmed condition. But sometimes admin knows
                    // they'll refund regardless (customer's already disputed, etc.),
                    // so offer both paths.
                    summary: "Пратката се връща. Обикновено възстановяването и движението в склада се записват след като пратката бъде инспектирана.",
                    refundNow: true,
                    refundLater: true,
                  },
                  package_lost: {
                    summary: "Възстановете сумата на клиента. Движение в склада не се налага — стоката е изгубена.",
                    refundNow: true,
                    refundLater: true,
                  },
                  returned: {
                    summary: "Запишете възстановяване и движение в склада (върнатите артикули се добавят към възстановяването).",
                    refundNow: true,
                    refundLater: true,
                  },
                  recalled: {
                    summary: "Запишете възстановяване; върнатите стоки се отписват като брак.",
                    refundNow: true,
                    refundLater: true,
                  },
                }
                const g = guidance[outcomeSavedType]

                return (
                  <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm">
                    <p className="font-medium text-green-900">
                      ✓ Събитието е записано в историята на поръчката.
                    </p>
                    <p className="mt-1 text-xs text-green-900/80">
                      <span className="font-medium">Следваща стъпка: </span>
                      {g.summary}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {g.refundNow && hasRemaining && (
                        <Button size="sm" variant="outline" onClick={openLinkedRefund}>
                          Отвори формата за възстановяване
                        </Button>
                      )}
                      {g.refundNow && !hasRemaining && (
                        <p className="text-xs text-green-900/80">
                          Цялата сума на поръчката вече е възстановена — няма остатък за възстановяване.
                        </p>
                      )}
                      {g.refundLater && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setOutcomeSavedType("")}
                        >
                          {g.refundNow ? "По-късно" : "Разбрах"}
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })()}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Shipment success modal */}
      {shipmentSuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShipmentSuccess(null)} onKeyDown={(e) => { if (e.key === "Escape") setShipmentSuccess(null) }} role="dialog" aria-modal="true">
          <div className="mx-4 w-full max-w-md rounded-lg bg-background p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-center mb-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </div>
            </div>
            <h3 className="text-center text-lg font-semibold">Товарителница генерирана</h3>
            <p className="mt-2 text-center text-sm text-muted-foreground">
              Номер: <span className="font-mono font-medium text-foreground">{shipmentSuccess}</span>
            </p>
            <p className="mt-3 text-center text-xs text-muted-foreground">
              Маркирайте поръчката като изпратена, когато сте готови.
            </p>
            <Button className="mt-5 w-full" onClick={() => setShipmentSuccess(null)}>
              Разбрах
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// One row in the refunds list. Shows the refund details, a computed
// breakdown for кредитно известие (VAT 20% inclusive; copy-pasteable for
// Microinvest), and an inline annotation edit for reason + credit_note_ref.
// The breakdown is built from linked inventory_log rows
// (inventory_log.reference_id = refund.id, reference_type = 'return').
function RefundRow({
  refund,
  orderId,
  orderItems,
  inventoryReturns,
  onSaved,
}: {
  refund: OrderRefund
  orderId: string
  orderItems: OrderDetail["items"]
  inventoryReturns: OrderInventoryReturn[]
  onSaved: () => Promise<void> | void
}) {
  const [editing, setEditing] = useState(false)
  const [reason, setReason] = useState(refund.reason ?? "")
  const [creditNote, setCreditNote] = useState(refund.credit_note_ref ?? "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [copied, setCopied] = useState(false)

  const breakdown = useMemo(
    () =>
      computeRefundBreakdown(
        refund.amount_cents,
        inventoryReturns.map((r) => ({ sku: r.sku, quantity: r.quantity, type: r.type })),
        orderItems.map((i) => ({
          sku: i.sku,
          productName: i.productName,
          unitPriceCents: i.priceInCents,
        })),
      ),
    [refund.amount_cents, inventoryReturns, orderItems],
  )

  const copyText = useMemo(
    () =>
      formatBreakdownForCreditNote(breakdown, {
        orderId,
        refundedAt: refund.refunded_at,
        method: refund.method,
      }),
    [breakdown, orderId, refund.refunded_at, refund.method],
  )

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(copyText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard API unavailable / permission denied — fall back to select-all
      // on a hidden textarea would be overkill; log and leave.
      console.error("Clipboard write failed")
    }
  }

  return (
    <div className="rounded-md border border-border p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div>
            <span className="font-medium">{formatPrice(refund.amount_cents)}</span>
            <span className="ml-2 text-xs text-muted-foreground">
              {refund.method === "stripe" ? "Stripe" : "Банков превод"}
            </span>
            <span className="ml-2 text-xs text-muted-foreground">
              {refund.source === "stripe_webhook" ? "(webhook)" : "(админ)"}
            </span>
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {new Date(refund.refunded_at).toLocaleDateString("bg-BG", {
              day: "2-digit", month: "2-digit", year: "numeric",
              hour: "2-digit", minute: "2-digit",
            })}
            {refund.stripe_refund_id && (
              <span className="ml-2 font-mono">{refund.stripe_refund_id}</span>
            )}
          </div>
        </div>
        {!editing && (
          <Button size="sm" variant="outline" onClick={() => { setEditing(true); setError("") }}>
            Редактирай
          </Button>
        )}
      </div>
      {!editing && (
        <div className="mt-2 space-y-1 text-xs">
          {refund.reason && (
            <div><span className="text-muted-foreground">Причина:</span> {refund.reason}</div>
          )}
          {refund.credit_note_ref && (
            <div><span className="text-muted-foreground">Кредитно известие:</span> <span className="font-mono">{refund.credit_note_ref}</span></div>
          )}
          {!refund.reason && !refund.credit_note_ref && (
            <div className="text-muted-foreground italic">Няма анотации — редактирайте, за да добавите.</div>
          )}
        </div>
      )}

      {/* Credit-note breakdown (VAT 20% inclusive) — visible when not editing.
          Helper for the admin when issuing кредитно известие in Microinvest. */}
      {!editing && (
        <div className="mt-3 rounded-md border border-border/60 bg-muted/20 p-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Данни за кредитно известие (ДДС 20%)
            </span>
            <Button size="sm" variant="outline" className="h-6 text-[11px]" onClick={handleCopy}>
              {copied ? "Копирано ✓" : "Копирай"}
            </Button>
          </div>
          {breakdown.lines.length > 0 ? (
            <div className="mt-2 space-y-1 text-xs">
              {breakdown.lines.map((line) => (
                <div key={line.sku} className="grid grid-cols-[1fr_auto] gap-x-3">
                  <div className="min-w-0">
                    <div className="truncate">
                      {line.productName}
                      {line.type === "damaged" && (
                        <span className="ml-2 text-muted-foreground">[брак]</span>
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {line.quantity} бр. × {formatPrice(line.unitPriceCents)} ·{" "}
                      <span className="font-mono">{line.sku}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div>{formatPrice(line.lineGrossCents)}</div>
                    <div className="text-[10px] text-muted-foreground">
                      ДДС {formatPrice(line.lineVatCents)}
                    </div>
                  </div>
                </div>
              ))}
              <div className="mt-1 grid grid-cols-[1fr_auto] gap-x-3 border-t border-border/60 pt-1 text-[11px]">
                <span className="text-muted-foreground">Общо върнати:</span>
                <span className="text-right">
                  {formatPrice(breakdown.linesGrossCents)}{" "}
                  <span className="text-muted-foreground">
                    (нето {formatPrice(breakdown.linesNetCents)} + ДДС {formatPrice(breakdown.linesVatCents)})
                  </span>
                </span>
              </div>
            </div>
          ) : (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Няма физически върнати артикули (възстановяване без връщане на стока).
            </p>
          )}
          <div className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 border-t border-border/60 pt-1 text-xs">
            <span className="font-medium">Сума по възстановяване:</span>
            <span className="text-right font-medium">
              {formatPrice(breakdown.refundGrossCents)}{" "}
              <span className="text-[10px] font-normal text-muted-foreground">
                (нето {formatPrice(breakdown.refundNetCents)} + ДДС {formatPrice(breakdown.refundVatCents)})
              </span>
            </span>
          </div>
          {breakdown.lines.length > 0 && !breakdown.matchesLineSum && (
            <p className="mt-2 text-[11px] text-amber-800">
              Разлика с върнатите артикули: {formatPrice(breakdown.refundGrossCents - breakdown.linesGrossCents)}{" "}
              (възможна такса обработка, доставка или частична отстъпка).
            </p>
          )}
        </div>
      )}

      {editing && (
        <div className="mt-3 space-y-2">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Причина</label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Право на отказ / рекламация / ..." className="h-8" maxLength={1000} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Кредитно известие №</label>
            <Input value={creditNote} onChange={(e) => setCreditNote(e.target.value)} placeholder="Незадължително" className="h-8" maxLength={100} />
          </div>
          {error && <p className="text-xs text-red-700">{error}</p>}
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={saving} onClick={async () => {
              setSaving(true)
              setError("")
              try {
                await updateRefundAnnotation(refund.id, {
                  reason,
                  creditNoteRef: creditNote,
                })
                setEditing(false)
                await onSaved()
              } catch (err) {
                setError(err instanceof Error ? err.message : "Грешка при запис")
              } finally {
                setSaving(false)
              }
            }}>
              {saving ? "Записване..." : "Запиши"}
            </Button>
            <Button size="sm" variant="outline" disabled={saving} onClick={() => {
              setReason(refund.reason ?? "")
              setCreditNote(refund.credit_note_ref ?? "")
              setEditing(false)
              setError("")
            }}>
              Отказ
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
