// report-language-guard.js — Pure Bahasa Indonesia translations for Market Orca reports
// Maps English section headers / phrases → Indonesian
// Used by ai-daily-report.js to patch text before writing reports

const ID_MAP = {
  // Section headers
  'TL;DR buat yang males baca': 'Ringkasan Eksekutif',
  'TL;DR': 'Ringkasan Eksekutif',
  '## Report Quality': '## Kualitas Laporan',
  '## What Changed Today': '## Yang Berubah Hari Ini',
  '## Red Flags': '## Bendera Merah',
  '## Actionable Watchlist': '## Watchlist Prioritas',
  '## ⚡ Suggested Alerts': '## ⚡ Alert yang Disarankan',
  '## Suggested Alerts (Smart Alert Threshold)': '## Alert yang Disarankan (Smart Alert)',
  '## Data Status': '## Status Data',
  '## Anomali Harga/Volume': '## Anomali Harga & Volume',
  '# Full Drop — AI DAILY REPORT': '# Laporan Lengkap — AI Daily Report',

  // Hero / vibe section
  '> Vibe check:': '> Mood pasar:',
  '> Why it matters:': '> Kenapa penting:',
  '> Why care:': '> Kenapa penting:',

  // Quality block
  '**Score:**': '**Skor:**',
  '**Sources:**': '**Sumber:**',
  '**Items:**': '**Item:**',
  '**Duplicates:**': '**Duplikat:**',
  '**Stale:**': '**Kedaluwarsa:**',
  '**Source rotation:**': '**Rotasi Sumber:**',

  // Data status
  'Pasar Tutup': 'Pasar Tutup',
  'Pasar Buka': 'Pasar Buka',
  'label diperlukan': 'label perlu diperbarui',

  // Suggested alerts
  'Tidak ada alert candidates dari report hari ini.': 'Tidak ada kandidat alert dari laporan hari ini.',
  'Approve/reject via API: POST /api/alerts/suggested/': 'Setujui/tolak via API: POST /api/alerts/suggested/',

  // Anomaly block
  'Threshold: harga ±10% atau volume >2x rata-rata 7 candle.': 'Ambang: harga ±10% atau volume >2x rata-rata 7 candle.',

  // Impact section
  '## Market Impact Simulator': '## Simulasi Dampak Pasar',

  // Instruction block
  'Language: Bahasa Indonesia': 'Bahasa: Indonesia',
  'Language: English': 'Bahasa: Inggris',

  // Hero description
  'Top Story:': 'Berita Utama:',
  'Kenapa penting:': 'Dampak:',
  'Sentimen pasar:': 'Sentimen Pasar:',
  'Indonesia Pulse:': 'Pulsa Indonesia:',
  'Coverage:': 'Cakupan:',
  'Data belum tersedia:': 'Data belum tersedia:',

  // Brief + Impact subsections
  '# Executive Morning Brief': '# Ringkasan Pagi',
  '## Market Impact Watch': '## Pantauan Dampak Pasar',
  '- **Market mood:**': '- **Mood pasar:**',
  '- **Indonesia pulse:**': '- **Pulsa Indonesia:**',
  '- **Biggest risk:**': '- **Risiko terbesar:**',
  '- **One opportunity:**': '- **Satu peluang:**',
  '- **Watch next:**': '- **Pantau selanjutnya:**',
  '- **hot topic:**': '- **topik hangat:**',
  '- **Regime:**': '- **Regim:**',
  '- **Event bias:**': '- **Bias peristiwa:**',
  '- **Drivers:**': '- **Pendorong:**',
  '- **Signals:**': '- **Sinyal:**',

  // Improvement/Added Features subsection
  '## Improvement / Added Features QA Pack': '## Peningkatan / Fitur Tambahan QC',
  '**Auto Root Cause Tagging:**': '**Penandaan Akar Masalah:**',
  '**Blackout / Outage Timeline:**': '**Linimasa Blackout:**',
  '**Impact Area Map:**': '**Peta Dampak:**',
  '**SLA Breach Detector:**': '**Detektor Pelanggaran SLA:**',
  '**Daily Executive Summary:**': '**Ringkasan Eksekutif Harian:**',
  '**Anomaly Alert:**': '**Peringatan Anomali:**',
  '**Before-After Improvement Tracker:**': '**Pelacak Peningkatan:**',
  '**Competitor Signal Feed:**': '**Sinyal Kompetitor:**',
  '**Action Recommendation Engine:**': '**Rekomendasi Tindakan:**',
  '**Report Confidence Score:**': '**Skor Keyakinan Laporan:**',

  // Reliability / Incident / QA subsection
  '## Reliability / Incident / QA Add-on Batch 3': '## Keandalan / Insiden / QC Paket 3',
  '| Feature | Status | Output |': '| Fitur | Status | Keluaran |',
  '| Source Reliability Score | added |': '| Skor Keandalan Sumber | ditambah |',
  '| Incident Severity Level | added |': '| Tingkat Keparahan Insiden | ditambah |',
  '| Customer Impact Estimate | added |': '| Estimasi Dampak Pelanggan | ditambah |',
  '| Recovery Status Tracker | added |': '| Pelacak Status Pemulihan | ditambah |',
  '| Duplicate News Cluster | added |': '| Klaster Berita Duplikat | ditambah |',
  '| Market Sentiment Meter | added |': '| Meter Sentimen Pasar | ditambah |',
  '| Risk Heatmap | added |': '| Peta Panas Risiko | ditambah |',
  '| Follow-up Task Generator | added |': '| Generator Tugas Lanjutan | ditambah |',
  '| Historical Comparison | added |': '| Perbandingan Historis | ditambah |',
  '| Report QA Checklist | added |': '| Daftar Periksa QA Laporan | ditambah |',
  '**Strong sources:**': '**Sumber kuat:**',
  '**Incident ops:**': '**Operasi insiden:**',
  '**QA checklist:**': '**Daftar periksa QA:**',
  '**Follow-up tasks:**': '**Tugas lanjutan:**',
  'no incident': 'tidak ada insiden',
  'no incident detected': 'tidak ada insiden terdeteksi',

  // Sentiment Trend subsection
  '## Sentiment Trend': '## Tren Sentimen',
};

