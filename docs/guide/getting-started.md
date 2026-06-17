# Getting Started

Welcome to **Market Orca** — a real-time market intelligence dashboard and AI report engine.

## System Requirements

- **Node.js** >= 20 (tested on v22+)
- **npm** >= 9
- **SQLite 3** (bundled via `better-sqlite3`)
- Optional: **SearXNG** (Docker) for web search

## Quick Install

```bash
# Clone repository
git clone https://github.com/anomali/market-orca.git
cd market-orca

# Install backend dependencies
cd backend
npm install
```

## Configuration

Create a `.env` file in the `backend/` directory:

```env
# Server
PORT=4567
HOST=0.0.0.0

# Auth
MCP_AUTH_TOKEN=your-secret-token

# Discord (optional)
DISCORD_BOT_TOKEN=your-bot-token
DISCORD_WEBHOOK_URL=your-webhook-url

# Web Search (optional)
SEARXNG_BASE_URL=http://localhost:18080
BING_API_KEY=your-bing-key
```

## Start the Backend

```bash
cd backend
npm start
```

The server starts on **port 4567**. Database auto-creates on first run with test accounts:
- `admin@example.test` / `admin12345`
- `user@example.test` / `user12345`

## Start the Frontend

```bash
cd frontend
npm install
npm run dev
```

The Vue 3 dashboard runs on **port 5173** (default Vite dev server).

## Verify It's Running

```bash
# Backend health check
curl http://localhost:4567/health

# MCP health check
curl http://localhost:4567/mcp/health
```

## Quick Links

| Service | URL | Port |
|---------|-----|------|
| Backend API | `http://localhost:4567` | 4567 |
| MCP HTTP | `http://localhost:1788/mcp` | 1788 |
| Report Dashboard | `http://localhost:4568` | 4568 |
| Frontend Dev | `http://localhost:5173` | 5173 |
| n8n | `http://localhost:5678` | 5678 |

## Next Steps

- [Architecture Overview](/guide/architecture) — Understand the system design
- [Backend API](/api/backend) — Explore all REST endpoints
- [MCP Tools](/api/mcp) — AI agent tool reference
- [n8n Integration](/integration/n8n) — Set up automation workflows
