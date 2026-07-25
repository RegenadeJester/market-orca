/**
 * Hermes Self-Improve Skill + Quality Scoring
 */
import { db } from './db.js'
import fs from 'node:fs'
import path from 'node:path'
const __dirname = import.meta.dirname
const LOG_DIR = path.join(__dirname, '..', '..', 'logs', 'hermes')
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true })

export function scoreRagQuality() {
  let score = 50
  try {
    const docs = db.prepare('SELECT count(*) as n FROM rag_evidence_chunks').get()?.n || 0
    score += Math.min(docs / 20, 20)
    const topics = db.prepare('SELECT count(DISTINCT topic) as n FROM rag_evidence_chunks').get()?.n || 0
    score += Math.min(topics * 3, 15)
    const recent = db.prepare("SELECT count(*) as n FROM rag_evidence_chunks WHERE datetime(fetched_at) > datetime('now', '-7 days')").get()?.n || 0
    score += Math.min(recent, 10)
    score = Math.min(score, 100)
  } catch (e) { console.warn('[hermes] scoreRagQuality:', e.message) }
  return { component: 'rag', score, level: score >= 80 ? 'good' : score >= 50 ? 'fair' : 'poor' }
}

export function scoreReportQuality() {
  let score = 50
  try {
    const reports = fs.readdirSync(path.join(__dirname, '..', '..', 'reports')).filter(f => f.endsWith('.json'))
    score += Math.min(reports.length * 1.5, 15)
    if (reports.length) {
      const latest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'reports', reports.sort().reverse()[0]), 'utf8'))
      const cnt = latest.topics?.reduce((s, t) => s + (t.items?.length || 0), 0) || 0
      score += Math.min(cnt, 25)
    }
  } catch (e) { console.warn('[hermes] scoreReportQuality:', e.message) }
  return { component: 'report', score, level: score >= 80 ? 'good' : score >= 50 ? 'fair' : 'poor' }
}

export function scoreMcpQuality() {
  let score = 50
  try {
    const mcpText = fs.readFileSync(path.join(__dirname, 'mcp-server.js'), 'utf8')
    const tools = (mcpText.match(/name:'[^']+'/g) || []).length
    score += Math.min(tools * 2, 20)
    if (mcpText.includes('market_orca_rag_ask')) score += 10
    score = Math.min(score, 100)
  } catch (e) { console.warn('[hermes] scoreMcpQuality:', e.message) }
  return { component: 'mcp', score, level: score >= 80 ? 'good' : score >= 50 ? 'fair' : 'poor' }
}

export function scoreAutolearnQuality() {
  let score = 50
  try {
    let n = 0
    try { n = db.prepare("SELECT count(DISTINCT json_extract(asset_tags, '$[0]')) as n FROM rag_evidence_chunks WHERE asset_tags IS NOT NULL AND asset_tags != '[]'").get()?.n || 0 } catch {}
    score += Math.min(n * 5, 25)
    const classified = db.prepare('SELECT count(*) as n FROM rag_evidence_chunks WHERE topic IS NOT NULL').get()?.n || 0
    const total = db.prepare('SELECT count(*) as n FROM rag_evidence_chunks').get()?.n || 1
    score += Math.min((classified / total) * 20, 20)
  } catch (e) { console.warn('[hermes] scoreAutolearnQuality:', e.message) }
  return { component: 'autolearn', score, level: score >= 80 ? 'good' : score >= 50 ? 'fair' : 'poor' }
}

export function advisorPulse() {
  const scores = [scoreRagQuality(), scoreReportQuality(), scoreMcpQuality(), scoreAutolearnQuality()]
  const overall = Math.round(scores.reduce((s, x) => s + x.score, 0) / scores.length)
  const issues = scores.filter(s => s.score < 60).map(s => s.component + '(' + s.score + ')')
  return { timestamp: new Date().toISOString(), overall, scores, level: overall >= 80 ? 'good' : overall >= 60 ? 'fair' : 'poor', issues }
}

export function generateImprovements() {
  const pulse = advisorPulse()
  const tasks = []
  if (pulse.overall < 80) {
    for (const s of pulse.scores) {
      if (s.score < 60) tasks.push({ priority: s.score < 40 ? 'high' : 'medium', target: s.component, action: 'Improve ' + s.component + ' quality (current: ' + s.score + '/100)' })
    }
  }
  const logFile = path.join(LOG_DIR, 'improvements-' + new Date().toISOString().slice(0,10) + '.json')
  fs.writeFileSync(logFile, JSON.stringify({ pulse, tasks }, null, 2))
  return { pulse, tasks }
}

export function applySelfCorrectives() {
  const fixes = []
  try {
    const pulse = advisorPulse()
    if (pulse.scores.find(s => s.component === 'rag')?.score < 60) {
      const r = fs.readdirSync(path.join(__dirname, '..', '..', 'reports')).filter(f => f.endsWith('.json')).sort().reverse().slice(0,3)
      fixes.push({ action: 'stale RAG, ' + r.length + ' reports ready' })
    }
  } catch (e) { console.warn('[hermes] applySelfCorrectives:', e.message) }
  return fixes
}
