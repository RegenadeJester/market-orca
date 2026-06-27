#!/usr/bin/env node
/**
 * Market Orca Enhanced Autolearn v2
 * - SearXNG + deep search
 * - Extracts images, summaries, metadata
 * - Rich ingestion with assetTags, images, source credibility
 * - Auto-create collections for new topics
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { URL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TOPICS_FILE = path.join(__dirname, '..', 'collections', 'autolearn-topics.json')
const LOG_FILE = path.join(__dirname, '..', 'collections', 'autolearn.log')
const LEARNED_FILE = path.join(__dirname, '..', 'collections', 'autolearn-learned.json')
const MCP_BASE = process.env.MCP_BASE || 'http://127.0.0.1:4567'
const SEARXNG_URL = process.env.SEARXNG_URL || 'http://127.0.0.1:18080'

const args = process.argv.slice(2)
const filterTopic = args.includes('--topic') ? args[args.indexOf('--topic') + 1] : null
const dryRun = args.includes('--dry-run')
const deepSearch = args.includes('--deep')

let MCP_TOKEN = ''
try {
  if (process.env.MCP_AUTH_TOKEN) MCP_TOKEN = process.env.MCP_AUTH_TOKEN
  if (!MCP_TOKEN) {
    const tokenFile = path.join(__dirname, '..', '.env.autolearn')
    if (fs.existsSync(tokenFile)) {
      const match = fs.readFileSync(tokenFile, 'utf8').match(/^MCP_AUTH_TOKEN=(.+)$/m)
      if (match) MCP_TOKEN = match[1].trim()
    }
  }
  if (!MCP_TOKEN) {
    const envFile = path.join(__dirname, '..', '.env')
    if (fs.existsSync(envFile)) {
      const match = fs.readFileSync(envFile, 'utf8').match(/^MCP_AUTH_TOKEN=(.+)$/m)
      if (match) MCP_TOKEN = match[1].trim()
    }
  }
} catch {}

let learnedStore = {}
if (!dryRun && fs.existsSync(LEARNED_FILE)) {
  try { learnedStore = JSON.parse(fs.readFileSync(LEARNED_FILE, 'utf8')) } catch {}
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

async function searxngSearch(query, limit = 5) {
  const url = `${SEARXNG_URL.replace(/\/$/, '')}/search?q=${encodeURIComponent(query)}&format=json&categories=general,news&pageno=1&language=all&safesearch=0`
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 20000)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    const data = await res.json()
    return (data.results || []).slice(0, limit)
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('searxng_timeout')
    throw err
  } finally { clearTimeout(t) }
}

async function deepSearchMCP(query, maxResults = 5) {
  try {
    const res = await mcpPost('web.deep_search', { query, maxResults, depth: 2 })
    const allResults = []
    for (const bucket of res.buckets || []) {
      for (const r of bucket.results || []) {
        allResults.push({
          title: r.title,
          url: r.url,
          snippet: r.snippet,
          source: r.source,
          domain: r.domain,
          trust: r.trust || 50,
          quality: r.quality || 0,
          mode: bucket.mode
        })
      }
    }
    return allResults.sort((a, b) => (b.quality || 0) - (a.quality || 0)).slice(0, maxResults)
  } catch { return [] }
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

async function restSearch(query, limit = 5) {
  try {
    const res = await fetch(`${MCP_BASE}/api/search/web`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, engines: ['bing', 'duckduckgo'], limit }),
      signal: AbortSignal.timeout(20000)
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

async function fetchPageContent(url) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 15000)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (MarketOrcaBot/2.0; +https://market-orca) AppleWebKit/537.36' }
    })
    if (!res.ok) return null
    const html = await res.text()

    // Extract metadata
    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || url).trim()
    const ogImage = (html.match(/<meta[^>]*property="]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)?.[1] ||
                     html.match(/<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i)?.[1] ||
                     html.match(/<img[^>]*src=["']([^"']+\.(?:jpg|jpeg|png|webp|gif))["']/i)?.[1] ||
                     '').trim()
    const description = (html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)?.[1] ||
                         html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i)?.[1] ||
                         '').trim()
    const publishedDate = (html.match(/<meta[^>]*property=["']article:published_time["'][^>]*content=["']([^"']+)["']/i)?.[1] ||
                           html.match(/<time[^>]*datetime=["']([^"']+)["']/i)?.[1] ||
                           '').trim()

    // Clean content
    const clean = html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
      .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ').trim()

    const source = new URL(url).hostname.replace(/^www\./, '')
    return { title, content: clean.slice(0, 15000), url, source, image: ogImage, description, publishedDate }
  } catch { return null }
  finally { clearTimeout(t) }
}

function generateSummary(content, maxSentences = 3) {
  const sentences = content.split(/(?<=[.!?])\s+/).filter(s => s.length > 20)
  return sentences.slice(0, maxSentences).join(' ')
}

function estimateCredibility(source, trust = 50) {
  const highTrust = ['idx.co.id', 'bi.go.id', 'ojk.go.id', 'kompas.id', 'detik.com', 'cnnindonesia.com', 'cnbcindonesia.com', 'investing.com', 'bloomberg.com', 'reuters.com', 'wsj.com', 'ft.com']
  const medTrust = ['katadata.co.id', 'kontan.co.id', 'bisnis.com', 'liputan6.com', 'tribunnews.com']
  if (highTrust.some(h => source.includes(h))) return Math.min(95, trust + 20)
  if (medTrust.some(m => source.includes(m))) return Math.min(80, trust + 10)
  return trust
}

async function processTopic(topic) {
  log(`\n📚 Topic: ${topic.name} [${topic.assetTags.join(', ')}]`)
  let totalFetched = 0, totalIngested = 0

  for (const query of topic.queries) {
    try {
      log(`  🔍 Search: "${query}"`)
      // Prefer REST API (goes through backend's multi-engine search)
      let results = await restSearch(query, topic.maxResults || 3)
      // Fallback to SearXNG direct if REST fails
      if (!results.length) {
        log(`  ⚠️ REST empty, trying SearXNG direct...`)
        results = await searxngSearch(query, topic.maxResults || 3)
      }
      // Fallback to MCP deep search
      if (!results.length) {
        log(`  ⚠️ SearXNG empty, trying MCP deep...`)
        results = await deepSearchMCP(query, topic.maxResults || 3)
      }
      log(`  📊 Found ${results.length} results`)

      if (deepSearch && results.length < (topic.maxResults || 3)) {
        log(`  🔬 Deep search supplement...`)
        const deep = await deepSearchMCP(query, topic.maxResults || 3)
        results = [...results, ...deep]
      }

      for (const r of results) {
        const url = r.url
        if (!url || url.includes('youtube.com') || url.includes('facebook.com') || url.includes('instagram.com') || url.includes('twitter.com') || url.includes('x.com')) continue
        // Skip Bing redirect URLs that can't be crawled
        if (url.includes('bing.com/ck/a') || url.includes('bing.com/cc/a')) continue

        const urlHash = url.slice(0, 200)
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

          log(`  📝 Ingest: "${page.title.slice(0, 50)}" (${page.content.length} chars, cred: ${credibility}) → [${topic.assetTags.join(',')}]`)

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
              assetTags: topic.assetTags,
              metadata: {
                topicId: topic.id,
                topicName: topic.name,
                searchQuery: query,
                fetchedAt: new Date().toISOString()
              }
            })
            learnedStore[urlHash] = {
              url, title: page.title, learnedAt: new Date().toISOString(),
              collection: topic.id, assetTags: topic.assetTags,
              summary: summary.slice(0, 200), image: page.image, credibility
            }
          }
          totalIngested++
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

  log(`  ✅ ${topic.id}: ${totalIngested} ingested / ${totalFetched} fetched`)
  return { topic: topic.id, name: topic.name, ingested: totalIngested, fetched: totalFetched, tags: topic.assetTags }
}

async function main() {
  log('═══════════════════════════════════════')
  log('🐋 Market Orca Enhanced Autolearn v2 — Starting')
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

  log(`📋 ${topics.length} topics${dryRun ? ' [DRY RUN]' : ''}${deepSearch ? ' + deep' : ''}`)

  const summary = []
  for (const topic of topics) {
    try { summary.push(await processTopic(topic)) }
    catch (err) { log(`❌ "${topic.name}" fatal: ${err.message}`); summary.push({ topic: topic.id, error: err.message }) }
  }

  try {
    const stats = await mcpPost('rag.storage', {})
    log(`\n📊 RAG: ${JSON.stringify(stats.stats || stats)}`)
  } catch {}

  log('\n═══════════════════════════════════════')
  log('🐋 Enhanced Autolearn Summary')
  for (const s of summary) {
    if (s.error) log(`  ❌ ${s.topic}: ${s.error}`)
    else log(`  ✅ ${s.topic} (${s.name}): ${s.ingested} ingested / ${s.fetched} fetched  🏷️ [${s.tags?.join(',')}]`)
  }
  log('═══════════════════════════════════════')

  console.log(JSON.stringify({ ok: true, learnedCount: summary.reduce((a, s) => a + (s.ingested || 0), 0), summary, timestamp: new Date().toISOString() }))
}

main().catch(err => { log(`❌ Fatal: ${err.message}`); process.exit(1) })