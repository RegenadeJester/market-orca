import express from 'express'
import cors from 'cors'
import compression from 'compression'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
import { db, saveAssetSnapshot, getStoredCandles, getStoredNews, getIncidentStatusHistory, manualUpdateIncidentStatus, incidentTitleHash } from './db.js'
import { sendDiscordAlert, initDiscordBot } from './discord.js'
import { getLiveAsset, getLiveAssets } from './live-data.js'
import { buildArticle } from './article.js'
import { runAlertScan } from './alert-engine.js'
import { APP_CONFIG } from './config.js'
import { searchSymbols, importAssetFromSearch } from './search.js'
import { getWatchlist, addWatchlist, removeWatchlist } from './watchlist.js'
import { generateAiDailyReport, sendAiReportToUser, buildTextReport, buildDiscordEmbed, saveReport, autoEnrichReportWeb, classifyIncidentSeverity, estimateCustomerImpact, trackRecoveryStatus } from './ai-daily-report.js'
import { CHANNEL_CONSTRAINTS, renderPreviewForChannel, publishChannel } from './channel-preview.js'
import { createSession, getUserFromReq, hashPassword, requireUser, seedTestAccounts } from './auth.js'
import { auditExport, canExportReport, createSignedExport, getReportMeta, safeReportPath, verifySignedExport, watermark } from './report-export-permissions.js'
import { initCanvasTables, getCanvas, saveCanvas, exportReport, cleanupExpiredExports } from './report-canvas.js'
import { ingestDocument, ingestUrl, searchRag, runRagReport, generateJsonlDataset, exportRagRun, factCheckReport, getRagRun } from './rag-report.js'
import { initRagSchema, ragSearch, ragHybridSearch, upsertRagDocument, buildRagContext, ragStorageStats, cleanupRagStore, vectorizeMissingChunks } from './rag.js'
import { enqueueRagCrawl, runRagCrawlWorker, isAllowedSource } from './rag-crawler.js'
import { webSearch, deepWebSearch, searchAndAnswer, fetchPageMarkdown, searchNews, webCacheStats, filterSearchForCrawl, TRUSTED_WEB_SOURCES, classifySearchResult, previewPublicPage } from './web-search.js'
import { getMarketCalendarStatus } from './market-calendar.js'
import { scoreSourceTrust, initSourceReliabilityTable, seedSourceReliability, listSourceReliability, getSourcesTrust } from './source-reliability.js'
import { initPersonaTable, getPersona, upsertPersona, inferPersonaFromActivity, buildContextPrompt } from './persona.js'
import { getTradingViewScreener, getTradingViewChart, getTradingViewTechnical, getTradingViewNews, getTradingViewPopular } from './mcp-tradingview.js'

seedTestAccounts()
seedSourceReliability()
initPersonaTable(db)
initCanvasTables(db)

const app = express()
const PORT = Number(process.env.REPORT_PORT || 4568)
app.use(compression())
app.use(cors())
app.use(express.json({ limit: '512kb' }))

// ── Security headers ──────────────────────────────────────────────────────
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('X-Robots-Tag', 'all, index, follow')
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  next()
})

// ── Health endpoint ───────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true, name: 'market-orca-report', port: PORT }))

// ── robots.txt ─────────────────────────────────────────────────────────────
app.get('/robots.txt', (_req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.send(`User-agent: *
Allow: /
Disallow: /api/auth/

Sitemap: https://report.anomali.web.id/sitemap.txt

# Market Orca Report Dashboard
# LLMs.txt: https://market-orca.anomali.web.id/llms.txt`)
})

// ── Favicon emoji SVG ──────────────────────────────────────────────────────
app.get('/favicon.ico', (_req, res) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="80" font-size="80">📊</text></svg>`
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8')
  res.setHeader('Cache-Control', 'public, max-age=86400')
  res.send(svg)
})

// ── Serve frontend SPA from frontend/dist ────────────────────────────────
const frontendDist = path.join(__dirname, '..', '..', 'frontend', 'dist')
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist, { maxAge: '1h', index: false }))
}

function baseAssets() {
  return db.prepare('SELECT * FROM assets ORDER BY market, name').all()
}

// ── Auth routes ──────────────────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {}
  const user = db.prepare('SELECT id,email,role,name,password_hash FROM users WHERE email = ?').get(String(email || '').toLowerCase())
  if (!user || user.password_hash !== hashPassword(password || '')) return res.status(401).json({ ok: false, error: 'invalid_credentials' })
  const token = createSession(user.id)
  res.cookie?.('mo_session', token, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 })
  res.json({ ok: true, token, user: { id: user.id, email: user.email, role: user.role, name: user.name } })
})

app.get('/api/me', (req, res) => {
  res.json({ ok: true, user: getUserFromReq(req) })
})

app.post('/api/auth/logout', (req, res) => {
  const user = getUserFromReq(req)
  if (user) db.prepare(`DELETE FROM sessions WHERE user_id=?`).run(user.id)
  res.clearCookie?.('mo_session')
  res.json({ ok: true })
})

// ── Overview / Assets API ────────────────────────────────────────────────
const overviewRateLimit = new Map()
app.get('/api/overview', async (_req, res) => {
  const ip = _req.ip || _req.socket?.remoteAddress || 'unknown'
  const now = Date.now()
  const last = overviewRateLimit.get(ip)
  if (last && now - last < 10000) return res.status(429).json({ error: 'rate_limited', retry_after: 10 - Math.round((now - last) / 1000) })
  overviewRateLimit.set(ip, now)
  try {
    const live = await getLiveAssets(baseAssets())
    live.forEach(saveAssetSnapshot)
    const assets = live.map((x) => ({ ...x.asset, sparkline: (x.candles || []).slice(-12).map((c) => c.close ?? c.value) }))
    const latestNews = live.flatMap((x) => (x.news || []).slice(0, 3).map((n) => ({ ...n, name: x.asset.name, symbol: x.asset.symbol, slug: x.asset.slug }))).slice(0, 20)
    res.json({ assets, latestNews })
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

// ── Market News (SearXNG) ───────────────────────────────────────────────
app.get('/api/market-news', async (_req, res) => {
  try {
    const queries = ['saham IDX berita hari ini', 'IHSG market update', 'saham naik turun']
    const allResults = []
    for (const q of queries.slice(0, 2)) {
      try {
        const data = await searchNews(q, { limit: 5, language: 'id', time_range: 'week' })
        allResults.push(...(data?.results || []))
      } catch (e) { console.error('[report-server] searchNews failed:', e.message) }
    }
    const seen = new Set()
    const unique = allResults.filter(r => {
      if (seen.has(r.url)) return false
      seen.add(r.url)
      return true
    }).slice(0, 10).map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.snippet,
      source: r.source || r.domain || 'unknown',
      publishedAt: r.published_at || ''
    }))
    res.json({ ok: true, news: unique })
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message })
  }
})

app.get('/api/assets', async (req, res) => {
  try {
    const q = (req.query.q || '').toString().toLowerCase()
    const market = (req.query.market || '').toString()
    const category = (req.query.category || '').toString()
    let rows = (await getLiveAssets(baseAssets())).map((x) => x.asset)
    if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.symbol.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q))
    if (market) rows = rows.filter((r) => r.market === market)
    if (category) rows = rows.filter((r) => r.category === category)
    res.json(rows)
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

app.get('/api/search', async (req, res) => {
  try {
    const q = (req.query.q || '').toString()
    const results = await searchSymbols(q)
    res.json({ results })
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

app.post('/api/assets/import', (req, res) => {
  const user = requireUser(req, res)
  if (!user) return
  try {
    const asset = importAssetFromSearch(req.body || {})
    res.json({ asset })
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

app.get('/api/watchlist', (_req, res) => {
  res.json({ items: getWatchlist() })
})

app.post('/api/watchlist', (req, res) => {
  const { slug } = req.body
  res.json({ items: addWatchlist(slug) })
})

app.post('/api/watchlist/remove', (req, res) => {
  const { slug } = req.body
  res.json({ items: removeWatchlist(slug) })
})

app.get('/api/watchlist/insights', (_req, res) => {
  const slugs = db.prepare('SELECT asset_slug FROM watchlist').all().map(r => r.asset_slug)
  const assets = slugs.length ? db.prepare(`SELECT * FROM assets WHERE slug IN (${slugs.map(() => '?').join(',')})`).all(...slugs) : []
  const rows = assets.map(a => {
    const news = db.prepare('SELECT title,summary,source,created_at FROM news WHERE asset_slug = ? ORDER BY id DESC LIMIT 1').get(a.slug)
    const momentum = Number(Math.abs(a.change_percent || 0).toFixed(2))
    const risk = momentum >= 5 ? 'high' : momentum >= 2 ? 'medium' : 'low'
    const action = risk === 'high' ? 'review now' : risk === 'medium' ? 'watch' : 'ignore unless catalyst changes'
    return { slug: a.slug, symbol: a.symbol, name: a.name, price: a.price, change_percent: a.change_percent, momentum, risk, action, catalyst: news ? { title: news.title, summary: news.summary, source: news.source, created_at: news.created_at } : null }
  }).sort((a, b) => b.momentum - a.momentum)
  res.json({ ok: true, count: rows.length, top_risk: rows[0] || null, items: rows })
})

app.get('/api/assets/:slug', async (req, res) => {
  try {
    const asset = db.prepare('SELECT * FROM assets WHERE slug = ?').get(req.params.slug)
    if (!asset) return res.status(404).json({ error: 'Not found' })
    const live = await getLiveAsset(asset)
    saveAssetSnapshot(live)
    const article = buildArticle(live.asset, live.news)
    const settings = db.prepare('SELECT * FROM asset_settings WHERE asset_slug = ?').get(asset.slug)
    const history = db.prepare('SELECT price, change_percent, source, created_at FROM price_history WHERE asset_slug = ? ORDER BY id DESC LIMIT 50').all(asset.slug)
    res.json({ ...live, article, settings, history })
  } catch (error) {
    const asset = db.prepare('SELECT * FROM assets WHERE slug = ?').get(req.params.slug)
    if (!asset) return res.status(404).json({ error: 'Not found' })
    const candles = getStoredCandles(asset.slug)
    const news = getStoredNews(asset.slug)
    const article = buildArticle(asset, news)
    const settings = db.prepare('SELECT * FROM asset_settings WHERE asset_slug = ?').get(asset.slug)
    const history = db.prepare('SELECT price, change_percent, source, created_at FROM price_history WHERE asset_slug = ? ORDER BY id DESC LIMIT 50').all(asset.slug)
    res.json({ asset, candles, news, article, settings, history, stale: true, error: String(error) })
  }
})

app.get('/api/terminal', async (_req, res) => {
  try {
    const rows = (await getLiveAssets(baseAssets())).map((x) => x.asset)
    const lines = rows.map((r) => `${r.change_percent >= 0 ? '📈' : '📉'} ${r.symbol} ${r.price} (${Number(r.change_percent).toFixed(2)}%) [${r.market}] ${r.name} via ${r.provider || 'live'}`)
    res.json({ lines })
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

app.get('/api/market/anomalies', async (req, res) => {
  try {
    const priceThreshold = Number(req.query.price || req.query.priceThreshold || 10)
    const volumeThreshold = Number(req.query.volume || req.query.volumeMultiplier || 2)
    const assets = db.prepare('SELECT slug,symbol,name,market,price,change_percent FROM assets ORDER BY abs(change_percent) DESC LIMIT 100').all()
    const rows = assets.map(a => {
      const candles = db.prepare('SELECT volume FROM candles WHERE asset_slug=? ORDER BY id DESC LIMIT 8').all(a.slug)
      const latest = Number(candles[0]?.volume || 0)
      const vols = candles.slice(1).map(c => Number(c.volume || 0)).filter(Boolean)
      const avg = vols.reduce((x, y) => x + y, 0) / Math.max(1, vols.length)
      const volumeRatio = avg ? Number((latest / avg).toFixed(2)) : 0
      return { ...a, priceMove: Number(a.change_percent || 0), volumeRatio, volume: latest, avgVolume: Number(avg.toFixed(2)) }
    }).filter(a => Math.abs(a.priceMove) >= priceThreshold || a.volumeRatio >= volumeThreshold).slice(0, 50)
    res.json({ ok: true, thresholds: { pricePercent: priceThreshold, volumeRatio: volumeThreshold }, count: rows.length, anomalies: rows })
  } catch (error) { res.status(500).json({ ok: false, error: String(error) }) }
})

app.get('/api/market-calendar', (req, res) => {
  try { getMarketCalendarStatus(req, res) }
  catch (error) { res.status(500).json({ ok: false, error: String(error) }) }
})

app.get('/api/debate/latest', (_req, res) => {
  let thread = db.prepare(`SELECT * FROM debate_threads ORDER BY id DESC LIMIT 1`).get()
  if (!thread) {
    const info = db.prepare(`INSERT INTO debate_threads (title,status) VALUES (?,?)`).run('Hermes + OpenClaw PRD Debate', 'agreed')
    const id = info.lastInsertRowid
    const msgs = [
      ['Hermes', 'Auth dulu; export guard tanpa identity = security theater.'],
      ['OpenClaw', 'Rewrite Astro penuh risk tinggi; incremental Express/Vue safer.'],
      ['Hermes', 'Private report wajib admin/signed link TTL + watermark + audit.'],
      ['OpenClaw', 'Set port 1745, seed admin/user, QA endpoints.'],
      ['Agreement', 'Implement guard/auth/audit now; note Astro/Drizzle migration as next refactor.']
    ]
    for (const [agent, message] of msgs) db.prepare(`INSERT INTO debate_messages (thread_id,agent,message) VALUES (?,?,?)`).run(id, agent, message)
    thread = db.prepare(`SELECT * FROM debate_threads WHERE id=?`).get(id)
  }
  const messages = db.prepare(`SELECT agent,message,created_at FROM debate_messages WHERE thread_id=? ORDER BY id`).all(thread.id)
  res.json({ ok: true, thread, messages })
})

// ── Report preferences / context ─────────────────────────────────────────
const defaultReportPrefs = {
  tone: 'balanced', depth: 'normal', language: 'id',
  priority_topics: 'market,indonesia,watchlist', favorite_assets: '', discord_spam_level: 'digest'
}
function cleanPref(value, allowed, fallback) {
  const v = String(value || '').trim().slice(0, 80)
  return allowed.includes(v) ? v : fallback
}

function ensureDecisionFingerprintSchema() { db.exec(`CREATE TABLE IF NOT EXISTS decision_context_fingerprints (id INTEGER PRIMARY KEY CHECK(id=1), fingerprint TEXT NOT NULL, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')));`) }
function stableHash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) } return (h >>> 0).toString(16) }
function buildDecisionContextFingerprint() {
  ensureDecisionFingerprintSchema()
  const prefs = db.prepare('SELECT * FROM user_report_preferences WHERE id=1').get() || {}
  const answers = db.prepare('SELECT key,value,confidence,source,updated_at FROM user_context_answers ORDER BY key').all()
  let assets = []; try { assets = db.prepare('SELECT symbol,name FROM assets WHERE pinned=1 OR enabled=1 ORDER BY symbol LIMIT 50').all() } catch (e) { console.error('[report-server] asset fetch failed:', e.message) }
  const payload = { goal: answers.find(a => a.key === 'goal')?.value || '', time_horizon: answers.find(a => a.key === 'time_horizon')?.value || '', watchlist_priority: answers.find(a => a.key === 'watchlist_priority')?.value || prefs.favorite_assets || '', risk_tolerance: answers.find(a => a.key === 'risk_tolerance')?.value || '', preferred_action: answers.find(a => a.key === 'preferred_action')?.value || '', language: prefs.language || 'id', depth: prefs.depth || 'normal', tone: prefs.tone || 'balanced', discord_spam_level: prefs.discord_spam_level || 'digest', assets }
  const fingerprint = stableHash(JSON.stringify(payload))
  db.prepare(`INSERT INTO decision_context_fingerprints (id,fingerprint,payload_json,context_json,updated_at) VALUES (1,?,?,?,datetime('now')) ON CONFLICT(id) DO UPDATE SET fingerprint=excluded.fingerprint,payload_json=excluded.payload_json,context_json=excluded.context_json,updated_at=datetime('now')`).run(fingerprint, JSON.stringify(payload), JSON.stringify(payload))
  return { fingerprint, payload }
}

