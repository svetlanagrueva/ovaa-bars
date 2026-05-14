import { describe, it, expect, beforeEach } from "vitest"
import { getCookiePreferences, hasCategoryConsent } from "@/components/cookie-consent"

const KEY = "egg-origin-cookie-consent"

describe("getCookiePreferences", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("returns null when nothing is stored", () => {
    expect(getCookiePreferences()).toBeNull()
  })

  it("parses fully-populated JSON", () => {
    localStorage.setItem(KEY, JSON.stringify({ analytics: true, marketing: true }))
    expect(getCookiePreferences()).toEqual({
      essential: true,
      analytics: true,
      marketing: true,
    })
  })

  it("defaults missing marketing key to false", () => {
    localStorage.setItem(KEY, JSON.stringify({ analytics: true }))
    expect(getCookiePreferences()).toEqual({
      essential: true,
      analytics: true,
      marketing: false,
    })
  })

  it("defaults missing analytics key to false", () => {
    localStorage.setItem(KEY, JSON.stringify({ marketing: true }))
    expect(getCookiePreferences()).toEqual({
      essential: true,
      analytics: false,
      marketing: true,
    })
  })

  it("returns null on malformed JSON", () => {
    localStorage.setItem(KEY, "{not json")
    expect(getCookiePreferences()).toBeNull()
  })

  it("returns null on non-object JSON", () => {
    localStorage.setItem(KEY, JSON.stringify("accepted"))
    expect(getCookiePreferences()).toBeNull()
  })

  it("returns null on null JSON", () => {
    localStorage.setItem(KEY, "null")
    expect(getCookiePreferences()).toBeNull()
  })

  it("coerces truthy values to booleans", () => {
    localStorage.setItem(KEY, JSON.stringify({ analytics: 1, marketing: "yes" }))
    expect(getCookiePreferences()).toEqual({
      essential: true,
      analytics: true,
      marketing: true,
    })
  })
})

describe("hasCategoryConsent", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("returns false when no preferences stored", () => {
    expect(hasCategoryConsent("analytics")).toBe(false)
    expect(hasCategoryConsent("marketing")).toBe(false)
  })

  it("returns the stored value per category", () => {
    localStorage.setItem(KEY, JSON.stringify({ analytics: false, marketing: true }))
    expect(hasCategoryConsent("analytics")).toBe(false)
    expect(hasCategoryConsent("marketing")).toBe(true)
  })
})
