/**
 * Indonesia Composite Crisis/Success Score — weighted multi-indicator model
 * Score 0-100: 0-30 crisis, 30-60 caution, 60-80 healthy, 80-100 booming
 */
import { getYieldCurveHistory, getLatestCompositeScore, getLatestFearGreed } from './indonesia-db.js'
import { getIHSGData, getForexData } from './market-data.js'
import { fetchYieldCurve, fetchMacroData, fetchForeignFlows } from './indonesia-data-fetcher.js'

// ── Indicator weights ───────────────────────────────────────────
const WEIGHTS = {
  yield_curve:  0.20,
  ihsg_trend:   0.20,
  idr_stability: 0.15,
  foreign_flow: 0.10,
  cds_spread:   0.05,
  inflation_bi: 0.15,
  credit_gdp:   0.10,
  fear_greed:   0.05
}

// ── Yield Curve Shape Score ─────────────────────────────────────
// 100 = perfectly normal (upward slope), 0 = deeply inverted
function scoreYieldCurve(curve) {
  const y2 = curve['2y'] ?? 5.5
  const y10 = curve['10y'] ?? 5.35
  const spread = y10 - y2  // positive = normal, negative = inverted

  // Spread ranges from -100bps (deep inversion) to +200bps (steep)
  if (spread < -1) return 0       // deeply inverted
  if (spread < -0.5) return 10
  if (spread < -0.25) return 20
  if (spread < 0) return 30       // slightly inverted
  if (spread < 0.1) return 50     // flat
  if (spread < 0.3) return 70     // normal
  if (spread < 0.5) return 85     // healthy
  return 100                       // steep/booming
}

// ── IHSG Trend Score ────────────────────────────────────────────
// Uses MA crossover + momentum
function scoreIhsgTrend(bars) {
  if (!bars || bars.length < 5) return 50  // neutral default

  const closes = bars.map(b => b.close ?? b.value).filter(Boolean)
  if (closes.length < 5) return 50

  const latest = closes.at(-1)
  const ma5 = avg(closes.slice(-5))
  const ma20 = avg(closes.slice(-20))
  const ma50 = closes.length >= 50 ? avg(closes.slice(-50)) : ma20

  // Momentum: 5-day return
  const prev5 = closes.length >= 6 ? closes.at(-6) : closes[0]
  const momentum = prev5 ? (latest - prev5) / prev5 : 0

  let score = 50

  // MA crossover signals
  if (latest > ma5) score += 10
  if (latest > ma20) score += 10
  if (ma5 > ma20) score += 10  // golden cross-ish
  if (latest > ma50) score += 10

  // Momentum
  if (momentum > 0.03) score += 15      // strong upward
  else if (momentum > 0.01) score += 5
  else if (momentum < -0.03) score -= 15 // strong downward
  else if (momentum < -0.01) score -= 5

  // Trend (20-day slope)
  const slope20 = closes.length >= 20 ? (closes.at(-1) - closes.at(-20)) / closes.at(-20) : 0
  if (slope20 > 0.05) score += 10
  else if (slope20 < -0.05) score -= 10

  return clamp(score)
}

// ── IDR Stability Score ─────────────────────────────────────────
function scoreIdrStability(forexBars) {
  if (!forexBars || forexBars.length < 2) return 50

  const closes = forexBars.map(b => b.close ?? b.value).filter(Boolean)
  if (closes.length < 2) return 50

  // USD/IDR — higher = weaker IDR
  const latest = closes.at(-1)
  const weekAgo = closes[Math.max(0, closes.length - 6)]
  const monthAgo = closes[0]

  const changeWeek = (latest - weekAgo) / weekAgo
  const changeMonth = (latest - monthAgo) / monthAgo

  let score = 50

  // Stable = good for IDR
  if (changeWeek < 0.005) score += 15   // barely moved
  else if (changeWeek < 0.01) score += 10
  else if (changeWeek < 0.02) score += 5
  else if (changeWeek > 0.03) score -= 20  // sharp weakening
  else if (changeWeek > 0.02) score -= 10

  // Monthly trend
  if (changeMonth < -0.01) score += 10    // IDR strengthening
  else if (changeMonth > 0.03) score -= 15 // IDR weakening month

  return clamp(score)
}

// ── Foreign Flow Score ──────────────────────────────────────────
function scoreForeignFlow(flow) {
  if (!flow) return 50

  const netBuy = flow.equity?.net_buy_today || 0

  if (netBuy > 500) return 90        // strong inflow
  if (netBuy > 100) return 75
  if (netBuy > 0) return 60
  if (netBuy > -100) return 40
  if (netBuy > -500) return 25
  return 10                           // strong outflow
}

// ── CDS Spread Score ────────────────────────────────────────────
function scoreCdsSpread(spread) {
  if (!spread) return 50

  // Lower spread = lower perceived risk = higher score
  if (spread < 80) return 90
  if (spread < 100) return 75
  if (spread < 120) return 60
  if (spread < 150) return 45
  if (spread < 200) return 30
  return 15
}

