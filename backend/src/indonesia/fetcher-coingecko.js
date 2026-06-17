/**
 * CoinGecko fetcher — crypto prices in IDR
 * Free API, no auth needed
 */
import { saveCrypto, getLatestCrypto } from './db.js'

const CG_BASE = 'https://api.coingecko.com/api/v3'
const TIMEOUT = 15000

const COINS = ['bitcoin', 'ethereum', 'solana', 'chainlink', 'cardano']
const COIN_MAP = {
  bitcoin: 'Bitcoin', ethereum: 'Ethereum', solana: 'Solana',
  chainlink: 'Chainlink', cardano: 'Cardano'
}

async function cgFetch(url) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT)
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'Accept': 'application/json' } })
    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`)
    return await res.json()
  } finally { clearTimeout(t) }
}

// ── Current prices in IDR ─────────────────────────────────────
export async function fetchCryptoPrices() {
  try {
    const url = `${CG_BASE}/simple/price?ids=${COINS.join(',')}&vs_currencies=idr&include_24hr_change=true`
    const data = await cgFetch(url)
    const prices = []
    for (const coin of COINS) {
      const info = data[coin]
      if (!info?.idr) continue
      const priceIdr = info.idr
      const change24h = info.idr_24h_change || 0
      prices.push({ coin, name: COIN_MAP[coin] || coin, price_idr: priceIdr, change_24h: Number(change24h.toFixed(2)) })
      saveCrypto(coin, priceIdr, Number(change24h.toFixed(2)), 'coingecko')
    }
    return { prices, fetchedAt: new Date().toISOString() }
  } catch (e) {
    console.error('[fetcher-coingecko] fetchCryptoPrices error:', e.message)
    const cached = getLatestCrypto()
    if (cached.length) {
      return { prices: cached.map(r => ({ coin: r.coin, price_idr: r.price_idr, change_24h: r.change_24h })), fetchedAt: new Date().toISOString(), cached: true }
    }
    throw e
  }
}

// ── Historical prices (1 year) for a coin ────────────────────
export async function fetchCryptoHistory(coinId = 'bitcoin', days = 365) {
  try {
    const url = `${CG_BASE}/coins/${coinId}/market_chart?vs_currency=idr&days=${days}`
    const data = await cgFetch(url)
    const prices = (data.prices || []).map(([ts, price]) => ({
      date: new Date(ts).toISOString().split('T')[0],
      price_idr: price
    }))
    return { coin: coinId, prices, fetchedAt: new Date().toISOString() }
  } catch (e) {
    console.error(`[fetcher-coingecko] fetchCryptoHistory ${coinId}:`, e.message)
    throw e
  }
}

export { COINS, COIN_MAP }
