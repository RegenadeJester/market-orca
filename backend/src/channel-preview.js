import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── Channel constraints ──────────────────────────────────────────────
export const CHANNEL_CONSTRAINTS = {
  discord: {
    charMax: 1850,
    splitMax: 2000,
    format: 'markdown',
    note: 'Discord: ~1900 char per part, auto-split dengan numbered pagination'
  },
  pdf: {
    pageSize: 'A4',
    format: 'html',
    note: 'PDF: A4 page layout via HTML-to-PDF'
  },
  web: {
    format: 'html',
    note: 'Web: full HTML interaktif'
  }
}

const MAX_PREVIEW_TTL_MS = 5 * 60 * 1000 // 5 min cache

// ── Discord split render ─────────────────────────────────────────────
function renderDiscordPreview(textReport = '', slug = '') {
  const parts = splitForDiscord(textReport || 'Laporan tidak tersedia.', CHANNEL_CONSTRAINTS.discord.charMax)
  return {
    channel: 'discord',
    slug,
    totalParts: parts.length,
    parts: parts.map((content, i) => ({
      part: i + 1,
      total: parts.length,
      chars: content.length,
      overflow: content.length > CHANNEL_CONSTRAINTS.discord.splitMax,
      content
    })),
    charMax: CHANNEL_CONSTRAINTS.discord.charMax,
    splitMax: CHANNEL_CONSTRAINTS.discord.splitMax,
    warnings: parts.filter(p => p.length > CHANNEL_CONSTRAINTS.discord.charMax).length
  }
}

function splitForDiscord(text, maxLen) {
  const parts = []
  let remaining = text
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      parts.push(remaining)
      break
    }
    // Try to split at double newline (paragraph boundary)
    let splitAt = remaining.lastIndexOf('\n\n', maxLen)
    if (splitAt < maxLen / 2) splitAt = remaining.lastIndexOf('\n', maxLen)
    if (splitAt < maxLen / 3) splitAt = remaining.lastIndexOf('. ', maxLen)
    if (splitAt < maxLen / 4) splitAt = maxLen

    parts.push(remaining.slice(0, splitAt + 1).trimEnd())
    remaining = remaining.slice(splitAt + 1).trimStart()
  }
  return parts
}

// ── Web preview (full HTML) ──────────────────────────────────────────
const reportDir = path.join(__dirname, '..', '..', 'reports')

function renderWebPreview(slug = '') {
  const fp = path.join(reportDir, `${slug}.html`)
  if (!fs.existsSync(fp)) {
    return {
      channel: 'web',
      slug,
      html: `<h1>Report ${slug}</h1><p>HTML version not found.</p>`,
      sections: []
    }
  }
  const raw = fs.readFileSync(fp, 'utf8')
  // Extract sections from report HTML
  const sections = []
  const h2Re = /<h2[^>]*>([^<]+)<\/h2>/g
  let m
  while ((m = h2Re.exec(raw)) !== null) {
    sections.push({ heading: m[1], index: sections.length })
  }
  return { channel: 'web', slug, html: raw, sections, chars: raw.length }
}

