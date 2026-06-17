import { db } from './db.js'

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'market-orca/1.0' } })
  if (!res.ok) throw new Error(`Search failed ${res.status}`)
  return res.json()
}

function scoreQuote(q, query) {
  const text = `${q.symbol || ''} ${q.shortname || ''} ${q.longname || ''}`.toLowerCase()
  const qq = query.toLowerCase()
  let score = 0
  if ((q.symbol || '').toLowerCase() === qq) score += 100
  if ((q.shortname || '').toLowerCase().includes(qq)) score += 60
  if ((q.longname || '').toLowerCase().includes(qq)) score += 60
  if (text.startsWith(qq)) score += 20
  if ((q.quoteType || '') === 'EQUITY') score += 15
  if ((q.exchange || q.exchDisp || '').match(/JKT|NMS|NYQ|NCM|NAS/)) score += 10
  return score
}

function inferMarket(exchange = '', symbol = '') {
  if (/JKT|IDX/i.test(exchange) || symbol.endsWith('.JK')) return 'IDX'
  if (/NMS|NAS|NYQ|PCX|ASE/i.test(exchange)) return 'US'
  if (/USD|USDT|BTC|ETH|SOL|DOGE|SHIB|PEPE/i.test(symbol)) return 'CRYPTO'
  return 'US'
}

function inferCategory(type = '', symbol = '') {
  if (/INDEX/i.test(type)) return 'index'
  if (/CRYPTO/i.test(type) || /USD|USDT/i.test(symbol)) return 'crypto'
  if (/CURRENCY/i.test(type)) return 'forex'
  return 'stock'
}

function makeSlug(symbol = '') {
  return symbol.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

export async function searchSymbols(query) {
  if (!query || query.trim().length < 2) return []
  const q = query.trim()
  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=30&newsCount=0`
  const data = await fetchJson(url)
  return (data.quotes || [])
    .filter((item) => item.symbol && (item.shortname || item.longname))
    .map((item) => ({
      symbol: item.symbol,
      name: item.shortname || item.longname,
      fullName: item.longname || item.shortname || '',
      exchange: item.exchange || item.exchDisp || '',
      type: item.quoteType || '',
      score: scoreQuote(item, q),
      slug: makeSlug(item.symbol),
      market: inferMarket(item.exchange || item.exchDisp || '', item.symbol),
      category: inferCategory(item.quoteType || '', item.symbol),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
}

export function importAssetFromSearch(item) {
  const slug = makeSlug(item.symbol)
  const existing = db.prepare('SELECT * FROM assets WHERE slug = ?').get(slug)
  if (existing) return existing
  const market = inferMarket(item.exchange || '', item.symbol)
  const category = inferCategory(item.type || '', item.symbol)
  db.prepare(`INSERT INTO assets (slug, symbol, name, market, category, price, change_percent, thesis) VALUES (?, ?, ?, ?, ?, 0, 0, ?)`)
    .run(slug, item.symbol, item.fullName || item.name || item.symbol, market, category, 'Asset hasil import dari search live.')
  db.prepare(`INSERT INTO asset_settings (asset_slug, threshold_up, threshold_down, watch_enabled, updated_at) VALUES (?, 2, -2, 1, datetime('now')) ON CONFLICT(asset_slug) DO UPDATE SET updated_at=datetime('now')`)
    .run(slug)
  return db.prepare('SELECT * FROM assets WHERE slug = ?').get(slug)
}
