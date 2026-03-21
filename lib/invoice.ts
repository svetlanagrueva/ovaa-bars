import "server-only"
import { createClient } from "@/lib/supabase/server"

export async function getNextInvoiceNumber(): Promise<string> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("next_invoice_number")

  if (error || data === null || data === undefined) {
    throw new Error("Failed to generate invoice number: " + (error?.message || "unknown"))
  }

  // ЗДДС Art. 78: invoice number must be exactly 10 Arabic digits, sequential, no gaps
  return String(data).padStart(10, "0")
}
