# AGENTS.md — Market Orca

## Project Overview

Market Orca is a **real-time market intelligence dashboard + AI report engine** for tracking stocks, crypto, forex, and commodities — with special focus on Indonesian market (IDX) and IDR exchange rates. It provides:

- Live price feeds (Yahoo Finance, Binance, Stooq) with candle/OHLCV data
- AI-generated daily market reports with incident tracking and severity classification
- RAG (Retrieval-Augmented Generation) corpus with FTS5 full-text search + lightweight vector search
- Web search integration (SearXNG, DuckDuckGo, Bing, Yahoo) with deep multi-mode search
- Discord bot for alerts, DM delivery, and report publishing
- MCP (Model Context Protocol) server — both stdio and HTTP transport — exposing 16 tools for AI agents
- Vue 3 SPA frontend (Vite, PWA-capable)

**Tech stack:** Node.js (ESM), Express, better-sqlite3 (WAL mode), Vue 3, Vite, Discord.js, @modelcontextprotocol/sdk, pdfkit

**Default ports:** Backend API `4567`, MCP HTTP `1788`, SearXNG `18080`, Frontend dev `5173`

---

## Directory Structure

```
market-orca/
├── backend/
│   ├── data/market.db              # SQLite database (WAL mode)
│   ├── src/
│   │   ├── server.js               # Main Express app + all REST API routes + MCP-lite HTTP endpoints
│   │   ├── config.js               # APP_CONFIG: LAN/Tailscale IP detection, alert thresholds, URLs
│   │   ├── db.js                   # SQLite schema (30+ tables), migrations, seed data, helper fns
│   │   ├── auth.js                 # User auth: hashPassword, createSession, requireUser, seedTestAccounts
│   │   ├── live-data.js            # Fetch live prices from Yahoo/Binance/Stooq + news aggregation
│   │   ├── alert-engine.js         # Periodic price alert scanning, Discord notifications
│   │   ├── ai-daily-report.js      # AI report generation (text, HTML, Discord embed, incident severity)
│   │   ├── web-search.js           # Multi-engine web search (SearXNG, Bing, DuckDuckGo, Yahoo)
│   │   ├── rag.js                  # RAG store: ingest, chunk, FTS5 search, lightweight vector search
│   │   ├── rag-report.js           # RAG-grounded report generation with citations
│   │   ├── rag-crawler.js          # Crawl queue: enqueue URLs, crawl4ai-lite fetch + ingest
│   │   ├── rag-report.js           # RAG report builder
│   │   ├── mcp-server.js           # MCP stdio server (JSON-RPC over stdin/stdout), 16 tools
│   │   ├── mcp-http-server.js      # MCP StreamableHTTP transport (@modelcontextprotocol/sdk)
│   │   ├── discord.js              # Discord bot: alerts, embeds, webhook posting, DM delivery
│   │   ├── discord-dm.js           # Discord DM subscriber management
│   │   ├── discord-settings.js     # Discord bot configuration (webhook, token, channel)
│   │   ├── search.js               # Symbol search (Yahoo) + asset import
│   │   ├── watchlist.js            # User watchlist CRUD
│   │   ├── article.js              # Article formatting
│   │   ├── channel-preview.js      # Multi-channel report preview (Discord, etc.)
│   │   ├── report-export-permissions.js  # Signed export links, audit, watermarking
│   │   ├── source-reliability.js   # Source trust scoring (30+ preconfigured sources)
│   │   ├── market-calendar.js      # Market holiday/closed detection per exchange
│   │   ├── news-enrich.js          # News sentiment enrichment
│   │   ├── seed.js                 # Database seeder
│   │   └── *.test.js               # Tests (node --test)
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.vue                 # Router + layout
│   │   ├── main.js                 # Vue app entry
│   │   ├── pages/                  # Route pages
│   │   │   ├── HomePage.vue
│   │   │   ├── AssetPage.vue       # Individual asset detail
│   │   │   ├── ReportPage.vue      # Daily report viewer
│   │   │   ├── ReportEditorPage.vue
│   │   │   ├── ReportPreferencesPage.vue
│   │   │   ├── TerminalPage.vue    # CLI-like terminal interface
│   │   │   ├── ImpactSimulatorPage.vue
│   │   │   ├── WatchlistInsightsPage.vue
│   │   │   ├── DeliveryDashboardPage.vue
│   │   │   └── RagReportBuilderPage.vue
│   │   └── components/
│   │       ├── AssetCharts.vue
│   │       ├── MiniSparkline.vue
│   │       ├── AlertCenter.vue
│   │       └── ToastStack.vue
│   ├── dist/                       # Built output (served by backend in production)
│   └── vite.config.js
├── reports/                        # Generated reports (.md, .html, .json, .png)
├── docs/
│   └── APM_IMPLEMENTATION_PLAN.md  # Feature tracking + task table
├── docker-compose.searxng.yml      # SearXNG search engine container
└── .claude/                        # Agent tooling config
```

