import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// Service role client for server actions — bypasses RLS, no cookies needed.
export async function createClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}
