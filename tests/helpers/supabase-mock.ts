import { vi } from "vitest"

/**
 * Creates a chainable Supabase mock that returns itself for all query builder methods.
 * Use `mockSupabase.single.mockResolvedValueOnce(...)` to control returned data.
 */
export function createSupabaseMock() {
  const mock: Record<string, ReturnType<typeof vi.fn>> = {
    from: vi.fn(() => mock),
    select: vi.fn(() => mock),
    insert: vi.fn(() => mock),
    update: vi.fn(() => mock),
    delete: vi.fn(() => mock),
    eq: vi.fn(() => mock),
    neq: vi.fn(() => mock),
    order: vi.fn(() => mock),
    range: vi.fn(() => mock),
    limit: vi.fn(() => mock),
    is: vi.fn(() => mock),
    not: vi.fn(() => mock),
    ilike: vi.fn(() => mock),
    or: vi.fn(() => mock),
    gte: vi.fn(() => mock),
    lte: vi.fn(() => mock),
    single: vi.fn(),
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
  }
  return mock
}

/**
 * Creates a thenable object that resolves with { data, error, count }.
 * Used for mocking Supabase query results that are awaited.
 */
export function mockThenableResult(data: unknown, error: unknown = null, count: number | null = null) {
  const obj: Record<string, unknown> = {
    eq: vi.fn(() => obj),
    neq: vi.fn(() => obj),
    is: vi.fn(() => obj),
    not: vi.fn(() => obj),
    ilike: vi.fn(() => obj),
    or: vi.fn(() => obj),
    gte: vi.fn(() => obj),
    lte: vi.fn(() => obj),
    select: vi.fn(() => obj),
    range: vi.fn(() => obj),
    then(resolve: (v: unknown) => void) {
      resolve({ data, error, count })
    },
  }
  return obj
}

/**
 * Creates a chainable update mock that resolves with a successful update result.
 * Use this for tests that call .update().eq().eq().select() chains.
 */
export function createUpdateChain(data: unknown = [{ id: "updated" }], error: unknown = null) {
  const chain: Record<string, unknown> = {
    eq: vi.fn(() => chain),
    is: vi.fn(() => chain),
    select: vi.fn(() => chain),
    single: vi.fn(() => Promise.resolve({ data: Array.isArray(data) ? data[0] : data, error })),
    then(resolve: (v: unknown) => void) {
      resolve({ data, error })
    },
  }
  return chain
}

/**
 * Resets all chainable methods on the mock to return the mock itself.
 * Call this in beforeEach to prevent state leaking between tests.
 */
export function resetSupabaseMock(mock: Record<string, ReturnType<typeof vi.fn>>) {
  const updateChain = createUpdateChain()
  mock.from = vi.fn(() => mock)
  mock.select = vi.fn(() => mock)
  mock.insert = vi.fn(() => mock)
  mock.update = vi.fn(() => updateChain)
  mock.delete = vi.fn(() => mock)
  mock.eq = vi.fn(() => mock)
  mock.neq = vi.fn(() => mock)
  mock.order = vi.fn(() => mock)
  mock.range = vi.fn(() => mock)
  mock.limit = vi.fn(() => mock)
  mock.is = vi.fn(() => mock)
  mock.not = vi.fn(() => mock)
  mock.ilike = vi.fn(() => mock)
  mock.or = vi.fn(() => mock)
  mock.gte = vi.fn(() => mock)
  mock.lte = vi.fn(() => mock)
  mock.single = vi.fn()
  mock.rpc = vi.fn(() => Promise.resolve({ data: null, error: null }))
}
