// ═══════════════════════════════════════════════════════════════════════════
// RAG Query Expansion — Synonyms, ticker aliases, Bilingual, Section-aware
// ═══════════════════════════════════════════════════════════════════════════

// Indonesian ↔ English synonyms
const SYNONYM_MAP = {
  // Market terms
  'naik': ['rising', 'surge', 'rally', 'bullish', 'uptrend'],
  'turun': ['falling', 'drop', 'decline', 'bearish', 'downtrend'],
  'untung': ['profit', 'laba', 'earnings', 'gain'],
  'rugi': ['loss', 'kerugian', 'deficit'],
  'bagus': ['positif', 'optimis', 'good', 'positive'],
  'jelek': ['negatif', 'pesimis', 'bad', 'negative', 'drop'],
  'harga': ['price', 'harga saham', 'valuation', 'perbandingan'],
  'saham': ['stock', 'equity', 'share', 'sekuritas'],
  'pasar': ['market', 'bursa', 'exchange'],
  'ekonomi': ['economy', 'macro', 'makro'],
  'inflasi': ['inflation', 'harga naik', 'daya beli'],
  'suku bunga': ['interest rate', 'BI rate', 'rate'],
  'dividen': ['dividend', 'deviden', 'pembagian laba'],
  'laba bersih': ['net profit', 'net income', 'laba bersih'],
  'pendapatan': ['revenue', 'omset', 'sales'],
  'capaian': ['performance', 'kinerja', 'hasil'],
  'risiko': ['risk', 'bahaya', 'kerugian potensial'],
  'catalyst': ['pemicu', 'katalis', 'trigger'],
  'resistance': ['level resistance', 'target atas', 'overbought'],
  'support': ['level support', 'target bawah', 'oversold'],
  // English → Indonesian
  'earnings': ['laba', 'untung', 'results', 'quarterly'],
  'revenue': ['pendapatan', 'omset', 'sales'],
  'profit': ['laba', 'untung', 'keuntungan'],
  'analyst': ['analis', 'riset', 'research'],
  'outlook': ['proyeksi', 'forecast', 'prospek'],
  'growth': ['pertumbuhan', 'ekspansi', 'kinerja'],
  'risk': ['risiko', 'bahaya'],
  'watchlist': ['pantauan', 'daftar saham'],
}

