#!/bin/bash
pkill -f "cloudflared tunnel" 2>/dev/null
sleep 1
nohup cloudflared tunnel --config /home/dicky/.openclaw/workspace/market-orca/config.yml run > /tmp/cf.log 2>&1 &
echo "cloudflared PID: $!"
