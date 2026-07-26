/**
 * Indonesian Economic News Aggregator
 * Fetches from Google News RSS, DDG, targeting reputable Indonesian economic sources.
 * Sources: Kontan, Bisnis.com, CNBC Indonesia, Tempo, Detik, Katadata, IDN Financials
 */
import { validateFetchUrl, webCacheStats } from './web-search.js'

const INDONESIAN_NEWS_SOURCES = [
  'kontan.co.id', 'bisnis.com', 'cnbcindonesia.com', 'tempo.co',
  'detik.com/finance', 'katadata.co.id', 'idnfinancials.com',
  'kompas.com/bisnis', 'antaranews.com', 'stockbit.com'
]

const NEWS_QUERIES = [
  'ekonomi Indonesia pasar saham IHSG',
  'BI suku bunga kebijakan moneter',
  'Rupiah USD forex exchange rate',
  'saham IDX idx.co.id',
  'komoditas minyak emas nickel Indonesia',
  'investasi fintech kripto Indonesia'
]

/* ── cache ──────────────────────────────────────────────────────────── */
const CACHE = new Map()
function cacheGet(key, ttlMs = 300_000) {
  const e = CACHE.get(key)
  if (!e || Date.now() > e.exp) { CACHE.delete(key); return null }
  return e.val
}
function cacheSet(key, val, ttlMs = 300_000) {
  CACHE.set(key, { val, exp: Date.now() + ttlMs })
  if (CACHE.size > 100) { const f = CACHE.keys().next().value; CACHE.delete(f) }
}

/* ── helpers ────────────────────────────────────────────────────────── */
function clean(s = '') { return String(s).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim() }
function host(url) { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' } }

function isIndonesianSource(url = '') {
  const h = host(url)
  return INDONESIAN_NEWS_SOURCES.some(s => h === s || h.endsWith('.' + s) || h === 'www.' + s)
}

// ponytail: SearXNG removed. DDG + Google News RSS are primary sources.
async function fetchSearxngNews(){ return [] }

/* ── Google News RSS fallback ───────────────────────────────────────── */
async function fetchGoogleNewsRSS(query, { limit = 10 } = {}) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=id&gl=ID&ceid=ID:id`
  const r = await fetch(url, {
    headers: { 'user-agent': 'MarketOrcaNews/1.0' },
    signal: AbortSignal.timeout(6000)
  })
  if (!r.ok) throw new Error(`gnews_${r.status}`)
  const xml = await r.text()
  const items = [...xml.matchAll(/<item>[\s\S]*?<\/item>/g)].slice(0, limit)
  return items.map(item => {
    const raw = item[0]
    const title = (raw.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '').trim()
    const link = raw.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || ''
    const pubDate = raw.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] || ''
    const source = raw.match(/<source[^>]*>([\s\S]*?)<\/source>/i)?.[1]?.trim() || ''
    return { title: clean(title), url: clean(link), snippet: '', source: source || host(clean(link)), engine: 'google-news', publishedAt: pubDate, thumbnail: '', isIndonesianSource: isIndonesianSource(clean(link)) }
  }).filter(x => x.title && x.url && /^https?:/.test(x.url))
}

/* ── Aggregate news ─────────────────────────────────────────────────── */
export async function fetchIndonesianNews({ query, limit = 20, timeRange = 'week', language = 'id' } = {}) {
  const cacheKey = `id_news:${query || 'trending'}:${limit}:${timeRange}:${language}`
  const cached = cacheGet(cacheKey)
  if (cached) return { ...cached, cached: true }

  const q = query || 'ekonomi Indonesia pasar saham'
  const all = []
  const errors = []

  // 1) DDG news (primary — was SearXNG fallback #3)

  // 2) Google News RSS (fallback)
  if (all.length < limit) {
    try {
      all.push(...await fetchGoogleNewsRSS(q, { limit: limit - all.length + 5 }))
    } catch (e) { errors.push({ engine: 'google-news', error: String(e.message || e) }) }
  }

  // 3) DDG news fallback
  if (all.length < 3) {
    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q + ' berita terbaru')}&iar=news`
      const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 MarketOrcaNews/1.0' }, signal: AbortSignal.timeout(8000) })
      if (r.ok) {
        const html = await r.text()
        const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g
        let m
        while ((m = re.exec(html)) && all.length < limit + 5) {
          let resultUrl = m[1]
          try { const x = new URL(resultUrl); const uddg = x.searchParams.get('uddg'); if (uddg) resultUrl = decodeURIComponent(uddg) } catch {}
          if (!/^https?:/.test(resultUrl)) continue
          all.push({ title: clean(m[2]), url: resultUrl, snippet: clean(m[3]), source: host(resultUrl), engine: 'duckduckgo', publishedAt: '', thumbnail: '', isIndonesianSource: isIndonesianSource(resultUrl) })
        }
      }
    } catch (e) { errors.push({ engine: 'duckduckgo', error: String(e.message || e) }) }
  }

  // Dedupe
  const seen = new Set()
  const results = all.filter(r => { const k = r.url.replace(/[?#].*/, ''); if (seen.has(k)) return false; seen.add(k); return true })

  // Sort: Indonesian sources first, then by date
  results.sort((a, b) => {
    if (a.isIndonesianSource !== b.isIndonesianSource) return b.isIndonesianSource ? 1 : -1
    const ta = a.publishedAt ? new Date(a.publishedAt).getTime() : 0
    const tb = b.publishedAt ? new Date(b.publishedAt).getTime() : 0
    return tb - ta
  })

  const out = {
    ok: true,
    query: q,
    count: results.length,
    results: results.slice(0, limit),
    sources: INDONESIAN_NEWS_SOURCES,
    errors,
    fetchedAt: new Date().toISOString()
  }
  cacheSet(cacheKey, out)
  return out
}

/* ── Aggregated trending news (for homepage/overview) ───────────────── */
export async function fetchTrendingNews({ limit = 15, timeRange = 'day' } = {}) {
  const cacheKey = `id_trending:${limit}:${timeRange}`
  const cached = cacheGet(cacheKey, 180_000)
  if (cached) return { ...cached, cached: true }

  const all = []
  const errors = []
  // Run a few focused queries in parallel
  const queries = NEWS_QUERIES.slice(0, 3)
  await Promise.allSettled(queries.map(async q => {
    try {
      // SearXNG removed; use DDG/Google News via fetchIndonesianNews instead
      const items = await fetchIndonesianNews({ query: q, limit: 8, timeRange })
      all.push(...items)
    } catch (e) { errors.push({ query: q, error: String(e.message || e) }) }
  }))

  const seen = new Set()
  const results = all.filter(r => { const k = r.url.replace(/[?#].*/, ''); if (seen.has(k)) return false; seen.add(k); return true })
  results.sort((a, b) => {
    if (a.isIndonesianSource !== b.isIndonesianSource) return b.isIndonesianSource ? 1 : -1
    const ta = a.publishedAt ? new Date(a.publishedAt).getTime() : 0
    const tb = b.publishedAt ? new Date(b.publishedAt).getTime() : 0
    return tb - ta
  })

  const out = {
    ok: true,
    count: results.length,
    results: results.slice(0, limit),
    sources: INDONESIAN_NEWS_SOURCES,
    errors,
    fetchedAt: new Date().toISOString()
  }
  cacheSet(cacheKey, out, 180_000)
  return out
}

export { INDONESIAN_NEWS_SOURCES }
