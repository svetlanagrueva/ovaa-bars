"use client"

import { useEffect, useState, use } from "react"
import Link from "next/link"
import { getOrder, updateOrderStatus, setInvoiceNumber, markInvoiceSent, addAdminNote, generateShipment, getShipmentDefaults, recordCodSettlement, markCodConfirmed, updateOrderContact, updateOrderQuantity, recordRefund, updateRefundAnnotation, recordStockMovement, recordComplaint, resolveComplaint, recordOrderOutcome, resendOrderConfirmationEmail, resendShippingEmail, resendDeliveryEmail, getOrderComplaints, createWithdrawal, getBatchAllocation, type OrderDetail, type OrderRefund, type Invoice, type Complaint, type ShipmentFormData, type ShipmentDisplayInfo, type Withdrawal, type WithdrawalRequestedVia, type BatchAllocationLine } from "@/app/actions/admin"
import { formatPrice } from "@/lib/products"
import { hasCustomerPaid, getFinancialStatus, FINANCIAL_STATUS_LABELS } from "@/lib/orders"
import { getDeliveryLabel } from "@/lib/delivery"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { SpeedyOfficePicker, type SpeedyOfficeOption } from "@/components/delivery/speedy-office-picker"
import { BatchAllocationCard } from "./batch-allocation-card"
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
  const [shipmentForm, setShipmentForm] = useState<ShipmentFormData | null>(null)
  // Batch traceability — populated when shipment dialog opens.
  // Read-only summary of what was saved via the "Партиди" card.
  const [savedAllocationLines, setSavedAllocationLines] = useState<BatchAllocationLine[]>([])
  const [shipmentDisplay, setShipmentDisplay] = useState<ShipmentDisplayInfo | null>(null)
  const [shipmentOpen, setShipmentOpen] = useState(false)
  const [shipmentLoading, setShipmentLoading] = useState(false)
  const [shipmentSuccess, setShipmentSuccess] = useState<string | null>(null)
  const [selectedOfficeNumericId, setSelectedOfficeNumericId] = useState<number | null>(null)
  // Sender / recipient sections start collapsed to a summary line — admin
  // sees pre-filled data without a dropdown overwhelming the view, expands
  // only when they actually need to change something. Mirrors Shopify's
  // "Edit" toggle on Ship-from / Ship-to in the fulfillment panel.
  const [senderEditing, setSenderEditing] = useState(false)
  const [recipientEditing, setRecipientEditing] = useState(false)
  const [officePickerError, setOfficePickerError] = useState(false)
  const [newNote, setNewNote] = useState("")
  const [notesSaving, setNotesSaving] = useState(false)
  const [settlementPppRef, setSettlementPppRef] = useState("")
  const [settlementRef, setSettlementRef] = useState("")
  const [settlementAmountInput, setSettlementAmountInput] = useState("")
  const [settlementPaidAt, setSettlementPaidAt] = useState(() => new Date().toISOString().slice(0, 10))
  const [settlementLoading, setSettlementLoading] = useState(false)
  const [settlementSaved, setSettlementSaved] = useState(false)
  const [codConfirmLoading, setCodConfirmLoading] = useState(false)
  // Each form / dialog / inline panel that submits OUTSIDE the Действия
  // card needs its own local error state — actionError renders only inside
  // Действия, so a thrown server-action error from elsewhere on the page
  // would silently disappear. Pattern documented in
  // memory/feedback_form_error_handling.md. New admin forms should follow
  // the same pattern: local <flow>Error + inline render next to Save.
  const [codConfirmError, setCodConfirmError] = useState("")
  const [qtyError, setQtyError] = useState<Record<string, string>>({})
  const [invoiceError, setInvoiceError] = useState("")
  const [noteError, setNoteError] = useState("")
  const [refundError, setRefundError] = useState("")
  const [complaintError, setComplaintError] = useState("")
  const [outcomeError, setOutcomeError] = useState("")

  // Order edit — contact info state
  const [contactEditing, setContactEditing] = useState(false)
  const [contactFirstName, setContactFirstName] = useState("")
  const [contactLastName, setContactLastName] = useState("")
  const [contactPhone, setContactPhone] = useState("")
  const [contactEmail, setContactEmail] = useState("")
  const [contactAddress, setContactAddress] = useState("")
  const [contactPostalCode, setContactPostalCode] = useState("")
  const [contactCity, setContactCity] = useState("")
  const [contactNotes, setContactNotes] = useState("")
  const [contactSaving, setContactSaving] = useState(false)
  // Errors from updateOrderContact need to surface inside the contact card
  // itself — actionError is shared with the Действия card much further down,
  // so a validation rejection scrolled out of view and the admin saw nothing.
  const [contactError, setContactError] = useState("")

  // Order edit — COD quantity state (per-SKU)
  const [qtyEditing, setQtyEditing] = useState<Record<string, number | null>>({})
  const [qtySaving, setQtySaving] = useState<Record<string, boolean>>({})

  // Exception-flow dialogs. Refund / complaint / outcome are rare actions
  // (<5% of orders touch any of them), so they live behind the "Още действия"
  // dropdown rather than the main panel. Same Shopify pattern: keep the
  // routine flow uncluttered, exception flows one click away.
  const [refundDialogOpen, setRefundDialogOpen] = useState(false)
  const [complaintDialogOpen, setComplaintDialogOpen] = useState(false)
  const [outcomeDialogOpen, setOutcomeDialogOpen] = useState(false)
  const [withdrawalDialogOpen, setWithdrawalDialogOpen] = useState(false)
  const [withdrawalVia, setWithdrawalVia] = useState<WithdrawalRequestedVia>("email")
  const [withdrawalEmail, setWithdrawalEmail] = useState("")
  const [withdrawalText, setWithdrawalText] = useState("")
  const [withdrawalLoading, setWithdrawalLoading] = useState(false)
  const [withdrawalError, setWithdrawalError] = useState("")
  const [withdrawalResult, setWithdrawalResult] = useState<{ id: string; ref: string } | null>(null)

  // Email resend state — per-email-type loading flag and a transient
  // "sent just now" marker so the admin gets immediate feedback (the
  // audit event timestamps aren't re-read into state on every resend).
  type EmailKind = "order_confirmation" | "shipping" | "delivery"
  const [emailResendLoading, setEmailResendLoading] = useState<Record<EmailKind, boolean>>({
    order_confirmation: false,
    shipping: false,
    delivery: false,
  })
  const [emailResendJustSent, setEmailResendJustSent] = useState<Record<EmailKind, boolean>>({
    order_confirmation: false,
    shipping: false,
    delivery: false,
  })
  const [emailResendError, setEmailResendError] = useState("")

  // Refund state — Step 1 form fields
  const [refundAmount, setRefundAmount] = useState("")
  const [refundReason, setRefundReason] = useState("")
  const [refundMethod, setRefundMethod] = useState<"stripe" | "bank_transfer">("stripe")
  const [refundDate, setRefundDate] = useState("")
  const [refundStripeId, setRefundStripeId] = useState("")
  const [refundBankTransferRef, setRefundBankTransferRef] = useState("")
  const [refundAffectsInvoicedSupply, setRefundAffectsInvoicedSupply] = useState(true)
  const [refundSkipReason, setRefundSkipReason] = useState("")
  const [refundLoading, setRefundLoading] = useState(false)
  // client_idempotency_key for the refund insert. Regenerated after the
  // whole "refund → stock outcome" flow completes (not just after the refund
  // step), so a retry during Step 2 still resolves to the same refund row.
  const [refundClientKey, setRefundClientKey] = useState<string>(() => crypto.randomUUID())
  const [refundLinkedWithdrawalId, setRefundLinkedWithdrawalId] = useState<string>("")
  // Refund mode: "items" — admin picks specific order_items to allocate;
  // refund total computed from items + optional additional. "amount" — admin
  // types a single refund total (no per-line allocation, used for shipping
  // disputes / goodwill). Webhook-created refunds are always "amount" with
  // no items input. Default to items since that's the legally-cleanest case.
  const [refundMode, setRefundMode] = useState<"items" | "amount">("items")
  const [itemSelections, setItemSelections] = useState<Record<number, { quantity: string; amountOverride: string }>>({})
  const [refundAdditionalAmount, setRefundAdditionalAmount] = useState<string>("")

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

  // Single resend helper, called from each dropdown item. Confirms intent,
  // calls the right server action, sets a transient "just sent" marker the
  // top-of-page banner reads to surface success / error.
  async function handleEmailResend(kind: EmailKind) {
    const labels: Record<EmailKind, string> = {
      order_confirmation: "потвърждение за поръчка",
      shipping: "известие за изпратена пратка",
      delivery: "потвърждение за доставка",
    }
    if (!window.confirm(`Изпрати ${labels[kind]} отново до клиента?`)) return
    setEmailResendError("")
    setEmailResendLoading((s) => ({ ...s, [kind]: true }))
    setEmailResendJustSent((s) => ({ ...s, [kind]: false }))
    try {
      if (kind === "order_confirmation") await resendOrderConfirmationEmail(id)
      else if (kind === "shipping") await resendShippingEmail(id)
      else await resendDeliveryEmail(id)
      setEmailResendJustSent((s) => ({ ...s, [kind]: true }))
      // Auto-clear the success banner after a few seconds so it doesn't
      // linger on the page indefinitely.
      setTimeout(() => setEmailResendJustSent((s) => ({ ...s, [kind]: false })), 4000)
    } catch (err) {
      setEmailResendError(err instanceof Error ? err.message : "Грешка при повторно изпращане")
    } finally {
      setEmailResendLoading((s) => ({ ...s, [kind]: false }))
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
        {/* Exception flows: refund / complaint / outcome live behind this
            dropdown so the main panel stays focused on routine actions
            (status, settlement, contact edits, invoice). Mirrors Shopify's
            "More actions" pattern. Items are gated by order state — only
            show what's actionable on the current order. */}
        {(() => {
          // Refund follows the customer-payment moment, not seller-settlement.
          // For COD this means refundable as soon as delivered — courier
          // remittance to us is independent. See lib/orders.ts.
          const canRefund = hasCustomerPaid(order)
          const canOutcome = order.status === "shipped" || order.status === "delivered"
          // Email gating mirrors the underlying server actions' state checks.
          const canEmailConfirm = order.status !== "pending" && order.status !== "cancelled" && order.status !== "expired"
          const canEmailShipping = !!order.tracking_number && order.tracking_number !== "__generating__"
          const canEmailDelivery = order.status === "delivered"
          const hasAnyEmail = canEmailConfirm || canEmailShipping || canEmailDelivery
          // Single-button fallback only when literally only complaint is
          // actionable (terminal-state orders, fresh pending orders).
          if (!canRefund && !canOutcome && !hasAnyEmail) {
            return (
              <Button
                variant="outline"
                size="sm"
                className="ml-auto h-8 text-xs"
                onClick={() => setComplaintDialogOpen(true)}
              >
                Регистрирай рекламация
              </Button>
            )
          }
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="ml-auto h-8 text-xs">
                  Още действия ▾
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                {canRefund && (
                  <DropdownMenuItem onClick={() => setRefundDialogOpen(true)}>
                    Запиши възстановяване
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => setComplaintDialogOpen(true)}>
                  Регистрирай рекламация
                  {complaints.filter((c) => c.status === "open").length > 0 && (
                    <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-900">
                      {complaints.filter((c) => c.status === "open").length}
                    </span>
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setWithdrawalEmail(order?.email ?? "")
                    setWithdrawalText("")
                    setWithdrawalVia("email")
                    setWithdrawalError("")
                    setWithdrawalDialogOpen(true)
                  }}
                >
                  Регистрирай заявка за връщане
                  {(order?.withdrawals?.filter((w) => w.status === "requested" || w.status === "approved" || w.status === "goods_received").length ?? 0) > 0 && (
                    <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-900">
                      {order?.withdrawals?.filter((w) => w.status === "requested" || w.status === "approved" || w.status === "goods_received").length}
                    </span>
                  )}
                </DropdownMenuItem>
                {canOutcome && (
                  <DropdownMenuItem onClick={() => setOutcomeDialogOpen(true)}>
                    Следдоставно събитие
                  </DropdownMenuItem>
                )}
                {hasAnyEmail && (
                  <>
                    <DropdownMenuSeparator />
                    {canEmailConfirm && (
                      <DropdownMenuItem
                        disabled={emailResendLoading.order_confirmation}
                        onClick={() => handleEmailResend("order_confirmation")}
                      >
                        Изпрати потвърждение за поръчка
                      </DropdownMenuItem>
                    )}
                    {canEmailShipping && (
                      <DropdownMenuItem
                        disabled={emailResendLoading.shipping}
                        onClick={() => handleEmailResend("shipping")}
                      >
                        Изпрати известие за изпращане
                      </DropdownMenuItem>
                    )}
                    {canEmailDelivery && (
                      <DropdownMenuItem
                        disabled={emailResendLoading.delivery}
                        onClick={() => handleEmailResend("delivery")}
                      >
                        Изпрати потвърждение за доставка
                      </DropdownMenuItem>
                    )}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )
        })()}
      </div>

      {/* Transient feedback for email resends. Success banner auto-clears
          after ~4s via the timeout in handleEmailResend; error banner stays
          until the next resend attempt clears it. Both render only when
          relevant — no permanent screen real estate. */}
      {(emailResendJustSent.order_confirmation || emailResendJustSent.shipping || emailResendJustSent.delivery) && (
        <div className="mb-4 rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900">
          ✓ Имейлът е изпратен повторно до клиента.
        </div>
      )}
      {emailResendError && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
          <span>{emailResendError}</span>
          <button
            type="button"
            onClick={() => setEmailResendError("")}
            className="shrink-0 text-xs underline hover:no-underline"
          >
            Затвори
          </button>
        </div>
      )}

      {/* COD phone confirmation banner. Three states for confirmed COD orders:
          1. Unconfirmed → amber "please call" + tel link + "Mark as confirmed" button
          2. Confirmed → green banner with timestamp (admin can still see the record)
          3. Shipped/delivered → banner hidden (the call is no longer actionable)
          This turns the old policy reminder into an operational gate: pairing with
          the soft-block warning on generate-shipment below.  */}
      {order.payment_method === "cod" && order.status === "confirmed" && !order.cod_confirmed_at && (
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
          {codConfirmError && (
            <p className="mt-2 text-sm text-red-700">{codConfirmError}</p>
          )}
          <div className="mt-3">
            <Button
              size="sm"
              variant="outline"
              disabled={codConfirmLoading}
              onClick={async () => {
                setCodConfirmLoading(true)
                setCodConfirmError("")
                try {
                  await markCodConfirmed(id)
                  const updated = await getOrder(id)
                  setOrder(updated)
                } catch (err) {
                  setCodConfirmError(err instanceof Error ? err.message : "Грешка при потвърждаване")
                } finally {
                  setCodConfirmLoading(false)
                }
              }}
            >
              {codConfirmLoading ? "Записване..." : "Маркирай обаждането като потвърдено"}
            </Button>
          </div>
        </div>
      )}
      {order.payment_method === "cod" && order.status === "confirmed" && order.cod_confirmed_at && (
        <div className="mb-6 rounded-lg border border-green-300 bg-green-50 p-4 text-sm text-green-900">
          ✓ Обаждането е потвърдено на{" "}
          {new Date(order.cod_confirmed_at).toLocaleDateString("bg-BG", {
            day: "2-digit", month: "2-digit", year: "numeric",
            hour: "2-digit", minute: "2-digit",
          })}
          {order.cod_confirmed_by && order.cod_confirmed_by !== "admin" && (
            <span className="ml-1 text-green-900/70">от {order.cod_confirmed_by}</span>
          )}
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {/* Customer info — read-only by default, inline edit for status=confirmed.
            Edit produces a single UPDATE on orders; the AFTER UPDATE trigger emits
            a contact_info_changed event with per-field {old, new} pairs. Fields
            not editable here: email (stays out of the edit surface because of the
            lowercase CHECK + it's also the unsubscribe key). Admin who truly needs
            to correct an email does it via direct DB or support. */}
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">Клиент</CardTitle>
            {order.status === "confirmed" && !contactEditing && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[11px]"
                onClick={() => {
                  setContactFirstName(order.first_name)
                  setContactLastName(order.last_name)
                  setContactPhone(order.phone)
                  setContactEmail(order.email)
                  setContactAddress(order.address ?? "")
                  setContactPostalCode(order.postal_code ?? "")
                  setContactCity(order.city)
                  setContactNotes(order.notes ?? "")
                  setActionError("")
                  setContactError("")
                  setContactEditing(true)
                }}
              >
                Редактирай
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {!contactEditing && (
              <>
                <div><span className="text-muted-foreground">Име:</span> {order.first_name} {order.last_name}</div>
                <div><span className="text-muted-foreground">Имейл:</span> {order.email}</div>
                <div><span className="text-muted-foreground">Телефон:</span> {order.phone}</div>
                <div><span className="text-muted-foreground">Град:</span> {order.city}</div>
                {order.address && <div><span className="text-muted-foreground">Адрес:</span> {order.address}</div>}
                {order.postal_code && <div><span className="text-muted-foreground">Пощенски код:</span> {order.postal_code}</div>}
                {order.notes && <div><span className="text-muted-foreground">Бележки:</span> {order.notes}</div>}
              </>
            )}
            {contactEditing && (
              <div className="space-y-2">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">Име</label>
                    <Input value={contactFirstName} onChange={(e) => setContactFirstName(e.target.value)} className="h-8" maxLength={200} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">Фамилия</label>
                    <Input value={contactLastName} onChange={(e) => setContactLastName(e.target.value)} className="h-8" maxLength={200} />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Имейл</label>
                  <Input
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    className="h-8"
                    maxLength={500}
                  />
                  {contactEmail.trim().toLowerCase() !== order.email && (
                    <p className="mt-1 text-[11px] text-amber-700">
                      Промяната на имейла прекъсва връзката с предишния отписващ адрес. Новият имейл наследява статуса на абонамент за маркетинг от своята основна стойност в email_unsubscribes.
                    </p>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Телефон</label>
                  <Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} className="h-8" maxLength={40} />
                </div>
                <div className="grid gap-2 sm:grid-cols-[1fr,auto]">
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">Град</label>
                    <Input value={contactCity} onChange={(e) => setContactCity(e.target.value)} className="h-8" maxLength={200} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">Пощенски код</label>
                    <Input value={contactPostalCode} onChange={(e) => setContactPostalCode(e.target.value)} className="h-8 w-28" maxLength={20} />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Адрес</label>
                  <Input value={contactAddress} onChange={(e) => setContactAddress(e.target.value)} className="h-8" maxLength={500} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Бележки от клиента</label>
                  <textarea
                    value={contactNotes}
                    onChange={(e) => setContactNotes(e.target.value)}
                    rows={2}
                    maxLength={2000}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  />
                </div>
                {contactError && (
                  <p className="text-sm text-red-600">{contactError}</p>
                )}
                <div className="flex items-center gap-2 pt-1">
                  <Button
                    size="sm"
                    disabled={contactSaving}
                    onClick={async () => {
                      setContactSaving(true)
                      setContactError("")
                      // Only send fields the admin actually changed. Pre-filled
                      // values that match the order's current state pass
                      // through as undefined and skip server-side validation,
                      // so legacy data with empty city / etc. doesn't trip a
                      // non-empty rule on a no-op edit.
                      const payload: Parameters<typeof updateOrderContact>[1] = {}
                      if (contactFirstName !== order.first_name) payload.firstName = contactFirstName
                      if (contactLastName !== order.last_name) payload.lastName = contactLastName
                      if (contactPhone !== order.phone) payload.phone = contactPhone
                      if (contactEmail.trim().toLowerCase() !== order.email) payload.email = contactEmail
                      if (contactAddress !== (order.address ?? "")) payload.address = contactAddress
                      if (contactPostalCode !== (order.postal_code ?? "")) payload.postalCode = contactPostalCode
                      if (contactCity !== order.city) payload.city = contactCity
                      if (contactNotes !== (order.notes ?? "")) payload.notes = contactNotes
                      if (Object.keys(payload).length === 0) {
                        setContactError("Няма промени за записване")
                        setContactSaving(false)
                        return
                      }
                      try {
                        await updateOrderContact(id, payload)
                        const refreshed = await getOrder(id)
                        setOrder(refreshed)
                        setContactEditing(false)
                      } catch (err) {
                        setContactError(err instanceof Error ? err.message : "Грешка при записване")
                      } finally {
                        setContactSaving(false)
                      }
                    }}
                  >
                    {contactSaving ? "Записване..." : "Запази"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={contactSaving}
                    onClick={() => {
                      setContactEditing(false)
                      setContactError("")
                    }}
                  >
                    Отказ
                  </Button>
                </div>
              </div>
            )}
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

        {/* Items — per-line quantity edit for COD + confirmed + no tracking.
            Atomic via edit_order_quantity RPC: reserves/restores inventory,
            updates order_items, recomputes total_amount in one transaction. */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Продукти</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(() => {
                const canEditQty =
                  order.payment_method === "cod" &&
                  order.status === "confirmed" &&
                  !order.tracking_number
                return order.items.map((item, i) => {
                  const editing = qtyEditing[item.sku] ?? null
                  const saving = qtySaving[item.sku] ?? false
                  const lineError = qtyError[item.sku] ?? ""
                  return (
                    <div key={i} className="space-y-1">
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <div className="min-w-0 flex-1 truncate">
                          {item.productName}
                          {!canEditQty || editing === null ? (
                            <span> x {item.quantity}</span>
                          ) : null}
                        </div>
                        {canEditQty && editing === null && (
                          <>
                            <span className="font-medium">{formatPrice(item.priceInCents * item.quantity)}</span>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[11px]"
                              onClick={() => {
                                setQtyEditing({ ...qtyEditing, [item.sku]: item.quantity })
                                setQtyError({ ...qtyError, [item.sku]: "" })
                              }}
                            >
                              Редактирай
                            </Button>
                          </>
                        )}
                        {canEditQty && editing !== null && (
                          <div className="flex items-center gap-1">
                            <Input
                              type="number"
                              min="1"
                              max="100"
                              step="1"
                              value={editing}
                              onChange={(e) => {
                                const n = parseInt(e.target.value, 10)
                                setQtyEditing({
                                  ...qtyEditing,
                                  [item.sku]: Number.isInteger(n) && n >= 1 ? n : editing,
                                })
                              }}
                              className="h-7 w-16"
                              disabled={saving}
                            />
                            <Button
                              size="sm"
                              className="h-7 text-[11px]"
                              disabled={saving || editing === item.quantity}
                              onClick={async () => {
                                if (editing === null) return
                                setQtySaving({ ...qtySaving, [item.sku]: true })
                                setQtyError({ ...qtyError, [item.sku]: "" })
                                try {
                                  await updateOrderQuantity(id, item.sku, editing)
                                  const refreshed = await getOrder(id)
                                  setOrder(refreshed)
                                  setQtyEditing({ ...qtyEditing, [item.sku]: null })
                                } catch (err) {
                                  setQtyError({
                                    ...qtyError,
                                    [item.sku]: err instanceof Error ? err.message : "Грешка при редакция",
                                  })
                                } finally {
                                  setQtySaving({ ...qtySaving, [item.sku]: false })
                                }
                              }}
                            >
                              {saving ? "..." : "Запиши"}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[11px]"
                              disabled={saving}
                              onClick={() => {
                                setQtyEditing({ ...qtyEditing, [item.sku]: null })
                                setQtyError({ ...qtyError, [item.sku]: "" })
                              }}
                            >
                              Отказ
                            </Button>
                          </div>
                        )}
                        {!canEditQty && (
                          <span className="font-medium">{formatPrice(item.priceInCents * item.quantity)}</span>
                        )}
                      </div>
                      {lineError && (
                        <p className="text-xs text-red-600">{lineError}</p>
                      )}
                    </div>
                  )
                })
              })()}
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

        {/* Документи (фактури + кредитни известия) */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Документи</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {order.invoices.length === 0 ? (
              <div className="text-muted-foreground">
                Клиентът не е поискал фактура за тази поръчка, така че не се
                изисква и кредитно известие при възстановяване.
              </div>
            ) : (
              order.invoices.map((inv) => (
                <InvoiceRow
                  key={inv.id}
                  invoice={inv}
                  order={order}
                  onChanged={async () => {
                    const updated = await getOrder(id)
                    setOrder(updated)
                  }}
                />
              ))
            )}
            {invoiceError && (
              <p className="mt-2 text-sm text-red-600">{invoiceError}</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* COD Payment status (when already settled) */}
      {order.payment_method === "cod" && order.seller_settled_at && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">Плащане (наложен платеж)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-green-900">
              Плащането е получено на {new Date(order.seller_settled_at).toLocaleDateString("bg-BG", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
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
      {order.payment_method === "card" && order.seller_settled_at && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">Плащане (карта)</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <div className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-green-900">
              Платено на {new Date(order.seller_settled_at).toLocaleDateString("bg-BG", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
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
              // Use the shared financial-status helper so the wording here
              // never drifts from the orders list. The summary card only
              // renders when refunds.length > 0, so getFinancialStatus
              // returns either "refunded" or "partially_refunded".
              const totalRefunded = order.refunds.reduce((sum, r) => sum + r.amount_cents, 0)
              const status = getFinancialStatus({
                ...order,
                refunds_total: totalRefunded,
              })
              return (
                <div className="rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-blue-900">
                  {FINANCIAL_STATUS_LABELS[status]}:{" "}
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
                creditNoteInvoice={order.invoices.find((inv) => inv.type === "credit_note" && inv.refund_id === r.id)}
                orderItems={order.items}
                onSaved={async () => {
                  const refreshed = await getOrder(id)
                  setOrder(refreshed)
                }}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Заявки — withdrawals (право на отказ) for this order. Complaints
          stay in their dedicated dialog (above) since they're already part of
          the existing flow. Each withdrawal links to /admin/returns/[id]
          where the full state machine + actions live. */}
      {(order.withdrawals.length > 0 || complaints.length > 0) && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">Свързани заявки</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {(() => {
              const wdStatusLabel: Record<Withdrawal["status"], string> = {
                requested: "Подадена",
                approved: "Одобрена",
                goods_received: "Получени стоки",
                rejected: "Отказана",
                completed: "Завършена",
              }
              const wdStatusColor: Record<Withdrawal["status"], string> = {
                requested: "bg-amber-100 text-amber-800",
                approved: "bg-blue-100 text-blue-800",
                goods_received: "bg-violet-100 text-violet-800",
                rejected: "bg-red-100 text-red-800",
                completed: "bg-green-100 text-green-800",
              }
              const cmpStatusLabel: Record<string, string> = {
                open: "Отворена",
                resolved: "Приключена",
                rejected: "Отхвърлена",
              }
              const cmpStatusColor: Record<string, string> = {
                open: "bg-amber-100 text-amber-800",
                resolved: "bg-green-100 text-green-800",
                rejected: "bg-red-100 text-red-800",
              }
              const cmpDemandLabel: Record<string, string> = {
                refund: "Възстановяване",
                replacement: "Замяна",
                repair: "Ремонт",
                discount: "Отстъпка",
              }

              // Unify into a single list sorted by created_at desc so the
              // most recent activity surfaces first regardless of type.
              type Row =
                | { type: "withdrawal"; created_at: string; data: Withdrawal }
                | { type: "complaint"; created_at: string; data: Complaint }
              const rows: Row[] = [
                ...order.withdrawals.map((w) => ({ type: "withdrawal" as const, created_at: w.created_at, data: w })),
                ...complaints.map((c) => ({ type: "complaint" as const, created_at: c.reported_at, data: c })),
              ].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))

              return rows.map((row) => {
                if (row.type === "withdrawal") {
                  const w = row.data
                  return (
                    <div key={`w-${w.id}`} className="rounded-md border border-border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-blue-800">
                              Право на отказ
                            </span>
                            <span className="font-mono text-sm font-medium">{w.withdrawal_ref}</span>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${wdStatusColor[w.status]}`}>
                              {wdStatusLabel[w.status]}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            Канал: {w.requested_via} · Имейл: {w.customer_email}
                          </div>
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            Подадена на {new Date(w.created_at).toLocaleDateString("bg-BG", {
                              day: "2-digit", month: "2-digit", year: "numeric",
                            })}
                            {w.refund_id && (
                              <> · Свързана с възстановяване <span className="font-mono">{w.refund_id.slice(0, 8)}</span></>
                            )}
                          </div>
                        </div>
                        <Link
                          href={`/admin/returns/${w.id}`}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          Отвори ↗
                        </Link>
                      </div>
                    </div>
                  )
                }
                const c = row.data
                return (
                  <div key={`c-${c.id}`} className="rounded-md border border-border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-purple-800">
                            Рекламация
                          </span>
                          <span className="font-mono text-sm font-medium">{c.complaint_ref}</span>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${cmpStatusColor[c.status] ?? "bg-muted"}`}>
                            {cmpStatusLabel[c.status] ?? c.status}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {c.defect_description.length > 100 ? c.defect_description.slice(0, 100) + "…" : c.defect_description}
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          Претенция: {cmpDemandLabel[c.customer_demand] ?? c.customer_demand}
                          {" · "}
                          Подадена на {new Date(c.reported_at).toLocaleDateString("bg-BG", {
                            day: "2-digit", month: "2-digit", year: "numeric",
                          })}
                          {c.resolved_at && (
                            <> · Приключена на {new Date(c.resolved_at).toLocaleDateString("bg-BG", {
                              day: "2-digit", month: "2-digit", year: "numeric",
                            })}</>
                          )}
                        </div>
                        {c.resolution && (
                          <div className="mt-1 text-xs">
                            <span className="text-muted-foreground">Решение:</span> {c.resolution}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setComplaintDialogOpen(true)}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        Отвори ↗
                      </button>
                    </div>
                  </div>
                )
              })
            })()}
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
              // Map an order_audit_events row to a Bulgarian label + detail
              // string for the timeline. Domain events that aren't already
              // captured by column-derived rows (status, seller_settled_at, etc.) live
              // here. The server filters event_type to TIMELINE_EVENT_TYPES;
              // any new outcome / audit type added there should also get a
              // case here so it renders something readable.
              type AuditEvt = OrderDetail["auditEvents"][number]
              const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s)
              const renderAuditEvent = (e: AuditEvt): { label: string; detail?: string } => {
                const p = e.payload || {}
                switch (e.event_type) {
                  case "order_items_changed": {
                    const productName = (p.product_name as string) || (p.sku as string) || "артикул"
                    const oldQ = p.old_quantity as number | undefined
                    const newQ = p.new_quantity as number | undefined
                    const detail = oldQ != null && newQ != null
                      ? `${productName}: ${oldQ} → ${newQ}`
                      : productName
                    return { label: "Редакция на количество", detail }
                  }
                  case "contact_info_changed": {
                    const fields = Object.keys(p).filter((k) => p[k] && typeof p[k] === "object")
                    const labels: Record<string, string> = {
                      first_name: "име",
                      last_name: "фамилия",
                      phone: "телефон",
                      email: "имейл",
                      address: "адрес",
                      postal_code: "пощ. код",
                      city: "град",
                      notes: "бележки",
                    }
                    const list = fields.map((k) => labels[k] ?? k).join(", ")
                    return { label: "Редакция на данни на клиента", detail: list || undefined }
                  }
                  case "email_resent": {
                    const t = p.email_type as string | undefined
                    const labels: Record<string, string> = {
                      order_confirmation: "потвърждение за поръчка",
                      shipping: "известие за изпращане",
                      delivery: "потвърждение за доставка",
                    }
                    return { label: "Имейл изпратен повторно", detail: t ? labels[t] ?? t : undefined }
                  }
                  case "status_force_override": {
                    const from = p.from as string | undefined
                    const to = p.to as string | undefined
                    const reason = p.reason as string | undefined
                    return {
                      label: "Принудителна промяна на статус",
                      detail: [from && to ? `${from} → ${to}` : null, reason ? truncate(reason, 80) : null].filter(Boolean).join(" — ") || undefined,
                    }
                  }
                  case "data_repair": {
                    return { label: "Корекция на данни", detail: p.reason ? truncate(p.reason as string, 80) : undefined }
                  }
                  case "delivery_refused":
                    return { label: "Отказана доставка", detail: p.note ? truncate(p.note as string, 80) : undefined }
                  case "package_lost":
                    return { label: "Изгубена пратка", detail: (p.courier_ref as string) || undefined }
                  case "returned":
                    return { label: "Върнат продукт", detail: (p.return_ref as string) || undefined }
                  case "recalled":
                    return { label: "Изтеглен продукт", detail: (p.recall_ref as string) || undefined }
                  case "partial_return":
                    return { label: "Частично връщане" }
                  case "refund_annotation_edited":
                    return { label: "Промяна на бележка по възстановяване" }
                  case "external_refund":
                    return { label: "Външно възстановяване" }
                  case "payment_failed":
                    return { label: "Неуспешно плащане", detail: (p.reason as string) || undefined }
                  case "dispute_opened":
                    return { label: "Отворен спор" }
                  case "dispute_closed":
                    return { label: "Приключен спор", detail: (p.status as string) || undefined }
                  case "dispute_funds_reinstated":
                    return { label: "Върнати средства от спор" }
                  default:
                    return { label: e.event_type }
                }
              }

              // For orders created before timestamps were added, fall back to created_at
              const confirmedFallback = !order.confirmed_at && order.status !== "pending" ? order.created_at : null
              const events = [
                { label: "Поръчка създадена", date: order.created_at },
                { label: "Потвърдена", date: order.confirmed_at || confirmedFallback },
                ...order.invoices
                  .filter((inv) => inv.type === "invoice" && inv.invoice_number && inv.invoice_date)
                  .map((inv) => ({ label: "Фактура издадена", date: inv.invoice_date, detail: `#${inv.invoice_number}` })),
                ...order.invoices
                  .filter((inv) => inv.type === "invoice" && inv.sent_at)
                  .map((inv) => ({ label: "Фактура изпратена", date: inv.sent_at })),
                ...order.invoices
                  .filter((inv) => inv.type === "credit_note" && inv.invoice_number && inv.invoice_date)
                  .map((inv) => ({ label: "Кредитно известие издадено", date: inv.invoice_date, detail: `#${inv.invoice_number}` })),
                ...order.invoices
                  .filter((inv) => inv.type === "credit_note" && inv.sent_at)
                  .map((inv) => ({ label: "Кредитно известие изпратено", date: inv.sent_at })),
                { label: "Изпратена", date: order.shipped_at, detail: order.tracking_number || undefined },
                { label: "Доставена", date: order.delivered_at },
                { label: "Плащане получено", date: order.seller_settled_at, detail: order.settlement_ref ? `Ref: ${order.settlement_ref}` : undefined },
                ...order.refunds.map((r) => ({
                  label: "Възстановяване",
                  date: r.refunded_at,
                  detail: `${formatPrice(r.amount_cents)} (${r.method === "stripe" ? "Stripe" : "Банков превод"})`,
                })),
                ...complaints.filter(c => c.reported_at).map(c => ({ label: "Рекламация", date: c.reported_at, detail: `#${c.complaint_ref}` })),
                { label: "Отказана", date: order.cancelled_at, detail: order.cancellation_reason ? (order.cancellation_reason.length > 80 ? order.cancellation_reason.slice(0, 80) + "…" : order.cancellation_reason) : undefined },
                // Domain events from order_audit_events. Admin notes are
                // intentionally NOT in this array — they live in the
                // dedicated "Вътрешни бележки" card to avoid duplication
                // (see admin-panel.md § Order Detail timeline).
                ...order.auditEvents.map((e) => {
                  const { label, detail } = renderAuditEvent(e)
                  return { label, date: e.created_at, detail }
                }),
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
                setNoteError("")
                try {
                  await addAdminNote(id, newNote)
                  const updated = await getOrder(id)
                  setOrder(updated)
                  setNewNote("")
                } catch (err) {
                  setNoteError(err instanceof Error ? err.message : "Грешка при добавяне на бележка")
                } finally {
                  setNotesSaving(false)
                }
              }}
            >
              {notesSaving ? "..." : "Добави"}
            </Button>
          </div>
          {noteError && (
            <p className="mt-2 text-sm text-red-600">{noteError}</p>
          )}
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

      {/* Batch allocation — visible only while the order is editable */}
      {order.status === "confirmed" && !order.tracking_number && (
        <div data-batch-allocation-card>
          <BatchAllocationCard orderId={id} />
        </div>
      )}

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
                    <div className="space-y-2">
                      {/* Soft-block warning: COD orders should have the phone
                          confirmation recorded before shipping. We don't block
                          the button — admin can proceed — but the warning is
                          visible and the action requires a second click, which
                          is the "soft block" (prompt-based) per the 2026-04-24
                          ops plan. Promote to hard block only if abuse appears. */}
                      {order.payment_method === "cod" && !order.cod_confirmed_at && (
                        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                          ⚠ Обаждането за потвърждение на COD поръчката не е маркирано. Препоръчително е да потвърдите обаждането преди да генерирате товарителница (намалява отказите на доставка).
                        </div>
                      )}
                      <Button
                        variant="outline"
                        onClick={async () => {
                          // Soft block: if COD is unconfirmed, require explicit
                          // acknowledgement via a native confirm() dialog. The
                          // wording makes the deliberate-override character
                          // obvious — admin has to actively say "да, въпреки това".
                          if (order.payment_method === "cod" && !order.cod_confirmed_at) {
                            const proceed = window.confirm(
                              "Обаждането за потвърждение не е маркирано. Сигурни ли сте, че искате да генерирате товарителницата без потвърдено обаждане?",
                            )
                            if (!proceed) return
                          }
                          setActionError("")
                          try {
                            const [{ form, display }, lines] = await Promise.all([
                              getShipmentDefaults(id),
                              getBatchAllocation(id),
                            ])
                            setShipmentForm(form)
                            setShipmentDisplay(display)
                            setSavedAllocationLines(lines)
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
                    </div>
                  ) : shipmentForm && (
                    <div className="rounded-lg border border-border p-4 space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold">
                          Товарителница — {shipmentDisplay?.courier === "speedy" ? "Speedy" : "Еконт"} ({shipmentDisplay?.deliveryType === "office" ? "до офис" : "до адрес"})
                        </h3>
                        <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => { setShipmentOpen(false); setSelectedOfficeNumericId(null); setOfficePickerError(false); setSenderEditing(false); setRecipientEditing(false) }}>Затвори</button>
                      </div>

                      {/* Sender — collapsed summary by default; "Промени"
                          expands to editable fields. Pre-filled from
                          SELLER_* env vars. For Econt sender, edit mode adds
                          an office picker so admin can pick a different
                          drop-off office without typing the code by hand. */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Подател</p>
                          {!senderEditing && (
                            <button
                              type="button"
                              onClick={() => setSenderEditing(true)}
                              className="text-xs text-blue-600 hover:underline"
                            >
                              Промени
                            </button>
                          )}
                        </div>
                        {(() => {
                          // Three sender modes, by precedence:
                          //   1. Econt drop-off office (SELLER_ECONT_OFFICE_CODE set)
                          //   2. Speedy drop-off office (SELLER_SPEEDY_OFFICE_ID set)
                          //   3. Address pickup (default — courier comes to seller)
                          const usesEcontOffice = shipmentDisplay?.courier === "econt" && !!shipmentForm.senderOfficeCode
                          const usesSpeedyOffice = shipmentDisplay?.courier === "speedy" && !!shipmentForm.senderSpeedyOfficeId
                          if (!senderEditing) {
                            return (
                              <div className="rounded-md border border-border/60 bg-secondary/40 px-3 py-2 text-sm">
                                <p className="font-medium">{shipmentForm.senderName || "—"}</p>
                                <p className="text-xs text-muted-foreground">{shipmentForm.senderPhone || "—"}</p>
                                {usesEcontOffice ? (
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    Офис: <span className="font-medium text-foreground">{shipmentForm.senderOfficeName || "—"}</span>
                                    <span className="ml-1 font-mono">({shipmentForm.senderOfficeCode})</span>
                                  </p>
                                ) : usesSpeedyOffice ? (
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    Офис: <span className="font-medium text-foreground">{shipmentForm.senderSpeedyOfficeName || "—"}</span>
                                    <span className="ml-1 font-mono">({shipmentForm.senderSpeedyOfficeId})</span>
                                  </p>
                                ) : (
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {[shipmentForm.senderAddress, shipmentForm.senderCity, shipmentForm.senderPostalCode].filter(Boolean).join(", ") || "—"}
                                  </p>
                                )}
                              </div>
                            )
                          }
                          return (
                            <>
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
                              {usesEcontOffice ? (
                                <div className="space-y-3">
                                  <EcontOfficePicker
                                    selectedOfficeId={null}
                                    onSelect={(office: EcontOfficeOption) => {
                                      setShipmentForm({ ...shipmentForm, senderOfficeCode: office.code, senderOfficeName: office.name })
                                    }}
                                    onError={setOfficePickerError}
                                  />
                                  {officePickerError && (
                                    <p className="text-sm text-red-600">
                                      Офисите не могат да бъдат заредени. Кодът на офиса остава непроменен.
                                    </p>
                                  )}
                                  <div className="grid gap-2 sm:grid-cols-3">
                                    <div>
                                      <label className="mb-1 block text-xs text-muted-foreground">Офис код</label>
                                      <Input value={shipmentForm.senderOfficeCode} disabled className="bg-secondary" />
                                    </div>
                                    <div className="sm:col-span-2">
                                      <label className="mb-1 block text-xs text-muted-foreground">Име на офис</label>
                                      <Input value={shipmentForm.senderOfficeName} disabled className="bg-secondary" />
                                    </div>
                                  </div>
                                </div>
                              ) : usesSpeedyOffice ? (
                                <div className="space-y-3">
                                  <SpeedyOfficePicker
                                    selectedOfficeId={Number(shipmentForm.senderSpeedyOfficeId) || null}
                                    onSelect={(office: SpeedyOfficeOption) => {
                                      setShipmentForm({ ...shipmentForm, senderSpeedyOfficeId: String(office.id), senderSpeedyOfficeName: office.name })
                                    }}
                                    onError={setOfficePickerError}
                                  />
                                  {officePickerError && (
                                    <p className="text-sm text-red-600">
                                      Офисите не могат да бъдат заредени. ID-то на офиса остава непроменено.
                                    </p>
                                  )}
                                  <div className="grid gap-2 sm:grid-cols-3">
                                    <div>
                                      <label className="mb-1 block text-xs text-muted-foreground">Офис ID</label>
                                      <Input value={shipmentForm.senderSpeedyOfficeId} disabled className="bg-secondary" />
                                    </div>
                                    <div className="sm:col-span-2">
                                      <label className="mb-1 block text-xs text-muted-foreground">Име на офис</label>
                                      <Input value={shipmentForm.senderSpeedyOfficeName} disabled className="bg-secondary" />
                                    </div>
                                  </div>
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
                              <div className="pt-1">
                                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setSenderEditing(false)}>Готово</Button>
                              </div>
                            </>
                          )
                        })()}
                      </div>

                      {/* Receiver — collapsed summary by default. Customer
                          chose office (or address) at checkout, so the
                          pre-filled value is almost always correct. "Промени
                          офис" expands the picker for the rare case admin
                          needs to switch (customer called to change
                          delivery, picked wrong office, etc.). */}
                      <div className="space-y-2 border-t pt-3">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Получател</p>
                          {!recipientEditing && (
                            <button
                              type="button"
                              onClick={() => setRecipientEditing(true)}
                              className="text-xs text-blue-600 hover:underline"
                            >
                              {shipmentDisplay?.deliveryType === "office" ? "Промени офис" : "Промени"}
                            </button>
                          )}
                        </div>
                        {!recipientEditing ? (
                          <div className="rounded-md border border-border/60 bg-secondary/40 px-3 py-2 text-sm">
                            <p className="font-medium">{shipmentForm.recipientName || "—"}</p>
                            <p className="text-xs text-muted-foreground">{shipmentForm.recipientPhone || "—"}</p>
                            {shipmentDisplay?.deliveryType === "office" ? (
                              <p className="mt-1 text-xs text-muted-foreground">
                                Офис: <span className="font-medium text-foreground">{shipmentForm.recipientOfficeName || "—"}</span>
                                {(shipmentForm.recipientOfficeId || shipmentForm.recipientOfficeCode) && (
                                  <span className="ml-1 font-mono">
                                    ({shipmentDisplay?.courier === "speedy" ? shipmentForm.recipientOfficeId : shipmentForm.recipientOfficeCode})
                                  </span>
                                )}
                              </p>
                            ) : (
                              <p className="mt-1 text-xs text-muted-foreground">
                                {[shipmentForm.recipientAddress, shipmentForm.recipientCity, shipmentForm.recipientPostalCode].filter(Boolean).join(", ") || "—"}
                              </p>
                            )}
                          </div>
                        ) : (
                          <>
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
                            <div className="pt-1">
                              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setRecipientEditing(false)}>Готово</Button>
                            </div>
                          </>
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

                      {/* ── Batch allocation — read-only summary ─────────────── */}
                      {savedAllocationLines.length > 0 && (
                        <div className="rounded-md border border-border bg-muted/20 p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <h4 className="text-sm font-medium">Партиди за изпращане</h4>
                            <a
                              href="#"
                              className="text-xs text-muted-foreground hover:text-foreground"
                              onClick={(e) => {
                                e.preventDefault()
                                setShipmentOpen(false)
                                document.querySelector("[data-batch-allocation-card]")?.scrollIntoView({ behavior: "smooth", block: "start" })
                              }}
                            >
                              Редактирай разпределението
                            </a>
                          </div>
                          <div className="overflow-hidden rounded-md border border-border/60 bg-background text-xs">
                            <table className="w-full">
                              <thead className="bg-muted/30 text-[11px] text-muted-foreground">
                                <tr>
                                  <th className="px-2 py-1.5 text-left">Артикул</th>
                                  <th className="px-2 py-1.5 text-left">Партида</th>
                                  <th className="px-2 py-1.5 text-right">Бр.</th>
                                  <th className="px-2 py-1.5 text-left">Срок</th>
                                </tr>
                              </thead>
                              <tbody>
                                {savedAllocationLines.flatMap((line) =>
                                  line.allocations.length === 0
                                    ? [(
                                        <tr key={`${line.orderItemId}-empty`} className="border-t border-border/60">
                                          <td className="px-2 py-1.5 font-medium">{line.productName}</td>
                                          <td className="px-2 py-1.5 text-amber-700" colSpan={3}>
                                            Няма разпределени партиди
                                          </td>
                                        </tr>
                                      )]
                                    : line.allocations.map((a, idx) => (
                                        <tr key={`${line.orderItemId}-${a.productBatchId}`} className="border-t border-border/60">
                                          <td className="px-2 py-1.5">{idx === 0 ? line.productName : ""}</td>
                                          <td className="px-2 py-1.5 font-mono">{a.batchNumber}</td>
                                          <td className="px-2 py-1.5 text-right">{a.quantity}</td>
                                          <td className="px-2 py-1.5 text-muted-foreground">
                                            {a.expiryDate ? new Date(a.expiryDate).toLocaleDateString("bg-BG", { day: "2-digit", month: "2-digit", year: "numeric" }) : ""}
                                          </td>
                                        </tr>
                                      )),
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      <div className="flex gap-2 pt-2">
                        <Button
                          disabled={shipmentLoading || officePickerError || (() => {
                            // Block submit if any line's saved allocation doesn't sum to ordered qty.
                            // The server's generateShipment precondition is the source of truth, but
                            // the disabled state gives instant UX feedback.
                            for (const line of savedAllocationLines) {
                              const total = line.allocations.reduce((s, a) => s + a.quantity, 0)
                              if (total !== line.orderedQuantity) return true
                            }
                            return false
                          })()}
                          onClick={async () => {
                            setShipmentLoading(true)
                            setActionError("")
                            try {
                              const { trackingNumber: tn } = await generateShipment(id, shipmentForm)
                              setTrackingNumber(tn)
                              setShipmentOpen(false)
                              setSelectedOfficeNumericId(null)
                              setOfficePickerError(false)
                              setSenderEditing(false)
                              setRecipientEditing(false)
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
                        <Button variant="ghost" onClick={() => { setShipmentOpen(false); setSelectedOfficeNumericId(null); setOfficePickerError(false); setSenderEditing(false); setRecipientEditing(false) }}>Отказ</Button>
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
            order.payment_method === "cod" && !order.seller_settled_at ? (
              <div className="space-y-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Плащане (наложен платеж)</p>
                <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
                  Очаква се плащане от куриер
                </div>
                {order.refunds.length > 0 && (() => {
                  const refundsTotal = order.refunds.reduce((s, r) => s + r.amount_cents, 0)
                  return (
                    <div className="rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-xs text-blue-900">
                      ⚠ По тази поръчка вече е възстановена сума <strong>{formatPrice(refundsTotal)}</strong> към клиента.
                      Куриерът ще преведе ППП сумата (минус комисионата). Реално ще получите изплатената от куриера сума минус {formatPrice(refundsTotal)}.
                    </div>
                  )
                })()}
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
                          settledAt: settlementPaidAt,
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

          {/* Two-step refund flow lives in a Dialog (triggered from the "Още
              действия" dropdown in the page header). The form is rare —
              keeping it always-rendered cluttered the main panel. Same Step 1
              records the refund row; Step 2 separately records any physical
              stock outcome (per-SKU recordStockMovement calls) OR captures a
              "no stock movement" reason via addAdminNote. Each server action
              stays single-responsibility; the UI does the coordination. */}
          <Dialog open={refundDialogOpen} onOpenChange={(open) => { setRefundDialogOpen(open); if (!open) setRefundError("") }}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Запиши възстановяване</DialogTitle>
                <DialogDescription>
                  Запишете извършено възстановяване (Stripe или банков превод). Изпълнете първо превода, после въведете тук референцията.
                </DialogDescription>
              </DialogHeader>
              {refundError && (
                <p className="text-sm text-red-600">{refundError}</p>
              )}
              {(() => {
            const alreadyRefunded = order.refunds.reduce((s, r) => s + r.amount_cents, 0)
            const remainingCents = order.total_amount - alreadyRefunded
            // Mirror the dropdown's canRefund predicate.
            if (!hasCustomerPaid(order)) return null

            const resetFlow = () => {
              setRefundAmount("")
              setRefundReason("")
              setRefundStripeId("")
              setRefundBankTransferRef("")
              setRefundAffectsInvoicedSupply(true)
              setRefundSkipReason("")
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
              setRefundLinkedWithdrawalId("")
              setRefundMode("items")
              setItemSelections({})
              setRefundAdditionalAmount("")
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
                        {/* Mode selector — items mode (allocates to specific
                            order lines, drives credit-note breakdown) vs
                            amount-only (shipping disputes, goodwill). Items
                            mode computes the refund total from selections;
                            amount mode lets admin type it. */}
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant={refundMode === "items" ? "default" : "outline"}
                            onClick={() => setRefundMode("items")}
                          >
                            По артикули
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant={refundMode === "amount" ? "default" : "outline"}
                            onClick={() => setRefundMode("amount")}
                          >
                            Допълнителна сума само
                          </Button>
                        </div>

                        {refundMode === "items" && (() => {
                          // Compute items total from current selections; uses
                          // unit_price_cents × quantity unless admin entered
                          // an override amount.
                          let itemsTotalCents = 0
                          for (const oi of order.items) {
                            const sel = itemSelections[oi.id]
                            if (!sel) continue
                            const qty = parseInt(sel.quantity, 10) || 0
                            if (qty < 1) continue
                            const overrideEur = parseFloat(sel.amountOverride)
                            const lineCents = sel.amountOverride && !isNaN(overrideEur)
                              ? Math.round(overrideEur * 100)
                              : oi.priceInCents * qty
                            itemsTotalCents += lineCents
                          }
                          const additionalEur = parseFloat(refundAdditionalAmount)
                          const additionalCents = !isNaN(additionalEur) && additionalEur > 0
                            ? Math.round(additionalEur * 100)
                            : 0
                          const totalCents = itemsTotalCents + additionalCents
                          return (
                            <>
                              <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
                                <p className="text-xs text-muted-foreground">
                                  Изберете артикули за възстановяване. Сумата по подразбиране е
                                  единична цена × количество; може да я промените.
                                </p>
                                {order.items.map((oi) => {
                                  const sel = itemSelections[oi.id]
                                  const checked = !!sel
                                  return (
                                    <div key={oi.id} className="rounded-md border border-border/60 bg-background p-2 text-xs">
                                      <label className="flex items-start gap-2">
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          onChange={(e) => {
                                            setItemSelections((prev) => {
                                              const next = { ...prev }
                                              if (e.target.checked) {
                                                next[oi.id] = { quantity: "1", amountOverride: "" }
                                              } else {
                                                delete next[oi.id]
                                              }
                                              return next
                                            })
                                          }}
                                          className="mt-0.5"
                                        />
                                        <span className="flex-1">
                                          <span className="font-medium text-foreground">{oi.productName}</span>
                                          <span className="ml-2 text-muted-foreground">{formatPrice(oi.priceInCents)} / бр. · поръчани {oi.quantity}</span>
                                        </span>
                                      </label>
                                      {checked && (
                                        <div className="mt-2 grid grid-cols-2 gap-2 pl-6">
                                          <div>
                                            <label className="mb-1 block text-[10px] text-muted-foreground">Количество</label>
                                            <Input
                                              type="number"
                                              min={1}
                                              max={oi.quantity}
                                              value={sel.quantity}
                                              onChange={(e) =>
                                                setItemSelections((prev) => ({
                                                  ...prev,
                                                  [oi.id]: { ...prev[oi.id], quantity: e.target.value },
                                                }))
                                              }
                                              className="h-7 text-xs"
                                            />
                                          </div>
                                          <div>
                                            <label className="mb-1 block text-[10px] text-muted-foreground">Сума (€) — override</label>
                                            <Input
                                              type="number"
                                              step="0.01"
                                              min="0.01"
                                              placeholder={((oi.priceInCents * (parseInt(sel.quantity, 10) || 1)) / 100).toFixed(2)}
                                              value={sel.amountOverride}
                                              onChange={(e) =>
                                                setItemSelections((prev) => ({
                                                  ...prev,
                                                  [oi.id]: { ...prev[oi.id], amountOverride: e.target.value },
                                                }))
                                              }
                                              className="h-7 text-xs"
                                            />
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  )
                                })}
                                <div>
                                  <label className="mb-1 block text-xs text-muted-foreground">
                                    Допълнителна сума (€) — за доставка / goodwill / неаллокирана част
                                  </label>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={refundAdditionalAmount}
                                    onChange={(e) => setRefundAdditionalAmount(e.target.value)}
                                    placeholder="0.00"
                                    className="h-8"
                                  />
                                </div>
                                <div className="flex items-center justify-between border-t border-border/60 pt-2 text-xs">
                                  <span className="text-muted-foreground">Общо за възстановяване:</span>
                                  <span className="font-medium">{formatPrice(totalCents)}</span>
                                </div>
                                {totalCents > remainingCents && (
                                  <p className="text-[11px] text-red-700">
                                    Сумата надвишава остатъка по поръчката ({formatPrice(remainingCents)}).
                                  </p>
                                )}
                              </div>
                            </>
                          )
                        })()}

                        <div className="grid gap-2 sm:grid-cols-2">
                          <div>
                            <label className="mb-1 block text-xs text-muted-foreground">Дата</label>
                            <Input type="date" value={refundDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setRefundDate(e.target.value)} className="h-8" />
                          </div>
                          {refundMode === "amount" && (
                            <div>
                              <label className="mb-1 block text-xs text-muted-foreground">Сума (€)</label>
                              <Input type="number" step="0.01" min="0.01" max={(remainingCents / 100).toFixed(2)} placeholder={(remainingCents / 100).toFixed(2)} value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} className="h-8" />
                            </div>
                          )}
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div>
                            <label className="mb-1 block text-xs text-muted-foreground">Метод</label>
                            <select value={refundMethod} onChange={(e) => setRefundMethod(e.target.value as "stripe" | "bank_transfer")} className="h-8 w-full rounded-md border border-border bg-background px-3 text-sm">
                              <option value="stripe">Stripe</option>
                              <option value="bank_transfer">Банков превод</option>
                            </select>
                          </div>
                          {(() => {
                            const initialInvoice = order.invoices.find((i) => i.type === "invoice")
                            const invoiceIssued = !!initialInvoice?.invoice_number
                            const willCreateCreditNote = invoiceIssued && refundAffectsInvoicedSupply
                            return (
                              <div>
                                {invoiceIssued && (
                                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <input
                                      type="checkbox"
                                      checked={refundAffectsInvoicedSupply}
                                      onChange={(e) => setRefundAffectsInvoicedSupply(e.target.checked)}
                                      className="rounded border-border"
                                    />
                                    <span>Това възстановяване намалява фактурираната сума (ще се създаде кредитно известие)</span>
                                  </label>
                                )}
                                {invoiceIssued && !refundAffectsInvoicedSupply && (
                                  <Input
                                    value={refundSkipReason}
                                    onChange={(e) => setRefundSkipReason(e.target.value)}
                                    placeholder="Причина за пропуск на КИ (задължително)"
                                    className="mt-2 h-8"
                                    maxLength={500}
                                  />
                                )}
                                {invoiceIssued && willCreateCreditNote && (
                                  <p className="mt-1 text-[11px] text-muted-foreground">
                                    Системата ще създаде кредитно известие в Документи; въведете номера от Microinvest след това.
                                  </p>
                                )}
                              </div>
                            )
                          })()}
                        </div>
                        {refundMethod === "stripe" && (
                          <div>
                            <label className="mb-1 block text-xs text-muted-foreground">Stripe refund ID (от Stripe Dashboard)</label>
                            <Input value={refundStripeId} onChange={(e) => setRefundStripeId(e.target.value)} placeholder="re_..." className="h-8 font-mono" maxLength={100} />
                          </div>
                        )}
                        {refundMethod === "bank_transfer" && (
                          <div>
                            <label className="mb-1 block text-xs text-muted-foreground">Референция на банков превод</label>
                            <Input value={refundBankTransferRef} onChange={(e) => setRefundBankTransferRef(e.target.value)} placeholder="Номер на превод от банковата ви извадка" className="h-8 font-mono" maxLength={200} />
                          </div>
                        )}
                        <div>
                          <label className="mb-1 block text-xs text-muted-foreground">Причина</label>
                          <Input value={refundReason} onChange={(e) => setRefundReason(e.target.value)} placeholder="Право на отказ / рекламация / ..." className="h-8" maxLength={1000} />
                        </div>

                        {(() => {
                          const linkable = order.withdrawals.filter(
                            (w) => w.status === "approved" || w.status === "goods_received",
                          )
                          if (linkable.length === 0) return null
                          return (
                            <div>
                              <label className="mb-1 block text-xs text-muted-foreground">
                                Свързване със заявка за връщане (по избор)
                              </label>
                              <select
                                value={refundLinkedWithdrawalId}
                                onChange={(e) => setRefundLinkedWithdrawalId(e.target.value)}
                                className="h-8 w-full rounded-md border border-border bg-background px-3 text-sm"
                              >
                                <option value="">— без връзка —</option>
                                {linkable.map((w) => (
                                  <option key={w.id} value={w.id}>
                                    {w.withdrawal_ref} ({w.status})
                                  </option>
                                ))}
                              </select>
                            </div>
                          )
                        })()}

                        <div className="flex items-center gap-3">
                          <Button size="sm" disabled={(() => {
                            if (refundLoading) return true
                            if (!refundReason.trim()) return true
                            if (refundMethod === "stripe" && !refundStripeId.trim()) return true
                            if (refundMethod === "bank_transfer" && !refundBankTransferRef.trim()) return true
                            if (!refundAffectsInvoicedSupply && !refundSkipReason.trim()) return true
                            // Items mode: at least one item OR a non-zero
                            // additional amount is required (otherwise the
                            // refund total is 0).
                            if (refundMode === "items") {
                              const hasSelection = Object.keys(itemSelections).length > 0
                              const additional = parseFloat(refundAdditionalAmount)
                              const hasAdditional = !isNaN(additional) && additional > 0
                              if (!hasSelection && !hasAdditional) return true
                            }
                            return false
                          })()} onClick={async () => {
                            setRefundLoading(true)
                            setRefundError("")
                            try {
                              // Compute the refund total + items array based on mode.
                              let amountCents: number
                              let itemsForRecord: Array<{ orderItemId: number; quantity: number; amountCents?: number }> | undefined
                              if (refundMode === "items") {
                                const items: Array<{ orderItemId: number; quantity: number; amountCents: number }> = []
                                let itemsTotal = 0
                                for (const oi of order.items) {
                                  const sel = itemSelections[oi.id]
                                  if (!sel) continue
                                  const qty = parseInt(sel.quantity, 10)
                                  if (!Number.isInteger(qty) || qty < 1) continue
                                  const overrideEur = parseFloat(sel.amountOverride)
                                  const lineCents = sel.amountOverride && !isNaN(overrideEur) && overrideEur > 0
                                    ? Math.round(overrideEur * 100)
                                    : oi.priceInCents * qty
                                  items.push({ orderItemId: oi.id, quantity: qty, amountCents: lineCents })
                                  itemsTotal += lineCents
                                }
                                const additionalEur = parseFloat(refundAdditionalAmount)
                                const additionalCents = !isNaN(additionalEur) && additionalEur > 0
                                  ? Math.round(additionalEur * 100)
                                  : 0
                                amountCents = itemsTotal + additionalCents
                                itemsForRecord = items.length > 0 ? items : undefined
                              } else {
                                const amountFloat = refundAmount ? parseFloat(refundAmount) : remainingCents / 100
                                amountCents = Math.round(amountFloat * 100)
                                itemsForRecord = undefined
                              }
                              const result = await recordRefund(id, {
                                refundAmount: amountCents,
                                refundReason: refundReason.trim(),
                                refundMethod,
                                refundedAt: refundDate || undefined,
                                stripeRefundId: refundMethod === "stripe" ? refundStripeId.trim() : undefined,
                                bankTransferRef: refundMethod === "bank_transfer" ? refundBankTransferRef.trim() : undefined,
                                affectsInvoicedSupply: refundAffectsInvoicedSupply,
                                creditNoteSkipReason: !refundAffectsInvoicedSupply ? refundSkipReason.trim() : undefined,
                                clientIdempotencyKey: refundClientKey,
                                withdrawalId: refundLinkedWithdrawalId || undefined,
                                items: itemsForRecord,
                              })
                              const updated = await getOrder(id)
                              setOrder(updated)
                              setSavedRefundId(result.refundId)
                              setSavedRefundAmountCents(amountCents)
                              setRefundStep("stock")
                            } catch (err) {
                              setRefundError(err instanceof Error ? err.message : "Грешка при записване на възстановяване")
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
                              setRefundError('Въведете поне едно количество, или изберете „Няма физическо връщане" по-долу')
                              return
                            }
                            setStockLoading(true)
                            setRefundError("")
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
                              setRefundError(failed[0].message)
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
                            setRefundError("")
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
                              setRefundError(err instanceof Error ? err.message : "Грешка при записване")
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
            </DialogContent>
          </Dialog>

          {/* Complaints section — moved to dialog. Triggered from "Още
              действия" dropdown. Existing complaints and the new-complaint
              form all live here. */}
          <Dialog open={complaintDialogOpen} onOpenChange={(open) => { setComplaintDialogOpen(open); if (!open) { setComplaintError(""); setComplaintResult("") } }}>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Рекламации</DialogTitle>
                <DialogDescription>
                  Регистрирайте рекламация по ЗЗП Чл. 127 или приключете съществуваща.
                </DialogDescription>
              </DialogHeader>
              {complaintError && (
                <p className="text-sm text-red-600">{complaintError}</p>
              )}
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">Регистрирайте рекламация по ЗЗП Чл. 127. Получавате уникален номер (RCL-YYYY-NNNN) за обратна връзка с клиента.</p>
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
                              setComplaintError("")
                              try {
                                await resolveComplaint(c.id, { status: resolveStatus, resolution: resolveResolution.trim() })
                                const updated = await getOrderComplaints(id)
                                setComplaints(updated)
                                setResolveId(null)
                                setResolveResolution("")
                              } catch (err) {
                                setComplaintError(err instanceof Error ? err.message : "Грешка")
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
            {complaintResult ? (
              // Just-registered state: show success + offer to register another.
              // Hides the form so admin doesn't accidentally re-submit.
              <div className="space-y-3">
                <div className="rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-900">
                  <p className="font-medium">Рекламация регистрирана: {complaintResult}</p>
                  <p className="mt-1 text-xs">Предоставете този номер на клиента като потвърждение за регистрация на рекламацията.</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => setComplaintResult("")}>
                  Регистрирай нова рекламация
                </Button>
              </div>
            ) : (
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
                    setComplaintError("")
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
                      setComplaintError(err instanceof Error ? err.message : "Грешка при записване на рекламация")
                    } finally {
                      setComplaintLoading(false)
                    }
                  }}>
                    {complaintLoading ? "Записване..." : "Регистрирай рекламация"}
                  </Button>
                </div>
              </div>
            )}
          </div>
            </DialogContent>
          </Dialog>

          {/* Withdrawals (право на отказ) — admin-driven intake. The dialog
              is opened from the "Регистрирай заявка за връщане" item in the
              Още действия dropdown above. The Заявки card below lists all
              withdrawals + complaints for this order. */}
          <Dialog
            open={withdrawalDialogOpen}
            onOpenChange={(open) => {
              setWithdrawalDialogOpen(open)
              if (!open) {
                setWithdrawalError("")
                setWithdrawalResult(null)
              }
            }}
          >
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Регистрирай заявка за връщане</DialogTitle>
                <DialogDescription>
                  Право на отказ по ЗЗП Чл. 50. Регистрирайте заявка след контакт с клиента.
                </DialogDescription>
              </DialogHeader>
              {withdrawalError && (
                <p className="text-sm text-red-600">{withdrawalError}</p>
              )}
              {withdrawalResult ? (
                // Just-registered state: show success + offer to register another
                // or open the new withdrawal's detail page. Hides the form so
                // admin doesn't accidentally re-submit.
                <div className="space-y-3">
                  <div className="rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-900">
                    <p className="font-medium">Заявка регистрирана: {withdrawalResult.ref}</p>
                    <p className="mt-1 text-xs">
                      Изпратихме потвърждение на клиента. Прегледайте допустимостта и одобрете
                      или отхвърлете от страницата на заявката.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={() => {
                        window.location.href = `/admin/returns/${withdrawalResult.id}`
                      }}
                    >
                      Отвори заявката ↗
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setWithdrawalResult(null)}>
                      Регистрирай нова
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Право на отказ по чл. 50 ЗЗП. Регистрирайте заявка след като
                    клиентът Ви е писал/обадил. Системата генерира уникална
                    референция (WD-YYYY-NNNN) и изпраща потвърждение на клиента.
                  </p>
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">Канал на заявка</label>
                    <select
                      value={withdrawalVia}
                      onChange={(e) => setWithdrawalVia(e.target.value as WithdrawalRequestedVia)}
                      className="h-8 w-full rounded-md border border-border bg-background px-3 text-sm"
                    >
                      <option value="email">Имейл</option>
                      <option value="phone">Телефон</option>
                      <option value="admin">Админ (вътрешна)</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">Имейл на клиента</label>
                    <Input
                      value={withdrawalEmail}
                      onChange={(e) => setWithdrawalEmail(e.target.value)}
                      placeholder="customer@example.com"
                      className="h-8"
                      maxLength={200}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">Текст на заявката (по избор)</label>
                    <textarea
                      value={withdrawalText}
                      onChange={(e) => setWithdrawalText(e.target.value)}
                      placeholder="Кратко описание / резюме на имейла на клиента..."
                      className="h-24 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                      maxLength={2000}
                    />
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={withdrawalLoading}
                      onClick={() => setWithdrawalDialogOpen(false)}
                    >
                      Отказ
                    </Button>
                    <Button
                      size="sm"
                      disabled={withdrawalLoading || !withdrawalEmail.trim()}
                      onClick={async () => {
                        setWithdrawalLoading(true)
                        setWithdrawalError("")
                        try {
                          const result = await createWithdrawal(id, {
                            requestedVia: withdrawalVia,
                            customerEmail: withdrawalEmail.trim(),
                            customerRequestText: withdrawalText.trim() || undefined,
                          })
                          setWithdrawalEmail("")
                          setWithdrawalText("")
                          const updated = await getOrder(id)
                          setOrder(updated)
                          setWithdrawalResult({ id: result.withdrawalId, ref: result.withdrawalRef })
                        } catch (err) {
                          setWithdrawalError(err instanceof Error ? err.message : "Грешка")
                        } finally {
                          setWithdrawalLoading(false)
                        }
                    }}
                  >
                    {withdrawalLoading ? "Записване..." : "Регистрирай"}
                  </Button>
                </div>
              </div>
              )}
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>

      {/* Email resends are now in the "Още действия" dropdown at the page
          header (with a separator from the exception flows). The previous
          always-visible "Имейли" card was confusing — "не е отбелязан като
          изпратен" read as a problem when in fact the helpers either had no
          persisted timestamp (shipping) or the timestamp was first-write-wins
          (so a missing value just meant no successful send had been recorded
          yet, not that something was broken). Past sends are visible in the
          History card via `email_resent` audit events and the persisted
          first-sent timestamps. Sending state lives on the dropdown items;
          completion / error feedback surfaces as a transient banner near the
          dropdown. */}

      {/* Post-shipment outcome events — moved to dialog. Triggered from "Още
          действия" dropdown for shipped/delivered orders. The dialog body is
          identical to the previous always-visible card. */}
      <Dialog open={outcomeDialogOpen} onOpenChange={(open) => { setOutcomeDialogOpen(open); if (!open) setOutcomeError("") }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Следдоставно събитие</DialogTitle>
            <DialogDescription>
              Запишете събитие след доставка (отказана доставка, изгубена пратка, върнат продукт, изтегляне).
            </DialogDescription>
          </DialogHeader>
          {outcomeError && (
            <p className="text-sm text-red-600">{outcomeError}</p>
          )}
          <div>
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
                  setOutcomeError("")
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
                    setOutcomeError(err instanceof Error ? err.message : "Грешка при записване на събитие")
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

                  // Hand off from the outcome dialog to the refund dialog.
                  // Close this one, open that one. Focus the amount input
                  // after Radix has had a tick to mount the dialog content.
                  setOutcomeDialogOpen(false)
                  setRefundDialogOpen(true)
                  setTimeout(() => {
                    const input = document.querySelector<HTMLInputElement>(
                      '#refund-card input[type="number"]',
                    )
                    input?.focus()
                    input?.select()
                  }, 100)

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
          </div>
        </DialogContent>
      </Dialog>

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

// One row in the refunds list. Shows refund details (amount, method, date,
// per-line allocation when refund_items exist) and an inline annotation
// edit for reason + bank_transfer_ref + credit_note_skip_reason. No VAT
// math here by design — business is not VAT-registered, and once it is,
// VAT amounts will be pasted from Microinvest, never computed in the UI.
// The credit-note document number lives on the linked invoices row of
// type='credit_note' (auto-created on refund when conditions hold) —
// admin edits it from the Документи section.
function RefundRow({
  refund,
  creditNoteInvoice,
  orderItems,
  onSaved,
}: {
  refund: OrderRefund
  creditNoteInvoice: Invoice | undefined
  orderItems: OrderDetail["items"]
  onSaved: () => Promise<void> | void
}) {
  const [editing, setEditing] = useState(false)
  const [reason, setReason] = useState(refund.reason ?? "")
  const [bankTransferRef, setBankTransferRef] = useState(refund.bank_transfer_ref ?? "")
  const [skipReason, setSkipReason] = useState(refund.credit_note_skip_reason ?? "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

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
            {refund.bank_transfer_ref && (
              <span className="ml-2 font-mono">{refund.bank_transfer_ref}</span>
            )}
          </div>
          {refund.items.length > 0 && (() => {
            // Item summary surfaces the allocation when refund_items exists.
            // Format: "1 × Микс Кутия + 2 × Друг бар" with optional
            // "+ X.XX € допълнително" when the items don't sum to the full
            // refund total (the unallocated portion).
            const parts: string[] = []
            const itemsTotal = refund.items.reduce((s, it) => s + it.amount_cents, 0)
            const additionalCents = refund.amount_cents - itemsTotal
            for (const it of refund.items) {
              const oi = orderItems.find((o) => o.id === it.order_item_id)
              const label = oi ? oi.productName : `артикул #${it.order_item_id}`
              parts.push(`${it.quantity} × ${label}`)
            }
            const itemsLabel = parts.join(" + ")
            return (
              <div className="mt-1 text-xs">
                <span className="text-muted-foreground">Артикули:</span>{" "}
                <span>{itemsLabel}</span>
                {additionalCents > 0 && (
                  <span className="text-muted-foreground"> + {formatPrice(additionalCents)} допълнително</span>
                )}
              </div>
            )
          })()}
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
          {creditNoteInvoice ? (
            <div>
              <span className="text-muted-foreground">Кредитно известие:</span>{" "}
              {creditNoteInvoice.invoice_number ? (
                <span className="font-mono">#{creditNoteInvoice.invoice_number}</span>
              ) : (
                <span className="text-amber-700">чака номер ↗ (виж Документи)</span>
              )}
            </div>
          ) : refund.affects_invoiced_supply === false ? (
            <div className="text-muted-foreground">
              Не изисква кредитно известие
              {refund.credit_note_skip_reason && (
                <> — <span>{refund.credit_note_skip_reason}</span></>
              )}
            </div>
          ) : null}
          {!refund.reason && !creditNoteInvoice && !refund.credit_note_skip_reason && (
            <div className="text-muted-foreground italic">Няма анотации — редактирайте, за да добавите.</div>
          )}
        </div>
      )}


      {editing && (
        <div className="mt-3 space-y-2">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Причина</label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Право на отказ / рекламация / ..." className="h-8" maxLength={1000} />
          </div>
          {refund.method === "bank_transfer" && (
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Референция на банков превод</label>
              <Input value={bankTransferRef} onChange={(e) => setBankTransferRef(e.target.value)} placeholder="Номер на превод" className="h-8 font-mono" maxLength={200} />
            </div>
          )}
          {refund.affects_invoiced_supply === false && (
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Причина за пропуск на кредитно известие</label>
              <Input value={skipReason} onChange={(e) => setSkipReason(e.target.value)} placeholder="Защо не се създава КИ" className="h-8" maxLength={500} />
            </div>
          )}
          {error && <p className="text-xs text-red-700">{error}</p>}
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={saving} onClick={async () => {
              setSaving(true)
              setError("")
              try {
                await updateRefundAnnotation(refund.id, {
                  reason,
                  bankTransferRef: refund.method === "bank_transfer" ? bankTransferRef : undefined,
                  creditNoteSkipReason: refund.affects_invoiced_supply === false ? skipReason : undefined,
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
              setBankTransferRef(refund.bank_transfer_ref ?? "")
              setSkipReason(refund.credit_note_skip_reason ?? "")
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

// One row in the Документи section. Renders a type='invoice' or
// type='credit_note' row with status badges, the Microinvest number input
// (if pending), and the "mark as sent" toggle. For credit notes, also shows
// the linked refund summary, the original фактура it references, and a
// due-date alert (5 days from refund per ЗДДС Чл. 113 ал. 4).
function InvoiceRow({
  invoice,
  order,
  onChanged,
}: {
  invoice: Invoice
  order: OrderDetail
  onChanged: () => Promise<void> | void
}) {
  const [number, setNumber] = useState("")
  const [date, setDate] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const isInvoice = invoice.type === "invoice"
  const linkedRefund = isInvoice
    ? null
    : order.refunds.find((r) => r.id === invoice.refund_id)
  const referencedInvoice = isInvoice
    ? null
    : order.invoices.find((i) => i.id === invoice.references_invoice_id)

  const dueAlert = (() => {
    if (invoice.invoice_number) return null
    if (!invoice.due_at) return null
    const due = new Date(invoice.due_at)
    const now = new Date()
    const daysLeft = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    const dueLabel = due.toLocaleDateString("bg-BG")
    if (daysLeft <= 0) {
      return { tone: "error" as const, text: `Срокът за издаване е изтекъл (${dueLabel})` }
    }
    if (daysLeft <= 2) {
      return { tone: "warn" as const, text: `Остават ${daysLeft} ${daysLeft === 1 ? "ден" : "дни"} (до ${dueLabel})` }
    }
    return { tone: "info" as const, text: `Срок: до ${dueLabel} (${daysLeft} дни)` }
  })()

  const statusBadge = invoice.invoice_number
    ? invoice.sent_at
      ? { label: "изпратен", className: "bg-green-100 text-green-800" }
      : { label: "издаден", className: "bg-blue-100 text-blue-800" }
    : { label: "чака номер", className: "bg-amber-100 text-amber-800" }

  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium">
              {isInvoice ? "Фактура" : "Кредитно известие"}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${statusBadge.className}`}>
              {statusBadge.label}
            </span>
          </div>
          {!isInvoice && linkedRefund && (
            <div className="text-xs text-muted-foreground">
              ↳ за възстановяване от{" "}
              {new Date(linkedRefund.refunded_at).toLocaleDateString("bg-BG")}{" "}
              ({formatPrice(linkedRefund.amount_cents)})
            </div>
          )}
          {!isInvoice && referencedInvoice?.invoice_number && (
            <div className="text-xs text-muted-foreground">
              ↳ към Фактура #{referencedInvoice.invoice_number}
            </div>
          )}
          {isInvoice && (
            <div className="text-xs text-muted-foreground space-y-0.5">
              {invoice.invoice_type && (
                <div>
                  <span>Тип:</span>{" "}
                  {invoice.invoice_type === "company" ? "Юридическо лице" : "Физическо лице"}
                </div>
              )}
              {invoice.company_name && <div>Фирма: {invoice.company_name}</div>}
              {invoice.eik && <div>ЕИК: {invoice.eik}</div>}
              {invoice.vat_number && <div>ДДС номер: {invoice.vat_number}</div>}
              {invoice.mol && <div>МОЛ: {invoice.mol}</div>}
              {invoice.address && <div>Адрес: {invoice.address}</div>}
            </div>
          )}
        </div>
      </div>

      {dueAlert && (
        <div className={`mt-2 rounded-md px-3 py-2 text-xs font-medium ${
          dueAlert.tone === "error" ? "border border-red-300 bg-red-50 text-red-900"
          : dueAlert.tone === "warn" ? "border border-amber-300 bg-amber-50 text-amber-900"
          : "border border-border bg-secondary text-foreground"
        }`}>
          {dueAlert.text}
        </div>
      )}

      {invoice.invoice_number ? (
        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          <div>
            <span>Номер:</span>{" "}
            <span className="font-mono text-foreground">#{invoice.invoice_number}</span>
          </div>
          {invoice.invoice_date && (
            <div>
              <span>Дата:</span>{" "}
              {new Date(invoice.invoice_date).toLocaleDateString("bg-BG")}
            </div>
          )}
          {invoice.sent_at ? (
            <div>
              <span>Изпратен на клиента на:</span>{" "}
              {new Date(invoice.sent_at).toLocaleDateString("bg-BG", {
                day: "2-digit", month: "2-digit", year: "numeric",
                hour: "2-digit", minute: "2-digit",
              })}
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="mt-1"
              disabled={saving}
              onClick={async () => {
                setError("")
                setSaving(true)
                try {
                  await markInvoiceSent(invoice.id)
                  await onChanged()
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Грешка")
                } finally {
                  setSaving(false)
                }
              }}
            >
              Маркирай като изпратен на клиента
            </Button>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-2 text-xs">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[160px]">
              <label className="mb-1 block text-muted-foreground">Номер от Microinvest</label>
              <Input
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                placeholder={isInvoice ? "напр. F-2026-0042" : "напр. KI-2026-0007"}
                className="h-8 font-mono"
                maxLength={50}
              />
            </div>
            <div>
              <label className="mb-1 block text-muted-foreground">Дата</label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="h-8 w-40"
              />
            </div>
            <Button
              size="sm"
              disabled={saving || !number.trim()}
              onClick={async () => {
                setError("")
                setSaving(true)
                try {
                  await setInvoiceNumber(invoice.id, number.trim(), date || undefined)
                  setNumber("")
                  setDate("")
                  await onChanged()
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Грешка")
                } finally {
                  setSaving(false)
                }
              }}
            >
              {saving ? "Записване..." : "Запиши"}
            </Button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
    </div>
  )
}
