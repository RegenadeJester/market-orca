#!/usr/bin/env node
import express from 'express'
import cors from 'cors'
import crypto from 'node:crypto'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { tools, call } from './mcp-server.js'

const PORT = Number(process.env.MCP_PORT || 1788)
const HOST = process.env.MCP_HOST || '0.0.0.0'
const TOKEN = process.env.MCP_TOKEN || ''

function makeServer() {
  const server = new Server({ name: 'market-orca-mcp', version: '1.2.0' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))
  server.setRequestHandler(CallToolRequestSchema, async (req) => call(req.params.name, req.params.arguments || {}))
  return server
}

const app = express()
app.use(cors({ origin: true, exposedHeaders: ['mcp-session-id'] }))
app.use(express.json({ limit: '4mb' }))

// Session storage for SSE transports
const transports = new Map()

function auth(req, res, next) {
  if (!TOKEN) return next()
  const h = req.headers.authorization || ''
  if (h === `Bearer ${TOKEN}`) return next()
  res.status(401).json({ error: 'unauthorized' })
}

// Health endpoint
app.get('/health', (_req, res) => res.json({ ok: true, name: 'market-orca-mcp', transport: 'sse', path: '/mcp' }))

// Docs UI at root
app.get('/', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.send(`
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Market Orca MCP Server</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0f; color: #e4e4e7; min-height: 100vh; }
    .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
    header { border-bottom: 1px solid #27272a; padding-bottom: 1.5rem; margin-bottom: 2rem; }
    h1 { font-size: 2rem; font-weight: 700; background: linear-gradient(135deg, #06b6d4 0%, #8b5cf6 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .subtitle { color: #71717a; margin-top: 0.5rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem; }
    .card { background: #18181b; border: 1px solid #27272a; border-radius: 12px; padding: 1.5rem; transition: border-color 0.2s; }
    .card:hover { border-color: #06b6d4; }
    .card h3 { font-size: 1.1rem; font-weight: 600; margin-bottom: 0.75rem; color: #06b6d4; }
    .card p { color: #a1a1aa; font-size: 0.9rem; line-height: 1.6; }
    .badge { display: inline-block; background: #06b6d4; color: #0a0a0f; padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; margin-right: 0.5rem; margin-bottom: 0.5rem; }
    .tool-list { display: flex; flex-wrap: wrap; gap: 0.5rem; }
    .tool-name { background: #27272a; padding: 0.35rem 0.7rem; border-radius: 6px; font-size: 0.8rem; font-family: monospace; color: #e4e4e7; }
    .endpoint { background: #18181b; border: 1px solid #27272a; border-radius: 8px; padding: 1rem; margin-top: 1.5rem; }
    .endpoint h3 { color: #06b6d4; margin-bottom: 0.5rem; }
    code { background: #0a0a0f; color: #06b6d4; padding: 0.2rem 0.4rem; border-radius: 4px; font-family: monospace; }
    pre { background: #0a0a0f; padding: 1rem; border-radius: 8px; overflow-x: auto; }
    .btn { display: inline-block; background: linear-gradient(135deg, #06b6d4 0%, #8b5cf6 100%); color: #0a0a0f; padding: 0.75rem 1.5rem; border-radius: 8px; font-weight: 600; text-decoration: none; transition: opacity 0.2s; }
    .btn:hover { opacity: 0.9; }
    .status { display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.5rem 1rem; background: #052e16; border: 1px solid #065f46; border-radius: 8px; color: #10b981; font-weight: 500; }
    .status::before { content: ''; width: 8px; height: 8px; background: #10b981; border-radius: 50%; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>Market Orca MCP Server</h1>
      <p class="subtitle">Model Context Protocol — Streamable HTTP + SSE Transport</p>
    </header>

    <div class="status">✓ Server Running — SSE Transport Active</div>

    <div class="endpoint">
      <h3>Endpoints</h3>
      <p><code>GET  /health</code> — Health check</p>
      <p><code>GET  /mcp/sse</code> — SSE connection endpoint (MCP transport)</p>
      <p><code>POST /mcp/message</code> — Send MCP messages (requires session)</p>
    </div>

    <div class="grid">
      <div class="card">
        <h3>🔧 Connection</h3>
        <p>Use SSE transport for persistent MCP sessions. Compatible with MCP Inspector, Claude Desktop, and custom clients.</p>
        <div class="tool-list">
          <span class="tool-name">SSE Transport</span>
          <span class="tool-name">Session Persistence</span>
          <span class="tool-name">Auto-Reconnect</span>
        </div>
      </div>

      <div class="card">
        <h3>🛡️ Authentication</h3>
        <p>Optional Bearer token via <code>MCP_TOKEN</code> env var. Send as <code>Authorization: Bearer &lt;token&gt;</code> header.</p>
        <div class="tool-list">
          <span class="tool-name">Bearer Token</span>
          <span class="tool-name">Per-Request Auth</span>
        </div>
      </div>

      <div class="card">
        <h3>📦 Available Tools (16)</h3>
        <div class="tool-list">
          <span class="tool-name">web.search</span>
          <span class="tool-name">web.deep_search</span>
          <span class="tool-name">web.fetch_page</span>
          <span class="tool-name">web.search_and_answer</span>
          <span class="tool-name">web.search_to_crawl</span>
          <span class="tool-name">web.news_search</span>
          <span class="tool-name">web.preview</span>
          <span class="tool-name">rag.search</span>
          <span class="tool-name">rag.ingest</span>
          <span class="tool-name">rag.crawl_url</span>
          <span class="tool-name">rag.report</span>
          <span class="tool-name">rag.report_qa</span>
          <span class="tool-name">profile.safe_search</span>
          <span class="tool-name">trusted_domains</span>
          <span class="tool-name">web.capabilities</span>
          <span class="tool-name">decision_fingerprint</span>
        </div>
      </div>

      <div class="card">
        <h3>🚀 Quick Start</h3>
        <p>Connect with MCP Inspector:</p>
        <pre>npx @modelcontextprotocol/inspector
# Select "SSE" transport
# URL: https://mcp.anomali.web.id/mcp/sse</pre>
      </div>

      <div class="card">
        <h3>🔌 n8n Bridge</h3>
        <p>Native n8n node exposure via MCP. Each n8n node becomes a callable MCP tool with typed inputs/outputs.</p>
        <div class="tool-list">
          <span class="tool-name">n8n.workflows</span>
          <span class="tool-name">n8n.execute</span>
          <span class="tool-name">n8n.nodes</span>
        </div>
      </div>

      <div class="card">
        <h3>📊 RAG + Web Search</h3>
        <p>Hybrid FTS5 + vector search, multi-engine web search with trusted-source ranking, auto-crawl pipeline.</p>
        <div class="tool-list">
          <span class="tool-name">FTS5 + Vector</span>
          <span class="tool-name">SearXNG + Bing</span>
          <span class="tool-name">Crawl4AI</span>
        </div>
      </div>
    </div>

    <div style="margin-top: 2rem; text-align: center;">
      <a href="/health" class="btn">Check Health</a>
    </div>
  </div>
</body>
</html>
  `)
})

