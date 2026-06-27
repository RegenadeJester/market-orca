# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- APM Enterprise Pipeline v2.0 — 5-agent engineering team (PM, Architect, Dev, QA, Reviewer)
- `/api/apm/status` endpoint exposing pipeline metrics, feature stats, pain point counts
- APM PM Agent (`scripts/apm/apm-pm.cjs`) — automated codebase pain point scanner
- APM Dashboard (`scripts/apm/apm-dashboard.cjs`) — MMd.md parser with feature analytics
- APM Pipeline orchestrator (`scripts/apm/apm-pipeline.cjs`) — daily 08:00 WIB runner
- CI workflow (`.github/workflows/ci.yml`) — syntax check + test runner
- Architecture Decision Records directory (`architecture/`)
- QA sign-off directory (`qa-signoff/`) and Review directory (`review/`)

### Fixed
- Silent catch blocks in `ai-daily-report.js` (5 locations) now log DB errors
- Silent catch blocks in `config.js` (3 locations) now log config load failures
- Silent catch blocks in `alert-engine.js` and `discord-dm.js` now log errors
- APM PM scanner false positive reduction: .then() detector now skips Vue templates, deduplicates within 5-line windows
- `report-server.js` catch-all proxy now correctly placed after explicit routes

### Changed
- `apm.md` rewritten with full enterprise pipeline: 5 agents, quality gates, status dashboard, cron schedule
