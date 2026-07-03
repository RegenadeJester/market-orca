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
import { ragAsk } from './rag-ask.js'
import { initRagSchema, ragSearch, ragHybridSearch, upsertRagDocument, buildRagContext, ragStorageStats, cleanupRagStore, vectorizeMissingChunks } from './rag.js'
import { enqueueRagCrawl, runRagCrawlWorker, isAllowedSource } from './rag-crawler.js'
import { webSearch, deepWebSearch, searchAndAnswer, fetchPageMarkdown, searchNews, webCacheStats, filterSearchForCrawl, TRUSTED_WEB_SOURCES, classifySearchResult, previewPublicPage } from './web-search.js'
import { getMarketCalendarStatus } from './market-calendar.js'
import { scoreSourceTrust, initSourceReliabilityTable, seedSourceReliability, listSourceReliability, getSourcesTrust } from './source-reliability.js'
import { initPersonaTable, getPersona, upsertPersona, inferPersonaFromActivity, buildContextPrompt } from './persona.js'
import { getTradingViewScreener, getTradingViewChart, getTradingViewTechnical, getTradingViewNews, getTradingViewPopular } from './mcp-tradingview.js'
import { startPipelineRun, logPipelineEvent, completePipelineRun, getLatestPipelineStatus, getRecentPipelineEvents, getPipelineRun, getPipelineStats, getStageBreakdown } from './pipeline-monitor.js'
import { runHealthChecks } from './health.js'
import { fetchIndonesianNews, fetchTrendingNews, INDONESIAN_NEWS_SOURCES } from './news-fetcher.js'
import { getIHSGData, getForexData, getMarketOverview, FOREX_SYMBOLS } from './market-data.js'
import indonesiaRoutes from './indonesia/indonesia-router.js'
// New structured Indonesia modules
import { initIndonesiaTables } from './indonesia/db.js'
import { startIndonesiaCron as startStructuredIndonesiaCron } from './indonesia/cron-indonesia.js'
import { calculateCompositeScore } from './indonesia/indicator-calculator.js'

seedTestAccounts()
seedSourceReliability()
initPersonaTable(db)
initCanvasTables(db)

const app = express()
const PORT = Number(process.env.PORT || 4567)
app.use(compression())
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('X-XSS-Protection', '0')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  res.setHeader('X-Robots-Tag', 'all, index, follow')
  next()
})
app.use(cors({ origin: ['https://market-orca.anomali.web.id', 'https://report.anomali.web.id', 'http://localhost:4567', 'http://localhost:4568', 'http://localhost:5173'], credentials: true }))
app.use(express.json({ limit:'512kb' }))

function baseAssets() {
  return db.prepare('SELECT * FROM assets ORDER BY market, name').all()
}

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {}
  const user = db.prepare('SELECT id,email,role,name,password_hash FROM users WHERE email = ?').get(String(email || '').toLowerCase())
  if (!user || user.password_hash !== hashPassword(password || '')) return res.status(401).json({ ok:false, error:'invalid_credentials' })
  const token = createSession(user.id)
  res.cookie?.('mo_session', token, { httpOnly:true, sameSite:'lax', maxAge:7*24*60*60*1000 })
  res.json({ ok:true, token, user:{ id:user.id, email:user.email, role:user.role, name:user.name } })
})

app.get('/api/me', (req, res) => {
  res.json({ ok:true, user:getUserFromReq(req) })
})

app.post('/api/auth/logout', (req, res) => {
  const user = getUserFromReq(req)
  if (user) db.prepare(`DELETE FROM sessions WHERE user_id=?`).run(user.id)
  res.clearCookie?.('mo_session')
  res.json({ ok:true })
})

app.get('/api/debate/latest', (_req, res) => {
  let thread = db.prepare(`SELECT * FROM debate_threads ORDER BY id DESC LIMIT 1`).get()
  if (!thread) {
    const info = db.prepare(`INSERT INTO debate_threads (title,status) VALUES (?,?)`).run('Hermes + OpenClaw PRD Debate','agreed')
    const id = info.lastInsertRowid
    const msgs = [
      ['Hermes','Auth dulu; export guard tanpa identity = security theater.'],
      ['OpenClaw','Rewrite Astro penuh risk tinggi; incremental Express/Vue safer.'],
      ['Hermes','Private report wajib admin/signed link TTL + watermark + audit.'],
      ['OpenClaw','Set port 1745, seed admin/user, QA endpoints.'],
      ['Agreement','Implement guard/auth/audit now; note Astro/Drizzle migration as next refactor.']
    ]
    for (const [agent, message] of msgs) db.prepare(`INSERT INTO debate_messages (thread_id,agent,message) VALUES (?,?,?)`).run(id, agent, message)
    thread = db.prepare(`SELECT * FROM debate_threads WHERE id=?`).get(id)
  }
  const messages = db.prepare(`SELECT agent,message,created_at FROM debate_messages WHERE thread_id=? ORDER BY id`).all(thread.id)
  res.json({ ok:true, thread, messages })
})

// ── robots.txt ─────────────────────────────────────────────────────────────
app.get('/robots.txt', (_req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.send(`User-agent: *
Allow: /
Disallow: /api/auth/
Disallow: /api/watchlist/remove

Sitemap: https://market-orca.anomali.web.id/sitemap.xml
Sitemap: https://report.anomali.web.id/robots-sitemap.txt

# Market Orca — AI-powered market intelligence
# LLMs.txt: https://market-orca.anomali.web.id/llms.txt
# MCP API: https://mcp.anomali.web.id/mcp/tools`)
})

// ── sitemap.xml ────────────────────────────────────────────────────────────
app.get('/sitemap.xml', (_req, res) => {
  const assets = db.prepare('SELECT slug FROM assets ORDER BY slug').all()
  const reports = fs.existsSync(path.join(__dirname, '..', '..', 'reports'))
    ? fs.readdirSync(path.join(__dirname, '..', '..', 'reports')).filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''))
    : []
  const now = new Date().toISOString().split('T')[0]
  const urls = [
    { loc: 'https://market-orca.anomali.web.id/', priority: '1.0', freq: 'daily' },
    ...assets.map(a => ({ loc: `https://market-orca.anomali.web.id/asset/${a.slug}`, priority: '0.8', freq: 'daily' })),
    { loc: 'https://report.anomali.web.id/report', priority: '0.9', freq: 'daily' },
    ...reports.slice(0, 30).map(s => ({ loc: `https://report.anomali.web.id/report/${s}`, priority: '0.7', freq: 'daily' })),
    { loc: 'https://mcp.anomali.web.id/', priority: '0.6', freq: 'weekly' },
    { loc: 'https://mcp.anomali.web.id/mcp/health', priority: '0.3', freq: 'weekly' },
    { loc: 'https://mcp.anomali.web.id/mcp/tools', priority: '0.5', freq: 'weekly' }
  ]
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${urls.map(u => `  <url><loc>${u.loc}</loc><lastmod>${now}</lastmod><changefreq>${u.freq}</changefreq><priority>${u.priority}</priority></url>`).join('\n')}
</urlset>`
  res.setHeader('Content-Type', 'application/xml; charset=utf-8')
  res.send(xml)
})

// ── llms.txt ───────────────────────────────────────────────────────────────
app.get('/llms.txt', (_req, res) => {
  const assets = db.prepare('SELECT symbol, name, slug FROM assets ORDER BY market, name').all()
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.send(`# Market Orca — AI-powered Market Intelligence & Trading Dashboard
> Real-time Indonesian market data, AI daily reports, trading alerts, and MCP-lite API for AI agents.

## Overview
Market Orca is a full-stack market intelligence platform built for Indonesian markets (IDX, forex, crypto).
It provides: real-time asset tracking, AI daily reports, RAG-powered research, TradingView charts, and an MCP-lite API for programmatic access by AI agents.

## Public APIs

### Market Data (no auth required)
- GET /api/overview — live assets with sparklines + latest news
- GET /api/assets — all tracked assets (query: q=, market=, category=)
- GET /api/indices — Indonesian stock indices (IHSG composite)
- GET /api/forex — forex pairs (IDR-USD, MYR-IDR, SGD-IDR)
- GET /api/news/latest — latest Indonesian news (trusted sources: Kontan, Bisnis, CNBC ID, Tempo, Antara, Katadata, Liputan6)
- GET /api/market/ihsg — IHSG composite index
- GET /api/market/forex — forex pairs
- GET /api/market/overview — market overview
- GET /api/search?q= — symbol/name search

### TradingView Integration (no auth)
- GET /api/tradingview/screener?market=crypto&limit=50 — market screener
- GET /api/tradingview/chart/:symbol — OHLCV candle data
- GET /api/tradingview/technical/:symbol — RSI, MACD, SMA, Bollinger, ATR, VWAP
- GET /api/tradingview/news/:symbol — latest symbol news
- GET /api/tradingview/popular — trending tickers by market cap

### Authenticated APIs (token required)
- POST /api/auth/login — login (body: {email, password})
- GET /api/me — current user info
- GET /api/watchlist — user watchlist
- POST /api/watchlist — add to watchlist (body: {slug})
- GET /api/watchlist/insights — watchlist risk analysis

### MCP-lite API (Bearer token required)
All MCP calls require: Authorization: Bearer <MCP_AUTH_TOKEN>
- GET /mcp — MCP status (public)
- GET /mcp/health — health check (public)
- GET /mcp/tools — tool catalog with schemas (public)
- GET /mcp/metrics — performance metrics (public)
- GET /mcp/openapi.json — OpenAPI 3.1 spec (public)
- POST /mcp/tool/web.search — web search
- POST /mcp/tool/web.deep_search — broad multi-engine search
- POST /mcp/tool/web.fetch_page — read URL to Markdown
- POST /mcp/tool/web.search_and_answer — search + extractive answer
- POST /mcp/tool/web.news_search — news search
- POST /mcp/tool/rag.search — search local RAG evidence store
- POST /mcp/tool/rag.ingest — ingest content into RAG
- POST /mcp/tool/rag.crawl_enqueue — enqueue URL for crawl
- POST /mcp/tool/rag.crawl_run — run crawl worker
- POST /mcp/tool/report.get — get daily report by slug
- POST /mcp/tool/report.blocks — get report evidence blocks
- POST /mcp/tool/tradingview.screener — market screener
- POST /mcp/tool/tradingview.chart — OHLCV chart data
- POST /mcp/tool/tradingview.technical — technical analysis
- POST /mcp/tool/tradingview.news — symbol news
- POST /mcp/tool/tradingview.popular — trending tickers

### Research & RAG APIs (auth required)
- POST /api/rag/crawl/enqueue — enqueue URL for RAG crawl
- POST /api/rag/crawl/run — run RAG crawl worker
- GET /api/rag/storage — RAG storage stats
- POST /api/rag/cleanup — cleanup old RAG chunks
- POST /api/search/web — web search with filters
- POST /api/search/deep — deep multi-mode search
- POST /api/search/web-to-crawl — search + auto-enqueue for crawl

## Trusted News Sources
Kontan, Bisnis.com, CNBC Indonesia, Tempo, Antara, Katadata, Liputan6 — all verified Indonesian financial news.

## Data Tags
🔴 Red Flag — market warnings, significant risks
🟢 Worth Knowing — positive developments
🟡 Model Wars — competitive landscape
🔵 Breaking — breaking news, urgent updates

## Related Services
- Report Dashboard: https://report.anomali.web.id/report — AI daily report viewer
- MCP Docs: https://market-orca.anomali.web.id/docs/mcp — full MCP API documentation
- SearXNG (AROXNG): https://searxng.anomali.web.id — federated search engine`)
})

