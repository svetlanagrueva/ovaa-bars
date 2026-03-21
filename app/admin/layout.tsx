import React from "react"
import type { Metadata } from "next"
import { AdminNav } from "./nav"

export const metadata: Metadata = {
  title: "Ovva Sculpt - Админ панел",
  robots: { index: false, follow: false },
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <main className="min-h-screen bg-gray-50">
      <AdminNav />
      {children}
    </main>
  )
}
