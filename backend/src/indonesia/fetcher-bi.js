/**
 * Bank Indonesia data fetcher — BI-Rate (7DRR) and SUN Yield Curve
 * Uses known BI rate + modeled yield curve. Falls back to stored values on failure.
 */
import { saveYieldCurvePoint, getYieldCurveLatest } from './db.js'

// ── BI-Rate (last known: 5.75% as of 2025) ───────────────────
export const BI_RATE = 5.75

// ── Fallback yield curve (normal upward slope) ───────────────
const FALLBACK_CURVE = {
  '1m': 5.90, '3m': 5.85, '6m': 5.75, '1y': 5.65,
  '2y': 5.55, '5y': 5.45, '10y': 5.35, '20y': 5.40, '30y': 5.50
}

/**
 * Fetch yield curve. Try BI source, fallback to modelled.
 */
export async function fetchYieldCurve() {
  try {
    // Try fetching from BI's CSV endpoint
    const url = 'https://www.bi.go.id/id/statistik/ekonomi-keuangan/ssp/contents/Data/IRBI.csv'
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 10000)
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'MarketOrca/1.0' }
    })
    clearTimeout(t)
    if (res.ok) {
      const text = await res.text()
      const curve = parseYieldCsv(text)
      if (Object.keys(curve.curve).length >= 3) {
        // Save to DB
        for (const [tenor, pct] of Object.entries(curve.curve)) {
          saveYieldCurvePoint(tenor, pct, 'bi')
        }
        return curve
      }
    }
  } catch (e) {
    console.error('[fetcher-bi] BI CSV fetch error:', e.message)
  }

  // Try Yahoo Finance for SUN benchmark (^JKMT10Y)
  try {
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/%5EJKMT10Y?interval=1d&range=1d'
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 10000)
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'MarketOrca/1.0' } })
    clearTimeout(t)
    if (res.ok) {
      const data = await res.json()
      const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice
      if (price && price > 0) {
        const curve = buildCurveFromBase(price)
        for (const [tenor, pct] of Object.entries(curve.curve)) {
          saveYieldCurvePoint(tenor, pct, 'yahoo-modeled')
        }
        return curve
      }
    }
  } catch (e) {
    console.error('[fetcher-bi] Yahoo yield error:', e.message)
  }

  // Fallback to DB cache
  const cached = getYieldCurveLatest()
  if (cached && cached.length >= 3) {
    const curve = {}
    for (const row of cached) curve[row.tenor] = row.yield_pct
    return { curve, source: 'cache', timestamp: new Date().toISOString(), status: 'cached' }
  }

  // Ultimate fallback
  return { curve: { ...FALLBACK_CURVE }, source: 'fallback', timestamp: new Date().toISOString(), status: 'estimated' }
}

function parseYieldCsv(text) {
  const lines = text.split('\n').filter(l => l.trim())
  const headers = lines[0]?.split(',') || []
  const lastRow = lines.at(-1)?.split(',') || []
  const curve = {}
  const tenorMap = {
    '1M': '1m', '3M': '3m', '6M': '6m', '1Y': '1y',
    '2Y': '2y', '5Y': '5y', '10Y': '10y', '20Y': '20y', '30Y': '30y'
  }
  for (let i = 0; i < headers.length; i++) {
    const t = tenorMap[headers[i]?.trim()?.toUpperCase()]
    if (t && lastRow[i]) curve[t] = parseFloat(lastRow[i])
  }
  return {
    curve: Object.keys(curve).length >= 3 ? curve : { ...FALLBACK_CURVE },
    source: 'bi-irbi',
    timestamp: new Date().toISOString(),
    status: Object.keys(curve).length >= 3 ? 'live' : 'fallback'
  }
}

function buildCurveFromBase(base10y) {
  return {
    curve: {
      '1m':  base10y + 0.55, '3m':  base10y + 0.50, '6m':  base10y + 0.40,
      '1y':  base10y + 0.30, '2y':  base10y + 0.20, '5y':  base10y + 0.10,
      '10y': base10y,         '20y': base10y + 0.05, '30y': base10y + 0.15
    },
    source: 'yahoo-modeled',
    timestamp: new Date().toISOString(),
    status: 'modeled'
  }
}

export default { BI_RATE, FALLBACK_CURVE, fetchYieldCurve }
