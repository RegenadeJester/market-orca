#!/usr/bin/env bash
set -euo pipefail

DATE=$(date +%Y-%m-%d)
CDIR="/home/dicky/.openclaw/workspace/market-orca"
LOG="$CDIR/MMd.md"

cd "$CDIR"

# Git sync
git checkout main
git pull origin main 2>/dev/null || true

# Detect 5 improvement areas from current state
echo "=== MMd: $DATE ===" >> "$LOG"

# Run improvements via sub-agent (main session handles this)
# This script is a trigger — the actual work runs via OpenClaw cron
echo "Triggered at $(date)" >> /tmp/mmd-run-$DATE.log
