import assert from 'node:assert/strict'
import test from 'node:test'

// watchlist.js — CRUD operations on watchlist table via DB.

import { db } from './db.js'
import { getWatchlist, addWatchlist, removeWatchlist } from './watchlist.js'

// Ensure we have at least one asset in the DB to watchlist
const testAsset = db.prepare('SELECT slug FROM assets LIMIT 1').get()

test('getWatchlist returns array', () => {
  const items = getWatchlist()
  assert.ok(Array.isArray(items))
})

test('addWatchlist adds slug and returns updated list', () => {
  if (!testAsset) return // skip if no assets seeded
  const items = addWatchlist(testAsset.slug)
  assert.ok(Array.isArray(items))
  const found = items.find(i => i.slug === testAsset.slug)
  assert.ok(found, `slug ${testAsset.slug} should be in watchlist`)
})

test('addWatchlist is idempotent (INSERT OR IGNORE)', () => {
  if (!testAsset) return
  addWatchlist(testAsset.slug)
  const items = addWatchlist(testAsset.slug)
  const matches = items.filter(i => i.slug === testAsset.slug)
  assert.equal(matches.length, 1, 'no duplicate entries')
})

test('removeWatchlist removes slug', () => {
  if (!testAsset) return
  addWatchlist(testAsset.slug)
  const items = removeWatchlist(testAsset.slug)
  const found = items.find(i => i.slug === testAsset.slug)
  assert.equal(found, undefined, 'slug should be removed')
})

test('removeWatchlist on non-existent slug does not throw', () => {
  const items = removeWatchlist('nonexistent-slug-xyz')
  assert.ok(Array.isArray(items))
})

test('getWatchlist items have asset fields', () => {
  if (!testAsset) return
  addWatchlist(testAsset.slug)
  const items = getWatchlist()
  if (items.length > 0) {
    const item = items[0]
    assert.ok(item.slug, 'has slug')
    assert.ok(item.symbol, 'has symbol')
    assert.ok(item.name, 'has name')
    assert.ok(item.market, 'has market')
    assert.ok(item.category, 'has category')
  }
  // Cleanup
  removeWatchlist(testAsset.slug)
})
