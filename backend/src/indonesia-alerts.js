/**
 * Indonesia Alert System — threshold-based alerts for economic indicators
 * Integrates with existing Discord alert pipeline
 */
import { db } from './db.js'
import { getAlertConfig } from './indonesia-db.js'
import { sendDiscordAlert } from './discord.js'
import { APP_CONFIG } from './config.js'

// ── Fired cooldown map (indicator → last fire timestamp) ────────
const fired = new Map()
const COOLDOWN_MS = 3600_000  // 1 hour between same-type alerts

// ── Alert Definitions ───────────────────────────────────────────

export const INDICATOR_ALERTS = {
  yield_curve_inversion: {
    label: '🇮🇩 Yield Curve Inverted',
    severity: 'critical',
    check: (data) => {
      const inverted = data.yieldCurveInverted
      const spread = data.yieldSpread
      return inverted ? { triggered: true, value: spread, message: `2Y-10Y spread: ${spread.toFixed(2)}%. Classic recession signal.` } : null
    }
  },

  composite_score_crisis: {
    label: '🔴 Composite Score: Crisis Zone',
    severity: 'critical',
    check: (data) => {
      if (data.compositeScore < 30) return { triggered: true, value: data.compositeScore, message: `Composite score ${data.compositeScore}/100 — CRISIS ZONE. Multiple indicators flashing red.` }
      return null
    }
  },

  composite_score_booming: {
    label: '🟢 Composite Score: Booming',
    severity: 'info',
    check: (data) => {
      if (data.compositeScore > 80) return { triggered: true, value: data.compositeScore, message: `Composite score ${data.compositeScore}/100 — BOOMING. All indicators positive.` }
      return null
    }
  },

  ihsg_drop_1d: {
    label: '📉 IHSG Sharp Drop',
    severity: 'warning',
    check: (data) => {
      const change = data.ihsg?.change
      const cfg = getAlertConfig('ihsg_drop_1d')
      const threshold = cfg?.threshold_low ?? -3
      if (change != null && change <= threshold) return { triggered: true, value: change, message: `IHSG dropped ${change.toFixed(2)}% today — below ${threshold}% threshold.` }
      return null
    }
  },

  idr_weaken_1d: {
    label: '💱 IDR Weakening',
    severity: 'warning',
    check: (data) => {
      const idrRate = data.idrUsd
      if (!idrRate) return null
      // Alert if USD/IDR > 16500 (significant weakening)
      const cfg = getAlertConfig('idr_weaken_1d')
      const threshold = 16500
      if (idrRate > threshold) return { triggered: true, value: idrRate, message: `USD/IDR at ${idrRate.toFixed(0)} — above ${threshold} threshold. IDR weakening.` }
      return null
    }
  },

  inflation_spike: {
    label: '🔥 Inflation Above Target',
    severity: 'warning',
    check: (data) => {
      const inflation = data.data?.macro?.inflation
      const cfg = getAlertConfig('inflation_spike')
      const threshold = cfg?.threshold_high ?? 6
      if (inflation != null && inflation > threshold) return { triggered: true, value: inflation, message: `Inflation at ${inflation}% — above ${threshold}% BI target ceiling.` }
      return null
    }
  },

  fear_extreme: {
    label: '😱 Extreme Market Fear',
    severity: 'warning',
    check: (data) => {
      const fg = data.data?.fearGreed?.value
      if (fg != null && fg < 15) return { triggered: true, value: fg, message: `Fear & Greed Index at ${fg} — Extreme Fear. Market panic.` }
      return null
    }
  },

  foreign_outflow: {
    label: '🏦 Foreign Capital Outflow',
    severity: 'warning',
    check: (data) => {
      const netBuy = data.data?.foreignFlow?.equity?.net_buy_today
      if (netBuy != null && netBuy < -500) return { triggered: true, value: netBuy, message: `Foreign equity outflow: IDR ${Math.abs(netBuy).toFixed(0)}B — significant selloff.` }
      return null
    }
  }
}

// ── Alert Scanner ───────────────────────────────────────────────

export async function runIndonesiaAlertScan(compositeData) {
  if (!compositeData) return []

  const triggered = []

  for (const [key, def] of Object.entries(INDICATOR_ALERTS)) {
    const cfg = getAlertConfig(key)
    if (!cfg || cfg.enabled === 0) continue

    const result = def.check(compositeData)
    if (!result || !result.triggered) continue

    // Cooldown check
    const now = Date.now()
    const lastFire = fired.get(key)
    if (lastFire && now - lastFire < COOLDOWN_MS) continue

    // Fire alert
    const alertRecord = {
      indicator: key,
      severity: def.severity,
      title: def.label,
      message: result.message,
      currentValue: result.value,
      thresholdValue: cfg.threshold_low || cfg.threshold_high,
    }

    // Store in DB
    db.prepare(`INSERT INTO indo_alert_history (indicator, severity, title, message, current_value, threshold_value, discord_sent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`)
      .run(alertRecord.indicator, alertRecord.severity, alertRecord.title, alertRecord.message, alertRecord.currentValue, alertRecord.thresholdValue, 0)

    // Send Discord
    try {
      await sendDiscordAlert({
        title: alertRecord.title,
        message: alertRecord.message,
        slug: 'indonesia-indicators',
        symbol: key,
        price: alertRecord.currentValue,
        changePercent: 0,
        detailUrl: `${APP_CONFIG.publicBaseUrl}/indonesia`,
      })
      db.prepare(`UPDATE indo_alert_history SET discord_sent = 1 WHERE indicator = ? AND id = (SELECT MAX(id) FROM indo_alert_history WHERE indicator = ?)`).run(key, key)
    } catch (e) {
      console.error('[indonesia-alert-discord-error]', key, e.message)
    }

    // Update last fired
    db.prepare(`UPDATE indo_alert_config SET last_fired_at = datetime('now') WHERE indicator = ?`).run(key)
    fired.set(key, now)
    triggered.push(alertRecord)
  }

  return triggered
}

// ── Alert Query Helpers ─────────────────────────────────────────

export function getIndonesiaAlertHistory(limit = 50) {
  return db.prepare('SELECT * FROM indo_alert_history ORDER BY id DESC LIMIT ?').all(limit)
}

export function getIndonesiaAlertStats() {
  return db.prepare(`
    SELECT indicator, severity, COUNT(*) AS count, MAX(created_at) AS last_fired
    FROM indo_alert_history
    GROUP BY indicator, severity
    ORDER BY last_fired DESC
  `).all()
}
