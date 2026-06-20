// ═══════════════════════════════════════════════════════════════════════════
// Market Orca Discord Bot — Full Interactive Bot
// 17+ slash commands · buttons · select menus · modals · dark theme
// ═══════════════════════════════════════════════════════════════════════════
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  Client, GatewayIntentBits,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  ActivityType, ChannelType, SlashCommandBuilder, EmbedBuilder,
} from 'discord.js'
import { APP_CONFIG } from './config.js'
import { getDiscordSetting, setDiscordSetting, getDiscordSettings } from './discord-settings.js'
import { addDmSubscriber, removeDmSubscriber, listDmSubscribers } from './discord-dm.js'
import {
  buildSummaryEmbed, buildAssetEmbed, buildNewsEmbed, buildReportEmbed,
  buildAlertEmbed, buildErrorEmbed, buildHelpEmbed, buildSettingsEmbed,
  COLORS,
} from './discord-embeds.js'

// ── Globals ───────────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.join(__dirname, '..', '.env')
let botClientPromise = null
let _client = null

// ── Load ENV ──────────────────────────────────────────────────────────────
function loadEnv() {
  const out = {}
  if (!fs.existsSync(envPath)) return out
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue
    const i = line.indexOf('=')
    if (i === -1) continue
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}

// ── Webhook helper ────────────────────────────────────────────────────────
async function postWebhook(url, payload) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!r.ok) throw new Error(`Webhook ${r.status}: ${await r.text()}`)
}

// ── Fallback embed builder (for alerts / backward compat) ─────────────────
function buildEmbed(data = {}) {
  const { title, description, color, fields, url, image } = data
  const e = new EmbedBuilder()
    .setColor(color ?? COLORS.primary)
    .setAuthor({ name: '🐋 Market Orca', iconURL: `${APP_CONFIG.publicBaseUrl}/icon-192.svg` })
    .setTimestamp()
    .setFooter({ text: `🐋 Market Orca • ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' })}` })
  if (title) e.setTitle(title)
  if (description) e.setDescription(description)
  if (url) e.setURL(url)
  if (image) e.setImage(image)
  if (Array.isArray(fields)) {
    for (const f of fields) e.addFields(f)
  }
  return e
}

// ═══════════════════════════════════════════════════════════════════════════
// SLASH COMMAND DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════
function buildCommands() {
  return [
    // ── Market Data ──────────────────────────────────────────────────
    new SlashCommandBuilder()
      .setName('market-summary')
      .setDescription('📊 Ringkasan pasar — IHSG, forex, crypto, top movers'),

    new SlashCommandBuilder()
      .setName('market-asset')
      .setDescription('🔍 Detail aset real-time')
      .addStringOption(o => o.setName('symbol').setDescription('Simbol aset (e.g. bbca-jk, aapl, btc-usd)').setRequired(true)),

    new SlashCommandBuilder()
      .setName('market-top')
      .setDescription('🏆 Top gainers / losers / volume'),

    new SlashCommandBuilder()
      .setName('market-search')
      .setDescription('🔎 Cari aset berdasarkan nama/simbol')
      .addStringOption(o => o.setName('query').setDescription('Kata kunci pencarian').setRequired(true)),

    // ── News ─────────────────────────────────────────────────────────
    new SlashCommandBuilder()
      .setName('market-news')
      .setDescription('📰 Berita pasar terbaru')
      .addStringOption(o => o.setName('asset').setDescription('Filter berdasarkan aset (opsional)')),

    // ── Reports ──────────────────────────────────────────────────────
    new SlashCommandBuilder()
      .setName('market-report')
      .setDescription('📄 Laporan AI harian')
      .addStringOption(o => o.setName('date').setDescription('Tanggal (YYYY-MM-DD, default: hari ini)')),

    // ── Alerts ───────────────────────────────────────────────────────
    new SlashCommandBuilder()
      .setName('market-alerts')
      .setDescription('🔔 Kelola alert harga'),

    new SlashCommandBuilder()
      .setName('market-alert-channel')
      .setDescription('🎯 Atur channel untuk alert')
      .addChannelOption(o => o.setName('channel').setDescription('Channel Discord').addChannelTypes(ChannelType.GuildText).setRequired(true)),

    // ── Watchlist & Portfolio ────────────────────────────────────────
    new SlashCommandBuilder()
      .setName('market-watchlist')
      .setDescription('⭐ Kelola watchlist'),

    new SlashCommandBuilder()
      .setName('market-portfolio')
      .setDescription('💼 Pelacak portofolio sederhana'),

    // ── DM Subscribe ─────────────────────────────────────────────────
    new SlashCommandBuilder()
      .setName('market-dm-subscribe')
      .setDescription('📬 Langganan alert via DM'),

    new SlashCommandBuilder()
      .setName('market-dm-unsubscribe')
      .setDescription('🚫 Berhenti langganan alert DM'),

    new SlashCommandBuilder()
      .setName('market-dm-list')
      .setDescription('📋 Lihat daftar pelanggan DM'),

    // ── Settings ─────────────────────────────────────────────────────
    new SlashCommandBuilder()
      .setName('market-settings')
      .setDescription('⚙️ Lihat pengaturan bot'),

    new SlashCommandBuilder()
      .setName('market-embed-style')
      .setDescription('🎨 Atur gaya embed')
      .addStringOption(o => o.setName('style').setDescription('Gaya embed').addChoices(
        { name: 'Default', value: 'default' },
        { name: 'Compact', value: 'compact' },
        { name: 'Rich', value: 'rich' },
      ).setRequired(true)),

    new SlashCommandBuilder()
      .setName('market-rich-mode')
      .setDescription('🔄 Atur mode rich presence')
      .addStringOption(o => o.setName('mode').setDescription('Mode').addChoices(
        { name: 'Auto', value: 'auto' },
        { name: 'Manual', value: 'manual' },
        { name: 'Off', value: 'off' },
      ).setRequired(true)),

    // ── Help ─────────────────────────────────────────────────────────
    new SlashCommandBuilder()
      .setName('market-help')
      .setDescription('🐋 Bantuan lengkap Market Orca'),

    // ── Legacy commands (backward compat) ────────────────────────────
    new SlashCommandBuilder().setName('price').setDescription('Cek harga real-time asset')
      .addStringOption(o => o.setName('symbol').setDescription('Symbol (e.g. bbca-jk, aapl, btc-usd)').setRequired(true)),
    new SlashCommandBuilder().setName('market').setDescription('Market overview — top gainers, losers, berita')
      .addStringOption(o => o.setName('tab').setDescription('Tab tampilan').addChoices(
        { name: '📊 Overview', value: 'overview' },
        { name: '🟢 Top Gainers', value: 'gainers' },
        { name: '🔴 Top Losers', value: 'losers' },
        { name: '📰 Berita', value: 'news' })),
    new SlashCommandBuilder().setName('news').setDescription('Berita market terbaru')
      .addStringOption(o => o.setName('query').setDescription('Keyword pencarian')),
    new SlashCommandBuilder().setName('chart').setDescription('Price chart (7d/30d/90d)')
      .addStringOption(o => o.setName('symbol').setDescription('Symbol').setRequired(true))
      .addStringOption(o => o.setName('period').setDescription('Periode').addChoices(
        { name: '7 Hari', value: '7d' },
        { name: '30 Hari', value: '30d' },
        { name: '90 Hari', value: '90d' })),
    new SlashCommandBuilder().setName('compare').setDescription('Bandingkan 2-3 aset')
      .addStringOption(o => o.setName('symbols').setDescription('Symbols dipisah koma (e.g. bbca-jk,bbri-jk)').setRequired(true)),
    new SlashCommandBuilder().setName('report').setDescription('Lihat AI report')
      .addStringOption(o => o.setName('date').setDescription('Tanggal (YYYY-MM-DD) atau "latest"')),
    new SlashCommandBuilder().setName('report-latest').setDescription('Report hari ini terbaru'),
    new SlashCommandBuilder().setName('report-archive').setDescription('Arsip report 30 hari terakhir'),
    new SlashCommandBuilder().setName('alert-create').setDescription('Buat price alert')
      .addStringOption(o => o.setName('symbol').setDescription('Symbol').setRequired(true))
      .addStringOption(o => o.setName('condition').setDescription('Kondisi').addChoices(
        { name: 'Naik di atas', value: 'above' },
        { name: 'Turun di bawah', value: 'below' },
        { name: 'Berubah > %', value: 'percent' }).setRequired(true))
      .addNumberOption(o => o.setName('value').setDescription('Target value / percent').setRequired(true)),
    new SlashCommandBuilder().setName('alert-list').setDescription('Lihat semua alert aktif'),
    new SlashCommandBuilder().setName('alert-delete').setDescription('Hapus alert')
      .addStringOption(o => o.setName('id').setDescription('Alert ID').setRequired(true)),
    new SlashCommandBuilder().setName('alert-test').setDescription('Test alert ke channel'),
    new SlashCommandBuilder().setName('watchlist').setDescription('Lihat watchlist kamu'),
    new SlashCommandBuilder().setName('watchlist-add').setDescription('Tambah asset ke watchlist')
      .addStringOption(o => o.setName('symbol').setDescription('Symbol').setRequired(true)),
    new SlashCommandBuilder().setName('watchlist-remove').setDescription('Hapus dari watchlist')
      .addStringOption(o => o.setName('symbol').setDescription('Symbol').setRequired(true)),
    new SlashCommandBuilder().setName('subscribe').setDescription('Subscribe alert ke DM pribadi'),
    new SlashCommandBuilder().setName('unsubscribe').setDescription('Unsubscribe alert DM'),
    new SlashCommandBuilder().setName('subscriber-list').setDescription('Lihat daftar subscriber DM'),
    new SlashCommandBuilder().setName('settings').setDescription('Lihat & atur setting bot')
      .addStringOption(o => o.setName('action').setDescription('Aksi').addChoices(
        { name: '👁 Lihat Settings', value: 'view' },
        { name: '🎯 Atur Alert Channel', value: 'set-channel' },
        { name: '🎨 Atur Embed Style', value: 'set-style' },
        { name: '🔄 Atur Rich Mode', value: 'set-rich' })),
    new SlashCommandBuilder().setName('help').setDescription('Bantuan lengkap Market Orca Bot'),
    new SlashCommandBuilder().setName('status').setDescription('Status bot & sistem'),
  ].map(c => c.toJSON())
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENT BUILDERS
// ═══════════════════════════════════════════════════════════════════════════

// Market summary refresh button
function summaryRefreshButton() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('summary_refresh')
      .setLabel('🔄 Refresh')
      .setStyle(ButtonStyle.Primary),
  )
}

// Asset action buttons
function assetButtons(slug) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`asset_refresh_${slug}`)
      .setLabel('🔄 Refresh')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`asset_news_${slug}`)
      .setLabel('📰 News')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setURL(`${APP_CONFIG.publicBaseUrl}/asset/${slug}`)
      .setLabel('📈 Chart')
      .setStyle(ButtonStyle.Link),
  )
}

