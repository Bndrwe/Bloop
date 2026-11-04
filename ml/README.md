# Bloop model training kit

Fine-tunes **Qwen/Qwen3.5-0.8B** (LoRA r=16, 2 epochs), merges it, converts to GGUF and quantizes to **Q4_K_M** (~500 MB) for Bloop's built-in model. Dataset: `ml/data/` (see `ml/README-data.md`).

> Status: the scripts were written and statically checked only (`py_compile`, `bash -n`, notebook JSON, unit tests for scoring). They have **not** been run end to end, because the authoring sandbox could not install PyTorch or llama.cpp. Expect to fix small things on the first real run and please report them.

## Quick start

**Apple Silicon Mac** (macOS, Python 3.11+, cmake, git; `brew install cmake python@3.12`):

```bash
npm run model:train          # same as: bash ml/run_mac.sh
```

It creates `ml/.venv`, installs the packages, checks `ml/data/READY`, times a few steps and prints an ETA, then trains, merges, converts, quantizes and evaluates. Finished steps are skipped when you re-run (`ml/out/.done/`); `FORCE=1` redoes everything, `DRY_RUN=1` stops after the ETA.

**Google Colab (free T4):** open `ml/colab/train_bloop.ipynb` in Colab, pick *Runtime -> T4 GPU*, run the cells top to bottom (it uploads `train.jsonl`/`eval.jsonl`, trains, converts, evaluates, optionally publishes).

## Outputs

| Path | What |
|---|---|
| `ml/out/adapter/` | LoRA adapter |
| `ml/out/merged/` | merged HF model (bf16) |
| `ml/out/bloop-qwen3.5-0.8b-Q4_K_M.gguf` | the model for the app |
| `ml/out/base-qwen3.5-0.8b-Q4_K_M.gguf` | untouched base, for comparison |
| `ml/eval/REPORT.md` | base vs tuned, with and without JSON grammar |
| `ml/out/train_log.jsonl` | train loss per 10 steps and eval loss per epoch |

## Using the result

- **In Bloop:** Settings -> AI -> Bloop model -> "Load from file", pick the `.gguf`.
- **Publish for everyone:** `hf auth login`, then `npm run model:publish -- <hf-username>` (= `bash ml/publish.sh`). It uploads the GGUF and `MODEL_CARD.md` and prints `BLOOP_MODEL_URL`, `BLOOP_MODEL_SHA256` and `BLOOP_MODEL_BYTES` for `src/main/ai/local/bloop.ts`.
- **Ollama:** `cd ml && ollama create bloop -f Modelfile && ollama run bloop`.

## Manual steps

```bash
source ml/.venv/bin/activate
python ml/train/train_lora.py --dry-run                 # timing + ETA only
python ml/train/train_lora.py --epochs 2 --lr 2e-4      # every hyperparameter is a flag (--help)
python ml/train/train_lora.py --merge-only              # re-merge ml/out/adapter
bash ml/train/convert_quantize.sh                       # merged -> GGUF -> Q4_K_M, prints size and sha256
python ml/train/eval.py --limit 25                      # quick eval
python -m unittest discover -s ml/train                 # scoring + helper tests (stdlib only)
python ml/train/train_lora.py --base mit                # LoRA on top of MIT's weight-space edit (BASE=mit for run_mac.sh)
```

## Weight-space editing (no gradients)

`ml/wsp/` is a harness for editing the model's weights directly, after MIT CSAIL's [weight-space programming](https://rikiyat.github.io/blog/weight-space-programming/). You get a forward-pass budget, a locked test split, logged and revertible edits, and a changed-parameter cap. Start with `ml/wsp/README.md` and `ml/wsp/session.ipynb`. `eval.py` compares base, mit-edit, tuned and tuned+edit, using whichever GGUFs exist.

## Expected times and disk

| Where | Training (2 epochs) | Convert + quantize + eval |
|---|---|---|
| Apple Silicon (M-series, MPS) | ~20-40 min on the first run (depends on dataset size) | ~10-15 min incl. llama.cpp build |
| Colab T4 | ~15-25 min | ~10-15 min (CPU llama.cpp build) |
| CPU only | hours; not recommended | same |

Disk: about 15 GB free (base weights ~1.7 GB, merged ~1.7 GB, f16 GGUF ~1.6 GB, llama.cpp build, pip caches, venv). RAM: 16 GB recommended on a Mac.

These times are estimates, not measurements; the timing step prints a real ETA for your machine before committing.

## How it works (short)

- Qwen3.5 is a multimodal hybrid model (Gated DeltaNet linear attention + full attention). We load it with its original class so the merged checkpoint keeps the architecture llama.cpp's converter expects, and put LoRA on the language-model linears only (vision tower excluded).
- Loss covers only the assistant answer (prompt built by the chat template with `add_generation_prompt=True`). Examples longer than `--max-len` are dropped rather than truncated, so JSON answers are never cut.
- Thinking: the template default is used. If the printed prompt tail shows an open `<think>` block, re-run with `--enable-thinking false` so training matches non-thinking inference.

## Troubleshooting

- **`NotImplementedError ... not currently implemented for the MPS device`**: `PYTORCH_ENABLE_MPS_FALLBACK=1` is already set by the scripts; if you run Python yourself, export it. Some ops then run on the CPU (slower).
- **Warnings about missing `flash-linear-attention` / `causal-conv1d`**: harmless. The PyTorch fallback is used: slower, same result. On CUDA you can `pip install flash-linear-attention` to speed up.
- **Out of memory** (the 248k-token vocabulary makes logits big): lower `--max-len 768`, add `--grad-checkpointing`, keep `--micro-batch 1`. On a Mac close other apps; 8 GB machines may not fit.
- **`model type qwen3_5 not recognized`**: upgrade `pip install -U 'transformers>=5.2'` (or the newest). `--trust-remote-code` is the last resort.
- **fp16 loss is `nan` on CUDA**: use `--dtype fp32` (slower) or lower `--lr`.
- **`convert_hf_to_gguf.py` complains about the architecture**: your llama.cpp checkout is too old; delete `ml/cache/llama.cpp` and re-run (it clones the latest master; set `LLAMA_CPP_REF` for a specific tag).
- **ml/data/READY not found**: the dataset is still being generated.
- **Redo a step**: delete its marker in `ml/out/.done/` or run with `FORCE=1`.
