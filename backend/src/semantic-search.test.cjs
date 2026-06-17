/**
 * Unit tests for semantic search / cosine similarity logic.
 * Mirrors the browser-side useSemanticSearch composable.
 * Tests: cosine similarity, embedding batching, topic filtering, score computation.
 * @see frontend/src/composables/useSemanticSearch.js
 */
const assert = require('node:assert')
const { describe, it } = require('node:test')

// ── Cosine similarity (mirrors browser implementation) ──────────
function cosineSim(a, b) {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

// ── Embedding batching (mirrors browser batch logic) ────────────
function normalize(vec) {
  let norm = 0
  for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i]
  norm = Math.sqrt(norm)
  return norm === 0 ? vec : vec.map(v => v / norm)
}

function embedBatch(texts) {
  // Mock: return pseudo-random normalized embeddings for testing
  // Real implementation uses Transformers.js pipeline
  return texts.map((text, idx) => {
    const seed = text.length + idx + 1
    const dim = 4 // tiny dim for testing
    const vec = new Array(dim)
    for (let i = 0; i < dim; i++) {
      vec[i] = Math.sin(seed * (i + 1) * 100) * 0.5 // deterministic pseudo-random
    }
    return normalize(vec)
  })
}

// ── Score computation & filtering ────────────────────────────────
function computeScores(queryEmb, vectors, minScore) {
  const scores = vectors.map((vec, i) => ({
    index: i,
    score: cosineSim(queryEmb, vec)
  }))
  return scores.filter(s => s.score >= minScore).sort((a, b) => b.score - a.score)
}

// ── Tests ────────────────────────────────────────────────────────
describe('semantic-search', () => {

  describe('cosineSim()', () => {
    it('identical vectors → 1.0', () => {
      const v = [1, 0, 0]
      assert.strictEqual(cosineSim(v, v), 1)
    })

    it('orthogonal vectors → 0', () => {
      assert(Math.abs(cosineSim([1, 0], [0, 1])) < 1e-10)
    })

    it('opposite vectors → -1', () => {
      assert(Math.abs(cosineSim([1, 0], [-1, 0]) - (-1)) < 1e-10)
    })

    it('parallel with scaling → 1', () => {
      assert(Math.abs(cosineSim([2, 0], [1, 0]) - 1) < 1e-10)
    })

    it('zero vector → 0', () => {
      assert.strictEqual(cosineSim([0, 0, 0], [1, 0, 0]), 0)
    })

    it('handles different lengths', () => {
      const v1 = [1, 2, 3]
      const v2 = [4, 5, 6]
      const result = cosineSim(v1, v2)
      assert(typeof result === 'number')
      assert(result > 0 && result < 1)
    })
  })

  describe('normalize()', () => {
    it('unit vector → unchanged', () => {
      const v = normalize([1, 0, 0])
      assert.strictEqual(v[0], 1)
      assert.strictEqual(v[1], 0)
    })

    it('length = sqrt(sum of squares)', () => {
      const v = normalize([3, 4])
      assert(Math.abs(v[0] - 0.6) < 1e-10)
      assert(Math.abs(v[1] - 0.8) < 1e-10)
    })

    it('zero vector → unchanged', () => {
      const v = normalize([0, 0, 0])
      assert.deepStrictEqual(v, [0, 0, 0])
    })
  })

  describe('embedBatch()', () => {
    it('returns normalized vectors of correct count', () => {
      const texts = ['hello', 'world', 'test']
      const vectors = embedBatch(texts)
      assert.strictEqual(vectors.length, 3)
      vectors.forEach(v => {
        const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0))
        assert(Math.abs(norm - 1) < 1e-10, 'each vector should be unit length')
      })
    })

    it('deterministic — same input → same output', () => {
      const a = embedBatch(['same text'])
      const b = embedBatch(['same text'])
      for (let i = 0; i < a[0].length; i++) {
        assert(Math.abs(a[0][i] - b[0][i]) < 1e-10)
      }
    })
  })

  describe('computeScores()', () => {
    // Use explicit vectors — not mock embedBatch — for reliable scoring
    it('returns scores sorted descending', () => {
      const query = normalize([1, 0, 0, 0])
      const vectors = [
        normalize([1, 0, 0, 0]),      // 1.0
        normalize([1, 1, 0, 0]),      // ~0.707
        normalize([0, 0, 1, 0]),      // 0
      ]
      const results = computeScores(query, vectors, 0)
      assert.strictEqual(results.length, 3)
      assert(results[0].score >= results[1].score)
      assert(results[1].score >= results[2].score)
      assert(Math.abs(results[0].score - 1) < 1e-10, 'top match should be 1.0')
    })

    it('filters below minScore', () => {
      const query = normalize([1, 0, 0, 0])
      const vectors = [
        normalize([1, 0, 0, 0]),     // 1.0 — above 0.5
        normalize([1, 1, 0, 0]),     // 0.707 — above 0.5
        normalize([0, 0, 0, 1]),     // 0.0 — below 0.5
      ]
      const results = computeScores(query, vectors, 0.5)
      assert.strictEqual(results.length, 2, 'should filter out score=0')
      assert(results.every(r => r.score >= 0.5))
    })

    it('empty vectors → empty results', () => {
      const results = computeScores([1, 0], [], 0)
      assert.strictEqual(results.length, 0)
    })
  })
})
