#!/usr/bin/env bash
# Start MCP servers for Market Orca
# Usage: ./start-mcp.sh [start|stop|status]

BACKEND_DIR="/home/dicky/.openclaw/workspace/market-orca/backend"
MCP_LOG="/tmp/mcp-http-server.log"
BRIDGE_LOG="/tmp/n8n-mcp-bridge.log"

start() {
  echo "Starting Market Orca MCP (port 1788)..."
  pkill -f "mcp-http-server.js" 2>/dev/null
  sleep 0.5
  cd "$BACKEND_DIR"
  nohup node src/mcp-http-server.js > "$MCP_LOG" 2>&1 &
  echo "  PID: $!"

  echo "Starting n8n MCP Bridge (port 1789)..."
  pkill -f "n8n-mcp-bridge.js" 2>/dev/null
  sleep 0.5
  cd "$BACKEND_DIR"
  nohup node src/n8n-mcp-bridge.js > "$BRIDGE_LOG" 2>&1 &
  echo "  PID: $!"

  sleep 2
  echo ""
  echo "Health checks:"
  curl -s http://localhost:1788/health && echo ""
  curl -s http://localhost:1789/health && echo ""
}

stop() {
  echo "Stopping MCP servers..."
  pkill -f "mcp-http-server.js" 2>/dev/null
  pkill -f "n8n-mcp-bridge.js" 2>/dev/null
  echo "Done."
}

status() {
  echo "MCP HTTP Server (1788):"
  curl -s http://localhost:1788/health 2>/dev/null || echo "  NOT RUNNING"
  echo ""
  echo "n8n MCP Bridge (1789):"
  curl -s http://localhost:1789/health 2>/dev/null || echo "  NOT RUNNING"
  echo ""
  echo "Processes:"
  ps aux | grep -E "mcp-http-server|n8n-mcp-bridge" | grep -v grep || echo "  None found."
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  restart) stop; sleep 1; start ;;
  status) status ;;
  *) echo "Usage: $0 {start|stop|restart|status}" ;;
esac
