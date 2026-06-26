# Market Orca — Feature Log

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
