import Database from 'better-sqlite3'
import path from 'node:path'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dbPath = path.join(__dirname, '..', 'data', 'market.db')
export const db = new Database(dbPath)

db.pragma('journal_mode = WAL')
db.pragma('busy_timeout = 5000')

db.exec(`
CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  market TEXT NOT NULL,
  category TEXT NOT NULL,
  price REAL NOT NULL,
  change_percent REAL DEFAULT 0,
  thesis TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS news (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_slug TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  sentiment TEXT DEFAULT 'neutral',
  source TEXT DEFAULT '',
  link TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS candles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_slug TEXT NOT NULL,
  label TEXT NOT NULL,
  open REAL DEFAULT 0,
  high REAL DEFAULT 0,
  low REAL DEFAULT 0,
  close REAL DEFAULT 0,
  value REAL NOT NULL,
  volume REAL DEFAULT 0,
  ts INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_slug TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  discord_sent INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_slug TEXT NOT NULL,
  price REAL NOT NULL,
  change_percent REAL DEFAULT 0,
  source TEXT DEFAULT 'live',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS asset_settings (
  asset_slug TEXT PRIMARY KEY,
  threshold_up REAL DEFAULT 2,
  threshold_down REAL DEFAULT -2,
  watch_enabled INTEGER DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS watchlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_slug TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS discord_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS discord_dm_subscribers (
  user_id TEXT PRIMARY KEY,
  username TEXT DEFAULT '',
  enabled INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS event_templates (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  bias_json TEXT NOT NULL,
  drivers_json TEXT NOT NULL,
  signals_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS delivery_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL,
  channel TEXT NOT NULL,
  step TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS send_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'discord',
  step TEXT NOT NULL,
  payload TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT DEFAULT '',
  next_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_report_preferences (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  tone TEXT DEFAULT 'balanced',
  depth TEXT DEFAULT 'normal',
  language TEXT DEFAULT 'id',
  priority_topics TEXT DEFAULT 'market,indonesia,watchlist',
  favorite_assets TEXT DEFAULT '',
  discord_spam_level TEXT DEFAULT 'digest',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);


CREATE TABLE IF NOT EXISTS user_context_answers (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'user',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS report_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_slug TEXT NOT NULL,
  block_key TEXT NOT NULL,
  body_md TEXT NOT NULL,
  evidence_ids TEXT DEFAULT '[]',
  confidence REAL NOT NULL DEFAULT 0.5,
  claim_type TEXT NOT NULL DEFAULT 'assumption',
  edit_suggestion TEXT DEFAULT '',
  locked INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(report_slug, block_key)
);

CREATE TABLE IF NOT EXISTS report_rewrite_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_slug TEXT NOT NULL,
  block_key TEXT NOT NULL,
  before_md TEXT NOT NULL,
  after_md TEXT NOT NULL,
  evidence_ids TEXT DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT
);

CREATE TABLE IF NOT EXISTS decision_context_fingerprints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fingerprint TEXT UNIQUE NOT NULL,
  user_id INTEGER,
  route TEXT DEFAULT '',
  intent TEXT DEFAULT '',
  context_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  name TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT UNIQUE NOT NULL,
  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS report_export_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  report_slug TEXT NOT NULL,
  format TEXT NOT NULL,
  decision TEXT NOT NULL,
  reason TEXT DEFAULT '',
  ip TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS signed_export_links (
  token_hash TEXT PRIMARY KEY,
  report_slug TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  format TEXT NOT NULL DEFAULT 'html',
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS debate_threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'agreed',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS debate_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id INTEGER NOT NULL,
  agent TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rag_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL DEFAULT 'manual',
  source_url TEXT DEFAULT '',
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rag_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL,
  chunk_text TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE VIRTUAL TABLE IF NOT EXISTS rag_chunks_fts USING fts5(title, chunk_text, source_url, content='');

CREATE TABLE IF NOT EXISTS rag_vectors (
  chunk_id INTEGER PRIMARY KEY,
  dims_json TEXT NOT NULL,
  norm REAL NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE VIRTUAL TABLE IF NOT EXISTS rag_documents_fts USING fts5(title, content, source_url, content='rag_documents', content_rowid='id');

CREATE TABLE IF NOT EXISTS rag_report_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT NOT NULL,
  rewritten_queries TEXT NOT NULL DEFAULT '[]',
  selected_doc_ids TEXT NOT NULL DEFAULT '[]',
  report_md TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rag_citations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  document_id INTEGER NOT NULL,
  quote TEXT NOT NULL,
  source_url TEXT DEFAULT '',
  confidence REAL NOT NULL DEFAULT 0
);
`)

