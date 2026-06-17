/**
 * World Bank API fetcher — Indonesia macro data
 * Free API, no auth. Returns JSON array: [metadata, data_rows]
 */
import { saveMacro, getLatestMacro } from './db.js'

const WB_BASE = 'https://api.worldbank.org/v2/country/ID/indicator'
const TIMEOUT = 15000

const INDICATORS = {
  'NY.GDP.MKTP.KD.ZG':    { name: 'gdp_growth',       unit: '% YoY' },
  'FP.CPI.TOTL.ZG':       { name: 'inflation',        unit: '% YoY' },
  'FI.RES.TOTL.CD':       { name: 'forex_reserves',   unit: 'USD' },
  'BN.CAB.XOKA.GD.ZS':    { name: 'current_account',  unit: '% of GDP' },
  'SL.UEM.TOTL.ZS':       { name: 'unemployment',     unit: '%' },
}

async function wbFetch(indicator) {
  const url = `${WB_BASE}/${indicator}?format=json&per_page=20&sort=date:desc`
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT)
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'Accept': 'application/json' } })
    if (!res.ok) throw new Error(`World Bank HTTP ${res.status} for ${indicator}`)
    return await res.json()
  } finally { clearTimeout(t) }
}

export async function fetchMacroData() {
  const results = {}
  let allOk = true
  for (const [code, meta] of Object.entries(INDICATORS)) {
    try {
      const data = await wbFetch(code)
      const rows = Array.isArray(data) && data[1] ? data[1] : []
      const values = rows
        .filter(r => r.value != null)
        .map(r => ({ date: r.date, value: parseFloat(r.value) }))
      if (values.length) {
        results[meta.name] = { code, unit: meta.unit, values, latest: values[0] }
        // Cache latest value to DB
        if (values[0]) {
          saveMacro(values[0].date, meta.name, values[0].value, meta.unit, 'worldbank')
        }
      } else {
        results[meta.name] = { code, unit: meta.unit, values: [], latest: null, error: 'no_data' }
        allOk = false
      }
    } catch (e) {
      console.error(`[fetcher-worldbank] ${meta.name}:`, e.message)
      results[meta.name] = { code, unit: meta.unit, values: [], latest: null, error: e.message }
      allOk = false
    }
  }

  // Fallback: some data may be empty; use DB cache
  if (!allOk) {
    const cached = getLatestMacro()
    for (const row of cached || []) {
      const meta = Object.values(INDICATORS).find(m => m.name === row.indicator_name)
      if (meta && (!results[meta.name]?.latest)) {
        results[row.indicator_name] = {
          code: '',
          unit: row.unit,
          values: [{ date: row.date, value: row.value }],
          latest: { date: row.date, value: row.value },
          source: 'cache'
        }
      }
    }
  }

  return {
    indicators: results,
    fetchedAt: new Date().toISOString(),
    status: allOk ? 'live' : 'partial'
  }
}

export { INDICATORS }
