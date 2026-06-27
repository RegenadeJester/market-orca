#!/usr/bin/env bash
# install-systemd.sh — Install Market Orca report-server systemd service
set -euo pipefail

SERVICE_SRC="$(cd "$(dirname "$0")" && pwd)/report-server.service"

if [[ ! -f "$SERVICE_SRC" ]]; then
  echo "FATAL: report-server.service not found at $SERVICE_SRC"
  exit 1
fi

echo "→ Installing report-server systemd service..."
sudo cp "$SERVICE_SRC" /etc/systemd/system/market-orca-report-server.service
sudo chmod 644 /etc/systemd/system/market-orca-report-server.service
sudo systemctl daemon-reload
sudo systemctl enable market-orca-report-server.service

echo "✓ Service installed and enabled."
echo ""
echo "  Start now:  sudo systemctl start market-orca-report-server"
echo "  Status:     sudo systemctl status market-orca-report-server"
echo "  Logs:       journalctl -u market-orca-report-server -f"
echo ""
echo "  ⚠  Stop the existing process first: kill $(pgrep -f 'report-server.js')"
