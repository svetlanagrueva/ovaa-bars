"use client"

import React from "react"

import { useState } from "react"
import { Loader2, CheckCircle } from "lucide-react"
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
        email: formData.get("email") as string,
        subject: formData.get("subject") as string,
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
      <div className="mt-6 flex flex-col items-center py-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
          <CheckCircle className="h-8 w-8 text-primary" />
        </div>
        <h3 className="mt-4 text-lg font-semibold text-foreground">Съобщението е изпратено!</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Благодарим ви! Ще се свържем с вас възможно най-скоро.
        </p>
        <Button className="mt-6 bg-transparent" variant="outline" onClick={() => setIsSubmitted(false)}>
          Изпрати ново съобщение
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="name">Име *</Label>
          <Input id="name" name="name" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Имейл *</Label>
          <Input id="email" name="email" type="email" required />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="subject">Тема</Label>
        <Input id="subject" name="subject" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="message">Съобщение *</Label>
        <Textarea
          id="message"
          name="message"
          rows={5}
          required
          placeholder="Как можем да ви помогнем?"
        />
      </div>
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
      <Button type="submit" className="w-full" disabled={isLoading}>
        {isLoading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Изпращане...
          </>
        ) : (
          "Изпрати съобщение"
        )}
      </Button>
    </form>
  )
}
