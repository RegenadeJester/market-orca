# Notion Integration

Sync Market Orca market reports, watchlists, and alerts directly into your [Notion](https://notion.so) workspace.

## Overview

Market Orca → Notion sync can be done via:
1. **n8n workflows** (recommended) — no code, visual setup
2. **Direct API** — programmatic integration via Notion API + n8n or custom scripts
3. **Manual export** — copy reports from Notion or Markdown export

## Setup

> ⚠️ **Notion uses OAuth 2.0** — Internal Integration Tokens are no longer available for new integrations.
> See the full [Notion OAuth Setup Guide](./notion-oauth-guide.md).

### 1. Create Notion OAuth App

1. Go to [https://www.notion.so/profile/integrations](https://www.notion.so/profile/integrations)
2. Click **+ New integration**
3. Name it `Market Orca`
4. Select your workspace
5. Enable capabilities: `Read content`, `Insert content`, `Update content`
6. Set **OAuth Redirect URI**: `http://localhost:5678/rest/oauth2-credential/callback`
7. Copy the **Client ID** and **Client Secret**

### 2. OAuth Authorization URL

```
https://api.notion.com/v1/oauth/authorize?client_id={CLIENT_ID}&response_type=code&owner=user&redirect_uri=http%3A%2F%2Flocalhost%3A5678%2Frest%2Foauth2-credential%2Fcallback
```

### 3. Configure in n8n

1. In n8n → **Settings → Credentials → + Add Credential**
2. Search **Notion** → select **Notion OAuth2 API**
3. Paste **Client ID** and **Client Secret**
4. Click **Connect Account** → authorize in Notion popup
5. Credential is ready

### 4. Share Database with Integration

In Notion, share your target database/page with the `Market Orca` integration (Share button → Add integration).

### 3. Create Target Database

Set up a Notion database with these columns:

| Column | Type | Description |
|--------|------|-------------|
| Name | Title | Report title or alert name |
| Date | Date | Creation date |
| Type | Select | `report | alert | news | incident` |
| Severity | Select | `low | medium | high | critical` |
| Content | Text | Report content or alert notes |
| Source | URL | Link back to Market Orca |
| Tags | Multi-select | Topic tags |
| Assets | Text | Affected asset symbols |

## n8n + Notion Workflow

### Auto-sync Reports to Notion

```
┌──────────────┐    ┌──────────────────┐    ┌──────────────┐
│ Cron Trigger │───▶│ Fetch Reports    │───▶│ Create Page  │
│ (daily)      │    │ from API         │    │ in Notion    │
└──────────────┘    └──────────────────┘    └──────────────┘
```

**n8n Steps:**
1. **Schedule Trigger** — Daily at 8:00 AM WIB
2. **HTTP Request** — `GET http://localhost:4567/api/reports?limit=1`
3. **Notion Node** — Create page in target database

**Notion Node Config:**
```
Operation: Create Page
Database ID: your-database-id
Title: {{ $json.title }}
Properties:
  Date: {{ $json.created_at }}
  Type: report
  Content: {{ $json.content }}
  Tags: market-overview
  Assets: {{ $json.assets }}
```

### Alert Sync

```
Webhook → n8n → Create Notion Page
```

```json
{
  "title": "Alert: BTC above $50k",
  "Type": "alert",
  "Severity": "high",
  "Content": "BTC-USD reached $51,200 at 14:30 WIB"
}
```

### Weekly Digest

```
┌──────────────┐    ┌──────────────────┐    ┌──────────────┐
│ Cron Trigger │───▶│ Generate weekly  │───▶│ Create       │
│ (Monday 9am) │    │ summary via MCP  │    │ Notion page  │
└──────────────┘    └──────────────────┘    └──────────────┘
```

## Direct API Integration

### Create Page via Notion API

```bash
curl -X POST https://api.notion.com/v1/pages \
  -H "Authorization: Bearer YOUR_NOTION_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Notion-Version: 2022-06-28" \
  -d '{
    "parent": { "database_id": "YOUR_DB_ID" },
    "properties": {
      "Name": { "title": [{"text": {"content": "Market Report 2025-01-01"}}] },
      "Date": { "date": {"start": "2025-01-01"} },
      "Type": { "select": {"name": "report"} }
    },
    "children": [
      {
        "object": "block",
        "type": "paragraph",
        "paragraph": {
          "rich_text": [{"text": {"content": "Report content here..."}}]
        }
      }
    ]
  }'
```

### Update Existing Page

```bash
curl -X PATCH https://api.notion.com/v1/pages/PAGE_ID \
  -H "Authorization: Bearer YOUR_NOTION_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Notion-Version: 2022-06-28" \
  -d '{
    "properties": {
      "Tags": { "multi_select": [{"name": "updated"}, {"name": "mcp-report"}] }
    }
  }'
```

## Markdown to Notion Blocks

Market Orca reports (Markdown format) can be converted to Notion blocks:

```javascript
// Pseudocode — convert MD headers to Notion blocks
const blocks = markdown.split('\n').map(line => {
  if (line.startsWith('# '))
    return { type: 'heading_1', heading_1: { rich_text: [{text: {content: line.slice(2)}}] } }
  if (line.startsWith('## '))
    return { type: 'heading_2', heading_2: { rich_text: [{text: {content: line.slice(3)}}] } }
  return { type: 'paragraph', paragraph: { rich_text: [{text: {content: line}}] } }
})
```

## Environment Variables

### OAuth Flow (n8n handles token exchange)
```env
NOTION_CLIENT_ID=your-oauth-client-id
NOTION_CLIENT_SECRET=your-oauth-client-secret
NOTION_REDIRECT_URI=http://localhost:5678/rest/oauth2-credential/callback
NOTION_API_VERSION=2022-06-28
```

### Direct API (for non-n8n scripts)
```env
NOTION_API_KEY=ntn_YOUR_ACCESS_TOKEN
NOTION_DATABASE_ID=your-database-id
NOTION_VERSION=2022-06-28
MARKET_ORCA_URL=http://localhost:4567
```

### MCP Notion Server (`.claude/mcp-notion.json`)
```json
{
  "notion": {
    "command": "npx",
    "args": ["-y", "@anthropic/mcp-notion"],
    "env": {
      "NOTION_API_KEY": "ntn_YOUR_ACCESS_TOKEN"
    }
  }
}
```

## Permissions

The Notion integration requires:
- `Read content` — Fetch existing pages
- `Insert content` — Create new pages
- `Update content` — Modify existing reports

## Tips

- Use Notion's **Relation** property to link reports to watchlist items
- Set up **Notion webhooks** (or use n8n polling) for real-time updates
- Create filtered views by severity, date range, or asset type
- Use the **Table view** for alert tracking, **Board view** for incident management
