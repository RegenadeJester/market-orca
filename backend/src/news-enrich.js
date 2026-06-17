import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const scraplingPython = path.join(__dirname, '..', '.venv-scrapling-test', 'bin', 'python')
const scraplingScript = path.join(__dirname, 'news_scrape.py')

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'market-orca/1.0' }, redirect: 'follow' })
  if (!res.ok) throw new Error(`Fetch html failed ${res.status}`)
  return res.text()
}

function pickMeta(html, keys) {
  for (const key of keys) {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)["']`, 'i')
    const m = html.match(re)
    if (m?.[1]) return m[1]
  }
  return ''
}

async function enrichWithScrapling(item) {
  const { stdout } = await execFileAsync(scraplingPython, [scraplingScript, item.link], { timeout: 15000 })
  const data = JSON.parse(stdout || '{}')
  if (data.error) throw new Error(data.error)
  return {
    ...item,
    title: item.title || data.title || item.title,
    summary: item.summary || data.description || item.summary,
    image: data.image || item.image || '',
    source: item.source || data.site_name || item.source,
  }
}

async function enrichWithCrawl4ai(item) {
  const { stdout } = await execFileAsync('crwl', ['crawl', item.link, '-o', 'markdown'], { timeout: 20000, maxBuffer: 1024 * 1024 })
  const text = String(stdout || '').replace(/\[[^\]]+\]\([^\)]+\)/g, '').replace(/[#*_>`]/g, '').replace(/\s+/g, ' ').trim()
  if (!text) throw new Error('crawl4ai empty')
  return { ...item, summary: item.summary?.length > 80 ? item.summary : text.slice(0, 280), crawl4ai: true }
}

export async function enrichNewsItem(item) {
  if (!item?.link) return item
  try {
    return await enrichWithScrapling(item)
  } catch {
    try {
      const html = await fetchHtml(item.link)
      const image = pickMeta(html, ['og:image', 'twitter:image', 'og:image:url'])
      const description = pickMeta(html, ['og:description', 'description', 'twitter:description'])
      const siteName = pickMeta(html, ['og:site_name'])
      return { ...item, image, summary: item.summary || description || item.summary, source: item.source || siteName || item.source }
    } catch {
      try {
        return await enrichWithCrawl4ai(item)
      } catch {
        return item
      }
    }
  }
}