---

## Architecture

### Data Flow
```
Live Sources (Yahoo/Binance/Stooq/Google News)
    ↓ fetch
live-data.js → saveAssetSnapshot() → SQLite (assets, candles, news, price_history)
    ↓
alert-engine.js → runAlertScan() → Discord alerts (threshold-based)
    ↓
ai-daily-report.js → generateAiDailyReport() → text + HTML + Discord embed
    ↓
rag.js + rag-crawler.js → evidence store (FTS5 + vectors)
    ↓
server.js → REST API (Express) + MCP-lite HTTP endpoints
    ↓
frontend (Vue 3 SPA)
```

### Database Schema (SQLite, WAL mode)
Key tables: `assets`, `news`, `candles`, `alerts`, `price_history`, `asset_settings`, `watchlist`, `users`, `sessions`, `report_blocks`, `report_rewrite_proposals`, `rag_documents`, `rag_chunks`, `rag_chunks_fts`, `rag_vectors`, `rag_evidence_documents`, `rag_evidence_chunks`, `rag_evidence_chunks_fts`, `rag_report_runs`, `rag_citations`, `suggested_alerts`, `user_alert_feedback`, `incident_status`, `event_templates`, `delivery_log`, `send_queue`, `user_report_preferences`, `user_context_answers`, `decision_context_fingerprints`, `discord_settings`, `discord_dm_subscribers`, `source_reliability`, `debate_threads`, `debate_messages`, `report_export_audit`, `signed_export_links`

Schema auto-creates on startup via `db.js`. Migrations are inline (`ALTER TABLE ADD COLUMN` with existence checks).

### Auth
- Session-based auth (SHA-256 password hash, token in DB)
- Test accounts seeded on start: `admin@example.test` / `admin12345`, `user@example.test` / `user12345`
- Cookie: `mo_session` (httpOnly, lax, 7-day expiry)

### Discord Integration
- Bot token + webhook URLs configured via `backend/.env` or DB `discord_settings` table
- Alert delivery, DM subscriber management, report embeds
- Slash commands registered on bot connect

---

## MCP Interfaces

Market Orca exposes a **MCP-lite** interface (Model Context Protocol v2025-03-26) via two transports:

### 1. Embedded HTTP (in server.js)
Base: `http://localhost:4567/mcp/`

| Endpoint | Method | Description |
|---|---|---|
| `/mcp/health` | GET | Server health + tool list |
| `/mcp/tools` | GET | Full tool catalog with schemas |
| `/mcp/metrics` | GET | Request metrics + cache stats |
| `/mcp/selftest` | GET | Automated health checks (RAG, web, fetch) |
| `/mcp/openapi.json` | GET | OpenAPI 3.1 spec |
| `/mcp/tool/:tool` | POST | **Call any MCP tool** (rate-limited, auth-optional) |

Auth: `MCP_AUTH_TOKEN` env var → `Authorization: Bearer <token>` header
Rate limit: `MCP_RATE_LIMIT_PER_MIN` (default 120/min per IP)

### 2. Standalone MCP Server
**stdio transport:** `npm run mcp` → JSON-RPC over stdin/stdout
**HTTP transport:** `npm run mcp:http` → `http://0.0.0.0:1788/mcp` (StreamableHTTP)

### MCP Tools (16 tools)

**Web Search:**
- `web.search` — Focused search with modes/filters (no LLM required)
- `web.deep_search` — Broad multi-engine search with dedupe/rank/cluster
- `web.fetch_page` — Read one URL into clean Markdown
- `web.search_and_answer` — Perplexity-style search+answer with citations
- `web.search_to_crawl` — Search → filter → enqueue safe URLs to RAG
- `web.news_search` — Fresh news search with language/time filters
- `web.preview` — Preview URL before crawl

**RAG:**
- `rag.search` — Hybrid FTS + vector search
- `rag.ingest` — Ingest text/content into RAG
- `rag.crawl_enqueue` — Enqueue URL for crawl
- `rag.crawl_run` — Process crawl queue
- `rag.vectorize_missing` — Generate vectors for unvectorized chunks
- `rag.cleanup` — Purge old/excess chunks
- `rag.storage` — Storage stats

**Reports:**
- `report.get` — Get saved report JSON by slug
- `report.blocks` — Get evidence blocks + quality scores

**MCP tool naming convention:** HTTP endpoint uses `web.search`; stdio MCP uses `market_orca_web_search`

---

## Dev Setup

### Prerequisites
- Node.js 18+ (ESM)
- (Optional) Docker for SearXNG

