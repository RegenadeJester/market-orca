#!/usr/bin/env node
import fetch from 'node:fetch'
import fs from 'node:fs'
import path from 'node:path'

const BACKEND = 'http://localhost:4567'
const CHANNEL_ID = '1517112059358220289'

async function fetchNews(limit = 5) {
  const r = await fetch(`${BACKEND}/api/news?limit=${limit}`)
  if (!r.ok) throw new Error(`news fetch ${r.status}`)
  const d = await r.json()
  return d.news || d.items || []
}

async function postToDiscord(news) {
  const webhook = process.env.DISCORD_WEBHOOK_URL || process.env.DISCORD_MARKET_WEBHOOK
  if (!webhook) throw new Error('No DISCORD_WEBHOOK_URL or DISCORD_MARKET_WEBHOOK env')

  const embeds = news.slice(0, 5).map(n => ({
    title: n.title?.slice(0, 256) || 'Market News',
    url: n.url,
    description: (n.snippet || n.description || '').slice(0, 400),
    color: 0x1a1a2e,
    fields: [
      { name: '📡 Source', value: n.source || 'Unknown', inline: true },
      { name: '🕐 Published', value: n.publishedAt ? `<t:${Math.floor(new Date(n.publishedAt).getTime()/1000)}:R>` : 'N/A', inline: true }
    ],
    footer: { text: 'Market Orca • Market News' },
    timestamp: new Date().toISOString()
  }))

  await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      content: `📰 **Market News Update** — ${news.length} items`,
      embeds 
    })
  })
}

async function main() {
  try {
    const news = await fetchNews(6)
    if (!news.length) {
      console.log('No news found')
      return
    }
    await postToDiscord(news)
    console.log(`Posted ${news.length} news items to Discord`)
  } catch (e) {
    console.error('Error:', e.message)
    process.exit(1)
  }
}

main()
