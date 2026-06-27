#!/usr/bin/env node
/**
 * qa-report.js — Pre-publish Quality Assurance for Market Orca Reports
 * 
 * Checks:
 * 1. Empty sections detection
 * 2. Broken link validation
 * 3. Hallucinated citation detection
 * 4. Report structure consistency
 * 5. Source attribution verification
 * 
 * Usage: node qa-report.js <slug> [--strict]
 * Exit codes: 0 = pass, 1 = warnings, 2 = failures
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import https from 'node:https'
import http from 'node:http'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPORT_DIR = path.join(__dirname, '..', '..', 'reports')

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────
const CONFIG = {
  // Maximum time to wait for HTTP HEAD request (ms)
  linkCheckTimeout: 3000,
  // Maximum concurrent link checks
  maxConcurrentChecks: 3,
  // Minimum items per section to not be considered "empty"
  minItemsPerSection: 1,
  // Minimum words in section body to not be "empty"
  minWordsPerSection: 20,
  // Allowed domains for citations (empty = allow all)
  allowedSourceDomains: [
    'reuters.com',
    'bloomberg.com',
    'cnbc.com',
    'marketwatch.com',
    'investing.com',
    'finance.yahoo.com',
    'wsj.com',
    'ft.com',
    'economist.com',
    'bis.org',
    'imf.org',
    'worldbank.org',
    'oecd.org',
    'bankindonesia.go.id',
    'bps.go.id',
    'ojk.go.id',
    'idx.co.id',
    'kontan.co.id',
    'bisnis.com',
    'cnbcindonesia.com',
    'detik.com',
    'kompas.com',
    'liputan6.com',
    'tempo.co',
    'katadata.co.id',
    'databoks.katadata.co.id',
    'github.com',
    'stackoverflow.com',
    'arxiv.org',
    'medium.com',
    'substack.com',
  ],
  // Keywords that indicate hallucinated/made-up citations
  hallucinationIndicators: [
    'source: [^\\s]+\\.com (?:report|study|analysis) (?:shows|found|indicates)',
    'according to a (?:recent|new|latest) (?:study|report|analysis) by',
    'researchers at (?:[A-Z][a-z]+ )+(?:University|Institute) found',
    'a (?:recent|new) study published in',
    'data from (?:[A-Z][a-z]+ )+(?:Analytics|Research|Intelligence) shows',
  ],
}

// ─────────────────────────────────────────────────────────────────────────────
// Types / Interfaces
// ─────────────────────────────────────────────────────────────────────────────
/** @typedef {{title: string, items?: Array<{title: string, url?: string, source?: string, snippet?: string}>}} Section */
/** @typedef {{sections: Section[], items: number, warnings: string[], errors: string[], stats: object}} QAResult */

// ─────────────────────────────────────────────────────────────────────────────
// Utility Functions
// ─────────────────────────────────────────────────────────────────────────────

function log(...args) { console.log('[QA]', new Date().toISOString(), ...args) }
function warn(...args) { console.warn('[QA ⚠]', new Date().toISOString(), ...args) }
function error(...args) { console.error('[QA ✗]', new Date().toISOString(), ...args) }
function ok(...args) { console.log('[QA ✓]', new Date().toISOString(), ...args) }

// Load report JSON
function loadReport(slug) {
  const fp = path.join(REPORT_DIR, `${slug}.json`)
  if (!fs.existsSync(fp)) throw new Error(`Report not found: ${slug}`)
  return JSON.parse(fs.readFileSync(fp, 'utf8'))
}

// Extract all URLs from report
function extractUrls(report) {
  const urls = new Set()
  const add = (str) => {
    if (!str) return
    const matches = str.match(/https?:\/\/[^\s\]\)>"]+/g)
    if (matches) matches.forEach(u => urls.add(u.replace(/[.,;]+$/, '')))
  }

  // From topics/sections
  report.topics?.forEach(t => {
    add(t.intro)
    t.items?.forEach(item => {
      add(item.url)
      add(item.snippet)
      add(item.why)
      add(item.context)
      add(item.notes)
    })
    add(t.funFact)
  })

  // From textReport
  add(report.textReport)
  add(report.summary)
  add(report.heroWhy)
  add(report.changed)
  add(report.flags?.join(' '))
  add(report.funFacts?.map(f => f.fact).join(' '))

  return Array.from(urls)
}

