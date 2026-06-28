#!/usr/bin/env python3
"""
Lightweight SearXNG-compatible API
- No Docker, no heavy deps
- Uses existing search engines: duckduckgo, bing, yahoo, yandex
- Compatible with autolearn's searxng client calls
"""
import asyncio
import json
import os
import sys
from typing import List, Optional
from fastapi import FastAPI, Query, HTTPException
from fastapi.responses import JSONResponse
import uvicorn
import httpx
from bs4 import BeautifulSoup
import re

app = FastAPI(title="Market Orca Search API", version="1.0")

# Simple in-memory cache (TTL 5 min)
_cache = {}
_CACHE_TTL = 300

async def search_duckduckgo(query: str, limit: int = 10) -> List[dict]:
    """Search DuckDuckGo HTML"""
    url = "https://html.duckduckgo.com/html/"
    params = {"q": query}
    headers = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"}
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(url, data=params, headers=headers)
    soup = BeautifulSoup(r.text, 'html.parser')
    results = []
    for link in soup.select('.result__snippet')[:limit]:
        title_elem = link.find_previous('a', class_='result__url')
        title = title_elem.get_text(strip=True) if title_elem else query
        url_elem = link.find_previous('a', class_='result__snippet')
        href = url_elem.get('href') if url_elem else ''
        snippet = link.get_text(strip=True)[:300]
        if href and snippet:
            results.append({
                "title": title,
                "url": href,
                "content": snippet,
                "engine": "duckduckgo",
                "score": 0.8
            })
    return results

async def search_bing(query: str, limit: int = 10) -> List[dict]:
    """Search Bing HTML (public)"""
    url = "https://www.bing.com/search"
    params = {"q": query, "count": limit}
    headers = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"}
    async with httpx.AsyncClient(timeout=10, follow_redirects=False) as client:
        r = await client.get(url, params=params, headers=headers)
    soup = BeautifulSoup(r.text, 'html.parser')
    results = []
    for item in soup.select('li.b_algo')[:limit]:
        title_elem = item.select_one('h2 a')
        snippet_elem = item.select_one('.b_caption p')
        if title_elem:
            title = title_elem.get_text(strip=True)
            href = title_elem.get('href', '')
            snippet = snippet_elem.get_text(strip=True)[:300] if snippet_elem else ''
            # Resolve Bing redirect URLs via HEAD
            real_url = href
            if 'bing.com/ck/a' in href or 'bing.com/cc/a' in href:
                try:
                    async with httpx.AsyncClient(timeout=5, follow_redirects=True) as c2:
                        hr = await c2.head(href, headers={'User-Agent': 'Mozilla/5.0'})
                        real_url = str(hr.url)
                except:
                    pass
            if real_url and snippet:
                results.append({
                    "title": title,
                    "url": real_url,
                    "content": snippet,
                    "engine": "bing",
                    "score": 0.85
                })
    return results

async def search_yahoo(query: str, limit: int = 10) -> List[dict]:
    """Search Yahoo"""
    url = "https://search.yahoo.com/search"
    params = {"p": query, "n": limit}
    headers = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"}
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(url, params=params, headers=headers)
    soup = BeautifulSoup(r.text, 'html.parser')
    results = []
    for item in soup.select('div.dd.algo')[:limit]:
        title_elem = item.select_one('h3 a')
        snippet_elem = item.select_one('.compText')
        if title_elem:
            title = title_elem.get_text(strip=True)
            url = title_elem.get('href', '')
            snippet = snippet_elem.get_text(strip=True)[:300] if snippet_elem else ''
            if url and snippet:
                results.append({
                    "title": title,
                    "url": url,
                    "content": snippet,
                    "engine": "yahoo",
                    "score": 0.75
                })
    return results

async def search_yandex(query: str, limit: int = 10) -> List[dict]:
    """Search Yandex"""
    url = "https://yandex.com/search/"
    params = {"text": query, "lr": "213"}
    headers = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"}
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(url, params=params, headers=headers)
    soup = BeautifulSoup(r.text, 'html.parser')
    results = []
    for item in soup.select('li.serp-item')[:limit]:
        title_elem = item.select_one('h2 a')
        snippet_elem = item.select_one('.text-container')
        if title_elem:
            title = title_elem.get_text(strip=True)
            url = title_elem.get('href', '')
            snippet = snippet_elem.get_text(strip=True)[:300] if snippet_elem else ''
            if url and snippet:
                results.append({
                    "title": title,
                    "url": url,
                    "content": snippet,
                    "engine": "yandex",
                    "score": 0.7
                })
    return results

