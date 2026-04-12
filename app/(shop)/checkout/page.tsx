"use client"

import React from "react"
import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Truck, CreditCard, Loader2, Banknote, FileText, HelpCircle, ShieldCheck } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Checkbox } from "@/components/ui/checkbox"
import { useCartStore } from "@/lib/store/cart"
import { formatPrice } from "@/lib/products"
import { createCheckoutSession, createCODOrder, validatePromoCode, checkCartInventory } from "@/app/actions/stripe"
import { COD_FEE, calculateShippingPrice } from "@/lib/constants"
import { isOnSale } from "@/lib/products"
import { DeliveryInfo } from "@/components/delivery/delivery-info"
import { EcontOfficePicker, type EcontOfficeOption } from "@/components/delivery/econt-office-picker"
import { SpeedyOfficePicker, type SpeedyOfficeOption } from "@/components/delivery/speedy-office-picker"

interface CustomerInfo {
  firstName: string
  lastName: string
  email: string
  phone: string
  city: string
  address: string
  postalCode: string
  notes: string
}

interface BillingInfo {
  firstName: string
  lastName: string
  address: string
  company: string
  eik: string
  vatNumber: string
  egn: string
  city: string
  postalCode: string
}

export default function CheckoutPage() {
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const submittingRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [stockWarnings, setStockWarnings] = useState<Array<{ productName: string; available: number; requested: number }>>([])

  const [paymentMethod, setPaymentMethod] = useState("card")
  const [deliveryMethod, setDeliveryMethod] = useState("econt-office")
  const [selectedEcontOffice, setSelectedEcontOffice] = useState<EcontOfficeOption | null>(null)
  const [selectedSpeedyOffice, setSelectedSpeedyOffice] = useState<SpeedyOfficeOption | null>(null)
  const [officePickerError, setOfficePickerError] = useState(false)
  const { items, getTotalPrice } = useCartStore()

  const [promoCode, setPromoCode] = useState("")
  const [promoLoading, setPromoLoading] = useState(false)
  const [promoError, setPromoError] = useState<string | null>(null)
  const [appliedPromo, setAppliedPromo] = useState<{
    code: string
    discountAmount: number
  } | null>(null)

  const [customerInfo, setCustomerInfo] = useState<CustomerInfo>({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    city: "",
    address: "",
    postalCode: "",
    notes: "",
  })

  const [wantsInvoice, setWantsInvoice] = useState(false)
  const [marketingConsent, setMarketingConsent] = useState(false)
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [billingType, setBillingType] = useState<"individual" | "company">("individual")

  const [billingInfo, setBillingInfo] = useState<BillingInfo>({
    firstName: "",
    lastName: "",
    address: "",
    company: "",
    eik: "",
    vatNumber: "",
    egn: "",
    city: "",
    postalCode: "",
  })

  useEffect(() => {
    setMounted(true)
  }, [])

  // Redirect to cart if empty (in useEffect, not during render)
  useEffect(() => {
    if (mounted && items.length === 0) {
      router.push("/cart")
    }
  }, [mounted, items.length, router])

  // Soft stock check — warn early before any payment attempt
  useEffect(() => {
    if (!mounted || items.length === 0) return
    const cartItems = items.map((item) => ({ productId: item.product.id, quantity: item.quantity }))
    checkCartInventory(cartItems).then(setStockWarnings).catch(() => {})
  }, [mounted, items])

  const totalPrice = getTotalPrice()
  const shippingPrice = calculateShippingPrice(totalPrice, deliveryMethod)
  const codFee = paymentMethod === "cod" ? COD_FEE : 0

  // Clear promo if cart total changes (server will re-validate anyway)
  useEffect(() => {
    if (!appliedPromo) return
    setAppliedPromo(null)
    setPromoCode("")
    setPromoError("Количката се промени. Моля, приложете кода отново.")
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalPrice])

  const discountAmount = appliedPromo?.discountAmount ?? 0
  const finalPrice = Math.max(0, totalPrice - discountAmount + shippingPrice + codFee)

  async function handleApplyPromo() {
    setPromoError(null)
    setPromoLoading(true)
    try {
      const result = await validatePromoCode(promoCode.trim(), totalPrice)
      if (result.valid) {
        setAppliedPromo({ code: result.code, discountAmount: result.discountAmount })
      } else {
        setPromoError(result.error)
      }
    } catch {
      setPromoError("Грешка при валидиране на кода")
    } finally {
      setPromoLoading(false)
    }
  }

  function handleRemovePromo() {
    setAppliedPromo(null)
    setPromoCode("")
    setPromoError(null)
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setCustomerInfo((prev) => ({ ...prev, [name]: value }))
  }

  const handleBillingChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setBillingInfo((prev) => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submittingRef.current) return
    submittingRef.current = true
    setIsLoading(true)
    setError(null)

    try {
      if (!acceptedTerms) {
        setError("Моля, приемете условията за ползване и политиката за поверителност.")
        setIsLoading(false)
        submittingRef.current = false
        return
      }

      if (deliveryMethod === "econt-office" && !selectedEcontOffice) {
        setError("Моля, изберете офис на Еконт")
        setIsLoading(false)
        submittingRef.current = false
        return
      }

      if (deliveryMethod === "speedy-office" && !selectedSpeedyOffice) {
        setError("Моля, изберете офис на Speedy")
        setIsLoading(false)
        submittingRef.current = false
        return
      }

      const cartItems = items.map((item) => ({
        productId: item.product.id,
        quantity: item.quantity,
      }))

      const econtOffice = deliveryMethod === "econt-office" && selectedEcontOffice
        ? { id: selectedEcontOffice.id, code: selectedEcontOffice.code, name: selectedEcontOffice.name, city: selectedEcontOffice.city, fullAddress: selectedEcontOffice.fullAddress }
        : undefined

      const speedyOffice = deliveryMethod === "speedy-office" && selectedSpeedyOffice
        ? { id: selectedSpeedyOffice.id, name: selectedSpeedyOffice.name, city: selectedSpeedyOffice.city, fullAddress: selectedSpeedyOffice.fullAddress }
        : undefined

      const billingName = [billingInfo.firstName, billingInfo.lastName].filter(Boolean).join(" ")
        || [customerInfo.firstName, customerInfo.lastName].filter(Boolean).join(" ")
      const computedInvoiceAddress = wantsInvoice
        ? [billingInfo.city, billingInfo.address, billingInfo.postalCode].filter(Boolean).join(", ")
        : ""

      const invoiceData = wantsInvoice
        ? {
            companyName: billingType === "company" ? billingInfo.company.trim() : "",
            eik: billingType === "company" ? billingInfo.eik.trim() : "",
            vatNumber: billingType === "company" ? billingInfo.vatNumber.trim() : "",
            egn: billingType === "individual" ? billingInfo.egn.trim() : "",
            mol: billingName,
            invoiceAddress: computedInvoiceAddress,
          }
        : undefined

      if (paymentMethod === "cod") {
        const result = await createCODOrder({
          cartItems,
          customerInfo,
          deliveryMethod,
          needsInvoice: wantsInvoice,
          invoiceInfo: invoiceData,
          econtOffice,
          speedyOffice,
          promoCode: appliedPromo?.code,
          marketingConsent,
        })

        if (result.success) {
          // Don't clear cart here — the success page handles it after confirmation.
          // Clearing here triggers the empty-cart redirect before navigation completes.
          router.push(`/checkout/success?order_id=${result.orderId}`)
        }
      } else {
        const result = await createCheckoutSession({
          cartItems,
          customerInfo,
          deliveryMethod,
          needsInvoice: wantsInvoice,
          invoiceInfo: invoiceData,
          econtOffice,
          speedyOffice,
          promoCode: appliedPromo?.code,
          marketingConsent,
        })

        if (result.url) {
          // Don't clear cart yet — payment hasn't completed.
          // Cart is cleared on the success page after confirmation.
          window.location.href = result.url
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : ""
      const friendlyMessages: Record<string, string> = {
        "Invalid phone format": "Моля, въведете валиден телефонен номер.",
        "Invalid email format": "Моля, въведете валиден имейл адрес.",
        "First name is required": "Моля, въведете име.",
        "Last name is required": "Моля, въведете фамилия.",
        "City is required": "Моля, въведете град.",
        "Address is required for address delivery": "Моля, въведете адрес за доставка.",
      }
      setError(friendlyMessages[message] || "Възникна грешка при обработката на поръчката. Моля, опитайте отново.")
      setIsLoading(false)
      submittingRef.current = false
    }
  }

  if (!mounted || items.length === 0) {
    return (
      <div className="bg-background py-16 sm:py-20 lg:py-24">
        <div className="mx-auto max-w-4xl px-6 lg:px-8">
          <div className="animate-pulse">
            <div className="h-8 w-48 rounded bg-secondary" />
            <div className="mt-8 h-96 rounded-lg bg-secondary" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-background py-16 sm:py-20 lg:py-24">
      <div className="mx-auto max-w-4xl px-6 lg:px-8">
        <Link
          href="/cart"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Обратно към количката
        </Link>

        <h1 className="mt-6 text-4xl font-light leading-[1.05] tracking-[-0.04em] text-foreground sm:text-5xl">Плащане</h1>

        <form onSubmit={handleSubmit} className="mt-8">
          <div className="grid gap-8 lg:grid-cols-2">
            {/* Customer Information */}
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-primary">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                      1
                    </span>
                    Данни за контакт
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="firstName">Име *</Label>
                      <Input
                        id="firstName"
                        name="firstName"
                        value={customerInfo.firstName}
                        onChange={handleInputChange}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="lastName">Фамилия *</Label>
                      <Input
                        id="lastName"
                        name="lastName"
                        value={customerInfo.lastName}
                        onChange={handleInputChange}
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Имейл *</Label>
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      value={customerInfo.email}
                      onChange={handleInputChange}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">Телефон *</Label>
                    <Input
                      id="phone"
                      name="phone"
                      type="tel"
                      pattern="\+?[0-9\s\-()]*[0-9][0-9\s\-()]*"
                      minLength={6}
                      maxLength={20}
                      title="Въведете валиден телефонен номер (напр. +359888123456)"
                      placeholder="+359"
                      value={customerInfo.phone}
                      onChange={handleInputChange}
                      required
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-primary">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                      2
                    </span>
                    <Truck className="h-4 w-4" />
                    Доставка
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <RadioGroup value={deliveryMethod} onValueChange={(v) => { setDeliveryMethod(v); setOfficePickerError(false) }}>
                    <p className="text-sm font-medium text-foreground mb-2">Еконт</p>
                    <div className="flex items-center space-x-3 rounded-lg border border-border p-4">
                      <RadioGroupItem value="econt-office" id="econt-office" />
                      <Label htmlFor="econt-office" className="flex-1 cursor-pointer">
                        <span className="font-medium">Еконт офис</span>
                        <p className="text-sm text-muted-foreground">До най-близкия офис на Еконт</p>
                      </Label>
                    </div>
                    <p className="text-sm font-medium text-foreground mb-2 mt-4">Speedy</p>
                    <div className="flex items-center space-x-3 rounded-lg border border-border p-4">
                      <RadioGroupItem value="speedy-office" id="speedy-office" />
                      <Label htmlFor="speedy-office" className="flex-1 cursor-pointer">
                        <span className="font-medium">Speedy офис</span>
                        <p className="text-sm text-muted-foreground">До най-близкия офис на Speedy</p>
                      </Label>
                    </div>
                    <div className="flex items-center space-x-3 rounded-lg border border-border p-4">
                      <RadioGroupItem value="speedy-address" id="speedy-address" />
                      <Label htmlFor="speedy-address" className="flex-1 cursor-pointer">
                        <span className="font-medium">Speedy до адрес</span>
                        <p className="text-sm text-muted-foreground">Доставка до посочен адрес</p>
                      </Label>
                    </div>
                  </RadioGroup>

                  {deliveryMethod === "speedy-office" && (
                    <SpeedyOfficePicker
                      selectedOfficeId={selectedSpeedyOffice?.id ?? null}
                      onSelect={setSelectedSpeedyOffice}
                      onError={setOfficePickerError}
                    />
                  )}

                  {deliveryMethod === "econt-office" && (
                    <EcontOfficePicker
                      selectedOfficeId={selectedEcontOffice?.id ?? null}
                      onSelect={setSelectedEcontOffice}
                      onError={setOfficePickerError}
                    />
                  )}

                  <div className="space-y-4 pt-4">
                    {(deliveryMethod === "speedy-address" || officePickerError) && (
                      <div className="space-y-2">
                        <Label htmlFor="city">Град *</Label>
                        <Input
                          id="city"
                          name="city"
                          value={customerInfo.city}
                          onChange={handleInputChange}
                          required
                        />
                      </div>
                    )}
                    {(deliveryMethod === "speedy-address") && (
                      <>
                        <div className="space-y-2">
                          <Label htmlFor="address">Адрес *</Label>
                          <Input
                            id="address"
                            name="address"
                            value={customerInfo.address}
                            onChange={handleInputChange}
                            required={deliveryMethod === "speedy-address"}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="postalCode">Пощенски код</Label>
                          <Input
                            id="postalCode"
                            name="postalCode"
                            value={customerInfo.postalCode}
                            onChange={handleInputChange}
                          />
                        </div>
                      </>
                    )}
                    <div className="space-y-2">
                      <Label htmlFor="notes">Бележки към поръчката</Label>
                      <Input
                        id="notes"
                        name="notes"
                        value={customerInfo.notes}
                        onChange={handleInputChange}
                        placeholder="Допълнителни инструкции..."
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-primary">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                      3
                    </span>
                    <Banknote className="h-4 w-4" />
                    Начин на плащане
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <RadioGroup value={paymentMethod} onValueChange={setPaymentMethod}>
                    <div className="flex items-center space-x-3 rounded-[26px] border border-border/40 p-4 transition-all duration-500">
                      <RadioGroupItem value="card" id="card" />
                      <Label htmlFor="card" className="flex-1 cursor-pointer">
                        <span className="flex items-center gap-2 font-medium">
                          <CreditCard className="h-4 w-4" />
                          Карта
                        </span>
                        <p className="text-sm text-muted-foreground">Сигурно плащане с дебитна/кредитна карта</p>
                      </Label>
                    </div>
                    <div className="flex items-center space-x-3 rounded-[26px] border border-border/40 p-4 transition-all duration-500">
                      <RadioGroupItem value="cod" id="cod" />
                      <Label htmlFor="cod" className="flex-1 cursor-pointer">
                        <span className="flex items-center gap-2 font-medium">
                          <Banknote className="h-4 w-4" />
                          Наложен платеж
                        </span>
                        <p className="text-sm text-muted-foreground">Плащане при доставка (+{formatPrice(COD_FEE)})</p>
                      </Label>
                    </div>
                  </RadioGroup>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-primary">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                      4
                    </span>
                    <FileText className="h-4 w-4" />
                    Фактура
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-start space-x-3">
                    <Checkbox
                      id="wantsInvoice"
                      checked={wantsInvoice}
                      onCheckedChange={(checked) => setWantsInvoice(checked === true)}
                    />
                    <Label htmlFor="wantsInvoice" className="cursor-pointer leading-snug">
                      Искам фактура
                    </Label>
                  </div>

                  {wantsInvoice && (
                    <div className="space-y-4 pt-4 border-t border-border">
                      <div className="grid grid-cols-2 rounded-full border border-border/40 overflow-hidden">
                        <button
                          type="button"
                          className={`px-4 py-2.5 text-[10px] font-medium uppercase tracking-[0.16em] transition-colors ${
                            billingType === "individual"
                              ? "bg-primary text-primary-foreground"
                              : "bg-background text-muted-foreground hover:text-foreground"
                          }`}
                          onClick={() => setBillingType("individual")}
                        >
                          Физическо лице
                        </button>
                        <button
                          type="button"
                          className={`px-4 py-2.5 text-[10px] font-medium uppercase tracking-[0.16em] transition-colors border-l border-border/40 ${
                            billingType === "company"
                              ? "bg-primary text-primary-foreground"
                              : "bg-background text-muted-foreground hover:text-foreground"
                          }`}
                          onClick={() => setBillingType("company")}
                        >
                          Юридическо лице
                        </button>
                      </div>

                      {billingType === "company" && (
                        <>
                          <div className="space-y-2">
                            <Label htmlFor="billingCompany">Име на фирмата *</Label>
                            <Input
                              id="billingCompany"
                              name="company"
                              value={billingInfo.company}
                              onChange={handleBillingChange}
                              required={wantsInvoice && billingType === "company"}
                            />
                          </div>
                          <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                              <Label htmlFor="billingEik">ЕИК / Булстат *</Label>
                              <Input
                                id="billingEik"
                                name="eik"
                                value={billingInfo.eik}
                                onChange={handleBillingChange}
                                required={wantsInvoice && billingType === "company"}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="billingVatNumber">ДДС номер</Label>
                              <Input
                                id="billingVatNumber"
                                name="vatNumber"
                                value={billingInfo.vatNumber}
                                onChange={handleBillingChange}
                                placeholder="BG..."
                              />
                            </div>
                          </div>
                          <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                              <Label htmlFor="billingFirstName">МОЛ - Име *</Label>
                              <Input
                                id="billingFirstName"
                                name="firstName"
                                value={billingInfo.firstName}
                                onChange={handleBillingChange}
                                required={wantsInvoice && billingType === "company"}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="billingLastName">МОЛ - Фамилия *</Label>
                              <Input
                                id="billingLastName"
                                name="lastName"
                                value={billingInfo.lastName}
                                onChange={handleBillingChange}
                                required={wantsInvoice && billingType === "company"}
                              />
                            </div>
                          </div>
                        </>
                      )}

                      {billingType === "individual" && (
                        <>
                          <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                              <Label htmlFor="billingFirstName">Име *</Label>
                              <Input
                                id="billingFirstName"
                                name="firstName"
                                value={billingInfo.firstName}
                                onChange={handleBillingChange}
                                required={wantsInvoice && billingType === "individual"}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="billingLastName">Фамилия *</Label>
                              <Input
                                id="billingLastName"
                                name="lastName"
                                value={billingInfo.lastName}
                                onChange={handleBillingChange}
                                required={wantsInvoice && billingType === "individual"}
                              />
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="billingEgn">ЕГН *</Label>
                            <Input
                              id="billingEgn"
                              name="egn"
                              value={billingInfo.egn}
                              onChange={handleBillingChange}
                              required={wantsInvoice && billingType === "individual"}
                              placeholder="10 цифри"
                              maxLength={10}
                            />
                          </div>
                        </>
                      )}

                      <div className="space-y-2">
                        <Label htmlFor="billingAddress">
                          {billingType === "company" ? "Адрес по регистрация *" : "Адрес *"}
                        </Label>
                        <Input
                          id="billingAddress"
                          name="address"
                          value={billingInfo.address}
                          onChange={handleBillingChange}
                          required={wantsInvoice}
                        />
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="billingCity">Град *</Label>
                          <Input
                            id="billingCity"
                            name="city"
                            value={billingInfo.city}
                            onChange={handleBillingChange}
                            required={wantsInvoice}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="billingPostalCode">Пощенски код</Label>
                          <Input
                            id="billingPostalCode"
                            name="postalCode"
                            value={billingInfo.postalCode}
                            onChange={handleBillingChange}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                      5
                    </span>
                    <ShieldCheck className="h-4 w-4" />
                    Съгласия
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className={`flex items-start space-x-3 rounded-lg p-3 -mx-3`}>
                    <Checkbox
                      id="acceptedTerms"
                      checked={acceptedTerms}
                      onCheckedChange={(checked) => setAcceptedTerms(checked === true)}
                      className="mt-0.5"
                      required
                    />
                    <label htmlFor="acceptedTerms" className="cursor-pointer text-sm font-medium leading-snug text-foreground">
                      Приемам <a href="/terms" target="_blank" rel="noopener noreferrer" className="whitespace-nowrap text-foreground underline underline-offset-2 hover:text-accent">Условията за ползване</a> и <a href="/privacy" target="_blank" rel="noopener noreferrer" className="whitespace-nowrap text-foreground underline underline-offset-2 hover:text-accent">Политиката за поверителност</a>
                    </label>
                  </div>
                  <div className="flex items-start space-x-3">
                    <Checkbox
                      id="marketingConsent"
                      checked={marketingConsent}
                      onCheckedChange={(checked) => setMarketingConsent(checked === true)}
                    />
                    <label htmlFor="marketingConsent" className="cursor-pointer font-medium text-sm leading-snug text-foreground">
                      Искам да получавам имейли с промоции и новини от Egg Origin
                    </label>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Order Summary */}
            <div>
              <Card className="sticky top-24">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-primary">
                    <CreditCard className="h-4 w-4" />
                    Вашата поръчка
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {items.map((item) => (
                    <div key={item.product.id} className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        {item.product.name} x {item.quantity}
                      </span>
                      <span className="text-foreground">
                        {formatPrice(item.product.priceInCents * item.quantity)}
                      </span>
                    </div>
                  ))}
                  <div className="border-t border-border pt-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Междинна сума</span>
                      <span className="text-foreground">{formatPrice(totalPrice)}</span>
                    </div>
                    {items.some((item) => isOnSale(item.product)) && (
                      <div className="mt-2 flex justify-between text-sm text-green-600">
                        <span>Спестявате</span>
                        <span>-{formatPrice(items.reduce((s, item) =>
                          s + (isOnSale(item.product)
                            ? ((item.product.originalPriceInCents ?? item.product.priceInCents) - item.product.priceInCents) * item.quantity
                            : 0), 0))}
                        </span>
                      </div>
                    )}
                    <div className="mt-2 flex justify-between text-sm">
                      <span className="flex items-center gap-1 text-muted-foreground">
                        Доставка ({deliveryMethod.startsWith("speedy") ? "Speedy" : "Еконт"})
                        <Dialog>
                          <DialogTrigger asChild>
                            <button type="button" className="inline-flex text-muted-foreground/60 hover:text-foreground transition-colors">
                              <HelpCircle className="h-3.5 w-3.5" />
                            </button>
                          </DialogTrigger>
                          <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
                            <DialogHeader>
                              <DialogTitle>Доставка</DialogTitle>
                            </DialogHeader>
                            <DeliveryInfo />
                          </DialogContent>
                        </Dialog>
                      </span>
                      <span className="text-foreground">
                        {shippingPrice === 0 ? "Безплатна" : formatPrice(shippingPrice)}
                      </span>
                    </div>
                    {selectedSpeedyOffice && deliveryMethod === "speedy-office" && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Офис: {selectedSpeedyOffice.name}, {selectedSpeedyOffice.city}
                      </p>
                    )}
                    {selectedEcontOffice && deliveryMethod === "econt-office" && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Офис: {selectedEcontOffice.name}, {selectedEcontOffice.city}
                      </p>
                    )}
                    {codFee > 0 && (
                      <div className="mt-2 flex justify-between text-sm">
                        <span className="text-muted-foreground">Наложен платеж</span>
                        <span className="text-foreground">{formatPrice(codFee)}</span>
                      </div>
                    )}
                    {discountAmount > 0 && (
                      <div className="mt-2 flex justify-between text-sm text-green-600">
                        <span>Отстъпка ({appliedPromo?.code})</span>
                        <span>-{formatPrice(discountAmount)}</span>
                      </div>
                    )}
                  </div>

                  {/* Promo code */}
                  <div className="border-t border-border pt-4">
                    <Label className="text-sm text-muted-foreground">Код за отстъпка</Label>
                    {appliedPromo ? (
                      <div className="mt-2 flex items-center justify-between rounded-md bg-green-50 px-3 py-2">
                        <span className="text-sm font-medium text-green-700">{appliedPromo.code}</span>
                        <button
                          type="button"
                          className="text-xs text-muted-foreground hover:text-foreground"
                          onClick={handleRemovePromo}
                        >
                          Премахни
                        </button>
                      </div>
                    ) : (
                      <div className="mt-2 flex gap-2">
                        <Input
                          placeholder="Въведете код"
                          value={promoCode}
                          onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                          className="flex-1 uppercase"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={promoLoading || !promoCode.trim()}
                          onClick={handleApplyPromo}
                        >
                          {promoLoading ? "..." : "Приложи"}
                        </Button>
                      </div>
                    )}
                    {promoError && (
                      <p className="mt-1 text-xs text-destructive">{promoError}</p>
                    )}
                  </div>

                  <div className="border-t border-border pt-4">
                    <div className="flex justify-between">
                      <span className="font-semibold text-foreground">Общо</span>
                      <span className="text-xl font-bold text-primary">{formatPrice(finalPrice)}</span>
                    </div>
                  </div>

                  {stockWarnings.length > 0 && (
                    <div className="rounded border border-destructive/40 bg-destructive/5 p-3 space-y-1">
                      {stockWarnings.map((w) => (
                        <p key={w.productName} className="text-sm text-destructive">
                          {w.available === 0
                            ? `${w.productName} е изчерпан`
                            : `Недостатъчна наличност на ${w.productName}. Налични ${w.available}бр.`}
                        </p>
                      ))}
                      <p className="text-xs text-muted-foreground">Моля, актуализирайте количката.</p>
                    </div>
                  )}

                  {error && (
                    <p className="text-sm text-destructive">{error}</p>
                  )}

                  <Button type="submit" className="mt-6 h-11 w-full gap-2 rounded-full bg-primary text-[10px] uppercase tracking-[0.16em] text-primary-foreground hover:opacity-90" size="lg" disabled={isLoading || stockWarnings.length > 0}>
                    {isLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Обработка...
                      </>
                    ) : paymentMethod === "card" ? (
                      "Плати с карта"
                    ) : (
                      "Завърши поръчката"
                    )}
                  </Button>

                  <p className="text-center text-xs text-muted-foreground">
                    {paymentMethod === "card"
                      ? "Сигурно плащане чрез Stripe. Вашите данни са защитени."
                      : "Ще платите при получаване на пратката."}
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
