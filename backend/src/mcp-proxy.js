// Standalone MCP reverse proxy: port 1788 → localhost:4567/mcp/*
import http from 'node:http'

const PORT = 1788
const TARGET = 'http://127.0.0.1:4567'

http.createServer((req, res) => {
  // ── Favicon ──────────────────────────────────────────────────────────────
  if (req.url === '/favicon.ico') {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="80" font-size="80">🔌</text></svg>`
    res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=86400' })
    res.end(svg)
    return
  }
  // ── robots.txt ───────────────────────────────────────────────────────────
  if (req.url === '/robots.txt') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end(`User-agent: *
Allow: /

# MCP.anomali.web.id — AI agent API
# Docs: https://market-orca.anomali.web.id/docs/mcp`)
    return
  }

  const upstream = new URL(req.url, TARGET)
  upstream.pathname = '/mcp' + req.url

  const opts = {
    hostname: '127.0.0.1',
    port: 4567,
    path: '/mcp' + req.url,
    method: req.method,
    headers: { ...req.headers, host: '127.0.0.1:4567' }
  }

  console.log(`[mcp-proxy] ${req.method} ${req.url} -> /mcp${req.url}`)

  const proxy = http.request(opts, (upstream) => {
    res.writeHead(upstream.statusCode, upstream.headers)
    upstream.pipe(res)
  })

  proxy.on('error', (e) => {
    console.error('[mcp-proxy] error', e.message)
    res.writeHead(502)
    res.end('MCP server unavailable')
  })

  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    req.pipe(proxy)
  } else {
    proxy.end()
  }
}).listen(PORT, () => {
  console.log(`[mcp-proxy] http://localhost:${PORT} -> http://127.0.0.1:4567/mcp`)
})
