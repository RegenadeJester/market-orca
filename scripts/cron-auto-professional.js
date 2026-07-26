#!/usr/bin/env node
/**
 * Market Orca — Professional Auto Cron (02:00 WIB)
 * Comprehensive system health, security, optimization, and feature upgrade pipeline
 */

import { db } from '../backend/src/db.js'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE = path.join(__dirname, '..')
const LOG_DIR = path.join(BASE, 'logs', 'auto-pro')
const REPORT_FILE = path.join(LOG_DIR, `auto-pro-${new Date().toISOString().slice(0,10)}.json`)

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true })

const results = {
  timestamp: new Date().toISOString(),
  phase: 'started',
  checks: {},
  fixes: [],
  upgrades: [],
  security: [],
  recommendations: []
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(path.join(LOG_DIR, 'auto-pro.log'), line + '\n')
}

function runCmd(cmd, opts = {}) {
  try {
    const out = execSync(cmd, { encoding: 'utf8', timeout: opts.timeout || 60000, ...opts })
    return { ok: true, output: out.trim() }
  } catch (e) {
    return { ok: false, error: e.message, stdout: e.stdout?.toString() || '', stderr: e.stderr?.toString() || '' }
  }
}

async function phase1_HealthChecks() {
  log('=== PHASE 1: Health Checks ===')
  results.checks = {}

  // Backend
  const backend = runCmd('curl -s -o /dev/null -w "%{http_code}" http://localhost:4567/')
  results.checks.backend = backend.ok && backend.output === '200' ? 'healthy' : 'down'
  log(`Backend: ${results.checks.backend}`)

  // Report server
  const report = runCmd('curl -s -o /dev/null -w "%{http_code}" http://localhost:4568/')
  results.checks.report = report.ok && report.output === '200' ? 'healthy' : 'down'
  log(`Report: ${results.checks.report}`)

  // MCP
  const mcp = runCmd('curl -s -o /dev/null -w "%{http_code}" http://localhost:1788/health')
  results.checks.mcp = mcp.ok && mcp.output === '200' ? 'healthy' : 'down'
  log(`MCP: ${results.checks.mcp}`)



  // Database
  let assetCnt = 0
  try {
    const cnt = db.prepare('SELECT count(*) as n FROM assets').get().n
    assetCnt = cnt
    results.checks.database = cnt > 0 ? 'healthy' : 'empty'
  } catch {
    results.checks.database = 'error'
  }
  log(`Database: ${results.checks.database} (assets: ${assetCnt})`)

  // Disk space
  const disk = runCmd('df -h / | tail -1')
  if (disk.ok) results.checks.disk = disk.output
  log(`Disk: ${disk.output || 'unknown'}`)

  // Memory
  const mem = runCmd('free -h | grep Mem')
  if (mem.ok) results.checks.memory = mem.output
  log(`Memory: ${mem.output || 'unknown'}`)

  // PM2/Processes
  const pm2 = runCmd('pm2 list 2>/dev/null || echo "no pm2"')
  results.checks.processes = pm2.output
  log(`Processes: checked`)

  // Cloudflare tunnel
  const cf = runCmd('ps aux | grep cloudflared | grep -v grep')
  results.checks.tunnel = cf.ok ? 'running' : 'down'
  log(`Tunnel: ${results.checks.tunnel}`)
}

