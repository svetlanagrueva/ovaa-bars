"use client"

import React from "react"

import { useState } from "react"
import { Loader2, CheckCircle, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { sendContactMessage } from "@/app/actions/contact"

export function ContactForm() {
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    const formData = new FormData(e.currentTarget)

    try {
      await sendContactMessage({
        name: formData.get("name") as string,
        lastName: formData.get("lastName") as string,
        email: formData.get("email") as string,
        message: formData.get("message") as string,
      })
      setIsSubmitted(true)
    } catch {
      setError("Неуспешно изпращане. Моля, опитайте отново или ни пишете директно на info@eggorigin.com.")
    } finally {
      setIsLoading(false)
    }
  }

  if (isSubmitted) {
    return (
      <div className="mt-8 flex flex-col items-center py-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-secondary">
          <CheckCircle className="h-8 w-8 text-foreground" />
        </div>
        <h3 className="mt-6 text-lg font-light tracking-[-0.02em] text-foreground">Съобщението е изпратено</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Благодарим ви! Ще се свържем с вас възможно най-скоро.
        </p>
        <Button
          variant="outline"
          className="mt-8 h-10 rounded-full border-border/60 bg-transparent px-6 text-[10px] uppercase tracking-[0.16em] text-foreground hover:bg-secondary"
          onClick={() => setIsSubmitted(false)}
        >
          Изпрати ново съобщение
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 space-y-6">
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="name" className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Име *
          </Label>
          <Input
            id="name"
            name="name"
            required
            className="h-11 rounded-full border-border/60 bg-background px-4 text-sm focus:border-accent focus:ring-accent"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lastName">Фамилия *</Label>
          <Input id="lastName" name="lastName" required />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">Имейл *</Label>
        <Input id="email" name="email" type="email" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="message" className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Съобщение *
        </Label>
        <Textarea
          id="message"
          name="message"
          rows={5}
          required
          placeholder="Как можем да ви помогнем?"
          className="rounded-[20px] border-border/60 bg-background px-4 py-3 text-sm focus:border-accent focus:ring-accent"
        />
      </div>
      {error && (
        <div className="rounded-[16px] bg-destructive/10 p-4">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}
      <Button
        type="submit"
        disabled={isLoading}
        className="h-11 w-full gap-2 rounded-full bg-foreground text-[10px] uppercase tracking-[0.16em] text-background hover:opacity-90"
      >
        {isLoading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Изпращане...
          </>
        ) : (
          <>
            Изпрати съобщение
            <ArrowRight className="h-4 w-4" />
          </>
        )}
      </Button>
    </form>
  )
}
