// ═══════════════════════════════════════════════════════════════════════════
// RAG AutoLearn — Auto-ingest reports + auto-create topic collections
// ═══════════════════════════════════════════════════════════════════════════
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import { db } from './db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPORTS_DIR = path.join(__dirname, '..', '..', 'reports')

// ─── Topic Collections (auto-created + manual) ─────────────────────────
const TOPIC_COLLECTIONS = {
  'report-template': {
    label: 'High-Quality Report Templates',
    keywords: ['report template', 'best practice', 'quality report', 'daily report structure', 'market orca'],
    asset_tags: ['template', 'quality'],
    minQualityScore: 80,
    minDate: '2026-06-25',
  },
  'idx': {
    label: 'Indonesia Stock Market (IDX/IHSG)',
    keywords: ['ihsg', 'idx', 'jci', 'saham indonesia', 'bei', 'idx composite', 'jakarta composite'],
    asset_tags: ['idx', 'ihsg', 'bbca', 'bbri', 'bmri', 'bbni', 'tlkm', 'asii', 'unilever'],
  },
  'forex': {
    label: 'Forex & Currency',
    keywords: ['forex', 'currency', 'usd/idr', 'eur', 'gbp', 'yen', 'dollar', 'rupiah', 'exchange rate'],
    asset_tags: ['usdidr', 'eurusd', 'gbpusd', 'usdjpy'],
  },
  'crypto': {
    label: 'Cryptocurrency',
    keywords: ['bitcoin', 'btc', 'ethereum', 'eth', 'crypto', 'defi', 'altcoin', 'blockchain'],
    asset_tags: ['btc-usd', 'eth-usd'],
  },
  'commodity': {
    label: 'Commodities (Gold/Oil)',
    keywords: ['gold', 'oil', 'crude', 'commodity', 'xauusd', 'wti', 'brent', 'palm oil', 'cpo'],
    asset_tags: ['xauusd', 'usoil', 'crude'],
  },
  'macro': {
    label: 'Macro Economics',
    keywords: ['inflation', 'gdp', 'interest rate', 'bi rate', 'suku bunga', 'inflasi', 'ekonomi', 'moneter', 'fiscal'],
    asset_tags: ['bi-rate', 'inflation'],
  },
  'global': {
    label: 'Global Markets',
    keywords: ['s&p 500', 'nasdaq', 'dow jones', 'wall street', 'fed', 'fomc', 'global market', 'nikkei', 'hang seng'],
    asset_tags: ['spx', 'ndx', 'dji'],
  },
  'tech': {
    label: 'Tech & AI',
    keywords: ['nvidia', 'apple', 'google', 'microsoft', 'ai', 'artificial intelligence', 'chip', 'semiconductor', 'tech stock'],
    asset_tags: ['aapl', 'msft', 'nvda', 'googl'],
  },
  'energy': {
    label: 'Energy Sector',
    keywords: ['energy', 'oil gas', 'renewable', 'pln', 'pertamina', 'solar', 'nuclear'],
    asset_tags: ['energy'],
  },
}

// ─── Helpers ──────────────────────────────────────────────────────────────
function contentHash(s) { return crypto.createHash('md5').update(s).digest('hex') }

function safeParseTags(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  try { return JSON.parse(raw) } catch {}
  // Handle plain strings like "JKSE"
  if (typeof raw === 'string') return raw.split(',').map(t => t.trim()).filter(Boolean)
  return []
}

function chunkText(text, maxLen = 1200) {
  const chunks = []
  const sentences = text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/)
  let buf = ''
  for (const s of sentences) {
    if ((buf + ' ' + s).length > maxLen && buf.length > 0) {
      chunks.push(buf.trim())
      buf = s
    } else {
      buf = buf ? buf + ' ' + s : s
    }
  }
  if (buf.trim()) chunks.push(buf.trim())
  return chunks
}

function classifyTopics(text, topicTitle='', itemTitle='') {
  const haystack = (text + ' ' + topicTitle + ' ' + itemTitle).toLowerCase()
  const matched = []
  for (const [key, col] of Object.entries(TOPIC_COLLECTIONS)) {
    if (col.keywords.some(kw => haystack.includes(kw))) matched.push(key)
    if (col.asset_tags.some(t => haystack.includes(t))) matched.push(key)
  }
  return [...new Set(matched)]
}

