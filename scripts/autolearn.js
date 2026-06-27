#!/usr/bin/env node
/**
 * Market Orca Autolearn
 * 
 * Reads collections/autolearn-topics.json, researches via SearXNG,
 * and ingests into RAG with assetTags (collections).
 * 
 * Usage: node scripts/autolearn.js [--topic <id>] [--dry-run]
 * Cron: runs every 6h via Hermes cron job
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TOPICS_FILE = path.join(__dirname, '..', 'collections', 'autolearn-topics.json')
const LOG_FILE = path.join(__dirname, '..', 'collections', 'autolearn.log')
const LEARNED_FILE = path.join(__dirname, '..', 'collections', 'autolearn-learned.json')
const MCP_BASE = process.env.MCP_BASE || 'http://127.0.0.1:4567'
const SEARXNG_URL = process.env.SEARXNG_URL || 'http://127.0.0.1:18080'

// Parse CLI args
const args = process.argv.slice(2)
const filterTopic = args.includes('--topic') ? args[args.indexOf('--topic') + 1] : null
const dryRun = args.includes('--dry-run')

// Load MCP token
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

// Track learned URLs (dedup across runs)
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
  const url = `${SEARXNG_URL.replace(/\/$/, '')}/search?q=${encodeURIComponent(query)}&format=json&categories=general&pageno=1&language=all`
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 15000)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    const data = await res.json()
    return (data.results || []).slice(0, limit)
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('searxng_timeout')
    throw err
  } finally {
    clearTimeout(t)
  }
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

async function fetchPageContent(url) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 10000)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (MarketOrcaBot; +https://market-orca)' }
    })
    if (!res.ok) return null
    const html = await res.text()
    // Strip tags
    const clean = html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ').trim()
    // Extract title
    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || url).trim()
    return { title, content: clean.slice(0, 12000) }
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

async function processTopic(topic) {
  log(`\n📚 Topic: ${topic.name} [${topic.assetTags.join(', ')}]`)
  let totalFetched = 0, totalIngested = 0

  for (const query of topic.queries) {
    try {
      log(`  🔍 SearXNG: "${query}"`)
      const results = await searxngSearch(query, topic.maxResults || 3)
      log(`  📊 Found ${results.length} results`)

      for (const r of results) {
        const url = r.url
        if (!url || url.includes('youtube.com') || url.includes('facebook.com') || url.includes('instagram.com')) continue

        // Dedup across runs
        const urlHash = url.slice(0, 200)
        if (learnedStore[urlHash]) {
          log(`  ⏭️ Already learned: ${url.slice(0, 60)}`)
          continue
        }

        try {
          log(`  📥 Fetching: ${url.slice(0, 70)}`)
          const page = await fetchPageContent(url)
          if (!page || !page.content || page.content.length < 200) {
            log(`  ⚠️ Skip: content too short (${page?.content?.length || 0} chars)`)
            continue
          }

          const source = new URL(url).hostname.replace(/^www\./, '')
          log(`  📝 Ingest: "${page.title.slice(0, 50)}" (${page.content.length} chars) → [${topic.assetTags.join(',')}]`)

          if (!dryRun) {
            await mcpPost('rag.ingest', {
              url,
              title: page.title,
              source,
              content: page.content,
              assetTags: topic.assetTags
            })
            learnedStore[urlHash] = { url, title: page.title, learnedAt: new Date().toISOString(), collection: topic.id }
          }
          totalIngested++
        } catch (err) {
          log(`  ❌ Failed: ${url.slice(0, 50)}: ${err.message}`)
        }
        // Delay to avoid hammering
        await new Promise(resolve => setTimeout(resolve, 1000))
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
  log('🐋 Market Orca Autolearn — Starting')
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

  log(`📋 ${topics.length} topics${dryRun ? ' [DRY RUN]' : ''}`)

  const summary = []
  for (const topic of topics) {
    try { summary.push(await processTopic(topic)) }
    catch (err) { log(`❌ "${topic.name}" fatal: ${err.message}`); summary.push({ topic: topic.id, error: err.message }) }
  }

  // RAG stats
  try {
    const stats = await mcpPost('rag.storage', {})
    log(`\n📊 RAG: ${JSON.stringify(stats.stats || stats)}`)
  } catch {}

  log('\n═══════════════════════════════════════')
  log('🐋 Autolearn Summary')
  for (const s of summary) {
    if (s.error) log(`  ❌ ${s.topic}: ${s.error}`)
    else log(`  ✅ ${s.topic} (${s.name}): ${s.ingested} ingested / ${s.fetched} fetched  🏷️ [${s.tags?.join(',')}]`)
  }
  log('═══════════════════════════════════════')

  console.log(JSON.stringify({ ok: true, learnedCount: summary.reduce((a, s) => a + (s.ingested || 0), 0), summary, timestamp: new Date().toISOString() }))
}

main().catch(err => { log(`❌ Fatal: ${err.message}`); process.exit(1) })