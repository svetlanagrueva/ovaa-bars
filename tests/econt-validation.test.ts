import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest"
import { createSupabaseMock, resetSupabaseMock } from "./helpers/supabase-mock"

// Set env var in vi.hoisted so it runs before module-level evaluation
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


// Use dynamic imports to ensure env is set before module loads
let createCheckoutSession: typeof import("@/app/actions/stripe").createCheckoutSession
let createCODOrder: typeof import("@/app/actions/stripe").createCODOrder
let stripe: typeof import("@/lib/stripe").stripe

beforeAll(async () => {
  const { PRODUCTS } = await import("@/lib/products")
  mockGetProductsWithSales.mockImplementation(() => Promise.resolve([...PRODUCTS]))
  const stripeActions = await import("@/app/actions/stripe")
  createCheckoutSession = stripeActions.createCheckoutSession
  createCODOrder = stripeActions.createCODOrder
  const stripeMod = await import("@/lib/stripe")
  stripe = stripeMod.stripe
})

const validCartItems = [{ productId: "egg-origin-dark-chocolate-box", quantity: 2 }]
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
  code: "SOF-DRB",
  name: "София - Дружба",
  city: "София",
  fullAddress: "бул. Цариградско шосе 115",
}

const validSpeedyOffice = {
  id: 100,
  name: "Speedy офис София",
  city: "София",
  fullAddress: "бул. Ситняково 48",
}

describe("Econt office validation – createCheckoutSession", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSupabaseMock(mockSupabase)
    mockIp = `test-${Math.random()}`
  })

  it("rejects econt-office delivery without office data", async () => {
    await expect(
      createCheckoutSession({
        cartItems: validCartItems,
        customerInfo: validCustomerInfo,
        deliveryMethod: "econt-office",
      })
    ).rejects.toThrow("Econt office is required")
  })

  it("rejects econt-office delivery with missing office name", async () => {
    await expect(
      createCheckoutSession({
        cartItems: validCartItems,
        customerInfo: validCustomerInfo,
        deliveryMethod: "econt-office",
        econtOffice: { id: 1, code: "TST", name: "", city: "София", fullAddress: "ул. Тест" },
      })
    ).rejects.toThrow("Econt office is required")
  })

  it("rejects econt-office with excessively long office name", async () => {
    await expect(
      createCheckoutSession({
        cartItems: validCartItems,
        customerInfo: validCustomerInfo,
        deliveryMethod: "econt-office",
        econtOffice: {
          id: 1,
          code: "TST",
          name: "x".repeat(201),
          city: "София",
          fullAddress: "ул. Тест",
        },
      })
    ).rejects.toThrow("Invalid Econt office data")
  })

  it("rejects econt-office with excessively long fullAddress", async () => {
    await expect(
      createCheckoutSession({
        cartItems: validCartItems,
        customerInfo: validCustomerInfo,
        deliveryMethod: "econt-office",
        econtOffice: {
          id: 1,
          code: "TST",
          name: "Офис",
          city: "София",
          fullAddress: "x".repeat(501),
        },
      })
    ).rejects.toThrow("Invalid Econt office data")
  })

  it("accepts econt-office with valid office data", async () => {
    const fakeOrder = { id: "order-econt-1", ...validCustomerInfo }
    mockSupabase.single.mockResolvedValueOnce({ data: fakeOrder, error: null })
    vi.mocked(stripe.checkout.sessions.create).mockResolvedValueOnce({
      id: "cs_econt",
      url: "https://checkout.stripe.com/econt",
    } as never)

    const result = await createCheckoutSession({
      cartItems: validCartItems,
      customerInfo: validCustomerInfo,
      deliveryMethod: "econt-office",
      econtOffice: validEcontOffice,
    })

    expect(result.url).toBe("https://checkout.stripe.com/econt")
  })

  it("stores econt office fields in database", async () => {
    const fakeOrder = { id: "order-econt-2" }
    mockSupabase.single.mockResolvedValueOnce({ data: fakeOrder, error: null })
    vi.mocked(stripe.checkout.sessions.create).mockResolvedValueOnce({
      id: "cs_e2",
      url: "https://test.com",
    } as never)

    await createCheckoutSession({
      cartItems: validCartItems,
      customerInfo: validCustomerInfo,
      deliveryMethod: "econt-office",
      econtOffice: validEcontOffice,
    })

    const insertCall = mockSupabase.insert.mock.calls[0][0]
    expect(insertCall.econt_office_id).toBe(42)
    expect(insertCall.econt_office_name).toBe("София - Дружба")
    expect(insertCall.econt_office_address).toBe("бул. Цариградско шосе 115")
    expect(insertCall.logistics_partner).toBe("econt-office")
  })

  it("stores null econt fields for speedy delivery", async () => {
    const fakeOrder = { id: "order-speedy-1" }
    mockSupabase.single.mockResolvedValueOnce({ data: fakeOrder, error: null })
    vi.mocked(stripe.checkout.sessions.create).mockResolvedValueOnce({
      id: "cs_s1",
      url: "https://test.com",
    } as never)

    await createCheckoutSession({
      cartItems: validCartItems,
      customerInfo: validCustomerInfo,
      deliveryMethod: "speedy-office",
      speedyOffice: validSpeedyOffice,
    })

    const insertCall = mockSupabase.insert.mock.calls[0][0]
    expect(insertCall.econt_office_id).toBeNull()
    expect(insertCall.econt_office_name).toBeNull()
    expect(insertCall.econt_office_address).toBeNull()
  })

  it("ignores econtOffice data when delivery is not econt-office", async () => {
    const fakeOrder = { id: "order-speedy-2" }
    mockSupabase.single.mockResolvedValueOnce({ data: fakeOrder, error: null })
    vi.mocked(stripe.checkout.sessions.create).mockResolvedValueOnce({
      id: "cs_s2",
      url: "https://test.com",
    } as never)

    await createCheckoutSession({
      cartItems: validCartItems,
      customerInfo: validCustomerInfo,
      deliveryMethod: "speedy-office",
      speedyOffice: validSpeedyOffice,
      econtOffice: validEcontOffice,
    })

    expect(mockSupabase.insert).toHaveBeenCalled()
  })

  it("handles econt office ID 0 via nullish coalescing when using speedy delivery", async () => {
    const fakeOrder = { id: "order-zero-id" }
    mockSupabase.single.mockResolvedValueOnce({ data: fakeOrder, error: null })
    vi.mocked(stripe.checkout.sessions.create).mockResolvedValueOnce({
      id: "cs_z",
      url: "https://test.com",
    } as never)

    await createCheckoutSession({
      cartItems: validCartItems,
      customerInfo: validCustomerInfo,
      deliveryMethod: "speedy-office",
      speedyOffice: validSpeedyOffice,
      econtOffice: { id: 0, code: "", name: "Test", city: "София", fullAddress: "addr" },
    })

    const insertCall = mockSupabase.insert.mock.calls[0][0]
    expect(insertCall.econt_office_id).toBe(0)
  })

  it("handles undefined fullAddress without crashing", async () => {
    const fakeOrder = { id: "order-undef" }
    mockSupabase.single.mockResolvedValueOnce({ data: fakeOrder, error: null })
    vi.mocked(stripe.checkout.sessions.create).mockResolvedValueOnce({
      id: "cs_u",
      url: "https://test.com",
    } as never)

    // fullAddress is undefined — should not crash on .length check
    const result = await createCheckoutSession({
      cartItems: validCartItems,
      customerInfo: validCustomerInfo,
      deliveryMethod: "econt-office",
      econtOffice: {
        id: 1,
        code: "TST",
        name: "Офис Тест",
        city: "София",
        fullAddress: undefined as unknown as string,
      },
    })

    expect(result.url).toBe("https://test.com")
  })
})