function contextGapDetector() {
  const required = [
    ['goal', 'Tujuan utama report ini untuk apa: trading cepat, investasi panjang, riset kompetitor, atau monitoring risiko?'],
    ['time_horizon', 'Horizon keputusan yang dipakai: intraday, mingguan, bulanan, atau jangka panjang?'],
    ['watchlist_priority', 'Asset/watchlist mana yang paling prioritas hari ini?'],
    ['risk_tolerance', 'Toleransi risiko: konservatif, normal, agresif?'],
    ['preferred_action', 'Output aksi yang diinginkan: buy/sell/watch, risk alert, atau research note?']
  ]
  const rows = db.prepare('SELECT key,value,confidence,source,updated_at FROM user_context_answers').all()
  const map = new Map(rows.map(r => [r.key, r]))
  const missing = required.filter(([k]) => !map.has(k) || !String(map.get(k).value || '').trim())
  const questions = missing.slice(0, 3).map(([key, question]) => ({ key, question }))
  const assumptions = missing.map(([key]) => ({ key, value: inferContextAssumption(key), confidence: 0.35, source: 'inferred' }))
  return { required: required.map(([key]) => key), answers: Object.fromEntries(rows.map(r => [r.key, r])), missing: missing.map(([key]) => key), questions, assumptions, confidence: missing.length ? 'low' : 'high' }
}
function inferContextAssumption(key) {
  const fallback = { goal: 'monitoring risiko dan peluang market harian', time_horizon: 'harian sampai mingguan', watchlist_priority: 'watchlist aktif + USD/IDR + JKSE', risk_tolerance: 'normal', preferred_action: 'watch + risk alert + next signal' }
  return fallback[key] || 'unknown'
}

app.get('/api/report-context/gaps', (_req, res) => res.json({ ok: true, ...contextGapDetector() }))
app.put('/api/report-context/answer', (req, res) => {
  const key = String(req.body?.key || '').replace(/[^a-z_]/g, '').slice(0, 40)
  const value = String(req.body?.value || '').trim().slice(0, 500)
  if (!key || !value) return res.status(400).json({ ok: false, error: 'key/value required' })
  db.prepare(`INSERT INTO user_context_answers (key,value,confidence,source,updated_at) VALUES (?,?,?,?,datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, confidence=excluded.confidence, source=excluded.source, updated_at=datetime('now')`).run(key, value, Number(req.body?.confidence ?? 1), 'user')
  res.json({ ok: true, ...contextGapDetector() })
})

app.get('/api/decision-context/fingerprint', (_req, res) => { try { res.json({ ok: true, ...buildDecisionContextFingerprint() }) } catch (error) { res.status(500).json({ ok: false, error: String(error) }) } })
app.post('/api/decision-context/fingerprint/refresh', (_req, res) => { try { res.json({ ok: true, ...buildDecisionContextFingerprint() }) } catch (error) { res.status(500).json({ ok: false, error: String(error) }) } })

app.get('/api/report-preferences', (_req, res) => {
  const row = db.prepare('SELECT * FROM user_report_preferences WHERE id = 1').get()
  res.json({ ok: true, preferences: { ...defaultReportPrefs, ...(row || {}) } })
})

app.put('/api/report-preferences', (req, res) => {
  const body = req.body || {}
  const prefs = {
    tone: cleanPref(body.tone, ['concise', 'balanced', 'analytical'], defaultReportPrefs.tone),
    depth: cleanPref(body.depth, ['brief', 'normal', 'deep'], defaultReportPrefs.depth),
    language: cleanPref(body.language, ['id', 'en', 'mixed'], defaultReportPrefs.language),
    priority_topics: String(body.priority_topics || defaultReportPrefs.priority_topics).replace(/[^\w\s,.-]/g, '').slice(0, 240),
    favorite_assets: String(body.favorite_assets || '').replace(/[^\w\s,.-]/g, '').slice(0, 240),
    discord_spam_level: cleanPref(body.discord_spam_level, ['digest', 'normal', 'full'], defaultReportPrefs.discord_spam_level)
  }
  db.prepare(`INSERT INTO user_report_preferences (id,tone,depth,language,priority_topics,favorite_assets,discord_spam_level,updated_at)
    VALUES (1,@tone,@depth,@language,@priority_topics,@favorite_assets,@discord_spam_level,datetime('now'))
    ON CONFLICT(id) DO UPDATE SET tone=excluded.tone, depth=excluded.depth, language=excluded.language, priority_topics=excluded.priority_topics, favorite_assets=excluded.favorite_assets, discord_spam_level=excluded.discord_spam_level, updated_at=datetime('now')`).run(prefs)
  res.json({ ok: true, preferences: prefs })
})

// ── User Persona API ─────────────────────────────────────────────────────
app.get('/api/user/persona', (req, res) => {
  const user = requireUser(req, res)
  if (!user) return
  try {
    const persona = getPersona(db, user.id)
    res.json({ ok: true, persona })
  } catch (error) { res.status(500).json({ ok: false, error: String(error) }) }
})

app.patch('/api/user/persona', (req, res) => {
  const user = requireUser(req, res)
  if (!user) return
  try {
    const persona = upsertPersona(db, user.id, req.body || {})
    res.json({ ok: true, persona })
  } catch (error) { res.status(500).json({ ok: false, error: String(error) }) }
})

app.get('/api/user/persona/infer', (req, res) => {
  const user = requireUser(req, res)
  if (!user) return
  try {
    const persona = inferPersonaFromActivity(db, user.id)
    res.json({ ok: true, persona, source: 'activity_inference' })
  } catch (error) { res.status(500).json({ ok: false, error: String(error) }) }
})

// ── Report Canvas API ────────────────────────────────────────────────────
const _canvasReportDir = path.join(__dirname, '..', '..', 'reports')
const reportDir = _canvasReportDir

app.get('/api/report/:slug/canvas', (req, res) => {
  const user = requireUser(req, res)
  if (!user) return
  try {
    const slug = String(req.params.slug).replace(/[^0-9-]/g, '')
    const canvas = getCanvas(db, _canvasReportDir, slug, user.id)
    if (!canvas) return res.status(404).json({ ok: false, error: 'report_not_found' })
    res.json({ ok: true, ...canvas })
  } catch (error) { res.status(500).json({ ok: false, error: String(error) }) }
})

app.post('/api/report/:slug/canvas/save', (req, res) => {
  const user = requireUser(req, res)
  if (!user) return
  try {
    const slug = String(req.params.slug).replace(/[^0-9-]/g, '')
    const body = req.body || {}
    if (body.sectionOrder && !Array.isArray(body.sectionOrder)) return res.status(400).json({ ok: false, error: 'sectionOrder must be array' })
    if (body.hiddenSections && !Array.isArray(body.hiddenSections)) return res.status(400).json({ ok: false, error: 'hiddenSections must be array' })
    const canvas = saveCanvas(db, slug, user.id, {
      sectionOrder: (body.sectionOrder || []).slice(0, 25),
      overrides: typeof body.overrides === 'object' && body.overrides ? body.overrides : {},
      notes: typeof body.notes === 'object' && body.notes ? body.notes : {},
      hiddenSections: (body.hiddenSections || []).filter(k => typeof k === 'string').slice(0, 25),
    })
    res.json({ ok: true, canvas })
  } catch (error) { res.status(500).json({ ok: false, error: String(error) }) }
})

