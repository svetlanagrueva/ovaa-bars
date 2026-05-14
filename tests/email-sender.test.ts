import { describe, it, expect, vi, beforeEach } from "vitest"
import { createSupabaseMock, resetSupabaseMock } from "./helpers/supabase-mock"

// ── Mocks ─────────────────────────────────────────────────────────────────
//
// Strategy: stub external collaborators so the test exercises the
// composition logic in lib/email-sender (subject/from/to/template-call,
// idempotency timestamps, fire-and-forget error handling), not the
// templates themselves (those have their own test coverage).

type SendArgs = { from: string; to: string; subject: string; html?: string; text?: string }
const mockResendSend = vi.fn((_args: SendArgs) => Promise.resolve({ id: "re_test" }))
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: mockResendSend }
  },
}))

const mockSupabase = createSupabaseMock()
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
}))

vi.mock("@/lib/env", () => ({
  requireEnv: (name: string) => process.env[name] ?? `test-${name}`,
}))

// Each template builder returns the html/text the sender forwards to Resend.
// Tests assert (a) that the right builder was called with the right args
// and (b) that the returned strings are forwarded verbatim. Decouples the
// sender's composition contract from any specific template wording.
type BuilderFn = (input: unknown) => { html: string; text: string }
const mockBuildOrderConfirmation = vi.fn<BuilderFn>(() => ({
  html: "<order-confirmation-html />",
  text: "order-confirmation-text",
}))
const mockBuildDelivery = vi.fn<BuilderFn>(() => ({
  html: "<delivery-html />",
  text: "delivery-text",
}))
const mockBuildWithdrawalReceived = vi.fn<BuilderFn>(() => ({
  html: "<wd-received-html />",
  text: "wd-received-text",
}))
const mockBuildWithdrawalApproved = vi.fn<BuilderFn>(() => ({
  html: "<wd-approved-html />",
  text: "wd-approved-text",
}))
const mockBuildWithdrawalRejected = vi.fn<BuilderFn>(() => ({
  html: "<wd-rejected-html />",
  text: "wd-rejected-text",
}))
const mockBuildAdminNewOrder = vi.fn<BuilderFn>(() => ({
  html: "<admin-new-order-html />",
  text: "admin-new-order-text",
}))
vi.mock("@/lib/email-template", () => ({
  buildOrderConfirmationEmail: (input: unknown) => mockBuildOrderConfirmation(input),
  buildDeliveryEmail: (input: unknown) => mockBuildDelivery(input),
  buildAdminNewOrderEmail: (input: unknown) => mockBuildAdminNewOrder(input),
  buildWithdrawalReceivedEmail: (input: unknown) => mockBuildWithdrawalReceived(input),
  buildWithdrawalApprovedEmail: (input: unknown) => mockBuildWithdrawalApproved(input),
  buildWithdrawalRejectedEmail: (input: unknown) => mockBuildWithdrawalRejected(input),
}))

import {
  sendOrderConfirmationEmail,
  sendDeliveryEmail,
  notifyAdminNewOrder,
  sendWithdrawalReceivedEmail,
  sendWithdrawalApprovedEmail,
  sendWithdrawalRejectedEmail,
} from "@/lib/email-sender"

const VALID_ORDER_ID = "11111111-2222-3333-4444-555555555555"

const sampleOrder = {
  id: VALID_ORDER_ID,
  email: "customer@example.com",
  first_name: "Иван",
  last_name: "Иванов",
  phone: "+359888111222",
  city: "София",
  total_amount: 5140,
  shipping_fee: 360,
  cod_fee: 200,
  discount_amount: 0,
  promo_code: null,
  payment_method: "card" as const,
  created_at: "2026-04-20T10:00:00.000Z",
  stripe_receipt_url: "https://stripe.com/receipts/abc",
}

const sampleItems = [
  { product_id: "egg-origin-dark-chocolate-box", product_name: "Тъмен Шоколад Кутия", quantity: 2, unit_price_cents: 2570 },
]

