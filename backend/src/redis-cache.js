/**
 * Redis cache layer — persistent, shared, survives restarts.
 * Replaces in-memory Map caches for critical paths.
 * Fallback: if Redis down, returns null (caller falls through to DB/LLM).
 *
 * ponytail: no pub/sub, no streams. Add when needed.
 */
import Redis from 'ioredis'
import { REDIS_CONFIG } from './config.js'

let client = null
let connecting = false

export async function getRedis() {
  if (client?.status === 'ready') return client
  if (connecting) return null
  try {
    connecting = true
    client = new Redis(REDIS_CONFIG)
    await client.connect()
    connecting = false
    return client
  } catch (e) {
    console.error('[redis] connect failed:', e.message)
    connecting = false
    if (client) { client.disconnect(); client = null }
    return null
  }
}

/**
 * Get cached value. Returns null if miss or Redis down.
 * @param {string} key
 * @returns {any|null}
 */
export async function cacheGet(key) {
  const r = await getRedis()
  if (!r) return null
  try {
    const raw = await r.get(key)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

/**
 * Set cached value with TTL.
 * @param {string} key
 * @param {any} val
 * @param {number} ttlSec - seconds to live
 */
export async function cacheSet(key, val, ttlSec = 300) {
  const r = await getRedis()
  if (!r) return false
  try {
    const serialized = JSON.stringify(val)
    if (ttlSec > 0) {
      await r.setex(key, ttlSec, serialized)
    } else {
      await r.set(key, serialized)
    }
    return true
  } catch { return false }
}

/**
 * Delete one or more keys.
 */
export async function cacheDel(...keys) {
  const r = await getRedis()
  if (!r) return false
  try {
    if (keys.length === 1) await r.del(keys[0])
    else if (keys.length > 1) await r.del(...keys)
    return true
  } catch { return false }
}

/**
 * Get-or-set pattern: fetch from cache, if miss run fn(), cache result, return.
 * @param {string} key
 * @param {number} ttlSec
 * @param {() => Promise<any>} fn
 */
export async function cacheMemo(key, ttlSec, fn) {
  const hit = await cacheGet(key)
  if (hit !== null) return { ...hit, _cache: 'hit' }
  const result = await fn()
  await cacheSet(key, result, ttlSec)
  return { ...result, _cache: 'miss' }
}

/**
 * Rate limiter: sliding window counter per key.
 * @param {string} key
 * @param {number} limit - max hits in window
 * @param {number} windowSec - window size in seconds
 * @returns {{ allowed: boolean, remaining: number, retryAfterSec: number }}
 */
export async function rateLimit(key, limit = 60, windowSec = 60) {
  const r = await getRedis()
  if (!r) return { allowed: true, remaining: limit, retryAfterSec: 0 }
  try {
    const now = Date.now()
    const windowKey = `rl:${key}:${Math.floor(now / (windowSec * 1000))}`
    const prevKey = `rl:${key}:${Math.floor(now / (windowSec * 1000)) - 1}`

    const [current, prev] = await Promise.all([
      r.get(windowKey),
      r.get(prevKey)
    ])

    const prevCount = parseInt(prev || '0', 10)
    const currentCount = parseInt(current || '0', 10)
    const elapsed = (now % (windowSec * 1000)) / (windowSec * 1000)
    const weight = 1 - elapsed
    const approx = prevCount * weight + currentCount

    if (approx >= limit) {
      const retryAfter = windowSec - Math.floor((now % (windowSec * 1000)) / 1000)
      return { allowed: false, remaining: 0, retryAfterSec: retryAfter }
    }

    await r.incr(windowKey)
    await r.expire(windowKey, windowSec * 2)
    return { allowed: true, remaining: Math.max(0, Math.floor(limit - approx - 1)), retryAfterSec: 0 }
  } catch { return { allowed: true, remaining: limit, retryAfterSec: 0 } }
}

/**
 * Health check: ping + basic ops.
 */
export async function redisHealth() {
  const r = await getRedis()
  if (!r) return { ok: false, error: 'not_connected' }
  try {
    const start = Date.now()
    const pong = await r.ping()
    const latencyMs = Date.now() - start
    const info = await r.info('memory')
    const usedMem = info.match(/used_memory_human:(\S+)/)?.[1] || '?'
    return { ok: pong === 'PONG', latencyMs, usedMemory: usedMem }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

/**
 * Graceful shutdown.
 */
export async function closeRedis() {
  if (client) {
    await client.quit().catch(() => {})
    client = null
  }
}