// Top gainers/losers select menu
function topSelect() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('top_select')
      .setPlaceholder('🏆 Pilih kategori...')
      .addOptions([
        new StringSelectMenuOptionBuilder().setLabel('Top Gainers').setDescription('Saham dengan kenaikan terbesar').setValue('gainers').setEmoji('🟢'),
        new StringSelectMenuOptionBuilder().setLabel('Top Losers').setDescription('Saham dengan penurunan terbesar').setValue('losers').setEmoji('🔴'),
        new StringSelectMenuOptionBuilder().setLabel('Volume Tertinggi').setDescription('Saham dengan volume perdagangan tertinggi').setValue('volume').setEmoji('📊'),
      ]),
  )
}

// News pagination buttons
function newsNavButtons(page, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`news_page_${Math.max(0, page - 1)}`)
      .setLabel('◀ Sebelumnya')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId(`news_page_${Math.min(totalPages - 1, page + 1)}`)
      .setLabel('Selanjutnya ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1),
  )
}

// Report section select + web link
function reportComponents(slug, sections = []) {
  const rows = []
  if (sections.length) {
    const opts = sections.slice(0, 25).map(s => {
      const key = s.key || s.judul || s.title || 'section'
      const label = (s.key || s.judul || s.title || 'Bagian').slice(0, 100)
      return new StringSelectMenuOptionBuilder().setLabel(label).setDescription(`Lihat bagian ${label}`).setValue(`section_${key}`).setEmoji('📑')
    })
    if (opts.length) {
      rows.push(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`report_section_${slug}_nav`)
          .setPlaceholder('📑 Pilih bagian laporan...')
          .addOptions(opts),
      ))
    }
  }
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setURL(`${APP_CONFIG.publicBaseUrl}/report/${slug}`)
      .setLabel('🌐 Buka di Web')
      .setStyle(ButtonStyle.Link),
  ))
  return rows
}

// Alert action buttons
function alertActionButtons(alertId, status) {
  const isActive = status === 'active'
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`alert_toggle_${alertId}`)
      .setLabel(isActive ? '⏸️ Nonaktifkan' : '▶️ Aktifkan')
      .setStyle(isActive ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`alert_delete_${alertId}`)
      .setLabel('🗑️ Hapus')
      .setStyle(ButtonStyle.Secondary),
  )
}

// Search results select menu
function searchSelect(results, query) {
  if (!results.length) return null
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`asset_search_${query}`)
      .setPlaceholder(`🔎 ${results.length} hasil untuk "${query}"...`)
      .addOptions(
        results.slice(0, 25).map(a => new StringSelectMenuOptionBuilder()
          .setLabel(`${a.symbol?.toUpperCase() || '?'} — ${a.name || a.symbol || '?'}`.slice(0, 100))
          .setDescription(`Rp ${Number(a.price || 0).toLocaleString('id-ID')}`.slice(0, 100))
          .setValue(a.slug || a.symbol || '?')
          .setEmoji((a.change_percent ?? 0) >= 0 ? '🟢' : '🔴')),
      ),
  )
}

// Portfolio action select
function portfolioSelect(items) {
  if (!items.length) return null
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('portfolio_remove_select')
      .setPlaceholder('🗑️ Pilih aset untuk dihapus...')
      .addOptions(
        items.slice(0, 25).map(item => {
          const sym = (item.symbol || item.asset || '?').toUpperCase()
          return new StringSelectMenuOptionBuilder()
            .setLabel(`${sym} — ${item.amount || 0} unit @ Rp ${Number(item.price || item.avg_price || 0).toLocaleString('id-ID')}`.slice(0, 100))
            .setValue(item.id || item.symbol || '?')
            .setEmoji('🗑️')
        }),
      ),
  )
}

// Portfolio add button
function portfolioAddButton() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('portfolio_add')
      .setLabel('➕ Tambah Aset')
      .setStyle(ButtonStyle.Success),
  )
}

// Watchlist remove select
function watchlistRemoveSelect(items) {
  if (!items.length) return null
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('watchlist_remove_select')
      .setPlaceholder('🗑️ Pilih aset untuk dihapus...')
      .addOptions(
        items.slice(0, 25).map(item => new StringSelectMenuOptionBuilder()
          .setLabel(`${item.symbol?.toUpperCase() || '?'} — ${item.name || ''}`.slice(0, 100))
          .setDescription(`Rp ${Number(item.price || 0).toLocaleString('id-ID')}`.slice(0, 100))
          .setValue(item.slug || item.symbol || '?')
          .setEmoji('🗑️')),
      ),
  )
}

// Watchlist add button
function watchlistAddButton() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('watchlist_add')
      .setLabel('➕ Tambah Aset')
      .setStyle(ButtonStyle.Success),
  )
}

// Help category buttons
function helpCategoryButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('help_data').setLabel('📊 Data Pasar').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('help_news').setLabel('📰 Berita').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('help_alerts').setLabel('🔔 Alert').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('help_portfolio').setLabel('⭐ Portofolio').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('help_settings').setLabel('⚙️ Pengaturan').setStyle(ButtonStyle.Primary),
  )
}

// Legacy components (backward compat)
function priceButtons(symbol) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`price_refresh:${symbol}`).setLabel('🔄 Refresh').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`chart:${symbol}:7d`).setLabel('📈 Chart 7d').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`news:${symbol}`).setLabel('📰 News').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setURL(`${APP_CONFIG.publicBaseUrl}/asset/${symbol}`).setLabel('🌐 Web').setStyle(ButtonStyle.Link),
  )
}
function marketSelect() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('market_tab').setPlaceholder('📊 Pilih tampilan market...')
      .addOptions([
        { label: '📊 Overview', description: 'Market overview lengkap', value: 'overview' },
        { label: '🟢 Top Gainers', description: 'Saham naik terbesar', value: 'gainers' },
        { label: '🔴 Top Losers', description: 'Saham turun terbesar', value: 'losers' },
        { label: '📰 Berita', description: 'Berita market terbaru', value: 'news' },
        { label: '💱 Forex', description: 'Currency exchange rates', value: 'forex' },
        { label: '₿ Crypto', description: 'Cryptocurrency prices', value: 'crypto' },
      ]),
  )
}
function alertConfirmButtons(symbol, condition, value) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`alert_confirm:${symbol}:${condition}:${value}`).setLabel('✅ Buat Alert').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`alert_cancel`).setLabel('❌ Batal').setStyle(ButtonStyle.Danger),
  )
}
function reportNavButtons(date) {
  const d = new Date(date)
  const prev = new Date(d); prev.setDate(prev.getDate() - 1)
  const next = new Date(d); next.setDate(next.getDate() + 1)
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`report:${prev.toISOString().slice(0, 10)}`).setLabel('⬅️ Prev').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`report_web:${date}`).setLabel('🌐 Full Report').setStyle(ButtonStyle.Link).setURL(`${APP_CONFIG.publicBaseUrl}/report/${date}`),
    new ButtonBuilder().setCustomId(`report:${next.toISOString().slice(0, 10)}`).setLabel('Next ➡️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`report_pdf:${date}`).setLabel('📄 Export PDF').setStyle(ButtonStyle.Primary),
  )
}
function watchlistSelect(assets) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('watchlist_action').setPlaceholder('⭐ Pilih aksi...')
      .addOptions([
        ...assets.slice(0, 24).map(a => ({
          label: `${a.symbol?.toUpperCase() || a} — ${a.name || a.symbol || a}`.slice(0, 100),
          description: `Harga: Rp ${Number(a.price || 0).toLocaleString('id-ID')}`.slice(0, 100),
          value: a.slug || a.symbol || a,
          emoji: (a.change_percent ?? 0) >= 0 ? '🟢' : '🔴',
        })),
        { label: '➕ Tambah Asset', description: 'Tambah ke watchlist', value: '_add', emoji: '➕' },
        { label: '🗑️ Hapus Asset', description: 'Hapus dari watchlist', value: '_remove', emoji: '🗑️' },
      ]),
  )
}
function settingsModal() {
  return new ModalBuilder()
    .setCustomId('settings_modal')
    .setTitle('⚙️ Market Orca Settings')
    .addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('alert_channel').setLabel('Alert Channel ID').setPlaceholder('ID channel Discord').setStyle(TextInputStyle.Short).setRequired(false)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('embed_style').setLabel('Embed Style (default/compact/rich)').setPlaceholder('default').setStyle(TextInputStyle.Short).setRequired(false)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('rich_mode').setLabel('Rich Mode (auto/manual/off)').setPlaceholder('auto').setStyle(TextInputStyle.Short).setRequired(false)),
    )
}

// ── Modal builders (new) ───────────────────────────────────────────────────
function watchlistAddModal() {
  return new ModalBuilder()
    .setCustomId('watchlist_add_modal')
    .setTitle('⭐ Tambah ke Watchlist')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('watchlist_symbol')
          .setLabel('Simbol Aset')
          .setPlaceholder('e.g. bbca-jk, aapl, btc-usd')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(32),
      ),
    )
}

function portfolioAddModal() {
  return new ModalBuilder()
    .setCustomId('portfolio_add_modal')
    .setTitle('💼 Tambah ke Portofolio')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('portfolio_symbol')
          .setLabel('Simbol Aset')
          .setPlaceholder('e.g. bbca-jk')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(32),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('portfolio_amount')
          .setLabel('Jumlah Unit')
          .setPlaceholder('e.g. 100')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(32),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('portfolio_price')
          .setLabel('Harga Beli (opsional)')
          .setPlaceholder('e.g. 5000')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(32),
      ),
    )
}

// ═══════════════════════════════════════════════════════════════════════════
// API FETCH HELPERS
// ═══════════════════════════════════════════════════════════════════════════
const API_BASE = 'http://localhost:4567'

async function apiGet(path) {
  const r = await fetch(`${API_BASE}${path}`)
  if (!r.ok) throw new Error(`API ${r.status}: ${await r.text()}`)
  return r.json()
}

async function apiPost(path, body) {
  const r = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`API POST ${r.status}: ${await r.text()}`)
  return r.json()
}

async function apiDelete(path) {
  const r = await fetch(`${API_BASE}${path}`, { method: 'DELETE' })
  if (!r.ok) throw new Error(`API DELETE ${r.status}: ${await r.text()}`)
  return r.json()
}