app.get('/api/report/:slug/export', (req, res) => {
  const user = requireUser(req, res)
  if (!user) return
  try {
    const slug = String(req.params.slug).replace(/[^0-9-]/g, '')
    const format = String(req.query.format || 'md').toLowerCase()
    const result = exportReport(db, _canvasReportDir, slug, user.id, format)
    if (!result.ok) return res.status(result.error === 'report_not_found' ? 404 : 400).json(result)
    res.setHeader('Content-Type', result.mime)
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`)
    res.send(fs.readFileSync(result.filePath, 'utf8'))
  } catch (error) { res.status(500).json({ ok: false, error: String(error) }) }
})

app.get('/api/report-exports/cleanup', (req, res) => {
  try {
    const cleaned = cleanupExpiredExports(db, _canvasReportDir)
    res.json({ ok: true, cleaned })
  } catch (error) { res.status(500).json({ ok: false, error: String(error) }) }
})

// ── RAG storage API ──────────────────────────────────────────────────────
app.get('/api/rag/storage', (_req, res) => {
  try { res.json({ ok: true, stats: ragStorageStats() }) }
  catch (error) { res.status(500).json({ ok: false, error: String(error) }) }
})

app.post('/api/rag/cleanup', (req, res) => {
  try { res.json(cleanupRagStore({ maxAgeDays: Number(req.body?.maxAgeDays || 60), maxChunks: Number(req.body?.maxChunks || 20000) })) }
  catch (error) { res.status(500).json({ ok: false, error: String(error) }) }
})

app.post('/api/rag/vectorize-missing', (req, res) => {
  try { res.json(vectorizeMissingChunks({ limit: Number(req.body?.limit || req.query.limit || 100) })) }
  catch (error) { res.status(500).json({ ok: false, error: String(error) }) }
})

// ── Web search helper ────────────────────────────────────────────────────
function webSearchOptions(body = {}, defaultLimit = 10) {
  return {
    limit: Number(body?.limit || defaultLimit), engines: body?.engines || ['duckduckgo'], mode: String(body?.mode || ''),
    preferTrusted: body?.preferTrusted !== false, sites: Array.isArray(body?.sites) ? body.sites : [],
    domains: Array.isArray(body?.domains) ? body.domains : [], site: String(body?.site || ''),
    excludeSites: Array.isArray(body?.excludeSites) ? body.excludeSites : [],
    filetype: String(body?.filetype || ''), intitle: String(body?.intitle || ''), exact: String(body?.exact || ''),
    after: String(body?.after || ''), before: String(body?.before || ''), time_range: String(body?.time_range || body?.timeRange || ''),
    mustHave: Array.isArray(body?.mustHave) ? body.mustHave : [], autoPreview: body?.autoPreview === true,
    previewLimit: Number(body?.previewLimit || 3), dynamic: body?.dynamic !== false
  }
}

// ── Search API ───────────────────────────────────────────────────────────
app.get('/api/search/trusted-sources', (_req, res) => res.json({ ok: true, sources: TRUSTED_WEB_SOURCES }))
app.post('/api/search/web', async (req, res) => {
  try { const q = String(req.body?.query || ''); const opts = webSearchOptions(req.body, 10); const out = await webSearch(q, opts); if (!out.results?.length) out.fallbackResults = ragHybridSearch(q, { limit: opts.limit, section: 'web-fallback' }).map(r => ({ ...r, source: 'local_rag_fallback' })); res.json(out) }
  catch (error) { res.status(500).json({ ok: false, error: String(error) }) }
})

app.post('/api/search/web-to-crawl', async (req, res) => {
  try { const q = String(req.body?.query || ''); const opts = webSearchOptions(req.body, 8); const out = await webSearch(q, opts); if (!out.results?.length) out.fallbackResults = ragHybridSearch(q, { limit: opts.limit, section: 'web-fallback' }).map(r => ({ ...r, source: 'local_rag_fallback' })); const filtered = await filterSearchForCrawl(out.results, { allowUntrusted: true, openDocsOnly: !!req.body?.openDocsOnly }); for (const r of filtered.filter(x => x.crawlAllowed).slice(0, Number(req.body?.enqueueLimit || 3))) enqueueRagCrawl(r.url, { source: r.domain, assetTags: req.body?.assetTags || [] }); res.json({ ...out, crawlCandidates: filtered }) }
  catch (error) { res.status(500).json({ ok: false, error: String(error) }) }
})

app.post('/api/search/deep', async (req, res) => {
  try {
    const target = String(req.body?.query || req.body?.target || '').trim()
    if (!target) return res.status(400).json({ ok: false, error: 'query_required' })
    const isUrl = /^https?:\/\//i.test(target)
    const queries = isUrl ? [target, `"${target}"`] : [target, `"${target.replace(/"/g, '')}"`, `${target} pdf`, `${target} jurnal OR journal OR repository`, `${target} reddit OR forum OR medium OR substack`]
    const modes = req.body?.modes || ['', 'official', 'market', 'journal', 'thesis', 'forum', 'blog', 'coding', 'marketing']
    const limit = Number(req.body?.limit || 30)
    const all = []; const errors = []
    for (const q of queries.slice(0, Number(req.body?.queryPasses || 2))) for (const mode of modes.slice(0, Number(req.body?.modePasses || 1))) {
      const out = await webSearch(q, { limit: Math.min(8, limit), engines: req.body?.engines || ['duckduckgo','bing','yahoo','yandex'], mode, dynamic: false, preferTrusted: req.body?.preferTrusted !== false }).catch(e => ({ ok: false, error: String(e), results: [] }))
      if (out.error) errors.push({ q, mode, error: out.error }); else all.push(...(out.results || []))
    }
    function searchRelevance(target = '', r = {}) {
      const terms = String(target).toLowerCase().split(/[^a-z0-9]+/).filter(x => x.length > 2)
      const hay = `${r.title || ''} ${r.snippet || ''} ${r.url || ''}`.toLowerCase()
      const exact = hay.includes(String(target).toLowerCase()) ? 30 : 0
      const hits = terms.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0)
      return Math.min(100, exact + Math.round((hits / Math.max(1, terms.length)) * 60) + (r.openDoc ? 10 : 0) + (r.social ? -10 : 0))
    }
    const seen = new Set(); const results = []
    for (const r of all) { const k = String(r.url || '').replace(/[#?].*$/, ''); if (!k || seen.has(k)) continue; seen.add(k); const cls = classifySearchResult(r); results.push({ ...r, ...cls, relevance: searchRelevance(target, { ...r, ...cls }) }) }
    results.sort((a, b) => b.relevance - a.relevance || (b.quality || 0) - (a.quality || 0))
    res.json({ ok: true, target, summary: { results: results.length }, results: results.slice(0, limit), errors })
  } catch (error) { res.status(500).json({ ok: false, error: String(error) }) }
})

app.post('/api/search/profile-safe', async (req, res) => {
  try {
    const name = String(req.body?.name || req.body?.query || '').trim()
    if (!name) return res.status(400).json({ ok: false, error: 'name_required' })
    const deep = req.body?.deep === true
    const out = await webSearch(deep ? name : `"${name.replace(/"/g, '')}"`, { limit: Number(req.body?.limit || 20), engines: req.body?.engines || ['duckduckgo','bing','yahoo','yandex'], preferTrusted: false, dynamic: deep, mode: req.body?.mode || '' })
    const results = (out.results || []).map(r => ({ ...r, ...classifySearchResult(r) }))
    res.json({ ok: true, name, results })
  } catch (error) { res.status(500).json({ ok: false, error: String(error) }) }
})

function stableFingerprint(input = {}) {
  const core = JSON.stringify(input, Object.keys(input).sort())
  return crypto.createHash('sha256').update(core).digest('hex').slice(0, 24)
}
app.post('/api/decision-context/fingerprint', (req, res) => {
  const user = getUserFromReq(req)
  const context = { intent: String(req.body?.intent || ''), route: String(req.body?.route || ''), asset: req.body?.asset || '', horizon: req.body?.horizon || '', risk: req.body?.risk || '', evidence_ids: req.body?.evidence_ids || [], prefs: req.body?.prefs || {}, ts_bucket: new Date().toISOString().slice(0, 10) }
  const fingerprint = stableFingerprint(context)
  db.prepare(`INSERT OR IGNORE INTO decision_context_fingerprints (fingerprint,user_id,route,intent,context_json) VALUES (?,?,?,?,?)`).run(fingerprint, user?.id || null, context.route, context.intent, JSON.stringify(context))
  res.json({ ok: true, fingerprint, context })
})