// Indonesian stock ticker aliases → full name + sector
const TICKER_MAP = {
  'TLKM': { name: 'Telkom Indonesia', sector: 'telekomunikasi', aliases: ['telkom', 'telkom indonesia', 'telekomunikasi'] },
  'BBCA': { name: 'Bank Central Asia', sector: 'perbankan', aliases: ['bca', 'bank central asia'] },
  'BBRI': { name: 'Bank Rakyat Indonesia', sector: 'perbankan', aliases: ['bri', 'bank rakyat indonesia'] },
  'BMRI': { name: 'Bank Mandiri', sector: 'perbankan', aliases: ['mandiri', 'bank mandiri'] },
  'BBNI': { name: 'Bank Negara Indonesia', sector: 'perbankan', aliases: ['bni', 'bank negara indonesia'] },
  'ASII': { name: 'Astra International', sector: 'otomotif', aliases: ['astra', 'astra international'] },
  'UNVR': { name: 'Unilever Indonesia', sector: 'consumer', aliases: ['unilever', 'unilever indonesia'] },
  'ICBP': { name: 'Indofood CBP Sukses Makmur', sector: 'consumer', aliases: ['indofood cbp'] },
  'INDF': { name: 'Indofood Sukses Makmur', sector: 'consumer', aliases: ['indofood'] },
  'EXCL': { name: 'XL Axiata', sector: 'telekomunikasi', aliases: ['xl', 'xl axiata'] },
  'ISAT': { name: 'Indosat Ooredoo Hutchison', sector: 'telekomunikasi', aliases: ['indosat', 'indosat ooredoo'] },
  'KLBF': { name: 'Kalbe Farma', sector: 'farmasi', aliases: ['kalbe', 'kalbe farma'] },
  'SIDO': { name: 'Sido Muncul', sector: 'farmasi', aliases: ['sido muncul'] },
  'BSDE': { name: 'Bumi Serpong Damai', sector: 'properti', aliases: ['bumi serpong'] },
  'SMRA': { name: 'Summarecon Agung', sector: 'properti', aliases: ['summarecon'] },
  'CPIN': { name: 'Charoen Pokphand Indonesia', sector: 'agrikultur', aliases: ['charoen', 'pokphand'] },
  'HMSP': { name: 'Hm Sampoerna', sector: 'rokok', aliases: ['sampoerna'] },
  'GGRM': { name: 'Gudang Garam', sector: 'rokok', aliases: ['gudang garam'] },
  'ADRO': { name: 'Adaro Energy Indonesia', sector: 'pertambangan', aliases: ['adaro', 'adaro energy'] },
  'PTBA': { name: 'Bukit Asam', sector: 'pertambangan', aliases: ['bukit asam'] },
  'ITMG': { name: 'Indo Tambangraya Megah', sector: 'pertambangan', aliases: ['indo tambangraya'] },
  'ANTM': { name: 'Aneka Tambang', sector: 'pertambangan', aliases: ['aneka tambang', 'antam'] },
  'INCO': { name: 'Vale Indonesia', sector: 'pertambangan', aliases: ['vale indonesia'] },
  'MDKA': { name: 'Merdeka Copper Gold', sector: 'pertambangan', aliases: ['merdeka copper'] },
  'BRPT': { name: 'Barito Pacific', sector: 'energi', aliases: ['barito pacific'] },
  'INTP': { name: 'Indocement Tunggal Prakarsa', sector: 'semen', aliases: ['indocement'] },
  'SMGR': { name: 'Semen Indonesia', sector: 'semen', aliases: ['semen indonesia'] },
  'TPIA': { name: 'Chandra Asri Petrochemical', sector: 'petrokimia', aliases: ['chandra asri'] },
  'KIJA': { name: 'Kawasan Industri Jababeka', sector: 'industri', aliases: ['jababeka'] },
  'EMTK': { name: 'Emtek', sector: 'media', aliases: ['emtek'] },
  'BREN': { name: 'Barito Renewables Energy', sector: 'energi', aliases: ['barito renewables'] },
}

// Section category detection (Bahasa + English)
const SECTION_PATTERNS = {
  harga: /harga|price|valuation|pe\s*?ratio|eps|pbv|market\s*?cap|kapitalisasi|harga\s*?saham/i,
  fundamental: /fundamental|laba|revenue|pendapatan|untung|rugi|earning|profit|loss|cashflow|arus\s*kas|dividen|dividend|quarterly|q[1-4]|annual|tahunan/i,
  teknikal: /technical|teknikal|chart|candle|support|resistance|rsi|macd|moving\s*average|ma[0-9]|volume|breakout|oversold|overbought/i,
  risiko: /risk|risiko|bahaya|headwind|tailwind|regulatory|regulasi|warning|caution|downside|threat/i,
  berita: /news|berita|headline|announcement|pengumuman|merger|akuisisi|acquisition|ipo|delisting/i,
  analisis: /analysis|analisis|research|riset|outlook|proyeksi|forecast|rekomendasi|target\s*price/i,
}

/**
 * Expand a query with synonyms, ticker aliases, and bilingual variants.
 * Returns array of expanded query strings (deduped).
 */
