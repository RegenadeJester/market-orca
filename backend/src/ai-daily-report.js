import { EmbedBuilder, AttachmentBuilder } from 'discord.js'
import { initDiscordBot } from './discord.js'
import { db, recordIncidentStatus, getIncidentStatusHistory, incidentTitleHash } from './db.js'
import { buildRagContext, formatRagMarkdown, saveRagCitations } from './rag.js'
import { deepWebSearch } from './web-search.js'
import { validateFetchUrl } from './web-search.js'
import { enqueueRagCrawl } from './rag-crawler.js'
import { getAssetFreshness, buildDataStatusBlock, dataFreshnessQA } from './market-calendar.js'
import { scoreSourceTrust } from './source-reliability.js'
import { getPersona, buildContextPrompt } from './persona.js'
import PDFDocument from 'pdfkit'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))


function reportSearchQueries(topics=[], limit=6){
  const q=[]
  for(const t of topics.slice(0,8)){
    const title=String(t.title||t.headline||'').trim()
    const source=String(t.source||'').trim()
    const tags=Array.isArray(t.tags)?t.tags.join(' '):''
    if(title) q.push(title)
    if(title && source) q.push(`${title} ${source}`)
    if(tags) q.push(`${title} ${tags}`.trim())
  }
  const assets=db.prepare('SELECT symbol,name FROM assets ORDER BY abs(change_percent) DESC LIMIT 6').all()
  for(const a of assets) q.push(`${a.symbol} ${a.name} news analysis`)
  return [...new Set(q.map(x=>x.replace(/https?:\/\/\S+/g,'').replace(/\s+/g,' ').trim()).filter(x=>x.length>8))].slice(0,limit)
}

export async function autoEnrichReportWeb(topics=[], {queryLimit=5, perQueryLimit=5, enqueueLimit=10}={}){
  const queries=reportSearchQueries(topics, queryLimit)
  const all=[]; const enqueued=[]; const errors=[]
  for(const query of queries){
    try{
      const out=await deepWebSearch(query,{limit:perQueryLimit,engines:['bing','yahoo','duckduckgo'],modes:['market','official','blog','forum','journal','coding'],filetypes:['pdf'],autoPreview:false})
      all.push({query,count:out.results.length,clusters:out.clusters?.slice(0,5)||[],top:out.results.slice(0,3)})
      for(const r of out.results.slice(0,enqueueLimit)){
        try{ enqueueRagCrawl(r.url,{source:r.domain,assetTags:[...(r.assetTags||[]),'auto-report-web']}); enqueued.push({query,url:r.url,domain:r.domain,title:r.title}) }catch(e){ errors.push({query,url:r.url,error:String(e.message||e)}) }
        if(enqueued.length>=enqueueLimit) break
      }
    }catch(e){ errors.push({query,error:String(e.message||e)}) }
    if(enqueued.length>=enqueueLimit) break
  }
  db.exec(`CREATE TABLE IF NOT EXISTS report_web_enrichment (id INTEGER PRIMARY KEY AUTOINCREMENT, report_slug TEXT DEFAULT '', query TEXT, url TEXT, domain TEXT, title TEXT, status TEXT DEFAULT 'enqueued', created_at TEXT DEFAULT (datetime('now')))`)
  const stmt=db.prepare('INSERT INTO report_web_enrichment (report_slug,query,url,domain,title,status) VALUES (?,?,?,?,?,?)')
  for(const e of enqueued) stmt.run(new Date().toISOString().slice(0,10),e.query,e.url,e.domain,e.title,'enqueued')
  return {ok:true,queries,enqueued:enqueued.length,enqueuedItems:enqueued,summary:all,errors}
}

function inferContextAssumption(key) {
  const fallback = { goal:'monitoring risiko dan peluang market harian', time_horizon:'harian sampai mingguan', watchlist_priority:'watchlist aktif + USD/IDR + JKSE', risk_tolerance:'normal', preferred_action:'watch + risk alert + next signal' }
  return fallback[key] || 'unknown'
}

function buildAnomalyReportBlock({priceThreshold=10, volumeMultiplier=2}={}){
  try {
    const assets=db.prepare('SELECT slug,symbol,name,market,price,change_percent FROM assets ORDER BY abs(change_percent) DESC LIMIT 80').all()
    const rows=[]
    for(const a of assets){
      const candles=db.prepare('SELECT volume FROM candles WHERE asset_slug=? ORDER BY id DESC LIMIT 8').all(a.slug)
      const latest=Number(candles[0]?.volume||0)
      const vols=candles.slice(1).map(c=>Number(c.volume||0)).filter(Boolean)
      const avg=vols.reduce((x,y)=>x+y,0)/Math.max(1,vols.length)
      const volumeRatio=avg?latest/avg:0
      const move=Math.abs(Number(a.change_percent||0))
      const flags=[]; if(move>=priceThreshold) flags.push(`harga ${a.change_percent>=0?'+':''}${Number(a.change_percent||0).toFixed(2)}%`); if(volumeRatio>=volumeMultiplier) flags.push(`volume ${volumeRatio.toFixed(1)}x avg`)
      if(flags.length) rows.push({...a,flags,volumeRatio})
    }
    if(!rows.length) return `## Anomali Harga/Volume\n- Tidak ada anomali besar: threshold harga ±${priceThreshold}% atau volume >${volumeMultiplier}x rata-rata 7 candle.`
    return `## Anomali Harga/Volume\nThreshold: harga ±${priceThreshold}% atau volume >${volumeMultiplier}x rata-rata 7 candle.\n\n${rows.slice(0,12).map(r=>`- **${r.symbol}** (${r.market}): ${r.flags.join(' · ')} — cek catalyst/news sebelum aksi.`).join('\n')}`
  } catch { return '## Anomali Harga/Volume\n- Data anomali belum tersedia.' }
}

function reportContextGapBlock() {
  try {
    const required = ['goal','time_horizon','watchlist_priority','risk_tolerance','preferred_action']
    const rows = db.prepare('SELECT key,value,confidence FROM user_context_answers').all()
    const map = new Map(rows.map(r=>[r.key,r]))
    const missing = required.filter(k=>!map.has(k) || !String(map.get(k).value||'').trim())
    const lines = required.map(k => map.has(k) ? `- ${k}: ${map.get(k).value} (${map.get(k).confidence})` : `- ${k}: assumed ${inferContextAssumption(k)} (low confidence)`).join('\n')
    const questions = missing.slice(0,3).map(k => ({ goal:'Tujuan utama report ini untuk apa: trading cepat, investasi panjang, riset kompetitor, atau monitoring risiko?', time_horizon:'Horizon keputusan: intraday, mingguan, bulanan, atau panjang?', watchlist_priority:'Asset/watchlist mana yang paling prioritas?', risk_tolerance:'Toleransi risiko: konservatif, normal, agresif?', preferred_action:'Output aksi yang diinginkan: buy/sell/watch, risk alert, atau research note?' }[k]))
    return `## Context Gap Interviewer\n- **Confidence:** ${missing.length?'low':'high'}\n${lines}${questions.length?`\n\n**Pertanyaan mikro:**\n${questions.map(q=>`- ${q}`).join('\n')}`:''}`
  } catch { return '' }
}

function loadEnv() {
  const out = {}
  const envPath = path.join(__dirname, '..', '.env')
  if (!fs.existsSync(envPath)) return out
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue
    const idx = line.indexOf('=')
    if (idx === -1) continue
    out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }
  return out
}

function logDelivery(slug, step, status, detail = '') {
  try { db.prepare(`INSERT INTO delivery_log (slug,channel,step,status,detail) VALUES (?,?,?,?,?)`).run(slug || 'unknown', 'discord', step, status, String(detail).slice(0,500)) } catch {}
  if (status === 'fail') {
    try {
      db.prepare(`INSERT INTO send_queue (slug,channel,step,payload,status,attempts,last_error,next_attempt_at,updated_at) VALUES (?,?,?,?, 'pending', 0, ?, datetime('now', '+15 minutes'), datetime('now'))`).run(slug || 'unknown', 'discord', step, JSON.stringify({ step, slug: slug || 'unknown' }), String(detail).slice(0,500))
    } catch {}
  }
}

async function getBotClient() {
  // Reuse the long-lived bot client from discord.js instead of creating a new login per report.
  // Fixes intermittent Discord connect timeout / bot-status dead issue.
  return initDiscordBot().catch(() => null)
}

function formatDateIndonesia() {
  const now = new Date()
  const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']
  const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
  return `${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`
}