// ═══════════════════════════════════════════════════════════════════════════
// COMMAND HANDLER
// ═══════════════════════════════════════════════════════════════════════════
async function handleCommand(interaction) {
  const { commandName, options } = interaction
  console.log(`[discord] command: ${commandName}`)

  try {
    switch (commandName) {
      // ── NEW MARKET- COMMANDS ─────────────────────────────────────────

      // 1. market-summary
      case 'market-summary': {
        await interaction.deferReply({ ephemeral: false })
        try {
          const data = await apiGet('/api/market/overview')
          const embed = buildSummaryEmbed({
            ihsg: data.ihsg || data.indeks,
            forex: data.forex,
            crypto: data.crypto,
            topMovers: data.topMovers || data,
          })
          await interaction.editReply({ embeds: [embed], components: [summaryRefreshButton()] })
        } catch (e) {
          console.error('[discord] market-summary error:', e)
          await interaction.editReply({ embeds: [buildErrorEmbed({ message: 'Gagal mengambil data pasar. Pastikan server backend berjalan.' })] })
        }
        break
      }

      // 2. market-asset
      case 'market-asset': {
        await interaction.deferReply({ ephemeral: false })
        const symbol = options.getString('symbol', true).toLowerCase()
        try {
          const data = await apiGet(`/api/assets/${symbol}/live-lite`)
          if (!data.ok && data.error) throw new Error(data.error)
          const embed = buildAssetEmbed({ asset: data })
          await interaction.editReply({ embeds: [embed], components: [assetButtons(data.slug || symbol)] })
        } catch (e) {
          console.error('[discord] market-asset error:', e)
          await interaction.editReply({ embeds: [buildErrorEmbed({ message: `Aset **${symbol}** tidak ditemukan. Coba /market-search untuk mencari.` })] })
        }
        break
      }

      // 3. market-top
      case 'market-top': {
        await interaction.deferReply({ ephemeral: false })
        try {
          const data = await apiGet('/api/assets/live-lite')
          const assets = (data.assets || []).slice(0, 50)
          const sortedGainers = [...assets].sort((a, b) => (b.change_percent || 0) - (a.change_percent || 0)).slice(0, 10)
          const embed = new EmbedBuilder()
            .setColor(COLORS.positive)
            .setAuthor({ name: '🐋 Market Orca', iconURL: `${APP_CONFIG.publicBaseUrl}/icon-192.svg` })
            .setTitle('🟢 Top Gainers')
            .setDescription(sortedGainers.map((a, i) => `**${i + 1}.** \`${a.symbol?.toUpperCase()}\` — **+${(a.change_percent || 0).toFixed(2)}%** — Rp ${Number(a.price || 0).toLocaleString('id-ID')}`).join('\n'))
            .setTimestamp()
            .setFooter({ text: `🐋 Market Orca • ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' })}` })
          await interaction.editReply({ embeds: [embed], components: [topSelect()] })
        } catch (e) {
          console.error('[discord] market-top error:', e)
          await interaction.editReply({ embeds: [buildErrorEmbed({ message: 'Gagal mengambil data top movers.' })] })
        }
        break
      }

      // 4. market-news
      case 'market-news': {
        await interaction.deferReply({ ephemeral: false })
        const asset = options.getString('asset') || ''
        try {
          const url = asset ? `/api/news?q=${encodeURIComponent(asset)}&limit=16` : '/api/overview'
          const data = await apiGet(url)
          const news = data.news || data.items || data.berita || []
          const page = 0
          const totalPages = Math.max(1, Math.ceil(news.length / 8))
          const embed = buildNewsEmbed({ newsList: news.slice(0, 8), page, totalPages })
          await interaction.editReply({
            embeds: [embed],
            components: totalPages > 1 ? [newsNavButtons(page, totalPages)] : [],
          })
        } catch (e) {
          console.error('[discord] market-news error:', e)
          await interaction.editReply({ embeds: [buildErrorEmbed({ message: 'Gagal mengambil berita.' })] })
        }
        break
      }

      // 5. market-report
      case 'market-report': {
        await interaction.deferReply({ ephemeral: false })
        const date = options.getString('date') || new Date().toISOString().slice(0, 10)
        try {
          const data = await apiGet(`/api/report/${date}`)
          if (!data.ok && data.error) throw new Error(data.error)
          const report = data.report || data.data || data
          const sections = report.sections || []
          const embed = buildReportEmbed({ report: { ...report, slug: date } })
          await interaction.editReply({ embeds: [embed], components: reportComponents(date, sections) })
        } catch (e) {
          console.error('[discord] market-report error:', e)
          await interaction.editReply({ embeds: [buildErrorEmbed({ message: `Laporan untuk **${date}** belum tersedia.` })] })
        }
        break
      }

      // 6. market-alerts
      case 'market-alerts': {
        await interaction.deferReply({ ephemeral: false })
        try {
          const data = await apiGet('/api/alerts')
          const alerts = data.alerts || data.data || []
          if (!alerts.length) {
            const embed = new EmbedBuilder()
              .setColor(COLORS.warning)
              .setAuthor({ name: '🐋 Market Orca', iconURL: `${APP_CONFIG.publicBaseUrl}/icon-192.svg` })
              .setTitle('🔔 Alert Harga')
              .setDescription('Belum ada alert aktif. Gunakan `/alert-create` untuk membuat alert baru.')
              .setTimestamp()
              .setFooter({ text: `🐋 Market Orca • ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' })}` })
            await interaction.editReply({ embeds: [embed] })
            return
          }
          // Send first alert as embed, with nav to cycle through
          const embeds = alerts.slice(0, 10).map(a => buildAlertEmbed({ alert: a }))
          const rows = []
          if (alerts.length > 1) {
            rows.push(new ActionRowBuilder().addComponents(
              new StringSelectMenuBuilder()
                .setCustomId('alerts_select')
                .setPlaceholder(`🔔 ${alerts.length} alert — pilih untuk detail...`)
                .addOptions(alerts.slice(0, 25).map(a => new StringSelectMenuOptionBuilder()
                  .setLabel(`${a.symbol?.toUpperCase() || '?'} — ${a.condition} ${a.value}`.slice(0, 100))
                  .setDescription(`Status: ${a.status || 'active'}`)
                  .setValue(String(a.id))
                  .setEmoji(a.status === 'active' ? '🟢' : '⏸️'))),
            ))
          }
          // For the first alert, show action buttons
          if (alerts[0]) {
            rows.push(alertActionButtons(alerts[0].id, alerts[0].status))
          }
          await interaction.editReply({ embeds: [embeds[0]], components: rows })
        } catch (e) {
          console.error('[discord] market-alerts error:', e)
          await interaction.editReply({ embeds: [buildErrorEmbed({ message: 'Gagal mengambil data alert.' })] })
        }
        break
      }

      // 7. market-search
      case 'market-search': {
        await interaction.deferReply({ ephemeral: false })
        const query = options.getString('query', true)
        try {
          const data = await apiGet(`/api/assets?q=${encodeURIComponent(query)}`)
          const results = data.assets || data.data || data.results || []
          if (!results.length) {
            await interaction.editReply({ embeds: [buildErrorEmbed({ message: `Tidak ditemukan aset untuk **${query}**.` })] })
            return
          }
          const embed = new EmbedBuilder()
            .setColor(COLORS.neutral)
            .setAuthor({ name: '🐋 Market Orca', iconURL: `${APP_CONFIG.publicBaseUrl}/icon-192.svg` })
            .setTitle(`🔎 Hasil Pencarian: ${query}`)
            .setDescription(results.slice(0, 10).map((a, i) => `${i + 1}. \`${a.symbol?.toUpperCase()}\` — ${a.name || ''} — Rp ${Number(a.price || 0).toLocaleString('id-ID')}`).join('\n'))
            .setTimestamp()
            .setFooter({ text: `🐋 Market Orca • ${results.length} ditemukan` })
          const select = searchSelect(results, query)
          await interaction.editReply({ embeds: [embed], components: select ? [select] : [] })
        } catch (e) {
          console.error('[discord] market-search error:', e)
          await interaction.editReply({ embeds: [buildErrorEmbed({ message: 'Gagal mencari aset.' })] })
        }
        break
      }

      // 8. market-watchlist
      case 'market-watchlist': {
        await interaction.deferReply({ ephemeral: false })
        try {
          const data = await apiGet(`/api/watchlist?user=${interaction.user.id}`)
          const items = data.watchlist || data.items || []
          if (!items.length) {
            const embed = new EmbedBuilder()
              .setColor(COLORS.neutral)
              .setAuthor({ name: '🐋 Market Orca', iconURL: `${APP_CONFIG.publicBaseUrl}/icon-192.svg` })
              .setTitle('⭐ Watchlist Kosong')
              .setDescription('Belum ada aset di watchlist. Klik tombol di bawah untuk menambah.')
              .setTimestamp()
              .setFooter({ text: `🐋 Market Orca • ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' })}` })
            await interaction.editReply({ embeds: [embed], components: [watchlistAddButton()] })
            return
          }
          const embed = new EmbedBuilder()
            .setColor(COLORS.primary)
            .setAuthor({ name: '🐋 Market Orca', iconURL: `${APP_CONFIG.publicBaseUrl}/icon-192.svg` })
            .setTitle('⭐ Watchlist')
            .setDescription(items.map((a, i) => {
              const emoji = (a.change_percent ?? 0) >= 0 ? '🟢' : '🔴'
              return `${emoji} **${i + 1}.** \`${a.symbol?.toUpperCase()}\` — **Rp ${Number(a.price || 0).toLocaleString('id-ID')}** (${a.change_percent ?? 0}%)`
            }).join('\n'))
            .setTimestamp()
            .setFooter({ text: `🐋 Market Orca • ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' })}` })
          const removeSelect = watchlistRemoveSelect(items)
          const rows = [watchlistAddButton()]
          if (removeSelect) rows.push(removeSelect)
          await interaction.editReply({ embeds: [embed], components: rows })
        } catch (e) {
          console.error('[discord] market-watchlist error:', e)
          await interaction.editReply({ embeds: [buildErrorEmbed({ message: 'Gagal mengambil watchlist.' })] })
        }
        break
      }

      // 9. market-portfolio
      case 'market-portfolio': {
        await interaction.deferReply({ ephemeral: false })
        try {
          const data = await apiGet(`/api/watchlist?user=${interaction.user.id}&portfolio=1`)
          const items = data.portfolio || data.items || data.watchlist || []
          if (!items.length) {
            const embed = new EmbedBuilder()
              .setColor(COLORS.neutral)
              .setAuthor({ name: '🐋 Market Orca', iconURL: `${APP_CONFIG.publicBaseUrl}/icon-192.svg` })
              .setTitle('💼 Portofolio Kosong')
              .setDescription('Belum ada aset di portofolio. Klik tombol di bawah untuk menambah.')
              .setTimestamp()
              .setFooter({ text: `🐋 Market Orca • ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' })}` })
            await interaction.editReply({ embeds: [embed], components: [portfolioAddButton()] })
            return
          }
          const totalValue = items.reduce((sum, item) => sum + (Number(item.price || 0) * Number(item.amount || 0)), 0)
          const embed = new EmbedBuilder()
            .setColor(COLORS.primary)
            .setAuthor({ name: '🐋 Market Orca', iconURL: `${APP_CONFIG.publicBaseUrl}/icon-192.svg` })
            .setTitle('💼 Portofolio Saya')
            .setDescription(items.map((a, i) => {
              const sym = (a.symbol || a.asset || '?').toUpperCase()
              const amt = Number(a.amount || 0)
              const price = Number(a.price || 0)
              const change = a.change_percent || 0
              const emoji = change >= 0 ? '🟢' : '🔴'
              return `${emoji} **${i + 1}.** \`${sym}\` — ${amt} unit × Rp ${price.toLocaleString('id-ID')} = **Rp ${(amt * price).toLocaleString('id-ID')}** (${change > 0 ? '+' : ''}${change}%)`
            }).join('\n'))
            .addFields({ name: '💰 Total Nilai', value: `Rp ${totalValue.toLocaleString('id-ID')}`, inline: false })
            .setTimestamp()
            .setFooter({ text: `🐋 Market Orca • ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' })}` })
          const removeSelect = portfolioSelect(items)
          const rows = [portfolioAddButton()]
          if (removeSelect) rows.push(removeSelect)
          await interaction.editReply({ embeds: [embed], components: rows })
        } catch (e) {
          console.error('[discord] market-portfolio error:', e)
          await interaction.editReply({ embeds: [buildErrorEmbed({ message: 'Gagal mengambil portofolio.' })] })
        }
        break
      }

      // 10. market-settings
      case 'market-settings': {
        const s = getDiscordSettings()
        const embed = buildSettingsEmbed({ settings: s })
        await interaction.reply({ embeds: [embed], components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('settings_edit').setLabel('✏️ Edit Settings').setStyle(ButtonStyle.Primary),
          ),
        ], ephemeral: true })
        break
      }

      // 11. market-alert-channel
      case 'market-alert-channel': {
        const channel = options.getChannel('channel', true)
        setDiscordSetting('alert_channel_id', channel.id)
        const embed = new EmbedBuilder()
          .setColor(COLORS.positive)
          .setAuthor({ name: '🐋 Market Orca', iconURL: `${APP_CONFIG.publicBaseUrl}/icon-192.svg` })
          .setTitle('✅ Channel Alert Diatur')
          .setDescription(`Alert akan dikirim ke ${channel}`)
          .setTimestamp()
          .setFooter({ text: `🐋 Market Orca • ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' })}` })
        await interaction.reply({ embeds: [embed], ephemeral: true })
        break
      }

      // 12. market-embed-style
      case 'market-embed-style': {
        const style = options.getString('style', true)
        setDiscordSetting('embed_style', style)
        const embed = new EmbedBuilder()
          .setColor(COLORS.positive)
          .setAuthor({ name: '🐋 Market Orca', iconURL: `${APP_CONFIG.publicBaseUrl}/icon-192.svg` })
          .setTitle('🎨 Gaya Embed Diperbarui')
          .setDescription(`Gaya embed diatur ke **${style}**.`)
          .setTimestamp()
          .setFooter({ text: `🐋 Market Orca • ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' })}` })
        await interaction.reply({ embeds: [embed], ephemeral: true })
        break
      }

      // 13. market-rich-mode
      case 'market-rich-mode': {
        const mode = options.getString('mode', true)
        setDiscordSetting('rich_mode', mode)
        const embed = new EmbedBuilder()
          .setColor(COLORS.positive)
          .setAuthor({ name: '🐋 Market Orca', iconURL: `${APP_CONFIG.publicBaseUrl}/icon-192.svg` })
          .setTitle('🔄 Rich Mode Diperbarui')
          .setDescription(`Rich mode diatur ke **${mode}**.`)
          .setTimestamp()
          .setFooter({ text: `🐋 Market Orca • ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' })}` })
        await interaction.reply({ embeds: [embed], ephemeral: true })
        break
      }

      // 14. market-dm-subscribe
      case 'market-dm-subscribe': {
        addDmSubscriber(interaction.user.id, interaction.user.tag)
        const embed = new EmbedBuilder()
          .setColor(COLORS.positive)
          .setAuthor({ name: '🐋 Market Orca', iconURL: `${APP_CONFIG.publicBaseUrl}/icon-192.svg` })
          .setTitle('✅ Berlangganan DM')
          .setDescription('Kamu akan menerima alert harga via DM pribadi.')
          .setTimestamp()
          .setFooter({ text: `🐋 Market Orca • ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' })}` })
        await interaction.reply({ embeds: [embed], ephemeral: true })
        break
      }

      // 15. market-dm-unsubscribe
      case 'market-dm-unsubscribe': {
        removeDmSubscriber(interaction.user.id)
        const embed = new EmbedBuilder()
          .setColor(COLORS.neutral)
          .setAuthor({ name: '🐋 Market Orca', iconURL: `${APP_CONFIG.publicBaseUrl}/icon-192.svg` })
          .setTitle('✅ Berhenti Langganan DM')
          .setDescription('Kamu tidak akan menerima alert DM lagi.')
          .setTimestamp()
          .setFooter({ text: `🐋 Market Orca • ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' })}` })
        await interaction.reply({ embeds: [embed], ephemeral: true })
        break
      }

      // 16. market-dm-list
      case 'market-dm-list': {
        const rows = listDmSubscribers()
        const text = rows.length ? rows.map((r, i) => `${i + 1}. ${r.username || r.user_id}`).join('\n') : 'Belum ada subscriber.'
        const embed = new EmbedBuilder()
          .setColor(COLORS.neutral)
          .setAuthor({ name: '🐋 Market Orca', iconURL: `${APP_CONFIG.publicBaseUrl}/icon-192.svg` })
          .setTitle('📬 Pelanggan DM')
          .setDescription(text)
          .setTimestamp()
          .setFooter({ text: `🐋 Market Orca • ${rows.length} pelanggan` })
        await interaction.reply({ embeds: [embed], ephemeral: true })
        break
      }

      // 17. market-help
      case 'market-help': {
        const embed = buildHelpEmbed()
        await interaction.reply({ embeds: [embed], components: [helpCategoryButtons()], ephemeral: false })
        break
      }

      // ── LEGACY COMMANDS (backward compat) ──────────────────────────

      case 'price': {
        await interaction.deferReply()
        const symbol = options.getString('symbol', true)
        try {
          const r = await fetch(`http://localhost:4567/api/assets/${symbol}/live-lite`)
          const d = await r.json()
          if (!d.ok) throw new Error(d.error || 'not found')
          const embed = buildAssetEmbed({ asset: d })
          await interaction.editReply({ embeds: [embed], components: [priceButtons(symbol)] })
        } catch (e) {
          await interaction.editReply({ embeds: [buildErrorEmbed({ message: `Symbol \`${symbol}\` tidak ditemukan.` })] })
        }
        break
      }

      case 'market': {
        await interaction.deferReply()
        const tab = options.getString('tab') || 'overview'
        try {
          const r = await fetch(`http://localhost:4567/api/assets/live-lite`)
          const d = await r.json()
          const assets = (d.assets || []).slice(0, 20)
          let embed
          if (tab === 'gainers') {
            const sorted = [...assets].sort((a, b) => (b.change_percent || 0) - (a.change_percent || 0)).slice(0, 10)
            embed = new EmbedBuilder()
              .setColor(COLORS.positive).setTitle('🟢 Top Gainers')
              .setDescription(sorted.map((a, i) => `**${i + 1}.** \`${a.symbol?.toUpperCase()}\` — **${a.change_percent ?? 0}%** — Rp ${Number(a.price || 0).toLocaleString('id-ID')}`).join('\n'))
          } else if (tab === 'losers') {
            const sorted = [...assets].sort((a, b) => (a.change_percent || 0) - (b.change_percent || 0)).slice(0, 10)
            embed = new EmbedBuilder()
              .setColor(COLORS.negative).setTitle('🔴 Top Losers')
              .setDescription(sorted.map((a, i) => `**${i + 1}.** \`${a.symbol?.toUpperCase()}\` — **${a.change_percent ?? 0}%** — Rp ${Number(a.price || 0).toLocaleString('id-ID')}`).join('\n'))
          } else if (tab === 'news') {
            const r2 = await fetch(`http://localhost:4567/api/news?limit=10`)
            const d2 = await r2.json()
            const news = d2.news || d2.items || []
            embed = new EmbedBuilder()
              .setColor(COLORS.neutral).setTitle('📰 Market News')
              .setDescription(news.slice(0, 8).map((n, i) => `**${i + 1}.** [${n.title?.slice(0, 80)}](${n.url})\n   *${n.source || ''}* — <t:${Math.floor(new Date(n.publishedAt || Date.now()).getTime() / 1000)}:R>`).join('\n\n'))
          } else {
            const top5 = assets.slice(0, 8)
            embed = new EmbedBuilder()
              .setColor(COLORS.primary).setTitle('📊 Market Overview')
              .setDescription(top5.map(a => `${(a.change_percent ?? 0) >= 0 ? '🟢' : '🔴'} \`${a.symbol?.toUpperCase()}\` — **Rp ${Number(a.price || 0).toLocaleString('id-ID')}** — ${a.change_percent ?? 0}%`).join('\n'))
              .addFields(
                { name: '📊 Total Assets', value: `${assets.length}`, inline: true },
                { name: '🟢 Gainers', value: `${assets.filter(a => (a.change_percent || 0) > 0).length}`, inline: true },
                { name: '🔴 Losers', value: `${assets.filter(a => (a.change_percent || 0) < 0).length}`, inline: true },
              )
          }
          await interaction.editReply({ embeds: [embed], components: [marketSelect()] })
        } catch (e) {
          await interaction.editReply({ embeds: [buildErrorEmbed({ message: String(e.message) })] })
        }
        break
      }

      case 'news': {
        await interaction.deferReply()
        const query = options.getString('query') || ''
        try {
          const url = query ? `/api/news?q=${encodeURIComponent(query)}&limit=10` : '/api/news?limit=10'
          const r = await fetch(`http://localhost:4567${url}`)
          const d = await r.json()
          const news = d.news || d.items || []
          const embeds = news.slice(0, 5).map(n => new EmbedBuilder()
            .setColor(COLORS.neutral)
            .setTitle(n.title?.slice(0, 256) || '📰 Market News')
            .setDescription(n.snippet || n.description || '')
            .addFields(
              { name: '📡 Source', value: n.source || 'Unknown', inline: true },
              ...(n.publishedAt ? [{ name: '🕐 Published', value: `<t:${Math.floor(new Date(n.publishedAt).getTime() / 1000)}:R>`, inline: true }] : []),
            )
            .setURL(n.url || APP_CONFIG.publicBaseUrl))
          if (!embeds.length) {
            embeds.push(new EmbedBuilder().setColor(COLORS.neutral).setTitle('📭 Tidak Ada Berita').setDescription('Tidak ada berita ditemukan.'))
          }
          await interaction.editReply({ embeds })
        } catch (e) {
          await interaction.editReply({ embeds: [buildErrorEmbed({ message: String(e.message) })] })
        }
        break
      }

      case 'chart': {
        await interaction.deferReply()
        const symbol = options.getString('symbol', true)
        const period = options.getString('period') || '7d'
        const embed = new EmbedBuilder()
          .setColor(COLORS.neutral)
          .setTitle(`📈 Chart: ${symbol.toUpperCase()} (${period})`)
          .setDescription(`Chart data untuk **${symbol.toUpperCase()}** periode **${period}**\n\n🌐 [Lihat chart lengkap](${APP_CONFIG.publicBaseUrl}/asset/${symbol})`)
        await interaction.editReply({
          embeds: [embed],
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setURL(`${APP_CONFIG.publicBaseUrl}/asset/${symbol}`).setLabel('🌐 Buka di Web').setStyle(ButtonStyle.Link),
            ),
          ],
        })
        break
      }

      case 'compare': {
        await interaction.deferReply()
        const symbols = options.getString('symbols', true).split(',').map(s => s.trim()).slice(0, 3)
        try {
          const results = await Promise.all(symbols.map(async s => {
            const r = await fetch(`http://localhost:4567/api/assets/${s}/live-lite`)
            const d = await r.json()
            return d.ok ? d : { symbol: s, error: true }
          }))
          const embed = new EmbedBuilder()
            .setColor(COLORS.primary)
            .setTitle('📊 Compare Assets')
            .setDescription(results.map(r => {
              if (r.error) return `❌ \`${r.symbol}\` — tidak ditemukan`
              const emoji = (r.change_percent ?? 0) >= 0 ? '🟢' : '🔴'
              return `${emoji} **${r.symbol?.toUpperCase()}** — **Rp ${Number(r.price || 0).toLocaleString('id-ID')}** (${r.change_percent ?? 0}%)`
            }).join('\n\n'))
          await interaction.editReply({ embeds: [embed] })
        } catch (e) {
          await interaction.editReply({ embeds: [buildErrorEmbed({ message: String(e.message) })] })
        }
        break
      }

      case 'report': {
        await interaction.deferReply()
        const date = options.getString('date') || new Date().toISOString().slice(0, 10)
        try {
          const r = await fetch(`http://localhost:4567/api/report/${date}`)
          const d = await r.json()
          if (!d.ok) throw new Error('Report not found')
          const sections = d.report?.sections?.length || d.data?.sections?.length || 0
          const items = d.report?.item_count || d.data?.item_count || 0
          const embed = new EmbedBuilder()
            .setColor(COLORS.warning)
            .setTitle(`📄 AI Report: ${date}`)
            .setDescription(`Report untuk **${date}**\n\n📊 **${sections}** sections • **${items}** items`)
            .addFields({ name: '🔗 Links', value: `[Web Report](${APP_CONFIG.publicBaseUrl}/report/${date})\n[PDF Export](${APP_CONFIG.publicBaseUrl}/api/report/${date}/export?format=html)`, inline: false })
          await interaction.editReply({ embeds: [embed], components: [reportNavButtons(date)] })
        } catch (e) {
          await interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.neutral).setTitle('📭 Report Tidak Ditemukan').setDescription(`Report untuk **${date}** belum tersedia.`)] })
        }
        break
      }

      case 'report-latest': {
        await interaction.deferReply()
        try {
          const r = await fetch('http://localhost:4567/api/report/latest')
          const d = await r.json()
          const date = d.slug || d.date || new Date().toISOString().slice(0, 10)
          const embed = new EmbedBuilder()
            .setColor(COLORS.warning)
            .setTitle(`📄 Report Terbaru: ${date}`)
            .setDescription(`[Buka Report](${APP_CONFIG.publicBaseUrl}/report/${date})`)
          await interaction.editReply({ embeds: [embed], components: [reportNavButtons(date)] })
        } catch (e) {
          await interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.neutral).setTitle('📭 Belum Ada Report').setDescription('Belum ada report hari ini.')] })
        }
        break
      }

      case 'report-archive': {
        await interaction.deferReply()
        try {
          const r = await fetch('http://localhost:4567/api/reports?limit=30')
          const d = await r.json()
          const reports = d.reports || d.data || []
          const embed = new EmbedBuilder()
            .setColor(COLORS.primary)
            .setTitle('📚 Report Archive')
            .setDescription(reports.slice(0, 20).map(r => `• [${r.slug || r.date}](${APP_CONFIG.publicBaseUrl}/report/${r.slug || r.date}) — ${r.item_count || '?'} items`).join('\n') || 'Belum ada report.')
          await interaction.editReply({ embeds: [embed] })
        } catch (e) {
          await interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.neutral).setTitle('📭 Error').setDescription(String(e.message))] })
        }
        break
      }

      case 'alert-create': {
        const symbol = options.getString('symbol', true)
        const condition = options.getString('condition', true)
        const value = options.getNumber('value', true)
        const embed = new EmbedBuilder()
          .setColor(COLORS.warning)
          .setTitle('🔔 Buat Alert')
          .setDescription(`Konfirmasi alert untuk **${symbol.toUpperCase()}**?`)
          .addFields(
            { name: 'Symbol', value: symbol.toUpperCase(), inline: true },
            { name: 'Condition', value: condition, inline: true },
            { name: 'Target', value: `${value}`, inline: true },
          )
        await interaction.reply({ embeds: [embed], components: [alertConfirmButtons(symbol, condition, value)], ephemeral: true })
        break
      }

      case 'alert-list': {
        await interaction.deferReply()
        try {
          const r = await fetch('http://localhost:4567/api/alerts')
          const d = await r.json()
          const alerts = d.alerts || d.data || []
          const embed = new EmbedBuilder()
            .setColor(COLORS.warning)
            .setTitle('🔔 Active Alerts')
            .setDescription(alerts.length ? alerts.slice(0, 15).map((a, i) => `**${i + 1}.** \`${a.symbol?.toUpperCase()}\` — ${a.condition} \`${a.value}\``).join('\n') : 'Tidak ada alert aktif.')
          await interaction.editReply({ embeds: [embed] })
        } catch (e) {
          await interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.neutral).setTitle('📭 Error').setDescription(String(e.message))] })
        }
        break
      }

      case 'alert-delete': {
        await interaction.deferReply()
        const id = options.getString('id', true)
        try {
          await fetch(`http://localhost:4567/api/alerts/${id}`, { method: 'DELETE' })
          await interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.positive).setTitle('✅ Alert Dihapus').setDescription(`Alert \`${id}\` berhasil dihapus.`)] })
        } catch (e) {
          await interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.negative).setTitle('❌ Gagal').setDescription(String(e.message))] })
        }
        break
      }

      case 'alert-test': {
        await interaction.deferReply()
        try {
          const r = await fetch('http://localhost:4567/api/alerts/test', { method: 'POST' })
          const d = await r.json()
          await interaction.editReply({ embeds: [new EmbedBuilder().setColor(d.ok ? COLORS.positive : COLORS.negative).setTitle(d.ok ? '✅ Alert Test Berhasil' : '❌ Alert Test Gagal').setDescription(d.message || JSON.stringify(d))] })
        } catch (e) {
          await interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.negative).setTitle('❌ Error').setDescription(String(e.message))] })
        }
        break
      }

      case 'watchlist': {
        await interaction.deferReply()
        try {
          const r = await fetch(`http://localhost:4567/api/watchlist?user=${interaction.user.id}`)
          const d = await r.json()
          const items = d.watchlist || d.items || []
          if (!items.length) {
            await interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.neutral).setTitle('⭐ Watchlist Kosong').setDescription('Gunakan `/watchlist-add <symbol>` untuk menambah asset.')], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('watchlist_add_prompt').setLabel('➕ Tambah Asset').setStyle(ButtonStyle.Success))] })
            return
          }
          const embed = new EmbedBuilder()
            .setColor(COLORS.primary)
            .setTitle('⭐ Watchlist')
            .setDescription(items.map((a, i) => `${(a.change_percent ?? 0) >= 0 ? '🟢' : '🔴'} **${i + 1}.** \`${a.symbol?.toUpperCase()}\` — **Rp ${Number(a.price || 0).toLocaleString('id-ID')}** (${a.change_percent ?? 0}%)`).join('\n'))
          await interaction.editReply({ embeds: [embed], components: [watchlistSelect(items)] })
        } catch (e) {
          await interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.negative).setTitle('❌ Error').setDescription(String(e.message))] })
        }
        break
      }

      case 'watchlist-add': {
        const symbol = options.getString('symbol', true)
        await interaction.deferReply()
        try {
          await fetch('http://localhost:4567/api/watchlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: interaction.user.id, symbol }) })
          await interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.positive).setTitle('✅ Ditambahkan').setDescription(`\`${symbol.toUpperCase()}\` ditambahkan ke watchlist.`)] })
        } catch (e) {
          await interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.negative).setTitle('❌ Error').setDescription(String(e.message))] })
        }
        break
      }

      case 'watchlist-remove': {
        const symbol = options.getString('symbol', true)
        await interaction.deferReply()
        try {
          await fetch(`http://localhost:4567/api/watchlist/${symbol}?user=${interaction.user.id}`, { method: 'DELETE' })
          await interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.positive).setTitle('✅ Dihapus').setDescription(`\`${symbol.toUpperCase()}\` dihapus dari watchlist.`)] })
        } catch (e) {
          await interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.negative).setTitle('❌ Error').setDescription(String(e.message))] })
        }
        break
      }

      case 'subscribe': {
        addDmSubscriber(interaction.user.id, interaction.user.tag)
        await interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.positive).setTitle('✅ Subscribed').setDescription('Kamu akan menerima alert via DM.')], ephemeral: true })
        break
      }

      case 'unsubscribe': {
        removeDmSubscriber(interaction.user.id)
        await interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.neutral).setTitle('✅ Unsubscribed').setDescription('Kamu tidak akan menerima alert DM lagi.')], ephemeral: true })
        break
      }

      case 'subscriber-list': {
        const rows = listDmSubscribers()
        const text = rows.length ? rows.map((r, i) => `${i + 1}. ${r.username || r.user_id}`).join('\n') : 'Belum ada subscriber.'
        await interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.primary).setTitle('📬 DM Subscribers').setDescription(text)], ephemeral: true })
        break
      }

      case 'settings': {
        const action = options.getString('action') || 'view'
        if (action === 'view') {
          const s = getDiscordSettings()
          const embed = buildSettingsEmbed({ settings: s })
          await interaction.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('settings_edit').setLabel('✏️ Edit Settings').setStyle(ButtonStyle.Primary))], ephemeral: true })
        } else if (action === 'set-channel') {
          await interaction.showModal(settingsModal())
        } else if (action === 'set-style') {
          await interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.primary).setTitle('🎨 Pilih Embed Style')], components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('style_select').setPlaceholder('Pilih style...').addOptions([{ label: 'Default', description: 'Clean, standard embed', value: 'default', emoji: '⚪' }, { label: 'Compact', description: 'Minimal, space-efficient', value: 'compact', emoji: '🔲' }, { label: 'Rich', description: 'Full detail, images, links', value: 'rich', emoji: '💎' }]))], ephemeral: true })
        } else if (action === 'set-rich') {
          await interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.primary).setTitle('🔄 Pilih Rich Mode')], components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('rich_select').setPlaceholder('Pilih mode...').addOptions([{ label: 'Auto', description: 'Bot manages presence automatically', value: 'auto', emoji: '🤖' }, { label: 'Manual', description: 'Manual control via webhook', value: 'manual', emoji: '🎮' }, { label: 'Off', description: 'Disable rich presence', value: 'off', emoji: '⭕' }]))], ephemeral: true })
        }
        break
      }

      case 'help': {
        await interaction.reply({ embeds: [buildHelpEmbed()], ephemeral: false })
        break
      }

      case 'status': {
        await interaction.deferReply()
        const uptime = process.uptime()
        const hours = Math.floor(uptime / 3600)
        const mins = Math.floor((uptime % 3600) / 60)
        const mem = process.memoryUsage()
        let dbSize = 'N/A'
        try { dbSize = (fs.statSync(path.join(__dirname, '..', 'data', 'market-orca.db')).size / 1024 / 1024).toFixed(1) + ' MB' } catch { }
        const embed = new EmbedBuilder()
          .setColor(COLORS.positive)
          .setAuthor({ name: '🐋 Market Orca', iconURL: `${APP_CONFIG.publicBaseUrl}/icon-192.svg` })
          .setTitle('🟢 Status Bot')
          .addFields(
            { name: '🤖 Bot', value: `\`${interaction.client.user?.tag || 'N/A'}\``, inline: true },
            { name: '🏓 Ping', value: `\`${interaction.client.ws.ping || 'N/A'}ms\``, inline: true },
            { name: '⏱️ Uptime', value: `\`${hours}h ${mins}m\``, inline: true },
            { name: '💾 Memory', value: `\`${(mem.rss / 1024 / 1024).toFixed(1)}MB\``, inline: true },
            { name: '🗄️ DB Size', value: `\`${dbSize}\``, inline: true },
            { name: '🔔 Last Alert', value: getDiscordSetting('last_alert_time', 'None'), inline: true },
            { name: '🌐 Public URL', value: `<${APP_CONFIG.publicBaseUrl}>`, inline: false },
          )
          .setTimestamp()
          .setFooter({ text: `🐋 Market Orca • ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' })}` })
        await interaction.editReply({ embeds: [embed] })
        break
      }

      default:
        await interaction.reply({ content: 'Perintah tidak dikenal. Gunakan `/market-help` untuk bantuan.', ephemeral: true })
    }
  } catch (e) {
    console.error(`[discord] command error ${commandName}:`, e)
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ embeds: [buildErrorEmbed({ message: 'Terjadi kesalahan internal.' })] })
      } else {
        await interaction.reply({ embeds: [buildErrorEmbed({ message: 'Terjadi kesalahan internal.' })], ephemeral: true })
      }
    } catch (e2) {
      console.error('[discord] failed to send error reply:', e2)
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// BUTTON / SELECT HANDLER
// ═══════════════════════════════════════════════════════════════════════════
async function handleComponent(interaction) {
  const customId = interaction.customId
  console.log(`[discord] component: ${customId}`)

  try {
    // ── MARKET-SUMMARY refresh ──────────────────────────────────
    if (customId === 'summary_refresh') {
      await interaction.deferUpdate()
      try {
        const data = await apiGet('/api/market/overview')
        const embed = buildSummaryEmbed({
          ihsg: data.ihsg || data.indeks,
          forex: data.forex,
          crypto: data.crypto,
          topMovers: data.topMovers || data,
        })
        await interaction.editReply({ embeds: [embed], components: [summaryRefreshButton()] })
      } catch (e) {
        console.error('[discord] summary_refresh error:', e)
      }
      return
    }

    // ── ASSET refresh ───────────────────────────────────────────
    if (customId.startsWith('asset_refresh_')) {
      await interaction.deferUpdate()
      const slug = customId.replace('asset_refresh_', '')
      try {
        const data = await apiGet(`/api/assets/${slug}/live-lite`)
        const embed = buildAssetEmbed({ asset: data })
        await interaction.editReply({ embeds: [embed], components: [assetButtons(data.slug || slug)] })
      } catch (e) {
        console.error('[discord] asset_refresh error:', e)
      }
      return
    }

    // ── ASSET news ──────────────────────────────────────────────
    if (customId.startsWith('asset_news_')) {
      await interaction.deferUpdate()
      const slug = customId.replace('asset_news_', '')
      try {
        const data = await apiGet(`/api/news?q=${slug}&limit=8`)
        const news = data.news || data.items || []
        const embed = buildNewsEmbed({ newsList: news.slice(0, 8), page: 0, totalPages: 1 })
        await interaction.editReply({ embeds: [embed] })
      } catch (e) {
        console.error('[discord] asset_news error:', e)
      }
      return
    }

    // ── TOP SELECT ─────────────────────────────────────────────
    if (customId === 'top_select') {
      await interaction.deferUpdate()
      const tab = interaction.values[0]
      try {
        const data = await apiGet('/api/assets/live-lite')
        const assets = (data.assets || []).slice(0, 50)
        let embed
        if (tab === 'gainers') {
          const sorted = [...assets].sort((a, b) => (b.change_percent || 0) - (a.change_percent || 0)).slice(0, 10)
          embed = new EmbedBuilder()
            .setColor(COLORS.positive).setTitle('🟢 Top Gainers')
            .setDescription(sorted.map((a, i) => `**${i + 1}.** \`${a.symbol?.toUpperCase()}\` — **+${(a.change_percent || 0).toFixed(2)}%** — Rp ${Number(a.price || 0).toLocaleString('id-ID')}`).join('\n'))
        } else if (tab === 'losers') {
          const sorted = [...assets].sort((a, b) => (a.change_percent || 0) - (b.change_percent || 0)).slice(0, 10)
          embed = new EmbedBuilder()
            .setColor(COLORS.negative).setTitle('🔴 Top Losers')
            .setDescription(sorted.map((a, i) => `**${i + 1}.** \`${a.symbol?.toUpperCase()}\` — **${(a.change_percent || 0).toFixed(2)}%** — Rp ${Number(a.price || 0).toLocaleString('id-ID')}`).join('\n'))
        } else {
          const sorted = [...assets].sort((a, b) => (b.volume || b.volume_24h || 0) - (a.volume || a.volume_24h || 0)).slice(0, 10)
          embed = new EmbedBuilder()
            .setColor(COLORS.neutral).setTitle('📊 Volume Tertinggi')
            .setDescription(sorted.map((a, i) => `**${i + 1}.** \`${a.symbol?.toUpperCase()}\` — Vol: ${Number(a.volume || a.volume_24h || 0).toLocaleString('id-ID')} — Rp ${Number(a.price || 0).toLocaleString('id-ID')}`).join('\n'))
        }
        embed.setTimestamp().setFooter({ text: `🐋 Market Orca • ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' })}` })
        await interaction.editReply({ embeds: [embed], components: [topSelect()] })
      } catch (e) {
        console.error('[discord] top_select error:', e)
      }
      return
    }

    // ── NEWS pagination ─────────────────────────────────────────
    if (customId.startsWith('news_page_')) {
      await interaction.deferUpdate()
      const page = parseInt(customId.replace('news_page_', ''), 10) || 0
      try {
        const data = await apiGet('/api/overview')
        const news = data.news || data.items || data.berita || []
        const totalPages = Math.max(1, Math.ceil(news.length / 8))
        const embed = buildNewsEmbed({ newsList: news.slice(page * 8, (page + 1) * 8), page, totalPages })
        await interaction.editReply({ embeds: [embed], components: [newsNavButtons(page, totalPages)] })
      } catch (e) {
        console.error('[discord] news_page error:', e)
      }
      return
    }

    // ── ALERTS select ──────────────────────────────────────────
    if (customId === 'alerts_select') {
      await interaction.deferUpdate()
      const alertId = interaction.values[0]
      try {
        const data = await apiGet('/api/alerts')
        const alerts = data.alerts || data.data || []
        const alert = alerts.find(a => String(a.id) === alertId)
        if (!alert) return
        const embed = buildAlertEmbed({ alert })
        const rows = [alertActionButtons(alert.id, alert.status)]
        await interaction.editReply({ embeds: [embed], components: rows })
      } catch (e) {
        console.error('[discord] alerts_select error:', e)
      }
      return
    }

    // ── ALERT toggle ───────────────────────────────────────────
    if (customId.startsWith('alert_toggle_')) {
      await interaction.deferUpdate()
      const alertId = customId.replace('alert_toggle_', '')
      try {
        const data = await apiGet('/api/alerts')
        const alerts = data.alerts || data.data || []
        const alert = alerts.find(a => String(a.id) === alertId)
        if (!alert) return
        const newStatus = alert.status === 'active' ? 'disabled' : 'active'
        await apiPost(`/api/alerts/${alertId}/status`, { status: newStatus })
        alert.status = newStatus
        const embed = buildAlertEmbed({ alert })
        await interaction.editReply({ embeds: [embed], components: [alertActionButtons(alert.id, alert.status)] })
      } catch (e) {
        console.error('[discord] alert_toggle error:', e)
      }
      return
    }

    // ── ALERT delete ───────────────────────────────────────────
    if (customId.startsWith('alert_delete_')) {
      await interaction.deferUpdate()
      const alertId = customId.replace('alert_delete_', '')
      try {
        await apiDelete(`/api/alerts/${alertId}`)
        const embed = new EmbedBuilder()
          .setColor(COLORS.positive)
          .setAuthor({ name: '🐋 Market Orca', iconURL: `${APP_CONFIG.publicBaseUrl}/icon-192.svg` })
          .setTitle('🗑️ Alert Dihapus')
          .setDescription(`Alert \`${alertId}\` berhasil dihapus.`)
          .setTimestamp()
          .setFooter({ text: `🐋 Market Orca • ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' })}` })
        await interaction.editReply({ embeds: [embed], components: [] })
      } catch (e) {
        console.error('[discord] alert_delete error:', e)
      }
      return
    }

    // ── REPORT section select ──────────────────────────────────
    if (customId.startsWith('report_section_')) {
      await interaction.deferUpdate()
      const parts = customId.split('_')
      // format: report_section_{slug}_nav
      const slug = parts.slice(2, -1).join('_') || 'latest'
      const sectionKey = interaction.values[0]?.replace('section_', '') || ''
      try {
        const data = await apiGet(`/api/report/${slug}`)
        const report = data.report || data.data || data
        const sections = report.sections || []
        const section = sections.find(s => (s.key || s.judul || s.title) === sectionKey)
        if (!section) return
        const embed = new EmbedBuilder()
          .setColor(COLORS.warning)
          .setAuthor({ name: '🐋 Market Orca', iconURL: `${APP_CONFIG.publicBaseUrl}/icon-192.svg` })
          .setTitle(`📄 ${section.key || section.judul || section.title || 'Bagian'}`)
          .setDescription((section.content || section.deskripsi || section.summary || JSON.stringify(section.items || [], null, 2)).slice(0, 2000))
          .setTimestamp()
          .setFooter({ text: `🐋 Market Orca • ${slug}` })
        await interaction.editReply({ embeds: [embed], components: reportComponents(slug, sections) })
      } catch (e) {
        console.error('[discord] report_section error:', e)
      }
      return
    }

    // ── SEARCH select ──────────────────────────────────────────
    if (customId.startsWith('asset_search_')) {
      await interaction.deferUpdate()
      const slug = interaction.values[0]
      try {
        const data = await apiGet(`/api/assets/${slug}/live-lite`)
        const embed = buildAssetEmbed({ asset: data })
        await interaction.editReply({ embeds: [embed], components: [assetButtons(data.slug || slug)] })
      } catch (e) {
        console.error('[discord] asset_search error:', e)
      }
      return
    }

    // ── WATCHLIST add button ────────────────────────────────────
    if (customId === 'watchlist_add') {
      await interaction.showModal(watchlistAddModal())
      return
    }

    // ── WATCHLIST remove select ─────────────────────────────────
    if (customId === 'watchlist_remove_select') {
      await interaction.deferUpdate()
      const slug = interaction.values[0]
      try {
        await apiDelete(`/api/watchlist/${slug}?user=${interaction.user.id}`)
        const embed = new EmbedBuilder()
          .setColor(COLORS.positive)
          .setAuthor({ name: '🐋 Market Orca', iconURL: `${APP_CONFIG.publicBaseUrl}/icon-192.svg` })
          .setTitle('✅ Dihapus dari Watchlist')
          .setDescription(`\`${slug.toUpperCase()}\` berhasil dihapus dari watchlist.`)
          .setTimestamp()
          .setFooter({ text: `🐋 Market Orca • ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' })}` })
        await interaction.editReply({ embeds: [embed], components: [] })
      } catch (e) {
        console.error('[discord] watchlist_remove error:', e)
      }
      return
    }

    // ── PORTFOLIO add button ────────────────────────────────────
    if (customId === 'portfolio_add') {
      await interaction.showModal(portfolioAddModal())
      return
    }

    // ── PORTFOLIO remove select ─────────────────────────────────
    if (customId === 'portfolio_remove_select') {
      await interaction.deferUpdate()
      const value = interaction.values[0]
      try {
        await apiDelete(`/api/watchlist/${value}?user=${interaction.user.id}&portfolio=1`)
        const embed = new EmbedBuilder()
          .setColor(COLORS.positive)
          .setAuthor({ name: '🐋 Market Orca', iconURL: `${APP_CONFIG.publicBaseUrl}/icon-192.svg` })
          .setTitle('✅ Dihapus dari Portofolio')
          .setDescription(`Aset berhasil dihapus dari portofolio.`)
          .setTimestamp()
          .setFooter({ text: `🐋 Market Orca • ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' })}` })
        await interaction.editReply({ embeds: [embed], components: [] })
      } catch (e) {
        console.error('[discord] portfolio_remove error:', e)
      }
      return
    }

    // ── HELP category buttons ──────────────────────────────────
    if (customId.startsWith('help_')) {
      await interaction.deferUpdate()
      const category = customId.replace('help_', '')
      const helpData = {
        data: {
          title: '📊 Data Pasar',
          desc: '**Perintah Data Pasar**\n\n' +
            '`/market-summary` — Ringkasan pasar (IHSG, forex, crypto, top movers)\n' +
            '`/market-asset <symbol>` — Detail aset real-time\n' +
            '`/market-top` — Top gainers / losers / volume\n' +
            '`/market-search <query>` — Cari aset\n' +
            '`/price <symbol>` — Cek harga cepat (legacy)\n' +
            '`/market <tab>` — Market overview (legacy)',
        },
        news: {
          title: '📰 Berita',
          desc: '**Perintah Berita**\n\n' +
            '`/market-news [asset]` — Berita pasar terbaru dengan navigasi halaman\n' +
            '`/news [query]` — Berita market (legacy)',
        },
        alerts: {
          title: '🔔 Alert & Notifikasi',
          desc: '**Perintah Alert**\n\n' +
            '`/market-alerts` — Kelola alert harga (aktifkan/nonaktifkan/hapus)\n' +
            '`/alert-create <symbol> <condition> <value>` — Buat alert baru\n' +
            '`/alert-list` — Lihat semua alert aktif\n' +
            '`/alert-delete <id>` — Hapus alert\n' +
            '`/alert-test` — Test alert ke channel\n\n' +
            '**Notifikasi DM**\n' +
            '`/market-dm-subscribe` — Langganan alert via DM\n' +
            '`/market-dm-unsubscribe` — Berhenti langganan DM\n' +
            '`/market-dm-list` — Lihat pelanggan DM',
        },
        portfolio: {
          title: '⭐ Portofolio & Watchlist',
          desc: '**Perintah Portofolio**\n\n' +
            '`/market-portfolio` — Lihat & kelola portofolio\n' +
            '`/market-watchlist` — Lihat & kelola watchlist\n' +
            '`/watchlist-add <symbol>` — Tambah ke watchlist (legacy)\n' +
            '`/watchlist-remove <symbol>` — Hapus dari watchlist (legacy)',
        },
        settings: {
          title: '⚙️ Pengaturan',
          desc: '**Perintah Pengaturan**\n\n' +
            '`/market-settings` — Lihat pengaturan bot\n' +
            '`/market-alert-channel <#channel>` — Atur channel alert\n' +
            '`/market-embed-style <style>` — Atur gaya embed\n' +
            '`/market-rich-mode <mode>` — Atur rich presence\n' +
            '`/settings [action]` — Atur setting (legacy)\n' +
            '`/status` — Status bot & sistem',
        },
      }
      const cat = helpData[category] || helpData.data
      const embed = new EmbedBuilder()
        .setColor(COLORS.primary)
        .setAuthor({ name: '🐋 Market Orca', iconURL: `${APP_CONFIG.publicBaseUrl}/icon-192.svg` })
        .setTitle(cat.title)
        .setDescription(cat.desc)
        .setTimestamp()
        .setFooter({ text: `🐋 Market Orca • ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' })}` })
      await interaction.editReply({ embeds: [embed], components: [helpCategoryButtons()] })
      return
    }

    // ── LEGACY component handlers (backward compat) ────────────
    const [action, ...args] = customId.split(':')

    switch (action) {
      case 'price_refresh': {
        await interaction.deferUpdate()
        const symbol = args[0]
        try {
          const r = await fetch(`http://localhost:4567/api/assets/${symbol}/live-lite`)
          const d = await r.json()
          if (d.ok) {
            const embed = buildAssetEmbed({ asset: d })
            await interaction.editReply({ embeds: [embed], components: [priceButtons(symbol)] })
          }
        } catch { }
        break
      }
      case 'chart': {
        await interaction.deferUpdate()
        const [symbol, period] = args
        const embed = new EmbedBuilder()
          .setColor(COLORS.neutral)
          .setTitle(`📈 ${symbol?.toUpperCase()} — ${period}`)
          .setDescription(`[Buka chart di web](${APP_CONFIG.publicBaseUrl}/asset/${symbol})`)
        await interaction.editReply({ embeds: [embed] })
        break
      }
      case 'news': {
        await interaction.deferUpdate()
        const symbol = args[0]
        try {
          const r = await fetch(`http://localhost:4567/api/news?q=${symbol}&limit=5`)
          const d = await r.json()
          const news = d.news || d.items || []
          const embeds = news.slice(0, 3).map(n => new EmbedBuilder()
            .setColor(COLORS.neutral)
            .setTitle(n.title?.slice(0, 256) || '📰 Market News')
            .setDescription(n.snippet || '')
            .addFields(
              { name: '📡 Source', value: n.source || 'Unknown', inline: true },
              ...(n.publishedAt ? [{ name: '🕐 Published', value: `<t:${Math.floor(new Date(n.publishedAt).getTime() / 1000)}:R>`, inline: true }] : []),
            )
            .setURL(n.url || APP_CONFIG.publicBaseUrl))
          if (embeds.length) await interaction.editReply({ embeds })
        } catch { }
        break
      }
      case 'market_tab': {
        await interaction.deferUpdate()
        const tab = interaction.values[0]
        try {
          const r = await fetch(`http://localhost:4567/api/assets/live-lite`)
          const d = await r.json()
          const assets = (d.assets || []).slice(0, 20)
          let embed
          if (tab === 'gainers') {
            const sorted = [...assets].sort((a, b) => (b.change_percent || 0) - (a.change_percent || 0)).slice(0, 10)
            embed = new EmbedBuilder().setColor(COLORS.positive).setTitle('🟢 Top Gainers').setDescription(sorted.map((a, i) => `**${i + 1}.** \`${a.symbol?.toUpperCase()}\` — **${a.change_percent ?? 0}%**`).join('\n'))
          } else if (tab === 'losers') {
            const sorted = [...assets].sort((a, b) => (a.change_percent || 0) - (b.change_percent || 0)).slice(0, 10)
            embed = new EmbedBuilder().setColor(COLORS.negative).setTitle('🔴 Top Losers').setDescription(sorted.map((a, i) => `**${i + 1}.** \`${a.symbol?.toUpperCase()}\` — **${a.change_percent ?? 0}%**`).join('\n'))
          } else if (tab === 'news') {
            const r2 = await fetch('http://localhost:4567/api/news?limit=8')
            const d2 = await r2.json()
            const news = d2.news || d2.items || []
            embed = new EmbedBuilder().setColor(COLORS.neutral).setTitle('📰 Berita').setDescription(news.map((n, i) => `**${i + 1}.** [${n.title?.slice(0, 70)}](${n.url})`).join('\n'))
          } else {
            embed = new EmbedBuilder().setColor(COLORS.primary).setTitle('📊 Overview').setDescription(assets.slice(0, 8).map(a => `${(a.change_percent ?? 0) >= 0 ? '🟢' : '🔴'} \`${a.symbol?.toUpperCase()}\` — **${a.change_percent ?? 0}%**`).join('\n'))
          }
          await interaction.editReply({ embeds: [embed], components: [marketSelect()] })
        } catch { }
        break
      }
      case 'alert_confirm': {
        await interaction.deferUpdate()
        const [symbol, condition, value] = args
        try {
          await fetch('http://localhost:4567/api/alerts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol, condition, value: parseFloat(value), user_id: interaction.user.id }) })
          await interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.positive).setTitle('✅ Alert Dibuat').setDescription(`Alert untuk **${symbol.toUpperCase()}** berhasil dibuat.`)], components: [] })
        } catch (e) {
          await interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.negative).setTitle('❌ Gagal').setDescription(String(e.message))], components: [] })
        }
        break
      }
      case 'alert_cancel': {
        await interaction.update({ embeds: [new EmbedBuilder().setColor(COLORS.neutral).setTitle('❌ Dibatalkan').setDescription('Pembuatan alert dibatalkan.')], components: [] })
        break
      }
      case 'report': {
        await interaction.deferUpdate()
        const date = args[0]
        try {
          const r = await fetch(`http://localhost:4567/api/report/${date}`)
          const d = await r.json()
          if (d.ok) {
            const embed = new EmbedBuilder().setColor(COLORS.warning).setTitle(`📄 Report: ${date}`).setDescription(`[Buka Report](${APP_CONFIG.publicBaseUrl}/report/${date})`)
            await interaction.editReply({ embeds: [embed], components: [reportNavButtons(date)] })
          }
        } catch { }
        break
      }
      case 'style_select': {
        await interaction.deferUpdate()
        const style = interaction.values[0]
        setDiscordSetting('embed_style', style)
        await interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.positive).setTitle('✅ Style Updated').setDescription(`Embed style diset ke **${style}**.`)], components: [] })
        break
      }
      case 'rich_select': {
        await interaction.deferUpdate()
        const mode = interaction.values[0]
        setDiscordSetting('rich_mode', mode)
        await interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.positive).setTitle('✅ Rich Mode Updated').setDescription(`Rich mode diset ke **${mode}**.`)], components: [] })
        break
      }
      case 'settings_edit': {
        await interaction.showModal(settingsModal())
        break
      }
      case 'watchlist_add_prompt': {
        await interaction.reply({ content: 'Gunakan `/watchlist-add <symbol>` untuk menambah asset.', ephemeral: true })
        break
      }
      default:
        break
    }
  } catch (e) {
    console.error(`[discord] component error ${customId}:`, e)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MODAL HANDLER
// ═══════════════════════════════════════════════════════════════════════════
async function handleModal(interaction) {
  console.log(`[discord] modal: ${interaction.customId}`)

  try {
    // Watchlist add modal
    if (interaction.customId === 'watchlist_add_modal') {
      const symbol = interaction.fields.getTextInputValue('watchlist_symbol').trim().toLowerCase()
      try {
        await apiPost('/api/watchlist', { user_id: interaction.user.id, symbol })
        const embed = new EmbedBuilder()
          .setColor(COLORS.positive)
          .setAuthor({ name: '🐋 Market Orca', iconURL: `${APP_CONFIG.publicBaseUrl}/icon-192.svg` })
          .setTitle('✅ Ditambahkan ke Watchlist')
          .setDescription(`\`${symbol.toUpperCase()}\` berhasil ditambahkan ke watchlist.`)
          .setTimestamp()
          .setFooter({ text: `🐋 Market Orca • ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' })}` })
        await interaction.reply({ embeds: [embed], ephemeral: true })
      } catch (e) {
        console.error('[discord] watchlist_add_modal error:', e)
        await interaction.reply({ embeds: [buildErrorEmbed({ message: `Gagal menambah ${symbol.toUpperCase()} ke watchlist.` })], ephemeral: true })
      }
      return
    }

    // Portfolio add modal
    if (interaction.customId === 'portfolio_add_modal') {
      const symbol = interaction.fields.getTextInputValue('portfolio_symbol').trim().toLowerCase()
      const amount = parseInt(interaction.fields.getTextInputValue('portfolio_amount').trim(), 10) || 0
      const priceRaw = interaction.fields.getTextInputValue('portfolio_price').trim()
      const price = priceRaw ? parseFloat(priceRaw) : 0
      if (!symbol || amount <= 0) {
        await interaction.reply({ embeds: [buildErrorEmbed({ message: 'Simbol dan jumlah unit harus diisi dengan benar.' })], ephemeral: true })
        return
      }
      try {
        await apiPost('/api/watchlist', { user_id: interaction.user.id, symbol, amount, avg_price: price || undefined })
        const embed = new EmbedBuilder()
          .setColor(COLORS.positive)
          .setAuthor({ name: '🐋 Market Orca', iconURL: `${APP_CONFIG.publicBaseUrl}/icon-192.svg` })
          .setTitle('✅ Ditambahkan ke Portofolio')
          .setDescription(`${amount} unit \`${symbol.toUpperCase()}\`${price ? ` @ Rp ${price.toLocaleString('id-ID')}` : ''} berhasil ditambahkan.`)
          .setTimestamp()
          .setFooter({ text: `🐋 Market Orca • ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' })}` })
        await interaction.reply({ embeds: [embed], ephemeral: true })
      } catch (e) {
        console.error('[discord] portfolio_add_modal error:', e)
        await interaction.reply({ embeds: [buildErrorEmbed({ message: `Gagal menambah ${symbol.toUpperCase()} ke portofolio.` })], ephemeral: true })
      }
      return
    }

    // Legacy settings modal
    if (interaction.customId === 'settings_modal') {
      const channel = interaction.fields.getTextInputValue('alert_channel')
      const style = interaction.fields.getTextInputValue('embed_style')
      const rich = interaction.fields.getTextInputValue('rich_mode')
      if (channel) setDiscordSetting('alert_channel_id', channel)
      if (style) setDiscordSetting('embed_style', style)
      if (rich) setDiscordSetting('rich_mode', rich)
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.positive).setTitle('✅ Settings Updated').setDescription('Settings berhasil diupdate.')], ephemeral: true })
      return
    }
  } catch (e) {
    console.error(`[discord] modal error ${interaction.customId}:`, e)
    try {
      await interaction.reply({ embeds: [buildErrorEmbed({ message: 'Gagal memproses form. Silakan coba lagi.' })], ephemeral: true })
    } catch { }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// INTERACTION ROUTER
// ═══════════════════════════════════════════════════════════════════════════
async function handleInteraction(interaction) {
  try {
    if (interaction.isChatInputCommand()) {
      await handleCommand(interaction)
    } else if (interaction.isButton()) {
      await handleComponent(interaction)
    } else if (interaction.isStringSelectMenu()) {
      await handleComponent(interaction)
    } else if (interaction.isModalSubmit()) {
      await handleModal(interaction)
    }
  } catch (e) {
    console.error('[discord] unhandled interaction error:', e)
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ embeds: [buildErrorEmbed({ message: 'Terjadi kesalahan tak terduga.' })] })
      } else {
        await interaction.reply({ embeds: [buildErrorEmbed({ message: 'Terjadi kesalahan tak terduga.' })], ephemeral: true })
      }
    } catch { }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// BOT CLIENT
