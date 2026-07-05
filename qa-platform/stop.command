#!/bin/bash
# macOS/Linux double-click stop — clears listeners on the API + web ports.
# (Windows: use "Stop QA Platform.cmd" or `npm run stop`.)
cd "$(dirname "$0")"
node launcher/stop.mjs
