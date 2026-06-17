/**
 * TradingView integration – free public endpoints
 * - Scanner API (screener): https://scanner.tradingview.com/{market}/scan  (POST)
 * - TradingView chart embed JS for frontend
 * - News via TradingView search
 */
import { validateFetchUrl } from './web-search.js'

const TV_BASE = 'https://scanner.tradingview.com'
const TV_TIMEOUT = 15000

/* ── simple in-memory cache ──────────────────────────────────────────── */
const CACHE = new Map()
function cacheGet(key, ttlMs = 60_000) {
  const e = CACHE.get(key)
  if (!e || Date.now() > e.exp) { CACHE.delete(key); return null }
  return e.val
}
function cacheSet(key, val, ttlMs = 60_000) {
  CACHE.set(key, { val, exp: Date.now() + ttlMs })
  if (CACHE.size > 500) {
    const first = CACHE.keys().next().value
    CACHE.delete(first)
  }
}

/* ── safe fetch wrapper ──────────────────────────────────────────────── */
async function safeFetch(url, opts = {}) {
  const v = await validateFetchUrl(url)
  if (!v.ok) throw new Error(`blocked: ${v.error}`)
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), opts.timeout || TV_TIMEOUT)
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0' }, ...opts })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res
  } finally { clearTimeout(t) }
}

/* ──────────────────────────────────────────────────────────────────────
 * 1. Screener
 * ────────────────────────────────────────────────────────────────────── */
