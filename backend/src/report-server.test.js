import assert from 'node:assert/strict'
import test from 'node:test'

// report-server.js internal helpers — these are not exported so we
// reproduce them locally from the source (lines 260-500 range).
// This tests the logic of stableHash, stableFingerprint, cleanPref,
// webSearchOptions, overlapScore, evidenceHealth, etc.

import crypto from 'node:crypto'

// ── cleanPref (line 264-267) ───────────────────────────────────────────────
function cleanPref(value, allowed, fallback) {
  const v = String(value || '').trim().slice(0, 80)
  return allowed.includes(v) ? v : fallback
}

test('cleanPref returns value if allowed', () => {
  assert.equal(cleanPref('balanced', ['concise', 'balanced', 'analytical'], 'balanced'), 'balanced')
  assert.equal(cleanPref('concise', ['concise', 'balanced'], 'balanced'), 'concise')
})

test('cleanPref returns fallback if not allowed', () => {
  assert.equal(cleanPref('extreme', ['concise', 'balanced'], 'balanced'), 'balanced')
  assert.equal(cleanPref('', ['a', 'b'], 'default'), 'default')
})

test('cleanPref trims whitespace', () => {
  assert.equal(cleanPref('  balanced  ', ['balanced'], 'default'), 'balanced')
})

test('cleanPref slices to 80 chars', () => {
  const long = 'a'.repeat(200)
  assert.equal(cleanPref(long, [long], 'fall'), 'fall') // truncated so not in allowed
})

// ── stableHash (FNV-1a, line 270) ──────────────────────────────────────────
function stableHash(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16)
}

test('stableHash produces hex string', () => {
  const h = stableHash('hello')
  assert.equal(typeof h, 'string')
  assert.match(h, /^[0-9a-f]+$/)
})

test('stableHash is deterministic', () => {
  assert.equal(stableHash('test'), stableHash('test'))
  assert.equal(stableHash(''), stableHash(''))
})

test('stableHash differs for different inputs', () => {
  assert.notEqual(stableHash('abc'), stableHash('xyz'))
})

test('stableHash handles unicode', () => {
  const h = stableHash('🔥 hello 世界')
  assert.equal(typeof h, 'string')
  assert.ok(h.length > 0)
})

// ── webSearchOptions (line 434-445) ────────────────────────────────────────
function webSearchOptions(body = {}, defaultLimit = 10) {
  return {
    limit: Number(body?.limit || defaultLimit), engines: body?.engines || ['duckduckgo'], mode: String(body?.mode || ''),
    preferTrusted: body?.preferTrusted !== false, sites: Array.isArray(body?.sites) ? body.sites : [],
    domains: Array.isArray(body?.domains) ? body.domains : [], site: String(body?.site || ''),
    excludeSites: Array.isArray(body?.excludeSites) ? body.excludeSites : [],
    filetype: String(body?.filetype || ''), intitle: String(body?.intitle || ''), exact: String(body?.exact || ''),
    after: String(body?.after || ''), before: String(body?.before || ''), time_range: String(body?.time_range || body?.timeRange || ''),
    mustHave: Array.isArray(body?.mustHave) ? body.mustHave : [], autoPreview: body?.autoPreview === true,
    previewLimit: Number(body?.previewLimit || 3), dynamic: body?.dynamic !== false
  }
}

test('webSearchOptions returns defaults with empty body', () => {
  const opts = webSearchOptions({})
  assert.equal(opts.limit, 10)
  assert.deepEqual(opts.engines, ['duckduckgo'])
  assert.equal(opts.mode, '')
  assert.equal(opts.preferTrusted, true)
  assert.deepEqual(opts.sites, [])
  assert.equal(opts.autoPreview, false)
  assert.equal(opts.dynamic, true)
})

test('webSearchOptions overrides limit, mode, engines', () => {
  const opts = webSearchOptions({ limit: 5, mode: 'journal', engines: ['searxng'] })
  assert.equal(opts.limit, 5)
  assert.equal(opts.mode, 'journal')
  assert.deepEqual(opts.engines, ['searxng'])
})

test('webSearchOptions handles time_range aliases', () => {
  const a = webSearchOptions({ time_range: 'week' })
  const b = webSearchOptions({ timeRange: 'month' })
  assert.equal(a.time_range, 'week')
  assert.equal(b.time_range, 'month')
})

test('webSearchOptions preferTrusted can be false', () => {
  const opts = webSearchOptions({ preferTrusted: false })
  assert.equal(opts.preferTrusted, false)
})

test('webSearchOptions sites and domains default to arrays', () => {
  const opts = webSearchOptions({})
  assert.ok(Array.isArray(opts.sites))
  assert.ok(Array.isArray(opts.domains))
})

test('webSearchOptions autoPreview and dynamic booleans', () => {
  const a = webSearchOptions({ autoPreview: true })
  const b = webSearchOptions({ dynamic: false })
  assert.equal(a.autoPreview, true)
  assert.equal(b.dynamic, false)
})

