/**
 * Indonesia API Routes — Express router
 * Mount in server.js: app.use('/api/indonesia', indonesiaRoutes)
 */
import { Router } from 'express'
import { calculateCompositeScore } from './indonesia-indicators.js'
import { runIndonesiaAlertScan, getIndonesiaAlertHistory, getIndonesiaAlertStats, INDICATOR_ALERTS } from './indonesia-alerts.js'
import {
  getYieldCurveHistory, getYieldCurveOverTime, getLatestCompositeScore, getCompositeScoreHistory,
  getMacroData, getLatestCryptoData, getLatestFearGreed, getFearGreedHistory,
  getLatestSectorPerformance, getLatestMarketBreadth, getBreadthHistory,
  getForeignFlowHistory, listAlertConfigs, setAlertConfig
} from './indonesia-db.js'
import {
  fetchYieldCurve, fetchMacroData, fetchCryptoData, fetchFearGreed,
  fetchForeignFlows, fetchMarketBreadth, fetchSectorPerformance
} from './indonesia-data-fetcher.js'
import { getIHSGData, getForexData, getMarketOverview } from './market-data.js'
import { getTradingViewTechnical } from './mcp-tradingview.js'
import { CRON_JOBS } from './indonesia-cron.js'

const router = Router()

// ── 1. YIELD CURVE ──────────────────────────────────────────────

