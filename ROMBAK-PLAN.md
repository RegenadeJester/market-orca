# Market Orca — Full Overhaul Plan
**Date:** 2026-06-21
**Scope:** Everything EXCEPT report-server.js (:4568)

## Phase 1: Backend Cleanup
- [ ] Fix fetchFearGreed not defined error
- [ ] Fix updatePresence _client undefined error
- [ ] Fix asset fetch errors (XAUUSD, TESTX, ETH-USDT, BRK.B)
- [ ] Remove legacy Indonesia files (indonesia-cron.js, indonesia-data-fetcher.js, indonesia-db.js, indonesia-indicators.js, indonesia-routes.js)
- [ ] Improve error handling in server.js
- [ ] Clean up discord.js (remove dead code)

## Phase 2: Frontend Redesign (Taste-Skill)
- [ ] Apply premium dark theme (Geist font, anti-AI-generic)
- [ ] Redesign App.vue navigation
- [ ] Redesign HomePage.vue dashboard
- [ ] Redesign AssetPage.vue
- [ ] Redesign TerminalPage.vue
- [ ] Update all components with premium styling
- [ ] Add micro-interactions and motion

## Phase 3: Discord Integration
- [ ] Improve alert embeds (volume/target data)
- [ ] Better report formatting
- [ ] Fix presence update

## Phase 4: Data Pipeline
- [ ] Improve news quality
- [ ] Better price data sources
- [ ] Cache optimization

## Phase 5: Deploy
- [ ] Rebuild frontend
- [ ] Restart servers
- [ ] Verify all endpoints
