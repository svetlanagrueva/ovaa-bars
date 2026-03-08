"use client"

import { useEffect, useState } from "react"
import { Analytics } from "@vercel/analytics/next"

const COOKIE_CONSENT_KEY = "ovva-sculpt-cookie-consent"

export function ConditionalAnalytics() {
  const [hasConsent, setHasConsent] = useState(false)

  useEffect(() => {
    setHasConsent(localStorage.getItem(COOKIE_CONSENT_KEY) === "accepted")

    const check = () => {
      setHasConsent(localStorage.getItem(COOKIE_CONSENT_KEY) === "accepted")
    }

    window.addEventListener("storage", check)
    window.addEventListener("cookie-consent-change", check)
    return () => {
      window.removeEventListener("storage", check)
      window.removeEventListener("cookie-consent-change", check)
    }
  }, [])

  if (!hasConsent) return null

  return <Analytics />
}