router.get('/yield-curve', async (req, res) => {
  try {
    const curve = await fetchYieldCurve()
    const history = getYieldCurveHistory()
    const inverted = (curve.curve?.['2y'] ?? 5.5) > (curve.curve?.['10y'] ?? 5.35)
    const spread2y10y = ((curve.curve?.['10y'] ?? 5.35) - (curve.curve?.['2y'] ?? 5.5))

    res.json({
      ok: true,
      ...curve,
      currentTenors: history,
      inverted,
      spread2y10y: Number(spread2y10y.toFixed(4)),
      interpretation: inverted ? 'INVERTED — recession signal' : spread2y10y < 0.1 ? 'FLAT — caution' : 'NORMAL — healthy',
      fetchedAt: new Date().toISOString()
    })
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

router.get('/yield-curve/history', (req, res) => {
  try {
    const tenor = req.query.tenor || '10y'
    const days = Math.min(parseInt(req.query.days) || 30, 365)
    res.json({ ok: true, tenor, data: getYieldCurveOverTime(tenor, days) })
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ── 2. COMPOSITE SCORE ─────────────────────────────────────────

router.get('/composite-score', async (req, res) => {
  try {
    // Check if we have a recent cached score (within 5 min)
    const cached = getLatestCompositeScore()
    if (cached) {
      const age = Date.now() - new Date(cached.created_at).getTime()
      if (age < 300_000) {
        return res.json({ ok: true, ...JSON.parse(cached.breakdown_json), compositeScore: cached.score, zone: cached.zone, cached: true })
      }
    }

    const result = await calculateCompositeScore()
    const history = getCompositeScoreHistory(30)

    res.json({
      ok: true,
      ...result,
      history,
      cached: false,
      fetchedAt: new Date().toISOString()
    })
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

router.get('/composite-score/history', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 30, 365)
    res.json({ ok: true, data: getCompositeScoreHistory(limit) })
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ── 3. IHSG DASHBOARD ──────────────────────────────────────────

router.get('/ihsg', async (req, res) => {
  try {
    const ihsg = await getIHSGData()
    const breadth = getLatestMarketBreadth()
    const sectors = getLatestSectorPerformance()

    // Get TradingView technicals for ^JKSE
    const technicals = await getTradingViewTechnical('%5EJKSE').catch(() => null)

    res.json({
      ok: true,
      ihsg,
      breadth: breadth || { advancing: 0, declining: 0, unchanged: 0 },
      sectors: sectors || [],
      technicals: technicals || null,
      fetchedAt: new Date().toISOString()
    })
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

router.get('/ihsg/technicals', async (req, res) => {
  try {
    const data = await getTradingViewTechnical('%5EJKSE')
    res.json({ ok: true, ...data })
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

router.get('/ihsg/breadth', (req, res) => {
  try {
    const latest = getLatestMarketBreadth()
    const history = getBreadthHistory(30)
    res.json({ ok: true, latest, history })
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

router.get('/ihsg/sectors', async (req, res) => {
  try {
    const data = await fetchSectorPerformance()
    res.json({ ok: true, ...data })
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ── 4. CRYPTO ──────────────────────────────────────────────────

router.get('/crypto', async (req, res) => {
  try {
    const data = await fetchCryptoData()
    res.json({ ok: true, ...data })
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ── 5. MACRO ───────────────────────────────────────────────────

router.get('/macro', async (req, res) => {
  try {
    const data = await fetchMacroData()
    const indicators = data?.indicators || {}

    // Enrich with historical data from DB
    const enriched = {}
    for (const [key, info] of Object.entries(indicators)) {
      const history = getMacroData(key, 12)
      enriched[key] = { ...info, history }
    }

    res.json({ ok: true, indicators: enriched, fetchedAt: data.fetchedAt })
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ── 6. FEAR & GREED ────────────────────────────────────────────

router.get('/fear-greed', async (req, res) => {
  try {
    const data = await fetchFearGreed()
    res.json({ ok: true, ...data })
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ── 7. FOREIGN FLOWS ───────────────────────────────────────────

router.get('/foreign-flows', async (req, res) => {
  try {
    const data = await fetchForeignFlows()
    const history = getForeignFlowHistory(30)
    res.json({ ok: true, ...data, history })
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ── 8. IDR / FOREX ─────────────────────────────────────────────

router.get('/forex', async (req, res) => {
  try {
    const data = await getForexData()
    res.json({ ok: true, ...data })
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ── 9. ALERTS ──────────────────────────────────────────────────

router.get('/alerts', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200)
    res.json({ ok: true, alerts: getIndonesiaAlertHistory(limit), stats: getIndonesiaAlertStats() })
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

router.get('/alerts/config', (req, res) => {
  try {
    res.json({ ok: true, configs: listAlertConfigs(), alertTypes: Object.entries(INDICATOR_ALERTS).map(([k, v]) => ({ key: k, label: v.label, severity: v.severity })) })
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

router.put('/alerts/config/:indicator', (req, res) => {
  try {
    const result = setAlertConfig(req.params.indicator, req.body)
    res.json(result)
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ── 10. OVERVIEW — combined dashboard data ─────────────────────

router.get('/overview', async (req, res) => {
  try {
    const [yieldData, ihsgData, forexData, cryptoData, fgData, macroData, sectorData, breadthData, flowData] = await Promise.allSettled([
      fetchYieldCurve(),
      getIHSGData(),
      getForexData(),
      fetchCryptoData(),
      fetchFearGreed(),
      fetchMacroData(),
      fetchSectorPerformance(),
      fetchMarketBreadth(),
      fetchForeignFlows(),
    ])

    const latestScore = getLatestCompositeScore()

    res.json({
      ok: true,
      yieldCurve: yieldData.status === 'fulfilled' ? yieldData.value : null,
      ihsg: ihsgData.status === 'fulfilled' ? ihsgData.value : null,
      forex: forexData.status === 'fulfilled' ? forexData.value : null,
      crypto: cryptoData.status === 'fulfilled' ? cryptoData.value : null,
      fearGreed: fgData.status === 'fulfilled' ? fgData.value : null,
      macro: macroData.status === 'fulfilled' ? macroData.value?.indicators : null,
      sectors: sectorData.status === 'fulfilled' ? sectorData.value?.sectors : [],
      breadth: breadthData.status === 'fulfilled' ? breadthData.value : null,
      foreignFlows: flowData.status === 'fulfilled' ? flowData.value : null,
      compositeScore: latestScore ? { score: latestScore.score, zone: latestScore.zone, breakdown: JSON.parse(latestScore.breakdown_json) } : null,
      fetchedAt: new Date().toISOString()
    })
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ── 11. REFRESH — manual trigger ───────────────────────────────

router.post('/refresh', async (req, res) => {
  try {
    const result = await calculateCompositeScore()
    res.json({ ok: true, compositeScore: result })
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ── 12. CRON STATUS ────────────────────────────────────────────

router.get('/cron-status', (req, res) => {
  const status = CRON_JOBS.map(j => ({
    name: j.name,
    enabled: j.enabled,
    intervalMs: j.intervalMs,
    lastRun: j.lastRun ? new Date(j.lastRun).toISOString() : null,
    nextRun: j.lastRun ? new Date(j.lastRun + j.intervalMs).toISOString() : null
  }))
  res.json({ ok: true, jobs: status })
})

export default router
