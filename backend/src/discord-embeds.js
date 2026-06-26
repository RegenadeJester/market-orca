// ═══════════════════════════════════════════════════════════════════════════
// Market Orca Discord — Reusable Embed Builders
// Modern dark theme · Bahasa Indonesia · Discord.js v14
// ═══════════════════════════════════════════════════════════════════════════
import { EmbedBuilder } from 'discord.js'
import { APP_CONFIG } from './config.js'
import { pct } from './normalizer.js'

// ── Color Palette ─────────────────────────────────────────────────────────
export const COLORS = {
  positive: 0x22c55e,   // Green
  negative: 0xef4444,   // Red
  neutral:  0x3b82f6,   // Blue
  warning:  0xf59e0b,   // Amber
  primary:  0x6366f1,   // Indigo
  accent:   0x1e1b4b,   // Deep dark indigo (bg accent)
}

// ── Footer helper ─────────────────────────────────────────────────────────
function footer() {
  return { text: `🐋 Market Orca • ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' })}` }
}

function author() {
  return { name: '🐋 Market Orca', iconURL: `${APP_CONFIG.publicBaseUrl}/icon-192.svg`, url: APP_CONFIG.publicBaseUrl }
}

// ═══════════════════════════════════════════════════════════════════════════
// BUILDERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Market overview — IHSG, forex, crypto, top movers
 */
export function buildSummaryEmbed({ ihsg, forex, crypto, topMovers } = {}) {
  const e = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setAuthor(author())
    .setTitle('📊 Ringkasan Pasar')
    .setTimestamp()
    .setFooter(footer())

  // IHSG
  if (ihsg) {
    const isUp = (ihsg.change ?? 0) >= 0
    e.addFields({
      name: '📈 IHSG',
      value: `**${Number(ihsg.price || 0).toLocaleString('id-ID')}** ${isUp ? '🟢' : '🔴'} ${isUp ? '+' : ''}${pct(ihsg).toFixed(2)}%`,
      inline: true,
    })
  }

  // Forex
  if (forex) {
    const lines = Array.isArray(forex)
      ? forex.slice(0, 4).map(f => {
          const isUp = (f.change ?? 0) >= 0
          return `${f.symbol?.toUpperCase() || '?'}: **${Number(f.price || 0).toLocaleString('id-ID')}** ${isUp ? '🟢' : '🔴'}`
        })
      : [`USD/IDR: **${Number(forex.usdidr || forex.price || 0).toLocaleString('id-ID')}**`]
    e.addFields({ name: '💱 Forex', value: lines.join('\n'), inline: true })
  }

  // Crypto
  if (crypto) {
    const lines = Array.isArray(crypto)
      ? crypto.slice(0, 4).map(c => {
          const isUp = (c.change ?? 0) >= 0
          return `${c.symbol?.toUpperCase() || '?'}: **${Number(c.price || 0).toLocaleString('id-ID')}** ${isUp ? '🟢' : '🔴'}`
        })
      : [`BTC: **${Number(crypto.btc || crypto.price || 0).toLocaleString('id-ID')}**`]
    e.addFields({ name: '₿ Crypto', value: lines.join('\n'), inline: true })
  }

  // Top movers
  if (topMovers) {
    const gainers = (topMovers.gainers || topMovers.top_gainers || []).slice(0, 5)
    const losers = (topMovers.losers || topMovers.top_losers || []).slice(0, 5)
    let desc = ''
    if (gainers.length) {
      desc += '**🟢 Top Gainers**\n'
      desc += gainers.map((g, i) => `${i + 1}. \`${g.symbol?.toUpperCase() || '?'}\` **${pct(g) > 0 ? '+' : ''}${pct(g).toFixed(2)}%**`).join('\n')
    }
    if (losers.length) {
      if (desc) desc += '\n\n'
      desc += '**🔴 Top Losers**\n'
      desc += losers.map((l, i) => `${i + 1}. \`${l.symbol?.toUpperCase() || '?'}\` **${pct(l).toFixed(2)}%**`).join('\n')
    }
    if (desc) e.setDescription(desc)
  }

  if (!e.data.fields?.length) {
    e.setDescription('Gunakan **/market-summary** untuk melihat ringkasan pasar terkini.')
  }

  return e
}

