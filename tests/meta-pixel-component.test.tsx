import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { act, cleanup, render } from "@testing-library/react"

// Mock next/navigation — usePathname is read on every render.
let currentPathname = "/"
vi.mock("next/navigation", () => ({
  usePathname: () => currentPathname,
}))

// Mock next/script to expose the onReady prop so tests can drive the
// "script is ready" transition deterministically.
let capturedOnReady: (() => void) | null = null
vi.mock("next/script", () => ({
  default: ({ onReady }: { onReady?: () => void }) => {
    capturedOnReady = onReady ?? null
    return null
  },
}))

// Reset module state between tests since MetaPixel reads env + module flag.
// Returns both the component and the helpers so they share a single module
// instance (otherwise isMetaPixelEnabled reads a stale flag from a prior graph).
async function loadMetaPixel() {
  vi.resetModules()
  const { MetaPixel } = await import("@/components/meta-pixel")
  const { isMetaPixelEnabled } = await import("@/lib/meta-pixel")
  return { MetaPixel, isMetaPixelEnabled }
}

function setConsent(category: "marketing" | "analytics", value: boolean) {
  const existing = (() => {
    try {
      return JSON.parse(localStorage.getItem("egg-origin-cookie-consent") ?? "{}")
    } catch {
      return {}
    }
  })()
  localStorage.setItem(
    "egg-origin-cookie-consent",
    JSON.stringify({ ...existing, [category]: value }),
  )
  window.dispatchEvent(new Event("cookie-consent-change"))
}

function installFbqShim() {
  // Mimic the inline loader: a queueing function that also tracks calls.
  const fbq = vi.fn()
  ;(window as unknown as { fbq?: (...args: unknown[]) => void }).fbq =
    fbq as unknown as (...args: unknown[]) => void
  return fbq
}

describe("<MetaPixel />", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_META_PIXEL_ID", "123456789012345")
    localStorage.clear()
    currentPathname = "/"
    capturedOnReady = null
    delete (window as unknown as { fbq?: unknown }).fbq
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllEnvs()
  })

  it("renders nothing without marketing consent", async () => {
    const { MetaPixel } = await loadMetaPixel()
    const { container } = render(<MetaPixel />)
    expect(container.firstChild).toBeNull()
  })

  it("renders nothing when pixel id is missing", async () => {
    vi.unstubAllEnvs()
    vi.stubEnv("NEXT_PUBLIC_META_PIXEL_ID", "")
    setConsent("marketing", true)
    const { MetaPixel } = await loadMetaPixel()
    const { container } = render(<MetaPixel />)
    expect(container.firstChild).toBeNull()
  })

  it("renders nothing when pixel id fails regex", async () => {
    vi.unstubAllEnvs()
    vi.stubEnv("NEXT_PUBLIC_META_PIXEL_ID", "not-numeric")
    setConsent("marketing", true)
    const { MetaPixel } = await loadMetaPixel()
    const { container } = render(<MetaPixel />)
    expect(container.firstChild).toBeNull()
  })

  it("fires init + PageView in onReady (single bootstrap event)", async () => {
    setConsent("marketing", true)
    const { MetaPixel } = await loadMetaPixel()
    const fbq = installFbqShim()

    render(<MetaPixel />)
    expect(capturedOnReady).toBeTruthy()

    // Pathname effect may have already run but was gated by initializedRef=false.
    expect(fbq).not.toHaveBeenCalled()

    await act(async () => {
      capturedOnReady!()
    })

    // init first, then PageView — same as canonical Meta bootstrap.
    expect(fbq).toHaveBeenNthCalledWith(1, "init", "123456789012345")
    expect(fbq).toHaveBeenNthCalledWith(2, "track", "PageView")
  })

  it("fires PageView on pathname change after init, but not for the same path", async () => {
    setConsent("marketing", true)
    const { MetaPixel } = await loadMetaPixel()
    const fbq = installFbqShim()

    const { rerender } = render(<MetaPixel />)
    await act(async () => {
      capturedOnReady!()
    })
    fbq.mockClear()

    // Navigate to a new path — pathname effect should fire PageView once.
    currentPathname = "/products/dark-chocolate-box"
    rerender(<MetaPixel />)
    expect(fbq).toHaveBeenCalledWith("track", "PageView")
    expect(fbq).toHaveBeenCalledTimes(1)

    // Re-render with same path — no extra PageView.
    fbq.mockClear()
    rerender(<MetaPixel />)
    expect(fbq).not.toHaveBeenCalled()
  })

  it("does not re-init when consent toggles off and back on (same session)", async () => {
    setConsent("marketing", true)
    const { MetaPixel } = await loadMetaPixel()
    const fbq = installFbqShim()

    const { rerender } = render(<MetaPixel />)
    await act(async () => {
      capturedOnReady!()
    })
    expect(fbq).toHaveBeenNthCalledWith(1, "init", "123456789012345")
    fbq.mockClear()

    // Withdraw consent — Script unmounts, disabled flag flips true.
    await act(async () => {
      setConsent("marketing", false)
    })
    rerender(<MetaPixel />)

    // Re-grant consent — Script remounts, onReady fires again, but
    // initializedRef is sticky so init is NOT called a second time.
    await act(async () => {
      setConsent("marketing", true)
    })
    rerender(<MetaPixel />)

    // Drive the new onReady
    if (capturedOnReady) {
      await act(async () => {
        capturedOnReady!()
      })
    }

    // No duplicate init.
    const initCalls = fbq.mock.calls.filter((args) => args[0] === "init")
    expect(initCalls).toHaveLength(0)
  })

  it("fires PageView on re-grant if pathname changed during off-window", async () => {
    setConsent("marketing", true)
    const { MetaPixel } = await loadMetaPixel()
    const fbq = installFbqShim()

    const { rerender } = render(<MetaPixel />)
    await act(async () => {
      capturedOnReady!()
    })
    fbq.mockClear()

    // Withdraw consent
    await act(async () => {
      setConsent("marketing", false)
    })
    rerender(<MetaPixel />)

    // User navigates while consent is off; pathname changes.
    currentPathname = "/cart"
    rerender(<MetaPixel />)
    expect(fbq).not.toHaveBeenCalled() // disabled + not consented

    // Re-grant — consent dep changes, pathname differs from lastFiredPath,
    // pathname effect fires one PageView for the new path.
    await act(async () => {
      setConsent("marketing", true)
    })
    rerender(<MetaPixel />)

    expect(fbq).toHaveBeenCalledWith("track", "PageView")
    expect(fbq).toHaveBeenCalledTimes(1)
  })

  it("syncs the module disabled flag with consent state", async () => {
    setConsent("marketing", true)
    const { MetaPixel, isMetaPixelEnabled } = await loadMetaPixel()
    installFbqShim()

    const { rerender } = render(<MetaPixel />)
    await act(async () => {
      capturedOnReady!()
    })
    expect(isMetaPixelEnabled()).toBe(true)

    await act(async () => {
      setConsent("marketing", false)
    })
    rerender(<MetaPixel />)
    expect(isMetaPixelEnabled()).toBe(false)
  })
})
