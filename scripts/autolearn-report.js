#!/usr/bin/env node
/**
 * Market Orca — Autolearn v3 Daily Report
 * 
 * Summarizes what autolearn collected with quality scores, per-collection stats,
 * and RAG knowledge base growth.
 * 
 * Outputs markdown for Discord #bot-log.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LEARNED_FILE = path.join(__dirname, '..', 'collections', 'autolearn-learned.json')
const LOG_FILE = path.join(__dirname, '..', 'collections', 'autolearn.log')
const METRICS_FILE = path.join(__dirname, '..', 'collections', 'autolearn-metrics.json')

function main() {
  // Count per-topic stats from learned store
  let store = {}
  if (fs.existsSync(LEARNED_FILE)) {
    try { store = JSON.parse(fs.readFileSync(LEARNED_FILE, 'utf8')) } catch {}
  }

  // Group by collection
  const collections = {}
  for (const [url, entry] of Object.entries(store)) {
    const col = entry.collection || 'unknown'
    if (!collections[col]) collections[col] = { count: 0, sources: new Set(), lastLearned: null, avgQuality: 0, totalQ: 0 }
    collections[col].count++
    collections[col].sources.add(new URL(entry.url).hostname.replace(/^www\./, ''))
    if (entry.qualityScore) {
      collections[col].totalQ += entry.qualityScore
    }
    const learned = new Date(entry.learnedAt)
    if (!collections[col].lastLearned || learned > new Date(collections[col].lastLearned)) {
      collections[col].lastLearned = entry.learnedAt
    }
  }

  // Calculate avg quality per collection
  for (const col of Object.values(collections)) {
    col.avgQuality = col.count > 0 ? Math.round(col.totalQ / col.count) : 0
  }

  // Read config for friendly names
  const configFile = path.join(__dirname, '..', 'collections', 'autolearn-topics.json')
  let topics = []
  if (fs.existsSync(configFile)) {
    topics = JSON.parse(fs.readFileSync(configFile, 'utf8')).topics || []
  }
  const nameMap = {}
  for (const t of topics) nameMap[t.id] = t.name

  // Count recent (last 24h)
  const now = Date.now()
  const recent = Object.values(store).filter(e => now - new Date(e.learnedAt).getTime() < 86400000).length

  const totalDocs = Object.keys(store).length

  // Load v3 metrics if available
  let metrics = { topicStats: {} }
  if (fs.existsSync(METRICS_FILE)) {
    try { metrics = JSON.parse(fs.readFileSync(METRICS_FILE, 'utf8')) } catch {}
  }

  // Build report
  let report = `📚 **Autolearn Knowledge Base v3**\n\n`
  report += `**Total:** ${totalDocs} documents | **Last 24h:** +${recent} new\n\n`

  // Sort collections by count
  const sorted = Object.entries(collections).sort((a, b) => b[1].count - a[1].count)

  for (const [id, info] of sorted) {
    const name = nameMap[id] || id
    const tags = (topics.find(t => t.id === id)?.assetTags || []).join(', ')
    const priority = topics.find(t => t.id === id)?.priority || 'medium'
    const priorityIcon = priority === 'high' ? '🔴' : priority === 'medium' ? '🟡' : '🟢'
    report += `${priorityIcon} **${name}**  \`[${tags}]\`\n`
    report += `   ${info.count} docs · ${info.sources.size} sources · Q:${info.avgQuality} · last: ${info.lastLearned ? new Date(info.lastLearned).toLocaleString('id-ID', {timeZone:'Asia/Jakarta'}) : 'never'}\n\n`
  }

  // Overall stats
  const totalQuality = Object.values(collections).reduce((a, c) => a + c.totalQ, 0)
  const avgQuality = totalDocs > 0 ? Math.round(totalQuality / totalDocs) : 0

  report += `📊 **Overall Stats**\n`
  report += `   Avg Quality: ${avgQuality}/100 | Topics: ${Object.keys(collections).length} | Sources: ${new Set(Object.values(collections).map(c => [...c.sources]).flat()).size}\n\n`

  // Top sources
  const allSources = {}
  for (const col of Object.values(collections)) {
    for (const s of col.sources) {
      allSources[s] = (allSources[s] || 0) + 1
    }
  }
  const topSources = Object.entries(allSources).sort((a, b) => b[1] - a[1]).slice(0, 5)
  if (topSources.length > 0) {
    report += `**Top Sources:** ${topSources.map(([s, n]) => `${s}(${n})`).join(' · ')}\n\n`
  }

  // Recent entries
  const recentEntries = Object.values(store)
    .sort((a, b) => new Date(b.learnedAt) - new Date(a.learnedAt))
    .slice(0, 5)
  if (recentEntries.length > 0) {
    report += `**Recently Learned:**\n`
    for (const e of recentEntries) {
      const d = new Date(e.learnedAt).toLocaleString('id-ID', {timeZone:'Asia/Jakarta'})
      const name = nameMap[e.collection] || e.collection
      report += `• \`${d}\` [${name}] ${e.title.slice(0, 60)}\n`
    }
    report += '\n'
  }

  report += `_Next autolearn run: every 3h (v3 enterprise)_`

  console.log(report)
}

main()
