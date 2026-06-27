
import dns from 'node:dns'
import { URL } from 'node:url'

const SSRF_DENY_PREFIXES = ['127.','10.','172.16.','172.17.','172.18.','172.19.','172.20.','172.21.','172.22.','172.23.','172.24.','172.25.','172.26.','172.27.','172.28.','172.29.','172.30.','172.31.','192.168.','169.254.','0.','::1']
const SSRF_DENY_HOSTS = new Set(['localhost','[::1]','metadata.google.internal','169.254.169.254','instance-data','100.100.100.200'])

function isPrivateIP(ip='') { return SSRF_DENY_PREFIXES.some(p=>ip.startsWith(p)) || ip==='::1' || ip==='0.0.0.0' }

const SSRF_MAX_REDIRECTS = Number(process.env.MCP_FETCH_MAX_REDIRECTS || 3)
const SSRF_TIMEOUT_MS = Number(process.env.MCP_FETCH_TIMEOUT_MS || 12000)
const SSRF_ALLOWED_DOMAINS = (process.env.MCP_FETCH_ALLOWED_DOMAINS || '').split(',').filter(Boolean)
const SSRF_INTERNAL_ALLOW = new Set(['127.0.0.1','localhost','0.0.0.0','[::1]'])

const DNS_CACHE = new Map()
const DNS_CACHE_TTL = Number(process.env.SSRF_DNS_CACHE_TTL || 60000)

async function resolveWithCache(hostname) {
  const cached = DNS_CACHE.get(hostname)
  if (cached && Date.now() < cached.exp) return cached.ip
  const { address } = await dns.promises.lookup(hostname)
  DNS_CACHE.set(hostname, { ip: address, exp: Date.now() + DNS_CACHE_TTL })
  return address
}

export async function validateFetchUrl(urlStr='', {internal=false}={}){
  try {
    const u = new URL(urlStr)
    if (!['http:','https:'].includes(u.protocol)) throw new Error('bad_protocol')
    // Internal calls (SearXNG, local services) skip private IP check
    if (internal && SSRF_INTERNAL_ALLOW.has(u.hostname)) {
      return { ok:true, hostname:u.hostname, ip:'127.0.0.1', internal:true }
    }
    if (SSRF_DENY_HOSTS.has(u.hostname)) throw new Error('private_ip_blocked')
    if (SSRF_ALLOWED_DOMAINS.length && !SSRF_ALLOWED_DOMAINS.some(d => u.hostname === d || u.hostname.endsWith('.'+d))) throw new Error('domain_not_allowed')
    if (/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname) && isPrivateIP(u.hostname)) throw new Error('private_ip_blocked')
    const address = await resolveWithCache(u.hostname)
    if (isPrivateIP(address)) throw new Error('private_ip_blocked:'+address)
    return { ok:true, hostname:u.hostname, ip:address }
  } catch(e) { return { ok:false, error:String(e.message||e) } }
}

import { isAllowedSource } from './rag-crawler.js'

const WEB_CACHE = new Map()
function cacheGet(key){ const x=WEB_CACHE.get(key); if(!x) return null; if(Date.now()>x.exp){WEB_CACHE.delete(key); return null} return x.val }
function cacheSet(key,val,ttlMs){ WEB_CACHE.set(key,{val,exp:Date.now()+ttlMs}); if(WEB_CACHE.size>300){ const first=WEB_CACHE.keys().next().value; WEB_CACHE.delete(first) } return val }
export function webCacheStats(){ return { entries:WEB_CACHE.size } }