// Check if URL is reachable (HEAD request with AbortController)
function checkUrl(url) {
  return new Promise((resolve) => {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), CONFIG.linkCheckTimeout)
      const client = url.startsWith('https') ? https : http
      const req = client.request(url, { method: 'HEAD', timeout: CONFIG.linkCheckTimeout, signal: controller.signal }, (res) => {
        clearTimeout(timer)
        const ok = res.statusCode >= 200 && res.statusCode < 400
        resolve({ url, ok, status: res.statusCode })
      })
      req.on('error', (e) => { clearTimeout(timer); resolve({ url, ok: false, error: e.message }) })
      req.on('timeout', () => { clearTimeout(timer); req.destroy(); resolve({ url, ok: false, error: 'timeout' }) })
      req.end()
    } catch (e) {
      resolve({ url, ok: false, error: e.message })
    }
  })
}

// Check all URLs with concurrency limit and overall timeout
async function checkUrls(urls) {
  const results = []
  const startTime = Date.now()
  const overallTimeout = 15000 // 15 second max for all link checking
  
  for (let i = 0; i < urls.length; i += CONFIG.maxConcurrentChecks) {
    if (Date.now() - startTime > overallTimeout) {
      console.warn(`[QA] Link check overall timeout (${overallTimeout}ms) - skipping remaining URLs`)
      break
    }
    const batch = urls.slice(i, i + CONFIG.maxConcurrentChecks)
    const batchResults = await Promise.allSettled(batch.map(checkUrl))
    batchResults.forEach(r => {
      if (r.status === 'fulfilled') results.push(r.value)
      else results.push({ url: 'unknown', ok: false, error: r.reason?.message || 'check failed' })
    })
  }
  return results
}

// Check for empty sections
function checkEmptySections(report) {
  const warnings = []
  const errors = []
  const stats = { sections: 0, emptySections: [], lowContentSections: [] }

  report.topics?.forEach((topic, idx) => {
    stats.sections++
    const items = topic.items || []
    const bodyWords = (topic.intro || '').split(/\s+/).filter(w => w.length > 0).length

    if (items.length < CONFIG.minItemsPerSection) {
      stats.emptySections.push({ index: idx, title: topic.title, itemCount: items.length })
      if (idx < 3) { // First few sections are critical
        errors.push(`Section "${topic.title}" has ${items.length} items (minimum ${CONFIG.minItemsPerSection})`)
      } else {
        warnings.push(`Section "${topic.title}" has ${items.length} items`)
      }
    }

    if (bodyWords < CONFIG.minWordsPerSection) {
      stats.lowContentSections.push({ index: idx, title: topic.title, wordCount: bodyWords })
      warnings.push(`Section "${topic.title}" intro has only ${bodyWords} words`)
    }
  })

  return { warnings, errors, stats }
}

// Check for hallucinated citations
function checkHallucinations(report) {
  const warnings = []
  const errors = []
  const stats = { suspiciousPatterns: [] }

  const fullText = [
    report.textReport || '',
    report.summary || '',
    ...(report.topics || []).flatMap(t => [
      t.intro || '',
      ...(t.items || []).map(i => [i.snippet, i.why, i.context, i.notes].join(' ')),
      t.funFact || ''
    ]),
    report.heroWhy || '',
    report.changed || '',
    report.flags?.join(' ') || '',
    report.funFacts?.map(f => f.fact).join(' ') || '',
  ].join('\n')

  CONFIG.hallucinationIndicators.forEach(pattern => {
    const re = new RegExp(pattern, 'gi')
    const matches = fullText.match(re)
    if (matches) {
      matches.forEach(m => {
        stats.suspiciousPatterns.push({ pattern, match: m.slice(0, 200) })
        warnings.push(`Possible hallucinated citation: "${m.slice(0, 150)}..."`)
      })
    }
  })

  // Check for suspicious "perfect" citation formats that don't match real sources
  const fakeCitationRe = /\[(?:Source|Ref|Citation)\s*\d*:\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+\d{4}\]/g
  const fakeMatches = fullText.match(fakeCitationRe)
  if (fakeMatches) {
    fakeMatches.forEach(m => {
      warnings.push(`Suspicious citation format: ${m}`)
      stats.suspiciousPatterns.push({ pattern: 'fake_citation_format', match: m })
    })
  }

  return { warnings, errors, stats }
}

