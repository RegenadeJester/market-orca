import assert from 'node:assert/strict'
import test from 'node:test'

import { scoreSourceTrust, getSourcesTrust } from './source-reliability.js'

test('scoreSourceTrust known domain returns high trust', () => {
  const r = scoreSourceTrust('Reuters', 'https://www.reuters.com/article')
  assert.ok(r.score >= 80)
  assert.equal(r.label, 'high_trust')
  assert.equal(r.tier, 'established')
})

test('scoreSourceTrust idx domain returns official', () => {
  const r = scoreSourceTrust('IDX', 'https://www.idx.co.id/news')
  assert.equal(r.score, 95)
  assert.equal(r.tier, 'official')
})

test('scoreSourceTrust social media returns low trust', () => {
  const r = scoreSourceTrust('Twitter', 'https://twitter.com/user')
  assert.ok(r.score <= 40)
  assert.equal(r.tier, 'social')
})

test('scoreSourceTrust empty source returns medium (fallback)', () => {
  const r = scoreSourceTrust('')
  assert.equal(r.score, 50)
  assert.equal(r.label, 'medium_trust')
})

test('scoreSourceTrust null source returns fallback', () => {
  const r = scoreSourceTrust(null, null)
  assert.equal(r.score, 50)
})

test('scoreSourceTrust gov domain gets boosted', () => {
  const r = scoreSourceTrust('', 'https://example.go.id/policy')
  assert.ok(r.score >= 80, `.go.id score=${r.score} should be >=80`)
  assert.equal(r.tier, 'inferred')
})

test('scoreSourceTrust edu domain gets boosted', () => {
  const r = scoreSourceTrust('', 'https://university.ac.id/research')
  assert.ok(r.score >= 80)
})

test('scoreSourceTrust blog domain gets lowered', () => {
  const r = scoreSourceTrust('', 'https://someblog.wordpress.com/post')
  assert.ok(r.score <= 50)
})

test('scoreSourceTrust medium.com returns blog tier', () => {
  const r = scoreSourceTrust('Medium', 'https://medium.com/@user')
  assert.equal(r.tier, 'blog')
})

test('scoreSourceTrust name-based fallback matches reuters', () => {
  const r = scoreSourceTrust('Reuters news service')
  assert.ok(r.score >= 80)
})

test('getSourcesTrust deduplicates and returns array', () => {
  const result = getSourcesTrust(['Reuters', 'reuters', 'Bloomberg', ''])
  assert.ok(Array.isArray(result))
  // 'reuters' and 'Reuters' dedupe to one entry; empty filtered
  assert.equal(result.length, 2)
  assert.equal(result[0].source, 'Reuters')
  assert.ok(result[0].trust.score >= 80)
})

test('getSourcesTrust handles empty input', () => {
  assert.deepEqual(getSourcesTrust([]), [])
  assert.deepEqual(getSourcesTrust(['']).length, 0)
})

test('scoreSourceTrust returns color field', () => {
  const r = scoreSourceTrust('Bloomberg')
  assert.ok(r.color, 'has color')
  assert.match(r.color, /^#[0-9a-f]{6}$/)
})

test('DOMAIN_TIER order: official > established > aggregator > community > blog > social', () => {
  const tiers = ['official', 'established', 'aggregator', 'community', 'blog', 'social']
  // Verify by scoring known domains
  const idx = scoreSourceTrust('IDX', 'idx.co.id')
  const reu = scoreSourceTrust('Reuters', 'reuters.com')
  const yah = scoreSourceTrust('Yahoo', 'yahoo.com')
  const red = scoreSourceTrust('Reddit', 'reddit.com')
  const sub = scoreSourceTrust('Substack', 'substack.com')
  const twi = scoreSourceTrust('Twitter', 'twitter.com')

  assert.equal(idx.tier, 'official')
  assert.equal(reu.tier, 'established')
  assert.equal(yah.tier, 'aggregator')
  assert.equal(red.tier, 'community')
  assert.equal(sub.tier, 'blog')
  assert.equal(twi.tier, 'social')

  // Score ordering check
  assert.ok(idx.score > reu.score, 'official > established')
  assert.ok(reu.score > yah.score, 'established > aggregator')
  assert.ok(yah.score > red.score, 'aggregator > community')
})
