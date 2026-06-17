/**
 * Indonesia Cron Jobs — periodic data fetching + alert scanning
 * Integrates with main server startup
 */
import { initIndonesiaSchema, saveYieldCurve, saveCompositeScore, saveMacroData, saveCryptoData, saveFearGreed, saveForeignFlow, saveMarketBreadth, saveSectorPerformance } from './indonesia-db.js'
import { fetchYieldCurve, fetchMacroData, fetchCryptoData, fetchFearGreed, fetchForeignFlows, fetchMarketBreadth, fetchSectorPerformance } from './indonesia-data-fetcher.js'
import { calculateCompositeScore } from './indonesia-indicators.js'
import { runIndonesiaAlertScan } from './indonesia-alerts.js'

// ── Cron schedule definitions ───────────────────────────────────
const CRON_JOBS = [
  {
    name: 'yield-curve',
    intervalMs: 6 * 3600_000,   // every 6 hours
    lastRun: 0,
    enabled: true,
    handler: refreshYieldCurve
  },
  {
    name: 'macro-data',
    intervalMs: 12 * 3600_000,  // every 12 hours (macro data changes slowly)
    lastRun: 0,
    enabled: true,
    handler: refreshMacroData
  },
  {
    name: 'crypto-idr',
    intervalMs: 5 * 60_000,     // every 5 minutes
    lastRun: 0,
    enabled: true,
    handler: refreshCryptoData
  },
  {
    name: 'fear-greed',
    intervalMs: 60 * 60_000,    // every hour
    lastRun: 0,
    enabled: true,
    handler: refreshFearGreed
  },
  {
    name: 'composite-score',
    intervalMs: 30 * 60_000,    // every 30 minutes
    lastRun: 0,
    enabled: true,
    handler: refreshCompositeScore
  },
  {
    name: 'sector-performance',
    intervalMs: 10 * 60_000,    // every 10 minutes (market hours only ideally)
    lastRun: 0,
    enabled: true,
    handler: refreshSectors
  },
  {
    name: 'market-breadth',
    intervalMs: 15 * 60_000,    // every 15 minutes
    lastRun: 0,
    enabled: true,
    handler: refreshBreadth
  },
  {
    name: 'foreign-flows',
    intervalMs: 60 * 60_000,    // every hour
    lastRun: 0,
    enabled: true,
    handler: refreshForeignFlows
  }
]

let timer = null

// ── Initialize & Start ──────────────────────────────────────────

export function initIndonesiaCron() {
  console.log('[indonesia-cron] Initializing schema...')
  initIndonesiaSchema()

  console.log('[indonesia-cron] Starting cron scheduler with', CRON_JOBS.length, 'jobs')
  timer = setInterval(tick, 60_000) // check every minute

  // Run composite score immediately on startup
  setTimeout(() => {
    refreshCompositeScore().catch(e => console.error('[indonesia-cron] initial composite score error:', e.message))
  }, 5000)
}

export function stopIndonesiaCron() {
  if (timer) clearInterval(timer)
  timer = null
  console.log('[indonesia-cron] Stopped')
}

function tick() {
  const now = Date.now()
  for (const job of CRON_JOBS) {
    if (!job.enabled) continue
    if (now - job.lastRun < job.intervalMs) continue
    job.lastRun = now
    job.handler().catch(e => console.error(`[indonesia-cron] ${job.name} error:`, e.message))
  }
}

// ── Individual refresh handlers ─────────────────────────────────

async function refreshYieldCurve() {
  console.log('[indonesia-cron] Refreshing yield curve...')
  const data = await fetchYieldCurve()
  if (data?.curve) {
    for (const [tenor, yieldPct] of Object.entries(data.curve)) {
      if (typeof yieldPct === 'number') saveYieldCurve(tenor, yieldPct, data.source || 'bi')
    }
  }
  return data
}

async function refreshMacroData() {
  console.log('[indonesia-cron] Refreshing macro data...')
  const data = await fetchMacroData()
  if (data?.indicators) {
    for (const [indicator, info] of Object.entries(data.indicators)) {
      saveMacroData(indicator, info.value, info.unit, info.period, info.source)
    }
  }
  return data
}

async function refreshCryptoData() {
  const data = await fetchCryptoData()
  if (data?.pairs) {
    for (const p of data.pairs) {
      if (p.price > 0) {
        saveCryptoData(p.pair, p.price, p.volume24h, p.change24h, p.high24h, p.low24h, 'binance')
      }
    }
  }
  return data
}

async function refreshFearGreed() {
  const data = await fetchFearGreed()
  if (data?.value != null) {
    saveFearGreed(data.value, data.classification, data.source)
  }
  return data
}

async function refreshCompositeScore() {
  console.log('[indonesia-cron] Calculating composite score...')
  const data = await calculateCompositeScore()
  if (data) {
    saveCompositeScore(data.compositeScore, data.zone, data.breakdown)
    // Run alert scan with new data
    const alerts = await runIndonesiaAlertScan(data)
    if (alerts.length) {
      console.log(`[indonesia-cron] ${alerts.length} Indonesia alerts fired`)
    }
  }
  return data
}

async function refreshSectors() {
  const data = await fetchSectorPerformance()
  if (data?.sectors) {
    for (const s of data.sectors) {
      saveSectorPerformance(s.code, s.name, s.changePct, 0, 0)
    }
  }
  return data
}

async function refreshBreadth() {
  const data = await fetchMarketBreadth()
  if (data) {
    saveMarketBreadth(data.advancing || 0, data.declining || 0, data.unchanged || 0, data.total_volume || 0, data.total_value || 0)
  }
  return data
}

async function refreshForeignFlows() {
  const data = await fetchForeignFlows()
  if (data?.flows) {
    if (data.flows.equity) saveForeignFlow('equity', data.flows.equity.net_buy_today, data.flows.equity.cumulative_ytd)
    if (data.flows.bond) saveForeignFlow('bond', data.flows.bond.net_buy_today, data.flows.bond.cumulative_ytd)
  }
  return data
}

export { CRON_JOBS }
