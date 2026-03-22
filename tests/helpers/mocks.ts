import { vi } from "vitest"

/**
 * Common vi.mock calls shared across server action test files.
 * Import this file at the top of test files that test server actions
 * which depend on Stripe, Resend, invoice modules, etc.
 */

export function setupStripeMock() {
  vi.mock("@/lib/stripe", () => ({
    stripe: {
      checkout: {
        sessions: { create: vi.fn(), retrieve: vi.fn() },
      },
      coupons: { del: vi.fn(() => Promise.resolve()) },
    },
  }))
}

export function setupResendMock() {
  vi.mock("resend", () => ({
    Resend: class {
      emails = { send: vi.fn(() => Promise.resolve({ id: "test" })) }
    },
  }))
}

export function setupInvoiceMocks() {
  vi.mock("@/lib/invoice", () => ({
    getNextInvoiceNumber: vi.fn(() => Promise.resolve("0000000001")),
  }))
  vi.mock("@/lib/invoice-pdf", () => ({
    generateInvoicePDF: vi.fn(() => Promise.resolve(Buffer.from("fake-pdf"))),
  }))
  vi.mock("@/lib/invoice-email", () => ({
    sendInvoiceEmail: vi.fn(),
  }))
  vi.mock("@/lib/seller", () => ({
    getSellerConfig: vi.fn(() => ({
      companyName: "Test Co", eik: "123456789", vatNumber: "", mol: "Test",
      address: "Test St", city: "Sofia", postalCode: "1000", phone: "",
      email: "", iban: "", bank: "",
    })),
  }))
}

export function setupSalesMock() {
  const mockGetProductsWithSales = vi.fn()
  vi.mock("@/lib/sales", () => ({
    getProductsWithSales: (...args: unknown[]) => mockGetProductsWithSales(...args),
  }))
  return mockGetProductsWithSales
}

export function setupHeadersMock(getIp: () => string) {
  vi.mock("next/headers", () => ({
    headers: vi.fn(() => Promise.resolve({
      get: (name: string) => name === "x-forwarded-for" ? getIp() : null,
    })),
  }))
}
