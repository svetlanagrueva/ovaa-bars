import { describe, it, expect, vi, beforeEach } from "vitest"
import { createSupabaseMock, resetSupabaseMock, mockThenableResult } from "./helpers/supabase-mock"

// Auth + heavy collaborators stubbed; this suite only exercises
// updateOrderDeliveryMethod's input validation, status/tracking guards,
// no-op detection, and the audit-emit shape.
vi.mock("@/lib/admin-auth", () => ({
  createAdminSession: vi.fn(),
  validateAdminSession: vi.fn(() => Promise.resolve(true)),
  destroyAdminSession: vi.fn(),
}))
vi.mock("@/lib/speedy", () => ({ createShipment: vi.fn() }))
vi.mock("@/lib/econt", () => ({ createShipment: vi.fn() }))
vi.mock("@/lib/delivery-confirmation", () => ({ confirmDeliveryForOrder: vi.fn() }))
vi.mock("@/lib/stripe", () => ({ stripe: { refunds: { retrieve: vi.fn() } } }))
vi.mock("@/lib/credit-note", () => ({ autoCreateCreditNoteRow: vi.fn() }))
vi.mock("resend", () => ({ Resend: class { emails = { send: vi.fn() } } }))
vi.mock("@/lib/email-sender", () => ({
  sendOrderConfirmationEmail: vi.fn(),
  sendDeliveryEmail: vi.fn(),
  notifyAdminNewOrder: vi.fn(),
  sendWithdrawalReceivedEmail: vi.fn(),
  sendWithdrawalApprovedEmail: vi.fn(),
  sendWithdrawalRejectedEmail: vi.fn(),
}))
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }))
vi.mock("next/headers", () => ({ headers: vi.fn(() => Promise.resolve({ get: () => null })) }))
vi.mock("next/navigation", () => ({ redirect: vi.fn() }))

const mockSupabase = createSupabaseMock()
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
}))

const VALID_ORDER_ID = "11111111-1111-1111-1111-111111111111"

// Default "before" snapshot the action reads first — speedy-address order,
// so most tests can target moving it to econt-office.
const BEFORE_SPEEDY_ADDRESS = {
  logistics_partner: "speedy-address",
  status: "confirmed",
  tracking_number: null,
  city: "София",
  address: "ул. Тест 1",
  postal_code: "1000",
  speedy_office_id: null,
  speedy_office_name: null,
  speedy_office_address: null,
  econt_office_id: null,
  econt_office_code: null,
  econt_office_name: null,
  econt_office_address: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  vi.stubEnv("ADMIN_PASSWORD", "test-password")
  resetSupabaseMock(mockSupabase)
})

