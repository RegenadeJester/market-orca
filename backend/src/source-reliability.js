// Source Reliability Score — Batch 3 #1
// Config map + scoring fn + DB persistence
import { db } from './db.js'
import crypto from 'node:crypto'

// Known source trust map (domain-level)
const DEFAULT_TRUST_MAP = {
  'idx.co.id':         { score: 95, label: 'high_trust',   tier: 'official' },
  'bi.go.id':          { score: 95, label: 'high_trust',   tier: 'official' },
  'ojk.go.id':         { score: 95, label: 'high_trust',   tier: 'official' },
  'reuters.com':       { score: 90, label: 'high_trust',   tier: 'established' },
  'bloomberg.com':     { score: 90, label: 'high_trust',   tier: 'established' },
  'yahoo.com':         { score: 75, label: 'medium_trust',  tier: 'aggregator' },
  'cnbc.com':          { score: 85, label: 'high_trust',   tier: 'established' },
  'cnbcindonesia.com': { score: 85, label: 'high_trust',   tier: 'established' },
  'kontan.co.id':      { score: 80, label: 'high_trust',   tier: 'established' },
  'bisnis.com':        { score: 80, label: 'high_trust',   tier: 'established' },
  'idxchannel.com':    { score: 80, label: 'high_trust',   tier: 'established' },
  'antara.id':         { score: 75, label: 'medium_trust',  tier: 'established' },
  'theverge.com':      { score: 70, label: 'medium_trust',  tier: 'established' },
  'techcrunch.com':    { score: 70, label: 'medium_trust',  tier: 'established' },
  'arstechnica.com':   { score: 75, label: 'medium_trust',  tier: 'established' },
  'wired.com':         { score: 70, label: 'medium_trust',  tier: 'established' },
  'bbc.com':           { score: 80, label: 'high_trust',   tier: 'established' },
  'bbc.co.uk':         { score: 80, label: 'high_trust',   tier: 'established' },
  'theguardian.com':   { score: 75, label: 'medium_trust',  tier: 'established' },
  'forbes.com':        { score: 65, label: 'medium_trust',  tier: 'established' },
  'marketwatch.com':   { score: 75, label: 'medium_trust',  tier: 'established' },
  'coindesk.com':      { score: 65, label: 'medium_trust',  tier: 'established' },
  'cointelegraph.com': { score: 60, label: 'medium_trust',  tier: 'established' },
  'github.com':        { score: 80, label: 'high_trust',   tier: 'established' },
  'news.ycombinator.com': { score: 60, label: 'medium_trust', tier: 'community' },
  'reddit.com':        { score: 40, label: 'low_trust',    tier: 'community' },
  'x.com':             { score: 35, label: 'low_trust',    tier: 'social' },
  'twitter.com':       { score: 35, label: 'low_trust',    tier: 'social' },
  'medium.com':        { score: 45, label: 'low_trust',    tier: 'blog' },
  'substack.com':      { score: 40, label: 'low_trust',    tier: 'blog' },
}

const LABEL_META = {
  high_trust:  { label: 'high', color: '#22c55e', order: 1 },
  medium_trust: { label: 'med',  color: '#f59e0b', order: 2 },
  low_trust:  { label: 'low',  color: '#ef4444', order: 3 },
}

// Extract domain from source or URL string
function extractDomain(raw) {
  if (!raw) return ''
  let s = String(raw).toLowerCase().trim()
  // Strip protocol/path if URL
  try { if (s.includes('://')) s = new URL(s).hostname } catch {}
  // Remove leading www.
  return s.replace(/^www\./, '')
}

// Score a source (name or URL). Returns {score, label, color, tier}
export function scoreSourceTrust(source, url) {
  const domain = extractDomain(url || source || '')
  const nameMatch = String(source || '').toLowerCase().trim()

  // Edge: no source at all
  if (!domain && !nameMatch) return { score: 50, label: 'medium_trust', color: '#f59e0b', tier: 'unknown' }

  // 1. direct domain lookup
  let entry = DEFAULT_TRUST_MAP[domain]
  // 2. partial domain match (e.g. "techcrunch.com" matches "techcrunch")
  if (!entry) {
    for (const [key, val] of Object.entries(DEFAULT_TRUST_MAP)) {
      if (domain.includes(key) || key.includes(domain)) { entry = val; break }
    }
  }
  // 3. name-based lookup (e.g. "Reuters" matches "reuters.com")
  if (!entry) {
    for (const [key, val] of Object.entries(DEFAULT_TRUST_MAP)) {
      const baseName = key.replace(/\..*$/, '') // "reuters" from "reuters.com"
      if (nameMatch.includes(baseName)) { entry = val; break }
    }
  }
  // 4. fallback: heuristic by domain type
  if (!entry) {
    let s = 50 // default
    if (/\.(go\.id|gov|ac\.id|edu\.id|edu|mil)$/.test(domain)) s = 85
    else if (/\.(org)$/.test(domain)) s = 65
    else if (/blog|medium|substack|wordpress/.test(domain)) s = 40
    else if (/\.(io|dev)$/.test(domain)) s = 55
    return { score: s, label: scoreToLabel(s), color: labelColor(scoreToLabel(s)), tier: 'inferred' }
  }

  return { ...entry, color: LABEL_META[entry.label]?.color || '#6b7280' }
}

function scoreToLabel(s) {
  if (s >= 75) return 'high_trust'
  if (s >= 50) return 'medium_trust'
  return 'low_trust'
}
function labelColor(l) { return LABEL_META[l]?.color || '#6b7280' }

// ---- DB persistence ----
export function initSourceReliabilityTable() {
  db.exec(`CREATE TABLE IF NOT EXISTS source_reliability (
    id TEXT PRIMARY KEY,
    domain TEXT UNIQUE NOT NULL,
    score INTEGER DEFAULT 50,
    label TEXT DEFAULT 'medium_trust',
    tier TEXT DEFAULT 'inferred',
    notes TEXT DEFAULT '',
    updated_at TEXT DEFAULT (datetime('now'))
  )`)
}

// Seed defaults into DB
export function seedSourceReliability() {
  initSourceReliabilityTable()
  const insert = db.prepare(`INSERT OR IGNORE INTO source_reliability (id,domain,score,label,tier) VALUES (?,?,?,?,?)`)
  const tx = db.transaction(() => {
    for (const [domain, cfg] of Object.entries(DEFAULT_TRUST_MAP)) {
      const id = crypto.createHash('md5').update(domain).digest('hex').slice(0, 12)
      insert.run(id, domain, cfg.score, cfg.label, cfg.tier)
    }
  })
  tx()
}

// List all configured sources with trust
export function listSourceReliability() {
  initSourceReliabilityTable()
  return db.prepare(`SELECT * FROM source_reliability ORDER BY score DESC`).all()
}

// Get trust for a set of source names (as used in report items)
export function getSourcesTrust(sources = []) {
  const seen = new Set()
  return sources
    .filter(Boolean)
    .filter(s => { const k = String(s).toLowerCase().trim(); if (seen.has(k)) return false; seen.add(k); return true })
    .map(s => ({ source: s, trust: scoreSourceTrust(s) }))
}