// ── TradingView routes ───────────────────────────────────────────────────
app.get('/api/tradingview/screener', async (req, res) => {
  try {
    const market = String(req.query.market || 'crypto')
    const filters = { limit: Math.min(Number(req.query.limit || 50), 200), sortBy: String(req.query.sortBy || 'volume'), sortOrder: String(req.query.sortOrder || 'desc') }
    if (req.query.columns) filters.columns = String(req.query.columns).split(',').map(s => s.trim())
    if (req.query.filter) { try { filters.filter = JSON.parse(req.query.filter) } catch (e) { console.error('[report-server] filter parse failed:', e.message) } }
    res.json(await getTradingViewScreener(market, filters))
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

app.get('/api/tradingview/chart/:symbol', async (req, res) => {
  try { res.json(await getTradingViewChart(req.params.symbol, String(req.query.timeframe || 'D'))) }
  catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

app.get('/api/tradingview/technical/:symbol', async (req, res) => {
  try { res.json(await getTradingViewTechnical(req.params.symbol, String(req.query.timeframe || 'D'))) }
  catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

app.get('/api/tradingview/news/:symbol', async (req, res) => {
  try { res.json(await getTradingViewNews(req.params.symbol, Number(req.query.limit || 15))) }
  catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

app.get('/api/tradingview/popular', async (req, res) => {
  try { res.json(await getTradingViewPopular(String(req.query.market || 'crypto'))) }
  catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ── Alerts API ───────────────────────────────────────────────────────────
app.get('/api/alerts/live', (_req, res) => {
  const alerts = db.prepare(`SELECT a.*, n.link AS news_link, n.title AS news_title FROM alerts a LEFT JOIN news n ON n.id = (SELECT id FROM news WHERE asset_slug = a.asset_slug ORDER BY id DESC LIMIT 1) ORDER BY a.id DESC LIMIT 10`).all()
  res.json({ alerts })
})

app.post('/api/alerts/test', async (req, res) => {
  const { slug } = req.body
  const asset = db.prepare('SELECT * FROM assets WHERE slug = ?').get(slug)
  if (!asset) return res.status(404).json({ error: 'Asset not found' })
  try {
    const live = await getLiveAsset(asset)
    saveAssetSnapshot(live)
    const a = live.asset
    const title = `${a.name} alert`
    const message = `${a.symbol} bergerak ke ${a.price} (${a.change_percent}%). Pantau alasan naik/turun di halaman detail.`
    const info = db.prepare(`INSERT INTO alerts (asset_slug, title, message, discord_sent, created_at) VALUES (?, ?, ?, 0, datetime('now'))`).run(a.slug, title, message)
    await sendDiscordAlert({ title, message, slug: a.slug, symbol: a.symbol, price: a.price, changePercent: a.change_percent, detailUrl: `${APP_CONFIG.publicBaseUrl}/asset/${a.slug}` })
    db.prepare('UPDATE alerts SET discord_sent = 1 WHERE id = ?').run(info.lastInsertRowid)
    res.json({ ok: true, sent: true, title, message, slug: a.slug })
  } catch (error) {
    res.status(500).json({ ok: false, sent: false, error: String(error), slug: asset.slug })
  }
})

// ── Suggested alerts ─────────────────────────────────────────────────────
import { insertSuggestedAlerts, listSuggestedAlerts, approveSuggestedAlert, rejectSuggestedAlert, suggestedAlertCount } from './db.js'
import { extractAlertCandidates, buildSuggestedAlertsBlock } from './ai-daily-report.js'

const MAX_PENDING_ALERTS = 5

app.get('/api/alerts/suggested', (_req, res) => {
  try {
    const status = String(_req.query.status || 'pending')
    const limit = Math.min(50, Number(_req.query.limit || 20))
    const rows = listSuggestedAlerts(status, limit)
    const pendingCount = suggestedAlertCount('pending')
    res.json({ ok: true, pending_count: pendingCount, max_pending: MAX_PENDING_ALERTS, count: rows.length, alerts: rows })
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }) }
})

app.post('/api/alerts/suggested/generate', async (_req, res) => {
  const user = requireUser(_req, res)
  if (!user) return
  try {
    const saved = latestSavedReport()
    const topics = Array.isArray(saved?.topics) ? saved.topics : []
    if (!topics.length) return res.json({ ok: false, error: 'no_report_topics' })
    const candidates = extractAlertCandidates(topics)
    const pendingCount = suggestedAlertCount('pending')
    const canAdd = Math.max(0, MAX_PENDING_ALERTS - pendingCount)
    if (canAdd <= 0) return res.json({ ok: true, inserted: 0, skipped: candidates.length, pending_count: pendingCount, max_pending: MAX_PENDING_ALERTS, message: 'pending cap reached' })
    const toInsert = candidates.slice(0, canAdd)
    const slug = saved?.slug || new Date().toISOString().slice(0, 10)
    toInsert.forEach(a => a.report_slug = slug)
    const count = insertSuggestedAlerts(toInsert)
    res.json({ ok: true, inserted: count, total_candidates: candidates.length, skipped: Math.max(0, candidates.length - count), pending_count: suggestedAlertCount('pending') })
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }) }
})

app.post('/api/alerts/suggested/:id/approve', (req, res) => {
  const user = requireUser(req, res)
  if (!user) return
  try {
    const id = Number(req.params.id)
    if (!id) return res.status(400).json({ ok: false, error: 'invalid_id' })
    const result = approveSuggestedAlert(id)
    if (!result.ok) return res.status(result.error === 'not_found' ? 404 : 400).json(result)
    res.json(result)
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }) }
})

app.post('/api/alerts/suggested/:id/reject', (req, res) => {
  const user = requireUser(req, res)
  if (!user) return
  try {
    const id = Number(req.params.id)
    if (!id) return res.status(400).json({ ok: false, error: 'invalid_id' })
    const reason = String(req.body?.reason || '').slice(0, 500)
    const result = rejectSuggestedAlert(id, reason)
    if (!result.ok) return res.status(result.error === 'not_found' ? 404 : 400).json(result)
    res.json(result)
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }) }
})

app.get('/api/alerts/suggested/block', (_req, res) => {
  try {
    const status = String(_req.query.status || 'pending')
    const rows = listSuggestedAlerts(status, 10)
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.send(buildSuggestedAlertsBlock(rows))
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }) }
})

// ── Report helper functions ──────────────────────────────────────────────
function usableTopics(topics) { return Array.isArray(topics) && topics.reduce((s, t) => s + (t.items?.length || 0), 0) >= 20 }
function latestSavedReport() {
  if (!fs.existsSync(reportDir)) return null
  const files = fs.readdirSync(reportDir).filter(f => f.endsWith('.json')).sort().reverse()
  for (const f of files) {
    const d = JSON.parse(fs.readFileSync(path.join(reportDir, f), 'utf8'))
    if (usableTopics(d.topics)) return { ...d, fallbackFrom: f.replace('.json', '') }
  }
  return null
}

app.get('/api/report-health', (_req, res) => {
  const rd = path.join(__dirname, '..', '..', 'reports')
  const files = fs.existsSync(rd) ? fs.readdirSync(rd).filter(f => f.endsWith('.json')).sort().reverse() : []
  const latest = files[0]?.replace('.json', '') || null
  const has = latest ? (ext) => fs.existsSync(path.join(rd, `${latest}.${ext}`)) : () => false
  const delivery = latest ? db.prepare('SELECT step,status,detail,created_at FROM delivery_log WHERE slug IN (?,?) ORDER BY id DESC LIMIT 12').all(latest, 'daily') : []
  const queueSummary = db.prepare(`SELECT status, count(*) AS count FROM send_queue GROUP BY status`).all()
  const sendQueue = db.prepare(`SELECT id,slug,channel,step,status,attempts,last_error,next_attempt_at,created_at FROM send_queue WHERE status IN ('pending','failed') ORDER BY id DESC LIMIT 12`).all()
  res.json({ ok: true, bot: 'report-server', latest_report: latest, deliverables: latest ? { html: has('html'), json: has('json'), md: has('md'), card: fs.existsSync(path.join(rd, `${latest}-card.png`)) } : {}, delivery, send_queue: { summary: queueSummary, pending_failed: sendQueue }, local: `${APP_CONFIG.publicBaseUrl}/report/${latest}`, tailscale: `${APP_CONFIG.tailscaleBaseUrl}/report/${latest}` })
})

function latestReportTopics() {
  const saved = latestSavedReport()
  return Array.isArray(saved?.topics) ? saved.topics : []
}

// ── Incidents ────────────────────────────────────────────────────────────
app.get('/api/incidents', (_req, res) => {
  const reportSlug = latestSavedReport()?.slug || ''
  const items = latestReportTopics().flatMap(t => (t.items || []).map(i => ({ ...i, section: t.title })))
  const incidents = items
    .filter(i => /outage|incident|blackout|gangguan|down|pemadaman|breach|hack|ransomware/i.test(`${i.title || ''} ${i.snippet || ''}`))
    .slice(0, 25)
    .map(i => {
      const severity = classifyIncidentSeverity(i)
      const title_hash = incidentTitleHash(i.title)
      const recovery_status = trackRecoveryStatus(i, reportSlug)
      const status_history = getIncidentStatusHistory(title_hash)
      return { title: i.title || '', title_hash, source: i.source || 'unknown', section: i.section || '', url: i.url || i.link || '', severity, recovery_status, status_history, customer_impact: estimateCustomerImpact(i), action: ['critical', 'high'].includes(severity) ? 'notify + monitor recovery' : 'monitor' }
    })
  res.json({ ok: true, count: incidents.length, incidents })
})

app.get('/api/incidents/:titleHash/history', (req, res) => {
  const history = getIncidentStatusHistory(req.params.titleHash)
  res.json({ ok: true, titleHash: req.params.titleHash, count: history.length, history })
})

app.post('/api/incidents/status/update', (req, res) => {
  const { title_hash, title, status, note } = req.body || {}
  if (!title_hash || !status) return res.status(400).json({ ok: false, error: 'title_hash and status required' })
  const result = manualUpdateIncidentStatus({ titleHash: title_hash, title: title || '', status, note: note || '' })
  if (!result.ok) return res.status(400).json(result)
  res.json(result)
})

app.post('/api/incidents/bulk-update', (req, res) => {
  const { statuses } = req.body || {}
  if (!Array.isArray(statuses)) return res.status(400).json({ ok: false, error: 'statuses array required' })
  const results = statuses.map(s => manualUpdateIncidentStatus({ titleHash: s.title_hash, title: s.title || '', status: s.status, note: s.note || '' }))
  res.json({ ok: true, updated: results.filter(r => r.ok).length, total: results.length, results })
})

// ── Source Reliability ───────────────────────────────────────────────────
app.get('/api/source-trust', (_req, res) => {
  try {
    const all = listSourceReliability()
    res.json({ ok: true, sources: all, count: all.length })
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

app.get('/api/source-trust/check', (req, res) => {
  const source = String(req.query.source || '').trim()
  if (!source) return res.status(400).json({ ok: false, error: 'source query param required' })
  const url = String(req.query.url || '').trim()
  res.json({ ok: true, source, trust: scoreSourceTrust(source, url) })
})

// ── QA Gate: check report quality before publishing ────────────────────
function runQA(slug) {
  try {
    const fp = path.join(__dirname, '..', '..', 'reports', `${slug}.json`)
    if (!fs.existsSync(fp)) return { passed: false, errors: [`Report JSON not found: ${slug}`] }
    const report = JSON.parse(fs.readFileSync(fp, 'utf8'))
    const errors = []
    const warnings = []

    // 1. Empty sections check
    report.topics?.forEach((t, i) => {
      const items = t.items || []
      if (items.length === 0) errors.push(`Empty section: "${t.title}" (0 items)`)
      if (items.length < 2) warnings.push(`Low items in section "${t.title}": ${items.length}`)
    })

    // 2. Title coverage
    report.topics?.forEach(t => {
      t.items?.forEach((item, i) => {
        if (!item.title || item.title.length < 3) warnings.push(`Item ${i} in "${t.title}" has missing/short title`)
        if (!item.url && !item.snippet) warnings.push(`Item "${item.title?.slice(0,50)}" has no URL or snippet`)
      })
    })

    // 3. Hallucination check — look for citations without corresponding source/url
    const fullText = report.textReport || ''
    const fakeCitationRe = /(?:menurut sebuah penelitian|menurut studi|sebuah studi dari|researchers at|according to a (?:study|report|analysis)|a recent (?:study|report|analysis) by)/gi
    const fakeMatches = fullText.match(fakeCitationRe)
    if (fakeMatches) fakeMatches.forEach(m => warnings.push(`Possible hallucinated/citation-gap: "${m.slice(0,80)}..."`))

    // 4. Source attribution
    let totalItems = 0
    let itemsWithUrl = 0
    report.topics?.forEach(t => t.items?.forEach(item => {
      totalItems++
      if (item.url) itemsWithUrl++
    }))
    const urlCoverage = totalItems > 0 ? itemsWithUrl / totalItems : 1
    if (urlCoverage < 0.3) warnings.push(`Low URL coverage: ${Math.round(urlCoverage * 100)}% of items have source URL`)

    // 5. Report freshness
    const dateStr = report.date || report.slug || ''
    if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const reportDate = new Date(dateStr + 'T23:59:59+07:00')
      const now = new Date()
      const daysOld = (now - reportDate) / 86400000
      if (daysOld > 1.5) warnings.push(`Report is ${Math.round(daysOld)} days old`)
    }

    return { passed: errors.length === 0, errors, warnings }
  } catch (e) {
    return { passed: false, errors: [`QA error: ${e.message}`], warnings: [] }
  }
}

// ── AI Daily Report ──────────────────────────────────────────────────────
async function generateAndSendDailyReport(reason = 'manual') {
  let { topics } = await generateAiDailyReport()
  let fallbackFrom = null
  if (!usableTopics(topics)) {
    const saved = latestSavedReport()
    if (saved) { topics = saved.topics; fallbackFrom = saved.fallbackFrom; console.warn(`[ai-report] ${reason} sparse, fallback=${fallbackFrom}`) }
  }
  setImmediate(() => autoEnrichReportWeb(topics, { queryLimit: 3, perQueryLimit: 4, enqueueLimit: 8 }).catch(e => console.error('[ai-report-web-enrich]', e.message || e)))
  const defaultUser = db.prepare('SELECT id FROM users LIMIT 1').get()
  const persona = defaultUser ? getPersona(db, defaultUser.id) : null
  const personaPrompt = persona ? buildContextPrompt(persona) : ''
  const textReport = buildTextReport(topics, { persona, personaPrompt })
  let embed
  try { embed = buildDiscordEmbed(topics) } catch (_) { embed = null }
  const { slug } = await saveReport(topics, textReport).catch(() => ({ slug: null }))

  // ── QA Gate ──
  if (slug) {
    const qa = runQA(slug)
    console.log(`[qa] ${slug}: ${qa.passed ? 'PASS' : 'FAIL'} (${qa.warnings.length} warnings, ${qa.errors.length} errors)`)
    qa.warnings.forEach(w => console.warn(`[qa ⚠] ${w}`))
    if (qa.errors.length > 0) {
      console.error(`[qa ✗] Report ${slug} has QA failures — still delivering but flagged`)
      db.prepare(`INSERT OR REPLACE INTO discord_settings (key, value, updated_at) VALUES ('qa_${slug}_errors', ?, datetime('now'))`).run(qa.errors.join('; '))
    }
  }

  await sendAiReportToUser(textReport, embed, topics)
  return { slug, fallbackFrom, topics }
}

app.post('/api/ai-daily-report/web-enrich', async (req, res) => {
  try {
    const out = await generateAiDailyReport()
    const topics = out.topics || out
    const enriched = await autoEnrichReportWeb(topics, { queryLimit: Number(req.body?.queryLimit || 5), perQueryLimit: Number(req.body?.perQueryLimit || 5), enqueueLimit: Number(req.body?.enqueueLimit || 10) })
    res.json(enriched)
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }) }
})

app.post('/api/ai-daily-report/generate', async (_req, res) => {
  try {
    const { slug, fallbackFrom, topics } = await generateAndSendDailyReport('api')
    res.json({ ok: true, slug, webUrl: slug ? `/report/${slug}` : null, fallbackFrom, topics: topics.map(t => ({ title: t.title, items: t.items.length })) })
  } catch (e) {
    console.error('[api] ai-daily-report failed:', e)
    res.status(500).json({ ok: false, error: e.message })
  }
})

app.get('/api/ai-daily-report/preview', async (_req, res) => {
  try {
    let { topics } = await generateAiDailyReport()
    let fallbackFrom = null
    if (!usableTopics(topics)) {
      const saved = latestSavedReport()
      if (saved) { topics = saved.topics; fallbackFrom = saved.fallbackFrom; console.warn(`[ai-report] preview sparse, fallback=${fallbackFrom}`) }
    }
    const defaultUser = db.prepare('SELECT id FROM users LIMIT 1').get()
    const persona = defaultUser ? getPersona(db, defaultUser.id) : null
    const personaPrompt = persona ? buildContextPrompt(persona) : ''
    const textReport = buildTextReport(topics, { persona, personaPrompt })
    res.json({ ok: true, topics, textReport, fallbackFrom })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

app.get('/api/ai-daily-report/catchup', async (_req, res) => {
  try {
    const slug = todaySlug()
    if (reportExists(slug)) return res.json({ ok: false, skipped: true, reason: 'already-exists', slug })
    const result = await generateAndSendDailyReport('catchup-api')
    return res.json({ ok: true, slug: result.slug })
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

function todaySlug() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) }
function reportExists(slug = todaySlug()) { return fs.existsSync(path.join(reportDir, `${slug}.json`)) }

// ── Report page routes (HTML views) ─────────────────────────────────────
app.get('/market', (_req, res) => {
  res.redirect(APP_CONFIG.publicBaseUrl + '/')
})

// Report portal list
app.get('/report', (_req, res) => {
  // Market overview from DB
  let marketHtml = ''
  try {
    const marketAssets = db.prepare(`SELECT symbol, name, market, price, change_percent FROM assets WHERE slug IN ('jkse','usdidr','btcusdt','ethusdt','spy','qqq','xauusd','eurusd','gbpusd','sgdidr','myridr') ORDER BY CASE slug WHEN 'jkse' THEN 1 WHEN 'usdidr' THEN 2 WHEN 'btcusdt' THEN 3 WHEN 'ethusdt' THEN 4 WHEN 'spy' THEN 5 WHEN 'qqq' THEN 6 WHEN 'xauusd' THEN 7 WHEN 'eurusd' THEN 8 WHEN 'gbpusd' THEN 9 WHEN 'sgdidr' THEN 10 WHEN 'myridr' THEN 11 ELSE 99 END`).all()
    if (marketAssets.length) {
      const fmtPrice = (p) => { const n = Number(p); if (!n || n === 0) return '-'; if (n > 100000) return n.toLocaleString('id-ID', { maximumFractionDigits: 0 }); if (n > 100) return n.toLocaleString('id-ID', { maximumFractionDigits: 1 }); return n.toLocaleString('id-ID', { maximumFractionDigits: 4 }) }
      const cardsHtml = marketAssets.map(a => {
        const chg = Number(a.change_percent) || 0
        const cls = chg >= 0 ? 'up' : 'down'
        return `<div class="mo-card"><div class="mo-sym">${(a.symbol || '').toUpperCase()}</div><div class="mo-price">${fmtPrice(a.price)}</div><div class="mo-chg ${cls}">${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%</div><div class="mo-name">${(a.name || '').replace(/</g, '<')}</div></div>`
      }).join('')
      marketHtml = `<section class="market-overview"><div class="mo-header">📊 Market Overview · Live Data</div><div class="mo-grid">${cardsHtml}</div></section>`
    }
  } catch (e) { console.error('[report-server] live assets fetch failed:', e.message) }

  const files = fs.existsSync(reportDir) ? fs.readdirSync(reportDir).filter(f => f.endsWith('.json')).sort().reverse() : []
  const cards = files.map((f) => {
    const slug = f.replace('.json', '')
    const d = JSON.parse(fs.readFileSync(path.join(reportDir, f), 'utf8'))
    const total = (d.topics || []).reduce((s, t) => s + (t.items?.length || 0), 0)
    const hero = (d.topics || []).flatMap(t => t.items || []).find(i => i.title) || {}
    const title = (hero.title || 'AI Daily Report').replace(/[<>&"]/g, '')
    return `<a class="card" href="/report/${slug}"><img src="/report/${slug}/card.png" alt=""><div class="date">${slug}</div><h2>${title}</h2><p>${total} items • ${(d.topics || []).length} sections</p></a>`
  }).join('')
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.send(`<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI Report Archive</title><style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800;900&display=swap');*{box-sizing:border-box}body{margin:0;background:#0a0a0f;color:#e4e4e7;font-family:'Geist',Inter,system-ui,sans-serif}.wrap{max-width:1100px;margin:auto;padding:28px 16px 60px}.mast{border-bottom:1px solid rgba(255,255,255,.06);padding-bottom:18px;margin-bottom:24px}.k{font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:#14b8a6}h1{font-size:clamp(32px,8vw,72px);line-height:.92;margin:6px 0 8px;font-weight:700;letter-spacing:-.04em;color:#fff}.sub{font-size:15px;color:#a1a1aa}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}.card{display:block;text-decoration:none;color:inherit;background:#fff;border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:12px;min-height:190px;transition:all .15s;background:#111118}.card:hover{transform:translateY(-2px);border-color:rgba(20,184,166,.3)}.card img{width:100%;aspect-ratio:4/5;object-fit:cover;border:2px solid #111;margin-bottom:12px}.date{font-size:12px;font-weight:900;color:#14b8a6;letter-spacing:.08em;text-transform:uppercase}.card h2{font-size:20px;line-height:1.1;margin:12px 0 8px;font-weight:600;letter-spacing:-.02em;color:#fff}.card p{color:#a1a1aa;font-weight:400;font-size:13px}@media(max-width:600px){.card{min-height:auto}h1{font-size:44px}}.market-overview{margin-bottom:28px;border:2px solid #111;box-shadow:6px 6px 0 #111;background:#fff;padding:16px}.mo-header{font-size:14px;font-weight:900;color:#7c2d12;margin-bottom:14px;letter-spacing:.05em}.mo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px}.mo-card{background:#fafaf9;border:2px solid #e7e5e4;padding:10px;border-radius:4px;text-align:center}.mo-sym{font-size:11px;font-weight:900;letter-spacing:.1em;text-transform:uppercase;color:#7c2d12}.mo-price{font-size:16px;font-weight:900;color:#151515;margin:4px 0 2px}.mo-chg{font-size:12px;font-weight:800}.mo-chg.up{color:#16a34a}.mo-chg.down{color:#dc2626}.mo-name{font-size:10px;color:#57534e;margin-top:2px}
  </style></head><body><main class="wrap"><section class="mast"><div class="k">Little Candle Archive</div><h1>AI Report<br>Portal</h1><p class="sub">Headline besar, ringkasan cepat, full report, PDF, dan content ideas.</p></section>${marketHtml}<section class="grid">${cards || '<p>No reports yet.</p>'}</section></main></body></html>`)
})

app.get('/report/:slug/card.png', (req, res) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.slug)) return res.status(404).send('Card not found')
  const png = path.join(reportDir, `${req.params.slug}-card.png`)
  const svg = path.join(reportDir, `${req.params.slug}-card.svg`)
  const fp = fs.existsSync(png) ? png : svg
  if (!fs.existsSync(fp)) return res.status(404).send('Card not found')
  res.setHeader('Content-Type', fp.endsWith('.png') ? 'image/png' : 'image/svg+xml')
  res.sendFile(fp)
})

app.get('/report/:slug', (req, res) => {
  const ua = req.headers['user-agent'] || ''
  const isBot = /bot|spider|crawl|googlebot|bingbot|slurp|duckduckbot|yandexbot|facebookexternalhit|twitterbot/i.test(ua)
  if (isBot) {
    // Serve pre-rendered HTML for SEO crawlers
    const fp = safeReportPath(reportDir, req.params.slug, 'html')
    if (!fp || !fs.existsSync(fp)) return res.status(404).send('Report not found')
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    return res.send(fs.readFileSync(fp, 'utf8'))
  }
  // Serve SPA for real users (redesigned Vue component)
  const indexPath = path.join(frontendDist, 'index.html')
  if (fs.existsSync(indexPath)) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    return res.sendFile(indexPath)
  }
  // Fallback to static HTML
  const fp = safeReportPath(reportDir, req.params.slug, 'html')
  if (!fp || !fs.existsSync(fp)) return res.status(404).send('Report not found')
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.send(fs.readFileSync(fp, 'utf8'))
})

// ── Report Evidence/Blocks logic ─────────────────────────────────────────
function reportEvidenceMap(report, query = '') {
  const rows = []
  if (query) {
    try { for (const r of ragHybridSearch(query, { limit: 8 })) rows.push({ id: r.chunk_id || r.url, topic: 'Hybrid RAG', title: r.title || '', source: r.source || '', url: r.url || '', snippet: r.snippet || r.content || '', imageUrl: '', evidence_kind: r.retrieval || 'hybrid', semantic_score: r.score || r.hybridScore || 0 }) } catch (e) { console.error('[report-server] ragHybridSearch failed:', e.message) }
  }
  let n = 1
  for (const t of report.topics || []) for (const i of t.items || []) {
    rows.push({ id: `ev${n++}`, topic: t.title, title: i.title || '', source: i.source || '', url: i.url || '', snippet: i.snippet || i.summary || '', imageUrl: i.imageUrl || '', kind: 'report_item' })
  }
  return rows
}

function autoIngestReportSources(report, limit = 40) {
  const items = (report.topics || []).flatMap(t => (t.items || []).map(i => ({ ...i, topic: t.title }))).filter(i => i.title || i.snippet || i.summary).slice(0, limit)
  let count = 0
  for (const i of items) {
    const sourceUrl = i.url || `report://${report.date || 'daily'}/${i.topic}/${i.title}`
    const exists = db.prepare('SELECT id FROM rag_documents WHERE source_url=? LIMIT 1').get(sourceUrl)
    if (exists) continue
    ingestDocument({ sourceType: 'report_source', sourceUrl, title: i.title || i.topic || 'Report source', content: `${i.title || ''}\n${i.snippet || i.summary || ''}\nSource: ${i.source || ''}\nTopic: ${i.topic || ''}`, metadata: { topic: i.topic, source: i.source, imageUrl: i.imageUrl } })
    count++
  }
  return count
}

function overlapScore(text = '', ev) {
  const words = new Set(String(text).toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 4))
  const hay = `${ev.title} ${ev.snippet} ${ev.source} ${ev.topic}`.toLowerCase()
  let s = 0; for (const w of words) if (hay.includes(w)) s++
  return s
}

function remapEvidenceWithRag(text = '', report = {}, limit = 5) {
  const hybrid = ragHybridSearch(text, { limit }).map((r, i) => ({ id: r.chunk_id || `hybrid${i + 1}`, topic: 'Hybrid RAG', title: r.title || `Hybrid evidence ${i + 1}`, source: r.source || r.retrieval || 'hybrid', url: r.url || '', snippet: r.snippet || r.content || '', imageUrl: '', kind: r.retrieval || 'hybrid_vector', score: r.hybridScore || r.score || 0 }))
  const legacy = searchRag(text, Math.max(0, limit - hybrid.length)).map((r, i) => ({ id: `rag${r.id || i + 1}`, topic: 'Legacy RAG', title: r.title || `RAG evidence ${i + 1}`, source: r.source_type || 'rag', url: r.source_url || '', snippet: r.quote || r.content || '', imageUrl: '', kind: 'rag_fts', score: r.score || 0 }))
  const rag = [...hybrid, ...legacy]
  const local = reportEvidenceMap(report).map(ev => ({ ...ev, score: overlapScore(text, ev) })).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, Math.max(0, limit - rag.length))
  const seen = new Set(); return [...rag, ...local].filter(e => { const k = e.url || e.title; if (seen.has(k)) return false; seen.add(k); return true }).slice(0, limit)
}

function classifyBlock(text = '', idx = 0, evidence = []) {
  const matches = evidence.map(ev => ({ ...ev, score: overlapScore(text, ev) })).filter(x => x.score >= 2).sort((a, b) => b.score - a.score).slice(0, 3)
  const hasCitation = matches.length > 0 || /https?:\/\/|\[\d+\]|source|sumber/i.test(text)
  const actionable = /watch|pantau|next|validasi|entry|buy|sell|risk|alert/i.test(text)
  const assumption = /asumsi|mungkin|berpotensi|bisa|could|likely/i.test(text) && !hasCitation
  const claim_type = hasCitation ? 'cited' : actionable ? 'actionable' : assumption ? 'assumption' : 'weak_evidence'
  const confidence = hasCitation ? Math.min(0.92, 0.62 + matches.length * 0.1) : claim_type === 'actionable' ? 0.58 : claim_type === 'assumption' ? 0.36 : 0.45
  const edit_suggestion = hasCitation ? `Terhubung ke ${matches.length} source; cek konsistensi sebelum export.` : claim_type === 'actionable' ? 'Tambahkan level harga/timeframe + source pendukung.' : 'Belum ada evidence kuat; rewrite sebagai asumsi atau tambahkan citation.'
  return { block_key: `b${String(idx + 1).padStart(3, '0')}`, body_md: text, evidence_ids: JSON.stringify(matches.map(m => m.id)), confidence, claim_type, edit_suggestion }
}

function evidenceHealth(row) {
  const ids = JSON.parse(row.evidence_ids || '[]')
  const badges = []
  if (!ids.length) badges.push('needs source')
  if (ids.length === 1) badges.push('single-source')
  if (row.claim_type === 'assumption') badges.push('opinion-only')
  if (row.claim_type === 'weak_evidence') badges.push('mixed evidence')
  if (ids.length >= 3 && Number(row.confidence || 0) >= 0.75) badges.push('strong evidence')
  const score = Math.max(0, Math.min(100, Math.round(Number(row.confidence || 0) * 70 + Math.min(ids.length, 4) * 8 - (badges.includes('needs source') ? 25 : 0) - (badges.includes('opinion-only') ? 15 : 0))))
  return { score, badges: badges.length ? badges : ['mixed evidence'] }
}

function decorateBlocks(rows) { return rows.map(r => ({ ...r, evidence_health: evidenceHealth(r) })) }
function ensureReportBlocks(slug, report) {
  const evidence = reportEvidenceMap(report)
  const existing = db.prepare('SELECT * FROM report_blocks WHERE report_slug=? ORDER BY block_key').all(slug)
  if (existing.length) {
    const upd = db.prepare('UPDATE report_blocks SET evidence_ids=?, confidence=?, claim_type=?, edit_suggestion=? WHERE report_slug=? AND block_key=? AND locked=0')
    for (const row of existing) {
      const next = classifyBlock(row.body_md, Number(row.block_key?.slice(1)) || 0, evidence)
      upd.run(next.evidence_ids, Math.max(Number(row.confidence || 0), next.confidence), next.claim_type, next.edit_suggestion, slug, row.block_key)
    }
    return decorateBlocks(db.prepare('SELECT * FROM report_blocks WHERE report_slug=? ORDER BY block_key').all(slug))
  }
  const raw = String(report.textReport || '').split(/\n\n+/).map(x => x.trim()).filter(x => x.length > 20).slice(0, 80)
  const blocks = raw.map((txt, i) => classifyBlock(txt, i, evidence))
  const ins = db.prepare(`INSERT OR IGNORE INTO report_blocks (report_slug,block_key,body_md,evidence_ids,confidence,claim_type,edit_suggestion) VALUES (?,?,?,?,?,?,?)`)
  for (const b of blocks) ins.run(slug, b.block_key, b.body_md, b.evidence_ids, b.confidence, b.claim_type, b.edit_suggestion)
  return decorateBlocks(db.prepare('SELECT * FROM report_blocks WHERE report_slug=? ORDER BY block_key').all(slug))
}

function reportQualityFromBlocks(slug) {
  const rows = db.prepare('SELECT claim_type,confidence,hidden FROM report_blocks WHERE report_slug=?').all(slug)
  const visible = rows.filter(r => !r.hidden)
  const cited = visible.filter(r => r.claim_type === 'cited').length
  const weak = visible.filter(r => r.claim_type === 'weak_evidence' || r.claim_type === 'assumption').length
  const avg = visible.reduce((s, r) => s + Number(r.confidence || 0), 0) / (visible.length || 1)
  const score = Math.max(0, Math.min(100, Math.round(avg * 60 + cited * 3 - weak * 2 - (rows.length - visible.length))))
  return { score, visible: visible.length, hidden: rows.length - visible.length, cited, weak }
}

// ── Report Data API ──────────────────────────────────────────────────────
app.get('/api/reports', (_req, res) => {
  const files = fs.readdirSync(reportDir).filter(f => f.endsWith('.json')).sort().reverse()
  if (_req.query.metadata === 'true') {
    const enriched = files.map(f => {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(reportDir, f), 'utf8'))
        const slug = f.replace('.json', '')
        const date = slug
        const topicCount = (d.topics || []).length
        const items = (d.topics || []).flatMap(t => t.items || [])
        const hero = items.find(i => i.title) || {}
        const title = (hero.title || 'AI Daily Report').replace(/[<>&\"]/g, '')
        return { slug, date, title, topicCount, itemCount: items.length, hasIncidents: !!d.incidents?.length, incidentCount: d.incidents?.length || 0 }
      } catch { return { slug: f.replace('.json', ''), date: f.replace('.json', ''), title: 'AI Daily Report', topicCount: 0, itemCount: 0 } }
    })
    return res.json(enriched)
  }
  res.json(files.map(f => f.replace('.json', '')))
})

