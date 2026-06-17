import assert from 'node:assert/strict'
import test from 'node:test'

// search.js internal pure functions are not exported, but importAssetFromSearch
// and searchSymbols are. We test importAssetFromSearch which uses DB.
// We also test the module's logic indirectly by verifying the import function
// works correctly with the live SQLite DB.

import { importAssetFromSearch } from './search.js'

test('importAssetFromSearch creates asset with correct slug', () => {
  const item = {
    symbol: 'TESTX',
    name: 'Test Corp',
    fullName: 'Test Corporation',
    exchange: 'NASDAQ',
    type: 'EQUITY',
  }
  const asset = importAssetFromSearch(item)
  assert.equal(asset.symbol, 'TESTX')
  assert.equal(asset.slug, 'testx')
  assert.equal(asset.market, 'US')
  assert.equal(asset.category, 'stock')
  assert.equal(asset.price, 0) // Initial price is 0
  assert.equal(asset.change_percent, 0)
})

test('importAssetFromSearch returns existing asset on duplicate', () => {
  const item = { symbol: 'TESTX', name: 'Test Corp', fullName: 'Test Corp', exchange: 'NASDAQ', type: 'EQUITY' }
  const first = importAssetFromSearch(item)
  const second = importAssetFromSearch(item)
  assert.equal(first.id, second.id, 'same ID for duplicate import')
})

test('importAssetFromSearch infers IDX market', () => {
  const item = { symbol: 'BBCA.JK', name: 'BBCA', fullName: 'Bank BCA', exchange: 'JKT', type: 'EQUITY' }
  const asset = importAssetFromSearch(item)
  assert.equal(asset.market, 'IDX')
})

test('importAssetFromSearch infers CRYPTO market', () => {
  const item = { symbol: 'BTC-USD', name: 'Bitcoin', fullName: 'Bitcoin USD', exchange: '', type: 'CRYPTOCURRENCY' }
  const asset = importAssetFromSearch(item)
  assert.equal(asset.market, 'CRYPTO')
  assert.equal(asset.category, 'crypto')
})

test('importAssetFromSearch infers crypto from USDT symbol', () => {
  const item = { symbol: 'ETH-USDT', name: 'Ethereum', fullName: 'Ethereum', exchange: '', type: '' }
  const asset = importAssetFromSearch(item)
  assert.equal(asset.market, 'CRYPTO')
  assert.equal(asset.category, 'crypto')
})

test('importAssetFromSearch infers index type', () => {
  const item = { symbol: 'JKSE', name: 'IHSG', fullName: 'Jakarta Composite', exchange: 'JKT', type: 'INDEX' }
  const asset = importAssetFromSearch(item)
  assert.equal(asset.category, 'index')
})

test('importAssetFromSearch infers forex type', () => {
  const item = { symbol: 'IDR=X', name: 'USD/IDR', fullName: 'USD/IDR', exchange: '', type: 'CURRENCY' }
  const asset = importAssetFromSearch(item)
  assert.equal(asset.category, 'forex')
})

test('importAssetFromSearch slug normalizes special chars', () => {
  const item = { symbol: 'BRK.B', name: 'BRK', fullName: 'Berkshire', exchange: 'NYQ', type: 'EQUITY' }
  const asset = importAssetFromSearch(item)
  assert.equal(asset.slug, 'brk-b') // dot → dash
})
