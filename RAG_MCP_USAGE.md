# Market Orca RAG MCP-lite Usage

Base URLs:
- Local: `http://localhost:4567`
- LAN: `http://192.168.x.x:4567`
- Tailscale: `http://100.x.x.x:4567`

This is an MCP-style HTTP tool server for agentic coding workflows. It is not stdio MCP yet; use it via HTTP from any agent/tool wrapper.

## Health

```bash
curl -s http://localhost:4567/mcp/health | jq
```

## Search RAG

```bash
curl -s -X POST http://localhost:4567/mcp/tool/rag.search \
  -H 'content-type: application/json' \
  -d '{"query":"rupiah usd idr bank indonesia","limit":5}' | jq
```

## Ingest text/source

```bash
curl -s -X POST http://localhost:4567/mcp/tool/rag.ingest \
  -H 'content-type: application/json' \
  -d '{
    "url":"https://example.com/source",
    "title":"My source title",
    "source":"manual",
    "content":"Paste source content here...",
    "assetTags":["USDIDR","JKSE"]
  }' | jq
```

## Vectorize missing chunks

```bash
curl -s -X POST http://localhost:4567/mcp/tool/rag.vectorize_missing \
  -H 'content-type: application/json' \
  -d '{"limit":100}' | jq
```

## Storage stats

```bash
curl -s -X POST http://localhost:4567/mcp/tool/rag.storage \
  -H 'content-type: application/json' \
  -d '{}' | jq
```

## Cleanup low-RAM store

```bash
curl -s -X POST http://localhost:4567/mcp/tool/rag.cleanup \
  -H 'content-type: application/json' \
  -d '{"maxAgeDays":60,"maxChunks":20000}' | jq
```

## Get latest report JSON

```bash
curl -s -X POST http://localhost:4567/mcp/tool/report.get \
  -H 'content-type: application/json' \
  -d '{"slug":"2026-05-29"}' | jq
```

## Get evidence-aware blocks

```bash
curl -s -X POST http://localhost:4567/mcp/tool/report.blocks \
  -H 'content-type: application/json' \
  -d '{"slug":"2026-05-29"}' | jq
```

## Agentic coding example

Prompt your coding agent:

> Use Market Orca RAG MCP-lite at `http://localhost:4567/mcp/tool/rag.search`. Before answering, search relevant project/market evidence with query `{topic}` and cite returned titles/URLs.

## Notes

- Current retrieval: SQLite FTS5 + local hashed vector hybrid search.
- Lightweight by design for laptop-server.
- No Qdrant/LanceDB daemon required.
- crawl4ai worker is still next phase.
