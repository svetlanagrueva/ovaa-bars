import 'server-only'

const SPEEDY_API_URL = process.env.SPEEDY_API_URL || 'https://api.speedy.bg/v1'
const SPEEDY_USERNAME = process.env.SPEEDY_USERNAME || ''
const SPEEDY_PASSWORD = process.env.SPEEDY_PASSWORD || ''

export interface SpeedyOffice {
  id: number
  name: string
  nameEn: string
  siteId: number
  address: {
    siteName: string
    postCode: string
    fullAddressString: string
    siteAddressString: string
    localAddressString: string
  }
  type: 'OFFICE' | 'APT'
  pickUpAllowed: boolean
  dropOffAllowed: boolean
  cardPaymentAllowed: boolean
  cashPaymentAllowed: boolean
  workingTimeFrom: string
  workingTimeTo: string
}

export async function getOffices(siteName?: string): Promise<SpeedyOffice[]> {
  const body: Record<string, unknown> = {
    userName: SPEEDY_USERNAME,
    password: SPEEDY_PASSWORD,
    language: 'BG',
    countryId: 100, // Bulgaria
  }
  if (siteName) body.siteName = siteName

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000) // 10s timeout

  let res: Response
  try {
    res = await fetch(
      `${SPEEDY_API_URL}/location/office`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
        next: { revalidate: 3600 },
      }
    )
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Speedy API timeout')
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }

  if (!res.ok) {
    throw new Error(`Speedy API error: ${res.status}`)
  }

  const data = await res.json()

  if (data.error) {
    throw new Error(`Speedy API error: ${data.error.message || 'Unknown error'}`)
  }

  return data.offices || []
}

export interface SpeedyShipmentParams {
  recipientName: string
  recipientPhone: string
  recipientEmail?: string
  officeId?: number
  address?: { siteId: number; streetName: string; streetNo: string }
  weight: number
  contents: string
  codAmount?: number
}

export interface SpeedyShipmentResult {
  shipmentId: string
  trackingNumber: string
  deliveryDeadline?: string
}

export async function createShipment(params: SpeedyShipmentParams): Promise<SpeedyShipmentResult> {
  const recipient: Record<string, unknown> = {
    phone1: { number: params.recipientPhone },
    privatePerson: true,
    clientName: params.recipientName,
  }
  if (params.recipientEmail) recipient.email = params.recipientEmail

  if (params.officeId) {
    recipient.pickupOfficeId = params.officeId
  } else if (params.address) {
    recipient.address = {
      countryId: 100,
      siteId: params.address.siteId,
      streetName: params.address.streetName,
      streetNo: params.address.streetNo,
    }
  }

  const service: Record<string, unknown> = {
    serviceId: Number(process.env.SPEEDY_SERVICE_ID) || 505, // 505 = Standard 24h
    autoAdjustPickupDate: true,
  }

  if (params.codAmount && params.codAmount > 0) {
    service.additionalServices = {
      cod: {
        amount: params.codAmount,
        processingType: "CASH",
      },
    }
  }

  const body = {
    userName: SPEEDY_USERNAME,
    password: SPEEDY_PASSWORD,
    language: "BG",
    sender: {
      phone1: { number: process.env.SELLER_PHONE || "" },
      contactName: process.env.SELLER_COMPANY_NAME || "",
      email: process.env.SELLER_EMAIL || "",
    },
    recipient,
    service,
    content: {
      parcelsCount: 1,
      totalWeight: params.weight,
      contents: params.contents,
      package: "BOX",
    },
    payment: {
      courierServicePayer: params.codAmount ? "RECIPIENT" : "SENDER",
    },
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)

  let res: Response
  try {
    res = await fetch(`${SPEEDY_API_URL}/shipment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("Speedy API timeout")
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Speedy API error: ${res.status} ${text}`)
  }

  const data = await res.json()

  if (data.error) {
    throw new Error(`Speedy: ${data.error.message || JSON.stringify(data.error)}`)
  }

  return {
    shipmentId: String(data.id),
    trackingNumber: String(data.parcels?.[0]?.id || data.id),
    deliveryDeadline: data.deliveryDeadline,
  }
}
