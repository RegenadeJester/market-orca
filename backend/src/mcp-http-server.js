#!/usr/bin/env node
import express from 'express'
import cors from 'cors'
import crypto from 'node:crypto'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { tools, call } from './mcp-server.js'

const PORT = Number(process.env.MCP_PORT || 1788)
const HOST = process.env.MCP_HOST || '0.0.0.0'
const TOKEN = process.env.MCP_TOKEN || ''
const PATH = process.env.MCP_PATH || '/mcp'

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
function auth(req,res,next){ if(!TOKEN) return next(); const h=req.headers.authorization||''; if(h === `Bearer ${TOKEN}`) return next(); res.status(401).json({ error:'unauthorized' }) }
app.get('/health', (_req,res)=>res.json({ ok:true, name:'market-orca-mcp', transport:'streamable-http', path:PATH }))
app.get('/', (_req,res)=>{
  res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Market Orca MCP</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f0f0f;color:#e0e0e0;min-height:100vh;display:flex;align-items:center;justify-content:center}
.card{max-width:540px;width:100%;padding:2.5rem;background:#1a1a1a;border:1px solid #222;border-radius:16px}
h1{font-size:1.5rem;background:linear-gradient(135deg,#60a5fa,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:.5rem}
p{color:#888;font-size:.85rem;margin-bottom:1.5rem}
.endpoints{list-style:none}
.endpoints li{padding:.6rem 0;border-bottom:1px solid #222;font-size:.85rem;display:flex;align-items:baseline;gap:.75rem}
.endpoints li:last-child{border-bottom:none}
.method{font-family:monospace;font-size:.7rem;padding:2px 6px;border-radius:4px;font-weight:600}
.get{background:#16331a;color:#4ade80}
.post{background:#332d1a;color:#fbbf24}
.uri{color:#bbb;font-family:monospace}
.desc{color:#666;font-size:.75rem}
</style>
</head>
<body>
<div class="card">
<h1>🐋 Market Orca MCP</h1>
<p>Model Context Protocol server — AI tool gateway</p>
<ul class="endpoints">
<li><span class="method get">GET</span><span class="uri">/health</span><span class="desc">Health check</span></li>
<li><span class="method get">GET</span><span class="uri">/mcp</span><span class="desc">MCP protocol endpoint</span></li>
<li><span class="method post">POST</span><span class="uri">/mcp</span><span class="desc">MCP tool calls</span></li>
</ul>
</div>
</body></html>`)
})
app.all(PATH, auth, async (req,res)=>{
  try {
    let transport
    const sid = req.headers['mcp-session-id']
    if (sid && transports.has(sid)) transport = transports.get(sid)
    else {
      transport = new StreamableHTTPServerTransport({ sessionIdGenerator:()=>crypto.randomUUID() })
      transport.onclose = () => { if (transport.sessionId) transports.delete(transport.sessionId) }
      const server = makeServer()
      await server.connect(transport)
      if (transport.sessionId) transports.set(transport.sessionId, transport)
    }
    await transport.handleRequest(req,res,req.body)
  } catch (e) {
    if(!res.headersSent) res.status(500).json({ jsonrpc:'2.0', error:{ code:-32603, message:String(e?.message||e) }, id:null })
  }
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