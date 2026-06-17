const TRUSTED = [
  ['reuters.com',0.98,'wire'], ['bloomberg.com',0.96,'terminal'], ['cnbc.com',0.88,'media'], ['marketwatch.com',0.84,'media'], ['ft.com',0.94,'media'], ['wsj.com',0.94,'media'],
  ['sec.gov',1,'official'], ['idx.co.id',0.95,'official'], ['bi.go.id',0.96,'official'], ['ojk.go.id',0.95,'official'], ['federalreserve.gov',0.97,'official'],
  ['github.com',0.86,'dev'], ['docs.',0.82,'docs'], ['developer.',0.82,'docs'], ['medium.com',0.68,'blog'], ['substack.com',0.66,'blog'], ['reddit.com',0.62,'forum'], ['news.ycombinator.com',0.64,'forum'], ['stackoverflow.com',0.72,'forum'], ['x.com',0.55,'social'], ['twitter.com',0.55,'social']
]
export function domainOf(url='') { try { return new URL(url).hostname.replace(/^www\./,'').toLowerCase() } catch { return '' } }
export function sourceCredibility(url='', title='') {
  const host = domainOf(url) || String(title).toLowerCase()
  const hit = TRUSTED.find(([d]) => d.endsWith('.') ? host.includes(d) : host.endsWith(d) || host.includes(d))
  return hit ? { domain:host, score:hit[1], type:hit[2], trusted:true } : { domain:host, score:0.5, type:'web', trusted:false }
}
export function freshnessScore(dateLike='') {
  const t = Date.parse(dateLike || '')
  if (!t) return { score:0.55, badge:'unknown-freshness' }
  const days = (Date.now()-t)/86400000
  if (days <= 1) return { score:1, badge:'fresh' }
  if (days <= 3) return { score:0.85, badge:'recent' }
  if (days <= 7) return { score:0.65, badge:'aging' }
  return { score:0.35, badge:'stale' }
}
function decodeHtml(s='') { return String(s).replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#x27;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim() }
function ddgUrl(raw='') { try { const u=new URL(raw); const uddg=u.searchParams.get('uddg'); return uddg ? decodeURIComponent(uddg) : raw } catch { return raw } }
export async function webSearch(query, { limit=10, provider='ddg' } = {}) {
  const url = provider === 'ddg' ? `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}` : `https://duckduckgo.com/html/?q=${encodeURIComponent(query+' site:'+provider)}`
  const r = await fetch(url, { headers:{ 'user-agent':'Mozilla/5.0 MarketOrcaSearch/1.0' } })
  const html = await r.text()
  const out=[]
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g
  let m
  while((m=re.exec(html)) && out.length<limit){
    const link=ddgUrl(decodeHtml(m[1])); const title=decodeHtml(m[2]); const snippet=decodeHtml(m[3]); const cred=sourceCredibility(link,title)
    out.push({ title, url:link, snippet, provider:'duckduckgo_html', credibility:cred, score:cred.score })
  }
  return out.sort((a,b)=>(b.score||0)-(a.score||0))
}
export function trustedDomains() { return TRUSTED.map(([domain,score,type])=>({domain,score,type})) }
