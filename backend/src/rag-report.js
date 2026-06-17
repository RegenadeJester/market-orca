import { db } from './db.js'
import PDFDocument from 'pdfkit'
import fs from 'node:fs'
import path from 'node:path'

function cleanText(s='') { return String(s).replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim() }
function tokenize(q='') { return [...new Set(String(q).toLowerCase().replace(/[^\p{L}\p{N}\s.-]/gu,' ').split(/\s+/).filter(x=>x.length>2).slice(0,12))] }
export function rewriteQueries(question='') {
  const q = String(question || '').trim()
  const base = tokenize(q).join(' ')
  const tickers = (q.match(/\b[A-Z]{2,6}\b/g)||[]).slice(0,4)
  return [...new Set([q, base, ...tickers.map(t=>`${t} earnings news risk technical price`), `${base} market impact catalyst risk`, `${base} indonesia watchlist sentiment`].filter(Boolean))]
}
export async function crawlUrl(url) {
  const r = await fetch(url, { headers:{ 'user-agent':'MarketOrcaRAG/1.0' } })
  const html = await r.text()
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || url).replace(/\s+/g,' ').trim()
  return { title, content: cleanText(html).slice(0, 60000), url }
}
function chunkText(text, size=900, overlap=120) { const out=[]; for(let i=0;i<text.length;i+=Math.max(1,size-overlap)) out.push(text.slice(i,i+size)); return out.filter(x=>x.trim().length>80).slice(0,160) }
function embedText(text='', dims=96) {
  const v = new Array(dims).fill(0)
  const toks = String(text).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,' ').split(/\s+/).filter(x=>x.length>2).slice(0,700)
  for (const t of toks) { let h=2166136261; for (const ch of t) h=(h ^ ch.charCodeAt(0))*16777619; v[Math.abs(h)%dims] += 1 / Math.sqrt(t.length) }
  const norm = Math.sqrt(v.reduce((s,x)=>s+x*x,0)) || 1
  return { dims:v.map(x=>Number((x/norm).toFixed(5))), norm }
}
function cosine(a=[], b=[]) { let s=0; for(let i=0;i<Math.min(a.length,b.length);i++) s+=Number(a[i]||0)*Number(b[i]||0); return s }
function upsertChunkVector(chunkId, text) { const e=embedText(text); db.prepare(`INSERT OR REPLACE INTO rag_vectors (chunk_id,dims_json,norm,updated_at) VALUES (?,?,?,datetime('now'))`).run(chunkId, JSON.stringify(e.dims), e.norm) }
export function semanticSearchRag(query, limit=8) {
  const qv = embedText(query).dims
  const rows = db.prepare(`SELECT c.id AS chunk_id,c.document_id AS id,d.title,d.source_url,c.chunk_text AS content,v.dims_json FROM rag_vectors v JOIN rag_chunks c ON c.id=v.chunk_id JOIN rag_documents d ON d.id=c.document_id ORDER BY c.id DESC LIMIT 1200`).all()
  return rows.map(r=>({ ...r, score:cosine(qv, JSON.parse(r.dims_json||'[]')), quote:selectQuote(r.content, tokenize(query)) })).sort((a,b)=>b.score-a.score).slice(0,limit)
}
export function ingestDocument({ sourceType='manual', sourceUrl='', title='Untitled', content='', metadata={} }) {
  const text = cleanText(content).slice(0, 120000)
  const cleanTitle = String(title).slice(0,300)
  const info = db.prepare(`INSERT INTO rag_documents (source_type,source_url,title,content,metadata_json) VALUES (?,?,?,?,?)`).run(sourceType, sourceUrl, cleanTitle, text, JSON.stringify(metadata||{}))
  db.prepare(`INSERT INTO rag_documents_fts(rowid,title,content,source_url) VALUES (?,?,?,?)`).run(info.lastInsertRowid, cleanTitle, text, sourceUrl)
  const insChunk = db.prepare(`INSERT INTO rag_chunks (document_id,chunk_index,chunk_text,metadata_json) VALUES (?,?,?,?)`)
  const insFts = db.prepare(`INSERT INTO rag_chunks_fts(rowid,title,chunk_text,source_url) VALUES (?,?,?,?)`)
  chunkText(text).forEach((chunk, idx) => { const ci=insChunk.run(info.lastInsertRowid, idx, chunk, JSON.stringify({ title:cleanTitle, sourceUrl })); insFts.run(ci.lastInsertRowid, cleanTitle, chunk, sourceUrl); upsertChunkVector(ci.lastInsertRowid, `${cleanTitle}\n${chunk}`) })
  return db.prepare(`SELECT * FROM rag_documents WHERE id=?`).get(info.lastInsertRowid)
}
export async function ingestUrl(url) { const page = await crawlUrl(url); return ingestDocument({ sourceType:'crawl4ai-lite', sourceUrl:url, title:page.title, content:page.content, metadata:{ crawler:'fetch-clean-html' } }) }
export function searchRag(query, limit=8) {
  const terms = tokenize(query)
  if (!terms.length) return []
  const fts = terms.map(t => `${t}*`).join(' OR ')
  let rows = []
  try {
    rows = db.prepare(`SELECT c.id AS chunk_id, c.document_id AS id, d.title, d.source_url, c.chunk_text AS content, bm25(rag_chunks_fts) AS rank FROM rag_chunks_fts f JOIN rag_chunks c ON c.id = f.rowid JOIN rag_documents d ON d.id = c.document_id WHERE rag_chunks_fts MATCH ? ORDER BY rank LIMIT ?`).all(fts, limit)
  } catch {
    rows = db.prepare(`SELECT id, title, source_url, content, 0 AS rank FROM rag_documents WHERE lower(title || ' ' || content) LIKE ? ORDER BY id DESC LIMIT ?`).all(`%${terms[0]}%`, limit)
  }
  const ftsRows = rows.map((r,i)=>({ ...r, retrieval:'fts', score:Number((1/(1+i+Math.abs(r.rank||0))).toFixed(4)), quote: selectQuote(r.content, terms) }))
  const semRows = semanticSearchRag(query, limit).map(r=>({ ...r, retrieval:'semantic_hash' }))
  const merged = new Map()
  for (const r of [...semRows, ...ftsRows]) { const k=r.chunk_id || r.id; if(!merged.has(k) || (merged.get(k).score||0)<(r.score||0)) merged.set(k,r) }
  return [...merged.values()].sort((a,b)=>(b.score||0)-(a.score||0)).slice(0,limit)
}