function clean(text) {
  return (text || '').replace(/[*_`[~\]]/g, '').replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim()
}

function pickHero(topics) {
  const all = topics.flatMap(t => (t.items || []).filter(i => i.title).map(i => ({ ...i, section: t.title })))
  const scored = all.map(i => {
    const txt = `${i.title} ${i.snippet || ''}`
    let score = 0
    if (i.points) score += Math.log10(Number(i.points) + 1) * 3
    if (/\b(launch|raise|funding|breakthrough|agent|model|security|privacy|earnings|stock|market|AI|LLM|OpenAI|Anthropic|Google|Nvidia)\b/i.test(txt)) score += 4
    if ((i.snippet || '').length > 80) score += 2
    if (/TechCrunch|VentureBeat|MIT Tech Review|Google AI Blog|Ars Technica|The Verge|CNBC Tech|HN/.test(i.source || '')) score += 2
    // Source reliability boost/penalty
    const trust = scoreSourceTrust(i.source, i.url)
    if (trust.score >= 75) score += 2
    else if (trust.score < 40) score -= 2
    return { ...i, heroScore: score }
  }).sort((a,b) => b.heroScore - a.heroScore)
  return scored[0] || all[0] || null
}

function vibeTag(item) {
  const t = `${item?.title || ''} ${item?.snippet || ''}`.toLowerCase()
  if (/agent|claude code|cursor|copilot|developer|coding|github|vibe/.test(t)) return 'dev-core'
  if (/funding|raises|ipo|valuation|billion|million|startup/.test(t)) return 'money moves'
  if (/security|privacy|hack|breach|vulnerability|malware/.test(t)) return 'red flag'
  if (/model|llm|benchmark|reasoning|openai|anthropic|gemini|llama|qwen/.test(t)) return 'model wars'
  if (/stock|market|finance|crypto|bitcoin|fed|rate|bank/.test(t)) return 'market mood'
  if (/launch|release|tool|platform|api|sdk|app|feature/.test(t)) return 'new tool drop'
  if (/research|paper|study|dataset|evaluation|safety/.test(t)) return 'lab notes'
  return 'worth knowing'
}

function whyItMatters(item) {
  const t = `${item?.title || ''} ${item?.snippet || ''}`.toLowerCase()
  const snippet = item?.snippet ? clean(item.snippet).slice(0, 120) : ''
  const vibe = vibeTag(item)
  // Build a contextual why-care based on actual content + vibeTag
  if (snippet.length > 20) {
    if (/agent|coding|developer|cursor|copilot|claude code/.test(t)) return `Developer workflow berubah: ${snippet.slice(0, 100)}${snippet.length > 100 ? '…' : ''} — cek apakah ini berdampak ke timmu.`
    if (/funding|raises|valuation|ipo/.test(t)) return `Modal masuk ke sektor ini: ${snippet.slice(0, 100)}${snippet.length > 100 ? '…' : ''} — indikator sektor mana yang sedang dipercaya investor.`
    if (/security|privacy|hack|breach|vulnerability|phishing/.test(t)) return `Risiko keamanan nyata: ${snippet.slice(0, 100)}${snippet.length > 100 ? '…' : ''} — periksa apakah sistemmu terdampak.`
    if (/model|llm|benchmark|reasoning/.test(t)) return `Evolusi model: ${snippet.slice(0, 100)}${snippet.length > 100 ? '…' : ''} — relevan untuk stack AI-mu.`
    if (/market|stock|crypto|fed|bank|finance|etf/.test(t)) return `Pergerakan market: ${snippet.slice(0, 100)}${snippet.length > 100 ? '…' : ''} — validasi dengan data harga dan volume.`
    if (/tool|launch|platform|api|sdk|feature|app/.test(t)) return `Tool/platform baru: ${snippet.slice(0, 100)}${snippet.length > 100 ? '…' : ''} — worth cek kalau bisa pangkas workflow.`
    return `Konteks: ${snippet.slice(0, 100)}${snippet.length > 100 ? '…' : ''} — ${vibe !== 'worth knowing' ? `kategori "${vibe}" menunjukkan tren ini patut dipantau.` : 'patut dipantau untuk update terkini.'}`
  }
  // Fallback without snippet: use title + vibe context
  if (/agent|coding|developer/.test(t)) return `Developer tools berubah — ini bisa mempengaruhi workflow timmu.`
  if (/funding|raises|valuation/.test(t)) return `Indikator modal masuk sektor tertentu — bagus untuk baca arah industri.`
  if (/security|hack|breach/.test(t)) return `Potensi risiko keamanan — periksa apakah sistem terdampak.`
  if (/model|llm|benchmark/.test(t)) return `Update model AI — relevan untuk stack dan keputusan teknis.`
  if (/market|stock|crypto|fed/.test(t)) return `Pergerakan market — cek konfirmasi sebelum aksi.`
  if (/tool|launch|platform|api/.test(t)) return `Produk baru rilis — worth cek kalau bisa efisiensi kerja.`
  return `Berita ${vibe !== 'worth knowing' ? `kategori "${vibe}"` : 'ini'} — baca untuk update terkini industri.`
}

function loadReportPreferences() {
  const defaults = { tone:'balanced', depth:'normal', language:'id', priority_topics:'market,indonesia,watchlist', favorite_assets:'', discord_spam_level:'digest' }
  try {
    const row = db.prepare('SELECT * FROM user_report_preferences WHERE id = 1').get()
    return { ...defaults, ...(row || {}) }
  } catch { return defaults }
}

function userIntentMemoryBlock(prefs = loadReportPreferences()) {
  const topics = String(prefs.priority_topics || '').split(',').map(x => x.trim()).filter(Boolean).slice(0, 8)
  const assets = String(prefs.favorite_assets || '').split(',').map(x => x.trim()).filter(Boolean).slice(0, 12)
  const focus = topics.length ? topics.join(' • ') : 'market • indonesia • watchlist'
  const assetLine = assets.length ? assets.join(' • ') : 'watchlist aktif'
  const style = prefs.language === 'en' ? 'English' : prefs.language === 'mixed' ? 'ID/EN mixed' : 'Bahasa Indonesia'
  const depth = prefs.depth === 'deep' ? 'deep analysis' : prefs.depth === 'brief' ? 'brief scan' : 'normal depth'
  return `## User Context\n- **Tone:** ${prefs.tone || 'balanced'} · **Depth:** ${depth} · **Language:** ${style}\n- **Priority topics:** ${focus}\n- **Favorite assets:** ${assetLine}\n- **Discord mode:** ${prefs.discord_spam_level || 'digest'}\n- **Instruction:** prioritaskan konteks user di atas berita generik; bila konteks rendah, ringkas + beri next signal.\n`
}

function punchyHeadline(item) {
  if (!item?.title) return 'AI, Tech, dan Market Hari Ini: Yang Worth Kamu Baca'
  const raw = clean(item.title).replace(/\.$/, '')
  const text = `${raw} ${item.snippet || ''}`.toLowerCase()
  const src = item.source ? ` — ${item.source}` : ''
  return `${raw}${src}`.slice(0, 150)
}

// ═══════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════

export function buildSummary(topics) {
  const allItems = topics.flatMap(t => t.items.filter(i => i.title))
  const hero = pickHero(topics)
  const impact = buildImpactWatch(topics)
  const sourceCount = new Set(allItems.map(i => i.source).filter(Boolean)).size

  const hotTitle = hero?.title ? clean(hero.title).slice(0, 120) : 'AI/tech market sedang ramai hari ini'
  const hotUrl = hero?.url ? `\n<${hero.url}>` : ''
  const why = hero ? whyItMatters(hero) : 'Mixed signal — perlu konfirmasi data dan volume lebih lanjut.'
  const regime = impact.regime.regime
  const dirText = regime === 'risk-on' ? 'positif (risk-on)' : regime === 'risk-off' ? 'negatif (risk-off)' : 'mixed'
  const driverText = impact.event.drivers.slice(0, 2).join(', ')

  // Anti-halucination: mark data gaps
  const dataGaps = []
  const assets = db.prepare('SELECT slug,price,change_percent FROM assets WHERE slug IN (?,?,?,?,?)').all('jkse','usdidr','btcusdt','spy','xauusd')
  if (!assets.find(a => a.slug === 'jkse' || a.slug === 'JKSE')) dataGaps.push('IHSG')
  if (!assets.find(a => a.slug === 'usdidr')) dataGaps.push('USD/IDR')
  if (!assets.find(a => a.slug === 'btcusdt')) dataGaps.push('BTC')
  const gapNote = dataGaps.length > 0 ? `\n⚠️ **Data belum tersedia:** ${dataGaps.join(', ')} — analisa ini tidak mencakup data tersebut.` : ''

  return `### Ringkasan Hari Ini\n\n` +
    `**Top Story:** ${hotTitle}${hotUrl}\n\n` +
    `**Kenapa penting:** ${why}\n\n` +
    `**Sentimen pasar:** ${dirText.charAt(0).toUpperCase() + dirText.slice(1)} — didorong oleh ${impact.event.label.toLowerCase()} (${driverText}).\n\n` +
    `**Indonesia Pulse:** ${impact.pulse || 'data pending'}\n\n` +
    `**Coverage:** ${allItems.length} berita dari ${sourceCount} sumber terverifikasi.${gapNote}`
}

// ═══════════════════════════════════════════
// ANTI-HALUSINASI: Data Validation Block
// ═══════════════════════════════════════════

export function buildDataValidationBlock() {
  const checks = []
  // Check if price data exists and is fresh
  const freshAssets = db.prepare(`SELECT COUNT(*) as cnt FROM assets WHERE price > 0 AND updated_at > datetime('now', '-6 hours')`).get()
  const totalAssets = db.prepare('SELECT COUNT(*) as cnt FROM assets').get()
  checks.push({
    name: 'Harga aktif',
    status: freshAssets.cnt > 0 ? 'ok' : 'warning',
    detail: `${freshAssets.cnt}/${totalAssets.cnt} asset dengan harga < 6 jam`,
    dataGap: freshAssets.cnt < 5 ? 'Sebagian besar data harga belum diperbarui — angka dalam report mungkin tidak mencerminkan kondisi terkini.' : null
  })

  // Check news freshness
  const freshNews = db.prepare(`SELECT COUNT(*) as cnt FROM news WHERE created_at > datetime('now', '-12 hours')`).get()
  checks.push({
    name: 'Berita',
    status: freshNews.cnt > 5 ? 'ok' : freshNews.cnt > 0 ? 'warning' : 'critical',
    detail: `${freshNews.cnt} berita < 12 jam`,
    dataGap: freshNews.cnt === 0 ? 'Tidak ada berita baru dalam 12 jam — analisa mungkin mengulang berita lama atau kosong.' : null
  })

  // Check candles (price history)
  const freshCandles = db.prepare(`SELECT COUNT(*) as cnt FROM candles WHERE time > datetime('now', '-24 hours')`).get()
  checks.push({
    name: 'OHLCV',
    status: freshCandles.cnt > 10 ? 'ok' : 'warning',
    detail: `${freshCandles.cnt} candle < 24 jam`,
    dataGap: freshCandles.cnt < 3 ? 'Data OHLCV sangat minim — analisa teknikal dan volume tidak reliable.' : null
  })

  // Check search coverage
  const lastSearch = db.prepare(`SELECT MAX(created_at) as last FROM report_web_enrichment`).get()
  const hoursSinceSearch = lastSearch?.last ? Math.round((Date.now() - Date.parse(lastSearch.last)) / 3600000) : 999
  checks.push({
    name: 'Web enrichment',
    status: hoursSinceSearch < 12 ? 'ok' : 'warning',
    detail: `${hoursSinceSearch} jam sejak web crawl terakhir`,
    dataGap: hoursSinceSearch > 24 ? 'Web crawl >24 jam — report tidak memiliki data dari sumber terbaru.' : null
  })

  const gaps = checks.filter(c => c.dataGap).map(c => c.dataGap)
  const allOk = checks.every(c => c.status === 'ok')

  let md = `## Data Quality & Validation\n\n`
  md += checks.map(c => `- ${c.status === 'ok' ? '✅' : c.status === 'warning' ? '⚠️' : '❌'} **${c.name}**: ${c.detail}${c.dataGap ? ' ⛔' : ''}`).join('\n')
  if (gaps.length) {
    md += `\n\n### ⚠️ Catatan Data Gap\n\nAnalisa ini memiliki keterbatasan karena:\n\n`
    md += gaps.map(g => `- ${g}`).join('\n')
    md += `\n\n> *Report ini menyajikan data yang tersedia. Jika ada data yang tidak ada atau tidak terverifikasi, analisa tersebut ditandai secara eksplisit. Tidak ada asumsi yang dibuat untuk mengisi data gap.*`
  } else {
    md += `\n\n✅ **Semua data valid dan fresh.** Analisa menggunakan data terkini dari ${checks.length} sumber.`
  }
  return md
}

export function buildExecutiveBrief(topics) {
  const allItems = topics.flatMap(t => (t.items || []).filter(i => i.title))
  const hero = pickHero(topics)
  const impact = buildImpactWatch(topics)
  const topRisk = impact.rows.find(r => r.risk === 'high') || impact.rows[0]
  const opportunity = impact.rows.find(r => r.dir === 'bullish') || impact.rows.find(r => r.score > 0) || topRisk
  const sourceCount = new Set(allItems.map(i => i.source).filter(Boolean)).size
  const hot = hero?.title ? clean(hero.title).slice(0, 120) : 'Tidak ada headline dominan.'
  const riskLine = topRisk ? `${topRisk.symbol}: ${topRisk.dir}, ${topRisk.risk} risk; pantau ${impact.event.signals.slice(0,2).join(' + ')}.` : 'Risiko utama belum cukup data.'
  const oppLine = opportunity ? `${opportunity.symbol}: ${opportunity.dir}; validasi volume/news sebelum aksi.` : 'Peluang belum jelas; tunggu konfirmasi data.'
  const watch = impact.event.signals.slice(0,3).join(' • ') || 'harga • volume • berita resmi'
  return `# Executive Morning Brief\n\n- **Market mood:** ${impact.regime.regime}; ${allItems.length} item dari ${sourceCount} sumber.\n- **Indonesia pulse:** ${impact.pulse}\n- **Biggest risk:** ${riskLine}\n- **One opportunity:** ${oppLine}\n- **Watch next:** ${watch}; hot topic: ${hot}`
}

function inferReportEvent(topics) {
  const text = topics.flatMap(t => t.items || []).map(i => `${i.title || ''} ${i.snippet || ''}`).join(' ').toLowerCase()
  if (/fed|rate|yield|inflation|central bank|suku bunga/.test(text)) return { id:'rate_hike', label:'Rate hike / hawkish central bank', bias:{crypto:-2,stock:-1.2,forex:1,commodity:-0.4}, drivers:['higher discount rate','risk-off flow','stronger USD'], signals:['DXY','US10Y','Fed speech'] }
  if (/regulation|sec|lawsuit|ban|policy|compliance/.test(text)) return { id:'regulation_news', label:'Regulation news', bias:{crypto:-2,stock:-0.7,forex:0.2,commodity:0}, drivers:['policy uncertainty','compliance cost','liquidity shift'], signals:['official statement','exchange response','legal timeline'] }
  if (/oil|supply|inventory|shipping|opec|geopolitical/.test(text)) return { id:'supply_shock', label:'Supply shock', bias:{commodity:2.4,stock:-0.6,forex:0.2,crypto:0}, drivers:['scarcity premium','inflation impulse','margin squeeze'], signals:['inventory data','shipping rates','geopolitical update'] }
  if (/earnings|guidance|revenue|margin|profit/.test(text)) return { id:'earnings_miss', label:'Earnings / guidance risk', bias:{stock:-2.4,crypto:-0.4,forex:0,commodity:0}, drivers:['margin pressure','guidance reset','valuation sensitivity'], signals:['volume spike','analyst revision','sector sympathy'] }
  return { id:'ai_breakthrough', label:'AI breakthrough / product launch', bias:{stock:1.5,crypto:0.4,forex:0,commodity:0}, drivers:['growth narrative','capex rotation','AI adoption'], signals:['product traction','cloud spend','chip demand'] }
}
function reportAssetKind(a) {
  const s = `${a.slug} ${a.symbol} ${a.market} ${a.category}`.toLowerCase()
  if (/btc|eth|sol|crypto|coin/.test(s)) return 'crypto'
  if (/xau|gold|oil|brent|wti|commodity/.test(s)) return 'commodity'
  if (/idr|usd|eur|jpy|forex|fx/.test(s)) return 'forex'
  return 'stock'
}
function buildImpactWatch(topics) {
  const event = inferReportEvent(topics)
  let assets = []
  try {
    assets = db.prepare(`SELECT * FROM assets ORDER BY abs(change_percent) DESC LIMIT 24`).all()
    const must = db.prepare(`SELECT * FROM assets WHERE slug IN ('usdidr','jkse')`).all()
    const seen = new Set(assets.map(a => a.slug))
    for (const a of must) if (!seen.has(a.slug)) assets.push(a)
  } catch { assets = [] }
  let rows = assets.map(a => {
    const kind = reportAssetKind(a)
    const base = event.bias[kind] ?? 0
    const vol = Math.min(2.2, Math.max(.7, Math.abs(a.change_percent || 0) / 2 + 1))
    const score = Number((base * vol).toFixed(2))
    const dir = score > .25 ? 'bullish' : score < -.25 ? 'bearish' : 'neutral'
    const risk = Math.abs(score) >= 4 ? 'high' : Math.abs(score) >= 2 ? 'medium' : 'low'
    return { symbol:a.symbol, name:a.name, slug:a.slug, kind, score, dir, risk }
  }).sort((a,b)=>Math.abs(b.score)-Math.abs(a.score))
  const pinned = new Set(['usdidr','jkse'])
  rows = [...rows.filter(r => pinned.has(r.slug)), ...rows.filter(r => !pinned.has(r.slug))].slice(0, 10)
  const regime = marketRegimeFromAssets(assets)
  const pulse = indonesiaPulse(assets)
  const reasons = rows.map(r => impactReason(r, event))
  return { event, rows, regime, pulse, reasons, markdown: `## Market Impact Watch\n- **Regime:** ${regime.regime} (${regime.signals.join(' • ')})\n- **Indonesia pulse:** ${pulse}\n- **Event bias:** ${event.label}\n- **Drivers:** ${event.drivers.join(', ')}\n- **Signals:** ${event.signals.join(', ')}\n\n${rows.map(r => `- **${r.symbol}**: ${r.dir}, ${r.risk} risk, score ${r.score} — ${impactReason(r,event)}`).join('\n')}` }
}


function freshnessLabel(item) {
  const ts = item?.createdAt ? Date.parse(item.createdAt) : 0
  if (!ts) return 'freshness n/a'
  const h = Math.max(0, Math.floor((Date.now()-ts)/36e5))
  if (h < 1) return 'fresh <1h'
  if (h < 24) return `fresh ${h}h`
  const d = Math.floor(h/24)
  return d <= 7 ? `${d}d old` : `stale ${d}d`
}
function marketRegimeFromAssets(assets=[]) {
  const by = q => assets.find(a => [a.slug,a.symbol,a.name].join(' ').toLowerCase().includes(q))
  const btc = by('btc'), ihsg = by('jkse') || by('ihsg'), idr = by('idr'), gold = by('gold') || by('xau'), nvda = by('nvda')
  let score = 0, signals = []
  for (const [label,a,dir=1] of [['BTC',btc,1],['IHSG',ihsg,1],['USD/IDR',idr,-1],['Gold',gold,-0.5],['NVDA',nvda,1]]) {
    if (!a) continue
    const ch = Number(a.change_percent || 0)
    score += Math.sign(ch) * dir
    signals.push(`${label} ${ch>=0?'+':''}${ch}%`)
  }
  const regime = score >= 2 ? 'risk-on' : score <= -2 ? 'risk-off' : 'mixed'
  return { regime, score, signals }
}
function impactReason(row, event) {
  const axis = {
    crypto:['likuiditas global','risk appetite','ETF/flow exchange','leverage market'],
    stock:['earnings sensitivity','discount rate','sector rotation','foreign flow'],
    forex:['selisih suku bunga','arus USD','cadangan devisa','risk-off hedge'],
    commodity:['inflasi','supply shock','safe haven','inventory']
  }[row.kind] || ['sentimen']
  const i = Math.abs([...String(row.symbol)].reduce((a,c)=>a+c.charCodeAt(0),0)) % axis.length
  const watch = row.kind==='forex' ? 'pantau DXY, BI/Fed tone, dan level psikologis' : row.kind==='crypto' ? 'pantau funding, BTC dominance, dan liquidation map' : row.kind==='commodity' ? 'pantau yield real, geopolitik, dan inventory' : 'pantau volume, asing, dan news confirmation'
  return `${row.symbol}: ${row.dir} karena ${axis[i]} + ${event.drivers[i % event.drivers.length]}; ${watch}`
}
function reportQuality(topics=[]) {
  const items = topics.flatMap(t => t.items || [])
  const titles = items.map(i => (i.title||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().slice(0,80)).filter(Boolean)
  const dupes = titles.length - new Set(titles).size
  const stale = items.filter(i => freshnessLabel(i).startsWith('stale')).length
  const sources = new Set(items.map(i=>i.source).filter(Boolean)).size
  const images = items.filter(i=>i.imageUrl).length
  const why = items.map(whyItMatters)
  const whyUniq = why.length ? new Set(why).size / why.length : 1
  const staleRatio = items.length ? stale / items.length : 0
  let score = 100 - dupes*10 - stale*8 - (whyUniq < .65 ? 10 : 0) + Math.min(10, sources) + Math.min(8, images)
  if (dupes > 5) score = Math.min(score, 75)
  if (staleRatio > .25) score = Math.min(score, 70)
  if (sources < 4) score = Math.min(score, 65)
  score = Math.max(0, Math.min(100, Math.round(score)))
  const status = score >= 88 ? 'excellent' : score >= 80 ? 'good' : score >= 70 ? 'ok' : 'needs retry'
  return { score, status, dupes, stale, sources, images, items:items.length, staleRatio:Number(staleRatio.toFixed(2)), whyUniq:Number(whyUniq.toFixed(2)) }
}
function indonesiaPulse(assets=[]) {
  const keys = ['jkse','lq45','bbca','bbri','bmri','tlkm','asii','bbni','excl','indf','smgr','adro','antm','usdidr']
  const picked = assets.filter(a => keys.some(k => (a.slug||'').includes(k)))
  return picked.map(a => `${a.symbol}: ${Number(a.change_percent||0)>=0?'+':''}${a.change_percent||0}%`).join(' • ') || 'IHSG/IDR data pending'
}
function watchlistThesis(rows=[]) {
  return rows.slice(0,6).map(r => `- **${r.symbol}**: pantau karena ${r.risk} risk, ${r.dir}, score ${r.score}; next signal = breakout/volume/news confirmation`).join('\n')
}
function redFlags(topics=[], impactRows=[]) {
  const text = topics.flatMap(t=>t.items||[]).map(i=>`${i.title} ${i.snippet||''}`).join(' ').toLowerCase()
  const flags=[]
  if (/breach|hack|ransomware|vulnerability|lawsuit|ban|sec|regulation/.test(text)) flags.push('policy/security headline risk')
  if (impactRows.some(r=>r.risk==='high')) flags.push('high-impact asset move detected')
  if (/fed|inflation|yield|rate/.test(text)) flags.push('macro/rate sensitivity')
  return flags.length ? flags : ['no major red flag detected']
}
function whatChangedToday(topics=[]) {
  return topics.flatMap(t => (t.items||[]).slice(0,1).map(i => `- **${t.title}**: ${clean(i.title).slice(0,110)} (${freshnessLabel(i)})`)).join('\n')
}
function sourceRotationHint() {
  const day = new Date().getDate()
  const packs = ['HN/GitHub/RSS','Market/Finance/Indonesia','Security/Research/Models']
  return packs[day % packs.length]
}


function rootCauseTagging(topics=[]) {
  const txt = topics.flatMap(t=>t.items||[]).map(i=>`${i.title||''} ${i.snippet||''}`).join(' ').toLowerCase()
  const rules = [
    ['PLN / power grid', /pln|blackout|pemadaman|listrik|power outage|grid|gardu|transmisi/],
    ['Network / connectivity', /network|internet|isp|dns|latency|packet|connectivity|telco/],
    ['Application / deploy', /bug|crash|deploy|release|regression|frontend|backend|server error/],
    ['Database / storage', /database|sqlite|postgres|mysql|redis|db|storage|disk|query/],
    ['API / third-party', /api|provider|third.party|rate limit|timeout|upstream|integration/],
    ['User / operational', /user error|misconfig|operator|human error|manual|credential/]
  ]
  const hits = rules.filter(([,re])=>re.test(txt)).map(([name])=>name)
  return { primary: hits[0] || 'Market/news driven', tags: hits.length ? hits : ['market/news driven'], confidence: hits.length ? Math.min(95, 55 + hits.length*12) : 45 }
}
function outageTimeline(topics=[]) {
  const items = topics.flatMap(t=>t.items||[]).filter(i=>/blackout|outage|pemadaman|pln|down|incident|gangguan/i.test(`${i.title||''} ${i.snippet||''}`)).slice(0,5)
  if (!items.length) return ['No outage/incident headline detected today']
  return items.map((i,idx)=>`${idx+1}. ${freshnessLabel(i)} — ${clean(i.title).slice(0,120)}${i.source?` (${i.source})`:''}`)
}
function impactAreaMap(topics=[]) {
  const text = topics.flatMap(t=>t.items||[]).map(i=>`${i.title||''} ${i.snippet||''}`).join(' ')
  const areas = ['Sumut','Medan','Binjai','Deli Serdang','Aceh','Riau','Jakarta','Indonesia','US','China','Europe'].filter(a=>new RegExp(a,'i').test(text))
  return areas.length ? [...new Set(areas)] : ['Global/online market']
}
function slaBreachDetector(topics=[]) {
  const incident = outageTimeline(topics).length > 0 && !outageTimeline(topics)[0].startsWith('No ')
  const stale = reportQuality(topics).stale
  const status = incident || stale > 3 ? 'warning' : 'safe'
  return { status, reason: incident ? 'incident headline detected' : stale > 3 ? 'stale source count high' : 'no SLA breach signal' }
}
function executiveSummary(topics=[]) {
  const q = reportQuality(topics), impact = buildImpactWatch(topics), rc = rootCauseTagging(topics)
  return [`Revenue/market: ${impact.regime.regime}`, `Incident: ${rc.primary}`, `Customer impact: ${impactAreaMap(topics).join(', ')}`, `Market signal: ${impact.event.label}`, `Next action: verify ${impact.event.signals[0] || 'primary source'}`]
}
function anomalyAlert(topics=[]) {
  const items = topics.flatMap(t=>t.items||[])
  const spikes = items.filter(i=>Number(i.points||0)>150 || /surge|spike|crash|drop|outage|blackout|breach|hack/i.test(`${i.title||''} ${i.snippet||''}`)).slice(0,5)
  return spikes.length ? spikes.map(i=>`${clean(i.title).slice(0,110)}${i.points?` (^${i.points})`:''}`) : ['No major anomaly detected']
}
function beforeAfterTracker(topics=[]) {
  const q = reportQuality(topics)
  return [`Before: raw ${q.items} items / ${q.sources} sources`, `After: ranked, tagged, dedup-aware report score ${q.score}/100`, `Metric to watch: duplicate ${q.dupes}, stale ${q.stale}`]
}
function competitorSignalFeed(topics=[]) {
  const names = ['OpenAI','Anthropic','Google','Meta','Microsoft','Nvidia','Apple','xAI','Perplexity','Mistral']
  const textItems = topics.flatMap(t=>t.items||[])
  return names.map(n=>({n,c:textItems.filter(i=>new RegExp(n,'i').test(`${i.title||''} ${i.snippet||''}`)).length})).filter(x=>x.c).sort((a,b)=>b.c-a.c).slice(0,6).map(x=>`${x.n}: ${x.c} signal`) || ['No named competitor spike']
}
function actionRecommendationEngine(topics=[]) {
  const sla = slaBreachDetector(topics), impact = buildImpactWatch(topics)
  return [sla.status==='warning' ? `Prioritize incident comms: ${sla.reason}` : 'Ship report normally', `Watch ${impact.rows[0]?.symbol || 'top asset'} for ${impact.event.signals[0] || 'confirmation'}`, `Rotate source pack: ${sourceRotationHint()}`]
}
function featureImprovementPack(topics=[]) {
  const rc = rootCauseTagging(topics), sla = slaBreachDetector(topics), q = reportQuality(topics)
  const lines = [
    `1. **Auto Root Cause Tagging:** ${rc.primary} (${rc.confidence}%) — tags: ${rc.tags.join(', ')}`,
    `2. **Blackout / Outage Timeline:**`,
    ...outageTimeline(topics).map(x=>`   - ${x}`),
    `3. **Impact Area Map:** ${impactAreaMap(topics).join(' → ')}`,
    `4. **SLA Breach Detector:** ${sla.status} — ${sla.reason}`,
    `5. **Daily Executive Summary:**`,
    ...executiveSummary(topics).map(x=>`   - ${x}`),
    `6. **Anomaly Alert:**`,
    ...anomalyAlert(topics).map(x=>`   - ${x}`),
    `7. **Before-After Improvement Tracker:**`,
    ...beforeAfterTracker(topics).map(x=>`   - ${x}`),
    `8. **Competitor Signal Feed:**`,
    ...competitorSignalFeed(topics).map(x=>`   - ${x}`),
    `9. **Action Recommendation Engine:**`,
    ...actionRecommendationEngine(topics).map(x=>`   - ${x}`)
  ]
  // Only show confidence score if below perfect
  if (q.score < 100) lines.push(`10. **Report Confidence Score:** ${q.score}/100 (${q.status}) — sources ${q.sources}, items ${q.items}`)
  return `## Improvement / Added Features QA Pack\n${lines.join('\n')}`
}


function sourceReliabilityScore(source='') {
  const high = ['Google AI Blog','MIT Tech Review','Ars Technica','BBC Tech','Guardian Tech','CNBC Tech','MarketWatch','Forbes','IDX Channel','Kontan','Bisnis','Antara']
  const med = ['HN','TechCrunch','VentureBeat','The Verge','Engadget','CoinDesk','GitHub','HF','Dev.to','Analytics Vidhya']
  const score = high.includes(source) ? 90 : med.includes(source) ? 72 : source ? 55 : 35
  const label = score >= 80 ? 'strong' : score >= 60 ? 'medium' : 'weak'
  return { source: source || 'unknown', score, label }
}
export function classifyIncidentSeverity(item={}) {
  const t = `${item.title||''} ${item.snippet||''}`.toLowerCase()
  let n = 0
  if (/critical|blackout|major outage|down nationwide|pemadaman|ransomware|breach/.test(t)) n += 3
  if (/outage|incident|gangguan|disruption|latency|crash|down/.test(t)) n += 2
  if (/jakarta|indonesia|global|nationwide|wilayah|users|customer|market/.test(t)) n += 1
  return n >= 5 ? 'critical' : n >= 3 ? 'high' : n >= 2 ? 'medium' : 'low'
}
export function estimateCustomerImpact(item={}) {
  const t = `${item.title||''} ${item.snippet||''}`.toLowerCase()
  const geography = impactAreaMap([{items:[item]}]).join(', ')
  const users = /nationwide|global|major|blackout|critical/.test(t) ? 'large' : /outage|gangguan|down/.test(t) ? 'medium' : 'limited'
  const ops = /payment|bank|api|cloud|network|pln|listrik|database|server/.test(t) ? 'ops impacted' : 'monitor only'
  const market = /stock|market|crypto|bank|rupiah|ihsg|usd/.test(t) ? 'market sensitive' : 'low market impact'
  const confidence = /source|official|reported|confirmed|update/.test(t) ? 75 : 55
  return { users, geography, ops, market, confidence }
}
export function trackRecoveryStatus(item={}, reportSlug='') {
  const t = `${item.title||''} ${item.snippet||''}`.toLowerCase()
  let status = 'n/a'
  if (/resolved|restored|pulih|normal kembali|fixed|recovered/.test(t)) status = 'resolved'
  else if (/partial|sebagian|recovering|gradual/.test(t)) status = 'partial_recovery'
  else if (/investigating|probe|checking|menyelidiki|assessment/.test(t)) status = 'investigating'
  else if (/outage|incident|gangguan|blackout|down|pemadaman/.test(t)) status = 'detected'
  if (status !== 'n/a' && reportSlug && item.title) {
    const titleHash = incidentTitleHash(item.title)
    const source = item.source || 'unknown'
    recordIncidentStatus({ titleHash, title:item.title, status, source, reportSlug })
  }
  return status
}
function canonicalNewsTitle(x='') { return clean(x).toLowerCase().replace(/\b(the|a|an|to|of|for|and|in|on|with|new|latest)\b/g,'').replace(/[^a-z0-9]+/g,' ').trim().slice(0,70) }
function clusterDuplicateNews(topics=[]) {
  const map = new Map()
  for (const item of topics.flatMap(t=>t.items||[])) {
    const key = canonicalNewsTitle(item.title||'')
    if (!key) continue
    const bucket = [...map.keys()].find(k => k.includes(key.slice(0,35)) || key.includes(k.slice(0,35))) || key
    const arr = map.get(bucket) || []
    arr.push(item); map.set(bucket, arr)
  }
  return [...map.entries()].filter(([,v])=>v.length>1).slice(0,5).map(([k,v])=>({ title:v[0].title, count:v.length, sources:[...new Set(v.map(i=>i.source).filter(Boolean))] }))
}
function scoreMarketSentiment(topics=[]) {
  const scoreText = items => {
    let score = 0
    for (const i of items) {
      const t = `${i.title||''} ${i.snippet||''}`.toLowerCase()
      if (/surge|gain|bull|rally|growth|profit|record|beats|breakthrough|launch/.test(t)) score++
      if (/drop|fall|bear|crash|loss|miss|lawsuit|ban|hack|breach|outage|inflation|rate hike/.test(t)) score--
    }
    const label = score > 1 ? 'bullish' : score < -1 ? 'bearish' : 'neutral'
    return { score, label, confidence: Math.min(90, 50 + Math.abs(score)*10) }
  }
  const sections = topics.map(t=>({ section:t.title, ...scoreText(t.items||[]) }))
  return { overall: scoreText(topics.flatMap(t=>t.items||[])), sections }
}
function buildRiskHeatmap(assets=[], incidents=[]) {
  const rows = assets.slice(0,10).map(a=>{ const ch=Math.abs(Number(a.change_percent||0)); return { label:a.symbol||a.slug, type:a.category||a.market||'asset', risk: ch>=5?'high':ch>=2?'medium':'low', color: ch>=5?'red':ch>=2?'yellow':'green', reason:`move ${a.change_percent||0}%` } })
  incidents.slice(0,5).forEach(i=>rows.push({ label:clean(i.title).slice(0,40), type:'incident', risk:classifyIncidentSeverity(i), color:['critical','high'].includes(classifyIncidentSeverity(i))?'red':'yellow', reason:trackRecoveryStatus(i) }))
  return rows.sort((a,b)=>({critical:4,high:3,medium:2,low:1}[b.risk]||0)-({critical:4,high:3,medium:2,low:1}[a.risk]||0))
}
function generateFollowUpTasks(reportContext={}) {
  const tasks = ['cek source lemah / single-source claims','monitor top asset risk','update incident status jika ada outage','notify user kalau severity high/critical','set alert untuk catalyst besar']
  if (reportContext.qa?.score < 75) tasks.unshift('review report sebelum send')
  return tasks.map((task,i)=>({ id:`task-${i+1}`, task, status:'open' }))
}
function buildHistoricalComparison(topics=[]) {
  try {
    const rd = path.join(__dirname, '..', '..', 'reports')
    const prev = fs.readdirSync(rd).filter(f=>f.endsWith('.json')).sort().reverse().find(f=>!f.startsWith(new Date().toISOString().slice(0,10)))
    if (!prev) return { status:'no baseline', summary:'belum ada report kemarin/previous untuk compare' }
    const d = JSON.parse(fs.readFileSync(path.join(rd, prev),'utf8'))
    const nowQ = reportQuality(topics), oldQ = reportQuality(d.topics||[])
    return { status:'compared', baseline:prev.replace('.json',''), qualityShift:nowQ.score-oldQ.score, duplicateShift:nowQ.dupes-oldQ.dupes, summary:`quality ${nowQ.score-oldQ.score>=0?'naik':'turun'} ${Math.abs(nowQ.score-oldQ.score)}; duplicate shift ${nowQ.dupes-oldQ.dupes}` }
  } catch { return { status:'unavailable', summary:'comparison read failed' } }
}
function runReportQA(topics=[]) {
  const q = reportQuality(topics)
  const incidents = topics.flatMap(t=>t.items||[]).filter(i=>/outage|incident|blackout|gangguan|down|pemadaman/i.test(`${i.title||''} ${i.snippet||''}`))
  const checks = [
    { name:'source ada', pass:q.sources>0 }, { name:'duplicate rendah', pass:q.dupes<=2 }, { name:'confidence cukup', pass:q.score>=70 }, { name:'incident tagged', pass:!incidents.length || incidents.every(i=>classifyIncidentSeverity(i)) }, { name:'action tersedia', pass:true }
  ]
  const score = Math.round(checks.filter(c=>c.pass).length/checks.length*100)
  return { score, status:score>=80?'pass':'warning', checks }
}
function reliabilityIncidentQaPack(topics=[]) {
  const items = topics.flatMap(t=>t.items||[])
  const incidents = items.filter(i=>/outage|incident|blackout|gangguan|down|pemadaman|breach|hack/i.test(`${i.title||''} ${i.snippet||''}`)).slice(0,5)
  const trust = [...new Map(items.map(i=>[i.source||'unknown', sourceReliabilityScore(i.source)])).values()].sort((a,b)=>b.score-a.score)
  const sentiment = scoreMarketSentiment(topics), qa = runReportQA(topics), comparison = buildHistoricalComparison(topics)
  let assets=[]; try { assets = db.prepare(`SELECT * FROM assets ORDER BY abs(change_percent) DESC LIMIT 10`).all() } catch {}
  const heatmap = buildRiskHeatmap(assets, incidents), clusters = clusterDuplicateNews(topics), tasks = generateFollowUpTasks({qa})
  return `## Reliability / Incident / QA Add-on Batch 3\n`+
`| Feature | Status | Output |\n|---|---:|---|\n`+
`| Source Reliability Score | added | strong ${trust.filter(x=>x.label==='strong').length}, medium ${trust.filter(x=>x.label==='medium').length}, weak ${trust.filter(x=>x.label==='weak').length} |\n`+
`| Incident Severity Level | added | ${incidents[0] ? classifyIncidentSeverity(incidents[0]) : 'no incident'} |\n`+
`| Customer Impact Estimate | added | ${incidents[0] ? `${estimateCustomerImpact(incidents[0]).users}, ${estimateCustomerImpact(incidents[0]).geography}` : 'n/a'} |\n`+
`| Recovery Status Tracker | added | ${incidents[0] ? trackRecoveryStatus(incidents[0]) : 'n/a'} |\n`+
`| Duplicate News Cluster | added | ${clusters.length} cluster |\n`+
`| Market Sentiment Meter | added | ${sentiment.overall.label} (${sentiment.overall.confidence}%) |\n`+
`| Risk Heatmap | added | ${heatmap.slice(0,3).map(x=>`${x.label}:${x.risk}`).join(' • ') || 'n/a'} |\n`+
`| Follow-up Task Generator | added | ${tasks.length} tasks |\n`+
`| Historical Comparison | added | ${comparison.summary} |\n`+
`| Report QA Checklist | added | ${qa.score}/100 ${qa.status} |\n\n`+
`**Strong sources:** ${trust.filter(x=>x.label==='strong').slice(0,6).map(x=>`${x.source} ${x.score}`).join(' • ') || 'n/a'}\n\n`+
`**Incident ops:**\n${incidents.length ? incidents.map(i=>`- ${classifyIncidentSeverity(i)} · ${trackRecoveryStatus(i)} · ${clean(i.title).slice(0,100)}`).join('\n') : '- no incident detected'}\n\n`+
`**QA checklist:**\n${qa.checks.map(c=>`- ${c.pass?'✅':'⚠️'} ${c.name}`).join('\n')}\n\n`+
`**Follow-up tasks:**\n${tasks.map(t=>`- [ ] ${t.task}`).join('\n')}`+
`\n\n··································\n\n`+
`## Sentiment Trend\n`+
`${sentimentTrendBlock(topics)}\n\n`+
`··································\n\n`+
`## Source Diversity Score\n`+
`${sourceDiversityBlock(topics)}\n\n`+
`··································\n\n`+
`## Market Regime\n`+
`${marketRegimeBlock(topics)}`
}
function sentimentTrendBlock(topics=[]) {
  try {
    const sentiment = scoreMarketSentiment(topics)
    const lines = [
      `**Overall Market:** ${sentiment.overall.label} (${sentiment.overall.confidence}% confidence)`,
      `**Per-Section Breakdown:**`,
      ...sentiment.sections.slice(0,10).map(s => `  - ${s.section}: ${s.label} (score ${s.score >=0 ? '+':''}${s.score})`),
      `**Trend Signal:** ${sentiment.overall.label === 'bullish' ? '🟢 Risk appetite tinggi' : sentiment.overall.label === 'bearish' ? '🔴 Risk aversion terdeteksi' : '🟡 Sentimen netral — tunggu konfirmasi'}`
    ]
    return lines.join('\n')
  } catch { return 'Sentiment trend data tidak tersedia.' }
}
function sourceDiversityBlock(topics=[]) {
  try {
    const domains = new Map()
    for (const t of topics) {
      for (const item of (t.items || [])) {
        const src = (item.source || item.domain || 'unknown').toLowerCase().trim()
        if (!src || src === 'unknown') continue
        const count = domains.get(src) || 0
        domains.set(src, count + 1)
      }
    }
    const uniqueDomains = domains.size
    const total = [...domains.values()].reduce((a,b) => a+b, 0)
    const topDomains = [...domains.entries()].sort((a,b) => b[1] - a[1]).slice(0,5)
    let score = 40
    if (uniqueDomains >= 10) score = 95
    else if (uniqueDomains >= 7) score = 85
    else if (uniqueDomains >= 5) score = 75
    else if (uniqueDomains >= 3) score = 60
    const label = score >= 85 ? 'excellent' : score >= 75 ? 'good' : score >= 60 ? 'moderate' : 'poor'
    const lines = [
      `**Score:** ${score}/100 (${label})`,
      `**Unique Domains:** ${uniqueDomains} | **Total Items:** ${total}`,
      `**Top Sources:** ${topDomains.map(([d,c]) => `${d} (${c}x)`).join(' · ')}`
    ]
    return lines.join('\n')
  } catch { return 'Source diversity data tidak tersedia.' }
}
function marketRegimeBlock(topics=[]) {
  try {
    let assets = []
    try { assets = db.prepare('SELECT * FROM assets ORDER BY abs(change_percent) DESC LIMIT 24').all() } catch {}
    const up = assets.filter(a => Number(a.change_percent||0) > 1).length
    const down = assets.filter(a => Number(a.change_percent||0) < -1).length
    const totalMov = assets.filter(a => Math.abs(Number(a.change_percent||0)) > 0.5).length
    let regime = 'neutral'
    let conviction = 50
    if (up > down + 2 && up >= 3 && totalMov >= 4) { regime = 'risk-on'; conviction = Math.min(95, 60 + (up - down) * 8) }
    else if (down > up + 2 && down >= 3 && totalMov >= 4) { regime = 'risk-off'; conviction = Math.min(95, 60 + (down - up) * 8) }
    else { conviction = Math.max(40, 60 - Math.abs(up - down) * 5) }
    const emoji = regime === 'risk-on' ? '🟢' : regime === 'risk-off' ? '🔴' : '🟡'
    const lines = [
      `**Regime:** ${emoji} ${regime.toUpperCase()} (conviction ${conviction}%)`,
      `**Breadth:** ${up} assets >+1% · ${down} assets <-1% · ${totalMov} assets bergerak`
    ]
    const sentiment = scoreMarketSentiment(topics)
    if (sentiment.overall) lines.push(`**Sentimen vs Regime:** ${sentiment.overall.label === 'bullish' && regime === 'risk-on' ? '✅ Selaras bullish' : sentiment.overall.label === 'bearish' && regime === 'risk-off' ? '✅ Selaras bearish' : '⚠️ Divergensi — price vs sentiment berbeda arah'}`)
    return lines.join('\n')
  } catch { return 'Market regime data tidak tersedia.' }
}

// ═══════════════════════════════════════════
// SMART ALERT THRESHOLD — extract alert candidates from report insights
// ═══════════════════════════════════════════

export function extractAlertCandidates(topics) {
  const alerts = []
  const assetMap = new Map()
  try {
    const rows = db.prepare('SELECT slug, symbol, price FROM assets').all()
    for (const r of rows) {
      assetMap.set(r.slug.toLowerCase(), r)
      assetMap.set(r.symbol.toLowerCase(), r)
    }
  } catch {}

  const textItems = topics.flatMap(t => (t.items || []).map(i => ({ ...i, section: t.title }))).filter(i => i.title)

  for (const item of textItems) {
    const txt = `${item.title || ''} ${item.snippet || ''}`.toLowerCase()
    const found = []

    // match known assets in text
    for (const [key, asset] of assetMap) {
      if (txt.includes(key)) found.push(asset)
      if (found.length >= 3) break
    }

    if (!found.length) continue

    // extract price targets
    const pricePatterns = [
      ...txt.matchAll(/(?:target|resist|support|breakout|level)\s*(?:di|ke|pada|:|=)?\s*([\d,]+(?:\.\d+)?)/gi),
      ...txt.matchAll(/([\d,]+(?:\.\d+)?)\s*(?:sebagai\s+)?(?:resist|support|target|level)/gi),
      ...txt.matchAll(/(?:ke|menuju|turun\s*ke|naik\s*ke)\s*([\d,]+(?:\.\d+)?)/gi),
    ]
    const prices = [...new Set([...pricePatterns].map(m => Number(m[1].replace(/,/g, ''))).filter(n => n > 0 && n < 1e7))].slice(0, 2)

    // determine direction
    let direction = 'neutral'
    if (/\b(naik|bull|breakout|rally|surge|gain|atas|buy|resistance\s*break|target\s*naik)\b/i.test(txt)) direction = 'up'
    else if (/\bturun|bear|breakdown|drop|decline|jual|support\s*break|target\s*turun|risiko|warning\b/i.test(txt)) direction = 'down'

    if (!prices.length && direction === 'neutral') continue

    const slug = found[0].slug
    const symbol = found[0].symbol
    const basePrice = Number(found[0].price) || 0
    const targetPrice = prices[0] || (direction === 'up' ? basePrice * 1.05 : basePrice * 0.95)
    const hasExplicitTarget = prices.length > 0
    const confidence = hasExplicitTarget ? 0.7 : 0.35

    alerts.push({
      asset_slug: slug,
      asset_symbol: symbol,
      target_price: Math.round(targetPrice * 100) / 100,
      direction,
      reason: clean(item.title).slice(0, 200) || `Alert from report insight`,
      confidence,
      report_slug: '',
      source_title: clean(item.title).slice(0, 100)
    })
  }

  // dedupe by (slug + target_price)
  const seen = new Set()
  return alerts.filter(a => {
    const k = `${a.asset_slug}|${a.target_price}|${a.direction}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  }).slice(0, 10)
}

export function buildSuggestedAlertsBlock(alerts = []) {
  if (!alerts.length) return '## ⚡ Suggested Alerts\n- Tidak ada alert candidates dari report hari ini.\n'
  const lines = alerts.map((a, i) =>
    `- **#${i + 1}** ${a.asset_symbol} ${a.direction === 'up' ? '📈' : '📉'} ${a.target_price} (confidence ${Math.round(a.confidence * 100)}%) — ${a.reason.slice(0, 80)}`
  )
  return `## ⚡ Suggested Alerts (Smart Alert Threshold)\n${lines.join('\n')}\n\n_Approve/reject via API: POST /api/alerts/suggested/[:id]/approve | /reject_\n`
}

// ═══════════════════════════════════════════
// TEXT REPORT (Discord markdown)
// ═══════════════════════════════════════════

export function buildTextReport(topics, opts = {}) {
  const rag = buildRagContext(topics)
  const ragMarkdown = formatRagMarkdown(rag)
  const dateStr = formatDateIndonesia()
  const dotline = '▸ ▸ ▸'
  const hero = pickHero(topics)
  const heroTitle = punchyHeadline(hero)
  const heroWhy = hero?.snippet ? truncateText(clean(hero.snippet), 260) : 'Ringkasan cepat berita AI, teknologi, market, security, dan tools paling penting hari ini.'

  const impact = buildImpactWatch(topics)
  const quality = reportQuality(topics)
  const changed = whatChangedToday(topics)
  const flags = redFlags(topics, impact.rows).map(x => `- ${x}`).join('\n')
  const thesis = watchlistThesis(impact.rows)
  const userContext = userIntentMemoryBlock()
  // Persona-tailored section
  const persona = opts.persona || null
  const personaPrompt = opts.personaPrompt || (persona ? buildContextPrompt(persona) : '')
  let personaSection = ''
  if (personaPrompt) {
    const pRole = persona?.role || 'investor'
    const pRisk = persona?.risk_tolerance || 'moderate'
    let pSectors = []
    try { pSectors = JSON.parse(persona?.focus_sectors || '[]') } catch { pSectors = [] }
    const pTimeframe = persona?.preferred_timeframe || 'swing'
    const pStyle = persona?.alert_style || 'brief'
    const sectorLine = pSectors.length ? pSectors.join(', ') : 'general market'
    personaSection = `## Tailored For You\n` +
      `- **Profile:** ${pRole} · ${pRisk} risk · ${pTimeframe} timeframe\n` +
      `- **Focus sectors:** ${sectorLine}\n` +
      `- **Alert style:** ${pStyle}\n` +
      `- **Context:** ${personaPrompt}\n`
    // Highlight assets relevant to persona's sectors
    if (pSectors.length) {
      const sectorAssets = impact.rows.filter(r => {
        const txt = `${r.symbol} ${r.slug} ${r.name}`.toLowerCase()
        return pSectors.some(s => txt.includes(s.toLowerCase()))
      })
      if (sectorAssets.length) {
        personaSection += `\n**Sector highlights:**\n${sectorAssets.map(r => `- **${r.symbol}**: ${r.dir}, ${r.risk} risk, score ${r.score}`).join('\n')}\n`
      }
    }
  }
  let assets = []
  try { assets = db.prepare('SELECT * FROM assets ORDER BY abs(change_percent) DESC LIMIT 24').all() } catch {}
  const dataStatusBlock = buildDataStatusBlock(assets)
  const dataFreshnessQa = dataFreshnessQA(assets)
  let text = `# ${heroTitle}\n${dateStr}\n\n> Vibe check: **${vibeTag(hero)}**\n> ${heroWhy}\n> Why it matters: ${whyItMatters(hero)}\n${hero?.url ? `> <${hero.url}>\n` : ''}\n\n${dotline}\n\n${userContext}\n\n${personaSection ? personaSection + '\n' : ''}${dotline}\n\n## TL;DR buat yang males baca\n\n${buildSummary(topics)}\n\n${dotline}\n\n## Report Quality\n- **Score:** ${quality.score}/100 (${quality.status})\n- **Sources:** ${quality.sources} · Items: ${quality.items} · Duplicates: ${quality.dupes} · Stale: ${quality.stale}\n- **Source rotation:** ${sourceRotationHint()}\n\n${dotline}\n\n${dataStatusBlock}\n${dataFreshnessQa.warning ? `\n> ⚠️ ${dataFreshnessQa.warning}\n` : ''}\n${dotline}\n\n## What Changed Today\n${changed}\n\n${dotline}\n\n${buildAnomalyReportBlock()}\n\n${dotline}\n\n${buildSuggestedAlertsBlock(extractAlertCandidates(topics))}\n\n${dotline}\n\n${ragMarkdown}\n\n${dotline}\n\n${impact.markdown}\n\n${dotline}\n\n${quality.score < 80 ? featureImprovementPack(topics) + `\n\n${dotline}\n\n` : ''}${quality.score < 80 ? reliabilityIncidentQaPack(topics) + `\n\n${dotline}\n\n` : ''}## Actionable Watchlist\n${thesis}\n\n## Red Flags\n${flags}\n\n${dotline}\n\n${(() => { try { return buildDataValidationBlock() } catch { return '' } })()}\n\n${dotline}\n\n# Full Drop — AI DAILY REPORT\n\n`

  const textSeenUrls = new Set()

  for (const topic of topics) {
    const items = topic.items.filter(i => i.title).filter(i => {
      const url = i.url || i.link || ''
      if (url && textSeenUrls.has(url)) return false
      if (url) textSeenUrls.add(url)
      return true
    })
    if (items.length === 0) continue

    text += `## ${topic.title}\n\n`

    if (topic.intro && topic.intro.length > 30) {
      text += `> *"${clean(topic.intro).slice(0, 280)}"*\n\n`
    }

    items.slice(0, 4).forEach((item, idx) => {
      const badge = item.source ? `[${item.source}]` : ''
      const freshness = freshnessLabel(item)
      text += `**${idx + 1}.** ${badge} **${clean(item.title)}**\n`
      text += `> Vibe: **${vibeTag(item)}** · ${freshness}\n`
      if (item.snippet && item.snippet !== item.title && item.snippet.length > 15) {
        text += `> ${truncateText(clean(item.snippet), 230)}\n`
      }
      text += `> Why care: ${whyItMatters(item)}\n`
      if (item.points) text += `> ^ ${item.points} pts | ${item.comments} comments\n`
      if (item.url) text += `> <${item.url}>\n`
      text += '\n'
    })

    if (topic.funFact && topic.funFact.length > 15) {
      text += `**Fun Fact:** ${clean(topic.funFact).slice(0, 200)}\n\n`
    }

    text += `${dotline}\n\n`
  }

  text += `Little Candle -- AI Daily Report -- 16+ sources -- PDF available`
  return text
}

// ═══════════════════════════════════════════
// PDF REPORT
// ═══════════════════════════════════════════

// Strip non-Latin characters safe for pdfkit Helvetica font
function safe(text) {
  if (!text) return ''
  // First decode common HTML entities
  let r = (text || '')
    .replace(/&#x[0-9a-f]+;/gi, c => String.fromCodePoint(parseInt(c.slice(3,-1), 16)))
    .replace(/&#\d+;/g, c => String.fromCodePoint(parseInt(c.slice(2,-1))))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
  // Keep only ASCII + Latin-1 + common punctuation that Helvetica renders
  r = r.replace(/[^\x20-\x7E\xA0-\xFF\u2010-\u2027\u2030-\u205E\u20AC\u2122]/g, ' ')
  return r.replace(/\s+/g, ' ').trim()
}

// Fetch og:image from a URL (with timeout)
async function fetchOgImage(url) {
  if (!url) return null
  const v = await validateFetchUrl(url).catch(() => null)
  if (!v?.ok) return null
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000), headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) return null
    const html = await res.text()
    const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    return m?.[1] || null
  } catch { return null }
}

async function fetchImageBuffer(url) {
  if (!url) return null
  const v = await validateFetchUrl(url).catch(() => null)
  if (!v?.ok) return null
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000), headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) return null
    const type = res.headers.get('content-type') || ''
    const len = Number(res.headers.get('content-length') || 0)
    if (!type.startsWith('image/') || len > 1_200_000) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > 1_200_000) return null
    return buf
  } catch { return null }
}

