import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client, GatewayIntentBits, ActivityType, ChannelType, SlashCommandBuilder } from 'discord.js'
import { APP_CONFIG } from './config.js'
import { getDiscordSetting, setDiscordSetting, getDiscordSettings } from './discord-settings.js'
import { addDmSubscriber, removeDmSubscriber, listDmSubscribers } from './discord-dm.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.join(__dirname, '..', '.env')
let botClientPromise = null

function loadEnv() {
  const out = {}
  if (!fs.existsSync(envPath)) return out
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    if (!line || line.trim().startsWith('#')) continue
    const idx = line.indexOf('=')
    if (idx === -1) continue
    out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }
  return out
}

async function postWebhook(webhook, payload) {
  const response = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  if (!response.ok) throw new Error(`Discord webhook failed: ${response.status} ${await response.text()}`)
}

function buildCommands() {
  return [
    new SlashCommandBuilder().setName('market-settings').setDescription('Lihat setting Discord bot Market Orca'),
    new SlashCommandBuilder().setName('market-alert-channel').setDescription('Atur channel alert untuk bot')
      .addChannelOption(o => o.setName('channel').setDescription('Channel target alert').addChannelTypes(ChannelType.GuildText).setRequired(true)),
    new SlashCommandBuilder().setName('market-embed-style').setDescription('Atur style embed alert')
      .addStringOption(o => o.setName('style').setDescription('Style embed').addChoices(
        { name: 'default', value: 'default' },
        { name: 'compact', value: 'compact' },
        { name: 'rich', value: 'rich' }
      ).setRequired(true)),
    new SlashCommandBuilder().setName('market-rich-mode').setDescription('Atur mode rich presence/status')
      .addStringOption(o => o.setName('mode').setDescription('Mode rich').addChoices(
        { name: 'auto', value: 'auto' },
        { name: 'manual', value: 'manual' },
        { name: 'off', value: 'off' }
      ).setRequired(true)),
    new SlashCommandBuilder().setName('market-dm-subscribe').setDescription('Subscribe alert ke DM pribadi'),
    new SlashCommandBuilder().setName('market-dm-unsubscribe').setDescription('Stop alert DM pribadi'),
    new SlashCommandBuilder().setName('market-dm-list').setDescription('Lihat daftar subscriber DM Market Orca'),
  ].map(c => c.toJSON())
}

async function registerSlashCommands(client) {
  const env = loadEnv()
  const guildId = env.DISCORD_GUILD_ID
  const commands = buildCommands()
  if (guildId) {
    await client.application.commands.set(commands, guildId)
    console.log(`[discord] registered ${commands.length} guild slash commands for ${guildId}`)
  } else {
    await client.application.commands.set(commands)
    console.log(`[discord] registered ${commands.length} global slash commands`)
  }
}

async function handleInteraction(interaction) {
  if (!interaction.isChatInputCommand()) return
  if (interaction.commandName === 'market-settings') {
    const settings = getDiscordSettings()
    await interaction.reply({ content: `Settings:\n- alert_channel_id: ${settings.alert_channel_id || '-'}\n- embed_style: ${settings.embed_style || 'default'}\n- rich_mode: ${settings.rich_mode || 'auto'}`, ephemeral: true })
    return
  }
  if (interaction.commandName === 'market-alert-channel') {
    const channel = interaction.options.getChannel('channel', true)
    setDiscordSetting('alert_channel_id', channel.id)
    await interaction.reply({ content: `Alert channel diset ke <#${channel.id}>`, ephemeral: true })
    return
  }
  if (interaction.commandName === 'market-embed-style') {
    const style = interaction.options.getString('style', true)
    setDiscordSetting('embed_style', style)
    await interaction.reply({ content: `Embed style diset ke **${style}**`, ephemeral: true })
    return
  }
  if (interaction.commandName === 'market-rich-mode') {
    const mode = interaction.options.getString('mode', true)
    setDiscordSetting('rich_mode', mode)
    await interaction.reply({ content: `Rich mode diset ke **${mode}**`, ephemeral: true })
    return
  }
  if (interaction.commandName === 'market-dm-subscribe') {
    addDmSubscriber(interaction.user.id, interaction.user.tag)
    await interaction.reply({ content: 'Kamu sekarang subscribe alert DM Market Orca.', ephemeral: true })
    return
  }
  if (interaction.commandName === 'market-dm-unsubscribe') {
    removeDmSubscriber(interaction.user.id)
    await interaction.reply({ content: 'Kamu sudah unsubscribe alert DM Market Orca.', ephemeral: true })
    return
  }
  if (interaction.commandName === 'market-dm-list') {
    const rows = listDmSubscribers()
    const text = rows.length ? rows.map((r, i) => `${i + 1}. ${r.username || r.user_id} (${r.user_id})`).join('\n') : 'Belum ada subscriber DM.'
    await interaction.reply({ content: text.slice(0, 1900), ephemeral: true })
    return
  }
}

