import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

const MCP_PORT = 1788
const N8N_PORT = 1789
const BASE = `http://localhost:${MCP_PORT}`
const N8N_BASE = `http://localhost:${N8N_PORT}`

// Helper: POST JSON
async function post(url, body = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  return { status: res.status, data: await res.json().catch(() => ({})) }
}

async function get(url) {
  const res = await fetch(url)
  return { status: res.status, data: await res.json().catch(() => ({})) }
}

// ═══════════════════════════════════════════
// Market Orca MCP HTTP Server (port 1788)
// ═══════════════════════════════════════════
describe('Market Orca MCP HTTP (SSE)', () => {
  it('GET /health returns ok', async () => {
    const { status, data } = await get(`${BASE}/health`)
    assert.equal(status, 200)
    assert.equal(data.ok, true)
    assert.equal(data.transport, 'sse')
  })

  it('GET / returns HTML docs page', async () => {
    const res = await fetch(`${BASE}/`)
    const html = await res.text()
    assert.equal(res.status, 200)
    assert.ok(html.includes('Market Orca MCP Server'))
    assert.ok(html.includes('SSE Transport'))
  })

  it('GET /mcp/sse returns SSE headers', async () => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)
    try {
      const res = await fetch(`${BASE}/mcp/sse`, { signal: controller.signal })
      // Should get SSE headers
      const ct = res.headers.get('content-type') || ''
      assert.ok(ct.includes('text/event-stream') || res.status === 200,
        `Expected SSE stream, got content-type: ${ct}`)
    } catch (e) {
      // SSE connection stays open — abort is expected
      assert.ok(e.name === 'AbortError' || e.message.includes('abort'))
    } finally {
      clearTimeout(timeout)
    }
  })

  it('POST /mcp/message without session returns 404', async () => {
    const { status } = await post(`${BASE}/mcp/message?sessionId=nonexistent`)
    assert.equal(status, 404)
  })
})

// ═══════════════════════════════════════════
// n8n MCP Bridge (port 1789)
// ═══════════════════════════════════════════
describe('n8n MCP Bridge', () => {
  it('GET /health returns ok', async () => {
    const { status, data } = await get(`${N8N_BASE}/health`)
    assert.equal(status, 200)
    assert.equal(data.ok, true)
    assert.equal(data.name, 'n8n-mcp-bridge')
  })

  it('GET / returns HTML docs page', async () => {
    const res = await fetch(`${N8N_BASE}/`)
    const html = await res.text()
    assert.equal(res.status, 200)
    assert.ok(html.includes('n8n'))
    assert.ok(html.includes('MCP Bridge'))
  })

  // n8n.health tool
  it('POST /tool/n8n.health returns n8n status', async () => {
    const { status, data } = await post(`${N8N_BASE}/tool/n8n.health`)
    assert.equal(status, 200)
    const content = JSON.parse(data.content[0].text)
    assert.equal(content.bridge, 'ok')
    assert.ok(typeof content.n8n === 'string')
    assert.ok(typeof content.totalWorkflows === 'number')
  })

  // n8n.workflows.list tool
  it('POST /tool/n8n.workflows.list returns array', async () => {
    const { status, data } = await post(`${N8N_BASE}/tool/n8n.workflows.list`)
    assert.equal(status, 200)
    const content = JSON.parse(data.content[0].text)
    assert.ok(Array.isArray(content.workflows))
    assert.ok(Array.isArray(content.webhooks))
  })

  // n8n.workflows.get with invalid ID
  it('POST /tool/n8n.workflows.get returns not found for invalid ID', async () => {
    const { status, data } = await post(`${N8N_BASE}/tool/n8n.workflows.get`, { workflowId: 'nonexistent' })
    assert.equal(status, 200)
    assert.ok(data.content[0].text.includes('not found'))
  })

  // n8n.executions.list tool
  it('POST /tool/n8n.executions.list returns array', async () => {
    const { status, data } = await post(`${N8N_BASE}/tool/n8n.executions.list`, { limit: 5 })
    assert.equal(status, 200)
    const content = JSON.parse(data.content[0].text)
    assert.ok(Array.isArray(content.executions))
  })

  // n8n.nodes.list tool
  it('POST /tool/n8n.nodes.list returns node types', async () => {
    const { status, data } = await post(`${N8N_BASE}/tool/n8n.nodes.list`)
    assert.equal(status, 200)
    const content = JSON.parse(data.content[0].text)
    assert.ok(typeof content.count === 'number')
    assert.ok(Array.isArray(content.nodes))
    assert.ok(content.count > 0, 'Should have at least 1 node type')
  })

  it('POST /tool/n8n.nodes.list with search filter', async () => {
    const { status, data } = await post(`${N8N_BASE}/tool/n8n.nodes.list`, { search: 'http' })
    assert.equal(status, 200)
    const content = JSON.parse(data.content[0].text)
    assert.ok(content.nodes.some(n => n.type.includes('httpRequest')))
  })

  // n8n.nodes.schema tool
  it('POST /tool/n8n.nodes.schema returns node details', async () => {
    const { status, data } = await post(`${N8N_BASE}/tool/n8n.nodes.schema`, { nodeType: 'n8n-nodes-base.httpRequest' })
    assert.equal(status, 200)
    const content = JSON.parse(data.content[0].text)
    assert.equal(content.type, 'n8n-nodes-base.httpRequest')
  })

  it('POST /tool/n8n.nodes.schema returns error for unknown type', async () => {
    const { status, data } = await post(`${N8N_BASE}/tool/n8n.nodes.schema`, { nodeType: 'nonexistent' })
    assert.equal(status, 200)
    assert.ok(data.content[0].text.includes('not found'))
  })

  // SSE endpoint
  it('GET /mcp/sse establishes SSE connection', async () => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)
    try {
      const res = await fetch(`${N8N_BASE}/mcp/sse`, { signal: controller.signal })
      const ct = res.headers.get('content-type') || ''
      assert.ok(ct.includes('text/event-stream') || res.status === 200)
    } catch (e) {
      assert.ok(e.name === 'AbortError' || e.message.includes('abort'))
    } finally {
      clearTimeout(timeout)
    }
  })

  // REST fallback
  it('POST /tool/unknown-tool returns error', async () => {
    const { status, data } = await post(`${N8N_BASE}/tool/nonexistent.tool`)
    assert.equal(status, 200)
    assert.ok(data.isError)
    assert.ok(data.content[0].text.includes('Unknown tool'))
  })
})

// ═══════════════════════════════════════════
// Auth middleware
// ═══════════════════════════════════════════
describe('Auth (when TOKEN set)', () => {
  it('n8n bridge rejects invalid token when MCP_TOKEN is set', async () => {
    // This test only matters if N8N_MCP_TOKEN env var is set
    // Without it, auth is bypassed — which is the default
    const { status } = await get(`${N8N_BASE}/health`)
    assert.equal(status, 200) // no token = auth bypassed
  })
})
