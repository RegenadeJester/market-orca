/**
 * Indonesia Economic Indicators — SQLite tables (added to existing market-orca.db)
 * Imports db from parent src/db.js
 */
import { db } from '../db.js'

export function initIndonesiaTables() {
  db.exec(`

CREATE TABLE IF NOT EXISTS indonesia_ihsg (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  open REAL,
  high REAL,
  low REAL,
  close REAL NOT NULL,
  volume REAL DEFAULT 0,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ihsg_date ON indonesia_ihsg(date DESC);

CREATE TABLE IF NOT EXISTS indonesia_idx_stocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  date TEXT NOT NULL,
  open REAL,
  high REAL,
  low REAL,
  close REAL NOT NULL,
  volume REAL DEFAULT 0,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(symbol, date)
);

CREATE INDEX IF NOT EXISTS idx_idx_stocks_sym ON indonesia_idx_stocks(symbol, date DESC);

CREATE TABLE IF NOT EXISTS indonesia_macro (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  indicator_name TEXT NOT NULL,
  value REAL,
  unit TEXT DEFAULT '',
  source TEXT DEFAULT 'worldbank',
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(date, indicator_name)
);

CREATE INDEX IF NOT EXISTS idx_macro_name ON indonesia_macro(indicator_name, date DESC);

CREATE TABLE IF NOT EXISTS indonesia_crypto (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL DEFAULT (date('now')),
  coin TEXT NOT NULL,
  price_idr REAL NOT NULL,
  change_24h REAL DEFAULT 0,
  source TEXT DEFAULT 'coingecko',
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(date, coin)
);

CREATE INDEX IF NOT EXISTS idx_crypto_coin ON indonesia_crypto(coin, date DESC);

CREATE TABLE IF NOT EXISTS indonesia_crisis_score (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL DEFAULT (date('now')),
  composite_score REAL NOT NULL,
  zone TEXT NOT NULL,
  yield_curve_score REAL DEFAULT 0,
  ihsg_score REAL DEFAULT 0,
  macro_score REAL DEFAULT 0,
  crypto_score REAL DEFAULT 0,
  breakdown_json TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(date)
);

CREATE INDEX IF NOT EXISTS idx_crisis_score_date ON indonesia_crisis_score(date DESC);

CREATE TABLE IF NOT EXISTS indonesia_fear_greed (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  value INTEGER NOT NULL,
  classification TEXT NOT NULL,
  history_json TEXT DEFAULT '[]',
  source TEXT DEFAULT 'alternative.me',
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS indonesia_yield_curve (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL DEFAULT (date('now')),
  tenor TEXT NOT NULL,
  yield_pct REAL NOT NULL,
  source TEXT DEFAULT 'bi',
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(date, tenor)
);

CREATE TABLE IF NOT EXISTS indonesia_idr_usd (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  rate REAL NOT NULL,
  open REAL,
  high REAL,
  low REAL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

`)}

// ── IHSG ──────────────────────────────────────────────────────
export function saveIHSG(date, o, h, l, c, vol) {
  db.prepare(`INSERT OR IGNORE INTO indonesia_ihsg (date,open,high,low,close,volume) VALUES (?,?,?,?,?,?)`).run(date, o, h, l, c, vol)
}
export function getIHSG(days = 365) {
  return db.prepare(`SELECT * FROM indonesia_ihsg WHERE date >= date('now',?) ORDER BY date ASC`).all(`-${days} days`)
}
export function getLatestIHSG() {
  return db.prepare(`SELECT * FROM indonesia_ihsg ORDER BY date DESC LIMIT 1`).get()
}

// ── IDX Stocks ───────────────────────────────────────────────
export function saveIDXStock(symbol, date, o, h, l, c, vol) {
  db.prepare(`INSERT OR IGNORE INTO indonesia_idx_stocks (symbol,date,open,high,low,close,volume) VALUES (?,?,?,?,?,?,?)`).run(symbol, date, o, h, l, c, vol)
}
export function getIDXStocks(symbol, days = 90) {
  return db.prepare(`SELECT * FROM indonesia_idx_stocks WHERE symbol=? AND date >= date('now',?) ORDER BY date ASC`).all(symbol, `-${days} days`)
}
export function getLatestIDXStocks() {
  return db.prepare(`SELECT * FROM indonesia_idx_stocks WHERE (symbol,date) IN (SELECT symbol,MAX(date) FROM indonesia_idx_stocks GROUP BY symbol)`).all()
}

