<div align="center">

# 🐋 Market Orca

**Real-time Market Intelligence Dashboard + AI Report Engine**

[![Node.js](https://img.shields.io/badge/Node.js-ESM-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Vue 3](https://img.shields.io/badge/Vue-3-42b883?logo=vue.js&logoColor=white)](https://vuejs.org)
[![SQLite](https://img.shields.io/badge/SQLite-WAL-003B57?logo=sqlite&logoColor=white)](https://www.sqlite.org)
[![MCP](https://img.shields.io/badge/MCP-Server-8B5CF6)](https://modelcontextprotocol.io)
[![Discord](https://img.shields.io/badge/Discord-Bot-5865F2?logo=discord&logoColor=white)](https://discord.com)

Live price feeds · AI-powered reports · RAG evidence store · MCP tool server · Discord alerts

</div>

---

## ✨ Features

| Module | Description |
|--------|-------------|
| **Live Data** | Real-time prices from Yahoo Finance, Binance, Stooq — candle/OHLCV data |
| **AI Reports** | Automated daily market reports with incident tracking & severity classification |
| **RAG Store** | FTS5 full-text search + lightweight vector search for evidence grounding |
| **Web Search** | Multi-engine search via SearXNG, DuckDuckGo, Bing, Yahoo |
| **MCP Server** | 16 AI-agent tools via stdio + HTTP transport (`@modelcontextprotocol/sdk`) |
| **Discord Bot** | Alerts, embeds, DM delivery, webhook-based report publishing |
| **Frontend** | Vue 3 SPA with dark/light themes, i18n, PWA-ready |

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        LIVE SOURCES                              │
│  Yahoo Finance ─┐  Binance ─┐  Stooq ─┐  Google News ─┐       │
└─────────────────┼───────────┼──────────┼───────────────┼───────┘
                  ▼           ▼          ▼               ▼
          ┌──────────────────────────────────────────────────┐
          │               live-data.js                       │
          │   fetch() → saveAssetSnapshot() → SQLite         │
          └──────────┬──────────────┬────────────────┬───────┘
                     ▼              ▼                ▼
          ┌──────────────┐ ┌───────────────┐ ┌────────────────┐
          │ alert-engine │ │ ai-daily-     │ │ rag + rag-     │
          │ → Discord    │ │ report.js     │ │ crawler.js     │
          │   alerts     │ │ → HTML/MD     │ │ → FTS5/vectors │
          └──────┬───────┘ └───────┬───────┘ └───────┬────────┘
                 ▼                 ▼                  ▼
          ┌──────────────────────────────────────────────────────┐
          │  server.js — Express REST API + MCP-lite endpoints   │
          │  mcp-http-server.js — StreamableHTTP transport       │
          └──────────────────────┬───────────────────────────────┘
                                 ▼
          ┌──────────────────────────────────────────────────────┐
          │           frontend/ — Vue 3 SPA (Vite + PWA)         │
          └──────────────────────────────────────────────────────┘
```

## 📁 Project Structure

```
market-orca/
├── backend/
│   ├── src/
│   │   ├── server.js              # Express app + REST API
│   │   ├── config.js              # LAN/Tailscale IP detection, URLs
│   │   ├── db.js                  # SQLite schema (30+ tables), migrations
│   │   ├── auth.js                # Session-based auth (SHA-256)
│   │   ├── live-data.js           # Yahoo/Binance/Stooq price fetcher
│   │   ├── alert-engine.js        # Price alerts → Discord notifications
│   │   ├── ai-daily-report.js     # AI report generation (text, HTML, embed)
│   │   ├── web-search.js          # Multi-engine web search
│   │   ├── rag.js                 # RAG: ingest, chunk, FTS5 + vectors
│   │   ├── rag-crawler.js         # Crawl queue + ingest pipeline
│   │   ├── mcp-server.js          # MCP stdio server (16 tools)
│   │   ├── mcp-http-server.js     # MCP StreamableHTTP transport
│   │   ├── discord.js             # Discord bot (alerts, embeds, DMs)
│   │   └── report-server.js       # Report canvas + LLM rewrite
│   ├── package.json
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── App.vue                # Router + layout
│   │   ├── main.js                # Vue app entry
│   │   ├── pages/                 # Route pages
│   │   └── components/            # Reusable UI components
│   ├── package.json
│   └── vite.config.js
├── reports/                       # Generated reports (.md, .html, .json)
├── cloudflare-tunnel/             # Cloudflare tunnel config
├── docker-compose.dev.yml         # Docker dev services
├── docker-compose.searxng.yml     # SearXNG search engine
└── AGENTS.md                      # AI agent context
```

## 🔌 Port Map

| Service | Port | Protocol | Notes |
|---------|------|----------|-------|
| Backend API | `4567` | HTTP | Main REST API |
| Report Server | `4568` | HTTP | Report canvas + exports |
| Frontend Dev | `5173` | HTTP | Vite dev server (HMR) |
| MCP HTTP | `1788` | HTTP | AI agent tools endpoint |
| SearXNG | `18080` | HTTP | Self-hosted search engine |

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) ≥ 18 (ESM)
- [SQLite](https://www.sqlite.org/) (via `better-sqlite3`)
- [Docker](https://docker.com/) (optional — for SearXNG)

### 1. Clone

```bash
git clone https://github.com/RegenadeJester/market-orca.git
cd market-orca
```

### 2. Backend

```bash
cd backend
cp .env.example .env          # ← Edit with your values (see ⚠️ below)
npm install
npm run seed                   # Create schema + seed test accounts
npm run dev                    # Starts on :4567
```

### 3. Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev                    # Starts on :5173
```

### 4. Search Engine (optional)

```bash
# ⚠️ Edit searxng/settings.yml — change secret_key from "change-me" to a strong random string
docker compose -f docker-compose.searxng.yml up -d
# Accessible at http://localhost:18080
```

### 5. MCP Server

```bash
# Stdio transport (for Claude Desktop, etc.)
npm run mcp          # backend

# HTTP transport
npm run mcp:http     # backend
```

### 6. Cloudflare Tunnel (optional)

```bash
# ⚠️ Edit cloudflare-tunnel/config.yml — replace YOUR_TUNNEL_ID and hostnames
# ⚠️ Copy cloudflare-tunnel/.env.example → .env and add tunnel token
docker compose -f cloudflare-tunnel/docker-compose.yml up -d
```

## ⚠️ Security Notice

This repo is **public**. All secrets have been sanitized:

| File | What to customize |
|------|-------------------|
| `backend/.env` | Copy `.env.example` → `.env`, fill in real API keys |
| `searxng/settings.yml` | Change `secret_key: "change-me"` to a random string |
| `cloudflare-tunnel/config.yml` | Replace `YOUR_TUNNEL_ID` and hostnames with real values |
| `cloudflare-tunnel/.env` | Copy `.env.example` → `.env`, add `CLOUDFLARE_TUNNEL_TOKEN` |

**Never commit** `.env` files, tunnel tokens, or API keys. The `.gitignore` blocks them.

## 🔐 Authentication

| Account | Email | Password |
|---------|-------|----------|
| Admin | `admin@example.test` | `admin12345` |
| User | `user@example.test` | `user12345` |

> Test accounts are seeded automatically on `npm run seed`.

## 🧠 MCP Tools

The MCP server exposes 16 tools for AI agents:

| Tool | Description |
|------|-------------|
| `search_assets` | Search market assets by symbol/name |
| `get_asset_price` | Get live price + OHLCV data |
| `get_market_news` | Fetch recent market news |
| `search_web` | Multi-engine web search |
| `get_daily_report` | Generate/retrieve AI daily report |
| `rag_search` | Full-text search across RAG corpus |
| `rag_ingest` | Ingest a URL into RAG store |
| `create_alert` | Set price alert with threshold |
| `get_watchlist` | List user watchlist |
| `add_to_watchlist` | Add asset to watchlist |
| `get_candles` | Historical candle data |
| `get_news_sentiment` | News sentiment analysis |
| `get_rag_report` | RAG-grounded report with citations |
| `get_incidents` | Market incident tracking |
| `get_market_calendar` | Trading session status |
| `source_trust` | Source reliability scoring |

## 📡 API Endpoints

Key REST endpoints (all prefixed with API base):

```
GET  /assets                  — List all assets
GET  /assets/:symbol          — Asset detail + price history
GET  /news                    — Recent news feed
GET  /news/:symbol            — News for specific asset
GET  /candles/:symbol         — OHLCV candle data
GET  /watchlist               — User watchlist
POST /watchlist               — Add to watchlist
GET  /alerts                  — Price alerts
POST /alerts                  — Create alert
GET  /reports/daily           — Daily AI report
POST /reports/generate        — Generate new report
GET  /mcp/health              — MCP server health check
POST /mcp                     — MCP JSON-RPC endpoint
```

## ⚙️ Environment Variables

See [`backend/.env.example`](backend/.env.example) for all options.

**Critical secrets** (never commit):

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key for AI reports |
| `LLM_API_KEY` | Alternative LLM API key |
| `DISCORD_BOT_TOKEN` | Discord bot authentication |
| `DISCORD_WEBHOOK_URL` | Discord webhook for alerts |
| `MCP_AUTH_TOKEN` | MCP server auth bearer token |
| `PERPLEXITY_API_KEY` | Perplexity API for deep search |

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js (ESM) |
| Backend | Express.js |
| Database | SQLite (WAL mode, `better-sqlite3`) |
| Frontend | Vue 3, Vite, Composition API |
| AI/LLM | OpenAI GPT-4o-mini, RAG + FTS5 |
| MCP | `@modelcontextprotocol/sdk` |
| Bot | Discord.js v14 |
| Search | SearXNG, DuckDuckGo, Bing |
| PDF | pdfkit |

## 📄 License

MIT © [RegenadeJester](https://github.com/RegenadeJester)

---

<div align="center">
  <sub>Built with 🧠 for Indonesian markets (IDX) & global assets</sub>
</div>
