import { describe, it, expect, vi, beforeEach } from "vitest"
import { createSupabaseMock, resetSupabaseMock, mockThenableResult, createUpdateChain } from "./helpers/supabase-mock"

// Mock Stripe SDK. We control:
//   - webhooks.constructEvent: bypass real signature crypto in tests; return
//     the fake Event the test sets up (via mockReturnValueOnce), or throw to
//     simulate signature failure.
//   - paymentIntents.retrieve: used by checkout.session.completed handler
//     to fetch receipt URL + amount validation.
//   - refunds.list: used by charge.refunded handler to fan out per refund.
vi.mock("@/lib/stripe", () => ({
  stripe: {
    webhooks: {
      constructEvent: vi.fn(),
    },
    paymentIntents: {
      retrieve: vi.fn(),
    },
    refunds: {
      list: vi.fn(),
    },
  },
}))

const mockSupabase = createSupabaseMock()
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
}))

// Resend admin alerts are fire-and-forget. Mock the class so tests can
// assert when alerts fire without sending real emails.
const mockResendSend = vi.fn(() => Promise.resolve({ id: "test-email-id" }))
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: mockResendSend }
  },
}))

// Side-effect helpers — keep behavior under test; assert on calls.
const mockSendOrderConfirmation = vi.fn()
const mockNotifyAdminNewOrder = vi.fn()
vi.mock("@/lib/email-sender", () => ({
  sendOrderConfirmationEmail: (...args: unknown[]) => mockSendOrderConfirmation(...args),
  notifyAdminNewOrder: (...args: unknown[]) => mockNotifyAdminNewOrder(...args),
}))

// Credit-note auto-creation: assert it's called with the right shape; the
// helper itself is unit-tested elsewhere.
const mockAutoCreateCreditNote = vi.fn((..._args: unknown[]) => Promise.resolve())
vi.mock("@/lib/credit-note", () => ({
  autoCreateCreditNoteRow: (...args: unknown[]) => mockAutoCreateCreditNote(...args),
}))

vi.mock("@/lib/env", () => ({
  requireEnv: (name: string) => process.env[name] ?? "test-value",
}))

import { POST } from "@/app/api/webhooks/stripe/route"
import { stripe } from "@/lib/stripe"

const VALID_ORDER_ID = "1122334455"
const VALID_PI_ID = "pi_test_intent_123"

// Build a Request the route can consume. The body is opaque to the route
// during tests because constructEvent is mocked to return our fake Event.
function makeRequest(body = "{}", signature: string | null = "t=123,v1=fake"): Request {
  const headers: Record<string, string> = {}
  if (signature !== null) headers["stripe-signature"] = signature
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    body,
    headers,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  resetSupabaseMock(mockSupabase)
  mockResendSend.mockClear()
  mockSendOrderConfirmation.mockClear()
  mockNotifyAdminNewOrder.mockClear()
  mockAutoCreateCreditNote.mockClear()
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test"
  process.env.RESEND_API_KEY = "re_test"
  process.env.ADMIN_EMAIL = "admin@example.com"
  process.env.EMAIL_FROM = "Test <noreply@example.com>"
})

// ─── Signature verification ────────────────────────────────────────────────

describe("Stripe webhook — signature verification", () => {
  it("rejects request with missing stripe-signature header", async () => {
    const res = await POST(makeRequest("{}", null))
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toMatch(/signature/i)
    // No event was constructed — request short-circuits before crypto.
    expect(stripe.webhooks.constructEvent).not.toHaveBeenCalled()
  })

  it("rejects request when STRIPE_WEBHOOK_SECRET env var is missing", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET
    const res = await POST(makeRequest())
    expect(res.status).toBe(400)
    expect(stripe.webhooks.constructEvent).not.toHaveBeenCalled()
  })

  it("rejects request when constructEvent throws (invalid signature)", async () => {
    vi.mocked(stripe.webhooks.constructEvent).mockImplementationOnce(() => {
      throw new Error("No signatures found matching the expected signature for payload")
    })
    const res = await POST(makeRequest())
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toBe("Invalid signature")
  })

  it("forwards body, signature, and secret into constructEvent verbatim", async () => {
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
      id: "evt_1", type: "unknown.type", data: { object: {} },
    } as never)
    await POST(makeRequest("payload-bytes", "t=42,v1=sig"))
    expect(stripe.webhooks.constructEvent).toHaveBeenCalledWith(
      "payload-bytes",
      "t=42,v1=sig",
      "whsec_test",
    )
  })
})

