/**
 * RAG Ask — RAG retrieval + LLM synthesis (Perplexity-style)
 * PRIMARY: use expanded query → rerank → runRagReport (local FTS + semantic + query rewrite)
 * OPTIONAL: Perplexity API for enhanced synthesis (if PERPLEXITY_API_KEY set)
 */

import { db } from './db.js'
import { searchByTopic } from './rag-autolearn.js'
import { runRagReport, searchRag } from './rag-report.js'
import { expandQuery } from './rag-query-expansion.js'
import { rerankDocs } from './rag-rerank.js'

// Load .env for Perplexity key (systemd EnvironmentFile already loads it)
const PERPLEXITY_KEY = process.env.PERPLEXITY_API_KEY || (() => {
  try { return require('fs').readFileSync(new URL('../.env', import.meta.url), 'utf8').match(/PERPLEXITY_API_KEY=(.+)/)?.[1]?.trim() || '' } catch { return '' }
})()
const PERPLEXITY_URL = 'https://api.perplexity.ai/chat/completions'
const MODEL = 'sonar'

function formatLocalAnswer(report) {
  // Extract key sections from runRagReport output
  const lines = report.report.split('\n')
  const summary = []
  let inSummary = false
  for (const line of lines) {
    if (line.includes('## Ringkasan')) { inSummary = true; continue }
    if (inSummary && line.startsWith('## ')) break
    if (inSummary && line.trim()) summary.push(line.replace(/^- /, ''))
  }
  
  const citations = report.citations.map(c => ({
    n: c.n,
    title: c.title,
    url: c.url,
    quote: c.quote?.slice(0, 200)
  }))
  
  return {
    answer: summary.join('\n') || report.report.slice(0, 1500),
    citations,
    confidence: report.confidence,
    evidence: report.evidence,
    method: 'local-rag-report'
  }
}

export async function ragAsk(query, { limit=10, topic='', model=MODEL, enhanceWithLLM=false, mode='full' } = {}) {
  // 1. Query expansion (synonyms, ticker aliases, Bahasa/English)
  const expanded = expandQuery(query, { 
    maxQueries: mode === 'quick' ? 3 : mode === 'full' ? 6 : 10,
    includeSynonyms: true,
    includeTickerAliases: true,
    includeBahasaEnglish: true
  })
  
  // 2. Run local RAG report with expanded queries
  const localResult = runRagReport(expanded.join(' | '), Math.min(limit * 2, 16))
  
  // 3. Rerank results for better precision
  const reranked = rerankDocs(localResult.docs || [], query, { 
    limit
  })
  
  // Update localResult with reranked docs
  localResult.docs = reranked
  
  // 4. Format local answer
  const formatted = formatLocalAnswer(localResult)
  
  // 5. If Perplexity key available AND enhanceWithLLM requested, enhance answer
  if (PERPLEXITY_KEY && enhanceWithLLM) {
    try {
      const context = formatted.citations.map(c => `[${c.n}] ${c.title}: ${c.quote}`).join('\n\n')
      const resp = await fetch(PERPLEXITY_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${PERPLEXITY_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'You are a market intelligence analyst. Answer based on the RAG context. Be concise. Cite sources using [Source N]. Use Bahasa Indonesia if question is in Indonesian.' },
            { role: 'user', content: `Context:\n${context}\n\nQuestion: ${query}\n\nAnswer with citations:` }
          ],
          max_tokens: 1024,
          temperature: 0.2
        }),
        signal: AbortSignal.timeout(12000)
      })
      const data = await resp.json()
      const answer = data.choices?.[0]?.message?.content
      if (answer) {
        formatted.answer = answer
        formatted.method = `rag-ask+${model}`
        formatted.usage = data.usage
      }
    } catch {
      // Keep local answer on LLM failure
    }
  }
  
  return {
    ok: true,
    query,
    expandedQueries: expanded,
    answer: formatted.answer,
    citations: formatted.citations,
    confidence: formatted.confidence,
    evidence: formatted.evidence,
    sources: reranked.map(d => ({ title: d.title, url: d.source_url, score: d.score, domain: d.domain, rerankScore: d.rerankScore })) || [],
    method: formatted.method,
    factCheck: localResult.factCheck
  }
}
