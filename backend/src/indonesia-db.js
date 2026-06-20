/**
 * Indonesia Economic Indicators — SQLite schema extensions
 * Extends market.db with Indonesia-specific tables
 */
import { db } from './db.js'

export function initIndonesiaSchema() {
  db.exec(`

CREATE TABLE IF NOT EXISTS indo_yield_curve (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenor TEXT NOT NULL,                          /* 3m, 6m, 1y, 2y, 5y, 10y, 20y, 30y */
  yield_pct REAL NOT NULL,
  source TEXT DEFAULT 'bi',
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenor, fetched_at)
);

CREATE INDEX IF NOT EXISTS idx_indo_yield_curve_tenor ON indo_yield_curve(tenor, fetched_at DESC);

CREATE TABLE IF NOT EXISTS indo_composite_score (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  score REAL NOT NULL,                          /* 0-100 composite */
  zone TEXT NOT NULL,                           /* crisis, caution, healthy, booming */
  breakdown_json TEXT NOT NULL DEFAULT '{}',    /* individual indicator scores */
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS indo_macro_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  indicator TEXT NOT NULL,                      /* inflation, bi_rate, cad, reserves, gdp, credit_growth */
  value REAL NOT NULL,
  unit TEXT DEFAULT '',
  period TEXT NOT NULL,                         /* 2025-01, 2025-Q1, etc */
  source TEXT DEFAULT 'bi',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(indicator, period)
);

CREATE TABLE IF NOT EXISTS indo_sector_performance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sector TEXT NOT NULL,                         /* IDX sector codes */
  name TEXT NOT NULL,
  change_pct REAL DEFAULT 0,
  volume REAL DEFAULT 0,
  market_cap REAL DEFAULT 0,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS indo_market_breadth (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  advancing INTEGER DEFAULT 0,
  declining INTEGER DEFAULT 0,
  unchanged INTEGER DEFAULT 0,
  total_volume REAL DEFAULT 0,
  total_value REAL DEFAULT 0,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS indo_crypto_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pair TEXT NOT NULL,                           /* BTC/IDR, ETH/IDR, etc */
  price REAL NOT NULL,
  volume_24h REAL DEFAULT 0,
  change_24h_pct REAL DEFAULT 0,
  high_24h REAL DEFAULT 0,
  low_24h REAL DEFAULT 0,
  source TEXT DEFAULT 'binance',
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS indo_fear_greed (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  value INTEGER NOT NULL,                       /* 0-100 */
  classification TEXT NOT NULL,                 /* Extreme Fear, Fear, Neutral, Greed, Extreme Greed */
  source TEXT DEFAULT 'alternative.me',
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS indo_foreign_flow (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market TEXT NOT NULL,                         /* equity, bond */
  net_buy REAL DEFAULT 0,                       /* IDR billions */
  cumulative_ytd REAL DEFAULT 0,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS indo_cds_spread (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenor TEXT DEFAULT '5y',
  spread_bps REAL NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS indo_alert_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  indicator TEXT UNIQUE NOT NULL,               /* yield_curve_inversion, composite_score, ihsg_drop, idr_weaken, etc */
  enabled INTEGER DEFAULT 1,
  threshold_high REAL,
  threshold_low REAL,
  discord_channel TEXT DEFAULT '',
  last_fired_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS indo_alert_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  indicator TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',         /* info, warning, critical */
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  current_value REAL,
  threshold_value REAL,
  discord_sent INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

`)

  // Seed default alert configs if empty
  const count = db.prepare('SELECT count(*) AS n FROM indo_alert_config').get()?.n || 0
  if (count === 0) {
    const stmt = db.prepare(`INSERT INTO indo_alert_config (indicator, enabled, threshold_high, threshold_low) VALUES (?, ?, ?, ?)`)
    const defaults = [
      ['yield_curve_inversion', 1, null, null],
      ['composite_score_crisis', 1, null, 30],
      ['composite_score_booming', 1, 80, null],
      ['ihsg_drop_1d', 1, null, -3],
      ['ihsg_drop_5d', 1, null, -8],
      ['idr_weaken_1d', 1, null, -1],
      ['inflation_spike', 1, 6, null],
    ]
    const tx = db.transaction(() => {
      for (const row of defaults) stmt.run(...row)
    })
    tx()
  }
}

export function getAlertConfig(indicator) {
  return db.prepare('SELECT * FROM indo_alert_config WHERE indicator = ?').get(indicator)
}

export function setAlertConfig(indicator, updates) {
  const allowed = ['enabled', 'threshold_high', 'threshold_low', 'discord_channel']
  const sets = []
  const vals = []
  for (const k of allowed) {
    if (updates[k] !== undefined) {
      sets.push(`${k} = ?`)
      vals.push(updates[k])
    }
  }
  if (!sets.length) return { ok: false, error: 'no_fields' }
  sets.push("updated_at = datetime('now')")
  vals.push(indicator)
  db.prepare(`UPDATE indo_alert_config SET ${sets.join(', ')} WHERE indicator = ?`).run(...vals)
  return { ok: true }
}

export function listAlertConfigs() {
  return db.prepare('SELECT * FROM indo_alert_config ORDER BY indicator').all()
}

// ── Helpers ─────────────────────────────────────────────────────

export function saveYieldCurve(tenor, yieldPct, source = 'bi') {
  db.prepare(`INSERT INTO indo_yield_curve (tenor, yield_pct, source, fetched_at) VALUES (?, ?, ?, datetime('now'))`).run(tenor, yieldPct, source)
}

export function saveCompositeScore(score, zone, breakdown = {}) {
  db.prepare(`INSERT INTO indo_composite_score (score, zone, breakdown_json, created_at) VALUES (?, ?, ?, datetime('now'))`).run(score, zone, JSON.stringify(breakdown))
}

