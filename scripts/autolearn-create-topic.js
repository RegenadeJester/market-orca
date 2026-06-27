#!/usr/bin/env node
/**
 * Autolearn Topic Creator — auto-create new collection for any topic
 * 
 * Usage:
 *   node scripts/autolearn-create-topic.js --id "commodities" --name "Komoditas" --queries "harga emas hari ini,minyak mentah nickel Indonesia" --tags "COMM,COMMODITY" [--max 5] [--schedule "every 6h"]
 *   node scripts/autolearn-create-topic.js --prompt "I want to learn about Indonesian commodity prices"
 *   node scripts/autolearn-create-topic.js --list  (list all topics)
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TOPICS_FILE = path.join(__dirname, '..', 'collections', 'autolearn-topics.json')

const args = process.argv.slice(2)

// Parse args
function getArg(name) {
  const idx = args.indexOf(name)
  return idx >= 0 && idx < args.length - 1 ? args[idx + 1] : null
}

const listOnly = args.includes('--list')
const topicId = getArg('--id')
const topicName = getArg('--name')
const queriesRaw = getArg('--queries')
const tagsRaw = getArg('--tags')
const maxResults = parseInt(getArg('--max') || '3')
const schedule = getArg('--schedule') || 'every 6h'
const prompt = getArg('--prompt')

if (listOnly) {
  const config = JSON.parse(fs.readFileSync(TOPICS_FILE, 'utf8'))
  for (const t of config.topics) {
    console.log(`  ${t.id} (${t.enabled ? 'ON' : 'OFF'}): ${t.name}`)
    console.log(`    Queries: ${t.queries.join(', ')}`)
    console.log(`    Tags: [${t.assetTags.join(', ')}]  |  Max: ${t.maxResults}  |  ${t.schedule}`)
    console.log()
  }
  process.exit(0)
}

if (prompt) {
  // AI-powered creation from natural language prompt
  console.log(JSON.stringify({
    ok: false,
    error: 'AI prompt mode not available — use --id/--name/--queries/--tags directly'
  }))
  process.exit(1)
}

if (!topicId || !topicName || !queriesRaw || !tagsRaw) {
  console.log('Usage:')
  console.log('  node scripts/autolearn-create-topic.js \\')
  console.log('    --id "commodities" \\')
  console.log('    --name "Komoditas" \\')
  console.log('    --queries "harga emas terkini,minyak mentah Indonesia,nickel outlook,harga CPO" \\')
  console.log('    --tags "COMM,COMMODITY" \\')
  console.log('    --max 5 \\')
  console.log('    --schedule "every 6h"')
  console.log('')
  console.log('  node scripts/autolearn-create-topic.js --list')
  process.exit(1)
}

// Validate
if (!/^[a-z0-9_-]+$/.test(topicId)) {
  console.log(`❌ Invalid ID: "${topicId}" — use only a-z, 0-9, hyphens, underscores`)
  process.exit(1)
}

const queries = queriesRaw.split(',').map(q => q.trim()).filter(Boolean)
const assetTags = tagsRaw.split(',').map(t => t.trim().toUpperCase()).filter(Boolean)

if (queries.length === 0) { console.log('❌ At least 1 query required'); process.exit(1) }
if (assetTags.length === 0) { console.log('❌ At least 1 tag required'); process.exit(1) }

// Read current config
let config = { _doc: '', _usage: '', topics: [] }
if (fs.existsSync(TOPICS_FILE)) {
  config = JSON.parse(fs.readFileSync(TOPICS_FILE, 'utf8'))
}

// Check duplicate
if (config.topics.some(t => t.id === topicId)) {
  console.log(`❌ Topic "${topicId}" already exists — remove it first or use a different ID`)
  process.exit(1)
}

const newTopic = {
  id: topicId,
  name: topicName,
  queries,
  assetTags,
  maxResults,
  schedule,
  enabled: true
}

config.topics.push(newTopic)
fs.writeFileSync(TOPICS_FILE, JSON.stringify(config, null, 2))

console.log(JSON.stringify({
  ok: true,
  action: 'created',
  topic: newTopic,
  totalTopics: config.topics.length,
  message: `✅ Topic "${topicName}" (${topicId}) created with ${queries.length} queries and tags [${assetTags.join(',')}]`
}, null, 2))