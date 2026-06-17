// ═══════════════════════════════════════════
// USER PERSONA MODULE
// ═══════════════════════════════════════════

const PERSONA_CACHE_TTL_SEC = Number(process.env.PERSONA_CACHE_TTL_SEC || 3600)
const personaCache = new Map() // key: userId → { data, expiresAt }

// ── Table Init ──────────────────────────────

export function initPersonaTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_persona (
      user_id TEXT PRIMARY KEY,
      role TEXT CHECK(role IN ('trader','analyst','investor','researcher')) DEFAULT 'investor',
      risk_tolerance TEXT CHECK(risk_tolerance IN ('conservative','moderate','aggressive')) DEFAULT 'moderate',
      focus_sectors TEXT DEFAULT '[]',
      preferred_timeframe TEXT CHECK(preferred_timeframe IN ('intraday','swing','position','long_term')) DEFAULT 'swing',
      alert_style TEXT CHECK(alert_style IN ('brief','detailed','minimal')) DEFAULT 'brief',
      portfolio_holdings TEXT DEFAULT '[]',
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `)
  console.log('[persona] table ready')
}

// ── Cache helpers ───────────────────────────

function cacheGet(userId) {
  const entry = personaCache.get(userId)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) { personaCache.delete(userId); return null }
  return entry.data
}

function cacheSet(userId, data) {
  personaCache.set(userId, { data, expiresAt: Date.now() + PERSONA_CACHE_TTL_SEC * 1000 })
}

export function clearPersonaCache(userId) {
  if (userId) personaCache.delete(userId)
  else personaCache.clear()
}

// ── CRUD ────────────────────────────────────

const DEFAULT_PERSONA = {
  role: 'investor',
  risk_tolerance: 'moderate',
  focus_sectors: '[]',
  preferred_timeframe: 'swing',
  alert_style: 'brief',
  portfolio_holdings: '[]',
}

export function getPersona(db, userId) {
  const cached = cacheGet(userId)
  if (cached) return cached

  const row = db.prepare('SELECT * FROM user_persona WHERE user_id = ?').get(userId)
  if (row) {
    cacheSet(userId, row)
    return row
  }
  // Return defaults (not persisted yet)
  return { user_id: userId, ...DEFAULT_PERSONA, updated_at: null }
}

export function upsertPersona(db, userId, data = {}) {
  const allowed = ['role', 'risk_tolerance', 'focus_sectors', 'preferred_timeframe', 'alert_style', 'portfolio_holdings']
  const sets = []
  const vals = {}

  for (const key of allowed) {
    if (data[key] !== undefined) {
      let v = data[key]
      if (key === 'focus_sectors' || key === 'portfolio_holdings') {
        v = Array.isArray(v) ? JSON.stringify(v) : String(v)
      }
      sets.push(`${key} = @${key}`)
      vals[key] = v
    }
  }
  if (sets.length === 0) return getPersona(db, userId)

  const allFields = ['user_id', ...Object.keys(vals)]
  const placeholders = allFields.map(k => `@${k}`).join(',')
  const conflictUpdates = sets.join(', ')

  vals.user_id = userId

  db.prepare(`
    INSERT INTO user_persona (user_id, role, risk_tolerance, focus_sectors, preferred_timeframe, alert_style, portfolio_holdings, updated_at)
    VALUES (@user_id,
      COALESCE(@role, '${DEFAULT_PERSONA.role}'),
      COALESCE(@risk_tolerance, '${DEFAULT_PERSONA.risk_tolerance}'),
      COALESCE(@focus_sectors, '${DEFAULT_PERSONA.focus_sectors}'),
      COALESCE(@preferred_timeframe, '${DEFAULT_PERSONA.preferred_timeframe}'),
      COALESCE(@alert_style, '${DEFAULT_PERSONA.alert_style}'),
      COALESCE(@portfolio_holdings, '${DEFAULT_PERSONA.portfolio_holdings}'),
      datetime('now')
    )
    ON CONFLICT(user_id) DO UPDATE SET ${conflictUpdates}, updated_at = datetime('now')
  `).run(vals)

  clearPersonaCache(userId)
  return getPersona(db, userId)
}

// ── Inference from activity ─────────────────

export function inferPersonaFromActivity(db, userId) {
  let role = 'investor', risk = 'moderate', sectors = []

  try {
    // Check alert feedback patterns
    const feedbacks = db.prepare(
      `SELECT * FROM user_alert_feedback WHERE user_id = ? ORDER BY id DESC LIMIT 50`
    ).all(userId)

    if (feedbacks.length > 20) {
      // Heavy alert usage → trader or analyst
      const approved = feedbacks.filter(f => f.action === 'approve').length
      const rejected = feedbacks.filter(f => f.action === 'reject').length
      if (approved > rejected * 3) risk = 'aggressive'
      else if (rejected > approved * 2) risk = 'conservative'
    }

    // Check suggested alerts approved
    const alerts = db.prepare(
      `SELECT asset_slug, direction, reason FROM suggested_alerts WHERE user_id = ? ORDER BY id DESC LIMIT 30`
    ).all(userId)

    if (alerts.length > 10) role = 'trader'
    else if (alerts.length > 5) role = 'analyst'

    // Deduce sectors from alert asset slugs
    const slugs = alerts.map(a => a.asset_slug || '')
    if (slugs.length) {
      const sectorMap = {
        banking: ['bbca', 'bbri', 'bmri', 'bbni', 'bjbr', 'bnga'],
        crypto: ['btc', 'eth', 'sol', 'crypto'],
        mining: ['adro', 'ptba', 'itmg', 'bssr', 'hrtg'],
        tech: ['tlkm', 'excl', 'isat'],
        consumer: ['indf', 'icbp', 'klbf', 'smgr'],
        energy: ['adaro', 'pln', 'pertm'],
      }
      for (const [sector, keywords] of Object.entries(sectorMap)) {
        if (slugs.some(s => keywords.some(k => s.includes(k)))) sectors.push(sector)
      }
    }
  } catch { /* tables may not exist yet */ }

  const persona = {
    user_id: userId,
    role,
    risk_tolerance: risk,
    focus_sectors: JSON.stringify(sectors),
    preferred_timeframe: risk === 'aggressive' ? 'intraday' : risk === 'conservative' ? 'long_term' : 'swing',
    alert_style: role === 'trader' ? 'brief' : role === 'analyst' ? 'detailed' : 'brief',
    portfolio_holdings: '[]',
  }

  // Persist the inferred persona
  return upsertPersona(db, userId, persona)
}

// ── Context prompt builder ──────────────────

export function buildContextPrompt(persona, reportData = {}) {
  if (!persona) return ''

  const role = persona.role || 'investor'
  const risk = persona.risk_tolerance || 'moderate'
  let sectors = []
  try { sectors = JSON.parse(persona.focus_sectors || '[]') } catch { sectors = [] }
  const timeframe = persona.preferred_timeframe || 'swing'
  const style = persona.alert_style || 'brief'

  const sectorLine = sectors.length ? sectors.join(', ') : 'none specified'
  const depthHint = style === 'detailed' ? 'Include depth and rationale.' : style === 'minimal' ? 'Keep it very concise.' : 'Balanced brevity.'

  return `Briefing context: ${role} with ${risk} risk appetite. ` +
    `Focus sectors: ${sectorLine}. ` +
    `Timeframe: ${timeframe}. ` +
    `Style: ${style}. ${depthHint}`
}
