"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { logoutAdmin } from "@/app/actions/admin"
import { Button } from "@/components/ui/button"

const links = [
  { href: "/admin/orders", label: "Поръчки" },
  { href: "/admin/sales", label: "Промоции" },
]

export function AdminNav() {
  const pathname = usePathname()

  // Don't show nav on login page
  if (pathname === "/admin/login") return null

  return (
    <nav className="border-b bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-6">
          <span className="text-sm font-bold text-foreground">Админ</span>
          <div className="flex gap-4">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`text-sm font-medium transition-colors ${
                  pathname.startsWith(link.href)
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
        <form action={logoutAdmin}>
          <Button variant="outline" size="sm" type="submit">
            Изход
          </Button>
        </form>
      </div>
    </nav>
  )
}
