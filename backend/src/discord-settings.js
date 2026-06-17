import { db } from './db.js'

export function getDiscordSetting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM discord_settings WHERE key = ?').get(key)
  return row?.value ?? fallback
}

export function setDiscordSetting(key, value) {
  db.prepare(`INSERT INTO discord_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`).run(key, String(value))
}

export function getDiscordSettings() {
  const rows = db.prepare('SELECT key, value FROM discord_settings ORDER BY key').all()
  return Object.fromEntries(rows.map((r) => [r.key, r.value]))
}