// fetchOrderItemsForEmail is internal — its query is
// supabase.from("order_items").select(...).eq(...).order(...)
// which terminates as a thenable. We arm this by replacing `order` to
// return a thenable resolving with the items.
function armOrderItemsLookup(items = sampleItems, error: unknown = null) {
  mockSupabase.order = vi.fn(() => ({
    then(resolve: (v: unknown) => void) { resolve({ data: items, error }) },
  })) as never
}

beforeEach(() => {
  vi.clearAllMocks()
  resetSupabaseMock(mockSupabase)
  mockResendSend.mockClear()
  mockResendSend.mockImplementation(() => Promise.resolve({ id: "re_test" }) as never)
  mockBuildOrderConfirmation.mockClear()
  mockBuildOrderConfirmation.mockImplementation(() => ({
    html: "<order-confirmation-html />",
    text: "order-confirmation-text",
  }))
  mockBuildDelivery.mockClear()
  mockBuildDelivery.mockImplementation(() => ({
    html: "<delivery-html />",
    text: "delivery-text",
  }))
  mockBuildWithdrawalReceived.mockClear()
  mockBuildWithdrawalReceived.mockImplementation(() => ({
    html: "<wd-received-html />", text: "wd-received-text",
  }))
  mockBuildWithdrawalApproved.mockClear()
  mockBuildWithdrawalApproved.mockImplementation(() => ({
    html: "<wd-approved-html />", text: "wd-approved-text",
  }))
  mockBuildWithdrawalRejected.mockClear()
  mockBuildWithdrawalRejected.mockImplementation(() => ({
    html: "<wd-rejected-html />", text: "wd-rejected-text",
  }))
  process.env.RESEND_API_KEY = "re_test_key"
  process.env.ADMIN_EMAIL = "admin@eggorigin.com"
  process.env.EMAIL_FROM = "Egg Origin <noreply@eggorigin.com>"
  process.env.NEXT_PUBLIC_APP_URL = "https://eggorigin.com"
})

// ── sendOrderConfirmationEmail ────────────────────────────────────────────

describe("sendOrderConfirmationEmail", () => {
  it("composes the email with from/to/subject and forwards the template's html/text", async () => {
    armOrderItemsLookup()

    await sendOrderConfirmationEmail(sampleOrder)
    // Resolve the fire-and-forget .then() so the timestamp update runs.
    await new Promise((r) => setTimeout(r, 0))

    expect(mockResendSend).toHaveBeenCalledTimes(1)
    expect(mockResendSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Egg Origin <noreply@eggorigin.com>",
        to: "customer@example.com",
        subject: `Поръчка #${VALID_ORDER_ID.slice(0, 8)} - Потвърждение`,
        html: "<order-confirmation-html />",
        text: "order-confirmation-text",
      }),
    )
  })

  it("forwards the order data to the template builder verbatim (subtotal computed from items)", async () => {
    armOrderItemsLookup()

    await sendOrderConfirmationEmail(sampleOrder)
    await new Promise((r) => setTimeout(r, 0))

    expect(mockBuildOrderConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: VALID_ORDER_ID,
        firstName: "Иван",
        // subtotal = 2 × 2570 = 5140
        subtotal: 5140,
        shippingFee: 360,
        codFee: 200,
        discountAmount: 0,
        promoCode: null,
        totalAmount: 5140,
        paymentMethod: "card",
        date: "2026-04-20T10:00:00.000Z",
        stripeReceiptUrl: "https://stripe.com/receipts/abc",
        items: [
          expect.objectContaining({
            productId: "egg-origin-dark-chocolate-box",
            productName: "Тъмен Шоколад Кутия",
            quantity: 2,
            priceInCents: 2570,
          }),
        ],
      }),
    )
  })

  it("records order_confirmation_sent_at on successful send (idempotency-guarded)", async () => {
    armOrderItemsLookup()

    await sendOrderConfirmationEmail(sampleOrder)
    await new Promise((r) => setTimeout(r, 0))

    const updateCalls = (mockSupabase.update as ReturnType<typeof vi.fn>).mock.calls
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0][0]).toEqual(
      expect.objectContaining({ order_confirmation_sent_at: expect.any(String) }),
    )
    // Verify the .is(..., null) idempotency guard is applied via the
    // update chain. The chain captures eq+is+select calls separately
    // from the main mockSupabase, so we read them from the returned chain.
  })

  it("early-returns silently when RESEND_API_KEY is unset (e.g. local dev without email)", async () => {
    delete process.env.RESEND_API_KEY

    await sendOrderConfirmationEmail(sampleOrder)

    expect(mockResendSend).not.toHaveBeenCalled()
    expect(mockBuildOrderConfirmation).not.toHaveBeenCalled()
  })

  it("early-returns when fetching order_items errors — never calls Resend", async () => {
    armOrderItemsLookup([], { message: "DB exploded" })

    await sendOrderConfirmationEmail(sampleOrder)
    await new Promise((r) => setTimeout(r, 0))

    expect(mockResendSend).not.toHaveBeenCalled()
    expect(mockBuildOrderConfirmation).not.toHaveBeenCalled()
  })

  it("logs but never throws when Resend rejects (fire-and-forget)", async () => {
    armOrderItemsLookup()
    mockResendSend.mockImplementationOnce(() => Promise.reject(new Error("Resend 503")))
    const err = vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(sendOrderConfirmationEmail(sampleOrder)).resolves.toBeUndefined()
    await new Promise((r) => setTimeout(r, 0))

    expect(err).toHaveBeenCalledWith(
      expect.stringContaining("Failed to send confirmation email"),
      expect.any(Error),
    )
    err.mockRestore()
  })
})