// SSE endpoint - establishes persistent connection
app.get('/mcp/sse', auth, async (req, res) => {
  const sessionId = crypto.randomUUID()
  const transport = new SSEServerTransport(`/mcp/message?sessionId=${sessionId}`, res)
  
  const server = makeServer()
  await server.connect(transport)
  
  transports.set(sessionId, { transport, server })
  
  transport.onclose = () => {
    transports.delete(sessionId)
  }
  
  // Keep connection alive
  const interval = setInterval(() => {
    res.write(':keepalive\n\n')
  }, 30000)
  
  req.on('close', () => {
    clearInterval(interval)
    transports.delete(sessionId)
  })
})

// Message endpoint - handles MCP messages for a session
app.post('/mcp/message', auth, async (req, res) => {
  const sessionId = req.query.sessionId
  if (!sessionId || !transports.has(sessionId)) {
    return res.status(404).json({ error: 'Session not found', sessionId })
  }
  
  const { transport } = transports.get(sessionId)
  await transport.handlePostMessage(req, res)
})

// Legacy StreamableHTTP endpoint for backward compat (redirects to docs)
app.all('/mcp', auth, (_req, res) => {
  res.redirect('/')
})

app.listen(PORT, HOST, () => console.log(`market-orca MCP HTTP (SSE) listening on http://${HOST}:${PORT}`))