/**
 * Single asset detail
 */
export function buildAssetEmbed({ asset, price, change, market } = {}) {
  if (!asset) return buildErrorEmbed({ message: 'Data aset tidak tersedia.' })

  const sym = (asset.symbol || asset.name || '?').toUpperCase()
  const slug = asset.slug || sym.toLowerCase()
  const priceVal = price ?? asset.price ?? 0
  const changeVal = change ?? asset.change ?? 0
  const changePercentVal = pct(asset)
  const isUp = changeVal >= 0
  const arrow = isUp ? '📈' : '📉'
  const color = isUp ? COLORS.positive : COLORS.negative
  const changeStr = `${isUp ? '+' : ''}${changeVal.toFixed(2)} (${changePercentVal > 0 ? '+' : ''}${changePercentVal.toFixed(2)}%)`

  const e = new EmbedBuilder()
    .setColor(color)
    .setAuthor(author())
    .setTitle(`${arrow} ${sym}`)
    .setURL(`${APP_CONFIG.publicBaseUrl}/asset/${slug}`)
    .setTimestamp()
    .setFooter(footer())

  e.addFields(
    { name: '💹 Harga', value: `Rp ${Number(priceVal).toLocaleString('id-ID')}`, inline: true },
    { name: '📊 Perubahan', value: changeStr, inline: true },
  )

  if (asset.volume || asset.volume_24h) {
    e.addFields({ name: '📦 Volume 24j', value: Number(asset.volume || asset.volume_24h || 0).toLocaleString('id-ID'), inline: true })
  }
  if (asset.high24 || asset.high_24h) {
    e.addFields({ name: '⬆️ Tertinggi 24j', value: `Rp ${Number(asset.high24 || asset.high_24h || 0).toLocaleString('id-ID')}`, inline: true })
  }
  if (asset.low24 || asset.low_24h) {
    e.addFields({ name: '⬇️ Terendah 24j', value: `Rp ${Number(asset.low24 || asset.low_24h || 0).toLocaleString('id-ID')}`, inline: true })
  }
  if (asset.marketCap || asset.market_cap) {
    e.addFields({ name: '🏦 Kapitalisasi Pasar', value: `Rp ${Number(asset.marketCap || asset.market_cap || 0).toLocaleString('id-ID')}`, inline: false })
  }

  if (market) {
    e.addFields({ name: '🌐 Pasar', value: market, inline: true })
  }

  return e
}

/**
 * News list with pagination
 */
export function buildNewsEmbed({ newsList, page = 0, totalPages = 1 } = {}) {
  const items = Array.isArray(newsList) ? newsList : []
  const currentPage = Math.min(page, totalPages - 1)

  const e = new EmbedBuilder()
    .setColor(COLORS.neutral)
    .setAuthor(author())
    .setTitle('📰 Berita Pasar Terbaru')
    .setTimestamp()
    .setFooter({ text: `🐋 Market Orca • Halaman ${currentPage + 1} dari ${totalPages || 1} • ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' })}` })

  if (!items.length) {
    e.setDescription('Belum ada berita tersedia.')
    return e
  }

  const desc = items.slice(0, 8).map((n, i) => {
    const title = n.title?.slice(0, 100) || 'Berita'
    const source = n.source || n.sumber || ''
    const ts = n.publishedAt || n.tanggal
    const timeStr = ts ? ` • <t:${Math.floor(new Date(ts).getTime() / 1000)}:R>` : ''
    return `**${i + 1 + currentPage * 8}.** [${title}](${n.url || '#'})\n   📡 ${source}${timeStr}`
  }).join('\n\n')

  e.setDescription(desc)
  return e
}

