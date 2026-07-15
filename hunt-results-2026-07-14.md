# Agent/Tool Hunt Results — 2026-07-14

## Installed (via npm -g)
1. **@2sio/mcp@1.80.2** — 180+ tools: news, finance, crypto address-validate, EVM gas, OFAC screening, weather, search, patents, scientific papers. `npx -y @2sio/mcp`
2. **@bitcompare/mcp-server@1.1.0** — 18 crypto data tools: lending/staking/borrowing rates, coin metadata, aggregated prices, stablecoin peg-stability, symbol resolution.
3. **@clicks-protocol/mcp-server@0.3.0** — Autonomous USDC yield for AI agents on Base. 9 tools: register, split payments 80/20 liquid/yield, withdraw.
4. **equivault-mcp@1.0.2** — AI-powered equity research: 38 tools for company fundamentals, financial statements, screening, insider transactions, signals.
5. **signalfuse-mcp@1.1.2** — 11 tools for AI trading agents: fused crypto signals, sentiment, macro regime, strategy arena, sandboxed code execution.

## Already Installed (global npm — finance/market related)
- alpaca-mcp, alpha-vantage-mcp-server, alphavantage-stock-mcp
- backtest-kit, binance, bybit-official-trading-server, ccxt
- finnhub-mcp, kalshi-trading-bot-cli, mcp-crypto-price
- polymarket-mcp-server, stock-scanner-mcp, stock-sdk
- tavily-mcp, trading-signals, yahoo-finance-mcp-server
- @arcadia-finance/mcp-server, @coinrithm/mcp-trading
- @cryptoapis-io/mcp-market-data, @easysolutions906/mcp-finance
- @flyneko/mcp-market, @jasonruan/mcp-crypto-tools
- @junduck/trading-indi, @michaleffffff/mcp-trading-server
- @microagents/mcp-server-binance, @pipeworx/mcp-* (5: alphavantage, coinmarketcap, defillama, kalshi, market-spread)
- @timmeck/trading-brain, @vorionsys/aurais-mcp-market-scout
- @pullapi/google-news-scraper-mcp, @pullapi/yahoo-finance-scraper-mcp

## Already Installed (skills — 273 total)
- finance-trading, finance-content-factory, finance-radar, finance-report-pro, finance-report-analyzer
- crypto-funding-alert, crypto-market-data, crypto-investment-strategist, crypto-trading-bot-playbook
- trading, trading-desk, trading-devbox, trading-research, skill-trading-journal
- oanda-forex-trading, headless-crypto, realtime-crypto-price-api
- news, news-crawler, news-summary, tech-news
- finviz-crawler, yahoo-finance-forex
- agent-trading-bot, polymarket-telegram-picks
- mcp-server, mcp-server-discovery, mcp, mcp-skill, mcp-client
- deep-investment-research, financial-machine-learning
- threat-intel-vu

## Found (not installed — pip/npx/uvx tools, not npm packages)
6. **decksaga/market-pulse-mcp** — Live crypto/stocks/forex/Fear & Greed data. Zero API keys. `uvx market-pulse-mcp`
7. **eliasfire617/crypto-market-data-mcp** — Live prices, funding rates, OI, L/S ratio, orderbook across Bybit/Binance/OKX/Hyperliquid via CCXT. `uvx crypto-market-data-mcp`
8. **cryptobriefing/gloria-mcp** — AI-curated crypto news with sentiment. `pip install cryptobriefing-gloria-mcp`
9. **falsifylab-alpha-mcp** — 9 tools: yield farms, Hyperliquid vault leaderboard, SEC insider buys, macro tape. `pip install falsifylab-alpha-mcp`
10. **Octodamus** — AI consensus market oracle (11-signal BUY/SELL/HOLD: RSI, MACD, funding rate, Fear & Greed, Congressional). x402 micropayments.
11. **coinpaprika/dexpaprika-mcp** — DEX data across 20+ chains, 5M+ tokens: pricing, liquidity pools, OHLCV.
12. **AletaIndex/aletaindex-fin-narratives** — Financial narrative intelligence across 109 tickers: clustering news, sentiment momentum, portfolio mapping. `uvx narrative-intelligence-mcp`
13. **grahammccain/chart-library-mcp** — 24M pre-computed chart pattern embeddings across 15K stocks, 10yr data. `pip install chartlibrary-mcp`
14. **HypurrQuant/perp-cli** — Multi-DEX perpetual futures trading (Pacifica, Hyperliquid, Lighter). Funding rate arb scanning.
15. **Hive-intel/hive-crypto-mcp** — Unified crypto/DeFi/Web3 analytics.
16. **kukapay/* family** (~30 repos) — Crypto micro-MCP servers: fear & greed, news, sentiment, liquidations, trends, whitepapers, orderbooks, portfolio, DEX pools, staking, bridge metrics, DeFi yields, DAO proposals, crypto stocks, dune analytics. Most are pip/uvx.
17. **bubilife1202/crossfin** — Korean & global crypto exchange routing, arbitrage signals, x402 USDC payments. 16 tools across 9 exchanges.
18. **connerlambden/helium-mcp** — Real-time news with bias scoring across 5K+ sources, AI options pricing, live market data.
19. **haiku-trading/haiku-mcp-server** — DeFi execution across 22 chains: swap, LP, lend, bridge, yield strategies.
20. **keel-trade** — Build, backtest, automate Hyperliquid trading strategies. `pip install flox-mcp`
21. **dolphinquant/echolon** — SHFE futures backtest framework. `pip install echolon`
22. **keenableai/keenable-mcp** — Live web search + clean-markdown page fetch. Free 1K req/hr.

## GitHub Top Projects (repo references)
- **HKUDS/AI-Trader** (20.8K★) — Fully-automated agent-native trading
- **brokermr810/QuantDinger** (9.5K★) — AI quant trading: crypto, stocks, forex
- **TraderAlice/OpenAlice** (5.9K★) — One-person Wall Street AI agent
- **The-Swarm-Corporation/AutoHedge** (3.8K★) — Autonomous hedge fund builder
- **Polymarket/agents** (3.7K★) — Trade autonomously on Polymarket
- **simonlin1212/TradingAgents-astock** (2.1K★) — A-stock multi-agent research
- **Lumiwealth/lumibot** (1.8K★) — Backtestable AI trading agents
- **mnemox-ai/tradememory-protocol** (1.4K★) — Decision audit for trading agents

## Summary
- **Found:** 50+ agents/tools/MCP servers
- **Installed new npm globals:** 5 (@2sio/mcp, @bitcompare/mcp-server, @clicks-protocol/mcp-server, equivault-mcp, signalfuse-mcp)
- **Skipped:** 45+ (already installed, pip/uvx only, python-based, or not npm-installable)
- **Recommendation for Market Orca integration:** equivault-mcp (equity research), signalfuse-mcp (trading signals), @2sio/mcp (broad market data), crypto-market-data-mcp (crypto pricing), market-pulse-mcp (multi-asset data), cryptobriefing-gloria-mcp (crypto news + sentiment)