export const TRUSTED_WEB_SOURCES = [
  // official / regulator / exchange
  'idx.co.id','bi.go.id','ojk.go.id','ksei.co.id','bei.co.id','sec.gov','federalreserve.gov','treasury.gov','ecb.europa.eu','imf.org','worldbank.org','bis.org','bappebti.go.id','kemendag.go.id','kemenkeu.go.id',
  // global finance/news
  'reuters.com','bloomberg.com','ft.com','wsj.com','marketwatch.com','cnbc.com','investing.com','tradingeconomics.com','morningstar.com','seekingalpha.com','barrons.com','finance.yahoo.com','nasdaq.com','nyse.com',
  // indonesia market/news
  'kontan.co.id','bisnis.com','cnbcindonesia.com','katadata.co.id','detik.com','kompas.com','tempo.co','antaranews.com','idnfinancials.com','stockbit.com','ajaib.co.id','bareksa.com',
  // crypto
  'coindesk.com','cointelegraph.com','theblock.co','decrypt.co','coinmarketcap.com','coingecko.com','binance.com','kraken.com','coinbase.com',
  // forum/community/blog
  'reddit.com','medium.com','substack.com','dev.to','news.ycombinator.com','lobste.rs','stackoverflow.com','stackexchange.com','quora.com',
  // dev/ai/research/coding
  'github.com','gitlab.com','bitbucket.org','sourceforge.net','npmjs.com','pypi.org','crates.io','go.dev','rust-lang.org','python.org','nodejs.org','developer.mozilla.org','web.dev','w3.org','stackoverflow.com','stackexchange.com','huggingface.co','arxiv.org','paperswithcode.com','openreview.net','semanticscholar.org','scholar.google.com','researchgate.net','ssrn.com','jstor.org','springer.com','sciencedirect.com','ieee.org','acm.org','mdpi.com','frontiersin.org','nature.com','sciencedaily.com','doaj.org','core.ac.uk','garuda.kemdikbud.go.id','neliti.com','onesearch.id','repository.ugm.ac.id','repository.ui.ac.id','repository.itb.ac.id','repository.unair.ac.id','openai.com','anthropic.com','deepmind.google','microsoft.com','nvidia.com','cloudflare.com','vercel.com','supabase.com',
  // marketing/business/growth
  'hubspot.com','semrush.com','ahrefs.com','moz.com','searchengineland.com','thinkwithgoogle.com','mailchimp.com','shopify.com','stripe.com','hbr.org','mckinsey.com','bcg.com','bain.com','gartner.com','forrester.com','statista.com','similarweb.com',

  // open journals / thesis / repositories / data portals
  'pubmed.ncbi.nlm.nih.gov','ncbi.nlm.nih.gov','plos.org','biorxiv.org','medrxiv.org','osf.io','zenodo.org','figshare.com','dataverse.harvard.edu','kaggle.com','data.gov','data.go.id','perpusnas.go.id','rama.kemdikbud.go.id','eprints.undip.ac.id','repository.ipb.ac.id','repository.its.ac.id','repository.unpad.ac.id','repository.usu.ac.id','repository.binus.ac.id','journal.ui.ac.id','journal.ugm.ac.id','journal.itb.ac.id','sinta.kemdikbud.go.id','doaj.org','oapen.org','openlibrary.org',
  // marketing / ads / analytics / product growth
  'ads.google.com','analytics.google.com','support.google.com','developers.google.com','business.instagram.com','business.facebook.com','tiktok.com/business','ads.tiktok.com','linkedin.com/business','sproutsocial.com','hootsuite.com','buffer.com','later.com','socialmediaexaminer.com','contentmarketinginstitute.com','neilpatel.com','backlinko.com','wordstream.com','unbounce.com','optimizely.com','hotjar.com','mixpanel.com','amplitude.com','segment.com','intercom.com','salesforce.com','klaviyo.com','meta.com',
  // coding / docs / OSS ecosystems
  'docs.github.com','github.blog','git-scm.com','docker.com','kubernetes.io','cncf.io','helm.sh','prometheus.io','grafana.com','nginx.org','postgresql.org','sqlite.org','mysql.com','redis.io','elastic.co','bun.sh','deno.com','typescriptlang.org','react.dev','vuejs.org','astro.build','vite.dev','tailwindcss.com','svelte.dev','nextjs.org','nuxt.com','hono.dev','drizzle.team','prisma.io','ollama.com','modelcontextprotocol.io','docs.anthropic.com','platform.openai.com','ai.google.dev','docs.perplexity.ai',
  // tech media
  'techcrunch.com','theverge.com','technologyreview.com','arstechnica.com','wired.com','ft.com','wsj.com','investing.com','tradingview.com','seekingalpha.com','investopedia.com','fool.com','barrons.com','nasdaq.com','nyse.com','cointelegraph.com','decrypt.co','theblock.co','bankless.com','defillama.com','arxiv.org','paperswithcode.com','openreview.net','semianalysis.com','stratechery.com','platformer.news','venturebeat.com','zdnet.com','bleepingcomputer.com','krebsonsecurity.com','darkreading.com','venturebeat.com','zdnet.com','thenextweb.com','9to5mac.com','androidauthority.com'
]


const SEARCH_MODES = {
  forum:['reddit.com','news.ycombinator.com','stackoverflow.com'],
  blog:['medium.com','substack.com','dev.to'],
  official:['idx.co.id','bi.go.id','ojk.go.id','sec.gov','federalreserve.gov','nasdaq.com','nyse.com'],
  market:['reuters.com','bloomberg.com','cnbc.com','cnbcindonesia.com','marketwatch.com','kontan.co.id','bisnis.com','katadata.co.id','coindesk.com'],
  security:['bleepingcomputer.com','krebsonsecurity.com','darkreading.com','wired.com'],
  research:['arxiv.org','paperswithcode.com','openreview.net','technologyreview.com','semanticscholar.org','doaj.org','core.ac.uk'],
  coding:['github.com','docs.github.com','developer.mozilla.org','stackoverflow.com','npmjs.com','pypi.org','crates.io','go.dev','rust-lang.org','python.org','nodejs.org','docker.com','kubernetes.io','react.dev','vuejs.org','astro.build','hono.dev','drizzle.team','modelcontextprotocol.io'],
  marketing:['hubspot.com','semrush.com','ahrefs.com','moz.com','searchengineland.com','thinkwithgoogle.com','ads.google.com','business.instagram.com','business.facebook.com','ads.tiktok.com','linkedin.com/business','contentmarketinginstitute.com','backlinko.com','wordstream.com','hbr.org','mckinsey.com','bcg.com','bain.com'],
  journal:['arxiv.org','semanticscholar.org','doaj.org','core.ac.uk','pubmed.ncbi.nlm.nih.gov','plos.org','biorxiv.org','medrxiv.org','mdpi.com','frontiersin.org','nature.com','springer.com','sciencedirect.com','ieee.org','acm.org','ssrn.com','osf.io','zenodo.org'],
  thesis:['garuda.kemdikbud.go.id','rama.kemdikbud.go.id','neliti.com','onesearch.id','perpusnas.go.id','repository.ugm.ac.id','repository.ui.ac.id','repository.itb.ac.id','repository.unair.ac.id','repository.ipb.ac.id','repository.its.ac.id','eprints.undip.ac.id'],
  data:['data.go.id','data.gov','worldbank.org','imf.org','bis.org','kaggle.com','dataverse.harvard.edu','figshare.com','zenodo.org'],
  docs:['developer.mozilla.org','docs.github.com','platform.openai.com','docs.anthropic.com','modelcontextprotocol.io','ai.google.dev','docs.perplexity.ai','kubernetes.io','postgresql.org','sqlite.org'],
  person:['linkedin.com','github.com','instagram.com','facebook.com','youtube.com','x.com','twitter.com','medium.com','about.me']
}

