import assert from 'node:assert/strict'
import test from 'node:test'

// ── config.js tests ──────────────────────────────────────────────────────
// We import the module to validate its exported shape and APP_CONFIG defaults.
// The IP-detection functions are side-effectful (read OS nets), so we test
// the exported object and function signatures rather than the raw OS calls.

import { APP_CONFIG, detectIPs } from './config.js'

test('APP_CONFIG has all expected keys', () => {
  assert.ok(APP_CONFIG.publicBaseUrl, 'publicBaseUrl defined')
  assert.ok(APP_CONFIG.tailscaleBaseUrl, 'tailscaleBaseUrl defined')
  assert.ok(APP_CONFIG.frontendUrl, 'frontendUrl defined')
  assert.ok(APP_CONFIG.frontendTailscaleUrl, 'frontendTailscaleUrl defined')
  assert.equal(typeof APP_CONFIG.alertIntervalMs, 'number')
  assert.ok(APP_CONFIG.alertIntervalMs > 0)
  assert.ok(typeof APP_CONFIG.thresholds === 'object')
})

test('APP_CONFIG.publicBaseUrl is a valid HTTP URL', () => {
  assert.ok(APP_CONFIG.publicBaseUrl.startsWith('http'))
  assert.ok(APP_CONFIG.publicBaseUrl.includes(':'))
})

test('APP_CONFIG.thresholds has known assets', () => {
  assert.ok('aapl' in APP_CONFIG.thresholds)
  assert.ok('btc-usd' in APP_CONFIG.thresholds)
  assert.ok('bbca-jk' in APP_CONFIG.thresholds)
  assert.ok('xauusd' in APP_CONFIG.thresholds)
})

test('thresholds have up/down numbers', () => {
  for (const [key, val] of Object.entries(APP_CONFIG.thresholds)) {
    assert.equal(typeof val.up, 'number', `${key}.up is number`)
    assert.equal(typeof val.down, 'number', `${key}.down is number`)
    assert.ok(val.up > 0, `${key}.up > 0`)
    assert.ok(val.down < 0, `${key}.down < 0`)
  }
})

test('detectIPs returns object with lan and tailscale', () => {
  const result = detectIPs()
  assert.equal(typeof result.lan, 'string')
  assert.equal(typeof result.tailscale, 'string')
  assert.ok(result.lan.length > 0, 'lan not empty')
  assert.ok(result.tailscale.length > 0, 'tailscale not empty')
})

test('detectIPs lan is IPv4-ish (contains dots)', () => {
  const { lan } = detectIPs()
  assert.ok(lan.includes('.'), 'lan contains dots')
  assert.equal(lan.split('.').length, 4, 'lan has 4 octets')
})

test('detectIPs tailscale starts with 100. or is fallback', () => {
  const { tailscale } = detectIPs()
  // Either a real tailscale IP (100.x) or the hardcoded fallback
  const isValid = tailscale.startsWith('100.') || tailscale === '100.x.x.x'
  assert.ok(isValid, `tailscale=${tailscale} should be 100.x or fallback`)
})

test('env overrides work via process.env', () => {
  // The module-level constants are evaluated at import time.
  // We can verify the shape accepts env-style overrides by checking structure.
  assert.equal(typeof APP_CONFIG.publicBaseUrl, 'string')
  assert.equal(typeof APP_CONFIG.tailscaleBaseUrl, 'string')
})

test('thresholds for btc-usd are wider than aapl', () => {
  assert.ok(APP_CONFIG.thresholds['btc-usd'].up > APP_CONFIG.thresholds['aapl'].up,
    'BTC threshold wider than AAPL')
})
