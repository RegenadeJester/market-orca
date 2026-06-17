# n8n Workflows

Market Orca integrates with [n8n](https://n8n.io) (port 5678) for workflow automation — triggering reports, sending alerts, syncing data, and orchestrating market intelligence pipelines.

## Overview

```
n8n (port 5678) → Market Orca API (port 4567)
                   │
                   ├── Generate reports on schedule
                   ├── Send alerts via Discord
                   ├── Sync asset data
                   ├── Trigger RAG ingestion
                   └── Custom webhook workflows
```

## Setup

### 1. Access n8n

```bash
# n8n should be running on port 5678
open http://localhost:5678
```

### 2. Notion OAuth Credential

See the full [Notion OAuth Setup Guide](./notion-oauth-guide.md).

1. **Settings → Credentials → + Add Credential**
2. Search **Notion** → select **Notion OAuth2 API**
3. Enter **Client ID** and **Client Secret** from your Notion OAuth app
4. Click **Connect Account** → authorize in Notion popup
5. Credential named `Market Orca Notion` is ready

### 3. Obsidian Vault Access

n8n can write/read files from the Obsidian vault directly:

```yaml
# n8n docker-compose.yml volume mount (if using Docker)
volumes:
  - /home/dicky/ObsidianVault:/home/node/.n8n
  - /home/dicky/ObsidianVault:/home/dicky/ObsidianVault:ro  # read-only for safety
```

For **local n8n** (npm/Docker without extra mount): the local filesystem is accessible at `/home/dicky/ObsidianVault/` directly.

Use the **Read/Write Files from Disk** nodes:
- **Write Binary File** — `fileName: /home/dicky/ObsidianVault/path/to/note.md`
- **Read Binary Files** — `filePath: /home/dicky/ObsidianVault/**/*.md`

### 4. HTTP Request Node for Market Orca API

Configure a new HTTP Request node to call the Market Orca API:

```
Method: POST
URL: http://localhost:4567/mcp/tool/web.news_search
Headers:
  Content-Type: application/json
Body:
  {
    "query": "{{ $json.searchQuery }}",
    "lang": "id",
    "time_range": "day"
  }
```

### 3. Authentication

Add the MCP auth token if configured:

```
Headers:
  Authorization: Bearer YOUR_MCP_AUTH_TOKEN
```

## Common Workflows

### Daily Market Report Automation

```
┌──────────────┐    ┌──────────────────┐    ┌──────────────┐
│  Cron Trigger │───▶│ Generate Report  │───▶│ Send to      │
│  (7:00 AM)   │    │ via API          │    │ Discord      │
└──────────────┘    └──────────────────┘    └──────────────┘
```

**Steps:**
1. **Schedule Trigger** — Run daily at 7:00 AM WIB
2. **HTTP Request** — `POST /api/generate-report`
3. **HTTP Request** — `POST /api/discord/settings` (get webhook)
4. **HTTP Request** — Send report via Discord webhook

### Price Alert Pipeline

```
┌──────────────┐    ┌──────────────────┐    ┌──────────────┐
│  Webhook     │───▶│ Process Alert    │───▶│ Notify       │
│  Trigger     │    │ via MCP tool     │    │ (multi-ch)   │
└──────────────┘    └──────────────────┘    └──────────────┘
```

### News Sentiment Feed

```
┌──────────────┐    ┌──────────────────┐    ┌──────────────┐
│  Cron Trigger │───▶│ web.news_search  │───▶│ Filter +     │
│  (hourly)    │    │ via MCP          │    │ Aggregate    │
└──────────────┘    └──────────────────┘    └──────────────┘
```

### Notion ↔ Obsidian Sync (Import Workflow Template)

See the full workflow template at `docs/integration/n8n-notion-obsidian-template.json`.
Import it via n8n: **Settings → Workflows → Import from File**.

#### Flow A: Notion DB → Obsidian Vault

```
┌──────────────┐    ┌───────────────┐    ┌──────────┐    ┌─────────────┐    ┌───────────┐
│ Cron Trigger │───▶│ Watch Notion  │───▶│ Filter   │───▶│ Format → MD │───▶│ Write to  │
│ (daily 7AM)  │    │ Database      │    │ new items│    │ + Frontmatter│   │ Vault     │
└──────────────┘    └───────────────┘    └──────────┘    └─────────────┘    └───────────┘
                                                                                   │
                                                                                   ▼
                                                                              ┌───────────┐
                                                                              │ Discord   │
                                                                              │ notify    │
                                                                              └───────────┘
```

**Config:**
- `notionDatabaseId` → your Notion database ID
- Vault path → `/home/dicky/ObsidianVault/`
- Files written to: `ObsidianVault/Notion/{page-title}.md`
- Frontmatter: `title`, `date`, `source: notion`, `notion_url`, `notion_id`

#### Flow B: Obsidian Vault → Notion DB

```
┌──────────────┐    ┌───────────────┐    ┌──────────┐    ┌─────────────┐
│ Webhook:     │───▶│ Read Obsidian │───▶│ Extract  │───▶│ Create      │
│ /obsidian-   │    │ Note (.md)    │    │ Frontmatter│  │ Notion Page │
│ update       │    │               │    │ + Content │    │             │
└──────────────┘    └───────────────┘    └──────────┘    └─────────────┘
```

**Obsidian Hermes Plugin webhook URL:**
```
POST http://localhost:5678/webhook/obsidian-update
Body: { "filePath": "path/to/note.md" }
```

#### Flow C: Daily Report → Obsidian + Discord

```
┌──────────────┐    ┌───────────────┐    ┌──────────────┐    ┌──────────┐
│ Cron Mon-Fri │───▶│ GET MCP       │───▶│ Write to     │───▶│ Discord  │
│ 8:00 AM      │    │ /tool/report  │    │ ObsidianVault│    │ send     │
└──────────────┘    └───────────────┘    └──────────────┘    └──────────┘
```

### RAG Auto-Ingest

```
┌──────────────┐    ┌──────────────────┐    ┌──────────────┐
│  RSS/Webhook │───▶│ web.fetch_page   │───▶│ rag.ingest   │
│  Feed        │    │ via MCP          │    │ via MCP      │
└──────────────┘    └──────────────────┘    └──────────────┘
```

## MCP Tool Calls from n8n

Use the HTTP Request node to call MCP tools:

### Web Search
```
POST http://localhost:4567/mcp/tool/web.search
Body: {"query": "market conditions", "max_results": 10}
```

### News Search
```
POST http://localhost:4567/mcp/tool/web.news_search
Body: {"query": "stock market today", "time_range": "day"}
```

### RAG Search
```
POST http://localhost:4567/mcp/tool/rag.search
Body: {"query": "interest rate impact", "limit": 5}
```

### Market Assets
```
POST http://localhost:4567/mcp/tool/market.assets
Body: {}
```

### Generate RAG Report
```
POST http://localhost:4567/mcp/tool/rag.report
Body: {"topic": "weekly market review", "max_evidence": 15}
```

## Webhook Triggers

Market Orca can trigger n8n workflows via webhooks:

### Alert Triggered Webhook
```
POST http://localhost:5678/webhook/alert-triggered
Body: {
  "asset": "BTC-USD",
  "condition": "above",
  "threshold": 50000,
  "current_price": 51200
}
```

### Report Generated Webhook
```
POST http://localhost:5678/webhook/report-generated
Body: {
  "report_id": "abc123",
  "format": "html",
  "sections": ["market_overview", "incidents"]
}
```

## Environment Variables

Configure in n8n settings or `.env`:

```env
# Market Orca
MARKET_ORCA_URL=http://localhost:4567
MARKET_ORCA_MCP_TOKEN=your-token

# Notion OAuth (for n8n credential)
NOTION_CLIENT_ID=your-oauth-client-id
NOTION_CLIENT_SECRET=your-oauth-client-secret
NOTION_REDIRECT_URI=http://localhost:5678/rest/oauth2-credential/callback

# Obsidian
OBSIDIAN_VAULT_PATH=/home/dicky/ObsidianVault

# n8n
N8N_PORT=5678
N8N_WEBHOOK_URL=http://localhost:5678/webhook
```

## Tips

- Use n8n's **Error Trigger** node to handle API failures gracefully
- Add **retry logic** with exponential backoff for rate-limited endpoints
- Use n8n's **Set** node to transform data between API calls
- Store persistent config in n8n's environment variables
- Use the `/mcp/selftest` endpoint for health monitoring workflows
