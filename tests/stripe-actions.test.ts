import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock Stripe
vi.mock("@/lib/stripe", () => ({
  stripe: {
    checkout: {
      sessions: {
        create: vi.fn(),
        list: vi.fn(),
      },
    },
  },
}))

// Mock Supabase
const mockSupabase = {
  from: vi.fn(() => mockSupabase),
  insert: vi.fn(() => mockSupabase),
  update: vi.fn(() => mockSupabase),
  select: vi.fn(() => mockSupabase),
  eq: vi.fn(() => mockSupabase),
  single: vi.fn(),
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
}))

// Mock Resend
vi.mock("resend", () => ({
  Resend: vi.fn(() => ({
    emails: { send: vi.fn(() => Promise.resolve({ id: "test" })) },
  })),
}))

// Mock next/headers
vi.mock("next/headers", () => ({
  cookies: vi.fn(() => Promise.resolve({
    getAll: () => [],
    set: vi.fn(),
  })),
}))

import { createCheckoutSession, confirmOrder, createCODOrder } from "@/app/actions/stripe"
import { stripe } from "@/lib/stripe"

const validCartItems = [{ productId: "ovva-dark-chocolate-box", quantity: 2 }]
const validCustomerInfo = {
  firstName: "Иван",
  lastName: "Петров",
  email: "ivan@example.com",
  phone: "+359888123456",
  city: "София",
  address: "ул. Тестова 1",
  postalCode: "1000",
  notes: "",
}

describe("createCheckoutSession", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("creates order in database and Stripe session", async () => {
    const fakeOrder = { id: "order-123", ...validCustomerInfo }
    mockSupabase.single.mockResolvedValueOnce({ data: fakeOrder, error: null })

    const fakeSession = { url: "https://checkout.stripe.com/session-123" }
    vi.mocked(stripe.checkout.sessions.create).mockResolvedValueOnce(fakeSession as never)

    const result = await createCheckoutSession({
      cartItems: validCartItems,
      customerInfo: validCustomerInfo,
      deliveryMethod: "speedy-office",
      shippingPrice: 0,
    })

    expect(result.url).toBe(fakeSession.url)
    expect(mockSupabase.from).toHaveBeenCalledWith("orders")
    expect(mockSupabase.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        email: validCustomerInfo.email,
        payment_method: "card",
        status: "pending",
      })
    )
    expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_method_types: ["card"],
        mode: "payment",
        customer_email: validCustomerInfo.email,
      })
    )
  })

  it("throws when product not found", async () => {
    await expect(
      createCheckoutSession({
        cartItems: [{ productId: "nonexistent", quantity: 1 }],
        customerInfo: validCustomerInfo,
        deliveryMethod: "speedy-office",
        shippingPrice: 0,
      })
    ).rejects.toThrow("Product not found")
  })

  it("throws when database insert fails", async () => {
    mockSupabase.single.mockResolvedValueOnce({
      data: null,
      error: { message: "DB error" },
    })

    await expect(
      createCheckoutSession({
        cartItems: validCartItems,
        customerInfo: validCustomerInfo,
        deliveryMethod: "speedy-office",
        shippingPrice: 0,
      })
    ).rejects.toThrow("Failed to create order")
  })

  it("adds shipping line item when shippingPrice > 0", async () => {
    const fakeOrder = { id: "order-456" }
    mockSupabase.single.mockResolvedValueOnce({ data: fakeOrder, error: null })
    vi.mocked(stripe.checkout.sessions.create).mockResolvedValueOnce({ url: "https://test.com" } as never)

    await createCheckoutSession({
      cartItems: validCartItems,
      customerInfo: validCustomerInfo,
      deliveryMethod: "speedy-office",
      shippingPrice: 599,
    })

    const createCall = vi.mocked(stripe.checkout.sessions.create).mock.calls[0][0]
    const lineItems = createCall.line_items as Array<{ price_data: { product_data: { name: string } } }>
    const shippingItem = lineItems.find((item) => item.price_data.product_data.name === "Доставка (Speedy)")
    expect(shippingItem).toBeDefined()
  })

  it("includes invoice info when provided", async () => {
    const fakeOrder = { id: "order-789" }
    mockSupabase.single.mockResolvedValueOnce({ data: fakeOrder, error: null })
    vi.mocked(stripe.checkout.sessions.create).mockResolvedValueOnce({ url: "https://test.com" } as never)

    await createCheckoutSession({
      cartItems: validCartItems,
      customerInfo: validCustomerInfo,
      deliveryMethod: "speedy-office",
      shippingPrice: 0,
      needsInvoice: true,
      invoiceInfo: {
        companyName: "Test EOOD",
        eik: "123456789",
        vatNumber: "BG123456789",
        mol: "Иван Петров",
        invoiceAddress: "София, ул. Тестова 1",
      },
    })

    expect(mockSupabase.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        needs_invoice: true,
        invoice_company_name: "Test EOOD",
        invoice_eik: "123456789",
      })
    )
  })
})