// ── overlapScore (line 848-853) ────────────────────────────────────────────
function overlapScore(text = '', ev) {
  const words = new Set(String(text).toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 4))
  const hay = `${ev.title} ${ev.snippet} ${ev.source} ${ev.topic}`.toLowerCase()
  let s = 0; for (const w of words) if (hay.includes(w)) s++
  return s
}

test('overlapScore returns 0 for no overlap', () => {
  const ev = { title: 'Alpha', snippet: 'Beta', source: 'Gamma', topic: 'Delta' }
  assert.equal(overlapScore('xyz', ev), 0)
})

test('overlapScore counts overlapping words >4 chars', () => {
  const ev = { title: 'Market Crash', snippet: 'Stock market crash causes panic', source: 'Reuters', topic: 'Finance' }
  // "market" (6) and "crash" (5) match in text
  const score = overlapScore('market crash happened today', ev)
  assert.ok(score >= 2, `score=${score} should match market + crash`)
})

test('overlapScore ignores words <=4 chars', () => {
  const ev = { title: 'The', snippet: 'a an the', source: 'BBC', topic: 'News' }
  assert.equal(overlapScore('the a an', ev), 0)
})

// ── evidenceHealth (line 874-884) ──────────────────────────────────────────
function evidenceHealth(row) {
  const ids = JSON.parse(row.evidence_ids || '[]')
  const badges = []
  if (!ids.length) badges.push('needs source')
  if (ids.length === 1) badges.push('single-source')
  if (row.claim_type === 'assumption') badges.push('opinion-only')
  if (row.claim_type === 'weak_evidence') badges.push('mixed evidence')
  if (ids.length >= 3 && Number(row.confidence || 0) >= 0.75) badges.push('strong evidence')
  const score = Math.max(0, Math.min(100, Math.round(Number(row.confidence || 0) * 70 + Math.min(ids.length, 4) * 8 - (badges.includes('needs source') ? 25 : 0) - (badges.includes('opinion-only') ? 15 : 0))))
  return { score, badges: badges.length ? badges : ['mixed evidence'] }
}

test('evidenceHealth no ids = needs source', () => {
  const h = evidenceHealth({ evidence_ids: '[]', claim_type: 'assumption', confidence: 0.5 })
  assert.ok(h.badges.includes('needs source'))
  assert.ok(h.badges.includes('opinion-only'))
})

test('evidenceHealth strong evidence badge', () => {
  const h = evidenceHealth({ evidence_ids: '["a","b","c"]', claim_type: 'cited', confidence: 0.8 })
  assert.ok(h.badges.includes('strong evidence'))
  assert.ok(!h.badges.includes('needs source'))
  assert.ok(!h.badges.includes('opinion-only'))
})

test('evidenceHealth score is within 0-100', () => {
  const h = evidenceHealth({ evidence_ids: '[]', claim_type: 'weak_evidence', confidence: 0.3 })
  assert.ok(h.score >= 0 && h.score <= 100)
})

test('evidenceHealth score formulas are consistent', () => {
  const weak = evidenceHealth({ evidence_ids: '[]', claim_type: 'assumption', confidence: 0.5 })
  const strong = evidenceHealth({ evidence_ids: '["x","y","z"]', claim_type: 'cited', confidence: 0.9 })
  assert.ok(strong.score > weak.score, 'strong should score higher than weak')
})

// ── classifyBlock (line 863-872) ──────────────────────────────────────────
function classifyBlock(text = '', idx = 0, evidence = []) {
  const matches = evidence.map(ev => ({ ...ev, score: overlapScore(text, ev) })).filter(x => x.score >= 2).sort((a, b) => b.score - a.score).slice(0, 3)
  const hasCitation = matches.length > 0 || /https?:\/\/|\[\d+\]|source|sumber/i.test(text)
  const actionable = /watch|pantau|next|validasi|entry|buy|sell|risk|alert/i.test(text)
  const assumption = /asumsi|mungkin|berpotensi|bisa|could|likely/i.test(text) && !hasCitation
  const claim_type = hasCitation ? 'cited' : actionable ? 'actionable' : assumption ? 'assumption' : 'weak_evidence'
  const confidence = hasCitation ? Math.min(0.92, 0.62 + matches.length * 0.1) : claim_type === 'actionable' ? 0.58 : claim_type === 'assumption' ? 0.36 : 0.45
  const edit_suggestion = hasCitation ? `Terhubung ke ${matches.length} source; cek konsistensi sebelum export.` : claim_type === 'actionable' ? 'Tambahkan level harga/timeframe + source pendukung.' : 'Belum ada evidence kuat; rewrite sebagai asumsi atau tambahkan citation.'
  return { block_key: `b${String(idx + 1).padStart(3, '0')}`, body_md: text, evidence_ids: JSON.stringify(matches.map(m => m.id)), confidence, claim_type, edit_suggestion }
}

