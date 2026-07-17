// Market Holiday & No-Data Edge Handler
// Tracks market hours and holiday calendars for IDX, NYSE, NASDAQ, Crypto
// Returns data_freshness per asset: live | stale | holiday | closed

// IDX holidays 2026 (Indonesia)
const IDX_HOLIDAYS = new Set([
  '2026-01-01', // Tahun Baru
  '2026-01-28', // Isra Miraj
  '2026-01-29', // Tahun Baru Imlek
  '2026-03-11', // Hari Suci Nyepi
  '2026-03-31', // Wafat Isa Almasih
  '2026-04-03', // Cuti Nyepi
  '2026-04-10', // Cuti Bersama
  '2026-04-17', // Cuti Bersama
  '2026-05-01', // Hari Buruh
  '2026-05-04', // Cuti Bersama
  '2026-05-07', // Kenaikan Isa Almasih
  '2026-05-21', // Hari Raya Waisak
  '2026-05-26', // Cuti Bersama
  '2026-05-27', // Cuti Bersama
  '2026-06-01', // Hari Lahir Pancasila
  '2026-06-07', // Idul Adha
  '2026-06-08', // Cuti Bersama Idul Adha
  '2026-06-26', // 1 Muharram
  '2026-07-07', // Cuti Bersama
  '2026-08-17', // HUT RI
  '2026-08-28', // Cuti Bersama
  '2026-10-02', // Maulid Nabi
  '2026-12-24', // Cuti Bersama
  '2026-12-25', // Natal
  '2026-12-28', // Cuti Bersama
  '2026-12-29', // Cuti Bersama
  '2026-12-30', // Cuti Bersama
  '2026-12-31', // Cuti Bersama
])

// NYSE/NASDAQ holidays 2026
const US_HOLIDAYS = new Set([
  '2026-01-01', // New Year
  '2026-01-19', // MLK Day
  '2026-02-16', // Presidents Day
  '2026-04-03', // Good Friday
  '2026-05-25', // Memorial Day
  '2026-06-19', // Juneteenth
  '2026-07-03', // Independence Day (observed)
  '2026-09-07', // Labor Day
  '2026-11-26', // Thanksgiving
  '2026-12-25', // Christmas
])

// Weekend check
function isWeekend(d = new Date()) {
  const day = d.getUTCDay()
  return day === 0 || day === 6
}

// Get YYYY-MM-DD from date
function dateStr(d = new Date()) {
  return d.toISOString().slice(0, 10)
}

// Market operating hours in UTC
const MARKET_HOURS = {
  idx:     { open: 2, close: 9 },   // IDX 09:00-15:30 WIB → 02:00-08:30 UTC (approx)
  nyse:    { open: 14, close: 21 }, // NYSE 09:30-16:00 ET → 13:30-20:00 UTC (summer)
  nasdaq:  { open: 14, close: 21 }, // Same as NYSE
  crypto:  { open: 0, close: 24 },  // 24/7
  forex:   { open: 0, close: 24 },  // 24/5
}

// Classify asset market type
function assetMarketType(asset = {}) {
  const slug = (asset.slug || asset.symbol || '').toLowerCase()
  const market = (asset.market || '').toLowerCase()
  if (['btc','eth','sol','xrp','ada','doge','dot','link','matic','avax','bnb','atom','near','ftm','algo','ltc','bch','xlm','trx','etc','vet','theta','fil','egld','hbar','icp','apt','sui','op','arb','ldo','crv','aave','uni','sushi','cake','grt','ocean','fet','agix','rndr','akash'].includes(slug)) return 'crypto'
  if (['usdidr','eurusd','gbpusd','jpyusd','audusd','nzdusd','usdcad','usdchf','usdjpy','eurjpy','gbpjpy'].includes(slug)) return 'forex'
  if (['jkse','lq45','idxi','comp'].includes(slug)) return 'idx'
  if (market === 'idx' || market === 'id' || /^(bb|ji|tp|cn|jb|mr|by|rm|tg|ex|sm|bt|kr|wk)/i.test(slug)) return 'idx'
  return 'nyse' // default US stock
}

// Check if market is currently open
function isMarketOpen(marketType, now = new Date()) {
  if (marketType === 'crypto') return true // 24/7
  if (marketType === 'forex') return !isWeekend(now)

  const holidaySet = marketType === 'idx' ? IDX_HOLIDAYS : US_HOLIDAYS
  const today = dateStr(now)

  // Check holiday
  if (holidaySet.has(today)) return false

  // Check weekend
  if (isWeekend(now)) return false

  // Check hours
  const hours = MARKET_HOURS[marketType] || MARKET_HOURS.nyse
  const h = now.getUTCHours() + now.getUTCMinutes() / 60
  return h >= hours.open && h < hours.close
}