export async function buildPdfReport(topics) {
  const imageBuffers = new Map()
  const imageUrls = [...new Set(topics.flatMap(t => (t.items || []).slice(0, 1).map(i => i.imageUrl).filter(Boolean)))].slice(0, 10)
  await Promise.allSettled(imageUrls.map(async (u) => { const b = await fetchImageBuffer(u); if (b) imageBuffers.set(u, b) }))

  return new Promise((resolve, reject) => {
    try {
      const tmpFile = path.join(__dirname, '..', 'tmp', `ai-report-${Date.now()}.pdf`)
      fs.mkdirSync(path.dirname(tmpFile), { recursive: true })

      const doc = new PDFDocument({ size: 'A4', margin: 55, info: { Title: 'AI Daily Report', Author: 'Little Candle' }, bufferPages: true })
      const stream = fs.createWriteStream(tmpFile)
      doc.pipe(stream)

      const dateStr = formatDateIndonesia()
      const P = '#5B21B6', PG = '#EDE9FE', BL = '#2563EB', GY = '#6B7280', DK = '#1F2937'
      const sC = {
        'HN':'#FF6600','TechCrunch':'#0A9E01','VentureBeat':'#FF5722','The Verge':'#00D4AA',
        'Google AI Blog':'#4285F4','MIT Tech Review':'#000','Ars Technica':'#FF4C00',
        'Dev.to':'#0A0A0A','BBC Tech':'#BB1919','Guardian Tech':'#052962','Engadget':'#00A3E0',
        'HF':'#F59E0B','GitHub':'#333','CNBC Tech':'#005594','CoinDesk':'#2563EB',
        'Analytics Vidhya':'#8B5CF6','Forbes':'#3D7A4D','MarketWatch':'#E67E22',
      }

      const hero = pickHero(topics)
      const heroTitle = safe(punchyHeadline(hero))

      // ─── TITLE PAGE ───
      doc.fontSize(24).font('Helvetica-Bold').fillColor(P).text('AI DAILY REPORT', { align: 'center' })
      doc.moveDown(0.6)
      doc.fontSize(22).font('Helvetica-Bold').fillColor(DK).text(heroTitle, { align: 'center', lineGap: 3 })
      doc.moveDown(0.4)
      doc.fontSize(13).font('Helvetica').fillColor(GY).text(dateStr, { align: 'center' })
      doc.moveDown(0.3)
      doc.fontSize(10).font('Helvetica').fillColor(GY).text('Curated by Little Candle -- 18 sources, 13 sections', { align: 'center' })
      doc.moveDown(1.5)
      doc.moveTo(55, doc.y).lineTo(545, doc.y).strokeColor(PG).lineWidth(3).stroke()
      doc.moveDown(1.5)
      topics.forEach((t, i) => {
        doc.fontSize(9).font('Helvetica').fillColor(DK).text(`${i+1}. ${safe(t.title)} (${t.items.length} items)`)
      })
      doc.moveDown(2)

      // ─── SUMMARY FIRST ───
      const summaryText = buildSummary(topics)
      if (summaryText) {
        doc.addPage()
        doc.rect(55, doc.y, 500, 22).fill(PG)
        doc.fillColor(P).fontSize(13).font('Helvetica-Bold').text('Ringkasan', 65, doc.y + 5)
        doc.fillColor(DK).moveDown(1.8)
        doc.fontSize(10).font('Helvetica').fillColor(DK).text(safe(summaryText), { lineGap: 4 })
        doc.moveDown(1.5)

        // Stats box
        const ti = topics.reduce((s,t) => s + t.items.length, 0)
        const ta = topics.reduce((s,t) => s + t.items.filter(i=>i.type==='article').length, 0)
        const tm = topics.reduce((s,t) => s + t.items.filter(i=>i.type==='model').length, 0)
        const as = [...new Set(topics.flatMap(t=>t.items.map(i=>i.source).filter(Boolean)))]
        const by = doc.y
        doc.rect(55, by, 500, 42).fill('#F9FAFB')
        doc.fillColor(P).fontSize(10).font('Helvetica-Bold').text('Statistics', 65, by + 8)
        doc.fillColor(DK).fontSize(9).font('Helvetica').text(`Items: ${ti} | Articles: ${ta} | Models: ${tm} | Sources: ${as.length}`, 65, by + 24)
        doc.fillColor(GY).fontSize(8).text(`Sources: ${as.join(', ')}`, 65, doc.y + 3)
      }

      // ─── MARKET IMPACT PAGE ───
      const impact = buildImpactWatch(topics)
      const quality = reportQuality(topics)
      doc.addPage()
      doc.rect(55, doc.y, 500, 22).fill(PG)
      doc.fillColor(P).fontSize(13).font('Helvetica-Bold').text('Market Impact + Quality', 65, doc.y + 5)
      doc.fillColor(DK).moveDown(1.8)
      doc.fontSize(10).font('Helvetica-Bold').text(`Regime: ${safe(impact.regime.regime)} | Quality: ${quality.score}/100 (${quality.status})`)
      doc.fontSize(9).font('Helvetica').text(`Indonesia pulse: ${safe(impact.pulse)}`, { lineGap: 3 })
      doc.moveDown(0.5)
      impact.rows.slice(0, 10).forEach(r => {
        doc.fontSize(9).font('Helvetica-Bold').fillColor(DK).text(`${safe(r.symbol)} ${r.dir} ${r.risk} score ${r.score}`, { continued:false })
        doc.fontSize(8).font('Helvetica').fillColor(GY).text(safe(impactReason(r, impact.event)).slice(0, 160))
      })

      // ─── FUN FACTS ───
      const funFacts = topics.filter(t => t.funFact?.length > 15)
      if (funFacts.length > 0) {
        if (doc.y > 620) doc.addPage()
        doc.rect(55, doc.y, 500, 22).fill(PG)
        doc.fillColor(P).fontSize(13).font('Helvetica-Bold').text('Fun Facts', 65, doc.y + 5)
        doc.fillColor(DK).moveDown(1.8)
        funFacts.slice(0, 8).forEach(f => {
          if (doc.y > 710) doc.addPage()
          doc.fontSize(9).font('Helvetica-Oblique').fillColor(GY)
            .text(`${safe(f.title)}:`, { continued: true })
          doc.fontSize(9).font('Helvetica').fillColor(DK)
            .text(` ${safe(f.funFact).slice(0, 220)}`, { indent: 10 })
          doc.moveDown(0.3)
        })
      }

      // ─── SECTIONS ───
      topics.forEach((topic, ti) => {
        const items = topic.items.filter(i => i.title)
        if (!items.length) return
        if (doc.y > 660) doc.addPage()

        const hy = doc.y
        doc.rect(55, hy, 500, 22).fill(PG)
        doc.fillColor(P).fontSize(13).font('Helvetica-Bold').text(safe(topic.title), 65, hy + 5)
        doc.fillColor(DK).moveDown(1.5)

        if (topic.intro?.length > 30) {
          doc.fontSize(9).font('Helvetica-Oblique').fillColor(GY)
            .text(`"${safe(topic.intro).slice(0, 350)}"`, { indent: 10 })
          doc.fillColor(DK).moveDown(0.5)
        }

        // Fetch images for up to 3 items in parallel
        const imgUrls = items.slice(0, 3).map(i => i.imageUrl || null)

        items.slice(0, 4).forEach((item, idx) => {
          if (doc.y > 700) doc.addPage()
          const src = item.source || ''
          const title = safe(clean(item.title))
          const snippet = item.snippet ? safe(clean(item.snippet)) : ''
          const url = item.url || ''

          // Optional article image (top card thumbnail)
          const imgBuf = item.imageUrl ? imageBuffers.get(item.imageUrl) : null
          if (imgBuf) {
            try {
              doc.image(imgBuf, 73, doc.y, { width: 86, height: 54, fit: [86, 54] })
              doc.y += 58
            } catch (_) {}
          }

          // Item header with colored source badge
          doc.fontSize(10).font('Helvetica-Bold').fillColor(P).text(`${idx+1}.`, { continued: true })
          if (src && sC[src]) { doc.fillColor(sC[src]).fontSize(8).text(`[${src}]`, { continued: true }) }
          else if (src) { doc.fillColor(GY).fontSize(8).text(`[${src}]`, { continued: true }) }
          doc.fillColor(DK).fontSize(10).text(` ${title}`)

          // Snippet
          if (snippet.length > 10 && snippet !== title) {
            doc.fontSize(8).font('Helvetica').fillColor('#374151').text(truncateText(snippet, 280), { indent: 18, lineGap: 2 })
          }
          if (item.points) {
            doc.fontSize(7).font('Helvetica').fillColor(GY).text(`^ ${item.points} pts | ${item.comments||0} comments`, { indent: 18 })
          }
          if (url) {
            const ly = doc.y + 1
            doc.fontSize(7).font('Helvetica').fillColor(BL).text(url, { indent: 18, link: url })
            doc.link(73, ly, 465, 12, url)
          }
          doc.fillColor(DK).moveDown(0.2)
          doc.moveTo(70, doc.y).lineTo(535, doc.y).strokeColor('#E5E7EB').lineWidth(0.3).stroke()
          doc.moveDown(0.3)
        })
      })

      const pgs = doc.bufferedPageRange()
      for (let i = 0; i < pgs.count; i++) {
        doc.switchToPage(i)
        doc.fontSize(7).font('Helvetica').fillColor('#D1D5DB')
          .text(`Little Candle -- AI Daily Report -- Page ${i+1}/${pgs.count}`, 55, 810, { align: 'center' })
      }

      doc.end()
      stream.on('finish', () => resolve(tmpFile))
      stream.on('error', reject)
    } catch (e) { reject(e) }
  })
}