async function phase2_SecurityAudit() {
  log('=== PHASE 2: Security Audit ===')
  
  // 1. Check for exposed ports
  const ports = runCmd('ss -tlnp | grep -E ": (4567|4568|1788|5678)"')
  results.security.push({ check: 'exposed_ports', status: ports.ok ? 'ok' : 'unknown', detail: ports.output })

  // 2. Check SSH config
  const sshd = runCmd('grep -E "^(PermitRootLogin|PasswordAuthentication|PubkeyAuthentication)" /etc/ssh/sshd_config 2>/dev/null')
  results.security.push({ check: 'ssh_config', status: sshd.ok ? 'reviewed' : 'unavailable', detail: sshd.output })

  // 3. Check firewall
  const fw = runCmd('ufw status 2>/dev/null || iptables -L -n 2>/dev/null | head -20')
  results.security.push({ check: 'firewall', status: 'checked', detail: fw.output })

  // 4. Check for secrets in git history
  const secrets = runCmd('git log --all --oneline -p | grep -E "(password|token|secret|key).*=" | head -5')
  results.security.push({ check: 'git_secrets', status: secrets.ok && secrets.output ? 'LEAKED' : 'clean', detail: secrets.output || 'no secrets found' })

  // 5. Check .env files permissions
  const envPerms = runCmd('find . -name ".env*" -type f -exec ls -la {} \\; 2>/dev/null')
  results.security.push({ check: 'env_permissions', status: 'checked', detail: envPerms.output })

  // 6. Check for outdated npm packages
  const audit = runCmd('cd backend && npm audit --audit-level=high 2>/dev/null | tail -5')
  results.security.push({ check: 'npm_audit', status: audit.ok ? 'clean' : 'vulnerabilities', detail: audit.output })

  // 7. Docker security (if running)
  const docker = runCmd('docker ps --format "{{.Names}} {{.Image}}" 2>/dev/null')
  results.security.push({ check: 'docker_containers', status: docker.ok ? 'listed' : 'no_docker', detail: docker.output })

  log(`Security: ${results.security.length} checks completed`)
}

async function phase3_SystemOptimization() {
  log('=== PHASE 3: System Optimization ===')

  // 1. Clean old logs (>7 days)
  const oldLogs = runCmd(`find ${LOG_DIR} -name "*.log" -mtime +7 -delete && echo "cleaned"`)
  results.fixes.push({ action: 'clean_old_logs', result: oldLogs.ok ? 'done' : 'failed' })

  // 2. Vacuum SQLite
  try {
    db.exec('VACUUM; ANALYZE;')
    results.fixes.push({ action: 'sqlite_vacuum', result: 'done' })
    log('SQLite VACUUM + ANALYZE done')
  } catch (e) {
    results.fixes.push({ action: 'sqlite_vacuum', result: 'failed', error: e.message })
  }

  // 3. Clean node_modules cache
  const npmCache = runCmd('npm cache clean --force 2>/dev/null')
  results.fixes.push({ action: 'npm_cache_clean', result: npmCache.ok ? 'done' : 'failed' })

  // 4. Docker system prune (if docker running)
  const dockerPrune = runCmd('docker system prune -f 2>/dev/null | tail -3')
  results.fixes.push({ action: 'docker_prune', result: dockerPrune.ok ? 'done' : 'no_docker' })

  // 5. Rotate PM2 logs
  const pm2Flush = runCmd('pm2 flush 2>/dev/null')
  results.fixes.push({ action: 'pm2_flush_logs', result: pm2Flush.ok ? 'done' : 'no_pm2' })

  // 6. Check and fix file permissions
  const perms = runCmd('find backend -name "*.js" -type f ! -perm 644 -exec chmod 644 {} \\; 2>/dev/null && echo "fixed"')
  results.fixes.push({ action: 'fix_permissions', result: perms.ok ? 'done' : 'failed' })

  log(`Optimization: ${results.fixes.length} fixes applied`)
}

