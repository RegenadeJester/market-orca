# Market Orca — Feature Log

## 2026-07-03 — Feature #26: Silent Error Swallowing Fixes Batch 2 (report-server.js + server.js)
- **Pain point:** 13 silent `catch {}` blocks in `report-server.js` (8) and `server.js` (5) swallowed DB failures, fetch errors, LLM rewrite failures, fts5 health checks, and asset fetch errors in critical request paths without logging.
- **Done:**
  1. `report-server.js`: 8 catches now log `[report-server] <context>: <msg>` — searchNews, asset fetch, filter parse, live assets, ragHybridSearch, LLM rewrite, fts5 health, APM dashboard import
  2. `server.js`: 5 catches now log `[server] <context>: <msg>` — today report read, filter parse, fts5 health, ragHybridSearch, LLM rewrite
- **Files:** `backend/src/report-server.js`, `backend/src/server.js`
- **Deliverable:** Errors in request-path handlers no longer vanish; visible in logs for debugging. Continuation of Feature #21 pattern.
- **Branch:** `feat/silent-catch-fixes-batch2` → PR #14

## 2026-07-02 — Feature #25: Pipeline Monitor Frontend Page + Nav
- **Pain point:** PipelineMonitorPage.vue existed, route `/pipeline` registered, but no nav link → page inaccessible without typing URL. API_BASE used port-qualified URLs incompatible with Cloudflare tunnel.
- **Done:**
  1. App.vue: added `<RouterLink to="/pipeline">Pipeline</RouterLink>` in topbar nav
  2. api.js: relative URLs (empty-string fallback) instead of hardcoded port
  3. PipelineMonitorPage.vue: stats cards, latest run timeline, recent events list
  4. ReportPage.vue: styling improvements (.display-headline, .byline)
  5. AlertSummaryWidget.vue: new component
- **Repo:** Frontend (`report.git`)
- **Branch:** `feat/homepage-today-report-card` → PR #1 (updated)
- **PR:** https://github.com/RegenadeJester/report/pull/1

## 2026-06-29 — Feature #24: Pipeline Monitor API Routes
- **Pain point:** `pipeline-monitor.js` module fully built (188 lines, 10 functions) but zero routes exposed pipeline data. All pipeline stats, runs, and events locked inside SQLite.
- **Done:**
  1. `GET /api/pipeline/stats` — aggregated stats (success rate, averages, last run)
  2. `GET /api/pipeline/latest` — latest run with full event timeline
  3. `GET /api/pipeline/recent` — recent events (`?limit=N`, default 20)
  4. `GET /api/pipeline/run/:id` — run details by ID
  5. `GET /api/pipeline/run/:id/stages` — stage breakdown for a run
- **Files:** `backend/src/server.js` (5 new GET routes, +29 lines)
- **Deliverable:** Pipeline data now queryable from frontend, MCP, Discord. Ops dashboard can display pipeline health.
- **Branch:** `feat/pipeline-api-routes` → PR #13

## 2026-06-28 — Feature #23: APM Status Dashboard Endpoint
- **Pain point:** No visibility into APM pipeline health — ops had no way to see features shipped, pain point trends, or pipeline status.
- **Done:**
  1. New **`GET /api/apm/status`** endpoint on report-server returning pipeline metrics, feature stats, pain point counts.
  2. **`scripts/apm/apm-dashboard.cjs`** — MMd.md parser with feature analytics (shipped count, daily average, files touched).
  3. Response includes: `featuresShipped`, `dailyAverage`, `branchesCreated`, `prsMerged`, `painPoints` (total/P1/P2).
- **Files:** `backend/src/report-server.js`, `backend/scripts/apm/apm-dashboard.cjs`
- **Deliverable:** Ops dashboard now shows live APM pipeline status.
- **Branch:** `feat/apm-status-endpoint` → PR #23 ✅ merged

