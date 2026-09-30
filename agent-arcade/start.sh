#!/usr/bin/env bash
# Agent Arcade launcher for macOS/Linux: ./start.sh
# Installs dependencies the first time, starts server + client, opens the app.
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Node.js is not installed: https://nodejs.org"; exit 1; }
[ -d node_modules ] || npm install
( sleep 5; (command -v open >/dev/null && open http://127.0.0.1:5173) || xdg-open http://127.0.0.1:5173 ) &
npm run dev