async function phase4_LogicStrengthening() {
  log('=== PHASE 4: Logic & Data Quality ===')

  // 1. Check for duplicate assets
  const dupAssets = db.prepare(`
    SELECT symbol, count(*) as c FROM assets GROUP BY symbol HAVING c > 1
  `).all()
  if (dupAssets.length) {
    results.recommendations.push({ type: 'data', issue: 'duplicate_assets', count: dupAssets.length, detail: dupAssets })
  }

  // 2. Check for stale RAG data
  const staleRag = db.prepare(`
    SELECT count(*) as n FROM rag_evidence_documents 
    WHERE datetime(fetched_at) < datetime('now', '-30 days')
  `).get()
  results.recommendations.push({ type: 'data', issue: 'stale_rag_docs', count: staleRag.n, detail: 'Docs older than 30 days' })

  // 3. Check for empty report sections
  let emptySections = []
  try {
    emptySections = db.prepare(`SELECT report_slug, block_key FROM report_blocks 
      WHERE (evidence_ids IS NULL OR evidence_ids = '[]' OR evidence_ids = '')
      LIMIT 20`).all()
  } catch {}
  if (emptySections.length) {
    results.recommendations.push({ type: 'report', issue: 'empty_sections', count: emptySections.length })
  }

  // 4. Check alert thresholds
  try {
    const alerts = db.prepare('SELECT count(*) as n FROM alerts').get()
    results.recommendations.push({ type: 'alerts', issue: 'active_alerts', count: alerts.n })
  } catch {}

  // 5. Check Discord delivery failures
  try {
    const failedDeliveries = db.prepare(`SELECT count(*) as n FROM delivery_log WHERE status = 'fail' AND datetime(created_at) > datetime('now', '-1 day')`).get()
    if (failedDeliveries?.n > 0) {
      results.recommendations.push({ type: 'delivery', issue: 'discord_failures', count: failedDeliveries.n })
    }
  } catch {}

  // 6. RAG quality check
  const ragStats = db.prepare('SELECT count(*) as docs, count(DISTINCT topic) as topics FROM rag_evidence_chunks').get()
  results.recommendations.push({ type: 'rag', issue: 'coverage', docs: ragStats.docs, topics: ragStats.topics })

  log(`Logic checks: ${results.recommendations.length} recommendations`)
}

async function phase5_FeatureUpgrades() {
  log('=== PHASE 5: Feature Upgrades ===')

  // 1. Check for new npm updates (non-breaking)
  const updates = runCmd('cd backend && npm outdated --depth=0 2>/dev/null | head -10')
  if (updates.ok && updates.output) {
    results.upgrades.push({ type: 'npm', available: updates.output.split('\n').length - 1, detail: updates.output })
  }

  // 2. Check for new SearXNG engine updates
  // (handled by container restart)

  // 3. Auto-generate daily report if not exists
  const today = new Date().toISOString().slice(0,10)
  const reportExists = fs.existsSync(path.join(BASE, 'reports', `${today}.json`))
  if (!reportExists) {
    const gen = runCmd('curl -s -X POST http://localhost:4567/api/ai-daily-report/generate -H "content-type: application/json" -d "{}"', { timeout: 180000 })
    results.upgrades.push({ type: 'daily_report', generated: gen.ok, detail: gen.output })
  }

  // 4. Run autolearn ingestion
  const autolearn = runCmd('curl -s -X POST http://localhost:4567/api/rag/autolearn/ingest -H "content-type: application/json" -d "{\"date\":\"' + today + '\"}"', { timeout: 120000 })
  results.upgrades.push({ type: 'autolearn', ingested: autolearn.ok, detail: autolearn.output })

  // 5. Update RAG vectors for new docs
  const vectorize = runCmd('curl -s -X POST http://localhost:4567/api/rag/vectorize-missing', { timeout: 60000 })
  results.upgrades.push({ type: 'rag_vectors', updated: vectorize.ok, detail: vectorize.output })

  log(`Upgrades: ${results.upgrades.length} tasks`)
}

