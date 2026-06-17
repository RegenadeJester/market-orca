#!/usr/bin/env bash
# =============================================================================
# deploy.sh — Market Orca Multi-Agent Deployment System
# Usage: ./deploy.sh [command]
#   Commands: status, start, stop, restart, health, deploy, logs
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
DOCS_DIR="$SCRIPT_DIR/docs"
PID_DIR="$SCRIPT_DIR/.pids"
LOG_DIR="$SCRIPT_DIR/logs"
ENV_FILE="$SCRIPT_DIR/.env"

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

mkdir -p "$PID_DIR" "$LOG_DIR"

# ── Service Definitions ──────────────────────────────────────────────────────
# name|port|workdir|command|pid_pattern
SERVICES=(
  "backend|4567|$BACKEND_DIR|node src/server.js|src/server.js"
  "report-server|4568|$BACKEND_DIR|node src/report-server.js|src/report-server.js"
  "mcp-proxy|1788|$BACKEND_DIR|node src/mcp-proxy.js|mcp-proxy.js"
  "docs|4173|$DOCS_DIR|npx vitepress preview --port 4173 --host 0.0.0.0|vitepress"
)
DOCKER_SERVICES=(
  "searxng|18080|market-orca-searxng|docker-compose.searxng.yml"
  "cloudflare-tunnel||cloudflared-market-orca-mcp|cloudflare-tunnel/docker-compose.yml"
)