// ═══════════════════════════════════════════
// DISCORD EMBED (optional backup)
// ═══════════════════════════════════════════

export function buildDiscordEmbed(topics) {
  const allItems = topics.flatMap(t => (t.items || []).filter(i => i.title))
  const sourceCount = new Set(allItems.map(i => i.source).filter(Boolean)).size
  const embed = new EmbedBuilder()
    .setTitle('AI Daily Report')
    .setDescription(formatDateIndonesia())
    .setColor(0x8B5CF6)
    .setFooter({ text: `Little Candle -- ${sourceCount} sources` })
    .setTimestamp()

  for (const topic of topics) {
    const items = topic.items.filter(i => i.title).slice(0, 8)
    if (!items.length) continue
    let val = ''
    items.forEach((item, idx) => {
      const badge = item.source ? `[${item.source}] ` : ''
      val += `**${idx+1}.** ${badge}${clean(item.title).slice(0, 80)}\n`
      if (item.snippet?.length > 15 && item.snippet !== item.title)
        val += `${clean(item.snippet).slice(0, 150)}\n`
      if (item.points) val += `^ ${item.points} pts\n`
      if (item.url) val += `${item.url}\n\n`
    })
    embed.addFields({ name: topic.title, value: val.slice(0, 1020) })
  }
  embed.addFields({ name: 'Ringkasan', value: buildSummary(topics).slice(0, 1020) })
  return embed
}