async function phase6_SelfHealing() {
  log('=== PHASE 6: Self-Healing ===')

  const healing = []

  // 1. Restart unhealthy services
  if (results.checks.backend === 'down') {
    const r = runCmd('systemctl --user restart market-orca-backend')
    healing.push({ service: 'backend', action: 'restart', result: r.ok ? 'success' : 'failed' })
  }
  if (results.checks.report === 'down') {
    const r = runCmd('systemctl --user restart market-orca-report')
    healing.push({ service: 'report', action: 'restart', result: r.ok ? 'success' : 'failed' })
  }
  if (results.checks.mcp === 'down') {
    const r = runCmd('cd /home/dicky/.openclaw/workspace/market-orca/backend && nohup node src/mcp-http-server.js > /tmp/mcp-http.log 2>&1 &')
    healing.push({ service: 'mcp', action: 'restart', result: r.ok ? 'success' : 'failed' })
  }
  if (results.checks.searxng === 'down') {
    const r = runCmd('cd /home/dicky/.openclaw/workspace/market-orca && python3 scripts/searxng-lite.py &')
    healing.push({ service: 'searxng', action: 'restart', result: r.ok ? 'success' : 'failed' })
  }

  // 2. Fix cloudflared if down
  if (results.checks.tunnel === 'down') {
    const r = runCmd('nohup cloudflared tunnel --config /home/dicky/.openclaw/workspace/market-orca/config.yml --dns-server 1.1.1.1 --dns-server 8.8.8.8 run > /tmp/cf.log 2>&1 &')
    healing.push({ service: 'cloudflared', action: 'restart', result: r.ok ? 'success' : 'failed' })
  }

  // 3. Retry failed Discord deliveries
  try {
    const failed = db.prepare(`SELECT * FROM delivery_log WHERE status = 'fail' 
      AND datetime(created_at) > datetime('now', '-1 hour')`).all()
    for (const f of failed) {
      db.prepare(`UPDATE delivery_log SET status = 'pending', attempts = 0 WHERE id = ?`).run(f.id)
      healing.push({ service: 'discord', action: 'requeue_delivery', id: f.id })
    }
  } catch {}



  results.fixes.push(...healing)
  log(`Self-healing: ${healing.length} actions`)
}

async function main() {
  log('🚀 Starting Professional Auto Cron (02:00 WIB)')
  
  try { await phase1_HealthChecks() } catch (e) { log(`Phase 1 error: ${e.message}`) }
  try { await phase2_SecurityAudit() } catch (e) { log(`Phase 2 error: ${e.message}`) }
  try { await phase3_SystemOptimization() } catch (e) { log(`Phase 3 error: ${e.message}`) }
  try { await phase4_LogicStrengthening() } catch (e) { log(`Phase 4 error: ${e.message}`) }
  try { await phase5_FeatureUpgrades() } catch (e) { log(`Phase 5 error: ${e.message}`) }
  try { await phase6_SelfHealing() } catch (e) { log(`Phase 6 error: ${e.message}`) }

  results.phase = 'completed'
  results.summary = {
    healthy: Object.values(results.checks).filter(v => v === 'healthy').length,
    total_checks: Object.keys(results.checks).length,
    fixes_applied: results.fixes.length,
    security_issues: results.security.filter(s => s.status === 'LEAKED' || s.status === 'vulnerabilities').length,
    recommendations: results.recommendations.length,
    upgrades: results.upgrades.length
  }

  fs.writeFileSync(REPORT_FILE, JSON.stringify(results, null, 2))
  log(`✅ Complete. Report: ${REPORT_FILE}`)
  log(`Summary: ${JSON.stringify(results.summary)}`)

  // Send Discord summary if webhook configured
  const webhook = process.env.DISCORD_WEBHOOK_URL
  if (webhook) {
    const payload = {
      embeds: [{
        title: '🤖 Auto-Pro Cron Complete',
        color: results.summary.security_issues > 0 ? 0xff0000 : 0x00ff00,
        fields: [
          { name: 'Health', value: `${results.summary.healthy}/${results.summary.total_checks} healthy`, inline: true },
          { name: 'Fixes', value: results.summary.fixes_applied, inline: true },
          { name: 'Security', value: results.summary.security_issues > 0 ? '⚠️ Issues found' : '✅ Clean', inline: true },
          { name: 'Recommendations', value: results.summary.recommendations, inline: true },
          { name: 'Upgrades', value: results.summary.upgrades, inline: true }
        ],
        timestamp: new Date().toISOString()
      }]
    }
    await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .catch(() => log('Discord webhook failed'))
  }
}

main().catch(e => {
  log(`❌ Fatal: ${e.message}`)
  process.exit(1)
})