app.get('/api/report/:slug', (req, res) => {
  const fp = safeReportPath(reportDir, req.params.slug, 'json')
  if (!fp || !fs.existsSync(fp)) return res.status(404).json({ error: 'Report not found' })
  const report = JSON.parse(fs.readFileSync(fp, 'utf8'))
  report.rag_auto_ingested = autoIngestReportSources(report)
  report.blocks = ensureReportBlocks(req.params.slug, report)
  const allSources = [...new Set((report.topics || []).flatMap(t => (t.items || []).map(i => i.source).filter(Boolean)))]
  report.source_trust = getSourcesTrust(allSources)
  res.json(report)
})

app.get('/api/report/:slug/quality', (req, res) => res.json({ ok: true, quality: reportQualityFromBlocks(req.params.slug) }))

app.get('/api/report/:slug/compare/:otherSlug', (req, res) => {
  const fpA = safeReportPath(reportDir, req.params.slug, 'json')
  const fpB = safeReportPath(reportDir, req.params.otherSlug, 'json')
  if (!fpA || !fpB || !fs.existsSync(fpA) || !fs.existsSync(fpB)) return res.status(404).json({ ok: false, error: 'report_not_found' })
  const a = JSON.parse(fs.readFileSync(fpA, 'utf8'))
  const b = JSON.parse(fs.readFileSync(fpB, 'utf8'))
  const title = t => String(t?.title || '').trim()
  const key = s => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const topicsA = new Map((a.topics || []).map(t => [key(title(t)), t]))
  const topicsB = new Map((b.topics || []).map(t => [key(title(t)), t]))
  const topicAdded = [...topicsA.keys()].filter(k => !topicsB.has(k)).map(k => topicsA.get(k).title)
  const topicRemoved = [...topicsB.keys()].filter(k => !topicsA.has(k)).map(k => topicsB.get(k).title)
  const count = r => ({ topics: (r.topics || []).length, items: (r.topics || []).reduce((s, t) => s + (t.items || []).length, 0), sources: new Set((r.topics || []).flatMap(t => (t.items || []).map(i => i.source).filter(Boolean))).size })
  const now = count(a), prev = count(b)
  res.json({ ok: true, current: a.date, baseline: b.date, stats: { current: now, baseline: prev, item_delta: now.items - prev.items, source_delta: now.sources - prev.sources }, topics: { added: topicAdded, removed: topicRemoved }, summary: `${topicAdded.length} topik baru, ${topicRemoved.length} hilang, Δitem ${now.items - prev.items}` })
})

