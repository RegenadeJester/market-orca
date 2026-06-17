# Procfile — Market Orca Multi-Process Definition
# Use with: deploy.sh, systemd, supervisor, pm2, or manual
# Format: process_name: command
# ─────────────────────────────────────────────────────────────────────────────

# ── Core Services ────────────────────────────────────────────────────────────
backend:      cd backend && node src/server.js
report:       cd backend && node src/report-server.js
mcp-proxy:    cd backend && node src/mcp-proxy.js
docs:         cd docs && npx vitepress preview --port 4173 --host 0.0.0.0

# ── Docker Services (managed via deploy.sh) ──────────────────────────────────
# searxng:    docker compose -f docker-compose.searxng.yml up
# tunnel:     docker compose -f cloudflare-tunnel/docker-compose.yml up
# n8n:        (external — manages itself on port 5678)
# 9router:    (external — manages itself on port 9090)
