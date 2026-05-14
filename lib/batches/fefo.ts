export interface BatchInput {
  id: string
  expiryDate: string
  createdAt: string
  availableQty: number
}

export interface FefoPlan {
  allocations: Map<string, number>
  remainingQty: number
  isFullyAllocated: boolean
}

/**
 * Build the FEFO (First-Expired-First-Out) allocation plan for a SKU's
 * ordered quantity. Sort by expiry ascending, createdAt as tiebreaker;
 * greedily fill from each batch's `availableQty` until ordered qty is
 * met or batches are exhausted.
 *
 * Returns a structured result rather than throwing on insufficient stock,
 * so callers (e.g. autoAllocateFefo) can produce a friendly error without
 * exception flow for the normal "not enough stock" branch.
 */
export function buildExpectedFefoPlan(args: {
  orderedQty: number
  batches: BatchInput[]
}): FefoPlan {
  const { orderedQty, batches } = args
  const sorted = [...batches].sort((a, b) => {
    if (a.expiryDate !== b.expiryDate) return a.expiryDate.localeCompare(b.expiryDate)
    return a.createdAt.localeCompare(b.createdAt)
  })

  const allocations = new Map<string, number>()
  let remaining = orderedQty
  for (const batch of sorted) {
    if (remaining <= 0) break
    const take = Math.min(remaining, batch.availableQty)
    if (take > 0) {
      allocations.set(batch.id, take)
      remaining -= take
    }
  }

  return {
    allocations,
    remainingQty: remaining,
    isFullyAllocated: remaining === 0,
  }
}

/**
 * INVARIANT: assumes sum-equality has been validated upstream (sum of
 * `savedAllocation` values == orderedQty). Without that precondition,
 * a saved allocation that adds an extra later-expiring batch on top of
 * the full FEFO plan would incorrectly pass — every (batch, qty) in
 * `expectedPlan` is satisfied while the order is over-allocated.
 * `saveBatchAllocation` runs sum-equality first; tests pin the order.
 */
export function isFefoCompliant(
  savedAllocation: Map<string, number>,
  expectedPlan: Map<string, number>,
): boolean {
  for (const [batchId, expectedQty] of expectedPlan) {
    if ((savedAllocation.get(batchId) ?? 0) < expectedQty) return false
  }
  return true
}