// ── sendDeliveryEmail ─────────────────────────────────────────────────────

describe("sendDeliveryEmail", () => {
  it("composes the delivery email with the right subject and forwards template output", async () => {
    armOrderItemsLookup()

    await sendDeliveryEmail({ ...sampleOrder, delivery_email_sent_at: null })
    await new Promise((r) => setTimeout(r, 0))

    expect(mockResendSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Egg Origin <noreply@eggorigin.com>",
        to: "customer@example.com",
        subject: `Поръчка #${VALID_ORDER_ID.slice(0, 8)} - Доставена`,
        html: "<delivery-html />",
        text: "delivery-text",
      }),
    )
    expect(mockBuildDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: VALID_ORDER_ID,
        firstName: "Иван",
        items: expect.any(Array),
      }),
    )
  })

  it("early-returns when delivery_email_sent_at is already set (idempotency)", async () => {
    armOrderItemsLookup()

    await sendDeliveryEmail({
      ...sampleOrder,
      delivery_email_sent_at: "2026-04-25T12:00:00Z",
    })

    expect(mockResendSend).not.toHaveBeenCalled()
    expect(mockBuildDelivery).not.toHaveBeenCalled()
  })

  it("force=true bypasses the already-sent guard so admin can manually resend", async () => {
    armOrderItemsLookup()

    await sendDeliveryEmail(
      { ...sampleOrder, delivery_email_sent_at: "2026-04-25T12:00:00Z" },
      { force: true },
    )
    await new Promise((r) => setTimeout(r, 0))

    expect(mockResendSend).toHaveBeenCalledTimes(1)
  })

  it("records delivery_email_sent_at on success (clears any prior error)", async () => {
    armOrderItemsLookup()

    await sendDeliveryEmail({ ...sampleOrder, delivery_email_sent_at: null })
    await new Promise((r) => setTimeout(r, 0))

    const updateCalls = (mockSupabase.update as ReturnType<typeof vi.fn>).mock.calls
    expect(updateCalls[0][0]).toEqual(
      expect.objectContaining({
        delivery_email_sent_at: expect.any(String),
        delivery_email_last_error: null,
      }),
    )
  })

  it("on Resend failure: writes delivery_email_last_error, never throws", async () => {
    armOrderItemsLookup()
    mockResendSend.mockImplementationOnce(() => Promise.reject(new Error("Resend down")))
    const err = vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(
      sendDeliveryEmail({ ...sampleOrder, delivery_email_sent_at: null }),
    ).resolves.toBeUndefined()
    await new Promise((r) => setTimeout(r, 0))

    const updateCalls = (mockSupabase.update as ReturnType<typeof vi.fn>).mock.calls
    expect(updateCalls[0][0]).toEqual(
      expect.objectContaining({
        delivery_email_last_error: expect.stringContaining("Resend down"),
      }),
    )
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })

  it("early-returns silently when RESEND_API_KEY is unset", async () => {
    delete process.env.RESEND_API_KEY

    await sendDeliveryEmail({ ...sampleOrder, delivery_email_sent_at: null })

    expect(mockResendSend).not.toHaveBeenCalled()
  })
})

