# KANBAN.md — Market Orca Deployment Board

## ✅ DONE

### Deployment Infrastructure
- [x] `deploy.sh` — Unified deploy script (status/start/stop/restart/health/deploy/logs)
- [x] `Procfile` — Multi-process definition for all services
- [x] `health-dashboard.html` — Browser-based health check dashboard
- [x] Service registry: backend(:4567), report(:4568), mcp-proxy(:1788), docs(:4173), searxng(:18080), n8n(:5678), 9router(:9090), cloudflare-tunnel

### APM Features (all done)
- [x] Personalized Report Preferences UI
- [x] User Intent Memory Block integration
- [x] Report Send Queue + Retry
- [x] Alert Recommendation Engine
- [x] Report Comparison Mode UI
- [x] Executive Morning Brief Voice/Text
- [x] Incident Severity API
- [x] Recovery Status Tracker
- [x] Market Holiday / No-Data Edge Handler
- [x] Source Reliability Score Frontend Trust Badge
- [x] Smart Alert Threshold from Report Insight
- [x] Interactive Report Canvas (Backend)

---

## 🔄 IN PROGRESS

### Infrastructure Hardening
- [ ] Systemd service units for managed Node.js processes
- [ ] Auto-restart on crash (pm2 or systemd Restart=always)
- [ ] Log rotation config
- [ ] Centralized env management (envsubst / direnv)

---

## 📋 TODO (Backlog)

### Feature Backlog
- [ ] Catch-up Report Engine (Batch 1, #1)
- [ ] Discord Digest Mode improvements
- [ ] Market Impact Simulator v2
- [ ] Report health frontend status cards
- [ ] Prometheus/Grafana metrics endpoint
- [ ] Automated backup of SQLite DB

### DevOps
- [ ] Dockerfile for backend (production container)
- [ ] Docker Compose full stack (backend + frontend + searxng + tunnel)
- [ ] CI/CD pipeline (GitHub Actions)
- [ ] Health check alerts (webhook/Discord notification on down)

---

## 🔧 SERVICE MAP

| Service              | Port  | Manager      | Health URL                        | Domain                      |
|----------------------|-------|--------------|-----------------------------------|-----------------------------|
| Backend API          | 4567  | deploy.sh    | http://localhost:4567/api/health   | market-orca.anomali.web.id  |
| Report Frontend      | 4568  | deploy.sh    | http://localhost:4568/             | report.anomali.web.id       |
| MCP Proxy            | 1788  | deploy.sh    | http://localhost:1788/favicon.ico  | mcp.anomali.web.id          |
| SearXNG              | 18080 | Docker       | http://localhost:18080/            | searxng.anomali.web.id      |
| n8n                  | 5678  | External     | http://localhost:5678/             | n8n.anomali.web.id          |
| 9Router              | 9090  | External     | —                                 | —                           |
| VitePress Docs       | 4173  | deploy.sh    | http://localhost:4173/             | docs.anomali.web.id         |
| Cloudflare Tunnel    | —     | Docker       | docker ps → cloudflared-*         | *.anomali.web.id            |

---

## 📖 DEPLOYMENT GUIDE

### Quick Commands
```bash
cd /home/dicky/.openclaw/workspace/market-orca

./deploy.sh status    # Check all services
./deploy.sh health    # HTTP health checks
./deploy.sh start     # Start managed services
./deploy.sh stop      # Stop managed services
./deploy.sh restart   # Stop + start + health check
./deploy.sh deploy    # Full: git pull → build → restart
./deploy.sh logs backend  # Tail backend logs
```

### Full Deploy (git → build → restart)
```bash
./deploy.sh deploy
```
This runs: git pull → npm ci → frontend build → docs build → restart all → health check.

### Restart Individual Services
```bash
# Backend only
kill $(cat .pids/backend.pid) && cd backend && nohup node src/server.js > ../logs/backend.log 2>&1 & echo $! > ../.pids/backend.pid

# Report server only
kill $(cat .pids/report-server.pid) && cd backend && nohup node src/report-server.js > ../logs/report-server.log 2>&1 & echo $! > ../.pids/report-server.pid
```

### Docker Services
```bash
# SearXNG
docker compose -f docker-compose.searxng.yml up -d

# Cloudflare Tunnel
docker compose -f cloudflare-tunnel/docker-compose.yml up -d

# n8n (managed externally, port 5678)
```

### Health Dashboard
```bash
# Open in browser
xdg-open health-dashboard.html
# Or serve:
python3 -m http.server 8888 --directory . && xdg-open http://localhost:8888/health-dashboard.html
```
