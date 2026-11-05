#!/usr/bin/env bash
# Bloop: remove the app that scripts/install.sh installed (macOS and Linux).
#
#   ./scripts/uninstall.sh              remove the app, then ask about your data
#   ./scripts/uninstall.sh --keep-data  remove the app, keep settings/history/model
#   ./scripts/uninstall.sh --purge      remove the app and all data without asking
set -euo pipefail

APP_ID="edu.bloop.app"

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  B=$'\033[1m'; GRN=$'\033[32m'; YLW=$'\033[33m'; RED=$'\033[31m'; RST=$'\033[0m'
else
  B=''; GRN=''; YLW=''; RED=''; RST=''
fi
ok()   { printf '  %s✓%s %s\n' "$GRN" "$RST" "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '  %s!%s %s\n' "$YLW" "$RST" "$*" >&2; }
die()  { printf '%sError:%s %s\n' "$RED" "$RST" "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }
confirm() {
  local reply=''
  [[ -t 0 ]] || return 1
  read -r -p "  $1 [y/N] " reply || return 1
  [[ "$reply" =~ ^[Yy]([Ee][Ss])?$ ]]
}
remove() {
  local p
  for p in "$@"; do
    if [[ -e "$p" || -L "$p" ]]; then rm -rf "$p" && ok "removed $p"; fi
  done
  return 0
}
size_of() { du -sh "$1" 2>/dev/null | awk '{print $1}'; }

usage() {
  cat <<'EOF'
Remove Bloop (installed by scripts/install.sh) from this computer.

Usage: ./scripts/uninstall.sh [--keep-data | --purge]

  --keep-data   keep your settings, history, logs and downloaded AI model
  --purge       also delete all of that, without asking
  -h, --help    show this help

Without either flag it asks before deleting your data (and keeps it if it can't ask).
EOF
}

# ------------------------------------------------------------------ macOS

uninstall_mac() {
  if pgrep -x Bloop >/dev/null 2>&1; then
    info "Quitting Bloop…"
    osascript -e "tell application id \"$APP_ID\" to quit" >/dev/null 2>&1 || true
    local i
    for i in 1 2 3 4 5 6 7 8 9 10; do pgrep -x Bloop >/dev/null 2>&1 || break; sleep 0.5; done
    pkill -x Bloop >/dev/null 2>&1 || true
  fi
  remove /Applications/Bloop.app "$HOME/Applications/Bloop.app"
  info "If you had turned on \"Open Bloop when you log in\", remove Bloop from"
  info "System Settings → General → Login Items too."

  # macOS folders are case-insensitive, so "bloop" also matches an older "Bloop".
  DATA_DIRS=(
    "$HOME/Library/Application Support/bloop"
    "$HOME/Library/Logs/bloop"
    "$HOME/Library/Preferences/$APP_ID.plist"
    "$HOME/Library/Saved Application State/$APP_ID.savedState"
    "$HOME/Library/Caches/$APP_ID"
    "$HOME/Library/Caches/$APP_ID.ShipIt"
    "$HOME/Library/HTTPStorages/$APP_ID"
  )
  MODEL_DIR="$HOME/Library/Application Support/bloop/models"
}

# ------------------------------------------------------------------ Linux

uninstall_linux() {
  local opt="$HOME/.local/opt/bloop" appimage="$HOME/.local/opt/bloop/Bloop.AppImage" pid
  for pid in $(pgrep -x bloop 2>/dev/null || true); do
    if tr '\0' '\n' 2>/dev/null <"/proc/$pid/environ" | grep -qxF "APPIMAGE=$appimage"; then
      kill -TERM "$pid" 2>/dev/null || true
    fi
  done
  sleep 1

  # ~/.local/bin/bloop: only remove it if it is ours (a symlink to the AppImage or our wrapper).
  local cmd="$HOME/.local/bin/bloop"
  if [[ -L "$cmd" && "$(readlink "$cmd")" == "$appimage" ]] ||
     { [[ -f "$cmd" ]] && grep -q 'written by scripts/install.sh' "$cmd" 2>/dev/null; }; then
    remove "$cmd"
  elif [[ -e "$cmd" ]]; then
    warn "$cmd wasn't created by the installer; leaving it."
  fi

  local apps="$HOME/.local/share/applications"
  remove "$apps/bloop.desktop" "$appimage" "$opt/uninstall.sh" "$opt/launch.log"
  if [[ -e "$opt/.env" ]]; then
    warn "Kept $opt/.env (your API key file). Delete it yourself if you don't need it."
  else
    rmdir "$opt" 2>/dev/null || true
  fi
  local icon
  for icon in "$HOME"/.local/share/icons/hicolor/*/apps/bloop.png; do
    [[ -e "$icon" ]] && remove "$icon"
  done
  # Launch-at-login entry the app writes (Settings → Open Bloop when you log in).
  remove "${XDG_CONFIG_HOME:-$HOME/.config}/autostart/bloop.desktop"
  if have update-desktop-database && [[ -d "$apps" ]]; then update-desktop-database "$apps" >/dev/null 2>&1 || true; fi

  local cfg="${XDG_CONFIG_HOME:-$HOME/.config}"
  DATA_DIRS=("$cfg/bloop" "$cfg/Bloop")
  MODEL_DIR="$cfg/bloop/models"
}

# ------------------------------------------------------------------ main

main() {
  local mode=ask a
  for a in "$@"; do
    case "$a" in
      --keep-data) mode=keep ;;
      --purge|--yes|-y) mode=purge ;;
      -h|--help) usage; exit 0 ;;
      *) usage >&2; die "Unknown option: $a" ;;
    esac
  done

  printf '%sRemoving Bloop%s\n' "$B" "$RST"
  case "$(uname -s)" in
    Darwin) uninstall_mac ;;
    Linux) uninstall_linux ;;
    *) die "On Windows, run: powershell -ExecutionPolicy Bypass -File scripts\\uninstall.ps1" ;;
  esac
  ok "Bloop app removed"

  local existing=() d
  for d in "${DATA_DIRS[@]}"; do [[ -e "$d" ]] && existing+=("$d"); done
  if (( ${#existing[@]} == 0 )); then
    printf '\n%sDone.%s No Bloop data was found.\n' "$GRN$B" "$RST"
    return 0
  fi

  printf '\nYour Bloop data (settings, session history, logs):\n'
  for d in "${existing[@]}"; do info "$d  ($(size_of "$d"))"; done
  local has_model=0 g
  for g in "$MODEL_DIR"/*.gguf; do [[ -e "$g" ]] && has_model=1; done
  if (( has_model )); then
    info "This includes the Bloop AI model in $MODEL_DIR ($(size_of "$MODEL_DIR")), which the installer downloaded."
    info "Deleting your data deletes the model too (re-installing downloads it again, ~532 MB). --keep-data keeps it."
  fi

  local wipe=0
  case "$mode" in
    purge) wipe=1 ;;
    keep) ;;
    ask) if confirm "Delete your Bloop data too? This can't be undone."; then wipe=1; fi ;;
  esac
  if (( wipe )); then
    remove "${existing[@]}"
    if [[ "$(uname -s)" == Darwin ]]; then
      info "Optional: clear Bloop's privacy permissions too:  tccutil reset All $APP_ID"
    fi
    printf '\n%sDone.%s Bloop and its data are gone.\n' "$GRN$B" "$RST"
  else
    printf '\n%sDone.%s Your data was kept; reinstalling Bloop picks it up again.\n' "$GRN$B" "$RST"
  fi
}

main "$@"; exit $?
