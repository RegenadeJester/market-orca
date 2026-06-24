/**
 * Indonesia Express Router — 7 endpoints
 * GET /api/indonesia/composite — composite crisis/success score
 * GET /api/indonesia/ihsg      — IHSG data with technicals
 * GET /api/indonesia/crypto    — crypto prices in IDR
 * GET /api/indonesia/macro     — macro indicators (World Bank)
 * GET /api/indonesia/yield-curve — yield curve data
 * GET /api/indonesia/signals   — crisis/success signals
 * GET /api/indonesia/overview  — batch all data (composite, yield, ihsg, macro, crypto, fear-greed, signals)
 */
import { Router } from 'express'
import { calculateCompositeScore, calculateYieldCurveScore, calculateIHSGScore, calculateMacroScore, detectCrisisSignals } from './indicator-calculator.js'
import { fetchYieldCurve, BI_RATE } from './fetcher-bi.js'
import { fetchIHSG, fetchIDXStocks, fetchIDRUSD } from './fetcher-yahoo.js'
import { fetchCryptoPrices, fetchCryptoHistory } from './fetcher-coingecko.js'
import { fetchFearGreedIndex } from './fetcher-fear-greed.js'
import { fetchMacroData } from './fetcher-worldbank.js'
import { getLatestCrisisScore, getCrisisScoreHistory, getLatestIHSG, getLatestCrypto, getLatestFearGreed, getLatestMacro, getLatestIDRUSD, getYieldCurveLatest } from './db.js'

const router = Router()

