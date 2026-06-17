/**
 * Indonesia Cron — auto-refresh all data every hour
 * Start: import and call startIndonesiaCron() from server.js
 */
import { initIndonesiaTables } from './db.js'
import { fetchYieldCurve } from './fetcher-bi.js'
import { fetchIHSG, fetchIDXStocks, fetchIDRUSD } from './fetcher-yahoo.js'
import { fetchCryptoPrices } from './fetcher-coingecko.js'
import { fetchFearGreedIndex } from './fetcher-fear-greed.js'
import { fetchMacroData } from './fetcher-worldbank.js'
import { calculateCompositeScore } from './indicator-calculator.js'

let timer = null
let lastRun = 0

const INTERVALS = {
  yield_curve:   6 * 3600_000,  // 6 hours
  ihsg:          1 * 3600_000,  // 1 hour
  idr_usd:       1 * 3600_000,  // 1 hour
  idx_stocks:    1 * 3600_000,  // 1 hour
  crypto:        5 * 60_000,    // 5 minutes
  fear_greed:    1 * 3600_000,  // 1 hour
  macro:         12 * 3600_000, // 12 hours
  composite:     30 * 60_000,   // 30 minutes
}

const lastRunByTask = {}

function shouldRun(task) {
  const last = lastRunByTask[task] || 0
  if (Date.now() - last >= INTERVALS[task]) return true
  return false
}

async function runTask(name, fn) {
  try {
    lastRunByTask[name] = Date.now()
    await fn()
    console.log(`[indonesia-cron] ${name} refreshed`)
  } catch (e) {
    console.error(`[indonesia-cron] ${name} error:`, e.message)
  }
}

async function tick() {
  if (shouldRun('yield_curve'))   await runTask('yield_curve', fetchYieldCurve)
  if (shouldRun('ihsg'))          await runTask('ihsg', () => fetchIHSG('6mo'))
  if (shouldRun('idr_usd'))       await runTask('idr_usd', () => fetchIDRUSD('6mo'))
  if (shouldRun('idx_stocks'))    await runTask('idx_stocks', () => fetchIDXStocks('3mo'))
  if (shouldRun('crypto'))        await runTask('crypto', fetchCryptoPrices)
  if (shouldRun('fear_greed'))    await runTask('fear_greed', fetchFearGreedIndex)
  if (shouldRun('macro'))         await runTask('macro', fetchMacroData)
  if (shouldRun('composite'))     await runTask('composite', async () => {
    const result = await calculateCompositeScore()
    console.log(`[indonesia-cron] composite: ${result.compositeScore}/100 (${result.zone})`)
  })
}

export function startIndonesiaCron() {
  console.log('[indonesia-cron] Initializing Indonesia tables...')
  initIndonesiaTables()
  console.log('[indonesia-cron] Starting cron scheduler (check every 60s)')
  timer = setInterval(tick, 60_000)

  // Initial fetch after 5s
  setTimeout(async () => {
    console.log('[indonesia-cron] Running initial data fetch...')
    try {
      await fetchYieldCurve()
      await fetchIHSG('6mo')
      await fetchIDRUSD('6mo')
      await fetchCryptoPrices()
      await fetchFearGreedIndex()
      await fetchMacroData()
      const score = await calculateCompositeScore()
      console.log(`[indonesia-cron] Initial composite: ${score.compositeScore}/100 (${score.zone})`)
    } catch (e) {
      console.error('[indonesia-cron] Initial fetch error:', e.message)
    }
  }, 5000)
}

export function stopIndonesiaCron() {
  if (timer) clearInterval(timer)
  timer = null
  console.log('[indonesia-cron] Stopped')
}

export { INTERVALS }