// ═══════════════════════════════════════════════════════════════════════════
function getBotClient() {
  return botClientPromise
}

async function registerSlashCommands(client) {
  const env = loadEnv()
  const guildId = env.DISCORD_GUILD_ID

  if (!guildId) {
    console.warn('[discord] No DISCORD_GUILD_ID in .env — skipping guild command registration')
    return
  }

  try {
    const commands = buildCommands()
    console.log(`[discord] Registering ${commands.length} slash commands for guild ${guildId}...`)

    await client.guilds.cache.get(guildId)?.commands.set(commands)

    // Also set global commands as fallback
    try {
      await client.application.commands.set(commands)
      console.log('[discord] Global commands registered.')
    } catch (e) {
      console.warn('[discord] Could not register global commands:', e.message)
    }

    console.log(`[discord] ${commands.length} slash commands registered.`)
  } catch (e) {
    console.error('[discord] Failed to register commands:', e)
  }
}

async function updateDiscordPresence(client) {
  try {
    // Fall back to module-level _client if caller passed a non-Discord object (e.g. {text:...})
    if (!client || !client.user || typeof client.user.setActivity !== 'function') {
      client = _client
    }
    if (!client || !client.isReady?.()) return

    const richMode = getDiscordSetting('rich_mode', 'auto')

    if (richMode === 'off') {
      client.user.setActivity('Market Orca', { type: ActivityType.Playing })
      return
    }

    const r = await fetch('http://localhost:4567/api/assets/live-lite').catch(() => null)
    if (r && r.ok) {
      const d = await r.json()
      const assets = d.assets || []
      const gainers = assets.filter(a => (a.change_percent || 0) > 0).length
      const losers = assets.filter(a => (a.change_percent || 0) < 0).length

      client.user.setActivity(`${assets.length} aset • 🟢${gainers} 🔴${losers}`, {
        type: ActivityType.Watching,
      })
    } else {
      client.user.setActivity('📊 Market Orca', { type: ActivityType.Watching })
    }
  } catch (e) {
    console.error('[discord] updatePresence error:', e)
  }
}

