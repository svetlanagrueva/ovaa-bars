"use client"

import { useEffect, useState } from "react"
import { Analytics } from "@vercel/analytics/next"
import { GoogleAnalytics } from "@next/third-parties/google"
import { hasCategoryConsent } from "@/components/cookie-consent"

export function ConditionalAnalytics() {
  const [analyticsConsent, setAnalyticsConsent] = useState(false)

  useEffect(() => {
    setAnalyticsConsent(hasCategoryConsent("analytics"))

    const check = () => {
      setAnalyticsConsent(hasCategoryConsent("analytics"))
    }

    window.addEventListener("storage", check)
    window.addEventListener("cookie-consent-change", check)
    return () => {
      window.removeEventListener("storage", check)
      window.removeEventListener("cookie-consent-change", check)
    }
  }, [])

  if (!analyticsConsent) return null

  const gaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID

  return (
    <>
      <Analytics />
      {gaId && <GoogleAnalytics gaId={gaId} />}
    </>
  )
}
