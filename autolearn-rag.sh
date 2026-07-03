#!/usr/bin/env bash
# Autolearn RAG - priority topics only
set -euo pipefail

cd /home/dicky/.openclaw/workspace/market-orca
echo "=== Autolearn RAG Priority $(date) ==="
node scripts/autolearn-enhanced-v3.js --priority 2>&1
echo "=== Done ==="