import { describe, it, expect, vi, beforeEach } from "vitest"
import { createSupabaseMock, resetSupabaseMock } from "./helpers/supabase-mock"
import { validCustomerInfo, validCartItems, singleCartItem, validEcontOffice, validSpeedyOffice } from "./helpers/fixtures"

// Enable Econt delivery methods for tests
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_ECONT_ENABLED = "true"
})

// Mock Stripe
vi.mock("@/lib/stripe", () => ({
  stripe: {
    checkout: {
      sessions: { create: vi.fn(), retrieve: vi.fn() },
    },
    coupons: { del: vi.fn(() => Promise.resolve()) },
  },
}))

// Mock Supabase
const mockSupabase = createSupabaseMock()

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
let mockIp = "127.0.0.1"
vi.mock("next/headers", () => ({
  headers: vi.fn(() => Promise.resolve({
    get: (name: string) => name === "x-forwarded-for" ? mockIp : null,
  })),
}))

// Mock sales module — returns base prices (no active sales in tests)
const mockGetProductsWithSales = vi.fn()
vi.mock("@/lib/sales", () => ({
  getProductsWithSales: (...args: unknown[]) => mockGetProductsWithSales(...args),
}))

vi.mock("@/lib/invoice", () => ({
  getNextInvoiceNumber: vi.fn(() => Promise.resolve("0000000001")),
}))

import { createCheckoutSession, confirmOrder, createCODOrder, checkCartInventory } from "@/app/actions/stripe"
import { stripe } from "@/lib/stripe"
import { PRODUCTS } from "@/lib/products"

// Set up sales mock to return base prices (no active sales)
mockGetProductsWithSales.mockImplementation(() => Promise.resolve([...PRODUCTS]))

describe("createCheckoutSession", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSupabaseMock(mockSupabase)
    mockIp = `test-${Math.random()}`
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
      speedyOffice: validSpeedyOffice,
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
        speedyOffice: validSpeedyOffice,
      })
    ).rejects.toThrow("Product not found")
  })

  it("throws when quantity exceeds max", async () => {
    await expect(
      createCheckoutSession({
        cartItems: [{ productId: "egg-origin-dark-chocolate-box", quantity: 100 }],
        customerInfo: validCustomerInfo,
        deliveryMethod: "speedy-office",
        speedyOffice: validSpeedyOffice,
      })
    ).rejects.toThrow("Invalid quantity")
  })

  it("throws when quantity is zero", async () => {
    await expect(
      createCheckoutSession({
        cartItems: [{ productId: "egg-origin-dark-chocolate-box", quantity: 0 }],
        customerInfo: validCustomerInfo,
        deliveryMethod: "speedy-office",
        speedyOffice: validSpeedyOffice,
      })
    ).rejects.toThrow("Invalid quantity")
  })

  it("throws when cart is empty", async () => {
    await expect(
      createCheckoutSession({
        cartItems: [],
        customerInfo: validCustomerInfo,
        deliveryMethod: "speedy-office",
        speedyOffice: validSpeedyOffice,
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
        speedyOffice: validSpeedyOffice,
      })
    ).rejects.toThrow("Failed to create order")
  })

  it("calculates shipping server-side (free over 30 €)", async () => {
    const fakeOrder = { id: "order-456" }
    mockSupabase.single.mockResolvedValueOnce({ data: fakeOrder, error: null })
    vi.mocked(stripe.checkout.sessions.create).mockResolvedValueOnce({ id: "cs_1", url: "https://test.com" } as never)

    // 2 boxes at 25.70 = 51.40 € → free shipping
    await createCheckoutSession({
      cartItems: validCartItems,
      customerInfo: validCustomerInfo,
      deliveryMethod: "speedy-office",
      speedyOffice: validSpeedyOffice,
    })

    const insertCall = mockSupabase.insert.mock.calls[0][0]
    expect(insertCall.total_amount).toBe(2570 * 2) // No shipping added
  })

  it("uses correct carrier name for Econt", async () => {
    const fakeOrder = { id: "order-789" }
    mockSupabase.single.mockResolvedValueOnce({ data: fakeOrder, error: null })
    vi.mocked(stripe.checkout.sessions.create).mockResolvedValueOnce({ id: "cs_2", url: "https://test.com" } as never)

    // 1 box = 25.70 € < 30 € threshold, but test checks carrier name not shipping
    await createCheckoutSession({
      cartItems: [{ productId: "egg-origin-dark-chocolate-box", quantity: 1 }],
      customerInfo: validCustomerInfo,
      deliveryMethod: "econt-office",
      econtOffice: validEcontOffice,
    })

    // 25.70 € < 30 € threshold, but this test only checks delivery method, not shipping
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
      speedyOffice: validSpeedyOffice,
    })

    // Second .from("orders") call is the update with stripe_session_id
    expect(mockSupabase.update).toHaveBeenCalledWith({ stripe_session_id: "cs_stored" })
  })
})

