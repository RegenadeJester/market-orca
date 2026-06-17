import { execSync } from 'node:child_process'
import { networkInterfaces } from 'node:os'

function findLanIP() {
  try {
    const nets = networkInterfaces()
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === 'IPv4' && !net.internal && net.address.startsWith('192.168.')) return net.address
      }
    }
    // Fallback: try hostname -I
    const out = execSync('hostname -I 2>/dev/null || true', { timeout: 3000, encoding: 'utf8' }).trim()
    const ips = out.split(/\s+/).filter(ip => ip.startsWith('192.168.'))
    if (ips.length) return ips[0]
  } catch {}
  return '192.168.x.x'
}

function findTailscaleIP() {
  try {
    const out = execSync('tailscale ip -4 2>/dev/null || true', { timeout: 3000, encoding: 'utf8' }).trim()
    if (out && out.startsWith('100.')) return out
  } catch {}
  try {
    const nets = networkInterfaces()
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === 'IPv4' && net.address.startsWith('100.')) return net.address
      }
    }
  } catch {}
  return '100.x.x.x'
}

const PORT = process.env.PORT || '4567'
const LAN = process.env.LAN_IP || findLanIP()
const TS = process.env.TAILSCALE_IP || findTailscaleIP()

export const APP_CONFIG = {
  publicBaseUrl: process.env.PUBLIC_BASE_URL || `http://${LAN}:${PORT}`,
  tailscaleBaseUrl: process.env.TAILSCALE_BASE_URL || `http://${TS}:${PORT}`,
  frontendUrl: process.env.FRONTEND_URL || `http://${LAN}:5173`,
  frontendTailscaleUrl: process.env.FRONTEND_TAILSCALE_URL || `http://${TS}:5173`,
  alertIntervalMs: 180000,
  thresholds: {
    'bbca-jk': { up: 1.5, down: -1.5 },
    'aapl': { up: 1.2, down: -1.2 },
    'btc-usd': { up: 2.5, down: -2.5 },
    'xauusd': { up: 1.0, down: -1.0 }
  }
}

export function detectIPs() {
  return { lan: LAN, tailscale: TS }
}
