/**
 * Canonical Data Normalizer
 *
 * market-data.js returns `changePercent` (camelCase)
 * live-data.js  returns `change_percent` (snake_case)
 * discord-embeds.js uses `?? ` fallback → fragile, misses values
 *
 * This module normalises any asset/pair data to a single canonical shape.
 */
export const CANONICAL_KEYS = [
  'symbol', 'price', 'changePercent', // *always present*
  'name', 'slug', 'market', 'currency', 'marketState', 'exchange', 'longName',
  'previousClose',
  'change',         // absolute change value
  'changePercent',  // canonical: *always* camelCase
  'fetchedAt',
]

/** Convert any object to canonical asset shape (camelCase wins) */
export function normalizeAsset(data = {}) {
  const out = { ...data }

  // ── changePercent: try camelCase first, fallback snake_case ──────
  if (out.changePercent == null && out.change_percent != null) {
    out.changePercent = Number(out.change_percent)
  }
  if (out.changePercent == null && out.changePercent != null) {
    // already set or undefined
  }
  if (out.changePercent != null) out.changePercent = Number(out.changePercent)
  delete out.change_percent

  // ── change: absolute change ──────────────────────────────────────
  if (out.change == null && out.change_abs != null) {
    out.change = Number(out.change_abs)
  }
  if (out.change != null) out.change = Number(out.change)

  // ── price ────────────────────────────────────────────────────────
  if (out.price != null) out.price = Number(out.price)

  // ── previousClose ────────────────────────────────────────────────
  if (out.previousClose == null && out.previous_close != null) {
    out.previousClose = Number(out.previous_close)
  }
  delete out.previous_close

  // ── chain helpers ────────────────────────────────────────────────
  if (out.symbol && !out.slug) {
    out.slug = String(out.symbol).toLowerCase().replace(/[^a-z0-9]/g, '-')
  }

  return out
}

/**
 * Normalize a batch of assets (e.g. forex pairs, crypto list).
 */
export function normalizeAssets(list = []) {
  return list.map(normalizeAsset)
}

/**
 * Normalize an IHSG / index result.
 * market-data.js returns `changePercent` (already camelCase, but double-check).
 */
export function normalizeIndex(data = {}) {
  const out = { ...data }

  if (out.changePercent == null && out.change_percent != null) {
    out.changePercent = Number(out.change_percent)
  }
  delete out.change_percent

  if (out.change == null && out.change_abs != null) {
    out.change = Number(out.change_abs)
  }
  if (out.price != null) out.price = Number(out.price)

  return out
}

/**
 * Get a safe display percent (always returns a number).
 */
export function pct(data = {}) {
  const v = data.changePercent ?? data.change_percent
  return (v != null ? Number(v) : 0)
}

/**
 * Safe display price with locale formatting.
 */
export function displayPrice(val, locale = 'id-ID') {
  const n = Number(val)
  if (!n) return '0'
  if (n > 100000) return n.toLocaleString(locale, { maximumFractionDigits: 0 })
  if (n > 100) return n.toLocaleString(locale, { maximumFractionDigits: 1 })
  if (n > 1) return n.toLocaleString(locale, { maximumFractionDigits: 4 })
  return n.toLocaleString(locale, { maximumFractionDigits: 8 })
}
