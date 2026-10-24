#!/bin/bash
# Run Net worth quietly in the background, started at login and restarted if it stops.
#   scripts/background.sh install    switch it on
#   scripts/background.sh remove     switch it off (then use Net Worth.command as before)

LABEL=com.nw1.server
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE=""
for p in /opt/homebrew/bin/node /usr/local/bin/node "$(command -v node)"; do [ -x "$p" ] && NODE="$p" && break; done
UIDN=$(id -u)

case "$1" in
  install)
    [ -z "$NODE" ] && echo "Node not found. Install it with: brew install node" && exit 1
    mkdir -p "$DIR/data" "$HOME/Library/LaunchAgents"
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$NODE</string><string>$DIR/server.mjs</string></array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$DIR/data/server.log</string>
  <key>StandardErrorPath</key><string>$DIR/data/server.log</string>
</dict>
</plist>
EOF
    launchctl bootout "gui/$UIDN/$LABEL" 2>/dev/null
    launchctl bootstrap "gui/$UIDN" "$PLIST" && echo "Net worth now runs in the background at http://localhost:4747"
    ;;
  remove)
    launchctl bootout "gui/$UIDN/$LABEL" 2>/dev/null
    rm -f "$PLIST"
    echo "Background running switched off."
    ;;
  *) echo "Usage: $0 install | remove"; exit 1 ;;
esac