# ── Helpers ──────────────────────────────────────────────────────────────────
log()   { echo -e "${CYAN}[$(date +%H:%M:%S)]${NC} $*"; }
ok()    { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
fail()  { echo -e "${RED}✗${NC} $*"; }

get_pid() {
  local name="$1"
  local pidfile="$PID_DIR/$name.pid"
  if [[ -f "$pidfile" ]]; then
    local pid
    pid=$(cat "$pidfile")
    if kill -0 "$pid" 2>/dev/null; then
      echo "$pid"
      return 0
    fi
    rm -f "$pidfile"
  fi
  return 1
}

check_port() {
  local port="$1"
  ss -tlnp 2>/dev/null | grep -q ":${port} " && return 0 || return 1
}

health_check() {
  local port="$1"
  local timeout="${2:-3}"
  curl -sf -o /dev/null -m "$timeout" "http://127.0.0.1:${port}/" 2>/dev/null && return 0 || return 1
}

# ── Commands ─────────────────────────────────────────────────────────────────

cmd_status() {
  echo ""
  echo -e "${CYAN}═══ Market Orca Service Status ═══${NC}"
  echo ""

  for svc_def in "${SERVICES[@]}"; do
    IFS='|' read -r name port _dir _cmd _pat <<< "$svc_def"
    local pid
    if pid=$(get_pid "$name"); then
      if check_port "$port" 2>/dev/null; then
        ok "$name (:$port) — PID $pid — running"
      else
        warn "$name (:$port) — PID $pid — port not bound"
      fi
    elif check_port "$port" 2>/dev/null; then
      local rp
      rp=$(ss -tlnp 2>/dev/null | grep ":${port} " | head -1 | grep -oP 'pid=\K[0-9]+' || echo "?")
      warn "$name (:$port) — running (PID $rp) — not managed"
    else
      fail "$name (:$port) — stopped"
    fi
  done

  echo ""
  echo -e "${CYAN}── Docker Services ──${NC}"
  for dsvc in "${DOCKER_SERVICES[@]}"; do
    IFS='|' read -r dname dport dcontainer dcompose <<< "$dsvc"
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${dcontainer}$"; then
      ok "$dname ($dcontainer) — running"
    else
      fail "$dname ($dcontainer) — stopped"
    fi
  done

  echo ""
  echo -e "${CYAN}── External (not managed) ──${NC}"
  check_port 5678 2>/dev/null && ok "n8n (:5678) — running" || warn "n8n (:5678) — not running"
  check_port 9090 2>/dev/null && ok "9Router (:9090) — running" || warn "9Router (:9090) — not running"
  echo ""
}

cmd_health() {
  echo ""
  echo -e "${CYAN}═══ Health Checks ═══${NC}"
  echo ""
  local all_ok=true

  local checks=("backend:4567:/api/health" "report-server:4568:/" "mcp-proxy:1788:/favicon.ico" "docs:4173:/")
  for check in "${checks[@]}"; do
    IFS=':' read -r name port path <<< "$check"
    local url="http://127.0.0.1:${port}${path}"
    if curl -sf -o /dev/null -m 5 "$url" 2>/dev/null; then
      ok "$name (:$port) — healthy"
    else
      fail "$name (:$port) — unhealthy"
      all_ok=false
    fi
  done

  # Docker checks
  local dchecks=("searxng:18080:/" "cloudflare-tunnel:none:none")
  for check in "${dchecks[@]}"; do
    IFS=':' read -r name port path <<< "$check"
    [[ "$path" == "none" ]] && continue
    if curl -sf -o /dev/null -m 5 "http://127.0.0.1:${port}${path}" 2>/dev/null; then
      ok "$name (:$port) — healthy"
    else
      fail "$name (:$port) — unhealthy"
      all_ok=false
    fi
  done

  echo ""
  $all_ok && ok "All services healthy" || fail "Some services unhealthy"
  echo ""
}

cmd_start() {
  log "Starting managed services..."

  # Load env if present
  [[ -f "$ENV_FILE" ]] && set -a && source "$ENV_FILE" && set +a

  for svc_def in "${SERVICES[@]}"; do
    IFS='|' read -r name port dir cmd pat <<< "$svc_def"
    if get_pid "$name" >/dev/null 2>&1; then
      warn "$name already running"
      continue
    fi
    log "Starting $name on :$port..."
    cd "$dir"
    nohup $cmd > "$LOG_DIR/$name.log" 2>&1 &
    echo $! > "$PID_DIR/$name.pid"
    sleep 1
    if check_port "$port" 2>/dev/null; then
      ok "$name started (PID $(cat "$PID_DIR/$name.pid"))"
    else
      warn "$name starting... (may take a moment)"
    fi
  done

  # Docker services
  for dsvc in "${DOCKER_SERVICES[@]}"; do
    IFS='|' read -r dname dport dcontainer dcompose <<< "$dsvc"
    local full_path="$SCRIPT_DIR/$dcompose"
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${dcontainer}$"; then
      warn "$dname already running"
    elif [[ -f "$full_path" ]]; then
      log "Starting $dname..."
      docker compose -f "$full_path" up -d 2>/dev/null && ok "$dname started" || warn "$dname failed"
    else
      warn "$dname compose file not found: $full_path"
    fi
  done

  echo ""
}

cmd_stop() {
  log "Stopping managed services..."

  for svc_def in "${SERVICES[@]}"; do
    IFS='|' read -r name _port _dir _cmd _pat <<< "$svc_def"
    if pid=$(get_pid "$name"); then
      log "Stopping $name (PID $pid)..."
      kill "$pid" 2>/dev/null
      sleep 1
      kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null
      rm -f "$PID_DIR/$name.pid"
      ok "$name stopped"
    else
      warn "$name not running"
    fi
  done

  echo ""
  ok "All managed services stopped"
  echo ""
}

cmd_restart() {
  cmd_stop
  sleep 2
  cmd_start
  sleep 3
  cmd_health
}

cmd_deploy() {
  echo ""
  echo -e "${CYAN}═══ Deploy: Pull → Build → Restart ═══${NC}"
  echo ""

  # 1. Git pull
  log "Step 1/5: Git pull..."
  cd "$SCRIPT_DIR"
  if git remote -v 2>/dev/null | grep -q origin; then
    git pull --ff-only 2>&1 | tail -3
    ok "Git updated"
  else
    warn "No remote — skipping git pull"
  fi

  # 2. Install backend deps
  log "Step 2/5: Backend dependencies..."
  cd "$BACKEND_DIR"
  if [[ -f package-lock.json ]]; then
    npm ci --omit=dev 2>&1 | tail -3
    ok "Backend deps installed"
  else
    npm install --omit=dev 2>&1 | tail -3
    ok "Backend deps installed"
  fi

  # 3. Build frontend
  log "Step 3/5: Build frontend..."
  cd "$FRONTEND_DIR"
  npm install 2>&1 | tail -2
  npm run build 2>&1 | tail -3
  ok "Frontend built"

  # 4. Build docs
  log "Step 4/5: Build docs..."
  cd "$DOCS_DIR"
  if [[ -f package.json ]]; then
    npm install 2>&1 | tail -2
    npm run build 2>&1 | tail -3 || warn "Docs build skipped/failed"
    ok "Docs built"
  fi

  # 5. Restart services
  log "Step 5/5: Restart services..."
  cmd_restart

  echo ""
  log "Deployment complete!"
  cmd_status
}

cmd_logs() {
  local svc="${1:-}"
  if [[ -n "$svc" ]]; then
    tail -f "$LOG_DIR/$svc.log" 2>/dev/null || warn "No log for $svc"
  else
    echo "Available logs:"
    ls -la "$LOG_DIR"/*.log 2>/dev/null || echo "  (none)"
    echo ""
    echo "Usage: $0 logs <service>"
    echo "Services: backend, report-server, mcp-proxy, docs"
  fi
}

# ── Main ─────────────────────────────────────────────────────────────────────
CMD="${1:-status}"
case "$CMD" in
  status)   cmd_status ;;
  health)   cmd_health ;;
  start)    cmd_start ;;
  stop)     cmd_stop ;;
  restart)  cmd_restart ;;
  deploy)   cmd_deploy ;;
  logs)     cmd_logs "${2:-}" ;;
  *)
    echo "Usage: $0 {status|health|start|stop|restart|deploy|logs [service]}"
    exit 1
    ;;
esac
