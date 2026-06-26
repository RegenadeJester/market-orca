/**
 * Market Data — IHSG (^JKSE) and Forex (IDR pairs) from Yahoo Finance
 * Uses same SSRF-safe fetch pattern as mcp-tradingview.js
 */
import { validateFetchUrl } from './web-search.js'
import { normalizeAsset, normalizeIndex, normalizeAssets } from './normalizer.js'

const YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart'
const YAHOO_QUOTE = 'https://query1.finance.yahoo.com/v7/finance/quote'
const TIMEOUT = 12000

/* ── cache ──────────────────────────────────────────────────────────── */
const CACHE = new Map()
function cacheGet(key, ttlMs = 60_000) {
  const e = CACHE.get(key)
  if (!e || Date.now() > e.exp) { CACHE.delete(key); return null }
  return e.val
}
function cacheSet(key, val, ttlMs = 60_000) {
  CACHE.set(key, { val, exp: Date.now() + ttlMs })
  if (CACHE.size > 100) { const f = CACHE.keys().next().value; CACHE.delete(f) }
}

/* ── safe fetch ─────────────────────────────────────────────────────── */
async function safeFetch(url, opts = {}) {
  const v = await validateFetchUrl(url)
  if (!v.ok) throw new Error(`blocked: ${v.error}`)
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), opts.timeout || TIMEOUT)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 MarketOrca/1.0' },
      ...opts
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  } finally { clearTimeout(t) }
}

/* ── Parse Yahoo Finance chart result ───────────────────────────────── */
function parseChartResult(symbol, payload) {
  const result = payload?.chart?.result?.[0]
  if (!result) throw new Error(`No chart result for ${symbol}`)
  const meta = result.meta || {}
  const ts = result.timestamp || []
  const quote = result.indicators?.quote?.[0] || {}
  const adjClose = result.indicators?.adjclose?.[0]?.adjclose || []

  const bars = ts.map((t, i) => ({
    time: t,
    open: quote.open?.[i],
    high: quote.high?.[i],
    low: quote.low?.[i],
    close: quote.close?.[i],
    volume: quote.volume?.[i] || 0,
    adjclose: adjClose[i]
  })).filter(b => b.close != null)

  const price = meta.regularMarketPrice ?? bars.at(-1)?.close ?? meta.previousClose
  const prev = meta.chartPreviousClose ?? meta.previousClose ?? bars[0]?.open
  const change = (price != null && prev != null) ? price - prev : 0
  const changePercent = (price != null && prev != null && prev !== 0) ? ((price - prev) / prev) * 100 : 0

  return normalizeIndex({
    symbol: meta.symbol || symbol,
    price,
    change,
    changePercent: Number(changePercent.toFixed(4)),
    currency: meta.currency || 'USD',
    marketState: meta.marketState || 'REGULAR',
    exchange: meta.exchangeName || '',
    longName: meta.longName || '',
    previousClose: prev,
    bars: bars.slice(-200),
    fetchedAt: new Date().toISOString()
  })
}

/* ── Parse Yahoo Finance quote result ───────────────────────────────── */
function parseQuoteResult(payload) {
  const rows = payload?.quoteResponse?.result || []
  return rows.map(r => normalizeAsset({
    symbol: r.symbol || '',
    price: r.regularMarketPrice ?? r.postMarketPrice ?? r.bid ?? r.ask,
    change: r.regularMarketChange,
    changePercent: r.regularMarketChangePercent,
    currency: r.currency || 'USD',
    marketState: r.marketState || 'REGULAR',
    exchange: r.exchange || r.fullExchangeName || '',
    longName: r.longName || r.shortName || '',
    marketCap: r.marketCap,
    previousClose: r.regularMarketPreviousClose,
    dayLow: r.regularMarketDayLow,
    dayHigh: r.regularMarketDayHigh,
    fiftyTwoWeekLow: r.fiftyTwoWeekLow,
    fiftyTwoWeekHigh: r.fiftyTwoWeekHigh,
    fetchedAt: new Date().toISOString()
  }))
}