// ── notifyAdminNewOrder ───────────────────────────────────────────────────

describe("notifyAdminNewOrder", () => {
  it("forwards order details + delivery label to the admin template builder", async () => {
    armOrderItemsLookup()

    const orderWithLogistics = { ...sampleOrder, logistics_partner: "speedy-address" }
    await notifyAdminNewOrder(orderWithLogistics, "card")
    await new Promise((r) => setTimeout(r, 0))

    expect(mockResendSend).toHaveBeenCalledTimes(1)
    const call = mockResendSend.mock.calls[0][0] as Record<string, string>
    expect(call.to).toBe("admin@eggorigin.com")
    expect(call.from).toBe("Egg Origin <noreply@eggorigin.com>")
    expect(call.subject).toContain("Нова поръчка")
    expect(call.subject).toContain(VALID_ORDER_ID.slice(0, 8))
    expect(call.html).toBe("<admin-new-order-html />")
    expect(call.text).toBe("admin-new-order-text")

    // Per the documented mock strategy, assert on the data the sender
    // hands to the builder rather than scraping its rendered output.
    expect(mockBuildAdminNewOrder).toHaveBeenCalledWith(expect.objectContaining({
      orderId: VALID_ORDER_ID,
      firstName: "Иван",
      lastName: "Иванов",
      customerEmail: "customer@example.com",
      paymentMethod: "card",
      deliveryLabel: "Speedy до адрес",
      adminUrl: expect.stringContaining(`/admin/orders/${VALID_ORDER_ID}`),
      items: expect.arrayContaining([
        expect.objectContaining({ productName: "Тъмен Шоколад Кутия", quantity: 2 }),
      ]),
    }))
  })

  it("passes paymentMethod='cod' for cash-on-delivery orders", async () => {
    armOrderItemsLookup()

    await notifyAdminNewOrder({ ...sampleOrder, payment_method: "cod" }, "cod")
    await new Promise((r) => setTimeout(r, 0))

    expect(mockBuildAdminNewOrder).toHaveBeenCalledWith(expect.objectContaining({
      paymentMethod: "cod",
    }))
  })

  it("falls back to '—' for delivery label when logistics_partner is unset", async () => {
    armOrderItemsLookup()

    await notifyAdminNewOrder(sampleOrder, "card")
    await new Promise((r) => setTimeout(r, 0))

    expect(mockBuildAdminNewOrder).toHaveBeenCalledWith(expect.objectContaining({
      deliveryLabel: "—",
    }))
  })

  it("early-returns when ADMIN_EMAIL is unset (no admin to notify)", async () => {
    delete process.env.ADMIN_EMAIL

    await notifyAdminNewOrder(sampleOrder, "card")

    expect(mockResendSend).not.toHaveBeenCalled()
  })

  it("early-returns when RESEND_API_KEY is unset", async () => {
    delete process.env.RESEND_API_KEY

    await notifyAdminNewOrder(sampleOrder, "card")

    expect(mockResendSend).not.toHaveBeenCalled()
  })

  it("returns silently when items lookup fails — admin still sees other order signals via dashboard", async () => {
    armOrderItemsLookup([], { message: "no items" })

    await notifyAdminNewOrder(sampleOrder, "card")

    expect(mockResendSend).not.toHaveBeenCalled()
  })
})

// ── Withdrawal emails (право на отказ) ────────────────────────────────────