/**
 * Daily AI report preview
 */
export function buildReportEmbed({ report } = {}) {
  if (!report) return buildErrorEmbed({ message: 'Laporan tidak tersedia.' })

  const slug = report.slug || report.date || new Date().toISOString().slice(0, 10)
  const sections = report.sections || report.data?.sections || []
  const itemCount = report.item_count || report.data?.item_count || 0
  const summary = report.summary || report.data?.summary || report.deskripsi || ''

  const e = new EmbedBuilder()
    .setColor(COLORS.warning)
    .setAuthor(author())
    .setTitle(`📄 Laporan Pasar: ${slug}`)
    .setURL(`${APP_CONFIG.publicBaseUrl}/report/${slug}`)
    .setTimestamp()
    .setFooter(footer())

  if (summary) {
    e.setDescription(summary.slice(0, 400))
  }

  if (sections.length) {
    const sectionText = sections.slice(0, 6).map(s => {
      const key = s.key || s.judul || s.title || 'Bagian'
      const items = s.items || s.poin || []
      return `**${key}**${items.length ? ` — ${items.length} item` : ''}`
    }).join('\n')
    e.addFields({ name: '📋 Bagian Laporan', value: sectionText, inline: false })
  }

  e.addFields(
    { name: '📊 Total Item', value: `${itemCount}`, inline: true },
    { name: '📑 Halaman', value: `${sections.length} bagian`, inline: true },
  )

  return e
}

/**
 * Alert notification embed
 */
export function buildAlertEmbed({ alert } = {}) {
  if (!alert) return buildErrorEmbed({ message: 'Alert tidak tersedia.' })

  const sym = (alert.symbol || '?').toUpperCase()
  const cond = alert.condition || 'above'
  const condLabels = {
    above: 'Naik di atas',
    below: 'Turun di bawah',
    percent: 'Berubah > %',
    crossing: 'Menyilang',
  }
  const condEmojis = {
    above: '📈',
    below: '📉',
    percent: '📊',
    crossing: '⚡',
  }
  const status = alert.status || 'active'
  const statusLabel = status === 'triggered' ? '✅ Terpicu' : status === 'disabled' ? '⏸️ Nonaktif' : '⏳ Menunggu'

  const e = new EmbedBuilder()
    .setColor(status === 'triggered' ? COLORS.warning : COLORS.primary)
    .setAuthor(author())
    .setTitle(`🔔 Alert: ${sym}`)
    .setTimestamp()
    .setFooter(footer())

  e.addFields(
    { name: '🎯 Kondisi', value: `${condEmojis[cond] || '🔔'} ${condLabels[cond] || cond}`, inline: true },
    { name: '🎯 Target', value: `${alert.value || alert.harga || 0}`, inline: true },
    { name: '📍 Status', value: statusLabel, inline: true },
  )

  if (alert.currentPrice || alert.harga_saat_ini) {
    e.addFields({ name: '💰 Harga Saat Ini', value: `Rp ${Number(alert.currentPrice || alert.harga_saat_ini || 0).toLocaleString('id-ID')}`, inline: true })
  }

  if (alert.message || alert.pesan) {
    e.setDescription(alert.message || alert.pesan)
  }

  return e
}

/**
 * Error response embed
 */
export function buildErrorEmbed({ message = 'Terjadi kesalahan.' } = {}) {
  return new EmbedBuilder()
    .setColor(COLORS.negative)
    .setAuthor(author())
    .setTitle('❌ Error')
    .setDescription(String(message).slice(0, 2000))
    .setTimestamp()
    .setFooter(footer())
}

/**
 * Categorized help with command list (Bahasa Indonesia, market- prefix)
 */
