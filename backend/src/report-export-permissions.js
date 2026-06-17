import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { db } from './db.js'

const SLUG_RE = /^\d{4}-\d{2}-\d{2}$/
const FORMATS = new Set(['html', 'md', 'json'])

export function safeReportPath(reportDir, slug, format = 'html') {
  if (!SLUG_RE.test(String(slug))) return null
  if (!FORMATS.has(format)) return null
  const fp = path.join(reportDir, `${slug}.${format}`)
  const resolved = path.resolve(fp)
  if (!resolved.startsWith(path.resolve(reportDir) + path.sep)) return null
  return resolved
}

export function getReportMeta(reportDir, slug) {
  const fp = safeReportPath(reportDir, slug, 'json')
  if (!fp || !fs.existsSync(fp)) return null
  let data = {}
  try { data = JSON.parse(fs.readFileSync(fp, 'utf8')) } catch {}
  const sensitivity = data.sensitivity || (String(slug).endsWith('27') ? 'private' : 'internal')
  return { slug, sensitivity, title: data.title || 'AI Daily Report' }
}

export function canExportReport(user, report) {
  if (!user) return { ok:false, status:401, reason:'anonymous_denied' }
  if (!report) return { ok:false, status:404, reason:'report_not_found' }
  if (report.sensitivity === 'public') return { ok:true, reason:'public_logged_in' }
  if (report.sensitivity === 'internal') return ['user','admin'].includes(user.role) ? { ok:true, reason:'internal_role_allowed' } : { ok:false, status:403, reason:'role_denied' }
  if (report.sensitivity === 'private') return user.role === 'admin' ? { ok:true, reason:'admin_private_allowed' } : { ok:false, status:403, reason:'private_admin_only' }
  return { ok:false, status:403, reason:'unknown_sensitivity' }
}

export function auditExport({ user, slug, format, decision, reason, ip }) {
  db.prepare(`INSERT INTO report_export_audit (user_id,report_slug,format,decision,reason,ip,created_at) VALUES (?,?,?,?,?,?,datetime('now'))`)
    .run(user?.id || null, slug, format, decision, reason, ip || '')
}

export function watermark(content, user, report, format) {
  const mark = `Exported for ${user.email} (${user.role}) • ${report.slug} • ${report.sensitivity} • ${new Date().toISOString()}`
  if (format === 'json') {
    const data = JSON.parse(content)
    return JSON.stringify({ ...data, export_watermark: mark }, null, 2)
  }
  if (format === 'html') return content.replace('</body>', `<div style="position:fixed;bottom:8px;right:8px;font:11px monospace;color:#78716c;background:#fff8;border:1px solid #ddd;padding:4px;z-index:9999">${mark.replace(/[<>&"]/g,'')}</div></body>`)
  return `${content}\n\n---\n${mark}\n`
}

export function createSignedExport(user, report, format, ttlSeconds = 900) {
  const token = crypto.randomBytes(24).toString('hex')
  const hash = crypto.createHash('sha256').update(token).digest('hex')
  db.prepare(`INSERT INTO signed_export_links (token_hash,report_slug,user_id,format,expires_at,created_at) VALUES (?,?,?,?,datetime('now',?),datetime('now'))`)
    .run(hash, report.slug, user.id, format, `+${ttlSeconds} seconds`)
  return token
}

export function verifySignedExport(token) {
  const hash = crypto.createHash('sha256').update(String(token || '')).digest('hex')
  return db.prepare(`SELECT l.*,u.email,u.role,u.name FROM signed_export_links l JOIN users u ON u.id=l.user_id WHERE l.token_hash=? AND l.expires_at > datetime('now') AND l.used_at IS NULL`).get(hash)
}
