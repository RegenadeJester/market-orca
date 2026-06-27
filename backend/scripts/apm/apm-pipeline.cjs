#!/usr/bin/env node
/**
 * APM Daily Pipeline Orchestrator
 * Runs at 08:00 WIB daily via cron.
 * Executes: PM → Architect → Dev → QA → Reviewer → Merge
 * 
 * Usage: node scripts/apm/apm-pipeline.cjs [--dry-run] [--pm-only] [--skip-architect]
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BACKEND = path.resolve(__dirname, '../..');
const SCRIPTS = __dirname;
const now = new Date();
const date = now.toISOString().slice(0, 10);
const args = process.argv.slice(2);

const DRY_RUN = args.includes('--dry-run');
const PM_ONLY = args.includes('--pm-only');
const SKIP_ARCHITECT = args.includes('--skip-architect');

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

function run(script, extraArgs = '') {
  log(`▶ Running ${path.basename(script)}${extraArgs ? ' ' + extraArgs : ''}`);
  try {
    const out = execSync(`node "${script}" ${extraArgs}`, {
      cwd: BACKEND,
      timeout: 300000,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    if (out.trim()) log(out.trim());
    return { ok: true, output: out };
  } catch (e) {
    const stderr = e.stderr || '';
    log(`❌ Script failed: ${path.basename(script)}`);
    if (stderr) log(stderr.slice(0, 500));
    return { ok: false, error: e.message, stderr };
  }
}

function checkGitStatus() {
  try {
    const status = execSync('git status --porcelain', { cwd: BACKEND, encoding: 'utf8' });
    const dirty = status.trim().split('\n').filter(l => l.trim()).length;
    if (dirty > 0) {
      log(`⚠️  Working directory has ${dirty} uncommitted changes`);
      return { dirty, files: status.trim() };
    }
    return { dirty: 0 };
  } catch { return { dirty: -1 }; }
}

function main() {
  log('═══════════════════════════════════════════════════');
  log(`  APM Daily Pipeline — ${date} 08:00 WIB`);
  log('═══════════════════════════════════════════════════');

  // Pre-flight
  const git = checkGitStatus();
  if (git.dirty > 0 && !DRY_RUN) {
    log('⚠️  Stashing uncommitted changes...');
    execSync('git stash push -m "apm-pipeline-pre-flight"', { cwd: BACKEND });
  }

  // Phase 1: PM scans codebase, picks top 3 features
  log('\n━━━ PHASE 1: PM Agent — Pain Point Scan ━━━');
  const pm = run(path.join(SCRIPTS, 'apm-pm.cjs'));
  if (!pm.ok) { log('Pipeline aborted: PM scan failed'); process.exit(1); }
  if (PM_ONLY) { log('PM-only mode, stopping.'); return; }

  // Phase 2: Architect designs each feature
  log('\n━━━ PHASE 2: Architect Agent — Solution Design ━━━');
  if (!SKIP_ARCHITECT) {
    const arch = run(path.join(SCRIPTS, 'apm-architect.cjs'));
    if (!arch.ok) { log('Warning: Architect design had issues, proceeding with best-effort'); }
  }

  // Phase 3: Dev implements features
  log('\n━━━ PHASE 3: Dev Agent — Implementation ━━━');
  const dev = run(path.join(SCRIPTS, 'apm-dev.cjs'));
  if (!dev.ok) { log('Pipeline paused: Dev implementation failed'); process.exit(1); }

  // Phase 4: QA tests features
  log('\n━━━ PHASE 4: QA Agent — Testing & Verification ━━━');
  const qa = run(path.join(SCRIPTS, 'apm-qa.cjs'));
  if (!qa.ok) { log('Pipeline paused: QA found critical issues'); process.exit(1); }

  // Phase 5: Reviewer approves
  log('\n━━━ PHASE 5: Reviewer Agent — Code Review ━━━');
  const review = run(path.join(SCRIPTS, 'apm-reviewer.cjs'));
  if (!review.ok) { log('Pipeline paused: Review blocked'); process.exit(1); }

  // Phase 6: Merge to main
  log('\n━━━ PHASE 6: Merge & Deploy ━━━');
  if (!DRY_RUN) {
    try {
      const branches = execSync('git branch --list "feat/*"', { cwd: BACKEND, encoding: 'utf8' })
        .trim().split('\n').filter(Boolean);
      for (const branch of branches) {
        log(`Merging ${branch.trim()} → main`);
        execSync(`git checkout main && git merge --no-ff ${branch.trim()} -m "APM: merge ${branch.trim()}"`, { cwd: BACKEND });
        execSync(`git branch -d ${branch.trim()}`, { cwd: BACKEND });
      }
      log('All feature branches merged ✅');
    } catch (e) {
      log(`⚠️  Merge step: ${e.message}`);
    }
  }

  // Phase 7: Push to GitHub
  log('\n━━━ PHASE 7: Push to GitHub ━━━');
  if (!DRY_RUN) {
    try {
      execSync('git push origin main', { cwd: BACKEND });
      log('Pushed to GitHub ✅');
    } catch (e) {
      log(`⚠️  Push failed (check remote): ${e.message}`);
    }
  }

  // Phase 8: Dashboard update
  log('\n━━━ PHASE 8: Dashboard Update ━━━');
  run(path.join(SCRIPTS, 'apm-dashboard.cjs'));

  // Post-flight: restore stash if we stashed
  if (git.dirty > 0 && !DRY_RUN) {
    try { execSync('git stash pop', { cwd: BACKEND }); } catch {}
  }

  log('\n═══════════════════════════════════════════════════');
  log('  Pipeline complete 🐋');
  log('═══════════════════════════════════════════════════');
}

main();
