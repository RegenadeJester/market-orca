# APM — Enterprise Agent Pipeline

**Mission:** Transform Market Orca development into a self-running engineering team. 5 specialized agents execute a daily pipeline at **08:00 WIB** shipping 2-3 production features.

---

## 1. AGENT ROLES & RESPONSIBILITIES

### 🎯 PM Agent (Product Manager)
**Motto:** "Find the pain, define the gain."
- **Scan codebase** → identify top 3 pain points (real user friction, not cosmetic)
- **Define requirements** → acceptance criteria, scope, priority (P0/P1/P2)
- **Accept/Reject** → final gate before merge; can send back to Dev/QA with reasons
- **Output:** `daily-brief.md` with 3 ranked features + acceptance criteria

### 🏗️ Architect Agent
**Motto:** "Design once, build right."
- **Design solution** per feature: API contracts, data flow, schema changes, component tree
- **Evaluate trade-offs** → document ADR (Architecture Decision Record) per feature
- **Pick best approach** → justify: simplicity vs flexibility, build vs buy, sync vs async
- **Output:** `architecture/<feature>.md` with Mermaid diagrams, contracts, risks

### 💻 Dev Agent
**Motto:** "Ship clean, ship fast."
- **Implement** per Architect spec + PM acceptance criteria
- **Write tests** → unit (Vitest), integration (Supertest), E2E (Playwright if UI)
- **Run checks** → lint, typecheck, test suite, build
- **Commit** → conventional commits, feature branch per feature
- **Output:** Working code + passing CI on feature branch

### 🧪 QA Agent
**Motto:** "Break it before users do."
- **Test feature** → happy path + edge cases + negative cases
- **Verify acceptance** → match PM criteria exactly
- **Check regressions** → run full test suite, smoke test related flows
- **Sign-off** → `qa-signoff/<feature>.json` with pass/fail, evidence, screenshots
- **Block merge** if any P0/P1 issue found

### 👁️ Reviewer Agent
**Motto:** "Code that survives review survives prod."
- **Code review** → correctness, style, security, performance, maintainability
- **Suggest improvements** → actionable, scoped, with examples
- **Approve PR** → only if: tests pass, QA sign-off, no unresolved P0/P1 comments
- **Output:** `review/<feature>.md` with approval or required changes

---

## 2. DAILY PIPELINE (08:00 WIB)

```
┌─────────────┐   ┌───────────────┐   ┌─────────────┐   ┌───────────┐   ┌──────────────┐   ┌──────────┐
│ 08:00 PM    │──▶│ 08:15 Arch    │──▶│ 08:45 Dev   │──▶│ 10:30 QA  │──▶│ 11:00 Review│──▶│ 11:15    │
│  Scan + Pick│   │  Design ×3    │   │  Implement  │   │  Test     │   │  Approve  │   │  Merge   │
└─────────────┘   └───────────────┘   └─────────────┘   └───────────┘   └──────────────┘   └──────────┘
     │                │                  │                  │                │               │
     ▼                ▼                  ▼                  ▼                ▼               ▼
  daily-brief.md  architecture/      feature/*         qa-signoff/     review/          main branch
                   <feature>.md       branches          <feature>.json   <feature>.md     + tag
```

**Timebox per feature:**
| Tier | Scope | Files | Dev | QA | Review |
|------|-------|-------|-----|-----|--------|
| Small Fix | 1-2 files, <50 LOC | 1-2 | 25 min | 10 min | 5 min |
| Medium Feature | 3-5 files, new endpoint/component | 3-5 | 60 min | 15 min | 10 min |
| Polish | UX/perf/docs, no new logic | 1-3 | 30 min | 10 min | 5 min |

**Parallelization:** Architect designs all 3 → Dev implements sequentially (or parallel if independent) → QA/Review can overlap.

---

## 3. FEATURE SCOPE (Realistic Per Day)

| Tier | Scope | Files | Time | Example |
|------|-------|-------|------|---------|
| **Small Fix** | 1-2 files, <50 LOC change | 1-2 | 40 min | Fix N+1 query, add missing index, patch validation |
| **Medium Feature** | 3-5 files, new endpoint/component | 3-5 | 85 min | New API endpoint + FE widget, alert rule engine, report section |
| **Polish** | UX/perf/docs, no new logic | 1-3 | 45 min | Dark mode fix, query optimization, API docs, loading states |

**Constraint:** Max 3 features/day. If medium spills, drop polish. Never compromise quality gates.

---

## 4. QUALITY GATES (Non-Negotiable)

