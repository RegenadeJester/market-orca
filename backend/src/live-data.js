const quoteUrl = (symbol, range = '5d', interval = '30m') => `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`
const yahooQuoteUrl = (symbol) => `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`
const binanceUrl = (symbol) => `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=30m&limit=36`
const binanceTickerUrl = (symbol) => `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`
const stooqUrl = (symbol) => `https://stooq.com/q/l/?s=${encodeURIComponent(symbol)}&f=sd2t2ohlcv&h&e=csv`
const searchNewsUrl = (query) => `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`
const yahooNewsUrl = (query) => `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(query)}&region=US&lang=en-US`
// Indonesian financial news now fetched via SearXNG (see fetchIndoNewsSearxng)
import { enrichNewsItem } from './news-enrich.js'
import { normalizeAsset } from './normalizer.js'

import { validateFetchUrl } from './web-search.js'

const liveCache = new Map()
const requestLocks = new Map()

/** Stagger configuration — tune via env for laptop server constraints */
const STAGGER_DELAY_MS = Number(process.env.LIVE_DATA_STAGGER_MS || 150) // 150ms between requests
const MAX_CONCURRENCY = Number(process.env.LIVE_DATA_CONCURRENCY || 3) // max 3 parallel fetches

function decodeHtml(value = '') { return value.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ') }
function stripTags(value = '') { return decodeHtml(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() }
function cleanTitle(value = '') { return stripTags(value).replace(/\s+[-–—]\s+[^-–—]+$/, '').replace(/\s{2,}/g, ' ').trim() }

async function fetchWithTimeout(url, mode = 'json', timeoutMs = 12000, {internal=false}={}) {
  try { const v=await validateFetchUrl(url,{internal}); if(!v.ok) throw new Error('ssrf:'+v.error) } catch(e) { if(e.message?.startsWith('ssrf')) throw e }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'market-orca/1.0' }, signal: controller.signal })
    if (!res.ok) throw new Error(`Fetch failed ${res.status}`)
    return mode === 'json' ? res.json() : res.text()
  } finally {
    clearTimeout(timer)
  }
}

