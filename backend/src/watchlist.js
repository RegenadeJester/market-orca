import { db } from './db.js'

export function getWatchlist() {
  return db.prepare(`SELECT a.* FROM watchlist w JOIN assets a ON a.slug = w.asset_slug ORDER BY w.id DESC`).all()
}

export function addWatchlist(slug) {
  db.prepare(`INSERT OR IGNORE INTO watchlist (asset_slug, created_at) VALUES (?, datetime('now'))`).run(slug)
  return getWatchlist()
}

export function removeWatchlist(slug) {
  db.prepare(`DELETE FROM watchlist WHERE asset_slug = ?`).run(slug)
  return getWatchlist()
}
