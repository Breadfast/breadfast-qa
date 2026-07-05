#!/bin/bash
# macOS/Linux double-click launcher — starts api + worker + web and opens the app.
# (Windows: use "Breadfast QA Platform.cmd" or `npm start`.)
cd "$(dirname "$0")"
node launcher/launch.mjs
