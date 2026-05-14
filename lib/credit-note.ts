import { createClient } from "@/lib/supabase/server"
import { sanitizeError } from "@/lib/logger"

const CREDIT_NOTE_DUE_DAYS = 5

// Auto-create a type='credit_note' row in invoices for a refund, if the
// order had an invoice issued (Microinvest number set). Returns the new
// credit_note row id, or null if the conditions weren't met or insertion
// failed.
//
// Conditions for creation:
//   1. An invoices row of type='invoice' exists for this order
//   2. That invoice row has invoice_number set (фактура actually issued)
//
// Caller is responsible for the third condition (admin's
// affects_invoiced_supply flag) — we don't fetch the refund here, just trust
// the caller's intent. due_at is refunded_at + 5 days per ЗДДС Чл. 113 ал. 4.
export async function autoCreateCreditNoteRow(
  supabase: Awaited<ReturnType<typeof createClient>>,
  params: {
    orderId: string
    refundId: string
    refundedAt: string
  },
): Promise<string | null> {
  const { data: invoiceRow, error: lookupError } = await supabase
    .from("invoices")
    .select("id, invoice_number")
    .eq("order_id", params.orderId)
    .eq("type", "invoice")
    .maybeSingle()

  if (lookupError) {
    console.error(
      `Credit-note auto-creation lookup failed for refund ${params.refundId}:`,
      sanitizeError(lookupError),
    )
    return null
  }

  if (!invoiceRow?.invoice_number) return null

  const dueAt = new Date(
    new Date(params.refundedAt).getTime() + CREDIT_NOTE_DUE_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString()

  const { data: cn, error: insertError } = await supabase
    .from("invoices")
    .insert({
      order_id: params.orderId,
      type: "credit_note",
      refund_id: params.refundId,
      references_invoice_id: invoiceRow.id,
      due_at: dueAt,
    })
    .select("id")
    .single()

  if (insertError) {
    // Don't surface to the user — refund is recorded; admin can manually
    // create the credit_note row from the order detail page if needed.
    console.error(
      `Credit-note auto-insert failed for refund ${params.refundId}:`,
      sanitizeError(insertError),
    )
    return null
  }

  return cn?.id ?? null
}
