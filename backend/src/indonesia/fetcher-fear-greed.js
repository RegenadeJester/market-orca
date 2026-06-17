/**
 * Fear & Greed Index fetcher
 * API: https://api.alternative.me/fng/
 */
import { saveFearGreed, getLatestFearGreed } from './db.js'

const FG_URL = 'https://api.alternative.me/fng/?limit=30'
const TIMEOUT = 10000

export async function fetchFearGreedIndex() {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), TIMEOUT)
    const res = await fetch(FG_URL, { signal: ctrl.signal, headers: { 'Accept': 'application/json' } })
    clearTimeout(t)
    if (!res.ok) throw new Error(`Fear & Greed HTTP ${res.status}`)
    const data = await res.json()
    const entries = data?.data || []
    if (!entries.length) throw new Error('No fear/greed data')

    const current = entries[0]
    const value = parseInt(current.value)
    const classification = current.value_classification
    const history = entries.map(e => ({
      value: parseInt(e.value),
      classification: e.value_classification,
      timestamp: parseInt(e.timestamp) * 1000
    })).reverse()

    saveFearGreed(value, classification, history)

    return {
      value,
      classification,
      timestamp: parseInt(current.timestamp) * 1000,
      history,
      source: 'alternative.me',
      fetchedAt: new Date().toISOString()
    }
  } catch (e) {
    console.error('[fetcher-fear-greed] error:', e.message)
    const cached = getLatestFearGreed()
    if (cached) {
      return {
        value: cached.value,
        classification: cached.classification,
        history: JSON.parse(cached.history_json || '[]'),
        source: 'cache',
        fetchedAt: new Date().toISOString(),
        cached: true
      }
    }
    // Ultimate fallback
    return { value: 50, classification: 'Neutral', history: [], source: 'fallback', fetchedAt: new Date().toISOString() }
  }
}