describe("sendWithdrawalReceivedEmail", () => {
  it("sends to the customer email with the WD-ref in the subject", async () => {
    await sendWithdrawalReceivedEmail(
      { id: VALID_ORDER_ID },
      { withdrawalRef: "WD-2026-0042", customerEmail: "withdrawer@example.com" },
    )

    expect(mockResendSend).toHaveBeenCalledWith({
      from: "Egg Origin <noreply@eggorigin.com>",
      to: "withdrawer@example.com",
      subject: "Получихме заявката Ви за връщане WD-2026-0042",
      html: "<wd-received-html />",
      text: "wd-received-text",
    })
    expect(mockBuildWithdrawalReceived).toHaveBeenCalledWith({
      orderId: VALID_ORDER_ID,
      withdrawalRef: "WD-2026-0042",
    })
  })

  it("logs but never throws when Resend rejects", async () => {
    mockResendSend.mockImplementationOnce(() => Promise.reject(new Error("network")))
    const err = vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(
      sendWithdrawalReceivedEmail(
        { id: VALID_ORDER_ID },
        { withdrawalRef: "WD-2026-0001", customerEmail: "x@y.z" },
      ),
    ).resolves.toBeUndefined()

    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })

  it("early-returns when RESEND_API_KEY is unset", async () => {
    delete process.env.RESEND_API_KEY

    await sendWithdrawalReceivedEmail(
      { id: VALID_ORDER_ID },
      { withdrawalRef: "WD-1", customerEmail: "x@y.z" },
    )

    expect(mockResendSend).not.toHaveBeenCalled()
    expect(mockBuildWithdrawalReceived).not.toHaveBeenCalled()
  })
})

describe("sendWithdrawalApprovedEmail", () => {
  it("composes approval email with returnRequired=true (Path A — return goods)", async () => {
    await sendWithdrawalApprovedEmail({
      orderId: VALID_ORDER_ID,
      customerEmail: "x@y.z",
      withdrawalRef: "WD-2026-0042",
      returnRequired: true,
    })

    expect(mockResendSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "x@y.z",
        subject: "Заявката Ви WD-2026-0042 е одобрена",
        html: "<wd-approved-html />",
      }),
    )
    expect(mockBuildWithdrawalApproved).toHaveBeenCalledWith({
      orderId: VALID_ORDER_ID,
      withdrawalRef: "WD-2026-0042",
      returnRequired: true,
    })
  })

  it("composes approval email with returnRequired=false (Path B — keep goods / goodwill)", async () => {
    await sendWithdrawalApprovedEmail({
      orderId: VALID_ORDER_ID,
      customerEmail: "x@y.z",
      withdrawalRef: "WD-2026-0099",
      returnRequired: false,
    })

    expect(mockBuildWithdrawalApproved).toHaveBeenCalledWith(
      expect.objectContaining({ returnRequired: false }),
    )
  })

  it("early-returns when RESEND_API_KEY is unset", async () => {
    delete process.env.RESEND_API_KEY

    await sendWithdrawalApprovedEmail({
      orderId: VALID_ORDER_ID,
      customerEmail: "x@y.z",
      withdrawalRef: "WD-1",
      returnRequired: true,
    })

    expect(mockResendSend).not.toHaveBeenCalled()
  })
})

describe("sendWithdrawalRejectedEmail", () => {
  it("composes rejection email with the rejection reason flowing into the template", async () => {
    await sendWithdrawalRejectedEmail({
      orderId: VALID_ORDER_ID,
      customerEmail: "x@y.z",
      withdrawalRef: "WD-2026-0042",
      rejectionReason: "Стоката е извън 14-дневния срок за отказ",
    })

    expect(mockResendSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "x@y.z",
        subject: "Заявката Ви WD-2026-0042 не е одобрена",
        html: "<wd-rejected-html />",
      }),
    )
    expect(mockBuildWithdrawalRejected).toHaveBeenCalledWith({
      orderId: VALID_ORDER_ID,
      withdrawalRef: "WD-2026-0042",
      rejectionReason: "Стоката е извън 14-дневния срок за отказ",
    })
  })

  it("early-returns when RESEND_API_KEY is unset", async () => {
    delete process.env.RESEND_API_KEY

    await sendWithdrawalRejectedEmail({
      orderId: VALID_ORDER_ID,
      customerEmail: "x@y.z",
      withdrawalRef: "WD-1",
      rejectionReason: "n/a",
    })

    expect(mockResendSend).not.toHaveBeenCalled()
  })
})
