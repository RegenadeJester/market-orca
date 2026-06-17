import assert from 'node:assert/strict'
import test from 'node:test'

// article.js exports are not named; we import and use the module default behavior.
// Actually article.js uses: export function buildArticle — let me verify.

import { buildArticle } from './article.js'

// ── directionWord tests (via buildArticle) ────────────────────────────────

test('buildArticle headline uses "naik" for positive change', () => {
  const asset = { name: 'Apple', symbol: 'AAPL', price: 200, market: 'US', category: 'stock', change_percent: 1.5 }
  const article = buildArticle(asset, [])
  assert.ok(article.headline.includes('naik'), `headline="${article.headline}"`)
  assert.ok(article.headline.includes('1.50'))
})

test('buildArticle headline uses "turun" for negative change', () => {
  const asset = { name: 'Bitcoin', symbol: 'BTC-USD', price: 60000, market: 'CRYPTO', category: 'crypto', change_percent: -3.2 }
  const article = buildArticle(asset, [])
  assert.ok(article.headline.includes('turun'), `headline="${article.headline}"`)
  assert.ok(article.headline.includes('3.20'))
})

test('buildArticle headline uses "bergerak datar" for zero change', () => {
  const asset = { name: 'IDR/USD', symbol: 'IDR=X', price: 15000, market: 'FOREX', category: 'forex', change_percent: 0 }
  const article = buildArticle(asset, [])
  assert.ok(article.headline.includes('bergerak datar'), `headline="${article.headline}"`)
  assert.ok(article.headline.includes('0.00'))
})

test('buildArticle body has 5 paragraphs', () => {
  const asset = { name: 'Test', symbol: 'TST', price: 100, market: 'US', category: 'stock', change_percent: 2.0 }
  const article = buildArticle(asset, [])
  assert.ok(Array.isArray(article.body))
  assert.equal(article.body.length, 5)
})

test('buildArticle relatedNews groups by sentiment', () => {
  const news = [
    { title: 'Good news', summary: 'OK', sentiment: 'positive', source: 'Reuters' },
    { title: 'Bad news', summary: 'Bad', sentiment: 'negative', source: 'Bloomberg' },
    { title: 'OK news', summary: 'Meh', sentiment: 'neutral', source: 'BBC' },
  ]
  const asset = { name: 'Test', symbol: 'T', price: 50, market: 'US', category: 'stock', change_percent: 1.0 }
  const article = buildArticle(asset, news)
  // For positive change, main = positive, counter = negative
  assert.ok(article.relatedNews.main.length > 0, 'main has items')
  assert.equal(article.relatedNews.main[0].sentiment, 'positive')
})

test('buildArticle with no news provides fallback text', () => {
  const asset = { name: 'XYZ', symbol: 'XYZ', price: 10, market: 'US', category: 'stock', change_percent: -0.5 }
  const article = buildArticle(asset, [])
  assert.ok(article.body[1].includes('Belum ada headline'), article.body[1])
})

test('buildArticle with multiple news items classifies correctly for downtrend', () => {
  const news = [
    { title: 'Negative 1', summary: 'x', sentiment: 'negative', source: 'A' },
    { title: 'Negative 2', summary: 'y', sentiment: 'negative', source: 'B' },
    { title: 'Positive 1', summary: 'z', sentiment: 'positive', source: 'C' },
  ]
  const asset = { name: 'D', symbol: 'D', price: 20, market: 'US', category: 'stock', change_percent: -5.0 }
  const article = buildArticle(asset, news)
  // For downtrend, main = negative
  assert.equal(article.relatedNews.main[0].sentiment, 'negative')
})

test('buildArticle includes asset info in body', () => {
  const asset = { name: 'Apa itu', symbol: 'A', price: 999, currency: 'IDR', market: 'IDX', category: 'stock', change_percent: 2.0 }
  const article = buildArticle(asset, [])
  assert.ok(article.body[0].includes('999 IDR'), `body[0]="${article.body[0]}"`)
  assert.ok(article.body[0].includes('IDX'))
  assert.ok(article.body[0].includes('naik'))
})
