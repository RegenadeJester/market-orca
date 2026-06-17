/**
 * Indonesia Composite Crisis/Success Score
 *
 * Score 0–100 zones:
 *   0–30   Crisis
 *   30–50  Caution
 *   50–70  Stable
 *   70–85  Growth
 *   85–100 Booming
 *
 * Weights:
 *   25% — Yield curve shape
 *   25% — IHSG momentum (MA crossover, RSI, MACD)
 *   20% — Macro health (inflation, BI-Rate, IDR stability)
 *   15% — Crypto fear & greed
 *   15% — Foreign flows
 */
import { fetchYieldCurve, BI_RATE } from './fetcher-bi.js'
import { fetchIHSG, fetchIDRUSD } from './fetcher-yahoo.js'
import { fetchCryptoPrices } from './fetcher-coingecko.js'
import { fetchMacroData } from './fetcher-worldbank.js'
import { fetchFearGreedIndex } from './fetcher-fear-greed.js'
import { saveCrisisScore, getLatestCrisisScore } from './db.js'

const WEIGHTS = {
  yield_curve: 0.25,
  ihsg_momentum: 0.25,
  macro_health: 0.20,
  crypto_fear_greed: 0.15,
  foreign_flows: 0.15
}

// ── Yield Curve Score (25%) ────────────────────────────────────
export function calculateYieldCurveScore(curve) {
  if (!curve?.['2y'] || !curve?.['10y']) return 50
  const spread = curve['10y'] - curve['2y'] // positive = normal
  if (spread < -1.0) return 5    // deeply inverted
  if (spread < -0.5) return 15
  if (spread < -0.25) return 25
  if (spread < 0) return 35      // slightly inverted
  if (spread < 0.1) return 50    // flat
  if (spread < 0.3) return 65    // normal
  if (spread < 0.5) return 80    // healthy
  return 90                       // steep = normal/booming
}

// ── IHSG Momentum Score (25%) ─────────────────────────────────
export function calculateIHSGScore(bars) {
  if (!bars || bars.length < 5) return 50
  const closes = bars.map(b => b.close ?? b.value).filter(Boolean)
  if (closes.length < 5) return 50

  const latest = closes.at(-1)
  const ma5 = avg(closes.slice(-5))
  const ma20 = avg(closes.slice(-20))
  const ma50 = closes.length >= 50 ? avg(closes.slice(-50)) : ma20

  // RSI-14
  const rsi = calcRSI(closes, 14)

  // MACD (12, 26, 9)
  const macdResult = calcMACD(closes)

  let score = 50

  // MA crossover signals
  if (latest > ma5) score += 8
  if (latest > ma20) score += 8
  if (ma5 > ma20) score += 8   // golden cross-ish
  if (latest > ma50) score += 8

  // Momentum
  const prev5 = closes.length >= 6 ? closes.at(-6) : closes[0]
  const momentum = prev5 ? (latest - prev5) / prev5 : 0
  if (momentum > 0.05) score += 12
  else if (momentum > 0.02) score += 6
  else if (momentum < -0.05) score -= 12
  else if (momentum < -0.02) score -= 6

  // RSI signals
  if (rsi > 70) score -= 5    // overbought
  else if (rsi < 30) score += 5  // oversold = potential bounce
  else if (rsi > 50) score += 3
  else score -= 3

  // MACD histogram
  if (macdResult.histogram > 0) score += 5
  else score -= 5

  // Trend (20-day slope)
  const slope20 = closes.length >= 20 ? (closes.at(-1) - closes.at(-20)) / closes.at(-20) : 0
  if (slope20 > 0.05) score += 6
  else if (slope20 < -0.05) score -= 6

  return clamp(score)
}

// ── Macro Health Score (20%) ──────────────────────────────────
export function calculateMacroScore(indicators, idrUsdBars) {
  let score = 50

  // Inflation (target: 2–4% for Indonesia)
  const inflation = indicators?.inflation?.latest?.value ?? 2.5
  if (inflation >= 2 && inflation <= 4) score += 15
  else if (inflation >= 1.5 && inflation <= 5) score += 8
  else if (inflation > 6) score -= 25
  else score -= 5

  // BI-Rate vs inflation spread
  const biRate = BI_RATE
  const spread = biRate - inflation
  if (spread >= 1 && spread <= 4) score += 10
  else if (spread > 4) score -= 8  // too tight
  else if (spread < 0) score -= 15 // negative real rates

  // IDR stability
  const idrScore = idrUsdBars ? calcIDRScore(idrUsdBars) : 50
  score += (idrScore - 50) * 0.5

  // GDP growth
  const gdp = indicators?.gdp_growth?.latest?.value ?? 5.0
  if (gdp > 5) score += 10
  else if (gdp > 4) score += 5
  else if (gdp < 3) score -= 10

  return clamp(score)
}

