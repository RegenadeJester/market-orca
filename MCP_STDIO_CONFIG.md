# Market Orca MCP stdio config

Use this in any AI client/agent that supports MCP stdio.

```json
{
  "mcpServers": {
    "market-orca": {
      "command": "node",
      "args": ["/home/dicky/.openclaw/workspace/market-orca/backend/src/mcp-server.js"],
      "cwd": "/home/dicky/.openclaw/workspace/market-orca/backend"
    }
  }
}
```

## What this MCP is for

Market Orca MCP gives agents a simple public-evidence workflow:

1. Search public web with operators/modes.
2. Preview results.
3. Crawl allowed open/public URLs.
4. Ingest into RAG.
5. Search/report with citations.

## Tools

- `market_orca_web_capabilities` — read this first. Shows engines, modes, operators, examples, source count.
- `market_orca_web_search` — dedicated web search.
- `market_orca_web_to_crawl` — search, filter crawl-safe URLs, enqueue into RAG crawl queue.
- `market_orca_trusted_domains` — trusted/source-priority domains.
- `market_orca_crawl_url` — crawl one URL and ingest.
- `market_orca_rag_search` — search local RAG evidence store.
- `market_orca_ingest_text` — ingest custom text into RAG.
- `market_orca_rag_report` — citation-grounded answer/report from RAG.
- `market_orca_report_qa` — inspect report block evidence quality.
- `market_orca_decision_fingerprint` — stable decision fingerprint for agent runs.

## Search modes

- `market` — finance/market sources
- `official` — regulators/exchanges/gov
- `forum` — Reddit/HN/StackOverflow
- `blog` — Medium/Substack/Dev.to
- `coding` — GitHub/docs/package registries
- `marketing` — growth/ads/analytics/business
- `journal` — open research/journals
- `thesis` — skripsi/thesis/open repositories
- `data` — public/open datasets
- `docs` — technical docs
- `security` — infosec sources
- `research` — AI/research sources

## Operators supported

- `sites`: emits `site:` filters
- `excludeSites`: emits `-site:` filters
- `filetype`: e.g. `pdf`, `csv`, `json`
- `intitle`
- `exact`: quoted phrase
- `after`: `YYYY-MM-DD`
- `before`: `YYYY-MM-DD`
- `mustHave`: required terms

## Example: journal PDF

```json
{
  "query": "financial sentiment analysis",
  "mode": "journal",
  "filetype": "pdf",
  "exact": "stock market",
  "after": "2022-01-01",
  "engines": ["bing", "yahoo"],
  "limit": 5
}
```

## Example: coding docs

```json
{
  "query": "SQLite FTS5 vector search RAG",
  "mode": "coding",
  "sites": ["github.com", "sqlite.org", "developer.mozilla.org"],
  "excludeSites": ["medium.com"],
  "engines": ["bing", "duckduckgo"],
  "limit": 5
}
```

## Safety policy

- Public/open sources only.
- No CAPTCHA bypass.
- No paywall bypass.
- Respect crawl allowlist/private-IP guard.
- If engine blocks parsing, fallback links/results are acceptable; do not fake certainty.
