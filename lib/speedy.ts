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