## 2026-06-28 — Feature #22: APM PM Agent Pain Point Scanner (Noise Reduction)
- **Pain point:** PM scanner (`apm-pm.cjs`) reported 340+ pain points with many false positives (Vue template `.then()`, duplicate silent catches), making daily briefs unactionable.
- **Done:**
  1. Added **deduplication** within 5-line windows — same file+type grouped.
  2. **Vue template filter** — `.then()` detector skips lines with `v-if`, `@click`, `v-for`, `:class`, `:style`.
  3. **Silent catch context check** — skips `catch {}` if `console.error` in same block.
  4. Results: P1 issues dropped from 313 → 251 (62 fewer false alarms).
- **Files:** `backend/scripts/apm/apm-pm.cjs`
- **Deliverable:** Daily brief now surfaces real pain points, not template noise.
- **Branch:** `feat/apm-pm-scanner-fix` → PR #22 ✅ merged

## 2026-06-28 — Feature #21: Silent Error Swallowing Fixes (5 modules)
- **Pain point:** 5+ silent `catch {}` blocks in `ai-daily-report.js`, `config.js`, `alert-engine.js`, `discord-dm.js` lost DB failures, config load errors, Discord send failures without logging.
- **Done:**
  1. `ai-daily-report.js`: 5 DB query catches now log `[ai-report] DB query failed: <msg>`
  2. `config.js`: 3 config loads now log `[config] load failed: <msg>`
  3. `alert-engine.js`: alert scan failure logs `[alert-engine] scan failed: <msg>`
  4. `discord-dm.js`: DM send failure logs `[discord-dm] send failed: <msg>`
  4. `logDelivery()` in `ai-daily-report.js`: both catches now surface errors
- **Files:** `backend/src/ai-daily-report.js`, `backend/src/config.js`, `backend/src/alert-engine.js`, `backend/src/discord-dm.js`
- **Deliverable:** Errors no longer vanish; visible in logs for debugging.
- **Branch:** `feat/silent-catch-fixes` → PR #21 ✅ merged

# Market Orca — Feature Log

## 2026-06-28 — Feature #20: Alert Dashboard Summary Endpoint
- **Pain point:** `AlertSummaryWidget.vue` (frontend) calls `/api/market/alerts-summary` but backend had no such endpoint → widget always loaded empty/404.
- **Done:**
  1. New **`GET /api/market/alerts-summary`** endpoint returning aggregated alert dashboard data.
  2. **`summary`** object: `critical`, `warning`, `triggered`, `suggested` counts.
  3. **`threshold_alerts`**: all assets with breach detection (up/down/none) + severity (critical/warning) based on asset_settings thresholds.
  4. **`triggered`**: 10 latest fired alerts from `alerts` table.
  5. **`suggested`**: pending `suggested_alerts` from reports with computed `distance_pct`.
- **Files:** `backend/src/server.js`
- **Deliverable:** Frontend AlertSummaryWidget now renders with live data. 16 critical breaches, 4 warning, 10 triggered alerts detected.
- **Branch:** `feat/alerts-summary-endpoint` → PR #12 ✅ merged
- **Pain point:** Report quality was only checked via manual `qa-report.js` CLI. No RAG-driven quality scoring, no template learning, no automated QA in the pipeline.
- **Done:**
  1. **RAG collection `report-template`** in `rag-autolearn.js` — auto-ingests reports ≥80 quality as templates. Stores structure, section count, item count, snippet lengths, quality metadata. Searchable via FTS.
  2. **`qaReport(slug)`** — 7-check QA pipeline: empty sections, snippet length (<50 chars), broken citations (no URL), duplicate titles, source diversity (<4), item count (<10), template comparison against best reports.
  3. **`/api/rag/qa-report/:slug`** endpoint — returns score, status, per-check breakdown, issues list, template comparison.
  4. **`/api/rag/qa-report` (POST)** — same, with body `{slug}`.
  5. **`/api/rag/template/ingest`** — ingest single or all best reports.
  6. **`/api/rag/template/search`** — search templates by topic/structure.
  7. **Pipeline integration** — `generateAndSendDailyReport()` now auto-runs QA after save, sends summary to Discord, and ingests high-quality reports as templates.
