#!/bin/bash
# CI only: end-to-end check of the built Bloop.app on a real macOS (GitHub Actions) runner.
#   A  launch without permissions, check what Bloop reports
#   A2 grant Screen Recording + Automation in TCC.db while A is still running (the user's
#      "I granted it but it still says not granted" scenario) and see what the running app reports
#   B  relaunch with the grants and drive real apps: TextEdit, Terminal, Safari (YouTube, Wikipedia)
# Writes logs, screenshots and summary.md to OUT. Exits non-zero if an assertion failed.
#
# Usage: scripts/ci/mac-e2e.sh /path/to/Bloop.app OUTDIR
set -u
APP="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
OUT="$2"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
HERE="$(cd "$(dirname "$0")" && pwd)"
BIN="$APP/Contents/MacOS/Bloop"
BID=$(defaults read "$APP/Contents/Info.plist" CFBundleIdentifier)
SUMMARY="$OUT/summary.md"
FAILS=0
: >"$SUMMARY"

say() { echo "$*" | tee -a "$SUMMARY"; }
pass() { say "- PASS: $*"; }
fail() {
  say "- **FAIL**: $*"
  FAILS=$((FAILS + 1))
}
check() { # description, command...
  local d="$1"
  shift
  if "$@"; then pass "$d"; else fail "$d"; fi
}
tmo() { # seconds cmd... (macOS has no `timeout`)
  perl -e 'alarm shift; exec @ARGV' "$@"
}
shot() {
  if tmo 20 screencapture -x "$OUT/$1.png"; then echo "screenshot: $1.png"; else echo "screencapture failed: $1"; fi
}
frontmost() {
  tmo 10 osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true' 2>&1
}
activate() {
  tmo 15 osascript -e "tell application \"$1\" to activate" >/dev/null 2>&1 || open -a "$1"
  sleep 2
  say "  frontmost after activating $1: $(frontmost)"
}
# lines of $1 after line $2
since() { tail -n +"$(($2 + 1))" "$1"; }
lines() { wc -l <"$1" | tr -d ' '; }

LAUNCH_MODE=""
launch() { # name -> sets LOG
  LOG="$OUT/$1.stdout.txt"
  : >"$LOG"
  : >"$OUT/$1.stderr.txt"
  # LaunchServices-launched apps get their env from launchd; `open` makes Bloop its own
  # "responsible process" for TCC (a binary started from this shell would inherit the runner's grants).
  launchctl setenv BLOOP_FAST 1
  launchctl setenv BLOOP_AUTOSTART 1
  launchctl setenv BLOOP_TRACE 1
  launchctl unsetenv BLOOP_FAKE_ACTIVE
  if open -n -g --stdout "$LOG" --stderr "$OUT/$1.stderr.txt" "$APP" 2>"$OUT/$1.open-error.txt"; then
    LAUNCH_MODE="open (LaunchServices)"
  else
    say "  \`open\` failed ($(cat "$OUT/$1.open-error.txt")), starting the binary directly"
    BLOOP_FAST=1 BLOOP_AUTOSTART=1 BLOOP_TRACE=1 "$BIN" >"$LOG" 2>"$OUT/$1.stderr.txt" &
    LAUNCH_MODE="direct exec"
  fi
  for _ in $(seq 1 40); do
    grep -q '\[bloop\] permissions:' "$LOG" && break
    sleep 1
  done
  say "  launched $1 via $LAUNCH_MODE, pid(s): $(pgrep -x Bloop | tr '\n' ' ')"
}
quit_bloop() {
  pkill -x Bloop 2>/dev/null
  for _ in $(seq 1 15); do
    pgrep -x Bloop >/dev/null || return 0
    sleep 1
  done
  pkill -9 -x Bloop 2>/dev/null
  sleep 1
}
perm_line() { grep -m1 '\[bloop\] permissions:' "$1"; }
last_refresh() { grep '\[bloop\] permissions(refresh):' "$1" | tail -1; }

say "# Bloop macOS e2e ($(sw_vers -productName) $(sw_vers -productVersion), $(uname -m), runner ${RUNNER_NAME:-local})"
say ""
say "App: \`$APP\` (bundle id $BID)"

# Fresh start: no stale grants, no stored settings. Long focus phase so the pomodoro break
# doesn't interrupt the app switching (BLOOP_FAST turns focusMinutes into seconds).
tccutil reset ScreenCapture "$BID" >/dev/null 2>&1 || true
tccutil reset AppleEvents "$BID" >/dev/null 2>&1 || true
USERDATA="$HOME/Library/Application Support/Bloop"
rm -rf "$USERDATA" "$HOME/Library/Application Support/bloop"
mkdir -p "$USERDATA"
echo '{"settings":{"focusMinutes":400}}' >"$USERDATA/bloop.json"
quit_bloop

# ------------------------------------------------------------------ A: not granted
say ""
say "## A: launch without permissions"
shot "00-desktop-before"
launch A
sleep 15
shot "A1-not-granted"
say "  \`$(perm_line "$LOG")\`"
say "  last refresh: \`$(last_refresh "$LOG")\`"
check "A: app started and logged its permission state" grep -q '\[bloop\] permissions:' "$LOG"
check "A: Screen Recording is NOT reported granted before the grant" bash -c "! grep -q 'permissions: screen=granted' '$LOG'"
check "A: session auto-started" grep -q '\[bloop\] session start' "$LOG"
check "A: real active-window samples are being taken" grep -q '\[bloop\] sample app=' "$LOG"
say "  sample lines (last 3):"
grep '\[bloop\] sample app=' "$LOG" | tail -3 | sed 's/^/      /' | tee -a "$SUMMARY" >/dev/null