// ─── Event-type routing — unhandled types ──────────────────────────────────

describe("Stripe webhook — unhandled events", () => {
  it("returns 200 received:true for events the route doesn't handle", async () => {
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
      id: "evt_1", type: "customer.created", data: { object: {} },
    } as never)
    const res = await POST(makeRequest())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({ received: true })
    // No DB writes for unhandled types.
    expect(mockSupabase.update).not.toHaveBeenCalled()
    expect(mockSupabase.insert).not.toHaveBeenCalled()
    expect(mockSupabase.rpc).not.toHaveBeenCalled()
  })
})

// ─── checkout.session.completed ────────────────────────────────────────────

describe("Stripe webhook — checkout.session.completed", () => {
  function fakeCompletedEvent(overrides: Record<string, unknown> = {}) {
    return {
      id: "evt_completed",
      type: "checkout.session.completed",
      data: {
        object: {
          payment_status: "paid",
          payment_intent: VALID_PI_ID,
          metadata: { orderId: VALID_ORDER_ID },
          ...overrides,
        },
      },
    }
  }

  it("flips pending order to confirmed, sets seller_settled_at, sends emails", async () => {
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce(fakeCompletedEvent() as never)
    vi.mocked(stripe.paymentIntents.retrieve).mockResolvedValueOnce({
      latest_charge: { receipt_url: "https://stripe.com/receipts/abc" },
      amount_received: 5140,
    } as never)
    // Order amount check + final update.
    mockSupabase.single
      .mockResolvedValueOnce({ data: { total_amount: 5140 }, error: null }) // amount-mismatch check
      .mockResolvedValueOnce({
        data: { id: VALID_ORDER_ID, email: "c@example.com", first_name: "C" },
        error: null,
      })

    const res = await POST(makeRequest())
    expect(res.status).toBe(200)

    // Persisted state — what gets written is the contract.
    const update = (mockSupabase.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(update).toMatchObject({
      status: "confirmed",
      stripe_payment_intent_id: VALID_PI_ID,
      stripe_receipt_url: "https://stripe.com/receipts/abc",
    })
    expect(update.seller_settled_at).toBeTruthy()
    expect(update.confirmed_at).toBeTruthy()

    // The .eq("status","pending") idempotency guard is verified by the
    // companion test below (duplicate-delivery → no emails). Asserting it
    // here would require capturing the internal updateChain — output is
    // already strong enough.
    expect(mockNotifyAdminNewOrder).toHaveBeenCalledTimes(1)
    expect(mockSendOrderConfirmation).toHaveBeenCalledTimes(1)
  })

  it("skips when payment_status is not 'paid' (e.g. async bank-debit pending)", async () => {
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce(
      fakeCompletedEvent({ payment_status: "unpaid" }) as never,
    )
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect(mockSupabase.update).not.toHaveBeenCalled()
    expect(mockNotifyAdminNewOrder).not.toHaveBeenCalled()
  })

  it("rejects with 400 on missing or malformed orderId metadata", async () => {
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce(
      fakeCompletedEvent({ metadata: { orderId: "not-a-uuid" } }) as never,
    )
    const res = await POST(makeRequest())
    expect(res.status).toBe(400)
    expect(mockSupabase.update).not.toHaveBeenCalled()
  })

  it("is idempotent on duplicate webhook delivery (already-confirmed order)", async () => {
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce(fakeCompletedEvent() as never)
    vi.mocked(stripe.paymentIntents.retrieve).mockResolvedValueOnce({
      latest_charge: null,
      amount_received: 5140,
    } as never)
    // amount-mismatch check returns the order so the update path proceeds.
    mockSupabase.single.mockResolvedValueOnce({ data: { total_amount: 5140 }, error: null })
    // Override the update chain so .single() resolves with no rows
    // (the .eq("status","pending") guard didn't match because the order
    // was already confirmed by an earlier delivery / the success page).
    mockSupabase.update = vi.fn(() => createUpdateChain(null, { message: "no rows" })) as never

    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    // No emails fire on duplicate delivery — protects against double-send
    // when admin success-page confirmation raced ahead.
    expect(mockSendOrderConfirmation).not.toHaveBeenCalled()
    expect(mockNotifyAdminNewOrder).not.toHaveBeenCalled()
  })

  it("logs amount mismatch when Stripe captured a different total than the order", async () => {
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce(fakeCompletedEvent() as never)
    vi.mocked(stripe.paymentIntents.retrieve).mockResolvedValueOnce({
      latest_charge: null,
      amount_received: 9999, // mismatch
    } as never)
    mockSupabase.single
      .mockResolvedValueOnce({ data: { total_amount: 5140 }, error: null })
      .mockResolvedValueOnce({
        data: { id: VALID_ORDER_ID, email: "c@example.com" }, error: null,
      })

    await POST(makeRequest())

    expect(consoleErr).toHaveBeenCalledWith(
      expect.stringContaining("AMOUNT MISMATCH"),
    )
    consoleErr.mockRestore()
  })
})

// ─── checkout.session.expired ──────────────────────────────────────────────

describe("Stripe webhook — checkout.session.expired", () => {
  function fakeExpiredEvent() {
    return {
      id: "evt_expired",
      type: "checkout.session.expired",
      data: { object: { metadata: { orderId: VALID_ORDER_ID } } },
    }
  }

  it("flips pending → expired and restores inventory line-by-line", async () => {
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce(fakeExpiredEvent() as never)
    // Default updateChain claims 1 row ([{id:"updated"}]) — claim succeeds.
    // The order_items lookup is `.from(...).select(...).eq("order_id", ...)`
    // so we override the FIRST mockSupabase.eq() call (the only one in the
    // request: the update chain has its own internal eq, separate from
    // mockSupabase.eq).
    mockSupabase.eq.mockReturnValueOnce(
      mockThenableResult(
        [{ sku: "EGO-DC-12", quantity: 2 }, { sku: "EGO-WCR-12", quantity: 1 }],
        null,
      ) as never,
    )

    const res = await POST(makeRequest())
    expect(res.status).toBe(200)

    // Atomic claim: pending → expired guarded by .eq("status", "pending").
    expect(mockSupabase.update).toHaveBeenCalledWith({ status: "expired" })

    // One restore_inventory RPC per line item.
    const rpcCalls = (mockSupabase.rpc as ReturnType<typeof vi.fn>).mock.calls
    const restoreCalls = rpcCalls.filter((c) => c[0] === "restore_inventory")
    expect(restoreCalls).toHaveLength(2)
    expect(restoreCalls[0][1]).toEqual({
      p_sku: "EGO-DC-12", p_quantity: 2, p_order_id: VALID_ORDER_ID,
    })
    expect(restoreCalls[1][1]).toEqual({
      p_sku: "EGO-WCR-12", p_quantity: 1, p_order_id: VALID_ORDER_ID,
    })
  })

  it("is idempotent: zero-rows-claimed on duplicate delivery skips restore", async () => {
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce(fakeExpiredEvent() as never)
    // Override updateChain so claim resolves with empty data (the
    // .eq("status","pending") guard didn't match — already expired).
    mockSupabase.update = vi.fn(() => createUpdateChain([], null)) as never

    const res = await POST(makeRequest())
    expect(res.status).toBe(200)

    // No restore_inventory calls when claim found 0 rows.
    const rpcCalls = (mockSupabase.rpc as ReturnType<typeof vi.fn>).mock.calls
    expect(rpcCalls.filter((c) => c[0] === "restore_inventory")).toHaveLength(0)
  })

  it("ignores event when orderId metadata is missing", async () => {
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
      id: "evt", type: "checkout.session.expired",
      data: { object: { metadata: {} } },
    } as never)
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect(mockSupabase.update).not.toHaveBeenCalled()
  })
})

