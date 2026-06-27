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
        } catch {}
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
  } catch {
    // Fallback: LIKE search
    try { rows = db.prepare('SELECT id chunk_id, document_id, title, source, url, content, asset_tags, 0 rank FROM rag_evidence_chunks WHERE lower(title || " " || content) LIKE ? LIMIT ?').all(`%${query}%`, limit) }
    catch {}
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
