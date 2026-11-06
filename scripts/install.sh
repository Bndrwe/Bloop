#!/usr/bin/env bash
# Bloop: build the app from this source folder and install it (macOS and Linux).
#
#   ./scripts/install.sh            build, install, launch
#   ./scripts/install.sh --help     all options
#
# Re-running it updates Bloop: it pulls the latest code (when the checkout is clean), rebuilds and
# replaces the installed copy. Your settings and history are kept.
#
#   macOS: /Applications/Bloop.app (or ~/Applications/Bloop.app if /Applications isn't writable)
#   Linux: ~/.local/opt/bloop/Bloop.AppImage, plus ~/.local/bin/bloop and an app-menu entry
#
# Uninstall: ./scripts/uninstall.sh   (or npm run uninstall-app)

# Works with the bash 3.2 that ships with macOS. Everything runs inside main(), so bash has read the
# whole file before anything happens and a `git pull` that changes this script can't confuse it.
set -euo pipefail

APP_ID="edu.bloop.app"
NODE_MIN=20

# ------------------------------------------------------------------ output helpers

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  B=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GRN=$'\033[32m'; YLW=$'\033[33m'; RST=$'\033[0m'
else
  B=''; DIM=''; RED=''; GRN=''; YLW=''; RST=''
fi
STEP=0
step() { STEP=$((STEP + 1)); printf '\n%s==> [%d] %s%s\n' "$B" "$STEP" "$*" "$RST"; }
info() { printf '    %s\n' "$*"; }
ok()   { printf '    %s✓%s %s\n' "$GRN" "$RST" "$*"; }
warn() { printf '    %s!%s %s\n' "$YLW" "$RST" "$*" >&2; }
die()  { printf '\n%sError:%s %s\n' "$RED" "$RST" "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

# y/N question. Defaults to "no" when there is no terminal to ask on.
confirm() {
  local reply=''
  [[ -t 0 ]] || return 1
  read -r -p "    $1 [y/N] " reply || return 1
  [[ "$reply" =~ ^[Yy]([Ee][Ss])?$ ]]
}

usage() {
  cat <<'EOF'
Build Bloop from source and install it on this computer (macOS or Linux).

Usage: ./scripts/install.sh [options]      (or: npm run install-app -- [options])

Options:
  --no-launch    install but don't start Bloop afterwards
  --fast         skip the TypeScript check (saves ~30 s)
  --clean        delete dist/, out/ and node_modules/ first (fixes most odd build errors)
  --no-pull      don't `git pull` the latest code first
  --keep-build   keep the build output in dist/ (it is deleted after installing to save space)
  -h, --help     show this help

Re-run the same command to update. Uninstall with ./scripts/uninstall.sh.
EOF
}

# ------------------------------------------------------------------ checks

node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

need_node_mac() {
  warn "Bloop needs Node.js ${NODE_MIN} or newer (with npm) to build."
  if have brew; then
    info "Homebrew can install it:  brew install node@${NODE_MIN}"
    if confirm "Run 'brew install node@${NODE_MIN}' now?"; then
      brew install "node@${NODE_MIN}"
      local prefix
      prefix="$(brew --prefix "node@${NODE_MIN}")"
      export PATH="$prefix/bin:$PATH"
      info "node@${NODE_MIN} is keg-only. To use it in new terminals, add this to ~/.zshrc:"
      info "  export PATH=\"$prefix/bin:\$PATH\""
      return 0
    fi
  else
    info "Install it from https://nodejs.org (the LTS .pkg), or install Homebrew"
    info "(https://brew.sh) and run:  brew install node@${NODE_MIN}"
  fi
  die "Install Node.js ${NODE_MIN}+, then run this command again."
}

need_node_linux() {
  warn "Bloop needs Node.js ${NODE_MIN} or newer (with npm) to build."
  info "Easiest, no sudo (nvm):"
  info "  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash"
  info "  # open a new terminal, then:"
  info "  nvm install ${NODE_MIN}"
  info "Or from your distro / NodeSource:"
  info "  Ubuntu/Debian: https://github.com/nodesource/distributions (apt install nodejs)"
  info "  Fedora:        sudo dnf install nodejs"
  info "  Arch:          sudo pacman -S nodejs npm"
  die "Install Node.js ${NODE_MIN}+, then run this command again."
}

check_tools() {
  step "Checking tools"
  if ! have git; then
    if [[ "$OS" == mac ]]; then
      warn "git is missing. Run:  xcode-select --install"
    else
      warn "git is missing. Install it with your package manager (sudo apt install git / sudo dnf install git)."
    fi
    if [[ -d "$ROOT/.git" ]]; then die "git is required to update this checkout."; fi
  else
    ok "git $(git --version | awk '{print $3}')"
  fi

  if ! have node || (( $(node_major) < NODE_MIN )); then
    have node && warn "Found Node.js $(node -v), which is too old."
    if [[ "$OS" == mac ]]; then need_node_mac; else need_node_linux; fi
  fi
  have node && (( $(node_major) >= NODE_MIN )) || die "Node.js ${NODE_MIN}+ is still not on PATH. Open a new terminal and re-run."
  have npm || die "npm is missing (it normally comes with Node.js). Reinstall Node.js ${NODE_MIN}+."
  ok "node $(node -v), npm $(npm -v)"

  NODE_ARCH="$(node -p process.arch)"
  case "$NODE_ARCH" in
    x64|arm64) ;;
    *) die "Unsupported CPU architecture '$NODE_ARCH'. Bloop builds for x64 and arm64." ;;
  esac
  if [[ "$OS" == mac && "$NODE_ARCH" == x64 && "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" == 1 ]]; then
    warn "This is an Apple Silicon Mac but your Node.js is the Intel (x64) build, so Bloop will be"
    warn "built for Intel and run under Rosetta. Install the arm64 Node.js for a native build."
  fi
  ok "building for $OS-$NODE_ARCH"

  local free_kb
  free_kb="$(df -Pk "$ROOT" | awk 'NR==2 {print $4}')"
  if [[ -n "$free_kb" ]] && (( free_kb < 2500000 )); then
    warn "Only $((free_kb / 1024)) MB free here. The build needs about 2 GB (node_modules + build output)."
  fi
}