ENGINES = {
    "duckduckgo": search_duckduckgo,
    "bing": search_bing,
    "yahoo": search_yahoo,
    "yandex": search_yandex,
}

@app.get("/health")
async def health():
    return {"status": "ok", "engines": list(ENGINES.keys())}

@app.get("/search")
async def search(
    q: str = Query(..., description="Query"),
    engines: str = Query("duckduckgo,yahoo", description="Comma-separated engines"),
    limit: int = Query(10, ge=1, le=50),
    format: str = Query("json", description="json or searxng"),
    # SearXNG-compatible params
    language: str = Query("all", description="Language"),
    safesearch: int = Query(0, description="Safe search"),
    categories: str = Query("general", description="Categories")
):
    # Handle both SearXNG format and our format
    if engines == "duckduckgo,yahoo" and "searxng" not in engines:
        # Check if called with SearXNG-style params
        engine_list = ["duckduckgo", "yahoo"]
    else:
        engine_list = [e.strip() for e in engines.split(",") if e.strip() in ENGINES]
    if not engine_list:
        engine_list = ["duckduckgo", "bing"]
    
    # Cache key
    cache_key = f"{q}:{','.join(engine_list)}:{limit}"
    import time
    if cache_key in _cache:
        cached, ts = _cache[cache_key]
        if time.time() - ts < _CACHE_TTL:
            return cached if format == "json" else to_searxng_format(cached)
    
    # Search all engines in parallel
    tasks = [ENGINES[e](q, limit) for e in engine_list]
    all_results = await asyncio.gather(*tasks, return_exceptions=True)
    
    results = []
    for i, r in enumerate(all_results):
        if isinstance(r, list):
            results.extend(r)
        elif isinstance(r, Exception):
            print(f"Engine {engine_list[i]} error: {r}")
    
    # Dedupe by URL
    seen = set()
    unique = []
    for r in results:
        if r["url"] not in seen:
            seen.add(r["url"])
            unique.append(r)
    
    # Sort by score
    unique.sort(key=lambda x: x.get("score", 0), reverse=True)
    unique = unique[:limit]
    
    response = {
        "query": q,
        "number_of_results": len(unique),
        "results": unique
    }
    
    _cache[cache_key] = (response, time.time())
    
    if format == "searxng":
        return to_searxng_format(response)
    return response

def to_searxng_format(data: dict) -> dict:
    """Convert to SearXNG-compatible format"""
    return {
        "query": data["query"],
        "number_of_results": data["number_of_results"],
        "results": [
            {
                "title": r["title"],
                "url": r["url"],
                "content": r["content"],
                "engine": r["engine"],
                "score": r.get("score", 0),
                "category": "general"
            }
            for r in data["results"]
        ],
        "answers": [],
        "corrections": [],
        "infoboxes": [],
        "suggestions": [],
        "unresponsive_engines": []
    }

