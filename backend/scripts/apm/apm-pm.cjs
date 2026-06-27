#!/usr/bin/env node
/**
 * APM PM Agent — Pain Point Scanner & Feature Picker
 * 
 * Scans both backend/src/ and frontend/src/ for:
 * 1. Silent catch blocks (catch(() => {}) / catch {} etc.)
 * 2. Missing error handlers (.then() without .catch())
 * 3. Console.error without user feedback
 * 4. Hardcoded values
 * 5. N+1 query patterns
 * 6. Files without test coverage
 * 7. Recent git changes with technical debt
 * 
 * Output: daily-brief.md with top 3 ranked features + acceptance criteria
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BACKEND = path.resolve(__dirname, '../..');
const FRONTEND = path.resolve(BACKEND, '../../frontend');
const SRC = path.join(BACKEND, 'src');
const FRONTEND_SRC = path.join(FRONTEND, 'src');

const now = new Date();
const date = now.toISOString().slice(0, 10);

const painPoints = [];

// ── Scanner 1: Silent catch blocks ──
function scanSilentCatches(dir, label) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir, { recursive: true })
    .filter(f => (f.endsWith('.js') || f.endsWith('.vue')) && !f.includes('.test.js') && !f.includes('.spec.js'));
  for (const file of files) {
    const fp = path.join(dir, file);
    if (!fs.statSync(fp).isFile()) continue;
    const content = fs.readFileSync(fp, 'utf8');
    let lines = content.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // catch {}  or  catch(() => {})  or  catch(e) { }  or  catch(_) {}
      if (/catch\s*(\([^)]*\))?\s*\{\s*\}/.test(line) || 
          /catch\s*\(\)\s*=>\s*\{\s*\}/.test(line)) {
        // Look at context: is this actually a silent catch?
        const context = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 4)).join('\n');
        // Skip if it's just logging inside the catch
        if (/console\.(error|log|warn)/.test(context)) continue;
        painPoints.push({
          type: 'silent-catch',
          label: 'Silent catch block swallows error',
          priority: 'P1',
          file: path.relative(BACKEND, fp),
          line: i + 1,
          code: line.trim().slice(0, 100)
        });
      }
      // catch(e) { console.error(...) } - logged but no user feedback
      if (/catch\s*\(\s*(\w+|_)\s*\)/.test(line)) {
        // Check if next lines have ONLY console.error
        const block = lines.slice(i, Math.min(i + 8, lines.length)).join('\n');
        if (/console\.(error|log|warn)/.test(block) && 
            !/res\.(json|status|send|end)/.test(block) && 
            !/toast|notify|alert|throw|return/.test(block) &&
            !/logger\./.test(block)) {
          painPoints.push({
            type: 'no-user-feedback',
            label: 'Error logged but not surfaced to user',
            priority: 'P2',
            file: path.relative(BACKEND, fp),
            line: i + 1,
            code: line.trim().slice(0, 100)
          });
        }
      }
    }
  }
}

// ── Scanner 2: .then() without .catch() ──
function scanMissingCatches(dir, label) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir, { recursive: true })
    .filter(f => f.endsWith('.js') || f.endsWith('.vue'));
  for (const file of files) {
    const fp = path.join(dir, file);
    if (!fs.statSync(fp).isFile()) continue;
    const content = fs.readFileSync(fp, 'utf8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (/\.then\(/.test(lines[i])) {
        // Look ahead max 10 lines for .catch(
        const following = lines.slice(i, i + 10).join('\n');
        // Count .then( and .catch(
        const thenCount = (following.match(/\.then\(/g) || []).length;
        const catchCount = (following.match(/\.catch\(/g) || []).length;
        if (thenCount > 0 && catchCount === 0 && !/await/.test(lines[i])) {
          painPoints.push({
            type: 'missing-catch',
            label: 'Promise chain without .catch() error handler',
            priority: 'P1',
            file: path.relative(BACKEND, fp),
            line: i + 1,
            code: lines[i].trim().slice(0, 100)
          });
        }
      }
    }
  }
}

// ── Scanner 3: Hardcoded values ──
function scanHardcoded(dir, label) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir, { recursive: true })
    .filter(f => f.endsWith('.js') || f.endsWith('.vue'));
  for (const file of files) {
    const fp = path.join(dir, file);
    if (!fs.statSync(fp).isFile()) continue;
    const content = fs.readFileSync(fp, 'utf8');
    // Magic numbers / hardcoded URLs
    if (content.includes('"http://localhost') && !content.includes('process.env')) {
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('"http://localhost') && !lines[i].includes('process.env')) {
          painPoints.push({
            type: 'hardcoded-url',
            label: 'Hardcoded localhost URL should use env variable',
            priority: 'P2',
            file: path.relative(BACKEND, fp),
            line: i + 1,
            code: lines[i].trim().slice(0, 100)
          });
        }
      }
    }
  }
}

// ── Scanner 4: Missing tests ──
function scanMissingTests() {
  if (!fs.existsSync(SRC)) return;
  const srcFiles = fs.readdirSync(SRC).filter(f => f.endsWith('.js') && !f.includes('.test'));
  for (const file of srcFiles) {
    const base = file.replace('.js', '');
    const testFile = path.join(SRC, `${base}.test.js`);
    if (!fs.existsSync(testFile)) {
      const fp = path.join(SRC, file);
      const content = fs.readFileSync(fp, 'utf8');
      // Only flag files with at least one function export
      if (/module\.exports|exports\.|function /.test(content) && content.length > 2000) {
        painPoints.push({
          type: 'missing-test',
          label: 'Module has no test file',
          priority: 'P1',
          file: path.relative(BACKEND, fp),
          line: 1,
          code: `${file} — ${content.length} bytes, 0 tests`
        });
      }
    }
  }
}

// ── Scanner 5: DB queries inside loops (potential N+1) ──
function scanQueriesInLoops(dir, label) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir, { recursive: true })
    .filter(f => f.endsWith('.js'));
  for (const file of files) {
    const fp = path.join(dir, file);
    if (!fs.statSync(fp).isFile()) continue;
    const content = fs.readFileSync(fp, 'utf8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (/\b(for|while|forEach|map|reduce)\b/.test(lines[i]) || 
          lines[i].includes('.forEach(') || lines[i].includes('.map(')) {
        // Check inside loop for db.prepare
        const loopBody = lines.slice(i, Math.min(i + 20, lines.length)).join('\n');
        if (/db\.(prepare|all|get|run)/.test(loopBody)) {
          painPoints.push({
            type: 'n-plus-1',
            label: 'DB query inside loop — potential N+1',
            priority: 'P1',
            file: path.relative(BACKEND, fp),
            line: i + 1,
            code: lines[i].trim().slice(0, 100)
          });
        }
      }
    }
  }
}

// ── Scanner 6: Large files with no tests (tech debt) ──
function scanLargeTechDebt(dir, label) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir, { recursive: true })
    .filter(f => f.endsWith('.js'));
  for (const file of files) {
    const fp = path.join(dir, file);
    if (!fs.statSync(fp).isFile()) continue;
    const content = fs.readFileSync(fp, 'utf8');
    if (content.length > 30000 && !file.includes('.test')) {
      painPoints.push({
        type: 'large-file',
        label: 'File exceeds 30KB without tests — refactoring candidate',
        priority: 'P2',
        file: path.relative(BACKEND, fp),
        line: 1,
        code: `${file} — ${content.length} bytes`
      });
    }
  }
}

// ── Scanner 7: Git log for recent flux areas ──
function scanGitActivity() {
  try {
    // Check if git repo exists first
    try { execSync('git rev-parse --is-inside-work-tree', { cwd: BACKEND, encoding: 'utf8', timeout: 3000 }); }
    catch { return; } // Not a git repo
    const commits = execSync('git log --oneline --since="7 days ago" --name-only --format="%n" -- "src/"', { 
      cwd: BACKEND, encoding: 'utf8', timeout: 5000 
    });
    const files = commits.trim().split('\n').filter(Boolean);
    const freq = {};
    for (const f of files) {
      if (f.endsWith('.js')) freq[f] = (freq[f] || 0) + 1;
    }
    const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (sorted.length > 0) {
      painPoints.push({
        type: 'churn',
        label: `High-activity file: ${sorted[0][1]} changes last 7 days`,
        priority: 'P2',
        file: sorted[0][0],
        line: 1,
        code: `Top file: ${sorted[0][0]} (${sorted[0][1]} changes)`
      });
    }
  } catch {}
}

// ── RUN ALL SCANNERS ──
console.log('🔍 APM PM Agent — Scanning codebase for pain points...\n');

scanSilentCatches(SRC, 'backend');
scanSilentCatches(FRONTEND_SRC, 'frontend');
scanMissingCatches(SRC, 'backend');
scanMissingCatches(FRONTEND_SRC, 'frontend');
scanHardcoded(SRC, 'backend');
scanMissingTests();
scanQueriesInLoops(SRC, 'backend');
scanLargeTechDebt(SRC, 'backend');
scanGitActivity();

// ── Rank & pick top 3 ──
const ranked = painPoints.sort((a, b) => {
  const p = { P0: 0, P1: 1, P2: 2, P3: 3 };
  return (p[a.priority] || 3) - (p[b.priority] || 3);
});

const top3 = ranked.slice(0, 3);

function formatFeature(idx, pp) {
  const featureNames = {
    'silent-catch': 'Eliminate Silent Error Swallowing',
    'no-user-feedback': 'Surface Errors to User',
    'missing-catch': 'Add Promise Error Handlers',
    'hardcoded-url': 'Configurable Backend URLs',
    'missing-test': 'Test Coverage for Critical Module',
    'n-plus-1': 'Optimize N+1 Database Queries',
    'large-file': 'Refactor Large Untested Module',
    'churn': 'Stabilize High-Churn Module'
  };
  const types = [...new Set(top3.map(p => p.type))];
  const feature = featureNames[pp.type] || pp.label;
  return `## Feature #${idx}: ${feature}

**Pain point:** ${pp.label} in \`${pp.file}\` (line ${pp.line})
**Type:** ${pp.type} | **Priority:** ${pp.priority} | **Code:** \`${pp.code}\`

**Acceptance Criteria:**
- [ ] Eliminate the ${pp.type} pattern in identified file(s)
- [ ] Add proper error handling or user feedback
- [ ] Existing behavior preserved
- [ ] Tests pass
- [ ] No new silent catch blocks introduced

**Estimated effort:** ${pp.type === 'missing-test' ? 'medium (60m)' : pp.type === 'large-file' ? 'medium (90m)' : 'small (30m)'}
`;
}

// ── Write daily-brief.md ──
const briefContent = `# 📋 APM Daily Brief — ${date}

> Generated by PM Agent scan at 08:00 WIB from ${painPoints.length} identified pain points

---

## Top 3 Features for Today

${top3.map((pp, i) => formatFeature(i + 1, pp)).join('\n---\n\n')}

---

## Full Scan Results (${painPoints.length} total)

| # | Type | Priority | File | Line |
|---|------|----------|------|------|
${ranked.map((pp, i) => `| ${i+1} | ${pp.priority} | ${pp.type} | \`${pp.file}:${pp.line}\` | ${pp.code.slice(0, 60)} |`).join('\n')}

---

## Stats

- **Backend files scanned:** ~${fs.readdirSync(SRC).length} modules
- **Frontend files scanned:** ${fs.existsSync(FRONTEND_SRC) ? fs.readdirSync(FRONTEND_SRC, { recursive: true }).filter(f => f.endsWith('.vue') || f.endsWith('.js')).length : 0} components
- **Total pain points:** ${painPoints.length}
  - P1 (critical): ${ranked.filter(p => p.priority === 'P1').length}
  - P2 (important): ${ranked.filter(p => p.priority === 'P2').length}
  - P3 (nice-to-have): ${ranked.filter(p => p.priority === 'P3').length}
`;

fs.writeFileSync(path.join(BACKEND, 'daily-brief.md'), briefContent);
console.log(`✅ daily-brief.md written with top 3 features`);
console.log(`   (Total: ${painPoints.length} pain points, P1: ${ranked.filter(p => p.priority === 'P1').length})`);

// Log for dashboard
console.log('\n📊 Top 3 features for today:');
top3.forEach((pp, i) => {
  console.log(`   ${i+1}. [${pp.priority}] ${pp.type}: ${pp.file}:${pp.line}`);
});
