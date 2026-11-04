#!/usr/bin/env bash
# One command: train -> merge -> GGUF -> Q4_K_M -> eval, on an Apple Silicon Mac (PyTorch MPS).
#
#   bash ml/run_mac.sh                 # everything; finished steps are skipped on re-run
#   FORCE=1 bash ml/run_mac.sh         # redo all steps
#   DRY_RUN=1 bash ml/run_mac.sh       # only set up + time a few steps and print the ETA
#   TRAIN_ARGS="--max-len 768 --grad-checkpointing" bash ml/run_mac.sh   # extra flags for train_lora.py
#   SKIP_EVAL=1 / SKIP_BASE=1          # skip eval / skip converting the base model for comparison
#
# Untested end to end in the authoring sandbox - see ml/README.md.
set -euo pipefail

ML_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$ML_DIR/.venv"
OUT="$ML_DIR/out"
DONE="$OUT/.done"
TRAIN_ARGS="${TRAIN_ARGS:-}"
mkdir -p "$OUT" "$DONE" "$ML_DIR/cache"

step()  { printf '\n\033[1;36m[%s] %s\033[0m\n' "$1" "$2"; }
skip()  { printf '    skipping: %s (already done; FORCE=1 to redo)\n' "$1"; }
finished() { [[ -f "$DONE/$1" && "${FORCE:-0}" != "1" ]]; }
mark() { date > "$DONE/$1"; }
fail() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

step "0/7" "Checking the machine"
if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "    WARNING: this script targets Apple Silicon. Detected $(uname -s)/$(uname -m); training may fall back to CPU (hours)."
  echo "    For a free GPU use the Colab notebook: ml/colab/train_bloop.ipynb"
fi
PYBIN=""
for c in python3.13 python3.12 python3.11 python3; do
  if command -v "$c" >/dev/null && "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' 2>/dev/null; then PYBIN="$c"; break; fi
done
[[ -n "$PYBIN" ]] || fail "Python 3.11+ required (brew install python@3.12)."
command -v git >/dev/null   || fail "git not found (xcode-select --install)."
command -v cmake >/dev/null || fail "cmake not found (brew install cmake)."
FREE_GB=$(df -Pk "$ML_DIR" | awk 'NR==2 {print int($4/1024/1024)}')
echo "    python: $($PYBIN --version) | free disk: ${FREE_GB} GB (need ~15 GB) | $(sysctl -n hw.memsize 2>/dev/null | awk '{print int($1/2^30)" GB RAM"}')"
(( FREE_GB >= 10 )) || fail "Less than 10 GB free disk space."

step "1/7" "Dataset"
if [[ ! -f "$ML_DIR/data/READY" ]]; then
  fail "ml/data/READY not found. The dataset (ml/data/train.jsonl + eval.jsonl) is not finished yet - see ml/README-data.md."
fi
[[ -s "$ML_DIR/data/train.jsonl" && -s "$ML_DIR/data/eval.jsonl" ]] || fail "ml/data/train.jsonl or eval.jsonl is missing/empty."
echo "    $(wc -l < "$ML_DIR/data/train.jsonl" | tr -d ' ') train / $(wc -l < "$ML_DIR/data/eval.jsonl" | tr -d ' ') eval rows"

step "2/7" "Python environment ($VENV)"
if [[ ! -x "$VENV/bin/python" ]]; then "$PYBIN" -m venv "$VENV"; fi
PY="$VENV/bin/python"
if finished venv; then skip "pip install"; else
  "$PY" -m pip install -q --upgrade pip
  "$PY" -m pip install -r "$ML_DIR/train/requirements.txt"
  mark venv
fi
"$PY" - <<'PYEOF'
import torch, transformers, peft
print(f"    torch {torch.__version__} | transformers {transformers.__version__} | peft {peft.__version__} | mps={torch.backends.mps.is_available()}")
PYEOF

export PYTORCH_ENABLE_MPS_FALLBACK=1   # a few ops used by linear attention may lack MPS kernels
export TOKENIZERS_PARALLELISM=false

step "3/7" "Timing a few steps (ETA)"
# shellcheck disable=SC2086
"$PY" "$ML_DIR/train/train_lora.py" --dry-run $TRAIN_ARGS
if [[ -n "${DRY_RUN:-}" ]]; then echo; echo "DRY_RUN set - stopping here."; exit 0; fi

step "4/7" "Training LoRA + merging (loss on assistant tokens only)"
if finished train && [[ -f "$OUT/merged/config.json" ]]; then skip "training"; else
  # shellcheck disable=SC2086
  "$PY" "$ML_DIR/train/train_lora.py" $TRAIN_ARGS
  mark train
fi

step "5/7" "Convert to GGUF and quantize to Q4_K_M"
FINAL="$OUT/bloop-qwen3.5-0.8b-Q4_K_M.gguf"
bash "$ML_DIR/train/convert_quantize.sh" --src "$OUT/merged" --name bloop
if [[ "${SKIP_EVAL:-0}" != "1" && "${SKIP_BASE:-0}" != "1" ]]; then
  if [[ ! -f "$OUT/base-qwen3.5-0.8b-Q4_K_M.gguf" ]]; then
    echo "    preparing the untouched base model for the side-by-side eval ..."
    "$PY" -c "from huggingface_hub import snapshot_download; snapshot_download('Qwen/Qwen3.5-0.8B', local_dir='$ML_DIR/cache/base', allow_patterns=['*.json','*.safetensors','*.txt','*.jinja','*.model'])"
    bash "$ML_DIR/train/convert_quantize.sh" --src "$ML_DIR/cache/base" --name base
  fi
fi
mark gguf

step "6/7" "Evaluation (base vs tuned, with and without JSON grammar)"
if [[ "${SKIP_EVAL:-0}" == "1" ]]; then echo "    SKIP_EVAL=1"; elif finished eval; then skip "eval"; else
  "$PY" "$ML_DIR/train/eval.py"
  mark eval
fi

step "7/7" "Done"
BYTES=$(stat -f%z "$FINAL" 2>/dev/null || stat -c%s "$FINAL")
cat <<MSG

  Model:   $FINAL  ($((BYTES / 1024 / 1024)) MiB)
  Report:  $ML_DIR/eval/REPORT.md

Next steps
  * Try it now in Bloop:  Settings -> AI -> Bloop model -> "Load from file"  and pick the .gguf above.
  * Try it in Ollama:     cd ml && ollama create bloop -f Modelfile && ollama run bloop
  * Publish for everyone: hf auth login && bash ml/publish.sh <your-hf-username>
                          (prints BLOOP_MODEL_URL / BLOOP_MODEL_SHA256 / BLOOP_MODEL_BYTES for src/main/ai/local/bloop.ts)
MSG
