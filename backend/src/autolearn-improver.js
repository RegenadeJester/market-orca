#!/usr/bin/env node
/**
 * autolearn-improver.js — Autonomous report quality improvement system
 *
 * Continually evaluates Market Orca reports for:
 *   - Language purity (Indo-English mixing)
 *   - Writing quality (readability, structure, signal:noise)
 *   - News accuracy (source freshness, citation coverage)
 *   - Breaking news potential (public reaction signals)
 *   - UI delivery (frontend rendering quality)
 *
 * Usage:
 *   node autolearn-improver.js --evaluate          Score last 7 days of reports
 *   node autolearn-improver.js --evaluate --days=1  Score today's report only
 *   node autolearn-improver.js --evaluate --days=7 --deep  Deep analysis + pattern extraction
 *   node autolearn-improver.js --fix-language       Patch report templates with better ID
 *   node autolearn-improver.js --apply-improvements Apply all pending improvements
 *   node autolearn-improver.js --status             Show current quality trend
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..')  // backend/src → project root
const REPORTS_DIR = join(ROOT, 'reports')
const AUTOLEARN_DIR = join(REPORTS_DIR, 'autolearn')
const REPORT_SRC = join(__dirname, 'ai-daily-report.js')

// ---- Config ----
const ALLOWED_ENGLISH = [
  'AI', 'API', 'RAG', 'MCP', 'LLM', 'REST', 'HTTP', 'JSON', 'SQL',
  'FTS', 'SSE', 'CRUD', 'CI/CD', 'QA', 'UI', 'UX', 'JWT', 'OAuth',
  'TLKM', 'BBRI', 'BMRI', 'ASII', 'ADRO', 'ANTM', 'BBNI', 'SMGR', 'INDF', 'EXCL',
  'JKSE', 'JKLQ45', 'IDR', 'USD', 'BTC', 'ETH', 'SOL',
  'NYSE', 'NASDAQ', 'IDX', 'S&P', 'DJI',
  'Node.js', 'SQLite', 'Discord', 'GitHub',
]

const ENGLISH_HEADERS = [
  '## What Changed Today',
  '## Report Quality',
  '## Suggested Alerts',
  '> Vibe check:',
  '> Why it matters:',
  '> Why care:',
  '# Full Drop — AI DAILY REPORT',
]

const ID_REPLACEMENTS = {
  '## What Changed Today': '## Yang Berubah Hari Ini',
  '## Report Quality': '## Kualitas Laporan',
  '## Suggested Alerts': '## Alert yang Disarankan',
  '## Suggested Alerts (Smart Alert Threshold)': '## Alert yang Disarankan (Smart Alert)',
  '## Red Flags': '## Bendera Merah',
  '## Actionable Watchlist': '## Watchlist Prioritas',
  '## Data Status': '## Status Data',
  '> Vibe check:': '> Mood pasar:',
  '> Why it matters:': '> Kenapa penting:',
  '> Why care:': '> Kenapa penting:',
  '# Full Drop — AI DAILY REPORT': '# Laporan Lengkap — AI Daily Report',
  'TL;DR buat yang males baca': 'Ringkasan Eksekutif',
  '**Score:**': '**Skor:**',
  '**Sources:**': '**Sumber:**',
  '**Items:**': '**Item:**',
  '**Duplicates:**': '**Duplikat:**',
  '**Stale:**': '**Kedaluwarsa:**',
  '**Source rotation:**': '**Rotasi Sumber:**',
  'Tidak ada alert candidates dari report hari ini.': 'Tidak ada kandidat alert dari laporan hari ini.',
  'Top Story:': 'Berita Utama:',
  'Kenapa penting:': 'Dampak:',
  'Sentimen pasar:': 'Sentimen Pasar:',
  'Indonesia Pulse:': 'Pulsa Indonesia:',
  'Coverage:': 'Cakupan:',
  'Data belum tersedia:': 'Data belum tersedia:',
}

// ---- Core evaluators ----

function findReportFiles(days) {
  const cutoff = new Date(Date.now() - days * 86400000)
  if (!existsSync(REPORTS_DIR)) return []
  return readdirSync(REPORTS_DIR)
    .filter(f => f.endsWith('.md') && !f.includes('autolearn') && !f.includes('-brief'))
    .map(f => {
      const fp = join(REPORTS_DIR, f)
      const { mtime } = existsSync(fp) ? statSync(fp) : { mtime: new Date(0) }
      return { file: f, path: fp, mtime }
    })
    .filter(({ mtime }) => mtime >= cutoff)
    .sort((a, b) => b.mtime - a.mtime)
}

function scoreLanguage(text) {
  const lines = text.split('\n')
  let englishSegmentCount = 0
  let totalSegmentCount = 0
  const issues = []
  const seen = new Set()

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line || line.startsWith('<http') || line.startsWith('```')) continue

    // Check section headers
    for (const header of ENGLISH_HEADERS) {
      if (line.startsWith(header) && !seen.has(header)) {
        englishSegmentCount++
        totalSegmentCount++
        seen.add(header)
        issues.push({ line: i + 1, issue: `EN header: "${line.substring(0, 40)}"`, severity: 'medium' })
        break
      }
    }
    totalSegmentCount++
  }

  // Check inline English terms in ID sections
  const idSectionLines = lines.filter(l => !l.startsWith('##') && !l.startsWith('>') && !l.startsWith('```') && l.trim())
  let inlineIssues = 0
  for (const line of idSectionLines) {
    const words = line.split(/\s+/).filter(w => /^[a-zA-Z]+$/.test(w) && w.length > 2)
    for (const word of words) {
      if (!ALLOWED_ENGLISH.includes(word) && !ALLOWED_ENGLISH.includes(word.toUpperCase())) {
        inlineIssues++
      }
    }
  }

  const score = Math.max(0, Math.round(100 - (englishSegmentCount / Math.max(1, totalSegmentCount) * 100) - inlineIssues * 0.5))
  return { score: Math.max(0, Math.min(100, score)), issues }
}

function scoreWriting(text) {
  // Readability: average sentence length, paragraph structure
  const lines = text.split('\n').filter(l => l.trim())
  const contentLines = lines.filter(l => !l.startsWith('>') && !l.startsWith('<') && !l.startsWith('```') && l.trim().length > 20)
  if (contentLines.length === 0) return { score: 50, issues: [{ issue: 'No content to evaluate', severity: 'high' }] }

  const avgLineLen = contentLines.reduce((s, l) => s + l.replace(/\*\*/g, '').length, 0) / contentLines.length
  const hasHeaderCount = lines.filter(l => l.startsWith('##')).length
  const hasBullet = contentLines.filter(l => l.trim().startsWith('-')).length
  const hasActionable = text.includes('✅') || text.includes('⚠️') || text.includes('📌')

  let score = 70
  const issues = []

  if (avgLineLen > 200) { score -= 15; issues.push({ issue: `Lines too long (avg ${Math.round(avgLineLen)} chars)`, severity: 'medium' }) }
  if (avgLineLen < 30) { score -= 10; issues.push({ issue: 'Lines too short (fragments)', severity: 'low' }) }
  if (hasHeaderCount < 4) { score -= 10; issues.push({ issue: `Few sections (${hasHeaderCount})`, severity: 'medium' }) }
  if (hasBullet < 1) { score -= 5; issues.push({ issue: 'No bullet lists', severity: 'low' }) }
  if (!hasActionable) { score -= 5; issues.push({ issue: 'No actionable icons (✅⚠️📌)', severity: 'low' }) }

  // Bonus: good signals
  if (hasHeaderCount >= 8) score += 10
  if (hasBullet >= 10) score += 5
  if (hasActionable) score += 5

  return { score: Math.max(0, Math.min(100, score)), issues }
}

