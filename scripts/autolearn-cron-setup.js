#!/usr/bin/env node
/**
 * Autolearn Cron Setup — Summary
 */
const { readFileSync } = require('fs');
try {
  const topics = JSON.parse(readFileSync('collections/autolearn-topics.json', 'utf8'));
  console.log(`Topics configured: ${topics.length}`);
  console.log(`\n=== Cron Schedule ===`);
  console.log(`1. Topic Discovery: 0 */6 * * * → scripts/autodiscover.js`);
  console.log(`2. Autolearn: 0 */3 * * * → scripts/autolearn-enhanced.js`);
  console.log(`3. Daily RAG Report: 0 7 * * * → generate RAG-grounded report`);
  console.log(`\n=== Topics ===`);
  topics.forEach(t => console.log(`  - ${t.name} (${t.id})`));
} catch(e) { console.error('Error:', e.message); }