function buildAdvancedQuery(query,{mode='',sites=[],domains=[],site='',excludeSites=[],filetype='',intitle='',exact='',after='',before='',time_range='',mustHave=[]}={}){
  const parts=[String(query||'').trim()]
  if(exact) parts.push(`"${String(exact).replace(/"/g,'').trim()}"`)
  for(const t of mustHave||[]) if(t) parts.push(`+${String(t).trim()}`)
  if(intitle) parts.push(`intitle:${String(intitle).replace(/\s+/g,' ').trim()}`)
  if(filetype) parts.push(`filetype:${String(filetype).replace(/^\./,'').trim()}`)
  if(time_range && !after){ const days={day:1,week:7,month:31,year:365}[time_range]||0; if(days){ const d=new Date(Date.now()-days*86400000); after=d.toISOString().slice(0,10) } }
  if(after) parts.push(`after:${String(after).slice(0,10)}`)
  if(before) parts.push(`before:${String(before).slice(0,10)}`)
  const modeSites = SEARCH_MODES[mode] || []
  const allSites=[...new Set([...(sites||[]), ...(domains||[]), ...(site?[site]:[]), ...modeSites].filter(Boolean))]
  if(allSites.length) parts.push(`(${allSites.map(x=>`site:${x}`).join(' OR ')})`)
  for(const x of excludeSites||[]) if(x) parts.push(`-site:${x}`)
  return parts.filter(Boolean).join(' ').replace(/\s+/g,' ').trim()
}

export const WEB_SEARCH_CAPABILITIES = {
  operators:['site:','-site:','filetype:','intitle:','"exact phrase"','after:YYYY-MM-DD','before:YYYY-MM-DD'],
  modes:Object.keys(SEARCH_MODES),
  filetypes:['pdf','html','doc','docx','ppt','pptx','csv','json'],
  engines:['duckduckgo','bing','yahoo','yandex']
}

function applyMode(query, mode){ const sites=SEARCH_MODES[mode]; if(!sites?.length) return query; return `${query} (${sites.map(s=>`site:${s}`).join(' OR ')})` }

function clean(s=''){ return String(s).replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim() }
function host(url){ try { return new URL(url).hostname.replace(/^www\./,'') } catch { return '' } }
function trustedScore(url){ const h=host(url); const idx=TRUSTED_WEB_SOURCES.findIndex(d=>h===d||h.endsWith('.'+d)); return idx>=0 ? 100-idx : 10 }

function decodeMaybeBase64(s=''){
  try { let x=String(s); if(x.startsWith('a1')) x=x.slice(2); x=x.replace(/-/g,'+').replace(/_/g,'/'); return Buffer.from(x,'base64').toString('utf8') } catch { return s }
}
function resolveSearchRedirect(u=''){
  try{
    const raw=String(u).replace(/&amp;/g,'&')
    const x=new URL(raw)
    if(x.hostname.includes('bing.com') && x.pathname.includes('/ck/')){ const enc=x.searchParams.get('u'); const dec=enc?decodeMaybeBase64(enc):''; if(/^https?:/.test(dec)) return dec }
    if(x.hostname.includes('search.yahoo.com') || x.hostname.includes('r.search.yahoo.com')){ const m=raw.match(/\/RU=([^/]+)\/RK=/); if(m) return decodeURIComponent(m[1]) }
    return raw
  }catch{return String(u||'')}
}
function isBadSearchResultUrl(u=''){
  const h=host(u); return !/^https?:/.test(u) || /bing\.com|yahoo\.com|yandex\.com|yandex\.cloud|duckduckgo\.com/.test(h) || /captcha|smartcaptcha|\/search\?/.test(u)
}
function extractSearchBlocks(html='', engine=''){
  if(engine==='bing') return [...html.matchAll(/<li class="b_algo"[\s\S]*?<\/li>/g)].map(m=>m[0])
  if(engine==='yahoo') return [...html.matchAll(/<h3[^>]*>[\s\S]*?<\/h3>[\s\S]{0,1400}/g)].map(m=>m[0])
  return []
}
function resultFromBlock(block='', engine='', query=''){
  const links=[...block.matchAll(/href="([^"]+)"/g)].map(m=>resolveSearchRedirect(m[1])).filter(u=>!isBadSearchResultUrl(u))
  const url=links[0]
  if(!url) return null
  const title=clean((block.match(/<h3[^>]*>[\s\S]*?<\/h3>/i)?.[0] || block.match(/<a[^>]*>[\s\S]*?<\/a>/i)?.[0] || query)).slice(0,180)
  const snippet=clean(block).replace(title,'').slice(0,420)
  return { title:title||query, url, snippet, source:engine, domain:host(url), trust:trustedScore(url) }
}
export async function previewPublicPage(url){
  const ssrf=await validateFetchUrl(url); if(!ssrf.ok) throw new Error('ssrf_blocked:'+ssrf.error)
  // Redirect limiter: follow up to SSRF_MAX_REDIRECTS, re-validate each hop
  let current=url
  const fetchOpts={headers:{'user-agent':'Mozilla/5.0 MarketOrcaPreview/1.0'},signal:AbortSignal.timeout(SSRF_TIMEOUT_MS),redirect:'manual'}
  for(let hop=0; hop<=SSRF_MAX_REDIRECTS; hop++){
    const r=await fetch(current, fetchOpts)
    if([301,302,303,307,308].includes(r.status)){
      const loc=r.headers.get('location')
      if(!loc) throw new Error('redirect_missing_location')
      try{ current=new URL(loc, current).href }catch{ throw new Error('redirect_invalid') }
      const hopCheck=await validateFetchUrl(current); if(!hopCheck.ok) throw new Error('ssrf_redirect_blocked:'+hopCheck.error)
      continue
    }
    if(!r.ok) throw new Error(`preview_${r.status}`)
    const html=await r.text()
    const title=clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'')
    const desc=clean(html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i)?.[1]||html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)/i)?.[1]||'')
    const text=clean(html.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ')).slice(0,2000)
    return {ok:true,url:current,title,description:desc,text:cleanSnippet(text)}
  }
  throw new Error('redirect_limit_exceeded:'+SSRF_MAX_REDIRECTS)
}