async function fetchJson(url, timeoutMs, opts) { return fetchWithTimeout(url, 'json', timeoutMs, opts) }
async function fetchText(url, timeoutMs, opts) { return fetchWithTimeout(url, 'text', timeoutMs, opts) }
function extractTag(block, tag) { const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i')); return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '' }
function extractLink(link = '') { const m = link.match(/url=([^&]+)/); return m ? decodeURIComponent(m[1]) : link }
function inferSentiment(text = '') {
  const value = text.toLowerCase()
  if (/(jump|surge|rise|gain|bull|strong|record|optimism|beat|rally|buy|breakout|naik|menguat|melonjak|laba|cuan|akumulasi|beli|ekspansi|positif)/.test(value)) return 'positive'
  if (/(drop|fall|decline|risk|fear|selloff|weak|cut|loss|bear|outflow|slump|turun|melemah|anjlok|rugi|tekanan|jual|koreksi|phk|gagal|negatif)/.test(value)) return 'negative'
  return 'neutral'
}
function inferThumbnail(item) { const source = `${item.title} ${item.summary}`.toLowerCase(); if (source.includes('bitcoin') || source.includes('btc')) return '₿'; if (source.includes('ethereum') || source.includes('eth')) return '◆'; if (source.includes('nvidia') || source.includes('nvda') || source.includes('chip')) return '⚙️'; if (source.includes('oil') || source.includes('brent') || source.includes('wti')) return '🛢️'; if (source.includes('gold') || source.includes('xau')) return '✦'; if (source.includes('bank') || source.includes('bbca') || source.includes('bbri')) return '🏦'; return '📰' }
function parseDateValue(value = '') { const ts = Date.parse(value || ''); return Number.isFinite(ts) ? ts : 0 }
function newsAgeLabel(value = '') { const ts = parseDateValue(value); if (!ts) return 'tanggal tidak jelas'; const diffHours = Math.max(0, Math.floor((Date.now() - ts) / 3600000)); if (diffHours < 1) return 'fresh <1 jam'; if (diffHours < 24) return `fresh ${diffHours} jam lalu`; const days = Math.floor(diffHours / 24); return `${days} hari lalu` }
function normalizeCandles(points = []) { return points.slice(-36).map((p, idx) => ({ label: `P${idx + 1}`, open: p.open ?? p.close, high: p.high ?? p.close, low: p.low ?? p.close, close: p.close, value: p.close, volume: p.volume || 0, ts: p.ts || Date.now() })) }

function parseYahooChart(symbol, payload) {
  const result = payload?.chart?.result?.[0]
  if (!result) throw new Error(`No quote result for ${symbol}`)
  const meta = result.meta || {}
  const timestamps = result.timestamp || []
  const quote = result.indicators?.quote?.[0] || {}
  const points = (quote.close || []).map((close, idx) => ({ open: quote.open?.[idx], high: quote.high?.[idx], low: quote.low?.[idx], close, volume: quote.volume?.[idx] || 0, ts: timestamps[idx] || 0 })).filter((p) => typeof p.close === 'number')
  const price = meta.regularMarketPrice ?? points.at(-1)?.close ?? meta.previousClose
  const firstOpen = points.find((p) => typeof p.open === 'number')?.open
  const firstClose = points[0]?.close
  const rawPrev = meta.chartPreviousClose ?? meta.previousClose ?? firstOpen ?? firstClose
  let prev = rawPrev
  if (price && prev) {
    const ratio = Math.abs((price - prev) / prev) * 100
    if (!Number.isFinite(ratio) || ratio > 20) prev = firstOpen ?? firstClose ?? price
  }
  const changePercent = price && prev ? ((price - prev) / prev) * 100 : 0
  return { symbol, price, change_percent: Number(changePercent.toFixed(2)), currency: meta.currency || null, marketState: meta.marketState || null, candles: normalizeCandles(points), provider: 'yahoo-chart' }
}

function parseYahooQuote(symbol, payload) {
  const row = payload?.quoteResponse?.result?.[0]
  if (!row) throw new Error(`No yahoo quote row for ${symbol}`)
  const price = row.regularMarketPrice ?? row.postMarketPrice ?? row.bid ?? row.ask
  const prev = row.regularMarketPreviousClose ?? row.regularMarketOpen ?? price
  const changePercent = price && prev ? ((price - prev) / prev) * 100 : (row.regularMarketChangePercent || 0)
  const base = Number(price || 0)
  const points = Array.from({ length: 24 }, (_, i) => ({ close: base, open: base, high: base, low: base, volume: 0, ts: Date.now() - (24 - i) * 1800000 }))
  return { symbol, price, change_percent: Number(changePercent.toFixed(2)), currency: row.currency || null, marketState: row.marketState || null, candles: normalizeCandles(points), provider: 'yahoo-quote' }
}

async function parseBinanceQuote(symbol) {
  const map = { 'BTC-USD': 'BTCUSDT', 'ETH-USD': 'ETHUSDT', 'ETH-USDT': 'ETHUSDT', 'SOL-USD': 'SOLUSDT', 'DOGE-USD': 'DOGEUSDT', 'SHIB-USD': 'SHIBUSDT', 'PEPE-USD': 'PEPEUSDT' }
  const pair = map[symbol]
  if (!pair) throw new Error('No binance pair')
  const [rows, ticker] = await Promise.all([fetchJson(binanceUrl(pair), 9000), fetchJson(binanceTickerUrl(pair), 9000).catch(() => null)])
  const points = rows.map((r) => ({ open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]), volume: Number(r[5]), ts: Number(r[0]) }))
  const price = Number(ticker?.lastPrice) || points.at(-1)?.close
  const changePercent = Number(ticker?.priceChangePercent) || 0
  return { symbol, price, change_percent: Number(changePercent.toFixed(2)), currency: 'USD', marketState: 'LIVE', candles: normalizeCandles(points), provider: 'binance' }
}

