import { describe, it, expect } from "vitest"
import { buildOrderConfirmationEmail } from "@/lib/email-template"

const baseEmailData = {
  orderId: "550e8400-e29b-41d4-a716-446655440000",
  firstName: "Иван",
  items: [{ productId: "egg-origin-dark-chocolate-box", productName: "Dark Chocolate Box", quantity: 1, priceInCents: 2570 }],
  subtotal: 2570,
  shippingFee: 300,
  codFee: 0,
  discountAmount: 0,
  promoCode: null,
  totalAmount: 2870,
  date: "2026-04-16T10:00:00.000Z",
}

describe("buildOrderConfirmationEmail", () => {
  it("includes Stripe receipt link for card payments when URL provided", () => {
    const { html, text } = buildOrderConfirmationEmail({
      ...baseEmailData,
      paymentMethod: "card",
      stripeReceiptUrl: "https://pay.stripe.com/receipts/test_abc",
    })

    expect(html).toContain("https://pay.stripe.com/receipts/test_abc")
    expect(html).toContain("Разписка за картово плащане (Stripe)")
    expect(text).toContain("Разписка за картово плащане (Stripe)")
    expect(text).toContain("https://pay.stripe.com/receipts/test_abc")
  })

  it("omits receipt link when stripeReceiptUrl is null", () => {
    const { html, text } = buildOrderConfirmationEmail({
      ...baseEmailData,
      paymentMethod: "card",
      stripeReceiptUrl: null,
    })

    expect(html).not.toContain("Разписка за картово плащане")
    expect(text).not.toContain("Разписка за картово плащане")
  })

  it("omits receipt link when stripeReceiptUrl is not provided", () => {
    const { html, text } = buildOrderConfirmationEmail({
      ...baseEmailData,
      paymentMethod: "card",
    })

    expect(html).not.toContain("Разписка за картово плащане")
    expect(text).not.toContain("Разписка за картово плащане")
  })

  it("omits receipt link for COD payments", () => {
    const { html, text } = buildOrderConfirmationEmail({
      ...baseEmailData,
      paymentMethod: "cod",
      codFee: 200,
      totalAmount: 3070,
      stripeReceiptUrl: null,
    })

    expect(html).not.toContain("Разписка за картово плащане")
    expect(text).not.toContain("Разписка за картово плащане")
  })

  it("HTML-escapes the receipt URL", () => {
    const { html } = buildOrderConfirmationEmail({
      ...baseEmailData,
      paymentMethod: "card",
      stripeReceiptUrl: "https://pay.stripe.com/receipts/test?foo=1&bar=2",
    })

    // The & in the URL should be escaped to &amp; in HTML
    expect(html).toContain("https://pay.stripe.com/receipts/test?foo=1&amp;bar=2")
  })

  it("never labels the receipt link as фактура or касов бон", () => {
    const { html, text } = buildOrderConfirmationEmail({
      ...baseEmailData,
      paymentMethod: "card",
      stripeReceiptUrl: "https://pay.stripe.com/receipts/test",
    })

    expect(html).not.toContain("фактура")
    expect(html).not.toContain("Фактура")
    expect(html).not.toContain("касов бон")
    expect(html).not.toContain("системен бон")
    expect(text).not.toContain("фактура")
    expect(text).not.toContain("касов бон")
  })
})
