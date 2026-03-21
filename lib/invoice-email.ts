import "server-only"
import { Resend } from "resend"

export function sendInvoiceEmail(params: {
  to: string
  firstName: string
  orderId: string
  invoiceNumber: string
  type: "invoice" | "proforma"
  pdfBuffer: Buffer
  sellerName?: string
}) {
  if (!process.env.RESEND_API_KEY) {
    console.warn("RESEND_API_KEY not set — invoice email not sent for order", params.orderId)
    return
  }

  const resend = new Resend(process.env.RESEND_API_KEY)
  const { to, firstName, orderId, invoiceNumber, type, pdfBuffer } = params
  const sellerName = params.sellerName || process.env.SELLER_COMPANY_NAME || "Egg Origin"

  const shortId = orderId.slice(0, 8)
  const isInvoice = type === "invoice"

  const subject = isInvoice
    ? `Фактура ${invoiceNumber} - Поръчка #${shortId}`
    : `Проформа фактура - Поръчка #${shortId}`

  const filename = isInvoice
    ? `faktura-${invoiceNumber}.pdf`
    : `proforma-${shortId}.pdf`

  const text = isInvoice
    ? `Здравейте ${firstName},\n\nПрилагаме фактура ${invoiceNumber} към Вашата поръчка #${shortId}.\n\nБлагодарим Ви, че пазарувахте при нас!\n\nПоздрави,\nЕкипът на ${sellerName}`
    : `Здравейте ${firstName},\n\nПрилагаме проформа фактура към Вашата поръчка #${shortId}.\n\nОкончателна фактура ще получите след получаване на пратката.\n\nПоздрави,\nЕкипът на ${sellerName}`

  resend.emails.send({
    from: process.env.EMAIL_FROM || "Egg Origin <onboarding@resend.dev>",
    to,
    subject,
    text,
    attachments: [{ filename, content: pdfBuffer }],
  }).catch((err) => {
    console.error(`Failed to send ${type} email for order ${shortId}:`, err)
  })
}