describe("confirmOrder", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSupabaseMock(mockSupabase)
    mockIp = `test-${Math.random()}`
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

    await expect(confirmOrder("a1b2c3d4-e5f6-7890-abcd-ef1234567890")).rejects.toThrow("Unable to confirm order")
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

    await expect(confirmOrder("a1b2c3d4-e5f6-7890-abcd-ef1234567890")).rejects.toThrow("Unable to confirm order")
  })

  it("rejects card order when no stripe session ID stored", async () => {
    const pendingOrder = {
      id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      status: "pending",
      payment_method: "card",
      stripe_session_id: null,
    }
    mockSupabase.single.mockResolvedValueOnce({ data: pendingOrder, error: null })

    await expect(confirmOrder("a1b2c3d4-e5f6-7890-abcd-ef1234567890")).rejects.toThrow("Unable to confirm order")
  })
})

describe("createCODOrder", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSupabaseMock(mockSupabase)
    mockIp = `test-${Math.random()}`
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
      cartItems: [{ productId: "egg-origin-dark-chocolate-box", quantity: 1 }],
      customerInfo: validCustomerInfo,
      deliveryMethod: "econt-office",
      econtOffice: validEcontOffice,
    })

    const insertCall = mockSupabase.insert.mock.calls[0][0]
    // 2570 (product) + 300 (shipping, 25.70 < 30 € threshold) + 200 (COD fee) = 3070
    expect(insertCall.total_amount).toBe(3070)
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
    resetSupabaseMock(mockSupabase)
    mockIp = `test-${Math.random()}`
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
        cartItems: [{ productId: "egg-origin-dark-chocolate-box", quantity: 1.5 }],
        customerInfo: validCustomerInfo,
        deliveryMethod: "speedy-office",
        speedyOffice: validSpeedyOffice,
      })
    ).rejects.toThrow("Invalid quantity")
  })

  it("rejects empty address for address delivery", async () => {
    await expect(
      createCheckoutSession({
        cartItems: validCartItems,
        customerInfo: { ...validCustomerInfo, address: "" },
        deliveryMethod: "speedy-address",
      })
    ).rejects.toThrow("Address is required for address delivery")
  })

  it("rejects empty address for econt address delivery", async () => {
    await expect(
      createCODOrder({
        cartItems: validCartItems,
        customerInfo: { ...validCustomerInfo, address: "" },
        deliveryMethod: "econt-address",
      })
    ).rejects.toThrow("Address is required for address delivery")
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

  it("rejects missing required fields", async () => {
    await expect(
      createCheckoutSession({
        cartItems: validCartItems,
        customerInfo: { ...validCustomerInfo, lastName: "" },
        deliveryMethod: "speedy-office",
      })
    ).rejects.toThrow("Last name is required")

    await expect(
      createCheckoutSession({
        cartItems: validCartItems,
        customerInfo: { ...validCustomerInfo, city: "" },
        deliveryMethod: "speedy-office",
      })
    ).rejects.toThrow("City is required")
  })

  it("rejects missing Speedy office for office delivery", async () => {
    await expect(
      createCheckoutSession({
        cartItems: validCartItems,
        customerInfo: validCustomerInfo,
        deliveryMethod: "speedy-office",
      })
    ).rejects.toThrow("Speedy office")
  })

  it("rejects missing Econt office for office delivery", async () => {
    await expect(
      createCheckoutSession({
        cartItems: validCartItems,
        customerInfo: validCustomerInfo,
        deliveryMethod: "econt-office",
      })
    ).rejects.toThrow("Econt office")
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

describe("invoice validation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSupabaseMock(mockSupabase)
    mockIp = `test-${Math.random()}`
  })

  it("accepts order without invoice", async () => {
    const fakeOrder = { id: "order-no-inv", email: "t@t.com", first_name: "T" }
    mockSupabase.single.mockResolvedValueOnce({ data: fakeOrder, error: null })

    const result = await createCODOrder({
      cartItems: validCartItems,
      customerInfo: validCustomerInfo,
      deliveryMethod: "speedy-office",
      speedyOffice: validSpeedyOffice,
      needsInvoice: false,
    })

    expect(result.success).toBe(true)
  })

  it("accepts valid company invoice data", async () => {
    const fakeOrder = { id: "order-inv-co", email: "t@t.com", first_name: "T" }
    mockSupabase.single.mockResolvedValueOnce({ data: fakeOrder, error: null })

    const result = await createCODOrder({
      cartItems: validCartItems,
      customerInfo: validCustomerInfo,
      deliveryMethod: "speedy-office",
      speedyOffice: validSpeedyOffice,
      needsInvoice: true,
      invoiceInfo: {
        companyName: "Test EOOD",
        eik: "123456789",
        vatNumber: "BG123456789",
        egn: "",
        mol: "Иван Петров",
        invoiceAddress: "София, ул. Тестова 1",
      },
    })

    expect(result.success).toBe(true)
  })

  it("rejects company invoice with invalid EIK", async () => {
    await expect(
      createCODOrder({
        cartItems: validCartItems,
        customerInfo: validCustomerInfo,
        deliveryMethod: "speedy-office",
        speedyOffice: validSpeedyOffice,
        needsInvoice: true,
        invoiceInfo: {
          companyName: "Test EOOD",
          eik: "abc",
          vatNumber: "",
          egn: "",
          mol: "Test",
          invoiceAddress: "Sofia",
        },
      })
    ).rejects.toThrow("ЕИК трябва да бъде 9 или 13 цифри")
  })

  it("rejects company invoice with empty EIK", async () => {
    await expect(
      createCODOrder({
        cartItems: validCartItems,
        customerInfo: validCustomerInfo,
        deliveryMethod: "speedy-office",
        speedyOffice: validSpeedyOffice,
        needsInvoice: true,
        invoiceInfo: {
          companyName: "Test EOOD",
          eik: "",
          vatNumber: "",
          egn: "",
          mol: "Test",
          invoiceAddress: "Sofia",
        },
      })
    ).rejects.toThrow("ЕИК трябва да бъде 9 или 13 цифри")
  })

  it("rejects company invoice with invalid VAT number", async () => {
    await expect(
      createCODOrder({
        cartItems: validCartItems,
        customerInfo: validCustomerInfo,
        deliveryMethod: "speedy-office",
        speedyOffice: validSpeedyOffice,
        needsInvoice: true,
        invoiceInfo: {
          companyName: "Test EOOD",
          eik: "123456789",
          vatNumber: "INVALID",
          egn: "",
          mol: "Test",
          invoiceAddress: "Sofia",
        },
      })
    ).rejects.toThrow("Невалиден ДДС номер")
  })

  it("rejects invoice without MOL", async () => {
    await expect(
      createCODOrder({
        cartItems: validCartItems,
        customerInfo: validCustomerInfo,
        deliveryMethod: "speedy-office",
        speedyOffice: validSpeedyOffice,
        needsInvoice: true,
        invoiceInfo: {
          companyName: "",
          eik: "",
          vatNumber: "",
          egn: "",
          mol: "",
          invoiceAddress: "Sofia",
        },
      })
    ).rejects.toThrow("МОЛ / Име е задължително")
  })

  it("rejects invoice without address", async () => {
    await expect(
      createCODOrder({
        cartItems: validCartItems,
        customerInfo: validCustomerInfo,
        deliveryMethod: "speedy-office",
        speedyOffice: validSpeedyOffice,
        needsInvoice: true,
        invoiceInfo: {
          companyName: "",
          eik: "",
          vatNumber: "",
          egn: "",
          mol: "Test Person",
          invoiceAddress: "",
        },
      })
    ).rejects.toThrow("Адресът е задължителен")
  })

  it("rejects individual invoice with invalid EGN", async () => {
    await expect(
      createCODOrder({
        cartItems: validCartItems,
        customerInfo: validCustomerInfo,
        deliveryMethod: "speedy-office",
        speedyOffice: validSpeedyOffice,
        needsInvoice: true,
        invoiceInfo: {
          companyName: "",
          eik: "",
          vatNumber: "",
          egn: "12345",
          mol: "Test Person",
          invoiceAddress: "Sofia",
        },
      })
    ).rejects.toThrow("ЕГН трябва да бъде 10 цифри")
  })

  it("accepts valid individual invoice with EGN", async () => {
    const fakeOrder = { id: "order-inv-ind", email: "t@t.com", first_name: "T" }
    mockSupabase.single.mockResolvedValueOnce({ data: fakeOrder, error: null })

    const result = await createCODOrder({
      cartItems: validCartItems,
      customerInfo: validCustomerInfo,
      deliveryMethod: "speedy-office",
      speedyOffice: validSpeedyOffice,
      needsInvoice: true,
      invoiceInfo: {
        companyName: "",
        eik: "",
        vatNumber: "",
        egn: "1234567890",
        mol: "Иван Петров",
        invoiceAddress: "София, ул. Тестова 1",
      },
    })

    expect(result.success).toBe(true)
  })
})

describe("createCODOrder — additional", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSupabaseMock(mockSupabase)
    mockIp = `test-${Math.random()}`
  })

  it("stores shipping_fee and cod_fee on order", async () => {
    const fakeOrder = { id: "cod-fees", email: "t@t.com", first_name: "T" }
    mockSupabase.single.mockResolvedValueOnce({ data: fakeOrder, error: null })

    await createCODOrder({
      cartItems: [{ productId: "egg-origin-dark-chocolate-box", quantity: 1 }],
      customerInfo: validCustomerInfo,
      deliveryMethod: "speedy-office",
      speedyOffice: validSpeedyOffice,
    })

    const insertCall = mockSupabase.insert.mock.calls[0][0]
    expect(insertCall.shipping_fee).toBe(300) // speedy office shipping
    expect(insertCall.cod_fee).toBe(200)
    expect(insertCall.confirmed_at).toBeTruthy()
  })

  it("stores invoice data when needsInvoice is true", async () => {
    const fakeOrder = { id: "cod-inv", email: "t@t.com", first_name: "T" }
    mockSupabase.single.mockResolvedValueOnce({ data: fakeOrder, error: null })

    await createCODOrder({
      cartItems: validCartItems,
      customerInfo: validCustomerInfo,
      deliveryMethod: "speedy-office",
      speedyOffice: validSpeedyOffice,
      needsInvoice: true,
      invoiceInfo: {
        companyName: "Firm",
        eik: "123456789",
        vatNumber: "",
        egn: "",
        mol: "Boss",
        invoiceAddress: "Sofia",
      },
    })

    const insertCall = mockSupabase.insert.mock.calls[0][0]
    expect(insertCall.needs_invoice).toBe(true)
    expect(insertCall.invoice_company_name).toBe("Firm")
    expect(insertCall.invoice_eik).toBe("123456789")
    expect(insertCall.invoice_mol).toBe("Boss")
  })

  it("stores Speedy office data", async () => {
    const fakeOrder = { id: "cod-speedy", email: "t@t.com", first_name: "T" }
    mockSupabase.single.mockResolvedValueOnce({ data: fakeOrder, error: null })

    await createCODOrder({
      cartItems: validCartItems,
      customerInfo: validCustomerInfo,
      deliveryMethod: "speedy-office",
      speedyOffice: validSpeedyOffice,
    })

    const insertCall = mockSupabase.insert.mock.calls[0][0]
    expect(insertCall.speedy_office_id).toBe(100)
    expect(insertCall.speedy_office_name).toBe("Speedy офис София")
  })

  it("throws when DB insert fails", async () => {
    mockSupabase.single.mockResolvedValueOnce({ data: null, error: { message: "DB err" } })

    await expect(
      createCODOrder({
        cartItems: validCartItems,
        customerInfo: validCustomerInfo,
        deliveryMethod: "speedy-office",
        speedyOffice: validSpeedyOffice,
      })
    ).rejects.toThrow("Failed to create order")
  })

  it("applies free shipping for orders over threshold", async () => {
    const fakeOrder = { id: "cod-free-ship", email: "t@t.com", first_name: "T" }
    mockSupabase.single.mockResolvedValueOnce({ data: fakeOrder, error: null })

    // 2 boxes = 51.40 EUR > 30 EUR threshold → free office shipping
    await createCODOrder({
      cartItems: validCartItems,
      customerInfo: validCustomerInfo,
      deliveryMethod: "speedy-office",
      speedyOffice: validSpeedyOffice,
    })

    const insertCall = mockSupabase.insert.mock.calls[0][0]
    expect(insertCall.shipping_fee).toBe(0)
    // total = 5140 (products) + 0 (shipping) + 200 (cod) = 5340
    expect(insertCall.total_amount).toBe(5340)
  })
})