- **Files:** `backend/src/rag-autolearn.js`, `backend/src/server.js`
- **Deliverable:** QA endpoint returns quality score + issues. Pipeline auto-QA on every generate. Template collection with 3 reports (avg 100 quality).
- **Issues Fixed:**
  1. **No systemd service** — Report server (port 4568) crashed on restart. Added `deploy/report-server.service` with auto-restart, memory limit (512M), and structured logging.
  2. **Inconsistent styling** — Added QA gate (`backend/src/qa-report.js`) checking empty sections, broken links, hallucinated citations, source attribution, and report freshness. Runs automatically in `generateAndSendDailyReport()` before publish.
  3. **No quality gate** — Pre-publish QA validates: section item counts, URL coverage, fake citation patterns, required fields, link health (concurrent HEAD checks). Outputs pass/fail + warnings.
  4. **Discord delivery unreliable** — Bot now initializes in report-server (was only in main server). Added webhook fallback (`sendViaWebhook`) when bot unavailable. Both paths log delivery status to `delivery_log` table.
- **Files:** `deploy/report-server.service`, `deploy/install-systemd.sh`, `backend/src/qa-report.js`, `backend/src/report-server.js`, `backend/src/ai-daily-report.js`
- **Deliverable:** Report server survives restart, QA pipeline runs on every generation, Discord delivery works via bot or webhook.

## 2026-06-27 — Feature #15: Today's Report Card on HomePage
- **Branch:** `feat/homepage-today-report-card` → PR #1 (frontend repo)
- **Pain point:** Backend returns `todayReport` in `/api/overview` but frontend ignores it. Users can't see if today's report is ready without navigating to `/report` page.
- **Fix:** HomePage now displays a prominent banner showing today's report status — title, topic count, generation time, incident badge — with direct link to report. Shows "generate via Report Editor" CTA when no report exists.
- **Files:** `frontend/src/pages/HomePage.vue`

## 2026-06-27 — Feature #14: Today's Report on Overview
- **Branch:** `feat/overview-today-report` → PR #11
- **Pain point:** HomePage fetches `/api/overview` for assets/news but needs separate `/api/reports` call to check if today's daily report is ready.
- **Fix:** `/api/overview` now returns `todayReport` field with `slug`, `generatedAt`, `title`, `topicCount`, `hasIncidents`, `incidentCount` — or `null` if no report today. Uses WIB timezone (Asia/Jakarta).
- **Files:** `server.js`

## 2026-06-26 — Feature #13: Staggered Asset Fetcher
- **Branch:** `feat/staggered-fetcher` → merged to main
- **Pain point:** `getLiveAssets()` fires `Promise.allSettled` on 20+ assets simultaneously → Yahoo Finance 429 rate limits, home internet overload, TIME_WAIT socket exhaustion on laptop server.
- **Fix:** Split into batches of `MAX_CONCURRENCY=3` with `STAGGER_DELAY=150ms` between batches. Configurable via `LIVE_DATA_CONCURRENCY` and `LIVE_DATA_STAGGER_MS` env vars. Adds timing log showing elapsed time and concurrency. Protects laptop-server RAM/network with graceful fallback.
- **Files:** `live-data.js`

## 2026-06-26 — Feature #12: Discord DM Delivery Tracker
- **Branch:** `feat/discord-dm-tracker` → merged to main
- **Pain point:** `discord.js` silently catches DM errors (`.catch(() => {})`). `sendAiReportToUserDm` was a dead-end — logs error, never actually sends. No delivery status tracking.
- **Fix:** `discord-dm.js` rewritten with `sendDmWithRetry()` (2x retry + delivery_log), `sendDmToAllSubscribers()`, delivery status/cleanup endpoints. `sendAiReportToUserDm` now actually delivers to DM subscribers. `/api/dm-delivery/status` and `/api/dm-delivery/cleanup` added to report-server.
- **Files:** `discord-dm.js`, `discord.js`, `ai-daily-report.js`, `report-server.js`

