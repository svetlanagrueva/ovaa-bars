import { NextRequest, NextResponse } from 'next/server'
import { getOffices } from '@/lib/econt'

// In-memory cache for slim office data (response is ~2.4MB raw, too large for Next.js fetch cache)
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour
let officeCache: { data: Map<string, { id: number; name: string; city: string; fullAddress: string }[]>; timestamp: number } | null = null

/** @internal — exposed for tests only */
export function _resetCache() { officeCache = null }

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
    const cacheKey = city || '__all__'
    const now = Date.now()

    // Return cached data if fresh
    if (officeCache && now - officeCache.timestamp < CACHE_TTL_MS) {
      const cached = officeCache.data.get(cacheKey)
      if (cached) {
        return NextResponse.json({ offices: cached })
      }
    }

    const offices = await getOffices(city)
    const slim = offices.map((o) => ({
      id: o.id,
      code: o.code,
      name: o.name,
      city: o.address?.city?.name || '',
      fullAddress: o.address?.fullAddress || '',
    }))

    // Update cache
    if (!officeCache || now - officeCache.timestamp >= CACHE_TTL_MS) {
      officeCache = { data: new Map(), timestamp: now }
    }
    officeCache.data.set(cacheKey, slim)

    return NextResponse.json({ offices: slim })
  } catch (error) {
    console.error('Econt offices fetch failed:', error)
    return NextResponse.json(
      { offices: [], error: 'Failed to fetch offices' },
      { status: 502 }
    )
  }
}