describe("inventory reservation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSupabaseMock(mockSupabase)
    mockIp = `test-${Math.random()}`
  })

  it("createCheckoutSession calls reserve_inventory for each cart item", async () => {
    const fakeOrder = { id: "order-inv-1" }
    mockSupabase.single.mockResolvedValueOnce({ data: fakeOrder, error: null })
    vi.mocked(stripe.checkout.sessions.create).mockResolvedValueOnce({ id: "cs_inv", url: "https://test.com" } as never)

    await createCheckoutSession({
      cartItems: [{ productId: "egg-origin-dark-chocolate-box", quantity: 2 }],
      customerInfo: validCustomerInfo,
      deliveryMethod: "speedy-office",
      speedyOffice: validSpeedyOffice,
    })

    expect(mockSupabase.rpc).toHaveBeenCalledWith("reserve_inventory", {
      p_sku: "EGO-DC-12",
      p_quantity: 2,
      p_order_id: "order-inv-1",
    })
  })

  it("createCheckoutSession deletes order and throws when inventory reservation fails", async () => {
    const fakeOrder = { id: "order-inv-fail" }
    mockSupabase.single.mockResolvedValueOnce({ data: fakeOrder, error: null })
    mockSupabase.rpc = vi.fn(() => Promise.resolve({ data: null, error: { message: "Insufficient stock for SKU EGO-DC-12. Available: 0, requested: 1" } }))

    await expect(
      createCheckoutSession({
        cartItems: [{ productId: "egg-origin-dark-chocolate-box", quantity: 1 }],
        customerInfo: validCustomerInfo,
        deliveryMethod: "speedy-office",
        speedyOffice: validSpeedyOffice,
      })
    ).rejects.toThrow("Insufficient stock")

    // Order must be cleaned up
    expect(mockSupabase.delete).toHaveBeenCalled()
    // Stripe session must NOT have been created
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled()
  })

  it("createCheckoutSession rolls back already-reserved items if a later item fails", async () => {
    const fakeOrder = { id: "order-rollback" }
    mockSupabase.single.mockResolvedValueOnce({ data: fakeOrder, error: null })

    let rpcCallCount = 0
    mockSupabase.rpc = vi.fn((fn: string) => {
      if (fn === "reserve_inventory") {
        rpcCallCount++
        if (rpcCallCount === 2) {
          return Promise.resolve({ data: null, error: { message: "Insufficient stock for SKU EGO-WCR-12" } })
        }
      }
      return Promise.resolve({ data: null, error: null })
    })

    await expect(
      createCheckoutSession({
        cartItems: [
          { productId: "egg-origin-dark-chocolate-box", quantity: 1 },
          { productId: "egg-origin-white-chocolate-raspberry-box", quantity: 1 },
        ],
        customerInfo: validCustomerInfo,
        deliveryMethod: "speedy-office",
        speedyOffice: validSpeedyOffice,
      })
    ).rejects.toThrow()

    // Should have called restore for the first item that was reserved
    expect(mockSupabase.rpc).toHaveBeenCalledWith("restore_inventory", expect.objectContaining({
      p_sku: "EGO-DC-12",
      p_order_id: "order-rollback",
    }))
  })

  it("createCODOrder calls reserve_inventory", async () => {
    const fakeOrder = { id: "cod-inv-order", email: "t@t.com", first_name: "T" }
    mockSupabase.single.mockResolvedValueOnce({ data: fakeOrder, error: null })

    await createCODOrder({
      cartItems: [{ productId: "egg-origin-dark-chocolate-box", quantity: 1 }],
      customerInfo: validCustomerInfo,
      deliveryMethod: "speedy-office",
      speedyOffice: validSpeedyOffice,
    })

    expect(mockSupabase.rpc).toHaveBeenCalledWith("reserve_inventory", {
      p_sku: "EGO-DC-12",
      p_quantity: 1,
      p_order_id: "cod-inv-order",
    })
  })
})