function decodeDdgUrl(u){ try{ const x=new URL(u); const uddg=x.searchParams.get('uddg'); return uddg ? decodeURIComponent(uddg) : u } catch { return u } }

async function searchSearxng(query,{limit=10, categories='general'}={}){
  const base = process.env.SEARXNG_URL || process.env.SEARX_URL || ''
  if (!base) throw new Error('searxng_not_configured')
  const searchUrl = `${base.replace(/\/$/,'')}/search?q=${encodeURIComponent(query)}&format=json&language=all&safesearch=0&categories=${encodeURIComponent(categories)}`
  // Validate SSRF before hitting external service
  const ssrf = await validateFetchUrl(searchUrl, { internal: true }).catch(() => ({ ok: false, error: 'validate_fail' }))
  if (!ssrf.ok) {
    // localhost SearXNG is allowed as internal
    if (!base.startsWith('http://127.') && !base.startsWith('http://localhost') && !base.startsWith('http://0.')) {
      throw new Error('searxng_blocked:'+ssrf.error)
    }
  }
  let lastErr
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(searchUrl,{headers:{'user-agent':'MarketOrcaSearch/1.0','accept':'application/json'},signal:AbortSignal.timeout(8000)})
      if(!r.ok) throw new Error(`searxng_${r.status}`)
      const j=await r.json(); const rows=Array.isArray(j.results)?j.results:[]
      return rows.slice(0,limit*2).map(x=>{ const u=x.url||''; return { title:clean(x.title||u), url:u, snippet:clean(x.content||''), source:'searxng', domain:host(u), trust:trustedScore(u), engines:x.engines||[] } }).filter(x=>/^https?:/.test(x.url)).sort((a,b)=>b.trust-a.trust).slice(0,limit)
    } catch(e) { lastErr = e; if (attempt === 0) await new Promise(r => setTimeout(r, 1000)) }
  }
  throw lastErr || new Error('searxng_retries_exhausted')
}

