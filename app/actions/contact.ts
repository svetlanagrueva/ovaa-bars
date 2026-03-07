"use server"

import { Resend } from "resend"

interface ContactData {
  name: string
  email: string
  subject: string
  message: string
}

export async function sendContactMessage(data: ContactData) {
  const { name, email, subject, message } = data

  if (!name || !email || !message) {
    throw new Error("Missing required fields")
  }

  if (!process.env.RESEND_API_KEY) {
    throw new Error("Email service not configured")
  }

  const resend = new Resend(process.env.RESEND_API_KEY)

  await resend.emails.send({
    from: "Ovva Sculpt <onboarding@resend.dev>",
    to: "info@proteinbg.com",
    replyTo: email,
    subject: subject ? `Contact: ${subject}` : `Contact from ${name}`,
    text: `Name: ${name}\nEmail: ${email}\n\n${message}`,
  })

  return { success: true }
}
