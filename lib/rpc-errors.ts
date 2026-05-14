// Stable mapping from Postgres RPC errors to user-facing Bulgarian
// messages. The plpgsql functions raise with `using hint = 'CODE'` so
// the app can translate without grepping the message text — that
// pattern was brittle (any wording tweak in the SQL silently broke the
// UX path that depended on a specific substring).

interface RpcErrorLike {
  message?: string | null
  hint?: string | null
  code?: string | null
}

/**
 * Translate an RPC error to a user-facing message using the stable
 * `hint` field. Falls back to `fallback` when the hint isn't in the
 * map, the hint is missing, or the error itself is null.
 *
 * Usage:
 *   throw new Error(translateRpcError(rpcError, {
 *     BATCH_ALLOCATION_LOCKED: "Партидите вече са заключени...",
 *     ORDER_NOT_CONFIRMED: "Поръчката не е в статус...",
 *   }, "Грешка при записване на разпределението"))
 */
export function translateRpcError(
  err: RpcErrorLike | null | undefined,
  hintMap: Record<string, string>,
  fallback: string,
): string {
  if (!err) return fallback
  const hint = err.hint
  if (hint && hintMap[hint]) return hintMap[hint]
  return fallback
}
