import { db } from './db.js'

export function addDmSubscriber(userId, username = '') {
  db.prepare(`INSERT INTO discord_dm_subscribers (user_id, username, enabled, created_at) VALUES (?, ?, 1, datetime('now')) ON CONFLICT(user_id) DO UPDATE SET enabled=1, username=excluded.username`).run(String(userId), username)
}

export function removeDmSubscriber(userId) {
  db.prepare(`DELETE FROM discord_dm_subscribers WHERE user_id = ?`).run(String(userId))
}

export function listDmSubscribers() {
  return db.prepare(`SELECT user_id, username, enabled, created_at FROM discord_dm_subscribers ORDER BY created_at DESC`).all()
}