test('classifyBlock with URL returns cited', () => {
  const result = classifyBlock('Menurut https://example.com/news, pasar naik signifikan.', 0, [])
  assert.equal(result.claim_type, 'cited')
  assert.ok(result.confidence > 0.6)
})

test('classifyBlock with source keyword returns cited', () => {
  const result = classifyBlock('Data dari sumber terpercaya menunjukkan kenaikan.', 0, [])
  assert.equal(result.claim_type, 'cited')
})

test('classifyBlock with actionable words returns actionable', () => {
  const result = classifyBlock('Watch price action di support level.', 0, [])
  assert.equal(result.claim_type, 'actionable')
  assert.equal(result.confidence, 0.58)
})

test('classifyBlock with assumption words returns assumption', () => {
  const result = classifyBlock('Harga mungkin berpotensi naik minggu depan.', 0, [])
  assert.equal(result.claim_type, 'assumption')
  assert.equal(result.confidence, 0.36)
})

test('classifyBlock with weak evidence returns weak_evidence', () => {
  const result = classifyBlock('Beberapa analis melihat tren positif.', 0, [])
  assert.equal(result.claim_type, 'weak_evidence')
  assert.equal(result.confidence, 0.45)
})

test('classifyBlock block_key format', () => {
  const r1 = classifyBlock('text', 0, [])
  const r50 = classifyBlock('text', 49, [])
  assert.equal(r1.block_key, 'b001')
  assert.equal(r50.block_key, 'b050')
})

test('classifyBlock with evidence matches returns cited', () => {
  const ev = [{ id: 'ev1', title: 'Market Update', snippet: 'Pasar naik signifikan', source: 'Reuters', topic: 'Finance' }]
  // "pasar" (5) matches between text and ev
  const result = classifyBlock('Pasar mengalami kenaikan signifikan minggu ini', 0, ev)
  // "signifikan" (10) and "kenaikan" (8) both >4 chars, "pasar" (5)
  // Let's check overlapScore each word
  assert.equal(result.claim_type, 'cited')
})

// ── usableTopics (line 635) ────────────────────────────────────────────────
function usableTopics(topics) {
  return Array.isArray(topics) && topics.reduce((s, t) => s + (t.items?.length || 0), 0) >= 20
}

test('usableTopics returns false for empty/undefined', () => {
  assert.equal(usableTopics(undefined), false)
  assert.equal(usableTopics(null), false)
  assert.equal(usableTopics([]), false)
  assert.equal(usableTopics([{ items: [] }]), false)
})

test('usableTopics returns false for <20 items', () => {
  const topics = [{ title: 'A', items: [{}, {}, {}] }] // 3 items
  assert.equal(usableTopics(topics), false)
})

test('usableTopics returns true for >=20 items', () => {
  const items = Array.from({ length: 20 }, (_, i) => ({ title: `Item ${i}` }))
  const topics = [{ title: 'Main', items }]
  assert.equal(usableTopics(topics), true)
})

test('usableTopics sums across multiple sections', () => {
  const topics = [
    { title: 'A', items: Array(10).fill({}) },
    { title: 'B', items: Array(15).fill({}) },
  ]
  assert.equal(usableTopics(topics), true)
})

// ── stableFingerprint (line 497-500) ───────────────────────────────────────
function stableFingerprint(input = {}) {
  const core = JSON.stringify(input, Object.keys(input).sort())
  return crypto.createHash('sha256').update(core).digest('hex').slice(0, 24)
}

test('stableFingerprint produces 24-char hex', () => {
  const fp = stableFingerprint({ intent: 'test', asset: 'BTC' })
  assert.equal(fp.length, 24)
  assert.match(fp, /^[0-9a-f]{24}$/)
})

test('stableFingerprint is deterministic for same input', () => {
  const a = stableFingerprint({ intent: 'x', route: '/y' })
  const b = stableFingerprint({ intent: 'x', route: '/y' })
  assert.equal(a, b)
})

test('stableFingerprint differs for different input', () => {
  const a = stableFingerprint({ intent: 'a' })
  const b = stableFingerprint({ intent: 'b' })
  assert.notEqual(a, b)
})

test('stableFingerprint sorts keys', () => {
  const a = stableFingerprint({ b: 2, a: 1 })
  const b = stableFingerprint({ a: 1, b: 2 })
  assert.equal(a, b)
})

test('stableFingerprint handles empty object', () => {
  const fp = stableFingerprint({})
  assert.equal(fp.length, 24)
})

// ── defaultReportPrefs (line 260-263) ──────────────────────────────────────
const defaultReportPrefs = {
  tone: 'balanced', depth: 'normal', language: 'id',
  priority_topics: 'market,indonesia,watchlist', favorite_assets: '', discord_spam_level: 'digest'
}

test('defaultReportPrefs has expected structure', () => {
  assert.equal(defaultReportPrefs.tone, 'balanced')
  assert.equal(defaultReportPrefs.depth, 'normal')
  assert.equal(defaultReportPrefs.language, 'id')
  assert.equal(defaultReportPrefs.discord_spam_level, 'digest')
})
