# Agent Hunt Report — 2026-07-25 18:02 WIB

## Summary
- **Total candidates found**: 87
- **Already installed (skipped)**: 3 (market-orca backend)
- **Recommended for install**: 24
- **Worth monitoring**: 60

---

## Current Market Orca Stack (Skipped)
| Package | Version | Purpose |
|---------|---------|---------|
| @modelcontextprotocol/sdk | ^1.29.0 | MCP core SDK |
| discord.js | ^14.21.0 | Discord bot |
| better-sqlite3 | ^12.2.0 | Local DB |
| express | ^4.21.2 | API server |

---

## Recommended Installs (24)

### MCP Servers — Finance & Market Data (6)
| Package | Repo | Why |
|---------|------|-----|
| @coingecko/coingecko-mcp | coingecko/coingecko-typescript | Official CoinGecko MCP — prices, markets, coins |
| yahoo-finance-mcp-server | danishashko/yahoo-finance-mcp | Real-time stocks, financials, market analysis |
| @pipeworx/mcp-finance-feeds | pipeworx-io/mcp-finance-feeds | Multi-source finance feeds |
| @agentutility/mcp-edge-finance | rooz21/x402 | Pay-per-call finance tools, USDC on Base |
| @compute-finance/mcp | compute-finance/mcp | Live AI compute pricing oracle |
| @easysolutions906/mcp-finance | — | Currency conversion, exchange rates (Frankfurter) |

### MCP Servers — Web/News Intelligence (5)
| Package | Repo | Why |
|---------|------|-----|
| one-search-mcp | yokingma/one-search-mcp | Multi-engine: SearXNG, Tavily, DuckDuckGo, Bing |
| smart-web-mcp | jojo-labs/smart-web | Search, fetch, crawl, docs export |
| @ericthered926/duckduckgo-mcp-server | ericthered926/duckduckgo-mcp-server | DuckDuckGo web + news search |
| rss-reader-mcp | kwp-lab/rss-reader-mcp | RSS aggregation + content extraction |
| agentic-rss-parser | bluecarbons/agentic-rss-parser | LLM-enriched RSS, dedup, MCP tools |
| mcp-scraper | vilovieta/mcp-scraper | Web intelligence scraping |

### MCP Servers — DeFi / On-Chain (3)
| Package | Repo | Why |
|---------|------|-----|
| @arcadia-finance/mcp-server | arcadia-finance/mcp-server | Concentrated LP, rebalancing, yield farming (Base, Unichain, Optimism) |
| web3-research-mcp | aaronjmars/web3-research-mcp | Deep crypto research, local-first |
| @browserless.io/mcp | browserless/browserless-mcp | Browser automation for on-chain data |

### MCP Servers — Dev/Infra (3)
| Package | Repo | Why |
|---------|------|-----|
| mcp-proxy | punkpeye/mcp-proxy | SSE proxy for stdio MCP servers |
| @playwright/mcp | microsoft/playwright-mcp | Browser automation via Playwright |
| @upstash/context7-mcp | upstash/context7 | Code/docs lookup for dev workflows |

### Trading/Analysis Libraries (4)
| Package | Repo | Why |
|---------|------|-----|
| finance-market | thodinh.sg/finance-market | AI-friendly CLI: indicators, signals, backtest, CCXT |
| @backtest-kit/sidekick | tripolskypetr/backtest-kit | Scaffold trading bots with LLM integration |
| opentrader | bludnic/opentrader | Open-source crypto bot: grid, DCA, RSI strategies |
| dexbot | froooze/DEXBot2 | Zero-dep market making, adaptive strategy |

### Discord/Infra (3)
| Package | Repo | Why |
|---------|------|-----|
| @sapphire/framework | sapphiredev/framework | Modern TS Discord framework (upgrade from raw discord.js) |
| discordx | discordx-ts/discordx | Decorator-based Discord bot |
| opencode-discord-bot | ysm-dev/opencode-discord-bot | Bridge for self-hosted opencode |

---

## Worth Monitoring (60) — Not Installed

