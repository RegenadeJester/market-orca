#!/bin/bash
pkill -f "cloudflared tunnel" 2>/dev/null
sleep 1
nohup cloudflared tunnel --config /home/dicky/.openclaw/workspace/market-orca/config.yml --dns-server 1.1.1.1 --dns-server 8.8.8.8 run > /tmp/cf.log 2>&1 &
echo "cloudflared PID: $!"