// Technical / proper nouns that should NEVER be translated
const ALLOWED_ENGLISH = [
  'AI', 'API', 'RAG', 'MCP', 'LLM', 'REST', 'HTTP', 'JSON', 'SQL',
  'SSE', 'FTS', 'FTS5', 'WAL', 'CRUD', 'CI/CD', 'QA', 'UI', 'UX',
  'SaaS', 'B2B', 'B2C', 'MVP', 'POC', 'TBD', 'TLM', 'KPI', 'OKR',
  'CORS', 'JWT', 'OAuth', 'WebSocket', 'Discord', 'GitHub',
  'TLKM', 'BBRI', 'BMRI', 'ASII', 'ADRO', 'ANTM', 'BBNI', 'SMGR', 'INDF', 'EXCL',
  'JKSE', 'JKLQ45', 'IDR/USD', 'USDIDR', 'IDR=X',
  'BTC', 'ETH', 'SOL', 'BNB', 'USDT',
  'NYSE', 'NASDAQ', 'IDX', 'LSE', 'S&P', 'DJI',
  'Python', 'Node.js', 'TypeScript', 'JavaScript', 'SQLite', 'Docker',
  'Yahoo', 'Binance', 'Stooq', 'SearXNG', 'DuckDuckGo', 'Google',
  'AI DILARANG MENGUBAH'
];

// Check if a word is an allowed English technical term
function isAllowedEnglish(word) {
  let clean = word.replace(/^[^a-zA-Z_.\/\-]+/, '').replace(/[^a-zA-Z_.\/\-]+$/, '')
  return ALLOWED_ENGLISH.includes(clean) || ALLOWED_ENGLISH.includes(clean.toUpperCase())
}

// Main: translate an entire report text
function translateReport(text) {
  let result = text

  // Map section headers first
  for (const [en, id] of Object.entries(ID_MAP)) {
    result = result.replaceAll(en, id)
  }

  // Fix remaining "Vibe:" (without "check")
  result = result.replaceAll(/\*\*Vibe\b/gi, '**Mood')
  result = result.replaceAll(/\bVibe check:\*\*/g, 'Mood pasar:**')

  // Generic → specific improvements
  // "Vibe: worth knowing" → "Mood: worth knowing" (keep the rest, just prefix)
  // Actually wait — the ID_MAP already covers "> Vibe check:" → "> Mood pasar:"
  // But what about the inline vibe tags? Let's handle them generically

  // Remove "▸ ▸ ▸" visual separators (redundant in clean ID version)
  result = result.replaceAll('\n\n▸ ▸ ▸\n\n', '\n\n')

  return result
}

// Score a report for language consistency (0-100)
function scoreLanguage(text) {
  const lines = text.split('\n')
  let englishSegments = 0
  let totalSegments = 0
  const idSections = ['##', '>', '**', '- **', '# ']
  const foundIssues = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line || line.startsWith('<http') || line.startsWith('```') || line.startsWith('![media]') || line.startsWith('MEDIA:')) continue

    // Check if line starts with known English-only section header
    if (
      line.startsWith('## What Changed') ||
      line.startsWith('## Report Quality') ||
      line.startsWith('## Suggested Alerts') ||
      line.startsWith('> Vibe check:') ||
      line.startsWith('> Why it matters:') ||
      line.startsWith('> Why care:') ||
      line.startsWith('## Full Drop —')
    ) {
      englishSegments++
      totalSegments++
      foundIssues.push(`Line ${i + 1}: English header → "${line.split(':')[0]}"`)
      continue
    }

    totalSegments++
  }

  if (totalSegments === 0) return { score: 100, issues: [] }

  const score = Math.max(0, Math.round(100 - (englishSegments / totalSegments) * 100))
  return { score, issues: foundIssues }
}

export { translateReport, scoreLanguage, ID_MAP, ALLOWED_ENGLISH }