describe("updateOrderDeliveryMethod — input validation (rejects before DB)", () => {
  it("rejects invalid order ID", async () => {
    const { updateOrderDeliveryMethod } = await import("@/app/actions/admin")
    await expect(
      updateOrderDeliveryMethod("not-a-uuid", { partner: "econt-office", city: "София" }),
    ).rejects.toThrow("Invalid order ID")
  })

  it("rejects unknown partner", async () => {
    const { updateOrderDeliveryMethod } = await import("@/app/actions/admin")
    await expect(
      updateOrderDeliveryMethod(VALID_ORDER_ID, {
        // @ts-expect-error testing runtime guard against bogus partner
        partner: "fedex-overnight",
        city: "София",
      }),
    ).rejects.toThrow("Невалиден метод")
  })

  it("rejects empty city", async () => {
    const { updateOrderDeliveryMethod } = await import("@/app/actions/admin")
    await expect(
      updateOrderDeliveryMethod(VALID_ORDER_ID, { partner: "speedy-address", city: "" }),
    ).rejects.toThrow("Градът е задължителен")
  })

  it("rejects speedy-address without address", async () => {
    const { updateOrderDeliveryMethod } = await import("@/app/actions/admin")
    await expect(
      updateOrderDeliveryMethod(VALID_ORDER_ID, { partner: "speedy-address", city: "София" }),
    ).rejects.toThrow("Адресът е задължителен")
  })

  it("rejects speedy-address without postal code", async () => {
    const { updateOrderDeliveryMethod } = await import("@/app/actions/admin")
    await expect(
      updateOrderDeliveryMethod(VALID_ORDER_ID, {
        partner: "speedy-address",
        city: "София",
        address: "ул. Тест 1",
      }),
    ).rejects.toThrow("Пощенският код е задължителен")
  })

  it("rejects speedy-office without office id", async () => {
    const { updateOrderDeliveryMethod } = await import("@/app/actions/admin")
    await expect(
      updateOrderDeliveryMethod(VALID_ORDER_ID, {
        partner: "speedy-office",
        city: "София",
        speedyOfficeName: "X",
        speedyOfficeAddress: "Y",
      }),
    ).rejects.toThrow("Изберете офис на Speedy")
  })

  it("rejects econt-office without office code", async () => {
    const { updateOrderDeliveryMethod } = await import("@/app/actions/admin")
    await expect(
      updateOrderDeliveryMethod(VALID_ORDER_ID, {
        partner: "econt-office",
        city: "София",
        econtOfficeId: 1056,
        econtOfficeName: "X",
        econtOfficeAddress: "Y",
      }),
    ).rejects.toThrow("Кодът на Еконт офиса")
  })
})

describe("updateOrderDeliveryMethod — status / tracking guards", () => {
  it("rejects when order is shipped", async () => {
    mockSupabase.single = vi.fn(() => Promise.resolve({
      data: { ...BEFORE_SPEEDY_ADDRESS, status: "shipped" }, error: null,
    }))
    const { updateOrderDeliveryMethod } = await import("@/app/actions/admin")
    await expect(
      updateOrderDeliveryMethod(VALID_ORDER_ID, {
        partner: "econt-office",
        city: "София",
        econtOfficeId: 1056,
        econtOfficeCode: "1056",
        econtOfficeName: "Center",
        econtOfficeAddress: "ул. Тест 5",
      }),
    ).rejects.toThrow(/чакащи \/ потвърдени/)
  })

  it("rejects when tracking_number is already set", async () => {
    mockSupabase.single = vi.fn(() => Promise.resolve({
      data: { ...BEFORE_SPEEDY_ADDRESS, tracking_number: "SP-123" }, error: null,
    }))
    const { updateOrderDeliveryMethod } = await import("@/app/actions/admin")
    await expect(
      updateOrderDeliveryMethod(VALID_ORDER_ID, {
        partner: "econt-office",
        city: "София",
        econtOfficeId: 1056,
        econtOfficeCode: "1056",
        econtOfficeName: "Center",
        econtOfficeAddress: "ул. Тест 5",
      }),
    ).rejects.toThrow(/анулирайте товарителницата първо/)
  })

  it("rejects when order isn't found", async () => {
    mockSupabase.single = vi.fn(() => Promise.resolve({ data: null, error: { message: "not found" } }))
    const { updateOrderDeliveryMethod } = await import("@/app/actions/admin")
    await expect(
      updateOrderDeliveryMethod(VALID_ORDER_ID, { partner: "econt-office", city: "София",
        econtOfficeId: 1056, econtOfficeCode: "1056", econtOfficeName: "X", econtOfficeAddress: "Y" }),
    ).rejects.toThrow("Поръчката не е намерена")
  })
})

describe("updateOrderDeliveryMethod — no-op detection", () => {
  it("rejects when partner + fields are unchanged", async () => {
    mockSupabase.single = vi.fn(() => Promise.resolve({ data: BEFORE_SPEEDY_ADDRESS, error: null }))
    const { updateOrderDeliveryMethod } = await import("@/app/actions/admin")
    await expect(
      updateOrderDeliveryMethod(VALID_ORDER_ID, {
        partner: "speedy-address",
        city: "София",
        address: "ул. Тест 1",
        postalCode: "1000",
      }),
    ).rejects.toThrow("Няма промяна за прилагане")
  })
})

