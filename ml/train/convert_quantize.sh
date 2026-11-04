#!/usr/bin/env bash
# Merged HF model -> GGUF (f16) -> Q4_K_M, using llama.cpp (cloned/built into ml/cache/llama.cpp).
#
#   bash ml/train/convert_quantize.sh                                  # tuned model: ml/out/merged
#   bash ml/train/convert_quantize.sh --src ml/cache/base --name base  # the untouched base model (for eval)
#
# Env: LLAMA_CPP_REF (default master), LLAMA_CPP_DIR, PYTHON, FORCE=1 (redo finished steps), KEEP_F16=1
# Untested end to end in the authoring sandbox.
set -euo pipefail

ML_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ML_DIR/out/merged"
NAME="bloop"
OUT_DIR="$ML_DIR/out"
QUANT="Q4_K_M"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --src) SRC="$2"; shift 2 ;;
    --name) NAME="$2"; shift 2 ;;
    --out) OUT_DIR="$2"; shift 2 ;;
    --quant) QUANT="$2"; shift 2 ;;
    -h|--help) sed -n '2,8p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

LLAMA_DIR="${LLAMA_CPP_DIR:-$ML_DIR/cache/llama.cpp}"
REF="${LLAMA_CPP_REF:-master}"
if [[ -n "${PYTHON:-}" ]]; then PY="$PYTHON"
elif [[ -x "$ML_DIR/.venv/bin/python" ]]; then PY="$ML_DIR/.venv/bin/python"
else PY="$(command -v python3)"; fi

F16="$OUT_DIR/$NAME-qwen3.5-0.8b-f16.gguf"
FINAL="$OUT_DIR/$NAME-qwen3.5-0.8b-$QUANT.gguf"
mkdir -p "$OUT_DIR" "$(dirname "$LLAMA_DIR")"

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
sha256_of() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
size_of() { if stat -f%z "$1" >/dev/null 2>&1; then stat -f%z "$1"; else stat -c%s "$1"; fi; }

report() {
  local bytes; bytes="$(size_of "$FINAL")"
  echo
  echo "GGUF:   $FINAL"
  echo "Size:   $bytes bytes ($(( bytes / 1024 / 1024 )) MiB)"
  echo "SHA256: $(sha256_of "$FINAL")"
}

if [[ -f "$FINAL" && "${FORCE:-0}" != "1" ]]; then
  say "$FINAL already exists - skipping (FORCE=1 to redo)"
  report; exit 0
fi

[[ -f "$SRC/config.json" ]] || { echo "No HF model at $SRC (config.json missing). Train/merge first." >&2; exit 1; }
for tool in git cmake; do command -v "$tool" >/dev/null || { echo "Missing '$tool'. macOS: xcode-select --install && brew install cmake. Colab: apt-get install -y cmake" >&2; exit 1; }; done

say "llama.cpp ($REF) in $LLAMA_DIR"
if [[ -d "$LLAMA_DIR/.git" ]]; then
  git -C "$LLAMA_DIR" fetch --depth 1 origin "$REF"
  git -C "$LLAMA_DIR" checkout -q FETCH_HEAD
else
  git clone --depth 1 --branch "$REF" https://github.com/ggml-org/llama.cpp "$LLAMA_DIR"
fi

say "Python requirements for convert_hf_to_gguf.py"
# Keep our already-installed torch/transformers (the converter's pins could downgrade them and break Qwen3.5 support).
REQ_TMP="$(mktemp)"
trap 'rm -f "$REQ_TMP"' EXIT
for f in requirements-convert_hf_to_gguf.txt requirements-convert_legacy_llama.txt; do
  [[ -f "$LLAMA_DIR/requirements/$f" ]] && grep -hvE '^\s*(#|-r|-e|--|torch|transformers|$)|@' "$LLAMA_DIR/requirements/$f" >> "$REQ_TMP" || true
done
"$PY" -m pip install -q -r "$REQ_TMP"
"$PY" -m pip install -q -e "$LLAMA_DIR/gguf-py" || "$PY" -m pip install -q gguf

if [[ ! -f "$F16" || "${FORCE:-0}" == "1" ]]; then
  say "Convert to GGUF f16"
  "$PY" "$LLAMA_DIR/convert_hf_to_gguf.py" "$SRC" --outfile "$F16" --outtype f16
else
  say "f16 GGUF exists - reusing $F16"
fi

say "Build llama.cpp tools (llama-quantize, llama-server, llama-cli)"
CMAKE_ARGS=(-DCMAKE_BUILD_TYPE=Release -DLLAMA_CURL=OFF -DGGML_CUDA=OFF -DBUILD_SHARED_LIBS=OFF)
[[ "$(uname -s)" == "Darwin" ]] && CMAKE_ARGS+=(-DGGML_METAL=ON)
JOBS="$(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 4)"
cmake -S "$LLAMA_DIR" -B "$LLAMA_DIR/build" "${CMAKE_ARGS[@]}"
cmake --build "$LLAMA_DIR/build" --config Release -j "$JOBS" --target llama-quantize llama-server llama-cli

say "Quantize to $QUANT"
"$LLAMA_DIR/build/bin/llama-quantize" "$F16" "$FINAL" "$QUANT"
[[ "${KEEP_F16:-0}" == "1" ]] || rm -f "$F16"

say "Done"
report
