// Ambient declaration of every environment variable referenced from
// app/, lib/, components/, or middleware. Augments NodeJS.ProcessEnv so
// editors (JetBrains, VSCode, Cursor) recognize each `process.env.X` access
// instead of flagging "Unresolved variable".
//
// Values are typed as `string | undefined` because, at the TypeScript layer,
// we can't assume a var is set — the actual must-be-present check runs at
// boot via lib/env.ts (HARD_REQUIRED throws; EXPECTED_SOFT logs at error
// level in prod / warn level in dev).
//
// Source of truth for which vars are expected: .claude/rules/env-vars.md
// and lib/env.ts. When a new env var is introduced, add it here, to env.ts
// (HARD_REQUIRED or EXPECTED_SOFT), and to env-vars.md.

declare namespace NodeJS {
  interface ProcessEnv {
    // ── Core ─────────────────────────────────────────────────────────────
    NODE_ENV?: "development" | "production" | "test"
    VERCEL_ENV?: "development" | "preview" | "production"
    VERCEL_URL?: string
    NEXT_PUBLIC_APP_URL?: string

    // ── Supabase ─────────────────────────────────────────────────────────
    NEXT_PUBLIC_SUPABASE_URL?: string
    SUPABASE_SERVICE_ROLE_KEY?: string

    // ── Stripe ───────────────────────────────────────────────────────────
    STRIPE_SECRET_KEY?: string
    STRIPE_WEBHOOK_SECRET?: string

    // ── Admin auth + crypto secrets ──────────────────────────────────────
    ADMIN_PASSWORD?: string
    ADMIN_EMAIL?: string
    UNSUBSCRIBE_SECRET?: string
    CRON_SECRET?: string

    // ── Email (Resend) ───────────────────────────────────────────────────
    RESEND_API_KEY?: string
    EMAIL_FROM?: string

    // ── Analytics / tracking ─────────────────────────────────────────────
    NEXT_PUBLIC_GA_MEASUREMENT_ID?: string
    NEXT_PUBLIC_META_PIXEL_ID?: string

    // ── Seller identity (terms / privacy pages, courier shipments,
    //     invoice email footer) ────────────────────────────────────────
    SELLER_COMPANY_NAME?: string
    SELLER_EIK?: string
    SELLER_VAT_NUMBER?: string
    SELLER_MOL?: string
    SELLER_ADDRESS?: string
    SELLER_ADDRESS_NUM?: string
    SELLER_CITY?: string
    SELLER_POSTAL_CODE?: string
    SELLER_PHONE?: string
    SELLER_EMAIL?: string
    SELLER_BANK?: string
    SELLER_IBAN?: string

    // ── Default seller drop-off offices (courier shipment form pre-fill) ─
    SELLER_ECONT_OFFICE_CODE?: string
    SELLER_ECONT_OFFICE_NAME?: string
    SELLER_SPEEDY_OFFICE_ID?: string
    SELLER_SPEEDY_OFFICE_NAME?: string

    // ── Couriers ─────────────────────────────────────────────────────────
    SPEEDY_USERNAME?: string
    SPEEDY_PASSWORD?: string
    SPEEDY_API_URL?: string
    SPEEDY_SERVICE_ID?: string
    ECONT_USERNAME?: string
    ECONT_PASSWORD?: string
    ECONT_API_URL?: string
  }
}

export {}
