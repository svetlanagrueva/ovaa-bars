"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { Cookie } from "lucide-react"
import { Button } from "@/components/ui/button"

const COOKIE_CONSENT_KEY = "ovva-sculpt-cookie-consent"

export type CookieConsent = "accepted" | "rejected" | null

function useCookieConsent() {
  const [consent, setConsent] = useState<CookieConsent>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem(COOKIE_CONSENT_KEY)
    if (stored === "accepted" || stored === "rejected") {
      setConsent(stored)
    }
    setLoaded(true)
  }, [])

  const accept = () => {
    localStorage.setItem(COOKIE_CONSENT_KEY, "accepted")
    setConsent("accepted")
    window.dispatchEvent(new Event("cookie-consent-change"))
  }

  const reject = () => {
    localStorage.setItem(COOKIE_CONSENT_KEY, "rejected")
    setConsent("rejected")
    window.dispatchEvent(new Event("cookie-consent-change"))
  }

  const reset = () => {
    localStorage.removeItem(COOKIE_CONSENT_KEY)
    setConsent(null)
    window.dispatchEvent(new Event("cookie-consent-change"))
  }

  return { consent, loaded, accept, reject, reset }
}

export function CookieConsentBanner() {
  const { consent, loaded, accept, reject, reset } = useCookieConsent()
  const [showBanner, setShowBanner] = useState(false)

  useEffect(() => {
    if (loaded && consent === null) {
      setShowBanner(true)
    }
  }, [loaded, consent])

  if (!loaded) return null

  // Show floating icon when consent has been given (not during initial banner)
  if (consent !== null && !showBanner) {
    return (
      <button
        onClick={() => setShowBanner(true)}
        className="fixed bottom-16 left-4 z-50 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-lg transition-colors hover:text-foreground"
        aria-label="Настройки за бисквитки"
      >
        <Cookie className="h-6 w-6" />
      </button>
    )
  }

  if (!showBanner) return null

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background p-4 shadow-lg sm:p-6">
      <div className="mx-auto flex max-w-5xl flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Използваме бисквитки за анализ на трафика и подобряване на изживяването.
          Научете повече в нашата{" "}
          <Link href="/privacy#cookies" className="underline hover:text-foreground">
            политика за поверителност
          </Link>
          .
        </p>
        <div className="flex shrink-0 gap-3">
          <Button variant="outline" size="sm" onClick={() => { reject(); setShowBanner(false) }}>
            Отказвам
          </Button>
          <Button size="sm" onClick={() => { accept(); setShowBanner(false) }}>
            Приемам
          </Button>
        </div>
      </div>
    </div>
  )
}