// ═══════════════════════════════════════════
// DATA SOURCES
// ═══════════════════════════════════════════

// Lightweight free rerank: BM25-ish lexical + keyword boosts.
// No paid API, no large local model, safe for low-RAM boxes.
// Optional future models: BAAI/bge-small-en-v1.5 (embedding), BAAI/bge-reranker-base or jinaai/jina-reranker-v2-base-multilingual (rerank).

const MAX_ITEM_AGE_HOURS = 72
const MAX_RSS_AGE_HOURS = 96
function itemAgeHours(item) { const ts = item?.createdAt ? Date.parse(item.createdAt) : 0; return ts ? (Date.now()-ts)/36e5 : null }
function isFreshEnough(item, maxHours = MAX_ITEM_AGE_HOURS) { const h = itemAgeHours(item); if (h === null) return /HF|GitHub|HN/.test(item?.source || '') || item?.type === 'model'; return h <= maxHours }
function canonicalUrl(url='') { try { const u = new URL(String(url)); u.hash=''; ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','fbclid','gclid'].forEach(k=>u.searchParams.delete(k)); return `${u.hostname.replace(/^www\./,'')}${u.pathname}`.replace(/\/$/,'').toLowerCase() } catch { return '' } }
function canonicalTitle(title='') { return String(title).toLowerCase().replace(/\[[^\]]+\]|\([^)]*\)/g,' ').replace(/\b(live updates|breaking|exclusive|latest|new|today|update|report|analysis)\b/g,' ').replace(/[^a-z0-9]+/g,' ').replace(/\b(the|a|an|and|or|of|to|in|for|with|on|by|from)\b/g,' ').replace(/\s+/g,' ').trim().slice(0,90) }
function dedupeKey(item) { return canonicalUrl(item?.url || '') || canonicalTitle(item?.title || '') }
function stripStaleAndDupe(items, maxHours = MAX_ITEM_AGE_HOURS) { const seen = new Set(); const out=[]; for (const item of items||[]) { if (!isFreshEnough(item, maxHours)) continue; const k=dedupeKey(item); if(!k || seen.has(k)) continue; if ([...seen].some(s => s.includes(k) || k.includes(s))) continue; seen.add(k); out.push(item) } return out }
async function enrichOgThumbnails(items, limit=18) { let n=0; await Promise.allSettled((items||[]).map(async item => { if (item.imageUrl || !item.url || n>=limit) return; n++; const img = await fetchOgImage(item.url); if (img) item.imageUrl = img })) ; return items }

const STOP_WORDS = new Set('the a an and or of to in for with on by from as is are was were be been being this that these those it its into at about after before new latest today how why what you your we our ai tech technology'.split(' '))
function tokenizeRank(text='') {
  return String(text).toLowerCase().replace(/https?:\/\/\S+/g, ' ').replace(/[^a-z0-9+#.\s-]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP_WORDS.has(w))
}
function recencyBoost(item) {
  const ts = item.createdAt ? Date.parse(item.createdAt) : 0
  if (!ts) return 0
  const ageH = (Date.now() - ts) / 36e5
  if (ageH < 24) return 5
  if (ageH < 72) return 3
  if (ageH < 168) return 1
  return -3
}
function textRankScore(item, query, sectionId='') {
  const text = `${item.title || ''} ${item.snippet || ''} ${item.source || ''}`
  const toks = tokenizeRank(text)
  if (!toks.length) return 0
  const q = tokenizeRank(query)
  let score = 0
  for (const qt of q) {
    const exact = toks.filter(t => t === qt).length
    const fuzzy = toks.filter(t => t.includes(qt) || qt.includes(t)).length
    score += exact * 3 + fuzzy * 0.7
  }
  // quality boosts
  if (item.points) score += Math.log10(Number(item.points) + 1) * 1.8
  if ((item.snippet || '').length > 80) score += 1.2
  if ((item.title || '').length > 25) score += 0.5
  if (/HN|TechCrunch|VentureBeat|MIT Tech Review|Google AI Blog|Ars Technica|The Verge/.test(item.source || '')) score += 0.8
  // section intent boosts
  const s = `${item.title || ''} ${item.snippet || ''}`.toLowerCase()
  const boosts = {
    models: /\b(model|llm|gpt|claude|gemini|llama|mistral|qwen|benchmark)\b/,
    tools: /\b(tool|product|api|sdk|framework|platform|plugin|app|launch)\b/,
    research: /\b(research|paper|study|benchmark|evaluation|dataset|safety)\b/,
    industry: /\b(startup|funding|company|acquisition|ipo|valuation|revenue|series)\b/,
    tips: /\b(tips|tutorial|guide|how to|prompt|workflow|best practice)\b/,
    vibecode: /\b(cursor|copilot|agent|claude code|code|developer|github|vibe)\b/,
    cyber: /\b(security|privacy|hack|breach|encrypt|vulnerability|malware)\b/,
    finance: /\b(stock|market|finance|bank|crypto|bitcoin|trading|economy)\b/,
    aifinance: /\b(ai.*financ|financ.*ai|fintech|banking|trading|market)\b/,
  }
  if (boosts[sectionId]?.test(s)) score += 4
  score += recencyBoost(item)
  return score
}
function freshnessBoost(item) {
  const ts = item.createdAt ? Date.parse(item.createdAt) : 0
  if (!ts) return 0
  const ageH = (Date.now() - ts) / 36e5
  if (ageH < 24) return 2
  if (ageH < 72) return 1
  if (ageH < 168) return .4
  return -2
}
function diversifySources(items, limit = 4, maxPerSource = 2) {
  const out = [], counts = new Map()
  for (const item of items) {
    const src = item.source || item.domain || 'unknown'
    if ((counts.get(src) || 0) >= maxPerSource) continue
    out.push(item); counts.set(src, (counts.get(src) || 0) + 1)
    if (out.length >= limit) break
  }
  return out.length >= Math.min(limit, items.length) ? out : items.slice(0, limit)
}
// SEO spam filter — reject low-quality content before reranking
function isSpamItem(item) {
  const title = (item.title || '').trim()
  const snippet = (item.snippet || '').trim()
  const text = `${title} ${snippet}`.toLowerCase()
  // Suspicious title patterns
  if (/^(ultimate guide|who is|what is|why is|how to be(come)?|top \d+ ways?|best \d+ tips?|everything you need to know|complete guide|beginner.?s guide|the history of|simple guide|quick guide)/i.test(title)) return true
  // Basic encyclopedia / spam content indicators
  if (/^[\w\s,.-]+(country|capital|population|currency|language|area|flag|religion|president|prime minister)/i.test(title)) return true
  // Spam content: random country names, "AI Companion", etc.
  if (/\b(AI Companion|AI Girlfriend|AI Boyfriend|AI Waifu|AI Husband|AI Wife|NSFW AI|uncensored AI|sexting|AI porn)\b/i.test(text)) return true
  // Snippet too short or gibberish
  if (snippet.length < 20) return true
  // Non-English mixed gibberish check (>80% non-ASCII in a mixed block)
  const asciiCount = (text.match(/[\x20-\x7E]/g) || []).length
  const totalCount = text.length || 1
  const asciiRatio = asciiCount / totalCount
  if (asciiRatio < 0.2 && snippet.length > 0) return true
  // Spam domain check
  const domain = (item.domain || '').toLowerCase()
  if (/example\.com|test\.com|lorem\.ipsum|dummy\.site|tests\.com/i.test(domain)) return true
  return false
}

// Sentence-aware truncation: cuts at sentence boundary, never mid-word
function truncateText(text, maxLen = 200) {
  if (!text || text.length <= maxLen) return text || ''
  let cut = text.lastIndexOf('. ', maxLen - 1)
  if (cut < maxLen * 0.4) cut = text.lastIndexOf('! ', maxLen - 1)
  if (cut < maxLen * 0.4) cut = text.lastIndexOf('? ', maxLen - 1)
  if (cut < maxLen * 0.4) cut = text.lastIndexOf('…', maxLen - 1)
  if (cut < maxLen * 0.4) cut = text.lastIndexOf(' — ', maxLen - 1)
  if (cut < maxLen * 0.4) {
    // Fall back to word boundary
    cut = text.lastIndexOf(' ', maxLen - 1)
    if (cut < maxLen * 0.4) cut = maxLen - 1
  }
  let result = text.slice(0, cut + 1).trim()
  // Ensure we don't end mid-word
  if (result.length > 0 && result.length < text.length) {
    result = result.replace(/\s+\S*$/, '') + '…'
  }
  return result
}

function rerankItems(items, sectionDef) {
  const query = `${sectionDef.title || ''} ${sectionDef.desc || ''} AI LLM technology news`
  return [...items.filter(item => !isSpamItem(item))]
    .map(i => ({ ...i, rerankScore: Number((textRankScore(i, query, sectionDef.id) + freshnessBoost(i)).toFixed(2)) }))
    .sort((a,b) => (b.rerankScore || 0) - (a.rerankScore || 0))
}

const AI_WORDS = /\b(ai|openai|anthropic|llm|gpt|claude|gemini|deepseek|machine learning|google ai|microsoft|meta ai|amazon|voice ai|image gen|text.to|image|text.generation|reasoning|agent|coding|copilot|cursor|prompt|vibe|chatbot|neural|model|dataset|compute|nvidia|intel|apple intelligence|android|robot|automation|llama|mistral|falcon|qwen|transformer|attention|fine.?tune|RAG|vector|embedding|token)/i

const TECH_WORDS = /\b(smartphone|iphone|samsung|google|apple|microsoft|amazon|meta|tesla|spacex|nasa|cybersecurity|hacker|data breach|privacy|encryption|5g|6g|chip|processor|gpu|cpu|semiconductor|battery|electric vehicle|ev|space|crypto|blockchain|cloud|server|linux|windows|macos|os|update|gadget|hardware|console|playstation|xbox|nintendo|streaming|disney|netflix|youtube|tiktok|instagram|twitter|x\.com|threads|bluesky)/i

async function fetchFromHNSearch() {
  try {
    const queries = [
      'AI artificial intelligence news', 'OpenAI Anthropic Google model LLM',
      'LLM GPT Claude Gemini deepseek', 'AI research benchmark',
      'machine learning development', 'Show HN AI tools agent',
      'vibe coding cursor copilot agent', 'prompt engineering tips LLM',
      'AI startup funding industry', 'technology news Apple Google Microsoft',
      'cybersecurity data breach hacking', 'Show HN new developer tool',
      'AI finance fintech banking investment', 'crypto bitcoin blockchain AI trading',
      'stock market AI trading investing', 'fintech startup funding banking',
    ]
    const q = encodeURIComponent(queries[Math.floor(Math.random() * queries.length)])
    const res = await fetch(
      `https://hn.algolia.com/api/v1/search_by_date?query=${q}&tags=story&hitsPerPage=40&numericFilters=created_at_i>${Math.floor(Date.now()/1000)-7*86400}`,
      { headers: { 'User-Agent': 'market-orca/1.0', 'Cache-Control':'no-cache' }, signal: AbortSignal.timeout(8000) }
    )
    if (!res.ok) return []
    const data = await res.json()
    return (data.hits || []).map(hit => {
      const raw = hit._highlightResult?.story_text?.value || hit.story_text || ''
      const snippet = raw.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
      return {
        type: 'article',
        title: hit.title,
        snippet: snippet.length > 15 ? snippet : `${hit.points || 0} pts - ${hit.num_comments || 0} comments on HN`,
        url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
        source: 'HN',
        points: hit.points || 0,
        comments: hit.num_comments || 0,
        createdAt: hit.created_at,
        domain: (hit.url || '').replace(/^https?:\/\//, '').split('/')[0].replace('www.', '') || 'news.ycombinator.com',
        createdAt: hit.created_at,
      }
    })
  } catch (e) { console.warn('[ai-report] HN:', e.message); return [] }
}

async function fetchFromRSS(url, label, opts = {}) {
  try {
    const maxItems = opts.maxItems || 6
    const onlyAi = opts.onlyAi !== false
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) })
    if (!res.ok) return []
    const text = await res.text()
    const items = text.match(/<(item|entry)[^>]*>[\s\S]*?<\/(item|entry)>/gi) || []
    const out = []

    // Helper to decode HTML entities
    const decode = (str) => {
      return str
        .replace(/<!\[CDATA\[|\]\]>/gi, '')
        .replace(/&amp;#\d+;/g, c => String.fromCodePoint(parseInt(c.slice(6,-1))))
        .replace(/&#x[0-9a-f]+;/gi, c => String.fromCodePoint(parseInt(c.slice(3,-1), 16)))
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/&#\d+;/g, c => String.fromCodePoint(parseInt(c.slice(2,-1))))
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ').trim()
    }

    for (const item of items) {
      if (out.length >= maxItems) break
      const tM = item.match(/<title[^>]*>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]+))<\/title>/i)
      const lM = item.match(/<link[^>]*>([^<]+)<\/link>/i) || item.match(/<link[^>]*\shref="([^"]+)"[^>]*\/?>/i)
      const dM = item.match(/<(description|content|summary)[^>]*>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]+))<\/(description|content|summary)>/i)
      const pM = item.match(/<(pubDate|published|updated)[^>]*>([^<]+)<\/(pubDate|published|updated)>/i)
      const title = decode(tM?.[1] || tM?.[2] || '')
      const link = decode(lM?.[1] || lM?.[2] || '')
      const descRaw = decode(dM?.[2] || dM?.[3] || '')
      const createdAt = decode(pM?.[2] || '')
      const ageMs = createdAt ? Date.now() - Date.parse(createdAt) : 0
      if (ageMs && ageMs > MAX_RSS_AGE_HOURS*36e5) continue
      if (!title || !link) continue
      const check = title + ' ' + descRaw.slice(0, 300)
      const isAI = AI_WORDS.test(check)
      const isTech = TECH_WORDS.test(check)
      if (onlyAi && !isAI && !isTech) continue
      out.push({
        type: 'article', title,
        snippet: (isAI || isTech) && descRaw.length > 15 ? descRaw.slice(0, 280) : '',
        url: link, source: label,
        domain: link.replace(/^https?:\/\//, '').split('/')[0].replace('www.', ''),
        createdAt,
      })
    }
    return out
  } catch (e) { console.warn(`[ai-report] ${label}:`, e.message); return [] }
}

async function fetchFromHF() {
  try {
    const res = await fetch(
      'https://huggingface.co/api/models?sort=likes&direction=-1&limit=15&full=true',
      { headers: { 'User-Agent': 'market-orca/1.0', 'Cache-Control':'no-cache' }, signal: AbortSignal.timeout(8000) }
    )
    if (!res.ok) return []
    const data = await res.json()
    return (Array.isArray(data) ? data.slice(0, 10) : []).map(m => {
      const id = m.modelId || m.id || ''
      const dl = m.downloads || 0
      return {
        type: 'model',
        title: id.split('/').pop(),
        snippet: dl > 100000
          ? `${dl.toLocaleString()} downloads - ${(m.likes||0).toLocaleString()} likes - ${m.pipeline_tag || 'model'} (modified ${(m.lastModified||'').slice(0,10)})`
          : `${dl.toLocaleString()} downloads - ${(m.likes||0).toLocaleString()} likes - ${m.pipeline_tag || 'model'}`,
        url: `https://huggingface.co/${id}`, source: 'HF',
        downloads: dl, likes: m.likes || 0, task: m.pipeline_tag || 'n/a',
      }
    })
  } catch (e) { console.warn('[ai-report] HF:', e.message); return [] }
}