function queryIntent(question=''){
  const q=String(question).toLowerCase()
  const market=/(ihsg|jkse|idx|saham|trading|intraday|market|rupiah|usd|idr|usd\/idr|emas|gold|btc|crypto|forex|bank|bbca|bbri|tlkm|asii|support|resistance|candle|harga|volume)/i.test(q)
  const coding=/(coding|programming|javascript|python|github|rag|llm|agent|mcp|frontend|backend|database|sqlite|api|docker|kubernetes|security|prompt injection)/i.test(q)
  const person=/(siapa|profil|nama orang|linkedin|instagram|facebook|github profile)/i.test(q)
  return market?'market':coding?'coding':person?'person':'general'
}
function docDomain(d={}){
  const hay=`${d.title||''} ${d.source_url||''} ${d.content||''}`.toLowerCase()
  if(/(ihsg|jkse|idx|saham|trading|intraday|market|rupiah|usd|idr|forex|gold|btc|crypto|bank|bbca|bbri|tlkm|asii|ojk|bi\.go|idx\.co|kontan|bisnis|cnbc|reuters|bloomberg|marketwatch|investing|tradingview|support|resistance|harga|volume)/i.test(hay)) return 'market'
  if(/(coding|programming|github|javascript|python|llm|agent|mcp|api|docker|kubernetes|sqlite|frontend|backend|security|prompt injection|vibe coder|techcrunch|arstechnica|dev\.to)/i.test(hay)) return 'coding'
  return 'general'
}
function relevanceGate(question, docs=[]){
  const intent=queryIntent(question)
  const qterms=tokenize(question)
  const out=[]
  for(const d of docs){
    const domain=docDomain(d)
    const hay=`${d.title||''} ${d.quote||''} ${d.source_url||''}`.toLowerCase()
    const overlap=qterms.filter(t=>hay.includes(t)).length
    let penalty=0
    if(intent==='market' && domain==='coding') penalty+=0.7
    if(intent==='coding' && domain==='market') penalty+=0.35
    if(intent==='market' && overlap===0) penalty+=0.25
    const relevance=Math.max(0, Number(d.score||0) + overlap*0.08 - penalty)
    if(relevance>=0.18 || (intent==='general' && relevance>0.05)) out.push({...d, relevance, domain, overlap})
  }
  return out.sort((a,b)=>(b.relevance||0)-(a.relevance||0))
}
function noRelevantEvidenceReport(question, context={}){
  const gap=contextGapDetector(context)
  const report=`# Laporan RAG Market Orca\n\n**Pertanyaan:** ${question}\n**Keyakinan:** 20%\n\n${contextGapBlock(gap)}\n\n## Ringkasan\nBelum ada sumber yang relevan untuk pertanyaan ini di RAG. Query tampak butuh data pasar/IHSG, tapi evidence yang tersedia tidak cocok.\n\n## Guardrail\n- Tidak memakai sumber AI/coding untuk menjawab trading IHSG.\n- Tidak membuat analisa trading tanpa harga/candle/berita market relevan.\n\n## Langkah berikutnya\n- Jalankan web search mode market/official untuk IHSG/JKSE.\n- Crawl sumber relevan: IDX, BI, OJK, CNBC Indonesia, Kontan, Bisnis, Reuters/Bloomberg jika tersedia.\n- Baru generate ulang RAG report.`
  return { id:null, report, citations:[], confidence:0.2, evidence:'', contextGap:gap, factCheck:{passed:true,unsupported_claims:[],stale_sources:[],confidence_penalty:0}, rewrittenQueries:rewriteQueries(question), docs:[], relevanceGate:{intent:queryIntent(question),kept:0,dropped:true} }
}

