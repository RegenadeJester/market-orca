# Market Orca MCP-lite via Cloudflare Tunnel

Goal:

```txt
https://mcp.example.com -> http://localhost:4567
```

No SSH. Docker method only.

## 1) Cloudflare dashboard

Cloudflare Zero Trust → Networks → Tunnels → Create tunnel → Cloudflared → Docker.

Public Hostname:

```txt
Subdomain: mcp
Domain: example.com
Service: http://host.docker.internal:4567
```

Copy the tunnel token.

## 2) Setup on laptop-server

```bash
cd /path/to/cloudflare-tunnel
cp .env.example .env
nano .env
```

Paste:

```txt
CLOUDFLARE_TUNNEL_TOKEN=...
```

Run:

```bash
docker compose up -d
```

Check:

```bash
docker compose logs -f
curl https://mcp.example.com/mcp/health
```

Expected:

```json
{"ok":true,"name":"market-orca-rag-mcp-lite"}
```

## Agent usage

Base URL:

```txt
https://mcp.example.com
```

Health:

```txt
GET /mcp/health
```

Tool call format:

```txt
POST /mcp/tool/{tool_name}
```

Example:

```bash
curl -s -X POST https://mcp.example.com/mcp/tool/web.search \
  -H 'content-type: application/json' \
  -d '{"query":"SQLite FTS5 RAG","mode":"coding","limit":5}' | jq
```

Tools:

- `web.search`
- `web.search_to_crawl`
- `rag.search`
- `rag.ingest`
- `rag.crawl_enqueue`
- `rag.crawl_run`
- `rag.vectorize_missing`
- `rag.cleanup`
- `rag.storage`
- `report.get`
- `report.blocks`

## Notes

- This exposes HTTP MCP-lite, not stdio MCP.
- Keep Cloudflare Access enabled if you want auth.
- Recommended Access policy: your email only.
