// Map a PostgrestError-like object's `hint` field to a friendly Bulgarian
// message. Postgres plpgsql functions emit stable HINT codes via
// `RAISE EXCEPTION ... using hint = 'CODE'`; this helper turns that into the
// admin-facing string. Replaces the prior brittle pattern of
// `error.message?.includes("substring")` matching, which broke when DB
// messages were reworded.
//
// Usage:
//   const { error } = await supabase.rpc("foo", { ... })
//   if (error) throw new Error(translateRpcError(error, {
//     ORDER_NOT_FOUND: "Поръчката не е намерена",
//     INVALID_QUANTITY: "Количеството трябва да е положително",
//   }, "Грешка при изпълнение"))

export interface RpcErrorLike {
  hint?: string | null
  message?: string | null
  code?: string | null
}

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
