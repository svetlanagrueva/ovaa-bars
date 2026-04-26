"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { Cookie, X, ChevronDown } from "lucide-react"

const COOKIE_CONSENT_KEY = "egg-origin-cookie-consent"

export interface CookiePreferences {
  essential: true // always on
  analytics: boolean
}

const DEFAULT_PREFERENCES: CookiePreferences = {
  essential: true,
  analytics: false,
}

const ALL_ACCEPTED: CookiePreferences = {
  essential: true,
  analytics: true,
}

/** Read stored preferences. Returns null if user hasn't chosen yet. */
export function getCookiePreferences(): CookiePreferences | null {
  if (typeof window === "undefined") return null
  const raw = localStorage.getItem(COOKIE_CONSENT_KEY)
  if (!raw) return null

  // Backwards compat: old format stored "accepted" / "rejected"
  if (raw === "accepted") return ALL_ACCEPTED
  if (raw === "rejected") return DEFAULT_PREFERENCES

  try {
    const parsed = JSON.parse(raw)
    return { essential: true, analytics: !!parsed.analytics }
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
  const [showDetails, setShowDetails] = useState(false)
  const [analyticsChecked, setAnalyticsChecked] = useState(true)
  const [openSections, setOpenSections] = useState<Set<"essential" | "analytics">>(
    () => new Set(["essential", "analytics"]),
  )

  useEffect(() => {
    const stored = getCookiePreferences()
    if (stored) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAnalyticsChecked(stored.analytics)
      setHasStored(true)
    }
    setLoaded(true)
  }, [])

  const toggleSection = useCallback((id: "essential" | "analytics") => {
    setOpenSections((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  useEffect(() => {
    if (loaded && !hasStored) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowBanner(true)
    }
  }, [loaded, hasStored])

  // Lock body scroll while details modal is open
  useEffect(() => {
    if (!showDetails) return
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = previous
    }
  }, [showDetails])

  const save = useCallback((prefs: CookiePreferences) => {
    savePreferences(prefs)
    setAnalyticsChecked(prefs.analytics)
    setHasStored(true)
    setShowBanner(false)
    setShowDetails(false)
  }, [])

  const acceptAll = useCallback(() => save(ALL_ACCEPTED), [save])
  const saveSelected = useCallback(
    () => save({ essential: true, analytics: analyticsChecked }),
    [save, analyticsChecked],
  )

  const closeDetails = useCallback(() => {
    setShowDetails(false)
    if (!hasStored) setShowBanner(true)
  }, [hasStored])

  if (!loaded) return null

  // Floating icon to re-open settings after initial choice
  if (hasStored && !showBanner && !showDetails) {
    return (
      <button
        onClick={() => setShowDetails(true)}
        className="fixed bottom-6 left-4 z-50 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-lg transition-colors hover:text-foreground"
        aria-label="Настройки за бисквитки"
      >
        <Cookie className="h-6 w-6" />
      </button>
    )
  }

  return (
    <>
      {/* Initial banner */}
      {showBanner && !showDetails && (
        <>
          {/* Mobile: rounded card sitting at bottom */}
          <div className="fixed inset-x-3 bottom-3 z-50 rounded-[18px] bg-primary p-5 text-primary-foreground shadow-2xl sm:hidden">
            <p className="text-[13px] leading-[1.6]">
              Този сайт използва бисквитки, за да Ви осигури най-доброто преживяване.
            </p>
            <Link
              href="/privacy#cookies"
              className="mt-3 inline-block text-[13px] underline underline-offset-4 transition-colors hover:text-accent"
            >
              Правила за поверителност
            </Link>
            <div className="mt-5 flex flex-col gap-2.5">
              <button
                onClick={acceptAll}
                className="h-11 w-full rounded-full bg-accent text-[10px] uppercase tracking-[0.16em] text-primary-foreground transition-opacity hover:opacity-90"
              >
                Приемам всички
              </button>
              <button
                onClick={() => setShowDetails(true)}
                className="h-11 w-full rounded-full border border-accent text-[10px] uppercase tracking-[0.16em] text-primary-foreground transition-colors hover:bg-accent/10"
              >
                Детайли
              </button>
            </div>
          </div>

          {/* Desktop: thin bar at the bottom */}
          <div className="fixed inset-x-0 bottom-0 z-50 hidden bg-primary text-primary-foreground shadow-lg sm:block">
            <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-4 lg:px-8">
              <p className="text-[13px] leading-[1.5]">
                Този сайт използва бисквитки, за да Ви осигури най-доброто преживяване.{" "}
                <Link
                  href="/privacy#cookies"
                  className="underline underline-offset-4 transition-colors hover:text-accent"
                >
                  Правила за поверителност
                </Link>
              </p>
              <div className="flex flex-shrink-0 items-center gap-3">
                <button
                  onClick={() => setShowDetails(true)}
                  className="h-9 rounded-full border border-accent px-5 text-[10px] uppercase tracking-[0.16em] text-primary-foreground transition-colors hover:bg-accent/10"
                >
                  Детайли
                </button>
                <button
                  onClick={acceptAll}
                  className="h-9 rounded-full bg-accent px-5 text-[10px] uppercase tracking-[0.16em] text-primary-foreground transition-opacity hover:opacity-90"
                >
                  Приемам всички
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Details overlay */}
      {showDetails && (
        <div
          className="fixed inset-0 z-50 bg-black/60 sm:flex sm:items-center sm:justify-center sm:p-6"
          onClick={(e) => { if (e.target === e.currentTarget) closeDetails() }}
        >
          <div className="flex h-full w-full flex-col bg-primary text-primary-foreground shadow-2xl sm:h-auto sm:max-h-[85vh] sm:max-w-2xl sm:rounded-[20px]">
            <div className="flex items-start justify-between gap-4 px-6 pb-4 pt-6 sm:px-8 sm:pt-8">
              <h2 className="text-base font-medium tracking-[-0.01em] sm:text-lg">
                Вашите предпочитания за бисквитки
              </h2>
              <button
                onClick={closeDetails}
                aria-label="Затвори"
                className="-mr-2 -mt-2 flex h-8 w-8 items-center justify-center text-primary-foreground/70 transition-opacity hover:opacity-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 space-y-1 overflow-y-auto px-6 pb-4 sm:px-8">
              <CategorySection
                isOpen={openSections.has("essential")}
                onToggle={() => toggleSection("essential")}
                checked
                disabled
                label="Задължителни бисквитки"
                description="Основните функционалности на сайта ни в по-голямата си част зависят от „бисквитките“, поставени от нас. Без тези „бисквитки“ функционирането на уебсайта ще е невъзможно. Ако забраните тези бисквитки, няма да можете да влизате в профила си в сайта ни, както и да извършвате поръчки и други основни функционалности на eggorigin.com."
              />
              <CategorySection
                isOpen={openSections.has("analytics")}
                onToggle={() => toggleSection("analytics")}
                checked={analyticsChecked}
                onCheckedChange={setAnalyticsChecked}
                label="Бисквитки за анализ"
                description="Аналитичните бисквитки (Analytics cookies) са анонимни бисквитки, които ни съобщават, в съвкупност, кои са най-посещаваните страници, потребителските ви пътувания и действията на широки категории потребители. Благодарение на аналитичните бисквитки можем да оценим ефективността на нашия уебсайт и да подобрим вашето изживяване онлайн."
              />
            </div>

            <div className="flex flex-col-reverse gap-3 border-t border-primary-foreground/10 px-6 py-5 sm:flex-row sm:justify-end sm:px-8 sm:py-6">
              <button
                onClick={saveSelected}
                className="h-11 w-full rounded-full border border-accent text-[10px] uppercase tracking-[0.16em] text-primary-foreground transition-colors hover:bg-accent/10 sm:w-auto sm:px-8"
              >
                Запази
              </button>
              <button
                onClick={acceptAll}
                className="h-11 w-full rounded-full bg-accent text-[10px] uppercase tracking-[0.16em] text-primary-foreground transition-opacity hover:opacity-90 sm:w-auto sm:px-8"
              >
                Разбирам
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

interface CategorySectionProps {
  isOpen: boolean
  onToggle: () => void
  checked: boolean
  disabled?: boolean
  onCheckedChange?: (checked: boolean) => void
  label: string
  description: string
}

function CategorySection({
  isOpen,
  onToggle,
  checked,
  disabled,
  onCheckedChange,
  label,
  description,
}: CategorySectionProps) {
  return (
    <div className="border-b border-primary-foreground/10 py-4 last:border-0">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onCheckedChange?.(!checked)}
          disabled={disabled}
          aria-checked={checked}
          role="checkbox"
          className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-[4px] border transition-colors ${
            checked
              ? "border-accent bg-accent text-primary-foreground"
              : "border-primary-foreground/40"
          } ${disabled ? "cursor-not-allowed opacity-80" : "cursor-pointer"}`}
        >
          {checked && (
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3.5 8.5 6.5 11.5 12.5 5" />
            </svg>
          )}
        </button>
        <button
          type="button"
          onClick={onToggle}
          className="flex flex-1 items-center justify-between gap-3 text-left"
        >
          <span className="text-[13px] font-medium tracking-tight sm:text-sm">{label}</span>
          <ChevronDown
            className={`h-4 w-4 flex-shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
          />
        </button>
      </div>
      {isOpen && (
        <p className="mt-3 text-[13px] leading-[1.6] text-primary-foreground/75 sm:text-sm sm:leading-7">
          {description}
        </p>
      )}
    </div>
  )
}
