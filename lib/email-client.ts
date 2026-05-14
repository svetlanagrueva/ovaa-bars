import { Resend } from "resend"
import { createTransport } from "nodemailer"

interface SendArgs {
  from: string
  to: string | string[]
  subject: string
  html?: string
  text?: string
  reply_to?: string
  replyTo?: string
}

interface SendResult {
  data: { id: string } | null
  error: { name: string; message: string } | null
}

interface EmailClient {
  emails: { send: (args: SendArgs) => Promise<SendResult> }
}

const NOOP_CLIENT: EmailClient = {
  emails: {
    send: async () => ({ data: { id: "noop" }, error: null }),
  },
}

export function isEmailEnabled(): boolean {
  return Boolean(process.env.RESEND_API_KEY) || process.env.NODE_ENV === "development"
}

export function getEmailClient(): EmailClient {
  if (process.env.RESEND_API_KEY) {
    return wrapResend(new Resend(process.env.RESEND_API_KEY))
  }
  if (process.env.NODE_ENV === "development") {
    return createMailpitClient()
  }
  return NOOP_CLIENT
}

function wrapResend(resend: Resend): EmailClient {
  return {
    emails: {
      send: async (args) => {
        // Resend's send is an overloaded union (template | base); SendArgs
        // matches the base branch but TS can't narrow through the alias.
        const { data, error } = await resend.emails.send(
          args as Parameters<typeof resend.emails.send>[0],
        )
        return { data, error: error ? { name: error.name, message: error.message } : null }
      },
    },
  }
}

function createMailpitClient(): EmailClient {
  const transporter = createTransport({
    host: "127.0.0.1",
    port: 54325,
    secure: false,
    ignoreTLS: true,
  })
  return {
    emails: {
      send: async (args) => {
        try {
          const info = await transporter.sendMail({
            from: args.from,
            to: Array.isArray(args.to) ? args.to.join(", ") : args.to,
            subject: args.subject,
            html: args.html,
            text: args.text,
            replyTo: args.reply_to,
          })
          return { data: { id: info.messageId }, error: null }
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown SMTP error"
          return { data: null, error: { name: "smtp_error", message } }
        }
      },
    },
  }
}