// ── Macro ────────────────────────────────────────────────────
export function saveMacro(date, name, value, unit, source) {
  db.prepare(`INSERT OR REPLACE INTO indonesia_macro (date,indicator_name,value,unit,source) VALUES (?,?,?,?,?)`).run(date, name, value, unit, source || 'worldbank')
}
export function getMacro(name, limit = 20) {
  return db.prepare(`SELECT * FROM indonesia_macro WHERE indicator_name=? ORDER BY date DESC LIMIT ?`).all(name, limit)
}
export function getLatestMacro() {
  return db.prepare(`SELECT * FROM indonesia_macro WHERE (indicator_name,date) IN (SELECT indicator_name,MAX(date) FROM indonesia_macro GROUP BY indicator_name)`).all()
}

// ── Crypto ───────────────────────────────────────────────────
export function saveCrypto(coin, priceIdr, change24h, source) {
  db.prepare(`INSERT OR REPLACE INTO indonesia_crypto (date,coin,price_idr,change_24h,source) VALUES (date('now'),?,?,?,?)`).run(coin, priceIdr, change24h, source || 'coingecko')
}
export function getCrypto(coin) {
  return db.prepare(`SELECT * FROM indonesia_crypto WHERE coin=? ORDER BY date DESC LIMIT 30`).all(coin)
}
export function getLatestCrypto() {
  return db.prepare(`SELECT * FROM indonesia_crypto WHERE (coin,date) IN (SELECT coin,MAX(date) FROM indonesia_crypto GROUP BY coin)`).all()
}

// ── Crisis Score ─────────────────────────────────────────────
export function saveCrisisScore(composite, zone, ycScore, ihsgScore, macroScore, cryptoScore, breakdown) {
  db.prepare(`INSERT OR REPLACE INTO indonesia_crisis_score (date,composite_score,zone,yield_curve_score,ihsg_score,macro_score,crypto_score,breakdown_json) VALUES (date('now'),?,?,?,?,?,?,?)`).run(composite, zone, ycScore, ihsgScore, macroScore, cryptoScore, JSON.stringify(breakdown))
}
export function getLatestCrisisScore() {
  return db.prepare(`SELECT * FROM indonesia_crisis_score ORDER BY date DESC LIMIT 1`).get()
}
export function getCrisisScoreHistory(days = 90) {
  return db.prepare(`SELECT * FROM indonesia_crisis_score WHERE date >= date('now',?) ORDER BY date ASC`).all(`-${days} days`)
}

// ── Fear & Greed ─────────────────────────────────────────────
export function saveFearGreed(value, classification, history) {
  db.prepare(`INSERT INTO indonesia_fear_greed (value,classification,history_json) VALUES (?,?,?)`).run(value, classification, JSON.stringify(history || []))
}
export function getLatestFearGreed() {
  return db.prepare(`SELECT * FROM indonesia_fear_greed ORDER BY id DESC LIMIT 1`).get()
}

// ── Yield Curve ──────────────────────────────────────────────
export function saveYieldCurvePoint(tenor, yieldPct, source) {
  db.prepare(`INSERT OR REPLACE INTO indonesia_yield_curve (date,tenor,yield_pct,source) VALUES (date('now'),?,?,?)`).run(tenor, yieldPct, source || 'bi')
}
export function getYieldCurveLatest() {
  return db.prepare(`SELECT * FROM indonesia_yield_curve WHERE date = (SELECT MAX(date) FROM indonesia_yield_curve) ORDER BY
    CASE tenor WHEN '1m' THEN 1 WHEN '3m' THEN 2 WHEN '6m' THEN 3 WHEN '1y' THEN 4 WHEN '2y' THEN 5 WHEN '5y' THEN 6 WHEN '10y' THEN 7 WHEN '20y' THEN 8 WHEN '30y' THEN 9 ELSE 10 END`).all()
}

// ── IDR/USD ──────────────────────────────────────────────────
export function saveIDRUSD(date, rate, o, h, l) {
  db.prepare(`INSERT OR IGNORE INTO indonesia_idr_usd (date,rate,open,high,low) VALUES (?,?,?,?,?)`).run(date, rate, o, h, l)
}
export function getIDRUSD(days = 90) {
  return db.prepare(`SELECT * FROM indonesia_idr_usd WHERE date >= date('now',?) ORDER BY date ASC`).all(`-${days} days`)
}
export function getLatestIDRUSD() {
  return db.prepare(`SELECT * FROM indonesia_idr_usd ORDER BY date DESC LIMIT 1`).get()
}

export default { initIndonesiaTables, saveIHSG, getIHSG, getLatestIHSG, saveIDXStock, getIDXStocks, getLatestIDXStocks, saveMacro, getMacro, getLatestMacro, saveCrypto, getCrypto, getLatestCrypto, saveCrisisScore, getLatestCrisisScore, getCrisisScoreHistory, saveFearGreed, getLatestFearGreed, saveYieldCurvePoint, getYieldCurveLatest, saveIDRUSD, getIDRUSD, getLatestIDRUSD }
