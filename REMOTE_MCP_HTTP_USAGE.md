# Market Orca Remote MCP-lite HTTP Usage

Base URL over Tailscale:

```txt
http://100.x.x.x:4567
```

Public Cloudflare target after DNS/ICANN fixed:

```txt
https://mcp.example.com
```

## Health

```bash
curl http://100.x.x.x:4567/mcp/health
```

## Tool call format

```txt
POST /mcp/tool/{tool_name}
Content-Type: application/json
```

## Tools

- `web.search` — focused web search
- `web.deep_search` — many searches across modes/engines, merge/dedupe/rank/cluster
- `web.search_to_crawl` — web search then enqueue crawl-safe results into RAG
- `rag.search`
- `rag.ingest`
- `rag.crawl_enqueue`
- `rag.crawl_run`
- `rag.vectorize_missing`
- `rag.cleanup`
- `rag.storage`
- `report.get`
- `report.blocks`

## Best default for agents

Use `web.deep_search` first for broad research.

```bash
curl -s -X POST http://100.x.x.x:4567/mcp/tool/web.deep_search \
  -H 'content-type: application/json' \
  -d '{
    "query":"IHSG hari ini trading cepat",
    "engines":["bing","yahoo","duckduckgo"],
    "modes":["market","official","forum","blog"],
    "limit":20,
    "autoPreview":true,
    "previewLimit":3
  }' | jq
```

## Focused search

```bash
curl -s -X POST http://100.x.x.x:4567/mcp/tool/web.search \
  -H 'content-type: application/json' \
  -d '{
    "query":"SQLite FTS5 RAG low memory",
    "mode":"coding",
    "engines":["bing","yahoo"],
    "limit":5
  }' | jq
```

## Search → Crawl → RAG

```bash
curl -s -X POST http://100.x.x.x:4567/mcp/tool/web.search_to_crawl \
  -H 'content-type: application/json' \
  -d '{
    "query":"Bank Indonesia kurs rupiah",
    "mode":"official",
    "engines":["bing","yahoo"],
    "limit":10,
    "enqueueLimit":3,
    "assetTags":["USDIDR"]
  }' | jq
```

Then run crawl worker:

```bash
curl -s -X POST http://100.x.x.x:4567/mcp/tool/rag.crawl_run \
  -H 'content-type: application/json' \
  -d '{"limit":3}' | jq
```

Then RAG:

```bash
curl -s -X POST http://100.x.x.x:4567/mcp/tool/rag.search \
  -H 'content-type: application/json' \
  -d '{"query":"Bank Indonesia kurs rupiah", "limit":5}' | jq
```

## Agent prompt

```txt
Use Market Orca MCP-lite over HTTP.
Base URL: http://100.x.x.x:4567
Call tools with POST /mcp/tool/{tool_name}.
For broad research, use web.deep_search.
For focused source discovery, use web.search.
For ingestion, use web.search_to_crawl then rag.crawl_run then rag.search.
Use public/open sources only. Do not bypass CAPTCHA/paywall. Prefer high-confidence trusted domains. If result is low confidence, preview/cross-check before using.
```