# ------------------------------------------------------------------ A2: grant while running
say ""
say "## A2: grant in TCC.db while Bloop is still running (no relaunch)"
"$HERE/mac-tcc-grant.sh" "$APP" "$OUT" >"$OUT/tcc-grant.txt" 2>&1
sed 's/^/      /' "$OUT/tcc-grant.txt" | tail -25 | tee -a "$SUMMARY" >/dev/null
MARK=$(lines "$LOG")
open -a Safari "https://en.wikipedia.org/wiki/Study_skills"
sleep 8
activate Safari
sleep 12
shot "A2-granted-while-running"
say "  refresh after grant: \`$(since "$LOG" "$MARK" | grep '\[bloop\] permissions(refresh):' | tail -1)\`"
since "$LOG" "$MARK" | grep -E '\[bloop\] (automation permission|trace raw)' | tail -4 | sed 's/^/      /' | tee -a "$SUMMARY" >/dev/null
check "A2: running app picks up the Automation grant without relaunch" bash -c "tail -n +$((MARK + 1)) '$LOG' | grep -q 'automation=granted'"
if since "$LOG" "$MARK" | grep '\[bloop\] permissions(refresh):' | tail -1 | grep -q 'screen=granted'; then
  say "  observation: Screen Recording WAS picked up without relaunch"
else
  say "  observation: Screen Recording still not granted in the running process (macOS caches it per process; needs relaunch)"
fi
quit_bloop

# ------------------------------------------------------------------ B: granted, real apps
say ""
say "## B: relaunch with permissions granted, drive real apps"
launch B
sleep 8
say "  \`$(perm_line "$LOG")\`"
check "B: Screen Recording reported granted after relaunch" grep -q 'permissions: screen=granted' "$LOG"
check "B: session auto-started" grep -q '\[bloop\] session start' "$LOG"

stage() { # name app-to-activate seconds [open args...]
  local name="$1" appname="$2" secs="$3"
  shift 3
  say ""
  say "### $name"
  MARK=$(lines "$LOG")
  if [[ $# -gt 0 ]]; then open "$@"; fi
  sleep 3
  activate "$appname"
  sleep "$secs"
  STAGE_LOG="$OUT/B-$name.slice.txt"
  since "$LOG" "$MARK" >"$STAGE_LOG"
  grep -E '\[bloop\] (sample|mood|nudge|pet says|automation permission)' "$STAGE_LOG" | tail -6 | sed 's/^/      /' | tee -a "$SUMMARY" >/dev/null
  shot "B-$name"
}
score_of_last() { grep "$1" "$STAGE_LOG" | tail -1 | sed -n 's/.*score=\([0-9.a-z]*\).*/\1/p'; }

stage 1-textedit TextEdit 12 -a TextEdit
check "TextEdit sampled as neutral" grep -q 'sample app="TextEdit" category=neutral' "$STAGE_LOG"

stage 2-terminal Terminal 12 -a Terminal
check "Terminal sampled as focus" grep -q 'sample app="Terminal" category=focus' "$STAGE_LOG"
S_TERM=$(score_of_last 'app="Terminal"')
say "  score on Terminal: $S_TERM"
check "score is 100 after only focus time" test "$S_TERM" = "100"

stage 3-youtube Safari 16 -a Safari "https://www.youtube.com"
check "Safari on YouTube sampled as distract (URL via AppleScript)" grep -qE 'sample app="Safari" domain=[a-z.]*youtube\.com category=distract' "$STAGE_LOG"
check "pet turned worried after the nudge threshold" grep -qE 'mood [a-z]+ -> worried' "$STAGE_LOG"
check "nudge fired" grep -q '\[bloop\] nudge (distracted' "$STAGE_LOG"
S_YT=$(score_of_last 'category=distract')
say "  score after YouTube: $S_YT"
check "score dropped below 100 on YouTube" bash -c "[[ '$S_YT' =~ ^[0-9.]+$ ]] && awk 'BEGIN{exit !($S_YT < 100)}'"

stage 4-wikipedia Safari 12 -a Safari "https://en.wikipedia.org/wiki/Pomodoro_Technique"
check "Safari on Wikipedia sampled as focus" grep -qE 'sample app="Safari" domain=[a-z.]*wikipedia\.org category=focus' "$STAGE_LOG"
check "pet happy again after coming back" grep -qE 'mood [a-z]+ -> happy|pet says' "$STAGE_LOG"
S_WIKI=$(score_of_last 'category=focus')
say "  score after Wikipedia: $S_WIKI"
check "score recovered on Wikipedia" bash -c "[[ '$S_WIKI' =~ ^[0-9.]+$ ]] && awk 'BEGIN{exit !($S_WIKI > $S_YT)}'"

say ""
say "### permissions as seen by the running app (B)"
say "  \`$(last_refresh "$LOG")\`"
check "B: Automation reported granted" grep -qE 'automation=granted|automation permission -> granted' "$LOG"
check "B: window titles readable (Screen Recording effective)" grep -qE 'trace raw: .*titleLen=[1-9]' "$LOG"
quit_bloop

say ""
say "## Result: $FAILS failed assertion(s)"
exit $((FAILS > 0 ? 1 : 0))
