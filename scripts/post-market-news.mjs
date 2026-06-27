#!/usr/bin/env node
// Market Orca — Post Market News to Discord
// Fetches news via MCP, extracts og:image, posts rich embeds with links
import fs from 'node:fs'
import path from 'node:path'

const BACKEND = 'http://localhost:4567'
const NEWS_CHANNEL = '1517112059358220289'

// ─── Env loader ─────────────────────────────────────────────────────────
const envPath = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'backend', '.env')
const env = {}
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  if (!line || line.startsWith('#')) continue
  const i = line.indexOf('=')
  if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim()
}

// ─── Fetch og:image from a URL (lightweight, no full page render) ──────
async function fetchOgImage(url) {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 MarketOrca/1.0' },
      signal: AbortSignal.timeout(5000),
      redirect: 'follow'
    })
    if (!r.ok) return null
    // Read only first 8KB for meta tags
    const reader = r.body.getReader()
    let buf = ''
    for (let i = 0; i < 3; i++) {
      const { done, value } = await reader.read()
      if (done) break
      buf += new TextDecoder().decode(value)
      if (buf.includes('og:image') || buf.includes('twitter:image')) break
    }
    // Extract og:image
    const ogMatch = buf.match(/property="og:image"\s+content="([^"]+)"/)
    if (ogMatch) return ogMatch[1]
    const twMatch = buf.match(/name="twitter:image"\s+content="([^"]+)"/)
    if (twMatch) return twMatch[1]
  } catch {}
  return null
}

// ─── Fetch news from MCP ───────────────────────────────────────────────
async function fetchNews() {
  const r = await fetch(`${BACKEND}/mcp/tool/web.news_search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.MCP_AUTH_TOKEN}` },
    body: JSON.stringify({ query: 'market Indonesia IHSG saham', limit: 6 })
  })
  if (!r.ok) throw new Error(`news fetch ${r.status}`)
  const d = await r.json()
  return d.results || []
}

// ─── Send embeds to Discord channel ────────────────────────────────────
async function sendToChannel(token, channelId, payload) {
  const r = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bot ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  if (!r.ok) {
    const err = await r.text()
    throw new Error(`Discord ${r.status}: ${err.slice(0, 200)}`)
  }
  return r.json()
}

// ─── Main ──────────────────────────────────────────────────────────────
async function main() {
  const token = env.DISCORD_BOT_TOKEN
  if (!token) throw new Error('No DISCORD_BOT_TOKEN')

  console.log('Fetching news...')
  const news = await fetchNews()
  if (!news.length) { console.log('No news found'); return }
  console.log(`Found ${news.length} items, fetching images...`)

  // Fetch og:image for each news item (parallel, with timeout)
  const enriched = await Promise.allSettled(news.map(async (n) => {
    const image = await fetchOgImage(n.url)
    return { ...n, image }
  }))

  const items = enriched.map(r => r.status === 'fulfilled' ? r.value : r.reason).filter(Boolean)

  // Build rich embeds
  const embeds = items.map((n, i) => {
    const source = n.domain || n.source || 'Unknown'
    const pubDate = n.published_at
      ? `<t:${Math.floor(new Date(n.published_at).getTime() / 1000)}:R>`
      : 'Baru saja'

    return {
      title: (n.title || 'Market News').slice(0, 256),
      url: n.url,
      description: (n.snippet || n.description || '').slice(0, 400),
      color: [0x1a1a2e, 0x0f3460, 0x16213e, 0x533483, 0xe94560, 0xf59e0b][i % 6],
      fields: [
        { name: '📡 Source', value: `**${source}**`, inline: true },
        { name: '🕐 Published', value: pubDate, inline: true },
      ],
      image: n.image ? { url: n.image } : undefined,
      thumbnail: !n.image ? { url: `${env.PUBLIC_BASE_URL || 'https://market-orca.anomali.web.id'}/favicon.ico` } : undefined,
      footer: { text: `Market Orca • ${i + 1}/${items.length} • Tap untuk baca` },
      timestamp: new Date().toISOString()
    }
  })

  const dateStr = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })

  await sendToChannel(token, NEWS_CHANNEL, {
    content: `📰 **Market News Update — ${dateStr}**`,
    embeds
  })
  console.log(`✅ Posted ${items.length} news items with ${items.filter(n => n.image).length} images to #market-orca`)
}

main().catch(e => { console.error('❌', e.message); process.exit(1) })
