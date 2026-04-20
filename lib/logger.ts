// Lightweight PII-safe error logging.
//
// Usage:
//   console.error("Failed to create order:", sanitizeError(err))
//
// What it does:
//   - Extracts only structured fields from Supabase/Error objects (code, hint,
//     name, redacted message). Drops .details and other fields that have
//     historically leaked inserted column values.
//   - Redacts email and Bulgarian phone-number patterns from any string it
//     passes through.
//   - Preserves UUIDs (order IDs aren't PII on their own and are useful for
//     correlating logs).
//
// This is deliberately a small, explicit helper, not a blanket wrapper around
// console.error — callers opt in where the logged value could contain PII.
// Pure-static error messages and ID-only logs don't need it.

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g
// Bulgarian phone shapes: +359XXXXXXXXX, 00359XXXXXXXXX, 0XXXXXXXXX (8-9 digits after)
const PHONE_RE = /(?:\+?359|00359|0)\d{8,9}/g

export function redactPii(input: string): string {
  return input.replace(EMAIL_RE, "[email]").replace(PHONE_RE, "[phone]")
}

export interface SanitizedError {
  name?: string
  code?: unknown
  hint?: unknown
  message?: string
}

export function sanitizeError(err: unknown): SanitizedError | { error: string } {
  if (err === null || err === undefined) {
    return { error: "null" }
  }

  if (err instanceof Error) {
    return {
      name: err.name,
      message: redactPii(err.message),
    }
  }

  if (typeof err === "object") {
    const e = err as Record<string, unknown>
    const out: SanitizedError = {}
    if (e.code !== undefined) out.code = e.code
    if (e.hint !== undefined) out.hint = e.hint
    if (typeof e.message === "string") out.message = redactPii(e.message)
    return out
  }

  return { error: redactPii(String(err)) }
}
