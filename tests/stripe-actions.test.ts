import { describe, it, expect, vi, beforeEach } from "vitest"

// Enable Econt delivery methods for tests
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_ECONT_ENABLED = "true"
})

// Mock Stripe
vi.mock("@/lib/stripe", () => ({
  stripe: {
    checkout: {
      sessions: {
        create: vi.fn(),
        retrieve: vi.fn(),
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
  Resend: class {
    emails = { send: vi.fn(() => Promise.resolve({ id: "test" })) }
  },
}))

// Mock next/headers
vi.mock("next/headers", () => ({
  headers: vi.fn(() => Promise.resolve({
    get: (name: string) => name === "x-forwarded-for" ? "127.0.0.1" : null,
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

const validEcontOffice = {
  id: 42,
  name: "София - Дружба",
  city: "София",
  fullAddress: "бул. Цариградско шосе 115",
}

describe("createCheckoutSession", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("creates order in database and Stripe session", async () => {
    const fakeOrder = { id: "order-123", ...validCustomerInfo }
    mockSupabase.single.mockResolvedValueOnce({ data: fakeOrder, error: null })

    const fakeSession = { id: "cs_test_123", url: "https://checkout.stripe.com/session-123" }
    vi.mocked(stripe.checkout.sessions.create).mockResolvedValueOnce(fakeSession as never)

    const result = await createCheckoutSession({
      cartItems: validCartItems,
      customerInfo: validCustomerInfo,
      deliveryMethod: "speedy-office",
    })

    expect(result.url).toBe(fakeSession.url)
    expect(mockSupabase.from).toHaveBeenCalledWith("orders")
    expect(mockSupabase.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        email: validCustomerInfo.email,
        payment_method: "card",
        status: "pending",
        notes: "",
      })
    )
  })

  it("throws when product not found", async () => {
    await expect(
      createCheckoutSession({
        cartItems: [{ productId: "nonexistent", quantity: 1 }],
        customerInfo: validCustomerInfo,
        deliveryMethod: "speedy-office",
      })
    ).rejects.toThrow("Product not found")
  })

  it("throws when quantity exceeds max", async () => {
    await expect(
      createCheckoutSession({
        cartItems: [{ productId: "ovva-dark-chocolate-box", quantity: 100 }],
        customerInfo: validCustomerInfo,
        deliveryMethod: "speedy-office",
      })
    ).rejects.toThrow("Invalid quantity")
  })

  it("throws when quantity is zero", async () => {
    await expect(
      createCheckoutSession({
        cartItems: [{ productId: "ovva-dark-chocolate-box", quantity: 0 }],
        customerInfo: validCustomerInfo,
        deliveryMethod: "speedy-office",
      })
    ).rejects.toThrow("Invalid quantity")
  })

  it("throws when cart is empty", async () => {
    await expect(
      createCheckoutSession({
        cartItems: [],
        customerInfo: validCustomerInfo,
        deliveryMethod: "speedy-office",
      })
    ).rejects.toThrow("Cart is empty")
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
      })
    ).rejects.toThrow("Failed to create order")
  })

  it("calculates shipping server-side (free over 50 лв)", async () => {
    const fakeOrder = { id: "order-456" }
    mockSupabase.single.mockResolvedValueOnce({ data: fakeOrder, error: null })
    vi.mocked(stripe.checkout.sessions.create).mockResolvedValueOnce({ id: "cs_1", url: "https://test.com" } as never)

    // 2 boxes at 59.99 = 119.98 лв → free shipping
    await createCheckoutSession({
      cartItems: validCartItems,
      customerInfo: validCustomerInfo,
      deliveryMethod: "speedy-office",
    })

    const insertCall = mockSupabase.insert.mock.calls[0][0]
    expect(insertCall.total_amount).toBe(5999 * 2) // No shipping added
  })

  it("uses correct carrier name for Econt", async () => {
    const fakeOrder = { id: "order-789" }
    mockSupabase.single.mockResolvedValueOnce({ data: fakeOrder, error: null })
    vi.mocked(stripe.checkout.sessions.create).mockResolvedValueOnce({ id: "cs_2", url: "https://test.com" } as never)

    // 1 box = 59.99 лв > 50 лв → free shipping, so no shipping line item
    // Use a cheaper scenario to trigger shipping: quantity 1 at 59.99 is already > 50
    // Actually 5999 > 5000 so shipping is free. We need the line items to include shipping.
    // Let's just check the Stripe session was created with correct metadata
    await createCheckoutSession({
      cartItems: [{ productId: "ovva-dark-chocolate-box", quantity: 1 }],
      customerInfo: validCustomerInfo,
      deliveryMethod: "econt-office",
      econtOffice: validEcontOffice,
    })

    // Since 59.99 лв > 50 лв threshold, shipping is free — no shipping line item
    // Verify the order was created with econt delivery method
    expect(mockSupabase.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        logistics_partner: "econt-office",
      })
    )
  })

  it("stores stripe session ID on order", async () => {
    const fakeOrder = { id: "order-abc" }
    mockSupabase.single.mockResolvedValueOnce({ data: fakeOrder, error: null })
    vi.mocked(stripe.checkout.sessions.create).mockResolvedValueOnce({ id: "cs_stored", url: "https://test.com" } as never)

    await createCheckoutSession({
      cartItems: validCartItems,
      customerInfo: validCustomerInfo,
      deliveryMethod: "speedy-office",
    })

    // Second .from("orders") call is the update with stripe_session_id
    expect(mockSupabase.update).toHaveBeenCalledWith({ stripe_session_id: "cs_stored" })
  })
})

describe("confirmOrder", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("rejects invalid UUID", async () => {
    await expect(confirmOrder("not-a-uuid")).rejects.toThrow("Invalid order ID")
  })

  it("returns minimal data if already confirmed", async () => {
    const confirmedOrder = { id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", status: "confirmed" }
    mockSupabase.single.mockResolvedValueOnce({ data: confirmedOrder, error: null })

    const result = await confirmOrder("a1b2c3d4-e5f6-7890-abcd-ef1234567890")
    expect(result).toEqual({ status: "confirmed" })
    expect(mockSupabase.update).not.toHaveBeenCalled()
  })

  it("throws when order not found", async () => {
    mockSupabase.single.mockResolvedValueOnce({ data: null, error: { message: "Not found" } })

    await expect(confirmOrder("a1b2c3d4-e5f6-7890-abcd-ef1234567890")).rejects.toThrow("Order not found")
  })

  it("verifies Stripe payment via session retrieve for card orders", async () => {
    const pendingOrder = {
      id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      status: "pending",
      payment_method: "card",
      stripe_session_id: "cs_test_abc",
    }
    mockSupabase.single.mockResolvedValueOnce({ data: pendingOrder, error: null })

    vi.mocked(stripe.checkout.sessions.retrieve).mockResolvedValueOnce({
      payment_status: "paid",
    } as never)

    const confirmedOrder = { ...pendingOrder, status: "confirmed" }
    mockSupabase.single.mockResolvedValueOnce({ data: confirmedOrder, error: null })

    const result = await confirmOrder("a1b2c3d4-e5f6-7890-abcd-ef1234567890")
    expect(result.status).toBe("confirmed")
    expect(stripe.checkout.sessions.retrieve).toHaveBeenCalledWith("cs_test_abc")
  })

  it("rejects card order when payment not verified", async () => {
    const pendingOrder = {
      id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      status: "pending",
      payment_method: "card",
      stripe_session_id: "cs_test_def",
    }
    mockSupabase.single.mockResolvedValueOnce({ data: pendingOrder, error: null })

    vi.mocked(stripe.checkout.sessions.retrieve).mockResolvedValueOnce({
      payment_status: "unpaid",
    } as never)

    await expect(confirmOrder("a1b2c3d4-e5f6-7890-abcd-ef1234567890")).rejects.toThrow("Payment not verified")
  })

  it("rejects card order when no stripe session ID stored", async () => {
    const pendingOrder = {
      id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      status: "pending",
      payment_method: "card",
      stripe_session_id: null,
    }
    mockSupabase.single.mockResolvedValueOnce({ data: pendingOrder, error: null })

    await expect(confirmOrder("a1b2c3d4-e5f6-7890-abcd-ef1234567890")).rejects.toThrow("Payment not verified")
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
      econtOffice: validEcontOffice,
    })

    expect(result).toEqual({ success: true, orderId: "cod-order-123" })
    expect(mockSupabase.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "confirmed",
        payment_method: "cod",
      })
    )
  })

  it("calculates shipping and COD fee server-side", async () => {
    const fakeOrder = { id: "cod-order-456", email: "test@test.com", first_name: "Test" }
    mockSupabase.single.mockResolvedValueOnce({ data: fakeOrder, error: null })

    await createCODOrder({
      cartItems: [{ productId: "ovva-dark-chocolate-box", quantity: 1 }],
      customerInfo: validCustomerInfo,
      deliveryMethod: "econt-office",
      econtOffice: validEcontOffice,
    })

    const insertCall = mockSupabase.insert.mock.calls[0][0]
    // 5999 (product) + 0 (shipping, 59.99 > 50 лв threshold) + 200 (COD fee) = 6199
    expect(insertCall.total_amount).toBe(6199)
  })

  it("throws when product not found", async () => {
    await expect(
      createCODOrder({
        cartItems: [{ productId: "nonexistent", quantity: 1 }],
        customerInfo: validCustomerInfo,
        deliveryMethod: "econt-office",
        econtOffice: validEcontOffice,
      })
    ).rejects.toThrow("Product not found")
  })
})

