#!/usr/bin/env node
import { ingestUrl, ingestDocument, searchRag, runRagReport } from './rag-report.js'
import { webSearch, deepWebSearch, searchAndAnswer, fetchPageMarkdown, searchNews, TRUSTED_WEB_SOURCES, WEB_SEARCH_CAPABILITIES, filterSearchForCrawl, previewPublicPage, classifySearchResult } from './web-search.js'
import { enqueueRagCrawl } from './rag-crawler.js'
import { ragAsk } from './rag-ask.js'
import { ingestAllReports, searchByTopic, getCollectionStats, autoCreateCollections, ingestReport } from './rag-autolearn.js'
import { db } from './db.js'
import crypto from 'node:crypto'

export const tools = [
  { name:'market_orca_rag_search', description:'Search Market Orca RAG corpus (FTS + lightweight semantic vector).', inputSchema:{ type:'object', properties:{ query:{type:'string'}, limit:{type:'number'} }, required:['query'] } },
  { name:'market_orca_crawl_url', description:'Crawl URL with crawl4ai-lite fetch/clean-html and ingest into RAG.', inputSchema:{ type:'object', properties:{ url:{type:'string'} }, required:['url'] } },
  { name:'market_orca_ingest_text', description:'Ingest text/document into Market Orca RAG.', inputSchema:{ type:'object', properties:{ title:{type:'string'}, content:{type:'string'}, sourceUrl:{type:'string'}, sourceType:{type:'string'} }, required:['title','content'] } },
  { name:'market_orca_rag_report', description:'Generate citation-grounded RAG report from corpus.', inputSchema:{ type:'object', properties:{ question:{type:'string'}, limit:{type:'number'} }, required:['question'] } },
  { name:'market_orca_rag_search_by_topic', description:'Cari RAG corpus berdasarkan query + topic collection.', inputSchema:{ type:'object', properties:{ query:{type:'string'}, topic:{type:'string'}, limit:{type:'number'} }, required:['query'] } },
  { name:'market_orca_rag_collections', description:'Lihat semua topik collection + statistik RAG.', inputSchema:{ type:'object', properties:{} } },
  { name:'market_orca_rag_ingest_report', description:'Ingest satu report ke RAG.', inputSchema:{ type:'object', properties:{ slug:{type:'string'} }, required:['slug'] } },
  { name:'market_orca_rag_ingest_all', description:'Ingest semua report yang ada ke RAG.', inputSchema:{ type:'object', properties:{ limit:{type:'number'} } } },

  { name:'market_orca_report_qa', description:'Inspect report block evidence quality by slug.', inputSchema:{ type:'object', properties:{ slug:{type:'string'} }, required:['slug'] } },
  { name:'market_orca_web_search', description:'Dedicated Market Orca web search. Supports modes and operators: site, exclude site, filetype PDF, intitle, exact phrase, after/before dates. Use for fresh public web evidence before RAG ingest.', inputSchema:{ type:'object', properties:{ query:{type:'string'}, mode:{type:'string',enum:['forum','blog','official','market','security','research','marketing','coding','journal','thesis','data','docs','person']}, engines:{type:'array',items:{type:'string',enum:['duckduckgo','bing','yahoo','yandex']}}, limit:{type:'number'}, sites:{type:'array',items:{type:'string'}}, excludeSites:{type:'array',items:{type:'string'}}, filetype:{type:'string'}, intitle:{type:'string'}, exact:{type:'string'}, after:{type:'string'}, before:{type:'string'}, mustHave:{type:'array',items:{type:'string'}}, preferTrusted:{type:'boolean'}, autoPreview:{type:'boolean'}, previewLimit:{type:'number'} }, required:['query'] } },
  { name:'market_orca_deep_web_search', description:'Run many web searches across multiple modes/engines, then merge/dedupe/rank/cluster results. Use when user wants more/broader search.', inputSchema:{ type:'object', properties:{ query:{type:'string'}, limit:{type:'number'}, engines:{type:'array',items:{type:'string'}}, modes:{type:'array',items:{type:'string'}}, filetypes:{type:'array',items:{type:'string'}}, autoPreview:{type:'boolean'}, previewLimit:{type:'number'} }, required:['query'] } },
  { name:'market_orca_fetch_page', description:'Fetch/read one public URL and return clean Markdown content. Lightweight web reader; no browser automation.', inputSchema:{ type:'object', properties:{ url:{type:'string'}, maxChars:{type:'number'} }, required:['url'] } },
  { name:'market_orca_search_and_answer', description:'Local Perplexity-style tool: deep search, read top pages, return Markdown answer with numbered citations.', inputSchema:{ type:'object', properties:{ query:{type:'string'}, limit:{type:'number'}, readLimit:{type:'number'}, engines:{type:'array',items:{type:'string'}}, modes:{type:'array',items:{type:'string'}}, time_range:{type:'string'}, domains:{type:'array',items:{type:'string'}} }, required:['query'] } },
  { name:'market_orca_web_preview', description:'Fetch one public URL and extract title/description/text preview before crawl/RAG ingest.', inputSchema:{ type:'object', properties:{ url:{type:'string'} }, required:['url'] } },
  { name:'market_orca_news_search', description:'Search latest news from trusted sources. Returns fresh articles with date, source, trust score. Best for breaking news, market events, and time-sensitive information.', inputSchema:{ type:'object', properties:{ query:{type:'string'}, limit:{type:'number'}, engines:{type:'array',items:{type:'string'}}, time_range:{type:'string',enum:['day','week','month']}, domains:{type:'array',items:{type:'string'}}, preferTrusted:{type:'boolean'} }, required:['query'] } },
  { name:'market_orca_web_to_crawl', description:'Search web, filter crawl-safe URLs, enqueue allowed open/public pages into RAG crawl queue.', inputSchema:{ type:'object', properties:{ query:{type:'string'}, mode:{type:'string'}, engines:{type:'array',items:{type:'string'}}, limit:{type:'number'}, enqueueLimit:{type:'number'}, assetTags:{type:'array',items:{type:'string'}}, sites:{type:'array',items:{type:'string'}}, excludeSites:{type:'array',items:{type:'string'}}, filetype:{type:'string'}, intitle:{type:'string'}, exact:{type:'string'}, after:{type:'string'}, before:{type:'string'} }, required:['query'] } },
  { name:'market_orca_web_capabilities', description:'Explain web search engines, modes, operators, examples, and trusted-source count so AI agents can search well.', inputSchema:{ type:'object', properties:{} } },
  { name:'market_orca_profile_safe_search', description:'Privacy-safe public profile search. Searches exact name, separates open-doc/academic results from social results, never auto-crawls social/private pages. Use for public-source-only identity mentions.', inputSchema:{ type:'object', properties:{ name:{type:'string'}, limit:{type:'number'}, autoCrawlOpenDocs:{type:'boolean'}, enqueueLimit:{type:'number'} }, required:['name'] } },
  { name:'market_orca_trusted_domains', description:'List trusted/source-priority domains for ranking and crawl policy.', inputSchema:{ type:'object', properties:{ limit:{type:'number'} } } },
  { name:'market_orca_decision_fingerprint', description:'Create stable decision context fingerprint for agent runs/reports.', inputSchema:{ type:'object', properties:{ intent:{type:'string'}, route:{type:'string'}, asset:{type:'string'}, horizon:{type:'string'}, risk:{type:'string'}, evidence_ids:{type:'array'} } } },
  { name:'market_orca_rag_ask', description:'RAG Ask: search Market Orca RAG corpus + LLM synthesis (Perplexity-style). Returns answer with inline citations from local corpus. Use for market data, reports, and knowledge base questions.', inputSchema:{ type:'object', properties:{ query:{type:'string'}, limit:{type:'number'}, topic:{type:'string'}, model:{type:'string'} }, required:['query'] } }
]


