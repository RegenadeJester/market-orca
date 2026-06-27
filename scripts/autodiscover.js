#!/usr/bin/env node
/**
 * Auto Topic Discovery + RAG Collection Creator
 * Inspired by Perplexity Discover
 * - Scans trending market/crypto/news topics
 * - Auto-creates new RAG collections for fresh topics
 * - Runs autolearn on each new collection
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', 'backend');
const COLLECTIONS = join(__dirname, '..', 'collections');
const DATA = join(ROOT, 'data');
const TOPICS_FILE = join(COLLECTIONS, 'autolearn-topics.json');
const LEARNED_FILE = join(COLLECTIONS, 'autolearn-learned.json');

[COLLECTIONS, DATA].forEach(d => { if (!existsSync(d)) mkdirSync(d, { recursive: true }); });

const TOPIC_TEMPLATES = {
  'indonesia': { label: 'Indonesia', keywords: ['indonesia', 'IDX', 'IHSG', 'jokowi', 'prabowo', 'OJK', 'BI rate', 'rupiah'], parent_area: 'macro', priority: 9 },
  'gold': { label: 'Gold & Commodities', keywords: ['gold price', 'emas', 'silver', 'copper', 'nickel', 'palm oil', 'CPO', 'minyak sawit', 'batu bara', 'crude oil'], parent_area: 'commodities', priority: 8 },
  'crypto': { label: 'Crypto & Blockchain', keywords: ['bitcoin', 'crypto', 'ethereum', 'blockchain', 'DeFi', 'memecoin', 'altcoin', 'ETH', 'SOL', 'BTC'], parent_area: 'markets', priority: 7 },
  'ai-tech': { label: 'AI & Technology', keywords: ['AI', 'artificial intelligence', 'machine learning', 'LLM', 'Nvidia', 'OpenAI', 'tech stocks', 'semiconductor'], parent_area: 'technology', priority: 8 },
  'us-market': { label: 'US Markets', keywords: ['S&P 500', 'Nasdaq', 'Dow Jones', 'Fed rate', 'FOMC', 'US inflation', 'US dollar', 'Treasury yield'], parent_area: 'markets', priority: 6 },
  'china': { label: 'China Economy', keywords: ['China', 'Shanghai', 'yuan', 'PBOC', 'Xi Jinping', 'tech war', 'China trade'], parent_area: 'macro', priority: 6 },
  'oil-energy': { label: 'Oil & Energy', keywords: ['crude oil', 'OPEC', 'energy crisis', 'renewable', 'solar', 'nuclear', 'LNG', 'WTI', 'brent'], parent_area: 'commodities', priority: 6 },
  'forex': { label: 'Forex', keywords: ['USD/IDR', 'EUR/USD', 'JPY', 'GBP', 'forex', 'exchange rate', 'central bank'], parent_area: 'markets', priority: 6 },
  'geopolitics': { label: 'Geopolitics', keywords: ['war', 'sanctions', 'tariff', 'trade war', 'NATO', 'Ukraine', 'Middle East', 'South China Sea'], parent_area: 'macro', priority: 5 },
  'indonesia-politics': { label: 'Indonesia Politics & Policy', keywords: ['pemilu', 'kabinet', 'DPR', 'APBN', 'IKN', 'nusantara', 'omnibus law', 'Makan Bergizi Gratis'], parent_area: 'indonesia', priority: 7 },
  'startup': { label: 'Startups & Unicorns', keywords: ['startup', 'unicorn', 'GoTo', 'Bukalapak', 'IPO', 'venture capital', 'funding'], parent_area: 'technology', priority: 5 },
  'global-macro': { label: 'Global Macro', keywords: ['recession', 'inflation', 'GDP', 'interest rate', 'global economy', 'trade war', 'supply chain', 'IMF', 'World Bank'], parent_area: 'macro', priority: 8 },
};

function loadTopics(path) {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    return Array.isArray(raw) ? raw : (raw.topics || []);
  } catch { return []; }
}

function saveTopics(path, topics) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  raw.topics = topics;
  writeFileSync(path, JSON.stringify(raw, null, 2));
}

function main() {
  let topics = loadTopics(TOPICS_FILE);
  const existingIds = new Set(topics.map(t => t.id));
  console.log(`[autodiscover] Existing: ${topics.length} topics`);

  let added = 0;
  for (const [id, tmpl] of Object.entries(TOPIC_TEMPLATES)) {
    if (existingIds.has(id)) continue;
    topics.push({
      id,
      name: tmpl.label,
      queries: tmpl.keywords.slice(0, 4).map(k => `${k} market outlook 2026`),
      assetTags: [id.replace('-', '').toUpperCase()],
      maxResults: 5,
      enabled: true,
      schedule: 'every 6h',
      _auto_added: true,
      _priority: tmpl.priority,
    });
    added++;
    console.log(`  + ${tmpl.label} (${id}) [${tmpl.parent_area}] prio:${tmpl.priority}`);
  }

  if (added > 0) {
    saveTopics(TOPICS_FILE, topics);
    console.log(`\n✅ ${added} new → ${TOPICS_FILE}`);
  } else {
    console.log(`\nNo new topics needed.`);
  }
  console.log(`\nTotal: ${topics.length} topics`);
  topics.forEach(t => console.log(`  ${t.id.padEnd(22)} ${t.name}`));
}

main();
