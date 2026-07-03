#!/usr/bin/env bash
# Autolearn Topic Discovery - scan trending topics
set -euo pipefail

cd /home/dicky/.openclaw/workspace/market-orca
echo "=== Autolearn Topic Discovery $(date) ==="
node scripts/autodiscover.js 2>&1
echo "=== Done ==="