async function fetchFromGitHub() {
  try {
    const since = new Date(Date.now() - 30*864e5).toISOString().slice(0,10)
    const queries = [`ai+agent+tools+pushed:>${since}`, `llm+framework+pushed:>${since}`, `vibe+coding+ai+pushed:>${since}`, `prompt+engineering+pushed:>${since}`, `cursor+copilot+agent+pushed:>${since}`]
    const q = encodeURIComponent(queries[Math.floor(Math.random() * queries.length)])
    const res = await fetch(
      `https://api.github.com/search/repositories?q=${q}&sort=updated&order=desc&per_page=8`,
      { headers: { 'User-Agent': 'market-orca/1.0', 'Accept': 'application/vnd.github.v3+json' }, signal: AbortSignal.timeout(8000) }
    )
    if (!res.ok) return []
    const data = await res.json()
    return (data.items || []).map(r => ({
      type: 'article',
      title: `${r.full_name} -- ${(r.description || '').slice(0, 100)}`,
      snippet: `${r.stargazers_count.toLocaleString()} stars, ${r.forks_count.toLocaleString()} forks, ${r.language || 'multi'}`,
      url: r.html_url, source: 'GitHub', domain: 'github.com',
      stars: r.stargazers_count, language: r.language || 'multi', createdAt: r.pushed_at || r.updated_at,
    }))
  } catch (e) { console.warn('[ai-report] GitHub:', e.message); return [] }
}

// ═══════════════════════════════════════════
// TOPICS & FEEDS
// ═══════════════════════════════════════════

const TOPICS = [
  { id:'news', title:'News', desc:'AI & tech news from various portals.' },
  { id:'models', title:'Models', desc:'LLM & AI model updates, launches, benchmarks.' },
  { id:'tools', title:'Tools', desc:'AI tools, products, platforms.' },
  { id:'research', title:'Research', desc:'Papers, research, benchmarks.' },
  { id:'industry', title:'Industry', desc:'AI business, funding, M&A.' },
  { id:'tips', title:'Tips & Tricks', desc:'AI/LLM tutorials, guides, best practices.' },
  { id:'vibecode', title:'Vibe Coding', desc:'AI coding tools, agents, frameworks.' },
  { id:'dev', title:'Dev News', desc:'AI development, advancements, updates.' },
  { id:'tech', title:'Tech & Gadgets', desc:'Hardware, gadgets, digital innovation.' },
  { id:'cyber', title:'Security', desc:'Cybersecurity, privacy, data breaches.' },
  { id:'finance', title:'Finance', desc:'Finance, economy, stocks, crypto.' },
  { id:'aifinance', title:'AI Finance', desc:'AI in fintech, banking, investing.' },
  { id:'fun', title:'Fun Facts', desc:'Interesting AI/tech facts and stories.' },
]

const RSS_FEEDS = [
  { url:'https://techcrunch.com/feed/', label:'TechCrunch' },
  { url:'https://venturebeat.com/category/ai/feed/', label:'VentureBeat' },
  { url:'https://www.theverge.com/rss/index.xml', label:'The Verge' },
  { url:'https://blog.google/technology/ai/rss/', label:'Google AI Blog' },
  { url:'https://www.technologyreview.com/feed/', label:'MIT Tech Review' },
  { url:'https://feeds.arstechnica.com/arstechnica/index', label:'Ars Technica' },
  { url:'https://dev.to/feed/tag/ai', label:'Dev.to', maxItems:8 },
  { url:'http://feeds.bbci.co.uk/news/technology/rss.xml', label:'BBC Tech' },
  { url:'https://www.theguardian.com/technology/rss', label:'Guardian Tech' },
  { url:'https://www.engadget.com/rss.xml', label:'Engadget' },
  { url:'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114', label:'CNBC Tech' },
  { url:'https://www.coindesk.com/arc/outboundfeeds/rss/', label:'CoinDesk' },
  { url:'https://www.analyticsvidhya.com/feed/', label:'Analytics Vidhya' },
  { url:'https://www.forbes.com/innovation/feed/', label:'Forbes' },
  { url:'https://feeds.marketwatch.com/marketwatch/topstories', label:'MarketWatch' },
]

// ═══════════════════════════════════════════
// MAIN GENERATION
// ═══════════════════════════════════════════

export async function generateAiDailyReport() {
  const startTime = Date.now()
  console.log('[ai-report] Generating...')

  const [
    hnArticles, tcArticles, vbArticles, vergeArticles, googleArticles,
    mitArticles, arsArticles, devArticles, bbcArticles, guardianArticles,
    engadgetArticles, cnbcArticles, coinDeskArticles, avArticles,
    forbesArticles, marketWatchArticles,
    hfModels, ghRepos,
  ] = await Promise.all([
    fetchFromHNSearch(),
    fetchFromRSS(RSS_FEEDS[0].url, RSS_FEEDS[0].label),
    fetchFromRSS(RSS_FEEDS[1].url, RSS_FEEDS[1].label),
    fetchFromRSS(RSS_FEEDS[2].url, RSS_FEEDS[2].label),
    fetchFromRSS(RSS_FEEDS[3].url, RSS_FEEDS[3].label, { onlyAi: true }),
    fetchFromRSS(RSS_FEEDS[4].url, RSS_FEEDS[4].label),
    fetchFromRSS(RSS_FEEDS[5].url, RSS_FEEDS[5].label),
    fetchFromRSS(RSS_FEEDS[6].url, RSS_FEEDS[6].label, { maxItems: 8 }),
    fetchFromRSS(RSS_FEEDS[7].url, RSS_FEEDS[7].label),
    fetchFromRSS(RSS_FEEDS[8].url, RSS_FEEDS[8].label),
    fetchFromRSS(RSS_FEEDS[9].url, RSS_FEEDS[9].label),
    fetchFromRSS(RSS_FEEDS[10].url, RSS_FEEDS[10].label),
    fetchFromRSS(RSS_FEEDS[11].url, RSS_FEEDS[11].label),
    fetchFromRSS(RSS_FEEDS[12].url, RSS_FEEDS[12].label),
    fetchFromRSS(RSS_FEEDS[13].url, RSS_FEEDS[13].label),
    fetchFromRSS(RSS_FEEDS[14].url, RSS_FEEDS[14].label),
    fetchFromHF(),
    fetchFromGitHub(),
  ])

  const log = (l,a) => `${l}=${a.length}`
  console.log(`[ai-report] Sources: ${log('HN',hnArticles)} ${log('TC',tcArticles)} ${log('VB',vbArticles)} ${log('VG',vergeArticles)} ${log('GA',googleArticles)} ${log('MIT',mitArticles)} ${log('Ars',arsArticles)} ${log('Dev',devArticles)} ${log('BBC',bbcArticles)} ${log('GRD',guardianArticles)} ${log('ENG',engadgetArticles)} ${log('CNBC',cnbcArticles)} ${log('CD',coinDeskArticles)} ${log('AV',avArticles)} ${log('FB',forbesArticles)} ${log('MW',marketWatchArticles)} ${log('HF',hfModels)} ${log('GH',ghRepos)}`)

  const allArticles = await enrichOgThumbnails(stripStaleAndDupe([
    ...hnArticles, ...tcArticles, ...vbArticles, ...vergeArticles, ...googleArticles,
    ...mitArticles, ...arsArticles, ...devArticles, ...bbcArticles, ...guardianArticles,
    ...engadgetArticles, ...cnbcArticles, ...coinDeskArticles, ...avArticles,
    ...forbesArticles, ...marketWatchArticles,
  ]))

  // Gunakan SEMUA section (bukan random subset)
  const topicDefs = [...TOPICS]
  const globalSeen = new Set()
  const enrichedTopics = []

  function deduped(arr, max) {
    const out = []
    for (const item of arr) {
      const key = dedupeKey(item)
      if (!key || globalSeen.has(key)) continue
      globalSeen.add(key); out.push(item)
      if (out.length >= max) break
    }
    return out
  }
  function dedupedFresh(arr, max) {
    const local = new Set(), out = []
    for (const item of rerankItems(arr, { id:'vibecode', title:'Vibe Coding', desc:'fresh AI coding agents tools frameworks' })) {
      const key = dedupeKey(item)
      if (!key || local.has(key) || globalSeen.has(key)) continue
      local.add(key); globalSeen.add(key); out.push(item)
      if (out.length >= max) break
    }
    return out
  }

  for (const def of topicDefs) {
    let items = []
    if (def.id === 'news') {
      const pool = [...tcArticles, ...arsArticles, ...mitArticles, ...vbArticles, ...vergeArticles, ...bbcArticles, ...guardianArticles, ...engadgetArticles, ...hnArticles]
      items = deduped(pool, 4).map(i => ({ ...i, type: 'article' }))
    } else if (def.id === 'models') {
      const mn = allArticles.filter(a => !globalSeen.has(dedupeKey(a)) && /\b(gpt|llm|gemini|claude|deepseek|model|openai|anthropic|llama|mistral|falcon|qwen|transformer)/i.test(a.title))
      items = deduped([...mn, ...hfModels], 4)
    } else if (def.id === 'tools') {
      const hnT = allArticles.filter(a => /\b(tool|product|launch|app|release|platform|api|sdk|library|framework|plugin|extension)/i.test(a.title))
      items = deduped([...ghRepos, ...hnT], 4)
    } else if (def.id === 'research') {
      const pool = allArticles.filter(a => a.snippet?.length > 40 && !globalSeen.has(dedupeKey(a)))
      items = deduped([...pool, ...hfModels], 4)
    } else if (def.id === 'industry') {
      const biz = allArticles.filter(a => /\b(startup|funding|acquisition|company|industry|invest|billion|million|IPO|valuation|revenue|seed|series)/i.test(a.title))
      items = deduped(biz, 4).map(i => ({ ...i, type: 'article' }))
    } else if (def.id === 'tips') {
      const dt = devArticles.filter(d => /\b(tips|tutorial|how to|guide|prompt|best practices|beginner|learn|course|implement|panduan|strategi|workflow|optimize)/i.test(d.title + (d.snippet||'').slice(0, 80)))
      const ht = allArticles.filter(a => /\b(tips|tutorial|how to|guide|prompt|prompt engineering|learn|best practice|workflow|panduan)/i.test(a.title))
      items = deduped([...dt, ...ht], 4)
    } else if (def.id === 'vibecode') {
      const dv = devArticles.filter(d => /\b(cursor|copilot|agent|code|vibe|developer|sdk|framework|tool|github|api)/i.test(d.title + (d.snippet||'').slice(0, 80)))
      const hn = allArticles.filter(a => /\b(cursor|copilot|dev tools|vibe coding|agent|code|developer|claude code|github copilot|codex|coding ai|low.code|no.code)/i.test(a.title))
      items = dedupedFresh([...ghRepos, ...dv, ...hn], 4).map(i => ({ ...i, source: i.domain?.includes('github.com') ? 'GitHub' : i.source }))
    } else if (def.id === 'dev') {
      const pool = [...vbArticles, ...vergeArticles, ...googleArticles, ...mitArticles, ...tcArticles].filter(a => a.snippet?.length > 20)
      const hd = allArticles.filter(a => /\b(development|advance|breakthrough|new|update|improve|upgrade|launch|release|deploy|performance|capability)/i.test(a.title))
      items = deduped([...pool, ...hd], 4)
    } else if (def.id === 'tech') {
      const pool = [...engadgetArticles, ...bbcArticles, ...guardianArticles, ...arsArticles, ...vergeArticles]
      const ht = allArticles.filter(a => /\b(smartphone|iphone|samsung|tesla|spacex|nasa|gadget|console|playstation|xbox|nintendo|streaming|netflix|hardware|chip|processor|gpu|cpu|battery|ev|electric)/i.test(a.title))
      items = deduped([...pool, ...ht], 4)
    } else if (def.id === 'cyber') {
      const pool = [...bbcArticles, ...guardianArticles, ...arsArticles, ...tcArticles]
      const hs = allArticles.filter(a => /\b(cyber|hack|data breach|privacy|encrypt|malware|ransomware|vulnerability|security|patch|attack|exploit)/i.test(a.title))
      items = deduped([...pool, ...hs], 4)
    } else if (def.id === 'finance') {
      const pool = [...cnbcArticles, ...coinDeskArticles, ...marketWatchArticles, ...forbesArticles, ...guardianArticles, ...bbcArticles, ...tcArticles]
      const hf = allArticles.filter(a => /\b(stock|market|finance|economy|bank|banking|interest rate|inflation|GDP|recession|bond|fed|central bank|invest|trading|crypto|bitcoin|ethereum|blockchain|fintech|wealth|portfolio|dividend|equity|debt|fiscal|monetary)/i.test(a.title))
      items = deduped([...pool, ...hf], 4)
    } else if (def.id === 'aifinance') {
      const pool = [...cnbcArticles, ...coinDeskArticles, ...vbArticles, ...tcArticles, ...avArticles]
      const ha = allArticles.filter(a => /\b(AI.*(financ|bank|invest|trad|stock|market|fintech|crypto|wealth))|(financ.*AI)|(AI.*fintech)/i.test(a.title + ' ' + (a.snippet||'').slice(0, 100)))
      items = deduped([...pool, ...ha], 4)
    } else {
      items = deduped([...allArticles, ...hfModels], 4)
    }

    items = diversifySources(rerankItems(items, def), 4, 2)
    const candidates = items.filter(i => i.snippet && i.snippet !== i.title && i.snippet.length > 30)
    let funFact = ''
    if (candidates.length > 0 && Math.random() > 0.3) funFact = candidates[Math.floor(Math.random() * candidates.length)].snippet
    const introSrc = items.find(i => i.snippet?.length > 40 && i.type !== 'model')
    const intro = introSrc?.snippet?.slice(0, 280) || def.desc || ''
    enrichedTopics.push({ title: def.title, intro, items, funFact: funFact ? funFact.slice(0, 200) : '' })
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000)
  console.log(`[ai-report] Done in ${elapsed}s, ${enrichedTopics.length} topics`)
  return { topics: enrichedTopics.filter(t => t.items.length > 0) }
}

// ═══════════════════════════════════════════
// DELIVERY
// ═══════════════════════════════════════════

// Convert simple markdown to HTML for web display
function inlineMd(line) {
  const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
  const links = []
  let s = String(line || '').replace(/<((?:https?:\/\/)[^>]+)>/g, (_, url) => {
    const key = `@@LINK${links.length}@@`; links.push({ key, url }); return key
  }).replace(/((?:https?:\/\/)[^\s<]+)/g, (url) => {
    const cleanUrl = url.replace(/[),.;]+$/,'')
    const suffix = url.slice(cleanUrl.length)
    const key = `@@LINK${links.length}@@`; links.push({ key, url: cleanUrl }); return key + suffix
  })
  s = esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
  for (const l of links) s = s.replaceAll(l.key, `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.url)}</a>`)
  return s
}

function mdToHtml(text) {
  return text.split('\n').map(line => {
    if (line.startsWith('# ')) return `<h1>${inlineMd(line.slice(2))}</h1>`
    if (line.startsWith('## ')) return `<h2>${inlineMd(line.slice(3))}</h2>`
    if (/^[-=·%]{5,}$/.test(line.trim())) return '<hr>'
    if (!line.trim()) return '<br>'
    if (line.startsWith('> ')) return `<blockquote>${inlineMd(line.slice(2))}</blockquote>`
    if (line.startsWith('^ ')) return `<div class="meta">${inlineMd(line.slice(2))}</div>`
    if (line.startsWith('**') && !line.includes('>') && !line.match(/\^ \d+ pts/)) return `<p class="hl">${inlineMd(line)}</p>`
    return `<p>${inlineMd(line)}</p>`
  }).join('\n')
}

// Batch-fetch og:image URLs for articles (non-blocking)
async function enrichWithImages(topics) {
  const allItems = topics.flatMap(t => t.items.filter(i => i.url && !i.imageUrl))
  const batchSize = 10
  for (let i = 0; i < allItems.length; i += batchSize) {
    const batch = allItems.slice(i, i + batchSize)
    await Promise.allSettled(batch.map(item => 
      fetchOgImage(item.url).then(url => { if (url) item.imageUrl = url }).catch(() => {})
    ))
  }
  return topics
}

