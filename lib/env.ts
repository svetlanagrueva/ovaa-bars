// Environment variable validation and access helpers.
//
// - checkEnvAtBoot() runs once at server startup (via instrumentation.ts).
//   Hard-required vars throw, aborting boot. Expected-but-softer vars log a
//   loud warning so Vercel logs show the problem on first deploy.
// - requireEnv(name) is for per-call runtime use when a function can only
//   run if the var is set. Throws with a clear "missing X" message.

const HARD_REQUIRED = [
  // Core app
  "ADMIN_PASSWORD",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  // Payments
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  // Crypto secrets
  "UNSUBSCRIBE_SECRET",
  "CRON_SECRET",
  // Email sender identity — used in every Resend.emails.send() call.
  // Was previously soft-expected with a hardcoded `onboarding@resend.dev`
  // fallback, which is Resend's test-sender domain. In production that
  // fallback produces DKIM/SPF failures and mailbox providers (Gmail,
  // Outlook) spam-filter it, so every confirmation / delivery / marketing
  // email silently doesn't reach the customer. Fail boot instead.
  "EMAIL_FROM",
] as const

// Vars whose absence silently breaks a feature but doesn't block the site
// from booting. Operator needs to see this loudly in Vercel logs on deploy —
// previously these would just cause "emails don't send" with no warning.
const EXPECTED_SOFT = [
  "RESEND_API_KEY", // customer emails + admin notifications
  "ADMIN_EMAIL", // admin-alert destination
  "SPEEDY_USERNAME",
  "SPEEDY_PASSWORD",
  "ECONT_USERNAME",
  "ECONT_PASSWORD",
  "SELLER_COMPANY_NAME",
  "SELLER_MOL",
  "SELLER_ADDRESS",
  "SELLER_CITY",
  "SELLER_POSTAL_CODE",
  "SELLER_PHONE",
  "SELLER_EMAIL",
] as const

export class MissingEnvError extends Error {
  constructor(public readonly names: string[]) {
    super(`Missing required environment variable${names.length === 1 ? "" : "s"}: ${names.join(", ")}`)
    this.name = "MissingEnvError"
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value || value.length === 0) {
    throw new MissingEnvError([name])
  }
  return value
}

export function checkEnvAtBoot(): void {
  const missingHard: string[] = []
  for (const name of HARD_REQUIRED) {
    if (!process.env[name]) missingHard.push(name)
  }
  if (missingHard.length > 0) {
    // Throw rather than console.error — serverless runtimes should visibly
    // fail the instrumentation hook so deploys surface the problem.
    throw new MissingEnvError(missingHard)
  }

  const missingSoft: string[] = []
  for (const name of EXPECTED_SOFT) {
    if (!process.env[name]) missingSoft.push(name)
  }
  if (missingSoft.length > 0) {
    const message = `[env] WARNING: env vars not set — related features will not work: ${missingSoft.join(", ")}`
    // In production (Vercel) escalate to error level so the warning shows in
    // the default log view. In dev it's info-level chatter.
    const isProd =
      process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production"
    if (isProd) {
      console.error(message)
    } else {
      console.warn(message)
    }
  }
}
