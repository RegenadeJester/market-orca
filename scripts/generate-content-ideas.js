#!/usr/bin/env node
/**
 * AI Daily Report → Blog Content Ideas Generator
 *
 * Usage:
 *   node scripts/generate-content-ideas.js              # fetch dari localhost:4567
 *   node scripts/generate-content-ideas.js --count 20   # generate 20 ideas
 *   node scripts/generate-content-ideas.js --output ideas-2026-05-12.md
 *
 * Output: Markdown file with blog content ideas based on today's AI news.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4567'

// ── CLI args ──
const args = process.argv.slice(2)
const COUNT = parseInt(args.find(a => a.startsWith('--count='))?.split('=')[1] || '15', 10)
const OUTPUT_FILE = args.find(a => a.startsWith('--output='))?.split('=')[1] ||
  `content-ideas-${new Date().toISOString().slice(0, 10)}.md`

// ── Category analysis ──
function categorizeArticle(title, snippet) {
  const text = (title + ' ' + (snippet || '')).toLowerCase()
  const cats = []
  if (/\b(openai|gpt|claude|gemini|deepseek|llama|mistral)\b/i.test(text)) cats.push('model-launch')
  if (/\b(startup|funding|acquisition|ipo|valuation|invest|seed|series)\b/i.test(text)) cats.push('funding')
  if (/\b(research|paper|study|benchmark|safety|alignment|evaluation)\b/i.test(text)) cats.push('research')
  if (/\b(tool|product|launch|app|release|platform|api|sdk)\b/i.test(text)) cats.push('product-launch')
  if (/\b(tips|tutorial|how.to|guide|prompt|best.practices)\b/i.test(text)) cats.push('tutorial')
  if (/\b(agent|copilot|cursor|vibe|coding|developer|code)\b/i.test(text)) cats.push('dev-tools')
  if (/\b(finance|fintech|banking|invest|trading|stock|crypto|bitcoin|blockchain)\b/i.test(text)) cats.push('finance')
  if (/\b(security|privacy|hack|breach|encrypt|vulnerability)\b/i.test(text)) cats.push('security')
  if (/\b(regulasi|eu|government|policy|law|bill|act|regulation)\b/i.test(text)) cats.push('policy')
  if (/\b(robotics|robot|automation|hardware|chip|gpu|processor)\b/i.test(text)) cats.push('hardware')
  return cats.length > 0 ? cats[Math.floor(Math.random() * cats.length)] : 'general'
}

// ── Generate blog ideas ──
function generateIdeas(topics, count) {
  const allItems = topics.flatMap(t => t.items)
  const articles = allItems.filter(i => i.type === 'article' && i.title)
  const models = allItems.filter(i => i.type === 'model' && i.title)
  const ideas = []

  // Angle starters untuk bikin konten menarik
  const angles = [
    { emoji: '🔥', prefix: 'Hot Take:', tone: 'opini' },
    { emoji: '📖', prefix: 'Deep Dive:', tone: 'analisis' },
    { emoji: '💡', prefix: 'Insight:', tone: 'edukasi' },
    { emoji: '⚡', prefix: '5 Menit Baca:', tone: 'ringkas' },
    { emoji: '🔍', prefix: 'Mengapa Ini Penting:', tone: 'perspektif' },
    { emoji: '🎯', prefix: 'Panduan Lengkap:', tone: 'tutorial' },
    { emoji: '💭', prefix: 'Pemikiran:', tone: 'opini' },
    { emoji: '📊', prefix: 'Analisis Data:', tone: 'analisis' },
    { emoji: '🤔', prefix: 'Pertanyaan:', tone: 'diskusi' },
    { emoji: '📈', prefix: 'Tren:', tone: 'analisis' },
  ]

  // ── IDEAS FROM ARTICLES ──
  // Cluster articles by category
  const categorized = {}
  for (const a of articles) {
    const cat = categorizeArticle(a.title, a.snippet)
    if (!categorized[cat]) categorized[cat] = []
    categorized[cat].push(a)
  }

  // From each category with 2+ articles, create angle-based ideas
  for (const [cat, items] of Object.entries(categorized)) {
    if (items.length < 2) continue
    if (ideas.length >= count) break

    const angle = angles[Math.floor(Math.random() * angles.length)]
    const topItem = items.sort((a, b) => (b.points || 0) - (a.points || 0))[0]
    const source = topItem.source || 'berita'

    // Template judul
    const templates = {
      'model-launch': [
        `${angle.emoji} ${angle.prefix} Perbandingan Model AI Terbaru: ${items.map(i => i.title.split(/[—–-]/)[0].trim()).slice(0, 3).join(' vs ')}`,
        `${angle.emoji} ${angle.prefix} Mana yang Terbaik? Review ${items.length} Model AI yang Baru Dirilis`,
        `${angle.emoji} ${angle.prefix} ${items[0].title.split(/[—–-]/)[0].trim()} — Apakah Layak Dicoba?`,
      ],
      'funding': [
        `${angle.emoji} ${angle.prefix} ${topItem.title} — Apa Artinya untuk Industri AI?`,
        `${angle.emoji} ${angle.prefix} Startup AI dengan Pendanaan Terbesar Bulan Ini`,
        `${angle.emoji} ${angle.prefix} ${items.length} Startup AI Baru Dapat Funding — Ini Peluangnya`,
      ],
      'product-launch': [
        `${angle.emoji} ${angle.prefix} ${topItem.title} — Fitur, Harga, dan Dampak`,
        `${angle.emoji} ${angle.prefix} ${items.length} Tools AI Baru untuk Dicoba Hari Ini`,
        `${angle.emoji} ${angle.prefix} Review: ${topItem.title}`,
      ],
      'research': [
        `${angle.emoji} ${angle.prefix} Penelitian AI Terbaru yang Bakal Mengubah Industri`,
        `${angle.emoji} ${angle.prefix} ${items.length} Temuan Riset AI Paling Signifikan`,
        `${angle.emoji} ${angle.prefix} Apa Kata Riset: ${topItem.title}`,
      ],
      'tutorial': [
        `${angle.emoji} ${angle.prefix} Tutorial ${topItem.title}`,
        `${angle.emoji} ${angle.prefix} ${items.length} Tips AI yang Wajib Kamu Coba`,
        `🚀 ${angle.prefix} Panduan Langkah-demi-Langkah: ${topItem.title}`,
      ],
      'dev-tools': [
        `🛠 ${angle.prefix} ${items.length} Developer Tools AI yang Sedang Naik Daun`,
        `👨‍💻 ${angle.prefix} ${topItem.title} — Wajib Coba Developer AI`,
        `⚡ ${angle.prefix} Rekomendasi Tools AI untuk Developer: ${items.map(i => i.title.split(/[—–-]/)[0].trim()).slice(0, 3).join(', ')}`,
      ],
      'finance': [
        `💰 ${angle.prefix} ${topItem.title} — Dampak untuk Pasar dan Investor`,
        `📊 ${angle.prefix} AI dan Fintech: ${items.length} Berita Penting Minggu Ini`,
        `🏦 ${angle.prefix} Bagaimana AI Mengubah Industri Keuangan? (Berdasarkan ${items.length} Berita)`,
      ],
      'security': [
        `🔒 ${angle.prefix} ${topItem.title} — Yang Perlu Kamu Tahu`,
        `🛡 ${angle.prefix} ${items.length} Ancaman Siber Baru — Apa Langkahmu?`,
        `🔐 ${angle.prefix} Keamanan AI: ${topItem.title}`,
      ],
      'policy': [
        `📜 ${angle.prefix} ${topItem.title} — Dampak Regulasi pada AI`,
        `⚖️ ${angle.prefix} ${items.length} Perubahan Regulasi AI yang Perlu Kamu Ikuti`,
      ],
      'hardware': [
        `💻 ${angle.prefix} ${topItem.title} — Performa dan Perbandingan`,
        `🔧 ${angle.prefix} ${items.length} Inovasi Hardware AI Terbaru`,
      ],
      'general': [
        `${angle.emoji} ${angle.prefix} ${items.length} Berita AI yang Paling Banyak Dibicarakan`,
        `${angle.emoji} ${angle.prefix} Rangkuman Berita AI — ${topItem.title} dan Lainnya`,
        `📰 ${angle.prefix} ${items.length} Hal Baru di Dunia AI yang Wajib Kamu Tahu`,
      ],
    }

    const titleOptions = templates[cat] || templates['general']
    let chosenTitle = titleOptions[Math.floor(Math.random() * titleOptions.length)]

    // Buat outline
    const outline = generateOutline(cat, topItem, items)

    ideas.push({
      title: chosenTitle,
      category: cat,
      source: source,
      inspiration: topItem.title,
      url: topItem.url,
      tone: angle.tone,
      outline: outline,
      keywords: extractKeywords(cat, chosenTitle),
    })
  }

  // ── IDEAS FROM MODELS ──
  if (models.length >= 2 && ideas.length < count) {
    const modelList = models.slice(0, 5).map(m => m.title).join(', ')
    ideas.push({
      title: `🤖 ${angles[Math.floor(Math.random() * angles.length)].prefix} ${models.length} Model AI Open Source Paling Populer — ${modelList.slice(0, 80)}`,
      category: 'models',
      source: 'HuggingFace',
      inspiration: `${models.length} trending AI models`,
      url: models[0]?.url || '',
      tone: 'edukasi',
      outline: [
        '1. Pendahuluan — Kenapa model open source penting',
        `2. ${models[0]?.title || 'Model #1'} — Fitur dan use case`,
        `3. ${models[1]?.title || 'Model #2'} — Perbandingan performa`,
        ...(models[2] ? [`4. ${models[2].title} — Kenapa populer`] : []),
        '5. Cara memulai dengan model-model ini (link download)',
        '6. Kesimpulan — Mana yang cocok untuk projectmu?',
      ],
      keywords: ['AI models', 'open source', 'HuggingFace', models.slice(0, 3).map(m => m.title).join(', ')],
    })
  }

  // ── MIXED / TREND IDEAS ──
  if (Object.keys(categorized).length >= 3 && ideas.length < count) {
    const trendCat = Object.entries(categorized).sort((a, b) => b[1].length - a[1].length)[0]
    ideas.push({
      title: `📈 ${angles[Math.floor(Math.random() * angles.length)].prefix} Kenapa ${trendCat[0].replace('-', ' ')} AI Lagi Panas — Analisis dari ${trendCat[1].length} Berita Terbaru`,
      category: 'trend',
      source: 'Multi-source',
      inspiration: `${trendCat[0]} category has ${trendCat[1].length} articles`,
      url: trendCat[1][0]?.url || '',
      tone: 'analisis',
      outline: [
        '1. Pendahuluan: Apa yang terjadi?',
        `2. ${trendCat[1][0]?.title || 'Berita #1'} — Analisis dampak`,
        `3. ${trendCat[1][1]?.title || 'Berita #2'} — Perspektif berbeda`,
        '4. Bagaimana ini mempengaruhi industri secara umum',
        '5. Prediksi dan langkah selanjutnya',
        '6. Kesimpulan — Apa yang perlu kamu lakukan',
      ],
      keywords: ['AI trend', categoryToKeyword(trendCat[0]), 'analisis teknologi'],
    })
  }

  return ideas.slice(0, count)
}

function generateOutline(cat, topItem, items) {
  const outlines = {
    'model-launch': [
      '1. Pendahuluan — Model AI baru bermunculan',
      `2. ${items[0]?.title?.split(/[—–-]/)[0]?.trim() || 'Model #1'} — Kelebihan & kekurangan`,
      `3. ${items[1]?.title?.split(/[—–-]/)[0]?.trim() || 'Model #2'} — Benchmark & performa`,
      '4. Perbandingan harga dan aksesibilitas',
      '5. Mana yang cocok untuk use case tertentu?',
      '6. Kesimpulan & rekomendasi',
    ],
    'funding': [
      '1. Ringkasan: Siapa dapat berapa?',
      `2. ${topItem.title} — Cerita di balik pendanaan`,
      '3. Analisis: Kenapa investor tertarik?',
      '4. Dampak untuk industri AI',
      '5. Prediksi: Startup AI mana yang akan menyusul?',
    ],
    'tutorial': [
      '1. Apa yang akan kamu pelajari?',
      `2. Apa itu ${cleanTitle(topItem.title)}?`,
      '3. Langkah 1: Persiapan',
      '4. Langkah 2: Implementasi',
      '5. Langkah 3: Optimasi',
      '6. Tips & trik dari praktisi',
    ],
    'dev-tools': [
      '1. Developer AI tools landscape saat ini',
      `2. ${items[0]?.title?.split(/[—–-]/)[0]?.trim() || 'Tool #1'} — Fitur unggulan`,
      `3. ${items[1]?.title?.split(/[—–-]/)[0]?.trim() || 'Tool #2'} — Perbandingan`,
      '4. Cara integrasi ke workflow kamu',
      '5. Rekomendasi berdasarkan use case',
    ],
    'finance': [
      '1. Situasi finansial AI saat ini',
      `2. ${topItem.title} — Analisis dampak pasar`,
      '3. Peluang investasi di AI',
      '4. Resiko yang perlu diperhatikan',
      '5. Strategi untuk investor ritel',
    ],
    'general': [
      '1. Rangkuman berita AI minggu ini',
      `2. ${items[0]?.title || 'Berita utama'} — Kenapa penting`,
      `3. ${items[1]?.title || 'Berita kedua'} — Perspektif berbeda`,
      '4. Implikasi untuk pengguna AI sehari-hari',
      '5. Yang perlu kamu lakukan selanjutnya',
    ],
  }
  return outlines[cat] || outlines['general']
}

function cleanTitle(title) {
  return (title || '').split(/[—–-]/)[0].trim()
}

function extractKeywords(cat, title) {
  const words = title.replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3)
  const kw = [...new Set([cat.replace('-', ' '), ...words.slice(0, 6)])]
  return kw.slice(0, 8)
}

function categoryToKeyword(cat) {
  const map = { 'model-launch': 'AI model', 'funding': 'AI funding', 'product-launch': 'AI product', 'research': 'AI research', 'tutorial': 'AI tutorial', 'dev-tools': 'AI developer tools', 'finance': 'AI finance' }
  return map[cat] || 'AI'
}

// ── Format output ──
function formatMarkdown(ideas, topics) {
  const date = new Date().toISOString().slice(0, 10)

  // Gather stats from topics
  const totalArticles = topics.reduce((s, t) => s + t.items.filter(i => i.type === 'article').length, 0)
  const totalModels = topics.reduce((s, t) => s + t.items.filter(i => i.type === 'model').length, 0)
  const allSources = [...new Set(topics.flatMap(t => t.items.map(i => i.source).filter(Boolean)))]

  let md = `# 📝 AI Blog Content Ideas\n`
  md += `📅 **${date}**\n\n`
  md += `> Generated from AI Daily Report — ${totalArticles} articles, ${totalModels} models from ${allSources.length} sources\n\n`
  md += `---\n\n`

  ideas.forEach((idea, i) => {
    md += `## ${i + 1}. ${idea.title}\n\n`
    md += `| | |\n|---|---|\n`
    md += `| **Kategori** | ${idea.category} |\n`
    md += `| **Tone** | ${idea.tone} |\n`
    md += `| **Inspirasi** | *${idea.inspiration}* |\n`
    if (idea.url) md += `| **Source** | [${idea.source}](${idea.url}) |\n`
    md += `| **Keywords** | ${idea.keywords?.join(', ') || '-'} |\n\n`

    md += `**Outline:**\n\n`
    idea.outline.forEach(point => { md += `- ${point}\n` })
    md += `\n---\n\n`
  })

  md += `\n*Generated by Little Candle 🕯️ — AI Daily Report Content Engine*\n`
  return md
}

// ── Fetch & Generate ──
async function main() {
  console.log(`[content-ideas] Fetching AI Daily Report from ${BACKEND_URL}...`)

  try {
    let topics = []
    try {
      const res = await fetch(`${BACKEND_URL}/api/ai-daily-report/preview`)
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      const data = await res.json()
      topics = data.topics || data || []
    } catch (e) {
      console.warn(`[content-ideas] Preview failed: ${e.message}`)
    }

    // Fallback: use newest saved report with enough items. Prevents empty MD when live sources timeout.
    const enoughItems = (ts) => Array.isArray(ts) && ts.reduce((s, t) => s + (t.items?.length || 0), 0) >= 20
    if (!enoughItems(topics)) {
      const reportDir = path.join(__dirname, '..', 'reports')
      const files = fs.existsSync(reportDir) ? fs.readdirSync(reportDir).filter(f => f.endsWith('.json')).sort().reverse() : []
      for (const f of files) {
        const saved = JSON.parse(fs.readFileSync(path.join(reportDir, f), 'utf8'))
        if (enoughItems(saved.topics)) {
          topics = saved.topics
          console.log(`[content-ideas] Using saved report fallback: ${f}`)
          break
        }
      }
    }

    if (!enoughItems(topics)) {
      console.error('[content-ideas] No usable topics found in live preview or saved reports')
      process.exit(1)
    }

    console.log(`[content-ideas] Found ${topics.length} topics with ${topics.reduce((s, t) => s + t.items.length, 0)} items`)
    console.log(`[content-ideas] Generating ${COUNT} blog content ideas...`)

    const ideas = generateIdeas(topics, COUNT)
    const markdown = formatMarkdown(ideas, topics)

    // Save to file
    const outputPath = path.join(__dirname, '..', OUTPUT_FILE)
    fs.writeFileSync(outputPath, markdown, 'utf8')
    console.log(`[content-ideas] ✅ Saved to ${outputPath} (${ideas.length} ideas, ${markdown.length} chars)`)
  } catch (e) {
    console.error(`[content-ideas] ❌ Failed: ${e.message}`)
    process.exit(1)
  }
}

main()
