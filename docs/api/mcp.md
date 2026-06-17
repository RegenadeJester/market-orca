# MCP Tools

Market Orca exposes **16 tools** via the Model Context Protocol (MCP v2025-03-26). AI agents can use these tools to search the web, query RAG, ingest data, and access market information.

## Transports

### 1. Embedded HTTP (in backend server)

**Base URL:** `http://localhost:4567/mcp/`

```bash
# List available tools
curl http://localhost:4567/mcp/tools

# Call a tool
curl -X POST http://localhost:4567/mcp/tool/web.search \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"query": "Fed rate decision"}'
```

### 2. Standalone MCP Server

**stdio transport:**
```bash
npm run mcp          # JSON-RPC over stdin/stdout
```

**HTTP transport:**
```bash
npm run mcp:http     # StreamableHTTP on port 1788
```

**Base URL:** `http://localhost:1788/mcp`

## Authentication

```bash
# Set in .env
MCP_AUTH_TOKEN=your-secret-token

# Pass in requests
Authorization: Bearer your-secret-token
```

Auth is optional — omit the header to allow unauthenticated access.

## Rate Limiting

- **Default:** 120 requests/minute per IP
- **Configurable:** `MCP_RATE_LIMIT_PER_MIN` env var

## MCP Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/mcp/health` | GET | Server health + tool list |
| `/mcp/tools` | GET | Full tool catalog with input schemas |
| `/mcp/metrics` | GET | Request metrics + cache stats |
| `/mcp/selftest` | GET | Automated health checks |
| `/mcp/openapi.json` | GET | OpenAPI 3.1 spec |
| `/mcp/tool/:tool` | POST | Call any MCP tool |

## Web Search Tools

### `web.search`

Focused search with filters — no LLM required.

```json
{
  "query": "Bank Indonesia interest rate",
  "mode": "web",
  "lang": "id",
  "time_range": "month",
  "max_results": 10
}
```

**Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `query` | string | required | Search query |
| `mode` | string | `web` | `web | images | news | videos` |
| `lang` | string | `en` | Language code |
| `time_range` | string | — | `day | week | month | year` |
| `max_results` | number | 10 | Max results (1-50) |

---

### `web.deep_search`

Broad multi-engine search with deduplication, ranking, and clustering.

```json
{
  "query": "Bitcoin ETF approval impact",
  "engines": ["google", "bing", "duckduckgo"],
  "max_results": 20,
  "dedupe": true
}
```

---

### `web.fetch_page`

Fetch one URL and return clean Markdown.

```json
{
  "url": "https://example.com/article"
}
```

---

### `web.search_and_answer`

Perplexity-style search + answer with citations.

```json
{
  "query": "What happened to IDX today?",
  "max_sources": 5
}
```

---

### `web.search_to_crawl`

Search → filter → enqueue safe URLs to RAG crawl queue.

```json
{
  "query": "market analysis Q3 2025",
  "max_urls": 10
}
```

---

### `web.news_search`

Fresh news search with language and time filters.

```json
{
  "query": "crypto regulation Indonesia",
  "lang": "id",
  "time_range": "day"
}
```

---

### `web.preview`

Preview a URL before crawling — returns title, description, and page structure.

```json
{
  "url": "https://example.com"
}
```

## RAG Tools

### `rag.search`

Hybrid full-text + vector search across the RAG store.

```json
{
  "query": "impact of rate hikes on IDX stocks",
  "limit": 10,
  "use_vectors": true
}
```

---

### `rag.ingest`

Ingest text content into the RAG store.

```json
{
  "content": "Full article text...",
  "title": "Article Title",
  "source_url": "https://example.com/article",
  "tags": ["market", "analysis"]
}
```

---

### `rag.crawl_url`

Crawl a URL and ingest its content into RAG.

```json
{
  "url": "https://example.com/article"
}
```

---

### `rag.report`

Generate a RAG-grounded report with citations.

```json
{
  "topic": "Indonesian market outlook Q4 2025",
  "sections": ["summary", "analysis", "citations"],
  "max_evidence": 20
}
```

## Market Data Tools

### `market.assets`

List all tracked assets with current prices.

```json
{
  "asset_type": "crypto",
  "quote_currency": "IDR"
}
```

---

### `market.asset_detail`

Detailed info for a single asset — price history, news, settings.

```json
{
  "symbol": "BTC-USD"
}
```

---

### `market.alerts`

List or create price alerts.

```json
{
  "action": "list"
}
```

```json
{
  "action": "create",
  "symbol": "BTC-USD",
  "condition": "above",
  "threshold": 50000
}
```

---

### `market.news`

Get latest news for an asset or market sector.

```json
{
  "symbol": "BTC-USD",
  "limit": 10
}
```

## Tool Metrics

```bash
curl http://localhost:4567/mcp/metrics
```

Returns request counts, cache hit rates, and latency stats per tool.

## Self-Test

```bash
curl http://localhost:4567/mcp/selftest
```

Automated health checks for:
- RAG store connectivity
- Web search availability
- External API reachability