async function sendDiscordAlert(alertData) {
  try {
    const client = _client
    if (!client?.isReady()) {
      console.warn('[discord] Bot not ready, cannot send alert')
      return { ok: false, error: 'Bot not ready' }
    }

    const channelId = getDiscordSetting('alert_channel_id')
    if (!channelId) {
      console.warn('[discord] No alert_channel_id configured')
      return { ok: false, error: 'No alert channel configured' }
    }

    const channel = await client.channels.fetch(channelId).catch(() => null)
    if (!channel) {
      console.warn(`[discord] Alert channel ${channelId} not found`)
      return { ok: false, error: 'Channel not found' }
    }

    const embed = buildAlertEmbed({ alert: alertData })
    await channel.send({ embeds: [embed] })
    setDiscordSetting('last_alert_time', new Date().toISOString())

    // Only DM subscribers if alert_dm_enabled in DB
    const dmEnabled = getDiscordSetting('alert_dm_enabled') !== 'false'
    if (dmEnabled) {
      const subscribers = listDmSubscribers()
      for (const sub of subscribers) {
        try {
          const user = await client.users.fetch(sub.user_id).catch(() => null)
          if (user) await user.send({ embeds: [embed] }).catch(() => { })
        } catch { }
      }
    }

    console.log(`[discord] Alert sent for ${alertData.symbol || '?'}`)
    return { ok: true }
  } catch (e) {
    console.error('[discord] sendDiscordAlert error:', e)
    return { ok: false, error: e.message }
  }
}