// ── Favicon emoji SVG ──────────────────────────────────────────────────────
app.get('/favicon.ico', (_req, res) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="80" font-size="80">🐋</text></svg>`
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8')
  res.setHeader('Cache-Control', 'public, max-age=86400')
  res.send(svg)
})

// ── MCP Documentation Page (removed duplicate; see comprehensive version near end of file) ──

// ── Crawl allow on all API routes ─────────────────────────────────────────
app.get('/', (_req, res) => {
  const rd = path.join(__dirname, '..', '..', 'reports')
  const reports = fs.existsSync(rd) ? fs.readdirSync(rd).filter(f => f.endsWith('.json')).sort().reverse().slice(0, 6) : []
  const reportCards = reports.map(f => {
    const slug = f.replace('.json','')
    const d = JSON.parse(fs.readFileSync(path.join(rd, f), 'utf8'))
    const first = (d.topics || []).flatMap(t => t.items || []).find(i => i.title) || {}
    return `<a class="card" href="/report/${slug}"><img src="/report/${slug}/card.png" alt=""><span>${slug}</span><h2>${String(first.title || 'AI Daily Report').replace(/[<>&"]/g,'')}</h2></a>`
  }).join('')
  const assets = db.prepare('SELECT slug,symbol,name,price,change_percent,market FROM assets ORDER BY abs(change_percent) DESC LIMIT 10').all()
  const assetRows = assets.map(a => `<a class="ticker" href="${APP_CONFIG.publicBaseUrl}/asset/${a.slug}"><b>${a.symbol}</b><em>${a.price ?? '-'}</em><strong class="${(a.change_percent||0)>=0?'up':'down'}">${a.change_percent ?? 0}%</strong></a>`).join('')
  const news = db.prepare('SELECT title,source,link,asset_slug FROM news ORDER BY id DESC LIMIT 10').all()
  const newsRows = news.map(n => `<a class="news" href="${n.link || APP_CONFIG.publicBaseUrl + '/asset/' + n.asset_slug}"><b>${String(n.title||'').replace(/[<>&"]/g,'')}</b><span>${n.source || n.asset_slug}</span></a>`).join('')
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.send(`<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>🐋 Market Orca - Financial News & Market Intelligence</title><meta name="description" content="AI-powered market intelligence &amp; trading dashboard for Indonesian markets. Real-time prices, AI daily reports, and trading alerts."><meta name="robots" content="index, follow"><link rel="canonical" href="https://market-orca.anomali.web.id/"><meta property="og:type" content="website"><meta property="og:title" content="Market Orca + AI Report"><meta property="og:description" content="AI-powered market intelligence &amp; trading dashboard for Indonesian markets."><meta property="og:url" content="https://market-orca.anomali.web.id/"><meta property="og:site_name" content="Market Orca"><meta property="og:image" content="https://market-orca.anomali.web.id/favicon.ico"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="Market Orca + AI Report"><meta name="twitter:description" content="AI-powered market intelligence &amp; trading dashboard for Indonesian markets."><script type="application/ld+json">[{"@context":"https://schema.org","@type":"WebSite","name":"Market Orca","url":"https://market-orca.anomali.web.id/","description":"AI-powered market intelligence &amp; trading dashboard","potentialAction":{"@type":"SearchAction","target":{"@type":"EntryPoint","urlTemplate":"https://market-orca.anomali.web.id/market?q={search_term_string}"},"query-input":"required name=search_term_string"}},{"@context":"https://schema.org","@type":"Organization","name":"Market Orca","url":"https://market-orca.anomali.web.id","logo":"https://market-orca.anomali.web.id/favicon.ico","description":"AI-powered market intelligence platform"},{"@context":"https://schema.org","@type":"WebApplication","name":"Market Orca + AI Report","url":"https://market-orca.anomali.web.id","applicationCategory":"FinanceApplication","operatingSystem":"Web","description":"AI-powered market intelligence &amp; trading dashboard for Indonesian markets"}]</script><style>@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&family=Newsreader:opsz,wght@6..72,800&display=swap');*{box-sizing:border-box}body{margin:0;background:#f4f1ea;color:#111;font-family:Inter,system-ui}.wrap{max-width:1180px;margin:auto;padding:24px 14px 70px}.nav{display:flex;justify-content:space-between;gap:12px;border:2px solid #111;background:#fff;padding:10px 12px;box-shadow:4px 4px 0 #111;margin-bottom:18px}.nav a{font-weight:900;color:#111;text-decoration:none;margin-left:12px}.hero{border:3px solid #111;background:#111;color:#fff;padding:clamp(22px,6vw,54px);box-shadow:8px 8px 0 #b45309;margin-bottom:20px}h1{font-family:Newsreader,serif;font-size:clamp(42px,10vw,96px);line-height:.86;letter-spacing:-.075em;margin:0 0 12px}.hero p{font-size:18px;color:#f5f5f4;font-weight:700}.grid{display:grid;grid-template-columns:1.2fr .8fr;gap:16px}.box{background:#fff;border:2px solid #111;padding:16px;box-shadow:5px 5px 0 #111;margin-bottom:16px}h2{font-size:26px;letter-spacing:-.04em}.card,.news,.ticker{display:block;color:#111;text-decoration:none;border-top:1px solid #d6d3d1;padding:12px 0}.card img{width:100%;aspect-ratio:4/5;object-fit:cover;border:2px solid #111;margin-bottom:10px}.card h2{font-family:Newsreader,serif;font-size:28px;line-height:1;margin:6px 0}.card span,.news span{font-size:12px;font-weight:900;color:#b45309;text-transform:uppercase}.ticker{display:grid;grid-template-columns:1fr auto auto;gap:10px}.ticker em{font-style:normal}.up{color:#15803d}.down{color:#b91c1c}@media(max-width:760px){.grid{grid-template-columns:1fr}.nav{flex-direction:column}}</style></head><body><main class="wrap"><nav class="nav"><b>Little Candle</b><div><a href="/">Home</a><a href="/report">Reports</a><a href="/market">Market Orca</a></div></nav><section class="hero"><h1>Market Orca<br>+ AI Report</h1><p>Portal ringkas buat pasar, berita, laporan AI harian, PDF, dan content ideas.</p></section><section class="grid"><div><div class="box"><h2>Latest AI Reports</h2>${reportCards || 'No reports yet.'}</div></div><aside><div class="box"><h2>Market Watch</h2>${assetRows || 'No market data yet.'}</div><div class="box"><h2>Market News</h2>${newsRows || 'No news yet.'}</div></aside></section></main><footer style="max-width:1180px;margin:30px auto;padding:24px 14px;border-top:2px solid #111;font-size:13px;line-height:1.6"><p style="margin:0 0 8px"><strong>🆓 Market Orca — Layanan GRATIS (Free Service)</strong></p><p style="margin:0 0 8px">📋 <strong>Edukasi saja:</strong> Semua data dan berita bersifat edukasi, bukan saran keuangan. Tidak ada jaminan akurasi. / <em>Educational purposes only. Not financial advice. No accuracy guarantee.</em></p><p style="margin:0 0 8px">⚠️ <strong>Scraping Disclaimer:</strong> Data dikumpulkan secara otomatis untuk tujuan edukasi. Kami menghormati semua ketentuan hukum di setiap negara, terutama Indonesia. Gunakan data dengan bijak. / <em>Data collected automatically for educational purposes. We respect all applicable laws, especially in Indonesia. Use data responsibly.</em></p><p style="color:#666;margin-top:16px">🔗 <a href="/report" style="color:#111">Report Dashboard</a> · <a href="/docs/mcp" style="color:#111">MCP Docs</a> · <a href="https://searxng.anomali.web.id" style="color:#111">AROXNG Search</a></p></footer></body></html>`)
})

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
    const todaySlug = todayReportSlug()
    const hasTodayReport = todayReportExists()
    let todayReport = null
    if (hasTodayReport) {
      try {
        const fp = path.join(reportDir, `${todaySlug}.json`)
        const d = JSON.parse(fs.readFileSync(fp, 'utf8'))
        todayReport = {
          slug: todaySlug,
          generatedAt: d.generatedAt || null,
          title: d.executiveBrief?.split('\n')[0] || d.topics?.[0]?.title || todaySlug,
          topicCount: (d.topics || []).length,
          hasIncidents: !!(d.incidents || []).length,
          incidentCount: (d.incidents || []).length
        }
      } catch (e) { console.error('[server] today report read failed:', e.message) }
    }
    res.json({ assets, latestNews, todayReport })
  } catch (error) {
    res.status(500).json({ error: String(error) })
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

app.get('/api/indices', async (req, res) => {
  try {
    const rows = (await getLiveAssets(baseAssets())).map((x) => x.asset).filter((r) => r.category === 'index')
    res.json(rows)
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

app.get('/api/forex', async (req, res) => {
  try {
    const rows = (await getLiveAssets(baseAssets())).map((x) => x.asset).filter((r) => r.market === 'FOREX')
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
  const assets = slugs.length ? db.prepare(`SELECT * FROM assets WHERE slug IN (${slugs.map(()=>'?').join(',')})`).all(...slugs) : []
  const rows = assets.map(a => {
    const news = db.prepare('SELECT title,summary,source,created_at FROM news WHERE asset_slug = ? ORDER BY id DESC LIMIT 1').get(a.slug)
    const momentum = Number(Math.abs(a.change_percent || 0).toFixed(2))
    const risk = momentum >= 5 ? 'high' : momentum >= 2 ? 'medium' : 'low'
    const action = risk === 'high' ? 'review now' : risk === 'medium' ? 'watch' : 'ignore unless catalyst changes'
    return { slug:a.slug, symbol:a.symbol, name:a.name, price:a.price, change_percent:a.change_percent, momentum, risk, action, catalyst: news ? { title:news.title, summary:news.summary, source:news.source, created_at:news.created_at } : null }
  }).sort((a,b)=>b.momentum-a.momentum)
  res.json({ ok:true, count:rows.length, top_risk:rows[0] || null, items:rows })
})

const defaultReportPrefs = {
  tone: 'balanced',
  depth: 'normal',
  language: 'id',
  priority_topics: 'market,indonesia,watchlist',
  favorite_assets: '',
  discord_spam_level: 'digest'
}

function cleanPref(value, allowed, fallback) {
  const v = String(value || '').trim().slice(0, 80)
  return allowed.includes(v) ? v : fallback
}


function ensureDecisionFingerprintSchema(){ db.exec(`CREATE TABLE IF NOT EXISTS decision_context_fingerprints (id INTEGER PRIMARY KEY CHECK(id=1), fingerprint TEXT NOT NULL, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')));`) }
function stableHash(str){ let h=2166136261; for(let i=0;i<str.length;i++){ h^=str.charCodeAt(i); h=Math.imul(h,16777619) } return (h>>>0).toString(16) }
function buildDecisionContextFingerprint(){
  ensureDecisionFingerprintSchema()
  const prefs = db.prepare('SELECT * FROM user_report_preferences WHERE id=1').get() || {}
  const answers = db.prepare('SELECT key,value,confidence,source,updated_at FROM user_context_answers ORDER BY key').all()
  let assets=[]; try{ assets=db.prepare('SELECT symbol,name FROM assets WHERE pinned=1 OR enabled=1 ORDER BY symbol LIMIT 50').all() }catch{}
  const payload = { goal:answers.find(a=>a.key==='goal')?.value||'', time_horizon:answers.find(a=>a.key==='time_horizon')?.value||'', watchlist_priority:answers.find(a=>a.key==='watchlist_priority')?.value||prefs.favorite_assets||'', risk_tolerance:answers.find(a=>a.key==='risk_tolerance')?.value||'', preferred_action:answers.find(a=>a.key==='preferred_action')?.value||'', language:prefs.language||'id', depth:prefs.depth||'normal', tone:prefs.tone||'balanced', discord_spam_level:prefs.discord_spam_level||'digest', assets }
  const fingerprint = stableHash(JSON.stringify(payload))
  db.prepare(`INSERT INTO decision_context_fingerprints (id,fingerprint,payload_json,context_json,updated_at) VALUES (1,?,?,?,datetime('now')) ON CONFLICT(id) DO UPDATE SET fingerprint=excluded.fingerprint,payload_json=excluded.payload_json,context_json=excluded.context_json,updated_at=datetime('now')`).run(fingerprint, JSON.stringify(payload), JSON.stringify(payload))
  return { fingerprint, payload }
}

function contextGapDetector() {
  const required = [
    ['goal','Tujuan utama report ini untuk apa: trading cepat, investasi panjang, riset kompetitor, atau monitoring risiko?'],
    ['time_horizon','Horizon keputusan yang dipakai: intraday, mingguan, bulanan, atau jangka panjang?'],
    ['watchlist_priority','Asset/watchlist mana yang paling prioritas hari ini?'],
    ['risk_tolerance','Toleransi risiko: konservatif, normal, agresif?'],
    ['preferred_action','Output aksi yang diinginkan: buy/sell/watch, risk alert, atau research note?']
  ]
  const rows = db.prepare('SELECT key,value,confidence,source,updated_at FROM user_context_answers').all()
  const map = new Map(rows.map(r => [r.key, r]))
  const missing = required.filter(([k]) => !map.has(k) || !String(map.get(k).value || '').trim())
  const questions = missing.slice(0,3).map(([key, question]) => ({ key, question }))
  const assumptions = missing.map(([key]) => ({ key, value: inferContextAssumption(key), confidence:0.35, source:'inferred' }))
  return { required: required.map(([key])=>key), answers:Object.fromEntries(rows.map(r=>[r.key,r])), missing:missing.map(([key])=>key), questions, assumptions, confidence: missing.length ? 'low' : 'high' }
}
function inferContextAssumption(key) {
  const fallback = { goal:'monitoring risiko dan peluang market harian', time_horizon:'harian sampai mingguan', watchlist_priority:'watchlist aktif + USD/IDR + JKSE', risk_tolerance:'normal', preferred_action:'watch + risk alert + next signal' }
  return fallback[key] || 'unknown'
}
function contextBlockForReport() {
  const g = contextGapDetector()
  const pairs = g.required.map(k => g.answers[k] ? `${k}: ${g.answers[k].value} (${g.answers[k].confidence})` : `${k}: assumed ${inferContextAssumption(k)} (low confidence)`).join('\n- ')
  return `## Context Gap Interviewer\n- Confidence: ${g.confidence}\n- ${pairs}\n${g.questions.length ? `\nHighest-impact questions:\n${g.questions.map(q=>`- ${q.question}`).join('\n')}` : ''}`
}

function alertRecommendation(asset, history = []) {
  const moves = history.map(r => Math.abs(Number(r.change_percent))).filter(Number.isFinite)
  const avgMove = moves.length ? moves.reduce((a,b)=>a+b,0) / moves.length : Math.abs(Number(asset.change_percent || 0))
  const marketBase = asset.market === 'CRYPTO' ? 3 : asset.market === 'IDX' ? 1.5 : 2
  const vol = Math.max(marketBase * 0.7, avgMove * 1.35)
  const up = Number(Math.min(12, Math.max(0.8, vol)).toFixed(2))
  const down = Number((-up).toFixed(2))
  const confidence = moves.length >= 20 ? 'high' : moves.length >= 6 ? 'medium' : 'low'
  return { recommended_threshold_up: up, recommended_threshold_down: down, basis: { market: asset.market, samples: moves.length, avg_abs_change_percent: Number(avgMove.toFixed(2)), confidence } }
}

app.get('/api/report-context/gaps', (_req, res) => res.json({ ok:true, ...contextGapDetector() }))
app.put('/api/report-context/answer', (req, res) => {
  const key = String(req.body?.key || '').replace(/[^a-z_]/g,'').slice(0,40)
  const value = String(req.body?.value || '').trim().slice(0,500)
  if (!key || !value) return res.status(400).json({ ok:false, error:'key/value required' })
  db.prepare(`INSERT INTO user_context_answers (key,value,confidence,source,updated_at) VALUES (?,?,?,?,datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, confidence=excluded.confidence, source=excluded.source, updated_at=datetime('now')`).run(key,value,Number(req.body?.confidence ?? 1),'user')
  res.json({ ok:true, ...contextGapDetector() })
})

app.get('/api/decision-context/fingerprint', (_req, res) => { try { res.json({ ok:true, ...buildDecisionContextFingerprint() }) } catch(error){ res.status(500).json({ ok:false,error:String(error) }) } })
app.post('/api/decision-context/fingerprint/refresh', (_req, res) => { try { res.json({ ok:true, ...buildDecisionContextFingerprint() }) } catch(error){ res.status(500).json({ ok:false,error:String(error) }) } })

app.get('/api/report-preferences', (_req, res) => {
  const row = db.prepare('SELECT * FROM user_report_preferences WHERE id = 1').get()
  res.json({ ok:true, preferences:{ ...defaultReportPrefs, ...(row || {}) } })
})

// ── User Persona API ──────────────────────────────────
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

// ── Report Canvas API ──────────────────────────────────────────
const _canvasReportDir = path.join(__dirname, '..', '..', 'reports')

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
    // Validate: arrays of strings only
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

app.put('/api/report-preferences', (req, res) => {
  const body = req.body || {}
  const prefs = {
    tone: cleanPref(body.tone, ['concise','balanced','analytical'], defaultReportPrefs.tone),
    depth: cleanPref(body.depth, ['brief','normal','deep'], defaultReportPrefs.depth),
    language: cleanPref(body.language, ['id','en','mixed'], defaultReportPrefs.language),
    priority_topics: String(body.priority_topics || defaultReportPrefs.priority_topics).replace(/[^\w\s,.-]/g, '').slice(0, 240),
    favorite_assets: String(body.favorite_assets || '').replace(/[^\w\s,.-]/g, '').slice(0, 240),
    discord_spam_level: cleanPref(body.discord_spam_level, ['digest','normal','full'], defaultReportPrefs.discord_spam_level)
  }
  db.prepare(`INSERT INTO user_report_preferences (id,tone,depth,language,priority_topics,favorite_assets,discord_spam_level,updated_at)
    VALUES (1,@tone,@depth,@language,@priority_topics,@favorite_assets,@discord_spam_level,datetime('now'))
    ON CONFLICT(id) DO UPDATE SET tone=excluded.tone, depth=excluded.depth, language=excluded.language, priority_topics=excluded.priority_topics, favorite_assets=excluded.favorite_assets, discord_spam_level=excluded.discord_spam_level, updated_at=datetime('now')`).run(prefs)
  res.json({ ok:true, preferences:prefs })
})

app.get('/api/market/anomalies', async (req,res)=>{
  try {
    const priceThreshold = Number(req.query.price || req.query.priceThreshold || 10)
    const volumeThreshold = Number(req.query.volume || req.query.volumeMultiplier || 2)
    const assets = db.prepare('SELECT slug,symbol,name,market,price,change_percent FROM assets ORDER BY abs(change_percent) DESC LIMIT 100').all()
    const rows = assets.map(a=>{
      const candles = db.prepare('SELECT volume FROM candles WHERE asset_slug=? ORDER BY id DESC LIMIT 8').all(a.slug)
      const latest = Number(candles[0]?.volume || 0)
      const vols = candles.slice(1).map(c=>Number(c.volume||0)).filter(Boolean)
      const avg = vols.reduce((x,y)=>x+y,0)/Math.max(1,vols.length)
      const volumeRatio = avg ? Number((latest/avg).toFixed(2)) : 0
      return { ...a, priceMove:Number(a.change_percent||0), volumeRatio, volume:latest, avgVolume:Number(avg.toFixed(2)) }
    }).filter(a=>Math.abs(a.priceMove)>=priceThreshold || a.volumeRatio>=volumeThreshold).slice(0,50)
    res.json({ ok:true, thresholds:{ pricePercent:priceThreshold, volumeRatio:volumeThreshold }, count:rows.length, anomalies:rows })
  } catch(error){ res.status(500).json({ ok:false, error:String(error) }) }
})

app.get('/api/market-calendar', (req, res) => {
  try { getMarketCalendarStatus(req, res) }
  catch (error) { res.status(500).json({ ok:false, error:String(error) }) }
})

app.get('/api/rag/storage', (_req, res) => {
  try { res.json({ ok:true, stats:ragStorageStats() }) }
  catch (error) { res.status(500).json({ ok:false, error:String(error) }) }
})

app.post('/api/rag/cleanup', (req, res) => {
  try { res.json(cleanupRagStore({ maxAgeDays:Number(req.body?.maxAgeDays || 60), maxChunks:Number(req.body?.maxChunks || 20000) })) }
  catch (error) { res.status(500).json({ ok:false, error:String(error) }) }
})


app.post('/api/rag/vectorize-missing', (req, res) => {
  try { res.json(vectorizeMissingChunks({ limit:Number(req.body?.limit || req.query.limit || 100) })) }
  catch (error) { res.status(500).json({ ok:false, error:String(error) }) }
})

// ── RAG Autolearn endpoints ─────────────────────────────────────────────
import { ingestAllReports, searchByTopic, getCollectionStats, autoCreateCollections, ingestReport, ingestReportAsTemplate, ingestBestReportTemplates, searchReportTemplates, qaReport } from './rag-autolearn.js'

app.get('/api/rag/autolearn/stats', (_req, res) => {
  try { res.json(getCollectionStats()) }
  catch (error) { res.status(500).json({ ok:false, error:String(error) }) }
})

app.get('/api/rag/autolearn/collections', (_req, res) => {
  try { res.json({ ok:true, collections:autoCreateCollections() }) }
  catch (error) { res.status(500).json({ ok:false, error:String(error) }) }
})

app.post('/api/rag/autolearn/ingest', (req, res) => {
  try {
    const slug = req.body?.slug
    if (slug) return res.json(ingestReport(slug))
    res.json(ingestAllReports())
  } catch (error) { res.status(500).json({ ok:false, error:String(error) }) }
})

app.post('/api/rag/autolearn/search', (req, res) => {
  try {
    const query = req.body?.query || req.query?.q || ''
    const topic = req.body?.topic || req.query?.topic || ''
    const limit = Number(req.body?.limit || req.query?.limit || 8)
    res.json(searchByTopic(query, { limit, topic }))
  } catch (error) { res.status(500).json({ ok:false, error:String(error) }) }
})


// ── RAG Report QA & Templates ──────────────────────────────────────

app.get('/api/rag/qa-report/:slug', (req, res) => {
  try { res.json(qaReport(req.params.slug)) }
  catch (error) { res.status(500).json({ ok:false, error:String(error) }) }
})

app.post('/api/rag/qa-report', (req, res) => {
  try {
    const slug = req.body?.slug
    if (!slug) return res.status(400).json({ ok:false, error:"slug required" })
    res.json(qaReport(slug))
  } catch (error) { res.status(500).json({ ok:false, error:String(error) }) }
})

app.post('/api/rag/template/ingest', (req, res) => {
  try {
    const slug = req.body?.slug
    if (slug) return res.json(ingestReportAsTemplate(slug))
    res.json(ingestBestReportTemplates())
  } catch (error) { res.status(500).json({ ok:false, error:String(error) }) }
})

app.post('/api/rag/template/search', (req, res) => {
  try {
    const query = req.body?.query || req.query?.q || ''
    const limit = Number(req.body?.limit || req.query?.limit || 5)
    res.json(searchReportTemplates(query, { limit }))
  } catch (error) { res.status(500).json({ ok:false, error:String(error) }) }
})

app.post('/api/rag/ask', async (req, res) => {
  try {
    const query = req.body?.query || ''
    if (!query) return res.status(400).json({ ok:false, error:"query required" })
    const result = await ragAsk(query, {
      limit: Number(req.body?.limit || 10),
      topic: req.body?.topic || '',
      model: req.body?.model || 'sonar'
    })
    res.json(result)
  } catch (error) { res.status(500).json({ ok:false, error:String(error) }) }
})

function webSearchOptions(body={}, defaultLimit=10){
  return {
    limit:Number(body?.limit||defaultLimit),
    engines:body?.engines||['duckduckgo'],
    mode:String(body?.mode||''),
    preferTrusted:body?.preferTrusted!==false,
    sites:Array.isArray(body?.sites)?body.sites:[],
    domains:Array.isArray(body?.domains)?body.domains:[],
    site:String(body?.site||''),
    excludeSites:Array.isArray(body?.excludeSites)?body.excludeSites:[],
    filetype:String(body?.filetype||''),
    intitle:String(body?.intitle||''),
    exact:String(body?.exact||''),
    after:String(body?.after||''),
    before:String(body?.before||''),
    time_range:String(body?.time_range||body?.timeRange||''),
    mustHave:Array.isArray(body?.mustHave)?body.mustHave:[],
    autoPreview:body?.autoPreview===true,
    previewLimit:Number(body?.previewLimit||3),
    dynamic:body?.dynamic!==false
  }
}

app.get('/api/search/trusted-sources', (_req, res) => res.json({ ok:true, sources:TRUSTED_WEB_SOURCES }))
app.post('/api/search/web', async (req, res) => {
  try { const q=String(req.body?.query||''); const opts=webSearchOptions(req.body,10); const out=await webSearch(q, opts); if(!out.results?.length) out.fallbackResults=ragHybridSearch(q,{limit:opts.limit,section:'web-fallback'}).map(r=>({...r,source:'local_rag_fallback'})); res.json(out) }
  catch(error){ res.status(500).json({ ok:false, error:String(error) }) }
})
app.post('/api/search/preview', async (req, res) => {
  try { res.json(await previewPublicPage(String(req.body?.url||''))) }
  catch(error){ res.status(500).json({ ok:false, error:String(error) }) }
})

app.post('/api/search/web-to-crawl', async (req, res) => {
  try { const q=String(req.body?.query||''); const opts=webSearchOptions(req.body,8); const out=await webSearch(q, opts); if(!out.results?.length) out.fallbackResults=ragHybridSearch(q,{limit:opts.limit,section:'web-fallback'}).map(r=>({...r,source:'local_rag_fallback'})); const filtered=await filterSearchForCrawl(out.results,{allowUntrusted:true, openDocsOnly:!!req.body?.openDocsOnly}); for(const r of filtered.filter(x=>x.crawlAllowed).slice(0, Number(req.body?.enqueueLimit||3))) enqueueRagCrawl(r.url,{source:r.domain,assetTags:req.body?.assetTags||[]}); res.json({...out, crawlCandidates:filtered}) }
  catch(error){ res.status(500).json({ ok:false, error:String(error) }) }
})

function searchRelevance(target='', r={}) {
  const terms=String(target).toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length>2)
  const hay=`${r.title||''} ${r.snippet||''} ${r.url||''}`.toLowerCase()
  const exact=hay.includes(String(target).toLowerCase()) ? 30 : 0
  const hits=terms.reduce((n,t)=>n+(hay.includes(t)?1:0),0)
  return Math.min(100, exact + Math.round((hits/Math.max(1,terms.length))*60) + (r.openDoc?10:0) + (r.social?-10:0))
}

app.post('/api/search/deep', async (req,res)=>{
  try {
    const target=String(req.body?.query||req.body?.target||'').trim()
    if(!target) return res.status(400).json({ok:false,error:'query_required'})
    const isUrl=/^https?:\/\//i.test(target)
    const queries=isUrl ? [target, `"${target}"`] : [target, `"${target.replace(/"/g,'')}"`, `${target} pdf`, `${target} jurnal OR journal OR repository`, `${target} reddit OR forum OR medium OR substack`]
    const modes=req.body?.modes||['','official','market','journal','thesis','forum','blog','coding','marketing']
    const limit=Number(req.body?.limit||30)
    const all=[]; const errors=[]
    for (const q of queries.slice(0, Number(req.body?.queryPasses||2))) for (const mode of modes.slice(0, Number(req.body?.modePasses||1))) {
      const out=await webSearch(q,{limit:Math.min(8,limit),engines:req.body?.engines||['searxng'],mode,dynamic:false,preferTrusted:req.body?.preferTrusted!==false}).catch(e=>({ok:false,error:String(e),results:[]}))
      if(out.error) errors.push({q,mode,error:out.error}); else all.push(...(out.results||[]))
    }
    const seen=new Set(); const results=[]
    for(const r of all){ const k=String(r.url||'').replace(/[#?].*$/,''); if(!k||seen.has(k)) continue; seen.add(k); const cls=classifySearchResult(r); results.push({...r,...cls,relevance:searchRelevance(target,{...r,...cls})}) }
    results.sort((a,b)=>b.relevance-a.relevance || (b.quality||0)-(a.quality||0))
    const openDocs=results.filter(r=>r.safeToAutoCrawl)
    const enqueued=[]
    if(req.body?.autoCrawlOpenDocs){ for(const r of openDocs.slice(0, Number(req.body?.enqueueLimit||5))) enqueued.push(enqueueRagCrawl(r.url,{source:r.domain,assetTags:['deep-search','open-doc']})) }
    res.json({ok:true,target,summary:{results:results.length,openDocs:openDocs.length,enqueued:enqueued.length},results:results.slice(0,limit),openDocs:openDocs.slice(0,limit),enqueued,errors})
  } catch(error){ res.status(500).json({ok:false,error:String(error)}) }
})

app.post('/api/search/profile-safe', async (req,res)=>{
  try {
    const name=String(req.body?.name||req.body?.query||'').trim()
    if(!name) return res.status(400).json({ok:false,error:'name_required'})
    const deep = req.body?.deep === true
    const out=await webSearch(deep ? name : `"${name.replace(/"/g,'')}"`, { limit:Number(req.body?.limit||20), engines:req.body?.engines||['searxng'], preferTrusted:false, dynamic:deep, mode:req.body?.mode||'' })
    const results=(out.results||[]).map(r=>({...r,...classifySearchResult(r)}))
    const publicOpenDocs=results.filter(r=>r.safeToAutoCrawl)
    const social=results.filter(r=>r.social)
    const enqueued=[]
    if(req.body?.autoCrawlOpenDocs){ for(const r of publicOpenDocs.slice(0, Number(req.body?.enqueueLimit||3))) enqueued.push(enqueueRagCrawl(r.url,{source:r.domain,assetTags:['profile-safe','open-doc']})) }
    res.json({ ok:true, name, privacy:'public-sources-only; no private inference; social not auto-crawled', summary:{ resultCount:results.length, openDocCount:publicOpenDocs.length, socialCount:social.length, enqueued:enqueued.length }, results, publicOpenDocs, social, enqueued })
  } catch(error){ res.status(500).json({ok:false,error:String(error)}) }
})

function stableFingerprint(input={}) {
  const core = JSON.stringify(input, Object.keys(input).sort())
  return crypto.createHash('sha256').update(core).digest('hex').slice(0,24)
}
app.post('/api/decision-context/fingerprint', (req,res)=>{
  const user = getUserFromReq(req)
  const context = { intent:String(req.body?.intent||''), route:String(req.body?.route||''), asset:req.body?.asset||'', horizon:req.body?.horizon||'', risk:req.body?.risk||'', evidence_ids:req.body?.evidence_ids||[], prefs:req.body?.prefs||{}, ts_bucket:new Date().toISOString().slice(0,10) }
  const fingerprint = stableFingerprint(context)
  db.prepare(`INSERT OR IGNORE INTO decision_context_fingerprints (fingerprint,user_id,route,intent,context_json) VALUES (?,?,?,?,?)`).run(fingerprint,user?.id||null,context.route,context.intent,JSON.stringify(context))
  res.json({ ok:true, fingerprint, context })
})

app.post('/api/rag/crawl/enqueue', async (req, res) => {
  try { const url=String(req.body?.url||''); const policy=await isAllowedSource(url); if(!policy.ok) return res.status(400).json({ok:false,error:policy.reason}); res.json(enqueueRagCrawl(url,{source:req.body?.source||policy.host,assetTags:req.body?.assetTags||[]})) }
  catch(error){ res.status(500).json({ok:false,error:String(error)}) }
})
app.post('/api/rag/crawl/run', async (req, res) => {
  try { res.json(await runRagCrawlWorker({limit:Number(req.body?.limit||3)})) }
  catch(error){ res.status(500).json({ok:false,error:String(error)}) }
})



// ── TradingView REST API routes ───────────────────────────────────
app.get('/api/tradingview/screener', async (req, res) => {
  try {
    const market = String(req.query.market || 'crypto')
    const filters = {
      limit: Math.min(Number(req.query.limit || 50), 200),
      sortBy: String(req.query.sortBy || 'volume'),
      sortOrder: String(req.query.sortOrder || 'desc')
    }
    if (req.query.columns) filters.columns = String(req.query.columns).split(',').map(s => s.trim())
    if (req.query.filter) { try { filters.filter = JSON.parse(req.query.filter) } catch (e) { console.error('[server] filter parse failed:', e.message) } }
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
// ──────────────────────────────────────────────────────────────────

// ── Indonesian News Routes ──────────────────────────────────────
app.get('/api/news/latest', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 20), 50)
    const timeRange = String(req.query.time_range || req.query.timeRange || 'day')
    const out = await fetchTrendingNews({ limit, timeRange })
    res.json(out)
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

app.get('/api/news/search', async (req, res) => {
  try {
    const q = String(req.query.q || req.query.query || '').trim()
    const limit = Math.min(Number(req.query.limit || 15), 50)
    const timeRange = String(req.query.time_range || req.query.timeRange || 'week')
    const language = String(req.query.language || 'id')
    if (!q) return res.status(400).json({ ok: false, error: 'query_required' })
    const out = await fetchIndonesianNews({ query: q, limit, timeRange, language })
    res.json(out)
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ── Market News → Discord ─────────────────────────────────────────
app.get('/api/discord/market-news', async (req, res) => {
  try {
    const { sendDiscordNews } = await import('./discord.js')
    // Fetch latest news from news-fetcher
    const newsData = await fetchTrendingNews({ limit: 8, timeRange: 'day' })
    const result = await sendDiscordNews(newsData.results || [])
    res.json({ ok: true, discord: result, count: newsData.count })
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

app.post('/api/discord/market-news', async (req, res) => {
  try {
    const { sendDiscordNews } = await import('./discord.js')
    const body = req.body || {}
    // Accept custom embeds or raw news data
    if (body.embeds) {
      // Direct embed send
      const channel = await (await import('./discord.js')).getBotClient()
        ?.channels?.fetch('1517112059358220289')
      if (channel) {
        await channel.send({ embeds: body.embeds })
        return res.json({ ok: true, sent: true })
      }
      return res.json({ ok: false, error: 'channel_not_found' })
    }
    const result = await sendDiscordNews(body.news || [])
    res.json({ ok: true, discord: result })
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ── IHSG & Forex Routes ─────────────────────────────────────────
app.get('/api/market/ihsg', async (req, res) => {
  try { res.json(await getIHSGData()) }
  catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

app.get('/api/market/forex', async (req, res) => {
  try { res.json(await getForexData()) }
  catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

app.get('/api/market/overview', async (req, res) => {
  try { res.json(await getMarketOverview()) }
  catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ── Alert Dashboard Summary ──────────────────────────────────
app.get('/api/market/alerts-summary', (_req, res) => {
  try {
    const triggered = db.prepare(`
      SELECT a.*, n.link AS news_link, n.title AS news_title
      FROM alerts a
      LEFT JOIN news n ON n.id = (SELECT id FROM news WHERE asset_slug = a.asset_slug ORDER BY id DESC LIMIT 1)
      ORDER BY a.id DESC LIMIT 10
    `).all()

    const suggested = db.prepare(
      "SELECT s.*, a.symbol, a.name, a.price AS current_price, a.change_percent FROM suggested_alerts s LEFT JOIN assets a ON a.slug = s.asset_slug WHERE s.status = 'pending' ORDER BY s.id DESC LIMIT 10"
    ).all()
    suggested.forEach(s => {
      s.distance_pct = s.current_price ? Number((((s.target_price - s.current_price) / s.current_price) * 100).toFixed(2)) : 0
      s.asset_symbol = s.asset_symbol || s.symbol
    })

    const assets = db.prepare('SELECT * FROM assets').all()
    const threshold_alerts = assets.map(a => {
      const t = db.prepare('SELECT * FROM asset_settings WHERE asset_slug = ?').get(a.slug) || {}
      const upTh = t.threshold_up ?? a.threshold_up ?? (a.market === 'CRYPTO' ? 3 : a.market === 'IDX' ? 1.5 : 2)
      const downTh = t.threshold_down ?? a.threshold_down ?? -upTh
      const change = a.change_percent || 0
      let breach = 'none'
      if (change >= upTh) breach = 'up'
      else if (change <= downTh) breach = 'down'
      return {
        asset_slug: a.slug, symbol: a.symbol, name: a.name, market: a.market,
        current_price: a.price, change_percent: change,
        threshold_up: upTh, threshold_down: downTh, breach,
        severity: breach !== 'none' ? (Math.abs(change) >= upTh * 1.5 ? 'critical' : 'warning') : 'none'
      }
    }).filter(a => a.breach !== 'none' || a.market)

    const summary = {
      critical: threshold_alerts.filter(a => a.severity === 'critical').length,
      warning: threshold_alerts.filter(a => a.severity === 'warning').length,
      triggered: triggered.length,
      suggested: suggested.length
    }

    res.json({ summary, triggered, suggested, threshold_alerts })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ── Health Check Endpoint ───────────────────────────────────────
app.get('/api/health', async (_req, res) => {
  try {
    const health = await runHealthChecks()
    res.json(health)
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error) })
  }
})

// ── Pipeline Monitor Routes ──────────────────────────────────────
app.get('/api/pipeline/stats', (_req, res) => {
  try { res.json(getPipelineStats()) }
  catch (error) { res.status(500).json({ ok: false, error: String(error) }) }
})

app.get('/api/pipeline/latest', (_req, res) => {
  try { res.json(getLatestPipelineStatus()) }
  catch (error) { res.status(500).json({ ok: false, error: String(error) }) }
})

app.get('/api/pipeline/recent', (req, res) => {
  try { res.json(getRecentPipelineEvents(Number(req.query.limit || 20))) }
  catch (error) { res.status(500).json({ ok: false, error: String(error) }) }
})

app.get('/api/pipeline/run/:id', (req, res) => {
  try {
    const run = getPipelineRun(Number(req.params.id))
    if (!run.ok) return res.status(404).json(run)
    res.json(run)
  } catch (error) { res.status(500).json({ ok: false, error: String(error) }) }
})

app.get('/api/pipeline/run/:id/stages', (req, res) => {
  try { res.json(getStageBreakdown(Number(req.params.id))) }
  catch (error) { res.status(500).json({ ok: false, error: String(error) }) }
})

const MCP_TOOLS = [
  {name:'web.search', description:'Focused web search with modes/filters. No LLM token required.', input:{query:'string', mode:'market|official|coding|journal|forum|blog|person|...', engines:['bing','yahoo','duckduckgo'], limit:5, time_range:'day|week|month|year', domains:['example.com']}},
  {name:'web.deep_search', description:'Broad multi-mode/multi-engine search; merge/dedupe/rank/cluster.', input:{query:'string', modes:['market','official'], engines:['bing','yahoo'], limit:20, autoPreview:false}},
  {name:'web.fetch_page', description:'Read one public URL into clean Markdown.', input:{url:'string', maxChars:12000}},
  {name:'web.search_and_answer', description:'Local Perplexity-style search+read+extractive answer with citations. No LLM token required.', input:{query:'string', limit:6, readLimit:3}},
  {name:'web.search_to_crawl', description:'Search, filter crawl-safe URLs, enqueue into RAG crawl queue.', input:{query:'string', mode:'official', enqueueLimit:3, assetTags:['USDIDR']}},
  {name:'rag.search', description:'Search local RAG evidence store.', input:{query:'string', limit:8}},
  {name:'rag.ingest', description:'Ingest manual content into RAG.', input:{url:'string', title:'string', content:'string', assetTags:[]}},
  {name:'rag.crawl_enqueue', description:'Enqueue one allowed URL for crawl.', input:{url:'string', assetTags:[]}},
  {name:'rag.crawl_run', description:'Run crawl worker with safe limit.', input:{limit:3}},
  {name:'rag.vectorize_missing', description:'Generate local hashed vectors for missing chunks.', input:{limit:100}},
  {name:'rag.cleanup', description:'Cleanup old/excess RAG chunks.', input:{maxAgeDays:60, maxChunks:20000}},
  {name:'rag.storage', description:'RAG storage stats.', input:{}},
  {name:'report.get', description:'Get saved daily report JSON by slug.', input:{slug:'YYYY-MM-DD'}},
  {name:'web.news_search', description:'Search latest news by query. Returns title, url, snippet, source, published_at. Supports language/time_range filter.', input:{query:'string', limit:10, language:'id|en|all', time_range:'day|week|month|year'}},
  {name:'report.blocks', description:'Get report evidence blocks and quality.', input:{slug:'YYYY-MM-DD'}},
  {name:'tradingview.screener', description:'TradingView market screener – stock/crypto/forex scanner with filters.', input:{market:'crypto|america|forex', limit:50, sortBy:'volume', columns:['name','close','change','volume','market_cap_basic']}},
  {name:'tradingview.chart', description:'OHLCV chart data from TradingView/Yahoo/Binance for any symbol.', input:{symbol:'BTCUSDT', timeframe:'D|W|M'}},
  {name:'tradingview.technical', description:'Full technical analysis: RSI, MACD, SMA, Bollinger, ATR, VWAP + signals.', input:{symbol:'BTCUSDT', timeframe:'D'}},
  {name:'tradingview.news', description:'Latest news for a crypto/stock symbol from CryptoCompare.', input:{symbol:'BTC', limit:15}},
  {name:'tradingview.popular', description:'Popular/trending tickers by market cap from TradingView screener.', input:{market:'crypto'}},
  {name:'rag.autolearn.stats', description:'RAG autolearn stats — documents, chunks, collections.', input:{}},
  {name:'rag.autolearn.collections', description:'List all topic collections with counts.', input:{}},
  {name:'rag.autolearn.search', description:'Topic-aware RAG search (Perplexity-style). Returns chunks with topic classification.', input:{query:'string', topic:'idx|forex|crypto|commodity|macro|global|tech|energy', limit:8}},
  {name:'rag.autolearn.ingest', description:'Ingest reports into RAG autolearn. Pass slug for one report, empty for all.', input:{slug:'YYYY-MM-DD'}}
]

const MCP_METRICS = { startedAt:new Date().toISOString(), total:0, ok:0, fail:0, byTool:{}, rateLimited:0 }
const MCP_RATE = new Map()
function mcpRateLimit(req,res,next){
  const ip=req.ip||req.socket?.remoteAddress||'unknown'; const now=Date.now(); const win=60000; const max=Number(process.env.MCP_RATE_LIMIT_PER_MIN||120)
  const bucket=MCP_RATE.get(ip)||[]; const fresh=bucket.filter(t=>now-t<win); fresh.push(now); MCP_RATE.set(ip,fresh)
  if(fresh.length>max){ MCP_METRICS.rateLimited++; return res.status(429).json({ok:false,error:'rate_limited',limitPerMinute:max}) }
  next()
}
function mcpMetric(tool,ok,ms){ MCP_METRICS.total++; if(ok) MCP_METRICS.ok++; else MCP_METRICS.fail++; const b=MCP_METRICS.byTool[tool] ||= {count:0,ok:0,fail:0,lastMs:0,maxMs:0}; b.count++; ok?b.ok++:b.fail++; b.lastMs=Math.round(ms); b.maxMs=Math.max(b.maxMs,Math.round(ms)) }

function mcpRequire(req,res,next){
  const token=process.env.MCP_AUTH_TOKEN||''
  if(token){ const got=(req.headers.authorization||'').replace(/^Bearer\s+/i,'') || String(req.headers['x-mcp-token']||''); if(got!==token) return res.status(401).json({ok:false,error:'unauthorized',hint:'send Authorization: Bearer <MCP_AUTH_TOKEN>'}) }
  const len=Number(req.headers['content-length']||0); if(len>512000) return res.status(413).json({ok:false,error:'payload_too_large',maxBytes:512000})
  next()
}
function withTimeout(promise, ms=45000){ return Promise.race([promise, new Promise((_,rej)=>setTimeout(()=>rej(new Error('mcp_timeout')),ms))]) }
function mcpError(res,error,tool=''){ const msg=String(error?.message||error); const status=msg==='mcp_timeout'?504:500; return res.status(status).json({ok:false,tool,error:msg}) }

app.get('/mcp', (req, res) => {
  res.json({ ok: true, name: 'market-orca-rag-mcp-lite', version: '1.2.0', docs: '/mcp/health', tools: '/mcp/tools', play: '/mcp/tool/{tool}' })
})

app.get('/mcp/health', (_req, res) => res.json({ ok:true, name:'market-orca-rag-mcp-lite', version:'1.2.0', transport:'http+stdio', auth:process.env.MCP_AUTH_TOKEN?'bearer':'none', tools:MCP_TOOLS.map(t=>t.name) }))
app.get('/mcp/tools', (_req,res)=>res.json({ok:true,name:'market-orca-rag-mcp-lite',version:'1.2.0',tools:MCP_TOOLS}))
app.get('/mcp/metrics', (_req,res)=>res.json({ok:true,metrics:MCP_METRICS,cache:webCacheStats()}))
app.get('/mcp/selftest', async (_req,res)=>{
  const checks=[]
  async function check(name, fn){ const t=Date.now(); try{ const out=await withTimeout(fn(),15000); checks.push({name,ok:true,ms:Date.now()-t,summary:out}) }catch(e){ checks.push({name,ok:false,ms:Date.now()-t,error:String(e.message||e)}) } }
  await check('rag.storage',()=>ragStorageStats())
  await check('web.fetch_page',()=>fetchPageMarkdown('https://www.sqlite.org/fts5.html',{maxChars:300}).then(x=>({chars:x.chars,title:x.title})))
  await check('web.search',()=>webSearch('SQLite FTS5 RAG',{limit:2,engines:['bing'],mode:'coding'}).then(x=>({results:x.results.length,errors:x.errors.length})))
  res.json({ok:checks.every(c=>c.ok),name:'market-orca-rag-mcp-lite',version:'1.2.0',checks})
})

app.get('/mcp/openapi.json', (_req,res)=>res.json({openapi:'3.1.0',info:{title:'Market Orca MCP-lite',version:'1.2.0'},paths:{'/mcp/health':{get:{summary:'Health'}},'/mcp/tools':{get:{summary:'Tool catalog'}},'/mcp/tool/{tool}':{post:{summary:'Call MCP-lite tool',parameters:[{name:'tool',in:'path',required:true,schema:{type:'string'}}],requestBody:{content:{'application/json':{schema:{type:'object'}}}},responses:{'200':{description:'Tool result'}}}}}}))

app.post('/mcp/tool/:tool', mcpRateLimit, mcpRequire, async (req, res) => {
  const __mcpStart=Date.now(); let tool=req.params.tool
  res.on('finish',()=>mcpMetric(tool,res.statusCode<500,Date.now()-__mcpStart))
  try {
    const input = req.body || {}
    if (tool === 'rag.search') return res.json({ ok:true, tool, results:ragHybridSearch(String(input.query || ''), { limit:Number(input.limit || 8), section:String(input.section || 'mcp'), assetTags:Array.isArray(input.assetTags) ? input.assetTags : [] }) })
    if (tool === 'rag.ingest') return res.json({ ok:true, tool, document:upsertRagDocument({ url:String(input.url||''), title:String(input.title||'Manual MCP source'), source:String(input.source||'mcp'), publishedAt:String(input.publishedAt||''), content:String(input.content||''), assetTags:Array.isArray(input.assetTags)?input.assetTags:[] }) })
    if (tool === 'web.search') return res.json({ ok:true, tool, ...(await withTimeout(webSearch(String(input.query||''), webSearchOptions(input,10)), Number(input.timeoutMs||45000))) })
    if (tool === 'web.fetch_page') return res.json({ ok:true, tool, ...(await withTimeout(fetchPageMarkdown(String(input.url||''), { maxChars:Number(input.maxChars||12000) }), Number(input.timeoutMs||45000))) })
    if (tool === 'web.search_and_answer') return res.json({ ok:true, tool, ...(await withTimeout(searchAndAnswer(String(input.query||''), { limit:Number(input.limit||6), readLimit:Number(input.readLimit||3), engines:input.engines||['bing','yahoo','duckduckgo'], modes:input.modes||['','official','market','coding','journal','forum','blog'], time_range:String(input.time_range||''), domains:input.domains||input.sites||[] }), Number(input.timeoutMs||60000))) })
    if (tool === 'web.news_search') return res.json({ ok:true, tool, ...(await withTimeout(searchNews(String(input.query||''), { limit:Number(input.limit||10), language:String(input.language||'all'), time_range:String(input.time_range||'') }), Number(input.timeoutMs||30000))) })
    if (tool === 'web.deep_search') return res.json({ ok:true, tool, ...(await withTimeout(deepWebSearch(String(input.query||''), { limit:Number(input.limit||30), engines:input.engines||['bing','yahoo','duckduckgo'], modes:input.modes||['','official','market','forum','blog','coding','journal','thesis','person'], filetypes:input.filetypes||[], autoPreview:input.autoPreview===true, previewLimit:Number(input.previewLimit||3) }), Number(input.timeoutMs||60000))) })
    if (tool === 'web.search_to_crawl') { const out=await withTimeout(webSearch(String(input.query||''), webSearchOptions(input,8)), Number(input.timeoutMs||45000)); const filtered=await filterSearchForCrawl(out.results,{allowUntrusted:true}); for(const r of filtered.filter(x=>x.crawlAllowed).slice(0, Number(input.enqueueLimit||3))) enqueueRagCrawl(r.url,{source:r.domain,assetTags:input.assetTags||[]}); return res.json({ ok:true, tool, ...out, results:filtered, enqueued:filtered.filter(x=>x.crawlAllowed).slice(0, Number(input.enqueueLimit||3)).map(x=>x.url) }) }
    if (tool === 'rag.crawl_enqueue') { const policy=await isAllowedSource(String(input.url||'')); if(!policy.ok) return res.status(400).json({ok:false,error:policy.reason}); return res.json({ ok:true, tool, ...enqueueRagCrawl(String(input.url), { source:input.source||policy.host, assetTags:input.assetTags||[] }) }) }
    if (tool === 'rag.crawl_run') return res.json({ ok:true, tool, ...(await runRagCrawlWorker({ limit:Number(input.limit||3) })) })
    if (tool === 'rag.vectorize_missing') return res.json({ ok:true, tool, ...vectorizeMissingChunks({ limit:Number(input.limit||100) }) })
    if (tool === 'rag.cleanup') return res.json({ ok:true, tool, ...cleanupRagStore({ maxAgeDays:Number(input.maxAgeDays||60), maxChunks:Number(input.maxChunks||20000) }) })
    if (tool === 'rag.storage') return res.json({ ok:true, tool, stats:ragStorageStats() })
    if (tool === 'rag.autolearn.stats') return res.json({ ok:true, tool, ...getCollectionStats() })
    if (tool === 'rag.autolearn.collections') return res.json({ ok:true, tool, collections:autoCreateCollections() })
    if (tool === 'rag.autolearn.search') return res.json({ ok:true, tool, ...searchByTopic(String(input.query||''), { limit:Number(input.limit||8), topic:String(input.topic||'') }) })
    if (tool === 'rag.autolearn.ingest') return res.json({ ok:true, tool, ...(input.slug ? ingestReport(input.slug) : ingestAllReports()) })
    if (tool === 'report.get') {
      const slug=String(input.slug||new Date().toISOString().slice(0,10)); const fp=safeReportPath(reportDir, slug, 'json'); if(!fp||!fs.existsSync(fp)) return res.status(404).json({ ok:false,error:'report_not_found' }); return res.json({ ok:true, tool, report:JSON.parse(fs.readFileSync(fp,'utf8')) })
    }
    if (tool === 'report.blocks') {
      const slug=String(input.slug||new Date().toISOString().slice(0,10)); const fp=safeReportPath(reportDir, slug, 'json'); if(!fp||!fs.existsSync(fp)) return res.status(404).json({ ok:false,error:'report_not_found' }); const report=JSON.parse(fs.readFileSync(fp,'utf8')); return res.json({ ok:true, tool, blocks:ensureReportBlocks(slug, report), quality:reportQualityFromBlocks(slug) })
    }
    // ── TradingView tools ────────────────────────────────────────
    if (tool === 'tradingview.screener') {
      return res.json({ ok:true, tool, ...(await withTimeout(getTradingViewScreener(String(input.market||'crypto'), { limit:Number(input.limit||50), sortBy:String(input.sortBy||'volume'), columns:Array.isArray(input.columns)?input.columns:undefined, filter:Array.isArray(input.filter)?input.filter:undefined, symbols:Array.isArray(input.symbols)?input.symbols:undefined }), 20000)) })
    }
    if (tool === 'tradingview.chart') {
      return res.json({ ok:true, tool, ...(await withTimeout(getTradingViewChart(String(input.symbol||'BTCUSDT'), String(input.timeframe||'D')), 20000)) })
    }
    if (tool === 'tradingview.technical') {
      return res.json({ ok:true, tool, ...(await withTimeout(getTradingViewTechnical(String(input.symbol||'BTCUSDT'), String(input.timeframe||'D')), 25000)) })
    }
    if (tool === 'tradingview.news') {
      return res.json({ ok:true, tool, ...(await withTimeout(getTradingViewNews(String(input.symbol||'BTC'), Number(input.limit||15)), 20000)) })
    }
    if (tool === 'tradingview.popular') {
      return res.json({ ok:true, tool, ...(await withTimeout(getTradingViewPopular(String(input.market||'crypto')), 20000)) })
    }
    return res.status(404).json({ ok:false, error:'unknown_tool', tool })
  } catch (error) { mcpError(res,error,req.params?.tool) }
})

app.get('/api/rag/health', (_req, res) => {
  try {
    initRagSchema()
    const fts5 = db.prepare(`SELECT sqlite_compileoption_used('ENABLE_FTS5') AS enabled`).get()?.enabled === 1
    let runtime = false
    try { db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS temp.rag_health_fts USING fts5(body); DROP TABLE temp.rag_health_fts;`); runtime = true } catch (e) { console.error('[server] fts5 runtime check failed:', e.message) }
    const docs = db.prepare(`SELECT count(*) AS n FROM rag_evidence_documents`).get()?.n || 0
    const chunks = db.prepare(`SELECT count(*) AS n FROM rag_evidence_chunks`).get()?.n || 0
    res.json({ ok:true, fts5CompileOption:fts5, fts5Runtime:runtime, docs, chunks })
  } catch (error) { res.status(500).json({ ok:false, error:String(error) }) }
})

app.post('/api/rag/evidence-ingest', async (req, res) => {
  try {
    initRagSchema()
    const body = req.body || {}
    const doc = upsertRagDocument({ url:String(body.url || body.sourceUrl || ''), title:String(body.title || 'Manual source'), source:String(body.source || ''), publishedAt:String(body.publishedAt || ''), content:String(body.content || ''), assetTags:Array.isArray(body.assetTags)?body.assetTags:[] })
    res.json({ ok:true, document:doc })
  } catch (error) { res.status(500).json({ ok:false, error:String(error) }) }
})

app.get('/api/rag/evidence-search', (req, res) => {
  try { res.json({ ok:true, results: ragSearch(String(req.query.q || ''), { section:String(req.query.section || 'api'), limit:Number(req.query.limit || 8) }) }) }
  catch (error) { res.status(500).json({ ok:false, error:String(error) }) }
})

app.post('/api/rag/ingest', async (req, res) => {
  try {
    const body = req.body || {}
    const user = getUserFromReq(req)
    if (body.url) return res.json({ ok:true, document: await ingestUrl(String(body.url)) })
    const doc = ingestDocument({ sourceType:body.sourceType || 'manual', sourceUrl:body.sourceUrl || '', title:body.title || 'Manual source', content:body.content || '', metadata:{ userId:user?.id || null } })
    res.json({ ok:true, document:doc })
  } catch (error) { res.status(500).json({ ok:false, error:String(error) }) }
})

app.get('/api/rag/search', (req, res) => {
  try { res.json({ ok:true, results: searchRag(String(req.query.q || ''), Number(req.query.limit || 8)) }) }
  catch (error) { res.status(500).json({ ok:false, error:String(error) }) }
})

app.post('/api/reports/rag-generate', (req, res) => {
  try {
    const body = req.body || {}
    res.json({ ok:true, ...runRagReport(String(body.question || body.query || ''), Number(body.limit || 8), body.context || {}) })
  }
  catch (error) { res.status(500).json({ ok:false, error:String(error) }) }
})

app.post('/api/datasets/indonesian-jsonl', (req, res) => {
  try { res.type('application/x-jsonlines').send(generateJsonlDataset({ count:Number(req.body?.count || 12), topic:String(req.body?.topic || 'Market Orca RAG report') })) }
  catch (error) { res.status(500).json({ ok:false, error:String(error) }) }
})

app.get('/api/reports/rag/:id', (req, res) => {
  try { const run = getRagRun(Number(req.params.id)); if (!run) return res.status(404).json({ ok:false, error:'not_found' }); res.json({ ok:true, run, factCheck: factCheckReport(run.report_md, []) }) }
  catch (error) { res.status(500).json({ ok:false, error:String(error) }) }
})

app.get('/api/reports/rag/:id/export', (req, res) => {
  try { const out = exportRagRun(Number(req.params.id), String(req.query.format || 'md')); res.download(out.path, out.filename) }
  catch (error) { res.status(500).json({ ok:false, error:String(error) }) }
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
    res.json({ ...live, article, settings, history, alert_recommendation: alertRecommendation(live.asset, history) })
  } catch (error) {
    const asset = db.prepare('SELECT * FROM assets WHERE slug = ?').get(req.params.slug)
    if (!asset) return res.status(404).json({ error: 'Not found' })
    const candles = getStoredCandles(asset.slug)
    const news = getStoredNews(asset.slug)
    const article = buildArticle(asset, news)
    const settings = db.prepare('SELECT * FROM asset_settings WHERE asset_slug = ?').get(asset.slug)
    const history = db.prepare('SELECT price, change_percent, source, created_at FROM price_history WHERE asset_slug = ? ORDER BY id DESC LIMIT 50').all(asset.slug)
    res.json({ asset, candles, news, article, settings, history, alert_recommendation: alertRecommendation(asset, history), stale: true, error: String(error) })
  }
})

app.post('/api/assets/:slug/settings', (req, res) => {
  const asset = db.prepare('SELECT * FROM assets WHERE slug = ?').get(req.params.slug)
  if (!asset) return res.status(404).json({ error: 'Not found' })
  const up = Number(req.body.threshold_up ?? 2)
  const down = Number(req.body.threshold_down ?? -2)
  const watch = req.body.watch_enabled === false ? 0 : 1
  db.prepare(`INSERT INTO asset_settings (asset_slug, threshold_up, threshold_down, watch_enabled, updated_at) VALUES (?, ?, ?, ?, datetime('now')) ON CONFLICT(asset_slug) DO UPDATE SET threshold_up=excluded.threshold_up, threshold_down=excluded.threshold_down, watch_enabled=excluded.watch_enabled, updated_at=datetime('now')`).run(asset.slug, up, down, watch)
  res.json(db.prepare('SELECT * FROM asset_settings WHERE asset_slug = ?').get(asset.slug))
})

app.get('/api/assets/:slug/history', (req, res) => {
  const rows = db.prepare('SELECT price, change_percent, source, created_at FROM price_history WHERE asset_slug = ? ORDER BY id DESC LIMIT 100').all(req.params.slug)
  res.json({ rows })
})

app.get('/api/assets/:slug/live-lite', async (req, res) => {
  try {
    const asset = db.prepare('SELECT * FROM assets WHERE slug = ?').get(req.params.slug)
    if (!asset) return res.status(404).json({ error: 'Not found' })
    const live = await getLiveAsset(asset)
    saveAssetSnapshot(live)
    res.json({ asset: live.asset, candles: live.candles })
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

app.get('/api/assets/:slug/stream', (req, res) => {
  const asset = db.prepare('SELECT * FROM assets WHERE slug = ?').get(req.params.slug)
  if (!asset) return res.status(404).json({ error: 'Not found' })
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()

  let closed = false
  const send = async () => {
    if (closed) return
    try {
      const live = await getLiveAsset(asset)
      // SSE: no DB writes; avoid hammering SQLite on laptop server.
      res.write(`data: ${JSON.stringify({ asset: live.asset, candles: live.candles })}\n\n`)
    } catch (error) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: String(error) })}\n\n`)
    }
  }

  send()
  const timer = setInterval(send, 8000)
  req.on('close', () => {
    closed = true
    clearInterval(timer)
    res.end()
  })
})

app.get('/api/overview/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()

  let closed = false
  const send = async () => {
    if (closed) return
    try {
      const live = await getLiveAssets(baseAssets())
      // Overview SSE: cache/live only; persistence belongs to scheduled scan/API detail.
      const assets = live.map((x) => ({ ...x.asset, sparkline: (x.candles || []).slice(-12).map((c) => c.close ?? c.value) }))
      res.write(`data: ${JSON.stringify({ assets })}\n\n`)
    } catch (error) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: String(error) })}\n\n`)
    }
  }

  send()
  const timer = setInterval(send, 15000)
  req.on('close', () => {
    closed = true
    clearInterval(timer)
    res.end()
  })
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

app.get('/api/alerts/live', (_req, res) => {
  const alerts = db.prepare(`
    SELECT a.*, n.link AS news_link, n.title AS news_title
    FROM alerts a
    LEFT JOIN news n ON n.id = (
      SELECT id FROM news
      WHERE asset_slug = a.asset_slug
      ORDER BY id DESC
      LIMIT 1
    )
    ORDER BY a.id DESC
    LIMIT 10
  `).all()
  res.json({ alerts })
})

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

const EVENT_TEMPLATES = {
  rate_hike: { label: 'Rate hike / hawkish central bank', bias: { crypto:-2, stock:-1.2, forex:1, commodity:-0.4 }, drivers:['higher discount rate','risk-off flow','stronger USD'], signals:['DXY','US10Y','Fed speech'] },
  earnings_miss: { label: 'Earnings miss / weak guidance', bias: { stock:-2.4, crypto:-0.4, forex:0, commodity:0 }, drivers:['margin pressure','lower guidance','valuation reset'], signals:['volume spike','analyst downgrade','sector sympathy'] },
  regulation_news: { label: 'Regulation news', bias: { crypto:-2, stock:-0.7, forex:0.2, commodity:0 }, drivers:['policy uncertainty','compliance cost','liquidity shift'], signals:['official statement','exchange response','legal timeline'] },
  supply_shock: { label: 'Supply shock', bias: { commodity:2.4, stock:-0.6, forex:0.2, crypto:0 }, drivers:['scarcity premium','inflation impulse','margin squeeze'], signals:['inventory data','shipping rates','geopolitical update'] },
  ai_breakthrough: { label: 'AI breakthrough / product launch', bias: { stock:1.5, crypto:0.4, forex:0, commodity:0 }, drivers:['growth narrative','capex rotation','AI adoption'], signals:['product traction','cloud spend','chip demand'] },
  liquidity_crunch: { label: 'Liquidity crunch / credit stress', bias: { crypto:-2.6, stock:-1.8, forex:0.7, commodity:-0.8 }, drivers:['cash preference','spread widening','forced deleveraging'], signals:['credit spreads','stablecoin flows','VIX'] },
  geopolitical_risk: { label: 'Geopolitical risk', bias: { commodity:1.8, forex:0.8, stock:-1.1, crypto:-0.5 }, drivers:['safe-haven flow','energy disruption','risk premium'], signals:['oil/gold spike','USD/JPY','official escalation'] },
}
for (const [id, t] of Object.entries(EVENT_TEMPLATES)) {
  db.prepare(`INSERT OR IGNORE INTO event_templates (id,label,bias_json,drivers_json,signals_json) VALUES (?,?,?,?,?)`).run(id, t.label, JSON.stringify(t.bias), JSON.stringify(t.drivers), JSON.stringify(t.signals))
}
function loadEventTemplates() {
  const rows = db.prepare('SELECT * FROM event_templates ORDER BY id').all()
  return Object.fromEntries(rows.map(r => [r.id, { label:r.label, bias:JSON.parse(r.bias_json||'{}'), drivers:JSON.parse(r.drivers_json||'[]'), signals:JSON.parse(r.signals_json||'[]') }]))
}
function assetKind(a) {
  const s = `${a.slug} ${a.symbol} ${a.market} ${a.category}`.toLowerCase()
  if (/btc|eth|sol|crypto|coin/.test(s)) return 'crypto'
  if (/xau|gold|oil|brent|wti|commodity/.test(s)) return 'commodity'
  if (/idr|usd|eur|jpy|forex|fx/.test(s)) return 'forex'
  return 'stock'
}
function impactFor(asset, tmpl, timeframe='1d') {
  const kind = assetKind(asset)
  const base = tmpl.bias[kind] ?? 0
  const vol = Math.min(2.2, Math.max(.7, Math.abs(asset.change_percent || 0) / 2 + 1))
  const tf = timeframe === '1w' ? 1.4 : timeframe === '1m' ? 1.8 : 1
  const score = Number((base * vol * tf).toFixed(2))
  const level = Math.abs(score) >= 4 ? 'high' : Math.abs(score) >= 2 ? 'medium' : 'low'
  const direction = score > .25 ? 'bullish' : score < -.25 ? 'bearish' : 'neutral'
  return { slug: asset.slug, symbol: asset.symbol, name: asset.name, kind, price: asset.price, change_percent: asset.change_percent, direction, impact_score: score, risk_level: level, bull: score >= 0 ? 'momentum continuation if signal confirms' : 'relief bounce if headline fades', base: 'watch confirmation signals before action', bear: score <= 0 ? 'drawdown risk if event escalates' : 'fade risk if market prices it in' }
}
app.get('/api/impact-simulator/templates', (_req, res) => {
  const templates = loadEventTemplates()
  res.json({ templates, items:Object.entries(templates).map(([type,t]) => ({ type, label:t.label, drivers:t.drivers, signals:t.signals })) })
})

app.post('/api/impact-simulator', (req, res) => {
  const templates = loadEventTemplates()
  const customText = String(req.body?.custom_event_text || '').trim()
  let eventType = req.body?.event_type || 'rate_hike'
  if (customText) {
    const t = customText.toLowerCase()
    if (/rate|fed|inflation|yield|suku bunga/.test(t)) eventType = 'rate_hike'
    else if (/regulat|sec|ban|policy|aturan/.test(t)) eventType = 'regulation_news'
    else if (/supply|oil|opec|shipping|geopolitical/.test(t)) eventType = 'supply_shock'
    else if (/earning|guidance|revenue|profit/.test(t)) eventType = 'earnings_miss'
    else if (/liquid|credit|stress/.test(t)) eventType = 'liquidity_crunch'
    else if (/war|geopolitical|conflict/.test(t)) eventType = 'geopolitical_risk'
    else eventType = 'ai_breakthrough'
  }
  const timeframe = req.body?.timeframe || '1d'
  const severity = Math.min(3, Math.max(0.25, Number(req.body?.severity || 1)))
  const probability = Math.min(1, Math.max(0.05, Number(req.body?.probability || 0.6)))
  const tmpl = templates[eventType] || templates.rate_hike
  const reqAssets = Array.isArray(req.body?.assets) ? req.body.assets.filter(Boolean) : []
  const watch = db.prepare('SELECT asset_slug FROM watchlist').all().map(r => r.asset_slug)
  const slugs = reqAssets.length ? reqAssets : (req.body?.scope === 'watchlist' ? watch : [])
  const assets = slugs.length
    ? db.prepare(`SELECT * FROM assets WHERE slug IN (${slugs.map(()=>'?').join(',')})`).all(...slugs)
    : db.prepare(`SELECT * FROM assets WHERE abs(change_percent) >= 0.1 OR market IN ('IDX','FOREX') OR category = 'index' ORDER BY abs(change_percent) DESC LIMIT 24`).all()
  const rows = assets.map(a => {
    const r = impactFor(a, tmpl, timeframe)
    r.impact_score = Number((r.impact_score * severity * probability).toFixed(2))
    r.direction = r.impact_score > .25 ? 'bullish' : r.impact_score < -.25 ? 'bearish' : 'neutral'
    r.risk_level = Math.abs(r.impact_score) >= 4 ? 'high' : Math.abs(r.impact_score) >= 2 ? 'medium' : 'low'
    return r
  }).sort((a,b)=>Math.abs(b.impact_score)-Math.abs(a.impact_score))
  const md = `## Market Event Impact Simulator\n- **Event**: ${tmpl.label}\n- **Timeframe**: ${timeframe}\n- **Severity**: ${severity}x\n- **Probability**: ${Math.round(probability*100)}%\n- **Drivers**: ${tmpl.drivers.join(', ')}\n- **Signals to watch**: ${tmpl.signals.join(', ')}\n\n` + rows.map(r => `- **${r.symbol}** (${r.direction}, ${r.risk_level}, score ${r.impact_score}): bull=${r.bull}; base=${r.base}; bear=${r.bear}`).join('\n')
  res.json({ ok:true, event_type:eventType, event_label:tmpl.label, custom_event_text:customText, timeframe, severity, probability, drivers:tmpl.drivers, signals:tmpl.signals, items:rows, markdown:md, report_block:md })
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

// ---- Smart Alert Threshold — suggested alerts from report insights ----
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

// ── Market Alerts Summary Dashboard ───────────────────────────────
app.get('/api/market/alerts-summary', async (_req, res) => {
  try {
    // 1. Active triggered alerts from alerts table
    const triggeredAlerts = db.prepare(`
      SELECT a.*, ast.symbol, ast.name, ast.market, ast.category, ast.price AS current_price, ast.change_percent
      FROM alerts a
      JOIN assets ast ON ast.slug = a.asset_slug
      ORDER BY a.id DESC
      LIMIT 50
    `).all()

    // 2. Pending suggested alerts from reports
    const suggestedAlerts = db.prepare(`
      SELECT sa.*, ast.symbol, ast.name, ast.market, ast.category, ast.price AS current_price, ast.change_percent
      FROM suggested_alerts sa
      JOIN assets ast ON ast.slug = sa.asset_slug
      WHERE sa.status = 'pending'
      ORDER BY sa.id DESC
      LIMIT 20
    `).all()

    // 3. Active threshold alerts from asset_settings
    const thresholdAlerts = db.prepare(`
      SELECT ast.slug, ast.symbol, ast.name, ast.market, ast.category, ast.price AS current_price, ast.change_percent,
             s.threshold_up, s.threshold_down
      FROM assets ast
      JOIN asset_settings s ON s.asset_slug = ast.slug
      WHERE s.watch_enabled = 1
      ORDER BY ast.change_percent DESC
    `).all()

    // 4. Compute breach status for threshold alerts
    const thresholdWithStatus = thresholdAlerts.map(a => {
      const pct = a.change_percent || 0
      const up = a.threshold_up || (a.market === 'CRYPTO' ? 3 : a.market === 'IDX' ? 1.5 : 2)
      const down = a.threshold_down || -up
      let breach = 'none', severity = 'info'
      if (pct >= up) { breach = 'up'; severity = pct >= up * 1.5 ? 'critical' : 'warning' }
      else if (pct <= down) { breach = 'down'; severity = pct <= down * 1.5 ? 'critical' : 'warning' }
      return { ...a, breach, severity, distance_up: Number((pct - up).toFixed(2)), distance_down: Number((pct - down).toFixed(2)) }
    }).filter(a => a.breach !== 'none' || Math.abs(a.change_percent || 0) > 0.5)

    // 5. Aggregate stats
    const triggeredCount = triggeredAlerts.length
    const suggestedCount = suggestedAlerts.length
    const thresholdBreaches = thresholdWithStatus.filter(a => a.breach !== 'none').length
    const criticalCount = [...triggeredAlerts, ...thresholdWithStatus].filter(a => a.severity === 'critical').length
    const warningCount = [...triggeredAlerts, ...thresholdWithStatus].filter(a => a.severity === 'warning').length

    res.json({
      ok: true,
      summary: {
        triggered: triggeredCount,
        suggested: suggestedCount,
        threshold_breaches: thresholdBreaches,
        critical: criticalCount,
        warning: warningCount,
        total_active: triggeredCount + thresholdBreaches
      },
      triggered: triggeredAlerts.map(a => ({
        id: a.id, asset_slug: a.asset_slug, symbol: a.symbol, name: a.name, market: a.market,
        title: a.title, message: a.message, current_price: a.current_price,
        change_percent: a.change_percent, created_at: a.created_at, discord_sent: a.discord_sent
      })),
      suggested: suggestedAlerts.map(a => ({
        id: a.id, asset_slug: a.asset_slug, symbol: a.symbol, name: a.name, market: a.market,
        target_price: a.target_price, direction: a.direction, reason: a.reason,
        confidence: a.confidence, current_price: a.current_price, change_percent: a.change_percent,
        distance_pct: Number(((a.target_price - a.current_price) / a.current_price * 100).toFixed(2))
      })),
      threshold_alerts: thresholdWithStatus.slice(0, 30).map(a => ({
        asset_slug: a.slug, symbol: a.symbol, name: a.name, market: a.market,
        current_price: a.current_price, change_percent: a.change_percent,
        threshold_up: a.threshold_up, threshold_down: a.threshold_down,
        breach: a.breach, severity: a.severity,
        distance_up: a.distance_up, distance_down: a.distance_down
      }))
    })
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }) }
})

const reportDir = path.join(__dirname, '..', '..', 'reports')
function todayReportSlug() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
function todayReportExists() {
  return fs.existsSync(path.join(reportDir, `${todayReportSlug()}.json`))
}
function usableTopics(topics) { return Array.isArray(topics) && topics.reduce((s,t)=>s+(t.items?.length||0),0) >= 20 }
function latestSavedReport() {
  if (!fs.existsSync(reportDir)) return null
  const files = fs.readdirSync(reportDir).filter(f => f.endsWith('.json')).sort().reverse()
  for (const f of files) {
    const d = JSON.parse(fs.readFileSync(path.join(reportDir, f), 'utf8'))
    if (usableTopics(d.topics)) return { ...d, fallbackFrom: f.replace('.json','') }
  }
  return null
}

app.get('/api/report-health', (_req, res) => {
  const rd = path.join(__dirname, '..', '..', 'reports')
  const files = fs.existsSync(rd) ? fs.readdirSync(rd).filter(f => f.endsWith('.json')).sort().reverse() : []
  const latest = files[0]?.replace('.json','') || null
  const has = latest ? (ext) => fs.existsSync(path.join(rd, `${latest}.${ext}`)) : () => false
  const delivery = latest ? db.prepare('SELECT step,status,detail,created_at FROM delivery_log WHERE slug IN (?,?) ORDER BY id DESC LIMIT 12').all(latest,'daily') : []
  const queueSummary = db.prepare(`SELECT status, count(*) AS count FROM send_queue GROUP BY status`).all()
  const sendQueue = db.prepare(`SELECT id,slug,channel,step,status,attempts,last_error,next_attempt_at,created_at FROM send_queue WHERE status IN ('pending','failed') ORDER BY id DESC LIMIT 12`).all()

  // ── Health metrics for status cards ─────────────────────────
  // Report age
  let reportAgeHours = null
  if (latest) {
    const parts = latest.split('-')
    const reportDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 7, 0, 0)
    reportAgeHours = Math.max(0, Math.round((Date.now() - reportDate.getTime()) / 3600000))
  }

  // Delivery success rate (last 20 entries)
  const recentDelivery = db.prepare('SELECT status FROM delivery_log ORDER BY id DESC LIMIT 20').all()
  const totalDelivery = recentDelivery.length
  const okDelivery = recentDelivery.filter(r => r.status === 'ok' || r.status === 'sent' || r.status === 'done').length
  const deliveryRate = totalDelivery > 0 ? Math.round((okDelivery / totalDelivery) * 100) : null

  // Queue health
  const queueCounts = {}
  for (const q of queueSummary) queueCounts[q.status] = q.count
  const pendingCount = queueCounts.pending || 0
  const failedCount = queueCounts.failed || 0
  const queuedCount = queueCounts.queued || 0

  // Deliverables completeness
  const deliv = latest ? { html:has('html'), json:has('json'), md:has('md'), card:fs.existsSync(path.join(rd, `${latest}-card.png`)) } : {}
  const delivOk = Object.values(deliv).filter(Boolean).length
  const delivTotal = Object.keys(deliv).length

  // Overall status
  let overallStatus = 'healthy'
  let overallReason = 'All systems operational'
  if (failedCount > 0 || (deliveryRate !== null && deliveryRate < 60)) {
    overallStatus = 'critical'
    overallReason = failedCount > 0 ? `${failedCount} failed queue item(s)` : 'Delivery success rate below 60%'
  } else if (reportAgeHours !== null && reportAgeHours > 48) {
    overallStatus = 'critical'
    overallReason = `Last report is ${reportAgeHours}h old (>48h)`
  } else if (pendingCount > 3 || (deliveryRate !== null && deliveryRate < 80) || delivOk < delivTotal) {
    overallStatus = 'degraded'
    overallReason = pendingCount > 3 ? `${pendingCount} pending items` : (deliveryRate !== null && deliveryRate < 80 ? `Delivery rate ${deliveryRate}%` : 'Missing deliverables')
  }

  res.json({
    ok:true, bot:'started-with-backend', latest_report: latest,
    deliverables: deliv,
    delivery, send_queue:{ summary:queueSummary, pending_failed:sendQueue },
    local:`${APP_CONFIG.publicBaseUrl}/report/${latest}`,
    tailscale:`${APP_CONFIG.tailscaleBaseUrl}/report/${latest}`,
    health: {
      overall_status: overallStatus,
      overall_reason: overallReason,
      report_age_hours: reportAgeHours,
      delivery_success_rate: deliveryRate,
      delivery_sample_size: totalDelivery,
      queue_pending: pendingCount,
      queue_failed: failedCount,
      queue_queued: queuedCount,
      deliverables_ok: delivOk,
      deliverables_total: delivTotal,
      total_reports: files.length,
    }
  })
})

function latestReportTopics() {
  const saved = latestSavedReport()
  return Array.isArray(saved?.topics) ? saved.topics : []
}

app.get('/api/incidents', (_req, res) => {
  const reportSlug = latestSavedReport()?.slug || ''
  const items = latestReportTopics().flatMap(t => (t.items || []).map(i => ({ ...i, section: t.title })))
  const incidents = items
    .filter(i => /outage|incident|blackout|gangguan|down|pemadaman|breach|hack|ransomware/i.test(`${i.title||''} ${i.snippet||''}`))
    .slice(0, 25)
    .map(i => {
      const severity = classifyIncidentSeverity(i)
      const title_hash = incidentTitleHash(i.title)
      const recovery_status = trackRecoveryStatus(i, reportSlug)
      const status_history = getIncidentStatusHistory(title_hash)
      return { title:i.title || '', title_hash, source:i.source || 'unknown', section:i.section || '', url:i.url || i.link || '', severity, recovery_status, status_history, customer_impact:estimateCustomerImpact(i), action:['critical','high'].includes(severity) ? 'notify + monitor recovery' : 'monitor' }
    })
  res.json({ ok:true, count:incidents.length, incidents })
})

app.get('/api/incidents/:titleHash/history', (req, res) => {
  const history = getIncidentStatusHistory(req.params.titleHash)
  res.json({ ok:true, titleHash:req.params.titleHash, count:history.length, history })
})

app.post('/api/incidents/status/update', (req, res) => {
  const { title_hash, title, status, note } = req.body || {}
  if (!title_hash || !status) return res.status(400).json({ ok:false, error:'title_hash and status required' })
  const result = manualUpdateIncidentStatus({ titleHash:title_hash, title:title||'', status, note:note||'' })
  if (!result.ok) return res.status(400).json(result)
  res.json(result)
})

app.post('/api/incidents/bulk-update', (req, res) => {
  const { statuses } = req.body || {}
  if (!Array.isArray(statuses)) return res.status(400).json({ ok:false, error:'statuses array required' })
  const results = statuses.map(s => manualUpdateIncidentStatus({ titleHash:s.title_hash, title:s.title||'', status:s.status, note:s.note||'' }))
  res.json({ ok:true, updated:results.filter(r=>r.ok).length, total:results.length, results })
})

// ---- Source Reliability API ----
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

async function generateAndSendDailyReport(reason = 'manual') {
  let { topics } = await generateAiDailyReport()
  let fallbackFrom = null
  if (!usableTopics(topics)) {
    const saved = latestSavedReport()
    if (saved) { topics = saved.topics; fallbackFrom = saved.fallbackFrom; console.warn(`[ai-report] ${reason} sparse, fallback=${fallbackFrom}`) }
  }
  setImmediate(() => autoEnrichReportWeb(topics, { queryLimit:3, perQueryLimit:4, enqueueLimit:8 }).catch(e => console.error('[ai-report-web-enrich]', e.message||e)))
  // Build persona context for report personalization
  const defaultUser = db.prepare('SELECT id FROM users LIMIT 1').get()
  const persona = defaultUser ? getPersona(db, defaultUser.id) : null
  const personaPrompt = persona ? buildContextPrompt(persona) : ''
  const textReport = buildTextReport(topics, { persona, personaPrompt })
  let embed
  try { embed = buildDiscordEmbed(topics) } catch (_) { embed = null }
  await sendAiReportToUser(textReport, embed, topics)
  const { slug } = await saveReport(topics, textReport).catch(() => ({ slug: null }))

  // ── RAG QA: auto-run quality checks after report generation ──
  if (slug) {
    try {
      const qa = qaReport(slug)
      console.log(`[QA] ${slug}: score=${qa.score} status=${qa.status}`)
      // Send QA summary to Discord channel
      if (qa.issues?.length > 0 || qa.score < 80) {
        try {
          const botClient = await getBotClient().catch(() => null)
          const channelId = getDiscordSetting('report_channel_id')
          if (botClient?.isReady() && channelId) {
            const channel = await botClient.channels.fetch(channelId).catch(() => null)
            if (channel) {
              const issueSummary = qa.issues.map(i => `⚠️ ${i.type}: ${i.count || i.sections?.join(', ') || JSON.stringify(i)}`).join('\n')
              await channel.send({
                content: `**📊 Report QA: ${slug}** — Score: **${qa.score}/100** (${qa.status})\n${issueSummary || 'No major issues'}`
              })
            }
          }
        } catch (e) { console.warn('[QA] Discord notify failed:', e.message) }
      }
      // Auto-ingest as template if quality is high
      if (qa.score >= 80) {
        try { ingestReportAsTemplate(slug) } catch (e) { console.warn('[QA] Template ingest failed:', e.message) }
      }
    } catch (e) { console.error('[QA] Failed:', e.message) }
  }

  return { slug, fallbackFrom, topics }
}

app.post('/api/ai-daily-report/web-enrich', async (req, res) => {
  try {
    const out = await generateAiDailyReport()
    const topics = out.topics || out
    const enriched = await autoEnrichReportWeb(topics, { queryLimit:Number(req.body?.queryLimit||5), perQueryLimit:Number(req.body?.perQueryLimit||5), enqueueLimit:Number(req.body?.enqueueLimit||10) })
    res.json(enriched)
  } catch(e) { res.status(500).json({ ok:false, error:String(e.message||e) }) }
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

// /market is now served by the Vue SPA catch-all below

// Report portal list
app.get('/report', (_req, res) => {
  const files = fs.existsSync(reportDir) ? fs.readdirSync(reportDir).filter(f => f.endsWith('.json')).sort().reverse() : []
  const cards = files.map((f) => {
    const slug = f.replace('.json', '')
    const d = JSON.parse(fs.readFileSync(path.join(reportDir, f), 'utf8'))
    const total = (d.topics || []).reduce((s,t)=>s+(t.items?.length||0),0)
    const hero = (d.topics || []).flatMap(t=>t.items || []).find(i=>i.title) || {}
    const title = (hero.title || 'AI Daily Report').replace(/[<>&"]/g, '')
    return `<a class="card" href="/report/${slug}"><img src="/report/${slug}/card.png" alt=""><div class="date">${slug}</div><h2>${title}</h2><p>${total} items • ${(d.topics||[]).length} sections</p></a>`
  }).join('')
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.send(`<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI Report Archive</title><style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800;900&display=swap');
  *{box-sizing:border-box} body{margin:0;background:#f4f1ea;color:#151515;font-family:Inter,system-ui,sans-serif}.wrap{max-width:1100px;margin:auto;padding:28px 16px 60px}.mast{border-bottom:4px solid #111;padding-bottom:18px;margin-bottom:24px}.k{font-size:12px;font-weight:900;letter-spacing:.18em;text-transform:uppercase;color:#7c2d12}h1{font-size:clamp(38px,8vw,86px);line-height:.9;margin:6px 0 8px;font-weight:900;letter-spacing:-.07em}.sub{font-size:16px;color:#57534e}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}.card{display:block;text-decoration:none;color:inherit;background:#fff;border:2px solid #111;padding:12px;min-height:190px;box-shadow:6px 6px 0 #111;transition:.15s}.card:hover{transform:translate(-2px,-2px);box-shadow:9px 9px 0 #111}.card img{width:100%;aspect-ratio:4/5;object-fit:cover;border:2px solid #111;margin-bottom:12px}.date{font-size:12px;font-weight:900;color:#7c2d12;letter-spacing:.12em;text-transform:uppercase}.card h2{font-size:22px;line-height:1.05;margin:14px 0 10px;font-weight:900;letter-spacing:-.03em}.card p{color:#57534e;font-weight:600}@media(max-width:600px){.card{box-shadow:4px 4px 0 #111}h1{font-size:44px}}
  </style></head><body><main class="wrap"><section class="mast"><div class="k">Little Candle Archive</div><h1>AI Report<br>Portal</h1><p class="sub">Headline besar, ringkasan cepat, full report, PDF, dan content ideas.</p></section><section class="grid">${cards || '<p>No reports yet.</p>'}</section></main></body></html>`)
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

app.get('/report/:slug/editor', (req, res) => {
  const fp = safeReportPath(reportDir, req.params.slug, 'json')
  if (!fp || !fs.existsSync(fp)) return res.status(404).send('Report not found')
  const report = JSON.parse(fs.readFileSync(fp, 'utf8'))
  const blocks = ensureReportBlocks(req.params.slug, report)
  const esc = s => String(s||'').replace(/[&<>\"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]))
  const badge = b => `<span class="badge ${esc(b.claim_type)}">${esc(b.claim_type)} · ${Math.round(Number(b.confidence||0)*100)}%</span>`
  res.setHeader('Content-Type','text/html; charset=utf-8')
  res.send(`<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Evidence Composer ${req.params.slug}</title><style>*{box-sizing:border-box}body{margin:0;background:#f4f1ea;color:#111;font-family:Inter,system-ui,sans-serif}.wrap{max-width:1240px;margin:auto;padding:20px}.top{display:flex;justify-content:space-between;gap:12px;align-items:center;border-bottom:4px solid #111;padding-bottom:14px;margin-bottom:18px}h1{font-size:clamp(32px,6vw,64px);line-height:.9;margin:0;letter-spacing:-.06em}.grid{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:16px}.block{background:#fff;border:2px solid #111;box-shadow:5px 5px 0 #111;margin-bottom:12px;padding:14px}.badge{display:inline-block;border-radius:999px;padding:4px 8px;font-size:11px;font-weight:900;margin-bottom:8px}.cited{background:#dcfce7}.weak_evidence{background:#fef3c7}.assumption{background:#fee2e2}.actionable{background:#dbeafe}textarea{width:100%;min-height:110px;border:1px solid #aaa;padding:10px;font:inherit;line-height:1.5}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}button,a.btn{border:2px solid #111;background:#fff;color:#111;padding:8px 10px;font-weight:900;text-decoration:none;cursor:pointer}button.primary{background:#111;color:#fff}.side{position:sticky;top:12px;align-self:start;background:#111;color:#fff;border:2px solid #111;padding:14px;max-height:90vh;overflow:auto}.src{border-top:1px solid #444;padding:10px 0}.src a{color:#93c5fd}.muted{color:#777}.q{font-size:30px;font-weight:900}@media(max-width:900px){.grid{grid-template-columns:1fr}.side{position:static}}</style></head><body><main class="wrap"><div class="top"><div><p class="muted">Evidence-Aware Report Composer</p><h1>${req.params.slug}</h1></div><div><a class="btn" href="/report/${req.params.slug}">View</a> <a class="btn" href="/api/reports/${req.params.slug}/export?format=html">Export</a> <button id="remapBtn">Remap Evidence</button></div></div><div class="grid"><section>${blocks.map(b=>`<article class="block" data-key="${esc(b.block_key)}">${badge(b)}<div><b>${esc(b.block_key)}</b> ${b.locked?'🔒':''} ${b.hidden?'🙈':''}</div><textarea>${esc(b.body_md)}</textarea><p class="muted">${esc(b.edit_suggestion||'')}</p><div class="actions"><button class="primary" data-save>Save</button><button data-rewrite>Rewrite safer</button><button data-sources>Sources</button><button data-hide>${b.hidden?'Unhide':'Hide'}</button><button data-lock>${b.locked?'Unlock':'Lock'}</button></div></article>`).join('')}</section><aside class="side"><div class="q" id="score">Quality...</div><p>Click Sources untuk citation drawer per block.</p><div id="drawer"></div></aside></div></main><script>
const slug='${req.params.slug}';
async function quality(){const d=await fetch('/api/report/'+slug+'/quality').then(r=>r.json());score.textContent='Quality '+d.quality.score+'/100';}
document.addEventListener('click',async e=>{const b=e.target.closest('.block'); if(!b)return; const key=b.dataset.key; const body=b.querySelector('textarea').value; if(e.target.matches('[data-save]')) await patch(key,{body_md:body}); if(e.target.matches('[data-hide]')) await patch(key,{hidden:e.target.textContent==='Hide'}); if(e.target.matches('[data-lock]')) await patch(key,{locked:e.target.textContent==='Lock'}); if(e.target.matches('[data-rewrite]')) await fetch('/api/report/'+slug+'/blocks/'+key+'/rewrite',{method:'POST'}).then(()=>location.reload()); if(e.target.matches('[data-sources]')){const d=await fetch('/api/report/'+slug+'/blocks/'+key+'/sources').then(r=>r.json()); drawer.innerHTML='<h2>'+key+' Sources</h2>'+((d.sources||[]).map(s=>'<div class="src"><b>'+esc(s.title||'')+'</b><p>'+esc(s.source||'')+' · '+esc(s.topic||'')+'</p><p>'+esc((s.snippet||'').slice(0,180))+'</p><a href="'+esc(s.url||'#')+'" target="_blank">open source</a></div>').join('')||'<p>No matching sources.</p>')}});
async function patch(key,payload){await fetch('/api/report/'+slug+'/blocks',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({block_key:key,...payload})}); await quality();}
function esc(s){return String(s||'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]))}
document.getElementById('remapBtn')?.addEventListener('click', async()=>{ const r=await fetch('/api/report/'+slug+'/blocks/remap-evidence',{method:'POST'}).then(x=>x.json()); showToast('Remap evidence: '+(r.updated||0)+' blocks'); await quality(); setTimeout(()=>location.reload(),900); });
function showToast(msg){let t=document.getElementById('toast'); if(!t){t=document.createElement('div'); t.id='toast'; t.style.cssText='position:fixed;right:14px;bottom:14px;background:#111;color:#fff;padding:12px 14px;border:2px solid #fbbf24;font-weight:900;z-index:99'; document.body.appendChild(t)} t.textContent=msg; setTimeout(()=>t.remove(),2200)}
quality();</script></body></html>`)
})

// Serve saved reports (standalone HTML view; export guarded separately)
app.get('/report/:slug', (req, res) => {
  const fp = safeReportPath(reportDir, req.params.slug, 'html')
  if (!fp || !fs.existsSync(fp)) return res.status(404).send('Report not found')
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.send(fs.readFileSync(fp, 'utf8'))
})

function reportEvidenceMap(report, query='') {
  const rows = []
  if (query) {
    try { for (const r of ragHybridSearch(query, { limit:8 })) rows.push({ id:r.chunk_id || r.url, topic:'Hybrid RAG', title:r.title || '', source:r.source || '', url:r.url || '', snippet:r.snippet || r.content || '', imageUrl:'', evidence_kind:r.retrieval || 'hybrid', semantic_score:r.score || r.hybridScore || 0 }) } catch (e) { console.error('[server] ragHybridSearch failed:', e.message) }
  }
  let n = 1
  for (const t of report.topics || []) for (const i of t.items || []) {
    rows.push({ id:`ev${n++}`, topic:t.title, title:i.title || '', source:i.source || '', url:i.url || '', snippet:i.snippet || i.summary || '', imageUrl:i.imageUrl || '', kind:'report_item' })
  }
  return rows
}
function autoIngestReportSources(report, limit=40) {
  const items = (report.topics || []).flatMap(t => (t.items || []).map(i => ({ ...i, topic:t.title }))).filter(i => i.title || i.snippet || i.summary).slice(0, limit)
  let count = 0
  for (const i of items) {
    const sourceUrl = i.url || `report://${report.date || 'daily'}/${i.topic}/${i.title}`
    const exists = db.prepare('SELECT id FROM rag_documents WHERE source_url=? LIMIT 1').get(sourceUrl)
    if (exists) continue
    ingestDocument({ sourceType:'report_source', sourceUrl, title:i.title || i.topic || 'Report source', content:`${i.title || ''}\n${i.snippet || i.summary || ''}\nSource: ${i.source || ''}\nTopic: ${i.topic || ''}`, metadata:{ topic:i.topic, source:i.source, imageUrl:i.imageUrl } })
    count++
  }
  return count
}
function remapEvidenceWithRag(text='', report={}, limit=5) {
  const hybrid = ragHybridSearch(text, { limit }).map((r, i)=>({ id:r.chunk_id || `hybrid${i+1}`, topic:'Hybrid RAG', title:r.title || `Hybrid evidence ${i+1}`, source:r.source || r.retrieval || 'hybrid', url:r.url || '', snippet:r.snippet || r.content || '', imageUrl:'', kind:r.retrieval || 'hybrid_vector', score:r.hybridScore || r.score || 0 }))
  const legacy = searchRag(text, Math.max(0, limit-hybrid.length)).map((r, i)=>({ id:`rag${r.id || i+1}`, topic:'Legacy RAG', title:r.title || `RAG evidence ${i+1}`, source:r.source_type || 'rag', url:r.source_url || '', snippet:r.quote || r.content || '', imageUrl:'', kind:'rag_fts', score:r.score || 0 }))
  const rag = [...hybrid, ...legacy]
  const local = reportEvidenceMap(report).map(ev=>({ ...ev, score:overlapScore(text, ev) })).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0, Math.max(0, limit-rag.length))
  const seen = new Set(); return [...rag, ...local].filter(e => { const k=e.url||e.title; if(seen.has(k)) return false; seen.add(k); return true }).slice(0, limit)
}
function overlapScore(text='', ev) {
  const words = new Set(String(text).toLowerCase().split(/[^a-z0-9]+/).filter(w=>w.length>4))
  const hay = `${ev.title} ${ev.snippet} ${ev.source} ${ev.topic}`.toLowerCase()
  let s = 0; for (const w of words) if (hay.includes(w)) s++
  return s
}
function classifyBlock(text='', idx=0, evidence=[]) {
  const matches = evidence.map(ev => ({ ...ev, score:overlapScore(text, ev) })).filter(x=>x.score>=2).sort((a,b)=>b.score-a.score).slice(0,3)
  const hasCitation = matches.length > 0 || /https?:\/\/|\[\d+\]|source|sumber/i.test(text)
  const actionable = /watch|pantau|next|validasi|entry|buy|sell|risk|alert/i.test(text)
  const assumption = /asumsi|mungkin|berpotensi|bisa|could|likely/i.test(text) && !hasCitation
  const claim_type = hasCitation ? 'cited' : actionable ? 'actionable' : assumption ? 'assumption' : 'weak_evidence'
  const confidence = hasCitation ? Math.min(0.92, 0.62 + matches.length*0.1) : claim_type === 'actionable' ? 0.58 : claim_type === 'assumption' ? 0.36 : 0.45
  const edit_suggestion = hasCitation ? `Terhubung ke ${matches.length} source; cek konsistensi sebelum export.` : claim_type === 'actionable' ? 'Tambahkan level harga/timeframe + source pendukung.' : 'Belum ada evidence kuat; rewrite sebagai asumsi atau tambahkan citation.'
  return { block_key:`b${String(idx+1).padStart(3,'0')}`, body_md:text, evidence_ids:JSON.stringify(matches.map(m=>m.id)), confidence, claim_type, edit_suggestion }
}
function evidenceHealth(row) {
  const ids = JSON.parse(row.evidence_ids || '[]')
  const badges = []
  if (!ids.length) badges.push('needs source')
  if (ids.length === 1) badges.push('single-source')
  if (row.claim_type === 'assumption') badges.push('opinion-only')
  if (row.claim_type === 'weak_evidence') badges.push('mixed evidence')
  if (ids.length >= 3 && Number(row.confidence||0) >= 0.75) badges.push('strong evidence')
  const score = Math.max(0, Math.min(100, Math.round(Number(row.confidence||0)*70 + Math.min(ids.length,4)*8 - (badges.includes('needs source')?25:0) - (badges.includes('opinion-only')?15:0))))
  return { score, badges:badges.length?badges:['mixed evidence'] }
}
function decorateBlocks(rows) { return rows.map(r => ({ ...r, evidence_health:evidenceHealth(r) })) }
function ensureReportBlocks(slug, report) {
  const evidence = reportEvidenceMap(report)
  const existing = db.prepare('SELECT * FROM report_blocks WHERE report_slug=? ORDER BY block_key').all(slug)
  if (existing.length) {
    const upd = db.prepare('UPDATE report_blocks SET evidence_ids=?, confidence=?, claim_type=?, edit_suggestion=? WHERE report_slug=? AND block_key=? AND locked=0')
    for (const row of existing) {
      const next = classifyBlock(row.body_md, Number(row.block_key?.slice(1)) || 0, evidence)
      upd.run(next.evidence_ids, Math.max(Number(row.confidence||0), next.confidence), next.claim_type, next.edit_suggestion, slug, row.block_key)
    }
    return decorateBlocks(db.prepare('SELECT * FROM report_blocks WHERE report_slug=? ORDER BY block_key').all(slug))
  }
  const raw = String(report.textReport || '').split(/\n\n+/).map(x=>x.trim()).filter(x=>x.length>20).slice(0,80)
  const blocks = raw.map((txt,i)=>classifyBlock(txt,i,evidence))
  const ins = db.prepare(`INSERT OR IGNORE INTO report_blocks (report_slug,block_key,body_md,evidence_ids,confidence,claim_type,edit_suggestion) VALUES (?,?,?,?,?,?,?)`)
  for (const b of blocks) ins.run(slug,b.block_key,b.body_md,b.evidence_ids,b.confidence,b.claim_type,b.edit_suggestion)
  return decorateBlocks(db.prepare('SELECT * FROM report_blocks WHERE report_slug=? ORDER BY block_key').all(slug))
}

app.post('/api/report/:slug/search-related', async (req,res)=>{
  try {
    const fp=safeReportPath(reportDir, req.params.slug, 'json')
    if(!fp || !fs.existsSync(fp)) return res.status(404).json({ok:false,error:'report_not_found'})
    const report=JSON.parse(fs.readFileSync(fp,'utf8'))
    const base=[report.title, ...(report.topics||[]).map(t=>t.title), ...((report.topics||[]).flatMap(t=>(t.items||[]).slice(0,2).map(i=>i.title)))].filter(Boolean).slice(0, Number(req.body?.queries||8))
    const all=[]
    for(const q of base){ const out=await webSearch(q,{limit:Number(req.body?.perQuery||5),engines:req.body?.engines||['searxng'],mode:req.body?.mode||'market',dynamic:true,preferTrusted:true}); all.push(...(out.results||[]).map(r=>({...r,query:q,...classifySearchResult(r)}))) }
    const seen=new Set(); const results=[]
    for(const r of all){ const k=String(r.url||'').replace(/[#?].*$/,''); if(k && !seen.has(k)){ seen.add(k); results.push(r) } }
    const filtered=await filterSearchForCrawl(results,{allowUntrusted:true,openDocsOnly:!!req.body?.openDocsOnly})
    const enqueued=[]
    if(req.body?.autoCrawl!==false){ for(const r of filtered.filter(x=>x.crawlAllowed).slice(0, Number(req.body?.enqueueLimit||10))) enqueued.push(enqueueRagCrawl(r.url,{source:r.domain,assetTags:['report-related',req.params.slug]})) }
    res.json({ok:true,slug:req.params.slug,queries:base,results:filtered.slice(0,Number(req.body?.limit||30)),enqueued})
  } catch(error){ res.status(500).json({ok:false,error:String(error)}) }
})

// Report data API
app.get('/api/report/:slug', (req, res) => {
  const fp = safeReportPath(reportDir, req.params.slug, 'json')
  if (!fp || !fs.existsSync(fp)) return res.status(404).json({ error: 'Report not found' })
  const report = JSON.parse(fs.readFileSync(fp, 'utf8'))
  report.rag_auto_ingested = autoIngestReportSources(report)
  report.blocks = ensureReportBlocks(req.params.slug, report)
  // Inject source trust info
  const allSources = [...new Set((report.topics || []).flatMap(t => (t.items || []).map(i => i.source).filter(Boolean)))]
  report.source_trust = getSourcesTrust(allSources)
  res.json(report)
})

function reportCompare(a, b) {
  const title = t => String(t?.title || '').trim()
  const key = s => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const itemKey = i => key(i?.url || i?.title || '')
  const topicsA = new Map((a.topics || []).map(t => [key(title(t)), t]))
  const topicsB = new Map((b.topics || []).map(t => [key(title(t)), t]))
  const topicAdded = [...topicsA.keys()].filter(k => !topicsB.has(k)).map(k => topicsA.get(k).title)
  const topicRemoved = [...topicsB.keys()].filter(k => !topicsA.has(k)).map(k => topicsB.get(k).title)
  const aItems = new Map((a.topics || []).flatMap(t => (t.items || []).map(i => [itemKey(i), { topic:title(t), title:i.title, source:i.source, url:i.url }])).filter(([k]) => k))
  const bItems = new Map((b.topics || []).flatMap(t => (t.items || []).map(i => [itemKey(i), { topic:title(t), title:i.title, source:i.source, url:i.url }])).filter(([k]) => k))
  const added = [...aItems.keys()].filter(k => !bItems.has(k)).slice(0, 25).map(k => aItems.get(k))
  const removed = [...bItems.keys()].filter(k => !aItems.has(k)).slice(0, 25).map(k => bItems.get(k))
  const repeated = [...aItems.keys()].filter(k => bItems.has(k)).slice(0, 25).map(k => aItems.get(k))
  const count = r => ({ topics:(r.topics || []).length, items:(r.topics || []).reduce((s,t)=>s+(t.items || []).length,0), sources:new Set((r.topics || []).flatMap(t => (t.items || []).map(i => i.source).filter(Boolean))).size })
  const now = count(a), prev = count(b)
  return { ok:true, current:a.date, baseline:b.date, stats:{ current:now, baseline:prev, item_delta:now.items-prev.items, source_delta:now.sources-prev.sources }, topics:{ added:topicAdded, removed:topicRemoved, unchanged:[...topicsA.keys()].filter(k => topicsB.has(k)).map(k => topicsA.get(k).title) }, headlines:{ added, removed, repeated }, summary:`${topicAdded.length} topik baru, ${topicRemoved.length} hilang, Δitem ${now.items-prev.items}, repeated ${repeated.length}` }
}

app.get('/api/report/:slug/compare/:otherSlug', (req, res) => {
  const fpA = safeReportPath(reportDir, req.params.slug, 'json')
  const fpB = safeReportPath(reportDir, req.params.otherSlug, 'json')
  if (!fpA || !fpB || !fs.existsSync(fpA) || !fs.existsSync(fpB)) return res.status(404).json({ ok:false, error:'report_not_found' })
  res.json(reportCompare(JSON.parse(fs.readFileSync(fpA, 'utf8')), JSON.parse(fs.readFileSync(fpB, 'utf8'))))
})

app.patch('/api/report/:slug/blocks', (req, res) => {
  const user = requireUser(req, res)
  if (!user) return
  const slug = req.params.slug
  const blockKey = String(req.body?.block_key || '').slice(0,40)
  if (!blockKey) return res.status(400).json({ ok:false, error:'block_key_required' })
  const existing = db.prepare('SELECT * FROM report_blocks WHERE report_slug=? AND block_key=?').get(slug, blockKey)
  if (!existing) return res.status(404).json({ ok:false, error:'block_not_found' })
  if (existing.locked && req.body?.body_md && req.body.body_md !== existing.body_md) return res.status(409).json({ ok:false, error:'block_locked' })
  const next = { body_md:req.body?.body_md ?? existing.body_md, claim_type:req.body?.claim_type ?? existing.claim_type, confidence:Number(req.body?.confidence ?? existing.confidence), evidence_ids:JSON.stringify(req.body?.evidence_ids ?? JSON.parse(existing.evidence_ids || '[]')), edit_suggestion:req.body?.edit_suggestion ?? existing.edit_suggestion, locked:req.body?.locked === undefined ? existing.locked : (req.body.locked ? 1 : 0), hidden:req.body?.hidden === undefined ? existing.hidden : (req.body.hidden ? 1 : 0) }
  db.prepare(`UPDATE report_blocks SET body_md=?, claim_type=?, confidence=?, evidence_ids=?, edit_suggestion=?, locked=?, hidden=?, updated_at=datetime('now') WHERE report_slug=? AND block_key=?`).run(next.body_md,next.claim_type,next.confidence,next.evidence_ids,next.edit_suggestion,next.locked,next.hidden,slug,blockKey)
  res.json({ ok:true, block:db.prepare('SELECT * FROM report_blocks WHERE report_slug=? AND block_key=?').get(slug, blockKey), quality:reportQualityFromBlocks(slug) })
})


async function llmRewriteWithEvidence(original, ctx) {
  const base = process.env.OPENAI_BASE_URL || process.env.OPENAI_COMPATIBLE_BASE_URL || process.env.LLM_BASE_URL
  const key = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY
  const model = process.env.REPORT_REWRITE_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini'
  if (!base || !key) return null
  const evidence = ctx.map((e,i)=>`[${i+1}] ${e.title} — ${e.source}: ${String(e.snippet||'').slice(0,500)} URL:${e.url||''}`).join('\n')
  const prompt = `Rewrite this report paragraph in Indonesian. Requirements: concise, clear, no overclaim, preserve meaning, cite evidence IDs like [1], [2] when used. If evidence is weak, say it as assumption.\n\nParagraph:\n${original}\n\nEvidence:\n${evidence}`
  const url = base.replace(/\/$/,'') + '/chat/completions'
  const r = await fetch(url, { method:'POST', headers:{'content-type':'application/json','authorization':`Bearer ${key}`}, body:JSON.stringify({ model, messages:[{role:'system',content:'You are an evidence-aware Indonesian market report editor.'},{role:'user',content:prompt}], temperature:0.2, max_tokens:500 }), signal:AbortSignal.timeout(20000) })
  if (!r.ok) return null
  const d = await r.json().catch(()=>null)
  return d?.choices?.[0]?.message?.content?.trim() || null
}

function qaGate(slug) {
  const rows = db.prepare('SELECT * FROM report_blocks WHERE report_slug=? AND hidden=0').all(slug)
  const health = rows.map(evidenceHealth)
  const fail = []
  const weak = rows.filter((r,i)=>health[i].badges.includes('needs source') || health[i].badges.includes('opinion-only')).length
  if (weak > Math.max(3, rows.length*0.15)) fail.push('too_many_weak_blocks')
  if (health.some(h=>h.score < 25)) fail.push('critical_low_evidence_health')
  const score = Math.round(health.reduce((s,h)=>s+h.score,0)/(health.length||1))
  return { ok:fail.length===0, score, fail, checked:rows.length, weak }
}
function reportQualityFromBlocks(slug) {
  const rows = db.prepare('SELECT claim_type,confidence,hidden FROM report_blocks WHERE report_slug=?').all(slug)
  const visible = rows.filter(r=>!r.hidden)
  const cited = visible.filter(r=>r.claim_type==='cited').length
  const weak = visible.filter(r=>r.claim_type==='weak_evidence'||r.claim_type==='assumption').length
  const avg = visible.reduce((s,r)=>s+Number(r.confidence||0),0)/(visible.length||1)
  const score = Math.max(0, Math.min(100, Math.round(avg*60 + cited*3 - weak*2 - (rows.length-visible.length))))
  return { score, visible:visible.length, hidden:rows.length-visible.length, cited, weak }
}

app.post('/api/report/:slug/blocks/:blockKey/rewrite', async (req, res) => {
  const user = requireUser(req, res)
  if (!user) return
  const row = db.prepare('SELECT * FROM report_blocks WHERE report_slug=? AND block_key=?').get(req.params.slug, req.params.blockKey)
  if (!row) return res.status(404).json({ ok:false, error:'block_not_found' })
  if (row.locked) return res.status(409).json({ ok:false, error:'block_locked' })
  const fp = safeReportPath(reportDir, req.params.slug, 'json')
  const report = fp && fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp,'utf8')) : { topics:[] }
  const evidence = remapEvidenceWithRag(row.body_md, report, 5)
  const ids = new Set(JSON.parse(row.evidence_ids || '[]'))
  let ctx = evidence.filter(e => ids.has(e.id))
  if (!ctx.length) ctx = evidence.slice(0,3)
  const contextLines = ctx.map(e=>`- ${e.title} (${e.source}): ${e.snippet}`)
  const baseBody = String(row.body_md).replace(/\n?\s*(Catatan editor:|Berbasis source:)[\s\S]*$/i,'').trim()
  const safer = baseBody.replace(/\b(will|pasti|guaranteed|always)\b/gi,'berpotensi').replace(/\s+/g,' ').trim()
  let rewritten = ctx.length
    ? `${safer}\n\nBerbasis source: ${ctx.map(e=>e.source).filter(Boolean).join(', ')}. Evidence utama: ${ctx.map(e=>e.title).join(' | ')}.`
    : `${safer}\n\nCatatan: belum ada retrieval context kuat; perlakukan sebagai asumsi sampai ada source.`
  let usedLlm = false
  if ((process.env.OPENAI_API_KEY || process.env.LLM_API_KEY) && ctx.length) {
    try {
      const rr = await fetch('https://api.openai.com/v1/chat/completions', { method:'POST', headers:{'content-type':'application/json','authorization':`Bearer ${process.env.OPENAI_API_KEY}`}, body:JSON.stringify({ model:process.env.OPENAI_MODEL || 'gpt-4o-mini', temperature:0.2, max_tokens:450, messages:[{role:'system',content:'Rewrite paragraph in Bahasa Indonesia. Use ONLY locked evidence. Preserve cautious wording. Add short source note. No invented facts.'},{role:'user',content:`PARAGRAPH:\n${row.body_md}\n\nLOCKED_EVIDENCE_IDS:${ctx.map(e=>e.id).join(', ')}\nEVIDENCE:\n${contextLines.join('\n')}`} ] }) })
      const jj = await rr.json(); const txt = jj.choices?.[0]?.message?.content?.trim(); if (txt) { rewritten = txt; usedLlm = true }
    } catch (e) { console.error('[server] LLM rewrite failed:', e.message) }
  }
  const newIds = ctx.map(e=>e.id)
  const claimType = ctx.length ? 'cited' : (row.claim_type === 'assumption' ? 'weak_evidence' : row.claim_type)
  const confidence = ctx.length ? Math.min(0.9, 0.62 + ctx.length*0.1) : Math.max(0.45, Number(row.confidence||0.5))
  const prop = db.prepare(`INSERT INTO report_rewrite_proposals (report_slug,block_key,before_md,after_md,evidence_ids) VALUES (?,?,?,?,?)`).run(req.params.slug, req.params.blockKey, row.body_md, rewritten, JSON.stringify(newIds))
  if (req.body?.apply === true) db.prepare(`UPDATE report_blocks SET body_md=?, confidence=?, claim_type=?, evidence_ids=?, edit_suggestion=?, updated_at=datetime('now') WHERE report_slug=? AND block_key=?`).run(rewritten, confidence, claimType, JSON.stringify(newIds), usedLlm ? `LLM rewrite pakai ${ctx.length} evidence context.` : (ctx.length ? `Deterministic rewrite pakai ${ctx.length} retrieval context.` : 'Rewrite aman tanpa source kuat; butuh citation.'), req.params.slug, req.params.blockKey)
  res.json({ ok:true, proposal_id:prop.lastInsertRowid, before:row.body_md, after:rewritten, applied:req.body?.apply===true, block:db.prepare('SELECT * FROM report_blocks WHERE report_slug=? AND block_key=?').get(req.params.slug, req.params.blockKey), quality:reportQualityFromBlocks(req.params.slug), context:contextLines })
})

app.post('/api/report/:slug/rewrite-proposals/:id/accept', (req,res)=>{
  const p=db.prepare('SELECT * FROM report_rewrite_proposals WHERE id=? AND report_slug=?').get(req.params.id, req.params.slug)
  if(!p) return res.status(404).json({ok:false,error:'proposal_not_found'})
  db.prepare(`UPDATE report_blocks SET body_md=?, evidence_ids=?, confidence=max(confidence,0.78), claim_type='cited', edit_suggestion='Accepted rewrite proposal.', updated_at=datetime('now') WHERE report_slug=? AND block_key=? AND locked=0`).run(p.after_md,p.evidence_ids,p.report_slug,p.block_key)
  db.prepare(`UPDATE report_rewrite_proposals SET status='accepted', decided_at=datetime('now') WHERE id=?`).run(p.id)
  res.json({ok:true, block:db.prepare('SELECT * FROM report_blocks WHERE report_slug=? AND block_key=?').get(p.report_slug,p.block_key), quality:reportQualityFromBlocks(p.report_slug)})
})
app.post('/api/report/:slug/rewrite-proposals/:id/reject', (req,res)=>{
  const p=db.prepare('SELECT * FROM report_rewrite_proposals WHERE id=? AND report_slug=?').get(req.params.id, req.params.slug)
  if(!p) return res.status(404).json({ok:false,error:'proposal_not_found'})
  db.prepare(`UPDATE report_rewrite_proposals SET status='rejected', decided_at=datetime('now') WHERE id=?`).run(p.id)
  res.json({ok:true})
})

app.post('/api/report/:slug/blocks/:blockKey/remap-evidence', (req, res) => {
  const row = db.prepare('SELECT * FROM report_blocks WHERE report_slug=? AND block_key=?').get(req.params.slug, req.params.blockKey)
  if (!row) return res.status(404).json({ ok:false, error:'block_not_found' })
  if (row.locked) return res.status(409).json({ ok:false, error:'block_locked' })
  const fp = safeReportPath(reportDir, req.params.slug, 'json')
  const report = fp && fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp,'utf8')) : { topics:[] }
  const ingested = autoIngestReportSources(report)
  const ctx = remapEvidenceWithRag(row.body_md, report, Number(req.body?.limit || 5))
  const evidenceIds = ctx.map(e=>e.id)
  const claimType = ctx.length ? 'cited' : 'weak_evidence'
  const confidence = ctx.length ? Math.min(0.94, 0.6 + ctx.length*0.07) : 0.4
  const suggestion = ctx.length ? `Remap Evidence pakai ragSearch + source map: ${ctx.length} evidence.` : 'Tidak ada evidence kuat; tambahkan source/RAG ingest.'
  db.prepare(`UPDATE report_blocks SET evidence_ids=?, confidence=?, claim_type=?, edit_suggestion=?, updated_at=datetime('now') WHERE report_slug=? AND block_key=?`).run(JSON.stringify(evidenceIds), confidence, claimType, suggestion, req.params.slug, req.params.blockKey)
  res.json({ ok:true, block:db.prepare('SELECT * FROM report_blocks WHERE report_slug=? AND block_key=?').get(req.params.slug, req.params.blockKey), sources:ctx, quality:reportQualityFromBlocks(req.params.slug), rag_auto_ingested:ingested })
})

app.get('/api/report/:slug/blocks/:blockKey/sources', (req, res) => {
  const row = db.prepare('SELECT * FROM report_blocks WHERE report_slug=? AND block_key=?').get(req.params.slug, req.params.blockKey)
  if (!row) return res.status(404).json({ ok:false, error:'block_not_found' })
  const fp = safeReportPath(reportDir, req.params.slug, 'json')
  const report = fp && fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp,'utf8')) : { topics:[] }
  const evidence = remapEvidenceWithRag(row.body_md, report, 8)
  const ids = new Set(JSON.parse(row.evidence_ids || '[]'))
  let sources = evidence.filter(e=>ids.has(e.id))
  if (!sources.length) sources = evidence
  res.json({ ok:true, block:row, evidence_ids:[...ids], sources })
})

app.post('/api/report/:slug/blocks/remap-evidence', (req, res) => {
  const user = requireUser(req, res)
  if (!user) return
  const fp = safeReportPath(reportDir, req.params.slug, 'json')
  if (!fp || !fs.existsSync(fp)) return res.status(404).json({ ok:false, error:'report_not_found' })
  const report = JSON.parse(fs.readFileSync(fp,'utf8'))
  const rows = ensureReportBlocks(req.params.slug, report)
  const upd = db.prepare('UPDATE report_blocks SET evidence_ids=?, confidence=?, claim_type=?, edit_suggestion=?, updated_at=datetime(\'now\') WHERE report_slug=? AND block_key=? AND locked=0')
  let updated = 0
  for (const row of rows) {
    const evidence = remapEvidenceWithRag(row.body_md, report, 5)
    const next = classifyBlock(row.body_md, Number(row.block_key?.slice(1)) || 0, evidence)
    if (JSON.parse(next.evidence_ids || '[]').length) { upd.run(next.evidence_ids, next.confidence, next.claim_type, next.edit_suggestion, req.params.slug, row.block_key); updated++ }
  }
  res.json({ ok:true, updated, quality:reportQualityFromBlocks(req.params.slug) })
})

app.post('/api/report/:slug/blocks/remap-all', (req, res) => {
  const user = requireUser(req, res)
  if (!user) return
  const fp = safeReportPath(reportDir, req.params.slug, 'json')
  const report = fp && fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp,'utf8')) : { topics:[] }
  const ingested = autoIngestReportSources(report)
  const rows = db.prepare('SELECT * FROM report_blocks WHERE report_slug=? AND locked=0').all(req.params.slug)
  let changed = 0
  for (const row of rows) {
    const ctx = remapEvidenceWithRag(row.body_md, report, Number(req.body?.limit || 5))
    if (!ctx.length) continue
    db.prepare(`UPDATE report_blocks SET evidence_ids=?, confidence=?, claim_type=?, edit_suggestion=?, updated_at=datetime('now') WHERE report_slug=? AND block_key=?`).run(JSON.stringify(ctx.map(e=>e.id)), Math.min(0.94,0.6+ctx.length*0.07), 'cited', `Remap all: ${ctx.length} evidence.`, req.params.slug, row.block_key)
    changed++
  }
  res.json({ ok:true, changed, rag_auto_ingested:ingested, quality:reportQualityFromBlocks(req.params.slug), blocks:decorateBlocks(db.prepare('SELECT * FROM report_blocks WHERE report_slug=? ORDER BY block_key').all(req.params.slug)) })
})

app.post('/api/report/:slug/blocks/rewrite-weak', (req, res) => {
  const user = requireUser(req, res)
  if (!user) return
  const rows = db.prepare(`SELECT * FROM report_blocks WHERE report_slug=? AND locked=0 AND hidden=0 AND (claim_type IN ('weak_evidence','assumption') OR confidence < 0.7) LIMIT ?`).all(req.params.slug, Number(req.body?.limit || 20))
  const fp = safeReportPath(reportDir, req.params.slug, 'json')
  const report = fp && fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp,'utf8')) : { topics:[] }
  let changed = 0
  for (const row of rows) {
    const ctx = remapEvidenceWithRag(row.body_md, report, 4)
    const rewritten = ctx.length ? `${row.body_md}\n\nRewrite berbasis evidence terkunci: ${ctx.map(e=>e.title).join(' | ')}.` : `${row.body_md}\n\nCatatan: perlu source tambahan sebelum dijadikan klaim kuat.`
    db.prepare(`UPDATE report_blocks SET body_md=?, evidence_ids=?, confidence=?, claim_type=?, edit_suggestion=?, updated_at=datetime('now') WHERE report_slug=? AND block_key=?`).run(rewritten, JSON.stringify(ctx.map(e=>e.id)), ctx.length?0.78:0.45, ctx.length?'cited':'weak_evidence', ctx.length?'Batch rewrite pakai retrieval context.':'Batch rewrite fallback; evidence kurang.', req.params.slug, row.block_key)
    changed++
  }
  res.json({ ok:true, changed, quality:reportQualityFromBlocks(req.params.slug), blocks:decorateBlocks(db.prepare('SELECT * FROM report_blocks WHERE report_slug=? ORDER BY block_key').all(req.params.slug)) })
})

app.get('/api/report/:slug/quality', (req,res)=>res.json({ ok:true, quality:reportQualityFromBlocks(req.params.slug) }))

app.get('/api/reports/:slug/export', (req, res) => {
  const format = String(req.query.format || 'html')
  const user = getUserFromReq(req)
  const report = getReportMeta(reportDir, req.params.slug)
  const decision = canExportReport(user, report)
  auditExport({ user, slug:req.params.slug, format, decision:decision.ok?'allow':'deny', reason:decision.reason, ip:req.ip })
  if (!decision.ok) return res.status(decision.status || 403).json({ ok:false, error:decision.reason })
  const gate = qaGate(req.params.slug)
  if (!gate.ok && req.query.force !== '1') return res.status(422).json({ ok:false, error:'qa_gate_failed', gate, hint:'fix evidence or pass ?force=1' })
  const fp = safeReportPath(reportDir, req.params.slug, format)
  if (!fp || !fs.existsSync(fp)) return res.status(404).json({ ok:false, error:'export_not_found' })
  const raw = fs.readFileSync(fp, 'utf8')
  const blocks = db.prepare('SELECT block_key,claim_type,confidence,evidence_ids,edit_suggestion FROM report_blocks WHERE report_slug=? AND hidden=0 ORDER BY block_key').all(req.params.slug)
  const badgeNote = blocks.length ? `\n\n<section class="evidence-notes"><h2>Evidence Notes</h2>${blocks.map(b=>{ const h=evidenceHealth(b); return `<p><b>${b.block_key}</b> · ${b.claim_type} · health ${h.score} · ${h.badges.join(', ')} · ${Math.round(Number(b.confidence)*100)}% · evidence ${b.evidence_ids} · ${b.edit_suggestion||''}</p>` }).join('')}</section>` : ''
  const mdNote = blocks.length ? `\n\n## Evidence Notes\n${blocks.map(b=>{ const h=evidenceHealth(b); return `- **${b.block_key}**: ${b.claim_type}, health ${h.score}, badges ${h.badges.join(', ')}, ${Math.round(Number(b.confidence)*100)}%, evidence ${b.evidence_ids}. ${b.edit_suggestion||''}` }).join('\n')}` : ''
  const decorated = format === 'html' ? raw.replace('</body>', `${badgeNote}</body>`) : format === 'md' ? raw + mdNote : raw
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
  auditExport({ user, slug:req.params.slug, format, decision:decision.ok?'allow':'deny', reason:`signed:${decision.reason}`, ip:req.ip })
  if (!decision.ok) return res.status(decision.status || 403).json({ ok:false, error:decision.reason })
  const token = createSignedExport(user, report, format, Number(req.body?.ttl || 900))
  res.json({ ok:true, url:`/api/reports/signed-export/${token}`, expires_in_seconds:Number(req.body?.ttl || 900) })
})

app.get('/api/reports/signed-export/:token', (req, res) => {
  const link = verifySignedExport(req.params.token)
  if (!link) return res.status(403).json({ ok:false, error:'signed_link_invalid_or_expired' })
  const user = { id:link.user_id, email:link.email, role:link.role, name:link.name }
  const report = getReportMeta(reportDir, link.report_slug)
  const fp = safeReportPath(reportDir, link.report_slug, link.format)
  if (!report || !fp || !fs.existsSync(fp)) return res.status(404).json({ ok:false, error:'export_not_found' })
  db.prepare(`UPDATE signed_export_links SET used_at=datetime('now') WHERE token_hash=?`).run(link.token_hash)
  auditExport({ user, slug:link.report_slug, format:link.format, decision:'allow', reason:'signed_link_used', ip:req.ip })
  const raw = fs.readFileSync(fp, 'utf8')
  const blocks = db.prepare('SELECT block_key,claim_type,confidence,evidence_ids,edit_suggestion FROM report_blocks WHERE report_slug=? AND hidden=0 ORDER BY block_key').all(link.report_slug)
  const badgeNote = blocks.length ? `\n\n<section class="evidence-notes"><h2>Evidence Notes</h2>${blocks.map(b=>`<p><b>${b.block_key}</b> · ${b.claim_type} · ${Math.round(Number(b.confidence)*100)}% · evidence ${b.evidence_ids} · ${b.edit_suggestion||''}</p>`).join('')}</section>` : ''
  const decorated = link.format === 'html' ? raw.replace('</body>', `${badgeNote}</body>`) : raw
  res.send(watermark(decorated, user, report, link.format))
})

app.get('/api/report-export-audit', (req, res) => {
  const user = requireUser(req, res)
  if (!user) return
  if (user.role !== 'admin') return res.status(403).json({ ok:false, error:'admin_required' })
  const rows = db.prepare(`SELECT a.*,u.email FROM report_export_audit a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 100`).all()
  res.json({ ok:true, rows })
})

// Get list of available reports
app.get('/api/reports', (_req, res) => {
  const files = fs.readdirSync(reportDir).filter(f => f.endsWith('.json')).sort().reverse()
  const slugs = files.map(f => f.replace('.json', ''))
  // ?metadata=true → enriched objects
  if (_req.query?.metadata) {
    const list = slugs.map(slug => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(reportDir, `${slug}.json`), 'utf8'))
        return {
          slug,
          date: data.date || slug,
          title: data.executiveBrief?.split('\n')[0] || data.topics?.[0]?.title || slug,
          generatedAt: data.generatedAt || null,
          topicCount: (data.topics || []).length,
          hasIncidents: !!(data.incidents || []).length,
          incidentCount: (data.incidents || []).length
        }
      } catch {
        return { slug, date: slug, title: slug, topicCount: 0, hasIncidents: false, incidentCount: 0 }
      }
    })
    return res.json(list)
  }
  res.json(slugs)
})

// ── Market Activity Feed ──────────────────────────────────────────────
app.get('/api/market/activity', (_req, res) => {
  try {
    const timestamp = Date.now()
    const significantMoves = db.prepare(`
      SELECT slug, symbol, name, market, price, change_percent
      FROM assets WHERE abs(change_percent) > 1.5 ORDER BY abs(change_percent) DESC LIMIT 10
    `).all()

    const recentAlerts = db.prepare(`
      SELECT id, asset_slug, title, message, discord_sent, created_at
      FROM alerts ORDER BY id DESC LIMIT 8
    `).all()

    const recentDeliveries = db.prepare(`
      SELECT id, slug, channel, step, status, detail, created_at
      FROM delivery_log ORDER BY id DESC LIMIT 8
    `).all()

    const recentReports = (() => {
      const dir = path.join(__dirname, '..', '..', 'reports')
      if (!fs.existsSync(dir)) return []
      return fs.readdirSync(dir)
        .filter(f => f.endsWith('.json'))
        .slice(0, 8)
        .map(f => {
          const slug = f.replace(/\.json$/, '')
          const fp = path.join(dir, f)
          let title = slug, topicCount = 0, hasIncidents = false
          try {
            const data = JSON.parse(fs.readFileSync(fp, 'utf8'))
            title = data.title || slug
            topicCount = data.topics?.length || 0
            hasIncidents = data.incidents?.length > 0
          } catch {}
          const stat = fs.statSync(fp)
          return { slug, title, topicCount, hasIncidents, generatedAt: stat.mtime.toISOString() }
        })
        .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
    })()

    const now = new Date().toISOString()
    res.json({
      ok: true,
      timestamp: now,
      counts: {
        significantMoves: significantMoves.length,
        recentAlerts: recentAlerts.length,
        recentDeliveries: recentDeliveries.length,
        recentReports: recentReports.length,
      },
      data: {
        significantMoves,
        recentAlerts,
        recentDeliveries,
        recentReports,
      },
    })
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error) })
  }
})

// ── Multi-Channel Report Preview & Edit ──────────────────────────────
app.get('/api/channel-constraints', (_req, res) => {
  res.json({ ok: true, channels: CHANNEL_CONSTRAINTS })
})

app.get('/api/report/:slug/preview/:channel', (req, res) => {
  const slug = String(req.params.slug || '').replace(/[^0-9a-z-]/gi, '')
  const channel = String(req.params.channel || 'editor').toLowerCase()
  const allowed = ['editor', 'discord', 'web', 'pdf']
  if (!allowed.includes(channel)) {
    return res.status(400).json({ ok: false, error: 'invalid_channel', allowed })
  }
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

setInterval(() => {
  runAlertScan().catch((err) => console.error('[scan]', err))
}, APP_CONFIG.alertIntervalMs)

// AI Daily Report: setiap hari 07:00 WIB (= 00:00 UTC)
// Cek setiap menit, baru jalan kalau udah 07:00 dan belum jalan hari ini
let aiReportSent = false
function todaySlug() { return new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Jakarta', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date()) }
function jakartaHour() { return Number(new Intl.DateTimeFormat('en-GB', { timeZone:'Asia/Jakarta', hour:'2-digit', hour12:false }).format(new Date())) }
function reportExists(slug = todaySlug()) { return fs.existsSync(path.join(reportDir, `${slug}.json`)) }
function resetAiReportFlag() { aiReportSent = false }
async function maybeRunDailyReport(reason = 'timer') {
  const slug = todaySlug()
  if (aiReportSent || reportExists(slug)) return { ok:false, skipped:true, reason:'already-exists', slug }
  aiReportSent = true
  console.log(`[ai-daily] Triggering daily AI report (${reason})...`)
  const result = await generateAndSendDailyReport(reason)
  return { ok:true, slug: result.slug }
}
setInterval(() => {
  const now = new Date()
  const utcHour = now.getUTCHours()
  const utcMin = now.getUTCMinutes()
  if (utcHour === 0 && utcMin === 0) maybeRunDailyReport('07:00').catch((e) => { aiReportSent = false; console.error('[ai-daily]', e) })
  if (utcHour === 1 && utcMin === 0) resetAiReportFlag()
}, 60 * 1000)

app.get('/api/ai-daily-report/catchup', async (_req, res) => {
  try { res.json(await maybeRunDailyReport('catchup-api')) }
  catch (e) { aiReportSent = false; res.status(500).json({ ok:false, error:e.message }) }
})

// ── Proxy /report/* → report-server on port 4568 ──────────────────────────
import http from 'node:http'
const REPORT_PORT = Number(process.env.REPORT_PORT || 4568)

app.all('/report*', (req, res) => {
  const opts = { hostname: '127.0.0.1', port: REPORT_PORT, path: req.originalUrl, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${REPORT_PORT}` } }
  const proxy = http.request(opts, (upstream) => { res.writeHead(upstream.statusCode, upstream.headers); upstream.pipe(res) })
  proxy.on('error', (e) => { console.error('[report-proxy] error', e.message); res.status(502).json({ ok:false, error:'report_server_unavailable' }) })
  if (['POST','PUT','PATCH'].includes(req.method)) req.pipe(proxy)
  else proxy.end()
})

app.use((err, _req, res, next) => {
  if (err?.type === 'entity.too.large') return res.status(413).json({ ok:false, error:'payload_too_large', maxBytes:512000 })
  if (err instanceof SyntaxError && 'body' in err) return res.status(400).json({ ok:false, error:'invalid_json' })
  next(err)
})

// ── SEO / Crawl / Sitemap / Favicon / Docs Routes ───────────────────────
const BASE = APP_CONFIG.publicBaseUrl || 'https://market-orca.anomali.web.id'
const REPORT_BASE = 'https://report.anomali.web.id'
const MCP_BASE = 'https://mcp.anomali.web.id'

// robots.txt – open crawl for all AI crawlers
app.get('/robots.txt', (_req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.send(`User-agent: *
Allow: /

# LLM/Bot crawl directives
User-agent: GPTBot
Allow: /

User-agent: Claude-Web
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: PerplexityBot
Allow: /

Sitemap: ${BASE}/sitemap.xml
`)
})

// sitemap.xml – dynamic XML listing all public pages
app.get('/sitemap.xml', async (_req, res) => {
  try {
    const assetSlugs = db.prepare('SELECT slug FROM assets ORDER BY slug').all().map(r => r.slug)
    const urls = [
      { loc: BASE + '/', changefreq: 'daily', priority: '1.0' },
      { loc: REPORT_BASE + '/report', changefreq: 'daily', priority: '0.9' },
      { loc: MCP_BASE + '/', changefreq: 'weekly', priority: '0.8' },
      ...assetSlugs.map(slug => ({ loc: `${BASE}/asset/${slug}`, changefreq: 'hourly', priority: '0.7' }))
    ]
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>\n    <loc>${u.loc}</loc>\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`).join('\n')}
</urlset>`
    res.setHeader('Content-Type', 'application/xml; charset=utf-8')
    res.send(xml)
  } catch (err) {
    res.status(500).setHeader('Content-Type', 'text/plain').send('Error generating sitemap')
  }
})

// llms.txt – LLM-friendly API endpoint listing per llmstxt.org
app.get('/llms.txt', (_req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.send(`# Market Orca - LLM API Documentation
> Market Orca is an AI-powered market intelligence & trading dashboard for Indonesian markets.
> Base URLs: ${BASE} (API), ${REPORT_BASE} (Reports), ${MCP_BASE} (MCP)

## Core API Endpoints
- GET  ${BASE}/robots.txt           - Robots crawl directives
- GET  ${BASE}/sitemap.xml          - XML sitemap
- GET  ${BASE}/llms.txt             - This file
- GET  ${BASE}/                     - Dashboard homepage (HTML)
- GET  ${BASE}/api/assets           - List all assets
- GET  ${BASE}/api/assets?q={query} - Search assets
- GET  ${BASE}/api/overview         - Market overview with prices & news
- GET  ${BASE}/api/indices          - Market indices
- GET  ${BASE}/api/me               - Current user info
- POST ${BASE}/api/auth/login       - User login
- POST ${BASE}/api/auth/logout      - User logout
- GET  ${BASE}/api/news/latest      - Latest news feed
- GET  ${BASE}/api/watchlist        - Get watchlist
- POST ${BASE}/api/watchlist/add    - Add to watchlist
- POST ${BASE}/api/watchlist/remove - Remove from watchlist

## Report Endpoints
- GET  ${BASE}/report/{slug}        - View AI daily report
- GET  ${BASE}/report/{slug}.json   - Report raw JSON
- GET  ${BASE}/report/{slug}/card.png - Report card image
- GET  ${BASE}/api/report/today     - Today's report JSON
- GET  ${BASE}/api/report/list      - List all reports

## MCP (Model Context Protocol) Endpoints
- GET  ${MCP_BASE}/mcp              - MCP status
- GET  ${MCP_BASE}/mcp/health       - Health check
- GET  ${MCP_BASE}/mcp/tools        - Tool catalog
- GET  ${MCP_BASE}/mcp/metrics      - Performance metrics
- GET  ${MCP_BASE}/mcp/selftest     - Self-test suite
- GET  ${MCP_BASE}/mcp/openapi.json - OpenAPI spec
- POST ${MCP_BASE}/mcp/tool/{tool}  - Call an MCP tool
- GET  ${BASE}/docs/mcp             - MCP documentation

## MCP Tools (${MCP_TOOLS.length} total)
${MCP_TOOLS.map(t => `- **${t.name}**: ${t.description}`).join('\n')}

## Web Search
- POST /mcp/tool/web.search           - Search web with modes/filters
- POST /mcp/tool/web.deep_search      - Multi-engine deep search
- POST /mcp/tool/web.fetch_page       - Read URL to Markdown
- POST /mcp/tool/web.search_and_answer - Search + answer with citations
- POST /mcp/tool/web.news_search      - News search with filters
- POST /mcp/tool/web.search_to_crawl  - Search & enqueue for RAG crawl
- POST /mcp/tool/web.preview          - Preview URL before crawl

## RAG
- POST /mcp/tool/rag.search           - Search RAG evidence store
- POST /mcp/tool/rag.ingest           - Ingest content into RAG
- POST /mcp/tool/rag.crawl_enqueue    - Enqueue URL for crawl
- POST /mcp/tool/rag.crawl_run        - Run crawl worker
- POST /mcp/tool/rag.vectorize_missing - Vectorize missing chunks
- POST /mcp/tool/rag.cleanup          - Cleanup old RAG chunks
- POST /mcp/tool/rag.storage          - RAG storage stats

## Reports
- POST /mcp/tool/report.get           - Get report JSON by slug
- POST /mcp/tool/report.blocks        - Get report evidence blocks

## TradingView
- POST /mcp/tool/tradingview.screener  - Market screener
- POST /mcp/tool/tradingview.chart     - OHLCV chart data
- POST /mcp/tool/tradingview.technical - Technical analysis
- POST /mcp/tool/tradingview.news      - Symbol news
- POST /mcp/tool/tradingview.popular   - Popular tickers

## Auth
All MCP tool calls require a Bearer token in the Authorization header.
Set MCP_AUTH_TOKEN env var to enable auth. Example:
  curl -H "Authorization: Bearer <token>" ${MCP_BASE}/mcp/tool/web.search

---
Generated by Market Orca. See https://llmstxt.org/ for the llms.txt standard.
`)
})

// Favicon emoji – inline SVG with orca whale emoji
function emojiFaviconSvg(emoji, bg) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="20" fill="${bg}"/><text x="50" y="72" font-size="64" text-anchor="middle">${emoji}</text></svg>`
}
const FAVICON_SVG = emojiFaviconSvg('🐋', '#111')
const FAVICON_LIGHT_SVG = emojiFaviconSvg('🐋', '#f4f1ea')
const FAVICON_DARK_SVG = emojiFaviconSvg('🐋', '#111')
const SVG_CACHE_CTRL = 'public, max-age=86400'

app.get('/favicon.ico', (_req, res) => {
  res.setHeader('Content-Type', 'image/svg+xml')
  res.setHeader('Cache-Control', SVG_CACHE_CTRL)
  res.send(FAVICON_SVG)
})
app.get('/favicon-light.ico', (_req, res) => {
  res.setHeader('Content-Type', 'image/svg+xml')
  res.setHeader('Cache-Control', SVG_CACHE_CTRL)
  res.send(FAVICON_LIGHT_SVG)
})
app.get('/favicon-dark.ico', (_req, res) => {
  res.setHeader('Content-Type', 'image/svg+xml')
  res.setHeader('Cache-Control', SVG_CACHE_CTRL)
  res.send(FAVICON_DARK_SVG)
})

// MCP docs page – comprehensive HTML documentation with EN/ID toggle
app.get('/docs/mcp', (_req, res) => {
  const toolRows = MCP_TOOLS.map(t => `<tr><td><code>${t.name}</code></td><td>${t.description.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</td><td><code>POST /mcp/tool/${t.name.split('.')[0]}</code></td></tr>`).join('\\\\n')
  const toolList = MCP_TOOLS.map(t => `  <li><strong>${t.name}</strong> — ${t.description.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</li>`).join('\\\\n')
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.send(`<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>🐋 Market Orca MCP Server - Documentation</title>
<meta name="description" content="Complete MCP API documentation for Market Orca - Model Context Protocol tools for market intelligence, web search, RAG, TradingView, and reports.">
<meta name="robots" content="index, follow">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"TechArticle","name":"Market Orca MCP Server Documentation","description":"Complete MCP API documentation for Market Orca - Model Context Protocol tools for market intelligence, web search, RAG, TradingView, and reports.","url":"https://market-orca.anomali.web.id/docs/mcp","publisher":{"@type":"Organization","name":"Market Orca"},"author":{"@type":"Person","name":"OpenClaw"}}</script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0a0a0b;color:#e4e4e7;font-family:system-ui,-apple-system,Inter,sans-serif;line-height:1.6}
.wrap{max-width:960px;margin:auto;padding:32px 16px}
h1{font-size:2.2rem;font-weight:800;background:linear-gradient(135deg,#818cf8,#6366f1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:6px}
h2{font-size:1.4rem;font-weight:700;color:#a5b4fc;margin:28px 0 12px;border-bottom:1px solid #27272a;padding-bottom:6px}
h3{font-size:1.1rem;font-weight:600;color:#c4b5fd;margin:18px 0 8px}
p,li{color:#d4d4d8;font-size:.95rem}
a{color:#818cf8}
code{background:#1e1e24;color:#e879f9;padding:1px 5px;border-radius:4px;font-size:.9rem}
pre{background:#1e1e24;border:1px solid #27272a;border-radius:8px;padding:14px;overflow-x:auto;margin:10px 0;font-size:.85rem}
pre code{background:none;color:#e4e4e7;padding:0}
table{width:100%;border-collapse:collapse;margin:14px 0}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #27272a;font-size:.9rem}
th{color:#a5b4fc;font-weight:600;background:#121215}
tr:hover td{background:#18181b}
.badge{display:inline-block;background:#6366f1;color:#fff;font-size:.7rem;font-weight:700;padding:2px 8px;border-radius:4px;text-transform:uppercase;margin-right:4px}
.badge-get{background:#10b981}
.badge-post{background:#6366f1}
.badge-opt{border:1px solid #52525b;background:transparent;color:#a1a1aa}
.section{background:#121215;border:1px solid #27272a;border-radius:10px;padding:20px;margin-bottom:18px}
.tag{color:#818cf8;font-size:.8rem}
ul{padding-left:20px}
li{margin:4px 0}
.lang-toggle{display:flex;gap:8px;justify-content:flex-end;margin-bottom:16px}
.lang-btn{background:#27272a;border:1px solid #52525b;color:#a1a1aa;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:.8rem;font-weight:600;transition:all .15s}
.lang-btn.active{background:#6366f1;border-color:#818cf8;color:#fff}
.lang-id,.lang-en{transition:opacity .2s}
</style>
</head><body>
<script>
(function(){var lang=localStorage.getItem('mcp_docs_lang')||'en';document.documentElement.lang=lang;window.__mcpLang=lang})()
function setLang(l){localStorage.setItem('mcp_docs_lang',l);document.documentElement.lang=l;window.__mcpLang=l;document.querySelectorAll('.lang-en,.lang-id').forEach(function(el){el.style.display=el.classList.contains('lang-'+l)?'':'none'});document.querySelectorAll('.lang-btn').forEach(function(b){b.classList.toggle('active',b.dataset.lang===l)})}
</script>
<div class="wrap">
<div class="lang-toggle"><button class="lang-btn" data-lang="en" onclick="setLang('en')">🇬🇧 English</button><button class="lang-btn" data-lang="id" onclick="setLang('id')">🇮🇩 Indonesia</button></div>

<h1>🐋 Market Orca MCP Server - Documentation</h1>
<p style="color:#a1a1aa;margin-bottom:20px">Model Context Protocol v2025-03-26 &middot; HTTP Transport &middot; ${MCP_TOOLS.length} tools available</p>

<!-- ========== OVERVIEW ========== -->
<div class="section">
<h2>💡 Overview</h2>
<div class="lang-en">
<p>Market Orca exposes a <strong>MCP-lite</strong> interface (<strong>M</strong>odel <strong>C</strong>ontext <strong>P</strong>rotocol) for programmatic access to market intelligence, web search, RAG retrieval, TradingView data, and automated reporting. MCP is an open standard developed by Anthropic that enables AI agents to interact with external tools and data sources through a unified protocol. All endpoints are accessible via HTTP with optional Bearer token authentication.</p>
<p><strong>Base URL:</strong> <code>${MCP_BASE}/mcp</code></p>
<p><strong>Auth:</strong> All MCP tool calls require <code>Authorization: Bearer &lt;token&gt;</code> header when <code>MCP_AUTH_TOKEN</code> env var is set.</p>
<p><strong>Rate Limit:</strong> ${process.env.MCP_RATE_LIMIT_PER_MIN || 120} requests/min per IP</p>
<p><strong>Version:</strong> 1.2.0</p>
</div>
<div class="lang-id">
<p>Market Orca menyediakan antarmuka <strong>MCP-lite</strong> (<strong>M</strong>odel <strong>C</strong>ontext <strong>P</strong>rotocol) untuk akses terprogram ke informasi pasar, pencarian web, RAG, data TradingView, dan pelaporan otomatis. MCP adalah standar terbuka yang dikembangkan oleh Anthropic yang memungkinkan agen AI berinteraksi dengan alat eksternal dan sumber data melalui protokol terpadu. Semua endpoint dapat diakses via HTTP dengan autentikasi Bearer token opsional.</p>
<p><strong>Base URL:</strong> <code>${MCP_BASE}/mcp</code></p>
<p><strong>Autentikasi:</strong> Semua panggilan MCP memerlukan header <code>Authorization: Bearer &lt;token&gt;</code> jika <code>MCP_AUTH_TOKEN</code> env var diset.</p>
<p><strong>Batas Rate:</strong> ${process.env.MCP_RATE_LIMIT_PER_MIN || 120} permintaan/menit per IP</p>
<p><strong>Versi:</strong> 1.2.0</p>
</div>
</div>

<!-- ========== ENDPOINTS ========== -->
<div class="section">
<h2>🧹 Endpoints</h2>
<table>
<tr><th>Endpoint</th><th>Method</th><th><span class="lang-en">Description</span><span class="lang-id">Deskripsi</span></th></tr>
<tr><td><code>/mcp</code></td><td><span class="badge badge-get">GET</span></td><td><span class="lang-en">MCP status: version, tool count, rate limit info</span><span class="lang-id">Status MCP: versi, jumlah alat, info batas rate</span></td></tr>
<tr><td><code>/mcp/health</code></td><td><span class="badge badge-get">GET</span></td><td><span class="lang-en">Health check with transport type, auth mode, tool names</span><span class="lang-id">Pemeriksaan kesehatan dengan tipe transport, mode auth, nama alat</span></td></tr>
<tr><td><code>/mcp/tools</code></td><td><span class="badge badge-get">GET</span></td><td><span class="lang-en">Full tool catalog with input schemas</span><span class="lang-id">Katalog lengkap alat dengan skema input</span></td></tr>
<tr><td><code>/mcp/metrics</code></td><td><span class="badge badge-get">GET</span></td><td><span class="lang-en">Request metrics: total, ok, fail, rate-limited, by-tool stats, cache stats</span><span class="lang-id">Metrik permintaan: total, ok, gagal, statistik per alat, cache</span></td></tr>
<tr><td><code>/mcp/selftest</code></td><td><span class="badge badge-get">GET</span></td><td><span class="lang-en">Automated health checks: RAG storage, web fetch, web search</span><span class="lang-id">Pemeriksaan otomatis: penyimpanan RAG, fetch web, pencarian web</span></td></tr>
<tr><td><code>/mcp/openapi.json</code></td><td><span class="badge badge-get">GET</span></td><td><span class="lang-en">OpenAPI 3.1 specification</span><span class="lang-id">Spesifikasi OpenAPI 3.1</span></td></tr>
<tr><td><code>/mcp/tool/{tool}</code></td><td><span class="badge badge-post">POST</span></td><td><span class="lang-en">Call any MCP tool</span><span class="lang-id">Panggil alat MCP apa pun</span></td></tr>
</table>
</div>

<!-- ========== TOOLS ========== -->
<div class="section">
<h2>🔧 <span class="lang-en">Available Tools</span><span class="lang-id">Alat yang Tersedia</span></h2>
<ul>${toolList}
</ul>
</div>

<!-- ========== USAGE EXAMPLES ========== -->
<div class="section">
<h2>🛬 <span class="lang-en">Usage Examples</span><span class="lang-id">Contoh Penggunaan</span></h2>

<h3>Health Check</h3>
<pre><code>curl -s ${MCP_BASE}/mcp/health | jq .</code></pre>

<h3><span class="lang-en">List Tools</span><span class="lang-id">Daftar Alat</span></h3>
<pre><code>curl -s ${MCP_BASE}/mcp/tools | jq .</code></pre>

<h3><span class="lang-en">Call a Tool (with auth)</span><span class="lang-id">Panggil Alat (dengan auth)</span></h3>
<pre><code>curl -s -X POST ${MCP_BASE}/mcp/tool/web.search \\
  -H "Authorization: Bearer *** \\
  -H "Content-Type: application/json" \\
  -d '{"query":"IHSG today","limit":5}' | jq .</code></pre>

<h3>RAG Search</h3>
<pre><code>curl -s -X POST ${MCP_BASE}/mcp/tool/rag.search \\
  -H "Authorization: Bearer *** \\
  -H "Content-Type: application/json" \\
  -d '{"query":"Indonesian market outlook","limit":8}' | jq .</code></pre>

<h3><span class="lang-en">Get Report</span><span class="lang-id">Ambil Laporan</span></h3>
<pre><code>curl -s -X POST ${MCP_BASE}/mcp/tool/report.get \\
  -H "Authorization: Bearer *** \\
  -H "Content-Type: application/json" \\
  -d '{"slug":"2026-06-16"}' | jq .</code></pre>

<h3>TradingView Screener</h3>
<pre><code>curl -s -X POST ${MCP_BASE}/mcp/tool/tradingview.screener \\
  -H "Authorization: Bearer *** \\
  -H "Content-Type: application/json" \\
  -d '{"market":"crypto","limit":10}' | jq .</code></pre>
</div>

<!-- ========== INTEGRATION GUIDE ========== -->
<div class="section">
<h2>🤖 <span class="lang-en">AI Integration Guide</span><span class="lang-id">Panduan Integrasi AI</span></h2>

<div class="lang-en">
<h3>Claude Desktop</h3>
<p>Add an MCP server in your <code>claude_desktop_config.json</code>:</p>
<pre><code>{
  "mcpServers": {
    "market-orca": {
      "type": "url",
      "url": "${MCP_BASE}/mcp"
    }
  }
}</code></pre>
<p>All 20 tools are auto-discovered. No restart needed after config change.</p>

<h3>Claude Code (CLI)</h3>
<p>Add the MCP server configuration:</p>
<pre><code># In your project's .claude/settings.json or ~/.claude/settings.json:
{
  "mcpServers": {
    "market-orca": {
      "type": "url",
      "url": "${MCP_BASE}/mcp"
    }
  }
}</code></pre>

<h3>Cursor IDE</h3>
<p>In Cursor settings → Features → MCP Servers, add:</p>
<pre><code>Type: url
Url: ${MCP_BASE}/mcp</code></pre>
<p>Or add to your project's <code>.cursor/mcp.json</code>:</p>
<pre><code>{
  "mcpServers": {
    "market-orca": {
      "type": "url",
      "url": "${MCP_BASE}/mcp"
    }
  }
}</code></pre>
</div>

<div class="lang-id">
<h3>Claude Desktop</h3>
<p>Tambahkan server MCP di <code>claude_desktop_config.json</code>:</p>
<pre><code>{
  "mcpServers": {
    "market-orca": {
      "type": "url",
      "url": "${MCP_BASE}/mcp"
    }
  }
}</code></pre>
<p>Semua 20 alat terdeteksi otomatis. Tidak perlu restart setelah perubahan konfigurasi.</p>

<h3>Claude Code (CLI)</h3>
<p>Tambahkan konfigurasi server MCP:</p>
<pre><code>// Di .claude/settings.json proyek Anda:
{
  "mcpServers": {
    "market-orca": {
      "type": "url",
      "url": "${MCP_BASE}/mcp"
    }
  }
}</code></pre>

<h3>Cursor IDE</h3>
<p>Di pengaturan Cursor → Features → MCP Servers, tambahkan:</p>
<pre><code>Type: url
Url: ${MCP_BASE}/mcp</code></pre>
<p>Atau tambahkan ke <code>.cursor/mcp.json</code> proyek Anda:</p>
<pre><code>{
  "mcpServers": {
    "market-orca": {
      "type": "url",
      "url": "${MCP_BASE}/mcp"
    }
  }
}</code></pre>
</div>
</div>

<!-- ========== AUTH ========== -->
<div class="section">
<h2>🛡️ Authentication</h2>
<div class="lang-en">
<p>To enable authentication, set the <code>MCP_AUTH_TOKEN</code> environment variable in your <code>.env</code> file:</p>
<pre><code>MCP_AUTH_TOKEN=your-secret-token</code></pre>
<p>All requests must include the token in the <code>Authorization</code> header:</p>
<pre><code>Authorization: Bearer your-secret-token</code></pre>
<p>If <code>MCP_AUTH_TOKEN</code> is not set, the MCP endpoints are publicly accessible. Set a strong random token in production.</p>
</div>
<div class="lang-id">
<p>Untuk mengaktifkan autentikasi, set variabel lingkungan <code>MCP_AUTH_TOKEN</code> di file <code>.env</code>:</p>
<pre><code>MCP_AUTH_TOKEN=your-secret-token</code></pre>
<p>Semua permintaan harus menyertakan token di header <code>Authorization</code>:</p>
<pre><code>Authorization: Bearer your-secret-token</code></pre>
<p>Jika <code>MCP_AUTH_TOKEN</code> tidak diset, endpoint MCP dapat diakses publik. Gunakan token acak yang kuat di produksi.</p>
</div>
</div>

<!-- ========== RATE LIMITING ========== -->
<div class="section">
<h2>📊 <span class="lang-en">Rate Limiting</span><span class="lang-id">Batas Rate</span></h2>
<div class="lang-en">
<p>Rate limiting is applied per IP address. Default: ${process.env.MCP_RATE_LIMIT_PER_MIN || 120} requests per minute. Configure via <code>MCP_RATE_LIMIT_PER_MIN</code> env var.</p>
<p>When rate-limited, the API returns HTTP 429 with:</p>
</div>
<div class="lang-id">
<p>Batas rate diterapkan per alamat IP. Default: ${process.env.MCP_RATE_LIMIT_PER_MIN || 120} permintaan per menit. Konfigurasi via <code>MCP_RATE_LIMIT_PER_MIN</code> env var.</p>
<p>Saat dibatasi, API mengembalikan HTTP 429 dengan:</p>
</div>
<pre><code>{"ok":false,"error":"rate_limited","limitPerMinute":120}</code></pre>
</div>

<!-- ========== RELATED ========== -->
<div class="section">
<h2>🌍 <span class="lang-en">Related Links</span><span class="lang-id">Tautan Terkait</span></h2>
<ul>
<li><a href="${BASE}/">Market Orca Dashboard</a></li>
<li><a href="${BASE}/sitemap.xml">Sitemap</a></li>
<li><a href="${BASE}/robots.txt">Robots.txt</a></li>
<li><a href="${BASE}/llms.txt">LLMs.txt</a></li>
<li><a href="${REPORT_BASE}/report">AI Reports</a></li>
</ul>
</div>

<p style="text-align:center;color:#52525b;font-size:.8rem;margin-top:40px">Market Orca MCP &middot; Built with ❤\\u{FE0F} by OpenClaw &middot; <a href="https://market-orca.anomali.web.id">market-orca.anomali.web.id</a></p>
</div>
<script>setLang(window.__mcpLang||'en')</script>
</body></html>`)
})

// ── Indonesia Economic Indicators ─────────────────────────────────
app.use('/api/indonesia', indonesiaRoutes)

// ── Serve Vue SPA for client-side routes ─────────────────────────
const FRONTEND_DIST = path.resolve(__dirname, '../../frontend/dist')
if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST))
  // Catch-all: serve index.html for SPA routes not matched above
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/mcp/')) return next()
    res.sendFile(path.join(FRONTEND_DIST, 'index.html'))
  })
} else {
  console.warn('[spa] frontend/dist not found at', FRONTEND_DIST)
}

app.listen(PORT, '::', () => {
  console.log(`market-orca backend listening on http://localhost:${PORT} (IPv4+IPv6)`)
  startStructuredIndonesiaCron()  // New structured Indonesia module
  if (process.env.NO_DISCORD !== '1') initDiscordBot().catch((err) => console.error('[discord] init-failed', err))
  if (jakartaHour() >= 7 && !reportExists(todaySlug())) {
    setTimeout(() => maybeRunDailyReport('startup-catchup').catch((e) => { aiReportSent = false; console.error('[ai-daily-catchup]', e) }), 15000)
  }
})
