"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { Cookie } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"

const COOKIE_CONSENT_KEY = "egg-origin-cookie-consent"

export interface CookiePreferences {
  essential: true // always on
  analytics: boolean
  marketing: boolean
}

const DEFAULT_PREFERENCES: CookiePreferences = {
  essential: true,
  analytics: false,
  marketing: false,
}

const ALL_ACCEPTED: CookiePreferences = {
  essential: true,
  analytics: true,
  marketing: true,
}

/** Read stored preferences. Returns null if user hasn't chosen yet. */
export function getCookiePreferences(): CookiePreferences | null {
  if (typeof window === "undefined") return null
  const raw = localStorage.getItem(COOKIE_CONSENT_KEY)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return null
    return {
      essential: true,
      analytics: !!parsed.analytics,
      marketing: !!parsed.marketing,
    }
  } catch {
    return null
  }
}

/** Check whether a specific cookie category is consented to. */
export function hasCategoryConsent(category: keyof CookiePreferences): boolean {
  const prefs = getCookiePreferences()
  if (!prefs) return false
  return prefs[category]
}

function savePreferences(prefs: CookiePreferences) {
  localStorage.setItem(COOKIE_CONSENT_KEY, JSON.stringify(prefs))
  window.dispatchEvent(new Event("cookie-consent-change"))
}

export function CookieConsentBanner() {
  const [loaded, setLoaded] = useState(false)
  const [hasStored, setHasStored] = useState(false)
  const [showBanner, setShowBanner] = useState(false)
  const [analyticsChecked, setAnalyticsChecked] = useState(false)
  const [marketingChecked, setMarketingChecked] = useState(false)

  useEffect(() => {
    const stored = getCookiePreferences()
    if (stored) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAnalyticsChecked(stored.analytics)
      setMarketingChecked(stored.marketing)
      setHasStored(true)
    }
    setLoaded(true)
  }, [])

  useEffect(() => {
    if (loaded && !hasStored) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowBanner(true)
    }
  }, [loaded, hasStored])

  const save = useCallback((prefs: CookiePreferences) => {
    savePreferences(prefs)
    setAnalyticsChecked(prefs.analytics)
    setMarketingChecked(prefs.marketing)
    setHasStored(true)
    setShowBanner(false)
  }, [])

  const acceptAll = useCallback(() => save(ALL_ACCEPTED), [save])
  const rejectOptional = useCallback(() => save(DEFAULT_PREFERENCES), [save])
  const saveSelected = useCallback(
    () => save({ essential: true, analytics: analyticsChecked, marketing: marketingChecked }),
    [save, analyticsChecked, marketingChecked],
  )

  if (!loaded) return null

  // Floating icon to re-open settings after initial choice
  if (hasStored && !showBanner) {
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
      <div className="mx-auto max-w-5xl space-y-4">
        <p className="text-sm text-muted-foreground">
          Използваме бисквитки, за да подобрим изживяването Ви. Изберете кои категории да разрешите.
          Научете повече в нашата{" "}
          <Link href="/privacy#cookies" className="underline hover:text-foreground">
            политика за поверителност
          </Link>
          .
        </p>

        <div className="grid gap-3 sm:grid-cols-3">
          {/* Essential — always on */}
          <div className="flex items-start gap-3 rounded-lg border border-border p-3">
            <Checkbox id="ck-essential" checked disabled className="mt-0.5" />
            <div>
              <Label htmlFor="ck-essential" className="font-medium text-foreground">
                Необходими
              </Label>
              <p className="text-xs text-muted-foreground">
                Тези бисквитки са необходими за правилното функциониране на сайта, включително за различни възможности, като например влизане в профила и добавяне на артикули в количката.
              </p>
            </div>
          </div>

          {/* Analytics — optional (aggregate site usage statistics) */}
          <div className="flex items-start gap-3 rounded-lg border border-border p-3">
            <Checkbox
              id="ck-analytics"
              checked={analyticsChecked}
              onCheckedChange={(checked) => setAnalyticsChecked(checked === true)}
              className="mt-0.5"
            />
            <div>
              <Label htmlFor="ck-analytics" className="cursor-pointer font-medium text-foreground">
                Анализ
              </Label>
              <p className="text-xs text-muted-foreground">
                Помагат ни да разберем как се използва сайтът (агрегирана статистика), за да идентифицираме области за подобрение.
              </p>
            </div>
          </div>

          {/* Marketing — optional (advertising / remarketing, shares data with Meta) */}
          <div className="flex items-start gap-3 rounded-lg border border-border p-3">
            <Checkbox
              id="ck-marketing"
              checked={marketingChecked}
              onCheckedChange={(checked) => setMarketingChecked(checked === true)}
              className="mt-0.5"
            />
            <div>
              <Label htmlFor="ck-marketing" className="cursor-pointer font-medium text-foreground">
                Маркетинг
              </Label>
              <p className="text-xs text-muted-foreground">
                Позволяват ни да Ви показваме реклами във Facebook и Instagram и да измерваме тяхната ефективност. Споделят данни с Meta.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button variant="outline" size="sm" onClick={rejectOptional}>
            Отказвам
          </Button>
          <Button variant="outline" size="sm" onClick={saveSelected}>
            Запази избора
          </Button>
          <Button size="sm" onClick={acceptAll}>
            Приемам всички
          </Button>
        </div>
      </div>
    </div>
  )
}
