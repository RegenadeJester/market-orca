#!/usr/bin/env node
/**
 * Market Orca — Autolearn Daily Report
 * 
 * Summarizes what autolearn collected, per collection stats, and
 * RAG knowledge base growth.
 * 
 * Outputs markdown for Discord #bot-log.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LEARNED_FILE = path.join(__dirname, '..', 'collections', 'autolearn-learned.json')
const LOG_FILE = path.join(__dirname, '..', 'collections', 'autolearn.log')

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
    if (!collections[col]) collections[col] = { count: 0, sources: new Set(), lastLearned: null }
    collections[col].count++
    collections[col].sources.add(new URL(entry.url).hostname.replace(/^www\./, ''))
    const learned = new Date(entry.learnedAt)
    if (!collections[col].lastLearned || learned > new Date(collections[col].lastLearned)) {
      collections[col].lastLearned = entry.learnedAt
    }
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

  // Build report
  let report = `📚 **Autolearn Knowledge Base**\n\n`
  report += `**Total:** ${totalDocs} documents learned | **Last 24h:** +${recent} new\n\n`

  for (const [id, info] of Object.entries(collections)) {
    const name = nameMap[id] || id
    const tags = (topics.find(t => t.id === id)?.assetTags || []).join(', ')
    report += `📁 **${name}**  \`[${tags}]\`\n`
    report += `   ${info.count} docs · ${info.sources.size} sources · last: ${info.lastLearned ? new Date(info.lastLearned).toLocaleString('id-ID', {timeZone:'Asia/Jakarta'}) : 'never'}\n\n`
  }

  // Also list recent URLs
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

  report += `_Next autolearn run: every 6h_`

  console.log(report)
}

main()
