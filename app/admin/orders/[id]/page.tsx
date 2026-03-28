"use client"

import { useEffect, useState, useRef, useCallback, use } from "react"
import Link from "next/link"
import { getOrder, updateOrderStatus, downloadInvoicePDF, issueInvoice, updateAdminNotes, generateShipment, getShipmentDefaults, type OrderDetail, type ShipmentFormData, type ShipmentDisplayInfo } from "@/app/actions/admin"
import { formatPrice } from "@/lib/products"
import { getDeliveryLabel } from "@/lib/delivery"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

// Office code → name lookup component (fetches office list once, looks up on code change)
function OfficeCodeInput({ shipmentForm, setShipmentForm, courier }: {
  shipmentForm: ShipmentFormData
  setShipmentForm: (fn: ShipmentFormData | ((prev: ShipmentFormData | null) => ShipmentFormData | null)) => void
  courier: string
}) {
  const officesRef = useRef<Array<Record<string, unknown>> | null>(null)
  const isSpeedy = courier === "speedy"

  const loadOffices = useCallback(async () => {
    if (officesRef.current) return officesRef.current
    try {
      const endpoint = isSpeedy ? "/api/speedy/offices" : "/api/econt/offices"
      const res = await fetch(endpoint)
      if (!res.ok) return []
      const data = await res.json()
      const offices = data.offices || data
      officesRef.current = offices
      return offices
    } catch {
      return []
    }
  }, [isSpeedy])

  const lookupOfficeName = useCallback(async (code: string) => {
    const offices = await loadOffices()
    const match = offices.find((o: Record<string, unknown>) =>
      isSpeedy ? String(o.id) === code : String(o.code) === code
    )
    setShipmentForm((prev) => prev ? { ...prev, recipientOfficeName: match?.name as string || "" } : prev)
  }, [loadOffices, isSpeedy, setShipmentForm])

  return (
    <div className="grid gap-2 sm:grid-cols-3">
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">Офис {isSpeedy ? "ID" : "код"}</label>
        <Input
          value={isSpeedy ? shipmentForm.recipientOfficeId : shipmentForm.recipientOfficeCode}
          onChange={(e) => {
            const val = e.target.value
            if (isSpeedy) {
              setShipmentForm({ ...shipmentForm, recipientOfficeId: val })
            } else {
              setShipmentForm({ ...shipmentForm, recipientOfficeCode: val })
            }
          }}
          onBlur={(e) => {
            const val = e.target.value.trim()
            if (val) lookupOfficeName(val)
          }}
        />
      </div>
      <div className="sm:col-span-2">
        <label className="mb-1 block text-xs text-muted-foreground">Име на офис</label>
        <Input value={shipmentForm.recipientOfficeName} disabled className="bg-secondary" />
      </div>
    </div>
  )
}

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
  const [pdfLoading, setPdfLoading] = useState(false)
  const [shipmentForm, setShipmentForm] = useState<ShipmentFormData | null>(null)
  const [shipmentDisplay, setShipmentDisplay] = useState<ShipmentDisplayInfo | null>(null)
  const [shipmentOpen, setShipmentOpen] = useState(false)
  const [shipmentLoading, setShipmentLoading] = useState(false)
  const [shipmentSuccess, setShipmentSuccess] = useState<string | null>(null)
  const [adminNotes, setAdminNotes] = useState("")
  const [notesSaving, setNotesSaving] = useState(false)
  const [notesSaved, setNotesSaved] = useState(false)

  useEffect(() => {
    getOrder(id)
      .then((o) => { setOrder(o); setAdminNotes(o.admin_notes || "") })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
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
            {order.invoice_company_name && <div><span className="text-muted-foreground">Фирма:</span> {order.invoice_company_name}</div>}
            {order.invoice_eik && <div><span className="text-muted-foreground">ЕИК:</span> {order.invoice_eik}</div>}
            {order.invoice_egn && <div><span className="text-muted-foreground">ЕГН:</span> {order.invoice_egn}</div>}
            {order.invoice_vat_number && <div><span className="text-muted-foreground">ДДС номер:</span> {order.invoice_vat_number}</div>}
            {order.invoice_mol && <div><span className="text-muted-foreground">МОЛ:</span> {order.invoice_mol}</div>}
            {order.invoice_address && <div><span className="text-muted-foreground">Адрес:</span> {order.invoice_address}</div>}
            <div className="flex gap-2 pt-2">
              {!order.invoice_number && (
                <Button
                  size="sm"
                  disabled={actionLoading}
                  onClick={async () => {
                    if (!confirm("Сигурни ли сте, че искате да издадете фактура? Това действие е необратимо.")) return
                    setActionError("")
                    setActionLoading(true)
                    try {
                      await issueInvoice(id)
                      const updated = await getOrder(id)
                      setOrder(updated)
                    } catch (err) {
                      setActionError(err instanceof Error ? err.message : "Грешка при издаване на фактура")
                    } finally {
                      setActionLoading(false)
                    }
                  }}
                >
                  Издай фактура
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={pdfLoading}
                onClick={async () => {
                  setPdfLoading(true)
                  try {
                    const { pdfBase64, filename } = await downloadInvoicePDF(id)
                    const blob = new Blob(
                      [Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0))],
                      { type: "application/pdf" }
                    )
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement("a")
                    a.href = url
                    a.download = filename
                    a.click()
                    URL.revokeObjectURL(url)
                  } catch {
                    setActionError("Грешка при генериране на PDF")
                  } finally {
                    setPdfLoading(false)
                  }
                }}
              >
                {pdfLoading ? "Генериране..." : order.invoice_number ? "Изтегли фактура" : "Изтегли проформа"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

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
                { label: "Изпратена", date: order.shipped_at, detail: order.tracking_number || undefined },
                { label: "Доставена", date: order.delivered_at },
                { label: "Отказана", date: order.cancelled_at, detail: order.cancellation_reason ? (order.cancellation_reason.length > 80 ? order.cancellation_reason.slice(0, 80) + "…" : order.cancellation_reason) : undefined },
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
          <textarea
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            rows={3}
            placeholder="Добави бележка..."
            value={adminNotes}
            onChange={(e) => { setAdminNotes(e.target.value); setNotesSaved(false) }}
          />
          <div className="mt-2 flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              disabled={notesSaving || adminNotes === (order.admin_notes || "")}
              onClick={async () => {
                setNotesSaving(true)
                try {
                  await updateAdminNotes(id, adminNotes)
                  const updated = await getOrder(id)
                  setOrder(updated)
                  setNotesSaved(true)
                } catch {
                  setActionError("Грешка при запазване на бележки")
                } finally {
                  setNotesSaving(false)
                }
              }}
            >
              {notesSaving ? "Запазване..." : "Запази"}
            </Button>
            {notesSaved && <span className="text-xs text-muted-foreground">Запазено</span>}
          </div>
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
                        <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setShipmentOpen(false)}>Затвори</button>
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
                          <OfficeCodeInput shipmentForm={shipmentForm} setShipmentForm={setShipmentForm} courier={shipmentDisplay?.courier || ""} />
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
                          disabled={shipmentLoading}
                          onClick={async () => {
                            setShipmentLoading(true)
                            setActionError("")
                            try {
                              const { trackingNumber: tn } = await generateShipment(id, shipmentForm)
                              setTrackingNumber(tn)
                              setShipmentOpen(false)
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
                        <Button variant="ghost" onClick={() => setShipmentOpen(false)}>Отказ</Button>
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
            <p className="text-sm text-muted-foreground">Няма налични действия за тази поръчка.</p>
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
        </CardContent>
      </Card>

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
