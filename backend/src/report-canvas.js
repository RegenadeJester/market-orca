// ═══════════════════════════════════════════════════════════════
// Report Canvas — Interactive section reorder, inline edits, notes
// + Multi-format export (MD, HTML)
// ═══════════════════════════════════════════════════════════════
import fs from 'node:fs'
import path from 'node:path'

const EXPORT_CLEANUP_HOURS = Number(process.env.EXPORT_CLEANUP_HOURS || 24)
const EXPORT_MAX_FILE_MB = Number(process.env.EXPORT_MAX_FILE_MB || 10)
const MAX_SECTIONS = 25

// ── Table Init ────────────────────────────────────────────────
export function initCanvasTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS report_canvas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_slug TEXT NOT NULL,
      user_id TEXT NOT NULL,
      section_order TEXT NOT NULL DEFAULT '[]',
      overrides TEXT NOT NULL DEFAULT '{}',
      notes TEXT NOT NULL DEFAULT '{}',
      hidden_sections TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(report_slug, user_id)
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS export_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_slug TEXT NOT NULL,
      user_id TEXT NOT NULL,
      format TEXT NOT NULL CHECK(format IN ('md','html','json')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','rendering','done','failed')),
      file_path TEXT,
      error TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT DEFAULT (datetime('now','+24 hours'))
    )
  `)
  console.log('[canvas] tables ready')
}

// ── Load report JSON ──────────────────────────────────────────
function loadReportJson(reportDir, slug) {
  const safeSlug = String(slug || '').replace(/[^0-9-]/g, '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(safeSlug)) return null
  const fp = path.join(reportDir, `${safeSlug}.json`)
  if (!fs.existsSync(fp)) return null
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')) } catch { return null }
}

// ── Build default sections from report topics ─────────────────
function topicsToSections(topics) {
  if (!Array.isArray(topics)) return []
  return topics.slice(0, MAX_SECTIONS).map((t, i) => ({
    key: `section_${i}`,
    title: t.title || `Section ${i + 1}`,
    body: t.intro || '',
    items: Array.isArray(t.items) ? t.items : [],
    funFact: t.funFact || '',
    hidden: false,
  }))
}

// ── Get canvas (with fallback to raw report) ──────────────────
export function getCanvas(db, reportDir, reportSlug, userId) {
  const row = db.prepare(
    'SELECT * FROM report_canvas WHERE report_slug = ? AND user_id = ?'
  ).get(reportSlug, userId)

  const report = loadReportJson(reportDir, reportSlug)
  if (!report) return null

  let sections = topicsToSections(report.topics)

  if (row) {
    // Apply canvas overrides on top of raw report
    const sectionOrder = JSON.parse(row.section_order || '[]')
    const overrides = JSON.parse(row.overrides || '{}')
    const notes = JSON.parse(row.notes || '{}')
    const hiddenSections = JSON.parse(row.hidden_sections || '[]')

    if (Array.isArray(sectionOrder) && sectionOrder.length > 0) {
      // Reorder sections
      const ordered = []
      const sectionMap = {}
      sections.forEach(s => { sectionMap[s.key] = s })
      sectionOrder.forEach(key => {
        if (sectionMap[key]) {
          ordered.push(sectionMap[key])
          delete sectionMap[key]
        }
      })
      // Append any remaining (new sections from report)
      Object.values(sectionMap).forEach(s => ordered.push(s))
      sections = ordered
    }

    sections = sections.map(s => {
      const override = overrides[s.key]
      const note = notes[s.key]
      const hidden = hiddenSections.includes(s.key)
      return {
        ...s,
        title: override?.title || s.title,
        body: override?.body || s.body,
        items: override?.items || s.items,
        funFact: override?.funFact || s.funFact,
        note: note || null,
        hidden,
      }
    })
  }

  return {
    reportSlug: reportSlug,
    title: report.title || 'AI Daily Report',
    date: report.date || reportSlug,
    sections,
    canvasExists: !!row,
  }
}

export function saveCanvas(db, reportSlug, userId, data = {}) {
  const existing = db.prepare(
    'SELECT id FROM report_canvas WHERE report_slug = ? AND user_id = ?'
  ).get(reportSlug, userId)

  const sectionOrder = JSON.stringify(data.sectionOrder || [])
  const overrides = JSON.stringify(data.overrides || {})
  const notes = JSON.stringify(data.notes || {})
  const hiddenSections = JSON.stringify(data.hiddenSections || [])

  if (existing) {
    db.prepare(`
      UPDATE report_canvas SET
        section_order = ?,
        overrides = ?,
        notes = ?,
        hidden_sections = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(sectionOrder, overrides, notes, hiddenSections, existing.id)
  } else {
    db.prepare(`
      INSERT INTO report_canvas (report_slug, user_id, section_order, overrides, notes, hidden_sections, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(reportSlug, userId, sectionOrder, overrides, notes, hiddenSections)
  }

  return getCanvas(db, path.join(import.meta.dirname, '..', '..', 'reports'), reportSlug, userId)
}

// ── Export ────────────────────────────────────────────────────
export function exportReport(db, reportDir, reportSlug, userId, format = 'md') {
  const canvas = getCanvas(db, reportDir, reportSlug, userId)
  if (!canvas) return { ok: false, error: 'report_not_found' }

  const safeFormats = new Set(['md', 'html', 'json'])
  if (!safeFormats.has(format)) return { ok: false, error: `unsupported_format:${format}` }

  const visibleSections = canvas.sections.filter(s => !s.hidden)

  let content, filename, mime

  if (format === 'json') {
    content = JSON.stringify(canvas, null, 2)
    filename = `${reportSlug}-canvas.json`
    mime = 'application/json'
  } else if (format === 'html') {
    const esc = s => String(s || '').replace(/[&<>"]/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
    const itemHtml = item => {
      if (!item) return ''
      const t = esc(item.title || item.symbol || '')
      const d = esc(item.direction || item.sentiment || '')
      const v = item.price ? esc(String(item.price)) : ''
      const s = item.score ? `${item.score}` : ''
      return `<tr><td>${t}</td><td>${d}</td><td>${v}</td><td>${s}</td></tr>`
    }
    content = `<!doctype html>
<html lang="id">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(canvas.title)}</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f4f1ea;color:#111;font-family:Inter,system-ui,sans-serif}
.wrap{max-width:960px;margin:auto;padding:20px}
h1{border-bottom:4px solid #111;padding-bottom:10px;margin-bottom:16px}
.section{background:#fff;border:2px solid #111;padding:16px;margin-bottom:16px}
.section h2{margin:0 0 8px}
.section .note{background:#fffbdd;border-left:4px solid #f5c842;padding:8px;margin:8px 0;font-size:14px}
.section .body{white-space:pre-wrap;margin:8px 0;color:#444;font-size:14px}
table{width:100%;border-collapse:collapse;margin:8px 0}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #ddd}
th{background:#eee;font-weight:600}
.fun{background:#f0f8ff;border:1px solid #b8d4e8;padding:8px;margin:8px 0;font-size:13px;color:#444}
</style></head>
<body><div class="wrap">
<h1>${esc(canvas.title)} — ${esc(canvas.date)}</h1>
${visibleSections.map(s => `<div class="section">
<h2>${esc(s.title)}</h2>
${s.note ? `<div class="note">📌 ${esc(s.note)}</div>` : ''}
${s.body ? `<div class="body">${esc(s.body)}</div>` : ''}
${Array.isArray(s.items) && s.items.length ? `<table><thead><tr><th>Item</th><th>Direction</th><th>Price</th><th>Score</th></tr></thead><tbody>${s.items.map(itemHtml).join('')}</tbody></table>` : ''}
${s.funFact ? `<div class="fun">💡 ${esc(s.funFact)}</div>` : ''}
</div>`).join('\n')}
<p style="color:#999;font-size:12px;border-top:2px solid #ddd;padding-top:8px">Generated by Market Orca · Canvas Export</p>
</div></body></html>`
    filename = `${reportSlug}-canvas.html`
    mime = 'text/html'
  } else {
    // Markdown
    content = `# ${canvas.title} — ${canvas.date}\n\n`
    visibleSections.forEach(s => {
      content += `## ${s.title}\n\n`
      if (s.note) content += `> 📌 ${s.note}\n\n`
      if (s.body) content += `${s.body}\n\n`
      if (Array.isArray(s.items) && s.items.length) {
        content += `| Item | Direction | Price | Score |\n|------|-----------|-------|-------|\n`
        s.items.forEach(item => {
          const t = item.title || item.symbol || ''
          const d = item.direction || item.sentiment || ''
          const v = item.price || ''
          const sc = item.score || ''
          content += `| ${t} | ${d} | ${v} | ${sc} |\n`
        })
        content += '\n'
      }
      if (s.funFact) content += `💡 *${s.funFact}*\n\n`
    })
    content += `---\n*Generated by Market Orca · Canvas Export*\n`
    filename = `${reportSlug}-canvas.md`
    mime = 'text/markdown'
  }

  // Check size limit
  const size = Buffer.byteLength(content, 'utf8')
  if (size > EXPORT_MAX_FILE_MB * 1024 * 1024) {
    return { ok: false, error: `export_too_large:${(size/1024/1024).toFixed(1)}MB > ${EXPORT_MAX_FILE_MB}MB limit` }
  }

  // Write to export dir
  const exportDir = path.join(reportDir, 'exports')
  if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true })
  const filePath = path.join(exportDir, filename)
  fs.writeFileSync(filePath, content, 'utf8')

  // Log export job
  db.prepare(`
    INSERT INTO export_jobs (report_slug, user_id, format, status, file_path, created_at, expires_at)
    VALUES (?, ?, ?, 'done', ?, datetime('now'), datetime('now','+${EXPORT_CLEANUP_HOURS} hours'))
  `).run(reportSlug, userId, format, filePath)

  return { ok: true, filePath, filename, mime, size }
}

// ── Cleanup expired exports ───────────────────────────────────
export function cleanupExpiredExports(db, reportDir) {
  const expired = db.prepare(
    "SELECT id, file_path FROM export_jobs WHERE expires_at < datetime('now')"
  ).all()
  const del = db.prepare('DELETE FROM export_jobs WHERE id = ?')
  let count = 0
  for (const job of expired) {
    if (job.file_path && fs.existsSync(job.file_path)) {
      try { fs.unlinkSync(job.file_path) } catch {}
    }
    del.run(job.id)
    count++
  }
  return count
}