// ── 1. COMPOSITE SCORE ────────────────────────────────────────
router.get('/composite', async (req, res) => {
  try {
    // Check cache (5 min)
    const cached = getLatestCrisisScore()
    if (cached) {
      const age = Date.now() - new Date(cached.created_at).getTime()
      if (age < 300_000) {
        return res.json({
          ok: true,
          compositeScore: cached.composite_score,
          zone: cached.zone,
          breakdown: {
            yield_curve: cached.yield_curve_score,
            ihsg_momentum: cached.ihsg_score,
            macro_health: cached.macro_score,
            crypto_fear_greed: cached.crypto_score,
            foreign_flows: 50
          },
          history: getCrisisScoreHistory(30),
          cached: true,
          fetchedAt: new Date().toISOString()
        })
      }
    }

    const result = await calculateCompositeScore()
    const history = getCrisisScoreHistory(30)
    res.json({ ok: true, ...result, history, cached: false })
  } catch (e) {
    console.error('[indonesia-router] /composite error:', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ── 2. IHSG ───────────────────────────────────────────────────
router.get('/ihsg', async (req, res) => {
  try {
    const range = req.query.range || '6mo'
    const ihsg = await fetchIHSG(range)
    const stocks = await fetchIDXStocks(range).catch(() => null)
    const idr = await fetchIDRUSD(range).catch(() => null)

    // Compute IHSG score from bars
    const ihsgScore = calculateIHSGScore(ihsg?.bars)

    res.json({
      ok: true,
      ihsg: {
        symbol: ihsg.symbol,
        price: ihsg.currentPrice,
        change: ihsg.change,
        changePercent: Number((ihsg.changePercent || 0).toFixed(2)),
        score: ihsgScore
      },
      stocks: stocks?.stocks || [],
      idrUsd: idr ? { rate: idr.currentRate, changePercent: Number((idr.changePercent || 0).toFixed(2)) } : null,
      bars: (ihsg.bars || []).slice(-60), // last 60 days for chart
      fetchedAt: new Date().toISOString()
    })
  } catch (e) {
    // Fallback to DB cache
    const cached = getLatestIHSG()
    if (cached) {
      return res.json({
        ok: true,
        ihsg: { symbol: '^JKSE', price: cached.close, change: 0, changePercent: 0, score: 50 },
        stocks: [],
        bars: [],
        fetchedAt: new Date().toISOString(),
        cached: true
      })
    }
    console.error('[indonesia-router] /ihsg error:', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ── 3. CRYPTO ─────────────────────────────────────────────────
router.get('/crypto', async (req, res) => {
  try {
    const coin = req.query.coin // optional: bitcoin, ethereum, etc.
    if (coin) {
      const history = await fetchCryptoHistory(coin, parseInt(req.query.days) || 365)
      const prices = await fetchCryptoPrices().catch(() => null)
      return res.json({ ok: true, coin, history: history.prices, current: prices?.prices?.find(p => p.coin === coin), fetchedAt: new Date().toISOString() })
    }
    const data = await fetchCryptoPrices()
    res.json({ ok: true, prices: data.prices, fetchedAt: data.fetchedAt })
  } catch (e) {
    const cached = getLatestCrypto()
    if (cached.length) {
      return res.json({ ok: true, prices: cached.map(r => ({ coin: r.coin, price_idr: r.price_idr, change_24h: r.change_24h })), cached: true, fetchedAt: new Date().toISOString() })
    }
    console.error('[indonesia-router] /crypto error:', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ── 4. MACRO ──────────────────────────────────────────────────
router.get('/macro', async (req, res) => {
  try {
    const data = await fetchMacroData()
    const cached = getLatestMacro()
    res.json({
      ok: true,
      indicators: data.indicators,
      cachedMacro: cached,
      status: data.status,
      fetchedAt: data.fetchedAt
    })
  } catch (e) {
    const cached = getLatestMacro()
    if (cached.length) {
      return res.json({ ok: true, indicators: {}, cachedMacro: cached, cached: true, fetchedAt: new Date().toISOString() })
    }
    console.error('[indonesia-router] /macro error:', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ── 5. YIELD CURVE ───────────────────────────────────────────
router.get('/yield-curve', async (req, res) => {
  try {
    const data = await fetchYieldCurve()
    const curve = data.curve || {}
    const spread = (curve['10y'] ?? 5.35) - (curve['2y'] ?? 5.55)
    const inverted = spread < 0
    const ycScore = calculateYieldCurveScore(curve)

    res.json({
      ok: true,
      curve,
      source: data.source,
      status: data.status,
      spread2y10y: Number(spread.toFixed(4)),
      inverted,
      score: ycScore,
      biRate: BI_RATE,
      interpretation: inverted ? 'INVERTED — recession signal' : spread < 0.1 ? 'FLAT — caution' : 'NORMAL — healthy',
      fetchedAt: new Date().toISOString()
    })
  } catch (e) {
    const cached = getYieldCurveLatest()
    if (cached?.length) {
      const curve = {}
      for (const r of cached) curve[r.tenor] = r.yield_pct
      return res.json({ ok: true, curve, source: 'cache', cached: true, fetchedAt: new Date().toISOString() })
    }
    console.error('[indonesia-router] /yield-curve error:', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ── 6. SIGNALS ────────────────────────────────────────────────
router.get('/signals', async (req, res) => {
  try {
    const cached = getLatestCrisisScore()
    let data
    if (cached) {
      data = {
        compositeScore: cached.composite_score,
        zone: cached.zone,
        breakdown: {
          yield_curve: cached.yield_curve_score,
          ihsg_momentum: cached.ihsg_score,
          macro_health: cached.macro_score,
          crypto_fear_greed: cached.crypto_score,
          foreign_flows: 50
        }
      }
    } else {
      data = await calculateCompositeScore()
    }

    const signals = detectCrisisSignals(data)
    const fg = getLatestFearGreed()

    res.json({
      ok: true,
      compositeScore: data.compositeScore,
      zone: data.zone,
      signals,
      fearGreed: fg ? { value: fg.value, classification: fg.classification } : null,
      signalCount: signals.length,
      criticalCount: signals.filter(s => s.severity === 'critical').length,
      fetchedAt: new Date().toISOString()
    })
  } catch (e) {
    console.error('[indonesia-router] /signals error:', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ── 7. OVERVIEW (batch) ────────────────────────────────────────
router.get('/overview', async (req, res) => {
  try {
    // Fetch all sections in parallel
    const [compositeResult, yieldResult, ihsgResult, macroResult, cryptoResult, fgResult] = await Promise.allSettled([
      calculateCompositeScore(),
      fetchYieldCurve(),
      Promise.all([fetchIHSG('6mo'), fetchIDXStocks('6mo').catch(() => null), fetchIDRUSD('6mo').catch(() => null)]),
      fetchMacroData(),
      fetchCryptoPrices(),
      fetchFearGreedIndex()
    ])

    const composite = compositeResult.status === 'fulfilled' ? compositeResult.value : null
    const yieldCurve = yieldResult.status === 'fulfilled' ? yieldResult.value : null
    const ihsgData = ihsgResult.status === 'fulfilled' ? ihsgResult.value : null
    const macroData = macroResult.status === 'fulfilled' ? macroResult.value : null
    const cryptoData = cryptoResult.status === 'fulfilled' ? cryptoResult.value : null
    const fgData = fgResult.status === 'fulfilled' ? fgResult.value : null

    // Compute signals from composite if available
    const signals = composite ? detectCrisisSignals(composite) : []

    // Build IHSG response
    const ihsg = ihsgData ? {
      ihsg: {
        symbol: ihsgData[0]?.symbol,
        price: ihsgData[0]?.currentPrice,
        change: ihsgData[0]?.change,
        changePercent: Number((ihsgData[0]?.changePercent || 0).toFixed(2))
      },
      stocks: ihsgData[1]?.stocks || [],
      idrUsd: ihsgData[2] ? { rate: ihsgData[2].currentRate, changePercent: Number((ihsgData[2].changePercent || 0).toFixed(2)) } : null,
      bars: (ihsgData[0]?.bars || []).slice(-60)
    } : null

    // Build yield curve response
    const yc = yieldCurve?.curve || {}
    const spread2y10y = Number(((yc['10y'] ?? 5.35) - (yc['2y'] ?? 5.55)).toFixed(4))

    const result = {
      ok: true,
      composite: composite ? {
        compositeScore: composite.compositeScore,
        zone: composite.zone,
        breakdown: composite.breakdown,
        history: getCrisisScoreHistory(30)
      } : null,
      yieldCurve: yieldCurve ? {
        curve: yc,
        source: yieldCurve.source,
        status: yieldCurve.status,
        spread2y10y,
        inverted: spread2y10y < 0,
        score: calculateYieldCurveScore(yc),
        biRate: BI_RATE,
        interpretation: spread2y10y < 0 ? 'INVERTED — recession signal' : spread2y10y < 0.1 ? 'FLAT — caution' : 'NORMAL — healthy'
      } : null,
      ihsg,
      macro: macroData ? { indicators: macroData.indicators, status: macroData.status } : null,
      crypto: cryptoData ? { prices: cryptoData.prices } : null,
      fearGreed: fgData ? { value: fgData.value, classification: fgData.classification } : null,
      signals,
      alerts: [],
      fetchedAt: new Date().toISOString()
    }
    res.json(result)
  } catch (e) {
    console.error('[indonesia-router] /overview error:', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

export default router
