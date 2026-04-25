// Next.js instrumentation hook. Runs once at server startup in both
// development and production. Used here to fail-fast on missing required
// environment variables — catches typos on first deploy instead of waiting
// for the first customer checkout to silently fail.

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { checkEnvAtBoot } = await import("./lib/env")
    checkEnvAtBoot()
  }
}
