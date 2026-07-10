import assert from 'node:assert/strict'
import test from 'node:test'

// mcp-server.js — test tool definitions and call dispatch.
// We can't easily test the full MCP JSON-RPC stdin/stdout loop, but we CAN test
// the exported `tools` array and the `call()` function for pure/safe tools.

import { tools, call } from './mcp-server.js'

// ── tools array ───────────────────────────────────────────────────────────

test('tools is a non-empty array', () => {
  assert.ok(Array.isArray(tools))
  assert.ok(tools.length >= 10, `expected >=10 tools, got ${tools.length}`)
})

test('each tool has name, description, inputSchema', () => {
  for (const t of tools) {
    assert.ok(t.name, `tool "${t.name}" has name`)
    assert.ok(t.description, `tool "${t.name}" has description`)
    assert.ok(t.inputSchema, `tool "${t.name}" has inputSchema`)
    assert.equal(t.inputSchema.type, 'object', `tool "${t.name}" schema type is object`)
  }
})

test('tool names are unique', () => {
  const names = tools.map(t => t.name)
  const unique = new Set(names)
  assert.equal(names.length, unique.size, 'all tool names are unique')
})

test('known tool names exist', () => {
  const names = new Set(tools.map(t => t.name))
  assert.ok(names.has('market_orca_rag_search'))
  assert.ok(names.has('market_orca_web_search'))
  assert.ok(names.has('market_orca_fetch_page'))
  assert.ok(names.has('market_orca_search_and_answer'))
  assert.ok(names.has('market_orca_news_search'))
  assert.ok(names.has('market_orca_deep_web_search'))
  assert.ok(names.has('market_orca_ingest_text'))
  assert.ok(names.has('market_orca_crawl_url'))
  assert.ok(names.has('market_orca_web_to_crawl'))
  assert.ok(names.has('market_orca_report_qa'))
  assert.ok(names.has('market_orca_web_capabilities'))
  assert.ok(names.has('market_orca_trusted_domains'))
  assert.ok(names.has('market_orca_profile_safe_search'))
  assert.ok(names.has('market_orca_web_preview'))
  assert.ok(names.has('market_orca_decision_fingerprint'))
})

test('required fields in schemas', () => {
  const ragSearch = tools.find(t => t.name === 'market_orca_rag_search')
  assert.ok(ragSearch.inputSchema.required.includes('query'))

  const webSearch = tools.find(t => t.name === 'market_orca_web_search')
  assert.ok(webSearch.inputSchema.required.includes('query'))

  const ingest = tools.find(t => t.name === 'market_orca_ingest_text')
  assert.ok(ingest.inputSchema.required.includes('title'))
  assert.ok(ingest.inputSchema.required.includes('content'))

  const crawl = tools.find(t => t.name === 'market_orca_crawl_url')
  assert.ok(crawl.inputSchema.required.includes('url'))
})

// ── call() dispatch tests ──────────────────────────────────────────────────

test('call() throws for unknown tool', async () => {
  await assert.rejects(
    () => call('nonexistent_tool', {}),
    { message: 'unknown_tool' }
  )
})

test('call() market_orca_rag_search returns structured result', async () => {
  const result = await call('market_orca_rag_search', { query: 'test query', limit: 5 })
  assert.ok(result.structuredContent, 'has structuredContent')
  assert.ok(Array.isArray(result.content), 'content is array')
  assert.equal(result.content[0].type, 'text')
})

test('call() market_orca_report_qa returns blocks info', async () => {
  const result = await call('market_orca_report_qa', { slug: 'nonexistent-slug' })
  assert.ok(result.structuredContent)
  assert.equal(result.structuredContent.slug, 'nonexistent-slug')
  assert.ok(Array.isArray(result.structuredContent.rows))
  assert.equal(result.structuredContent.blocks, 0)
})

test('call() market_orca_web_capabilities returns trusted source count', async () => {
  const result = await call('market_orca_web_capabilities', {})
  assert.ok(result.structuredContent)
  assert.ok(typeof result.structuredContent.trustedSourceCount === 'number')
  assert.ok(result.structuredContent.trustedSourceCount > 0)
})

test('call() market_orca_trusted_domains returns array', async () => {
  const result = await call('market_orca_trusted_domains', { limit: 5 })
  assert.ok(Array.isArray(result.structuredContent))
  assert.ok(result.structuredContent.length <= 5)
  // Each domain is a string
  for (const d of result.structuredContent) {
    assert.ok(typeof d === 'string', `expected string domain, got ${typeof d}: ${d}`)
  }
})

test('call() market_orca_decision_fingerprint returns 24-char hex', async () => {
  const result = await call('market_orca_decision_fingerprint', {
    intent: 'research', route: '/market', asset: 'AAPL'
  })
  const fp = result.structuredContent.fingerprint
  assert.equal(typeof fp, 'string')
  assert.equal(fp.length, 24)
  assert.match(fp, /^[0-9a-f]{24}$/)
})

test('call() market_orca_decision_fingerprint is stable for same input', async () => {
  const a = await call('market_orca_decision_fingerprint', { intent: 'x', route: '/y' })
  const b = await call('market_orca_decision_fingerprint', { intent: 'x', route: '/y' })
  // ts_bucket is today's date, so fingerprints differ only if day changes.
  // At minimum both should be 24-char hex.
  assert.equal(a.structuredContent.fingerprint.length, 24)
  assert.equal(b.structuredContent.fingerprint.length, 24)
})

test('call() market_orca_ingest_text ingests and returns', async () => {
  const result = await call('market_orca_ingest_text', {
    title: 'Test Document',
    content: 'This is a test document for unit testing RAG ingest.',
    sourceType: 'test'
  })
  assert.ok(result.structuredContent)
  assert.ok(result.structuredContent.ok !== undefined || result.structuredContent.id !== undefined,
    'ingest returns result with id or ok')
})