function calcIDRScore(bars) {
  if (bars.length < 5) return 50
  const closes = bars.map(b => b.close ?? b.value).filter(Boolean)
  const latest = closes.at(-1)
  const weekAgo = closes[Math.max(0, closes.length - 6)]
  const monthAgo = closes[0]
  const changeWeek = (latest - weekAgo) / weekAgo
  let score = 50
  if (changeWeek < 0.005) score += 15
  else if (changeWeek < 0.01) score += 10
  else if (changeWeek < 0.02) score += 5
  else if (changeWeek > 0.03) score -= 20
  else if (changeWeek > 0.02) score -= 10
  const changeMonth = (latest - monthAgo) / monthAgo
  if (changeMonth < -0.01) score += 10
  else if (changeMonth > 0.03) score -= 15
  return clamp(score)
}

// ── Crypto Fear & Greed Score (15%) ───────────────────────────
export function calculateCryptoScore(fg) {
  if (!fg) return 50
  const v = fg.value ?? 50
  // Contrarian: extreme fear can be buying opportunity, extreme greed = risk
  if (v < 15) return 40   // extreme fear — caution but potential bottom
  if (v < 35) return 50
  if (v < 50) return 60
  if (v < 65) return 70
  if (v < 85) return 75   // moderate greed = healthy
  return 55               // extreme greed = euphoria risk
}

// ── Foreign Flows Score (15%) — simplified ─────────────────────
export function calculateForeignFlowsScore(flows) {
  // Placeholder: use IDR trend as proxy for foreign flows
  // Positive IDR trend = foreign inflow, negative = outflow
  if (!flows) return 50
  return 50 // default neutral until real KSEI data
}

// ── Composite Score Calculator ────────────────────────────────
export async function calculateCompositeScore() {
  const [yieldData, ihsgData, idrData, cryptoData, fgData, macroData] = await Promise.allSettled([
    fetchYieldCurve(),
    fetchIHSG(),
    fetchIDRUSD(),
    fetchCryptoPrices(),
    fetchFearGreedIndex(),
    fetchMacroData()
  ])

  const yieldVal = yieldData.status === 'fulfilled' ? yieldData.value : null
  const ihsgVal = ihsgData.status === 'fulfilled' ? ihsgData.value : null
  const idrVal = idrData.status === 'fulfilled' ? idrData.value : null
  const cryptoVal = cryptoData.status === 'fulfilled' ? cryptoData.value : null
  const fgVal = fgData.status === 'fulfilled' ? fgData.value : null
  const macroVal = macroData.status === 'fulfilled' ? macroData.value : null

  const ycScore = calculateYieldCurveScore(yieldVal?.curve)
  const ihsgScore = calculateIHSGScore(ihsgVal?.bars)
  const macroScore = calculateMacroScore(macroVal?.indicators, idrVal?.bars)
  const cryptoScore = calculateCryptoScore(fgVal)
  const flowsScore = calculateForeignFlowsScore(null)

  const breakdown = {
    yield_curve: ycScore,
    ihsg_momentum: ihsgScore,
    macro_health: macroScore,
    crypto_fear_greed: cryptoScore,
    foreign_flows: flowsScore
  }

  // Weighted composite
  let composite = 0
  let totalWeight = 0
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    if (breakdown[key] !== undefined) {
      composite += breakdown[key] * weight
      totalWeight += weight
    }
  }
  composite = totalWeight > 0 ? Math.round((composite / totalWeight * 10)) / 10 : 50

  const zone = scoreToZone(composite)

  // Save to DB
  saveCrisisScore(composite, zone, ycScore, ihsgScore, macroScore, cryptoScore, breakdown)

  return {
    compositeScore: composite,
    zone,
    breakdown,
    weights: WEIGHTS,
    details: {
      yieldCurve: yieldVal ? { curve: yieldVal.curve, source: yieldVal.source, status: yieldVal.status } : null,
      ihsg: ihsgVal ? { price: ihsgVal.currentPrice, changePercent: ihsgVal.changePercent } : null,
      idrUsd: idrVal?.currentRate,
      macro: macroVal?.indicators ? {
        inflation: macroVal.indicators.inflation?.latest?.value,
        gdpGrowth: macroVal.indicators.gdp_growth?.latest?.value,
        forexReserves: macroVal.indicators.forex_reserves?.latest?.value,
        currentAccount: macroVal.indicators.current_account?.latest?.value,
        unemployment: macroVal.indicators.unemployment?.latest?.value
      } : null,
      fearGreed: fgVal ? { value: fgVal.value, classification: fgVal.classification } : null,
      crypto: cryptoVal?.prices || null
    },
    calculatedAt: new Date().toISOString()
  }
}

