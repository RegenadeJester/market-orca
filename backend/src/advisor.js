/**
 * Real-Time Advisor — review actions against quality rules
 */
import { db } from './db.js'
import fs from 'node:fs'
import path from 'node:path'
const __dirname = import.meta.dirname

const RULES = [
  { id: 'no_citations', pattern: /answer.*without.*citation|citation.*0/, severity: 'error', correction: 'Setiap claim RAG wajib punya citation [source N]' },
  { id: 'truncated', pattern: /slice\(0,\s*\d\d\d\)|truncate.*[12]\d\d/, severity: 'error', correction: 'Jangan potong snippet <300 chars, raise limit ke 500+' },
  { id: 'empty_catch', pattern: /catch\s*\{\s*\}/, severity: 'warning', correction: 'Empty catch — log error minimal console.error()' },
  { id: 'missing_url', pattern: /source_url.*null|url.*['"]\s*['"]/, severity: 'warning', correction: 'Isi source_url untuk citation dan trust score' },
  { id: 'no_topic', pattern: /topic.*null|topic.*['"]\s*['"]/, severity: 'warning', correction: 'Setiap RAG chunk harus punya topic' }
]

export function reviewAction(action, context = {}) {
  const findings = []
  const text = typeof action === 'string' ? action : JSON.stringify(action) + ' ' + JSON.stringify(context)
  for (const r of RULES) {
    if (r.pattern.test(text)) findings.push({ ruleId: r.id, severity: r.severity, correction: r.correction })
  }
  if (context.type === 'report' && (context.items || 0) < 10) {
    findings.push({ ruleId: 'too_few_items', severity: 'warning', correction: 'Target 15+ items per report' })
  }
  return {
    timestamp: new Date().toISOString(),
    passed: findings.length === 0,
    findings,
    score: findings.length === 0 ? 100 : findings.some(f => f.severity === 'error') ? 30 : 60,
    recommendation: findings.length === 0 ? '✅ Clean' : findings.map(f => '(' + f.severity + ') ' + f.correction).join(' | ')
  }
}

export function dailyAdvisorSummary() {
  return { totalInterventions: 0, cleanActions: 0 }
}
