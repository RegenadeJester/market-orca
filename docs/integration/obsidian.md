# Obsidian Integration

Connect Market Orca to [Obsidian](https://obsidian.md) for persistent notebooks, AI research logs, and embeddable market reports.

## Template System

Add a Market Orca template to your **Templater** or **QuickAdd** setup:

```
---
created: {{date}}
type: market-report
source: market-orca
region: {{region}}
tags: [market-orca, {{region}}]
---

# Daily Market Report — {{date:YYYY-MM-DD}}

## Overview
![[market-snapshot.md]]

## Assets Tracked
![[watchlist.md]]

## Alerts Active
![[active-alerts.md]]

## Report
{{report_content}}
```

## Local RAG Sync

Sync Market Orca's RAG corpus to local Obsidian vault:

```bash
# Export RAG documents as Markdown files
curl http://localhost:4567/api/rag/export/vault > vault-dump.json

# Or use the MCP tool via a script
curl -X POST http://localhost:4567/mcp/tool/rag.search \
  -H "Content-Type: application/json" \
  -d '{"query": "*", "limit": 500}'
```

## Dataview Queries

Track assets with Obsidian's Dataview plugin:

```dataview
TABLE region, price, change_24h
FROM "market-orca"
WHERE type = "asset"
SORT change_24h DESC
```

## Discord-like Embeds in Obsidian

If you use the Obsidian Discord Rich Embed plugin or a custom CSS snippet, Market Orca report embeds render natively.

## Workflow

1. **Fetch** — Use an n8n workflow or shell script to pull daily reports
2. **Convert** — Transform JSON/HTML reports to clean Markdown
3. **Template** — Apply Obsidian templates with frontmatter tags
4. **Save** — File into organized vault folders by date/topic

## n8n Webhook Integration

The Obsidian Hermes plugin can trigger n8n workflows via webhook:

1. In n8n, create a **Webhook** node with path `/obsidian-update`
2. Configure the Hermes plugin to POST to:
   ```
   http://localhost:5678/webhook/obsidian-update
   ```
3. Payload format:
   ```json
   {
     "filePath": "Market-Orca/Daily-2025-01-01.md",
     "action": "created" | "modified" | "deleted"
   }
   ```
4. n8n workflow reads the vault file, processes it, and can sync to Notion

### Example: Obsidian → n8n → Notion

```json
// n8n webhook receives:
{
  "filePath": "market-orca/daily-2025-01-01.md",
  "action": "created"
}

// n8n reads file → extracts frontmatter → creates Notion page
```

### Example: n8n → Obsidian (write report)

Use n8n's **Write Binary File** node:
```json
{
  "fileName": "/home/dicky/ObsidianVault/Market-Orca/Reports/Daily-2025-01-01.md",
  "dataPropertyName": "reportContent"
}
```

Workflow template available at `docs/integration/n8n-notion-obsidian-template.json`.

## Obsidian Hermes Plugin

The Hermes plugin in Obsidian can access n8n webhooks for automation:

1. Install **Hermes Agent** Obsidian plugin
2. Configure plugin settings:
   ```yaml
   n8n_webhook_url: http://localhost:5678/webhook/obsidian-update
   notion_oauth_enabled: true
   vault_path: /home/dicky/ObsidianVault
   ```
3. Use Hermes commands:
   - `Sync current note to Notion`
   - `Pull latest from Notion`
   - `Run daily market report → save here`

## Dataview Queries

## Obsidian URI Links

```markdown
[Open Market Orca](obsidian://open?vault=anomali&file=market-orca/daily-2025-01-01)
```

## Notes

- All Market Orca reports can be exported as Markdown (`format: text`)
- Use the RAG export for persistent local knowledge base
- Compatible with any Markdown-first note-taking app