function scoreAccuracy(text) {
  const issues = []
  let score = 80

  // Check for stale data warnings
  if (text.includes('data stale') || text.includes('Data belum tersedia')) {
    score -= 20
    issues.push({ issue: 'Contains stale/missing data indicators', severity: 'high' })
  }

  // Check citation count (URLs per item ratio)
  const urls = (text.match(/https?:\/\/[^\s\n>]+/g) || []).length
  const items = (text.match(/^\d+\.\s+\[/gm) || []).length
  if (items > 0 && urls < items) {
    score -= 10
    issues.push({ issue: `Citations incomplete (${urls} URLs for ${items} items)`, severity: 'medium' })
  }

  // Check source count
  const sourceMatch = text.match(/\*\*Sumber:\*\*\s+(\d+)/)
  if (sourceMatch) {
    const sourceCount = parseInt(sourceMatch[1])
    if (sourceCount < 3) {
      score -= 15
      issues.push({ issue: `Low source diversity: ${sourceCount} sources`, severity: 'high' })
    }
  }

  return { score: Math.max(0, Math.min(100, score)), issues }
}

function scoreBreaking(text) {
  const issues = []
  let score = 50

  // Check for fresh items (< 1h)
  const freshMentions = (text.match(/fresh\s*<\s*1h/gi) || []).length
  if (freshMentions > 0) {
    score += freshMentions * 10
    issues.push({ issue: `${freshMentions} breaking items (fresh <1h)`, severity: 'info' })
  }

  // Check for price anomaly section signals
  if (text.includes('Anomali') || text.includes('⚠️')) score += 15

  // Check for high-impact keywords
  const impactWords = ['crash', 'surge', 'plunge', 'moon', 'ban', 'launch', 'scandal', 'lawsuit', 'SEC', 'Fed', 'rate', 'war', 'crisis']
  const impactCount = impactWords.filter(w => text.toLowerCase().includes(w)).length
  score += impactCount * 5

  return { score: Math.max(0, Math.min(100, score)), issues }
}

function scoreUI(text) {
  const issues = []
  let score = 70

  // Check for HTML markers (if exists)
  if (text.includes('<div') || text.includes('<p>') || text.includes('class=')) {
    score += 10
  }

  // Markdown structure check
  const hasHeadings = text.includes('## ')
  const hasBold = text.includes('**')
  const hasLinks = text.includes('http')
  const hasLists = text.startsWith('1.') || text.includes('\n- ')

  if (!hasHeadings) { score -= 20; issues.push({ issue: 'No markdown headings', severity: 'high' }) }
  if (!hasBold) { score -= 5; issues.push({ issue: 'No bold text', severity: 'low' }) }
  if (!hasLinks) { score -= 10; issues.push({ issue: 'No links/citations', severity: 'medium' }) }
  if (!hasLists) { score -= 5; issues.push({ issue: 'No lists', severity: 'low' }) }

  return { score: Math.max(0, Math.min(100, score)), issues }
}

function scoreValue(userLang = 'Bahasa Indonesia') {
  // Dummy for now: checks user_context mentions
  let score = 70
  const issues = []

  return { score, issues }
}

// ---- Autolearn pipeline ----

function evaluateReport(content, file) {
  const lang = scoreLanguage(content)
  const writing = scoreWriting(content)
  const accuracy = scoreAccuracy(content)
  const breaking = scoreBreaking(content)
  const ui = scoreUI(content)
  const value = scoreValue()

  const total = Math.round(
    lang.score * 0.25 +
    writing.score * 0.20 +
    accuracy.score * 0.20 +
    breaking.score * 0.15 +
    ui.score * 0.10 +
    value.score * 0.10
  )

  return {
    report: file,
    date: new Date().toISOString(),
    total,
    dimensions: { lang, writing, accuracy, breaking, ui, value },
    improvementPriority: getPriority(lang, writing, accuracy, breaking, ui),
  }
}

function getPriority(...scorers) {
  const lows = scorers.filter(s => s.score < 50)
  if (lows.length > 2) return 'CRITICAL'
  if (lows.length > 0) return 'HIGH'
  if (scorers.some(s => s.score < 70)) return 'MEDIUM'
  return 'LOW'
}

function generateImprovementPlan(evaluations) {
  // Aggregate issues across evaluations
  const allIssues = []
  for (const ev of evaluations) {
    for (const [dim, data] of Object.entries(ev.dimensions)) {
      for (const issue of data.issues) {
        allIssues.push({ ...issue, dimension: dim, report: ev.report })
      }
    }
  }

  // Rank by frequency
  const freq = {}
  for (const issue of allIssues) {
    const key = issue.issue
    if (!freq[key]) freq[key] = { count: 0, dimensions: new Set(), reports: new Set(), severity: issue.severity }
    freq[key].count++
    freq[key].dimensions.add(issue.dimension)
    freq[key].reports.add(issue.report)
    if (issue.severity === 'high') freq[key].severity = 'high'
  }

  const sorted = Object.entries(freq)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([issue, data]) => ({
      issue,
      count: data.count,
      severity: data.severity,
      spread: data.reports.size,
      dimensions: [...data.dimensions],
    }))

  return sorted
}