function mdEscape(s=''){ return String(s||'').replace(/\|/g,'\\|').trim() }
function resultsMarkdown(obj={}){
  const rows=obj.results||[]
  const head=[`# Market Orca Web Search`, `Query: ${obj.query||''}`, `Results: ${rows.length}`, obj.mode?`Mode: ${obj.mode}`:''].filter(Boolean).join('\n')
  const body=rows.slice(0, obj.limit||20).map((r,i)=>{
    const snippet=(r.content||r.snippet||'').replace(/\s+/g,' ').slice(0,900)
    return `\n## ${i+1}. ${mdEscape(r.title)}\n- URL: ${r.url}\n- Domain: ${r.domain||''}\n- Source: ${r.source||''}\n- Confidence: ${r.confidence||'n/a'} · Quality: ${r.quality ?? 'n/a'}\n- Content: ${snippet || '(no snippet)'}`
  }).join('\n')
  const clusters=obj.clusters?.length ? `\n\n## Clusters\n${obj.clusters.slice(0,8).map(c=>`- ${c.domain}: ${c.count}`).join('\n')}` : ''
  return `${head}\n${body}${clusters}`
}
function mcpOut(obj, markdown=false){ return { structuredContent: obj, content:[{ type:'text', text: markdown ? resultsMarkdown(obj) : (typeof obj==='string'?obj:JSON.stringify(obj,null,2)) }] } }
function reportOut(obj){ return { structuredContent: obj, content:[{ type:'text', text: obj?.report || JSON.stringify(obj,null,2) }] } }
function text(obj){ return mcpOut(obj,false) }