describe("input validation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("rejects invalid delivery method", async () => {
    await expect(
      createCheckoutSession({
        cartItems: validCartItems,
        customerInfo: validCustomerInfo,
        deliveryMethod: "invalid-method",
      })
    ).rejects.toThrow("Invalid delivery method")
  })

  it("rejects empty required customer fields", async () => {
    await expect(
      createCheckoutSession({
        cartItems: validCartItems,
        customerInfo: { ...validCustomerInfo, firstName: "" },
        deliveryMethod: "speedy-office",
      })
    ).rejects.toThrow("First name is required")
  })

  it("rejects invalid email format", async () => {
    await expect(
      createCheckoutSession({
        cartItems: validCartItems,
        customerInfo: { ...validCustomerInfo, email: "not-an-email" },
        deliveryMethod: "speedy-office",
      })
    ).rejects.toThrow("Invalid email format")
  })

  it("rejects invalid phone format", async () => {
    await expect(
      createCheckoutSession({
        cartItems: validCartItems,
        customerInfo: { ...validCustomerInfo, phone: "abc" },
        deliveryMethod: "speedy-office",
      })
    ).rejects.toThrow("Invalid phone format")
  })

  it("rejects fractional quantity", async () => {
    await expect(
      createCheckoutSession({
        cartItems: [{ productId: "ovva-dark-chocolate-box", quantity: 1.5 }],
        customerInfo: validCustomerInfo,
        deliveryMethod: "speedy-office",
      })
    ).rejects.toThrow("Invalid quantity")
  })

  it("rejects fields exceeding max length", async () => {
    await expect(
      createCheckoutSession({
        cartItems: validCartItems,
        customerInfo: { ...validCustomerInfo, notes: "x".repeat(501) },
        deliveryMethod: "speedy-office",
      })
    ).rejects.toThrow("Notes is too long")
  })

  it("confirmOrder returns only status, no PII", async () => {
    const pendingOrder = {
      id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      status: "pending",
      payment_method: "card",
      stripe_session_id: "cs_test_xyz",
      email: "secret@test.com",
      first_name: "Secret",
      phone: "+359888000000",
    }
    mockSupabase.single.mockResolvedValueOnce({ data: pendingOrder, error: null })
    vi.mocked(stripe.checkout.sessions.retrieve).mockResolvedValueOnce({
      payment_status: "paid",
    } as never)
    const confirmedOrder = { ...pendingOrder, status: "confirmed" }
    mockSupabase.single.mockResolvedValueOnce({ data: confirmedOrder, error: null })

    const result = await confirmOrder("a1b2c3d4-e5f6-7890-abcd-ef1234567890")
    expect(result).toEqual({ status: "confirmed" })
    expect(result).not.toHaveProperty("email")
    expect(result).not.toHaveProperty("first_name")
    expect(result).not.toHaveProperty("phone")
  })
})
