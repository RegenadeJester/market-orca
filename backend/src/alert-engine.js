import { db, saveAssetSnapshot } from './db.js'
import { getLiveAsset } from './live-data.js'
import { sendDiscordAlert, updateDiscordPresence } from './discord.js'
import { APP_CONFIG } from './config.js'

const fired = new Map()

function avg(values = []) {
  if (!values.length) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

export async function runAlertScan() {
  let alertCount = 0
  let topMover = null
  const assets = db.prepare('SELECT * FROM assets').all()
  for (const asset of assets) {
    try {
      const live = await getLiveAsset(asset)
      saveAssetSnapshot(live)
      const a = live.asset
      if (!topMover || Math.abs(a.change_percent || 0) > Math.abs(topMover.change_percent || 0)) topMover = a
      const t = db.prepare('SELECT * FROM asset_settings WHERE asset_slug = ?').get(a.slug) || APP_CONFIG.thresholds[a.slug]
      if (!t || t.watch_enabled === 0) continue

      const candles = live.candles || []
      const last = candles.at(-1)
      const prev = candles.at(-2)
      const avgVol = avg(candles.slice(-12, -1).map((c) => c.volume || 0))
      const lastVol = last?.volume || 0
      const lastClose = last?.close ?? last?.value ?? a.price
      const prevClose = prev?.close ?? prev?.value ?? a.price
      const shortMove = prevClose ? ((lastClose - prevClose) / prevClose) * 100 : 0
      const breakoutUp = candles.length > 8 && lastClose >= Math.max(...candles.slice(-8, -1).map((c) => c.high ?? c.value))
      const breakoutDown = candles.length > 8 && lastClose <= Math.min(...candles.slice(-8, -1).map((c) => c.low ?? c.value))
      const volumeSpike = avgVol > 0 && lastVol >= avgVol * 1.8

      const upTh = t.threshold_up ?? t.up ?? (a.market === 'CRYPTO' ? 3 : a.market === 'IDX' ? 1.5 : 2)
      const downTh = t.threshold_down ?? t.down ?? -upTh
      const direction = a.change_percent >= upTh ? 'up' : a.change_percent <= downTh ? 'down' : null
      let score = 0
      if (direction) score += 2
      if (direction === 'up' && shortMove > 0) score += 1
      if (direction === 'down' && shortMove < 0) score += 1
      if (direction === 'up' && breakoutUp) score += 1
      if (direction === 'down' && breakoutDown) score += 1
      if (volumeSpike) score += 1
      const alignedNews = (live.news || []).find(n => direction === 'up' ? n.sentiment === 'positive' : direction === 'down' ? n.sentiment === 'negative' : false)
      if (alignedNews) score += 1

      let title = null
      if (score >= 3 && direction === 'up') title = `${a.name} momentum naik terkonfirmasi`
      if (score >= 3 && direction === 'down') title = `${a.name} momentum turun terkonfirmasi`
      if (!title && breakoutUp && volumeSpike) title = `${a.name} breakout atas + volume`
      if (!title && breakoutDown && volumeSpike) title = `${a.name} breakdown bawah + volume`
      if (!title) continue

      const key = `${a.slug}:${title}`
      const lastFire = fired.get(key)
      const now = Date.now()
      if (lastFire && now - lastFire < APP_CONFIG.alertIntervalMs) continue

      const leadNews = alignedNews || live.news?.[0] || null
      const message = `${a.symbol} ${a.price} (${a.change_percent}%). Score ${score}/5, short move ${shortMove.toFixed(2)}%, volume ${Math.round(lastVol)} vs avg ${Math.round(avgVol)}.`
      await sendDiscordAlert({
        title,
        message,
        slug: a.slug,
        symbol: a.symbol,
        price: a.price,
        changePercent: a.change_percent,
        detailUrl: `${APP_CONFIG.publicBaseUrl}/asset/${a.slug}`,
        newsTitle: leadNews?.title,
        newsLink: leadNews?.link,
        image: leadNews?.image,
        source: leadNews?.source,
        marketState: a.marketState
      })
      db.prepare(`INSERT INTO alerts (asset_slug, title, message, discord_sent, created_at) VALUES (?, ?, ?, 1, datetime('now'))`).run(a.slug, title, message)
      fired.set(key, now)
      alertCount += 1
    } catch (err) {
      console.error('[alert-scan-error]', asset.slug, String(err))
    }
  }

  if (topMover) {
    await updateDiscordPresence({
      text: `${topMover.symbol} ${topMover.change_percent}% • ${alertCount} active alerts • monitoring ${assets.length} assets`
    }).catch(() => {})
  }
}