## 2026-06-26 — Feature #11: Canonical Data Normalizer
- **Branch:** `feat/data-normalizer` → merged to main
- **Pain point:** `market-data.js` returns `changePercent` (camelCase), `live-data.js` returns `change_percent` (snake_case). Discord embeds use fragile `?? ` fallback that silently loses values.
- **Fix:** `normalizer.js` with `normalizeAsset()`, `normalizeIndex()`, `pct()` helpers. Wired into all three data producers. All discord-embeds `?? ` fallbacks replaced with canonical `pct()` call.
- **Files:** `normalizer.js`, `market-data.js`, `live-data.js`, `discord-embeds.js`

---

# Skill Hunt Report — 2026-06-26

## Summary
- **New packages installed globally:** 10
- **New packages discovered (not yet installed):** 6
- **Failed to install:** 1
- **Already installed from prior hunts:** 22
- **Total global MCP/trading packages:** 90+

---

## 🔥 NEWLY INSTALLED (10 packages)

### Trading / Finance MCP Servers
1. **kalshi-trading-bot-cli** v2.1.10 — AI-powered prediction market terminal (Kalshi). Uses LangChain with OpenAI/Anthropic/Ollama. TUI interface. *(14h old — brand new!)*
   - `npm: kalshi-trading-bot-cli` | Bin: `kalshi`, `kalshi-trading-bot-cli`
   
2. **@bitcompare/mcp-server** v1.1.0 — Crypto yield data, prices, coin metadata, stablecoin data, market stats. Zero-API-key friendly.
   - `npm: @bitcompare/mcp-server` | Bin: `bitcompare-mcp`
   
3. **@agent_fi/mcp-server** v0.5.0 — Crypto transaction tools for AI agents. DeFi integrations (Uniswap, Aave, Compound, Curve, ERC4626).
   - `npm: @agent_fi/mcp-server` | Bin: `agentfi-mcp`

4. **@hyperflow.fun/ghost** v0.0.12 — AI trading companion for Hyperliquid perpetuals. DeFi + LLM powered.
   - `npm: @hyperflow.fun/ghost`

5. **yahoo-finance-mcp-server** v1.2.2 — Yahoo Finance MCP. Real-time stock data, company info, financial statements.
   - `npm: yahoo-finance-mcp-server`

6. **@pullapi/yahoo-finance-scraper-mcp** v1.0.0 — Yahoo Finance scraper MCP. Stock quotes, historical data, financials, earnings, options & news.
   - `npm: @pullapi/yahoo-finance-scraper-mcp`

### Discord MCP Servers
7. **mcp-server-discord** v1.2.8 — Discord MCP server. Channel mgmt, messaging, member operations.
   - `npm: mcp-server-discord` | Bin: `mcp-server-discord`

8. **@pasympa/discord-mcp** v2.0.0 — Lightweight, multi-guild Discord MCP server with **95+ tools**. Claude/Cursor/Windsurf compatible.
   - `npm: @pasympa/discord-mcp`

9. **discord-ops** v0.23.3 — Agency-grade Discord MCP server with multi-guild project routing and notifications.
   - `npm: discord-ops`

### AI Agent Framework
10. **beeai-framework** v0.1.29 — BeeAI Framework — LLM Agent Framework. Production-grade agent orchestration.
    - `npm: beeai-framework`

---

## 📋 DISCOVERED BUT NOT YET INSTALLED

1. **@jellyos/agent** v0.3.0 — Standalone AI trading agent. Runs locally, no server required. *(FAILED install — post-install script bug with Node.js v22)*
   - `npm: @jellyos/agent` | Bin: `jellyos`, `jellyagent`, `jellyos-mcp`

2. **octagon-sec-filings-mcp** v1.0.0 — SEC Filings Analysis MCP. 8,000+ companies, SEC EDGAR, data since 2018.
   - `npm: octagon-sec-filings-mcp`

