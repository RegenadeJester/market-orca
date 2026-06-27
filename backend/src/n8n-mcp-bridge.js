#!/usr/bin/env node
/**
 * n8n → MCP Bridge
 * 
 * Reads n8n SQLite DB directly for workflow/node discovery.
 * Executes workflows via production webhook URLs (no auth needed).
 * Exposes n8n capabilities as MCP tools.
 * 
 * Tools:
 *   n8n.workflows.list    — List all workflows
 *   n8n.workflows.get     — Get workflow detail + nodes
 *   n8n.workflows.execute — Trigger workflow via webhook
 *   n8n.workflows.activate — Activate/deactivate workflow
 *   n8n.nodes.list        — List all node types available in n8n
 *   n8n.nodes.schema      — Get node type configuration schema
 *   n8n.executions.list   — Recent execution history
 *   n8n.health            — n8n instance health check
 */

import express from 'express'
import cors from 'cors'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

// ─── Config ───
const PORT = Number(process.env.N8N_MCP_PORT || 1789)
const HOST = process.env.N8N_MCP_HOST || '0.0.0.0'
const TOKEN = process.env.N8N_MCP_TOKEN || ''
const N8N_DB = process.env.N8N_DB_PATH || '/tmp/n8n-db.sqlite'
const N8N_URL = process.env.N8N_URL || 'http://localhost:5678'

// ─── n8n DB read layer ───
function getDb() {
  if (!fs.existsSync(N8N_DB)) throw new Error(`n8n DB not found: ${N8N_DB}`)
  const db = new Database(N8N_DB, { readonly: true })
  db.pragma('journal_mode = WAL')
  return db
}

function listWorkflows() {
  const db = getDb()
  try {
    const rows = db.prepare(`
      SELECT id, name, active, createdAt, updatedAt, nodes
      FROM workflow_entity
      ORDER BY updatedAt DESC
    `).all()
    return rows.map(r => {
      let nodeNames = []
      try { nodeNames = JSON.parse(r.nodes || '[]').map(n => n.name || n.type) } catch {}
      return {
        id: r.id,
        name: r.name,
        active: !!r.active,
        nodeCount: nodeNames.length,
        nodes: nodeNames,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt
      }
    })
  } finally { db.close() }
}

function getWorkflow(id) {
  const db = getDb()
  try {
    const row = db.prepare(`
      SELECT * FROM workflow_entity WHERE id = ?
    `).get(id)
    if (!row) return null
    let nodes = []
    try { nodes = JSON.parse(row.nodes || '[]') } catch {}
    let connections = {}
    try { connections = JSON.parse(row.connections || '{}') } catch {}
    return {
      id: row.id,
      name: row.name,
      active: !!row.active,
      nodes: nodes.map(n => ({
        name: n.name,
        type: n.type,
        typeVersion: n.typeVersion,
        position: n.position,
        parameters: n.parameters || {},
        credentials: n.credentials ? Object.keys(n.credentials) : []
      })),
      connections,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }
  } finally { db.close() }
}

function listWebhooks() {
  const db = getDb()
  try {
    const rows = db.prepare('SELECT * FROM webhook_entity').all()
    return rows.map(r => ({
      id: r.id,
      workflowId: r.workflowId,
      webhookPath: r.webhookPath,
      method: r.method,
      node: r.node,
      active: !!r.active,
      isProduction: !!r.isProduction
    }))
  } finally { db.close() }
}

function listExecutions(limit = 20) {
  const db = getDb()
  try {
    const rows = db.prepare(`
      SELECT e.id, e.workflowId, e.status, e.startedAt, e.stoppedAt, e.mode,
             w.name as workflowName
      FROM execution_entity e
      LEFT JOIN workflow_entity w ON e.workflowId = w.id
      ORDER BY e.startedAt DESC
      LIMIT ?
    `).all(limit)
    return rows.map(r => ({
      id: r.id,
      workflowId: r.workflowId,
      workflowName: r.workflowName || '',
      status: r.status,
      mode: r.mode,
      startedAt: r.startedAt,
      stoppedAt: r.stoppedAt
    }))
  } finally { db.close() }
}

