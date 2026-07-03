import assert from 'node:assert/strict'
import test from 'node:test'
import { db } from './db.js'

test('market activity queries work', () => {
  // Check assets with significant moves query works
  const moves = db.prepare(`
    SELECT slug, symbol, name, market, price, change_percent
    FROM assets WHERE abs(change_percent) > 1.5 ORDER BY abs(change_percent) DESC LIMIT 10
  `).all()
  assert.ok(Array.isArray(moves))
  if (moves.length > 0) {
    assert.ok(typeof moves[0].slug === 'string')
    assert.ok(typeof moves[0].change_percent === 'number')
  }

  // Check alerts query works
  const alerts = db.prepare(`
    SELECT id, asset_slug, title, message, discord_sent, created_at
    FROM alerts ORDER BY id DESC LIMIT 8
  `).all()
  assert.ok(Array.isArray(alerts))
  if (alerts.length > 0) {
    assert.ok(typeof alerts[0].asset_slug === 'string')
  }

  // Check delivery_log query works
  const deliveries = db.prepare(`
    SELECT id, slug, channel, step, status, detail, created_at
    FROM delivery_log ORDER BY id DESC LIMIT 8
  `).all()
  assert.ok(Array.isArray(deliveries))
  if (deliveries.length > 0) {
    assert.ok(typeof deliveries[0].slug === 'string')
  }
})