export function buildHelpEmbed() {
  const baseUrl = APP_CONFIG.publicBaseUrl

  return new EmbedBuilder()
    .setColor(COLORS.primary)
    .setAuthor(author())
    .setTitle('🐋 Bantuan Market Orca Bot')
    .setDescription('Bot monitoring pasar saham Indonesia & global. Gunakan perintah **slash** di bawah:')
    .addFields(
      // ── Market Data ──────────────────────────────────────────────
      { name: '━━━ 📊 Data Pasar ━━━', value: ' ', inline: false },
      { name: '</market-summary:0>', value: 'Ringkasan pasar (IHSG, forex, crypto, top movers)', inline: true },
      { name: '</market-asset:0> `<symbol>`', value: 'Detail aset dengan harga real-time', inline: true },
      { name: '</market-top:0>', value: 'Top gainers/losers/volume', inline: true },
      { name: '</market-search:0> `<query>`', value: 'Cari aset berdasarkan nama/simbol', inline: true },

      // ── News ────────────────────────────────────────────────────
      { name: '━━━ 📰 Berita ━━━', value: ' ', inline: false },
      { name: '</market-news:0> `[asset]`', value: 'Berita pasar terbaru dengan navigasi halaman', inline: true },

      // ── Reports ─────────────────────────────────────────────────
      { name: '━━━ 📄 Laporan ━━━', value: ' ', inline: false },
      { name: '</market-report:0> `[date]`', value: 'Laporan AI harian dengan navigasi bagian', inline: true },

      // ── Alerts ──────────────────────────────────────────────────
      { name: '━━━ 🔔 Alert ━━━', value: ' ', inline: false },
      { name: '</market-alerts:0>', value: 'Kelola alert harga (aktifkan/nonaktifkan)', inline: true },
      { name: '</market-dm-subscribe:0>', value: 'Langganan alert via DM pribadi', inline: true },
      { name: '</market-dm-unsubscribe:0>', value: 'Berhenti langganan alert DM', inline: true },
      { name: '</market-dm-list:0>', value: 'Lihat daftar pelanggan DM', inline: true },

      // ── Watchlist & Portfolio ────────────────────────────────────
      { name: '━━━ ⭐ Portofolio ━━━', value: ' ', inline: false },
      { name: '</market-watchlist:0>', value: 'Kelola watchlist (tambah/hapus/lihat)', inline: true },
      { name: '</market-portfolio:0>', value: 'Pelacak portofolio sederhana', inline: true },

      // ── Settings ────────────────────────────────────────────────
      { name: '━━━ ⚙️ Pengaturan ━━━', value: ' ', inline: false },
      { name: '</market-settings:0>', value: 'Lihat pengaturan bot saat ini', inline: true },
      { name: '</market-alert-channel:0> `<#channel>`', value: 'Atur channel untuk alert', inline: true },
      { name: '</market-embed-style:0> `<style>`', value: 'Atur gaya embed (default/compact/rich)', inline: true },
      { name: '</market-rich-mode:0> `<mode>`', value: 'Atur mode rich presence (auto/manual/off)', inline: true },
      { name: '</market-help:0>', value: 'Tampilkan bantuan ini', inline: true },
    )
    .setURL(baseUrl)
    .setTimestamp()
    .setFooter(footer())
}

/**
 * Current settings display
 */
export function buildSettingsEmbed({ settings } = {}) {
  const s = settings || {}

  return new EmbedBuilder()
    .setColor(COLORS.neutral)
    .setAuthor(author())
    .setTitle('⚙️ Pengaturan Bot')
    .addFields(
      { name: '🎯 Channel Alert', value: s.alert_channel_id ? `<#${s.alert_channel_id}>` : 'Belum diatur', inline: true },
      { name: '🎨 Gaya Embed', value: `\`${s.embed_style || 'default'}\``, inline: true },
      { name: '🔄 Rich Mode', value: `\`${s.rich_mode || 'auto'}\``, inline: true },
    )
    .setTimestamp()
    .setFooter(footer())
}
