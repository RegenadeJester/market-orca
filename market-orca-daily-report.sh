#!/usr/bin/env bash
# Market Orca Daily Report — runs professional report + AI daily report
set -euo pipefail
cd /home/dicky/.openclaw/workspace/market-orca

echo "=== Market Orca Daily Report $(date) ==="

echo "Generating professional report..."
node backend/src/report-professional.js 2>&1 | tee -a reports/daily-report.log

echo "Generating AI daily report..."
node -e "
import { generateAiDailyReport } from './backend/src/ai-daily-report.js';
import { initDiscordBot } from './backend/src/discord.js';
const bot = initDiscordBot();
if (bot) {
  const { reportText, reportHtml, embed } = await generateAiDailyReport({ days: 1 });
  console.log('AI Daily Report generated');
  console.log(reportText.slice(0, 500));
} else {
  console.log('Discord bot not initialized, skipping AI daily report');
}
" 2>&1 | tee -a reports/daily-report.log

echo "=== Done $(date) ==="