async function parseStooqQuote(symbol) {
  const map = { AAPL: 'aapl.us', NVDA: 'nvda.us', AMD: 'amd.us', TSLA: 'tsla.us' }
  const code = map[symbol]
  if (!code) throw new Error('No stooq symbol')
  const csv = await fetchText(stooqUrl(code), 9000)
  const row = csv.trim().split(/\r?\n/)[1]?.split(',')
  if (!row || row.length < 8) throw new Error('Invalid stooq payload')
  const open = Number(row[4]), high = Number(row[5]), low = Number(row[6]), close = Number(row[7]), volume = Number(row[8] || 0)
  return { symbol, price: close, change_percent: 0, currency: 'USD', marketState: 'LIVE', candles: normalizeCandles([{ open, high, low, close, volume, ts: Date.now() }]), provider: 'stooq' }
}

function parseNews(xml, provider = 'google') {
  return xml.split('<item>').slice(1, 10).map((item) => {
    const title = cleanTitle(extractTag(item, 'title'))
    const summary = stripTags(extractTag(item, 'description')).slice(0, 280)
    const link = extractLink(extractTag(item, 'link'))
    const source = cleanTitle(extractTag(item, 'source')) || provider
    const created_at = extractTag(item, 'pubDate')
    return { title, summary, created_at, freshness: newsAgeLabel(created_at), freshness_ts: parseDateValue(created_at), sentiment: inferSentiment(`${title} ${summary}`), link, source, thumbnail: inferThumbnail({ title, summary }), image: '' }
  }).filter((item) => item.title)
}

function buildQuery(asset) {
  const base = `"${asset.symbol}" OR "${asset.name}"`
  const exclude = '-"price prediction" -forecast -"where to buy"'
  if (asset.market === 'CRYPTO') return `${base} crypto OR bitcoin OR ETF OR inflow OR liquidation OR Fed ${exclude}`
  if (asset.market === 'COMMODITY') return `${base} commodity OR gold OR oil OR futures OR demand ${exclude}`
  if (asset.market === 'FOREX') return `${base} forex OR rate OR inflation OR central bank ${exclude}`
  if (asset.market === 'IDX') return `${base} saham OR IDX OR IHSG OR LQ45 OR laba OR emiten ${exclude}`
  return `${base} earnings OR guidance OR analyst OR stock OR market ${exclude}`
}
function newsKey(title='') { return title.toLowerCase().replace(/\s+[-–—]\s+[^-–—]+$/, '').replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim().slice(0,80) }
function uniqueNews(items) { const seen = new Set(); return items.filter((item) => { const key = newsKey(item.title); if (seen.has(key)) return false; seen.add(key); return true }) }
function newsRelevance(item, asset) {
  const text = `${item.title} ${item.summary} ${item.source}`.toLowerCase()
  let score = 0
  for (const p of [asset.symbol, asset.name]) if (p && text.includes(String(p).toLowerCase())) score += 5
  if (asset.market === 'IDX' && /(saham|ihsg|idx|emiten|laba|bursa)/i.test(text)) score += 2
  if (asset.market === 'CRYPTO' && /(crypto|bitcoin|ethereum|etf|fed|liquidation|inflow)/i.test(text)) score += 2
  if (asset.market === 'US' && /(earnings|guidance|analyst|nasdaq|stock|shares)/i.test(text)) score += 2
  score += Math.max(0, 3 - ((Date.now() - (item.freshness_ts || 0)) / 86400000))
  return score
}


const SEARXNG_BASE = process.env.SEARXNG_URL || 'http://localhost:18080'

