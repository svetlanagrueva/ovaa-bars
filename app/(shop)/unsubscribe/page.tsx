"use client"

import { Suspense, useState, useRef } from "react"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Loader2 } from "lucide-react"

function UnsubscribeContent() {
  const searchParams = useSearchParams()
  const token = searchParams.get("token")
  const [state, setState] = useState<"confirm" | "loading" | "success" | "error">(
    token ? "confirm" : "error"
  )
  const [errorMessage, setErrorMessage] = useState<string | null>(
    token ? null : "Невалиден линк."
  )

  const submittingRef = useRef(false)

  const handleUnsubscribe = async () => {
    if (submittingRef.current) return
    submittingRef.current = true
    setState("loading")
    try {
      const res = await fetch("/api/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        setState("success")
      } else {
        setState("error")
        setErrorMessage(data.error || "Възникна грешка. Моля, опитайте отново.")
      }
    } catch {
      setState("error")
      setErrorMessage("Възникна грешка. Моля, опитайте отново.")
    }
  }

  return (
    <div className="bg-background py-12 sm:py-16 lg:py-24">
      <div className="mx-auto max-w-lg px-5 text-center sm:px-6">
        {state === "confirm" && (
          <>
            <p className="text-[10px] font-medium uppercase tracking-[0.25em] text-muted-foreground sm:text-[11px] sm:tracking-[0.3em]">
              Настройки
            </p>
            <h1 className="mt-4 text-[28px] font-light leading-[1.1] tracking-[-0.03em] text-foreground sm:mt-6 sm:text-3xl sm:leading-[1.05] sm:tracking-[-0.04em] lg:text-4xl">
              Отписване
              <span className="block text-muted-foreground">от имейли</span>
            </h1>
            <p className="mt-4 text-[13px] leading-[1.7] text-muted-foreground sm:mt-6 sm:text-sm sm:leading-7">
              Сигурни ли сте, че искате да се отпишете от маркетинг имейли на Egg Origin?
            </p>
            <p className="mt-2 text-[13px] text-muted-foreground sm:text-sm">
              Ще продължите да получавате имейли за Вашите поръчки.
            </p>
            <Button
              onClick={handleUnsubscribe}
              className="mt-6 h-12 w-full rounded-full bg-primary text-[10px] uppercase tracking-[0.16em] text-primary-foreground hover:opacity-90 sm:mt-8 sm:h-11 sm:w-auto sm:px-6"
            >
              Да, отпиши ме
            </Button>
          </>
        )}

        {state === "loading" && (
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-[13px] text-muted-foreground sm:text-sm">Обработка...</p>
          </div>
        )}

        {state === "success" && (
          <>
            <p className="text-[10px] font-medium uppercase tracking-[0.25em] text-muted-foreground sm:text-[11px] sm:tracking-[0.3em]">
              Готово
            </p>
            <h1 className="mt-4 text-[28px] font-light leading-[1.1] tracking-[-0.03em] text-foreground sm:mt-6 sm:text-3xl sm:leading-[1.05] sm:tracking-[-0.04em] lg:text-4xl">
              Успешно
              <span className="block text-muted-foreground">се отписахте</span>
            </h1>
            <p className="mt-4 text-[13px] leading-[1.7] text-muted-foreground sm:mt-6 sm:text-sm sm:leading-7">
              Няма да получавате повече маркетинг имейли от Egg Origin.
              Ще продължите да получавате имейли за Вашите поръчки.
            </p>
          </>
        )}

        {state === "error" && (
          <>
            <p className="text-[10px] font-medium uppercase tracking-[0.25em] text-muted-foreground sm:text-[11px] sm:tracking-[0.3em]">
              Грешка
            </p>
            <h1 className="mt-4 text-[28px] font-light leading-[1.1] tracking-[-0.03em] text-foreground sm:mt-6 sm:text-3xl sm:leading-[1.05] sm:tracking-[-0.04em] lg:text-4xl">
              Невалиден
              <span className="block text-muted-foreground">линк</span>
            </h1>
            <p className="mt-4 text-[13px] leading-[1.7] text-muted-foreground sm:mt-6 sm:text-sm sm:leading-7">
              {errorMessage || "Невалиден или изтекъл линк."}
            </p>
            <p className="mt-2 text-[13px] text-muted-foreground sm:text-sm">
              Моля, свържете се с нас на{" "}
              <a href="mailto:info@eggorigin.com" className="text-foreground underline hover:text-accent transition-colors">
                info@eggorigin.com
              </a>
            </p>
          </>
        )}
      </div>
    </div>
  )
}

export default function UnsubscribePage() {
  return (
    <Suspense
      fallback={
        <div className="bg-background py-12 sm:py-16 lg:py-24">
          <div className="mx-auto max-w-lg px-5 text-center sm:px-6">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </div>
      }
    >
      <UnsubscribeContent />
    </Suspense>
  )
}
