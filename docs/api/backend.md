# Backend API

The Market Orca backend runs on **port 4567** and provides RESTful endpoints for market data, alerts, reports, and system management.

::: tip Base URL
All endpoints are relative to `http://localhost:4567`
:::

## Authentication

Most endpoints require a session cookie (`mo_session`).

### Login

```http
POST /api/login
Content-Type: application/json

{
  "email": "admin@example.test",
  "password": "admin12345"
}
```

**Response:** Sets `mo_session` cookie and returns user info.

### Logout

```http
POST /api/logout
```

### Check Session

```http
GET /api/me
```

## Market Data

### Get All Assets

```http
GET /api/assets
```

Returns all tracked assets with current prices and metadata.

### Get Single Asset

```http
GET /api/assets/:id
```

Detailed view — price history, news, candles, settings.

### Search Assets

```http
GET /api/search?q={query}
```

Search Yahoo Finance symbols by name or ticker.

### Live Prices

```
GET /api/live-prices
```

Current snapshot of all tracked asset prices.

### Price History

```
GET /api/assets/:id/candles?interval={interval}&range={range}
```

**Parameters:**
- `interval`: `1m`, `5m`, `15m`, `30m`, `1h`, `4h`, `1d`
- `range`: `1d`, `5d`, `1mo`, `3mo`, `1y`

## Alerts

### List Alerts

```http
GET /api/alerts
```

### Create Alert

```http
POST /api/alerts
Content-Type: application/json

{
  "asset_id": "BTC-USD",
  "condition": "above",
  "threshold": 50000,
  "notes": "BTC broke 50k"
}
```

`condition`: `above | below | change_percent`

### Delete Alert

```http
DELETE /api/alerts/:id
```

### Suggested Alerts

```http
GET /api/suggested-alerts
```

AI-generated alert suggestions based on market conditions.

## Watchlists

### List Watchlists

```http
GET /api/watchlists
```

### Create/Update Watchlist

```http
POST /api/watchlists
Content-Type: application/json

{
  "name": "Crypto Watch",
  "assets": ["BTC-USD", "ETH-USD", "SOL-USD"]
}
```

## Reports

### Generate Daily Report

```http
POST /api/generate-report
Content-Type: application/json

{
  "sections": ["market_overview", "incidents", "economic_indicators"],
  "format": "text"
}
```

**Parameters:**
- `sections`: Array of sections to include
- `format`: `text | html | discord | json`

### Get Report History

```http
GET /api/reports?limit=10&offset=0
```

### Get Single Report

```http
GET /api/reports/:id
```

### Delete Report

```http
DELETE /api/reports/:id
```

## RAG

### Search RAG Store

```http
POST /api/rag/search
Content-Type: application/json

{
  "query": "interest rates impact on tech stocks",
  "limit": 10
}
```

### Ingest Content

```http
POST /api/rag/ingest
Content-Type: application/json

{
  "content": "Article text content...",
  "source_url": "https://example.com/article",
  "title": "Article Title",
  "tags": ["economics", "stocks"]
}
```

### Crawl URL

```http
POST /api/rag/crawl
Content-Type: application/json

{
  "url": "https://example.com/article"
}
```

## Incidents

### List Incidents

```http
GET /api/incidents
```

### Create Incident

```http
POST /api/incidents
Content-Type: application/json

{
  "title": "Fed Rate Decision",
  "severity": "high",
  "description": "FOMC announces rate decision...",
  "affected_assets": ["SPY", "QQQ"]
}
```

Severity levels: `low | medium | high | critical`

## Discord

### Get Settings

```http
GET /api/discord/settings
```

### Update Settings

```http
POST /api/discord/settings
Content-Type: application/json

{
  "webhook_url": "https://discord.com/api/webhooks/...",
  "token": "...",
  "channel_id": "..."
}
```

### DM Subscribers

```http
GET /api/discord/dm-subscribers
```

## System

### Health Check

```http
GET /health
```

Returns server status, uptime, and database connectivity.

### Config

```http
GET /api/config
```

Current server configuration (safe values only — no secrets).
