#!/usr/bin/env node
import express from 'express'
import cors from 'cors'
import crypto from 'node:crypto'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { tools, call } from './mcp-server.js'

const PORT = Number(process.env.MCP_PORT || 1788)
const HOST = process.env.MCP_HOST || '0.0.0.0'
const PATH = process.env.MCP_PATH || '/mcp'
const TOKEN = process.env.MCP_TOKEN || ''

function makeServer(){
  const server = new Server({ name:'market-orca-mcp', version:'1.2.0' }, { capabilities:{ tools:{} } })
  server.setRequestHandler(ListToolsRequestSchema, async()=>({ tools }))
  server.setRequestHandler(CallToolRequestSchema, async(req)=> call(req.params.name, req.params.arguments || {}))
  return server
}

const app = express()
app.use(cors({ origin:true, exposedHeaders:['mcp-session-id'] }))
app.use(express.json({ limit:'4mb' }))

const transports = new Map()
function auth(req,res,next){ if(!TOKEN) return next(); const h=req.headers.authorization||''; if(h === `Bearer ${TOKEN}`) return next(); res.status(401).json({ error:'unauthorized' }) }
app.get('/health', (_req,res)=>res.json({ ok:true, name:'market-orca-mcp', transport:'streamable-http', path:PATH }))
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

app.listen(PORT, HOST, ()=> console.log(`market-orca MCP HTTP listening on http://${HOST}:${PORT}${PATH}`))