// ─── payment_intent.payment_failed ─────────────────────────────────────────

describe("Stripe webhook — payment_intent.payment_failed", () => {
  it("flips pending → expired, restores inventory, records payment_failed audit", async () => {
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
      id: "evt_pf",
      type: "payment_intent.payment_failed",
      data: {
        object: {
          id: "pi_failed_1",
          metadata: { orderId: VALID_ORDER_ID },
          last_payment_error: { code: "card_declined", message: "Your card was declined." },
        },
      },
    } as never)
    // Default updateChain claims 1 row → proceeds to inventory restore.
    mockSupabase.eq.mockReturnValueOnce(
      mockThenableResult([{ sku: "EGO-DC-12", quantity: 1 }], null) as never,
    )

    const res = await POST(makeRequest())
    expect(res.status).toBe(200)

    expect(mockSupabase.update).toHaveBeenCalledWith({ status: "expired" })

    const rpcCalls = (mockSupabase.rpc as ReturnType<typeof vi.fn>).mock.calls
    expect(rpcCalls.filter((c) => c[0] === "restore_inventory")).toHaveLength(1)

    const outcome = rpcCalls.find((c) => c[0] === "record_order_outcome")
    expect(outcome).toBeDefined()
    expect(outcome![1]).toMatchObject({
      p_order_id: VALID_ORDER_ID,
      p_outcome_type: "payment_failed",
      p_actor: "stripe-webhook",
      p_payload: expect.objectContaining({
        payment_intent_id: "pi_failed_1",
        failure_code: "card_declined",
        failure_message: "Your card was declined.",
      }),
    })
  })
})

