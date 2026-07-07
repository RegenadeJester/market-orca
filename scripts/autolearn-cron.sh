#!/usr/bin/env bash
# Autolearn Enhanced v3 - Priority RAG Ingestion (Every 4h)
set -euo pipefail

cd /home/dicky/.openclaw/workspace/market-orca
echo "=== Autolearn Enhanced v3 $(date) ==="

# --- Precondition Guard ---
FAILED=0
for endpoint in "http://localhost:4567/mcp/health" "http://localhost:18080/search?q=test&format=json"; do
  if ! curl -sf "$endpoint" > /dev/null 2>&1; then
    echo "[WARN] $endpoint unreachable"
    FAILED=1
  fi
done
if [ "$FAILED" -eq 1 ]; then
  echo "[SKIP] $(date) — dependencies down (MCP or SearXNG), aborting"
  exit 1
fi
# --- End Guard ---

node scripts/autolearn-enhanced-v3.js 2>&1
echo "=== Done $(date) ==="