# ------------------------------------------------------------------ build

update_source() {
  (( PULL )) || return 0
  [[ -d "$ROOT/.git" ]] && have git || return 0
  step "Getting the latest code"
  if ! git -C "$ROOT" rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
    info "This branch has no upstream; building the code as it is."
    return 0
  fi
  if [[ -n "$(git -C "$ROOT" status --porcelain --untracked-files=no)" ]]; then
    warn "You have local changes, so I'm not pulling. Building the code as it is."
    return 0
  fi
  local before after
  before="$(git -C "$ROOT" rev-parse HEAD)"
  if ! git -C "$ROOT" pull --ff-only; then
    warn "git pull failed (offline, or no access?). Building the code you already have."
    return 0
  fi
  after="$(git -C "$ROOT" rev-parse HEAD)"
  if [[ "$before" != "$after" ]]; then
    ok "updated to $(git -C "$ROOT" log -1 --format='%h %s')"
    # This script may have changed too: run the new copy.
    exec bash "$ROOT/scripts/install.sh" --no-pull ${ORIG_ARGS[@]+"${ORIG_ARGS[@]}"}
  fi
  ok "already up to date ($(git -C "$ROOT" log -1 --format=%h))"
}

install_deps() {
  step "Installing dependencies (first time takes a few minutes)"
  local stamp="$ROOT/node_modules/.bloop-install-stamp" want have_stamp=''
  if [[ -f "$ROOT/package-lock.json" ]]; then
    want="$(node -e 'const c=require("crypto"),f=require("fs");process.stdout.write(c.createHash("sha256").update(f.readFileSync(process.argv[1])).update(process.version+process.arch).digest("hex"))' "$ROOT/package-lock.json")"
    [[ -f "$stamp" ]] && have_stamp="$(cat "$stamp")"
    if [[ "$want" == "$have_stamp" && -d "$ROOT/node_modules/electron/dist" ]]; then
      ok "node_modules already matches package-lock.json"
      return 0
    fi
    (cd "$ROOT" && npm ci --no-audit --no-fund)
    printf '%s' "$want" >"$stamp"
  else
    warn "No package-lock.json, using npm install."
    (cd "$ROOT" && npm install --no-audit --no-fund)
  fi
  ok "dependencies installed"
}