describe("updateOrderDeliveryMethod — happy path", () => {
  function setupHappyPath(before = BEFORE_SPEEDY_ADDRESS) {
    mockSupabase.single = vi.fn(() => Promise.resolve({ data: before, error: null }))
    // Atomic UPDATE chain: .from().update().eq().in().is().select() returns the
    // updated row(s). The select-at-end returns through the thenable.
    const updateChain = {
      eq: vi.fn(() => updateChain),
      in: vi.fn(() => updateChain),
      is: vi.fn(() => updateChain),
      select: vi.fn(() => mockThenableResult([{ id: VALID_ORDER_ID }], null)),
    }
    mockSupabase.update = vi.fn(() => updateChain) as never
  }

  it("happy path: speedy-address → econt-office calls update + emits audit event", async () => {
    setupHappyPath()
    const { updateOrderDeliveryMethod } = await import("@/app/actions/admin")

    const result = await updateOrderDeliveryMethod(VALID_ORDER_ID, {
      partner: "econt-office",
      city: "София",
      econtOfficeId: 1056,
      econtOfficeCode: "1056",
      econtOfficeName: "София Център",
      econtOfficeAddress: "тестов адрес",
    })

    expect(result).toEqual({ success: true, fromPartner: "speedy-address", toPartner: "econt-office" })

    expect(mockSupabase.update).toHaveBeenCalledWith(expect.objectContaining({
      logistics_partner: "econt-office",
      city: "София",
      // Old partner's fields nulled
      address: "",
      postal_code: "",
      // New partner's fields populated
      econt_office_id: 1056,
      econt_office_code: "1056",
      econt_office_name: "София Център",
      econt_office_address: "тестов адрес",
      // Other office fields cleared
      speedy_office_id: null,
      speedy_office_name: null,
      speedy_office_address: null,
    }))

    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      "record_order_outcome",
      expect.objectContaining({
        p_outcome_type: "delivery_method_changed",
        p_payload: expect.objectContaining({
          from_partner: "speedy-address",
          to_partner: "econt-office",
          from: expect.objectContaining({ city: "София", address: "ул. Тест 1", postal_code: "1000" }),
          to: expect.objectContaining({ office_id: 1056, office_code: "1056" }),
        }),
      }),
    )
  })

  it("appends an admin_note when reason is supplied", async () => {
    setupHappyPath()
    const { updateOrderDeliveryMethod } = await import("@/app/actions/admin")

    await updateOrderDeliveryMethod(VALID_ORDER_ID, {
      partner: "econt-office",
      city: "София",
      econtOfficeId: 1056,
      econtOfficeCode: "1056",
      econtOfficeName: "София Център",
      econtOfficeAddress: "тестов адрес",
      reason: "обаждане с клиента — премина към Еконт офис",
    })

    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      "add_admin_note",
      expect.objectContaining({
        p_text: expect.stringContaining("speedy-address → econt-office"),
      }),
    )
  })

  it("does NOT append an admin_note when reason is omitted", async () => {
    setupHappyPath()
    const { updateOrderDeliveryMethod } = await import("@/app/actions/admin")

    await updateOrderDeliveryMethod(VALID_ORDER_ID, {
      partner: "econt-office",
      city: "София",
      econtOfficeId: 1056,
      econtOfficeCode: "1056",
      econtOfficeName: "София Център",
      econtOfficeAddress: "тестов адрес",
    })

    const noteCalls = (mockSupabase.rpc as ReturnType<typeof vi.fn>).mock.calls
      .filter((c) => c[0] === "add_admin_note")
    expect(noteCalls).toHaveLength(0)
  })
})