// ── Send Report to Discord channel ────────────────────────────────────────
async function sendDiscordReport(reportData) {
  try {
    const client = _client
    if (!client?.isReady()) return { ok: false, error: 'Bot not ready' }

    const channelId = getDiscordSetting('report_channel_id')
    if (!channelId) {
      console.warn('[discord] No report_channel_id configured')
      return { ok: false, error: 'No report channel configured' }
    }

    const channel = await client.channels.fetch(channelId).catch(() => null)
    if (!channel) {
      console.warn(`[discord] Report channel ${channelId} not found`)
      return { ok: false, error: 'Channel not found' }
    }

    const embed = buildReportEmbed({ report: reportData })
    await channel.send({ embeds: [embed] })
    console.log(`[discord] Report sent to #${channel.name}`)
    return { ok: true }
  } catch (e) {
    console.error('[discord] sendDiscordReport error:', e)
    return { ok: false, error: e.message }
  }
}

// ── Send News to Discord channel ──────────────────────────────────────────
async function sendDiscordNews(newsData) {
  try {
    const client = _client
    if (!client?.isReady()) return { ok: false, error: 'Bot not ready' }

    const channelId = getDiscordSetting('market_channel_id')
    if (!channelId) {
      console.warn('[discord] No market_channel_id configured')
      return { ok: false, error: 'No market channel configured' }
    }

    const channel = await client.channels.fetch(channelId).catch(() => null)
    if (!channel) {
      console.warn(`[discord] Market channel ${channelId} not found`)
      return { ok: false, error: 'Channel not found' }
    }

    const embed = buildNewsEmbed({ newsList: newsData })
    await channel.send({ embeds: [embed] })
    console.log(`[discord] News sent to #${channel.name}`)
    return { ok: true }
  } catch (e) {
    console.error('[discord] sendDiscordNews error:', e)
    return { ok: false, error: e.message }
  }
}