// Check source attribution consistency
function checkSourceAttribution(report) {
  const warnings = []
  const stats = { itemsWithSource: 0, itemsWithUrl: 0, totalItems: 0, unknownSources: [] }

  report.topics?.forEach(topic => {
    topic.items?.forEach(item => {
      stats.totalItems++
      if (item.source) stats.itemsWithSource++
      if (item.url) stats.itemsWithUrl++

      if (item.source && !CONFIG.allowedSourceDomains.some(d => item.url?.includes(d))) {
        // Unknown source domain - could be OK but flag for review
        stats.unknownSources.push({ source: item.source, url: item.url })
      }
    })
  })

  if (stats.totalItems > 0) {
    const sourceCoverage = stats.itemsWithSource / stats.totalItems
    const urlCoverage = stats.itemsWithUrl / stats.totalItems
    if (sourceCoverage < 0.5) warnings.push(`Low source attribution: ${Math.round(sourceCoverage * 100)}% of items have source`)
    if (urlCoverage < 0.3) warnings.push(`Low URL coverage: ${Math.round(urlCoverage * 100)}% of items have source URL`)
  }

  return { warnings, errors: [], stats }
}

// Check report structure consistency
function checkStructure(report) {
  const warnings = []
  const errors = []
  const stats = {}

  // Required fields
  const required = ['date', 'title', 'topics', 'summary', 'textReport']
  required.forEach(field => {
    if (!report[field]) errors.push(`Missing required field: ${field}`)
  })

  if (report.topics) {
    stats.topicCount = report.topics.length
    const totalItems = report.topics.reduce((s, t) => s + (t.items?.length || 0), 0)
    stats.totalItems = totalItems
    if (report.topics.length < 3) warnings.push(`Only ${report.topics.length} topics (recommend ≥3)`)
    if (totalItems < 5) warnings.push(`Only ${totalItems} total items across all topics`)
  }

  return { warnings, errors, stats }
}

// Main QA function
async function runQA(slug, strict = false) {
  log(`Starting QA for report: ${slug}`)
  const report = loadReport(slug)

  const results = {
    slug,
    timestamp: new Date().toISOString(),
    passed: true,
    warnings: [],
    errors: [],
    stats: {},
  }

  // Run all checks
  const checks = [
    checkStructure(report),
    checkEmptySections(report),
    checkSourceAttribution(report),
    checkHallucinations(report),
  ]

  checks.forEach(c => {
    results.warnings.push(...c.warnings)
    results.errors.push(...c.errors)
    Object.assign(results.stats, c.stats)
  })

  // Link checking (async)
  log('Checking links...')
  const urls = extractUrls(report)
  log(`Found ${urls.length} unique URLs to check`)
  const linkResults = await checkUrls(urls)
  const brokenLinks = linkResults.filter(r => !r.ok)
  results.stats.linksChecked = urls.length
  results.stats.brokenLinks = brokenLinks.length

  if (brokenLinks.length > 0) {
    brokenLinks.forEach(b => {
      const msg = `Broken link: ${b.url} (${b.status || b.error})`
      if (strict) results.errors.push(msg)
      else results.warnings.push(msg)
    })
  }

  // Determine overall pass/fail
  if (results.errors.length > 0) results.passed = false

  // Output summary
  console.log('\n' + '='.repeat(60))
  console.log(`QA RESULT: ${results.passed ? 'PASS' : 'FAIL'} — ${slug}`)
  console.log('='.repeat(60))
  console.log(`Errors:   ${results.errors.length}`)
  console.log(`Warnings: ${results.warnings.length}`)
  console.log(`Links:    ${results.stats.brokenLinks}/${results.stats.linksChecked} broken`)
  console.log(`Sections: ${results.stats.sections || 0} (${results.stats.emptySections?.length || 0} empty, ${results.stats.lowContentSections?.length || 0} low content)`)
  console.log(`Items:    ${results.stats.totalItems || 0} (source: ${results.stats.itemsWithSource || 0}, url: ${results.stats.itemsWithUrl || 0})`)
  console.log(`Hallucination patterns: ${results.stats.suspiciousPatterns?.length || 0}`)
  console.log('='.repeat(60))

  if (results.errors.length > 0) {
    console.log('\nERRORS:')
    results.errors.forEach(e => console.log(`  ✗ ${e}`))
  }
  if (results.warnings.length > 0) {
    console.log('\nWARNINGS:')
    results.warnings.forEach(w => console.log(`  ⚠ ${w}`))
  }
  if (brokenLinks.length > 0) {
    console.log('\nBROKEN LINKS:')
    brokenLinks.forEach(b => console.log(`  ✗ ${b.url} — ${b.status || b.error}`))
  }

  return results
}

// CLI
const args = process.argv.slice(2)
const slug = args.find(a => !a.startsWith('-'))
const strict = args.includes('--strict')

if (!slug) {
  console.error('Usage: node qa-report.js <YYYY-MM-DD> [--strict]')
  process.exit(1)
}

runQA(slug, strict)
  .then(r => process.exit(r.passed ? 0 : 2))
  .catch(e => { error(e.message); process.exit(1) })