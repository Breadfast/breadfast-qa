#!/bin/bash
# Double-click launcher for the Card User Creation & Activation sandbox.
# Starts the local server only if it isn't already running, then opens the page in your browser.
# Works whether this file sits in the repo or is copied to the Desktop.

PORT="${PORT:-4100}"
URL="http://localhost:$PORT"

# 1. Find the repo: use this script's folder if it holds the server, else the known checkout path.
SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$SELF_DIR/server.js" ]; then
  REPO="$(cd "$SELF_DIR/../.." && pwd)"
elif [ -f "$SELF_DIR/automation/card-sandbox/server.js" ]; then
  REPO="$SELF_DIR"
else
  REPO="/Users/Breadfast1/breadfast-qa"
fi
SERVER="$REPO/automation/card-sandbox/server.js"

# 2. Find node (double-clicked .command has a minimal PATH; cover nvm/homebrew/system).
NODE="$(command -v node)"
for c in "$HOME/.nvm/versions/node"/*/bin/node /opt/homebrew/bin/node /usr/local/bin/node; do
  [ -z "$NODE" ] && [ -x "$c" ] && NODE="$c"
done
if [ -z "$NODE" ]; then
  echo "Could not find node. Open Terminal and run: npm run card-sandbox"; sleep 5; exit 1
fi

# 3. Start the server only if nothing is already listening on the port.
if ! curl -s -o /dev/null "http://localhost:$PORT/"; then
  if [ ! -f "$SERVER" ]; then
    echo "Sandbox not found at $SERVER — edit REPO in this launcher."; sleep 5; exit 1
  fi
  echo "Starting the Card Sandbox…"
  OPEN=0 PORT="$PORT" nohup "$NODE" "$SERVER" >"$REPO/automation/card-sandbox/server.log" 2>&1 &
  for i in $(seq 1 25); do
    curl -s -o /dev/null "http://localhost:$PORT/" && break
    sleep 0.3
  done
fi

# 4. Open the page and leave the server running in the background.
open "$URL"
echo "Card Sandbox is open at $URL — you can close this window."
sleep 1
