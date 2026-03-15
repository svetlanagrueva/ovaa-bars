import { NextRequest, NextResponse } from 'next/server'
import { getOffices } from '@/lib/speedy'

// Simple in-memory rate limiter: max 30 requests per minute per IP
const rateLimit = new Map<string, number[]>()
const RATE_LIMIT_WINDOW_MS = 60 * 1000
const RATE_LIMIT_MAX = 30

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const timestamps = (rateLimit.get(ip) || []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS
  )
  if (timestamps.length >= RATE_LIMIT_MAX) return false
  timestamps.push(now)
  rateLimit.set(ip, timestamps)

  // Purge stale entries
  if (rateLimit.size > 500) {
    for (const [key, ts] of rateLimit) {
      const active = ts.filter((t) => now - t < RATE_LIMIT_WINDOW_MS)
      if (active.length === 0) rateLimit.delete(key)
      else rateLimit.set(key, active)
    }
  }
  return true
}

export async function GET(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { offices: [], error: 'Too many requests' },
      { status: 429 }
    )
  }

  const city = request.nextUrl.searchParams.get('city') || undefined
  if (city && city.length > 100) {
    return NextResponse.json({ offices: [], error: 'Invalid city parameter' }, { status: 400 })
  }

  try {
    const offices = await getOffices(city)
    const slim = offices.map((o) => ({
      id: o.id,
      name: o.name,
      city: o.address?.siteName || '',
      fullAddress: o.address?.fullAddressString || '',
    }))
    return NextResponse.json({ offices: slim })
  } catch (error) {
    console.error('Speedy offices fetch failed:', error)
    return NextResponse.json(
      { offices: [], error: 'Failed to fetch offices' },
      { status: 502 }
    )
  }
}