export async function call(name,args={}){
  if(name==='market_orca_rag_search') return text(searchRag(args.query, args.limit||8))
  if(name==='market_orca_crawl_url') return text(await ingestUrl(args.url))
  if(name==='market_orca_ingest_text') return text(ingestDocument({ sourceType:args.sourceType||'mcp', sourceUrl:args.sourceUrl||'', title:args.title, content:args.content, metadata:{ via:'mcp' } }))
  if(name==='market_orca_rag_report') return reportOut(runRagReport(args.question, args.limit||8))
  if(name==='market_orca_rag_search_by_topic') return text(JSON.stringify(searchByTopic(args.query, { limit:args.limit||8, topic:args.topic||'' })))
  if(name==='market_orca_rag_collections') return text(JSON.stringify(getCollectionStats()))
  if(name==='market_orca_rag_ingest_report') return text(JSON.stringify(ingestReport(args.slug)))
  if(name==='market_orca_rag_ingest_all') return text(JSON.stringify(ingestAllReports()))

  if(name==='market_orca_report_qa') {
    const rows=db.prepare('SELECT block_key,claim_type,confidence,evidence_ids,edit_suggestion,hidden,locked FROM report_blocks WHERE report_slug=? ORDER BY block_key').all(args.slug)
    return text({ slug:args.slug, blocks:rows.length, rows })
  }
  if(name==='market_orca_web_search') return mcpOut(await webSearch(args.query, { limit:args.limit||10, engines:args.engines||['searxng'], mode:args.mode||'', sites:args.sites||[], excludeSites:args.excludeSites||[], filetype:args.filetype||'', intitle:args.intitle||'', exact:args.exact||'', after:args.after||'', before:args.before||'', mustHave:args.mustHave||[], preferTrusted:args.preferTrusted!==false, autoPreview:args.autoPreview===true, previewLimit:args.previewLimit||3 }), true)
  if(name==='market_orca_deep_web_search') return mcpOut(await deepWebSearch(args.query,{ limit:args.limit||30, engines:args.engines||['searxng','bing'], modes:args.modes||['','official','market','forum','blog','coding','journal','thesis','person'], filetypes:args.filetypes||[], autoPreview:args.autoPreview===true, previewLimit:args.previewLimit||3 }), true)
  if(name==='market_orca_fetch_page') { const out=await fetchPageMarkdown(args.url,{maxChars:args.maxChars||12000}); return { structuredContent:out, content:[{type:'text', text:out.markdown}] } }
  if(name==='market_orca_search_and_answer') { const out=await searchAndAnswer(args.query,{limit:args.limit||6,readLimit:args.readLimit||3,engines:args.engines||['searxng','bing'],modes:args.modes||['','official','market','coding','journal','forum','blog'],time_range:args.time_range||'',domains:args.domains||[]}); return { structuredContent:out, content:[{type:'text', text:out.answer}] } }
  if(name==='market_orca_web_preview') return text(await previewPublicPage(args.url))
  if(name==='market_orca_news_search') return mcpOut(await newsSearch(args.query,{ limit:args.limit||10, engines:args.engines||['searxng'], time_range:args.time_range||'week', domains:args.domains||[], preferTrusted:args.preferTrusted!==false }), true)
  if(name==='market_orca_web_to_crawl') { const out=await webSearch(args.query,{ limit:args.limit||8, engines:args.engines||['searxng'], mode:args.mode||'', sites:args.sites||[], excludeSites:args.excludeSites||[], filetype:args.filetype||'', intitle:args.intitle||'', exact:args.exact||'', after:args.after||'', before:args.before||'' }); const filtered=await filterSearchForCrawl(out.results,{allowUntrusted:true}); const enq=[]; for(const r of filtered.filter(x=>x.crawlAllowed).slice(0,args.enqueueLimit||3)){ enqueueRagCrawl(r.url,{source:r.domain,assetTags:args.assetTags||[]}); enq.push(r.url) } return text({...out,results:filtered,enqueued:enq}) }
  if(name==='market_orca_profile_safe_search') { const out=await webSearch(`"${String(args.name||'').replace(/"/g,'')}"`,{ limit:args.limit||8, engines:['searxng'], preferTrusted:false, dynamic:false }); const results=(out.results||[]).map(r=>({...r,...classifySearchResult(r)})); const publicOpenDocs=results.filter(r=>r.safeToAutoCrawl); const social=results.filter(r=>r.social); const enqueued=[]; if(args.autoCrawlOpenDocs){ for(const r of publicOpenDocs.slice(0,args.enqueueLimit||3)){ enqueueRagCrawl(r.url,{source:r.domain,assetTags:['profile-safe','open-doc']}); enqueued.push(r.url) } } return text({ ok:true, name:args.name, privacy:'public-sources-only; social not auto-crawled', summary:{resultCount:results.length,openDocCount:publicOpenDocs.length,socialCount:social.length,enqueued:enqueued.length}, results, publicOpenDocs, social, enqueued }) }
  if(name==='market_orca_web_capabilities') return text({ ...WEB_SEARCH_CAPABILITIES, trustedSourceCount:TRUSTED_WEB_SOURCES.length, examples:[{mode:'journal',filetype:'pdf',exact:'stock market',after:'2022-01-01'},{mode:'coding',sites:['github.com','sqlite.org'],excludeSites:['medium.com']},{mode:'thesis',filetype:'pdf'}] })
  if(name==='market_orca_trusted_domains') return text(TRUSTED_WEB_SOURCES.slice(0,args.limit||TRUSTED_WEB_SOURCES.length))
  if(name==='market_orca_decision_fingerprint') { const context={...args, ts_bucket:new Date().toISOString().slice(0,10)}; const fingerprint=crypto.createHash('sha256').update(JSON.stringify(context,Object.keys(context).sort())).digest('hex').slice(0,24); return text({ fingerprint, context }) }
  if(name==='market_orca_rag_ask') return text(await ragAsk(args.query, { limit:args.limit||10, topic:args.topic||'', model:args.model||'sonar' }))
  throw new Error('unknown_tool')
}

let nextId = 1
function send(id,result){ process.stdout.write(JSON.stringify({ jsonrpc:'2.0', id, result })+'\n') }
function err(id,error){ process.stdout.write(JSON.stringify({ jsonrpc:'2.0', id, error:{ code:-32000, message:String(error?.message||error) } })+'\n') }

let buf=''
process.stdin.on('data', chunk=>{
  buf += chunk.toString()
  let idx
  while((idx=buf.indexOf('\n'))>=0){
    const line=buf.slice(0,idx).trim(); buf=buf.slice(idx+1); if(!line) continue
    ;(async()=>{
      let msg; try{ msg=JSON.parse(line) }catch(e){ return }
      const id = msg.id ?? nextId++
      try{
        if(msg.method==='initialize') return send(id,{ protocolVersion:'2025-03-26', capabilities:{ tools:{ listChanged:false } }, serverInfo:{ name:'market-orca-mcp', version:'1.2.0' } })
        if(msg.method==='tools/list') return send(id,{ tools })
        if(msg.method==='tools/call') return send(id, await call(msg.params?.name, msg.params?.arguments||{}))
        if(msg.method==='notifications/initialized') return
        send(id,{})
      }catch(e){ err(id,e) }
    })()
  }
})
