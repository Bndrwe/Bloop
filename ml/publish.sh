#!/usr/bin/env bash
# Publish the quantized Bloop GGUF + model card to Hugging Face and print the values the app needs.
#
#   hf auth login                       # once; paste a *write* token from https://huggingface.co/settings/tokens
#   bash ml/publish.sh <hf-username>    # or: HF_USER=name bash ml/publish.sh
#
# Env: GGUF (path), REPO_NAME (default bloop-qwen3.5-0.8b-GGUF), PRIVATE=1 to create a private repo (default is PUBLIC; the app can only download from a public repo).
set -euo pipefail

ML_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GGUF="${GGUF:-$ML_DIR/out/bloop-qwen3.5-0.8b-Q4_K_M.gguf}"
REPO_NAME="${REPO_NAME:-bloop-qwen3.5-0.8b-GGUF}"
HF_USER="${1:-${HF_USER:-}}"

[[ -f "$GGUF" ]] || { echo "GGUF not found: $GGUF (run: bash ml/run_mac.sh)" >&2; exit 1; }
[[ -f "$ML_DIR/MODEL_CARD.md" ]] || { echo "ml/MODEL_CARD.md missing" >&2; exit 1; }

if command -v hf >/dev/null; then HF=(hf)
elif command -v huggingface-cli >/dev/null; then HF=(huggingface-cli)
elif [[ -x "$ML_DIR/.venv/bin/hf" ]]; then HF=("$ML_DIR/.venv/bin/hf")
elif [[ -x "$ML_DIR/.venv/bin/huggingface-cli" ]]; then HF=("$ML_DIR/.venv/bin/huggingface-cli")
else echo "Install the CLI: pip install -U huggingface_hub  (then: hf auth login)" >&2; exit 1; fi

if [[ -z "$HF_USER" ]]; then
  HF_USER="$("${HF[@]}" auth whoami 2>/dev/null | head -1 | awk '{print $NF}' || true)"
  [[ -z "$HF_USER" ]] && { echo "Not logged in. Run: hf auth login   (or pass your username as the first argument)" >&2; exit 1; }
fi
REPO="$HF_USER/$REPO_NAME"
FILE="$(basename "$GGUF")"

sha256_of() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
size_of() { if stat -f%z "$1" >/dev/null 2>&1; then stat -f%z "$1"; else stat -c%s "$1"; fi; }

echo "==> Publishing $FILE to https://huggingface.co/$REPO"
CREATE=("${HF[@]}" repo create "$REPO" --repo-type model)
[[ "${PRIVATE:-0}" == "1" ]] && CREATE+=(--private)
"${CREATE[@]}" 2>/dev/null || echo "(repo exists or could not be created; continuing - upload will fail if it is truly missing)"

"${HF[@]}" upload "$REPO" "$GGUF" "$FILE" --commit-message "Add $FILE"
"${HF[@]}" upload "$REPO" "$ML_DIR/MODEL_CARD.md" README.md --commit-message "Update model card"

SHA="$(sha256_of "$GGUF")"; BYTES="$(size_of "$GGUF")"
cat <<OUT

Done. These three constants REPLACE the ones at the top of src/main/ai/local/bloop.ts:

  BLOOP_MODEL_URL    = 'https://huggingface.co/$REPO/resolve/main/$FILE'
  BLOOP_MODEL_SHA256 = '$SHA'
  BLOOP_MODEL_BYTES  = $BYTES
OUT
