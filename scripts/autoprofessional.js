#!/usr/bin/env node
/**
 * Autoprofessional — nightly 02:00 WIB system audit & upgrade bot
 * Scans: health, security, code quality, deps, performance, git, features
 * Auto-fixes where safe, generates markdown report
 */
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import http from 'node:http'

const __dirname = path.dirname(new URL(import.meta.url).pathname)
const ROOT = path.resolve(__dirname, '..')
const REPORTS = path.join(ROOT, 'backend', 'reports', 'ap')
fs.mkdirSync(REPORTS, { recursive: true })

const TS = new Date().toISOString()
const WIB = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
const report = { ts: TS, wib: WIB, services: {}, security: {}, code: {}, deps: {}, system: {}, git: {}, tools: {}, summary: [], fixes: [] }
let score = 100

// ── utils ──
const run = (cmd, timeout = 15000) => {
  try { return execSync(cmd, { encoding:'utf8', timeout, cwd: ROOT }).trim() }
  catch { return '' }
}
const checkPort = (port) => {
  try {
    const out = execSync(`ss -tlnp 'sport = :${port}'`, { encoding:'utf8', timeout:5000 })
    return out.includes('LISTEN')
  } catch { return false }
}
const httpGet = (url, timeout = 8000) => new Promise(resolve => {
  const req = http.get(url, { timeout }, res => {
    let data = ''
    res.on('data', c => data += c)
    res.on('end', () => resolve({ status: res.statusCode, data: data.slice(0,2000) }))
  })
  req.on('error', () => resolve(null))
  req.on('timeout', () => { req.destroy(); resolve(null) })
})

// ── 1. SERVICE HEALTH ──
const PORTS = { 'market-orca':4567, 'report-server':4568, 'mcp':1788, '9router':9090 }
for (const [name, port] of Object.entries(PORTS)) {
  const listening = checkPort(port)
  report.services[name] = { port, status: listening ? '✅' : '❌' }
  if (!listening) { score -= 10; report.summary.push(`❌ ${name} (port ${port}) NOT running`) }
}

// ── 2. SECURITY AUDIT ──
const security = {}
const mcpHealth = await httpGet('http://localhost:4567/mcp/health')
if (mcpHealth?.data?.includes('"auth":"none"')) {
  security.mcpAuth = 'DISABLED'
  score -= 15; report.summary.push('🔴 HIGH: MCP auth disabled — add MCP_AUTH_TOKEN')
} else {
  security.mcpAuth = 'enabled'
}

// Check for .env exposure
const envExists = fs.existsSync(path.join(ROOT, 'backend', '.env'))
const envGitignored = run('git check-ignore backend/.env') === 'backend/.env'
if (envExists && !envGitignored) {
  security.envExposed = true
  score -= 10; report.summary.push('🔴 .env not gitignored')
}

// Check MCP port is bound to localhost only
const mcpBind = run("ss -tlnp 'sport = :1788' | grep -oP '[\\d.:]+' | head -1")
if (mcpBind && !mcpBind.includes('127.0.0.1') && !mcpBind.includes('localhost')) {
  security.mcpPublicBind = true
  score -= 5; report.summary.push('⚠️ MCP bound outside localhost')
}

report.security = security