// ─── Refund event flows ────────────────────────────────────────────────────

describe("Stripe webhook — refund events", () => {
  function fakeRefund(overrides: Record<string, unknown> = {}) {
    return {
      id: "re_test_1",
      object: "refund",
      amount: 1000,
      created: 1700000000,
      payment_intent: VALID_PI_ID,
      reason: "requested_by_customer",
      status: "succeeded",
      ...overrides,
    }
  }

  function setupOrderLookupAndExisting(opts: {
    order?: { id: string } | null
    existingRefund?: { id: string } | null
  } = {}) {
    // findOrderForRefund — orders.select(...).eq(...).single()
    mockSupabase.single.mockResolvedValueOnce({
      data: opts.order === undefined ? { id: VALID_ORDER_ID } : opts.order,
      error: null,
    })
    // upsertRefundFromStripe — refunds.select(...).eq(...).maybeSingle()
    mockSupabase.maybeSingle.mockResolvedValueOnce({
      data: opts.existingRefund ?? null,
      error: null,
    })
  }

  it("refund.created with status=succeeded inserts a refunds row and triggers credit-note auto-create", async () => {
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
      id: "evt_refund_1",
      type: "refund.created",
      data: { object: fakeRefund() },
    } as never)
    setupOrderLookupAndExisting()
    // Insert returns the new refund id.
    mockSupabase.maybeSingle.mockResolvedValueOnce({
      data: { id: "refund-row-id-xyz" },
      error: null,
    })

    const res = await POST(makeRequest())
    expect(res.status).toBe(200)

    expect(mockSupabase.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        order_id: VALID_ORDER_ID,
        stripe_refund_id: "re_test_1",
        amount_cents: 1000,
        method: "stripe",
        source: "stripe_webhook",
        recorded_by: "stripe-webhook",
      }),
    )

    expect(mockAutoCreateCreditNote).toHaveBeenCalledWith(
      mockSupabase,
      expect.objectContaining({
        orderId: VALID_ORDER_ID,
        refundId: "refund-row-id-xyz",
      }),
    )

    // Admin alert fires on the new-refund path.
    expect(mockResendSend).toHaveBeenCalled()
  })

  it("is idempotent: existing stripe_refund_id is a no-op on duplicate delivery", async () => {
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
      id: "evt_refund_dup",
      type: "refund.created",
      data: { object: fakeRefund() },
    } as never)
    setupOrderLookupAndExisting({ existingRefund: { id: "preexisting" } })

    const res = await POST(makeRequest())
    expect(res.status).toBe(200)

    // Existing row found → fast-path return; never insert, never alert.
    expect(mockSupabase.insert).not.toHaveBeenCalled()
    expect(mockAutoCreateCreditNote).not.toHaveBeenCalled()
  })

  it("treats refund.updated identically to refund.created (same upsert path)", async () => {
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
      id: "evt_refund_updated",
      type: "refund.updated",
      data: { object: fakeRefund() },
    } as never)
    setupOrderLookupAndExisting()
    mockSupabase.maybeSingle.mockResolvedValueOnce({
      data: { id: "refund-row-id" }, error: null,
    })

    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect(mockSupabase.insert).toHaveBeenCalledWith(
      expect.objectContaining({ stripe_refund_id: "re_test_1" }),
    )
  })

  it("refund.failed: no DB write, admin alert with failure_reason", async () => {
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
      id: "evt_refund_failed",
      type: "refund.failed",
      data: { object: fakeRefund({ status: "failed", failure_reason: "expired_or_canceled_card" }) },
    } as never)
    // findOrderForRefund still runs to attach order context to the alert.
    mockSupabase.single.mockResolvedValueOnce({
      data: { id: VALID_ORDER_ID }, error: null,
    })

    const res = await POST(makeRequest())
    expect(res.status).toBe(200)

    expect(mockSupabase.insert).not.toHaveBeenCalled()
    expect(mockResendSend).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining("FAILED"),
        text: expect.stringContaining("expired_or_canceled_card"),
      }),
    )
  })

  it("refund with status=canceled: no DB write, informational alert", async () => {
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
      id: "evt_refund_canceled",
      type: "refund.updated",
      data: { object: fakeRefund({ status: "canceled" }) },
    } as never)
    mockSupabase.single.mockResolvedValueOnce({
      data: { id: VALID_ORDER_ID }, error: null,
    })

    const res = await POST(makeRequest())
    expect(res.status).toBe(200)

    expect(mockSupabase.insert).not.toHaveBeenCalled()
    expect(mockResendSend).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining("canceled"),
      }),
    )
  })

  it("refund with status=pending: silent skip — no DB write, no alert", async () => {
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
      id: "evt_refund_pending",
      type: "refund.created",
      data: { object: fakeRefund({ status: "pending" }) },
    } as never)

    const res = await POST(makeRequest())
    expect(res.status).toBe(200)

    expect(mockSupabase.insert).not.toHaveBeenCalled()
    expect(mockResendSend).not.toHaveBeenCalled()
  })

  it("returns 200 without DB write when refund's payment_intent does not match any order", async () => {
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
      id: "evt_refund_orphan",
      type: "refund.created",
      data: { object: fakeRefund() },
    } as never)
    // Order lookup returns null — refund is for a payment we don't know about.
    mockSupabase.single.mockResolvedValueOnce({ data: null, error: null })

    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect(mockSupabase.insert).not.toHaveBeenCalled()
  })

  it("charge.refunded fans out via stripe.refunds.list and upserts each refund", async () => {
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
      id: "evt_charge_refunded",
      type: "charge.refunded",
      data: { object: { id: "ch_test_1" } },
    } as never)
    vi.mocked(stripe.refunds.list).mockResolvedValueOnce({
      data: [
        fakeRefund({ id: "re_a", amount: 500 }),
        fakeRefund({ id: "re_b", amount: 700 }),
      ],
    } as never)
    // Per-refund: order lookup + existing-row check + insert (×2)
    setupOrderLookupAndExisting()
    mockSupabase.maybeSingle.mockResolvedValueOnce({ data: { id: "row-1" }, error: null })
    setupOrderLookupAndExisting()
    mockSupabase.maybeSingle.mockResolvedValueOnce({ data: { id: "row-2" }, error: null })

    const res = await POST(makeRequest())
    expect(res.status).toBe(200)

    expect(stripe.refunds.list).toHaveBeenCalledWith({ charge: "ch_test_1", limit: 10 })

    const insertCalls = (mockSupabase.insert as ReturnType<typeof vi.fn>).mock.calls
    expect(insertCalls).toHaveLength(2)
    expect(insertCalls[0][0]).toMatchObject({ stripe_refund_id: "re_a", amount_cents: 500 })
    expect(insertCalls[1][0]).toMatchObject({ stripe_refund_id: "re_b", amount_cents: 700 })
  })
})

