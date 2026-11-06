#!/bin/bash
# Bloop: fix "permission not granted" on macOS.
#
# The same fix is in the app: Settings > Permissions > Reset permissions…, then Relaunch Bloop.
# This is the terminal alternative.
#
# macOS doesn't let any script *grant* Screen Recording or Automation (they live in a
# SIP-protected database). What we can do from the terminal is clear stale entries left by
# older/unsigned builds, then open the right panes so you can tick the box once, and relaunch.
#
# Usage: npm run perms            (built app, bundle id = package.json build.appId)
#        npm run perms -- --dev   (also resets "Electron", used by `npm run dev`)
set -e
if [[ "$(uname)" != "Darwin" ]]; then echo "macOS only."; exit 0; fi

APP_ID="io.github.bndrwe.bloop" # = package.json build.appId and src/shared/appId.ts
IDS=("$APP_ID")
[[ "$1" == "--dev" ]] && IDS+=("com.github.Electron")

for id in "${IDS[@]}"; do
  echo "Resetting Screen Recording + Automation for $id"
  tccutil reset ScreenCapture "$id" >/dev/null 2>&1 || true
  tccutil reset AppleEvents "$id" >/dev/null 2>&1 || true
done

pkill -x Bloop >/dev/null 2>&1 || true

cat <<'MSG'

Next:
  1. Screen Recording pane opens now. Turn ON "Bloop" (or, for `npm run dev`, the terminal
     app you ran it from: Terminal / iTerm / VS Code). If Bloop isn't listed, open Bloop once,
     click "Open Screen Recording settings" in Settings > Permissions, then come back.
  2. Then the Automation pane opens. Under Bloop, allow your browser (Chrome / Arc / Safari).
     If Bloop isn't listed there yet, it appears the first time Bloop asks: open a browser and
     click "Ask for browser access" in Settings > Permissions.
  3. Quit and reopen Bloop. macOS only re-reads Screen Recording on launch.
MSG
open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
read -r -p "Press Enter when done with Screen Recording to open Automation… " _
open "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation"
