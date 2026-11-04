#!/bin/bash
# CI only (GitHub macOS runners, SIP disabled): grant Bloop Screen Recording and Automation
# (Bloop -> Safari) by writing TCC.db directly, the way actions/runner-images does for its tools.
# Real users can't do this (SIP protects TCC.db); they tick the boxes in System Settings.
#
# Usage: scripts/ci/mac-tcc-grant.sh /path/to/Bloop.app [outdir]
set -u
APP="$1"
OUT="${2:-.}"
BIN="$APP/Contents/MacOS/Bloop"
BID=$(defaults read "$APP/Contents/Info.plist" CFBundleIdentifier)
SYS_DB="/Library/Application Support/com.apple.TCC/TCC.db"
USER_DB="$HOME/Library/Application Support/com.apple.TCC/TCC.db"
NOW=$(date +%s)

echo "csrutil: $(csrutil status 2>&1)"
echo "bundle id: $BID  binary: $BIN"

# Code requirement blobs, so tccd can match the grant to this exact (ad-hoc, cdhash) signature.
req_hex() { # $1 = path to code; prints hex blob or NULL
  local req tmp
  req=$(codesign -d -r- "$1" 2>&1 | sed -n 's/^\(# \)\{0,1\}designated => //p')
  if [[ -z "$req" ]]; then echo "NULL"; return; fi
  tmp=$(mktemp)
  if echo "$req" | csreq -r- -b "$tmp" 2>/dev/null; then
    echo "X'$(xxd -p "$tmp" | tr -d '\n')'"
  else
    echo "NULL"
  fi
  rm -f "$tmp"
}
APP_REQ=$(req_hex "$APP")
SAFARI_REQ=$(req_hex /Applications/Safari.app)
echo "designated requirement (app): $(codesign -d -r- "$APP" 2>&1 | sed -n 's/^\(# \)\{0,1\}designated => //p')"
echo "designated requirement (Safari): $(codesign -d -r- /Applications/Safari.app 2>&1 | sed -n 's/^\(# \)\{0,1\}designated => //p')"

COLS="service, client, client_type, auth_value, auth_reason, auth_version, csreq, policy_id, indirect_object_identifier_type, indirect_object_identifier, indirect_object_code_identity, flags, last_modified"
ins() { # db service client client_type csreq indirect_id indirect_req
  local db="$1" svc="$2" client="$3" ctype="$4" req="$5" ind="$6" indreq="$7"
  sudo sqlite3 "$db" "DELETE FROM access WHERE service='$svc' AND client='$client' AND indirect_object_identifier='$ind';
INSERT INTO access ($COLS) VALUES ('$svc', '$client', $ctype, 2, 4, 1, $req, NULL, 0, '$ind', $indreq, 0, $NOW);" \
    && echo "inserted $svc $client ($ctype) -> $ind into $(basename "$(dirname "$(dirname "$db")")")/$(basename "$db") [$( [[ "$db" == "$SYS_DB" ]] && echo system || echo user )]" \
    || echo "INSERT FAILED: $svc $client into $db"
}

for db in "$SYS_DB" "$USER_DB"; do
  echo "--- schema ($db)"
  sudo sqlite3 "$db" ".schema access" | head -5
done

# Screen Recording lives in the system DB (also add to the user DB, harmless).
for db in "$SYS_DB" "$USER_DB"; do
  ins "$db" kTCCServiceScreenCapture "$BID" 0 "$APP_REQ" UNUSED NULL
  ins "$db" kTCCServiceScreenCapture "$BIN" 1 "$APP_REQ" UNUSED NULL
done
# Automation (Apple Events) lives in the user DB.
for db in "$USER_DB" "$SYS_DB"; do
  ins "$db" kTCCServiceAppleEvents "$BID" 0 "$APP_REQ" com.apple.Safari "$SAFARI_REQ"
  ins "$db" kTCCServiceAppleEvents "$BIN" 1 "$APP_REQ" com.apple.Safari "$SAFARI_REQ"
done

# tccd caches; restart both the system and the per-user daemon.
sudo killall tccd 2>/dev/null || true
killall tccd 2>/dev/null || true
sleep 2

for db in "$SYS_DB" "$USER_DB"; do
  echo "--- rows for Bloop in $db"
  sudo sqlite3 -header "$db" "SELECT service, client, client_type, auth_value, auth_reason, indirect_object_identifier, length(csreq) AS csreq_len, length(indirect_object_code_identity) AS ind_req_len FROM access WHERE client LIKE '%bloop%' OR client LIKE '%Bloop%';"
done