async function getBotClient() {
  const env = loadEnv()
  const token = env.DISCORD_BOT_TOKEN
  if (!token) return null
  if (botClientPromise) return botClientPromise
  botClientPromise = (async () => {
    const client = new Client({ intents: [GatewayIntentBits.Guilds] })
    client.once('ready', async () => {
      console.log(`[discord] bot ready as ${client.user?.tag || 'unknown'}`)
      await registerSlashCommands(client).catch((err) => console.error('[discord] slash-register-failed', err))
    })
    client.on('interactionCreate', (interaction) => {
      handleInteraction(interaction).catch(() => {})
    })
    await client.login(token)
    return client
  })().catch((err) => {
    botClientPromise = null
    throw err
  })
  return botClientPromise
}

function buildEmbed({ title, message, slug, symbol, price, changePercent, detailUrl, newsTitle, newsLink, image, source, marketState }) {
  const style = getDiscordSetting('embed_style', 'default')
  const color = (changePercent ?? 0) >= 0 ? 0x57F287 : 0xED4245
  const fallbackThumb = `${APP_CONFIG.publicBaseUrl}/icon-192.svg`
  const fields = [
    { name: 'Symbol', value: symbol, inline: true },
    { name: 'Price', value: String(price), inline: true },
    { name: 'Change %', value: changePercent != null ? `${changePercent}%` : 'N/A', inline: true },
  ]
  if (style !== 'compact') {
    fields.push({ name: 'Market State', value: marketState || 'LIVE', inline: true })
    fields.push({ name: 'News Source', value: source || 'N/A', inline: true })
    const localUrl = detailUrl || `${APP_CONFIG.publicBaseUrl}/asset/${slug}`
  const tsUrl = `${APP_CONFIG.tailscaleBaseUrl}/asset/${slug}`
  fields.push({ name: 'Detail URL', value: `<${localUrl}>\n<${tsUrl}>`, inline: false })
  }
  if (newsTitle) fields.push({ name: 'Headline', value: newsTitle.slice(0, 1024), inline: false })
  if (style === 'rich' && newsLink) fields.push({ name: 'News URL', value: newsLink, inline: false })
  return {
    title,
    description: `${message}\n\nSlug: ${slug}`,
    color,
    fields,
    thumbnail: { url: fallbackThumb },
    image: image ? { url: image } : (style === 'rich' ? { url: fallbackThumb } : undefined),
    footer: { text: `Market Orca • ${symbol}` },
    timestamp: new Date().toISOString()
  }
}

export async function sendDiscordAlert({ title, message, slug, symbol, price, changePercent, detailUrl, newsTitle, newsLink, image, source, marketState }) {
  const env = loadEnv()
  const embed = buildEmbed({ title, message, slug, symbol, price, changePercent, detailUrl, newsTitle, newsLink, image, source, marketState })
  const botClient = await getBotClient().catch(() => null)
  const alertChannelId = getDiscordSetting('alert_channel_id', '')
  if (botClient?.isReady() && alertChannelId) {
    const channel = await botClient.channels.fetch(alertChannelId).catch(() => null)
    if (channel?.isTextBased()) {
      await channel.send({ content: '📡 Market alert triggered', embeds: [embed] })
      return
    }
  }
  const webhook = env.DISCORD_WEBHOOK_URL
  if (!webhook) throw new Error('DISCORD_WEBHOOK_URL not set')
  await postWebhook(webhook, { content: '📡 Market alert triggered', embeds: [embed] })
}

export async function initDiscordBot() {
  return getBotClient()
}

export async function updateDiscordPresence({ text }) {
  const env = loadEnv()
  const richMode = getDiscordSetting('rich_mode', 'auto')
  const botClient = richMode !== 'off' ? await getBotClient().catch(() => null) : null
  if (botClient?.user && text && richMode !== 'manual') {
    botClient.user.setPresence({
      activities: [{ name: text.slice(0, 120), type: ActivityType.Watching }],
      status: 'online'
    })
    return { mode: 'bot-presence' }
  }
  const webhook = env.DISCORD_STATUS_WEBHOOK_URL || env.DISCORD_WEBHOOK_URL
  if (!webhook || !text || richMode === 'off') return { mode: 'disabled' }
  await postWebhook(webhook, { content: `🟢 STATUS: ${text}` })
  return { mode: 'webhook-status' }
}
