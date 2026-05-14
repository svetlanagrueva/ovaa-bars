export function DevProdDbBanner() {
  if (process.env.NODE_ENV !== "development") return null
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
  if (!url.includes("supabase.co")) return null

  return (
    <div
      role="alert"
      className="sticky top-0 z-[100] bg-red-600 px-4 py-2 text-center text-sm font-semibold text-white"
    >
      ⚠ Local dev is connected to PROD Supabase — writes affect real data.
    </div>
  )
}