### MCP Servers (18)
- @notionhq/notion-mcp-server — Notion integration
- @apify/actors-mcp-server — Apify actors
- chrome-devtools-mcp — Chrome DevTools
- @sentry/mcp-server — Sentry error tracking
- @browserstack/mcp-server — BrowserStack testing
- @sap-ux/fiori-mcp-server — SAP Fiori
- @modelcontextprotocol/server-filesystem — Filesystem access
- @transcend-io/* (8 servers) — Consent, DSR, Discovery, Inventory, etc.
- next-finance-mcp — NEXT Finance (Brazil)
- @arcadia-finance/mcp-server — already listed above
- @agentutility/mcp-edge-finance — already listed above

### Trading Bots (14)
- @mathieuc/tradingview — TradingView API, alerts
- kalshi-trading-bot-cli — OctagonAI Kalshi prediction markets
- bot18 — Carlos8f HFT bot
- @sotatek/avabot-aa — Telegram trading bot AA
- opexbot — Trading bot
- incumque — Multi-exchange, backtest
- capital-trader — Capital.com automated
- @alzarak/trading-bot — Autonomous Alpaca day trading
- saksh-trading-bot — TradingView webhooks + OpenAI
- gekko — Classic bitcoin bot
- tradepilot — Fast signals, auto trades
- @uma/trader — UMA protocol
- @magic8bot/db — Crypto trading
- that-guy — Genetic algorithm bot

### Discord Frameworks (12)
- create-discord-bot / create-discord-app — Boilerplate
- @sapphire/framework — listed above
- discord-mel — Modular framework
- discord-bot-cdk-construct — AWS CDK serverless
- @biscotto/core + cli — Biscotto framework
- discordx — listed above
- eris-boiler — Eris-based
- @openpalm/discord-portal — OpenPalm adapter
- @magicyan/discord — Helper functions
- @eartharoid/dbf — Simple framework
- dokdo — Debug tool
- opencode-discord-bot — listed above

### News/Scraper (8)
- @bochilteam/scraper-news — News scraper module
- rss-parser — Lightweight RSS parser
- indonesian-news-scraper — Indonesian news sources
- nodejs-web-scraper — General web scraper
- google-news-decoder — Decode Google News URLs
- rss — RSS feed generator
- @astrojs/rss — Astro RSS
- smart-web-mcp — already listed above

### Finance/Crypto Libraries (8)
- @coingecko/coingecko-typescript — TS SDK
- yahoo-finance2 — Yahoo Finance JS API
- @kamino-finance/scope-sdk — Solana oracle
- @spritz-finance/api-client — Spritz Finance
- @mercurial-finance/* — Vault SDK, Dynamic AMM
- @voyant-travel/finance-contracts — Validation schemas
- finance-market — already listed above
- coingecko-api / coingecko-api-v3 — Alternative wrappers

---

## Install Commands (Recommended)

```bash
# MCP Servers - Finance
npm i -D @coingecko/coingecko-mcp yahoo-finance-mcp-server @pipeworx/mcp-finance-feeds @agentutility/mcp-edge-finance @compute-finance/mcp @easysolutions906/mcp-finance

# MCP Servers - Web/News
npm i -D one-search-mcp smart-web-mcp @ericthered926/duckduckgo-mcp-server rss-reader-mcp agentic-rss-parser mcp-scraper

# MCP Servers - DeFi
npm i -D @arcadia-finance/mcp-server web3-research-mcp @browserless.io/mcp

# MCP Servers - Infra
npm i -D mcp-proxy @playwright/mcp @upstash/context7-mcp

# Trading/Analysis
npm i -D finance-market @backtest-kit/sidekick opentrader dexbot

# Discord Upgrade
npm i @sapphire/framework discordx opencode-discord-bot
```

---

## Next Steps
1. Install high-priority MCP servers first (finance + web intelligence)
2. Test each MCP server with Market Orca's backend
3. Evaluate trading libs for strategy backtesting integration
4. Consider migrating to @sapphire/framework for Discord bot
5. Set up cron to re-run this hunt monthly