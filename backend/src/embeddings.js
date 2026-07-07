/**
 * Neural embeddings using @xenova/transformers (ONNX runtime, CPU-only, no Python).
 * Model: sentence-transformers/all-MiniLM-L6-v2 (384 dim, 22MB, fast).
 *
 * ponytail: cache model in /tmp. Add quantization options later if needed.
 */

import { pipeline } from '@xenova/transformers'
import { createHash } from 'node:crypto'
import { cacheGet, cacheSet } from './redis-cache.js'

let embedder = null
let loading = false
const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2'
const EMBED_DIM = 384
const CACHE_PREFIX = 'embed:'
const CACHE_TTL = 86400 // 24h

async function loadEmbedder() {
  if (embedder) return embedder
  if (loading) {
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 100))
      if (embedder) return embedder
    }
  }
  loading = true
  try {
    console.log('[embeddings] loading', MODEL_NAME, '...')
    embedder = await pipeline('feature-extraction', MODEL_NAME, { quantized: true })
    console.log('[embeddings] loaded', EMBED_DIM, 'dim')
    loading = false
    return embedder
  } catch (e) {
    loading = false
    console.error('[embeddings] load failed:', e.message)
    throw e
  }
}

/**
 * Generate embedding for text. Caches in Redis.
 * @param {string} text
 * @returns {Promise<number[]>} 384-dim vector
 */
export async function embedText(text) {
  if (!text?.trim()) return new Array(EMBED_DIM).fill(0)

  const cacheKey = CACHE_PREFIX + createHash('sha256').update(text.slice(0, 2000)).digest('hex').slice(0, 32)
  const cached = await cacheGet(cacheKey)
  if (cached?.vector) return cached.vector

  try {
    const pipe = await loadEmbedder()
    const output = await pipe(text, { pooling: 'mean', normalize: true })
    const vector = Array.from(output.data)
    await cacheSet(cacheKey, { vector, dim: EMBED_DIM, model: MODEL_NAME }, CACHE_TTL)
    return vector
  } catch (e) {
    console.error('[embeddings] infer failed:', e.message)
    return new Array(EMBED_DIM).fill(0)
  }
}

/**
 * Batch embed multiple texts (more efficient).
 * @param {string[]} texts
 * @returns {Promise<number[][]>}
 */
export async function embedBatch(texts) {
  if (!texts?.length) return []
  const pipe = await loadEmbedder()
  const results = await Promise.all(
    texts.map(t => pipe(t, { pooling: 'mean', normalize: true }).then(o => Array.from(o.data)))
  )
  return results
}

export function cosineSimilarity(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return 0
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

export function getEmbedDim() { return EMBED_DIM }
export function getEmbedModel() { return MODEL_NAME }
