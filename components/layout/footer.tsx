import Link from "next/link"

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
            <p className="text-sm text-muted-foreground">
              Доставка със <span className="font-medium text-foreground">Speedy</span> и <span className="font-medium text-foreground">Еконт</span>
            </p>
          </div>
        </div>
      </div>
    </footer>
  )
}