// ── 3. CODE QUALITY ──
const code = { files: 0, lines: 0, warnings: [] }
const dirs = ['backend/src', 'scripts']
for (const d of dirs) {
  const full = path.join(ROOT, d)
  if (!fs.existsSync(full)) continue
  const files = run(`find ${full} -name '*.js' -o -name '*.cjs' -o -name '*.py'`)
  for (const f of files.split('\n').filter(Boolean)) {
    try {
      const content = fs.readFileSync(f, 'utf8')
      code.files++
      code.lines += content.split('\n').length

      const execs = (content.match(/execSync\s*\(/g) || []).length
      if (execs > 3) code.warnings.push({ file: f.replace(ROOT+'/', ''), issue: `${execs}x execSync()`, severity: 'medium' })

      if (/eval\s*\(/.test(content) && !content.includes('JSON.parse')) {
        code.warnings.push({ file: f.replace(ROOT+'/', ''), issue: 'eval() detected', severity: 'high' })
        score -= 5
      }
    } catch {}
  }
}
if (code.warnings.length > 0) score -= Math.min(code.warnings.length * 2, 10)
report.code = code

// ── 4. DEPENDENCIES ──
const deps = {}
try {
  const audit = run('cd backend && npm audit --json 2>/dev/null', 30000)
  if (audit) {
    const parsed = JSON.parse(audit)
    deps.vulns = parsed.metadata?.vulnerabilities || {}
    if (deps.vulns.high || deps.vulns.critical) {
      score -= 10
      report.summary.push(`🔴 npm: ${deps.vulns.high||0} high, ${deps.vulns.critical||0} critical`)
    }
  }
} catch {}
report.deps = deps

// ── 5. SYSTEM RESOURCES ──
const sys = {}
sys.memory = run("free -h | awk '/Mem:/{print $3\"/\"$2}'")
sys.disk = run("df -h / | tail -1 | awk '{print $5\" used (\"$4\" free)\"}'")
sys.uptime = run('uptime -p')
sys.load = run("cat /proc/loadavg | awk '{print $1\", \"$2\", \"$3}'")

const memPct = Number(run("free | awk '/Mem:/{printf \"%.0f\", $3/$2*100}'"))
if (memPct > 85) { score -= 5; report.summary.push(`⚠️ Memory ${memPct}%`) }
const diskPct = Number(run("df / | tail -1 | awk '{gsub(/%/,\"\",$5); print $5}'"))
if (diskPct > 85) { score -= 5; report.summary.push(`⚠️ Disk ${diskPct}%`) }
report.system = sys

// ── 6. GIT HEALTH ──
const git = {}
git.branch = run('git rev-parse --abbrev-ref HEAD')
const uncommitted = run('git status --porcelain | wc -l')
git.uncommitted = Number(uncommitted) || 0
if (git.uncommitted > 10) { score -= 2; report.summary.push(`📝 ${git.uncommitted} uncommitted files`) }
const behind = run("git log --oneline HEAD..@{u} 2>/dev/null | wc -l")
git.behind = Number(behind) || 0
if (git.behind > 0) { score -= 2; report.summary.push(`📥 ${git.behind} commits behind remote`) }
report.git = git

// ── 7. TOOLS & FEATURES ──
const tools = {}

// MCP tools count
const mcpTools = await httpGet('http://localhost:4567/mcp/tools')
if (mcpTools?.data) {
  try {
    const parsed = JSON.parse(mcpTools.data)
    tools.mcpTools = parsed.tools?.length || 0
  } catch {}
}

// RAG stats
const ragStats = await httpGet('http://localhost:4567/mcp/tool/rag.storage_stats')
if (ragStats?.data) {
  try {
    const parsed = JSON.parse(ragStats.data)
    tools.ragDocs = parsed.results?.documents || 0
    tools.ragChunks = parsed.results?.chunks || 0
  } catch {}
}

report.tools = tools

// ── SCORE ──
report.healthScore = Math.max(0, Math.min(100, score))
report.grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : 'D'

// ── AUTO-FIXES (safe only) ──
try {
  const auditFix = run('cd backend && npm audit fix --audit-level=moderate 2>&1', 60000)
  if (auditFix.includes('added') || auditFix.includes('removed')) {
    report.fixes.push('✅ npm audit fix applied')
  }
} catch {}

// Git pull if clean
if (git.uncommitted === 0) {
  const pull = run('git pull --rebase 2>&1', 30000)
  if (pull.includes('Successfully rebased')) {
    report.fixes.push('✅ git pull --rebase')
  }
}

// ── WRITE REPORTS ──
const jsonPath = path.join(REPORTS, `autoprofessional-${TS.replace(/[:.]/g,'-')}.json`)
const mdPath = path.join(REPORTS, `autoprofessional-${TS.slice(0,10)}.md`)

fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2))

let md = `# 🔧 AutoProfessional — ${WIB}\n\n`
md += `**Score: ${report.healthScore}/100 (Grade ${report.grade})**\n\n`
md += `## 📡 Services\n| Service | Port | Status |\n|---------|------|--------|\n`
for (const [n, s] of Object.entries(report.services)) md += `| ${n} | ${s.port} | ${s.status} |\n`

if (report.summary.length) md += `\n## ⚠️ Issues\n${report.summary.map(s => `- ${s}`).join('\n')}\n`

md += `\n## 🛡️ Security\n- MCP Auth: ${security.mcpAuth}\n- .env exposed: ${security.envExposed ? 'YES' : 'no'}\n- MCP bind: ${security.mcpPublicBind ? 'PUBLIC' : 'localhost'}\n`

md += `\n## 💻 System\n- Memory: ${sys.memory}\n- Disk: ${sys.disk}\n- Uptime: ${sys.uptime}\n- Load: ${sys.load}\n`

md += `\n## 📊 Code\n- ${code.files} files, ${code.lines.toLocaleString()} lines\n- ${code.warnings.length} warnings\n`

md += `\n## 📦 Deps\n- Vulns: ${JSON.stringify(deps.vulns || {})}\n`

md += `\n## 🔧 Tools\n- MCP Tools: ${tools.mcpTools || '?'}\n- RAG: ${tools.ragDocs || 0} docs, ${tools.ragChunks || 0} chunks\n`

md += `\n## 📝 Git\n- Branch: ${git.branch}\n- Uncommitted: ${git.uncommitted}\n- Behind: ${git.behind}\n`

if (report.fixes.length) md += `\n## 🔨 Fixes Applied\n${report.fixes.join('\n')}\n`

md += `\n---\n*${TS} | AutoProfessional v2*\n`
fs.writeFileSync(mdPath, md)

// ── OUTPUT ──
const output = {
  ok: true,
  score: report.healthScore,
  grade: report.grade,
  issues: report.summary.length,
  warnings: code.warnings.length,
  fixes: report.fixes,
  report: mdPath
}
console.log(JSON.stringify(output, null, 2))
