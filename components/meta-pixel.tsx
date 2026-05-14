"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"
import Script from "next/script"
import { hasCategoryConsent } from "@/components/cookie-consent"
import { isMetaPixelEnabled, setMetaPixelDisabled } from "@/lib/meta-pixel"

// Meta Pixel IDs are numeric strings (typically 15–16 digits). Validate to
// avoid injecting a broken script on an empty/typo env value.
const PIXEL_ID_RE = /^\d{5,20}$/

export function MetaPixel() {
  const [consent, setConsent] = useState(false)
  const pathname = usePathname()
  const initializedRef = useRef(false)
  // Tracks the last pathname that produced a PageView so the pathname effect
  // doesn't double-fire after onReady's bootstrap PageView, and so a consent
  // re-grant on the same path doesn't duplicate the event.
  const lastFiredPathRef = useRef<string | null>(null)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConsent(hasCategoryConsent("marketing"))

    const check = () => setConsent(hasCategoryConsent("marketing"))
    window.addEventListener("storage", check)
    window.addEventListener("cookie-consent-change", check)
    return () => {
      window.removeEventListener("storage", check)
      window.removeEventListener("cookie-consent-change", check)
    }
  }, [])

  // Keep the module-level disabled flag in sync with consent state so helpers
  // stop emitting as soon as the user withdraws consent.
  useEffect(() => {
    setMetaPixelDisabled(!consent)
  }, [consent])

  // PageView on client navigation. The *first* PageView after init is fired
  // from onReady below — this effect only fires on *subsequent* pathname
  // changes. Guarded by initializedRef so we never race ahead of the loader.
  // intentional: query changes (filters, UTM, variants) do not refire PageView.
  useEffect(() => {
    if (!consent) return
    if (!initializedRef.current) return
    if (!isMetaPixelEnabled()) return
    if (lastFiredPathRef.current === pathname) return
    window.fbq!("track", "PageView")
    lastFiredPathRef.current = pathname
  }, [consent, pathname])

  const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID
  if (!pixelId || !PIXEL_ID_RE.test(pixelId)) return null
  if (!consent) return null

  const onReady = () => {
    // Guard against React re-mounts (consent toggled off→on): fbq stays global,
    // so re-running init would register the pixel twice.
    if (initializedRef.current) return
    initializedRef.current = true
    // Canonical Meta bootstrap: init + PageView together, after the loader
    // snippet has installed the fbq queueing shim. This is the first PageView;
    // the pathname effect above skips runs where lastFiredPathRef matches.
    window.fbq!("init", pixelId)
    window.fbq!("track", "PageView")
    lastFiredPathRef.current = pathname
  }

  return (
    <Script
      id="meta-pixel-loader"
      strategy="afterInteractive"
      onReady={onReady}
    >
      {`
        !function(f,b,e,v,n,t,s)
        {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
        n.callMethod.apply(n,arguments):n.queue.push(arguments)};
        if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
        n.queue=[];t=b.createElement(e);t.async=!0;
        t.src=v;s=b.getElementsByTagName(e)[0];
        s.parentNode.insertBefore(t,s)}(window,document,'script',
        'https://connect.facebook.net/en_US/fbevents.js');
      `}
    </Script>
  )
}