const searxngUrl = (query) => `http://localhost:18080/search?q=${encodeURIComponent(query)}&format=json`

async function parseSearxngGoldQuote(symbol) {
  const data = await fetchJson(searxngUrl(`${symbol} gold spot price USD today per ounce`), 12000, {internal:true})
  const results = data?.results || []
  for (const r of results.slice(0, 10)) {
    const text = `${r.title || ''} ${r.content || ''}`
    // Match prices like $4,219.10 or 4208.69 or $3,032.40
    const allPrices = [...text.matchAll(/\$?([\d,]+\.\d{2})/g)]
      .map(m => Number(m[1].replace(/,/g, '')))
      .filter(p => p > 1000 && p < 100000)
    if (allPrices.length) {
      const price = allPrices[0]
      return { symbol, price, change_percent: 0, currency: 'USD', marketState: 'LIVE', candles: normalizeCandles(Array.from({length:24}, (_,i) => ({close:price,open:price,high:price,low:price,volume:0,ts:Date.now()-(24-i)*1800000}))), provider: 'searxng-gold' }
    }
  }
  throw new Error('SearXNG gold parse failed')
}

async function fetchIndoNewsSearxng(query, limit = 5) {
  try {
    const url = `${SEARXNG_BASE}/search?q=${encodeURIComponent(query + ' berita saham IDX')}&format=json&categories=news&time_range=week&language=id`
    const data = await fetchJson(url, 10000, { internal: true })
    return (data.results || []).slice(0, limit).map(r => ({
      title: cleanTitle(r.title || ''),
      summary: (r.content || '').slice(0, 280),
      sentiment: inferSentiment(`${r.title} ${r.content}`),
      source: 'searxng',
      link: r.url || '',
      created_at: r.publishedDate || new Date().toISOString(),
      freshness: newsAgeLabel(r.publishedDate || ''),
      freshness_ts: parseDateValue(r.publishedDate || ''),
      thumbnail: inferThumbnail({ title: r.title, summary: r.content }),
      image: ''
    })).filter(item => item.title)
  } catch { return [] }
}

// Normalise Yahoo symbols (BRK.B → BRK-B)
function yahooSymbol(s) { return s.replace(/\./g, '-') }

async function tryProviders(asset) {
  const attempts = []
  if (asset.market === 'CRYPTO') {
    try { return await parseBinanceQuote(asset.symbol) } catch (err) { attempts.push(`binance:${err}`) }
  }
  try { return parseYahooChart(asset.symbol, await fetchJson(quoteUrl(yahooSymbol(asset.symbol)), 12000)) } catch (err) { attempts.push(`yahoo-chart:${err}`) }
  try { return parseYahooQuote(asset.symbol, await fetchJson(yahooQuoteUrl(yahooSymbol(asset.symbol)), 9000)) } catch (err) { attempts.push(`yahoo-quote:${err}`) }
  if (asset.market === 'US') {
    try { return await parseStooqQuote(asset.symbol) } catch (err) { attempts.push(`stooq:${err}`) }
  }
  if (asset.symbol === 'XAUUSD' || asset.market === 'COMMODITY' || (asset.symbol === 'XAUUSD' && asset.market === 'FOREX')) {
    try { return await parseSearxngGoldQuote(asset.symbol) } catch (err) { attempts.push(`searxng-gold:${err}`) }
  }
  throw new Error(`All providers failed for ${asset.symbol} :: ${attempts.join(' | ')}`)
}

function cacheTtlFor(asset) {
  if (asset.market === 'CRYPTO') return 8000
  if (asset.market === 'IDX') return 15000
  if (asset.category === 'index') return 20000
  return 12000
}

