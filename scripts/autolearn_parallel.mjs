#!/usr/bin/env node
/**
 * Market Orca Enhanced Autolearn v3 — Parallel Edition
 * Same as original but with parallel fetch+ingest per query batch
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TOPICS_FILE = path.join(__dirname, '..', 'collections', 'autolearn-topics.json')
const LOG_FILE = path.join(__dirname, '..', 'collections', 'autolearn.log')
const LEARNED_FILE = path.join(__dirname, '..', 'collections', 'autolearn-learned.json')
const METRICS_FILE = path.join(__dirname, '..', 'collections', 'autolearn-metrics.json')
const MCP_BASE = process.env.MCP_BASE || 'http://127.0.0.1:4567'

// AnySearch CLI wrapper
const ANYSEARCH_CLI = 'python3 /home/dicky/.hermes/skills/anysearch-skill/scripts/anysearch_cli.py'

async function anysearchSearch(query, limit = 5) {
  try {
    const { execSync } = await import('node:child_process')
    const cmd = `${ANYSEARCH_CLI} search "${query.replace(/"/g, '\\\\"')}" --max_results ${limit}`
    const out = execSync(cmd, { timeout: 25000, encoding: 'utf8' })
    const results = []
    const blocks = out.split(/### \d+\./).slice(1)
    for (const block of blocks) {
      const titleMatch = block.match(/^(.+?)$/m)
      const urlMatch = block.match(/\*\*URL\*\*:\s*(https?:\/\/\S+)/)
      const snippetMatch = block.match(/^- (.+?)$/m)
      if (titleMatch && urlMatch) {
        results.push({
          title: titleMatch[1].trim(),
          url: urlMatch[1],
          content: snippetMatch?.[1] || '',
          publishedDate: ''
        })
      }
    }
    return results.slice(0, limit)
  } catch (e) { log("  [autolearn-parallel] anysearchSearch failed: " + e.message); return [] }
}
const args = process.argv.slice(2)
const filterTopic = args.includes('--topic') ? args[args.indexOf('--topic') + 1] : null
const dryRun = args.includes('--dry-run')
const deepSearch = args.includes('--deep')
const priorityOnly = args.includes('--priority')
const metricsOnly = args.includes('--metrics')

// ─── Token & Auth ─────────────────────────────────────────────
let MCP_TOKEN = ''
try {
  if (process.env.MCP_AUTH_TOKEN) MCP_TOKEN = process.env.MCP_AUTH_TOKEN
  if (!MCP_TOKEN) {
    const envPaths = [
      path.join(__dirname, '..', 'backend', '.env'),
      path.join(__dirname, '..', '.env')
    ]
    for (const envFile of envPaths) {
      if (fs.existsSync(envFile)) {
        const match = fs.readFileSync(envFile, 'utf8').match(/^MCP_AUTH_TOKEN=(.+)$/m)
        if (match) { MCP_TOKEN = match[1].trim(); break }
      }
    }
  }
} catch (e) { log("  [autolearn-parallel] Token load failed: " + e.message) }

let learnedStore = {}
if (!dryRun && fs.existsSync(LEARNED_FILE)) {
  try { learnedStore = JSON.parse(fs.readFileSync(LEARNED_FILE, 'utf8')) } catch (e) { log("  [autolearn-parallel] Load learned failed: " + e.message) }
}

let metrics = { runs: [], topicStats: {} }
if (fs.existsSync(METRICS_FILE)) {
  try { metrics = JSON.parse(fs.readFileSync(METRICS_FILE, 'utf8')) } catch (e) { log("  [autolearn-parallel] Load metrics failed: " + e.message) }
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  try { fs.appendFileSync(LOG_FILE, line + '\n') } catch (e) { console.warn("[autolearn-parallel] log append failed: " + e.message) }
}

// ─── Search Engines ────────────────────────────────────────────


async function restSearch(query, limit = 5) {
  try {
    const res = await fetch(`${MCP_BASE}/api/search/web`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, engines: ['bing', 'duckduckgo'], limit }),
      signal: AbortSignal.timeout(25000)
    })
    if (!res.ok) throw new Error(`REST search ${res.status}`)
    const data = await res.json()
    return (data.results || []).map(r => ({
      title: r.title, url: r.url, snippet: r.snippet, source: r.source,
      domain: r.domain, trust: r.trust || 50, quality: r.quality || 0
    })).slice(0, limit)
  } catch (e) { log("  [autolearn-parallel] restSearch failed: " + e.message); return [] }
}

async function mcpPost(tool, input, timeoutMs = 60000) {
  const headers = { 'Content-Type': 'application/json' }
  if (MCP_TOKEN) headers['Authorization'] = `Bearer ${MCP_TOKEN}`
  const res = await fetch(`${MCP_BASE}/mcp/tool/${tool}`, {
    method: 'POST', headers, body: JSON.stringify(input),
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (!res.ok) throw new Error(`MCP ${tool} ${res.status}`)
  return res.json()
}

// ─── Content Processing ────────────────────────────────────────
async function fetchPageContent(url) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 8000)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (MarketOrcaBot/3.0; +https://market-orca) AppleWebKit/537.36' }
    })
    if (!res.ok) return null
    const html = await res.text()
    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || url).trim()
    const ogImage = (html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)?.[1] ||
                     html.match(/<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i)?.[1] || '').trim()
    const description = (html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)?.[1] ||
                         html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i)?.[1] || '').trim()
    const publishedDate = (html.match(/<meta[^>]*property=["']article:published_time["'][^>]*content=["']([^"']+)["']/i)?.[1] ||
                           html.match(/<time[^>]*datetime=["']([^"']+)["']/i)?.[1] || '').trim()
    const clean = html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
      .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ').trim()
    const source = new URL(url).hostname.replace(/^www\./, '')
    return { title, content: clean.slice(0, 20000), url, source, image: ogImage, description, publishedDate }
  } catch (e) { log("  [autolearn-parallel] fetchPageContent failed: " + e.message); return null }
  finally { clearTimeout(t) }
}

function generateSummary(content, maxSentences = 4) {
  const sentences = content.split(/(?<=[.!?])\s+/).filter(s => s.length > 30)
  return sentences.slice(0, maxSentences).join(' ')
}

function estimateCredibility(source, trust = 50) {
  const highTrust = ['idx.co.id', 'bi.go.id', 'ojk.go.id', 'kompas.id', 'detik.com', 'cnnindonesia.com',
                     'cnbcindonesia.com', 'investing.com', 'bloomberg.com', 'reuters.com', 'wsj.com', 'ft.com',
                     'reuters.com', 'cnbc.com', 'finance.yahoo.com', 'coindesk.com', 'cointelegraph.com']
  const medTrust = ['katadata.co.id', 'kontan.co.id', 'bisnis.com', 'liputan6.com', 'tribunnews.com',
                    'bbc.com', 'theguardian.com', 'ft.com', 'wsj.com', 'nytimes.com']
  if (highTrust.some(h => source.includes(h))) return Math.min(95, trust + 25)
  if (medTrust.some(m => source.includes(m))) return Math.min(85, trust + 15)
  return trust
}

function calculateQualityScore(title, content, source, trust) {
  let score = trust || 50
  if (content.length > 5000) score += 10
  if (content.length > 10000) score += 5
  if (/harga|kurs|IHSG|saham|crypto|bitcoin|USD|IDR/i.test(title)) score += 5
  if (/berita|analisis|prediksi|outlook|forecast/i.test(title)) score += 5
  return Math.min(100, score)
}

// ─── Smart Query Generation ────────────────────────────────────
const TRUSTED_DOMAINS = [
  'investing.com', 'idx.co.id', 'idxchannel.com', 'stockbit.com',
  'bi.go.id', 'ojk.go.id', 'kemenkeu.go.id', 'bps.go.id',
  'cnbcindonesia.com', 'kontan.co.id', 'katadata.co.id', 'bisnis.com',
  'kompas.com', 'detik.com', 'tempo.co', 'tirto.id', 'liputan6.com',
  'cnnindonesia.com', 'reuters.com', 'bloomberg.com', 'cnbc.com',
  'ft.com', 'wsj.com', 'coindesk.com', 'cointelegraph.com',
  'techinasia.com', 'theinformation.com', 'sahamidx.com',
  'tradingeconomics.com', 'bbc.com', 'theguardian.com'
]

function isTrustedDomain(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    return TRUSTED_DOMAINS.some(d => host.endsWith(d))
  } catch (e) { log("  [autolearn-parallel] isBlacklisted failed: " + e.message); return false }
}

function isBlacklisted(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    return ['cambridge.org', 'merriam-webster.com', 'wiktionary.org', 'collinsdictionary.com',
      'dictionary.com', 'thefreedictionary.com', 'wordreference.com',
      'github.com', 'gitlab.com', 'bitbucket.org',
      'stackoverflow.com', 'stackexchange.com',
      'reddit.com', 'quora.com', 'yahoo.com',
      'facebook.com', 'twitter.com', 'x.com', 'instagram.com', 'linkedin.com',
      'youtube.com', 'vimeo.com', 'dailymotion.com',
      'pinterest.com', 'tumblr.com'].some(d => host.includes(d))
  } catch (e) { log("  [autolearn-parallel] saveMetrics failed: " + e.message); return false }
}

// ─── Concurrency helper ────────────────────────────────────────
async function mapConcurrent(items, fn, concurrency = 3) {
  const results = []
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency)
    const chunkResults = await Promise.allSettled(chunk.map(fn))
    results.push(...chunkResults)
  }
  return results
}

const QUERIES = {
  'idx-market': ['IHSG indeks saham gabungan terbaru', 'saham IDX pergerakan hari ini', 'foreign flow net buy saham Indonesia', 'IHSG closing indeks harga saham gabungan'],
  'usd-idr': ['kurs rupiah USD IDR hari ini Bank Indonesia', 'USD IDR forecast nilai tukar rupiah', 'dampak Fed rate terhadap rupiah Indonesia', 'cadangan devisa Indonesia Bank Indonesia'],
  'crypto': ['harga bitcoin BTC hari ini crypto', 'ethereum ETH crypto market cap terbaru', 'crypto market Indonesia regulasi Bappebti', 'altcoin crypto investasi Indonesia terbaru'],
  'global-macro': ['Federal Reserve interest rate decision terbaru', 'global inflation rate latest berita ekonomi', 'ECB BOJ central bank monetary policy', 'global trade war economic impact tariff'],
  'ai-tech': ['NVIDIA stock earnings AI revenue terbaru', 'artificial intelligence AI economy impact berita', 'startup teknologi Indonesia funding terbaru', 'semiconductor chip industry global supply'],
  'commodities': ['harga komoditas Indonesia coal nickel CPO terbaru', 'coal batu bara harga export Indonesia', 'CPO palm oil price Indonesia terbaru', 'nickel Indonesia price LME world'],
  'indonesia': ['perekonomian Indonesia GDP pertumbuhan terkini', 'investasi asing FDI Indonesia', 'kebijakan pemerintah Indonesia ekonomi terbaru', 'infrastruktur Indonesia proyek pembangunan'],
  'gold': ['harga emas Antam hari ini terbaru', 'gold price outlook forecast terbaru', 'emas logam mulia investasi Indonesia', 'gold spot price USD per ounce'],
  'us-market': ['S&P 500 Nasdaq Dow Jones index hari ini', 'Wall Street market weekly recap terbaru', 'US stock market technology earnings', 'Federal Reserve rate impact stock market'],
  'china': ['China economy GDP growth terkini', 'China stock market Shanghai Shenzhen', 'yuan CNY China monetary policy PBOC', 'China US trade war tariff terbaru'],
  'oil-energy': ['crude oil WTI Brent price hari ini', 'OPEC production cut decision output', 'oil energy Indonesia Pertamina', 'energy transition Indonesia renewable'],
  'forex': ['EUR USD GBP forex analysis terbaru', 'USD IDR technical analysis forex', 'forex market weekly outlook', 'JPY Yen Japan intervention'],
  'geopolitics': ['geopolitik dunia terkini berita ekonomi', 'Russia Ukraine war economic impact', 'Middle East conflict oil market', 'ASEAN Southeast Asia geopolitics'],
  'indonesia-politics': ['politik Indonesia terkini pemerintah', 'kebijakan ekonomi Indonesia pemerintah', 'APBN Indonesia anggaran terbaru', 'regulasi ekonomi Indonesia undang-undang'],
  'startup': ['startup Indonesia unicorn decacorn', 'venture capital funding Southeast Asia', 'startup IPO Indonesia terbaru', 'tech startup funding round']
}

function getQueries(topicId, originalQueries) {
  if (QUERIES[topicId]) return QUERIES[topicId]
  return originalQueries.length > 0
    ? originalQueries.map(q => q.includes('Indonesia') ? q : `${q} Indonesia`).slice(0, 4)
    : [`${topicId} Indonesia market`]
}

// ─── Topic Processing ──────────────────────────────────────────
async function processTopic(topic) {
  log(`\n📚 Topic: ${topic.name} [${topic.assetTags.join(', ')}]`)
  let totalFetched = 0, totalIngested = 0, totalQuality = 0

  const queries = getQueries(topic.id, topic.queries || [])
  log(`  📋 Queries: ${queries.length}`)

  for (const query of queries) {
    try {
      log(`  🔍 Search: "${query}"`)
      let results = await restSearch(query, topic.maxResults || 5)
      // Fallback: AnySearch
      if (!results.length) {
        results = await anysearchSearch(query, topic.maxResults || 5)
      }
      if (!results.length) { log(`  ⚠️ No results`); continue }
      log(`  📊 Found ${results.length} results`)

      // Filter valid URLs
      const validUrls = results
        .map(r => r.url)
        .filter(url => {
          if (!url || /youtube|facebook|instagram|twitter|x\.com/.test(url)) return false
          if (url.includes('bing.com/ck/a') || url.includes('bing.com/cc/a')) return false
          if (isBlacklisted(url)) return false
          if (!isTrustedDomain(url)) return false
          const h = crypto.createHash('sha256').update(url).digest('hex')
          if (learnedStore[h]) return false
          return true
        })
        .slice(0, 3)

      if (!validUrls.length) { totalFetched += results.length; continue }
      log(`  📥 Fetch ${validUrls.length} URLs...`)

      // Parallel fetch
      const fetchResults = await mapConcurrent(validUrls, url => fetchPageContent(url), 3)
      const toIngest = validUrls
        .map((url, i) => ({ url, page: fetchResults[i].status === 'fulfilled' ? fetchResults[i].value : null }))
        .filter(x => x.page && x.page.content && x.page.content.length >= 300)

      if (!toIngest.length) { totalFetched += results.length; continue }
      log(`  📝 Ingest ${toIngest.length} docs...`)

      // Parallel ingest
      await mapConcurrent(toIngest, async ({ url, page }) => {
        try {
          const urlHash = crypto.createHash('sha256').update(url).digest('hex')
          const summary = generateSummary(page.content)
          const credibility = estimateCredibility(page.source, 50)
          const qs = calculateQualityScore(page.title, page.content, page.source, credibility)
          log(`  📝 "${page.title.slice(0, 45)}" (${page.content.length}c Q:${qs})`)
          if (!dryRun) {
            await mcpPost('rag.ingest', {
              url, title: page.title, source: page.source, content: page.content, summary,
              image: page.image || null, description: page.description || null,
              publishedDate: page.publishedDate || null, credibility, qualityScore: qs,
              assetTags: topic.assetTags,
              metadata: { topicId: topic.id, topicName: topic.name, searchQuery: query, fetchedAt: new Date().toISOString(), pipeline: 'autolearn-v3' }
            }, 30000)
            learnedStore[urlHash] = { url, title: page.title, learnedAt: new Date().toISOString(), collection: topic.id, assetTags: topic.assetTags, summary: summary.slice(0, 200), image: page.image, credibility, qualityScore: qs, hash: urlHash }
          }
          totalIngested++
          totalQuality += qs
        } catch (err) { log(`  ❌ ${url.slice(0, 50)}: ${err.message}`) }
      }, 3)

      totalFetched += results.length
    } catch (err) { log(`  ⚠️ Query "${query}" failed: ${err.message}`) }
  }

  if (!dryRun && totalIngested > 0) {
    fs.writeFileSync(LEARNED_FILE, JSON.stringify(learnedStore, null, 2))
  }

  const avgQuality = totalIngested > 0 ? Math.round(totalQuality / totalIngested) : 0
  const stats = metrics.topicStats[topic.id] || { totalIngested: 0, totalFetched: 0, avgQuality: 0, runs: 0 }
  stats.totalIngested += totalIngested
  stats.totalFetched += totalFetched
  stats.avgQuality = ((stats.avgQuality * stats.runs) + avgQuality) / (stats.runs + 1)
  stats.runs++
  stats.lastRun = new Date().toISOString()
  metrics.topicStats[topic.id] = stats
  metrics.runs.push({ topicId: topic.id, ingested: totalIngested, fetched: totalFetched, quality: avgQuality, timestamp: new Date().toISOString() })
  if (metrics.runs.length > 1000) metrics.runs = metrics.runs.slice(-500)
  if (!dryRun) { try { fs.writeFileSync(METRICS_FILE, JSON.stringify(metrics, null, 2)) } catch (e) { log("  [autolearn-parallel] saveMetrics failed: " + e.message) } }

  log(`  ✅ ${topic.id}: ${totalIngested} ingested / ${totalFetched} fetched (avg Q:${avgQuality})`)
  return { topic: topic.id, name: topic.name, ingested: totalIngested, fetched: totalFetched, avgQuality, tags: topic.assetTags }
}

async function main() {
  log('═══════════════════════════════════════')
  log('🐋 Market Orca Autolearn v3 — Parallel')
  log('═══════════════════════════════════════')

  if (!fs.existsSync(TOPICS_FILE)) { log(`❌ Topics file not found: ${TOPICS_FILE}`); process.exit(1) }
  const config = JSON.parse(fs.readFileSync(TOPICS_FILE, 'utf8'))
  let topics = config.topics.filter(t => t.enabled !== false)

  if (filterTopic) {
    topics = topics.filter(t => t.id === filterTopic)
    if (topics.length === 0) { log(`❌ Topic "${filterTopic}" not found`); process.exit(1) }
  }
  if (priorityOnly) topics = topics.filter(t => t.priority === 'high')

  log(`📋 ${topics.length} topics${dryRun ? ' [DRY RUN]' : ''}`)

  const summary = []
  for (const topic of topics) {
    try { summary.push(await processTopic(topic)) }
    catch (err) { log(`❌ "${topic.name}" fatal: ${err.message}`); summary.push({ topic: topic.id, error: err.message }) }
  }

  const totalIngested = summary.reduce((s, r) => s + (r.ingested || 0), 0)
  const totalQuality = summary.filter(r => r.avgQuality).reduce((s, r) => s + r.avgQuality, 0)
  const qualityTopics = summary.filter(r => r.avgQuality)
  const avgQuality = qualityTopics.length > 0 ? Math.round(totalQuality / qualityTopics.length) : 0

  log(`\n═══════════════════════════════════════`)
  log('🐋 Autolearn v3 Summary')
  for (const r of summary) {
    if (r.error) log(`  ❌ ${r.name}: ${r.error}`)
    else log(`  ✅ ${r.topic} (${r.name}): ${r.ingested} ingested / ${r.fetched} fetched  Q:${r.avgQuality}  🏷️ [${r.tags.join(',')}]`)
  }
  log(`\n  🏆 Overall: ${totalIngested} docs ingested | Avg Quality: ${avgQuality}`)
  log('═══════════════════════════════════════')

  console.log(JSON.stringify({ ok: true, learnedCount: totalIngested, avgQuality, summary }))
}

main().catch(err => { log(`❌ Fatal: ${err.message}`); process.exit(1) })