/* ── IHSG Index (^JKSE) ─────────────────────────────────────────────── */
export async function getIHSGData() {
  const cacheKey = 'ihsg:overview'
  const cached = cacheGet(cacheKey, 30_000)
  if (cached) return cached

  // ^JKSE needs dot encoded as %5E for Yahoo
  const symbol = '%5EJKSE'
  const chartUrl = `${YAHOO_CHART}/${symbol}?interval=1d&range=1mo`
  const quoteUrl = `${YAHOO_QUOTE}?symbols=${symbol}`

  try {
    const [chartJson, quoteJson] = await Promise.all([
      safeFetch(chartUrl),
      safeFetch(quoteUrl).catch(() => null)
    ])

    const chart = parseChartResult('^JKSE', chartJson)
    const quotes = quoteJson ? parseQuoteResult(quoteJson) : []

    const out = normalizeIndex({
      ok: true,
      index: '^JKSE',
      name: quotes[0]?.longName || 'IDX Composite (IHSG)',
      price: chart.price,
      change: chart.change,
      changePercent: chart.changePercent,
      currency: chart.currency,
      marketState: chart.marketState,
      previousClose: chart.previousClose,
      dayRange: quotes[0] ? { low: quotes[0].dayLow, high: quotes[0].dayHigh } : null,
      yearRange: quotes[0] ? { low: quotes[0].fiftyTwoWeekLow, high: quotes[0].fiftyTwoWeekHigh } : null,
      chart: chart.bars,
      fetchedAt: chart.fetchedAt
    })
    cacheSet(cacheKey, out, 30_000)
    return out
  } catch (e) {
    return { ok: false, error: String(e.message || e) }
  }
}

/* ── Forex pairs: IDR-USD, IDR-MYR, IDR-SGD ─────────────────────────── */
const FOREX_SYMBOLS = [
  { symbol: 'IDR=X', pair: 'IDR-USD', short: 'USDIDR', base: 'IDR', quote: 'USD' },
  { symbol: 'MYRIDR=X', pair: 'MYR-IDR', short: 'IDRMYR', base: 'MYR', quote: 'IDR' },
  { symbol: 'SGDIDR=X', pair: 'SGD-IDR', short: 'IDRSGD', base: 'SGD', quote: 'IDR' }
]

export async function getForexData() {
  const cacheKey = 'forex:idr_pairs'
  const cached = cacheGet(cacheKey, 30_000)
  if (cached) return cached

  try {
    // v7/quote returns 401 → use v8/chart for each symbol
    const results = await Promise.allSettled(
      FOREX_SYMBOLS.map(async (fx) => {
        const symbol = encodeURIComponent(fx.symbol)
        const url = `${YAHOO_CHART}/${symbol}?interval=1d&range=5d`
        const json = await safeFetch(url)
        const parsed = parseChartResult(fx.symbol, json)
        return { ...fx, ...parsed }
      })
    )

    const pairs = normalizeAssets(FOREX_SYMBOLS.map((fx, i) => {
      const r = results[i]
      if (r.status !== 'fulfilled') {
        return { ...fx, error: r.reason?.message || 'fetch_failed', price: null }
      }
      const data = r.value
      return {
        ...fx,
        price: data.price,
        change: data.change,
        changePercent: data.changePercent,
        currency: data.currency,
        marketState: data.marketState,
        previousClose: data.previousClose,
        fetchedAt: data.fetchedAt
      }
    }))

    const out = { ok: true, pairs, fetchedAt: new Date().toISOString() }
    cacheSet(cacheKey, out, 30_000)
    return out
  } catch (e) {
    return { ok: false, error: String(e.message || e) }
  }
}

/* ── Combined market overview (IHSG + Forex) ────────────────────────── */
export async function getMarketOverview() {
  const [ihsg, forex] = await Promise.allSettled([getIHSGData(), getForexData()])
  return {
    ok: true,
    ihsg: ihsg.status === 'fulfilled' ? ihsg.value : { ok: false, error: ihsg.reason?.message },
    forex: forex.status === 'fulfilled' ? forex.value : { ok: false, error: forex.reason?.message },
    fetchedAt: new Date().toISOString()
  }
}

export { FOREX_SYMBOLS }
