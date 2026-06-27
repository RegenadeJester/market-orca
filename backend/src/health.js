/**
 * Unified Health Check — Market Orca
 * Single endpoint for all service health checks
 */

import { db } from './db.js'
import { webCacheStats } from './web-search.js'
import { ragStorageStats } from './rag.js'
import { getCollectionStats } from './rag-autolearn.js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPORTS_DIR = path.join(__dirname, '..', '..', 'reports')

// ─── Individual Checks ────────────────────────────────────────────────────

async function checkDatabase() {
  const count = db.prepare('SELECT count(*) AS n FROM assets').get()?.n || 0
  const fts5 = db.prepare(`SELECT sqlite_compileoption_used('ENABLE_FTS5') AS enabled`).get()?.enabled === 1
  return { assets: count, fts5 }
}

async function checkRAG() {
  const docs = db.prepare('SELECT count(*) AS n FROM rag_evidence_documents').get()?.n || 0
  const chunks = db.prepare('SELECT count(*) AS n FROM rag_evidence_chunks').get()?.n || 0
  const stats = ragStorageStats()
  return { documents: docs, chunks, fts5Runtime: stats.fts5Runtime, vectorCoverage: stats.vectorCoverage }
}

async function checkAutolearn() {
  const stats = getCollectionStats()
  return { collections: stats.collections?.length || 0, totalDocuments: stats.totalDocuments || 0, totalChunks: stats.totalChunks || 0 }
}

async function checkSearXNG() {
  const base = (process.env.SEARXNG_URL || process.env.SEARX_URL || 'http://localhost:18080').replace(/\/$/, '')
  const r = await fetch(`${base}/search?q=test&format=json&language=all&safesearch=0&categories=general`, {
    headers: { 'user-agent': 'MarketOrcaHealth/1.0', 'accept': 'application/json' },
    signal: AbortSignal.timeout(5000)
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const j = await r.json()
  return { results: (j.results || []).length, url: base }
}

async function checkMCP() {
  const tools = (global.MCP_TOOLS?.length) || 20 // fallback from server.js
  return { version: '1.2.0', tools }
}

async function checkYahooFinance() {
  const url = 'https://query1.finance.yahoo.com/v7/finance/quote?symbols=%5EJKSE'
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(5000) })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return { reachable: true }
}

async function checkDiscord() {
  const hasToken = !!process.env.DISCORD_BOT_TOKEN
  const hasWebhook = !!process.env.DISCORD_WEBHOOK_URL
  return { configured: hasToken || hasWebhook, token: hasToken, webhook: hasWebhook }
}

async function checkCache() {
  return webCacheStats()
}

async function checkReports() {
  const files = fs.existsSync(REPORTS_DIR) 
    ? fs.readdirSync(REPORTS_DIR).filter(f => f.endsWith('.json')).sort().reverse() 
    : []
  const latest = files[0]?.replace('.json', '') || null
  return { reports: files.length, latest }
}

async function checkReportServer() {
  // Check if report server is running on port 4568
  try {
    const r = await fetch('http://localhost:4568/health', { signal: AbortSignal.timeout(3000) })
    if (r.ok) { const j = await r.json(); return { ok: true, ...j } }
    return { ok: false, error: `HTTP ${r.status}` }
  } catch (e) {
    return { ok: false, error: String(e.message || e) }
  }
}

async function checkCloudflareTunnel() {
  // Quick check if cloudflared process is running or tunnel URL reachable
  try {
    const r = await fetch('https://market-orca.anomali.web.id/health', { signal: AbortSignal.timeout(5000) })
    return { ok: r.ok, reachable: true }
  } catch {
    return { ok: false, reachable: false, error: 'tunnel unreachable' }
  }
}

// ─── Main Health Check ────────────────────────────────────────────────────

export async function runHealthChecks() {
  const checks = {}
  
  async function runCheck(name, fn) {
    const t0 = Date.now()
    try {
      const out = await fn()
      checks[name] = { ok: true, ...out, ms: Date.now() - t0 }
    } catch (e) {
      checks[name] = { ok: false, error: String(e.message || e), ms: Date.now() - t0 }
    }
  }

  await Promise.allSettled([
    runCheck('database', checkDatabase),
    runCheck('rag', checkRAG),
    runCheck('autolearn', checkAutolearn),
    runCheck('searxng', checkSearXNG),
    runCheck('mcp', checkMCP),
    runCheck('yahoo_finance', checkYahooFinance),
    runCheck('discord', checkDiscord),
    runCheck('cache', checkCache),
    runCheck('reports', checkReports),
    runCheck('report_server', checkReportServer),
    runCheck('cloudflare_tunnel', checkCloudflareTunnel)
  ])

  const allOk = Object.values(checks).every(c => c.ok)
  
  return {
    ok: allOk,
    name: 'market-orca-backend',
    version: '1.2.0',
    port: Number(process.env.PORT || 4567),
    allOk,
    services: checks,
    uptime: process.uptime(),
    memory: process.memoryUsage().rss,
    timestamp: new Date().toISOString()
  }
}

// ─── Component Health Subsets ──────────────────────────────────────────────

export async function checkRAGHealth() {
  const { ok, ...rest } = await runHealthChecks()
  return { ok: rest.rag?.ok && rest.autolearn?.ok, rag: rest.rag, autolearn: rest.autolearn }
}

export async function checkPipelineHealth() {
  const { ok, ...rest } = await runHealthChecks()
  return { ok: rest.database?.ok && rest.rag?.ok && rest.searxng?.ok, database: rest.database, rag: rest.rag, searxng: rest.searxng }
}

export { checkDatabase, checkRAG, checkAutolearn, checkSearXNG, checkMCP, checkYahooFinance, checkDiscord, checkCache, checkReports }