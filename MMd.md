# MMd.md — Market Orca Daily Improvements

Daily feature pipeline: brainstorm → plan → branch → implement → PR → review → merge.

## Guidelines

- 1–2 features/improvements per session
- Use git flow: branch → PR → merge (backend) or direct push (frontend)
- Focus: report quality, data accuracy, UI/UX, performance, automation
- Log all changes in this file with date + description

## Changelog

| Date | # | Feature | Branch | Status |
|------|---|---------|--------|--------|
| 2026-06-19 | 1 | Discord Report/News Publishing via publishChannel API | feat/discord-report-publish | merged |
| 2026-06-19 | 2 | GitHub Actions CI pipeline (test + build) | feat/ci-pipeline | PR #2 merged |
| 2026-06-20 | 3 | CDS spread fetcher — Indo-US 5Y yield spread proxy | feat/cds-spread-fetcher | PR #3 merged |
| 2026-06-21 | 4 | SearXNG IDX news + channel delivery + DM toggle + market-news API | feat/channel-delivery-searxng-news | PR #4 merged |
| 2026-06-21 | 5 | Enriched report list API (?metadata=true) + recent report cards on homepage | feat/report-list-metadata | PR #5 merged |
| 2026-06-22 | 6 | MCP SSE transport + docs UI + infra cleanup | feat/mcp-sse-transport-infra-cleanup | PR #6 merged |
| 2026-06-22 | 7 | Alert Summary Dashboard — /api/market/alerts-summary | feat/alert-summary-dashboard | PR #7 merged |
| 2026-06-24 | 8 | Market Activity Feed API + CI fix (data/ dir) | feat/market-activity-feed | PR #8 merged |
| 2026-06-25 | 9 | Indonesia overview batch endpoint — fixes 404 on IndonesiaPage | feat/indonesia-overview-endpoint | PR #9 merged |
| 2026-06-25 | 10 | MarketStatusBar — live/closed/holiday indicator per exchange on homepage | feat/market-status-bar | frontend main pushed |

## Feature 1: Smart Discord Digest with Rich Embed Card
- **Branch:** feature/smart-discord-digest → merged to main
- **What changed:**
  - `discordDigest()`: replaced fragile regex section stripping with explicit `DIGEST_REMOVE_SECTIONS` constant + header-matching logic
  - New `buildDigestEmbed()`: generates a rich Embed card (hero headline, stats, regime color, Indonesia pulse, og:image)
  - `sendAiReportToUser()`: sends embed card FIRST, then text digest as follow-up messages
  - Truncation logic improved: checks `\n\n` boundary in addition to sentence endings
- **Pain point fixed:** Wall-of-text delivery with no visual hierarchy; fragile regex that missed sections when separator pattern changed

## Feature 2: RSS Feed Timeout + Progress Logging
- **Branch:** feature/rss-feed-timeout → merged to main
- **What changed:**
  - New `fetchFeedWithTimeout(label, fetchFn, 12s)` wrapper using `Promise.race` against a `setTimeout`
  - `generateAiDailyReport()` now uses `Promise.allSettled` instead of `Promise.all` → one slow/hanging feed never blocks the whole report
  - Per-feed console log: `[ai-report] LABEL: ok X items (Yms)` or `fail reason (Yms)`
  - Total item count summary at end
- **Pain point fixed:** If CoinDesk or Forbes RSS hangs on DNS/connect, the entire report was stuck; now it logs and moves on

## Feature 3: PDF Hero Image + Top Stories Gallery
- **Branch:** feature/pdf-hero-image → merged to main
- **What changed:**
  - PDF title page now renders hero article's og:image as a 500×280 banner above the report title
    (gracefully catches if image buffer missing/unavailable)
  - New "Top Stories Gallery" page: up to 6 items (2 rows × 3 cols) with thumbnails + truncated headlines
  - Gallery only renders if 3+ items have imageUrls
  - Inline section thumbnails (86×54px) were already present
- **Pain point fixed:** PDF was text-only, bland; now visually scannable with images

## Feature 10: Market Status Bar
- **Branch:** feat/market-status-bar → pushed to frontend main
- **What changed:**
  - New `MarketStatusBar.vue` component: fetches `/api/market-calendar`, renders colored indicator dots + labels for Crypto, Forex, IDX, NYSE/NASDAQ
  - Mounted on `HomePage.vue` between marquee and Market Watch search section
  - Shows: Live (green), Closed (red), Holiday (orange) with detail text (holiday name, hours-until-open)
  - Backend `/api/market-calendar` endpoint was already wired in `market-calendar.js`
- **Pain point fixed:** No visual indicator of market status on frontend; users couldn't tell which markets were live vs closed at a glance