// ── Report blocks API ────────────────────────────────────────────────────
app.patch('/api/report/:slug/blocks', (req, res) => {
  const user = requireUser(req, res)
  if (!user) return
  const slug = req.params.slug
  const blockKey = String(req.body?.block_key || '').slice(0, 40)
  if (!blockKey) return res.status(400).json({ ok: false, error: 'block_key_required' })
  const existing = db.prepare('SELECT * FROM report_blocks WHERE report_slug=? AND block_key=?').get(slug, blockKey)
  if (!existing) return res.status(404).json({ ok: false, error: 'block_not_found' })
  if (existing.locked && req.body?.body_md && req.body.body_md !== existing.body_md) return res.status(409).json({ ok: false, error: 'block_locked' })
  const next = { body_md: req.body?.body_md ?? existing.body_md, claim_type: req.body?.claim_type ?? existing.claim_type, confidence: Number(req.body?.confidence ?? existing.confidence), evidence_ids: JSON.stringify(req.body?.evidence_ids ?? JSON.parse(existing.evidence_ids || '[]')), edit_suggestion: req.body?.edit_suggestion ?? existing.edit_suggestion, locked: req.body?.locked === undefined ? existing.locked : (req.body.locked ? 1 : 0), hidden: req.body?.hidden === undefined ? existing.hidden : (req.body.hidden ? 1 : 0) }
  db.prepare(`UPDATE report_blocks SET body_md=?, claim_type=?, confidence=?, evidence_ids=?, edit_suggestion=?, locked=?, hidden=?, updated_at=datetime('now') WHERE report_slug=? AND block_key=?`).run(next.body_md, next.claim_type, next.confidence, next.evidence_ids, next.edit_suggestion, next.locked, next.hidden, slug, blockKey)
  res.json({ ok: true, block: db.prepare('SELECT * FROM report_blocks WHERE report_slug=? AND block_key=?').get(slug, blockKey), quality: reportQualityFromBlocks(slug) })
})

app.post('/api/report/:slug/blocks/:blockKey/rewrite', async (req, res) => {
  const user = requireUser(req, res)
  if (!user) return
  const row = db.prepare('SELECT * FROM report_blocks WHERE report_slug=? AND block_key=?').get(req.params.slug, req.params.blockKey)
  if (!row) return res.status(404).json({ ok: false, error: 'block_not_found' })
  if (row.locked) return res.status(409).json({ ok: false, error: 'block_locked' })
  const fp = safeReportPath(reportDir, req.params.slug, 'json')
  const report = fp && fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, 'utf8')) : { topics: [] }
  const evidence = remapEvidenceWithRag(row.body_md, report, 5)
  const ids = new Set(JSON.parse(row.evidence_ids || '[]'))
  let ctx = evidence.filter(e => ids.has(e.id))
  if (!ctx.length) ctx = evidence.slice(0, 3)
  const safer = String(row.body_md).replace(/\b(will|pasti|guaranteed|always)\b/gi, 'berpotensi').replace(/\s+/g, ' ').trim()
  let rewritten = ctx.length
    ? `${safer}\n\nBerbasis source: ${ctx.map(e => e.source).filter(Boolean).join(', ')}. Evidence utama: ${ctx.map(e => e.title).join(' | ')}.`
    : `${safer}\n\nCatatan: belum ada retrieval context kuat; perlakukan sebagai asumsi sampai ada source.`
  let usedLlm = false
  if ((process.env.OPENAI_API_KEY || process.env.LLM_API_KEY) && ctx.length) {
    try {
      const base = process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL || 'https://api.openai.com/v1'
      const key = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY
      const model = process.env.REPORT_REWRITE_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini'
      const rr = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', 'authorization': `Bearer ${key}` }, body: JSON.stringify({ model, temperature: 0.2, max_tokens: 450, messages: [{ role: 'system', content: 'Rewrite paragraph in Bahasa Indonesia. Use ONLY locked evidence. Preserve cautious wording. Add short source note. No invented facts.' }, { role: 'user', content: `PARAGRAPH:\n${row.body_md}\n\nLOCKED_EVIDENCE_IDS:${ctx.map(e => e.id).join(', ')}\nEVIDENCE:\n${ctx.map(e => `- ${e.title} (${e.source}): ${e.snippet}`).join('\n')}` }] }) })
      const jj = await rr.json(); const txt = jj.choices?.[0]?.message?.content?.trim(); if (txt) { rewritten = txt; usedLlm = true }
      } catch (e) { console.error('[report-server] LLM rewrite failed:', e.message) }
    }
  const newIds = ctx.map(e => e.id)
  const claimType = ctx.length ? 'cited' : (row.claim_type === 'assumption' ? 'weak_evidence' : row.claim_type)
  const confidence = ctx.length ? Math.min(0.9, 0.62 + ctx.length * 0.1) : Math.max(0.45, Number(row.confidence || 0.5))
  db.prepare(`INSERT INTO report_rewrite_proposals (report_slug,block_key,before_md,after_md,evidence_ids) VALUES (?,?,?,?,?)`).run(req.params.slug, req.params.blockKey, row.body_md, rewritten, JSON.stringify(newIds))
  if (req.body?.apply === true) db.prepare(`UPDATE report_blocks SET body_md=?, confidence=?, claim_type=?, evidence_ids=?, edit_suggestion=?, updated_at=datetime('now') WHERE report_slug=? AND block_key=?`).run(rewritten, confidence, claimType, JSON.stringify(newIds), usedLlm ? `LLM rewrite pakai ${ctx.length} evidence context.` : (ctx.length ? `Deterministic rewrite pakai ${ctx.length} retrieval context.` : 'Rewrite aman tanpa source kuat; butuh citation.'), req.params.slug, req.params.blockKey)
  res.json({ ok: true, after: rewritten, applied: req.body?.apply === true, quality: reportQualityFromBlocks(req.params.slug) })
})

app.post('/api/report/:slug/blocks/:blockKey/remap-evidence', (req, res) => {
  const row = db.prepare('SELECT * FROM report_blocks WHERE report_slug=? AND block_key=?').get(req.params.slug, req.params.blockKey)
  if (!row) return res.status(404).json({ ok: false, error: 'block_not_found' })
  if (row.locked) return res.status(409).json({ ok: false, error: 'block_locked' })
  const fp = safeReportPath(reportDir, req.params.slug, 'json')
  const report = fp && fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, 'utf8')) : { topics: [] }
  const ingested = autoIngestReportSources(report)
  const ctx = remapEvidenceWithRag(row.body_md, report, Number(req.body?.limit || 5))
  const evidenceIds = ctx.map(e => e.id)
  const claimType = ctx.length ? 'cited' : 'weak_evidence'
  const confidence = ctx.length ? Math.min(0.94, 0.6 + ctx.length * 0.07) : 0.4
  db.prepare(`UPDATE report_blocks SET evidence_ids=?, confidence=?, claim_type=?, edit_suggestion=?, updated_at=datetime('now') WHERE report_slug=? AND block_key=?`).run(JSON.stringify(evidenceIds), confidence, claimType, ctx.length ? `Remap Evidence pakai ragSearch: ${ctx.length} evidence.` : 'Tidak ada evidence kuat.', req.params.slug, req.params.blockKey)
  res.json({ ok: true, block: db.prepare('SELECT * FROM report_blocks WHERE report_slug=? AND block_key=?').get(req.params.slug, req.params.blockKey), quality: reportQualityFromBlocks(req.params.slug) })
})

app.get('/api/report/:slug/blocks/:blockKey/sources', (req, res) => {
  const row = db.prepare('SELECT * FROM report_blocks WHERE report_slug=? AND block_key=?').get(req.params.slug, req.params.blockKey)
  if (!row) return res.status(404).json({ ok: false, error: 'block_not_found' })
  const fp = safeReportPath(reportDir, req.params.slug, 'json')
  const report = fp && fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, 'utf8')) : { topics: [] }
  const evidence = remapEvidenceWithRag(row.body_md, report, 8)
  const ids = new Set(JSON.parse(row.evidence_ids || '[]'))
  let sources = evidence.filter(e => ids.has(e.id))
  if (!sources.length) sources = evidence
  res.json({ ok: true, block: row, evidence_ids: [...ids], sources })
})

app.post('/api/report/:slug/blocks/remap-evidence', (req, res) => {
  const user = requireUser(req, res)
  if (!user) return
  const fp = safeReportPath(reportDir, req.params.slug, 'json')
  if (!fp || !fs.existsSync(fp)) return res.status(404).json({ ok: false, error: 'report_not_found' })
  const report = JSON.parse(fs.readFileSync(fp, 'utf8'))
  const rows = ensureReportBlocks(req.params.slug, report)
  const upd = db.prepare(`UPDATE report_blocks SET evidence_ids=?, confidence=?, claim_type=?, edit_suggestion=?, updated_at=datetime('now') WHERE report_slug=? AND block_key=? AND locked=0`)
  let updated = 0
  for (const row of rows) {
    const evidence = remapEvidenceWithRag(row.body_md, report, 5)
    const next = classifyBlock(row.body_md, Number(row.block_key?.slice(1)) || 0, evidence)
    if (JSON.parse(next.evidence_ids || '[]').length) { upd.run(next.evidence_ids, next.confidence, next.claim_type, next.edit_suggestion, req.params.slug, row.block_key); updated++ }
  }
  res.json({ ok: true, updated, quality: reportQualityFromBlocks(req.params.slug) })
})

app.post('/api/report/:slug/blocks/remap-all', (req, res) => {
  const user = requireUser(req, res)
  if (!user) return
  const fp = safeReportPath(reportDir, req.params.slug, 'json')
  const report = fp && fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, 'utf8')) : { topics: [] }
  const ingested = autoIngestReportSources(report)
  const rows = db.prepare('SELECT * FROM report_blocks WHERE report_slug=? AND locked=0').all(req.params.slug)
  let changed = 0
  for (const row of rows) {
    const ctx = remapEvidenceWithRag(row.body_md, report, Number(req.body?.limit || 5))
    if (!ctx.length) continue
    db.prepare(`UPDATE report_blocks SET evidence_ids=?, confidence=?, claim_type=?, edit_suggestion=?, updated_at=datetime('now') WHERE report_slug=? AND block_key=?`).run(JSON.stringify(ctx.map(e => e.id)), Math.min(0.94, 0.6 + ctx.length * 0.07), 'cited', `Remap all: ${ctx.length} evidence.`, req.params.slug, row.block_key)
    changed++
  }
  res.json({ ok: true, changed, quality: reportQualityFromBlocks(req.params.slug), blocks: decorateBlocks(db.prepare('SELECT * FROM report_blocks WHERE report_slug=? ORDER BY block_key').all(req.params.slug)) })
})