function findReportFiles() {
  if (!fs.existsSync(REPORTS_DIR)) return []
  return fs.readdirSync(REPORTS_DIR)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
}

// ─── Core: Ingest Report into RAG ──────────────────────────────────────
export function ingestReport(slug) {
  const fp = path.join(REPORTS_DIR, `${slug}.json`)
  if (!fs.existsSync(fp)) return { ok: false, error: `Report not found: ${slug}` }

  const report = JSON.parse(fs.readFileSync(fp, 'utf8'))
  const topics = report.topics || []
  let docCount = 0, chunkCount = 0, skipped = 0

  for (const topic of topics) {
    for (const item of (topic.items || [])) {
      const title = (item.title || '').trim()
      const snippet = (item.snippet || item.summary || '').trim()
      const source = item.source || ''
      const url = item.url || ''
      if (!title && !snippet) continue

      const content = `Title: ${title}\nSource: ${source}\nTopic: ${topic.title}\nDate: ${slug}\nContent: ${snippet}\nURL: ${url}`
      const hash = contentHash(content)
      const tags = classifyTopics(content, topic.title, title)

      // Check dedup by content hash
      const existing = db.prepare('SELECT id FROM rag_evidence_documents WHERE content_hash = ?').get(hash)
      // existing check removed for re-ingest

      const docId = `report-${slug}-${docCount}`
      db.prepare(`INSERT OR IGNORE INTO rag_evidence_documents (id, url, title, source, published_at, fetched_at, content_hash, asset_tags, quality_score) VALUES (?, ?, ?, ?, ?, datetime('now'), ?, ?, ?)`)
        .run(docId, url, title, source, slug, hash, JSON.stringify(tags), 0.7)

      // Chunk the content
      const chunks = chunkText(snippet)
      for (let ci = 0; ci < chunks.length; ci++) {
        const chunkId = `chunk-${docId}-${ci}`
        db.prepare(`INSERT OR IGNORE INTO rag_evidence_chunks (id, document_id, chunk_index, title, source, url, content, asset_tags, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`)
          .run(chunkId, docId, ci, title, source, url, chunks[ci], JSON.stringify(tags))
        // FTS
        try {
          db.prepare(`INSERT INTO rag_evidence_chunks_fts (rowid, title, source, content, asset_tags) VALUES ((SELECT rowid FROM rag_evidence_chunks WHERE id = ?), ?, ?, ?, ?)`)
            .run(chunkId, title, source, chunks[ci], JSON.stringify(tags))
        } catch (e) { console.warn('[rag-autolearn] FTS insert:', e.message) }
        chunkCount++
      }
      docCount++
    }
  }

  // Track seen titles
  const titleHash = contentHash(JSON.stringify(report.topics?.map(t => t.title) || []))
  db.prepare(`INSERT INTO rag_evidence_seen_titles (title_hash, title, first_seen, last_seen, count) VALUES (?, ?, ?, ?, 1) ON CONFLICT(title_hash) DO UPDATE SET last_seen = excluded.last_seen, count = count + 1`)
    .run(titleHash, slug, slug, slug)

  return { ok: true, slug, docs: docCount, chunks: chunkCount, skipped }
}

// ─── Core: Ingest all reports ──────────────────────────────────────────
export function ingestAllReports() {
  const files = findReportFiles()
  const results = []
  for (const f of files) {
    const slug = f.replace('.json', '')
    const r = ingestReport(slug)
    results.push(r)
  }
  const totalDocs = results.reduce((s, r) => s + (r.docs || 0), 0)
  const totalChunks = results.reduce((s, r) => s + (r.chunks || 0), 0)
  const totalSkipped = results.reduce((s, r) => s + (r.skipped || 0), 0)
  return { ok: true, reports: results.length, totalDocs, totalChunks, totalSkipped, results }
}

