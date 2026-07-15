/**
 * Pipeline Monitor — End-to-end pipeline tracking for Market Orca
 * Tracks: news search → RAG ingest → autolearn → report → QA → Discord
 */

import { db } from './db.js'

// ─── Pipeline Schema ──────────────────────────────────────────────────────
db.exec(`
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_type TEXT NOT NULL DEFAULT 'full', -- 'full' | 'news' | 'rag' | 'report' | 'manual'
  status TEXT NOT NULL DEFAULT 'running', -- 'running' | 'completed' | 'failed' | 'partial'
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  items_ingested INTEGER DEFAULT 0,
  items_classified INTEGER DEFAULT 0,
  report_score INTEGER,
  report_slug TEXT,
  error_message TEXT,
  metadata TEXT -- JSON for extra info
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_started ON pipeline_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status ON pipeline_runs(status);

CREATE TABLE IF NOT EXISTS pipeline_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  stage TEXT NOT NULL, -- 'news_search' | 'rag_ingest' | 'autolearn' | 'report_gen' | 'qa_gate' | 'discord_delivery' | 'rag_answer' | 'breaking_news'
  status TEXT NOT NULL, -- 'started' | 'completed' | 'failed' | 'skipped'
  message TEXT,
  details TEXT, -- JSON
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (run_id) REFERENCES pipeline_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pipeline_events_run ON pipeline_events(run_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_events_stage ON pipeline_events(stage);
`)

// ─── Helpers ──────────────────────────────────────────────────────────────
function nowISO() { return new Date().toISOString() }
function parseJSONsafe(s, fallback) { try { return JSON.parse(s) } catch { return fallback } }

// ─── Core Functions ───────────────────────────────────────────────────────

/** Start a new pipeline run */
export function startPipelineRun(runType = 'full', metadata = {}) {
  const info = db.prepare(`
    INSERT INTO pipeline_runs (run_type, status, metadata)
    VALUES (?, 'running', ?)
  `).run(runType, JSON.stringify(metadata))
  return info.lastInsertRowid
}

/** Log a pipeline event */
export function logPipelineEvent(runId, stage, status, message = '', details = {}) {
  db.prepare(`
    INSERT INTO pipeline_events (run_id, stage, status, message, details)
    VALUES (?, ?, ?, ?, ?)
  `).run(runId, stage, status, message, JSON.stringify(details))
}

/** Complete a pipeline run */
export function completePipelineRun(runId, status, { itemsIngested = 0, itemsClassified = 0, reportScore = null, reportSlug = null, errorMessage = null } = {}) {
  db.prepare(`
    UPDATE pipeline_runs
    SET status = ?, completed_at = ?, items_ingested = ?, items_classified = ?, report_score = ?, report_slug = ?, error_message = ?
    WHERE id = ?
  `).run(status, nowISO(), itemsIngested, itemsClassified, reportScore, reportSlug, errorMessage, runId)
}

/** Get latest pipeline run status */
export function getLatestPipelineStatus() {
  const run = db.prepare(`
    SELECT * FROM pipeline_runs ORDER BY started_at DESC LIMIT 1
  `).get()
  if (!run) return { ok: false, message: 'No pipeline runs recorded' }
  
  const events = db.prepare(`
    SELECT * FROM pipeline_events WHERE run_id = ? ORDER BY created_at
  `).all(run.id)
  
  return {
    ok: true,
    run: {
      ...run,
      metadata: parseJSONsafe(run.metadata, {}),
      events: events.map(e => ({ ...e, details: parseJSONsafe(e.details, {}) }))
    }
  }
}

/** Get recent pipeline events */
export function getRecentPipelineEvents(limit = 50) {
  const events = db.prepare(`
    SELECT e.*, r.run_type, r.status as run_status
    FROM pipeline_events e
    JOIN pipeline_runs r ON e.run_id = r.id
    ORDER BY e.created_at DESC
    LIMIT ?
  `).all(limit)
  return { ok: true, events: events.map(e => ({ ...e, details: parseJSONsafe(e.details, {}) })) }
}