export async function getTradingViewScreener(market = 'crypto', filters = {}) {
  const cacheKey = `screener:${market}:${JSON.stringify(filters)}`
  const cached = cacheGet(cacheKey)
  if (cached) return cached

  const validMarkets = ['crypto', 'america', 'forex', 'indonesia', 'japan', 'europe']
  if (!validMarkets.includes(market)) market = 'crypto'

  const columns = filters.columns || [
    'name', 'description', 'close', 'change', 'change_abs', 'recommendation',
    'volume', 'market_cap_basic', 'average_volume_10d_calc', 'number_of_employees',
    'price_52_week_high', 'price_52_week_low', 'Perf.1M', 'Perf.3M', 'Perf.6M', 'Perf.Y'
  ]

  const body = {
    columns,
    filter: (filters.filter || []).map(f => ({
      left: f.left || 'is_primary',
      operation: f.operation || 'equal',
      right: f.right ?? true
    })),
    options: { lang: 'en' },
    range: [0, filters.limit || 50],
    sort: { sortBy: filters.sortBy || 'volume', sortOrder: filters.sortOrder || 'desc' },
    symbols: filters.symbols ? { query: { types: filters.symbolTypes || ['stock'] } } : undefined
  }

  const res = await safeFetch(`${TV_BASE}/${market}/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })

  const json = await res.json()
  const data = (json.data || []).map(row => {
    const obj = {}
    const vals = row.d || []
    columns.forEach((k, i) => { obj[k] = vals[i] })
    obj._symbol = row.s || ''
    return obj
  })

  const result = {
    ok: true,
    market,
    count: data.length,
    total: json.totalCount || data.length,
    data,
    columns,
    fetchedAt: new Date().toISOString()
  }
  cacheSet(cacheKey, result, 120_000)
  return result
}

/* ──────────────────────────────────────────────────────────────────────
 * 2. Chart OHLCV
 * ────────────────────────────────────────────────────────────────────── */
export async function getTradingViewChart(symbol = 'BTC-USD', timeframe = 'D') {
  const cacheKey = `chart:${symbol}:${timeframe}`
  const cached = cacheGet(cacheKey, 30_000)
  if (cached) return cached

  const count = 200

  // ── Try CoinGecko (free, no key) for crypto ────────────
  const isCrypto = symbol.match(/(BTC|ETH|BNB|SOL|XRP|DOGE|ADA|DOT|AVAX|LINK|MATIC|ATOM|ALGO|UNI|AAVE)$/i)
  if (isCrypto) {
    try {
      const cgId = symbol.toLowerCase()
      const days = timeframe === 'M' ? 90 : timeframe === 'W' ? 60 : 30
      const cgUrl = `https://api.coingecko.com/api/v3/coins/${cgId}/ohlc?vs_currency=usd&days=${days}`
      const cgRes = await safeFetch(cgUrl, { timeout: 10000 })
      const ohlc = await cgRes.json()
      if (Array.isArray(ohlc) && ohlc.length) {
        const bars = ohlc.map(k => ({
          time: Math.floor(k[0] / 1000),
          open: k[1], high: k[2], low: k[3], close: k[4],
          volume: 0
        }))
        const out = { ok: true, symbol, timeframe, bars, count: bars.length, source: 'coingecko', fetchedAt: new Date().toISOString() }
        cacheSet(cacheKey, out, 60_000)
        return out
      }
    } catch {}
  }

  // ── Try Yahoo Finance ──────────────────────────────────
  // Yahoo symbol logic: try as-is first, then fallback variations
  const yahooVariants = [symbol]
  // Add -USD variant for crypto symbols like BTCUSD → BTC-USD
  if (!symbol.includes('-') && !symbol.endsWith('=X') && !symbol.startsWith('^')) {
    if (symbol.endsWith('USDT')) yahooVariants.push(symbol.replace(/USDT$/, '') + '-USD')
    else yahooVariants.push(symbol + '-USD')
  }

  for (const trySym of yahooVariants) {
    try {
      const interval = timeframe === 'W' ? '1wk' : timeframe === 'M' ? '1mo' : '1d'
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(trySym)}?interval=${interval}&range=2y`
      const res = await safeFetch(url, { timeout: 10000 })
      const json = await res.json()
      const result = json?.chart?.result?.[0]
      const ts = result?.timestamp || []
      const ohl = result?.indicators?.quote?.[0] || {}
      const bars = ts.map((t, i) => ({
        time: t,
        open: ohl.open?.[i], high: ohl.high?.[i], low: ohl.low?.[i], close: ohl.close?.[i], volume: ohl.volume?.[i]
      })).filter(b => b.open != null).slice(-count)
      if (bars.length) {
        const out = { ok: true, symbol, timeframe, bars, count: bars.length, source: 'yahoo', fetchedAt: new Date().toISOString() }
        cacheSet(cacheKey, out, 60_000)
        return out
      }
    } catch { /* try next variant */ }
  }

  throw new Error('chart_data_unavailable')
}

/* ──────────────────────────────────────────────────────────────────────
 * 3. Technical Indicators (computed from chart data)
 * ────────────────────────────────────────────────────────────────────── */
function sma(data, period) {
  const out = []
  for (let i = period - 1; i < data.length; i++) {
    const slice = data.slice(i - period + 1, i + 1)
    out.push({ time: data[i].time, value: slice.reduce((s, d) => s + d.close, 0) / period })
  }
  return out
}

function ema(data, period) {
  const k = 2 / (period + 1)
  const out = [{ time: data[0].time, value: data[0].close }]
  for (let i = 1; i < data.length; i++) {
    const val = data[i].close * k + out[i - 1].value * (1 - k)
    out.push({ time: data[i].time, value: val })
  }
  return out
}

function rsi(data, period = 14) {
  if (data.length < period + 1) return []
  let gains = 0, losses = 0
  for (let i = 1; i <= period; i++) {
    const d = data[i].close - data[i - 1].close
    if (d > 0) gains += d; else losses -= d
  }
  const out = [{ time: data[period].time, value: gains === 0 ? 0 : 100 - 100 / (1 + gains / losses) }]
  let avgGain = gains / period, avgLoss = losses / period
  for (let i = period + 1; i < data.length; i++) {
    const d = data[i].close - data[i - 1].close
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period
    out.push({ time: data[i].time, value: avgLoss === 0 ? 0 : 100 - 100 / (1 + avgGain / avgLoss) })
  }
  return out
}

function macd(data, fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(data, fast)
  const emaSlow = ema(data, slow)
  const len = Math.min(emaFast.length, emaSlow.length)
  const diff = []
  for (let i = 0; i < len; i++) diff.push({ time: emaFast[i].time, close: emaFast[i].value - emaSlow[i].value })
  const signalLine = ema(diff, signal)
  const macdLine = diff.slice(-signalLine.length)
  const histogram = macdLine.map((m, i) => ({ time: m.time, value: m.close - signalLine[i].value }))
  return { macd: macdLine.map(m => ({ time: m.time, value: m.close })), signal: signalLine.map(s => ({ time: s.time, value: s.value })), histogram }
}

function bollinger(data, period = 20, dev = 2) {
  const out = []
  for (let i = period - 1; i < data.length; i++) {
    const slice = data.slice(i - period + 1, i + 1)
    const mean = slice.reduce((s, d) => s + d.close, 0) / period
    const variance = slice.reduce((s, d) => s + (d.close - mean) ** 2, 0) / period
    const std = Math.sqrt(variance)
    out.push({ time: data[i].time, upper: mean + dev * std, middle: mean, lower: mean - dev * std })
  }
  return out
}

function atr(data, period = 14) {
  const trs = data.map((d, i) => {
    if (i === 0) return d.high - d.low
    return Math.max(d.high - d.low, Math.abs(d.high - data[i - 1].close), Math.abs(d.low - data[i - 1].close))
  })
  const out = []
  let sum = trs.slice(0, period).reduce((a, b) => a + b, 0)
  out.push({ time: data[period - 1].time, value: sum / period })
  for (let i = period; i < trs.length; i++) {
    const val = (out[out.length - 1].value * (period - 1) + trs[i]) / period
    out.push({ time: data[i].time, value: val })
  }
  return out
}

function vwap(data) {
  let cumVol = 0, cumTP = 0
  return data.map(d => {
    const tp = (d.high + d.low + d.close) / 3
    cumVol += d.volume || 0
    cumTP += tp * (d.volume || 0)
    return { time: d.time, value: cumVol > 0 ? cumTP / cumVol : tp }
  })
}

export async function getTradingViewTechnical(symbol = 'BTCUSDT', timeframe = 'D') {
  const cacheKey = `tech:${symbol}:${timeframe}`
  const cached = cacheGet(cacheKey, 120_000)
  if (cached) return cached

  const chart = await getTradingViewChart(symbol, timeframe)
  if (!chart.ok || !chart.bars?.length) return { ok: false, error: 'no_chart_data' }

  const bars = chart.bars
  const latest = bars[bars.length - 1]
  const prev = bars.length > 1 ? bars[bars.length - 2] : null
  const priceChange = prev ? latest.close - prev.close : 0
  const pctChange = prev ? (priceChange / prev.close) * 100 : 0

  const rsiValues = rsi(bars, 14)
  const currentRsi = rsiValues.length ? rsiValues[rsiValues.length - 1].value : null
  const macdValues = macd(bars)
  const sma20 = sma(bars, 20)
  const sma50 = sma(bars, 50)
  const sma200 = sma(bars, 200)
  const bb = bollinger(bars)
  const atrValues = atr(bars, 14)
  const vwapValues = vwap(bars)

  const sma20Val = sma20.length ? sma20[sma20.length - 1].value : null
  const sma50Val = sma50.length ? sma50[sma50.length - 1].value : null
  const sma200Val = sma200.length ? sma200[sma200.length - 1].value : null
  const bbLast = bb.length ? bb[bb.length - 1] : null
  const atrVal = atrValues.length ? atrValues[atrValues.length - 1].value : null
  const vwapVal = vwapValues.length ? vwapValues[vwapValues.length - 1].value : null
  const macdLast = macdValues.macd.length ? macdValues.macd[macdValues.macd.length - 1].value : null
  const signalLast = macdValues.signal.length ? macdValues.signal[macdValues.signal.length - 1].value : null

  // Generate signal summary
  const signals = []
  if (currentRsi != null) {
    if (currentRsi > 70) signals.push({ indicator: 'RSI', signal: 'OVERBOUGHT', value: currentRsi })
    else if (currentRsi < 30) signals.push({ indicator: 'RSI', signal: 'OVERSOLD', value: currentRsi })
    else signals.push({ indicator: 'RSI', signal: 'NEUTRAL', value: currentRsi })
  }
  if (sma20Val && sma50Val) {
    const cross = sma20Val > sma50Val ? 'BULLISH' : 'BEARISH'
    signals.push({ indicator: 'SMA_CROSS', signal: cross, sma20: sma20Val, sma50: sma50Val })
  }
  if (latest.close && sma200Val) {
    signals.push({ indicator: 'PRICE_VS_SMA200', signal: latest.close > sma200Val ? 'ABOVE' : 'BELOW' })
  }
  if (macdLast != null && signalLast != null) {
    signals.push({ indicator: 'MACD', signal: macdLast > signalLast ? 'BULLISH' : 'BEARISH', macd: macdLast, signal: signalLast })
  }
  if (bbLast) {
    const pct = (latest.close - bbLast.lower) / (bbLast.upper - bbLast.lower)
    let bbSignal = 'MIDDLE'
    if (pct > 0.9) bbSignal = 'UPPER_BAND'
    else if (pct < 0.1) bbSignal = 'LOWER_BAND'
    signals.push({ indicator: 'BOLLINGER', signal: bbSignal, pct })
  }

  // Overall recommendation
  const bullCount = signals.filter(s => ['OVERSOLD', 'BULLISH', 'ABOVE', 'LOWER_BAND'].includes(s.signal)).length
  const bearCount = signals.filter(s => ['OVERBOUGHT', 'BEARISH', 'BELOW', 'UPPER_BAND'].includes(s.signal)).length
  const recommendation = bullCount > bearCount ? 'BUY' : bearCount > bullCount ? 'SELL' : 'NEUTRAL'

  const result = {
    ok: true,
    symbol,
    timeframe,
    price: latest.close,
    priceChange,
    priceChangePercent: pctChange,
    indicators: {
      rsi: currentRsi,
      macd: macdLast,
      macd_signal: signalLast,
      sma_20: sma20Val,
      sma_50: sma50Val,
      sma_200: sma200Val,
      bollinger_upper: bbLast?.upper,
      bollinger_middle: bbLast?.middle,
      bollinger_lower: bbLast?.lower,
      atr_14: atrVal,
      vwap: vwapVal
    },
    series: {
      rsi: rsiValues.slice(-50),
      macd: macdValues.macd.slice(-50),
      macd_signal: macdValues.signal.slice(-50),
      macd_histogram: macdValues.histogram.slice(-50),
      sma_20: sma20.slice(-50),
      sma_50: sma50.slice(-50),
      sma_200: sma200,
      bollinger: bb.slice(-50),
      atr: atrValues.slice(-50),
      vwap: vwapValues.slice(-50)
    },
    signals,
    recommendation,
    fetchedAt: new Date().toISOString()
  }
  cacheSet(cacheKey, result, 120_000)
  return result
}

/* ──────────────────────────────────────────────────────────────────────
 * 4. News (via TradingView / web search)
 * ────────────────────────────────────────────────────────────────────── */
export async function getTradingViewNews(symbol = 'BTCUSDT', limit = 15) {
  const cacheKey = `news:${symbol}`
  const cached = cacheGet(cacheKey, 300_000) // 5 min cache
  if (cached) return cached

  // Try TradingView's search for news
  const url = `https://symbol-search.tradingview.com/symbol_search/v3/?text=${encodeURIComponent(symbol)}&type=&exchange=&lang=en`
  let symbolInfo = null
  try {
    const sr = await safeFetch(url, { timeout: 8000 })
    const sj = await sr.json()
    symbolInfo = sj?.symbols?.[0]
  } catch { /* ignore */ }

  // Use Binance news feed as fallback or web search for news
  const newsUrl = `https://min-api.cryptocompare.com/data/v2/news/?lang=EN&categories=${encodeURIComponent(symbol.replace(/USDT|USD$/i, '').replace(/-/g, ','))}&limit=${Math.min(limit, 50)}`
  try {
    const nr = await safeFetch(newsUrl, { timeout: 10000 })
    const nj = await nr.json()
    const items = (nj.Data || []).slice(0, limit).map(n => ({
      title: n.title,
      url: n.url,
      source: n.source,
      publishedAt: n.published_on ? new Date(n.published_on * 1000).toISOString() : null,
      image: n.imageurl,
      body: n.body?.slice(0, 300) || ''
    }))
    const result = { ok: true, symbol, count: items.length, items, source: 'cryptocompare', symbolInfo, fetchedAt: new Date().toISOString() }
    cacheSet(cacheKey, result, 300_000)
    return result
  } catch {
    // Fallback: empty result
    const result = { ok: true, symbol, count: 0, items: [], source: 'none', symbolInfo, fetchedAt: new Date().toISOString() }
    cacheSet(cacheKey, result, 60_000)
    return result
  }
}

/* ──────────────────────────────────────────────────────────────────────
 * 5. Popular tickers (for screener defaults)
 * ────────────────────────────────────────────────────────────────────── */
export async function getTradingViewPopular(market = 'crypto') {
  const cacheKey = `popular:${market}`
  const cached = cacheGet(cacheKey, 300_000)
  if (cached) return cached

  try {
    const result = await getTradingViewScreener(market, {
      columns: ['name', 'description', 'close', 'change', 'volume', 'market_cap_basic', 'Perf.1M'],
      limit: 30,
      sortBy: 'market_cap_basic',
      sortOrder: 'desc'
    })
    cacheSet(cacheKey, result, 300_000)
    return result
  } catch (e) {
    return { ok: false, error: e.message }
  }
}