app.post('/api/report/:slug/blocks/rewrite-weak', (req, res) => {
  const user = requireUser(req, res)
  if (!user) return
  const rows = db.prepare(`SELECT * FROM report_blocks WHERE report_slug=? AND locked=0 AND hidden=0 AND (claim_type IN ('weak_evidence','assumption') OR confidence < 0.7) LIMIT ?`).all(req.params.slug, Number(req.body?.limit || 20))
  const fp = safeReportPath(reportDir, req.params.slug, 'json')
  const report = fp && fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, 'utf8')) : { topics: [] }
  let changed = 0
  for (const row of rows) {
    const ctx = remapEvidenceWithRag(row.body_md, report, 4)
    const rewritten = ctx.length ? `${row.body_md}\n\nRewrite berbasis evidence terkunci: ${ctx.map(e => e.title).join(' | ')}.` : `${row.body_md}\n\nCatatan: perlu source tambahan sebelum dijadikan klaim kuat.`
    db.prepare(`UPDATE report_blocks SET body_md=?, evidence_ids=?, confidence=?, claim_type=?, edit_suggestion=?, updated_at=datetime('now') WHERE report_slug=? AND block_key=?`).run(rewritten, JSON.stringify(ctx.map(e => e.id)), ctx.length ? 0.78 : 0.45, ctx.length ? 'cited' : 'weak_evidence', ctx.length ? 'Batch rewrite pakai retrieval context.' : 'Batch rewrite fallback; evidence kurang.', req.params.slug, row.block_key)
    changed++
  }
  res.json({ ok: true, changed, quality: reportQualityFromBlocks(req.params.slug), blocks: decorateBlocks(db.prepare('SELECT * FROM report_blocks WHERE report_slug=? ORDER BY block_key').all(req.params.slug)) })
})

// ── Report Search Related ────────────────────────────────────────────────
app.post('/api/report/:slug/search-related', async (req, res) => {
  try {
    const fp = safeReportPath(reportDir, req.params.slug, 'json')
    if (!fp || !fs.existsSync(fp)) return res.status(404).json({ ok: false, error: 'report_not_found' })
    const report = JSON.parse(fs.readFileSync(fp, 'utf8'))
    const base = [report.title, ...(report.topics || []).map(t => t.title), ...((report.topics || []).flatMap(t => (t.items || []).slice(0, 2).map(i => i.title)))].filter(Boolean).slice(0, Number(req.body?.queries || 8))
    const all = []
    for (const q of base) { const out = await webSearch(q, { limit: Number(req.body?.perQuery || 5), engines: req.body?.engines || ['duckduckgo','bing','yahoo','yandex'], mode: req.body?.mode || 'market', dynamic: true, preferTrusted: true }); all.push(...(out.results || []).map(r => ({ ...r, query: q, ...classifySearchResult(r) }))) }
    const seen = new Set(); const results = []
    for (const r of all) { const k = String(r.url || '').replace(/[#?].*$/, ''); if (k && !seen.has(k)) { seen.add(k); results.push(r) } }
    const filtered = await filterSearchForCrawl(results, { allowUntrusted: true, openDocsOnly: !!req.body?.openDocsOnly })
    const enqueued = []
    if (req.body?.autoCrawl !== false) { for (const r of filtered.filter(x => x.crawlAllowed).slice(0, Number(req.body?.enqueueLimit || 10))) enqueued.push(enqueueRagCrawl(r.url, { source: r.domain, assetTags: ['report-related', req.params.slug] })) }
    res.json({ ok: true, slug: req.params.slug, queries: base, results: filtered.slice(0, Number(req.body?.limit || 30)), enqueued })
  } catch (error) { res.status(500).json({ ok: false, error: String(error) }) }
})

// ── Report Export ────────────────────────────────────────────────────────
app.get('/api/reports/:slug/export', (req, res) => {
  const format = String(req.query.format || 'html')
  const user = getUserFromReq(req)
  const report = getReportMeta(reportDir, req.params.slug)
  const decision = canExportReport(user, report)
  auditExport({ user, slug: req.params.slug, format, decision: decision.ok ? 'allow' : 'deny', reason: decision.reason, ip: req.ip })
  if (!decision.ok) return res.status(decision.status || 403).json({ ok: false, error: decision.reason })
  const fp = safeReportPath(reportDir, req.params.slug, format)
  if (!fp || !fs.existsSync(fp)) return res.status(404).json({ ok: false, error: 'export_not_found' })
  const raw = fs.readFileSync(fp, 'utf8')
  const decorated = format === 'html' ? raw : raw
  const out = watermark(decorated, user, report, format)
  res.setHeader('Content-Type', format === 'html' ? 'text/html; charset=utf-8' : format === 'json' ? 'application/json; charset=utf-8' : 'text/markdown; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.slug}.${format}"`)
  res.send(out)
})

app.post('/api/reports/:slug/signed-export', (req, res) => {
  const user = requireUser(req, res)
  if (!user) return
  const format = String(req.body?.format || 'html')
  const report = getReportMeta(reportDir, req.params.slug)
  const decision = canExportReport(user, report)
  auditExport({ user, slug: req.params.slug, format, decision: decision.ok ? 'allow' : 'deny', reason: `signed:${decision.reason}`, ip: req.ip })
  if (!decision.ok) return res.status(decision.status || 403).json({ ok: false, error: decision.reason })
  const token = createSignedExport(user, report, format, Number(req.body?.ttl || 900))
  res.json({ ok: true, url: `/api/reports/signed-export/${token}`, expires_in_seconds: Number(req.body?.ttl || 900) })
})

app.get('/api/reports/signed-export/:token', (req, res) => {
  const link = verifySignedExport(req.params.token)
  if (!link) return res.status(403).json({ ok: false, error: 'signed_link_invalid_or_expired' })
  const user = { id: link.user_id, email: link.email, role: link.role, name: link.name }
  const report = getReportMeta(reportDir, link.report_slug)
  const fp = safeReportPath(reportDir, link.report_slug, link.format)
  if (!report || !fp || !fs.existsSync(fp)) return res.status(404).json({ ok: false, error: 'export_not_found' })
  db.prepare(`UPDATE signed_export_links SET used_at=datetime('now') WHERE token_hash=?`).run(link.token_hash)
  auditExport({ user, slug: link.report_slug, format: link.format, decision: 'allow', reason: 'signed_link_used', ip: req.ip })
  const raw = fs.readFileSync(fp, 'utf8')
  const decorated = link.format === 'html' ? raw : raw
  res.send(watermark(decorated, user, report, link.format))
})

app.get('/api/report-export-audit', (req, res) => {
  const user = requireUser(req, res)
  if (!user) return
  if (user.role !== 'admin') return res.status(403).json({ ok: false, error: 'admin_required' })
  const rows = db.prepare(`SELECT a.*,u.email FROM report_export_audit a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 100`).all()
  res.json({ ok: true, rows })
})

// ── Multi-Channel Report Preview & Edit ──────────────────────────────────
app.get('/api/channel-constraints', (_req, res) => {
  res.json({ ok: true, channels: CHANNEL_CONSTRAINTS })
})

app.get('/api/report/:slug/preview/:channel', (req, res) => {
  const slug = String(req.params.slug || '').replace(/[^0-9a-z-]/gi, '')
  const channel = String(req.params.channel || 'editor').toLowerCase()
  const allowed = ['editor', 'discord', 'web', 'pdf']
  if (!allowed.includes(channel)) return res.status(400).json({ ok: false, error: 'invalid_channel', allowed })
  try {
    const result = renderPreviewForChannel(slug, channel)
    res.json({ ok: true, ...result })
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error) })
  }
})

app.post('/api/report/:slug/publish/:channel', async (req, res) => {
  const user = requireUser(req, res)
  if (!user) return
  const slug = String(req.params.slug || '').replace(/[^0-9a-z-]/gi, '')
  const channel = String(req.params.channel || 'editor').toLowerCase()
  const editedText = req.body?.textReport || req.body?.content
  if (!editedText) return res.status(400).json({ ok: false, error: 'textReport_required' })
  try {
    const result = await publishChannel(slug, channel, editedText)
    res.json(result)
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error) })
  }
})

// ── Impact Simulator ─────────────────────────────────────────────────────
const EVENT_TEMPLATES = {
  rate_hike: { label: 'Kenaikan suku bunga / bank sentral hawkish', bias: { crypto: -2, stock: -1.2, forex: 1, commodity: -0.4 }, drivers: ['suku bunga lebih tinggi', 'aliran risk-off', 'USD lebih kuat'], signals: ['DXY', 'US10Y', 'pidato Fed'] },
  earnings_miss: { label: 'Laporan laba mengecewakan / panduan lemah', bias: { stock: -2.4, crypto: -0.4, forex: 0, commodity: 0 }, drivers: ['tekanan margin', 'panduan lebih rendah', 'penurunan valuasi'], signals: ['lonjakan volume', 'penurunan rating analis', 'simpati sektor'] },
  regulation_news: { label: 'Berita regulasi', bias: { crypto: -2, stock: -0.7, forex: 0.2, commodity: 0 }, drivers: ['ketidakpastian kebijakan', 'biaya kepatuhan', 'pergeseran likuiditas'], signals: ['pernyataan resmi', 'respons bursa', 'jadwal hukum'] },
  supply_shock: { label: 'Gangguan pasokan', bias: { commodity: 2.4, stock: -0.6, forex: 0.2, crypto: 0 }, drivers: ['premium kelangkaan', 'dorongan inflasi', 'penyusutan margin'], signals: ['data inventaris', 'tarif pengiriman', 'perkembangan geopolitik'] },
  ai_breakthrough: { label: 'Terobosan AI / peluncuran produk', bias: { stock: 1.5, crypto: 0.4, forex: 0, commodity: 0 }, drivers: ['narasi pertumbuhan', 'rotasi belanja modal', 'adopsi AI'], signals: ['traksi produk', 'belanja cloud', 'permintaan chip'] },
  liquidity_crunch: { label: 'Krisis likuiditas / tekanan kredit', bias: { crypto: -2.6, stock: -1.8, forex: 0.7, commodity: -0.8 }, drivers: ['preferensi kas', 'pelebaran spread', 'deleveraging paksa'], signals: ['spread kredit', 'aliran stablecoin', 'VIX'] },
  geopolitical_risk: { label: 'Risiko geopolitik', bias: { commodity: 1.8, forex: 0.8, stock: -1.1, crypto: -0.5 }, drivers: ['aliran tempat aman', 'gangguan energi', 'premium risiko'], signals: ['lonjakan minyak/emas', 'USD/JPY', 'eskalasi resmi'] },
}
for (const [id, t] of Object.entries(EVENT_TEMPLATES)) {
  db.prepare(`INSERT OR IGNORE INTO event_templates (id,label,bias_json,drivers_json,signals_json) VALUES (?,?,?,?,?)`).run(id, t.label, JSON.stringify(t.bias), JSON.stringify(t.drivers), JSON.stringify(t.signals))
}
function loadEventTemplates() {
  const rows = db.prepare('SELECT * FROM event_templates ORDER BY id').all()
  return Object.fromEntries(rows.map(r => [r.id, { label: r.label, bias: JSON.parse(r.bias_json || '{}'), drivers: JSON.parse(r.drivers_json || '[]'), signals: JSON.parse(r.signals_json || '[]') }]))
}

app.get('/api/impact-simulator/templates', (_req, res) => {
  const templates = loadEventTemplates()
  res.json({ templates, items: Object.entries(templates).map(([type, t]) => ({ type, label: t.label, drivers: t.drivers, signals: t.signals })) })
})

