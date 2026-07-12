# Market Orca — Feature Log

## 2026-07-13 — Feature #36: .gitignore Collections Autolearn Generated Data
- **Pain point:** `collections/autolearn-learned.json`, `collections/autolearn-metrics.json`, `collections/autolearn-topics.json` regenerated daily by autolearn cron — tracked in git, making `git status` permanently dirty and commits noisy with auto-generated JSON.
- **Done:** Added `collections/` to `.gitignore`. Ran `git rm --cached` on all 3 tracked files (+ 8MB autolearn.log never tracked). Repo now clean between runs.
- **Files:** `.gitignore`
- **Deliverable:** `git status` clean between autolearn cron runs. No more noise commits for regenerated data. PR #23.
- **Branch:** `feat/gitignore-collections-autolearn` → PR #23
- **Backlog:** —

## 2026-07-12 — Feature #35: Automated SQLite Backup with Daily Cron and API Endpoints
- **Pain point:** No automated DB backup. Manual backup required `sqlite3` CLI or file copy. Risk of data loss from corruption, disk failure, or accidental deletion. No API to list/prune backups.
- **Done:** Added 4 functions to `db.js` (`createBackup`, `listBackups`, `deleteOldBackups`, `ensureBackupDir`) using `better-sqlite3` native `.backup()` API — atomic, no locks, no new deps. 3 REST endpoints in `server.js`: `POST /api/backup` (manual), `GET /api/backup/list` (list), `POST /api/backup/cleanup` (prune to 30). Daily cron at 07:00 WIB via `jakartaHour()` check (hourly interval, minimal overhead).
- **Files:** `backend/src/db.js`, `backend/src/server.js`
- **Deliverable:** Zero-dep automated backup with daily cron and full REST API. PR #22.
- **Branch:** `feat/sqlite-backup` → PR #22
- **Backlog:** Backup verification (checksum), S3/GCS upload target, retention policy config via DB.

## 2026-07-08 — Feature #33: Language Guard Wired to Text + HTML
4|- **Pain point:** `report-language-guard.js` existed with all ID translation maps but was never imported/called in `ai-daily-report.js`. English headers leaked in both text and HTML output despite translation infrastructure being ready.
5|- **Done:** Converted `module.exports` → `export` (ESM). Added `import { translateReport }` in `ai-daily-report.js`. Called `translateReport(text)` before returning from `buildTextReport()`. Patched HTML: `Statistics`→`Statistik`, `Report Quality`→`Kualitas Laporan`, `What Changed Today`→`Yang Berubah Hari Ini`, `Red Flags`→`Bendera Merah`.
6|- **Files:** `backend/src/report-language-guard.js`, `backend/src/ai-daily-report.js`
7|- **Deliverable:** Language guard now actively translates text reports and HTML headers to Bahasa Indonesia. PR #20.
8|- **Branch:** `feat/language-guard-wire` → PR #20
9|- **Backlog:** —

## 2026-07-10 — Feature #34: Translate Remaining English Subsections
- **Pain point:** `Executive Morning Brief`, `Market Impact Watch`, `Improvement / Added Features QA Pack`, `Reliability / Incident / QA Add-on Batch 3`, `Sentiment Trend` still had English headers despite language guard infrastructure being ready. `executiveBrief` not wrapped with `translateReport()`.
- **Done:** Added 49 ID translations to `ID_MAP` in `report-language-guard.js`. Wrapped `executiveBrief` with `translateReport()`. Also bundled CI stability fixes (test concurrency, force-exit, 8min timeout).
- **Files:** `backend/src/report-language-guard.js`, `backend/src/ai-daily-report.js`, `.github/workflows/ci.yml`
- **Deliverable:** All report subsections now fully Indonesian. PR #21.
- **Branch:** `feat/translate-remaining-english` → PR #21 ✅ merged
- **Backlog:** —

## 2026-07-06 — Feature #31: Silent Error Swallowing Fixes Batch 5
- **Pain point:** 9 silent `catch {}` blocks in `hermes-skill.js` (5), `rag-autolearn.js` (2), `report-professional.js` (2), `server.js` (2) swallowed DB failures, FTS search errors, MCP fetch failures, and env file read errors without logging.
- **Done:** Added `console.warn('[component] context:', e.message)` to all 9 catches for traceability. Pattern: `try { ... } catch (e) { console.warn('[component] context:', e.message) }`
- **Files:** `backend/src/hermes-skill.js`, `backend/src/rag-autolearn.js`, `backend/src/report-professional.js`, `backend/src/server.js`
- **Deliverable:** Critical path errors now surface in logs for debugging. Completes 5-batch silent catch elimination (Features #21 + #26 + #27 + #28 + #31).
- **Branch:** `feat/silent-catch-fixes-batch5` → PR #18
- **Backlog:** Silent catch audit complete — no remaining silent catches in critical paths.

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
