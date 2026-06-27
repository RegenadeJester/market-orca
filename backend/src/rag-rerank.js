// RAG Reranker — Lightweight multi-signal reranker
// Inline module: no deps on rag-report.js exports (cosine/tokenize not exported)

import { db } from './db.js'
import { detectSections } from './rag-query-expansion.js'

// Inline helpers
function tokenize(q='') { return [...new Set(String(q).toLowerCase().replace(/[^\p{L}\p{N}\s.-]/gu,' ').split(/\s+/).filter(x=>x.length>2).slice(0,12))] }
function cosine(a=[], b=[]) { let s=0; for(let i=0;i<Math.min(a.length,b.length);i++) s+=Number(a[i]||0)*Number(b[i]||0); return s }
function embedTextLite(text='', dims=96) {
  const v = new Array(dims).fill(0)
  const toks = String(text).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,' ').split(/\s+/).filter(x=>x.length>2).slice(0,700)
  for (const t of toks) { let h=2166136261; for (const ch of t) h=(h ^ ch.charCodeAt(0))*16777619; v[Math.abs(h)%dims] += 1 / Math.sqrt(t.length) }
  const norm = Math.sqrt(v.reduce((s,x)=>s+x*x,0)) || 1
  return v.map(x=>Number((x/norm).toFixed(5)))
}

// Source trust scores
const TRUST_SCORES = {
  'idx.co.id': 0.95, 'bei.co.id': 0.95, 'bi.go.id': 0.9, 'ojk.go.id': 0.9,
  'reuters.com': 0.9, 'bloomberg.com': 0.9, 'wsj.com': 0.85,
  'cnbc.com': 0.85, 'cnbcindonesia.com': 0.85, 'kontan.co.id': 0.8, 'bisnis.com': 0.8,
  'investing.com': 0.75, 'tradingview.com': 0.7, 'finance.yahoo.com': 0.75, 'marketwatch.com': 0.8,
}

function getSourceTrust(url='') { if(!url) return 0.3; const l=url.toLowerCase(); for(const[d,s] of Object.entries(TRUST_SCORES)) if(l.includes(d)) return s; return 0.4 }

function termOverlapScore(tokens=[], text='') { const l=text.toLowerCase(); return tokens.length ? tokens.filter(t=>l.includes(t)).length/tokens.length : 0 }

export function rerankDocs(docs=[], query, { limit=8 }={}) {
  if (!docs.length) return []
  const tokens = tokenize(query)
  const qVec = embedTextLite(query)

  const scored = docs.map(d => {
    const txt = `${d.title||''} ${d.content||d.chunk_text||''} ${d.source_url||d.url||''}`
    const tScore = termOverlapScore(tokens, txt) * 0.30
    const semScore = (d.score || 0) * 0.25
    const trustScore = getSourceTrust(d.source_url||d.url||'') * 0.15
    const age = (()=>{ try{return(Date.now()-new Date(d.published_at||d.created_at||'').getTime())/864e5}catch{return 30}})()
    const recency = Math.max(0,1-age/90)*0.10
    const quality = Math.min(1,(d.content||d.chunk_text||'').length/500)*0.10
    const sectionScore = 0.10
    return { ...d, composite_score: Number((tScore+semScore+trustScore+recency+quality+sectionScore).toFixed(4)),
      signal_breakdown:{ term:tScore, semantic:semScore, trust:trustScore, recency, quality }
    }
  })

  const deduped = new Map()
  for (const d of scored) {
    const key = (d.content||d.chunk_text||'').slice(0,200).toLowerCase().replace(/\s+/g,' ')
    if (!deduped.has(key) || deduped.get(key).composite_score < d.composite_score) deduped.set(key, d)
  }
  return [...deduped.values()].sort((a,b)=>b.composite_score-a.composite_score).slice(0,limit)
}
