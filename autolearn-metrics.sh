#!/usr/bin/env bash
# Autolearn Daily Metrics Report
set -euo pipefail

cd /home/dicky/.openclaw/workspace/market-orca
echo "=== Autolearn Daily Metrics $(date) ==="
node scripts/autolearn-enhanced-v3.js --metrics 2>&1
echo "=== Done ==="