SEARCH_UI_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Market Orca Search</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f0f0f;color:#e0e0e0;min-height:100vh;display:flex;flex-direction:column;align-items:center}
.hero{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;max-width:720px;padding:2rem}
.hero h1{font-size:2rem;font-weight:600;margin-bottom:.25rem;background:linear-gradient(135deg,#60a5fa,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.hero p{color:#888;font-size:.9rem;margin-bottom:2rem}
.search-box{width:100%;position:relative}
.search-box input{width:100%;padding:1rem 3.5rem 1rem 1.25rem;font-size:1rem;background:#1a1a1a;border:1px solid #333;border-radius:12px;color:#fff;outline:none;transition:border .2s}
.search-box input:focus{border-color:#60a5fa}
.search-box button{position:absolute;right:.75rem;top:50%;transform:translateY(-50%);background:none;border:none;color:#60a5fa;cursor:pointer;font-size:1.25rem}
.engines{margin-top:1.5rem;display:flex;gap:.75rem;flex-wrap:wrap;justify-content:center}
.engines label{font-size:.8rem;color:#999;cursor:pointer;display:flex;align-items:center;gap:.35rem}
.engines input{accent-color:#60a5fa}
.results{width:100%;max-width:720px;padding:1rem 2rem 3rem}
.result{margin-bottom:1.5rem;padding:1rem;background:#1a1a1a;border-radius:10px;border:1px solid #222}
.result h3{font-size:1rem;margin-bottom:.35rem}
.result h3 a{color:#60a5fa;text-decoration:none}
.result h3 a:hover{text-decoration:underline}
.result .url{font-size:.75rem;color:#666;margin-bottom:.4rem}
.result .snippet{font-size:.875rem;color:#bbb;line-height:1.5}
.result .engine-tag{display:inline-block;font-size:.65rem;padding:2px 6px;border-radius:4px;background:#222;color:#888;margin-top:.5rem}
.status{text-align:center;padding:2rem;color:#666}
.spinner{display:none;text-align:center;padding:3rem;color:#888}
.spinner::after{content:'';display:inline-block;width:24px;height:24px;border:3px solid #333;border-top-color:#60a5fa;border-radius:50%;animation:spin .6s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
@media(max-width:600px){.hero h1{font-size:1.5rem}.results{padding:1rem}}
</style>
</head>
<body>
<div class="hero">
  <h1>🔍 Market Orca Search</h1>
  <p>Multi-engine search — DuckDuckGo, Bing, Yahoo, Yandex</p>
  <form class="search-box" onsubmit="doSearch(event)">
    <input id="q" type="text" placeholder="Ask anything..." autofocus autocomplete="off">
    <button type="submit">→</button>
  </form>
  <div class="engines">
    <label><input type="checkbox" name="e" value="duckduckgo" checked>DuckDuckGo</label>
    <label><input type="checkbox" name="e" value="bing" checked>Bing</label>
    <label><input type="checkbox" name="e" value="yahoo">Yahoo</label>
    <label><input type="checkbox" name="e" value="yandex">Yandex</label>
  </div>
</div>
<div class="spinner" id="spinner"></div>
<div class="results" id="results"></div>
<script>
const input=document.getElementById('q'),results=document.getElementById('results'),spinner=document.getElementById('spinner');
const params=new URLSearchParams(location.search);
if(params.get('q')){input.value=params.get('q');doSearch()}
async function doSearch(e){
  if(e)e.preventDefault();
  const q=input.value.trim();if(!q)return;
  history.replaceState(null,'','/?q='+encodeURIComponent(q));
  spinner.style.display='block';results.innerHTML='';
  const eng=[...document.querySelectorAll('input[name=e]:checked')].map(c=>c.value);
  try{
    const r=await fetch('/search?q='+encodeURIComponent(q)+'&engines='+(eng.join(',')||'duckduckgo')+'&limit=20');
    const data=await r.json();
    spinner.style.display='none';
    if(!data.results||!data.results.length){results.innerHTML='<div class="status">No results found.</div>';return}
    results.innerHTML=data.results.map(r=>'<div class="result"><h3><a href="'+r.url+'" target="_blank" rel="noopener">'+esc(r.title)+'</a></h3><div class="url">'+esc(r.url)+'</div><div class="snippet">'+esc(r.content)+'</div><span class="engine-tag">'+esc(r.engine)+'</span></div>').join('');
  }catch(err){spinner.style.display='none';results.innerHTML='<div class="status">Search failed: '+esc(err.message)+'</div>'}
}
function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}
input.addEventListener('keydown',e=>{if(e.key==='Enter')doSearch(e)});
</script>
</body></html>"""

from fastapi.responses import HTMLResponse

@app.get("/")
async def root():
    q = None
    return HTMLResponse(content=SEARCH_UI_HTML)

@app.get("/api")
async def api_root():
    return {
        "name": "Market Orca Search",
        "version": "1.0",
        "description": "Lightweight SearXNG-compatible search API",
        "engines": list(ENGINES.keys()),
        "endpoints": {
            "search": "/search?q=query&engines=duckduckgo,yahoo&limit=10&format=json|searxng",
            "health": "/health"
        },
    }

if __name__ == "__main__":
    port = int(os.getenv("SEARXNG_PORT", "18080"))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")
