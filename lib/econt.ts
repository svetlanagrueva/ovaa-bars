import 'server-only'

const ECONT_API_URL = process.env.ECONT_API_URL || 'https://demo.econt.com/ee/services/'
const ECONT_USERNAME = process.env.ECONT_USERNAME || ''
const ECONT_PASSWORD = process.env.ECONT_PASSWORD || ''

function authHeaders(): HeadersInit {
  const encoded = Buffer.from(`${ECONT_USERNAME}:${ECONT_PASSWORD}`).toString('base64')
  return {
    'Content-Type': 'application/json',
    'Authorization': `Basic ${encoded}`,
  }
}

export interface EcontOffice {
  id: number
  code: string
  name: string
  nameEn: string
  phones: string[]
  address: {
    city: {
      name: string
      postCode: string
    }
    fullAddress: string
  }
  normalBusinessHoursFrom: number
  normalBusinessHoursTo: number
}

export async function getOffices(cityName?: string): Promise<EcontOffice[]> {
  const body: Record<string, string> = { countryCode: 'BGR' }
  if (cityName) body.cityName = cityName

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000) // 10s timeout

  let res: Response
  try {
    res = await fetch(
      `${ECONT_API_URL}Nomenclatures/NomenclaturesService.getOffices.json`,
      {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: 'no-store',
      }
    )
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Econt API timeout')
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }

  if (!res.ok) {
    throw new Error(`Econt API error: ${res.status}`)
  }

  const data = await res.json()
  return data.offices || []
}

export interface EcontShipmentParams {
  senderName?: string
  senderPhone?: string
  senderEmail?: string
  senderOfficeCode?: string
  senderCity?: string
  senderAddress?: string
  senderPostalCode?: string
  recipientName: string
  recipientPhone: string
  officeCode?: string
  address?: { city: string; postCode: string; street: string; num: string }
  weight: number
  contents: string
  codAmount?: number
}

export interface EcontShipmentResult {
  trackingNumber: string
  pdfUrl?: string
}

// Extract human-readable error messages from Econt nested error structure
function extractEcontErrors(err: Record<string, unknown>): string[] {
  const messages: string[] = []
  const msg = (err.message as string || "").trim()
  // Collect non-empty messages; skip generic container labels like "подател: " or " "
  if (msg && msg.length > 2 && !msg.endsWith(":")) messages.push(msg)
  if (Array.isArray(err.innerErrors)) {
    for (const inner of err.innerErrors) {
      messages.push(...extractEcontErrors(inner))
    }
  }
  return messages
}

export async function createShipment(params: EcontShipmentParams): Promise<EcontShipmentResult> {
  const senderName = params.senderName || process.env.SELLER_COMPANY_NAME || ""
  const senderPhone = params.senderPhone || process.env.SELLER_PHONE || ""
  const senderEmail = params.senderEmail || process.env.SELLER_EMAIL || ""

  const label: Record<string, unknown> = {
    senderClient: {
      name: senderName,
      phones: [senderPhone],
      email: senderEmail,
    },
    senderAgent: {
      name: process.env.SELLER_MOL || senderName,
      phones: [senderPhone],
    },
    receiverClient: {
      name: params.recipientName,
      phones: [params.recipientPhone],
    },
    packCount: 1,
    shipmentType: "PACK",
    weight: params.weight,
    shipmentDescription: params.contents,
  }

  // Sender: use office code if provided/configured, otherwise address
  const senderOffice = params.senderOfficeCode || process.env.SELLER_ECONT_OFFICE_CODE
  if (senderOffice) {
    label.senderOfficeCode = senderOffice
  } else {
    label.senderAddress = {
      city: {
        country: { code3: "BGR" },
        name: params.senderCity || process.env.SELLER_CITY || "София",
        postCode: params.senderPostalCode || process.env.SELLER_POSTAL_CODE || "1000",
      },
      street: params.senderAddress || process.env.SELLER_ADDRESS || "",
      num: process.env.SELLER_ADDRESS_NUM || "",
    }
  }

  // Receiver: office or address
  if (params.officeCode) {
    label.receiverOfficeCode = params.officeCode
  } else if (params.address) {
    label.receiverAddress = {
      city: {
        country: { code3: "BGR" },
        name: params.address.city,
        postCode: params.address.postCode,
      },
      street: params.address.street,
      num: params.address.num || "",
    }
  }

  if (params.codAmount && params.codAmount > 0) {
    label.services = {
      cdAmount: params.codAmount,
      cdType: "get",
      cdCurrency: "EUR",
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)

  let res: Response
  try {
    res = await fetch(
      `${ECONT_API_URL}Shipments/LabelService.createLabel.json`,
      {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ label, mode: "create" }),
        signal: controller.signal,
      }
    )
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("Econt API timeout")
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null)
    if (body && body.innerErrors) {
      const messages = extractEcontErrors(body)
      throw new Error(`Еконт: ${messages.join("; ") || "Невалидни данни"}`)
    }
    throw new Error(`Econt API error: ${res.status}`)
  }

  const data = await res.json()

  if (data.error) {
    throw new Error(`Еконт: ${data.error.message || JSON.stringify(data.error)}`)
  }

  if (data.label?.shipmentNumber) {
    return {
      trackingNumber: data.label.shipmentNumber,
      pdfUrl: data.label.pdfURL,
    }
  }

  throw new Error("Econt: No shipment number returned")
}
