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

  const res = await fetch(
    `${ECONT_API_URL}Nomenclatures/NomenclaturesService.getOffices.json`,
    {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body),
      next: { revalidate: 3600 },
    }
  )

  if (!res.ok) {
    throw new Error(`Econt API error: ${res.status}`)
  }

  const data = await res.json()
  return data.offices || []
}