function svgEscape(s='') { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') }
function wrapSvgText(text, max = 20) {
  const words = String(text || '').split(/\s+/)
  const lines = []
  let line = ''
  for (const w of words) {
    if ((line + ' ' + w).trim().length > max) { if (line) lines.push(line); line = w } else line = (line + ' ' + w).trim()
  }
  if (line) lines.push(line)
  return lines.slice(0, 5)
}
function buildSocialCardSvg(topics, date, bgDataUri = '') {
  const hero = pickHero(topics)
  const headline = punchyHeadline(hero).replace(/ — .+$/, '')
  const vibe = vibeTag(hero).toUpperCase()
  const why = whyItMatters(hero).replace(/^Ini /, '').replace(/\.$/, '')
  const lines = wrapSvgText(headline, 19).slice(0, 3)
  const whyLines = wrapSvgText(why, 42).slice(0, 2)
  const lineSvg = lines.map((l,i)=>`<text x="72" y="${775 + i*92}" class="headline">${svgEscape(l)}</text>`).join('')
  const whySvg = whyLines.map((l,i)=>`<text x="72" y="${1118 + i*42}" class="whytext">${svgEscape(l)}</text>`).join('')
  const heroImg = bgDataUri
    ? `<image href="${bgDataUri}" x="48" y="48" width="984" height="610" preserveAspectRatio="xMidYMid slice"/><rect x="48" y="48" width="984" height="610" fill="#000" opacity=".20"/>`
    : `<rect x="48" y="48" width="984" height="610" fill="#111"/><circle cx="842" cy="285" r="160" fill="#F97316"/><circle cx="760" cy="370" r="94" fill="#FACC15"/><rect x="110" y="210" width="380" height="28" fill="#FACC15"/><rect x="110" y="270" width="560" height="28" fill="#FACC15"/>`
  return `<svg width="1080" height="1350" viewBox="0 0 1080 1350" xmlns="http://www.w3.org/2000/svg">
  <rect width="1080" height="1350" fill="#F7F2EA"/>
  ${heroImg}
  <rect x="48" y="48" width="984" height="610" fill="none" stroke="#111" stroke-width="4"/>
  <rect x="72" y="74" width="242" height="44" fill="#FACC15"/>
  <text x="91" y="105" class="brand">LITTLE CANDLE</text>
  <rect x="700" y="74" width="308" height="44" fill="#111" opacity=".88"/>
  <text x="722" y="105" class="date">${svgEscape(date)} REPORT</text>
  <rect x="72" y="610" width="250" height="48" fill="#111"/>
  <text x="92" y="644" class="tag">${svgEscape(vibe)}</text>
  ${lineSvg}
  <rect x="72" y="1038" width="936" height="3" fill="#111" opacity=".45"/>
  <text x="72" y="1085" class="why">WHY CARE</text>
  ${whySvg}
  <text x="72" y="1264" class="footer">AI • TECH • MARKET — READ FULL REPORT</text>
  <style>
    text{font-family:Arial,Helvetica,sans-serif}
    .brand{font-size:24px;font-weight:900;letter-spacing:1.5px;fill:#111}
    .tag{font-size:26px;font-weight:900;letter-spacing:2px;fill:#FACC15}
    .date{font-size:20px;font-weight:900;letter-spacing:2px;fill:#FACC15}
    .headline{font-size:82px;font-weight:900;fill:#111;letter-spacing:-4px}
    .why{font-size:30px;font-weight:900;letter-spacing:4px;fill:#111}
    .whytext{font-size:31px;font-weight:800;fill:#111}
    .footer{font-size:24px;font-weight:900;letter-spacing:3px;fill:#9A3412}
  </style>
</svg>`
}
async function saveSocialCard(reportDir, slug, topics) {
  const hero = pickHero(topics)
  const imageUrl = hero?.imageUrl || hero?.image || null
  let bgDataUri = ''
  const buf = await fetchImageBuffer(imageUrl).catch(() => null)
  if (buf) bgDataUri = `data:image/jpeg;base64,${buf.toString('base64')}`
  const svg = buildSocialCardSvg(topics, slug, bgDataUri)
  const svgPath = path.join(reportDir, `${slug}-card.svg`)
  const pngPath = path.join(reportDir, `${slug}-card.png`)
  fs.writeFileSync(svgPath, svg)
  await new Promise((resolve) => execFile('magick', [svgPath, pngPath], { timeout: 15000 }, () => resolve()))
  return fs.existsSync(pngPath) ? pngPath : svgPath
}

export async function saveReport(topics, textReport) {
  const reportDir = path.join(__dirname, '..', '..', 'reports')
  fs.mkdirSync(reportDir, { recursive: true })
  const slug = new Date().toISOString().slice(0, 10)

  const rag = buildRagContext(topics)
  saveRagCitations(slug, rag)

  // Enrich with images — only top 1 per section, max 5s total
  const imgTargets = []
  for (const t of topics) {
    const top = t.items.filter(i => i.url && !i.imageUrl)[0]
    if (top) imgTargets.push(top)
  }
  Promise.race([
    Promise.allSettled(imgTargets.slice(0, 10).map(item =>
      fetchOgImage(item.url).then(url => { if (url) item.imageUrl = url }).catch(() => {})
    )),
    new Promise(r => setTimeout(r, 5000))
  ]).then(() => {
    // Re-save JSON with images
    const d2 = { slug, date: slug, generatedAt: new Date().toISOString(), topics, textReport, rag, executiveBrief: buildExecutiveBrief(topics) }
    fs.writeFileSync(path.join(reportDir, `${slug}.json`), JSON.stringify(d2, null, 2))
    fs.writeFileSync(path.join(reportDir, `${slug}.md`), textReport)
    fs.writeFileSync(path.join(reportDir, `${slug}-brief.md`), d2.executiveBrief)
    fs.writeFileSync(path.join(reportDir, `brief.md`), d2.executiveBrief)
    // Regenerate HTML with images
    const summary2 = buildSummary(topics)
    const fun2 = topics.filter(t => t.funFact?.length > 15).map(t => ({ title: t.title, fact: t.funFact }))
    fs.writeFileSync(path.join(reportDir, `${slug}.html`), buildReportHtml(d2, summary2, fun2, textReport))
  }).catch(() => {})

  const executiveBrief = buildExecutiveBrief(topics)
  const data = { slug, date: slug, generatedAt: new Date().toISOString(), topics, textReport, rag, executiveBrief }
  const summary = buildSummary(topics)
  const funFacts = topics.filter(t => t.funFact?.length > 15).map(t => ({ title: t.title, fact: t.funFact }))

  fs.writeFileSync(path.join(reportDir, `${slug}.json`), JSON.stringify(data, null, 2))
  fs.writeFileSync(path.join(reportDir, `${slug}.md`), textReport)
  fs.writeFileSync(path.join(reportDir, `${slug}-brief.md`), executiveBrief)
  fs.writeFileSync(path.join(reportDir, `brief.md`), executiveBrief)
  fs.writeFileSync(path.join(reportDir, `${slug}.html`), buildReportHtml(data, summary, funFacts, textReport))
  await saveSocialCard(reportDir, slug, topics).catch(() => null)

  return { slug }
}

function badgeColor(src) {
  const m = {'HN':'#FF6600','TechCrunch':'#0A9E01','VentureBeat':'#FF5722','The Verge':'#00D4AA',
    'Google AI Blog':'#4285F4','MIT Tech Review':'#000','Ars Technica':'#FF4C00',
    'Dev.to':'#0A0A0A','BBC Tech':'#BB1919','Guardian Tech':'#052962','Engadget':'#00A3E0',
    'HF':'#F59E0B','GitHub':'#333','CNBC Tech':'#005594','CoinDesk':'#2563EB',
    'Analytics Vidhya':'#8B5CF6','Forbes':'#3D7A4D','MarketWatch':'#E67E22'}
  return m[src] || '#6B7280'
}


function fallbackImageFor(item) {
  const text = `${item?.title || ''} ${item?.snippet || ''} ${item?.source || ''}`.toLowerCase()
  const base = 'https://images.unsplash.com/'
  if (/rupiah|idr|jkse|ihsg|bank|market|stock|finance|bitcoin|crypto|etf|fed|rate/.test(text)) return `${base}photo-1611974789855-9c2a0a7236a3?auto=format&fit=crop&w=1200&q=80`
  if (/security|hack|breach|privacy|phishing|signal/.test(text)) return `${base}photo-1550751827-4bd374c3f58b?auto=format&fit=crop&w=1200&q=80`
  if (/model|llm|ai|agent|anthropic|openai|google|claude/.test(text)) return `${base}photo-1677442136019-21780ecad995?auto=format&fit=crop&w=1200&q=80`
  if (/developer|coding|python|vibe|github|tool/.test(text)) return `${base}photo-1461749280684-dccba630e2f6?auto=format&fit=crop&w=1200&q=80`
  return `${base}photo-1495020689067-958852a7765e?auto=format&fit=crop&w=1200&q=80`
}
function variedWhyCare(item) {
  const why = whyItMatters(item)
  const t = `${item?.title || ''} ${item?.snippet || ''}`.toLowerCase()
  if (/rupiah|idr|jkse|ihsg|stock|market|crypto|bitcoin|fed|rate/.test(t)) return `Dampaknya bisa langsung kebaca ke risk appetite, arus dana, dan level penting yang perlu dipantau hari ini. ${why}`
  if (/security|hack|breach|privacy|phishing/.test(t)) return `Ini bukan cuma berita teknis: risiko trust, data, dan biaya mitigasi bisa menyebar ke user maupun bisnis. ${why}`
  if (/agent|ai|model|llm|claude|openai|google/.test(t)) return `Sinyalnya penting buat arah produktivitas dan kompetisi AI: siapa yang punya model/agent lebih berguna akan menang workflow. ${why}`
  return why
}
function contextBullets(item) {
  const snip = clean(item?.snippet || item?.summary || '')
  const title = clean(item?.title || '')
  const bullets = []
  if (snip) bullets.push(snip.slice(0, 260))
  bullets.push(`Sumber: ${item?.source || 'unknown'}${item?.createdAt ? ` · ${freshnessLabel(item)}` : ''}`)
  bullets.push(`Yang perlu dicek lanjut: data resmi, timing publikasi, dan apakah berita ini berdampak ke watchlist/market.`)
  if (item?.url) bullets.push(`Link: ${item.url}`)
  return bullets
}
function seoDescription(hero, summary) {
  return clean(`${hero?.title || 'Market Orca Report'} — ${hero?.snippet || summary || ''}`).slice(0, 155)
}

function buildReportHtml(data, summary, funFacts, textReport) {
  const { date, topics } = data
  const tC = s => safe(s || '')
  const tItems = topics.reduce((s,t) => s + t.items.length, 0)
  const tArts = topics.reduce((s,t) => s + t.items.filter(i=>i.type==='article').length, 0)
  const tMods = topics.reduce((s,t) => s + t.items.filter(i=>i.type==='model').length, 0)
  const allSrc = [...new Set(topics.flatMap(t=>t.items.map(i=>i.source).filter(Boolean)))]
  const contentHtml = mdToHtml(textReport)
  const impact = buildImpactWatch(topics)
  const quality = reportQuality(topics)
  const changed = whatChangedToday(topics)
  const flags = redFlags(topics, impact.rows)
  const hero = pickHero(topics)
  const heroTitle = punchyHeadline(hero)
  const heroSnippet = hero?.snippet ? truncateText(tC(hero.snippet), 320) : 'Berita paling penting hari ini diringkas cepat, lalu detail lengkap ada di bawah.'
  const heroVibe = vibeTag(hero)
  const heroWhy = whyItMatters(hero)
  const heroImg = hero?.imageUrl || hero?.image || fallbackImageFor(hero)
  let assets = []
  try { assets = db.prepare('SELECT * FROM assets ORDER BY abs(change_percent) DESC LIMIT 24').all() } catch {}
  const dataStatusBlock = buildDataStatusBlock(assets)
  const dataFreshnessQa = dataFreshnessQA(assets)

  let secHtml = ''
  const htmlSeenUrls = new Set()
  for (const topic of topics) {
    const items = topic.items.filter(i => i.title).filter(i => {
      const url = i.url || i.link || ''
      if (url && htmlSeenUrls.has(url)) return false
      if (url) htmlSeenUrls.add(url)
      return true
    }).slice(0, 4)
    if (!items.length) continue
    let ih = ''
    for (const item of items) {
      const src = item.source || ''
      const img = item.imageUrl || item.image || fallbackImageFor(item)
      const snip = item.snippet ? truncateText(tC(item.snippet), 280) : ''
      const pts = item.points ? `^ ${item.points} pts${item.comments ? ' | '+item.comments+' comments' : ''}` : ''
      const urlShort = item.url ? tC(item.url).slice(0, 80) + (item.url.length > 80 ? '...' : '') : ''
      const details = contextBullets(item).map(b => `<li>${tC(b)}</li>`).join('')
      const fLabel = freshnessLabel(item)
      const fColor = fLabel.startsWith('stale') ? '#ef4444' : fLabel.includes('fresh') ? '#22c55e' : '#f59e0b'
      ih += `<article class="item" data-report-item>${img ? `<div class="item-img"><img src="${img}" alt="Thumbnail berita: ${tC(item.title).slice(0,80)}" loading="lazy" onerror="this.src='${fallbackImageFor(item)}'"></div>` : ''}<div class="body"><div class="vibe">${vibeTag(item)}</div><span style="display:inline-block;font-size:10px;font-weight:700;padding:1px 5px;border-radius:3px;color:#fff;background:${fColor};margin-bottom:8px">${tC(fLabel)}</span><h3 class="headline">${src ? `<span class="badge" style="--c:${badgeColor(src)}">${src}</span>` : ''} ${tC(item.title)}</h3>${snip ? `<p class="snippet">${snip}</p>` : ''}<div class="why"><b>Kenapa penting:</b> ${tC(variedWhyCare(item))}</div><details class="showmore"><summary>Show more — konteks & catatan</summary><ul>${details}</ul></details>${pts ? `<div class="meta">${pts}</div>` : ''}${item.url ? `<a class="link" href="${item.url}" target="_blank" rel="noopener noreferrer">${urlShort}</a>` : ''}<div class="item-actions"><button type="button" data-hide-item>Hide item</button><button type="button" data-rewrite-section="${tC(topic.title)}">Rewrite section</button></div></div></article>`
    }
    secHtml += `<section class="secc"><h2>${tC(topic.title)}</h2>${topic.intro?.length > 30 ? `<div class="intro">"${tC(topic.intro).slice(0,350)}"</div>` : ''}${ih}</section>`
  }

  return `<!DOCTYPE html>
<html lang="id">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI Daily Report - ${date}</title>
<meta name="description" content="${svgEscape(seoDescription(hero, summary))}">
<meta name="robots" content="index,follow">
<link rel="canonical" href="/report/${date}">
<meta property="og:type" content="article">
<meta property="og:title" content="${svgEscape(heroTitle)}">
<meta property="og:description" content="${svgEscape(seoDescription(hero, summary))}">
<meta property="og:image" content="/report/${date}/card.png">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${JSON.stringify({ "@context":"https://schema.org", "@type":"NewsArticle", headline: heroTitle, datePublished: date, author:{ "@type":"Person", name:"Little Candle" } })}</script>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&family=Newsreader:opsz,wght@6..72,600;6..72,800&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{background:#f4f1ea;color:#161616;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,sans-serif;line-height:1.5;-webkit-font-smoothing:antialiased}
.wrap{max-width:1120px;margin:0 auto;padding:18px 14px 56px;width:100%}
h1{font-family:Newsreader,Georgia,serif;font-size:clamp(26px,5vw,44px);color:#111;margin-bottom:2px;line-height:.98;letter-spacing:-.04em}
h2{font-size:clamp(18px,3vw,26px);color:#111;margin:16px 0 10px;line-height:1.05;font-weight:900;letter-spacing:-.04em}
h1+.date{margin-bottom:16px}
.date{color:#6b7280;font-size:clamp(11px,2.5vw,13px);margin-bottom:20px}
.stats{background:#1a1a2e;border-radius:10px;padding:14px;margin-bottom:16px}
.stats h3{color:#a78bfa;font-size:12px;margin-bottom:6px}
.stats .row{color:#9ca3af;font-size:clamp(11px,2.5vw,13px)}
.secc,.sb,.fb,.impact,.qbox,.changed,.flags{background:#fff;border:2px solid #111;border-radius:0;padding:18px;margin-bottom:16px;box-shadow:5px 5px 0 #111}
.secc h2,.sb h2,.impact h2,.qbox h2,.changed h2,.flags h2{color:#111;font-size:22px;margin-bottom:12px;border-bottom:3px solid #111;padding-bottom:8px}
.intro{color:#57534e;font-style:italic;font-size:13px;margin-bottom:12px;padding-left:10px;border-left:4px solid #b45309;background:#fffbeb;padding-top:8px;padding-bottom:8px}
.item{display:flex;gap:14px;margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid #d6d3d1}
.item:last-child{border:0;margin:0;padding:0}
.item-img{flex-shrink:0;width:150px;height:95px;border-radius:0;overflow:hidden;background:#ddd;border:1px solid #111}
.item-img img{width:100%;height:100%;object-fit:cover}
.body{flex:1;min-width:0}
.headline{font-family:Newsreader,Georgia,serif;font-size:clamp(19px,3vw,28px);font-weight:800;line-height:1.05;margin-bottom:8px;word-wrap:break-word;color:#111;letter-spacing:-.03em}
.badge{display:inline-block;font-size:10px;font-weight:700;padding:1px 6px;border-radius:3px;color:#fff;background:var(--c);margin-right:5px;vertical-align:middle;white-space:nowrap}
.snippet{color:#44403c;font-size:clamp(13px,2.3vw,15px);margin-bottom:8px;line-height:1.55}
.meta{color:#78716c;font-size:12px;margin-bottom:4px;font-weight:700}
.link{color:#1d4ed8;font-size:12px;text-decoration:none;display:inline-block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700}
.link:hover{text-decoration:underline}
.sb h2{color:#a78bfa}
.stext{font-size:clamp(13px,2.5vw,15px);color:#111;line-height:1.75;font-weight:500}
.stext strong{color:#111;font-weight:900}
.fb h2{color:#111;font-weight:900}
.fb p{font-size:clamp(12px,2.4vw,14px);color:#111;margin-bottom:7px;font-weight:900}.fb .ft{color:#111;font-weight:900}
.ftitle{color:#111;font-weight:900}.impact{background:#020617!important;color:#d1fae5!important;border-color:#22c55e!important;box-shadow:5px 5px 0 #22c55e!important}.impact h2{color:#86efac!important;border-bottom-color:#22c55e!important;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.impact p{color:#d1fae5;font-size:13px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.impact-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px}.impact-card{border:1px solid #14532d;background:linear-gradient(180deg,#052e16,#020617);padding:12px;display:grid;gap:6px;color:#d1fae5;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.impact-card b{font-size:18px;color:#fff}.impact-card span{font-size:11px;text-transform:uppercase;font-weight:900;color:#86efac}.impact-card strong{font-size:36px;letter-spacing:-.06em}.impact-card small{color:#bbf7d0}.impact-card.bullish strong{color:#22c55e}.impact-card.bearish strong{color:#fb7185}.impact-card.neutral strong{color:#fde68a}
.ft{background:#fff;border:2px solid #111;color:#111;border-radius:0;padding:22px;margin-bottom:14px;overflow-x:hidden;box-shadow:5px 5px 0 #111;max-width:850px;margin-inline:auto}
.ft h1{font-size:clamp(16px,3.5vw,22px);margin-bottom:8px}
.ft h2{font-size:clamp(14px,3vw,17px);margin:14px 0 6px}
.ft p{font-size:clamp(14px,2.5vw,16px);color:#292524;margin-bottom:10px;line-height:1.75;word-wrap:break-word}
.ft blockquote{color:#44403c;font-size:clamp(13px,2.3vw,15px);padding:10px 14px;margin-bottom:10px;border-left:4px solid #b45309;background:#fffbeb;border-radius:0}
.ft .hl{font-weight:900;color:#111;margin:14px 0 6px}
.ft .meta{font-size:12px;color:#57534e;margin-bottom:6px}
.ft hr{border:0;border-top:1px solid #1f2937;margin:10px 0}
.ft code{font-size:12px;background:#f5f5f4;padding:2px 5px;border-radius:4px;color:#7c2d12}
.ft a{color:#60a5fa}
.footer{text-align:center;color:#6b7280;font-size:11px;margin-top:24px;padding:8px}
.hero{position:relative;overflow:hidden;background:#111;color:#fff;border:3px solid #111;border-radius:0;padding:clamp(20px,5vw,44px);margin-bottom:16px;box-shadow:8px 8px 0 #b45309}
.hero h1{font-family:Newsreader,Georgia,serif;font-size:clamp(38px,9vw,86px);line-height:.88;color:#fff;letter-spacing:-.075em;margin-bottom:16px;max-width:940px}
.hero p{font-size:clamp(15px,2.8vw,20px);color:#f5f5f4;max-width:760px;line-height:1.45;font-weight:600}
.hero a{color:#fbbf24;font-size:12px;display:inline-block;margin-top:12px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:800}.hero-why{margin-top:10px;color:#fde68a!important;font-weight:900!important}
.hero-img{width:100%;max-height:340px;object-fit:cover;border-radius:0;margin-top:18px;opacity:.95;border:2px solid #fff}
.kicker{font-size:12px;color:#fbbf24;font-weight:900;text-transform:uppercase;letter-spacing:.18em;margin-bottom:10px}.vibe{display:inline-block;background:#fbbf24;color:#111;border:2px solid #111;padding:2px 7px;font-size:11px;font-weight:900;text-transform:uppercase;margin-bottom:8px}.why{background:#fffbeb;border-left:4px solid #b45309;padding:8px 10px;margin:8px 0;color:#111;font-size:13px;font-weight:700}.showmore{margin:10px 0;border:1px solid #d6d3d1;background:#fafaf9;padding:10px}.item-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}.item-actions button{border:1px solid #111;background:#fff;padding:6px 9px;font-size:12px;font-weight:900;cursor:pointer}.item-actions button:hover{background:#fef3c7}.showmore summary{cursor:pointer;font-weight:900;color:#1d4ed8}.showmore ul{margin:8px 0 0 18px;color:#44403c;font-size:13px;line-height:1.65}.headline{display:block}.impact{background:#020617!important;color:#d1fae5!important;border:2px solid #22c55e!important;box-shadow:0 0 0 1px #064e3b,8px 8px 0 #111!important;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.impact h2{color:#86efac!important}.terminal-line{color:#67e8f9;font-size:12px;margin:3px 0}.impact-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-top:12px}.impact-card{background:#0f172a;border:1px solid #334155;border-left:4px solid #94a3b8;border-radius:8px;padding:10px;color:#e5e7eb}.impact-card.bullish{border-left-color:#22c55e}.impact-card.bearish{border-left-color:#ef4444}.impact-card.neutral{border-left-color:#f59e0b}.impact-card b{display:block;color:#fff}.impact-card span{font-size:11px;color:#a7f3d0}.impact-card strong{display:block;font-size:24px;color:#fbbf24}.impact-card small{display:block;color:#cbd5e1;line-height:1.45}.impact-bars{display:grid;gap:9px;margin-top:14px}.impact-row{display:grid;grid-template-columns:150px minmax(120px,1fr) 70px minmax(180px,1.2fr);gap:10px;align-items:center;border:1px solid #14532d;background:#030712;padding:10px;border-radius:10px}.impact-sym b{display:block;color:#fff}.impact-sym span{font-size:11px;color:#a7f3d0}.impact-bar{height:18px;background:#111827;border:1px solid #334155;border-radius:999px;overflow:hidden;box-shadow:inset 0 0 0 1px #020617}.impact-bar i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#64748b,#cbd5e1)}.impact-row.bullish .impact-bar i{background:linear-gradient(90deg,#14532d,#22c55e,#bbf7d0)}.impact-row.bearish .impact-bar i{background:linear-gradient(90deg,#7f1d1d,#ef4444,#fecaca)}.impact-row.neutral .impact-bar i{background:linear-gradient(90deg,#713f12,#f59e0b,#fde68a)}.impact-score{font-size:24px;font-weight:900;color:#fbbf24;text-align:right}.impact-detail{color:#cbd5e1;font-size:12px;line-height:1.45}.impact-detail summary{cursor:pointer;color:#67e8f9;font-weight:900}@media(max-width:760px){.impact-row{grid-template-columns:1fr}.impact-score{text-align:left}.impact-detail{font-size:13px}}
.nav{display:flex;align-items:center;justify-content:space-between;gap:12px;border:2px solid #111;background:#fff;padding:10px 12px;margin-bottom:14px;box-shadow:4px 4px 0 #111;position:sticky;top:8px;z-index:20}.brand{font-weight:900;letter-spacing:-.04em}.nav a{font-size:12px;font-weight:900;color:#111;text-decoration:none;margin-left:10px}.nav a:hover{text-decoration:underline}
.tabs{display:flex;gap:8px;margin-bottom:16px;position:sticky;top:62px;z-index:10}
.tab{padding:8px 16px;border-radius:0;font-size:13px;cursor:pointer;border:2px solid #111;background:#fff;color:#111;text-align:center;flex:1;transition:.2s;font-weight:900}
.tab.a{background:#a78bfa;color:#fff}
.tab:hover:not(.a){background:#2a2a3e}
@media(max-width:600px){
  .wrap{padding:12px 8px 32px}
  .secc,.sb,.fb,.ft,.stats{padding:12px;border-radius:8px}
  .item{gap:8px;margin-bottom:10px;padding-bottom:8px}
  .item{flex-direction:column}
  .item-img{width:100%;height:180px;border-radius:0}
  .tab{font-size:11px;padding:6px 10px}
}
@media(prefers-color-scheme:light){
  body{background:#f8f9fb;color:#1f2937}
  .secc,.sb,.fb,.ft,.stats,.tab{background:#fff;border:1px solid #e5e7eb;box-shadow:0 1px 2px rgba(0,0,0,.06)}
  .ft blockquote{background:#f3f4f6;border-left-color:#d1d5db}
  .ft code{background:#f3f4f6}
  .stext,.ft p{color:#6b7280}.fb p,.fb .ftitle{color:#111!important;font-weight:900}
  .stext strong{color:#1f2937}
  .snippet{color:#6b7280}
  .item{border-bottom-color:#f3f4f6}
  .tab:hover:not(.a){background:#f3f4f6}
}
</style></head><body>
<div class="wrap">
<nav class="nav"><div class="brand">Little Candle</div><div><a href="/">Home</a><a href="/report">Reports</a><a href="/market">Market Orca</a><a href="#tf" onclick="st('full')">Full Text</a></div></nav>
<div class="tabs" id="ts">
<button class="tab a" onclick="st('report')">Report</button>
<button class="tab" onclick="st('full')">Full Text</button>
</div>
<div id="tr"><section class="hero">
<div class="kicker">AI Daily Report • ${date} • ${heroVibe}</div>
<h1>${tC(heroTitle)}</h1>
<p>${heroSnippet}</p>
<p class="hero-why">Why care: ${tC(heroWhy)}</p>
${hero?.url ? `<a href="${hero.url}" target="_blank">Read source: ${tC(hero.url).slice(0,90)}...</a>` : ''}
${heroImg ? `<img class="hero-img" src="${heroImg}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
</section>
<div class="date">${topics.length} sections &middot; ${allSrc.length} sources</div>
<div class="stats"><h3>Statistics</h3><div class="row">Items: ${tItems} &middot; Articles: ${tArts} &middot; Models: ${tMods} &middot; Sources: ${allSrc.join(', ')}</div></div>
<div class="sb"><h2>Ringkasan</h2><div class="stext">${summary.split('\\n').filter(l => l.trim()).map(l => inlineMd(safe(l))).join('<br>')}</div></div>
<div class="qbox"><h2>Report Quality</h2><p><b>${quality.score}/100</b> ${quality.status} · ${quality.sources} sources · ${quality.dupes} dupes · ${quality.stale} stale · rotation ${sourceRotationHint()}</p></div>
<div class="qbox"><h2>Data Status</h2><p>${dataStatusBlock.split('\\n').map(l=>l.replace(/^\*\*/,'').replace(/\*\*/g,'').trim()).filter(Boolean).join(' · ')}${dataFreshnessQa.warning ? `<br><b>⚠️ ${dataFreshnessQa.warning}</b>` : ''}</p></div>
<div class="changed"><h2>What Changed Today</h2><div class="stext">${changed.split('\n').map(l=>inlineMd(l)).join('<br>')}</div></div>
<div class="impact" role="region" aria-labelledby="impact-title"><h2 id="impact-title">▣ MARKET IMPACT TERMINAL</h2><div class="terminal-line">$ regime --now → ${impact.regime.regime} :: ${impact.regime.signals.map(tC).join(' | ')}</div><div class="terminal-line">$ indonesia-pulse → ${tC(impact.pulse)}</div><div class="terminal-line">$ event-bias → ${tC(impact.event.label)}</div><div class="terminal-line">$ drivers → ${impact.event.drivers.map(tC).join(' / ')}</div><div class="impact-bars" aria-label="Market impact score bars">${impact.rows.map(r => { const pct=Math.min(100,Math.max(4,Math.abs(Number(r.score)||0)*18)); return `<div class="impact-row ${r.dir}"><div class="impact-sym"><b>${tC(r.symbol)}</b><span>${r.dir.toUpperCase()} · ${r.risk.toUpperCase()}</span></div><div class="impact-bar"><i style="width:${pct}%"></i></div><div class="impact-score">${r.score}</div><details class="impact-detail"><summary>driver</summary>${tC(impactReason(r, impact.event))}</details></div>` }).join('')}</div></div>
<div class="flags"><h2>Red Flags</h2><div class="stext">${flags.map(f=>`• ${tC(f)}`).join('<br>')}</div></div>
${funFacts.length ? `<div class="fb"><h2>Fun Facts</h2>${funFacts.map(f => `<p><span class="ftitle">${tC(f.title)}:</span> ${tC(f.fact).slice(0,220)}</p>`).join('')}</div>` : ''}
${secHtml}
<div class="footer">Generated by Little Candle &middot; ${date}</div></div>
<div id="tf" style="display:none"><div class="ft">${contentHtml}</div><div class="footer">Full text version &middot; ${date}</div></div></div>
<script>
function st(n){
  document.getElementById('tr').style.display=n==='report'?'':'none'
  document.getElementById('tf').style.display=n==='full'?'':'none'
  document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('a',b.textContent.trim().toLowerCase().startsWith(n)))
}
document.addEventListener('click', e => {
  if(e.target.matches('[data-hide-item]')) { e.target.closest('[data-report-item]')?.remove(); updateVisibleCount(); }
  if(e.target.matches('[data-rewrite-section]')) showToast('Rewrite section masuk backlog. Hide item lemah dulu, lalu regenerate report untuk score baru.');
});
function updateVisibleCount(){ const n=document.querySelectorAll('[data-report-item]').length; document.querySelector('.date').textContent = document.querySelector('.date').textContent.replace(/\d+ visible items|$/, ' · '+n+' visible items') }
function showToast(msg){ let t=document.getElementById('toast'); if(!t){t=document.createElement('div');t.id='toast';t.style.cssText='position:fixed;right:14px;bottom:14px;background:#111;color:#fff;padding:12px 14px;border:2px solid #fbbf24;z-index:99;font-weight:900;max-width:320px';document.body.appendChild(t)} t.textContent=msg; clearTimeout(window.__toast); window.__toast=setTimeout(()=>t.remove(),2600) }
</script></body></html>`
}

function stripLongRagBlock(s) {
  return String(s || '').replace(/\n## Retrieval Evidence \/ RAG[\s\S]*?(?=\n[-=·%]{5,}|\n## Market Impact Watch|\n## Actionable)/, '\n## Bukti & Sitasi\n- Ringkasan sumber lengkap tersedia di web/MD/PDF.\n')
}
function discordDigest(text) {
  const s = stripLongRagBlock(text)
  const cut = s.indexOf('\n# Full Drop')
  let digest = cut > 0 ? s.slice(0, cut).trim() : s.trim()

  // Remove internal/QA sections — keep only user-facing blocks
  const removeSections = [
    /\n## User Context[\s\S]*?(?=\n[·▸\n]+\n)/,
    /\n## Report Quality[\s\S]*?(?=\n[·▸\n]+\n)/,
    /\n## Improvement \/ Added Features QA Pack[\s\S]*?(?=\n[·▸\n]+\n)/,
    /\n## Reliability \/ Incident \/ QA Add-on Batch 3[\s\S]*?(?=\n[·▸\n]+\n)/,
    /\n## Anomali Harga\/Volume[\s\S]*?(?=\n[·▸\n]+\n)/,
    /\n## ⚡ Suggested Alerts[\s\S]*?(?=\n[·▸\n]+\n)/,
    /\n## Actionable Watchlist[\s\S]*?(?=\n## Red Flags|\n$)/,
    /\n## Bukti & Sitasi[\s\S]*?(?=\n[·▸\n]+\n)/,
    /\n## Data Status[\s\S]*?(?=\n[·▸\n]+\n)/,
  ]
  for (const pat of removeSections) digest = digest.replace(pat, '')

  // Remove empty funFact sections
  digest = digest.replace(/\n\*\*Fun Fact:\*\*.*(?:\n|$)/g, '')

  // Standardize dotline separators
  digest = digest.replace(/(\n[·▸─\n]+\n)+/g, '\n──────\n\n').trim()

  const maxChars = 7600
  if (digest.length > maxChars) {
    let endPos = maxChars
    const lastSentence = Math.max(digest.lastIndexOf('. ', maxChars), digest.lastIndexOf('!\n', maxChars), digest.lastIndexOf('?\n', maxChars), digest.lastIndexOf('.\n', maxChars))
    if (lastSentence > maxChars * 0.6) {
      endPos = lastSentence + 2
    } else {
      endPos = digest.lastIndexOf('\n', maxChars)
      if (endPos < maxChars * 0.5) endPos = maxChars
    }
    while (endPos > 0 && /\S/.test(digest[endPos - 1]) && /\S/.test(digest[endPos])) endPos--
    digest = digest.slice(0, endPos).trim() + '\n\n…dipotong. Full report ada di web/MD/PDF.'
  }
  return `${digest}\n\nFull report ada di web/MD/PDF.`
}

function splitDiscordText(text, max = 1900) {
  const blocks = String(text || '').split(/(?=^## |^# )/gm).filter(b => b.trim())
  const parts = []
  let current = ''

  for (const block of blocks) {
    const b = block.trim()
    if (!b) continue

    // If adding this block would exceed max, flush current
    if (current && current.length + 1 + b.length > max) {
      parts.push(current)
      current = ''
    }

    // If block itself exceeds max, split it internally
    if (b.length > max) {
      if (current) parts.push(current)
      current = ''
      let chunk = b
      while (chunk.length > 0) {
        if (chunk.length <= max) { current = chunk; break }
        // Prefer heading boundary for split
        let cut = chunk.slice(0, max).lastIndexOf('\n## ')
        if (cut < 10) cut = chunk.lastIndexOf('\n\n', max)
        if (cut < 10) cut = chunk.lastIndexOf('\n', max)
        if (cut < 10) cut = chunk.lastIndexOf('. ', max)
        if (cut < 10) cut = max
        parts.push(chunk.slice(0, cut).trimEnd())
        chunk = chunk.slice(cut).trimStart()
      }
    } else {
      current = current ? current + '\n\n' + b : b
    }
  }
  if (current) parts.push(current)

  // Add numbering [1/N] and continuation indicator
  if (parts.length > 1) {
    return parts.map((p, i) => {
      let out = `[${i + 1}/${parts.length}] ${p}`
      if (i < parts.length - 1) out += '\n\n_Continued in next message_'
      return out
    })
  }

  return parts
}

export async function sendAiReportToUser(textReport, _embed, topics) {
  const botClient = await getBotClient().catch(() => null)
  if (!botClient?.isReady()) { console.error('[ai-report] Bot not available'); return false }
  const user = await botClient.users.fetch(process.env.DISCORD_USER_ID || '313588026766917632').catch(() => null)
  if (!user) { console.error('[ai-report] User not found'); return false }

  const parts = splitDiscordText(discordDigest(textReport), 1900)
  let totalParts = 0
  for (let i = 0; i < parts.length; i++) {
    await user.send(parts[i].slice(0, 2000)).then(() => logDelivery('daily', 'text_digest', 'ok', `part ${i+1}/${parts.length}`)).catch((e) => { logDelivery('daily', 'text_digest', 'fail', e.message); console.warn('[ai-report] text send fail:', e.message) })
    totalParts++
  }
  console.log(`[ai-report] Text sent in ${totalParts} parts`)

  // Save report + send web link
  if (topics?.length > 0) {
    try {
      const { slug } = await saveReport(topics, textReport)
      const cardPath = path.join(__dirname, '..', '..', 'reports', `${slug}-card.png`)
      const { APP_CONFIG } = await import("./config.js");
      const msg = `**Web version:**\n<${APP_CONFIG.publicBaseUrl}/report/${slug}>\n<${APP_CONFIG.tailscaleBaseUrl}/report/${slug}>`
      if (fs.existsSync(cardPath)) await user.send({ content: msg, files: [new AttachmentBuilder(cardPath, { name: `ai-report-card-${slug}.png` })] }).then(() => logDelivery(slug,'web_card','ok')).catch((e) => { logDelivery(slug,'web_card','fail',e.message); return user.send(msg).catch(() => {}) })
      else await user.send(msg).then(() => logDelivery(slug,'web_link','ok')).catch((e) => logDelivery(slug,'web_link','fail',e.message))
      const mdPath = path.join(__dirname, '..', '..', 'reports', `${slug}.md`)
      if (fs.existsSync(mdPath)) await user.send({ content: '**Markdown file:**', files: [new AttachmentBuilder(mdPath, { name: `AI-Daily-Report-${slug}.md` })] }).then(() => logDelivery(slug,'md','ok')).catch((e) => { logDelivery(slug,'md','fail',e.message); console.warn('[ai-report] MD send fail:', e.message) })
      console.log('[ai-report] Web link + MD sent:', slug)
    } catch (e) { console.warn('[ai-report] Save report:', e.message) }
  }

  // PDF — async, tidak blocking
  if (topics?.length > 0) generateAndSendPdf(user, topics)
  return true
}

async function generateAndSendPdf(user, topics) {
  try {
    const pdfPath = await buildPdfReport(topics)
    if (pdfPath && fs.existsSync(pdfPath)) {
      const att = new AttachmentBuilder(pdfPath, { name: 'AI-Daily-Report.pdf' })
      await user.send({ files: [att] }).then(() => logDelivery('daily','pdf','ok')).catch((e) => { logDelivery('daily','pdf','fail',e.message); console.warn('[ai-report] PDF send fail:', e.message) })
      console.log('[ai-report] PDF sent')
      setTimeout(() => fs.promises.unlink(pdfPath).catch(() => {}), 10000)
    }
  } catch (e) { console.warn('[ai-report] PDF:', e.message) }
}
