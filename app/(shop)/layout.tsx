import React from "react"
import { Header } from "@/components/layout/header"
import { Footer } from "@/components/layout/footer"
import { CookieConsentBanner } from "@/components/cookie-consent"
import { CartPriceSync } from "@/components/cart-price-sync"
import { ConditionalAnalytics } from "@/components/analytics"

export default function ShopLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <Header />
      <main className="min-h-screen">
        {children}
      </main>
      <Footer />
      <CartPriceSync />
      <CookieConsentBanner />
      <ConditionalAnalytics />
    </>
  )
}
