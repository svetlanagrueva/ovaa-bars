"use client"

import React from "react"
import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Truck, CreditCard, Loader2, Banknote, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Checkbox } from "@/components/ui/checkbox"
import { useCartStore } from "@/lib/store/cart"
import { formatPrice } from "@/lib/products"
import { createCheckoutSession, createCODOrder } from "@/app/actions/stripe"
import { FREE_SHIPPING_THRESHOLD, SHIPPING_PRICE, COD_FEE } from "@/lib/constants"
import { EcontOfficePicker, type EcontOfficeOption } from "@/components/econt-office-picker"

const econtEnabled = process.env.NEXT_PUBLIC_ECONT_ENABLED === "true"

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

interface InvoiceInfo {
  companyName: string
  eik: string
  vatNumber: string
  mol: string
  invoiceAddress: string
}

export default function CheckoutPage() {
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [paymentMethod, setPaymentMethod] = useState("card")
  const [deliveryMethod, setDeliveryMethod] = useState("speedy-office")
  const [needsInvoice, setNeedsInvoice] = useState(false)
  const [selectedEcontOffice, setSelectedEcontOffice] = useState<EcontOfficeOption | null>(null)
  const { items, getTotalPrice, clearCart } = useCartStore()

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

  const [invoiceInfo, setInvoiceInfo] = useState<InvoiceInfo>({
    companyName: "",
    eik: "",
    vatNumber: "",
    mol: "",
    invoiceAddress: "",
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

  const totalPrice = getTotalPrice()
  const shippingPrice = totalPrice >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_PRICE
  const codFee = paymentMethod === "cod" ? COD_FEE : 0
  const finalPrice = totalPrice + shippingPrice + codFee

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setCustomerInfo((prev) => ({ ...prev, [name]: value }))
  }

  const handleInvoiceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setInvoiceInfo((prev) => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    try {
      if (deliveryMethod === "econt-office" && !selectedEcontOffice) {
        setError("Моля, изберете офис на Еконт")
        setIsLoading(false)
        return
      }

      const cartItems = items.map((item) => ({
        productId: item.product.id,
        quantity: item.quantity,
      }))

      const econtOffice = deliveryMethod === "econt-office" && selectedEcontOffice
        ? { id: selectedEcontOffice.id, name: selectedEcontOffice.name, city: selectedEcontOffice.city, fullAddress: selectedEcontOffice.fullAddress }
        : undefined

      if (paymentMethod === "cod") {
        const result = await createCODOrder({
          cartItems,
          customerInfo,
          deliveryMethod,
          needsInvoice,
          invoiceInfo: needsInvoice ? invoiceInfo : undefined,
          econtOffice,
        })

        if (result.success) {
          clearCart()
          router.push(`/checkout/success?order_id=${result.orderId}`)
        }
      } else {
        const result = await createCheckoutSession({
          cartItems,
          customerInfo,
          deliveryMethod,
          needsInvoice,
          invoiceInfo: needsInvoice ? invoiceInfo : undefined,
          econtOffice,
        })

        if (result.url) {
          // Don't clear cart yet — payment hasn't completed.
          // Cart is cleared on the success page after confirmation.
          window.location.href = result.url
        }
      }
    } catch {
      setError("Възникна грешка при обработката на поръчката. Моля, опитайте отново.")
      setIsLoading(false)
    }
  }

  if (!mounted || items.length === 0) {
    return (
      <div className="bg-background py-12 sm:py-16">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <div className="animate-pulse">
            <div className="h-8 w-48 rounded bg-secondary" />
            <div className="mt-8 h-96 rounded-lg bg-secondary" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-background py-12 sm:py-16">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <Link
          href="/cart"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Обратно към количката
        </Link>

        <h1 className="mt-6 text-3xl font-bold tracking-tight text-foreground">Плащане</h1>

        <form onSubmit={handleSubmit} className="mt-8">
          <div className="grid gap-8 lg:grid-cols-2">
            {/* Customer Information */}
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
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
                  <CardTitle className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                      2
                    </span>
                    <Truck className="h-4 w-4" />
                    Доставка
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <RadioGroup value={deliveryMethod} onValueChange={setDeliveryMethod}>
                    <p className="text-sm font-medium text-foreground mb-2">Speedy</p>
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
                    {econtEnabled && (
                      <>
                        <p className="text-sm font-medium text-foreground mb-2 mt-4">Еконт</p>
                        <div className="flex items-center space-x-3 rounded-lg border border-border p-4">
                          <RadioGroupItem value="econt-office" id="econt-office" />
                          <Label htmlFor="econt-office" className="flex-1 cursor-pointer">
                            <span className="font-medium">Еконт офис</span>
                            <p className="text-sm text-muted-foreground">До най-близкия офис на Еконт</p>
                          </Label>
                        </div>
                        <div className="flex items-center space-x-3 rounded-lg border border-border p-4">
                          <RadioGroupItem value="econt-address" id="econt-address" />
                          <Label htmlFor="econt-address" className="flex-1 cursor-pointer">
                            <span className="font-medium">Еконт до адрес</span>
                            <p className="text-sm text-muted-foreground">Доставка до посочен адрес</p>
                          </Label>
                        </div>
                      </>
                    )}
                  </RadioGroup>

                  {deliveryMethod === "econt-office" && econtEnabled && (
                    <EcontOfficePicker
                      selectedOfficeId={selectedEcontOffice?.id ?? null}
                      onSelect={setSelectedEcontOffice}
                    />
                  )}

                  <div className="space-y-4 pt-4">
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
                    {(deliveryMethod === "speedy-address" || deliveryMethod === "econt-address") && (
                      <>
                        <div className="space-y-2">
                          <Label htmlFor="address">Адрес *</Label>
                          <Input
                            id="address"
                            name="address"
                            value={customerInfo.address}
                            onChange={handleInputChange}
                            required={deliveryMethod === "speedy-address" || deliveryMethod === "econt-address"}
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
                  <CardTitle className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                      3
                    </span>
                    <Banknote className="h-4 w-4" />
                    Начин на плащане
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <RadioGroup value={paymentMethod} onValueChange={setPaymentMethod}>
                    <div className="flex items-center space-x-3 rounded-lg border border-border p-4">
                      <RadioGroupItem value="card" id="card" />
                      <Label htmlFor="card" className="flex-1 cursor-pointer">
                        <span className="flex items-center gap-2 font-medium">
                          <CreditCard className="h-4 w-4" />
                          Карта
                        </span>
                        <p className="text-sm text-muted-foreground">Сигурно плащане с дебитна/кредитна карта</p>
                      </Label>
                    </div>
                    <div className="flex items-center space-x-3 rounded-lg border border-border p-4">
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
                  <CardTitle className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                      4
                    </span>
                    <FileText className="h-4 w-4" />
                    Фактура
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center space-x-3">
                    <Checkbox
                      id="needsInvoice"
                      checked={needsInvoice}
                      onCheckedChange={(checked) => setNeedsInvoice(checked === true)}
                    />
                    <Label htmlFor="needsInvoice" className="cursor-pointer">
                      Искам фактура за юридическо лице
                    </Label>
                  </div>

                  {needsInvoice && (
                    <div className="space-y-4 pt-4 border-t border-border">
                      <div className="space-y-2">
                        <Label htmlFor="companyName">Име на фирмата *</Label>
                        <Input
                          id="companyName"
                          name="companyName"
                          value={invoiceInfo.companyName}
                          onChange={handleInvoiceChange}
                          required={needsInvoice}
                        />
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="eik">ЕИК *</Label>
                          <Input
                            id="eik"
                            name="eik"
                            value={invoiceInfo.eik}
                            onChange={handleInvoiceChange}
                            required={needsInvoice}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="vatNumber">ДДС номер</Label>
                          <Input
                            id="vatNumber"
                            name="vatNumber"
                            placeholder="BG..."
                            value={invoiceInfo.vatNumber}
                            onChange={handleInvoiceChange}
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="mol">МОЛ *</Label>
                        <Input
                          id="mol"
                          name="mol"
                          value={invoiceInfo.mol}
                          onChange={handleInvoiceChange}
                          required={needsInvoice}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="invoiceAddress">Адрес по регистрация *</Label>
                        <Input
                          id="invoiceAddress"
                          name="invoiceAddress"
                          value={invoiceInfo.invoiceAddress}
                          onChange={handleInvoiceChange}
                          required={needsInvoice}
                        />
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Order Summary */}
            <div>
              <Card className="sticky top-24">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
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
                    <div className="mt-2 flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        Доставка ({deliveryMethod.startsWith("speedy") ? "Speedy" : "Еконт"})
                      </span>
                      <span className="text-foreground">
                        {shippingPrice === 0 ? "Безплатна" : formatPrice(shippingPrice)}
                      </span>
                    </div>
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
                  </div>
                  <div className="border-t border-border pt-4">
                    <div className="flex justify-between">
                      <span className="font-semibold text-foreground">Общо</span>
                      <span className="text-xl font-bold text-primary">{formatPrice(finalPrice)}</span>
                    </div>
                  </div>

                  {error && (
                    <p className="text-sm text-destructive">{error}</p>
                  )}

                  <Button type="submit" className="mt-6 w-full" size="lg" disabled={isLoading}>
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
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
