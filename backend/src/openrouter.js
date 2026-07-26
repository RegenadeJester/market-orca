/**
 * OpenRouter API Client — Embedding, Reranking, Verification
 * Models:
 *   Embedding: nvidia/nemotron-3-embed-1b:free (2048-dim Matryoshka)
 *   Reranking: nvidia/llama-nemotron-rerank-vl-1b-v2:free
 *   Thinking/Verify: inclusionai/ling-3.0-flash:free
 */
import crypto from 'node:crypto'

const BASE = 'https://openrouter.ai/api/v1'
const KEY  = process.env.OPENROUTER_API_KEY || ''

export const MODELS = {
  embedding: process.env.OPENROUTER_EMBED_MODEL || 'nvidia/nemotron-3-embed-1b:free',
  reranker:  process.env.OPENROUTER_RERANK_MODEL || 'nvidia/llama-nemotron-rerank-vl-1b-v2:free',
  verify:    process.env.OPENROUTER_VERIFY_MODEL || 'inclusionai/ling-3.0-flash:free',
}
export const EMBED_DIM = Number(process.env.OPENROUTER_EMBED_DIM || 2048)

const limiter = { queue: [], running: 0, max: 4 }
function rateLimit(){
  return new Promise(res => {
    if(limiter.running < limiter.max){ limiter.running++; res() }
    else limiter.queue.push(res)
  })
}
function release(){
  if(limiter.queue.length) limiter.queue.shift()()
  else limiter.running--
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

export async function isOpenRouterReady(){ return Boolean(KEY) }

async function api(path, body, { timeout = 30000, retries = 2 } = {}){
  await rateLimit()
  let lastErr
  for(let i = 0; i <= retries; i++){
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), timeout)
      const r = await fetch(`${BASE}${path}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://market-orca.local', 'X-Title': 'MarketOrca' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      })
      clearTimeout(timer)
      if(!r.ok) throw new Error(`openrouter_${r.status}: ${(await r.text().catch(()=>'')).slice(0,200)}`)
      return await r.json()
    } catch(e){
      lastErr = e
      if(i < retries) await sleep(1000 * (i + 1))
    } finally { release() }
  }
  throw lastErr
}

// ── Embedding ────────────────────────────────────────────────────────
export async function embedTexts(texts = []){
  if(!texts.length || !KEY) return []
  const BATCH = 32, all = []
  for(let i = 0; i < texts.length; i += BATCH){
    const batch = texts.slice(i, i + BATCH).map(t => String(t || '').slice(0, 8000))
    try {
      const d = await api('/embeddings', { model: MODELS.embedding, input: batch })
      all.push(...(d.data || []).map(x => x.embedding))
    } catch { all.push(...batch.map(() => null)) }
    if(i + BATCH < texts.length) await sleep(200)
  }
  return all
}

export async function embedOne(text){ const r = await embedTexts([text]); return r[0] || null }

// ── Reranking ────────────────────────────────────────────────────────
export async function rerank(query, documents = [], { topN = 8 } = {}){
  if(!documents.length || !KEY) return documents.map((d, i) => ({ ...d, rerankScore: 100 - i, reranked: false }))
  const docs = documents.map((d, i) => ({ index: i, text: `${d.title || ''} ${d.snippet || d.content || ''}`.slice(0, 2000) }))
  try {
    const d = await api('/rerank', { model: MODELS.reranker, query: query.slice(0, 2000), documents: docs.map(x => x.text), top_n: Math.min(topN, documents.length), return_documents: false }, { timeout: 20000 })
    const scores = new Map()
    for(const r of (d.results || [])) scores.set(r.index, r.relevance_score ?? r.score ?? 0)
    return documents.map((d, i) => ({ ...d, rerankScore: Math.round((scores.get(i) ?? 0) * 100), reranked: true }))
      .sort((a, b) => (b.rerankScore || 0) - (a.rerankScore || 0))
      .slice(0, topN)
  } catch { return documents.map((d, i) => ({ ...d, rerankScore: 100 - i, reranked: false })) }
}

// ── Verification (2-step) ────────────────────────────────────────────
const VERIFY_SYSTEM = `Anda adalah verifikator fakta untuk konten keuangan/teknologi Indonesia.
Tugas: (1) identifikasi klaim faktual, (2) cross-check dengan sumber, (3) beri skor 0-100.
SKOR: 90-100=terverifikasi lengkap, 70-89=sebagian besar benar, 50-69=mix benar/salah, <50=mulai ragu.
Output JSON ketat: {"score":N,"issues":["..."],"unsupported":["..."],"summary":"..."}`

export async function verifyContent(content, sources = []){
  if(!KEY || !content) return { score: 0, issues: ['no_api_key_or_content'], unsupported: [], summary: 'Verification skipped', verified: false }
  const sourceText = sources.slice(0, 6).map((s, i) => `[${i + 1}] ${s.title || 'Untitled'} — ${s.source || s.domain || 'unknown'}\n    ${(s.snippet || s.content || '').slice(0, 500)}`).join('\n\n')
  const prompt = `=== KONTEN ===\n${content.slice(0, 6000)}\n\n=== SUMBER ===\n${sourceText || '(tidak ada sumber spesifik)'}\n\nVerifikasi klaim faktual. Skor 0-100. Output JSON ketat.`

  try {
    const d = await api('/chat/completions', {
      model: MODELS.verify, temperature: 0.1, max_tokens: 1500,
      messages: [{ role: 'system', content: VERIFY_SYSTEM }, { role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    }, { timeout: 45000 })
    const raw = (d.choices?.[0]?.message?.content || '').trim()
    const cleaned = raw.replace(/^```json\n?/i, '').replace(/\n?```$/i, '').trim()
    const parsed = JSON.parse(cleaned)
    return { ...parsed, verified: true, model: MODELS.verify, timestamp: new Date().toISOString() }
  } catch(e) {
    return { score: 0, issues: [`verify_error: ${e.message}`], unsupported: [], summary: 'Verification failed', verified: false }
  }
}

// ── Quality scoring for articles ──────────────────────────────────────
const QUALITY_SYSTEM = `Anda adalah penilai kualitas artikel keuangan Indonesia.
Analisis: akurasi data, kedalaman analisis, kebaruan informasi, kualitas sumber.
Output JSON: {"quality":N,"depth":"shallow|moderate|deep","freshness":"stale|recent|fresh","source_quality":"low|medium|high","notes":"..."}`

export async function scoreArticleQuality(title, content, source = ''){
  if(!KEY || !content) return { quality: 50, depth: 'moderate', freshness: 'recent', source_quality: 'medium', notes: 'no_api', scored: false }
  try {
    const d = await api('/chat/completions', {
      model: MODELS.verify, temperature: 0.2, max_tokens: 500,
      messages: [
        { role: 'system', content: QUALITY_SYSTEM },
        { role: 'user', content: `Judul: ${title}\nSumber: ${source}\nKonten:\n${content.slice(0, 4000)}\n\nNilai kualitas. Output JSON.` }
      ],
      response_format: { type: 'json_object' },
    }, { timeout: 20000 })
    const raw = (d.choices?.[0]?.message?.content || '').trim()
    const cleaned = raw.replace(/^```json\n?/i, '').replace(/\n?```$/i, '').trim()
    return { ...JSON.parse(cleaned), scored: true }
  } catch { return { quality: 50, depth: 'moderate', freshness: 'recent', source_quality: 'medium', notes: 'score_error', scored: false } }
}