// ─── Dispute lifecycle ─────────────────────────────────────────────────────

describe("Stripe webhook — dispute events", () => {
  function fakeDispute(overrides: Record<string, unknown> = {}) {
    return {
      id: "dp_test_1",
      object: "dispute",
      amount: 5000,
      reason: "fraudulent",
      status: "needs_response",
      payment_intent: VALID_PI_ID,
      evidence_details: { due_by: 1700000000 },
      ...overrides,
    }
  }

  it("charge.dispute.created records dispute_opened audit + admin alert with due-by date", async () => {
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
      id: "evt_dispute_created",
      type: "charge.dispute.created",
      data: { object: fakeDispute() },
    } as never)
    mockSupabase.single.mockResolvedValueOnce({
      data: { id: VALID_ORDER_ID }, error: null,
    })

    const res = await POST(makeRequest())
    expect(res.status).toBe(200)

    const rpcCalls = (mockSupabase.rpc as ReturnType<typeof vi.fn>).mock.calls
    const outcome = rpcCalls.find((c) => c[0] === "record_order_outcome")
    expect(outcome![1]).toMatchObject({
      p_order_id: VALID_ORDER_ID,
      p_outcome_type: "dispute_opened",
      p_actor: "stripe-webhook",
      p_payload: expect.objectContaining({
        dispute_id: "dp_test_1",
        amount: 5000,
        reason: "fraudulent",
      }),
    })
    expect(mockResendSend).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining("Chargeback opened"),
      }),
    )
  })

  it("charge.dispute.closed (won) records dispute_closed and alerts with 'WON' subject", async () => {
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
      id: "evt_dispute_won",
      type: "charge.dispute.closed",
      data: { object: fakeDispute({ status: "won" }) },
    } as never)
    mockSupabase.single.mockResolvedValueOnce({
      data: { id: VALID_ORDER_ID }, error: null,
    })

    await POST(makeRequest())

    const rpcCalls = (mockSupabase.rpc as ReturnType<typeof vi.fn>).mock.calls
    const outcome = rpcCalls.find((c) => c[0] === "record_order_outcome")
    expect(outcome![1].p_outcome_type).toBe("dispute_closed")
    expect(outcome![1].p_payload.status).toBe("won")
    expect(mockResendSend).toHaveBeenCalledWith(
      expect.objectContaining({ subject: expect.stringContaining("WON") }),
    )
  })

  it("charge.dispute.closed (lost) alerts with 'LOST' subject", async () => {
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
      id: "evt_dispute_lost",
      type: "charge.dispute.closed",
      data: { object: fakeDispute({ status: "lost" }) },
    } as never)
    mockSupabase.single.mockResolvedValueOnce({
      data: { id: VALID_ORDER_ID }, error: null,
    })

    await POST(makeRequest())

    expect(mockResendSend).toHaveBeenCalledWith(
      expect.objectContaining({ subject: expect.stringContaining("LOST") }),
    )
  })

  it("charge.dispute.funds_reinstated records dispute_funds_reinstated audit", async () => {
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
      id: "evt_funds_reinstated",
      type: "charge.dispute.funds_reinstated",
      data: { object: fakeDispute({ status: "won" }) },
    } as never)
    mockSupabase.single.mockResolvedValueOnce({
      data: { id: VALID_ORDER_ID }, error: null,
    })

    await POST(makeRequest())

    const rpcCalls = (mockSupabase.rpc as ReturnType<typeof vi.fn>).mock.calls
    const outcome = rpcCalls.find((c) => c[0] === "record_order_outcome")
    expect(outcome![1].p_outcome_type).toBe("dispute_funds_reinstated")
    expect(outcome![1].p_payload.dispute_id).toBe("dp_test_1")
  })

  it("dispute event whose payment_intent does not match an order is a no-op", async () => {
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
      id: "evt_orphan_dispute",
      type: "charge.dispute.created",
      data: { object: fakeDispute() },
    } as never)
    mockSupabase.single.mockResolvedValueOnce({ data: null, error: null })

    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect(mockSupabase.rpc).not.toHaveBeenCalled()
    expect(mockResendSend).not.toHaveBeenCalled()
  })
})