function patchReportTemplate() {
  // Apply language fixes directly to ai-daily-report.js
  if (!existsSync(REPORT_SRC)) return { applied: 0, errors: ['ai-daily-report.js not found'] }

  let code = readFileSync(REPORT_SRC, 'utf-8')
  let applied = 0
  const errors = []

  for (const [en, id] of Object.entries(ID_REPLACEMENTS)) {
    const count = (code.match(new RegExp(en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length
    if (count > 0) {
      code = code.replaceAll(en, id)
      applied++
    }
  }

  writeFileSync(REPORT_SRC, code, 'utf-8')
  return { applied, errors }
}

// ---- Main ----

async function main() {
  const args = process.argv.slice(2)
  const days = parseInt(args.find(a => a.startsWith('--days='))?.split('=')[1] || '7')
  const isDeep = args.includes('--deep')
  const isDryRun = args.includes('--dry-run')
  const isFixLanguage = args.includes('--fix-language')

  if (!existsSync(AUTOLEARN_DIR)) mkdirSync(AUTOLEARN_DIR, { recursive: true })

  if (isFixLanguage) {
    console.log('🔧 Patching report templates with Indonesian translations...')
    const result = patchReportTemplate()
    if (result.errors.length) {
      console.error('❌ Errors:', result.errors.join(', '))
    } else {
      console.log(`✅ ${result.applied} replacements applied to ai-daily-report.js`)
    }
    return
  }

  // ---- Evaluate reports ----
  if (args.includes('--evaluate') || args.includes('--status')) {
    const reports = findReportFiles(days)
    if (reports.length === 0) {
      console.log(`No reports found in last ${days} days`)
      return
    }

    console.log(`📊 Evaluating ${reports.length} reports from last ${days} days...\n`)

    const evaluations = reports.map(({ file, path }) => {
      const content = readFileSync(path, 'utf-8')
      return evaluateReport(content, file)
    })

    // Summary
    const avg = evals => Math.round(evals.reduce((s, e) => s + e.total, 0) / evals.length)
    const worst = evals => evals.reduce((w, e) => e.total < w.total ? e : w, evals[0])
    const best = evals => evals.reduce((b, e) => e.total > b.total ? e : b, evals[0])

    console.log('═══════════════════════════════════════')
    console.log(`  Overall: ${avg(evaluations)}/100  (${evaluations.length} reports)`)
    console.log(`  Best:    ${best(evaluations).total}/100 — ${best(evaluations).report}`)
    console.log(`  Worst:   ${worst(evaluations).total}/100 — ${worst(evaluations).report}`)
    console.log('═══════════════════════════════════════\n')

    for (const ev of evaluations) {
      console.log(`  ${ev.report}: ${ev.total}/100 [${ev.improvementPriority}]`)
      for (const [dim, data] of Object.entries(ev.dimensions)) {
        const bar = '█'.repeat(Math.floor(data.score / 10)) + '░'.repeat(Math.max(0, 10 - Math.floor(data.score / 10)))
        console.log(`    ${dim.padEnd(10)} ${bar} ${data.score}/100`)
      }
      console.log()
    }

    if (isDeep || evaluations.length > 2) {
      const improvements = generateImprovementPlan(evaluations)
      console.log(`\n📋 Top Improvements Needed:\n`)
      improvements.slice(0, 10).forEach((imp, i) => {
        console.log(`  ${i + 1}. [${imp.severity.toUpperCase()}] (×${imp.count}) ${imp.issue}`)
        if (imp.dimensions.length) console.log(`     Affects: ${imp.dimensions.join(', ')}`)
      })

      // Save evaluation
      if (!isDryRun) {
        const evalFile = join(AUTOLEARN_DIR, `evaluation-${new Date().toISOString().slice(0, 10)}.json`)
        const improvementsFile = join(AUTOLEARN_DIR, `improvements-${new Date().toISOString().slice(0, 10)}.md`)

        writeFileSync(evalFile, JSON.stringify({
          generated: new Date().toISOString(),
          reportsExamined: reports.length,
          days,
          averageScore: avg(evaluations),
          evaluations,
          improvements,
        }, null, 2), 'utf-8')

        writeFileSync(improvementsFile, [
          `# Improvement Plan — ${new Date().toISOString().slice(0, 10)}`,
          '',
          `**Score:** ${avg(evaluations)}/100 over ${reports.length} reports`,
          '',
          '## Priority Items',
          ...improvements.slice(0, 15).map((imp, i) =>
            `- [${imp.severity.toUpperCase()}] **${imp.issue}** (×${imp.count}, ${imp.spread} reports)`
          ),
          '',
          '## Dimension Breakdown',
          ...['lang', 'writing', 'accuracy', 'breaking', 'ui', 'value'].map(d => {
            const avgScore = Math.round(evaluations.reduce((s, e) => s + e.dimensions[d]?.score || 0, 0) / evaluations.length)
            const avgIssues = Math.round(evaluations.reduce((s, e) => s + (e.dimensions[d]?.issues?.length || 0), 0) / evaluations.length)
            return `- **${d}:** avg ${avgScore}/100 (${avgIssues} avg issues)`
          }),
          '',
          `## Reports Evaluated`,
          ...evaluations.map(e => `- ${e.report}: ${e.total}/100 [${e.improvementPriority}]`),
          '',
          `_Generated by autolearn-improver.js_`,
        ].join('\n'), 'utf-8')

        console.log(`\n💾 Saved: ${evalFile}`)
        console.log(`💾 Saved: ${improvementsFile}`)
      }
    }
  }

  if (args.includes('--status')) {
    const evalsDir = AUTOLEARN_DIR
    if (!existsSync(evalsDir)) {
      console.log('No evaluations yet. Run --evaluate first.')
      return
    }
    const files = readdirSync(evalsDir).filter(f => f.startsWith('evaluation')).sort()
    if (files.length === 0) {
      console.log('No evaluations found.')
      return
    }
    const last = JSON.parse(readFileSync(join(evalsDir, files[files.length - 1]), 'utf-8'))
    console.log(`📊 Last evaluation: ${files[files.length - 1]}`)
    console.log(`   Score: ${last.averageScore}/100 over ${last.reportsExamined} reports`)
    console.log(`   Top priority: ${last.improvements?.[0]?.issue || 'none'}`)
  }
}

main().catch(console.error)