export function expandQuery(query) {
  const q = String(query || '').trim()
  if (!q) return []

  const expanded = new Set([q])
  const lower = q.toLowerCase()

  // 1. Ticker alias expansion
  for (const [ticker, meta] of Object.entries(TICKER_MAP)) {
    if (lower.includes(ticker.toLowerCase()) || lower.includes(meta.name.toLowerCase())) {
      // Add ticker if query uses name, or add name if query uses ticker
      if (lower.includes(ticker.toLowerCase())) {
        expanded.add(`${q} ${meta.name}`)
        expanded.add(`${meta.name} ${meta.sector}`)
        for (const alias of meta.aliases.slice(0, 2)) {
          expanded.add(`${alias} saham harga berita`)
        }
      }
      if (lower.includes(meta.name.toLowerCase()) || meta.aliases.some(a => lower.includes(a.toLowerCase()))) {
        expanded.add(`${ticker} ${q}`)
        expanded.add(`${ticker} earnings report`)
      }
    }
  }

  // 2. Synonym expansion (top 3 most relevant synonyms)
  const words = lower.split(/\s+/)
  for (const word of words) {
    for (const [key, syns] of Object.entries(SYNONYM_MAP)) {
      if (word.includes(key) || key.includes(word)) {
        for (const syn of syns.slice(0, 2)) {
          expanded.add(`${q} ${syn}`)
        }
        break
      }
    }
  }

  // 3. Bilingual expansion
  const hasBahasa = /[a-z]{3,}/i.test(q) && /[áàâãéèêíìîóòôõúùûçñ]/i.test(q) || /saham|harga|laba|untung|rugi|pasar|ekonomi|berita/i.test(q)
  if (hasBahasa) {
    // Add English version
    if (/saham/i.test(q)) expanded.add(q.replace(/saham/gi, 'stock'))
    if (/harga/i.test(q)) expanded.add(q.replace(/harga/gi, 'price'))
    if (/laba/i.test(q)) expanded.add(q.replace(/laba/gi, 'profit'))
    if (/berita/i.test(q)) expanded.add(q.replace(/berita/gi, 'news'))
  }

  return [...expanded].slice(0, 8)
}

/**
 * Detect which section categories a query targets.
 * Returns array of section keys: ['harga', 'fundamental', 'teknikal', etc.]
 */
export function detectSections(query) {
  const sections = []
  for (const [key, pattern] of Object.entries(SECTION_PATTERNS)) {
    if (pattern.test(query)) sections.push(key)
  }
  return sections.length ? sections : ['general']
}

/**
 * Generate section-aware search variants.
 * If query targets 'harga', boost price-related terms.
 */
export function sectionAwareQueries(query) {
  const sections = detectSections(query)
  const queries = []

  for (const section of sections) {
    switch (section) {
      case 'harga':
        queries.push(`${query} harga saham price valuation`)
        break
      case 'fundamental':
        queries.push(`${query} laba revenue earnings quarterly fundamental`)
        break
      case 'teknikal':
        queries.push(`${query} technical chart support resistance volume`)
        break
      case 'risiko':
        queries.push(`${query} risk risk warning downside`)
        break
      case 'berita':
        queries.push(`${query} news berita headline latest`)
        break
      case 'analisis':
        queries.push(`${query} analysis research outlook recommendation`)
        break
    }
  }

  return queries
}

/**
 * Time-aware query boost — detect recency intent and add temporal terms.
 */
export function timeAwareQueries(query) {
  const lower = query.toLowerCase()
  const queries = []

  // Freshness intent detection
  if (/(terbaru|latest|newest|recent|today|hari ini|minggu ini|bulan ini|q[1-4]\s*\d{4})/i.test(lower)) {
    queries.push(`${query} 2026 latest news`)
    queries.push(`${query} terbaru berita`)
  }
  if (/(kemarin|yesterday|sebelumnya|last week|last month)/i.test(lower)) {
    queries.push(`${query} recent 2026`)
  }
  // Quarterly detection
  const qMatch = lower.match(/q([1-4])\s*(20\d{2})/)
  if (qMatch) {
    queries.push(`${query} quarterly report Q${qMatch[1]} ${qMatch[2]}`)
  }

  return queries
}

/**
 * Full expansion pipeline: base → ticker → synonyms → section → time → bilingual
 */
export function fullExpansionPipeline(query) {
  const base = expandQuery(query)
  const sectionQ = sectionAwareQueries(query)
  const timeQ = timeAwareQueries(query)

  const all = new Set([...base, ...sectionQ, ...timeQ])
  return [...all].slice(0, 10)
}