### Backend
```bash
cd backend
npm install
npm run dev      # PORT=1745, --watch mode
npm run start    # PORT=1745 production
npm run seed     # Re-seed database
npm test         # node --test src/*.test.js
npm run mcp      # Start MCP stdio server
npm run mcp:http # Start MCP HTTP server on :1788
```

### Frontend
```bash
cd frontend
npm install
npm run dev      # Vite dev server on :5173
npm run build    # → dist/
```

### SearXNG (local search engine)
```bash
docker compose -f docker-compose.searxng.yml up -d
# Available at http://127.0.0.1:18080
```

### Environment Variables
| Variable | Default | Description |
|---|---|---|
| `PORT` | `4567` | Backend API port |
| `MCP_PORT` | `1788` | Standalone MCP HTTP port |
| `MCP_TOKEN` | — | Auth token for standalone MCP |
| `MCP_AUTH_TOKEN` | — | Auth token for embedded MCP |
| `MCP_RATE_LIMIT_PER_MIN` | `120` | MCP rate limit |
| `LAN_IP` | auto-detect | LAN IP (fallback `192.168.x.x`) |
| `TAILSCALE_IP` | auto-detect | Tailscale IP (fallback `100.x.x.x`) |
| `PUBLIC_BASE_URL` | `http://{LAN}:{PORT}` | Public URL for links |
| `FRONTEND_URL` | `http://{LAN}:5173` | Frontend dev URL |
| `DISCORD_TOKEN` | — | Discord bot token (also via `.env`) |
| `DISCORD_WEBHOOK_URL` | — | Discord alert webhook |

### Key Dependencies
- `express` — HTTP server
- `better-sqlite3` — SQLite with WAL mode
- `discord.js` — Discord bot
- `@modelcontextprotocol/sdk` — MCP protocol
- `pdfkit` — PDF export
- `compression`, `cors` — Middleware

---

## Conventions

### Code Style
- **ESM only** (`"type": "module"` in package.json)
- **No TypeScript** — pure JavaScript with ESM imports
- **No build step for backend** — runs directly with Node
- **Schema-as-code** — DB tables auto-created in `db.js` with `CREATE TABLE IF NOT EXISTS`
- **Migrations inline** — `PRAGMA table_info` + `ALTER TABLE ADD COLUMN` pattern
- **Transactions** — wrapped in `db.transaction()` for atomicity

### API Patterns
- All endpoints return `{ ok: true/false, ...data }` shape
- Errors: `res.status(5xx).json({ ok:false, error: string })`
- Input validation: manual string cleaning, length limits, regex replace
- SSRF protection: `validateFetchUrl()` on all outbound fetches

### File Naming
- Backend: kebab-case `.js` (e.g., `ai-daily-report.js`, `rag-crawler.js`)
- Frontend: PascalCase `.vue` for pages/components (e.g., `ReportPage.vue`)
- Tests: `*.test.js` co-located with source

### Database
- Single SQLite file: `backend/data/market.db`
- WAL mode + busy_timeout 5000ms
- Table names: snake_case (e.g., `rag_evidence_chunks`, `report_blocks`)
- Timestamps: ISO 8601 TEXT via `datetime('now')`
- Soft deletes / status fields preferred over hard deletes

### MCP Tool Development
- Tool definitions: array in `mcp-server.js` (exported `tools`)
- Tool implementations: `call(name, args)` function in `mcp-server.js`
- HTTP wrappers in `server.js` under `/mcp/tool/:tool`
- Response shape: `{ structuredContent, content: [{ type:'text', text }] }`
- Timeout: 45s default via `withTimeout()`
- Rate limiting: sliding window per IP, configurable

### Report Generation
- Reports stored as JSON in `reports/YYYY-MM-DD.json`
- HTML renders in `reports/YYYY-MM-DD.html`
- Card images: `reports/YYYY-MM-DD-card.png`
- Brief markdown: `reports/YYYY-MM-DD-brief.md`
- Incident tracking via `title_hash` (SHA-256 prefix)
- Report blocks have `claim_type` (assumption/fact/opinion) and `confidence` scores

### Testing
- `node --test src/*.test.js` (Node.js built-in test runner)
- Tests co-located: `report-export-permissions.test.js`
- `node --check` for syntax validation

### Integrations (Notion / n8n / Obsidian)
- **Notion**: OAuth 2.0 (not internal tokens) — see `docs/integration/notion-oauth-guide.md`
- **n8n**: port `5678` — workflow templates in `docs/integration/n8n-notion-obsidian-template.json`
- **Obsidian vault**: `/home/dicky/ObsidianVault/` — write via n8n Write Binary File node
- **MCP Notion server**: config at `.claude/mcp-notion.json`
- **Env vars**: `.env.notion.example` → copy to `.env`
