#!/bin/bash
# Bloop: fix "permission not granted" on macOS.
#
# macOS doesn't let any script *grant* Screen Recording or Automation (they live in a
# SIP-protected database). What we can do from the terminal is clear stale entries left by
# older/unsigned builds, then open the right panes so you can tick the box once, and relaunch.
#
# Usage: npm run perms            (built app, bundle id edu.bloop.app)
#        npm run perms -- --dev   (also resets "Electron", used by `npm run dev`)
set -e
if [[ "$(uname)" != "Darwin" ]]; then echo "macOS only."; exit 0; fi

IDS=("edu.bloop.app")
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
     click "Open Screen Recording settings" in its welcome screen, then come back.
  2. Then the Automation pane opens. Under Bloop, allow your browser (Chrome / Arc / Safari).
     If Bloop isn't listed there yet, it appears the first time Bloop asks: open a browser and
     click "Ask for browser access" in Bloop.
  3. Quit and reopen Bloop. macOS only re-reads Screen Recording on launch.
MSG
open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
read -r -p "Press Enter when done with Screen Recording to open Automation… " _
open "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation"
