#!/usr/bin/env node
/**
 * Market Orca — Rich Market News Sender
 * 
 * Fetches latest market news from backend API + SearXNG,
 * formats as rich Discord embeds (w/ images, summaries, links),
 * sends to market_channel_id (1517112059358220289).
 * 
 * Usage: node scripts/market-news-sender.js [--dry-run]
 * Cron: every 4h
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TOPICS_FILE = path.join(__dirname, '..', 'collections', 'autolearn-topics.json')
const SENT_CACHE = path.join(__dirname, '..', 'collections', 'market-news-sent.json')
const API_BASE = process.env.API_BASE || 'http://127.0.0.1:4567'
const SEARXNG_URL = process.env.SEARXNG_URL || 'http://127.0.0.1:18080'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const forceSend = args.includes('--force')

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`) }

function loadSentCache() {
  if (fs.existsSync(SENT_CACHE)) {
    try { return JSON.parse(fs.readFileSync(SENT_CACHE, 'utf8')) } catch {}
  }
  return {}
}

async function fetchBackendNews() {
  try {
    const res = await fetch(`${API_BASE}/api/news/latest?limit=15&time_range=day`, {
      signal: AbortSignal.timeout(15000)
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    log('  ⚠️ Backend news fetch failed')
    return null
  }
}

async function fetchSearxngNews(query, limit = 8) {
  try {
    const url = `${SEARXNG_URL.replace(/\/$/, '')}/search?q=${encodeURIComponent(query)}&format=json&categories=news&language=id,en&time_range=week&safesearch=0`
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
    const data = await res.json()
    return (data.results || []).slice(0, limit)
  } catch { return [] }
}

async function fetchPageMeta(url) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Mozilla/5.0 (MarketOrcaBot/2.0)' }
    })
    if (!res.ok) return null
    const html = await res.text()
    const image = (html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i)?.[1] ||
                   html.match(/<meta[^>]*name="twitter:image"[^>]*content="([^"]+)"/i)?.[1] ||
                   html.match(/<img[^>]*src="([^"]+\.(?:jpg|jpeg|png|webp))"/i)?.[1] || '')
    const desc = (html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i)?.[1] ||
                  html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i)?.[1] || '')
    return { image: image.slice(0, 500), description: desc.slice(0, 300) }
  } catch { return null }
}

function buildRichEmbed(title, url, snippet, source, image, publishedAt) {
  source = source || 'unknown'
  const color = embedColor(source)
  const embed = {
    title: title?.slice(0, 100) || 'Berita Pasar',
    url: url || undefined,
    color,
    description: snippet?.slice(0, 200) || undefined,
    timestamp: publishedAt ? new Date(publishedAt).toISOString() : undefined,
    image: image ? { url: image } : undefined,
    footer: { text: `📡 ${source} • Market Orca` },
    fields: []
  }

    // Source credibility badge
    const cred = getCredibility(source)
    if (cred) {
      embed.fields.push({
        name: '🎯 Sumber',
        value: `${cred.badge} ${cred.label}`,
        inline: true
      })
    }

  if (publishedAt) {
    embed.fields.push({
      name: '🕐 Publikasi',
      value: new Date(publishedAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' }),
      inline: true
    })
  }

  return embed
}

function embedColor(source) {
  const s = (source || '').toLowerCase()
  if (s.includes('bi.go.id') || s.includes('idx.co.id') || s.includes('ojk.go.id')) return 0x1E88E5 // Blue (official)
  if (s.includes('bloomberg') || s.includes('reuters') || s.includes('wsj') || s.includes('ft.com')) return 0xFF6F00 // Amber (global)
  if (s.includes('cnbc') || s.includes('cnn') || s.includes('kompas') || s.includes('detik')) return 0x43A047 // Green (mainstream)
  if (s.includes('katadata') || s.includes('kontan') || s.includes('bisnis.com') || s.includes('tempo')) return 0x8E24AA // Purple (financial)
  return 0x00D4AA // Default teal
}

function getCredibility(source) {
  const s = (source || '').toLowerCase()
  if (s.includes('bi.go.id') || s.includes('idx.co.id') || s.includes('ojk.go.id')) return { badge: '🏛️', label: 'Resmi/Otoritas' }
  if (s.includes('bloomberg') || s.includes('reuters') || s.includes('wsj') || s.includes('ft.com')) return { badge: '🌍', label: 'Global' }
  if (s.includes('cnbc') || s.includes('cnn') || s.includes('kompas') || s.includes('detik')) return { badge: '📺', label: 'Media Utama' }
  if (s.includes('katadata') || s.includes('kontan') || s.includes('bisnis.com') || s.includes('tempo')) return { badge: '📊', label: 'Keuangan' }
  if (s.includes('investing') || s.includes('tradingview') || s.includes('yahoo')) return { badge: '📈', label: 'Data Pasar' }
  return null
}

function dedupe(items) {
  const seen = new Set()
  return items.filter(i => {
    const key = i.url?.replace(/[?#].*/, '')
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function main() {
  log('═══════════════════════════════════════')
  log('🐋 Market News Sender — Rich Embeds')
  log('═══════════════════════════════════════')

  const sentCache = loadSentCache()
  const dayKey = new Date().toISOString().split('T')[0]
  const hourKey = `${dayKey}T${String(new Date().getHours()).padStart(2, '0')}`

  if (!forceSend && sentCache['_lastSent'] === hourKey) {
    log('⏭️ Already sent this hour, use --force to override')
    console.log(JSON.stringify({ ok: true, skipped: true, reason: 'already_sent_this_hour', timestamp: new Date().toISOString() }))
    return
  }

  // 1. Fetch from backend news API
  log('📡 Fetching news from backend...')
  let items = []
  const backendNews = await fetchBackendNews()
  if (backendNews?.results?.length) {
    log(`  ✅ ${backendNews.count} news from backend`)
    items.push(...backendNews.results.map(n => ({
      title: n.title, url: n.url, snippet: n.snippet,
      source: n.source, publishedAt: n.publishedAt,
      engine: 'backend'
    })))
  }

  // 2. Supplement with SearXNG direct from topic queries
  if (fs.existsSync(TOPICS_FILE)) {
    const config = JSON.parse(fs.readFileSync(TOPICS_FILE, 'utf8'))
    for (const topic of config.topics) {
      if (!topic.enabled) continue
      const query = topic.queries[0] || topic.name
      log(`  🔍 SearXNG: "${query}"`)
      const results = await fetchSearxngNews(query, 4)
      items.push(...results.map(r => ({
        title: r.title, url: r.url, snippet: r.content || r.snippet,
        source: (r.url ? new URL(r.url).hostname.replace(/^www\./, '') : ''),
        publishedAt: r.publishedDate || '', engine: 'searxng',
        thumbnail: r.thumbnail || ''
      })))
      await new Promise(r => setTimeout(r, 1000))
    }
  }

  // Deduplicate
  items = dedupe(items)
  log(`📊 Total unique items: ${items.length}`)

  if (items.length === 0) {
    log('❌ No news items found')
    console.log(JSON.stringify({ ok: false, error: 'no_news', timestamp: new Date().toISOString() }))
    return
  }

  // Fetch images for top items
  log('🖼️ Fetching images/metadata...')
  const topItems = items.slice(0, 4)
  for (let i = 0; i < topItems.length; i++) {
    if (topItems[i].source === 'unknown') continue
    const meta = await fetchPageMeta(topItems[i].url)
    if (meta) {
      topItems[i].image = meta.image || topItems[i].thumbnail
      topItems[i].description = meta.description
    }
  }

  // Build rich embeds
  const embeds = topItems.map(item => buildRichEmbed(
    item.title, item.url,
    item.description || item.snippet,
    item.source, item.image,
    item.publishedAt || item.publishedDate
  ))

  // Add summary/intro embed
  const now = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'full', timeStyle: 'short' })
  const headerEmbed = {
    title: `📰 Market News — ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'long' })}`,
    description: `Ringkasan ${items.length} berita pasar terbaru dari sumber terpercaya.\n\n🐋 *Market Orca • ${now}*`,
    color: 0x00D4AA,
    fields: [
      { name: '📊 Topik', value: 'IHSG, USD/IDR, Crypto, Global, AI/Tech', inline: true },
      { name: '📡 Sumber', value: `${new Set(items.map(i => i.source)).size} source`, inline: true }
    ]
  }

  const allEmbeds = [headerEmbed, ...embeds]

  // Send via backend API
  if (!dryRun) {
    try {
      const res = await fetch(`${API_BASE}/api/discord/market-news`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embeds: allEmbeds }),
        signal: AbortSignal.timeout(15000)
      })
      const result = await res.json()
      if (result.ok || result.sent) {
        log(`✅ ${embeds.length} rich embeds sent to market channel`)
        sentCache['_lastSent'] = hourKey
        fs.writeFileSync(SENT_CACHE, JSON.stringify(sentCache, null, 2))
      } else {
        log(`❌ API failed: ${result.error || 'unknown'}`)
      }
    } catch (err) {
      log(`❌ Send failed: ${err.message}`)
    }
  } else {
    log(`🧪 DRY RUN: ${embeds.length} embeds prepared`)
    log(`  Header: ${headerEmbed.title}`)
    for (const e of embeds.slice(0, 2)) {
      log(`  📰 ${e.title?.slice(0, 50)} | ${e.image ? '🖼️' : '📄'} | ${e.description?.slice(0, 40)}...`)
    }
  }

  log('═══════════════════════════════════════')
  console.log(JSON.stringify({ ok: true, sent: !dryRun, embeds: embeds.length, items: items.length, timestamp: new Date().toISOString() }))
}

main().catch(err => { log(`❌ Fatal: ${err.message}`); process.exit(1) })