function activateWorkflow(id, active) {
  const db = getDb()
  try {
    const result = db.prepare('UPDATE workflow_entity SET active = ? WHERE id = ?').run(active ? 1 : 0, id)
    return result.changes > 0
  } finally { db.close() }
}

// ─── n8n HTTP calls ───
async function n8nFetch(endpoint, options = {}) {
  const url = `${N8N_URL}${endpoint}`
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers }
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`n8n ${options.method || 'GET'} ${endpoint} → ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json()
}

async function triggerWebhook(webhookPath, method = 'POST', body = {}) {
  const url = `${N8N_URL}/webhook/${webhookPath}`
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  return { status: res.status, data }
}

async function checkN8nHealth() {
  try {
    const res = await fetch(`${N8N_URL}/healthz`)
    return res.ok
  } catch { return false }
}

// ─── MCP Tool definitions ───
const TOOLS = [
  {
    name: 'n8n.workflows.list',
    description: 'List all n8n workflows with status, node count, and metadata',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'n8n.workflows.get',
    description: 'Get detailed info about an n8n workflow including nodes, parameters, and connections',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'n8n workflow ID' }
      },
      required: ['workflowId']
    }
  },
  {
    name: 'n8n.workflows.execute',
    description: 'Trigger an n8n workflow via its production webhook endpoint',
    inputSchema: {
      type: 'object',
      properties: {
        webhookPath: { type: 'string', description: 'Webhook path (from webhook URL)' },
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH'], default: 'POST' },
        body: { type: 'object', description: 'Request body payload', default: {} }
      },
      required: ['webhookPath']
    }
  },
  {
    name: 'n8n.workflows.activate',
    description: 'Activate or deactivate an n8n workflow',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string' },
        active: { type: 'boolean' }
      },
      required: ['workflowId', 'active']
    }
  },
  {
    name: 'n8n.nodes.list',
    description: 'List all available n8n node types (core + community packages)',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Filter by name/type keyword' }
      }
    }
  },
  {
    name: 'n8n.nodes.schema',
    description: 'Get the configuration schema for an n8n node type',
    inputSchema: {
      type: 'object',
      properties: {
        nodeType: { type: 'string', description: 'Node type identifier, e.g. n8n-nodes-base.httpRequest' }
      },
      required: ['nodeType']
    }
  },
  {
    name: 'n8n.executions.list',
    description: 'List recent workflow executions with status and timing',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', default: 20, description: 'Max results' }
      }
    }
  },
  {
    name: 'n8n.health',
    description: 'Check n8n instance health and connectivity',
    inputSchema: { type: 'object', properties: {} }
  }
]

// ─── MCP tool handler ───
async function callTool(name, args) {
  try {
    switch (name) {
      case 'n8n.workflows.list': {
        const wfs = listWorkflows()
        const webhooks = listWebhooks()
        return { content: [{ type: 'text', text: JSON.stringify({ workflows: wfs, webhooks }, null, 2) }] }
      }
      case 'n8n.workflows.get': {
        const wf = getWorkflow(args.workflowId)
        if (!wf) return { content: [{ type: 'text', text: `Workflow ${args.workflowId} not found` }] }
        const webhooks = listWebhooks().filter(w => w.workflowId === args.workflowId)
        return { content: [{ type: 'text', text: JSON.stringify({ ...wf, webhooks }, null, 2) }] }
      }
      case 'n8n.workflows.execute': {
        const result = await triggerWebhook(args.webhookPath, args.method || 'POST', args.body || {})
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
      }
      case 'n8n.workflows.activate': {
        const ok = activateWorkflow(args.workflowId, args.active)
        return { content: [{ type: 'text', text: ok ? `Workflow ${args.workflowId} set active=${args.active}` : 'Workflow not found' }] }
      }
      case 'n8n.nodes.list': {
        // Read cached node types JSON
        let nodeFiles = []
        const cachePath = path.join(path.dirname(N8N_DB), 'n8n-nodes-cache.json')
        const absCache = cachePath
        if (fs.existsSync(absCache)) {
          try {
            nodeFiles = JSON.parse(fs.readFileSync(absCache, 'utf8'))
          } catch {}
        } else {
          return { content: [{ type: 'text', text: 'Node cache not found. Run: docker cp n8n:/tmp/n8n-nodes-cache.json /tmp/ && docker exec n8n node -e "..." to generate.' }] }
        }
        if (args.search) {
          const q = args.search.toLowerCase()
          nodeFiles = nodeFiles.filter(n =>
            n.type.toLowerCase().includes(q) ||
            n.displayName.toLowerCase().includes(q) ||
            (n.description && n.description.toLowerCase().includes(q))
          )
        }
        return { content: [{ type: 'text', text: JSON.stringify({ count: nodeFiles.length, nodes: nodeFiles }, null, 2) }] }
      }
      case 'n8n.nodes.schema': {
        // Get node schema from n8n instance
        const cachePath = path.join(path.dirname(N8N_DB), 'n8n-nodes-cache.json')
        if (!fs.existsSync(cachePath)) {
          return { content: [{ type: 'text', text: 'Node cache not found' }] }
        }
        let allNodes = []
        try { allNodes = JSON.parse(fs.readFileSync(cachePath, 'utf8')) } catch {}
        const found = allNodes.find(n => n.type === args.nodeType)
        if (!found) return { content: [{ type: 'text', text: `Node type '${args.nodeType}' not found. Available: ${allNodes.slice(0,5).map(n=>n.type).join(', ')}...` }] }
        return { content: [{ type: 'text', text: JSON.stringify(found, null, 2) }] }
      }
      case 'n8n.executions.list': {
        const execs = listExecutions(args.limit || 20)
        return { content: [{ type: 'text', text: JSON.stringify({ count: execs.length, executions: execs }, null, 2) }] }
      }
      case 'n8n.health': {
        const healthy = await checkN8nHealth()
        const workflows = listWorkflows()
        const activeCount = workflows.filter(w => w.active).length
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              n8n: healthy ? 'healthy' : 'unreachable',
              n8nUrl: N8N_URL,
              n8nDb: N8N_DB,
              totalWorkflows: workflows.length,
              activeWorkflows: activeCount,
              bridge: 'ok'
            }, null, 2)
          }]
        }
      }
      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
    }
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }
  }
}

// ─── MCP Server factory ───
function makeServer() {
  const server = new Server({ name: 'n8n-mcp-bridge', version: '1.0.0' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))
  server.setRequestHandler(CallToolRequestSchema, async (req) => callTool(req.params.name, req.params.arguments || {}))
  return server
}

// ─── Express + SSE ───
const app = express()
app.use(cors({ origin: true, exposedHeaders: ['mcp-session-id'] }))
app.use(express.json({ limit: '4mb' }))

const transports = new Map()

function auth(req, res, next) {
  if (!TOKEN) return next()
  const h = req.headers.authorization || ''
  if (h === `Bearer ${TOKEN}`) return next()
  res.status(401).json({ error: 'unauthorized' })
}

app.get('/health', (_req, res) => res.json({ ok: true, name: 'n8n-mcp-bridge', transport: 'sse' }))

// Docs UI
app.get('/', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
  <title>n8n MCP Bridge</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #000000; --surface: #0a0a0a; --border: #1a1a1a; --border-hover: #27272a;
      --accent: #14b8a6; --accent-dim: rgba(20,184,166,0.1);
      --text: #e4e4e7; --text-sec: #a1a1aa; --text-muted: #52525b;
      --radius: 10px; --radius-sm: 6px;
    }
    body { font-family: 'Geist', system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--text-sec); min-height: 100vh; line-height: 1.6; -webkit-font-smoothing: antialiased; }
    .c { max-width: 1000px; margin: 0 auto; padding: 2rem; }
    header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem; border-bottom: 1px solid var(--border); padding-bottom: 1.5rem; margin-bottom: 2rem; }
    header h1 { font-size: 1.75rem; font-weight: 700; color: var(--text); letter-spacing: -0.03em; }
    header h1 span { color: var(--accent); }
    .header-right { display: flex; align-items: center; gap: 1rem; }
    .sub { color: var(--text-muted); font-size: 0.9rem; }
    .status-badge { display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.4rem 1rem; background: var(--surface); border: 1px solid var(--accent); border-radius: 20px; color: var(--accent); font-size: 0.85rem; font-weight: 500; }
    .status-badge::before { content: ''; width: 8px; height: 8px; background: var(--accent); border-radius: 50%; animation: pulse 2s ease-in-out infinite; }
    @keyframes pulse { 0%,100%{opacity:1}50%{opacity:0.4} }
    .section { margin-bottom: 2.5rem; }
    .section-title { font-size: 1.1rem; font-weight: 600; color: var(--text); margin-bottom: 1rem; letter-spacing: -0.02em; display: flex; align-items: center; gap: 0.5rem; }
    .section-title::before { content: ''; display: inline-block; width: 3px; height: 1.1rem; background: var(--accent); border-radius: 2px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 1.5rem; transition: border-color 0.15s; }
    .card:hover { border-color: var(--border-hover); }
    .card-title { font-size: 1rem; font-weight: 600; color: var(--text); margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.5rem; }
    .card p { font-size: 0.875rem; line-height: 1.7; color: var(--text-sec); }
    .tags { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-top: 0.5rem; }
    .tag { font-size: 0.7rem; padding: 0.25rem 0.5rem; border-radius: 3px; background: var(--surface); border: 1px solid var(--border); color: var(--text-muted); font-family: 'Geist Mono', monospace; }
    .endpoint-list { display: flex; flex-direction: column; gap: 0.5rem; }
    .ep-row { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 0.8rem 1rem; display: flex; align-items: center; gap: 1rem; font-size: 0.875rem; justify-content: space-between; }
    .ep-method { font-family: 'Geist Mono', monospace; font-size: 0.7rem; font-weight: 600; padding: 0.15rem 0.45rem; border-radius: 3px; background: var(--accent-dim); color: var(--accent); min-width: 36px; text-align: center; }
    .ep-path { font-family: 'Geist Mono', monospace; font-size: 0.8rem; color: var(--text); flex: 1; }
    .ep-desc { color: var(--text-muted); font-size: 0.8rem; }
    code { font-family: 'Geist Mono', monospace; font-size: 0.8rem; background: rgba(255,255,255,0.04); color: var(--accent); padding: 0.15rem 0.35rem; border-radius: 3px; }
    pre { font-family: 'Geist Mono', monospace; background: var(--surface); border: 1px solid var(--border); padding: 1rem; border-radius: var(--radius-sm); overflow-x: auto; font-size: 0.8rem; color: var(--text-sec); line-height: 1.6; }
    .btn { display: inline-flex; align-items: center; gap: 0.5rem; background: var(--surface); border: 1px solid var(--border); color: var(--text); padding: 0.5rem 1.25rem; border-radius: var(--radius-sm); font-family: 'Geist', system-ui, sans-serif; font-size: 0.85rem; font-weight: 500; text-decoration: none; transition: border-color 0.15s, color 0.15s; cursor: pointer; }
    .btn:hover { border-color: var(--accent); color: var(--accent); }
    .btn-primary { background: var(--accent); border-color: var(--accent); color: #000000; font-weight: 600; }
    .btn-primary:hover { opacity: 0.85; color: #000000; }
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: var(--bg); }
    ::-webkit-scrollbar-thumb { background: var(--border-hover); border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: #3f3f46; }
    ::selection { background: rgba(20,184,166,0.3); color: var(--text); }
    @media (max-width: 768px) { .c { padding: 1rem; } .grid { grid-template-columns: 1fr; } header { flex-direction: column; align-items: flex-start; } }
  </style>
</head>
<body>
<div class="c">
  <header>
    <div>
      <h1>n8n <span>&#8594;</span> MCP <span>Bridge</span></h1>
      <p class="sub">Expose n8n workflows, nodes &amp; executions as MCP tools &mdash; SSE transport</p>
    </div>
    <div class="header-right">
      <span class="status-badge">Online — Bridge Active</span>
    </div>
  </header>

  <div class="section">
    <div class="section-title">Endpoints</div>
    <div class="endpoint-list">
      <div class="ep-row"><span class="ep-method">GET</span><span class="ep-path">/health</span><span class="ep-desc">Health check</span></div>
      <div class="ep-row"><span class="ep-method">GET</span><span class="ep-path">/mcp/sse</span><span class="ep-desc">SSE connection (MCP transport)</span></div>
      <div class="ep-row"><span class="ep-method">POST</span><span class="ep-path">/mcp/message</span><span class="ep-desc">MCP messages (requires sessionId)</span></div>
      <div class="ep-row"><span class="ep-method">POST</span><span class="ep-path">/tool/:name</span><span class="ep-desc">Direct tool call (REST fallback)</span></div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Tools — 8 MCP Tools</div>
    <div class="grid">
      <div class="card">
        <div class="card-title">&#x1f504; Workflows</div>
        <p>List, get details, execute via webhook, activate/deactivate n8n workflows.</p>
        <div class="tags"><span class="tag">n8n.workflows.list</span><span class="tag">n8n.workflows.get</span><span class="tag">n8n.workflows.execute</span><span class="tag">n8n.workflows.activate</span></div>
      </div>
      <div class="card">
        <div class="card-title">&#x1f9e9; Nodes</div>
        <p>Browse 430+ n8n node types, get configuration schemas for any node.</p>
        <div class="tags"><span class="tag">n8n.nodes.list</span><span class="tag">n8n.nodes.schema</span></div>
      </div>
      <div class="card">
        <div class="card-title">&#x1f4ca; Executions</div>
        <p>View recent workflow execution history with status &amp; timing.</p>
        <div class="tags"><span class="tag">n8n.executions.list</span></div>
      </div>
      <div class="card">
        <div class="card-title">&#x1f3e5; Health</div>
        <p>Check n8n connectivity and bridge status.</p>
        <div class="tags"><span class="tag">n8n.health</span></div>
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Quick Start</div>
    <pre>npx @modelcontextprotocol/inspector
# Select &quot;SSE&quot; transport
# URL: https://n8n-bridge.anomali.web.id/mcp/sse</pre>
    <div style="margin-top:1rem;display:flex;gap:1rem">
      <a href="https://n8n-bridge.anomali.web.id/mcp/sse" class="btn btn-primary">&#x25b6; Connect SSE</a>
      <a href="/health" class="btn">&#x2699; Health</a>
    </div>
  </div>

  <div style="text-align:center;margin-top:2rem;font-size:0.75rem;color:var(--text-muted);">
    n8n MCP Bridge &mdash; 8 tools &mdash; SSE Transport &mdash; n8n v2.26.4
  </div>
</div>
</body>
</html>`)
})

// SSE endpoints
app.get('/mcp/sse', auth, async (req, res) => {
  const sessionId = crypto.randomUUID()
  const transport = new SSEServerTransport(`/mcp/message?sessionId=${sessionId}`, res)
  const server = makeServer()
  await server.connect(transport)
  transports.set(sessionId, { transport, server })
  transport.onclose = () => transports.delete(sessionId)
  const interval = setInterval(() => res.write(':keepalive\n\n'), 30000)
  req.on('close', () => { clearInterval(interval); transports.delete(sessionId) })
})

app.post('/mcp/message', auth, async (req, res) => {
  const sessionId = req.query.sessionId
  if (!sessionId || !transports.has(sessionId)) return res.status(404).json({ error: 'Session not found' })
  await transports.get(sessionId).transport.handlePostMessage(req, res)
})

// REST fallback — direct tool call without SSE
app.post('/tool/:name', auth, async (req, res) => {
  try {
    const result = await callTool(req.params.name, req.body)
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.listen(PORT, HOST, () => console.log(`n8n MCP bridge listening on http://${HOST}:${PORT}`))
