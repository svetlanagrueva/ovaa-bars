import "server-only"
import PDFDocument from "pdfkit"
import path from "path"
import fs from "fs"
import { formatPrice } from "@/lib/products"
import { COD_FEE } from "@/lib/constants"
import type { SellerConfig } from "@/lib/seller"

interface OrderItem {
  productName: string
  quantity: number
  priceInCents: number
}

export interface InvoiceOrderData {
  id: string
  created_at?: string
  first_name: string
  last_name: string
  email: string
  phone: string
  city: string
  address: string
  postal_code: string
  items: OrderItem[]
  total_amount: number
  payment_method: string
  logistics_partner: string
  needs_invoice: boolean
  invoice_company_name: string | null
  invoice_eik: string | null
  invoice_vat_number: string | null
  invoice_mol: string | null
  invoice_address: string | null
}

const FONT_DIR = path.join(process.cwd(), "public", "fonts")
const VAT_RATE = 0.20

// Back-calculate the price without VAT from a VAT-inclusive price
function excludeVat(amountWithVat: number): number {
  return Math.round(amountWithVat / (1 + VAT_RATE))
}

export async function generateInvoicePDF(params: {
  type: "invoice" | "proforma"
  invoiceNumber: string
  invoiceDate: Date
  taxEventDate?: Date
  order: InvoiceOrderData
  seller: SellerConfig
}): Promise<Buffer> {
  const { type, invoiceNumber, invoiceDate, order, seller } = params
  const taxEventDate = params.taxEventDate || invoiceDate
  const isCompany = !!(order.invoice_eik || order.invoice_company_name)

  const doc = new PDFDocument({ size: "A4", margin: 50 })
  const chunks: Buffer[] = []

  doc.on("data", (chunk: Buffer) => chunks.push(chunk))

  const fontRegular = path.join(FONT_DIR, "Roboto-Regular.ttf")
  const fontBold = path.join(FONT_DIR, "Roboto-Bold.ttf")

  if (!fs.existsSync(fontRegular) || !fs.existsSync(fontBold)) {
    throw new Error(`Invoice fonts not found at ${FONT_DIR}. Ensure Roboto-Regular.ttf and Roboto-Bold.ttf exist.`)
  }

  doc.registerFont("Regular", fontRegular)
  doc.registerFont("Bold", fontBold)

  // --- Header ---
  const title = type === "invoice" ? "ФАКТУРА" : "ПРОФОРМА ФАКТУРА"
  doc.font("Bold").fontSize(20).text(title, { align: "center" })
  doc.moveDown(0.2)
  doc.font("Bold").fontSize(10).text(`\u2116 ${invoiceNumber}`, { align: "center" })
  doc.font("Regular").fontSize(9)
  doc.text(`Дата на издаване: ${formatDate(invoiceDate)}`, { align: "center" })
  doc.text(`Дата на данъчното събитие: ${formatDate(taxEventDate)}`, { align: "center" })
  doc.moveDown(0.8)

  // --- Seller / Buyer columns ---
  const colLeft = 50
  const colRight = 310
  const startY = doc.y

  // Seller
  doc.font("Bold").fontSize(9).text("ДОСТАВЧИК", colLeft, startY)
  doc.font("Regular").fontSize(9)
  doc.text(seller.companyName, colLeft, doc.y + 4)
  doc.text(`ЕИК: ${seller.eik}`)
  if (seller.vatNumber) doc.text(`ИН по ЗДДС: ${seller.vatNumber}`)
  doc.text(`МОЛ: ${seller.mol}`)
  doc.text(`Адрес: ${seller.address}`)
  if (seller.phone) doc.text(`Тел: ${seller.phone}`)
  if (seller.iban) doc.text(`IBAN: ${seller.iban}`)
  if (seller.bank) doc.text(`Банка: ${seller.bank}`)
  const sellerEndY = doc.y

  // Buyer
  doc.font("Bold").fontSize(9).text("ПОЛУЧАТЕЛ", colRight, startY)
  doc.font("Regular").fontSize(9)

  if (isCompany) {
    doc.text(order.invoice_company_name || "", colRight, doc.y + 4)
    if (order.invoice_eik) doc.text(`ЕИК: ${order.invoice_eik}`)
    if (order.invoice_vat_number) doc.text(`ИН по ЗДДС: ${order.invoice_vat_number}`)
    doc.text(`МОЛ: ${order.invoice_mol || `${order.first_name} ${order.last_name}`}`)
    doc.text(`Адрес: ${order.invoice_address || [order.city, order.address].filter(Boolean).join(", ")}`)
  } else {
    doc.text(`${order.first_name} ${order.last_name}`, colRight, doc.y + 4)
    doc.text(`Адрес: ${order.invoice_address || [order.city, order.address, order.postal_code].filter(Boolean).join(", ")}`)
  }
  if (order.phone) doc.text(`Тел: ${order.phone}`)

  const buyerEndY = doc.y
  doc.y = Math.max(sellerEndY, buyerEndY) + 20

  // --- Separator ---
  drawLine(doc, doc.y)
  doc.moveDown(0.5)

  // --- Items table ---
  // All prices in the table are WITHOUT VAT (данъчна основа per line)
  const tableTop = doc.y
  const c1 = 50   // No
  const c2 = 70   // Description
  const c3 = 295  // Unit (мярка)
  const c4 = 330  // Qty
  const c5 = 380  // Unit price (без ДДС)
  const c6 = 460  // Total (без ДДС)

  // Table header
  doc.font("Bold").fontSize(7.5)
  doc.text("№", c1, tableTop)
  doc.text("Описание на стоката/услугата", c2, tableTop)
  doc.text("Мярка", c3, tableTop)
  doc.text("К-во", c4, tableTop, { width: 40, align: "right" })
  doc.text("Ед. цена", c5, tableTop, { width: 70, align: "right" })
  doc.text("Стойност", c6, tableTop, { width: 85, align: "right" })

  drawLine(doc, tableTop + 14)
  doc.y = tableTop + 20

  // Table rows — prices WITHOUT VAT
  doc.font("Regular").fontSize(8)
  const items = order.items || []
  let taxBaseTotal = 0
  let lineNum = 0

  items.forEach((item) => {
    lineNum++
    // Calculate unit price ex-VAT first, then derive line total from it
    // to ensure unit_price * qty = line_total on the invoice
    const unitPriceExVat = excludeVat(item.priceInCents)
    const lineTotalExVat = unitPriceExVat * item.quantity
    taxBaseTotal += lineTotalExVat
    const y = doc.y

    doc.text(String(lineNum), c1, y)
    doc.text(item.productName, c2, y, { width: 220 })
    doc.text("бр.", c3, y)
    doc.text(String(item.quantity), c4, y, { width: 40, align: "right" })
    doc.text(formatPrice(unitPriceExVat), c5, y, { width: 70, align: "right" })
    doc.text(formatPrice(lineTotalExVat), c6, y, { width: 85, align: "right" })
    doc.y = y + 16
  })

  // Shipping line
  const itemsTotalWithVat = items.reduce((s, it) => s + it.priceInCents * it.quantity, 0)
  const codFeeWithVat = order.payment_method === "cod" ? COD_FEE : 0
  const shippingWithVat = order.total_amount - itemsTotalWithVat - codFeeWithVat

  if (shippingWithVat > 0) {
    lineNum++
    const shippingExVat = excludeVat(shippingWithVat)
    taxBaseTotal += shippingExVat
    const y = doc.y
    doc.text(String(lineNum), c1, y)
    doc.text("Доставка", c2, y)
    doc.text("бр.", c3, y)
    doc.text("1", c4, y, { width: 40, align: "right" })
    doc.text(formatPrice(shippingExVat), c5, y, { width: 70, align: "right" })
    doc.text(formatPrice(shippingExVat), c6, y, { width: 85, align: "right" })
    doc.y = y + 16
  }

  // COD fee line
  if (codFeeWithVat > 0) {
    lineNum++
    const codExVat = excludeVat(codFeeWithVat)
    taxBaseTotal += codExVat
    const y = doc.y
    doc.text(String(lineNum), c1, y)
    doc.text("Такса наложен платеж", c2, y)
    doc.text("бр.", c3, y)
    doc.text("1", c4, y, { width: 40, align: "right" })
    doc.text(formatPrice(codExVat), c5, y, { width: 70, align: "right" })
    doc.text(formatPrice(codExVat), c6, y, { width: 85, align: "right" })
    doc.y = y + 16
  }

  drawLine(doc, doc.y + 4)
  doc.moveDown(1)

  // --- Totals ---
  const totalWithVat = order.total_amount
  const vatAmount = totalWithVat - taxBaseTotal

  const totalsX = 370
  doc.font("Regular").fontSize(9)

  let ty = doc.y
  doc.text("Данъчна основа:", totalsX, ty)
  doc.text(formatPrice(taxBaseTotal), c6, ty, { width: 85, align: "right" })
  ty += 16
  doc.text("ДДС 20%:", totalsX, ty)
  doc.text(formatPrice(vatAmount), c6, ty, { width: 85, align: "right" })
  ty += 16
  drawLine(doc, ty + 2, totalsX)
  ty += 8
  doc.font("Bold").fontSize(10)
  doc.text("Сума за плащане:", totalsX, ty)
  doc.text(formatPrice(totalWithVat), c6, ty, { width: 85, align: "right" })

  doc.y = ty + 28

  // --- Payment and legal info ---
  doc.font("Regular").fontSize(8)
  const paymentLabel = order.payment_method === "card" ? "По банков път (картово плащане)" : "Наложен платеж"
  doc.text(`Начин на плащане: ${paymentLabel}`, colLeft)

  // Legal basis for VAT (required when seller is VAT-registered)
  if (seller.vatNumber) {
    doc.text("Основание за начисляване на ДДС: чл. 12, ал. 1 от ЗДДС", colLeft)
  }

  // --- Signature lines ---
  doc.y = Math.max(doc.y + 40, 700)
  const sigY = doc.y

  doc.font("Regular").fontSize(8)
  doc.text("Съставил:", colLeft, sigY)
  drawLine(doc, sigY + 28, colLeft, 200)
  doc.text(`/ ${seller.mol} /`, colLeft, sigY + 32, { width: 200, align: "center" })

  doc.text("Получател:", colRight, sigY)
  drawLine(doc, sigY + 28, colRight, 200)
  const recipientName = isCompany
    ? (order.invoice_mol || `${order.first_name} ${order.last_name}`)
    : `${order.first_name} ${order.last_name}`
  doc.text(`/ ${recipientName} /`, colRight, sigY + 32, { width: 200, align: "center" })

  doc.end()

  return new Promise((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)))
  })
}

function formatDate(date: Date): string {
  const d = date.getDate().toString().padStart(2, "0")
  const m = (date.getMonth() + 1).toString().padStart(2, "0")
  const y = date.getFullYear()
  return `${d}.${m}.${y}`
}

function drawLine(doc: PDFKit.PDFDocument, y: number, fromX = 50, width = 495) {
  doc.moveTo(fromX, y).lineTo(fromX + width, y).strokeColor("#cccccc").lineWidth(0.5).stroke()
}
