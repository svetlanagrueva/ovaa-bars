"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { SpeedyOfficePicker, type SpeedyOfficeOption } from "@/components/delivery/speedy-office-picker"
import { EcontOfficePicker, type EcontOfficeOption } from "@/components/delivery/econt-office-picker"
import { updateOrderDeliveryMethod, type LogisticsPartner } from "@/app/actions/admin"

interface Props {
  orderId: string
  status: string
  trackingNumber: string | null
  // Current values, used to seed the form so admin sees what they're changing
  partner: string | null
  city: string
  address: string
  postalCode: string
  speedyOfficeId: number | null
  speedyOfficeName: string | null
  speedyOfficeAddress: string | null
  econtOfficeId: number | null
  econtOfficeCode: string | null
  econtOfficeName: string | null
  econtOfficeAddress: string | null
  onSaved: () => void
}

const PARTNER_LABELS: Record<LogisticsPartner, string> = {
  "speedy-address": "Speedy — до адрес",
  "speedy-office": "Speedy — до офис",
  "econt-office": "Еконт — до офис",
}

export function DeliveryMethodEditor(props: Props) {
  const canEdit =
    (props.status === "pending" || props.status === "confirmed") && !props.trackingNumber

  const [editing, setEditing] = useState(false)
  const [partner, setPartner] = useState<LogisticsPartner>(
    (props.partner as LogisticsPartner) ?? "speedy-address",
  )
  const [city, setCity] = useState(props.city ?? "")
  const [address, setAddress] = useState(props.address ?? "")
  const [postalCode, setPostalCode] = useState(props.postalCode ?? "")
  const [speedyOfficeId, setSpeedyOfficeId] = useState<number | null>(props.speedyOfficeId)
  const [speedyOfficeName, setSpeedyOfficeName] = useState(props.speedyOfficeName ?? "")
  const [speedyOfficeAddress, setSpeedyOfficeAddress] = useState(props.speedyOfficeAddress ?? "")
  const [econtOfficeId, setEcontOfficeId] = useState<number | null>(props.econtOfficeId)
  const [econtOfficeCode, setEcontOfficeCode] = useState(props.econtOfficeCode ?? "")
  const [econtOfficeName, setEcontOfficeName] = useState(props.econtOfficeName ?? "")
  const [econtOfficeAddress, setEcontOfficeAddress] = useState(props.econtOfficeAddress ?? "")
  const [reason, setReason] = useState("")
  const [pickerError, setPickerError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  function handleSpeedySelect(office: SpeedyOfficeOption) {
    setSpeedyOfficeId(office.id)
    setSpeedyOfficeName(office.name)
    setSpeedyOfficeAddress(office.fullAddress)
    if (office.city) setCity(office.city)
  }
  function handleEcontSelect(office: EcontOfficeOption) {
    setEcontOfficeId(office.id)
    setEcontOfficeCode(office.code)
    setEcontOfficeName(office.name)
    setEcontOfficeAddress(office.fullAddress)
    if (office.city) setCity(office.city)
  }

  async function handleSave() {
    setError("")
    setSaving(true)
    try {
      await updateOrderDeliveryMethod(props.orderId, {
        partner,
        city,
        // Send only the partner-specific fields the server needs; the rest
        // are nulled by the server in one atomic UPDATE so chk_delivery_
        // fields_consistent passes.
        ...(partner === "speedy-address" ? { address, postalCode } : {}),
        ...(partner === "speedy-office"
          ? {
              speedyOfficeId: speedyOfficeId ?? undefined,
              speedyOfficeName,
              speedyOfficeAddress,
            }
          : {}),
        ...(partner === "econt-office"
          ? {
              econtOfficeId: econtOfficeId ?? undefined,
              econtOfficeCode,
              econtOfficeName,
              econtOfficeAddress,
            }
          : {}),
        reason: reason.trim() || undefined,
      })
      setEditing(false)
      setReason("")
      props.onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Грешка")
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    if (!canEdit) return null
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={() => setEditing(true)}
      >
        Промени метод за доставка
      </Button>
    )
  }

  return (
    <div className="rounded-md border border-border bg-muted/20 p-3 space-y-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium">Промени метод за доставка</span>
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={() => { setEditing(false); setError("") }}
        >
          Отказ
        </button>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Метод</Label>
        <div className="space-y-1">
          {(Object.keys(PARTNER_LABELS) as LogisticsPartner[]).map((p) => (
            <label key={p} className="flex items-center gap-2 text-xs">
              <input
                type="radio"
                name="partner"
                value={p}
                checked={partner === p}
                onChange={() => { setPartner(p); setPickerError(false) }}
              />
              <span>{PARTNER_LABELS[p]}</span>
            </label>
          ))}
        </div>
      </div>

      {partner === "speedy-address" && (
        <div className="space-y-2">
          <div>
            <Label className="text-xs text-muted-foreground">Град</Label>
            <Input value={city} onChange={(e) => setCity(e.target.value)} className="h-8 text-xs" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Адрес</Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} className="h-8 text-xs" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Пощенски код</Label>
            <Input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} className="h-8 w-32 text-xs" />
          </div>
        </div>
      )}

      {partner === "speedy-office" && (
        <div className="space-y-2">
          <div>
            <Label className="text-xs text-muted-foreground">Град</Label>
            <Input value={city} onChange={(e) => setCity(e.target.value)} className="h-8 text-xs" />
          </div>
          <SpeedyOfficePicker
            selectedOfficeId={speedyOfficeId}
            onSelect={handleSpeedySelect}
            onError={setPickerError}
          />
        </div>
      )}

      {partner === "econt-office" && (
        <div className="space-y-2">
          <div>
            <Label className="text-xs text-muted-foreground">Град</Label>
            <Input value={city} onChange={(e) => setCity(e.target.value)} className="h-8 text-xs" />
          </div>
          <EcontOfficePicker
            selectedOfficeId={econtOfficeId}
            onSelect={handleEcontSelect}
            onError={setPickerError}
          />
        </div>
      )}

      <div>
        <Label className="text-xs text-muted-foreground">Причина за промяна (по желание)</Label>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder='напр. "обаждане с клиента — премина към Еконт офис"…'
          rows={2}
          className="text-xs"
        />
      </div>

      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-900">{error}</p>
      )}

      <div className="flex gap-2">
        <Button size="sm" onClick={() => void handleSave()} disabled={saving || pickerError}>
          {saving ? "Записване…" : "Запази"}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setError("") }} disabled={saving}>
          Отказ
        </Button>
      </div>
    </div>
  )
}