build_app() {
  if (( FAST )); then
    step "Skipping the type check (--fast)"
  else
    step "Type-checking"
    (cd "$ROOT" && npm run --silent typecheck)
    ok "types OK"
  fi

  step "Bundling the app"
  (cd "$ROOT" && npx --no-install electron-vite build)
  ok "bundled into out/"

  step "Packaging Bloop for $OS-$NODE_ARCH"
  # For the AppImage, electron-builder writes auto-update metadata and crashes if it can't find a
  # GitHub repo in .git (a source .zip, a fork, an SSH alias). Bloop has no auto-updater, so give it
  # a dummy feed; nothing is published or downloaded.
  local extra=(-c.publish.provider=generic -c.publish.url=https://localhost/bloop-no-updates)
  if [[ "$OS" == mac ]]; then
    # Unsigned local build: build.mac.identity "-" signs it ad hoc; never look for a Developer ID.
    (cd "$ROOT" && CSC_IDENTITY_AUTO_DISCOVERY=false npx --no-install electron-builder \
      --mac dir "--$NODE_ARCH" --publish never ${extra[@]+"${extra[@]}"})
  else
    (cd "$ROOT" && npx --no-install electron-builder --linux AppImage "--$NODE_ARCH" --publish never ${extra[@]+"${extra[@]}"})
  fi
  ok "packaged"
}

# ------------------------------------------------------------------ macOS install

mac_quit_running() {
  pgrep -x Bloop >/dev/null 2>&1 || return 0
  info "Quitting the running Bloop…"
  osascript -e "tell application id \"$APP_ID\" to quit" >/dev/null 2>&1 || true
  local i
  for i in 1 2 3 4 5 6 7 8 9 10; do
    pgrep -x Bloop >/dev/null 2>&1 || return 0
    sleep 0.5
  done
  pkill -x Bloop >/dev/null 2>&1 || true
  sleep 1
}

install_mac() {
  step "Installing Bloop.app"
  local built="" d
  for d in "$ROOT/dist/mac-$NODE_ARCH" "$ROOT/dist/mac" "$ROOT"/dist/mac*; do
    if [[ -d "$d/Bloop.app" ]]; then built="$d/Bloop.app"; break; fi
  done
  [[ -n "$built" ]] || die "Couldn't find the built Bloop.app in dist/."

  local apps="/Applications"
  if [[ ! -w "$apps" ]]; then
    apps="$HOME/Applications"
    mkdir -p "$apps"
    warn "/Applications isn't writable for your user, so Bloop goes into ~/Applications."
  fi
  APP_PATH="$apps/Bloop.app"

  mac_quit_running
  rm -rf "$APP_PATH"
  # ditto keeps the bundle's symlinks, permissions and code signature intact.
  ditto "$built" "$APP_PATH"
  # A build made on this Mac is not quarantined, but clear any extended attributes anyway.
  xattr -cr "$APP_PATH" 2>/dev/null || true
  if ! codesign --verify --deep --strict "$APP_PATH" >/dev/null 2>&1; then
    info "Re-signing ad hoc…"
    codesign --force --deep -s - "$APP_PATH"
  fi
  codesign --verify --deep --strict "$APP_PATH" || die "Bloop.app's signature didn't verify."
  ok "installed $APP_PATH (ad-hoc signed)"
  if [[ "$apps" == "$HOME/Applications" && -d /Applications/Bloop.app ]]; then
    warn "An older /Applications/Bloop.app also exists. Delete it so you don't open the old one."
  fi
}

# ------------------------------------------------------------------ Linux install

# Electron's sandbox needs unprivileged user namespaces. Ubuntu 23.10+ blocks them for apps without
# an AppArmor profile, and an AppImage can't use the setuid chrome-sandbox, so Bloop would exit at
# once. Detect that and start it with --no-sandbox.
linux_needs_no_sandbox() {
  [[ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || echo 0)" == 1 ]] && return 0
  [[ "$(cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null || echo 1)" == 0 ]] && return 0
  [[ "$(cat /proc/sys/user/max_user_namespaces 2>/dev/null || echo 1)" == 0 ]] && return 0
  return 1
}

linux_has_fuse2() {
  { have ldconfig && ldconfig -p 2>/dev/null | grep -q 'libfuse\.so\.2'; } && return 0
  local f
  for f in /lib/*/libfuse.so.2 /usr/lib/*/libfuse.so.2 /usr/lib/libfuse.so.2 /usr/lib64/libfuse.so.2; do
    [[ -e "$f" ]] && return 0
  done
  return 1
}

# Running copies of the installed AppImage (matched by the APPIMAGE variable the runtime sets).
linux_running_pids() {
  local pid
  for pid in $(pgrep -x bloop 2>/dev/null || true); do
    tr '\0' '\n' 2>/dev/null <"/proc/$pid/environ" | grep -qxF "APPIMAGE=$APPIMAGE_PATH" && echo "$pid"
  done
  return 0
}

linux_quit_running() {
  local pids i
  pids="$(linux_running_pids)"
  [[ -n "$pids" ]] || return 0
  info "Quitting the running Bloop…"
  # shellcheck disable=SC2086
  kill -TERM $pids 2>/dev/null || true
  for i in 1 2 3 4 5 6 7 8 9 10; do
    [[ -n "$(linux_running_pids)" ]] || return 0
    sleep 0.5
  done
  pids="$(linux_running_pids)"
  # shellcheck disable=SC2086
  [[ -n "$pids" ]] && kill -KILL $pids 2>/dev/null || true
}

install_linux() {
  step "Installing Bloop"
  local built
  built="$(ls -t "$ROOT"/dist/Bloop-*-linux-*.AppImage 2>/dev/null | head -n1 || true)"
  [[ -n "$built" ]] || die "Couldn't find the built AppImage in dist/."

  local opt="$HOME/.local/opt/bloop" bin="$HOME/.local/bin" apps="$HOME/.local/share/applications"
  local icons="$HOME/.local/share/icons/hicolor"
  APPIMAGE_PATH="$opt/Bloop.AppImage"
  mkdir -p "$opt" "$bin" "$apps"

  linux_quit_running
  cp "$built" "$APPIMAGE_PATH.tmp"
  chmod 755 "$APPIMAGE_PATH.tmp"
  mv -f "$APPIMAGE_PATH.tmp" "$APPIMAGE_PATH"
  cp "$ROOT/scripts/uninstall.sh" "$opt/uninstall.sh"
  chmod 755 "$opt/uninstall.sh"
  ok "app:      $APPIMAGE_PATH"

  # How to start it on this system.
  EXTRA_ARGS=()
  EXTRA_ENV=()
  if [[ "$(id -u)" == 0 ]]; then
    EXTRA_ARGS+=(--no-sandbox)   # Electron refuses to start as root without it
  elif linux_needs_no_sandbox; then
    EXTRA_ARGS+=(--no-sandbox)
    info "This system restricts user namespaces (Ubuntu 23.10+ AppArmor), so Bloop starts with --no-sandbox."
  fi
  if ! linux_has_fuse2; then
    EXTRA_ENV+=(APPIMAGE_EXTRACT_AND_RUN=1)
    info "FUSE 2 isn't installed, so Bloop unpacks itself to a temp folder on each start (a bit slower)."
  fi

  # ~/.local/bin/bloop: a plain symlink, or a tiny wrapper when extra flags are needed.
  rm -f "$bin/bloop"
  if (( ${#EXTRA_ARGS[@]} + ${#EXTRA_ENV[@]} == 0 )); then
    ln -s "$APPIMAGE_PATH" "$bin/bloop"
  else
    {
      echo '#!/bin/sh'
      echo '# Bloop launcher written by scripts/install.sh'
      printf 'exec %s"%s"%s "$@"\n' \
        "${EXTRA_ENV[*]:+env ${EXTRA_ENV[*]} }" "$APPIMAGE_PATH" "${EXTRA_ARGS[*]:+ ${EXTRA_ARGS[*]}}"
    } >"$bin/bloop"
    chmod 755 "$bin/bloop"
  fi
  ok "command:  $bin/bloop"
  case ":$PATH:" in
    *":$bin:"*) ;;
    *) warn "$bin is not on your PATH. Add  export PATH=\"\$HOME/.local/bin:\$PATH\"  to ~/.bashrc to type 'bloop'." ;;
  esac

  # Icons (hicolor theme, every size we have).
  local png size
  for png in "$ROOT"/build/icons/*x*.png; do
    [[ -f "$png" ]] || continue
    size="$(basename "$png" .png)"
    mkdir -p "$icons/$size/apps"
    cp "$png" "$icons/$size/apps/bloop.png"
  done
  if [[ ! -f "$icons/512x512/apps/bloop.png" && -f "$ROOT/build/icon.png" ]]; then
    mkdir -p "$icons/512x512/apps"
    cp "$ROOT/build/icon.png" "$icons/512x512/apps/bloop.png"
  fi

  # App-menu entry. Exec uses the AppImage directly so it works even without ~/.local/bin on PATH.
  local exec_line="\"$APPIMAGE_PATH\""
  (( ${#EXTRA_ENV[@]} )) && exec_line="env ${EXTRA_ENV[*]} $exec_line"
  (( ${#EXTRA_ARGS[@]} )) && exec_line="$exec_line ${EXTRA_ARGS[*]}"
  cat >"$apps/bloop.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Bloop
GenericName=Study companion
Comment=Your little study pet
Exec=$exec_line %U
TryExec=$APPIMAGE_PATH
Icon=bloop
Terminal=false
Categories=Education;Utility;
Keywords=study;focus;pomodoro;timer;
StartupWMClass=bloop
StartupNotify=false
X-Bloop-Installer=scripts/install.sh
EOF
  chmod 644 "$apps/bloop.desktop"
  have update-desktop-database && update-desktop-database "$apps" >/dev/null 2>&1 || true
  ok "menu:     $apps/bloop.desktop"

  # Runtime helpers Bloop uses on Linux.
  if ! have xprop || ! have xwininfo; then
    warn "Focus tracking needs xprop/xwininfo:  sudo apt install x11-utils   (Fedora: sudo dnf install xprop xwininfo)"
  fi
  if ! linux_has_fuse2; then
    warn "Optional, for faster starts:  sudo apt install libfuse2   (Ubuntu 24.04+: libfuse2t64; Fedora: sudo dnf install fuse-libs)"
  fi
  if [[ "${XDG_SESSION_TYPE:-}" == wayland ]]; then
    warn "You're on Wayland: Bloop can't see other apps' windows there. Pick an X11/Xorg session at login for focus tracking."
  fi
}

# ------------------------------------------------------------------ old model file cleanup

# One-time cleanup: earlier installers downloaded an on-device model file into the app's own data
# folder (<userData>/models/). Delete just that file (and its .part), and the folder if that leaves
# it empty. Nothing else is touched, and nothing here ever fails the install.
remove_old_model_file() {
  local dir f removed=0
  if [[ "$OS" == mac ]]; then
    dir="$HOME/Library/Application Support/bloop/models"
  else
    dir="${XDG_CONFIG_HOME:-$HOME/.config}/bloop/models"
  fi
  for f in "$dir/bloop-qwen3.5-0.8b-q4_k_m.gguf" "$dir/bloop-qwen3.5-0.8b-q4_k_m.gguf.part"; do
    if [[ -f "$f" ]]; then rm -f "$f" 2>/dev/null && removed=1; fi
  done
  (( removed )) || return 0
  rmdir "$dir" 2>/dev/null || true
  ok "Removed the old on-device model file (about 530 MB)."
  return 0
}

# ------------------------------------------------------------------ launch + summary

launch() {
  (( LAUNCH )) || return 0
  step "Starting Bloop"
  if [[ "$OS" == mac ]]; then
    open "$APP_PATH"
    ok "look for the pet in the top-right corner and the icon in the menu bar"
  else
    if [[ -z "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]]; then
      warn "No graphical session found (DISPLAY is empty), so not starting it. Run 'bloop' from your desktop."
      return 0
    fi
    local launch_log="$HOME/.local/opt/bloop/launch.log" i
    (
      cd "$HOME"
      if (( ${#EXTRA_ENV[@]} )); then export "${EXTRA_ENV[@]}"; fi
      nohup "$APPIMAGE_PATH" ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"} >"$launch_log" 2>&1 &
    )
    for i in 1 2 3 4 5 6 7 8 9 10; do
      sleep 1
      [[ -n "$(linux_running_pids)" ]] && break
    done
    sleep 2
    if [[ -z "$(linux_running_pids)" ]]; then
      warn "Bloop exited right after starting. The last lines it printed ($launch_log):"
      tail -n 15 "$launch_log" | sed 's/^/      /' >&2
      warn "Try starting it from a terminal with:  bloop --no-sandbox"
      return 0
    fi
    ok "started; look for the pet in the top-right corner of your screen"
  fi
}

cleanup_build() {
  (( KEEP_BUILD )) && return 0
  if [[ "$OS" == mac ]]; then
    rm -rf "$ROOT"/dist/mac "$ROOT"/dist/mac-*
  else
    rm -rf "$ROOT"/dist/Bloop-*-linux-*.AppImage "$ROOT"/dist/linux-unpacked "$ROOT"/dist/linux-*-unpacked "$ROOT"/dist/__appImage-*
  fi
  rm -f "$ROOT"/dist/builder-debug.yml "$ROOT"/dist/builder-effective-config.yaml "$ROOT"/dist/latest*.yml
  rmdir "$ROOT/dist" 2>/dev/null || true
}

summary() {
  printf '\n%sBloop is installed.%s\n\n' "$GRN$B" "$RST"
  if [[ "$OS" == mac ]]; then
    cat <<EOF
  App:        $APP_PATH
  Data:       ~/Library/Application Support/bloop
  Logs:       ~/Library/Logs/bloop/main.log   (menu bar icon → Open logs folder)
  Update:     run this command again
  Uninstall:  ./scripts/uninstall.sh   (or npm run uninstall-app)

  Each rebuild of an unsigned app looks like a new app to macOS, so it may ask for
  Screen Recording and Automation again. If a permission says "not granted" after an
  update, run:  npm run perms
EOF
  else
    cat <<EOF
  App:        $APPIMAGE_PATH
  Command:    bloop   (~/.local/bin/bloop)   · app menu: "Bloop"
  Data:       ~/.config/bloop
  Logs:       ~/.config/bloop/logs/main.log   (tray icon → Open logs folder)
  Update:     run this command again
  Uninstall:  ./scripts/uninstall.sh   (or ~/.local/opt/bloop/uninstall.sh)
EOF
  fi
}

# ------------------------------------------------------------------ main

main() {
  ORIG_ARGS=("$@")
  LAUNCH=1 FAST=0 CLEAN=0 PULL=1 KEEP_BUILD=0
  local a
  for a in "$@"; do
    case "$a" in
      --no-launch) LAUNCH=0 ;;
      --fast) FAST=1 ;;
      --clean) CLEAN=1 ;;
      --no-pull) PULL=0 ;;
      --keep-build) KEEP_BUILD=1 ;;
      --no-model|--model-only) ;;   # old flags, accepted and ignored so existing command lines still work
      -h|--help) usage; exit 0 ;;
      *) usage >&2; die "Unknown option: $a" ;;
    esac
  done

  ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  [[ -f "$ROOT/package.json" && -f "$ROOT/electron.vite.config.ts" ]] ||
    die "Run this from the Bloop source folder (couldn't find package.json next to scripts/)."

  case "$(uname -s)" in
    Darwin) OS=mac ;;
    Linux) OS=linux ;;
    MINGW*|MSYS*|CYGWIN*) die "On Windows, use PowerShell:  powershell -ExecutionPolicy Bypass -File scripts\\install.ps1" ;;
    *) die "Unsupported system: $(uname -s). Bloop installs on macOS, Linux and Windows." ;;
  esac
  printf '%sBloop installer%s %s(%s, %s)%s\n' "$B" "$RST" "$DIM" "$ROOT" "$(uname -sm)" "$RST"
  if [[ "$(id -u)" == 0 ]]; then
    warn "You're running as root, so Bloop is installed for root only. Run it as your normal user (no sudo)."
  fi
  local t0=$SECONDS

  check_tools
  update_source
  if (( CLEAN )); then
    step "Cleaning old build output (--clean)"
    rm -rf "$ROOT/dist" "$ROOT/out" "$ROOT/node_modules"
    ok "removed dist/, out/, node_modules/"
  fi
  install_deps
  build_app
  if [[ "$OS" == mac ]]; then install_mac; else install_linux; fi
  cleanup_build
  remove_old_model_file
  launch
  summary
  printf '\n  %sDone in %dm%02ds.%s\n' "$DIM" $(((SECONDS - t0) / 60)) $(((SECONDS - t0) % 60)) "$RST"
}

main "$@"; exit $?