async function getCachedLiveAsset(asset) {
  const key = asset.slug || asset.symbol
  const ttl = cacheTtlFor(asset)
  const cached = liveCache.get(key)
  if (cached && Date.now() - cached.at < ttl) return cached.value
  if (requestLocks.has(key)) return requestLocks.get(key)

  const promise = (async () => {
    try {
      const live = await tryProviders(asset)
      const query = buildQuery(asset)
      const newsPromises = [
        fetchText(searchNewsUrl(query), 9000),
        fetchText(yahooNewsUrl(asset.symbol), 9000),
      ]
      // Fetch from SearXNG for IDX assets
      if (asset.market === 'IDX') {
        newsPromises.push(
          fetchIndoNewsSearxng(asset.name || asset.symbol, 6).then(items => ({ searxng: items })).catch(() => null)
        )
      }
      const settledNews = await Promise.allSettled(newsPromises)
      const rawNews = []
      for (const result of settledNews) {
        if (result.status === 'fulfilled') {
          const val = result.value
          if (typeof val === 'string') {
            // Plain XML from Google/Yahoo
            rawNews.push(...parseNews(val, val.includes('kontan') || val.includes('indo') ? 'indo' : 'google'))
          } else if (val?.xml) {
            // Indonesian source
            rawNews.push(...parseNews(val.xml, val.source))
          } else if (val?.searxng) {
            rawNews.push(...val.searxng)
          }
        }
      }
      // Filter stale news (> 48h old) and dedupe
      const now = Date.now()
      const filteredNews = uniqueNews(rawNews)
        .filter(n => !n.freshness_ts || (now - n.freshness_ts) < 172800000) // 48h max
        .map(n => ({ ...n, relevance: newsRelevance(n, asset) }))
        .sort((a,b) => (b.relevance || 0) - (a.relevance || 0) || b.freshness_ts - a.freshness_ts)
        .slice(0, 8)
      // Enrich only top 1 to protect RAM/network on laptop server.
      const news = await Promise.all(filteredNews.map((item, idx) => idx < 1 ? enrichNewsItem(item) : item))
      const normalizedLive = normalizeAsset(live)
      const value = { asset: { ...asset, price: normalizedLive.price, changePercent: normalizedLive.changePercent, thesis: news[0]?.summary || asset.thesis, currency: normalizedLive.currency, marketState: normalizedLive.marketState, provider: normalizedLive.provider }, candles: live.candles, news }
      liveCache.set(key, { at: Date.now(), value })
      return value
    } catch (error) {
      if (cached) return cached.value
      throw error
    } finally {
      requestLocks.delete(key)
    }
  })()

  requestLocks.set(key, promise)
  return promise
}

export async function getLiveAsset(asset) {
  return getCachedLiveAsset(asset)
}

export async function getLiveAssets(assets) {
  // ── Staggered batch: cap concurrency to prevent burst API calls ────
  // On laptop server, 20+ simultaneous Yahoo/Binance calls → rate limits + TIME_WAIT.
  // Split into small batches with delay between batches.
  const settled = []
  const t0 = Date.now()
  let cacheHits = 0

  for (let i = 0; i < assets.length; i += MAX_CONCURRENCY) {
    const batch = assets.slice(i, i + MAX_CONCURRENCY)
    const results = await Promise.allSettled(batch.map((a) => getCachedLiveAsset(a)))
    settled.push(...results)

    // Count cache hits (instant return from liveCache)
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value?._cached) cacheHits++
    }

    // Stagger delay between batches (skip after last batch)
    if (i + MAX_CONCURRENCY < assets.length && STAGGER_DELAY_MS > 0) {
      await new Promise(r => setTimeout(r, STAGGER_DELAY_MS))
    }
  }

  const elapsed = Date.now() - t0
  console.log(`[live-data] getLiveAssets: ${assets.length} assets in ${elapsed}ms (concurrency=${MAX_CONCURRENCY}, stagger=${STAGGER_DELAY_MS}ms)`)
  return settled.map((result, index) => result.status === 'fulfilled' ? result.value : { asset: { ...assets[index], provider: 'fallback-error' }, candles: [], news: [], error: String(result.reason) })
}