async function initDiscordBot() {
  // Return existing if already initializing
  if (botClientPromise) return botClientPromise

  botClientPromise = (async () => {
    const env = loadEnv()
    const token = env.DISCORD_BOT_TOKEN

    if (!token) {
      console.warn('[discord] No DISCORD_BOT_TOKEN in .env — bot disabled')
      return null
    }

    try {
      console.log('[discord] Initializing bot...')

      const client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
          GatewayIntentBits.DirectMessages,
        ],
      })

      client.once('ready', async () => {
        console.log(`[discord] ✅ Bot logged in as ${client.user.tag}`)
        _client = client

        // Register slash commands
        await registerSlashCommands(client)

        // Set initial presence
        await updateDiscordPresence(client)

        // Periodic presence update (every 5 min)
        setInterval(() => updateDiscordPresence(client), 300000)
      })

      client.on('interactionCreate', handleInteraction)

      client.on('error', (e) => {
        console.error('[discord] Client error:', e)
      })

      await client.login(token)
      console.log('[discord] Bot logged in successfully.')
      return client
    } catch (e) {
      console.error('[discord] Failed to initialize bot:', e)
      botClientPromise = null
      throw e
    }
  })()

  return botClientPromise
}

export {
  getBotClient,
  initDiscordBot,
  sendDiscordAlert,
  sendDiscordReport,
  sendDiscordNews,
  updateDiscordPresence,
  buildEmbed,
  loadEnv,
  postWebhook,
  buildCommands,
}
