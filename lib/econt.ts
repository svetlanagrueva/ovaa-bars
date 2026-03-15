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
        next: { revalidate: 3600 },
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