describe("checkCartInventory", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSupabaseMock(mockSupabase)
  })

  it("returns empty array for empty cart", async () => {
    const result = await checkCartInventory([])
    expect(result).toEqual([])
  })

  it("returns empty array when all items have sufficient stock", async () => {
    mockSupabase.single.mockResolvedValueOnce(undefined)
    // Mock the .in() chain to resolve with stock data
    const inMock = { then: (resolve: (v: unknown) => void) => resolve({ data: [{ sku: "EGO-DC-12", quantity: 10 }], error: null }) }
    mockSupabase.in = vi.fn(() => inMock)

    const result = await checkCartInventory([{ productId: "egg-origin-dark-chocolate-box", quantity: 2 }])
    expect(result).toEqual([])
  })

  it("returns warnings for items with insufficient stock", async () => {
    const inMock = { then: (resolve: (v: unknown) => void) => resolve({ data: [{ sku: "EGO-DC-12", quantity: 1 }], error: null }) }
    mockSupabase.in = vi.fn(() => inMock)

    const result = await checkCartInventory([{ productId: "egg-origin-dark-chocolate-box", quantity: 3 }])
    expect(result).toHaveLength(1)
    expect(result[0].available).toBe(1)
    expect(result[0].requested).toBe(3)
  })

  it("returns empty array when DB errors — fail open", async () => {
    const inMock = { then: (resolve: (v: unknown) => void) => resolve({ data: null, error: { message: "DB error" } }) }
    mockSupabase.in = vi.fn(() => inMock)

    const result = await checkCartInventory([{ productId: "egg-origin-dark-chocolate-box", quantity: 1 }])
    expect(result).toEqual([])
  })

  it("ignores items with invalid quantity", async () => {
    const inMock = { then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }) }
    mockSupabase.in = vi.fn(() => inMock)

    const result = await checkCartInventory([{ productId: "egg-origin-dark-chocolate-box", quantity: -1 }])
    expect(result).toEqual([])
    // .in() called with empty array or not called at all since no valid items
  })

  it("returns empty for unknown product IDs", async () => {
    const result = await checkCartInventory([{ productId: "nonexistent-product", quantity: 1 }])
    expect(result).toEqual([])
  })
})
