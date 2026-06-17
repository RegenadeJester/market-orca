/**
 * Yahoo Finance fetcher — IHSG (^JKSE), IDX stocks, IDR/USD
 * Uses public Yahoo Finance chart API (no auth needed)
 */
import { saveIHSG, saveIDXStock, saveIDRUSD, getIHSG, getIDRUSD } from './db.js'

const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart'
const USER_AGENT = 'MarketOrca/1.0 Indonesia'
const TIMEOUT = 15000

async function yahooFetch(symbol, range = '1y', interval = '1d') {
  const url = `${YAHOO_BASE}/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': USER_AGENT }
    })
    if (!res.ok) throw new Error(`Yahoo HTTP ${res.status} for ${symbol}`)
    return await res.json()
  } finally { clearTimeout(t) }
}

function parseOHLCV(result) {
  if (!result?.timestamp || !result?.indicators?.quote?.[0]) return []
  const ts = result.timestamp
  const q = result.indicators.quote[0]
  const adjClose = result.indicators?.adjclose?.[0]?.adjclose
  const bars = []
  for (let i = 0; i < ts.length; i++) {
    if (q.close?.[i] == null) continue
    bars.push({
      date: new Date(ts[i] * 1000).toISOString().split('T')[0],
      open: q.open?.[i],
      high: q.high?.[i],
      low: q.low?.[i],
      close: q.close[i],
      volume: q.volume?.[i] || 0,
      adjClose: adjClose?.[i] || q.close[i]
    })
  }
  return bars
}

// ── IHSG (^JKSE) ─────────────────────────────────────────────
export async function fetchIHSG(range = '1y', interval = '1d') {
  try {
    const data = await yahooFetch('^JKSE', range, interval)
    const result = data?.chart?.result?.[0]
    if (!result) throw new Error('No IHSG data from Yahoo')
    const bars = parseOHLCV(result)
    // Cache to DB
    for (const b of bars) {
      saveIHSG(b.date, b.open, b.high, b.low, b.close, b.volume)
    }
    const meta = result.meta || {}
    return {
      symbol: '^JKSE',
      name: 'IHSG Composite',
      bars,
      currentPrice: meta.regularMarketPrice || bars.at(-1)?.close,
      previousClose: meta.chartPreviousClose || bars.at(-2)?.close,
      change: meta.regularMarketPrice - meta.chartPreviousClose || 0,
      changePercent: meta.chartPreviousClose ? ((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose) * 100 : 0,
      fetchedAt: new Date().toISOString()
    }
  } catch (e) {
    console.error('[fetcher-yahoo] fetchIHSG error:', e.message)
    // Fallback to DB cache
    const cached = getIHSG(365)
    if (cached.length) {
      const last = cached.at(-1)
      return {
        symbol: '^JKSE', name: 'IHSG Composite (cached)',
        bars: cached.map(r => ({ date: r.date, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume })),
        currentPrice: last?.close,
        change: 0, changePercent: 0,
        fetchedAt: new Date().toISOString(),
        cached: true
      }
    }
    throw e
  }
}

// ── IDX Stocks ────────────────────────────────────────────────
const IDX_SYMBOLS = ['BBCA.JK', 'BBRI.JK', 'BMRI.JK', 'TLKM.JK', 'ASII.JK']

export async function fetchIDXStocks(range = '6mo', interval = '1d') {
  const results = []
  for (const sym of IDX_SYMBOLS) {
    try {
      const data = await yahooFetch(sym, range, interval)
      const result = data?.chart?.result?.[0]
      if (!result) { results.push({ symbol: sym, bars: [], error: 'no_data' }); continue }
      const bars = parseOHLCV(result)
      for (const b of bars) {
        saveIDXStock(sym, b.date, b.open, b.high, b.low, b.close, b.volume)
      }
      const meta = result.meta || {}
      const lastBar = bars.at(-1)
      results.push({
        symbol: sym,
        bars,
        currentPrice: meta.regularMarketPrice || lastBar?.close,
        previousClose: meta.chartPreviousClose || bars.at(-2)?.close,
        changePercent: meta.chartPreviousClose ? ((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose) * 100 : 0
      })
    } catch (e) {
      console.error(`[fetcher-yahoo] fetchIDXStocks ${sym}:`, e.message)
      results.push({ symbol: sym, bars: [], error: e.message })
    }
  }
  return { symbols: IDX_SYMBOLS, stocks: results, fetchedAt: new Date().toISOString() }
}

// ── IDR/USD ──────────────────────────────────────────────────
export async function fetchIDRUSD(range = '6mo', interval = '1d') {
  try {
    const data = await yahooFetch('IDR=X', range, interval)
    const result = data?.chart?.result?.[0]
    if (!result) throw new Error('No IDR/USD data from Yahoo')
    const bars = parseOHLCV(result)
    for (const b of bars) {
      saveIDRUSD(b.date, b.close, b.open, b.high, b.low)
    }
    const meta = result.meta || {}
    return {
      symbol: 'IDR=X',
      name: 'USD/IDR',
      bars,
      currentRate: meta.regularMarketPrice || bars.at(-1)?.close,
      previousClose: meta.chartPreviousClose || bars.at(-2)?.close,
      changePercent: meta.chartPreviousClose ? ((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose) * 100 : 0,
      fetchedAt: new Date().toISOString()
    }
  } catch (e) {
    console.error('[fetcher-yahoo] fetchIDRUSD error:', e.message)
    const cached = getIDRUSD(90)
    if (cached.length) {
      const last = cached.at(-1)
      return {
        symbol: 'IDR=X', name: 'USD/IDR (cached)',
        bars: cached.map(r => ({ date: r.date, open: r.open, high: r.high, low: r.low, close: r.rate, volume: 0 })),
        currentRate: last?.rate,
        changePercent: 0, fetchedAt: new Date().toISOString(), cached: true
      }
    }
    throw e
  }
}

export { IDX_SYMBOLS }