export function saveMacroData(indicator, value, unit, period, source = 'bi') {
  db.prepare(`INSERT OR REPLACE INTO indo_macro_data (indicator, value, unit, period, source, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`).run(indicator, value, unit, period, source)
}

export function saveForeignFlow(market, netBuy, cumulativeYtd) {
  db.prepare(`INSERT INTO indo_foreign_flow (market, net_buy, cumulative_ytd, fetched_at) VALUES (?, ?, ?, datetime('now'))`).run(market, netBuy, cumulativeYtd)
}

export function saveCdsSpread(tenor, spreadBps) {
  db.prepare(`INSERT INTO indo_cds_spread (tenor, spread_bps, fetched_at) VALUES (?, ?, datetime('now'))`).run(tenor, spreadBps)
}

export function saveSectorPerformance(sector, name, changePct, volume, marketCap) {
  db.prepare(`INSERT INTO indo_sector_performance (sector, name, change_pct, volume, market_cap, fetched_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`).run(sector, name, changePct, volume, marketCap)
}

export function saveMarketBreadth(adv, dec, unch, totalVol, totalVal) {
  db.prepare(`INSERT INTO indo_market_breadth (advancing, declining, unchanged, total_volume, total_value, fetched_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`).run(adv, dec, unch, totalVol, totalVal)
}

export function saveCryptoData(pair, price, volume24h, change24hPct, high24h, low24h, source = 'binance') {
  db.prepare(`INSERT INTO indo_crypto_data (pair, price, volume_24h, change_24h_pct, high_24h, low_24h, source, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`).run(pair, price, volume24h, change24hPct, high24h, low24h, source)
}

export function saveFearGreed(value, classification, source = 'alternative.me') {
  db.prepare(`INSERT INTO indo_fear_greed (value, classification, source, fetched_at) VALUES (?, ?, ?, datetime('now'))`).run(value, classification, source)
}

// ── Query helpers ───────────────────────────────────────────────

export function getYieldCurveHistory(limit = 100) {
  // Get latest snapshot of all tenors
  const rows = db.prepare(`
    SELECT yc.* FROM indo_yield_curve yc
    INNER JOIN (
      SELECT tenor, MAX(fetched_at) AS max_fetched
      FROM indo_yield_curve GROUP BY tenor
    ) latest ON yc.tenor = latest.tenor AND yc.fetched_at = latest.max_fetched
    ORDER BY
      CASE yc.tenor
        WHEN '1m' THEN 1 WHEN '3m' THEN 2 WHEN '6m' THEN 3
        WHEN '1y' THEN 4 WHEN '2y' THEN 5 WHEN '5y' THEN 6
        WHEN '10y' THEN 7 WHEN '20y' THEN 8 WHEN '30y' THEN 9
        ELSE 10
      END
  `).all()
  return rows
}

export function getYieldCurveOverTime(tenor, days = 30) {
  return db.prepare(`
    SELECT fetched_at, yield_pct FROM indo_yield_curve
    WHERE tenor = ? AND fetched_at >= datetime('now', ?)
    ORDER BY fetched_at ASC
  `).all(tenor, `-${days} days`)
}

export function getCompositeScoreHistory(limit = 30) {
  return db.prepare('SELECT * FROM indo_composite_score ORDER BY id DESC LIMIT ?').all(limit).reverse()
}

export function getLatestCompositeScore() {
  return db.prepare('SELECT * FROM indo_composite_score ORDER BY id DESC LIMIT 1').get()
}

export function getMacroData(indicator, limit = 20) {
  return db.prepare('SELECT * FROM indo_macro_data WHERE indicator = ? ORDER BY period DESC LIMIT ?').all(indicator, limit)
}

export function getLatestCryptoData() {
  return db.prepare(`
    SELECT cd.* FROM indo_crypto_data cd
    INNER JOIN (
      SELECT pair, MAX(fetched_at) AS max_fetched
      FROM indo_crypto_data GROUP BY pair
    ) latest ON cd.pair = latest.pair AND cd.fetched_at = latest.max_fetched
    ORDER BY cd.pair
  `).all()
}

export function getLatestFearGreed() {
  return db.prepare('SELECT * FROM indo_fear_greed ORDER BY id DESC LIMIT 1').get()
}

export function getLatestCdsSpread() {
  return db.prepare('SELECT * FROM indo_cds_spread ORDER BY id DESC LIMIT 1').get()
}

export function getFearGreedHistory(days = 30) {
  return db.prepare(`
    SELECT * FROM indo_fear_greed
    WHERE fetched_at >= datetime('now', ?)
    ORDER BY fetched_at ASC
  `).all(`-${days} days`)
}

export function getForeignFlowHistory(days = 30) {
  return db.prepare(`
    SELECT * FROM indo_foreign_flow
    WHERE fetched_at >= datetime('now', ?)
    ORDER BY fetched_at ASC
  `).all(`-${days} days`)
}

export function getLatestSectorPerformance() {
  return db.prepare(`
    SELECT sp.* FROM indo_sector_performance sp
    INNER JOIN (
      SELECT sector, MAX(fetched_at) AS max_fetched
      FROM indo_sector_performance GROUP BY sector
    ) latest ON sp.sector = latest.sector AND sp.fetched_at = latest.max_fetched
    ORDER BY sp.change_pct DESC
  `).all()
}

export function getLatestMarketBreadth() {
  return db.prepare('SELECT * FROM indo_market_breadth ORDER BY id DESC LIMIT 1').get()
}

export function getBreadthHistory(days = 30) {
  return db.prepare(`
    SELECT * FROM indo_market_breadth
    WHERE fetched_at >= datetime('now', ?)
    ORDER BY fetched_at ASC
  `).all(`-${days} days`)
}
