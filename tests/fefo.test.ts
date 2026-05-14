import { describe, it, expect } from "vitest"
import { buildExpectedFefoPlan, isFefoCompliant } from "@/lib/batches/fefo"

const batchA = { id: "A", expiryDate: "2026-05-24", createdAt: "2026-04-01T00:00:00Z", availableQty: 3 }
const batchB = { id: "B", expiryDate: "2026-06-12", createdAt: "2026-04-15T00:00:00Z", availableQty: 10 }
const batchC_sameExpiryNewer = { id: "C", expiryDate: "2026-05-24", createdAt: "2026-04-15T00:00:00Z", availableQty: 5 }

describe("buildExpectedFefoPlan", () => {
  it("single batch with exact quantity", () => {
    const plan = buildExpectedFefoPlan({ orderedQty: 3, batches: [batchA] })
    expect(plan.allocations).toEqual(new Map([["A", 3]]))
    expect(plan.remainingQty).toBe(0)
    expect(plan.isFullyAllocated).toBe(true)
  })

  it("splits across two batches in expiry order (earlier first)", () => {
    const plan = buildExpectedFefoPlan({ orderedQty: 5, batches: [batchA, batchB] })
    expect(plan.allocations).toEqual(new Map([["A", 3], ["B", 2]]))
    expect(plan.remainingQty).toBe(0)
    expect(plan.isFullyAllocated).toBe(true)
  })

  it("input order doesn't matter — sort is by expiry then createdAt", () => {
    const plan = buildExpectedFefoPlan({ orderedQty: 5, batches: [batchB, batchA] })
    expect(plan.allocations).toEqual(new Map([["A", 3], ["B", 2]]))
  })

  it("uses createdAt as tiebreaker when expiry dates match", () => {
    // A and C both expire 2026-05-24, but A was created earlier
    const plan = buildExpectedFefoPlan({ orderedQty: 5, batches: [batchC_sameExpiryNewer, batchA] })
    expect(plan.allocations.get("A")).toBe(3)
    expect(plan.allocations.get("C")).toBe(2)
  })

  it("returns partial plan with remainingQty when stock is insufficient", () => {
    // Order 20 but only 3 + 10 = 13 available
    const plan = buildExpectedFefoPlan({ orderedQty: 20, batches: [batchA, batchB] })
    expect(plan.allocations).toEqual(new Map([["A", 3], ["B", 10]]))
    expect(plan.remainingQty).toBe(7)
    expect(plan.isFullyAllocated).toBe(false)
  })

  it("returns empty plan when no batches are provided", () => {
    const plan = buildExpectedFefoPlan({ orderedQty: 5, batches: [] })
    expect(plan.allocations.size).toBe(0)
    expect(plan.remainingQty).toBe(5)
    expect(plan.isFullyAllocated).toBe(false)
  })

  it("skips zero-availability batches without recording an allocation", () => {
    const empty = { ...batchA, availableQty: 0 }
    const plan = buildExpectedFefoPlan({ orderedQty: 5, batches: [empty, batchB] })
    expect(plan.allocations.has("A")).toBe(false)
    expect(plan.allocations.get("B")).toBe(5)
    expect(plan.isFullyAllocated).toBe(true)
  })
})

describe("isFefoCompliant", () => {
  // Expected plan for orderedQty=5 with [A:3, B:10]: { A: 3, B: 2 }
  const expected = buildExpectedFefoPlan({ orderedQty: 5, batches: [batchA, batchB] }).allocations

  it("compliant: matches the expected FEFO split", () => {
    const saved = new Map([["A", 3], ["B", 2]])
    expect(isFefoCompliant(saved, expected)).toBe(true)
  })

  it("non-compliant: skipped earlier-expiring batch entirely", () => {
    // Saved {B: 5} skips A despite A having earlier expiry + 3 available
    const saved = new Map([["B", 5]])
    expect(isFefoCompliant(saved, expected)).toBe(false)
  })

  it("non-compliant: partial skip of earlier batch", () => {
    // Saved {A: 1, B: 4} skips 2 of A's available units
    const saved = new Map([["A", 1], ["B", 4]])
    expect(isFefoCompliant(saved, expected)).toBe(false)
  })

  it("compliance check alone passes when extra later batch is added on top of full FEFO plan", () => {
    // INVARIANT: with {A: 3, B: 2, C: 1} this returns true — every batch in
    // expectedPlan is fully covered. The over-allocation (sum 6 vs ordered 5)
    // is caught upstream by sum-equality validation in saveBatchAllocation,
    // not here. Documents the sum-equality dependency.
    const saved = new Map([["A", 3], ["B", 2], ["C", 1]])
    expect(isFefoCompliant(saved, expected)).toBe(true)
  })

  it("compliant when expected plan is empty (no FEFO requirements)", () => {
    expect(isFefoCompliant(new Map(), new Map())).toBe(true)
  })
})
