#!/usr/bin/env bash
# CEO Daily Report - Market Orca ecosystem oversight
set -euo pipefail

cd /home/dicky/.openclaw/workspace/market-orca
echo "=== CEO Daily Report $(date) ==="

# Run professional report
node backend/src/report-professional.js

# Check system health
curl -s http://localhost:4567/api/health | jq .

# Check autolearn metrics
node scripts/autolearn-enhanced-v3.js --metrics

echo "=== CEO Daily Report Complete ==="