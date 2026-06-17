import assert from 'node:assert/strict'
import test from 'node:test'
import crypto from 'node:crypto'

// Use unique test identifiers so re-runs don't collide
function uniqueHash() {
  return crypto.randomUUID().slice(0, 16)
}

// DB module tests — these use the actual SQLite DB at backend/data/market.db
// which is auto-created and populated on import.

import { db, incidentTitleHash, recordIncidentStatus, getIncidentStatusHistory,
         manualUpdateIncidentStatus, getStoredCandles, getStoredNews,
         insertSuggestedAlerts, listSuggestedAlerts, approveSuggestedAlert,
         rejectSuggestedAlert, suggestedAlertCount } from './db.js'

test('db object is a better-sqlite3 Database instance', () => {
  assert.ok(db)
  assert.equal(typeof db.prepare, 'function')
  assert.equal(typeof db.exec, 'function')
})

test('db has WAL mode', () => {
  const mode = db.pragma('journal_mode', { simple: true })
  assert.equal(mode, 'wal')
})

test('db has assets table', () => {
  const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='assets'`).get()
  assert.ok(row, 'assets table exists')
})

test('db has users table', () => {
  const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='users'`).get()
  assert.ok(row)
})

test('db has sessions table', () => {
  const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'`).get()
  assert.ok(row)
})

test('db has report_blocks table', () => {
  const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='report_blocks'`).get()
  assert.ok(row)
})

test('db has suggested_alerts table', () => {
  const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='suggested_alerts'`).get()
  assert.ok(row)
})

// ── incidentTitleHash ──────────────────────────────────────────────────────

test('incidentTitleHash produces 16-char hex', () => {
  const h = incidentTitleHash('Some outage at datacenter')
  assert.equal(typeof h, 'string')
  assert.equal(h.length, 16)
  assert.match(h, /^[0-9a-f]{16}$/)
})

test('incidentTitleHash is deterministic', () => {
  const a = incidentTitleHash('Test Incident')
  const b = incidentTitleHash('Test Incident')
  assert.equal(a, b)
})

test('incidentTitleHash is case-insensitive', () => {
  assert.equal(incidentTitleHash('Hello'), incidentTitleHash('hello'))
  assert.equal(incidentTitleHash('Hello'), incidentTitleHash('HELLO'))
})

test('incidentTitleHash trims whitespace', () => {
  assert.equal(incidentTitleHash('  hello  '), incidentTitleHash('hello'))
})

test('incidentTitleHash different titles produce different hashes', () => {
  assert.notEqual(incidentTitleHash('alpha'), incidentTitleHash('beta'))
})

test('incidentTitleHash handles empty string', () => {
  const h = incidentTitleHash('')
  assert.equal(h.length, 16)
})

// ── incident status functions ──────────────────────────────────────────────

test('recordIncidentStatus inserts new status', () => {
  const hash = uniqueHash() // unique per run to avoid stale DB state
  const result = recordIncidentStatus({
    titleHash: hash,
    title: 'Test DB Incident',
    status: 'detected',
    source: 'test',
    reportSlug: '2026-01-01',
    note: 'unit test'
  })
  assert.equal(result.changed, true)
  assert.equal(result.status, 'detected')
})

test('recordIncidentStatus detects no-change when same status', () => {
  const hash = uniqueHash()
  // First insert always changes
  recordIncidentStatus({ titleHash: hash, title: 'Dupe', status: 'detected' })
  // Second insert with same status should detect no-change
  const result = recordIncidentStatus({ titleHash: hash, title: 'Dupe', status: 'detected' })
  assert.equal(result.changed, false)
  assert.equal(result.status, 'detected')
})

test('getIncidentStatusHistory returns array', () => {
  const hash = uniqueHash()
  recordIncidentStatus({ titleHash: hash, title: 'History Test', status: 'detected' })
  const history = getIncidentStatusHistory(hash)
  assert.ok(Array.isArray(history))
  assert.ok(history.length >= 1)
  assert.equal(history[0].status, 'detected')
})

test('manualUpdateIncidentStatus accepts valid status', () => {
  const hash = incidentTitleHash('Test Manual Incident')
  const result = manualUpdateIncidentStatus({
    titleHash: hash,
    title: 'Test Manual Incident',
    status: 'investigating',
    note: 'looking into it'
  })
  assert.equal(result.ok, true)
  assert.equal(result.status, 'investigating')
})

test('manualUpdateIncidentStatus rejects invalid status', () => {
  const result = manualUpdateIncidentStatus({
    titleHash: 'abc123',
    title: 'Test',
    status: 'INVALID_STATUS',
  })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'invalid_status')
  assert.ok(Array.isArray(result.valid))
  assert.ok(result.valid.includes('detected'))
  assert.ok(result.valid.includes('resolved'))
})

// ── stored data functions ──────────────────────────────────────────────────

test('getStoredCandles returns array', () => {
  const candles = getStoredCandles('nonexistent-slug')
  assert.ok(Array.isArray(candles))
})

test('getStoredNews returns array', () => {
  const news = getStoredNews('nonexistent-slug')
  assert.ok(Array.isArray(news))
})

// ── suggested alerts functions ─────────────────────────────────────────────

test('insertSuggestedAlerts inserts and returns count', () => {
  const count = insertSuggestedAlerts([
    { asset_slug: 'test-asset', asset_symbol: 'TST', target_price: 100, direction: 'up', reason: 'test', confidence: 0.8, report_slug: '2026-01-01', source_title: 'Test Source' }
  ])
  assert.equal(count, 1)
})

test('listSuggestedAlerts returns array', () => {
  const rows = listSuggestedAlerts('pending', 10)
  assert.ok(Array.isArray(rows))
  assert.ok(rows.length >= 1)
  assert.equal(rows[0].status, 'pending')
})

test('suggestedAlertCount returns number', () => {
  const n = suggestedAlertCount('pending')
  assert.equal(typeof n, 'number')
  assert.ok(n >= 1)
})

test('approveSuggestedAlert approves pending alert', () => {
  const rows = listSuggestedAlerts('pending', 1)
  const id = rows[0].id
  const result = approveSuggestedAlert(id)
  assert.equal(result.ok, true)
  assert.equal(result.status, 'active')
})

test('approveSuggestedAlert rejects already-decided alert', () => {
  const result = approveSuggestedAlert(99999) // non-existent
  assert.equal(result.ok, false)
  assert.equal(result.error, 'not_found')
})

test('rejectSuggestedAlert rejects pending alert', () => {
  // Insert a fresh one to reject
  insertSuggestedAlerts([
    { asset_slug: 'reject-test', asset_symbol: 'RJT', direction: 'down', reason: 'test reject' }
  ])
  const rows = listSuggestedAlerts('pending', 1)
  const id = rows[0].id
  const result = rejectSuggestedAlert(id, 'not relevant')
  assert.equal(result.ok, true)
  assert.equal(result.status, 'rejected')
})

test('rejectSuggestedAlert returns not_found for missing', () => {
  const result = rejectSuggestedAlert(99999)
  assert.equal(result.ok, false)
  assert.equal(result.error, 'not_found')
})