db.exec(`
CREATE INDEX IF NOT EXISTS idx_price_history_asset_id ON price_history(asset_slug, id DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_asset_id ON alerts(asset_slug, id DESC);
CREATE INDEX IF NOT EXISTS idx_news_asset_id ON news(asset_slug, id DESC);
CREATE INDEX IF NOT EXISTS idx_candles_asset_id ON candles(asset_slug, id ASC);
CREATE INDEX IF NOT EXISTS idx_send_queue_status ON send_queue(status, next_attempt_at, id DESC);
`)

db.exec(`
CREATE TABLE IF NOT EXISTS incident_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title_hash TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'detected',
  source TEXT DEFAULT '',
  report_slug TEXT DEFAULT '',
  transitioned_at TEXT NOT NULL DEFAULT (datetime('now')),
  note TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_incident_status_hash ON incident_status(title_hash, id DESC);
`)

const newsCols = db.prepare(`PRAGMA table_info(news)`).all().map((x) => x.name)
if (!newsCols.includes('source')) db.exec(`ALTER TABLE news ADD COLUMN source TEXT DEFAULT ''`)
if (!newsCols.includes('link')) db.exec(`ALTER TABLE news ADD COLUMN link TEXT DEFAULT ''`)

const candleCols = db.prepare(`PRAGMA table_info(candles)`).all().map((x) => x.name)
for (const [name, ddl] of [
  ['open', `ALTER TABLE candles ADD COLUMN open REAL DEFAULT 0`],
  ['high', `ALTER TABLE candles ADD COLUMN high REAL DEFAULT 0`],
  ['low', `ALTER TABLE candles ADD COLUMN low REAL DEFAULT 0`],
  ['close', `ALTER TABLE candles ADD COLUMN close REAL DEFAULT 0`],
  ['ts', `ALTER TABLE candles ADD COLUMN ts INTEGER DEFAULT 0`],
]) {
  if (!candleCols.includes(name)) db.exec(ddl)
}

const seedEventTemplates = db.transaction(() => {
  const rows = [
    ['rate_hike','Rate hike / hawkish central bank',{crypto:-2,stock:-1.2,forex:1,commodity:-0.4},['higher discount rate','risk-off flow','stronger USD'],['DXY','US10Y','Fed speech']],
    ['earnings_miss','Earnings miss / weak guidance',{stock:-2.4,crypto:-0.4,forex:0,commodity:0},['margin pressure','lower guidance','valuation reset'],['volume spike','analyst downgrade','sector sympathy']],
    ['regulation_news','Regulation news',{crypto:-2,stock:-0.7,forex:0.2,commodity:0},['policy uncertainty','compliance cost','liquidity shift'],['official statement','exchange response','legal timeline']],
    ['supply_shock','Supply shock',{commodity:2.4,stock:-0.6,forex:0.2,crypto:0},['scarcity premium','inflation impulse','margin squeeze'],['inventory data','shipping rates','geopolitical update']],
    ['ai_breakthrough','AI breakthrough / product launch',{stock:1.5,crypto:0.4,forex:0,commodity:0},['growth narrative','capex rotation','AI adoption'],['product traction','cloud spend','chip demand']],
  ]
  const stmt = db.prepare(`INSERT OR IGNORE INTO event_templates (id,label,bias_json,drivers_json,signals_json) VALUES (?,?,?,?,?)`)
  for (const [id,label,bias,drivers,signals] of rows) stmt.run(id,label,JSON.stringify(bias),JSON.stringify(drivers),JSON.stringify(signals))
})
seedEventTemplates()