| Gate | Check | Tool | Fail Action |
|------|-------|------|-------------|
| **Pre-commit** | Lint + Typecheck | ESLint + tsc | Block commit |
| **Pre-push** | Unit + Integration tests | Vitest | Block push |
| **PR Open** | Build passes | GitHub Actions | Block merge |
| **QA Sign-off** | Acceptance + Edge + Regression | QA Agent | Block merge |
| **Review Approve** | No P0/P1 comments | Reviewer Agent | Block merge |
| **Deploy** | QA sign-off + Review approve + Changelog | Pipeline | Block deploy |

**Changelog:** Every merge updates `CHANGELOG.md` (Keep a Changelog format).
**Screenshots:** Required for UI changes (QA provides).

---

## 5. STATUS DASHBOARD (APM)

**Tracked in `MMd.md` (Market Orca Feature Log):**
- ✅ Shipped features (by date, with branch/PR/commit)
- 🐛 Bugs found & fixed (with root cause, regression test added)
- 📦 Technical debt (tracked, prioritized, scheduled)
- 📊 Weekly report (auto-generated Fridays 17:00 WIB)

**Metrics:**
- Features shipped/week (target: 10-15)
- Bug escape rate (target: <5%)
- Cycle time: PM pick → merge (target: <4 hrs)
- Test coverage delta (target: ≥0% weekly)

---

## 6. AGENT IMPLEMENTATION (Node.js Scripts)

All agents implemented as Node.js scripts in `backend/scripts/apm/`:

| Script | Agent | Trigger | Output |
|--------|-------|---------|--------|
| `apm-pm.js` | PM | Cron 08:00 | `daily-brief.md` |
| `apm-architect.js` | Architect | PM done | `architecture/<feature>.md` |
| `apm-dev.js` | Dev | Arch done | Feature branch + commits |
| `apm-qa.js` | QA | Dev done | `qa-signoff/<feature>.json` |
| `apm-reviewer.js` | Reviewer | QA pass | `review/<feature>.md` |
| `apm-pipeline.js` | Orchestrator | Cron 08:00 | Runs full pipeline |
| `apm-dashboard.js` | Dashboard | Cron 17:00 Fri | Weekly report |

---

## 7. DAILY IDEA GENERATOR (`apm-daily-idea.js`)

Scans codebase for pain points using static analysis + git history + error logs:

```javascript
// Pain point detectors:
// 1. Silent catch blocks: catch(() => {}) or catch(e) { console.error(e) }
// 2. Missing error handling: .then() without .catch()
// 3. N+1 queries: DB calls inside loops
// 4. Missing tests: changed files without test coverage delta
// 5. TODOs/FIXMEs in changed files
// 6. Slow endpoints: response time >500ms in logs
// 7. Duplicate code: similar functions in multiple files
// 8. Missing indexes: WHERE clauses on non-indexed columns
```

**Output:** 3 ranked features with estimated effort + acceptance criteria.

---

## 8. CRON SCHEDULE (WIB)

| Time | Job | Script |
|------|-----|--------|
| 08:00 | Daily pipeline start | `apm-pipeline.js` |
| 12:00 | Midday health check | `apm-health.js` |
| 17:00 Fri | Weekly report | `apm-dashboard.js` |
| 02:00 | Nightly backup | `backup-db.sh` |

---

## 9. FILES & ARTIFACTS

```
/backend/
├── apm.md                    # This file
├── scripts/
│   ├── apm-pm.js
│   ├── apm-architect.js
│   ├── apm-dev.js
│   ├── apm-qa.js
│   ├── apm-reviewer.js
│   ├── apm-pipeline.js
│   ├── apm-dashboard.js
│   ├── apm-daily-idea.js     # Pain point scanner
│   └── apm-health.js
├── architecture/             # ADRs per feature
├── qa-signoff/              # QA sign-off JSON
├── review/                  # Reviewer reports
├── daily-brief.md           # Today's 3 features
├── MMd.md                   # Feature log + dashboard
├── CHANGELOG.md             # Keep a Changelog
└── .github/workflows/
    ├── ci.yml               # Lint + Test + Build
    └── apm-pipeline.yml     # Daily pipeline trigger
```

---

## 10. QUICK START

```bash
# Run full pipeline manually (for testing)
cd backend && node scripts/apm/apm-pipeline.js

# Run PM scan only
cd backend && node scripts/apm/apm-pm.js

# Generate weekly report
cd backend && node scripts/apm/apm-dashboard.js

# Scan for pain points
cd backend && node scripts/apm/apm-daily-idea.js
```

---

## 11. DECISION LOG

| Date | Decision | ADR |
|------|----------|-----|
| 2026-06-28 | Adopt 5-agent pipeline with 08:00 WIB cron | ADR-001 |
| 2026-06-28 | Quality gates: no merge without QA sign-off + Review approve | ADR-002 |
| 2026-06-28 | Feature scope: 1 small + 1 medium + 1 polish per day | ADR-003 |

---

*Last updated: 2026-06-28 06:00 WIB — Pipeline v1.0 initialized*