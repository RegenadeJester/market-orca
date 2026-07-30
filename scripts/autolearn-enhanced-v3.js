#!/usr/bin/env node
/**
 * Market Orca Enhanced Autolearn v3 — Enterprise Grade
 * - Smarter query generation with Indonesian context
 * - Quality scoring, deduplication, freshness tracking
 * - Per-topic scheduled learning
 * - Professional article-style report synthesis
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
    const cmd = `${ANYSEARCH_CLI} search "${query.replace(/"/g, '\\"')}" --max_results ${limit}`
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
  } catch { return [] }
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
    const envFile = path.join(__dirname, '..', '.env')
    if (fs.existsSync(envFile)) {
      const match = fs.readFileSync(envFile, 'utf8').match(/^MCP_AUTH_TOKEN=(.+)$/m)
      if (match) MCP_TOKEN = match[1].trim()
    }
  }
} catch {}

// ─── Store ─────────────────────────────────────────────────────
let learnedStore = {}
if (!dryRun && fs.existsSync(LEARNED_FILE)) {
  try { learnedStore = JSON.parse(fs.readFileSync(LEARNED_FILE, 'utf8')) } catch {}
}

let metrics = { runs: [], topicStats: {} }
if (fs.existsSync(METRICS_FILE)) {
  try { metrics = JSON.parse(fs.readFileSync(METRICS_FILE, 'utf8')) } catch {}
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  try { fs.appendFileSync(LOG_FILE, line + '\n') } catch {}
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
      title: r.title,
      url: r.url,
      snippet: r.snippet,
      source: r.source,
      domain: r.domain,
      trust: r.trust || 50,
      quality: r.quality || 0
    })).slice(0, limit)
  } catch { return [] }
}

async function mcpPost(tool, input, timeoutMs = 60000, retries = 2) {
  const headers = { 'Content-Type': 'application/json' }
  if (MCP_TOKEN) headers['Authorization'] = `Bearer ${MCP_TOKEN}`
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${MCP_BASE}/mcp/tool/${tool}`, {
        method: 'POST', headers, body: JSON.stringify(input),
        signal: AbortSignal.timeout(timeoutMs)
      })
      if (res.status === 401) throw new Error(`MCP ${tool} ${res.status} — check MCP_AUTH_TOKEN`)
      if (!res.ok) throw new Error(`MCP ${tool} ${res.status}`)
      return res.json()
    } catch (err) {
      if (attempt < retries && (err.message.includes('fetch failed') || err.message.includes('ECONNREFUSED'))) {
        log(`  ⚠️ MCP retry ${attempt+1}/${retries}: ${err.message}`)
        await new Promise(r => setTimeout(r, 2000))
        continue
      }
      throw err
    }
  }
}

// ─── Content Processing ────────────────────────────────────────
async function fetchPageContent(url) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 15000)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (MarketOrcaBot/3.0; +https://market-orca) AppleWebKit/537.36' }
    })
    if (!res.ok) return null
    const html = await res.text()

    // Extract metadata
    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || url).trim()
    const ogImage = (html.match(/<meta[^>]*property=["]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)?.[1] ||
                     html.match(/<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i)?.[1] || '').trim()
    const description = (html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)?.[1] ||
                         html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i)?.[1] || '').trim()
    const publishedDate = (html.match(/<meta[^>]*property=["']article:published_time["'][^>]*content=["']([^"']+)["']/i)?.[1] ||
                           html.match(/<time[^>]*datetime=["']([^"']+)["']/i)?.[1] || '').trim()

    // Clean content
    const clean = html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
      .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ').trim()

    const source = new URL(url).hostname.replace(/^www\./, '')
    return { title, content: clean.slice(0, 20000), url, source, image: ogImage, description, publishedDate }
  } catch { return null }
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
  // Length bonus
  if (content.length > 5000) score += 10
  if (content.length > 10000) score += 5
  // Title quality (Indonesian context)
  if (/harga|kurs|IHSG|saham|crypto|bitcoin|USD|IDR/i.test(title)) score += 5
  if (/berita|analisis|prediksi|outlook|forecast/i.test(title)) score += 5
  // Recency (published within 7 days)
  return Math.min(100, score)
}

// ─── Relevance Filter ──────────────────────────────────────────
const TOPIC_KEYWORDS = {
  'idx-market': ['IHSG','IDX','saham','indeks','Jakarta','BEI','Bursa Efek','JCI','composite','trading','investasi','pasar modal','foreign','net buy','net sell','rekomendasi','analyst','harga','saham','emiten','kapitalisasi','dividen'],
  'usd-idr': ['rupiah','IDR','USD','kurs','dollar','Bank Indonesia','devisa','forex','BI rate','Suku bunga','dollar AS','nilai tukar','mata uang','exchange','currency','forex','trading'],
  'crypto': ['bitcoin','ethereum','crypto','blockchain','altcoin','token','DeFi','Binance','Coinbase','cryptocurrency','solana','ripple','BTC','ETH','Web3','stablecoin'],
  'global-macro': ['inflasi','Fed','interest rate','monetary','IMF','GDP','trade war','recession','ekonomi','perekonomian','fiscal','stimulus','central bank','bank sentral','proyeksi','pertumbuhan'],
  'commodities': ['komoditas','batu bara','nickel','palm oil','CPO','emas','minyak','crude','commodity','nikel','tembaga','kopi','karet','kelapa sawit'],
  'gold': ['emas','gold','Antam','logam mulia','bullion','harga emas','XAU','precious metal'],
  'oil-energy': ['minyak mentah','OPEC','crude oil','energi','oil price','brent','WTI','BBM','fuel','natural gas'],
}

function isRelevant(title, content, topicId) {
  const keywords = TOPIC_KEYWORDS[topicId]
  if (!keywords) return true
  const text = (title + ' ' + (content || '').slice(0, 3000)).toLowerCase()
  const matches = keywords.filter(kw => text.includes(kw.toLowerCase()))
  return matches.length >= 1 // need at least 1 keyword match
}

// ─── Smart Query Generation ────────────────────────────────────
const INDONESIAN_QUERIES = {
  'idx-market': [
    'IHSG hari ini indeks komposit Jakarta',
    'saham aktif volume tinggi IDX hari ini',
    'pergerakan saham Indonesia minggu ini analisis',
    'foreign investor net buy sell IDX IHSG',
    'rekomendasi saham analyst Indonesia'
  ],
  'usd-idr': [
    'kurs rupiah hari ini BI',
    'USD IDR forecast analisis',
    'nilai tukar rupiah terhadap dolar',
    'dampak Fed rate ke rupiah',
    'cadangan devisa Indonesia'
  ],
  'crypto': [
    'harga bitcoin hari ini',
    'ethereum crypto market',
    'analisis crypto market mingguan',
    'altcoin terbaik untuk investasi',
    'regulasi crypto Indonesia terbaru'
  ],
  'global-macro': [
    'kebijakan moneter global',
    'inflasi dunia terkini',
    'suku bunga Fed ECB BOJ',
    'perang dagang dan dampak global',
    'proyeksi pertumbuhan ekonomi dunia'
  ],
  'ai-tech': [
    'teknologi AI terbaru Indonesia',
    'NVIDIA saham teknologi',
    'startup teknologi Indonesia funding',
    'kecerdasan buatan dampak ekonomi',
    'semitokon industri teknologi global'
  ],
  'commodities': [
    'harga komoditas Indonesia terkini',
    'batu bara Indonesia',
    'palm oil CPO harga',
    'nickel Indonesia harga dunia',
    'komoditas strategis Indonesia'
  ],
  'indonesia': [
    'perekonomian Indonesia terkini',
    'pertumbuhan GDP Indonesia',
    'investasi asing Indonesia',
    'kebijakan ekonomi pemerintah',
    'proyek infrastruktur Indonesia'
  ],
  'gold': [
    'harga emas hari ini Antam',
    'gold price outlook',
    'emas logam mulia investasi',
    'komoditas emas dunia',
    'cadangan emas Indonesia'
  ],
  'us-market': [
    'S&P 500 Nasdaq hari ini',
    'Wall Street market mingguan',
    'saham teknologi AS',
    'Fed rate impact',
    'analisis pasar modal AS'
  ],
  'china': [
    'ekonomi China terkini',
    'China market outlook',
    'Yuan China dampak global',
    'perang dagang China AS',
    'China stimulus kebijakan'
  ],
  'oil-energy': [
    'harga minyak mentah dunia',
    'OPEC production quota',
    'Energies Indonesia',
    'minyak dunia outlook',
    'transisi energi Indonesia'
  ],
  'forex': [
    'analisis forex EUR USD GBP',
    'USD IDR technical analysis',
    'forex market mingguan',
    'Yen JPY forecast',
    'forex Indonesia broker'
  ],
  'geopolitics': [
    'geopolitik dunia terkini',
    'perang Ukraina Rusia dampak',
    'Timur Tengah konflik',
    'Asia Tenggara geopolitik',
    'sanksi internasional ekonomi'
  ],
  'indonesia-politics': [
    'politik Indonesia terkini',
    'kebijakan pemerintah baru',
    'APBN Indonesia 2026',
    'undang undang ekonomi',
    'reformasi kebijakan Indonesia'
  ],
  'startup': [
    'startup Indonesia terbaru',
    'unicorn Indonesia',
    'venture capital funding',
    'ekosistem startup Indonesia',
    'teknologi startup IPO'
  ]
}

function getSmartQueries(topicId, originalQueries = []) {
  // Use enhanced Indonesian queries if available
  if (INDONESIAN_QUERIES[topicId]) {
    return INDONESIAN_QUERIES[topicId]
  }
  // Fallback to original queries with Indonesian context
  return originalQueries.length > 0 
    ? originalQueries.map(q => q.includes('Indonesia') ? q : `${q} Indonesia`)
    : [`${topicId} Indonesia market terkini`]
}

// ─── Metrics & Analytics ───────────────────────────────────────
function recordMetrics(topicId, ingested, fetched, quality) {
  const now = new Date().toISOString()
  if (!metrics.topicStats[topicId]) {
    metrics.topicStats[topicId] = { totalIngested: 0, totalFetched: 0, avgQuality: 0, runs: 0 }
  }
  const stats = metrics.topicStats[topicId]
  stats.totalIngested += ingested
  stats.totalFetched += fetched
  stats.avgQuality = ((stats.avgQuality * stats.runs) + quality) / (stats.runs + 1)
  stats.runs++
  stats.lastRun = now

  metrics.runs.push({ topicId, ingested, fetched, quality, timestamp: now })
  if (metrics.runs.length > 1000) metrics.runs = metrics.runs.slice(-500)
}

function saveMetrics() {
  if (!dryRun) {
    try { fs.writeFileSync(METRICS_FILE, JSON.stringify(metrics, null, 2)) } catch {}
  }
}

const BLACKLIST_DOMAINS = [
  'cambridge.org', 'merriam-webster.com', 'wiktionary.org', 'collinsdictionary.com',
  'dictionary.com', 'thefreedictionary.com', 'wordreference.com',
  'thesaurus.com', 'kbbi.', 'bdir.in', 'knowyourgst.com', 'mybroadband.co.za',
  'github.com', 'gitlab.com', 'bitbucket.org',
  'stackoverflow.com', 'stackexchange.com',
  'reddit.com', 'quora.com', 'yahoo.com',
  'facebook.com', 'twitter.com', 'x.com', 'instagram.com', 'linkedin.com',
  'youtube.com', 'vimeo.com', 'dailymotion.com',
  'pinterest.com', 'tumblr.com'
]

const MIN_QUALITY = 30

function isBlacklisted(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    return BLACKLIST_DOMAINS.some(d => host.includes(d))
  } catch { return false }
}

// ─── Topic Processing ──────────────────────────────────────────
async function processTopic(topic) {
  log(`\n📚 Topic: ${topic.name} [${topic.assetTags.join(', ')}]`)
  let totalFetched = 0, totalIngested = 0, totalQuality = 0

  // Use smart Indonesian queries
  const queries = getSmartQueries(topic.id, topic.queries || [])
  log(`  📋 Queries: ${queries.length} smart queries`)

  for (const query of queries) {
    try {
      log(`  🔍 Search: "${query}"`)
      // Priority 1: REST API (multi-engine through backend)
      let results = await restSearch(query, topic.maxResults || 5)
      // Fallback: AnySearch
      if (!results.length) {
        log(`  ⚠️ REST empty, trying AnySearch direct...`)
        results = await anysearchSearch(query, topic.maxResults || 5)
      }
      if (!results.length) {
        log(`  ⚠️ No results for "${query}"`)
        continue
      }
      log(`  📊 Found ${results.length} results`)

      for (const r of results) {
        const url = r.url
        if (!url || url.includes('youtube.com') || url.includes('facebook.com') || url.includes('instagram.com') || url.includes('twitter.com') || url.includes('x.com')) continue
        if (url.includes('bing.com/ck/a') || url.includes('bing.com/cc/a')) continue
        // Skip blacklisted domains
        if (isBlacklisted(url)) {
          log(`  ⛔ Skip blacklisted: ${url.slice(0, 60)}`)
          continue
        }

        const urlHash = crypto.createHash('sha256').update(url).digest('hex')
        if (learnedStore[urlHash]) {
          log(`  ⏭️ Already learned: ${url.slice(0, 60)}`)
          continue
        }

        try {
          log(`  📥 Fetching: ${url.slice(0, 70)}`)
          const page = await fetchPageContent(url)
          if (!page || !page.content || page.content.length < 300) {
            log(`  ⚠️ Skip: content too short (${page?.content?.length || 0} chars)`)
            continue
          }

          const summary = generateSummary(page.content)
          const credibility = estimateCredibility(page.source, r.trust)
          const qualityScore = calculateQualityScore(page.title, page.content, page.source, credibility)

          // Relevance filter - skip noise
          if (!isRelevant(page.title, page.content, topic.id)) {
            log(`  🚫 Irrelevant: "${page.title.slice(0, 50)}"`)
            continue
          }

          // Quality threshold filter - reject low quality
          if (qualityScore < MIN_QUALITY) {
            log(`  🗑️ Low quality (Q:${qualityScore} < ${MIN_QUALITY}): "${page.title.slice(0, 50)}"`)
            continue
          }

          log(`  📝 Ingest: "${page.title.slice(0, 50)}" (${page.content.length} chars, Q:${qualityScore}) → [${topic.assetTags.join(',')}]`)

          if (!dryRun) {
            await mcpPost('rag.ingest', {
              url,
              title: page.title,
              source: page.source,
              content: page.content,
              summary,
              image: page.image || null,
              description: page.description || null,
              publishedDate: page.publishedDate || null,
              credibility,
              qualityScore,
              assetTags: topic.assetTags,
              metadata: {
                topicId: topic.id,
                topicName: topic.name,
                searchQuery: query,
                fetchedAt: new Date().toISOString(),
                pipeline: 'autolearn-v3'
              }
            })
            learnedStore[urlHash] = {
              url, title: page.title, learnedAt: new Date().toISOString(),
              collection: topic.id, assetTags: topic.assetTags,
              summary: summary.slice(0, 200), image: page.image,
              credibility, qualityScore, hash: urlHash
            }
          }
          totalIngested++
          totalQuality += qualityScore
        } catch (err) {
          log(`  ❌ Failed: ${url.slice(0, 50)}: ${err.message}`)
        }
        await new Promise(resolve => setTimeout(resolve, 1500))
      }
      totalFetched += results.length
    } catch (err) {
      log(`  ⚠️ Query "${query}" failed: ${err.message}`)
    }
  }

  if (!dryRun && totalIngested > 0) {
    fs.writeFileSync(LEARNED_FILE, JSON.stringify(learnedStore, null, 2))
  }

  const avgQuality = totalIngested > 0 ? Math.round(totalQuality / totalIngested) : 0
  recordMetrics(topic.id, totalIngested, totalFetched, avgQuality)
  saveMetrics()

  log(`  ✅ ${topic.id}: ${totalIngested} ingested / ${totalFetched} fetched (avg Q:${avgQuality})`)
  return { topic: topic.id, name: topic.name, ingested: totalIngested, fetched: totalFetched, avgQuality, tags: topic.assetTags }
}

async function main() {
  log('═══════════════════════════════════════')
  log('🐋 Market Orca Autolearn v3 — Enterprise Grade')
  log('═══════════════════════════════════════')

  if (!fs.existsSync(TOPICS_FILE)) {
    log(`❌ Topics file not found: ${TOPICS_FILE}`)
    process.exit(1)
  }
  const config = JSON.parse(fs.readFileSync(TOPICS_FILE, 'utf8'))
  let topics = config.topics.filter(t => t.enabled !== false)

  if (filterTopic) {
    topics = topics.filter(t => t.id === filterTopic)
    if (topics.length === 0) { log(`❌ Topic "${filterTopic}" not found`); process.exit(1) }
  }

  if (priorityOnly) {
    topics = topics.filter(t => t.priority === 'high')
    log(`📋 ${topics.length} HIGH priority topics${dryRun ? ' [DRY RUN]' : ''}`)
  } else {
    log(`📋 ${topics.length} topics${dryRun ? ' [DRY RUN]' : ''}${deepSearch ? ' + deep' : ''}`)
  }

  if (metricsOnly) {
    log(`\n📊 Metrics: ${JSON.stringify(metrics, null, 2)}`)
    return
  }

  const summary = []
  for (const topic of topics) {
    try { summary.push(await processTopic(topic)) }
    catch (err) { log(`❌ "${topic.name}" fatal: ${err.message}`); summary.push({ topic: topic.id, error: err.message }) }
  }

  try {
    const stats = await mcpPost('rag.storage', {})
    log(`\n📊 RAG Stats: ${JSON.stringify(stats.stats || stats)}`)
  } catch {}

  log('\n═══════════════════════════════════════')
  log('🐋 Autolearn v3 Summary')
  let grandTotal = 0, grandQuality = 0, qCount = 0
  for (const s of summary) {
    if (s.error) log(`  ❌ ${s.topic}: ${s.error}`)
    else {
      log(`  ✅ ${s.topic} (${s.name}): ${s.ingested} ingested / ${s.fetched} fetched  Q:${s.avgQuality}  🏷️ [${s.tags?.join(',')}]`)
      grandTotal += s.ingested || 0
      grandQuality += (s.avgQuality || 0) * (s.ingested || 0)
      qCount += s.ingested || 0
    }
  }
  const overallQuality = qCount > 0 ? Math.round(grandQuality / qCount) : 0
  log(`\n  🏆 Overall: ${grandTotal} docs ingested | Avg Quality: ${overallQuality}`)
  log('═══════════════════════════════════════')

  console.log(JSON.stringify({
    ok: true,
    learnedCount: grandTotal,
    avgQuality: overallQuality,
    summary,
    timestamp: new Date().toISOString(),
    metrics: { totalRuns: metrics.runs.length, topics: Object.keys(metrics.topicStats).length }
  }))
}

main().catch(err => { log(`❌ Fatal: ${err.message}`); process.exit(1) })