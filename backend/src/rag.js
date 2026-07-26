import { db } from './db.js'
import crypto from 'node:crypto'
import { embedTexts, isOpenRouterReady } from './openrouter.js'

function nowIso(){ return new Date().toISOString() }
function hash(s){ return crypto.createHash('sha256').update(String(s||'')).digest('hex') }
function clean(s){ return String(s||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim() }
function host(url){ try { return new URL(url).hostname.replace(/^www\./,'') } catch { return '' } }
function chunkText(text, size=900, overlap=120){ const t=clean(text); const out=[]; for(let i=0;i<t.length;i+=size-overlap){ const c=t.slice(i,i+size).trim(); if(c.length>40) out.push(c); if(i+size>=t.length) break } return out }

export function initRagSchema(){
  db.exec(`
CREATE TABLE IF NOT EXISTS rag_evidence_documents (
  id TEXT PRIMARY KEY,
  url TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  source TEXT DEFAULT '',
  published_at TEXT DEFAULT '',
  fetched_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  asset_tags TEXT DEFAULT '',
  quality_score REAL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS rag_evidence_chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  title TEXT NOT NULL,
  source TEXT DEFAULT '',
  url TEXT NOT NULL,
  content TEXT NOT NULL,
  asset_tags TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS rag_evidence_chunks_fts USING fts5(title, source, content, asset_tags, content='rag_evidence_chunks', content_rowid='rowid');
CREATE TABLE IF NOT EXISTS rag_evidence_retrieval_runs (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  section TEXT DEFAULT '',
  result_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rag_evidence_report_citations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_slug TEXT NOT NULL,
  section TEXT NOT NULL,
  document_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  source TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS rag_evidence_seen_titles (
  title_hash TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  count INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS rag_evidence_quality_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_slug TEXT NOT NULL,
  citation_coverage REAL DEFAULT 0,
  source_diversity INTEGER DEFAULT 0,
  duplicate_clusters INTEGER DEFAULT 0,
  freshness_score REAL DEFAULT 0,
  unsupported_claims INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS rag_evidence_vectors (
  chunk_id TEXT PRIMARY KEY,
  vector_json TEXT NOT NULL,
  dim INTEGER NOT NULL DEFAULT 2048,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`)
}

function cosine(a, b){
  let s = 0, na = 0, nb = 0
  const len = Math.min(a.length, b.length)
  for(let i = 0; i < len; i++){ s += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return s / (Math.sqrt(na) * Math.sqrt(nb) || 1)
}

async function saveChunkVector(chunkId, text){
  const vectors = await embedTexts([text])
  const vec = vectors[0]
  if(!vec) return
  db.prepare(`INSERT INTO rag_evidence_vectors (chunk_id, vector_json, dim, updated_at) VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(chunk_id) DO UPDATE SET vector_json = excluded.vector_json, dim = excluded.dim, updated_at = datetime('now')`)
    .run(chunkId, JSON.stringify(vec), vec.length)
}

export async function ragSemanticSearch(query, { limit = 8, minScore = 0.08 } = {}){
  initRagSchema()
  const qVec = await embedTexts([query])
  if(!qVec[0]) return []
  const qv = qVec[0]
  const rows = db.prepare(`SELECT c.id chunk_id, c.document_id, c.title, c.source, c.url, c.content, c.asset_tags, v.vector_json
    FROM rag_evidence_vectors v JOIN rag_evidence_chunks c ON c.id = v.chunk_id WHERE v.dim = ? LIMIT 2000`).all(qv.length)
  return rows.map(r => {
    const vec = JSON.parse(r.vector_json || '[]')
    return { ...r, score: cosine(qv, vec), snippet: clean(r.content).slice(0, 420) }
  }).filter(r => r.score >= minScore).sort((a, b) => b.score - a.score).slice(0, limit)
}

export async function ragHybridSearch(query, { section = '', limit = 8, assetTags = [] } = {}){
  const fts = ragSearch(query, { section, limit: Math.max(limit, 12) })
  const sem = await ragSemanticSearch(query, { limit: Math.max(limit, 12) })
  const map = new Map()
  for(const r of fts) map.set(r.chunk_id, { ...r, retrieval: 'fts', hybridScore: (r.score || 0) / 100 })
  for(const r of sem){
    const old = map.get(r.chunk_id)
    map.set(r.chunk_id, { ...(old || r), ...r, retrieval: old ? 'hybrid' : 'semantic', hybridScore: (old?.hybridScore || 0) + Number(r.score || 0) })
  }
  let results = [...map.values()].sort((a, b) => (b.hybridScore || 0) - (a.hybridScore || 0)).slice(0, limit * 2)

  if(assetTags && assetTags.length > 0){
    const tags = assetTags.map(t => t.toLowerCase())
    results = results.filter(r => {
      const at = (r.asset_tags || '').toLowerCase()
      return tags.some(t => at.includes(t))
    })
  }

  return results.slice(0, limit)
}

export function upsertRagDocument({ url, title, source = '', publishedAt = '', content = '', assetTags = [] }){
  initRagSchema()
  if(!url || !title || !content) return null
  const id = hash(url).slice(0, 32), contentHash = hash(content), fetchedAt = nowIso(), tags = assetTags.join(',')
  db.prepare(`INSERT INTO rag_evidence_documents (id, url, title, source, published_at, fetched_at, content_hash, asset_tags, quality_score)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(url) DO UPDATE SET title = excluded.title, source = excluded.source, published_at = excluded.published_at, fetched_at = excluded.fetched_at, content_hash = excluded.content_hash, asset_tags = excluded.asset_tags, quality_score = excluded.quality_score`)
    .run(id, url, clean(title), source || host(url), publishedAt, fetchedAt, contentHash, tags, scoreSource(source || host(url), publishedAt))
  db.prepare(`DELETE FROM rag_evidence_chunks WHERE document_id = ?`).run(id)
  db.prepare(`DELETE FROM rag_evidence_chunks_fts WHERE rowid IN (SELECT rowid FROM rag_evidence_chunks WHERE document_id = ?)`).run(id)
  const insert = db.prepare(`INSERT INTO rag_evidence_chunks (id, document_id, chunk_index, title, source, url, content, asset_tags, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const ftsIns = db.prepare(`INSERT INTO rag_evidence_chunks_fts (rowid, title, source, content, asset_tags) VALUES ((SELECT rowid FROM rag_evidence_chunks WHERE id = ?), ?, ?, ?, ?)`)
  const chunks = chunkText(content)
  for(let i = 0; i < chunks.length; i++){
    const chunk = chunks[i], cid = hash(`${id}:${i}:${chunk}`).slice(0, 32)
    insert.run(cid, id, i, clean(title), source || host(url), url, chunk, tags, fetchedAt)
    ftsIns.run(cid, clean(title), source || host(url), chunk, tags)
    // Async vector save — don't block ingest
    saveChunkVector(cid, `${title} ${chunk} ${tags}`).catch(() => {})
  }
  const th = hash(clean(title).toLowerCase()).slice(0, 32)
  db.prepare(`INSERT INTO rag_evidence_seen_titles (title_hash, title, first_seen, last_seen, count) VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(title_hash) DO UPDATE SET last_seen = excluded.last_seen, count = count + 1`).run(th, clean(title), fetchedAt, fetchedAt)
  return { id, url, title: clean(title), chunks: chunks.length }
}

function scoreSource(source, publishedAt){
  let s = 50
  if(/idx|bi\.go|ojk|kontan|bisnis|cnbc|reuters|bloomberg|yahoo/i.test(source)) s += 25
  const age = publishedAt ? Date.now() - Date.parse(publishedAt) : 0
  if(age && age < 36e5 * 24) s += 15
  if(age && age > 36e5 * 24 * 7) s -= 20
  return Math.max(0, Math.min(100, s))
}

export function ingestTopicsToRag(topics = []){
  initRagSchema(); const out = []
  for(const topic of topics){
    for(const item of topic.items || []){
      if(!item?.url && !item?.link) continue
      const url = item.url || item.link, content = [item.title, item.snippet, item.summary, topic.intro].filter(Boolean).join('\n\n')
      const r = upsertRagDocument({ url, title: item.title, source: item.source || host(url), publishedAt: item.createdAt || item.created_at || '', content, assetTags: inferTags(`${item.title} ${item.snippet || ''} ${topic.title || ''}`) })
      if(r) out.push(r)
    }
  }
  return out
}

function inferTags(text){ const t = String(text || '').toLowerCase(); const tags = []; if(/jkse|ihsg|idx/.test(t)) tags.push('JKSE'); if(/usd|idr|rupiah|dollar/.test(t)) tags.push('USDIDR'); if(/wifi/.test(t)) tags.push('WIFI.JK'); if(/bitcoin|btc|crypto/.test(t)) tags.push('BTC'); if(/gold|xau/.test(t)) tags.push('XAUUSD'); return tags }

export function ragSearch(query, { section = '', limit = 8 } = {}){
  initRagSchema(); const q = clean(query).slice(0, 300); if(!q) return []
  const runId = hash(`${q}:${Date.now()}`).slice(0, 24)
  let rows = []
  const terms = [...new Set(q.toLowerCase().replace(/[^\p{L}\p{N}.\s-]/gu, ' ').split(/\s+/).filter(x => x.length > 2).slice(0, 10))]
  const ftsQuery = terms.map(t => `${t}*`).join(' OR ')
  try { rows = db.prepare(`SELECT c.id chunk_id, c.document_id, c.title, c.source, c.url, c.content, c.asset_tags, bm25(rag_evidence_chunks_fts) rank FROM rag_evidence_chunks_fts JOIN rag_evidence_chunks c ON rag_evidence_chunks_fts.rowid = c.rowid WHERE rag_evidence_chunks_fts MATCH ? ORDER BY rank LIMIT ?`).all(ftsQuery, limit * 3) }
  catch { rows = db.prepare(`SELECT id chunk_id, document_id, title, source, url, content, asset_tags, 0 rank FROM rag_evidence_chunks WHERE lower(title || ' ' || content) LIKE ? LIMIT ?`).all(`%${terms[0] || q.toLowerCase()}%`, limit * 3) }
  const seen = new Set()
  rows = rows.filter(r => { const k = r.url; if(seen.has(k)) return false; seen.add(k); return true }).filter(r => {
    const u = (r.url || '').toLowerCase()
    if(/example\.com|test\.com|lorem\.ipsum|dummy\.site/i.test(u)) return false
    const t = `${r.title || ''} ${r.content || ''}`.toLowerCase()
    if(/test retrieval|vectortest|bi test|unit test|mock data|fixture|sample data|placeholder/i.test(t)) return false
    if(/^\s*(test|dummy|example|sample|placeholder)/i.test(r.title || '')) return false
    return true
  }).slice(0, limit)
  db.prepare(`INSERT INTO rag_evidence_retrieval_runs (id, query, section, result_count, created_at) VALUES (?, ?, ?, ?, ?)`).run(runId, q, section, rows.length, nowIso())
  return rows.map((r, i) => ({ ...r, score: Number((100 - i * 7).toFixed(1)), snippet: clean(r.content).slice(0, 420) }))
}

export async function buildRagContext(topics = []){
  ingestTopicsToRag(topics)
  const queries = [
    ['Market catalysts', 'Indonesia market JKSE rupiah BI IDX market today'],
    ['USD/IDR', 'USD IDR rupiah dollar Bank Indonesia pressure'],
    ['Watchlist', 'WIFI JKSE watchlist corporate action stock market'],
    ['Global risk', 'global macro risk rates dollar crypto market']
  ]
  const sections = await Promise.all(queries.map(async ([section, q]) => {
    const ftsResults = ragSearch(q, { section, limit: 5 })
    const semResults = await ragSemanticSearch(q, { limit: 5 })
    const merged = new Map()
    for(const r of ftsResults) merged.set(r.chunk_id, { ...r, source: 'fts' })
    for(const r of semResults){ if(!merged.has(r.chunk_id)) merged.set(r.chunk_id, { ...r, source: 'semantic' }) }
    return { section, query: q, results: [...merged.values()].slice(0, 5) }
  }))
  const all = sections.flatMap(s => s.results.map(r => r.source || host(r.url))).filter(Boolean)
  const diversity = new Set(all).size
  const citations = sections.flatMap(s => s.results.map(r => ({ section: s.section, ...r })))
  return { sections, citations, quality: { sourceDiversity: diversity, citationCount: citations.length, coverage: sections.length ? Math.round(sections.filter(s => s.results.length).length / sections.length * 100) : 0 } }
}

export function formatRagMarkdown(rag){
  if(!rag?.sections?.length) return '## Retrieval Evidence\n- No retrieval evidence yet.'
  return `## Retrieval Evidence / RAG\n- Citation coverage: ${rag.quality.coverage}%\n- Source diversity: ${rag.quality.sourceDiversity}\n- Citations: ${rag.quality.citationCount}\n\n` + rag.sections.map(s => `### ${s.section}\n${s.results.length ? s.results.map((r, i) => `- ${i + 1}. **${clean(r.title).slice(0, 110)}** — ${r.source || host(r.url)}\n  ${r.snippet}\n  <${r.url}>`).join('\n') : '- no evidence'}`).join('\n\n')
}

export function saveRagCitations(reportSlug, rag){
  initRagSchema(); if(!reportSlug || !rag?.citations) return 0
  const stmt = db.prepare(`INSERT INTO rag_evidence_report_citations (report_slug, section, document_id, chunk_id, title, url, source) VALUES (?, ?, ?, ?, ?, ?, ?)`)
  let n = 0
  for(const c of rag.citations){ stmt.run(reportSlug, c.section, c.document_id, c.chunk_id, c.title, c.url, c.source || host(c.url)); n++ }
  db.prepare(`INSERT INTO rag_evidence_quality_scores (report_slug, citation_coverage, source_diversity, duplicate_clusters, freshness_score, unsupported_claims) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(reportSlug, rag.quality.coverage, rag.quality.sourceDiversity, 0, rag.quality.coverage, 0)
  return n
}

export function ragStorageStats(){
  initRagSchema()
  const q = t => db.prepare(`SELECT count(*) n FROM ${t}`).get().n
  return { documents: q('rag_evidence_documents'), chunks: q('rag_evidence_chunks'), vectors: q('rag_evidence_vectors'), retrievalRuns: q('rag_evidence_retrieval_runs') }
}

export function cleanupRagStore({ maxAgeDays = 60, maxChunks = 20000 } = {}){
  initRagSchema()
  const before = ragStorageStats()
  const cutoff = new Date(Date.now() - maxAgeDays * 864e5).toISOString()
  const oldDocs = db.prepare(`SELECT id FROM rag_evidence_documents WHERE fetched_at < ?`).all(cutoff).map(r => r.id)
  const delChunkFts = db.prepare(`DELETE FROM rag_evidence_chunks_fts WHERE rowid IN (SELECT rowid FROM rag_evidence_chunks WHERE document_id = ?)`)
  const delVec = db.prepare(`DELETE FROM rag_evidence_vectors WHERE chunk_id IN (SELECT id FROM rag_evidence_chunks WHERE document_id = ?)`)
  const delChunks = db.prepare(`DELETE FROM rag_evidence_chunks WHERE document_id = ?`)
  const delDoc = db.prepare(`DELETE FROM rag_evidence_documents WHERE id = ?`)
  for(const id of oldDocs){ delChunkFts.run(id); delVec.run(id); delChunks.run(id); delDoc.run(id) }
  const total = db.prepare(`SELECT count(*) n FROM rag_evidence_chunks`).get().n
  if(total > maxChunks){
    const excess = total - maxChunks
    const stale = db.prepare(`SELECT id FROM rag_evidence_chunks ORDER BY created_at ASC LIMIT ?`).all(excess).map(r => r.id)
    const delFtsById = db.prepare(`DELETE FROM rag_evidence_chunks_fts WHERE rowid IN (SELECT rowid FROM rag_evidence_chunks WHERE id = ?)`)
    const delVecById = db.prepare(`DELETE FROM rag_evidence_vectors WHERE chunk_id = ?`)
    const delChunkById = db.prepare(`DELETE FROM rag_evidence_chunks WHERE id = ?`)
    for(const id of stale){ delFtsById.run(id); delVecById.run(id); delChunkById.run(id) }
  }
  db.prepare(`DELETE FROM rag_evidence_retrieval_runs WHERE created_at < ?`).run(cutoff)
  const after = ragStorageStats()
  return { ok: true, maxAgeDays, maxChunks, removed: { documents: before.documents - after.documents, chunks: before.chunks - after.chunks, vectors: before.vectors - after.vectors, retrievalRuns: before.retrievalRuns - after.retrievalRuns }, before, after }
}

export async function vectorizeMissingChunks({ limit = 100 } = {}){
  initRagSchema()
  const rows = db.prepare(`SELECT c.id, c.title, c.content, c.asset_tags FROM rag_evidence_chunks c LEFT JOIN rag_evidence_vectors v ON v.chunk_id = c.id WHERE v.chunk_id IS NULL ORDER BY c.created_at DESC LIMIT ?`).all(limit)
  if(!rows.length) return { ok: true, requested: limit, vectorized: 0, stats: ragStorageStats() }
  const texts = rows.map(r => `${r.title} ${r.content} ${r.asset_tags || ''}`)
  const vectors = await embedTexts(texts)
  let vectorized = 0
  const upd = db.prepare(`INSERT INTO rag_evidence_vectors (chunk_id, vector_json, dim, updated_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(chunk_id) DO UPDATE SET vector_json = excluded.vector_json, dim = excluded.dim, updated_at = datetime('now')`)
  for(let i = 0; i < rows.length; i++){
    if(vectors[i]){ upd.run(rows[i].id, JSON.stringify(vectors[i]), vectors[i].length); vectorized++ }
  }
  return { ok: true, requested: limit, vectorized, stats: ragStorageStats() }
}

export async function migrateOldVectors(){
  try {
    const oldVecs = db.prepare(`SELECT count(*) n FROM rag_evidence_vectors WHERE dim = 128`).get()
    if(oldVecs.n > 0){
      console.log(`[rag] Migrating ${oldVecs.n} old 128-dim vectors to OpenRouter 2048-dim...`)
      const stale = db.prepare(`SELECT v.chunk_id, c.title, c.content, c.asset_tags FROM rag_evidence_vectors v JOIN rag_evidence_chunks c ON c.id = v.chunk_id WHERE v.dim = 128 LIMIT 500`).all()
      if(stale.length){
        const texts = stale.map(r => `${r.title} ${r.content} ${r.asset_tags || ''}`)
        const vectors = await embedTexts(texts)
        const upd = db.prepare(`UPDATE rag_evidence_vectors SET vector_json = ?, dim = ?, updated_at = datetime('now') WHERE chunk_id = ?`)
        let migrated = 0
        for(let i = 0; i < stale.length; i++){
          if(vectors[i]){ upd.run(JSON.stringify(vectors[i]), vectors[i].length, stale[i].chunk_id); migrated++ }
        }
        console.log(`[rag] Migrated ${migrated}/${stale.length} vectors to OpenRouter embeddings`)
      }
    }
  } catch(e){ console.warn('[rag] Vector migration skipped:', e.message) }
}
