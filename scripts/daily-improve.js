#!/usr/bin/env node
/**
 * Daily Self-Improvement Cron (02:05 WIB)
 */
import { generateImprovements, applySelfCorrectives } from '../backend/src/hermes-skill.js'
import { dailyAdvisorSummary } from '../backend/src/advisor.js'
import { db } from '../backend/src/db.js'
import fs from 'node:fs'
import path from 'node:path'

const LOG_DIR = path.join(import.meta.dirname, '..', 'logs', 'daily-improve')
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true })

async function main() {
  console.log('🧠 Daily Self-Improvement', new Date().toISOString())
  const { pulse, tasks } = generateImprovements()
  console.log('  Overall:', pulse.overall, pulse.level)
  pulse.scores.forEach(s => console.log('  ', s.component, s.score, s.level))

  const fixes = applySelfCorrectives()
  fixes.forEach(f => console.log('  ✅', f.action))

  const advisor = dailyAdvisorSummary()
  console.log('  Advisor:', advisor.totalInterventions, 'interventions')

  const outFile = path.join(LOG_DIR, 'improve-' + new Date().toISOString().slice(0,10) + '.json')
  fs.writeFileSync(outFile, JSON.stringify({ timestamp: new Date().toISOString(), pulse, tasks, fixes }, null, 2))
  console.log('📝 Saved:', outFile)
}
main().catch(e => { console.error(e); process.exit(1) })