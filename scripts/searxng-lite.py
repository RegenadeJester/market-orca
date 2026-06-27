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

@app.get("/")
async def root():
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