app.post('/api/impact-simulator', (req, res) => {
  const templates = loadEventTemplates()
  const customText = String(req.body?.custom_event_text || '').trim()
  let eventType = req.body?.event_type || 'rate_hike'
  if (customText) {
    const t = customText.toLowerCase()
    if (/rate|fed|inflation|yield|suku bunga|kenaikan bunga|bi rate/.test(t)) eventType = 'rate_hike'
    else if (/regulat|sec|ban|policy|aturan|regulasi|kebijakan/.test(t)) eventType = 'regulation_news'
    else if (/supply|oil|opec|shipping|geopolitical|pasokan|minyak/.test(t)) eventType = 'supply_shock'
    else if (/earning|guidance|revenue|profit|laba|pendapatan/.test(t)) eventType = 'earnings_miss'
    else if (/liquid|credit|stress|likuiditas|kredit/.test(t)) eventType = 'liquidity_crunch'
    else if (/war|geopolitical|conflict|perang|konflik/.test(t)) eventType = 'geopolitical_risk'
    else eventType = 'ai_breakthrough'
  }
  const timeframe = req.body?.timeframe || '1d'
  const severity = Math.min(3, Math.max(0.25, Number(req.body?.severity || 1)))
  const probability = Math.min(1, Math.max(0.05, Number(req.body?.probability || 0.6)))
  const tmpl = templates[eventType] || templates.rate_hike
  function assetKind(a) { const s = `${a.slug} ${a.symbol} ${a.market} ${a.category}`.toLowerCase(); if (/btc|eth|sol|crypto|coin/.test(s)) return 'crypto'; if (/xau|gold|oil|brent|wti|commodity/.test(s)) return 'commodity'; if (/idr|usd|eur|jpy|forex|fx/.test(s)) return 'forex'; return 'stock' }
  function impactFor(asset, tmpl, timeframe = '1d') { const kind = assetKind(asset); const base = tmpl.bias[kind] ?? 0; const vol = Math.min(2.2, Math.max(.7, Math.abs(asset.change_percent || 0) / 2 + 1)); const tf = timeframe === '1w' ? 1.4 : timeframe === '1m' ? 1.8 : 1; const score = Number((base * vol * tf).toFixed(2)); const level = Math.abs(score) >= 4 ? 'high' : Math.abs(score) >= 2 ? 'medium' : 'low'; const direction = score > .25 ? 'bullish' : score < -.25 ? 'bearish' : 'neutral'; return { slug: asset.slug, symbol: asset.symbol, name: asset.name, kind, price: asset.price, change_percent: asset.change_percent, direction, impact_score: score, risk_level: level } }
  const reqAssets = Array.isArray(req.body?.assets) ? req.body.assets.filter(Boolean) : []
  const watch = db.prepare('SELECT asset_slug FROM watchlist').all().map(r => r.asset_slug)
  const slugs = reqAssets.length ? reqAssets : (req.body?.scope === 'watchlist' ? watch : [])
  const assets = slugs.length
    ? db.prepare(`SELECT * FROM assets WHERE slug IN (${slugs.map(() => '?').join(',')})`).all(...slugs)
    : db.prepare(`SELECT * FROM assets WHERE abs(change_percent) >= 0.1 OR market IN ('IDX','FOREX') OR category = 'index' ORDER BY abs(change_percent) DESC LIMIT 24`).all()
  const rows = assets.map(a => { const r = impactFor(a, tmpl, timeframe); r.impact_score = Number((r.impact_score * severity * probability).toFixed(2)); r.direction = r.impact_score > .25 ? 'bullish' : r.impact_score < -.25 ? 'bearish' : 'netral'; r.risk_level = Math.abs(r.impact_score) >= 4 ? 'tinggi' : Math.abs(r.impact_score) >= 2 ? 'sedang' : 'rendah'; return r }).sort((a, b) => Math.abs(b.impact_score) - Math.abs(a.impact_score))
  res.json({ ok: true, event_type: eventType, event_label: tmpl.label, timeframe, severity, probability, drivers: tmpl.drivers, signals: tmpl.signals, items: rows })
})

// ── Image proxy ──────────────────────────────────────────────────────────
app.get('/api/image-proxy', async (req, res) => {
  try {
    const url = String(req.query.url || '')
    if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'invalid url' })
    const upstream = await fetch(url, { headers: { 'User-Agent': 'market-orca/1.0' }, signal: AbortSignal.timeout(8000) })
    if (!upstream.ok) return res.status(upstream.status).end()
    const contentType = upstream.headers.get('content-type') || 'image/jpeg'
    const len = Number(upstream.headers.get('content-length') || 0)
    if (!contentType.startsWith('image/') || len > 2_000_000) return res.status(400).json({ error: 'invalid image' })
    res.setHeader('Content-Type', contentType)
    res.setHeader('Cache-Control', 'public, max-age=3600')
    const buf = Buffer.from(await upstream.arrayBuffer())
    if (buf.length > 2_000_000) return res.status(400).json({ error: 'image too large' })
    res.end(buf)
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

// ── RAG routes ───────────────────────────────────────────────────────────
app.get('/api/rag/health', (_req, res) => {
  try {
    initRagSchema()
    const fts5 = db.prepare(`SELECT sqlite_compileoption_used('ENABLE_FTS5') AS enabled`).get()?.enabled === 1
    let runtime = false
    try { db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS temp.rag_health_fts USING fts5(body); DROP TABLE temp.rag_health_fts;`); runtime = true } catch (e) { console.error('[report-server] fts5 runtime check failed:', e.message) }
    const docs = db.prepare(`SELECT count(*) AS n FROM rag_evidence_documents`).get()?.n || 0
    const chunks = db.prepare(`SELECT count(*) AS n FROM rag_evidence_chunks`).get()?.n || 0
    res.json({ ok: true, fts5CompileOption: fts5, fts5Runtime: runtime, docs, chunks })
  } catch (error) { res.status(500).json({ ok: false, error: String(error) }) }
})

app.post('/api/rag/evidence-ingest', async (req, res) => {
  try {
    initRagSchema()
    const body = req.body || {}
    const doc = upsertRagDocument({ url: String(body.url || body.sourceUrl || ''), title: String(body.title || 'Manual source'), source: String(body.source || ''), publishedAt: String(body.publishedAt || ''), content: String(body.content || ''), assetTags: Array.isArray(body.assetTags) ? body.assetTags : [] })
    res.json({ ok: true, document: doc })
  } catch (error) { res.status(500).json({ ok: false, error: String(error) }) }
})

app.get('/api/rag/evidence-search', (req, res) => {
  try { res.json({ ok: true, results: ragSearch(String(req.query.q || ''), { section: String(req.query.section || 'api'), limit: Number(req.query.limit || 8) }) }) }
  catch (error) { res.status(500).json({ ok: false, error: String(error) }) }
})

app.post('/api/rag/ingest', async (req, res) => {
  try {
    const body = req.body || {}
    const user = getUserFromReq(req)
    if (body.url) return res.json({ ok: true, document: await ingestUrl(String(body.url)) })
    const doc = ingestDocument({ sourceType: body.sourceType || 'manual', sourceUrl: body.sourceUrl || '', title: body.title || 'Manual source', content: body.content || '', metadata: { userId: user?.id || null } })
    res.json({ ok: true, document: doc })
  } catch (error) { res.status(500).json({ ok: false, error: String(error) }) }
})

app.get('/api/rag/search', (req, res) => {
  try { res.json({ ok: true, results: searchRag(String(req.query.q || ''), Number(req.query.limit || 8)) }) }
  catch (error) { res.status(500).json({ ok: false, error: String(error) }) }
})

app.post('/api/reports/rag-generate', (req, res) => {
  try {
    const body = req.body || {}
    res.json({ ok: true, ...runRagReport(String(body.question || body.query || ''), Number(body.limit || 8), body.context || {}) })
  } catch (error) { res.status(500).json({ ok: false, error: String(error) }) }
})

app.post('/api/datasets/indonesian-jsonl', (req, res) => {
  try { res.type('application/x-jsonlines').send(generateJsonlDataset({ count: Number(req.body?.count || 12), topic: String(req.body?.topic || 'Market Orca RAG report') })) }
  catch (error) { res.status(500).json({ ok: false, error: String(error) }) }
})

app.get('/api/reports/rag/:id', (req, res) => {
  try { const run = getRagRun(Number(req.params.id)); if (!run) return res.status(404).json({ ok: false, error: 'not_found' }); res.json({ ok: true, run, factCheck: factCheckReport(run.report_md, []) }) }
  catch (error) { res.status(500).json({ ok: false, error: String(error) }) }
})

app.get('/api/reports/rag/:id/export', (req, res) => {
  try { const out = exportRagRun(Number(req.params.id), String(req.query.format || 'md')); res.download(out.path, out.filename) }
  catch (error) { res.status(500).json({ ok: false, error: String(error) }) }
})

app.post('/api/rag/crawl/enqueue', async (req, res) => {
  try { const url = String(req.body?.url || ''); const policy = await isAllowedSource(url); if (!policy.ok) return res.status(400).json({ ok: false, error: policy.reason }); res.json(enqueueRagCrawl(url, { source: req.body?.source || policy.host, assetTags: req.body?.assetTags || [] })) }
  catch (error) { res.status(500).json({ ok: false, error: String(error) }) }
})

app.post('/api/rag/crawl/run', async (req, res) => {
  try { res.json(await runRagCrawlWorker({ limit: Number(req.body?.limit || 3) })) }
  catch (error) { res.status(500).json({ ok: false, error: String(error) }) }
})

// ── DM Delivery Status ───────────────────────────────────────────────────
import { getDmDeliveryStatus, getDmFailCount, cleanupOldDeliveryLogs, getDmSubscriberCount } from './discord-dm.js'

app.get('/api/dm-delivery/status', (_req, res) => {
  try {
    const recent = getDmDeliveryStatus(20)
    const failCount = getDmFailCount()
    const subscriberCount = getDmSubscriberCount()
    res.json({ ok: true, subscriberCount, failCountLast24h: failCount, recentDeliveries: recent })
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }) }
})

app.post('/api/dm-delivery/cleanup', (req, res) => {
  try {
    const maxAgeDays = Number(req.body?.maxAgeDays || 7)
    const result = cleanupOldDeliveryLogs(maxAgeDays)
    res.json(result)
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }) }
})

// ── APM Status Endpoint (must be before catch-all) ───────────────────────
app.get('/api/apm/status', async (_req, res) => {
  try {
    const fsMod = await import('node:fs')
    const pathMod = await import('node:path')
    const MMd_PATH = pathMod.default.resolve(__dirname, '../../MMd.md')
    
    // Try to import the CJS dashboard module
    let stats = { totalFeatures: 0, totalFiles: 0, totalBranches: 0, totalPRs: 0, uniqueDates: 0, dailyAverage: '0' }
    try {
      const { createRequire } = await import('node:module');
      const mod = createRequire(import.meta.url)('../scripts/apm/apm-dashboard.cjs');
      const features = mod.parseFeatures();
      stats = mod.calculateStats(features);
    } catch (e) { console.error('[report-server] APM dashboard import failed:', e.message) }
    
    const dailyBriefPath = pathMod.default.resolve(__dirname, '../daily-brief.md')
    const briefExists = fsMod.default.existsSync(dailyBriefPath)
    const briefMtime = briefExists ? fsMod.default.statSync(dailyBriefPath).mtime.toISOString() : null
    
    // Pain point counts from latest scan
    let painPointStats = { total: 0, p1: 0, p2: 0, p3: 0 }
    if (briefExists) {
      const briefContent = fsMod.default.readFileSync(dailyBriefPath, 'utf8')
      const totalMatch = briefContent.match(/Total pain points:\s*(\d+)/)
      const p1Match = briefContent.match(/P1\s*\(critical\):\s*(\d+)/i)
      const p2Match = briefContent.match(/P2\s*\(important\):\s*(\d+)/i)
      painPointStats = {
        total: totalMatch ? parseInt(totalMatch[1]) : 0,
        p1: p1Match ? parseInt(p1Match[1]) : 0,
        p2: p2Match ? parseInt(p2Match[1]) : 0
      }
    }
    
    res.json({
      ok: true,
      project: 'Market Orca',
      environment: process.env.NODE_ENV || 'development',
      pipeline: {
        version: '2.0',
        lastRun: briefMtime,
        status: briefMtime ? 'active' : 'idle',
        featuresShipped: stats.totalFeatures || 0,
        dailyAverage: stats.dailyAverage || '0',
        branchesCreated: stats.totalBranches || 0,
        prsMerged: stats.totalPRs || 0
      },
      painPoints: painPointStats,
      uptime: process.uptime()
    })
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) })
  }
})

// ── Catch-all: serve SPA for client-side routing ─────────────────────────
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/mcp/')) {
    return res.status(404).json({ ok: false, error: 'not_found' })
  }
  const indexPath = path.join(frontendDist, 'index.html')
  if (fs.existsSync(indexPath)) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.sendFile(indexPath)
  } else {
    res.status(404).send('Not found')
  }
})

// ── API proxy: forward unknown /api/* to main backend (:4567) ──────────────
import http from 'node:http'
const PROXY_TARGET = `http://localhost:${APP_CONFIG?.port || 4567}`

app.use('/api', (req, res, next) => {
  if (res.headersSent) return next()
  const targetUrl = new URL(req.originalUrl, PROXY_TARGET)
  const proxyReq = http.request(targetUrl, {
    method: req.method,
    headers: { ...req.headers, host: `localhost:${APP_CONFIG?.port || 4567}` },
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers)
    proxyRes.pipe(res)
  })
  proxyReq.on('error', () => { if (!res.headersSent) res.status(502).json({ ok: false, error: 'proxy_error' }) })
  req.pipe(proxyReq)
})

// ── Error handler ────────────────────────────────────────────────────────
app.use((err, _req, res, next) => {
  if (err?.type === 'entity.too.large') return res.status(413).json({ ok: false, error: 'payload_too_large', maxBytes: 512000 })
  if (err instanceof SyntaxError && 'body' in err) return res.status(400).json({ ok: false, error: 'invalid_json' })
  next(err)
})

// ── Start server ─────────────────────────────────────────────────────────
app.listen(PORT, '127.0.0.1', () => {
  console.log(`[report-server] listening on http://localhost:${PORT} (IPv4)`)
  console.log(`[report-server] SPA dist: ${frontendDist} (exists: ${fs.existsSync(frontendDist)})`)
  // Initialize Discord bot for report delivery
  if (process.env.NO_DISCORD !== '1') {
    initDiscordBot().catch(e => console.error('[report-server] Discord init failed:', e.message))
  }
})