async function searchDuckDuckGo(query,{limit=10}={}){
  const url=`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 MarketOrcaSearch/1.0'},signal:AbortSignal.timeout(12000)})
  if(!r.ok) throw new Error(`duckduckgo_${r.status}`)
  const html=await r.text()
  const out=[]
  const re=/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g
  let m; while((m=re.exec(html)) && out.length<limit*2){ const resultUrl=decodeDdgUrl(m[1]); out.push({ title:clean(m[2]), url:resultUrl, snippet:clean(m[3]), source:'duckduckgo', domain:host(resultUrl), trust:trustedScore(resultUrl) }) }
  if(!out.length){ const re2=/<a[^>]+href="([^"]+)"[^>]*>([^<]{20,})<\/a>/g; while((m=re2.exec(html)) && out.length<limit){ const resultUrl=decodeDdgUrl(m[1]); if(/^https?:/.test(resultUrl) && !/captcha|smartcaptcha/i.test(resultUrl)) out.push({title:clean(m[2]),url:resultUrl,snippet:'',source:'duckduckgo',domain:host(resultUrl),trust:trustedScore(resultUrl)}) } }
  return out.sort((a,b)=>b.trust-a.trust).slice(0,limit)
}


async function searchBingLite(query,{limit=10}={}){ return searchGenericHtml('bing',`https://www.bing.com/search?q=${encodeURIComponent(query)}`,/<li class="b_algo"[\s\S]*?<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/g,query,limit) }
async function searchYahooLite(query,{limit=10}={}){ return searchGenericHtml('yahoo',`https://search.yahoo.com/search?p=${encodeURIComponent(query)}`,/<a[^>]+href="(https?:\/\/[^\"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]{0,500}?<p[^>]*>([\s\S]*?)<\/p>/g,query,limit) }
async function searchYandexLite(query,{limit=10}={}){ return searchGenericHtml('yandex',`https://yandex.com/search/?text=${encodeURIComponent(query)}`,/<a[^>]+href="(https?:\/\/[^\"]+)"[^>]*>([\s\S]*?)<\/a>/g,query,limit) }
async function searchGenericHtml(engine,url,re,query,limit){
  const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 MarketOrcaSearch/1.0'},signal:AbortSignal.timeout(12000)})
  if(!r.ok) throw new Error(`${engine}_${r.status}`)
  const html=await r.text(); const out=[]
  const blocks=extractSearchBlocks(html,engine)
  for(const b of blocks){ const item=resultFromBlock(b,engine,query); if(item) out.push(item); if(out.length>=limit*2) break }
  if(!out.length){ let m; while((m=re.exec(html)) && out.length<limit*2){ const resultUrl=resolveSearchRedirect(m[1]); if(isBadSearchResultUrl(resultUrl)) continue; out.push(normalizeResult({title:clean(m[2]||query),url:resultUrl,snippet:clean(m[3]||''),source:engine,domain:host(resultUrl),trust:trustedScore(resultUrl)})) } }
  return out.sort((a,b)=>b.trust-a.trust).slice(0,limit)
}


function cleanSnippet(s=''){
  return clean(String(s)
    .replace(/Nilai\s*\d+[,.]\d+\([^)]*\)/gi,' ')
    .replace(/\b\d+[,.]\d+\s*\([\d.,]+\)\b/g,' ')
    .replace(/\b\d{1,2}\s+(Jan|Feb|Mar|Apr|Mei|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}\s*[·-]?/gi,' ')
    .replace(/\.\.\.$/,'')
  ).slice(0,1200)
}
function normalizeResult(r={}){
  return {...r, snippet:cleanSnippet(r.snippet||r.content||''), content:cleanSnippet(r.content||r.snippet||'')}
}

function relevanceScore(query,r){ const terms=String(query).toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length>2); const hay=`${r.title} ${r.snippet} ${r.domain}`.toLowerCase(); return terms.reduce((s,t)=>s+(hay.includes(t)?6:0),0) }
function qualityScore(query,r,exact=''){ const forum=/reddit|hacker news|stackoverflow|lobste|quora/i.test(`${r.domain} ${r.title}`)?8:0; const text=(r.snippet||'').length>80?6:0; const hay=`${r.title} ${r.snippet} ${r.url}`.toLowerCase(); const phrase=String(exact||'').toLowerCase().trim(); const exactScore=phrase ? (hay.includes(phrase)?50:-25) : 0; return Math.round((r.trust||0)+relevanceScore(query,r)+forum+text+exactScore) }
function queryVariants(query, mode, opts={}){ const q=String(query||'').trim(); const advanced=buildAdvancedQuery(q,{...opts,mode}); const presets=[]; presets.push(advanced); if(opts.exact) presets.push(q); else if(!mode && !opts.filetype && !opts.sites?.length) presets.push(q, `${q} analysis`, `${q} latest source`, `${q} reddit OR medium OR substack`); else presets.push(q); return [...new Set(presets.filter(Boolean))].slice(0,4) }

function confidenceLabel(score){ if(score>=70) return 'high'; if(score>=35) return 'medium'; return 'low' }
function clusterResults(results=[]){
  const clusters={}
  for(const r of results){
    const key=(r.domain||'unknown').replace(/^www\./,'')
    clusters[key] ||= {domain:key,count:0,best:null,urls:[]}
    clusters[key].count++; clusters[key].urls.push(r.url)
    if(!clusters[key].best || (r.quality||0)>(clusters[key].best.quality||0)) clusters[key].best=r
  }
  return Object.values(clusters).sort((a,b)=>(b.best?.quality||0)-(a.best?.quality||0)).slice(0,12)
}
async function previewTopResults(results=[], n=3){
  const out=[]
  for(const r of results.slice(0,n)){
    try{ out.push({result:r, preview:await previewPublicPage(r.url)}) }
    catch(e){ out.push({result:r, preview:{ok:false,error:String(e.message||e)}}) }
  }
  return out
}

export async function webSearch(query,{limit=10, engines=['searxng','duckduckgo','bing','yahoo','yandex'], preferTrusted=true, mode='', dynamic=true, sites=[], domains=[], site='', excludeSites=[], filetype='', intitle='', exact='', after='', before='', time_range='', mustHave=[], autoPreview=false, previewLimit=3, cacheTtlMs=300000}={}){
  const cacheKey='webSearch:'+JSON.stringify({query,limit,engines,preferTrusted,mode,dynamic,sites,domains,site,excludeSites,filetype,intitle,exact,after,before,time_range,mustHave,autoPreview,previewLimit})
  const cached=cacheTtlMs?cacheGet(cacheKey):null; if(cached) return {...cached, cached:true}
  const opts={sites,domains,site,excludeSites,filetype,intitle,exact,after,before,time_range,mustHave}
  const variants=dynamic ? queryVariants(query, mode, opts) : [buildAdvancedQuery(query,{...opts,mode})]
  const results=[]; const errors=[]
  for (const finalQuery of variants) for(const e of engines){ try{ if(e==='searxng') results.push(...(await searchSearxng(finalQuery,{limit})).map(r=>({...r,finalQuery}))); else if(e==='duckduckgo') results.push(...(await searchDuckDuckGo(finalQuery,{limit})).map(r=>({...r,finalQuery}))); else if(e==='bing') results.push(...(await searchBingLite(finalQuery,{limit})).map(r=>({...r,finalQuery}))); else if(e==='yahoo') results.push(...(await searchYahooLite(finalQuery,{limit})).map(r=>({...r,finalQuery}))); else if(e==='yandex') results.push(...(await searchYandexLite(finalQuery,{limit})).map(r=>({...r,finalQuery}))); else errors.push({engine:e,error:'unknown_engine'}) } catch(err){ errors.push({engine:e,error:String(err.message||err)}) } }
  const seen=new Set(); const uniq=[]
  for(const r of results){ const k=r.url.replace(/[#?].*$/,''); if(seen.has(k)) continue; seen.add(k); uniq.push({...r,quality:qualityScore(query,r,exact)}) }
  let ranked = uniq.sort((a,b)=> preferTrusted ? b.quality-a.quality : b.quality-a.quality); if(exact) ranked=ranked.filter(r=>r.quality>=0); ranked=ranked.slice(0,limit).map(r=>({...r,confidence:confidenceLabel(r.quality||0)}))
  if (!ranked.length) {
    const sites = (SEARCH_MODES[mode] || TRUSTED_WEB_SOURCES).slice(0, limit)
    ranked = sites.map(s=>({ title:`Search ${s}: ${query}`, url:`https://duckduckgo.com/?q=${encodeURIComponent(`${query} site:${s}`)}`, snippet:'fallback search link; engine blocked or returned no parseable HTML', source:'fallback_query', domain:s, trust:trustedScore(`https://${s}`), quality:trustedScore(`https://${s}`) }))
  }
  return cacheSet(cacheKey, { ok:true, query, variants, mode, engines, errors, results:ranked, clusters:clusterResults(ranked), previews:autoPreview?await previewTopResults(ranked, Number(previewLimit||3)):[], trustedSources:TRUSTED_WEB_SOURCES, capabilities:WEB_SEARCH_CAPABILITIES, modes:Object.keys(SEARCH_MODES) }, cacheTtlMs)
}

export function classifySearchResult(r={}){
  const d=String(r.domain||''); const u=String(r.url||''); const text=`${r.title||''} ${r.snippet||''}`.toLowerCase()
  const social=/instagram\.com|facebook\.com|tiktok\.com|x\.com|twitter\.com|linkedin\.com/.test(d)
  const openDoc=/\.pdf($|[?#])|ojs\.|journal\.|repository\.|garuda\.|neliti\.|onesearch|arxiv|semanticscholar|doaj|core\.ac|mdpi|frontiers|springer|sciencedirect|ieee|acm/i.test(u+' '+d)
  const publicAcademic=openDoc || /jurnal|journal|skripsi|thesis|repository|paper|proceeding|doi/.test(text)
  return { social, openDoc, publicAcademic, safeToAutoCrawl: !social && (openDoc || publicAcademic || /github|docs|developer|wikipedia|official/.test(d)) }
}
export async function filterSearchForCrawl(results,{allowUntrusted=true, openDocsOnly=false}={}){
  const out=[]
  for(const r of results){ const cls=classifySearchResult(r); const policy=await isAllowedSource(r.url).catch(e=>({ok:false,reason:String(e.message||e)})); if((policy.ok || allowUntrusted) && (!openDocsOnly || cls.safeToAutoCrawl)) out.push({...r,...cls,crawlAllowed:policy.ok,crawlPolicy:policy.reason||'allowed'}) }
  return out
}

export async function deepWebSearch(query,{limit=30, engines=['bing','yahoo','duckduckgo'], modes=['','official','market','forum','blog','coding','journal','thesis','person'], filetypes=[], autoPreview=false, previewLimit=3}={}){
  const buckets=[]; const errors=[]; const seen=new Set(); const merged=[]
  const tasks=[]
  for(const mode of modes) tasks.push({mode,filetype:''})
  for(const ft of filetypes) tasks.push({mode:'',filetype:ft})
  for(const t of tasks.slice(0,14)){
    try{
      const out=await webSearch(query,{limit:Math.min(8,limit),engines,mode:t.mode,filetype:t.filetype,dynamic:true,preferTrusted:true})
      buckets.push({mode:t.mode,filetype:t.filetype,count:out.results.length,errors:out.errors})
      errors.push(...(out.errors||[]).map(e=>({...e,mode:t.mode,filetype:t.filetype})))
      for(const r of out.results||[]){ const k=(r.url||'').replace(/[#?].*$/,''); if(!k||seen.has(k)) continue; seen.add(k); merged.push({...r,mode:t.mode,filetype:t.filetype}) }
    }catch(e){ errors.push({mode:t.mode,filetype:t.filetype,error:String(e.message||e)}) }
  }
  const ranked=merged.sort((a,b)=>(b.quality||0)-(a.quality||0)).slice(0,limit)
  return {ok:true,query,engines,modes,filetypes,buckets,errors,results:ranked,clusters:clusterResults(ranked),previews:autoPreview?await previewTopResults(ranked,previewLimit):[]}
}


export async function fetchPageMarkdown(url,{maxChars=12000, cacheTtlMs=900000}={}){
  const cacheKey='fetchPage:'+url+':'+maxChars; const cached=cacheTtlMs?cacheGet(cacheKey):null; if(cached) return {...cached,cached:true}
  const p=await previewPublicPage(url)
  const md=[`# ${p.title||url}`, p.description?`\n> ${p.description}`:'', `\nSource: ${url}`, '\n## Content\n', p.text||''].join('\n')
  return cacheSet(cacheKey,{ok:true,url,title:p.title,description:p.description,markdown:md.slice(0,maxChars),chars:Math.min(md.length,maxChars)},cacheTtlMs)
}
// ─── JS-gated page detector ─────────────────────────────────────────────
function isJSGated(text='') {
  const patterns = [
    /please enable scripts/i, /please enable javascript/i,
    /your browser does not have javascript/i, /turn on javascript/i,
    /this site requires javascript/i, /javascript is required/i,
    /enable javascript to continue/i, /browser does not support javascript/i,
    /you need to enable javascript/i, /javascript must be enabled/i,
    /skip to main content/i, /turn off animations/i, /standard browser navigation/i,
  ]
  return text && patterns.some(p => p.test(text))
}

function sentenceSplit(s=''){ return String(s).replace(/\s+/g,' ').split(/(?<=[.!?])\s+/).filter(x=>x.length>30).slice(0,80) }

function answerFromSources(query, sources=[]){
  const qterms=String(query).toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length>2)
  
  // Filter out JS-gated or empty sources
  const validSources = sources.filter(s => {
    const text = (s.text||s.markdown||s.description||'')
    return !isJSGated(text) && text.length > 50 && s.ok !== false
  })
  
  if (!validSources.length) return `# Jawaban Web Research\n\n**Pertanyaan:** ${query}\n\n## Ringkasan\n- Maaf, belum bisa membaca konten dari sumber yang ditemukan. Sebagian besar situs memblokir akses otomatis. Coba ulangi dengan domain sumber yang lebih spesifik.\n\n## Hasil Pencarian\n${sources.map((s,i)=>`- [${i+1}] ${s.title||s.url} — ${s.url}`).join('\n')}`
  
  const bullets = []
  const usedSources = new Set()
  
  validSources.forEach((src,i)=>{
    const text = src.text||src.markdown||src.description||''
    const sentences = sentenceSplit(text)
      .map(x=>({x, score: qterms.reduce((n,t)=>n+(x.toLowerCase().includes(t)?1:0),0)}))
      .sort((a,b)=>b.score-a.score)
      .slice(0, Math.max(2, Math.min(4, Math.ceil(sentences.length/3))))
    
    for(const s of sentences) {
      bullets.push({ text: s, sourceIdx: i + 1, sourceLabel: src.title || src.url })
      usedSources.add(i)
    }
  })
  
  const summary = bullets.slice(0, 12)
    .map((b, i) => `${b.text} — [${b.sourceIdx}]`)
    .join('\n\n')
  
  return `# Jawaban Web Research — Perplexity-Style

**Pertanyaan:** ${query}
**Sumber:** ${validSources.length} halaman terbaca dari ${sources.length} ditemukan

## Ringkasan
${summary || '- Konten yang relevan belum cukup.'}

## Sumber
${validSources.map((s,i)=>`[${i+1}] **${s.title||'Tanpa judul'}** — ${s.url}\n    ${s.description?.slice(0,120)||''}`).join('\n')}

---
> Riset otomatis oleh Market Orca. Verifikasi mandiri sebelum digunakan.
> ${validSources.filter(s => {
    const t = s.text||s.markdown||''
    return !/^(https?:\/\/)/.test(t?.trim?.())
  }).length ? `${validSources.filter(s => {
    const t = s.text||s.markdown||''
    return !/^(https?:\/\/)/.test(t?.trim?.())
  }).length}/${validSources.length} sumber mungkin JS-gated — jika ringkasan kurang memuaskan, coba ulangi dengan domain spesifik.` : 'Semua sumber terbaca dengan baik.'}`
}

function cleanContent(text='') {
  // Remove JS-gated noise
  return text
    .replace(/please enable scripts and reload this page\.?/gi, '')
    .replace(/turn on (more accessible mode|animations)/gi, '')
    .replace(/skip ribbon commands|skip to main content/gi, '')
    .replace(/to navigate through the ribbon[^.]*\./gi, '')
    .replace(/it looks like your browser does not have javascript/i, '')
    .replace(/you may be trying to access this site from a secured browser/i, '')
    .trim()
}

export async function searchAndAnswer(query,{limit=6,readLimit=4,engines=['searxng','bing','duckduckgo'],modes=['','official','market','coding','journal','forum','blog'],time_range='',domains=[],sites=[]}={}){
  const search=await deepWebSearch(query,{limit,engines,modes,autoPreview:false})
  const sources=[]
  for(const r of (search.results||[]).slice(0,readLimit)){
    try{ 
      const p=await previewPublicPage(r.url)
      const text = cleanContent(p.text||'')
      if (isJSGated(text) || text.length < 30) {
        sources.push({ok:false,url:r.url,title:r.title,error:'JS-gated page', text: r.snippet||''})
      } else {
        sources.push({...p, text, rank:sources.length+1,searchResult:r})
      }
    } catch(e){ 
      sources.push({ok:false,url:r.url,title:r.title,error:String(e.message||e).slice(0,100),text:r.snippet||''}) 
    }
  }
  const answer=answerFromSources(query,sources)
  return {ok:true,query,answer,sources:sources.map((s,i)=>({n:i+1,url:s.url,title:s.title,description:s.description,ok:s.ok!==false,error:s.error||''})),search:{results:search.results?.slice(0,limit)||[],clusters:search.clusters||[],errors:search.errors||[]}}
}

export async function searchNews(query, {limit=10, language='all', time_range='', sources=[]}={}){
  const results=[]; const errors=[]
  const lang=language||'all'
  // 1) SearXNG news category
  const searxngBase = process.env.SEARXNG_URL || process.env.SEARX_URL || ''
  if(searxngBase){
    try{
      const url=`${searxngBase.replace(/\/$/,'')}/search?q=${encodeURIComponent(query)}&format=json&language=${lang}&safesearch=0&categories=news`
      const r=await fetch(url,{headers:{'user-agent':'MarketOrcaNews/1.0','accept':'application/json'},signal:AbortSignal.timeout(8000)})
      if(r.ok){
        const j=await r.json()
        const rows=Array.isArray(j.results)?j.results:[]
        for(const x of rows){
          const u=x.url||''
          if(!/^https?:/.test(u)) continue
          results.push({
            title:x.title||'',
            url:u,
            snippet:x.content||'',
            source:x.engine?.[0]||'searxng',
            domain:host(u),
            published_at:x.publishedDate||x.pubdate||'',
            engine:'searxng'
          })
        }
      }
    } catch(e){ errors.push({engine:'searxng',error:String(e.message||e)}) }
  }
  // 2) DDG news fallback
  if(results.length<limit){
    try{
      const ddgUrl=`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&iar=news`
      const r=await fetch(ddgUrl,{headers:{'user-agent':'Mozilla/5.0 MarketOrcaNews/1.0'},signal:AbortSignal.timeout(8000)})
      if(r.ok){
        const html=await r.text()
        const re=/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g
        let m; while((m=re.exec(html)) && results.length<limit){
          const resultUrl=decodeDdgUrl(m[1])
          if(!/^https?:/.test(resultUrl)) continue
          results.push({
            title:clean(m[2]),
            url:resultUrl,
            snippet:clean(m[3]),
            source:'duckduckgo',
            domain:host(resultUrl),
            published_at:'',
            engine:'duckduckgo'
          })
        }
      }
    } catch(e){ errors.push({engine:'duckduckgo',error:String(e.message||e)}) }
  }
  // 3) Google News RSS fallback
  if(results.length<2){
    try{
      const gUrl=`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`
      const r=await fetch(gUrl,{headers:{'user-agent':'MarketOrcaNews/1.0'},signal:AbortSignal.timeout(6000)})
      if(r.ok){
        const xml=await r.text()
        const items=[...xml.matchAll(/<item>[\s\S]*?<\/item>/g)].slice(0,limit-results.length)
        for(const item of items){
          const title=(item[0].match(/<title>([\s\S]*?)<\/title>/i)?.[1]||'').replace(/<!\[CDATA\[|\]\]>/g,'').trim()
          const link=item[0].match(/<link>([\s\S]*?)<\/link>/i)?.[1]||''
          const pubDate=item[0].match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1]||''
          const desc=(item[0].match(/<description>([\s\S]*?)<\/description>/i)?.[1]||'').replace(/<!\[CDATA\[|\]\]>/g,'').trim()
          if(!title||!link) continue
          results.push({title:clean(title),url:link,snippet:clean(desc),source:'google-news',domain:host(link),published_at:pubDate,engine:'google-news'})
        }
      }
    } catch(e){ errors.push({engine:'google-news',error:String(e.message||e)}) }
  }
  // Dedupe by URL
  const seen=new Set(); const uniq=[]
  for(const r of results){ const k=r.url.replace(/[#?].*$/,''); if(seen.has(k)) continue; seen.add(k); uniq.push(r) }
  // Sort by published_at descending if available
  uniq.sort((a,b)=>{
    const ta=a.published_at?new Date(a.published_at).getTime():0
    const tb=b.published_at?new Date(b.published_at).getTime():0
    return tb-ta
  })
  return {ok:true,query,count:uniq.length,results:uniq.slice(0,limit),errors}
}

export async function newsSearch(query, {limit=10, engines=['searxng'], time_range='week', domains=[], preferTrusted=true} = {}) {
  const cacheKey = 'newsSearch:'+JSON.stringify({query,limit,engines,time_range,domains})
  const cached = cacheGet(cacheKey); if (cached) return {...cached, cached:true}
  const variants = [query, `${query} news`, `${query} latest`]
  const allResults = []
  for (const v of variants.slice(0, 2)) {
    try {
      const out = await webSearch(v, { limit, engines, mode:'market', time_range, domains, preferTrusted, dynamic:false, cacheTtlMs:300000 })
      allResults.push(...(out.results || []))
    } catch(e) { /* skip */ }
  }
  // Also try SearXNG news category
  const searxngBase = process.env.SEARXNG_URL || process.env.SEARX_URL || ''
  if (searxngBase) try {
    const searxUrl = `${searxngBase.replace(/\/$/,'')}/search?q=${encodeURIComponent(query)}&format=json&categories=news&time_range=${time_range}`
    const r = await fetch(searxUrl, { headers: { 'user-agent': 'MarketOrcaNews/1.0', 'accept': 'application/json' }, signal: AbortSignal.timeout(10000) })
    if (!r.ok) throw new Error(`searxng_news_${r.status}`)
    const data = await r.json()
    const newsResults = (data?.results || []).map(r => ({
      title: clean(r.title || ''),
      url: r.url || '',
      snippet: clean(r.content || '').slice(0, 600),
      source: r.engine || 'searxng-news',
      domain: host(r.url || ''),
      trust: trustedScore(r.url || ''),
      publishedDate: r.publishedDate || r.published_date || '',
      thumbnail: r.thumbnail || ''
    })).filter(r => r.url && /^https?:/.test(r.url))
    allResults.push(...newsResults)
  } catch(e) { /* skip */ }
  // Dedupe by URL
  const seen = new Set()
  const deduped = allResults.filter(r => { const k = r.url.replace(/[?#].*/,''); if (seen.has(k)) return false; seen.add(k); return true })
  const ranked = deduped.sort((a,b) => (b.quality || b.trust || 0) - (a.quality || a.trust || 0)).slice(0, limit)
  return cacheSet(cacheKey, { ok:true, query, time_range, results:ranked, count:ranked.length, trustedSources: TRUSTED_WEB_SOURCES }, 300000)
}