function selectQuote(content='', terms=[]) {
  const text = cleanText(content)
  const lower = text.toLowerCase()
  const idx = Math.max(0, Math.min(...terms.map(t => lower.indexOf(t)).filter(i=>i>=0), 0))
  return text.slice(idx, idx + 480)
}
export function contextGapDetector(input={}) {
  const required = [
    ['goal','Tujuan utama report ini untuk apa: trading cepat, investasi panjang, riset kompetitor, atau monitoring risiko?'],
    ['time_horizon','Horizon keputusan: intraday, mingguan, bulanan, atau jangka panjang?'],
    ['watchlist_priority','Asset/watchlist mana yang paling prioritas?'],
    ['risk_tolerance','Toleransi risiko: konservatif, normal, agresif?'],
    ['preferred_action','Output aksi yang diinginkan: buy/sell/watch, risk alert, atau research note?']
  ]
  const rows = db.prepare('SELECT key,value,confidence,source,updated_at FROM user_context_answers').all()
  const answers = new Map(rows.map(r=>[r.key,r]))
  for (const [key,val] of Object.entries(input||{})) if (val) answers.set(key,{ key, value:String(val).slice(0,500), confidence:0.9, source:'request' })
  const missing = required.filter(([k])=>!answers.has(k) || !String(answers.get(k).value||'').trim())
  const questions = missing.slice(0,3).map(([key,question])=>({ key, question }))
  const assumptions = missing.map(([key])=>({ key, value:inferContextAssumption(key), confidence:0.35, source:'inferred' }))
  return { required:required.map(([key])=>key), answers:Object.fromEntries([...answers].map(([k,v])=>[k,v])), missing:missing.map(([k])=>k), questions, assumptions, confidence:missing.length?'low':'high' }
}
function inferContextAssumption(key) {
  return ({ goal:'monitoring risiko dan peluang market harian', time_horizon:'harian sampai mingguan', watchlist_priority:'watchlist aktif + USD/IDR + JKSE', risk_tolerance:'normal', preferred_action:'watch + risk alert + next signal' })[key] || 'unknown'
}
function contextGapBlock(g) {
  const rows = g.required.map(k => g.answers[k] ? `- ${k}: ${g.answers[k].value} (${g.answers[k].confidence ?? 1}, ${g.answers[k].source || 'user'})` : `- ${k}: assumed ${inferContextAssumption(k)} (0.35, inferred)`).join('\n')
  const qs = g.questions.length ? `\n\n**Pertanyaan mikro tertinggi:**\n${g.questions.map(q=>`- ${q.question}`).join('\n')}` : ''
  return `## Context Gap Interviewer\n- **Confidence konteks:** ${g.confidence}\n${rows}${qs}`
}
export function generateRagReport(question, docs=[], context={}) {
  const gap = contextGapDetector(context)
  const citations = docs.map((d,i)=>({ n:i+1, id:d.id, title:d.title, url:d.source_url, quote:d.quote, confidence:d.score || 0.5 }))
  const evidence = citations.map(c=>`[${c.n}] ${c.title}: ${c.quote}`).join('\n')
  const confidence = docs.length ? Math.min(.92, .45 + docs.length * .06 + docs.reduce((s,d)=>s+(d.score||0),0)/10 - (gap.confidence==='low'?0.08:0)) : .2
  const report = `# Laporan RAG Market Orca\n\n**Pertanyaan:** ${question}\n**Keyakinan:** ${(confidence*100).toFixed(0)}%\n\n${contextGapBlock(gap)}\n\n## Ringkasan\n${docs.length ? `Ditemukan ${docs.length} sumber relevan. Kesimpulan di bawah hanya memakai bukti yang tersedia.` : 'Data belum cukup. Tambahkan sumber atau crawl URL relevan.'}\n\n## Sorotan Bukti\n${citations.map(c=>`- [${c.n}] ${c.quote.slice(0,220)}${c.quote.length>220?'...':''}`).join('\n') || '- Tidak ada bukti.'}\n\n## Analisis Berbasis Tujuan\n- Tujuan/horizon: ${gap.answers.goal?.value || inferContextAssumption('goal')} / ${gap.answers.time_horizon?.value || inferContextAssumption('time_horizon')}\n- Sinyal utama: ${docs[0]?.title || 'belum ada sumber kuat'}\n- Risiko: klaim tanpa sitasi atau tanpa konteks user harus dianggap lemah.\n- Aksi preferensi: ${gap.answers.preferred_action?.value || inferContextAssumption('preferred_action')}\n- Langkah berikutnya: validasi dengan harga/candle/berita terbaru sebelum keputusan trading.\n\n## Blok Asumsi\n${gap.assumptions.map(a=>`- ${a.key}: ${a.value} (${a.confidence})`).join('\n') || '- Tidak ada asumsi konteks.'}\n\n## Sitasi\n${citations.map(c=>`[${c.n}] ${c.title}${c.url ? ` — ${c.url}` : ''}`).join('\n')}`
  return { report, citations, confidence:Number(confidence.toFixed(2)), evidence, contextGap:gap }
}
export function runRagReport(question, limit=8, context={}) {
  const queries = rewriteQueries(question)
  const seen = new Map()
  for (const q of queries) for (const d of searchRag(q, limit)) if (!seen.has(d.id)) seen.set(d.id, d)
  const rawDocs = [...seen.values()].sort((a,b)=>(b.score||0)-(a.score||0)).slice(0, limit*2)
  const docs = relevanceGate(question, rawDocs).slice(0, limit)
  if (!docs.length && queryIntent(question)==='market') return noRelevantEvidenceReport(question, context)
  const out = generateRagReport(question, docs, context)
  const factCheck = factCheckReport(out.report, out.citations)
  const finalConfidence = Math.max(0.1, Number((out.confidence - factCheck.confidence_penalty).toFixed(2)))
  const info = db.prepare(`INSERT INTO rag_report_runs (query,rewritten_queries,selected_doc_ids,report_md,confidence) VALUES (?,?,?,?,?)`).run(question, JSON.stringify(queries), JSON.stringify(docs.map(d=>d.id)), out.report, finalConfidence)
  const ins = db.prepare(`INSERT INTO rag_citations (run_id,document_id,quote,source_url,confidence) VALUES (?,?,?,?,?)`)
  for (const c of out.citations) ins.run(info.lastInsertRowid, c.id, c.quote, c.url || '', c.confidence)
  return { id: info.lastInsertRowid, ...out, confidence:finalConfidence, factCheck, rewrittenQueries: queries, docs: docs.map(d=>({id:d.id,title:d.title,source_url:d.source_url,score:d.score,relevance:d.relevance,domain:d.domain,overlap:d.overlap,quote:d.quote})), relevanceGate:{intent:queryIntent(question),kept:docs.length,raw:rawDocs.length} }
}
export function factCheckReport(report='', citations=[]) {
  const weak=[]
  for (const line of String(report).split('\n')) if (/\b(naik|turun|bullish|bearish|risiko|laba|revenue|profit|support|resistance)\b/i.test(line) && !/\[\d+\]/.test(line)) weak.push(line.trim().slice(0,220))
  const stale = citations.filter(c => !c.url && (c.confidence||0)<0.35).map(c=>c.title)
  return { unsupported_claims: weak.slice(0,20), stale_sources: stale.slice(0,10), passed: weak.length===0, confidence_penalty: Math.min(0.3, weak.length*0.03) }
}
export function getRagRun(id) { return db.prepare(`SELECT * FROM rag_report_runs WHERE id=?`).get(id) }
export function exportRagRun(id, format='md') {
  const run = getRagRun(id); if (!run) throw new Error('rag_run_not_found')
  const dir = path.join(process.cwd(), 'tmp'); fs.mkdirSync(dir,{recursive:true})
  const safe = `rag-report-${id}.${format==='pdf'?'pdf':'md'}`; const out = path.join(dir, safe)
  if (format === 'pdf') { const doc = new PDFDocument({ margin:48 }); doc.pipe(fs.createWriteStream(out)); doc.fontSize(18).text('Market Orca RAG Report'); doc.moveDown(); doc.fontSize(10).text(run.report_md, { width:500 }); doc.end() }
  else fs.writeFileSync(out, run.report_md)
  return { path:out, filename:safe, mime:format==='pdf'?'application/pdf':'text/markdown' }
}
export function generateJsonlDataset({ count=12, topic='RAG report market orca' } = {}) {
  const types = ['explanation','coding','debugging','comparison','planning','summarization','qa']
  const rows=[]
  for(let i=0;i<count;i++){
    const t=types[i%types.length]
    const instruction = `Buat jawaban ${t} dalam Bahasa Indonesia tentang ${topic}`
    const input = t==='coding' ? 'Contohkan endpoint Express untuk ingest dokumen RAG.' : t==='debugging' ? 'Search FTS5 tidak menemukan hasil padahal dokumen ada.' : `User ingin memahami ${topic} secara praktis.`
    const output = idealOutput(t, topic)
    rows.push(JSON.stringify({ instruction, input, output }))
  }
  return rows.join('\n') + '\n'
}
function idealOutput(t, topic){
  if(t==='coding') return `Gunakan endpoint POST /api/rag/ingest. Validasi title dan content, simpan ke tabel dokumen, lalu update FTS index. Jika pakai crawler, batasi ukuran konten dan simpan URL sebagai citation.`
  if(t==='debugging') return `Cek 4 hal: FTS table sudah dibuat, row sudah diinsert ke FTS, query tidak berisi karakter ilegal, dan token terlalu pendek tidak dipakai. Kalau masih gagal, fallback ke LIKE untuk memastikan data tersedia.`
  if(t==='comparison') return `SQLite FTS5 cocok untuk MVP cepat dan lokal. Qdrant/LanceDB lebih cocok saat butuh vector similarity besar, reranking, dan banyak dokumen. Mulai dari FTS5 dulu, upgrade setelah relevansi mentok.`
  if(t==='planning') return `Urutan aman: ingest dokumen, search, citation, report generator, fact-check pass, export guard, audit log, lalu cron crawler. Jangan mulai dari embedding kalau corpus masih kecil.`
  if(t==='summarization') return `Ringkas sumber berdasarkan evidence. Pisahkan fakta, opini, risiko, dan next action. Klaim tanpa citation harus ditandai lemah.`
  if(t==='qa') return `Ya, ${topic} bisa dibuat lebih akurat dengan search + retrieval + RAG. Kuncinya bukan cuma crawling, tapi ranking sumber, citation, dan guardrail anti-hallucination.`
  return `RAG membuat assistant membaca sumber dulu sebelum menjawab. Flow-nya: ubah pertanyaan jadi query, crawl sumber, ambil potongan penting, susun konteks, lalu generate jawaban dengan citation.`
}