// ── Crisis Signal Detection ───────────────────────────────────
export function detectCrisisSignals(data) {
  const signals = []
  if (!data) return signals

  const yc = data.breakdown?.yield_curve ?? 50
  const ihsg = data.breakdown?.ihsg_momentum ?? 50
  const macro = data.breakdown?.macro_health ?? 50
  const crypto = data.breakdown?.crypto_fear_greed ?? 50
  const flows = data.breakdown?.foreign_flows ?? 50

  if (yc < 30) signals.push({ type: 'yield_inversion', severity: 'critical', message: 'Yield curve inverted — recession signal', score: yc })
  if (ihsg < 25) signals.push({ type: 'ihsg_bearish', severity: 'critical', message: 'IHSG strong bearish momentum', score: ihsg })
  if (macro < 30) signals.push({ type: 'macro_deterioration', severity: 'critical', message: 'Macro indicators deteriorating', score: macro })
  if (crypto < 30) signals.push({ type: 'crypto_fear', severity: 'warning', message: 'Extreme crypto fear — market panic', score: crypto })
  if (flows < 30) signals.push({ type: 'foreign_outflow', severity: 'warning', message: 'Foreign capital outflow detected', score: flows })

  // Composite
  if (data.compositeScore < 30) signals.push({ type: 'composite_crisis', severity: 'critical', message: `Composite score ${data.compositeScore} — CRISIS ZONE`, score: data.compositeScore })

  // Booming signals
  if (data.compositeScore > 85) signals.push({ type: 'composite_booming', severity: 'info', message: `Composite score ${data.compositeScore} — BOOMING`, score: data.compositeScore })

  return signals
}

// ── Helpers ───────────────────────────────────────────────────
function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0 }
function clamp(v, min = 0, max = 100) { return Math.max(min, Math.min(max, Math.round(v))) }

function scoreToZone(score) {
  if (score < 30) return 'crisis'
  if (score < 50) return 'caution'
  if (score < 70) return 'stable'
  if (score < 85) return 'growth'
  return 'booming'
}

// ── RSI-14 ────────────────────────────────────────────────────
function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50
  let gains = 0, losses = 0
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff > 0) gains += diff; else losses -= diff
  }
  if (losses === 0) return 100
  const rs = gains / losses
  return clamp(100 - 100 / (1 + rs), 0, 100)
}

// ── MACD (12, 26, 9) ─────────────────────────────────────────
function calcMACD(closes, fast = 12, slow = 26, signal = 9) {
  if (closes.length < slow + signal) return { macd: 0, signal: 0, histogram: 0 }
  const emaFast = ema(closes, fast)
  const emaSlow = ema(closes, slow)
  const macdLine = []
  for (let i = 0; i < emaFast.length; i++) {
    macdLine.push(emaFast[i] - emaSlow[i])
  }
  const signalLine = ema(macdLine.filter(v => v !== undefined), signal)
  const macd = macdLine.at(-1) || 0
  const sig = signalLine.at(-1) || 0
  return { macd: Number(macd.toFixed(2)), signal: Number(sig.toFixed(2)), histogram: Number((macd - sig).toFixed(2)) }
}

function ema(data, period) {
  const k = 2 / (period + 1)
  const result = [data[0]]
  for (let i = 1; i < data.length; i++) {
    if (data[i] == null) { result.push(result.at(-1)); continue }
    result.push(data[i] * k + result.at(-1) * (1 - k))
  }
  return result
}

export { WEIGHTS, scoreToZone }
export default { calculateCompositeScore, calculateYieldCurveScore, calculateIHSGScore, calculateMacroScore, calculateCryptoScore, detectCrisisSignals }
