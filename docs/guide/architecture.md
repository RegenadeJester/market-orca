# Architecture

Market Orca is a multi-service platform combining real-time market data, AI-powered reports, and MCP tooling for AI agents.

## System Overview

```
┌─────────────────────────────────────────────────────────┐
│                    External Sources                       │
│  Yahoo Finance · Binance · Stooq · SearXNG · Google News │
└───────────────────────────┬─────────────────────────────┘
                            │ fetch
                            ▼
┌─────────────────────────────────────────────────────────┐
│                   Backend API (port 4567)                 │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐          │
│  │live-data │  │alert-eng │  │ai-daily-report│          │
│  └────┬─────┘  └────┬─────┘  └───────┬───────┘          │
│       │              │                │                   │
│       ▼              ▼                ▼                   │
│  ┌──────────────────────────────────────────┐           │
│  │        SQLite (WAL mode) + RAG Store      │           │
│  │  assets · candles · news · rag_chunks ·   │           │
│  │  rag_vectors · alerts · users · sessions  │           │
│  └──────────────────────────────────────────┘           │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐          │
│  │  MCP     │  │ Discord  │  │  Web Search   │          │
│  │  Server  │  │   Bot    │  │  Multi-Engine │          │
│  └──────────┘  └──────────┘  └──────────────┘          │
└──────────┬──────────┬───────────────┬──────────────────┘
           │          │               │
           ▼          ▼               ▼
┌──────────────┐ ┌──────────┐ ┌──────────────────┐
│  MCP HTTP    │ │ Discord  │ │  Frontend SPA    │
│  port 1788   │ │ Alerts   │ │  Vue 3 (5173)    │
└──────────────┘ └──────────┘ └──────────────────┘
                                         │
                                         ▼
                              ┌──────────────────┐
                              │  Report Dashboard │
                              │  port 4568        │
                              └──────────────────┘
```

## Core Components

### Backend (`backend/src/`)

| Module | Purpose |
|--------|---------|
| `server.js` | Express app — REST API routes + MCP-lite HTTP endpoints |
| `config.js` | App configuration — LAN/Tailscale IP detection, thresholds, URLs |
| `db.js` | SQLite schema (30+ tables), migrations, seed data, helper functions |
| `auth.js` | Session-based auth — SHA-256 password hash, cookie sessions |
| `live-data.js` | Price feeds from Yahoo, Binance, Stooq + news aggregation |
| `alert-engine.js` | Periodic price alert scanning, Discord notifications |
| `ai-daily-report.js` | AI report generation — text, HTML, Discord embed, incident severity |
| `web-search.js` | Multi-engine search — SearXNG, Bing, DuckDuckGo, Yahoo |
| `rag.js` | RAG store — ingest, chunk, FTS5 search, lightweight vector search |
| `rag-crawler.js` | Crawl queue — enqueue URLs, crawl4ai-lite fetch + ingest |
| `rag-report.js` | RAG-grounded report generation with citations |
| `mcp-server.js` | MCP stdio server — JSON-RPC over stdin/stdout |
| `mcp-http-server.js` | MCP HTTP server — StreamableHTTP transport |
| `discord.js` | Discord bot — alerts, embeds, webhook posting, DM delivery |

### Data Flow

```
1. Live Sources → live-data.js → SQLite (assets, candles, news, price_history)
2. alert-engine.js → runAlertScan() → Discord alerts
3. ai-daily-report.js → generateAiDailyReport() → text + HTML + embed
4. rag.js + rag-crawler.js → evidence store (FTS5 + vectors)
5. server.js → REST API + MCP HTTP endpoints
6. frontend (Vue 3 SPA) → Report Dashboard
```

### Frontend (`frontend/src/`)

| Page | Purpose |
|------|---------|
| `HomePage.vue` | Dashboard overview — market snapshot |
| `AssetPage.vue` | Individual asset detail with charts |
| `ReportPage.vue` | Daily report viewer |
| `ReportEditorPage.vue` | Report editing and rewriting |
| `TerminalPage.vue` | CLI-like terminal interface |
| `ImpactSimulatorPage.vue` | Impact simulation tool |
| `WatchlistInsightsPage.vue` | Watchlist analysis |
| `RagReportBuilderPage.vue` | RAG-powered report builder |

## Database Schema

SQLite with WAL mode. Key tables:

| Category | Tables |
|----------|--------|
| Market Data | `assets`, `candles`, `price_history`, `news` |
| Users | `users`, `sessions`, `watchlist` |
| Reports | `report_blocks`, `report_rewrite_proposals`, `user_report_preferences` |
| RAG | `rag_documents`, `rag_chunks`, `rag_chunks_fts`, `rag_vectors`, `rag_citations` |
| Alerts | `alerts`, `suggested_alerts`, `user_alert_feedback` |
| Discord | `discord_settings`, `discord_dm_subscribers` |
| Misc | `source_reliability`, `incident_status`, `delivery_log`, `debate_threads` |

Schema auto-creates on startup. Migrations are inline (`ALTER TABLE ADD COLUMN` with existence checks).

## Auth

- Session-based auth (SHA-256 password hash, token in DB)
- Test accounts seeded on start:
  - `admin@example.test` / `admin12345`
  - `user@example.test` / `user12345`
- Cookie: `mo_session` (httpOnly, lax, 7-day expiry)

## Default Ports

| Service | Port | Transport |
|---------|------|-----------|
| Backend API | 4567 | HTTP (Express) |
| MCP HTTP | 1788 | HTTP (StreamableHTTP) |
| MCP stdio | — | stdin/stdout (JSON-RPC) |
| SearXNG | 18080 | HTTP |
| Frontend Dev | 5173 | HTTP (Vite) |
| Report Dashboard | 4568 | HTTP |
| n8n | 5678 | HTTP |