// ─── Core: Auto-create collections from ingested data ──────────────────
export function autoCreateCollections() {
  const collections = []
  for (const [key, col] of Object.entries(TOPIC_COLLECTIONS)) {
    const tagsJson = JSON.stringify(col.asset_tags)
    const docCount = db.prepare('SELECT count(*) as c FROM rag_evidence_documents WHERE asset_tags LIKE ?').get(`%${key}%`)?.c || 0
    const chunkCount = db.prepare('SELECT count(*) as c FROM rag_evidence_chunks WHERE asset_tags LIKE ?').get(`%${key}%`)?.c || 0
    const latestDate = db.prepare('SELECT MAX(published_at) as d FROM rag_evidence_documents WHERE asset_tags LIKE ?').get(`%${key}%`)?.d || null

    collections.push({
      key,
      label: col.label,
      docCount,
      chunkCount,
      latestDate,
      keywords: col.keywords.slice(0, 5),
    })
  }
  return collections
}

// ─── Core: Topic-aware search ──────────────────────────────────────────
export function searchByTopic(query, { limit = 8, topic = '' } = {}) {
  // Find matching collections
  const qLower = (query + ' ' + topic).toLowerCase()
  const matchingTags = []
  for (const [key, col] of Object.entries(TOPIC_COLLECTIONS)) {
    if (col.keywords.some(kw => qLower.includes(kw))) matchingTags.push(key)
  }

  // FTS search
  const ftsQuery = query.replace(/[^a-zA-Z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2).join(' OR ')
  // Enrich FTS query with topic keywords — all terms joined with OR for FTS5
  const enrichedQuery = (() => {
    if (!matchingTags.length) return ftsQuery
    const allTerms = ftsQuery.split(/\s+OR\s+/).filter(Boolean)
    for (const t of matchingTags) {
      const kw = (TOPIC_COLLECTIONS[t]?.keywords || []).slice(0, 3)
      for (const k of kw) {
        if (!allTerms.some(at => at.toLowerCase() === k.toLowerCase())) allTerms.push(k)
      }
    }
    return allTerms.slice(0, 10).join(' OR ')
  })()
  
  let rows = []
  try {
    if (enrichedQuery) {
      rows = db.prepare(`SELECT c.id chunk_id, c.document_id, c.title, c.source, c.url, c.content, c.asset_tags, bm25(rag_evidence_chunks_fts) rank FROM rag_evidence_chunks_fts JOIN rag_evidence_chunks c ON rag_evidence_chunks_fts.rowid = c.rowid WHERE rag_evidence_chunks_fts MATCH ? ORDER BY rank LIMIT ?`)
        .all(enrichedQuery, limit * 3)
    }
  } catch (e) {
    console.warn('[rag-autolearn] FTS search failed:', e.message)
    // Fallback: LIKE search
    try { rows = db.prepare('SELECT id chunk_id, document_id, title, source, url, content, asset_tags, 0 rank FROM rag_evidence_chunks WHERE lower(title || " " || content) LIKE ? LIMIT ?').all(`%${query}%`, limit) }
    catch (e2) { console.warn('[rag-autolearn] LIKE fallback failed:', e2.message) }
  }

  // Dedup by title
  const seen = new Set()
  const deduped = rows.filter(r => {
    const key = r.title || r.url
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return {
    ok: true,
    query,
    topic: matchingTags.join(', ') || 'general',
    collections_matched: matchingTags,
    results: deduped.map(r => ({
      chunk_id: r.chunk_id,
      title: r.title,
      source: r.source,
      url: r.url,
      content: r.content?.slice(0, 400),
      tags: safeParseTags(r.asset_tags),
    })),
    total: deduped.length,
  }
}

// ─── Core: Collection stats ────────────────────────────────────────────
export function getCollectionStats() {
  const totalDocs = db.prepare('SELECT count(*) as c FROM rag_evidence_documents').get().c
  const totalChunks = db.prepare('SELECT count(*) as c FROM rag_evidence_chunks').get().c
  const collections = autoCreateCollections()
  const recentIngest = db.prepare('SELECT published_at, count(*) as c FROM rag_evidence_documents GROUP BY published_at ORDER BY published_at DESC LIMIT 7').all()
  return {
    ok: true,
    totalDocuments: totalDocs,
    totalChunks,
    collections,
    recentIngest,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Report Template Collection — Ingest best reports as learning templates
// ═══════════════════════════════════════════════════════════════════════════

// Compute quality score for a report (same logic as ai-daily-report.js reportQuality)
function computeReportQuality(topics = []) {
  const items = topics.flatMap(t => t.items || [])
  const titles = items.map(i => (i.title||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().slice(0,80)).filter(Boolean)
  const dupes = titles.length - new Set(titles).size
  const sources = new Set(items.map(i => i.source).filter(Boolean)).size
  const images = items.filter(i => i.imageUrl).length
  let score = 100 - dupes * 10 + Math.min(10, sources) + Math.min(8, images)
  if (dupes > 5) score = Math.min(score, 75)
  if (sources < 4) score = Math.min(score, 65)
  return Math.max(0, Math.min(100, Math.round(score)))
}

/**
 * Ingest a report as a template into the 'report-template' collection.
 * Only ingests if quality >= threshold (default 80).
 * Template chunks include structure info: section names, item counts, intro patterns.
 */
export function ingestReportAsTemplate(slug) {
  const fp = path.join(REPORTS_DIR, `${slug}.json`)
  if (!fs.existsSync(fp)) return { ok: false, error: `Report not found: ${slug}` }

  const report = JSON.parse(fs.readFileSync(fp, 'utf8'))
  const topics = report.topics || []
  const quality = computeReportQuality(topics)
  const templateConfig = TOPIC_COLLECTIONS['report-template']
  const minScore = templateConfig.minQualityScore || 80

  if (quality < minScore) {
    return { ok: false, reason: `quality ${quality} < min ${minScore}`, slug, quality }
  }

  // Build template document: structure + quality metadata
  const sectionSummary = topics.map(t => ({
    title: t.title,
    itemCount: (t.items || []).length,
    hasIntro: !!(t.intro && t.intro.length > 20),
    hasFunFact: !!(t.funFact && t.funFact.length > 15),
    avgSnippetLen: Math.round((t.items || []).reduce((s, i) => s + (i.snippet || '').length, 0) / Math.max(1, (t.items || []).length)),
  }))

  const templateContent = [
    `Report Template: ${slug}`,
    `Quality Score: ${quality}/100`,
    `Sections: ${topics.length}`,
    `Total Items: ${topics.reduce((s, t) => s + (t.items || []).length, 0)}`,
    `Structure: ${sectionSummary.map(s => `${s.title}(${s.itemCount} items, intro:${s.hasIntro}, funfact:${s.hasFunFact})`).join(' | ')}`,
    report.executiveBrief ? `Executive Brief: ${report.executiveBrief.slice(0, 500)}` : '',
    report.textReport ? `Text Report Snippet: ${report.textReport.slice(0, 1000)}` : '',
  ].filter(Boolean).join('\n')

  const docId = `template-${slug}`
  const hash = contentHash(templateContent)
  const tags = JSON.stringify(['report-template', 'template', 'quality', ...topics.slice(0, 5).map(t => t.title.toLowerCase().replace(/\s+/g, '-'))])

  db.prepare(`INSERT OR REPLACE INTO rag_evidence_documents (id, url, title, source, published_at, fetched_at, content_hash, asset_tags, quality_score) VALUES (?, ?, ?, ?, ?, datetime('now'), ?, ?, ?)`)
    .run(docId, `report://${slug}`, `Report Template ${slug}`, 'internal', slug, hash, tags, quality)

  // Chunk the template
  const chunks = chunkText(templateContent, 800)
  // Remove old chunks for this doc
  try {
    const oldChunks = db.prepare('SELECT id FROM rag_evidence_chunks WHERE document_id = ?').all(docId)
    for (const oc of oldChunks) {
      try { db.prepare('DELETE FROM rag_evidence_chunks_fts WHERE rowid = (SELECT rowid FROM rag_evidence_chunks WHERE id = ?)').run(oc.id) } catch (e) { console.warn('[rag-autolearn] FTS delete old:', e.message) }
      db.prepare('DELETE FROM rag_evidence_chunks WHERE id = ?').run(oc.id)
    }
  } catch (e) { console.warn('[rag-autolearn] remove old chunks:', e.message) }

  let chunkCount = 0
  for (let ci = 0; ci < chunks.length; ci++) {
    const chunkId = `tchunk-${slug}-${ci}`
    db.prepare(`INSERT OR IGNORE INTO rag_evidence_chunks (id, document_id, chunk_index, title, source, url, content, asset_tags, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`)
      .run(chunkId, docId, ci, `Template ${slug}`, 'internal', `report://${slug}`, chunks[ci], tags)
    try {
      db.prepare(`INSERT INTO rag_evidence_chunks_fts (rowid, title, source, content, asset_tags) VALUES ((SELECT rowid FROM rag_evidence_chunks WHERE id = ?), ?, ?, ?, ?)`)
        .run(chunkId, `Template ${slug}`, 'internal', chunks[ci], tags)
    } catch (e) { console.warn('[rag-autolearn] template FTS:', e.message) }
    chunkCount++
  }

  // Also store structured quality metadata in a separate table
  db.exec(`CREATE TABLE IF NOT EXISTS report_templates (
    slug TEXT PRIMARY KEY,
    quality_score INTEGER,
    section_count INTEGER,
    total_items INTEGER,
    structure_json TEXT,
    ingested_at TEXT DEFAULT (datetime('now'))
  )`)
  db.prepare(`INSERT OR REPLACE INTO report_templates (slug, quality_score, section_count, total_items, structure_json, ingested_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`)
    .run(slug, quality, topics.length, topics.reduce((s, t) => s + (t.items || []).length, 0), JSON.stringify(sectionSummary))

  return { ok: true, slug, quality, sections: topics.length, chunks: chunkCount }
}

/**
 * Ingest all reports >= minDate as templates if quality is high enough.
 */
export function ingestBestReportTemplates() {
  const minDate = TOPIC_COLLECTIONS['report-template'].minDate || '2026-06-25'
  const files = findReportFiles().filter(f => f.replace('.json', '') >= minDate)
  const results = []
  for (const f of files) {
    const slug = f.replace('.json', '')
    results.push(ingestReportAsTemplate(slug))
  }
  return {
    ok: true,
    files: files.length,
    ingested: results.filter(r => r.ok).length,
    skipped: results.filter(r => !r.ok).length,
    results,
  }
}

/**
 * Search report templates for similar structure/content.
 */
export function searchReportTemplates(query, { limit = 5 } = {}) {
  const ftsQuery = query.replace(/[^a-zA-Z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2).join(' OR ')
  let rows = []
  try {
    if (ftsQuery) {
      rows = db.prepare(`SELECT c.id chunk_id, c.title, c.content, c.url, d.quality_score FROM rag_evidence_chunks_fts JOIN rag_evidence_chunks c ON rag_evidence_chunks_fts.rowid = c.rowid JOIN rag_evidence_documents d ON c.document_id = d.id WHERE rag_evidence_chunks_fts MATCH ? AND c.asset_tags LIKE '%template%' ORDER BY d.quality_score DESC, bm25(rag_evidence_chunks_fts) LIMIT ?`)
        .all(ftsQuery, limit * 2)
    }
  } catch (e) {
    console.warn('[rag-autolearn] template FTS failed:', e.message)
    try {
      rows = db.prepare(`SELECT c.id chunk_id, c.title, c.content, c.url, d.quality_score FROM rag_evidence_chunks c JOIN rag_evidence_documents d ON c.document_id = d.id WHERE c.asset_tags LIKE '%template%' AND (c.title LIKE ? OR c.content LIKE ?) ORDER BY d.quality_score DESC LIMIT ?`)
        .all(`%${query}%`, `%${query}%`, limit)
    } catch (e2) { console.warn('[rag-autolearn] template LIKE fallback failed:', e2.message) }
  }

  const seen = new Set()
  return {
    ok: true,
    query,
    collection: 'report-template',
    results: rows.filter(r => {
      const k = r.chunk_id; if (seen.has(k)) return false; seen.add(k); return true
    }).slice(0, limit).map(r => ({
      chunk_id: r.chunk_id,
      title: r.title,
      content: r.content?.slice(0, 500),
      quality_score: r.quality_score,
      slug: r.url?.replace('report://', ''),
    })),
    total: rows.length,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Report Quality Assurance — pre-publish checks using RAG context
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Run QA checks on a report by slug. Returns quality score + check results.
 * Can be called from API endpoint or pipeline.
 */
export function qaReport(slug) {
  const fp = path.join(REPORTS_DIR, `${slug}.json`)
  if (!fs.existsSync(fp)) return { ok: false, error: `Report not found: ${slug}`, score: 0 }

  const report = JSON.parse(fs.readFileSync(fp, 'utf8'))
  const topics = report.topics || []
  const checks = []
  const issues = []

  // 1. Empty sections check
  const emptySections = topics.filter(t => !t.items || t.items.length === 0)
  checks.push({
    name: 'empty_sections',
    pass: emptySections.length === 0,
    detail: emptySections.length > 0 ? `Empty: ${emptySections.map(t => t.title).join(', ')}` : 'All sections have items',
  })
  if (emptySections.length > 0) issues.push({ type: 'empty_section', sections: emptySections.map(t => t.title) })

  // 2. Short snippets (< 50 chars)
  const shortSnippets = []
  for (const t of topics) {
    for (const item of (t.items || [])) {
      if (item.snippet && item.snippet.length < 50 && item.snippet !== item.title) {
        shortSnippets.push({ section: t.title, title: item.title, snippetLen: item.snippet.length })
      }
    }
  }
  checks.push({
    name: 'snippet_length',
    pass: shortSnippets.length <= 2,
    detail: `${shortSnippets.length} items with snippet < 50 chars`,
  })
  if (shortSnippets.length > 2) issues.push({ type: 'short_snippets', count: shortSnippets.length, examples: shortSnippets.slice(0, 3) })

  // 3. Broken citations (items without URL)
  const noUrlItems = []
  for (const t of topics) {
    for (const item of (t.items || [])) {
      if (!item.url) noUrlItems.push({ section: t.title, title: item.title })
    }
  }
  checks.push({
    name: 'broken_citations',
    pass: noUrlItems.length <= 1,
    detail: `${noUrlItems.length} items without URL`,
  })
  if (noUrlItems.length > 1) issues.push({ type: 'missing_urls', count: noUrlItems.length, examples: noUrlItems.slice(0, 3) })

  // 4. Duplicate titles
  const titles = topics.flatMap(t => (t.items || []).map(i => (i.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 60))).filter(Boolean)
  const dupeCount = titles.length - new Set(titles).size
  checks.push({
    name: 'duplicate_titles',
    pass: dupeCount <= 2,
    detail: `${dupeCount} duplicate titles`,
  })
  if (dupeCount > 2) issues.push({ type: 'duplicates', count: dupeCount })

  // 5. Source diversity
  const sources = new Set(topics.flatMap(t => (t.items || []).map(i => i.source)).filter(Boolean)).size
  checks.push({
    name: 'source_diversity',
    pass: sources >= 4,
    detail: `${sources} unique sources`,
  })
  if (sources < 4) issues.push({ type: 'low_source_diversity', count: sources })

  // 6. Total items
  const totalItems = topics.reduce((s, t) => s + (t.items || []).length, 0)
  checks.push({
    name: 'item_count',
    pass: totalItems >= 10,
    detail: `${totalItems} total items across ${topics.length} sections`,
  })
  if (totalItems < 10) issues.push({ type: 'low_item_count', count: totalItems })

  // 7. Compare with templates via RAG
  const templateSearch = searchReportTemplates(`sections ${topics.length} items ${totalItems}`, { limit: 3 })
  const avgTemplateQuality = templateSearch.results.length
    ? Math.round(templateSearch.results.reduce((s, r) => s + (r.quality_score || 0), 0) / templateSearch.results.length)
    : 0
  checks.push({
    name: 'template_comparison',
    pass: true, // informational only
    detail: templateSearch.results.length > 0 ? `Compared to ${templateSearch.results.length} templates (avg quality: ${avgTemplateQuality})` : 'No templates to compare',
  })

  // Score: percentage of passing checks
  const score = Math.round(checks.filter(c => c.pass).length / checks.length * 100)
  const status = score >= 88 ? 'excellent' : score >= 75 ? 'good' : score >= 60 ? 'ok' : 'needs_review'

  return {
    ok: true,
    slug,
    score,
    status,
    checks,
    issues,
    totalItems,
    sectionCount: topics.length,
    sourceCount: sources,
    templateComparison: avgTemplateQuality > 0 ? { avgTemplateQuality, templatesFound: templateSearch.results.length } : null,
  }
}