describe("confirmOrder", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns existing order if already confirmed", async () => {
    const confirmedOrder = { id: "order-123", status: "confirmed" }
    mockSupabase.single.mockResolvedValueOnce({ data: confirmedOrder, error: null })

    const result = await confirmOrder("order-123")
    expect(result).toEqual(confirmedOrder)
    expect(mockSupabase.update).not.toHaveBeenCalled()
  })

  it("throws when order not found", async () => {
    mockSupabase.single.mockResolvedValueOnce({ data: null, error: { message: "Not found" } })

    await expect(confirmOrder("nonexistent")).rejects.toThrow("Order not found")
  })

  it("verifies Stripe payment for card orders before confirming", async () => {
    const pendingOrder = { id: "order-123", status: "pending", payment_method: "card" }
    mockSupabase.single.mockResolvedValueOnce({ data: pendingOrder, error: null })

    vi.mocked(stripe.checkout.sessions.list).mockResolvedValueOnce({
      data: [{ metadata: { orderId: "order-123" }, payment_status: "paid" }],
    } as never)

    const confirmedOrder = { ...pendingOrder, status: "confirmed" }
    mockSupabase.single.mockResolvedValueOnce({ data: confirmedOrder, error: null })

    const result = await confirmOrder("order-123")
    expect(result.status).toBe("confirmed")
    expect(stripe.checkout.sessions.list).toHaveBeenCalled()
  })

  it("rejects card order when payment not verified", async () => {
    const pendingOrder = { id: "order-123", status: "pending", payment_method: "card" }
    mockSupabase.single.mockResolvedValueOnce({ data: pendingOrder, error: null })

    vi.mocked(stripe.checkout.sessions.list).mockResolvedValueOnce({
      data: [],
    } as never)

    await expect(confirmOrder("order-123")).rejects.toThrow("Payment not verified")
  })
})

describe("createCODOrder", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("creates order with confirmed status and cod payment method", async () => {
    const fakeOrder = { id: "cod-order-123", email: "test@test.com", first_name: "Test" }
    mockSupabase.single.mockResolvedValueOnce({ data: fakeOrder, error: null })

    const result = await createCODOrder({
      cartItems: validCartItems,
      customerInfo: validCustomerInfo,
      deliveryMethod: "econt-office",
      shippingPrice: 599,
      codFee: 200,
    })

    expect(result).toEqual({ success: true, orderId: "cod-order-123" })
    expect(mockSupabase.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "confirmed",
        payment_method: "cod",
      })
    )
  })

  it("includes COD fee in total amount", async () => {
    const fakeOrder = { id: "cod-order-456", email: "test@test.com", first_name: "Test" }
    mockSupabase.single.mockResolvedValueOnce({ data: fakeOrder, error: null })

    await createCODOrder({
      cartItems: [{ productId: "ovva-dark-chocolate-box", quantity: 1 }],
      customerInfo: validCustomerInfo,
      deliveryMethod: "econt-office",
      shippingPrice: 599,
      codFee: 200,
    })

    const insertCall = mockSupabase.insert.mock.calls[0][0]
    // 5999 (product) + 599 (shipping) + 200 (COD fee) = 6798
    expect(insertCall.total_amount).toBe(6798)
  })

  it("throws when product not found", async () => {
    await expect(
      createCODOrder({
        cartItems: [{ productId: "nonexistent", quantity: 1 }],
        customerInfo: validCustomerInfo,
        deliveryMethod: "econt-office",
        shippingPrice: 599,
        codFee: 200,
      })
    ).rejects.toThrow("Product not found")
  })
})