3. **@investoday/investoday-api** v1.9.1 — China market financial data CLI. A-share, HK stock, fund, macro-economics. *(Updated TODAY!)*
   - `npm: @investoday/investoday-api`

4. **@ui5/mcp-server** v0.2.14 — SAP UI5 MCP for enterprise dev. *(Updated TODAY!)*
   - `npm: @ui5/mcp-server`

5. **eodhd** v1.0.1 — Official EODHD Financial Data API library. Stocks, ETF, forex, crypto, fundamentals, options.
   - `npm: eodhd`

6. **@mastra/core** v1.46.0 — *(Already installed)* + **@mastra/mcp** v1.12.0 — Mastra AI agent framework with MCP integration.

---

## 📊 ALREADY INSTALLED (from prior hunts)

### Trading / Finance MCP
- stock-scanner-mcp v1.17.0 ✓
- stock-sdk v2.1.0 ✓
- @coinrithm/mcp-trading v0.4.0 ✓
- @cryptoapis-io/mcp-market-data v0.3.0 ✓
- @flyneko/mcp-market v0.1.31 ✓
- @jasonruan/mcp-crypto-tools v0.0.12 ✓
- @vorionsys/aurais-mcp-market-scout v0.5.0 ✓
- @pipeworx/mcp-alphavantage v0.1.0 ✓
- @pipeworx/mcp-coinmarketcap v0.1.0 ✓
- @pipeworx/mcp-defillama v0.1.0 ✓
- @pipeworx/mcp-market-spread v0.1.0 ✓
- mcp-crypto-price v3.5.12 ✓
- mcp-stock-chart v1.0.3 ✓
- trading-signals v7.4.3 ✓
- finoptima v1.3.3 ✓
- backtest-kit ✓
- interactive-brokers-mcp v1.23.4 ✓
- bybit-official-trading-server v2.1.13 ✓

### Discord / Messaging MCP
- @goul4rt/mcp-discord v0.3.0 ✓

### Other
- chrome-devtools-mcp v1.4.0 ✓
- indodax-cli v0.2.1 ✓
- @apify/actors-mcp-server v0.11.4 ✓
- mcp-proxy v6.5.2 ✓

---

## 🔥 TOP 5 PICKS FOR MARKET ORCA

1. **stock-scanner-mcp** (already installed) — The Swiss Army knife: stocks, crypto, SEC filings, insider trades, technical analysis, sentiment, options chain. Best all-in-one.
2. **kalshi-trading-bot-cli** (NEW) — AI prediction market terminal. New revenue stream opportunity.
3. **@bitcompare/mcp-server** (NEW) — Crypto yield data. DeFi staking/lending yields for portfolio analysis.
4. **@pasympa/discord-mcp** (NEW) — 95+ Discord tools. Massive upgrade over the current @goul4rt/mcp-discord.
5. **@pullapi/yahoo-finance-scraper-mcp** (NEW) — Broader Yahoo Finance coverage: options chain, earnings, news.

## 🔥 TOP 5 PICKS FOR OPENCLAW PLATFORM

1. **beeai-framework** (NEW) — Production agent framework. Could enhance agent orchestration.
2. **discord-ops** (NEW) — Agency-grade Discord MCP with multi-guild routing. Better than basic Discord bots.
3. **@agent_fi/mcp-server** (NEW) — DeFi transaction tools. If we ever need on-chain actions.
4. **octagon-sec-filings-mcp** (NOT INSTALLED) — SEC filings analysis would be killer for Market Orca reports.
5. **@investoday/investoday-api** (NOT INSTALLED) — China market data, relevant for Asian markets coverage.

## Search Coverage
npm keywords searched: mcp-server, ai-agent, trading-bot, discord-bot, crypto-trading, financial-data, sec-filings, technical-analysis, agent framework, discord-mcp, openai agent, market, stock, data, news, sentiment, alpha, vantage, finnhub, polygon, social

GitHub repos searched via gh search + trending index
