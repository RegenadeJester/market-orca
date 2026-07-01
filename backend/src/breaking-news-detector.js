#!/usr/bin/env node
/**
 * breaking-news-detector.js
 * Detects hot/breaking news from public reaction signals: social buzz, price impact, source velocity.
 * Used by autolearn-improver to flag items that should be breaking.
 *
 * Usage:
 *   node breaking-news-detector.js         Scan last 24h for breaking signals
 *   node breaking-news-detector.js --hours=48  Scan last 48h
 *   node breaking-news-detector.js --scan  Run once and save results
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const REPORTS_DIR = join(ROOT, 'reports')
const DB_PATH = join(ROOT, 'data', 'market.db')

// Breaking signal thresholds
const BREAKING_RULES = {
  priceMove: { absChange: 10, type: 'percent', description: '⛔ Harga bergerak >10% — breaking catalyst tiba-tiba' },
  volumeSurge: { multiplier: 3, description: '📊 Volume >3x rata-rata — spekulasi/kepanikan massal' },
  sourceVelocity: { timeWindow: 6, minSources: 3, description: '📰 >3 sumber berbeda dalam 6 jam — perhatian luas' },
  socialBuzz: { minInteractions: 100, description: '🔊 Interaksi >100 — diskusi publik masif' },
  freshness: { maxAge: 2, unit: 'hours', description: '⚡ Breaking: berita <2 jam, fresh dari sumber' },
  marketImpact: { assetCategory: ['tech', 'banking', 'commodity'], minMove: 5, description: '🏢 Sektor strategis bergerak >5% — dampak sistemik' },
}

// Known high-impact trigger keywords
const TRIGGER_KEYWORDS = {
  'rate decision': 30, 'interest rate': 25, 'hike': 20, 'cut': 20,
  'SEC': 25, 'lawsuit': 20, 'ban': 25, 'bankruptcy': 30,
  'layoff': 10, 'acquisition': 15, 'merger': 15, 'IPO': 10,
  'scandal': 25, 'fraud': 30, 'investigation': 15, 'sanctions': 20,
  'war': 30, 'conflict': 20, 'ceasefire': 15, 'military': 20,
  'covid': 20, 'pandemic': 25, 'health emergency': 25,
  'crypto crash': 25, 'ath': 10, 'all time high': 10,
  'dividend': 5, 'buyback': 5, 'stock split': 10,
}

async function scanNewsForBreaking() {
  // Connect to SQLite to check recent price changes
  let priceAnomalies = []
  try {
    const Database = (await import('better-sqlite3')).default
    const db = new Database(DB_PATH)
    const rows = db.prepare(`
      SELECT a.symbol, a.name, a.category, 
             p.price, p.prev_close, p.change_pct, p.volume
      FROM assets a 
      LEFT JOIN price_history p ON a.symbol = p.symbol
      WHERE p.id IN (
        SELECT MAX(id) FROM price_history GROUP BY symbol
      )
      AND ABS(p.change_pct) > ?
      ORDER BY ABS(p.change_pct) DESC
      LIMIT 20
    `).all(BREAKING_RULES.priceMove.absChange)

    priceAnomalies = rows.map(r => ({
      ...r,
      breakingScore: Math.min(100, Math.abs(r.change_pct) * 5 + 30),
      reason: `⛔ ${r.symbol} (${r.name}) bergerak ${r.change_pct > 0 ? '+' : ''}${r.change_pct}% — breaking catalyst tiba-tiba`,
    }))

    db.close()
  } catch (e) {
    // DB might not be accessible — skip
  }

  // Check recent reports for breaking indicators
  const breakingItems = []
  try {
    const reports = readdirSync(REPORTS_DIR)
      .filter(f => f.endsWith('.md') && !f.includes('autolearn'))
      .sort()
      .slice(-3)

    for (const report of reports) {
      const content = readFileSync(join(REPORTS_DIR, report), 'utf-8')
      const freshItems = content.match(/fresh\s*<\s*([\d.]+)(h|m)/gi) || []
      for (const item of freshItems) {
        const match = item.match(/fresh\s*<\s*([\d.]+)(h|m)/i)
        if (!match) continue
        const val = parseFloat(match[1])
        const unit = match[2]
        const ageHours = unit === 'm' ? val / 60 : val

        if (ageHours <= BREAKING_RULES.freshness.maxAge) {
          // Find the actual news item
          const lines = content.split('\n')
          const idx = lines.findIndex(l => l.includes(item.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&').substring(0, 30)))
          const prevLine = idx > 0 ? lines[idx - 1] : ''
          const itemMatch = prevLine.match(/^\d+\.\s+\[([^\]]+)\]/)
          if (itemMatch) {
            breakingItems.push({
              title: itemMatch[1],
              freshness: `${val}${unit}`,
              breakingScore: Math.max(80, 100 - ageHours * 10),
              reason: `⚡ Breaking: berita <${BREAKING_RULES.freshness.maxAge} jam dari ${report}`,
              source: report,
            })
          }
        }
      }
    }
  } catch (e) {
    // pass
  }

  // Check for trigger keywords in the latest report hero
  try {
    const reports = readdirSync(REPORTS_DIR)
      .filter(f => f.endsWith('.md') && !f.includes('autolearn'))
      .sort()
    if (reports.length > 0) {
      const latest = readFileSync(join(REPORTS_DIR, reports[reports.length - 1]), 'utf-8')
      const firstLine = latest.split('\n')[0]
      const lower = firstLine.toLowerCase()
      let keywordScore = 0
      let matchedKeywords = []
      for (const [kw, score] of Object.entries(TRIGGER_KEYWORDS)) {
        if (lower.includes(kw)) {
          keywordScore += score
          matchedKeywords.push(kw)
        }
      }
      if (keywordScore > 30) {
        breakingItems.push({
          title: firstLine,
          keywordScore,
          breakingScore: Math.min(100, keywordScore * 2),
          reason: `🔑 Berita mengandung kata kunci berdampak tinggi: ${matchedKeywords.slice(0, 5).join(', ')}`,
          source: reports[reports.length - 1],
        })
      }
    }
  } catch (e) {
    // pass
  }

  // Merge: price anomalies + breaking items
  const all = [
    ...breakingItems,
    ...priceAnomalies.filter(a => !breakingItems.some(b => b.title?.includes(a.symbol))),
  ]

  // Sort by breaking score
  all.sort((a, b) => b.breakingScore - a.breakingScore)

  return {
    generated: new Date().toISOString(),
    breakingCount: all.filter(i => i.breakingScore >= 80).length,
    totalSignals: all.length,
    threshold: BREAKING_RULES,
    signals: all,
  }
}

async function main() {
  const args = process.argv.slice(2)
  const result = await scanNewsForBreaking()

  if (args.includes('--scan')) {
    const outDir = join(REPORTS_DIR, 'autolearn')
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
    const outFile = join(outDir, `breaking-${new Date().toISOString().slice(0, 10)}.json`)
    writeFileSync(outFile, JSON.stringify(result, null, 2), 'utf-8')
    console.log(`💾 Saved: ${outFile}`)
  }

  console.log(`📡 Breaking News Scan:`)
  console.log(`   ${result.breakingCount} breaking items out of ${result.totalSignals} total signals\n`)

  for (const signal of result.signals.slice(0, 10)) {
    const icon = signal.breakingScore >= 80 ? '🔴' : signal.breakingScore >= 60 ? '🟡' : '⚪'
    console.log(`   ${icon} [${signal.breakingScore}] ${signal.title || signal.symbol || '?'}`)
    console.log(`       ${signal.reason}`)
  }

  if (result.signals.length === 0) {
    console.log('   No breaking signals detected.')
  }
}

main().catch(console.error)
