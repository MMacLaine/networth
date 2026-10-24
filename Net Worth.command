#!/bin/bash
# Double click to open Net worth. If it runs in the background (scripts/background.sh)
# this just opens the page. Otherwise it starts it here; close this window to stop it.

cd "$(dirname "$0")"
PORT=4747
URL="http://localhost:$PORT"
ping() { curl -s -o /dev/null "$URL/api/ping"; }

if ping; then open "$URL"; exit 0; fi

if [ -f "$HOME/Library/LaunchAgents/com.nw1.server.plist" ]; then
  launchctl kickstart -k "gui/$(id -u)/com.nw1.server"
  for _ in 1 2 3 4 5 6 7 8 9 10; do ping && break; sleep 0.3; done
  open "$URL"; exit 0
fi

NODE="$(command -v node || echo /opt/homebrew/bin/node)"
if [ ! -x "$NODE" ]; then
  echo "Node is not installed. Install it with: brew install node"
  read -r -p "Press return to close."
  exit 1
fi
"$NODE" server.mjs &
SERVER=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do ping && break; sleep 0.3; done
open "$URL"
wait $SERVER