describe("Econt office validation – createCODOrder", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSupabaseMock(mockSupabase)
    mockIp = `test-${Math.random()}`
  })

  it("rejects econt-office delivery without office data", async () => {
    await expect(
      createCODOrder({
        cartItems: validCartItems,
        customerInfo: validCustomerInfo,
        deliveryMethod: "econt-office",
      })
    ).rejects.toThrow("Econt office is required")
  })

  it("creates COD order with valid econt office", async () => {
    const fakeOrder = {
      id: "cod-econt-1",
      email: "test@test.com",
      first_name: "Иван",
    }
    mockSupabase.single.mockResolvedValueOnce({ data: fakeOrder, error: null })

    const result = await createCODOrder({
      cartItems: validCartItems,
      customerInfo: validCustomerInfo,
      deliveryMethod: "econt-office",
      econtOffice: validEcontOffice,
    })

    expect(result).toEqual({ success: true, orderId: "cod-econt-1" })
    const insertCall = mockSupabase.insert.mock.calls[0][0]
    expect(insertCall.econt_office_id).toBe(42)
    expect(insertCall.econt_office_name).toBe("София - Дружба")
    expect(insertCall.logistics_partner).toBe("econt-office")
    expect(insertCall.payment_method).toBe("cod")
  })

  it("stores null econt fields for speedy COD", async () => {
    const fakeOrder = {
      id: "cod-speedy-1",
      email: "test@test.com",
      first_name: "Иван",
    }
    mockSupabase.single.mockResolvedValueOnce({ data: fakeOrder, error: null })

    await createCODOrder({
      cartItems: validCartItems,
      customerInfo: validCustomerInfo,
      deliveryMethod: "speedy-office",
      speedyOffice: validSpeedyOffice,
    })

    const insertCall = mockSupabase.insert.mock.calls[0][0]
    expect(insertCall.econt_office_id).toBeNull()
    expect(insertCall.econt_office_name).toBeNull()
    expect(insertCall.econt_office_address).toBeNull()
  })
})
