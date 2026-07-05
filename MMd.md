# Market Orca — Feature Log

## 2026-07-05 — Feature #30: Impact Simulator v2 — Visual Impact Bars
- **Pain point:** Impact Simulator cards showed impact_score as text but no visual indicator of bullish vs bearish magnitude.
- **Done:** Added dual-color bar track (green bullish, red bearish) below score number with width proportional to impact_score using `bullishPct()`/`bearishPct()` helpers. Moved risk_level + kind text below the new bar. CSS transition on width change. Frontend-only change — no backend needed.
- **Frontend:** `frontend/src/pages/ImpactSimulatorPage.vue`
- **Deliverable:** Impact Simulator cards now have clear visual bull/bear bars. PR #2 (frontend repo).
- **Branch:** `feat/impact-sim-v2-visual-bars` → PR #2 (frontend repo) ✅ merged
- **Backlog:** Market Impact Simulator v2 — custom event enhancements (Batch 1, #7 — further custom event presets remain)

## 2026-07-05 — Feature #29: Discord Spam Level Respected in Delivery Path
- **Pain point:** `discord_spam_level` (digest/normal/full) stored in user preferences via ReportPreferencesPage but never actually used — all 3 Discord delivery paths (webhook, bot channel, DM fallback) hardcoded `discordDigest()` regardless of setting.
- **Done:** Added `prepareReportForDiscord(mode, text)` helper that routes report content through the correct filter per `discord_spam_level`: 'digest' strips internal/QA sections + smart truncation (no change), 'normal' strips RAG block only + ~12K truncate, 'full' sends raw text capped at 6K. Replaced hardcoded `discordDigest()` in `sendViaWebhook`, `sendAiReportToUser`, `sendAiReportToUserDm`. Added console.log showing active mode per delivery.
- **Files:** `backend/src/ai-daily-report.js`
- **Deliverable:** User preferences for Discord content level are now functional end-to-end. PR #17.
- **Branch:** `feat/discord-spam-level` → PR #17

## 2026-07-04 — Feature #28: Silent Error Swallowing Fixes Batch 4 (mcp-tradingview + n8n-mcp-bridge + rag-autolearn)
- **Pain point:** 9 silent `catch {}` blocks in `mcp-tradingview.js` (1), `n8n-mcp-bridge.js` (5), `rag-autolearn.js` (3) swallowed CoinGecko fetch failures, n8n workflow JSON corruption, and FTS insert/delete corruption without logging.
- **Done:** Added `console.warn('[mcp-tv] ...')`, `console.warn('[n8n] ...')`, `console.warn('[rag-autolearn] ...')` with error message.
- **Files:** `backend/src/mcp-tradingview.js`, `backend/src/n8n-mcp-bridge.js`, `backend/src/rag-autolearn.js`
- **Deliverable:** Critical path errors no longer vanish; visible in logs for debugging. Continuation of Features #21, #26, #27.
- **Branch:** `feat/silent-catch-fixes-batch4` → PR #16

## 2026-07-03 — Feature #27: Silent Error Swallowing Fixes Batch 3 (ai-daily-report.js + discord.js)
- **Pain point:** 9 silent `catch {}` blocks in `ai-daily-report.js` (2) and `discord.js` (7) swallowed PDF image render failures, DB stat errors, button handler fetch failures, and error reply fallback failures without logging.
- **Done:**
  1. `ai-daily-report.js`: 2 PDF image render catches now log `[ai-report] PDF image render failed: <msg>` — card image L1035, body image L1109
  2. `discord.js`: 7 catches now log `[discord] <context> failed: <msg>` — DB size stat, refresh/news/market_tab/report buttons, modal error reply, generic error handler
- **Files:** `backend/src/ai-daily-report.js`, `backend/src/discord.js`
- **Deliverable:** All remaining silent catches in PDF generation and Discord interaction handlers now surface errors for debugging. Completes the 3-batch silent catch elimination (Feature #21 + #26 + #27).
- **Branch:** `feat/silent-catch-fixes-batch3` → PR #15

## 2026-07-03 — Feature #26: Silent Error Swallowing Fixes Batch 2 (report-server.js + server.js)
- **Pain point:** 13 silent `catch {}` blocks in `report-server.js` (8) and `server.js` (5) swallowed DB failures, fetch errors, LLM rewrite failures, fts5 health checks, and asset fetch errors in critical request paths without logging.
- **Done:**
  1. `report-server.js`: 8 catches now log `[report-server] <context>: <msg>` — searchNews, asset fetch, filter parse, live assets, ragHybridSearch, LLM rewrite, fts5 health, APM dashboard import
  2. `server.js`: 5 catches now log `[server] <context>: <msg>` — today report read, filter parse, fts5 health, ragHybridSearch, LLM rewrite
- **Files:** `backend/src/report-server.js`, `backend/src/server.js`
- **Deliverable:** Errors in request-path handlers no longer vanish; visible in logs for debugging. Continuation of Feature #21 pattern.
- **Branch:** `feat/silent-catch-fixes-batch2` → PR #14
