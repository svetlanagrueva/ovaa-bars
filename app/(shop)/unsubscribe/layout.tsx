import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Отписване - Egg Origin",
  robots: { index: false, follow: false },
}

export default function UnsubscribeLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
