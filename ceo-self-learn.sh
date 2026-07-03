#!/usr/bin/env bash
# CEO Self-Learn - all divisions overview
set -euo pipefail

cd /home/dicky/.openclaw/workspace/market-orca
echo "=== CEO Self-Learn $(date) ==="

echo "--- System Health ---"
curl -s http://localhost:4567/api/health 2>&1 | jq . || echo "Backend not running"

echo "--- Autolearn Metrics ---"
node scripts/autolearn-enhanced-v3.js --metrics 2>&1

echo "--- Breaking News ---"
node backend/src/breaking-news-detector.js --scan 2>&1 || echo "Breaking detector failed"

echo "=== CEO Self-Learn Complete ==="