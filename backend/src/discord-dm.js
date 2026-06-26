/**
 * Discord DM Delivery — subscriber management + send with retry & confirmation
 *
 * Pain point: discord.js silently catches DM send errors (.catch(() => {})).
 * Reports fallback to sendAiReportToUserDm which never actually sends.
 *
 * Fix: add sendDmWithRetry, track delivery status in delivery_log, expose
 * /api/report-health status, and add periodic cleanup of old logs.
 */
import { db } from './db.js'

const MAX_DM_RETRIES = 2
const DM_RETRY_DELAY_MS = 2_000

/* ── Subscriber CRUD ─────────────────────────────────────────────────── */
export function addDmSubscriber(userId, username = '') {
  db.prepare(`INSERT INTO discord_dm_subscribers (user_id, username, enabled, created_at)
    VALUES (?, ?, 1, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET enabled=1, username=excluded.username`).run(String(userId), username)
}

export function removeDmSubscriber(userId) {
  db.prepare(`DELETE FROM discord_dm_subscribers WHERE user_id = ?`).run(String(userId))
}

export function listDmSubscribers() {
  return db.prepare(`SELECT user_id, username, enabled, created_at FROM discord_dm_subscribers ORDER BY created_at DESC`).all()
}

export function getDmSubscriberCount() {
  const r = db.prepare(`SELECT count(*) AS n FROM discord_dm_subscribers WHERE enabled=1`).get()
  return r?.n || 0
}

/* ── Send DM with retry + confirmation ───────────────────────────────── */
/**
 * Send a message or embed to a Discord user via DM.
 * Retries up to MAX_DM_RETRIES times on failure.
 * Logs every attempt to delivery_log.
 *
 * @param {import('discord.js').Client} client - Discord bot client
 * @param {string} userId - Discord user ID
 * @param {object} payload - { content?: string, embeds?: EmbedBuilder[] }
 * @param {string} [slug='dm'] - Slug for delivery_log context
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
export async function sendDmWithRetry(client, userId, payload, slug = 'dm') {
  const maxAttempts = MAX_DM_RETRIES + 1

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const user = await client.users.fetch(userId).catch(() => null)
      if (!user) {
        const errMsg = `DM: user ${userId} not found`
        logDmDelivery(slug, userId, 'fail', errMsg, attempt)
        return { ok: false, error: errMsg }
      }

      await user.send(payload)
      logDmDelivery(slug, userId, 'ok', `attempt ${attempt}/${maxAttempts}`, attempt)
      return { ok: true }

    } catch (err) {
      const errMsg = String(err.message || err).slice(0, 300)
      logDmDelivery(slug, userId, 'fail', `attempt ${attempt}/${maxAttempts}: ${errMsg}`, attempt)

      if (attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, DM_RETRY_DELAY_MS * attempt))
      } else {
        return { ok: false, error: errMsg }
      }
    }
  }
  return { ok: false, error: 'max_retries_exceeded' }
}

/**
 * Send DM to all enabled subscribers.
 * Returns a summary per user.
 */
export async function sendDmToAllSubscribers(client, payload, slug = 'dm') {
  const subs = listDmSubscribers().filter(s => s.enabled)
  if (!subs.length) return { ok: true, total: 0, results: [] }

  const results = []
  for (const sub of subs) {
    const r = await sendDmWithRetry(client, sub.user_id, payload, slug)
    results.push({ userId: sub.user_id, username: sub.username, ok: r.ok, error: r.error })
  }

  const okCount = results.filter(r => r.ok).length
  return { ok: okCount > 0, total: results.length, okCount, failCount: results.length - okCount, results }
}

/* ── Delivery log helpers ────────────────────────────────────────────── */
export function logDmDelivery(slug, userId, status, detail = '', attempt = 1) {
  try {
    db.prepare(`INSERT INTO delivery_log (slug, channel, step, status, detail, created_at)
      VALUES (?, 'dm', ?, ?, ?, datetime('now'))`)
      .run(String(slug || 'dm'), `dm_${String(userId).slice(0, 10)}_attempt_${attempt}`, status, String(detail).slice(0, 500))
  } catch {}
}

/**
 * Get recent DM delivery status from delivery_log.
 */
export function getDmDeliveryStatus(limit = 20) {
  try {
    return db.prepare(`
      SELECT slug, step, status, detail, created_at
      FROM delivery_log
      WHERE channel = 'dm'
      ORDER BY id DESC
      LIMIT ?
    `).all(limit)
  } catch { return [] }
}

/**
 * Count recent DM failures (last 24h).
 */
export function getDmFailCount() {
  try {
    const r = db.prepare(`
      SELECT count(*) AS n FROM delivery_log
      WHERE channel = 'dm' AND status = 'fail'
      AND created_at > datetime('now', '-1 day')
    `).get()
    return r?.n || 0
  } catch { return 0 }
}

/* ── Delivery log cleanup ────────────────────────────────────────────── */
export function cleanupOldDeliveryLogs(maxAgeDays = 7) {
  try {
    const r = db.prepare(`DELETE FROM delivery_log WHERE created_at < datetime('now', '-' || ? || ' days')`).run(maxAgeDays)
    return { ok: true, deleted: r.changes }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}