const saveSnapshotTx = db.transaction((live) => {
  const asset = live.asset
  db.prepare(`UPDATE assets SET price = ?, change_percent = ?, thesis = ? WHERE slug = ?`).run(asset.price, asset.change_percent, asset.thesis || '', asset.slug)
  db.prepare(`INSERT INTO price_history (asset_slug, price, change_percent, source, created_at) VALUES (?, ?, ?, ?, datetime('now'))`).run(asset.slug, asset.price, asset.change_percent || 0, 'live')

  db.prepare(`DELETE FROM candles WHERE asset_slug = ?`).run(asset.slug)
  const insertCandle = db.prepare(`INSERT INTO candles (asset_slug, label, open, high, low, close, value, volume, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  for (const candle of live.candles || []) {
    insertCandle.run(asset.slug, candle.label, candle.open || candle.value, candle.high || candle.value, candle.low || candle.value, candle.close || candle.value, candle.value, candle.volume || 0, candle.ts || 0)
  }

  db.prepare(`DELETE FROM news WHERE asset_slug = ?`).run(asset.slug)
  const insertNews = db.prepare(`INSERT INTO news (asset_slug, title, summary, sentiment, source, link, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
  for (const item of live.news || []) {
    insertNews.run(asset.slug, item.title, item.summary, item.sentiment || 'neutral', item.source || '', item.link || '', item.created_at || new Date().toISOString())
  }
})

export function saveAssetSnapshot(live) {
  saveSnapshotTx(live)
}

export function getStoredCandles(slug) {
  return db.prepare(`SELECT label, open, high, low, close, value, volume, ts FROM candles WHERE asset_slug = ? ORDER BY id ASC`).all(slug)
}

export function getStoredNews(slug) {
  return db.prepare(`SELECT title, summary, sentiment, source, link, created_at FROM news WHERE asset_slug = ? ORDER BY id DESC LIMIT 8`).all(slug)
}

export function recordIncidentStatus({ titleHash, title, status, source, reportSlug, note }) {
  const last = db.prepare(`SELECT status FROM incident_status WHERE title_hash = ? ORDER BY id DESC LIMIT 1`).get(titleHash)
  if (last && last.status === status) return { changed: false, status }
  db.prepare(`INSERT INTO incident_status (title_hash, title, status, source, report_slug, note) VALUES (?, ?, ?, ?, ?, ?)`).run(titleHash, title, status, source || '', reportSlug || '', note || '')
  return { changed: true, status, previous: last?.status || null }
}

export function incidentTitleHash(title='') {
  return crypto.createHash('sha256').update(String(title).toLowerCase().trim()).digest('hex').slice(0, 16)
}

export function getIncidentStatusHistory(titleHash) {
  return db.prepare(`SELECT id, title, status, source, report_slug, transitioned_at, note FROM incident_status WHERE title_hash = ? ORDER BY id DESC LIMIT 50`).all(titleHash)
}

export function getLatestIncidentStatus(titleHash) {
  return db.prepare(`SELECT status, transitioned_at FROM incident_status WHERE title_hash = ? ORDER BY id DESC LIMIT 1`).get(titleHash)
}

export function manualUpdateIncidentStatus({ titleHash, title, status, note }) {
  const validStatuses = ['detected', 'investigating', 'partial_recovery', 'resolved', 'monitoring']
  if (!validStatuses.includes(status)) return { ok: false, error: 'invalid_status', valid: validStatuses }
  db.prepare(`INSERT INTO incident_status (title_hash, title, status, source, report_slug, note) VALUES (?, ?, ?, ?, ?, ?)`).run(titleHash, title || '', status, 'manual', '', note || '')
  return { ok: true, status }
}

// ═══════════════════════════════════════════
// SMART ALERT THRESHOLD — suggested alerts from report insights
// ═══════════════════════════════════════════

db.exec(`
CREATE TABLE IF NOT EXISTS suggested_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_slug TEXT NOT NULL,
  asset_symbol TEXT NOT NULL,
  target_price REAL DEFAULT 0,
  direction TEXT NOT NULL DEFAULT 'up',
  reason TEXT DEFAULT '',
  confidence REAL DEFAULT 0.5,
  report_slug TEXT DEFAULT '',
  source_title TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_suggested_alerts_status ON suggested_alerts(status, id DESC);

CREATE TABLE IF NOT EXISTS user_alert_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  suggested_alert_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  reason TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`)

export function insertSuggestedAlerts(alerts = []) {
  const stmt = db.prepare(`INSERT INTO suggested_alerts (asset_slug, asset_symbol, target_price, direction, reason, confidence, report_slug, source_title, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`)
  const tx = db.transaction(() => {
    let count = 0
    for (const a of alerts) {
      stmt.run(a.asset_slug, a.asset_symbol, a.target_price || 0, a.direction || 'up', a.reason || '', a.confidence || 0.5, a.report_slug || '', a.source_title || '')
      count++
    }
    return count
  })
  return tx()
}

export function listSuggestedAlerts(status = 'pending', limit = 20) {
  if (status === 'all') return db.prepare('SELECT * FROM suggested_alerts ORDER BY id DESC LIMIT ?').all(limit)
  return db.prepare('SELECT * FROM suggested_alerts WHERE status = ? ORDER BY id DESC LIMIT ?').all(status, limit)
}

export function approveSuggestedAlert(id) {
  const row = db.prepare('SELECT * FROM suggested_alerts WHERE id = ?').get(id)
  if (!row) return { ok: false, error: 'not_found' }
  if (row.status !== 'pending') return { ok: false, error: 'already_decided', current_status: row.status }
  db.prepare("UPDATE suggested_alerts SET status = 'active', decided_at = datetime('now') WHERE id = ?").run(id)
  db.prepare("INSERT INTO user_alert_feedback (suggested_alert_id, action, reason) VALUES (?, 'approve', '')").run(id)
  return { ok: true, id, status: 'active' }
}

export function rejectSuggestedAlert(id, reason = '') {
  const row = db.prepare('SELECT * FROM suggested_alerts WHERE id = ?').get(id)
  if (!row) return { ok: false, error: 'not_found' }
  if (row.status !== 'pending') return { ok: false, error: 'already_decided', current_status: row.status }
  db.prepare("UPDATE suggested_alerts SET status = 'rejected', decided_at = datetime('now') WHERE id = ?").run(id)
  db.prepare("INSERT INTO user_alert_feedback (suggested_alert_id, action, reason) VALUES (?, 'reject', ?)").run(id, String(reason).slice(0, 500))
  return { ok: true, id, status: 'rejected' }
}

export function suggestedAlertCount(status = 'pending') {
  return db.prepare('SELECT count(*) AS n FROM suggested_alerts WHERE status = ?').get(status)?.n || 0
}

// Backup helpers
const backupDir = path.join(__dirname, '..', 'data', 'backups')
export function ensureBackupDir() {
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true })
}

export function createBackup(label = 'manual') {
  ensureBackupDir()
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const fname = `market-${label}-${ts}.db`
  const dest = path.join(backupDir, fname)
  fs.copyFileSync(dbPath, dest)
  return { ok: true, file: fname, path: dest, size: fs.statSync(dest).size, created_at: new Date().toISOString() }
}

export function listBackups(limit = 50) {
  ensureBackupDir()
  return fs.readdirSync(backupDir)
    .filter(f => f.endsWith('.db'))
    .map(f => ({ file: f, size: fs.statSync(path.join(backupDir, f)).size, mtime: fs.statSync(path.join(backupDir, f)).mtime }))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit)
}

export function deleteOldBackups(keep = 30) {
  ensureBackupDir()
  const files = fs.readdirSync(backupDir).filter(f => f.endsWith('.db')).sort()
  let deleted = 0
  for (const f of files.slice(0, Math.max(0, files.length - keep))) {
    fs.unlinkSync(path.join(backupDir, f))
    deleted++
  }
  return { ok: true, deleted, kept: files.length - deleted }
}