// ── Inflation vs BI-Rate Score ──────────────────────────────────
function scoreInflationBI(macro) {
  const inflation = macro?.inflation?.value ?? 2.5
  const biRate = macro?.bi_rate?.value ?? 5.75

  // Spread = bi rate - inflation (positive = tight, negative = loose)
  const spread = biRate - inflation

  // Ideal range: 2-4% inflation, spread 2-3%
  let score = 50

  // Inflation in target range (2-4%) is good
  if (inflation >= 2 && inflation <= 4) score += 20
  else if (inflation >= 1.5 && inflation <= 5) score += 10
  else if (inflation > 6) score -= 30
  else score -= 10

  // Reasonable rate differential
  if (spread >= 1 && spread <= 4) score += 15
  else if (spread > 4) score -= 10  // too tight

  return clamp(score)
}

// ── Credit Growth vs GDP Score ──────────────────────────────────
function scoreCreditGDP(macro) {
  const creditGrowth = macro?.credit_growth?.value ?? 8.5
  const gdpGrowth = macro?.gdp_growth?.value ?? 5.0

  // Healthy: credit growth slightly above GDP = credit expansion
  const ratio = gdpGrowth > 0 ? creditGrowth / gdpGrowth : 1

  if (ratio >= 1.2 && ratio <= 1.8) return 85  // healthy credit expansion
  if (ratio >= 0.8 && ratio <= 1.2) return 70  // normal
  if (ratio >= 1.8 && ratio <= 2.5) return 50  // getting overheated
  if (ratio > 2.5) return 20                     // credit bubble risk
  if (ratio < 0.8) return 40                     // credit contraction
  return 50
}

// ── Fear & Greed Score ──────────────────────────────────────────
function scoreFearGreed(fg) {
  if (!fg) return 50
  const v = fg.value ?? 50
  // Mirror: Fear → market cautious (not necessarily bad)
  // Extreme Fear (0-25) can be contrarian bullish
  // We use a nuanced mapping:
  // 0-15 (Extreme Fear) → 35 (caution, but potential bottom)
  // 15-35 (Fear) → 45
  // 35-50 (Neutral-low) → 55
  // 50-65 (Neutral-high) → 65
  // 65-85 (Greed) → 75
  // 85-100 (Extreme Greed) → 60 (euphoria risk)
  if (v < 15) return 35
  if (v < 35) return 45
  if (v < 50) return 55
  if (v < 65) return 65
  if (v < 85) return 75
  return 60
}

// ── Composite Calculator ────────────────────────────────────────

export async function calculateCompositeScore() {
  // Gather all data
  const [yieldData, macroData, ihsgData, forexBorrowData, fgData, flowData] = await Promise.all([
    fetchYieldCurve().catch(() => null),
    fetchMacroData().catch(() => null),
    getIHSGData().catch(() => null),
    getForexData().catch(() => null),
    fetchFearGreed().catch(() => null),
    fetchForeignFlows().catch(() => null),
  ])

  const curve = yieldData?.curve || {}
  const bars = ihsgData?.chart || []
  const forexBars = forexBorrowData?.pairs?.[0]?.chart || []
  const macro = macroData?.indicators || {}
  const cdsSpread = null  // TODO: fetch from data

  const breakdown = {
    yield_curve: scoreYieldCurve(curve),
    ihsg_trend: scoreIhsgTrend(bars),
    idr_stability: scoreIdrStability(forexBars),
    foreign_flow: scoreForeignFlow(flowData),
    cds_spread: scoreCdsSpread(cdsSpread),
    inflation_bi: scoreInflationBI(macro),
    credit_gdp: scoreCreditGDP(macro),
    fear_greed: scoreFearGreed(fgData),
  }

  // Weighted average
  let composite = 0
  let totalWeight = 0
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    if (breakdown[key] !== undefined) {
      composite += breakdown[key] * weight
      totalWeight += weight
    }
  }
  composite = totalWeight > 0 ? Math.round((composite / totalWeight) * 100) / 100 : 50

  const zone = scoreToZone(composite)

  return {
    compositeScore: Math.round(composite * 10) / 10,
    zone,
    breakdown,
    weights: WEIGHTS,
    data: {
      yieldCurve: curve,
      ihsg: { price: ihsgData?.price, change: ihsgData?.changePercent },
      idrUsd: forexBorrowData?.pairs?.[0]?.price,
      macro: {
        inflation: macro?.inflation?.value,
        biRate: macro?.bi_rate?.value,
        gdpGrowth: macro?.gdp_growth?.value,
        creditGrowth: macro?.credit_growth?.value,
        forexReserves: macro?.forex_reserves?.value,
        currentAccount: macro?.current_account?.value,
      },
      fearGreed: fgData ? { value: fgData.value, classification: fgData.classification } : null,
      foreignFlow: flowData?.flows || null,
    },
    weightsApplied: totalWeight,
    calculatedAt: new Date().toISOString(),
    yieldCurveInverted: (curve['2y'] ?? 5.5) > (curve['10y'] ?? 5.35),
    yieldSpread: ((curve['10y'] ?? 5.35) - (curve['2y'] ?? 5.5))
  }
}

function scoreToZone(score) {
  if (score < 30) return 'crisis'
  if (score < 60) return 'caution'
  if (score < 80) return 'healthy'
  return 'booming'
}

// ── Helpers ─────────────────────────────────────────────────────

function avg(arr) {
  if (!arr.length) return 0
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

function clamp(val, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(val)))
}

export { WEIGHTS, scoreToZone }