/** Get pipeline run by ID */
export function getPipelineRun(runId) {
  const run = db.prepare(`SELECT * FROM pipeline_runs WHERE id = ?`).get(runId)
  if (!run) return { ok: false, error: 'not_found' }
  const events = db.prepare(`SELECT * FROM pipeline_events WHERE run_id = ? ORDER BY created_at`).all(runId)
  return { ok: true, run: { ...run, metadata: parseJSONsafe(run.metadata, {}), events: events.map(e => ({ ...e, details: parseJSONsafe(e.details, {}) })) } }
}

/** Get pipeline stats */
export function getPipelineStats() {
  const totalRuns = db.prepare(`SELECT count(*) as n FROM pipeline_runs`).get()?.n || 0
  const completed = db.prepare(`SELECT count(*) as n FROM pipeline_runs WHERE status = 'completed'`).get()?.n || 0
  const failed = db.prepare(`SELECT count(*) as n FROM pipeline_runs WHERE status = 'failed'`).get()?.n || 0
  const running = db.prepare(`SELECT count(*) as n FROM pipeline_runs WHERE status = 'running'`).get()?.n || 0
  const lastCompleted = db.prepare(`
    SELECT * FROM pipeline_runs WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 1
  `).get()
  const lastFailed = db.prepare(`
    SELECT * FROM pipeline_runs WHERE status = 'failed' ORDER BY completed_at DESC LIMIT 1
  `).get()
  
  const avgItems = db.prepare(`
    SELECT avg(items_ingested) as avg_ingested, avg(items_classified) as avg_classified, avg(report_score) as avg_score
    FROM pipeline_runs WHERE status = 'completed' AND items_ingested > 0
  `).get()
  
  return {
    ok: true,
    totalRuns,
    completed,
    failed,
    running,
    successRate: totalRuns ? Math.round((completed / totalRuns) * 100) : 0,
    lastCompleted: lastCompleted ? { slug: lastCompleted.report_slug, score: lastCompleted.report_score, at: lastCompleted.completed_at } : null,
    lastFailed: lastFailed ? { error: lastFailed.error_message, at: lastFailed.completed_at } : null,
    averages: {
      itemsIngested: Math.round(avgItems?.avg_ingested || 0),
      itemsClassified: Math.round(avgItems?.avg_classified || 0),
      reportScore: Math.round(avgItems?.avg_score || 0)
    }
  }
}

/** Clean old pipeline runs (keep last N) */
export function cleanupPipelineRuns(keepLast = 100) {
  const oldIds = db.prepare(`
    SELECT id FROM pipeline_runs ORDER BY started_at DESC LIMIT -1 OFFSET ?
  `).all(keepLast).map(r => r.id)
  if (!oldIds.length) return { deleted: 0 }
  const placeholders = oldIds.map(() => '?').join(',')
  const deleted = db.prepare(`DELETE FROM pipeline_events WHERE run_id IN (${placeholders})`).run(...oldIds)
  const runsDeleted = db.prepare(`DELETE FROM pipeline_runs WHERE id IN (${placeholders})`).run(...oldIds)
  return { deleted: runsDeleted.changes, eventsDeleted: deleted.changes }
}

/** Get stage breakdown for a run */
export function getStageBreakdown(runId) {
  const events = db.prepare(`
    SELECT stage, status, count(*) as count, min(created_at) as started, max(created_at) as finished
    FROM pipeline_events WHERE run_id = ? GROUP BY stage, status
  `).all(runId)
  
  const stages = ['news_search', 'breaking_news', 'rag_ingest', 'autolearn', 'report_gen', 'qa_gate', 'discord_delivery', 'rag_answer']
  const breakdown = {}
  for (const stage of stages) {
    const s = events.filter(e => e.stage === stage)
    if (s.length === 0) {
      breakdown[stage] = { status: 'not_run', duration_ms: 0 }
    } else {
      const completed = s.find(e => e.status === 'completed')
      const failed = s.find(e => e.status === 'failed')
      const started = s.find(e => e.status === 'started')
      breakdown[stage] = {
        status: completed ? 'completed' : failed ? 'failed' : started ? 'running' : 'unknown',
        duration_ms: completed && started ? new Date(completed.created_at) - new Date(started.created_at) : 0,
        events: s.length
      }
    }
  }
  return { ok: true, breakdown }
}

export { db }