// ── PDF preview (HTML constrained for A4) ────────────────────────────
function renderPdfPreview(slug = '') {
  const fp = path.join(reportDir, `${slug}.html`)
  const exists = fs.existsSync(fp)
  const bodyHtml = exists
    ? fs.readFileSync(fp, 'utf8')
    : `<h1>Report ${slug}</h1><p>Not found.</p>`

  // Wrap in A4 page-break-aware container
  const pdfHtml = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<style>
@page { size: A4; margin: 18mm 14mm; }
@media print {
  .pdf-page { page-break-after: always; }
}
body { font-family: 'Inter', 'Segoe UI', sans-serif; font-size: 11pt; line-height: 1.55; color: #111; max-width: 160mm; margin: auto; padding: 0 10mm; }
h1 { font-size: 18pt; margin-top: 0; }
h2 { font-size: 14pt; margin-top: 18px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
p { margin: 4px 0; }
table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 10pt; }
th, td { border: 1px solid #ddd; padding: 4px 6px; text-align: left; }
th { background: #f5f5f5; }
img { max-width: 100%; height: auto; }
pre, code { font-size: 9pt; background: #f9f9f9; padding: 2px 4px; border-radius: 3px; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`

  const chars = pdfHtml.length
  const estimatedPages = Math.max(1, Math.round(chars / 3500)) // ~3500 chars per A4 page
  return {
    channel: 'pdf',
    slug,
    html: pdfHtml,
    chars,
    estimatedPages,
    pageSize: CHANNEL_CONSTRAINTS.pdf.pageSize
  }
}

// ── Editor representation (editable text) ────────────────────────────
function renderEditorPreview(slug = '') {
  const fp = path.join(reportDir, `${slug}.json`)
  if (!fs.existsSync(fp)) {
    return { channel: 'editor', slug, textReport: 'Report not found.', blocks: [] }
  }
  const report = JSON.parse(fs.readFileSync(fp, 'utf8'))
  const textReport = report.textReport || ''
  const topics = report.topics || []
  return {
    channel: 'editor',
    slug,
    textReport,
    date: report.date || slug,
    topics: topics.map(t => ({ title: t.title, itemCount: t.items?.length || 0 })),
    stats: {
      topics: topics.length,
      items: topics.reduce((s, t) => s + (t.items?.length || 0), 0)
    }
  }
}

// ── Main render dispatcher ───────────────────────────────────────────
export function renderPreviewForChannel(slug, channel = 'editor') {
  const ch = String(channel || '').toLowerCase()
  switch (ch) {
    case 'discord':
      const fp = path.join(reportDir, `${slug}.json`)
      const report = fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, 'utf8')) : {}
      return renderDiscordPreview(report.textReport, slug)
    case 'web':
      return renderWebPreview(slug)
    case 'pdf':
      return renderPdfPreview(slug)
    case 'editor':
    default:
      return renderEditorPreview(slug)
  }
}

// ── Publish: save edited textReport back to JSON, regenerate HTML, send to Discord ───
export async function publishChannel(slug, channel, editedText) {
  const jsonFp = path.join(reportDir, `${slug}.json`)
  if (!fs.existsSync(jsonFp)) {
    return { ok: false, error: 'report_not_found' }
  }

  const report = JSON.parse(fs.readFileSync(jsonFp, 'utf8'))

  const updated = ['json']

  if (channel === 'editor' && typeof editedText === 'string') {
    report.textReport = editedText
    fs.writeFileSync(jsonFp, JSON.stringify(report, null, 2), 'utf8')
    // Regenerate HTML only when textReport changed (editor channel)
    const htmlFp = path.join(reportDir, `${slug}.html`)
    const html = buildHtmlFromReport(report)
    fs.writeFileSync(htmlFp, html, 'utf8')
    updated.push('html')
  }

  const result = { ok: true, slug, channel, updated }

  // Send to Discord if channel is 'discord'
  if (channel === 'discord') {
    try {
      const { sendDiscordReport } = await import('./discord.js')
      const discordResult = await sendDiscordReport({ ...report, slug })
      result.discord = discordResult
    } catch (e) {
      console.error('[channel-preview] Discord send failed:', e.message)
      result.discord = { ok: false, error: e.message }
    }
  }

  return result
}

function buildHtmlFromReport(report) {
  const text = String(report.textReport || '')
  const body = text
    .split('\n')
    .map(line => {
      if (line.startsWith('## ')) return `<h2>${escHtml(line.slice(3))}</h2>`
      if (line.startsWith('# ')) return `<h1>${escHtml(line.slice(2))}</h1>`
      if (line.startsWith('> ')) return `<blockquote>${escHtml(line.slice(2))}</blockquote>`
      if (line.startsWith('**') && line.endsWith('**')) return `<p><strong>${escHtml(line.slice(2, -2))}</strong></p>`
      if (/^[-*]\s/.test(line)) return `<li>${escHtml(line.replace(/^[-*]\s/, ''))}</li>`
      if (/^\d+\.\s/.test(line)) return `<li>${escHtml(line.replace(/^\d+\.\s/, ''))}</li>`
      if (!line.trim()) return '<br>'
      let h = escHtml(line)
      h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>')
      h = h.replace(/`(.+?)`/g, '<code>$1</code>')
      h = h.replace(/https?:\/\/\S+/g, m => `<a href="${m}" target="_blank">${m}</a>`)
      return `<p>${h}</p>`
    })
    .join('\n')

  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escHtml(report.date || slug)} · Market Orca Report</title><style>
*{box-sizing:border-box}body{background:#f4f1ea;color:#111;font-family:Inter,system-ui,sans-serif;max-width:820px;margin:auto;padding:24px 16px 60px;line-height:1.6}
h1{font-size:clamp(24px,5vw,36px);margin-bottom:8px;letter-spacing:-.04em}
h2{font-size:clamp(18px,3.5vw,24px);margin-top:24px;margin-bottom:8px;border-bottom:2px solid #111;padding-bottom:4px}
p{margin:6px 0 12px;font-size:15px;line-height:1.7}
blockquote{border-left:4px solid #111;padding:8px 14px;margin:12px 0;background:#fff;font-style:italic}
li{margin:4px 0 4px 20px}code{background:#e5e5e5;padding:2px 5px;border-radius:3px;font-size:13px}
a{color:#1d4ed8;text-decoration:underline}
</style></head><body>${body}</body></html>`
}

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