// Get market status label
function marketStatus(marketType, now = new Date()) {
  if (marketType === 'crypto') return { data_freshness: 'live', label: 'Live 24/7', detail: '' }

  const holidaySet = marketType === 'idx' ? IDX_HOLIDAYS : US_HOLIDAYS
  const today = dateStr(now)

  if (holidaySet.has(today)) {
    const holidayName = getHolidayName(marketType, today)
    return { data_freshness: 'holiday', label: 'Pasar Libur', detail: holidayName }
  }

  if (isWeekend(now)) {
    return { data_freshness: 'closed', label: 'Pasar Tutup', detail: 'Weekend' }
  }

  const hours = MARKET_HOURS[marketType] || MARKET_HOURS.nyse
  const h = now.getUTCHours() + now.getUTCMinutes() / 60

  if (h >= hours.open && h < hours.close) {
    return { data_freshness: 'live', label: 'Live', detail: '' }
  }

  // Market closed for the day
  const nextOpen = new Date(now)
  nextOpen.setUTCHours(hours.open, 0, 0, 0)
  if (h >= hours.close) nextOpen.setUTCDate(nextOpen.getUTCDate() + 1)
  // Skip weekends/holidays for next open
  let attempts = 0
  while (attempts < 14) {
    if (!isWeekend(nextOpen) && !holidaySet.has(dateStr(nextOpen))) break
    nextOpen.setUTCDate(nextOpen.getUTCDate() + 1)
    attempts++
  }
  const hoursUntil = ((nextOpen - now) / 3600000).toFixed(1)
  return { data_freshness: 'closed', label: 'Pasar Tutup', detail: `Buka ~${hoursUntil} jam lagi` }
}

// Get asset freshness for report display
export function getAssetFreshness(asset = {}, now = new Date()) {
  const type = assetMarketType(asset)
  return { ...marketStatus(type, now), market_type: type }
}

// Get consolidated data status block for report
export function buildDataStatusBlock(assets = [], now = new Date()) {
  const types = [...new Set(assets.map(a => assetMarketType(a)))]
  const statuses = types.map(t => {
    const st = marketStatus(t, now)
    return `- **${tLabel(t)}**: ${st.label}${st.detail ? ' — ' + st.detail : ''}`
  })
  return `## Data Status\n${statuses.join('\n')}`
}

function tLabel(t) {
  return { idx:'IDX/Indonesia', nyse:'NYSE/NASDAQ (US)', nasdaq:'NASDAQ (US)', crypto:'Crypto', forex:'Forex' }[t] || t
}

function getHolidayName(marketType, dateStr) {
  const sets = marketType === 'idx' ? IDX_HOLIDAYS : US_HOLIDAYS
  return sets.has(dateStr) ? 'Hari Libur Pasar' : ''
}

// Check if any significant portion of data is stale/holiday
// Note: only 'stale' data_freshness counts as stale — 'closed' is expected off-hours
export function dataFreshnessQA(assets = [], now = new Date()) {
  if (!assets.length) return { pass: true, staleCount: 0, holidayCount: 0, total: 0 }
  let staleCount = 0, holidayCount = 0, closedCount = 0, liveCount = 0
  for (const a of assets) {
    const f = getAssetFreshness(a, now)
    if (f.data_freshness === 'stale') staleCount++
    else if (f.data_freshness === 'holiday') holidayCount++
    else if (f.data_freshness === 'closed') closedCount++
    else if (f.data_freshness === 'live') liveCount++
  }
  // Only stale (actual old data) triggers warning; closed is normal off-hours
  const staleRatio = assets.length ? staleCount / assets.length : 0
  const pass = staleRatio <= 0.3
  return {
    pass,
    staleCount,
    holidayCount,
    closedCount,
    liveCount,
    total: assets.length,
    staleRatio: Number(staleRatio.toFixed(2)),
    warning: !pass ? `>30% data stale (${Math.round(staleRatio*100)}%) — beberapa sumber perlu diperbarui` : undefined,
  }
}

// API endpoint handler
export function getMarketCalendarStatus(req, res) {
  const now = new Date()
  const assets = req.query?.assets
    ? String(req.query.assets).split(',').map(s => ({ slug: s.trim() }))
    : []
  const results = assets.map(a => ({ slug: a.slug, ...getAssetFreshness(a, now) }))
  const summary = {}
  for (const t of ['crypto','forex','idx','nyse']) {
    const r = marketStatus(t, now)
    summary[t] = { label: r.label, detail: r.detail, data_freshness: r.data_freshness }
  }
  res.json({ ok: true, now: now.toISOString(), summary, assets: results.length ? results : undefined })
}
