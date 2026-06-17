# Market Orca MCP Server

Self-hosted MCP untuk agentic coding: RAG + crawl4ai-lite + search system.

## Run

```bash
cd /home/dicky/.openclaw/workspace/market-orca/backend
npm run mcp
```

## Self-hosted search engine

Start SearXNG local:

```bash
cd /home/dicky/.openclaw/workspace/market-orca
docker compose -f docker-compose.searxng.yml up -d
```

Run Market Orca with SearXNG:

```bash
cd /home/dicky/.openclaw/workspace/market-orca/backend
SEARXNG_URL=http://127.0.0.1:18080 PORT=1747 node src/server.js
```

## Agent config contoh

```json
{
  "mcpServers": {
    "market-orca": {
      "command": "node",
      "args": ["/home/dicky/.openclaw/workspace/market-orca/backend/src/mcp-server.js"],
      "env": {}
    }
  }
}
```

## Tools

### `market_orca_rag_search`
Cari corpus RAG. Hybrid: FTS + lightweight semantic vector.

Input:
```json
{"query":"USD IDR risk today", "limit":8}
```

### `market_orca_crawl_url`
Crawl URL, clean HTML, ingest ke RAG.

Input:
```json
{"url":"https://example.com/article"}
```

### `market_orca_ingest_text`
Masukkan dokumen/manual context ke RAG.

Input:
```json
{"title":"Project Notes", "content":"...", "sourceUrl":"file://notes.md"}
```

### `market_orca_rag_report`
Buat report berbasis citations.

Input:
```json
{"question":"Apa risiko utama AAPL minggu ini?", "limit":8}
```

### `market_orca_report_qa`
Cek evidence blocks report by slug.

Input:
```json
{"slug":"2026-05-29"}
```

### `market_orca_web_search`
Self-hosted web search. Default DuckDuckGo HTML scraping. Hasil diurutkan pakai dynamic query variants + trusted/forum/blog/journal/coding/marketing boost, tapi web lain tetap masuk.

Input:
```json
{"query":"AAPL earnings reddit medium analysis", "limit":10}
```

### `market_orca_trusted_domains`
List domain prioritas: official, news, forum, blog, dev docs. Web lain tetap boleh dipakai; list ini cuma ranking boost.

Input:
```json
{}
```

### `market_orca_decision_fingerprint`
Bikin fingerprint konteks keputusan supaya agentic run bisa diulang/audit.

Input:
```json
{"intent":"market report", "asset":"AAPL", "horizon":"weekly", "risk":"normal", "evidence_ids":["rag1","ev2"]}
```

## Cara agent pakai

1. `market_orca_web_search` cari web/forum/blog/official sources.
2. Utamakan trusted domains, tapi jangan buang web lain kalau relevan.
3. `market_orca_crawl_url` crawl text source terbaik.
4. `market_orca_rag_search` untuk ambil evidence dari corpus.
5. Gunakan evidence sebagai locked context.
6. Kalau bikin kode/report, jangan klaim hal eksternal tanpa source dari tool.
7. Untuk report Market Orca, cek `market_orca_report_qa` sebelum export/publish.

## Catatan jujur

- `crawl4ai-lite` = fetch + clean HTML, bukan full browser crawler.
- Semantic vector = hashed local embedding, bukan neural embedding.
- Bagus untuk self-hosted murah/cepat.
- Untuk semantic enterprise: tambah local embedding model + Qdrant/LanceDB.
