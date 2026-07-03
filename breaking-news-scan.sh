#!/usr/bin/env bash
# Breaking News Scanner - price anomalies + fresh signals
set -euo pipefail

cd /home/dicky/.openclaw/workspace/market-orca
echo "=== Breaking News Scanner $(date) ==="
node backend/src/breaking-news-detector.js --scan 2>&1
echo "=== Done ==="