import Link from "next/link"
import { Instagram, Lock } from "lucide-react"
import { INSTAGRAM_URL, TIKTOK_URL } from "@/lib/constants"

function StripeBadge() {
  return (
    <div className="inline-flex items-center gap-3 rounded-md border border-border bg-white px-4 py-2">
      <Lock className="h-5 w-5 text-black" />
      <div className="flex flex-col items-center text-black">
        <span className="text-[11px] font-semibold leading-tight tracking-wide">Secure Payments</span>
        <span className="flex items-center gap-1 text-[10px] leading-tight text-neutral-500">
          Powered by
          <span className="text-sm font-bold text-[#635BFF]">stripe</span>
        </span>
      </div>
    </div>
  )
}

function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5" />
    </svg>
  )
}

export function Footer() {
  return (
    <footer className="border-t border-border bg-card">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-8 md:grid-cols-4">
          <div className="md:col-span-2">
            <Link href="/" className="flex items-center gap-2">
              <span className="text-xl font-light tracking-[0.2em] uppercase text-foreground">Egg Origin</span>
            </Link>
            <p className="mt-4 max-w-md text-sm text-muted-foreground">
              Протеинови барове с яйчен белтък. Високо съдържание на протеин,
              без суроватка, без добавена захар - създадени за ежедневна употреба.
            </p>
            <div className="mt-4 flex items-center gap-4">
              <a
                href={INSTAGRAM_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground transition-colors hover:text-primary"
                aria-label="Instagram"
              >
                <Instagram className="h-6 w-6" />
              </a>
              <a
                href={TIKTOK_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground transition-colors hover:text-primary"
                aria-label="TikTok"
              >
                <TikTokIcon className="h-6 w-6" />
              </a>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-foreground">Навигация</h3>
            <ul className="mt-4 space-y-3">
              <li>
                <Link href="/products" className="text-sm text-muted-foreground hover:text-primary">
                  Продукти
                </Link>
              </li>
              <li>
                <Link href="/about" className="text-sm text-muted-foreground hover:text-primary">
                  За нас
                </Link>
              </li>
              <li>
                <Link href="/contact" className="text-sm text-muted-foreground hover:text-primary">
                  Контакти
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-foreground">Правна информация</h3>
            <ul className="mt-4 space-y-3">
              <li>
                <Link href="/terms" className="text-sm text-muted-foreground hover:text-primary">
                  Общи условия
                </Link>
              </li>
              <li>
                <Link href="/privacy" className="text-sm text-muted-foreground hover:text-primary">
                  Политика за поверителност
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 border-t border-border pt-8">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <p className="text-sm text-muted-foreground">
              &copy; {new Date().getFullYear()} Egg Origin. Всички права запазени.
            </p>
            <StripeBadge />
            <p className="text-sm text-muted-foreground">
              Доставка със <span className="font-medium text-foreground">Speedy</span> и <span className="font-medium text-foreground">Еконт</span>
            </p>
          </div>
        </div>
      </div>
    </footer>
  )
}
