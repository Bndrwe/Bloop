# Bloop Model Playbook: train, edit and ship the on-device Bloop model

**One file, everything included.** This Markdown file has the full runbook *and* every file of the Bloop model kit embedded below: the training scripts, the dataset, the weight-space harness, the eval, and the publishing scripts. You don't need GitHub access or a zip. Give this file to Codex (or any agent) or follow it yourself.

> **What you're making:** the **Bloop model**. It's [Qwen/Qwen3.5-0.8B](https://huggingface.co/Qwen/Qwen3.5-0.8B), lightly LoRA fine-tuned on Bloop's study-plan and nudge tasks, optionally edited MIT-style in weight space, then converted to **GGUF Q4_K_M** (about 500 MB). The app can bundle it, import it, or download it (only after the user confirms); by default it downloads the stock Qwen3.5-0.8B. It runs on-device with node-llama-cpp.

---

## Contents

0. [Unpack the kit](#0-unpack-the-kit)
1. [Pick where to run](#1-pick-where-to-run)
2. [Part A: Fine-tune (LoRA)](#2-part-a-fine-tune-lora)
3. [Part B: Weight-space editing (MIT-style, optional)](#3-part-b-weight-space-editing-mit-style-optional)
4. [Part C: Convert, evaluate, publish](#4-part-c-convert-evaluate-publish)
5. [Report back](#5-report-back)
6. [Rules for agents](#6-rules-for-agents)
7. [Troubleshooting](#7-troubleshooting)
8. [Background: the tasks, the data, MIT's method](#8-background)
9. [Appendix: embedded files](#appendix-embedded-files)

---

## 0. Unpack the kit

Save this file as `BLOOP_MODEL_PLAYBOOK.md`. Then, in an empty folder (or the root of the StudyPet repo), run:

```bash
python3 - <<'PY'
import hashlib, os, re
src = open("BLOOP_MODEL_PLAYBOOK.md", encoding="utf-8").read()
pat = re.compile(r'<!-- FILE: (?P<path>[^ ]+) sha256=(?P<sha>[0-9a-f]{64}) nl=(?P<nl>[01]) -->\n``````[a-z]*\n(?P<body>.*?)\n``````\n', re.S)
n = 0
for m in pat.finditer(src):
    path, body = m["path"], m["body"]
    if m["nl"] == "1":
        body += "\n"
    data = body.encode("utf-8")
    assert hashlib.sha256(data).hexdigest() == m["sha"], f"checksum mismatch: {path}"
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)
    n += 1
print(f"unpacked {n} files, all checksums OK")
PY
chmod +x ml/run_mac.sh ml/publish.sh ml/train/convert_quantize.sh
```

You should see `unpacked 32 files, all checksums OK`. Quick sanity check (stdlib only, no GPU needed):

```bash
python3 ml/data/validate.py --no-ready                                             # dataset: expect ALL CHECKS PASSED
python3 -m unittest discover -s ml/train                                           # expect OK
python3 -m unittest discover -s ml/wsp                                             # expect OK
```

The layout after unpacking:

```
ml/
  data/        train.jsonl (240), eval.jsonl (30), READY, generator + validator
  train/       train_lora.py, convert_quantize.sh, eval.py, scoring.py, tests
  wsp/         weight-space harness (harness.py, presets.py, session.ipynb, README)
  colab/       train_bloop.ipynb  (Colab T4 version of everything)
  run_mac.sh   one-command pipeline for Apple Silicon
  publish.sh   upload to Hugging Face + print the app constants
  Modelfile    Ollama import
  MODEL_CARD.md
src/main/plan.ts   the app's real prompt (buildPrompt); the dataset mirrors it byte-for-byte
docs/             the two original Codex briefs (Part A and Part B as separate documents)
```

---

## 1. Pick where to run

| Option | Hardware | First run | Notes |
|---|---|---|---|
| **Google Colab (free T4)** | NVIDIA T4 16 GB | ~15–25 min | Best if you don't have a Mac. Upload this file, unpack, open `ml/colab/train_bloop.ipynb`. |
| **Apple Silicon Mac** | M1–M4 (MPS) | ~20–40 min | `bash ml/run_mac.sh`. It's resumable and skips finished steps. |
| Linux/NVIDIA box | any CUDA GPU | ~10–20 min | Same commands as the Mac script, using CUDA. |
| CPU only | — | hours | Works, but slowly. Not recommended. |

The first run includes downloading PyTorch (~150 MB) and Qwen3.5-0.8B (~1.6 GB), building llama.cpp (~3–5 min), conversion and quantization (~2 min), and eval (~5 min). Training itself is ~15–25 min on a T4 (faster on a newer GPU). The script times a few steps first and prints an ETA.

**Codex cloud containers have no GPU.** Use Codex *with a browser* to drive Colab, or Codex CLI on a Mac.

---

## 2. Part A: Fine-tune (LoRA)

### A1. Colab (T4)

1. Open https://colab.research.google.com, choose **Runtime → Change runtime type → T4 GPU → Save**, and check with `!nvidia-smi`.
2. Upload `BLOOP_MODEL_PLAYBOOK.md` in the Files sidebar (it lands in `/content`). In a new cell, run `!mkdir -p /content/StudyPet && mv /content/BLOOP_MODEL_PLAYBOOK.md /content/StudyPet/`. Then in a `%%bash` cell, run `cd /content/StudyPet` followed by the [unpack command](#0-unpack-the-kit).
3. **File → Upload notebook →** `ml/colab/train_bloop.ipynb` (download it from `/content/StudyPet/ml/colab/` via the Files sidebar first, or upload your own copy). The notebook runtime keeps the files you unpacked.
4. The notebook's "Get the training kit" cell only clones if `/content/StudyPet` doesn't exist. It already does, so it just `cd`s there and lists `ml/`. Don't change `REPO_URL`: the repo is private, so cloning would fail. The "Upload the dataset" cell keeps the `ml/data/` files that are already there.
5. Optional, cell 4b: `BASE = "mit"` trains on top of MIT's edited checkpoint (see Part B). The default is `"qwen"`.
6. **Runtime → Run all.** Keep the tab active (Colab disconnects idle sessions).

### A2. Apple Silicon Mac

```bash
bash ml/run_mac.sh                        # venv → install → timing → train → merge → GGUF → eval
# variants:
DRY_RUN=1 bash ml/run_mac.sh              # just time a few steps and print the ETA
BASE=mit  bash ml/run_mac.sh              # LoRA on top of MIT's edited Qwen (RikiyaT/Qwen3.5-0.8B-weight-space-programming)
TRAIN_ARGS="--max-len 1280" bash ml/run_mac.sh   # if it reports dropped (too-long) rows
FORCE=1   bash ml/run_mac.sh              # redo everything
```

If MPS complains about an unsupported op: `export PYTORCH_ENABLE_MPS_FALLBACK=1`.

### What training does (defaults)

- **Base model:** `Qwen/Qwen3.5-0.8B` (Apache-2.0). It's multimodal (`Qwen3_5ForConditionalGeneration`), so the vision tower is left untouched. It has 24 layers: 18 Gated DeltaNet linear-attention layers and 6 full-attention layers.
- **LoRA:** r=16, alpha=32, dropout 0.05, target `all-linear` (vision excluded).
- **Schedule:** lr 2e-4 with cosine decay and warmup, 2 epochs, effective batch 8, max length 1024.
- **Loss:** on the assistant answer only (the prompt is masked). Chat template default (Qwen3.5-0.8B is non-thinking by default); if the printed prompt tail shows an open `<think>` block, pass `--enable-thinking false`.
- **Precision:** CUDA uses fp32 weights with fp16 autocast (T4 has no bf16). MPS uses fp32. Missing `flash-linear-attention` / `causal-conv1d` only means slower training.
- **Outputs:** the adapter each epoch → `ml/out/merged` (the merged model) → GGUF.

---

## 3. Part B: Weight-space editing (MIT-style, optional)

### Background

MIT CSAIL ("Sparks of Weight-Space Programming", Takehi, Teoh, Zhang and Khattab, Nov 2026, https://rikiyat.github.io/blog/weight-space-programming/) had GPT-6 Astra **edit Qwen3.5-0.8B's weights directly**, with no gradient training and a budget of 50 forward passes.

- **Diagnosis:** Astra traced looping to one direction written by the MLPs of layers 15 and 19.
- **Edit:** it subtracted that direction from 64 output columns of `mlp.down_proj` in each layer. That is 131,072 weights, 0.016% of the model.
- **Results:** MATH-500 went from 7.9 to 48.1, GSM8K from 13.8 to 67.1, and IFEval from 21.0 to 62.3. The token-limit hit rate fell from 93% to 33%.
- **Checkpoint:** `RikiyaT/Qwen3.5-0.8B-weight-space-programming` (only those two tensors differ from the base).
- **Limits:** it didn't help Gemma 3 270M. Editing removes obstacles; it can't add abilities. Those numbers were measured with **thinking on**. Bloop runs thinking-off with short JSON, so the gains may not transfer. Measure it.

### Your job (as the editor)

Find what makes the Bloop model fail on Bloop's tasks and fix it with **small, targeted, reversible weight edits**, using the harness in `ml/wsp/`. Read `ml/wsp/README.md` first. It's the source of truth for the exact API.

```python
import sys; sys.path.insert(0, "ml/wsp")
from harness import Workspace
import presets

ws = Workspace(model="ml/out/merged", data_dir="ml/data", budget=50)   # or model="qwen" (plain base) / "mit" (MIT's edit)
base = ws.generate("dev")                         # costs budget; .metrics, .failures(), .loopers(), .show(i)
acts = ws.activations(texts, layers=[...], site="mlp_out")
d    = ws.contrast_direction(good_texts, bad_texts, layer=L, site="mlp_out")   # unit vector, good → bad
ws.logit_lens(d)                                  # free: tokens the direction promotes / suppresses
cols = ws.top_columns(L, d, k=64)                 # free
eid  = ws.edit_subtract_direction(L, d, columns=cols, strength=1.0)   # W[:,J] -= s·d(dᵀW[:,J])
ws.revert(eid); ws.revert_all(); ws.diff_summary(); ws.notes("why")
presets.apply_mit_edit(ws, mode="delta")          # MIT's edit as a baseline to beat
presets.find_loop_direction(ws)                   # automated version of MIT's diagnosis
ws.final_test()                                   # ONE shot on the locked eval split (not charged)
ws.save("ml/out/wsp")                             # model/ + patch.safetensors + edits.json + EDIT_REPORT.md + notes.md
```

### Procedure (50 forward passes)

**Budget unit:** 1 pass = up to 64 generations, or 128 activation reads. The harness enforces the budget.

1. **Setup:** check the GPU or MPS, load the model, print `ws.status()`.
2. **Baseline (~4 passes):** run `ws.generate("dev")` and record the metrics. Keep 5 failures and 5 successes per task. Classify the failures: invalid JSON, prose or code fences, leaked `<think>`, loops, wrong schema, blocks after the deadline, outside 08:00–22:00, nudge over 60 characters.
3. **MIT baseline (~4 passes):** `presets.apply_mit_edit(ws, mode="delta")`, re-score `dev`, note the result, then `ws.revert_all()`.
4. **Diagnose (~15 passes):** for the most common failure, compare activations of good vs bad outputs across layers. Rank layers by separation, and inspect the top directions with `logit_lens` (free). Directions promoting "```", "Sure", "<think>" or newline loops are good candidates. Write the hypothesis in `ws.notes(...)` **before** editing.
5. **Edit and verify (~20 passes):** apply the smallest edit (1–2 layers, k ≤ 64, strength 0.5–1.0) and re-score `dev`. Keep it only if the headline metric improves **and** nothing else drops by more than 2 points; otherwise revert. Keep total change under 0.05% (the hard cap is 0.1%). One clean edit beats many small ones.
6. **Final:** run `ws.final_test()` **once**, then `ws.save("ml/out/wsp")`.

**Headline metric:** schema-valid plan rate **without** a grammar. After that: the rule pass rate, then the nudge pass rate.

If no edit beats the baseline, **ship nothing from Part B** and say so.

---

## 4. Part C: Convert, evaluate, publish

### Convert and quantize

```bash
bash ml/train/convert_quantize.sh --src ml/out/merged    --name bloop        # → ml/out/bloop-qwen3.5-0.8b-Q4_K_M.gguf
bash ml/train/convert_quantize.sh --src ml/out/wsp/model --name bloop-edit   # only if Part B produced a keeper
```

`run_mac.sh` and the Colab notebook already do the first line. The script prints the size and sha256.

### Evaluate (base vs MIT edit vs tuned vs tuned+edit)

```bash
python ml/train/eval.py                                   # base + tuned (default)
python ml/train/eval.py --tuned-edit-gguf ml/out/bloop-edit-qwen3.5-0.8b-Q4_K_M.gguf --mit-gguf ml/out/mit-qwen3.5-0.8b-Q4_K_M.gguf
```

It writes `ml/eval/REPORT.md` and fills the eval table in `ml/MODEL_CARD.md`. Each variant runs with and without the JSON-schema grammar (the app uses the grammar).

### Quick smoke test

```bash
ml/cache/llama.cpp/build/bin/llama-cli -m ml/out/bloop-qwen3.5-0.8b-Q4_K_M.gguf -p "give me a one-line nudge, I'm on youtube" -n 40 -no-cnv
```

### Ship it inside the app (default; no hosting, no token)

Publishing is optional. By default the GGUF goes **inside Bloop**, and the app keeps it off until the user picks **Use Bloop model** in Settings → AI:

```bash
npm run model:bundle     # copies the newest ml/out/bloop-*-Q4_K_M.gguf (or the path you pass) to resources/models/
npm run build            # electron-builder copies resources/models/ into the app
```

`model:bundle` prints the size and sha256 and writes `resources/models/bloop-model.json`, which the app uses to show info and to verify the file the first time it is turned on. Both the `.gguf` and the json are gitignored; GitHub rejects files over 100 MB, so don't commit the model. Expect the app to grow by about 500 MB. A build with no `.gguf` there still succeeds (it just warns); users of that build can use **Import .gguf…**.

### Publish (optional, needs YOUR Hugging Face token; agents must ask)

Bundling is the default way to ship a fine-tuned model; publishing is optional. The app's **Download** button is already enabled: the constants at the top of `src/main/ai/local/bloop.ts` point by default at the stock `unsloth/Qwen3.5-0.8B-GGUF` Q4_K_M build. Publish only if you want that button to fetch your fine-tuned model instead (or besides bundling):

```bash
hf auth login                      # paste a WRITE token from https://huggingface.co/settings/tokens
bash ml/publish.sh <hf-username>   # uploads GGUF + MODEL_CARD.md to <user>/bloop-qwen3.5-0.8b-GGUF
```

**This creates a PUBLIC repo** unless you set `PRIVATE=1` (`PRIVATE=1 bash ml/publish.sh <hf-username>`). The notebook's publish cell likewise creates a public repo unless you add `private=True` to `create_repo(...)`. The app can only download from a public repo.

It prints the three values the app needs:

```
BLOOP_MODEL_URL    = https://huggingface.co/<user>/bloop-qwen3.5-0.8b-GGUF/resolve/main/bloop-qwen3.5-0.8b-Q4_K_M.gguf
BLOOP_MODEL_SHA256 = <sha256>
BLOOP_MODEL_BYTES  = <size in bytes>
```

These constants **replace** the ones at the top of `src/main/ai/local/bloop.ts`, so the in-app **Download** button fetches your model instead of the stock one (used only when no model is bundled).

- **Visibility:** the repo must be **public** for the app to download it without a token (a private repo is fine if you only bundle or import). Qwen3.5 is Apache-2.0, so redistribution is allowed.
- **Not bundling or publishing?** Load the `.gguf` in Bloop via **Settings → AI → Use Local → Bloop model → Import .gguf…**

### Ollama (optional)

```bash
ollama create bloop -f ml/Modelfile      # expects ./out/bloop-qwen3.5-0.8b-Q4_K_M.gguf relative to ml/
ollama run bloop "give me a one-line nudge, I'm on reddit"
```

The Modelfile template was written by hand. Compare it with `ollama show qwen3.5 --template`.

---

## 5. Report back

Paste this back to whoever is integrating the app:

- **The local path, size and sha256 of the `.gguf`**, and confirmation that `npm run model:bundle` then `npm run build` worked (the default). Only if you published it: **`BLOOP_MODEL_URL`**, **`BLOOP_MODEL_SHA256`**, **`BLOOP_MODEL_BYTES`**
- **Base used:** `qwen` or `mit`
- **Training:** final train and eval loss, plus any dropped rows
- **The `ml/eval/REPORT.md` table:** schema-valid %, rule pass %, nudge pass %, loop / token-limit %, and latency for every variant, with and without the grammar
- **Part B, if run:** the edit (layers, site, k, strength, # params changed, % of the model, logit-lens tokens), forward passes used, and dev vs final-test numbers
- **Recommendation:** which GGUF to ship, and why
- **Errors and workarounds**

---

## 6. Rules for agents

- **Free hardware only:** use the free T4. Don't buy Colab compute units or upgrade.
- **Leave the data and model alone:** don't change the dataset, the prompt format, or the base model choice (beyond `qwen` vs `mit`).
- **Part B is edits only:** no gradient training in Part B, only harness edits. Never exceed 50 passes. Call `final_test()` exactly once, and never look at the `test` split before it.
- **Protected weights:** never edit the embeddings, the unembedding or the vision tower. Keep every edit reversible, with a reason in `ws.notes`.
- **Tokens:** never invent, store or print a token. **Stop and ask** for the Hugging Face token at publishing time. Create the HF repo **private** unless the user wants the app to download it (then public). Note `ml/publish.sh` and the notebook publish cell default to public; use `PRIVATE=1` / `private=True` otherwise.
- **No private-repo clones:** don't clone the GitHub repo (it's private). Use the files unpacked from this playbook.
- **Stop on repeated failure:** if a step fails twice, stop and show the full error output.
- **Be honest:** if fine-tuning or editing doesn't beat the base, say so and recommend what to ship.

---

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| `ImportError: Found an incompatible version of torchao` (Colab) | `!pip uninstall -y torchao`, then re-run. Training doesn't use torchao, and Colab ships an old one that new peft rejects. |
| `qwen3_5` / `Qwen3_5ForConditionalGeneration` not found | `pip install -U "transformers>=5.2"` (needs a recent transformers) |
| `flash-linear-attention` / `causal-conv1d` won't install | Skip them. Training still works, just slower. |
| CUDA out of memory on T4 | `--max-len 768`, or lower the grad-accum micro-batch. Close other notebooks. |
| "dropped N rows (too long)" | Add `--max-len 1280` (the dataset's token counts were estimated). |
| MPS: op not implemented | `export PYTORCH_ENABLE_MPS_FALLBACK=1` |
| Batched generation garbage in the harness (Gated DeltaNet + left padding) | Set `ws.gen_batch_size = 1` |
| `convert_hf_to_gguf.py` rejects the arch | `git -C ml/cache/llama.cpp pull`, then re-run. Qwen3.5 GGUFs exist upstream (ggml-org/Qwen3.5-0.8B-GGUF), so it's supported. |
| Colab disconnected | Re-run. `run_mac.sh` and the notebook skip finished steps when outputs exist. |
| Plan outputs include `<think>` | Make sure thinking is off (`enable_thinking=False`). The kit uses the template default; add `--enable-thinking false` to `train_lora.py` (e.g. via `TRAIN_ARGS`). |

---

## 8. Background

### The two tasks (what "good" means)

1. **Study plan.** The prompt is exactly `buildPrompt()` from `src/main/plan.ts`. The answer must be **only** JSON:
   `{"summary": "<2–3 encouraging sentences>", "blocks": [{"day": 0-6, "time": "HH:MM", "minutes": n, "label": "..."}]}`
   - 3–10 blocks
   - between 08:00 and 22:00, ending by 22:00
   - blocks before their deadline's weekday
   - minutes roughly multiples of the pomodoro length
   - plans sized to recent habits
2. **Nudge line.** A one-liner of 60 characters or fewer, casual, lowercase, at most one emoji. Variants: drifted to a distracting site/app, welcome back, break time, back to work, session done. The prompt formats are in `ml/README-data.md`.

The scoring code is `ml/train/scoring.py`. The same checks are used by the dataset validator, `eval.py` and the harness.

### The dataset (`ml/data/`)

- **Size:** 240 train and 30 eval examples. Plans are 80% (70% normal, 10% robustness cases); nudges are 20%.
- **Coverage:** every weekday as "today", 4 pomodoro settings (25/5, 50/10, 30/5, 45/15), 14 courses, 0–5 deadlines, empty to busy weeks, and 6 time zones. 171 hand-written nudge lines.
- **Prompt fidelity:** plan prompts are rendered by the app's own `buildPrompt()` (via esbuild) and cross-checked byte-for-byte against a Python re-implementation.
- **Quality:** 100% pass on every scoring check, with no train/eval overlap. Fixed seed; `train.jsonl` sha256 is `56346fe0…fd13`.
- **Known limits:** plans come from rules (templated summaries), no plan has more than 6 blocks (to keep examples short), and the "habit" signal comes from the clock in "Today is…".

### The app side (for context)

Bloop's **Settings → AI** has **Auto / Use Local / Cloud**.

- **Use Local → Bloop model:** this GGUF, bundled in the app (`resources/models/`) and off until the user picks **Use Bloop model** (or imported, or downloaded after a confirmation (the URL points at the stock model by default)), run with node-llama-cpp using the JSON-schema grammar and thinking off.
- **Use Local → Ollama models:** detected separately, with a pull offer behind a confirmation.
- **Cloud:** Claude / Codex / Gemini CLIs, plus Anthropic / OpenRouter keys.
- **Auto order:** Bloop model (only once the user turned it on) → Ollama → cloud. It never downloads anything by itself.

---

## Appendix: embedded files

Each file below is wrapped as `<!-- FILE: path sha256=… nl=… -->` followed by a six-backtick fence. The [unpack command](#0-unpack-the-kit) extracts and verifies all of them. Don't edit them by hand inside this Markdown, or the checksums will fail. Edit the unpacked copies instead.

| File | Bytes |
|---|---|
| `docs/codex-colab-prompt.md` | 8,442 |
| `docs/codex-weight-space-prompt.md` | 7,387 |
| `ml/MODEL_CARD.md` | 3,003 |
| `ml/Modelfile` | 1,271 |
| `ml/README-data.md` | 7,183 |
| `ml/README.md` | 6,142 |
| `ml/colab/train_bloop.ipynb` | 13,043 |
| `ml/data/READY` | 163 |
| `ml/data/build_dataset.py` | 33,036 |
| `ml/data/eval.jsonl` | 53,891 |
| `ml/data/nudge_lines.py` | 9,549 |
| `ml/data/render_prompts.cjs` | 1,778 |
| `ml/data/train.jsonl` | 433,149 |
| `ml/data/validate.py` | 10,866 |
| `ml/publish.sh` | 2,550 |
| `ml/run_mac.sh` | 6,865 |
| `ml/train/convert_quantize.sh` | 3,911 |
| `ml/train/eval.py` | 14,658 |
| `ml/train/requirements.txt` | 442 |
| `ml/train/scoring.py` | 11,227 |
| `ml/train/test_eval_helpers.py` | 2,036 |
| `ml/train/test_scoring.py` | 7,721 |
| `ml/train/test_train_helpers.py` | 1,818 |
| `ml/train/train_lora.py` | 25,648 |
| `ml/wsp/README.md` | 13,240 |
| `ml/wsp/apply_patch.py` | 5,341 |
| `ml/wsp/harness.py` | 46,365 |
| `ml/wsp/presets.py` | 12,495 |
| `ml/wsp/session.ipynb` | 13,077 |
| `ml/wsp/test_harness_pure.py` | 19,193 |
| `ml/wsp/wsp_core.py` | 32,033 |
| `src/main/plan.ts` | 9,040 |

### `docs/codex-colab-prompt.md`

<!-- FILE: docs/codex-colab-prompt.md sha256=1fe2576b4972268ded3e193f97eae1138a7f4d99c04cf1fbde2ceb807c53083e nl=1 -->
``````markdown
# Brief for Codex (or any browser agent): train the Bloop model on Google Colab

Copy everything below the line into Codex. It's written to work in Codex with browser control, or in any agent that can drive a browser. Before you start:

- The repo is pulled locally, including `ml/data/train.jsonl`, `ml/data/eval.jsonl` and the `ml/colab/train_bloop.ipynb` notebook. Both already exist in the repo (the dataset is validated: 240 train / 30 eval rows).
- You're signed in to Google in the browser.
- You have a free Hugging Face account, if you want the model published.

---

## Goal

Fine-tune **Qwen/Qwen3.5-0.8B** (https://huggingface.co/Qwen/Qwen3.5-0.8B) with LoRA on the Bloop dataset, using a **free Google Colab T4 GPU**. Then merge it, convert it to **GGUF**, quantize it to **Q4_K_M** (about 500 MB), and either publish it to Hugging Face or download the `.gguf`. Report back the download URL, the sha256 and the byte size.

## Files (in the local repo)

- Notebook: `ml/colab/train_bloop.ipynb`
- Training data: `ml/data/train.jsonl` and `ml/data/eval.jsonl`. These are chat JSONL: `{"messages":[{"role":"user",...},{"role":"assistant",...}]}`
- If the notebook doesn't exist yet, use the fallback cells at the bottom of this brief.

## Steps

1. Open https://colab.research.google.com and go to **File → Upload notebook**. Upload `ml/colab/train_bloop.ipynb`. Without the notebook, choose **New notebook** instead.
2. Choose **Runtime → Change runtime type → Hardware accelerator: T4 GPU → Save**. Run `!nvidia-smi` and confirm it shows a Tesla T4. If no GPU is available (quota), stop and tell me.
3. The repo is **private**, so the notebook's `git clone` cell will fail without credentials. Don't paste a GitHub token. Instead:
   - On the local machine, zip the kit **without** heavy folders: `cd <repo> && zip -r bloop-ml.zip ml -x 'ml/.venv/*' 'ml/out/*' 'ml/cache/*'`
   - In Colab's **Files** sidebar (folder icon), upload `bloop-ml.zip`, then run a cell: `!mkdir -p /content/StudyPet && unzip -o -q /content/bloop-ml.zip -d /content/StudyPet && ls /content/StudyPet/ml`
   - Skip or let the clone cell no-op: it only clones if `/content/StudyPet` doesn't exist. The data is inside the zip at `ml/data/train.jsonl` and `ml/data/eval.jsonl`. If the notebook asks you to upload them separately, upload those two files to `/content/`.
4. Run the notebook cells top to bottom: **Runtime → Run all**, or one at a time. Wait for each cell to finish and read its output before going on.
   - The install cell may print dependency warnings. Those are fine unless a later import fails.
   - If `flash-linear-attention` or `causal-conv1d` fails to install, skip it. Training just runs slower.
   - The training cell prints an ETA after a few timing steps. On a T4, expect about 15–25 minutes. Keep the tab active, because Colab disconnects idle sessions.
   - If a cell runs out of memory, re-run the training cell with `--max-len 768 --grad-checkpointing` (keep `--micro-batch 1`).
5. Check the conversion cell's output: there should be a file named `bloop-qwen3.5-0.8b-Q4_K_M.gguf` of about 400–600 MB. Copy the printed **sha256** and **size in bytes**.
6. Optional sanity check: run the quick-test cell (`llama-cli`) and confirm it prints a short, sensible reply or valid JSON.
7. Publish, if I want it hosted:
   - Before running the publish cell, change its `create_repo(repo_id, repo_type="model", exist_ok=True)` to add `private=True`. The notebook creates a PUBLIC repo by default, which conflicts with the rules below. Then run it; it calls `huggingface_hub.login()`.
   - **Stop and ask me for my Hugging Face write token. Never invent one, never store it in the notebook, and only paste it into the login prompt.**
   - It creates `<my-hf-username>/bloop-qwen3.5-0.8b-GGUF` and uploads the GGUF and the model card.
   - Copy the printed resolve URL. It looks like `https://huggingface.co/<user>/bloop-qwen3.5-0.8b-GGUF/resolve/main/bloop-qwen3.5-0.8b-Q4_K_M.gguf`
8. If I don't want to publish, download the `.gguf` instead: right-click it in the Files sidebar and choose **Download**. Save it somewhere I can find it.
9. If it ran, copy the eval summary table (base vs fine-tuned: JSON-valid %, schema-valid %, rule checks, latency).

## Report back

- `BLOOP_MODEL_URL` = the resolve URL, or "downloaded locally at <path>"
- `BLOOP_MODEL_SHA256` = the sha256
- `BLOOP_MODEL_BYTES` = the size in bytes
- The final training loss and eval loss, plus the eval table if it ran
- Any errors you hit and how you worked around them

## Rules

- Use only the free T4 runtime. Don't buy Colab compute units or upgrade.
- Don't change the dataset or the model choice.
- Don't share the token or the notebook publicly. Make the Hugging Face repo public only if I say so; otherwise create it private.
- If a step fails twice, stop and show me the error output.

## Fallback cells (only if `ml/colab/train_bloop.ipynb` isn't there)

```python
# 1. install
!pip -q install -U "transformers>=5.2,<6" peft datasets accelerate huggingface_hub  # Qwen3.5 needs transformers >= 5.2 (see ml/train/requirements.txt)
!pip -q install flash-linear-attention causal-conv1d || true
```

```python
# 2. train (LoRA, loss on the assistant reply only) + merge
import torch
from datasets import load_dataset
from transformers import AutoTokenizer, AutoModelForCausalLM
from peft import LoraConfig, get_peft_model
BASE = "Qwen/Qwen3.5-0.8B"
tok = AutoTokenizer.from_pretrained(BASE)
model = AutoModelForCausalLM.from_pretrained(BASE, torch_dtype=torch.float32).cuda()
model = get_peft_model(model, LoraConfig(r=16, lora_alpha=32, lora_dropout=0.05, target_modules="all-linear", task_type="CAUSAL_LM"))
def encode(ex):
    m = ex["messages"]
    prompt = tok.apply_chat_template(m[:-1], tokenize=False, add_generation_prompt=True)
    p = tok(prompt, add_special_tokens=False)["input_ids"]
    ids = tok(prompt + m[-1]["content"] + tok.eos_token, add_special_tokens=False, truncation=True, max_length=1024)["input_ids"]
    return {"input_ids": ids, "labels": ([-100] * len(p) + ids[len(p):])[:len(ids)]}
ds = load_dataset("json", data_files={"train": "/content/train.jsonl", "eval": "/content/eval.jsonl"})
train = ds["train"].map(encode, remove_columns=ds["train"].column_names)
opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=2e-4)
scaler = torch.amp.GradScaler(); model.train(); accum = 8
for epoch in range(2):
    for i, ex in enumerate(train.shuffle(seed=epoch)):
        x = torch.tensor([ex["input_ids"]]).cuda(); y = torch.tensor([ex["labels"]]).cuda()
        with torch.autocast("cuda", dtype=torch.float16):
            loss = model(input_ids=x, labels=y).loss / accum
        scaler.scale(loss).backward()
        if (i + 1) % accum == 0: scaler.step(opt); scaler.update(); opt.zero_grad()
        if i % 40 == 0: print(epoch, i, round(loss.item() * accum, 3))
model = model.merge_and_unload(); model.save_pretrained("bloop-merged"); tok.save_pretrained("bloop-merged")
```

```python
# 3. GGUF + Q4_K_M
!git clone --depth 1 https://github.com/ggml-org/llama.cpp
!pip -q install -r llama.cpp/requirements.txt
!python llama.cpp/convert_hf_to_gguf.py bloop-merged --outtype f16 --outfile bloop-f16.gguf
!cmake -S llama.cpp -B llama.cpp/build && cmake --build llama.cpp/build --target llama-quantize llama-cli -j4
!llama.cpp/build/bin/llama-quantize bloop-f16.gguf bloop-qwen3.5-0.8b-Q4_K_M.gguf Q4_K_M
!ls -l bloop-qwen3.5-0.8b-Q4_K_M.gguf && sha256sum bloop-qwen3.5-0.8b-Q4_K_M.gguf
```

```python
# 4. publish (ASK THE USER FOR THEIR TOKEN)
from huggingface_hub import login, create_repo, upload_file, whoami
login()
repo = f"{whoami()['name']}/bloop-qwen3.5-0.8b-GGUF"
create_repo(repo, private=True, exist_ok=True)
upload_file(path_or_fileobj="bloop-qwen3.5-0.8b-Q4_K_M.gguf", path_in_repo="bloop-qwen3.5-0.8b-Q4_K_M.gguf", repo_id=repo)
print(f"https://huggingface.co/{repo}/resolve/main/bloop-qwen3.5-0.8b-Q4_K_M.gguf")
```

Note: a **private** Hugging Face repo can't be downloaded by the Bloop app without a token. If the app should download the model directly, make the repo public (and check that Qwen's license allows redistribution), or load the `.gguf` into Bloop with **Settings → AI → Use Local → Bloop model → Import .gguf…**. (Bloop already ships with a download link to the stock Qwen3.5-0.8B GGUF in `src/main/ai/local/bloop.ts`; the three values above replace it.)
``````

### `docs/codex-weight-space-prompt.md`

<!-- FILE: docs/codex-weight-space-prompt.md sha256=69d4a632c098b9177b131fae854ef3bb00144af05c7c2782465c8e57e8896f05 nl=1 -->
``````markdown
# Brief for Codex: weight-space editing of the Bloop model (MIT-style)

Use this **after** the training run from `docs/codex-colab-prompt.md` has finished. You need the merged Bloop model the training run writes to `ml/out/merged` (it's never in git; it's created in the same workspace), or the plain base model. Paste everything below the line into Codex. It works in Colab on a free T4 (upload `ml/` as a zip, same as the training brief) or on an Apple Silicon Mac (`ml/.venv`).

---

## Background

MIT CSAIL showed that an LLM can improve another model by **editing its weights directly**, with no gradient training. Source: "Sparks of Weight-Space Programming", Takehi, Teoh, Zhang and Khattab, Nov 2026, https://rikiyat.github.io/blog/weight-space-programming/

- **Setup:** GPT-6 Astra had a Python session holding Qwen3.5-0.8B's weights and a budget of 50 forward passes on practice problems.
- **Diagnosis:** it traced Qwen's looping to one direction written by the MLPs of layers 15 and 19.
- **Edit:** it subtracted that direction from 64 output columns of `mlp.down_proj` in each layer. That is 131,072 weights, 0.016% of the model.
- **Result:** MATH-500 went from 7.9 to 48.1 and IFEval from 21.0 to 62.3.
- **Checkpoint:** `RikiyaT/Qwen3.5-0.8B-weight-space-programming`.
- **Limitation:** editing removes obstacles that hide an ability. It can't add an ability the model lacks; it didn't help Gemma 3 270M.

**Your job:** do the same for **Bloop's** tasks. You are the editor. Find what makes the Bloop model fail, and fix it with small, targeted, reversible weight edits.

## Bloop's tasks (what "better" means)

The model runs with **thinking OFF**, short outputs and greedy decoding:

1. **Study plan:** the prompt is `buildPrompt()` in `src/main/plan.ts`. The output must be ONLY JSON: `{"summary": str, "blocks": [{"day": 0-6, "time": "HH:MM", "minutes": n, "label": str}]}`, with 3–10 blocks between 08:00 and 22:00, blocks before their deadline's weekday, and minutes roughly multiples of the pomodoro length.
2. **Nudge lines:** a one-liner of 60 characters or fewer, casual, encouraging, with at most one emoji. The format is in `ml/README-data.md`.

Scoring lives in `ml/train/scoring.py`: JSON valid, schema valid, rule checks, nudge length, plus loop and length indicators. The headline metric is **schema-valid plan rate with no grammar** (raw ability). Then the rule-check pass rate. Then nudge pass rate.

## Tools

Use `ml/wsp/harness.py` (read `ml/wsp/README.md` first) from a Python REPL or `ml/wsp/session.ipynb`:

```python
import sys; sys.path.insert(0, "ml/wsp")
from harness import Workspace
import presets
ws = Workspace(model="ml/out/merged", data_dir="ml/data", budget=50)   # or model="qwen" (plain base) / "mit" (MIT's edit)
base = ws.generate("dev")                    # costs budget; returns outputs + per-example scores
acts = ws.activations(texts, layers=[...], site="mlp_out")
d    = ws.contrast_direction(good_texts, bad_texts, layer=L, site="mlp_out")
ws.logit_lens(d)                             # free: which tokens the direction promotes
cols = ws.top_columns(L, d, k=64)
eid  = ws.edit_subtract_direction(L, d, columns=cols, strength=1.0)
ws.revert(eid); ws.diff_summary(); ws.notes("why I did this")
presets.apply_mit_edit(ws, mode="delta")     # MIT's own edit, as a baseline to beat
ws.final_test()                              # ONE shot on the locked eval set (not charged to budget)
ws.save("ml/out/wsp")                       # model/ + patch.safetensors + edits.json + EDIT_REPORT.md + notes.md
```

If the harness's exact names differ from these, follow `ml/wsp/README.md`. It's the source of truth.

## Procedure

1. **Setup:** check the GPU or MPS, load the model, and print the budget.
2. **Baseline (about 4 passes):** generate on `dev`. Record the metrics and save 5 failures and 5 successes per task. Classify the failures: invalid JSON, extra prose or code fences, a leaked `<think>`, loops or repetition, wrong schema, blocks after a deadline, times outside 08:00–22:00, nudges too long, and so on.
3. **MIT baseline (about 4 passes):** `presets.apply_mit_edit(ws, mode="delta")`, re-score on `dev`, write a note, then `revert_all()`. You now know whether MIT's loop fix helps Bloop's thinking-off tasks.
4. **Diagnose (about 15 passes):** for the most common failure type, build matched good vs bad sets.
   - Take activations at the MLP output and the residual stream across layers.
   - Rank layers by how well a difference-of-means direction separates good from bad.
   - Inspect top directions with `logit_lens` (free). For example, a direction promoting "```", "Sure", "<think>" or newline loops is a strong candidate.
   - Write down your hypothesis with `ws.notes(...)` before editing.
5. **Edit and verify (about 20 passes):**
   - Apply the smallest edit that tests the hypothesis: one or two layers, k ≤ 64 columns, strength 0.5–1.0.
   - Re-score on `dev`. Keep the edit only if the headline metric improves **and** nothing else regresses by more than 2 points (check the nudges too).
   - Otherwise `revert` it and try the next hypothesis.
   - Keep the total change under 0.05% of parameters. The harness hard-caps at 0.1%.
   - Prefer one clean edit over many small ones.
6. **Final:** call `ws.final_test()` once on the best configuration, then `ws.save("ml/out/wsp")`.
7. **Export:** `bash ml/train/convert_quantize.sh --src ml/out/wsp/model --name bloop-edit`, then `python ml/train/eval.py --tuned-edit-gguf ml/out/bloop-edit-qwen3.5-0.8b-Q4_K_M.gguf` (add `--mit-gguf` if you converted MIT's checkpoint) to compare **base, mit-edit, bloop-tuned and bloop-tuned+edit** (with and without the JSON grammar). Print the size and sha256 of the final GGUF. See `ml/wsp/README.md` for exact flags.
8. **Optional:** retrain the LoRA on top of MIT's checkpoint: `BASE=RikiyaT/Qwen3.5-0.8B-weight-space-programming bash ml/run_mac.sh`, or set `BASE` in the Colab notebook. Compare it in the same eval.

## Rules

- **No gradient training in this session.** Only direct weight edits through the harness. LoRA training belongs to the separate training brief.
- **Budget:** never exceed 50 forward passes (1 pass = up to 64 generations or 128 activation reads; the harness enforces it). Don't look at the `test` split before `final_test()`, and call it exactly once.
- **Edits stay small:** never edit embeddings, the unembedding or the vision tower.
- **Reversible:** every edit must stay reversible and logged with a reason in `ws.notes`.
- **Honest results:** if no edit beats the baseline, say so and ship nothing. If the MIT edit or plain fine-tuning is better, recommend that.
- **Don't publish anything.** If uploading to Hugging Face is needed, stop and ask me for a token. Never invent one.
- **Two failures:** if a step fails twice, stop and show me the error.

## Report back

- **Metrics table:** dev and final-test results (schema-valid %, rule pass %, nudge pass %, loop/token-limit %, latency) for base, MIT edit, your edit, and tuned plus edit.
- **The edit:** layers, site, k, strength, # params changed, % of the model, and the logit-lens tokens that explain it.
- **Budget:** how many forward passes you used.
- **Output:** the path of `ml/out/wsp`, the patch file (`patch.safetensors`), and the GGUF size and sha256.
- **Recommendation:** which variant Bloop should ship, and why.
``````

### `ml/MODEL_CARD.md`

<!-- FILE: ml/MODEL_CARD.md sha256=a416fe8de72060274518c3f4a8e805000bfe470e2adb80b77ebb30397e9304a5 nl=1 -->
``````markdown
---
license: apache-2.0
base_model: Qwen/Qwen3.5-0.8B
library_name: gguf
language:
  - en
tags:
  - gguf
  - lora
  - study
  - qwen3.5
  - llama.cpp
pipeline_tag: text-generation
---

# Bloop model (Qwen3.5-0.8B, LoRA fine-tuned, GGUF Q4_K_M)

The small on-device model behind **Bloop**, a desktop study-pet app. It is [Qwen/Qwen3.5-0.8B](https://huggingface.co/Qwen/Qwen3.5-0.8B) lightly fine-tuned with LoRA, merged, converted to GGUF and quantized to Q4_K_M (about 500 MB). The license follows the base model (Apache-2.0 on the base repo at the time of writing; check it if you redistribute).

## Intended use

Two narrow jobs inside Bloop, both running locally with llama.cpp:

1. **Weekly study plan.** Given upcoming deadlines, the last 7 days of focus stats and the pomodoro length, reply with a single JSON object `{"summary": "...", "blocks": [{"day": 0-6, "time": "HH:MM", "minutes": n, "label": "..."}]}` with 3-10 blocks between 08:00 and 22:00, blocks before the nearest deadline, and lengths that are roughly multiples of the pomodoro.
2. **Nudge lines.** One short, kind sentence (60 characters or fewer) when the student drifts off task.

It is not a general chat model, and nothing here is medical, academic or legal advice. For best results use the app's own prompts and (for plans) a JSON-schema grammar in llama.cpp.

## Data

Synthetic prompt/answer pairs in the exact prompt formats the app uses. See [`ml/README-data.md`](README-data.md) in the Bloop repository for how the data was built, its size and its prompt formats.

## Training

| | |
|---|---|
| Base | Qwen/Qwen3.5-0.8B (hybrid Gated DeltaNet + attention, 24 layers) |
| Method | LoRA, r=16, alpha=32, dropout 0.05, target `all-linear` (language model only) |
| Loss | assistant tokens only (chat template, `add_generation_prompt=True`) |
| Sequence length | 1024 |
| Optimizer | AdamW, lr 2e-4, cosine schedule with warmup, 2 epochs, effective batch 8 |
| Precision | fp16 autocast on CUDA (T4), fp32 on Apple MPS |
| Seed | 42 |
| Export | LoRA merged into the bf16 weights, `convert_hf_to_gguf.py --outtype f16`, `llama-quantize Q4_K_M` |

Reproduce with `bash ml/run_mac.sh` or the Colab notebook `ml/colab/train_bloop.ipynb`.

## Evaluation

Held-out eval set, llama.cpp `llama-server`, temperature 0.2. "grammar" means JSON-schema constrained decoding. This table is overwritten by `ml/train/eval.py`; the full report with samples is `ml/eval/REPORT.md`.

<!-- EVAL_TABLE_START -->
_Not evaluated yet. Run `python ml/train/eval.py`._
<!-- EVAL_TABLE_END -->

## Limits

- 0.8B parameters: plans are plausible, not optimal, and can still break the rules above. The app validates every plan and falls back gracefully.
- Trained on synthetic data in English; other languages and unusual calendars are unsupported.
- Q4_K_M quantization costs a little quality versus f16.
- Non-thinking mode only; it was not trained to reason step by step.
- It does not know your courses. Everything it knows comes from the prompt.
``````

### `ml/Modelfile`

<!-- FILE: ml/Modelfile sha256=be9c6d7fd09dde9a456cdff6a18ba290cf1ffc7f759400a1e35b1b14a3efd368 nl=1 -->
``````
# Ollama Modelfile for the Bloop model.
#   cd ml && ollama create bloop -f Modelfile && ollama run bloop
# (FROM is resolved relative to this file; run from ml/ to be safe.)
FROM ./out/bloop-qwen3.5-0.8b-Q4_K_M.gguf

# ChatML as used by Qwen3.5. Qwen3.5-0.8B runs in non-thinking mode by default, so the generation prompt
# carries an empty <think></think> block. NOTE: written from the Qwen3.5 chat template as documented, not
# diffed against Ollama's library/qwen3.5 template (not reachable from the authoring sandbox); if you see
# stray <think> text, compare with `ollama show qwen3.5 --template`.
TEMPLATE """{{- range $i, $_ := .Messages }}
{{- $last := eq (len (slice $.Messages $i)) 1 }}
{{- if eq .Role "system" }}<|im_start|>system
{{ .Content }}<|im_end|>
{{ else if eq .Role "user" }}<|im_start|>user
{{ .Content }}<|im_end|>
{{ else if eq .Role "assistant" }}<|im_start|>assistant
{{ .Content }}{{ if not $last }}<|im_end|>
{{ end }}
{{- end }}
{{- if and (ne .Role "assistant") $last }}<|im_start|>assistant
<think>

</think>

{{ end }}
{{- end }}"""

PARAMETER temperature 0.4
PARAMETER top_p 0.9
PARAMETER top_k 20
PARAMETER repeat_penalty 1.05
PARAMETER num_ctx 4096
PARAMETER num_predict 1024
PARAMETER stop "<|im_end|>"
PARAMETER stop "<|im_start|>"
``````

### `ml/README-data.md`

<!-- FILE: ml/README-data.md sha256=b831bb76d7d47e05a19e299aebfe2e9a60a6491406302d23a7879aee26806d45 nl=1 -->
``````markdown
# Bloop SFT dataset

`ml/data/train.jsonl` (240 rows) and `ml/data/eval.jsonl` (30 rows). One JSON object per line:
`{"messages":[{"role":"user","content":...},{"role":"assistant","content":...}]}`. No system prompt in the data.
`ml/data/READY` is written by `validate.py` only when everything passes; `ml/run_mac.sh` checks for it.

## Task mix

| Task | train | eval | share |
|---|---|---|---|
| Study plan (normal scenarios, 0-5 deadlines) | 168 | 21 | ~70% |
| Study plan, robustness (no history + no deadlines, deadlines today, 5-deadline crunch, only far deadlines, no history + deadlines) | 24 | 3 | ~10% |
| Nudges (drift 14/2, welcome-back 9/1, break 9/1, back-to-work 8/1, session-done 8/1) | 48 | 6 | ~20% |

Plans cover every weekday as "today" (round-robin), 6 time zones, pomodoro settings 25/5, 50/10, 30/5 and 45/15, 14 courses,
exam and assignment mixes, empty/low/sporadic/moderate/high focus histories, and morning/afternoon/evening habits.
The prompt carries no explicit habit-time info, so chronotype is tied to the clock in "Today is ..." (early now -> morning blocks, late now -> evening blocks).

## Study plan format

User message: **byte-identical output of `buildPrompt()` in `src/main/plan.ts`**. `ml/data/render_prompts.cjs` extracts `DAY_NAMES` + `buildPrompt`
from the live source, transpiles it with the repo's esbuild and runs it under `TZ=<scenario tz>`. `build_dataset.py` also re-implements the template
and `Date.toString()` in Python and asserts that every one of the 216 plan prompts matches the node output exactly.
If you change the wording in `plan.ts`, just rebuild.

Assistant message: only the JSON `{"summary": "...", "blocks": [{"day":0-6,"time":"HH:MM","minutes":n,"label":"..."}]}` (no fences, `json.dumps` default separators).
Planner rules (all checked by `scoring.py` plus extra checks in `validate.py`):

- 3-6 blocks in the data (limit is 3-10; long prompts + long answers are capped, see below), listed chronologically; times between 08:00 and 22:00 and every block ends by 22:00.
- Blocks sit only on days up to the farthest in-window deadline, studying for a deadline on the days before its due day (a block on the due day only if it ends before the due time: 60 min before for exams, 30 for assignments). Blocks never start before "now" on day 0.
- Exams count 3 days "closer" than assignments in priority; the nearest/top two items get most of their demand first.
- Daily load is `1.3 x mean focused min of the last 6 days`, clamped to [1 pomodoro, 210 min], so a quiet week gets a small plan.
- `minutes` are exact multiples of the pomodoro length.
- Summary: 2-3 short warm sentences naming the first priority, its weekday (or today/tomorrow), and the pacing reasoning.

## Nudge format

Note: today the app only calls the model for the study plan (`generateText` in `src/main/plan.ts`). The in-app pet nudges are fixed lines in `src/main/session.ts`, not model output, so these nudge prompts are a training/eval task for the model, not text the app currently sends.

User message (exact; `{...}` are filled, singular "1 minute"):

```
You are Bloop, a cute study pet. The student has been on {site} for {n} minute(s) during a focus session. Write one short, kind nudge (max 60 characters).
You are Bloop, a cute study pet. The student has been using {App} for {n} minute(s) during a focus session. Write one short, kind nudge (max 60 characters).
You are Bloop, a cute study pet. The student just came back to their study app after {n} minute(s) away. Write one short, kind welcome-back nudge (max 60 characters).
You are Bloop, a cute study pet. The student just finished a {f}-minute focus block and a {b}-minute break is starting. Write one short, kind break-time nudge (max 60 characters).
You are Bloop, a cute study pet. The student's {b}-minute break is over and the next {f}-minute focus block is starting. Write one short, kind back-to-work nudge (max 60 characters).
You are Bloop, a cute study pet. The student just finished a focus session of {m} minutes ({k} pomodoros). Write one short, kind session-complete nudge (max 60 characters).
```

None contains "study plan", so `scoring.is_plan_prompt` classifies them as nudges (scored on length <= 60, one line).
Assistant message: a single lowercase-casual line, <= 60 chars, at most one emoji. The hand-written pool is in `ml/data/nudge_lines.py`
(171 distinct lines: drift 32 generic + 18 site/app specific, welcome 32, break 29, back 30, done 30). The last 3 lines of each generic pool are
held out for eval only, so no eval target appears in train. Each line is used at most once per split.

## System prompt (TODO)

The app now sends a short system message with every request (`DEFAULT_SYSTEM_PROMPT` in `src/shared/ai.ts`, editable in Settings → AI). The rows here
were built without one, so a tuned model sees a system message at inference that it never saw in training (before this, node-llama-cpp added its own
generic default system prompt, so there was a mismatch either way). TODO for the next data build: add
`{"role":"system","content": DEFAULT_SYSTEM_PROMPT}` as the first message of every row (or of a share of rows, so the model also works without it),
read the text from `src/shared/ai.ts` the same way `render_prompts.cjs` reads `buildPrompt`, and re-run `validate.py`. Don't hand-edit the jsonl files.
`npm run model:check -- --gguf <file>` scores a build with and without it (`--no-system`).

## Regenerate / validate

```
python3 ml/data/build_dataset.py     # needs node + the repo's node_modules/esbuild; fixed seed 20261104; output is deterministic
python3 ml/data/validate.py          # scoring.py over every row; writes ml/data/READY only on a clean pass
```

`validate.py` checks: exact message schema, no duplicate prompts, no train/eval prompt or nudge-target overlap, and for plans `parsed`, `clean_json`,
`schema_valid`, `blocks_3_10`, `hours_ok`, `before_deadline`, `pomodoro_ok`, `all_rules` all 100% (before_deadline is n/a when no deadline falls in the next 7 days; applicable to
~75% of plans), plus summary sentence count, no overlaps, chronological order, nothing in the past today and nothing after a same-day due time; for nudges `le60`, one line, lowercase, <= 1 emoji, documented format.
It prints token stats (chars/3.5 and a digit-aware proxy).

## Notes for the trainer

- Token length: plans are digit-heavy (Qwen splits digits), so chars/3.5 underestimates. The generator caps prompt+answer at 900 on the digit-aware proxy, which is why no
  plan has more than 6 blocks; the default `--max-len 1024` should drop nothing. The tokenizer was not available here, so confirm with the `[data]` lines train_lora.py prints.
- Dates are in 2026-2027 and the time zones are US/UK/UTC; `Date.toString()` text is part of the prompt, so the model sees the real format.
- 240 rows is small. The plans are rule-based, so expect the model to learn the format and the rules well but write fairly templated summaries/labels.
- Unused pool lines (about 120 of 171 are not used in these 54 nudge rows) are there for adding more nudge rows: raise `NUDGE_MIX` and `MIX` in `build_dataset.py`.
``````

### `ml/README.md`

<!-- FILE: ml/README.md sha256=8a6b2dcf47a066034ac2646f79ac5c6a092a8ebb5fd9b2b5e1e4cd9abfe672ac nl=1 -->
``````markdown
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

- **In Bloop:** Settings -> AI -> Use Local -> Bloop model -> **Import .gguf…**, pick the `.gguf`. Or bundle it into the app: `npm run model:bundle` (see `resources/models/README.md`).
- **Publish for everyone:** `hf auth login`, then `npm run model:publish -- <hf-username>` (= `bash ml/publish.sh`). It uploads the GGUF and `MODEL_CARD.md` and prints `BLOOP_MODEL_URL`, `BLOOP_MODEL_SHA256` and `BLOOP_MODEL_BYTES` for `src/main/ai/local/bloop.ts` (they currently point at the stock unsloth/Qwen3.5-0.8B-GGUF build; replace them). The repo is created public unless you set `PRIVATE=1`, and a private repo cannot be downloaded by the app.
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
- **`convert_hf_to_gguf.py` complains about the architecture**: your llama.cpp checkout is too old; re-run `bash ml/train/convert_quantize.sh` (it fetches the latest `master` into `ml/cache/llama.cpp`; set `LLAMA_CPP_REF` for a specific tag, and `FORCE=1` to redo finished steps).
- **ml/data/READY not found**: the dataset is still being generated.
- **Redo a step**: delete its marker in `ml/out/.done/` or run with `FORCE=1`.
``````

### `ml/colab/train_bloop.ipynb`

<!-- FILE: ml/colab/train_bloop.ipynb sha256=33fc16e85ddb51fd9160c5dda2ce20501604791a9c4469a38266399fd6d2fb16 nl=1 -->
``````json
{
 "cells": [
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "# Train the Bloop model on a free Colab T4\n",
    "\n",
    "Fine-tunes **Qwen/Qwen3.5-0.8B** with a light LoRA on the Bloop dataset, merges it, converts it to GGUF, quantizes to **Q4_K_M** (~500 MB), evaluates it against the base model and (optionally) publishes it to Hugging Face.\n",
    "\n",
    "Run the cells top to bottom. Expected time on a T4: roughly 15-25 minutes for training plus 10-15 minutes for the llama.cpp build/convert/eval. Colab sessions are ephemeral, so download or publish the result before closing the tab.\n",
    "\n",
    "> This notebook was written without being run end to end. If a cell fails, the error message and `ml/README.md` (troubleshooting) are the first stops."
   ],
   "id": "cell00"
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "## 1. Check the runtime is a GPU\n",
    "\n",
    "Use **Runtime -> Change runtime type -> T4 GPU**. The T4 has no bfloat16, so the training script uses fp16 autocast on CUDA."
   ],
   "id": "cell01"
  },
  {
   "cell_type": "code",
   "metadata": {},
   "execution_count": null,
   "outputs": [],
   "source": [
    "import subprocess, sys\n",
    "out = subprocess.run([\"nvidia-smi\", \"--query-gpu=name,memory.total\", \"--format=csv,noheader\"], capture_output=True, text=True)\n",
    "if out.returncode != 0 or not out.stdout.strip():\n",
    "    raise SystemExit(\"No GPU found. Runtime -> Change runtime type -> T4 GPU, then re-run this cell.\")\n",
    "print(\"GPU:\", out.stdout.strip())"
   ],
   "id": "cell02"
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "## 2. Get the training kit\n",
    "\n",
    "Clones the Bloop repo (for `ml/train/*`, `ml/MODEL_CARD.md`). Change `REPO_URL` if you use a fork. If you cannot clone, upload the `ml/` folder as a zip instead and unzip it to `/content/StudyPet/ml`."
   ],
   "id": "cell03"
  },
  {
   "cell_type": "code",
   "metadata": {},
   "execution_count": null,
   "outputs": [],
   "source": [
    "REPO_URL = \"https://github.com/Bndrwe/StudyPet.git\"   # change for a fork\n",
    "import os\n",
    "if not os.path.isdir(\"/content/StudyPet\"):\n",
    "    !git clone --depth 1 {REPO_URL} /content/StudyPet\n",
    "%cd /content/StudyPet\n",
    "!ls ml ml/train"
   ],
   "id": "cell04"
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "## 3. Upload the dataset\n",
    "\n",
    "Choose `train.jsonl` and `eval.jsonl` (made by the dataset step, one `{\"messages\": [...]}` object per line). If they already exist in the repo checkout (`ml/data/`), this cell keeps them."
   ],
   "id": "cell05"
  },
  {
   "cell_type": "code",
   "metadata": {},
   "execution_count": null,
   "outputs": [],
   "source": [
    "import os, shutil\n",
    "os.makedirs(\"ml/data\", exist_ok=True)\n",
    "if not (os.path.exists(\"ml/data/train.jsonl\") and os.path.exists(\"ml/data/eval.jsonl\")):\n",
    "    from google.colab import files\n",
    "    for name, data in files.upload().items():\n",
    "        shutil.move(name, os.path.join(\"ml/data\", name))\n",
    "for f in (\"train.jsonl\", \"eval.jsonl\"):\n",
    "    p = os.path.join(\"ml/data\", f)\n",
    "    assert os.path.exists(p), f\"missing {p}: upload train.jsonl and eval.jsonl\"\n",
    "    print(f, sum(1 for _ in open(p, encoding=\"utf-8\")), \"rows\")"
   ],
   "id": "cell06"
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "## 4. Install\n",
    "\n",
    "Colab already ships PyTorch, so we install everything else (`torch` is excluded to keep the GPU build). We also try `flash-linear-attention`: Qwen3.5 mixes Gated DeltaNet (linear attention) layers with normal attention, and this package gives them a fast CUDA path. It is optional; without it training still works with the slower PyTorch fallback."
   ],
   "id": "cell07"
  },
  {
   "cell_type": "code",
   "metadata": {},
   "execution_count": null,
   "outputs": [],
   "source": [
    "!pip uninstall -y -q torchao  # Colab's old torchao (0.10) makes new peft refuse to load; we don't use it\n",
    "!grep -v '^torch' ml/train/requirements.txt > /tmp/req.txt && pip install -q -U -r /tmp/req.txt\n",
    "!pip install -q flash-linear-attention || echo \"flash-linear-attention not installed - slower fallback will be used (fine)\"\n",
    "!apt-get -qq install -y cmake > /dev/null\n",
    "import torch, transformers, peft\n",
    "print(torch.__version__, transformers.__version__, peft.__version__, torch.cuda.get_device_name(0))"
   ],
   "id": "cell08"
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "id": "base-choice-md",
   "source": [
    "## 4b. Choose the base model\n",
    "\n",
    "`BASE` is the checkpoint the LoRA starts from. The default is the plain **Qwen/Qwen3.5-0.8B**. Set it to `MIT_BASE` to train on top of MIT CSAIL's gradient-free weight edit ([blog](https://rikiyat.github.io/blog/weight-space-programming/), [checkpoint](https://huggingface.co/RikiyaT/Qwen3.5-0.8B-weight-space-programming), Apache-2.0). That edit removed a looping direction from two MLPs (layers 15 and 19); the rest is identical to Qwen. With `MIT_BASE`, section 6 also converts MIT's checkpoint so the eval compares base / mit-edit / tuned. See `ml/wsp/README.md` for editing weights yourself.\n"
   ]
  },
  {
   "cell_type": "code",
   "metadata": {},
   "id": "base-choice",
   "execution_count": null,
   "outputs": [],
   "source": [
    "QWEN_BASE = \"Qwen/Qwen3.5-0.8B\"\n",
    "MIT_BASE = \"RikiyaT/Qwen3.5-0.8B-weight-space-programming\"\n",
    "BASE = QWEN_BASE   # or MIT_BASE\n",
    "print(\"LoRA base:\", BASE)\n"
   ]
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "## 5. Time a few steps, then train and merge\n",
    "\n",
    "The first command times a few real steps and prints an ETA, then stops. The second runs the full training (2 epochs, LoRA r=16, effective batch 8, lr 2e-4 cosine), logs train/eval loss, saves the adapter to `ml/out/adapter` and the merged model to `ml/out/merged`.\n",
    "\n",
    "If you run out of GPU memory, add `--max-len 768 --grad-checkpointing`."
   ],
   "id": "cell09"
  },
  {
   "cell_type": "code",
   "metadata": {},
   "execution_count": null,
   "outputs": [],
   "source": [
    "!python ml/train/train_lora.py --base {BASE} --dry-run"
   ],
   "id": "cell10"
  },
  {
   "cell_type": "code",
   "metadata": {},
   "execution_count": null,
   "outputs": [],
   "source": [
    "!python ml/train/train_lora.py --base {BASE}"
   ],
   "id": "cell11"
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "## 6. Convert to GGUF and quantize (Q4_K_M)\n",
    "\n",
    "Clones and builds llama.cpp into `ml/cache/` (CPU build, a few minutes), converts the merged model to f16 GGUF and quantizes it. The last lines show the file size and SHA-256. The base model is converted too so the evaluation can compare the two."
   ],
   "id": "cell12"
  },
  {
   "cell_type": "code",
   "metadata": {},
   "execution_count": null,
   "outputs": [],
   "source": [
    "!bash ml/train/convert_quantize.sh --src ml/out/merged --name bloop"
   ],
   "id": "cell13"
  },
  {
   "cell_type": "code",
   "metadata": {},
   "execution_count": null,
   "outputs": [],
   "source": [
    "from huggingface_hub import snapshot_download\n",
    "snapshot_download(\"Qwen/Qwen3.5-0.8B\", local_dir=\"ml/cache/base\", allow_patterns=[\"*.json\", \"*.safetensors\", \"*.txt\", \"*.jinja\", \"*.model\"])\n",
    "!bash ml/train/convert_quantize.sh --src ml/cache/base --name base\n",
    "if BASE == MIT_BASE:  # also convert MIT's edited checkpoint so the eval compares base / mit-edit / tuned\n",
    "    snapshot_download(MIT_BASE, local_dir=\"ml/cache/mit\", allow_patterns=[\"*.json\", \"*.safetensors\", \"*.txt\", \"*.jinja\", \"*.model\"])\n",
    "    !bash ml/train/convert_quantize.sh --src ml/cache/mit --name mit\n"
   ],
   "id": "cell14"
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "## 7. Quick test with llama-cli\n",
    "\n",
    "A single prompt to see that the quantized model answers sensibly. The cell uses `-st` (single turn, then exit); on llama.cpp builds without it, use `-no-cnv` instead (e.g. `llama-cli -m … -p \"…\" -n 40 -no-cnv`). Check `llama-cli -h` if neither works."
   ],
   "id": "cell15"
  },
  {
   "cell_type": "code",
   "metadata": {},
   "execution_count": null,
   "outputs": [],
   "source": [
    "!ml/cache/llama.cpp/build/bin/llama-cli -m ml/out/bloop-qwen3.5-0.8b-Q4_K_M.gguf -st -n 60 --temp 0.4 -p \"I have been on YouTube for 4 minutes instead of studying. Write one short, kind nudge (max 60 characters).\" < /dev/null 2>/dev/null | tail -n 5"
   ],
   "id": "cell16"
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "## 8. Evaluate: base vs tuned\n",
    "\n",
    "Runs the eval set through `llama-server`, with and without a JSON-schema grammar, and writes `ml/eval/REPORT.md` (plan JSON parse / schema-valid rate, rule checks, nudge length, latency). The Colab build is CPU-only, so `--limit 25` keeps it to a few minutes. Remove it to use the whole eval set.\n",
    "\n",
    "If `ml/out/mit-qwen3.5-0.8b-Q4_K_M.gguf` (MIT's edit) or `ml/out/bloop-edit-qwen3.5-0.8b-Q4_K_M.gguf` (tuned + a weight-space edit from `ml/wsp/session.ipynb`) exist, they are added to the comparison automatically.\n"
   ],
   "id": "cell17"
  },
  {
   "cell_type": "code",
   "metadata": {},
   "execution_count": null,
   "outputs": [],
   "source": [
    "!python ml/train/eval.py --limit 25\n",
    "print(open(\"ml/eval/REPORT.md\").read()[:6000])"
   ],
   "id": "cell18"
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "## 9. Publish to Hugging Face (optional)\n",
    "\n",
    "`login()` asks for a **write** token (https://huggingface.co/settings/tokens). The cell creates `<your-user>/bloop-qwen3.5-0.8b-GGUF` (a PUBLIC repo: the cell passes no `private` flag, so add `private=True` to `create_repo(...)` to keep it private; the app can only download from a public repo), uploads the GGUF and the model card as `README.md`, then prints the three values the Bloop app needs: `BLOOP_MODEL_URL`, `BLOOP_MODEL_SHA256` and `BLOOP_MODEL_BYTES` (constants that REPLACE the ones at the top of `src/main/ai/local/bloop.ts`, which already point at the stock model). Publishing is optional; bundling is the default way to ship a fine-tuned model."
   ],
   "id": "cell19"
  },
  {
   "cell_type": "code",
   "metadata": {},
   "execution_count": null,
   "outputs": [],
   "source": [
    "import hashlib, os\n",
    "from huggingface_hub import HfApi, create_repo, login, upload_file\n",
    "\n",
    "GGUF = \"ml/out/bloop-qwen3.5-0.8b-Q4_K_M.gguf\"\n",
    "login()\n",
    "api = HfApi()\n",
    "user = api.whoami()[\"name\"]\n",
    "repo_id = f\"{user}/bloop-qwen3.5-0.8b-GGUF\"\n",
    "create_repo(repo_id, repo_type=\"model\", exist_ok=True)\n",
    "fname = os.path.basename(GGUF)\n",
    "upload_file(path_or_fileobj=GGUF, path_in_repo=fname, repo_id=repo_id, commit_message=f\"Add {fname}\")\n",
    "upload_file(path_or_fileobj=\"ml/MODEL_CARD.md\", path_in_repo=\"README.md\", repo_id=repo_id, commit_message=\"Model card\")\n",
    "\n",
    "h = hashlib.sha256()\n",
    "with open(GGUF, \"rb\") as f:\n",
    "    for chunk in iter(lambda: f.read(1 << 20), b\"\"):\n",
    "        h.update(chunk)\n",
    "print()\n",
    "print(\"Put these in src/main/ai/local/bloop.ts:\")\n",
    "print(f\"  BLOOP_MODEL_URL    = 'https://huggingface.co/{repo_id}/resolve/main/{fname}'\")\n",
    "print(f\"  BLOOP_MODEL_SHA256 = '{h.hexdigest()}'\")\n",
    "print(f\"  BLOOP_MODEL_BYTES  = {os.path.getsize(GGUF)}\")"
   ],
   "id": "cell20"
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "## Alternative: download the .gguf directly\n",
    "\n",
    "Skip publishing and just save the file to your computer, then import it in Bloop via **Settings → AI → Use Local → Bloop model → Import .gguf…**. To ship it inside the app instead, run `npm run model:bundle -- <file.gguf>` and then `npm run build`. The cell also prints the SHA-256 and size."
   ],
   "id": "cell21"
  },
  {
   "cell_type": "code",
   "metadata": {},
   "execution_count": null,
   "outputs": [],
   "source": [
    "import hashlib, os\n",
    "from google.colab import files\n",
    "GGUF = \"ml/out/bloop-qwen3.5-0.8b-Q4_K_M.gguf\"\n",
    "h = hashlib.sha256(open(GGUF, \"rb\").read()).hexdigest()\n",
    "print(\"sha256:\", h, \"| bytes:\", os.path.getsize(GGUF))\n",
    "files.download(GGUF)"
   ],
   "id": "cell22"
  }
 ],
 "metadata": {
  "accelerator": "GPU",
  "colab": {
   "name": "train_bloop.ipynb",
   "provenance": [],
   "gpuType": "T4"
  },
  "kernelspec": {
   "display_name": "Python 3",
   "name": "python3"
  },
  "language_info": {
   "name": "python"
  }
 },
 "nbformat": 4,
 "nbformat_minor": 5
}
``````

### `ml/data/READY`

<!-- FILE: ml/data/READY sha256=f673936d2a547fb3903922c5ecf0d8d721391744ba24a02f2efb54a27d4db17d nl=1 -->
``````
train: 240 examples (192 plan, 48 nudge)
eval: 30 examples (24 plan, 6 nudge)
train.jsonl sha256: 56346fe03f14b2e8579803d8b401f347ec4fbac391c663b931a16ddc4920fd13
``````

### `ml/data/build_dataset.py`

<!-- FILE: ml/data/build_dataset.py sha256=5f0d1324dfd5bdd49bd99620e0c0017d7564002f94e9acc2e79fb30049be1734 nl=1 -->
``````python
#!/usr/bin/env python3
"""Regenerates ml/data/train.jsonl and ml/data/eval.jsonl (deterministic, fixed seed).

    python3 ml/data/build_dataset.py            # writes train.jsonl / eval.jsonl
    python3 ml/data/validate.py                 # validates them, writes READY when clean

Study-plan prompts are rendered by the REAL buildPrompt() from src/main/plan.ts (ml/data/render_prompts.cjs
extracts and transpiles it), then cross-checked against an independent Python re-implementation below.
Plan targets come from a rule-based planner that satisfies every check in ml/train/scoring.py.
"""
from __future__ import annotations

import datetime as dt
import json
import random
import re
import subprocess
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "train"))
import scoring as S  # noqa: E402
from nudge_lines import DRIFT_SITE, EVAL_HOLDOUT, POOL  # noqa: E402

SEED = 20261104
N_TRAIN, N_EVAL = 240, 30
# (plans, robustness plans, nudges) per split. 70% / 10% / 20%.
MIX = {"train": (168, 24, 48), "eval": (21, 3, 6)}
NUDGE_MIX = {"train": {"drift": 14, "welcome": 9, "break": 9, "back": 8, "done": 8},
             "eval": {"drift": 2, "welcome": 1, "break": 1, "back": 1, "done": 1}}

DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
DOW3 = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
TZS = {  # tz -> (standard name, daylight name) as printed by V8's Date.toString()
    "America/New_York": ("Eastern Standard Time", "Eastern Daylight Time"),
    "America/Chicago": ("Central Standard Time", "Central Daylight Time"),
    "America/Denver": ("Mountain Standard Time", "Mountain Daylight Time"),
    "America/Los_Angeles": ("Pacific Standard Time", "Pacific Daylight Time"),
    "Europe/London": ("Greenwich Mean Time", "British Summer Time"),
    "UTC": ("Coordinated Universal Time", "Coordinated Universal Time"),
}
TZ_WEIGHTS = [("America/New_York", 4), ("America/Chicago", 3), ("America/Denver", 1),
              ("America/Los_Angeles", 3), ("Europe/London", 1), ("UTC", 1)]

# ----------------------------------------------------------------------------- courses
COURSES = {
    "CHEM 201": ["equilibrium", "acid-base titrations", "thermodynamics", "kinetics"],
    "CS 251": ["linked lists", "recursion", "hash tables", "Big-O analysis"],
    "MA 261": ["partial derivatives", "double integrals", "gradients", "Lagrange multipliers"],
    "HIST 110": ["the Industrial Revolution", "primary sources", "key dates", "the Cold War"],
    "PSY 120": ["memory models", "conditioning", "research methods", "cognitive biases"],
    "ECON 251": ["supply and demand", "elasticity", "market structures", "GDP and inflation"],
    "BIO 110": ["cell respiration", "genetics", "photosynthesis", "evolution"],
    "ENGL 106": ["thesis statements", "citations", "close reading", "argument structure"],
    "PHYS 172": ["Newton's laws", "energy conservation", "circuits", "waves"],
    "STAT 350": ["hypothesis tests", "confidence intervals", "regression", "probability rules"],
    "CS 180": ["Python loops", "functions", "debugging", "file I/O"],
    "MA 165": ["limits", "derivative rules", "integration", "related rates"],
    "SOC 100": ["social theory", "survey methods", "key concepts", "case studies"],
    "ART 120": ["art movements", "visual analysis", "artist profiles", "terminology"],
}
EXAM_TITLES = ["Midterm", "Midterm 2", "Midterm 1", "Final Exam", "Exam 1", "Exam 2", "Exam 3"]
# kind -> (titles, demand minutes, first step, last step)
ASSIGN = {
    "hw": (["Homework 4", "Homework 7", "Homework 9", "Problem Set 3", "Problem Set 5", "Problem Set 8"], 110,
           "work through the problems", "check answers and redo mistakes"),
    "lab": (["Lab Report 2", "Lab Report 3", "Lab Report 5"], 150, "organize data and figures", "write conclusion and proofread"),
    "essay": (["Essay Draft", "Essay 2", "Paper Outline", "Research Essay"], 170, "outline and draft", "revise and proofread"),
    "project": (["Project Milestone 2", "Project 3", "Group Project Part 1"], 170, "build the next milestone", "test and clean up"),
    "reading": (["Reading Response", "Reading Response 4", "Discussion Post 3"], 70, "read and take notes", "write the response"),
    "quiz": (["Quiz 3", "Quiz 4", "Online Quiz 2"], 75, "review key ideas", "quick practice quiz"),
    "talk": (["Presentation", "Group Presentation"], 120, "build the slides", "practice the talk out loud"),
}
GENERIC_LABELS = ["Review this week's lecture notes", "Get ahead on upcoming readings", "Make flashcards from class notes",
                  "Practice problems from class", "Plan next week's study goals", "Light revision: summarize key ideas",
                  "Tidy notes and fix gaps", "Catch up on any missed material"]

CHRONO_STARTS = {"morning": [8 * 60, 8 * 60 + 30, 9 * 60, 9 * 60 + 30, 10 * 60],
                 "afternoon": [13 * 60, 13 * 60 + 30, 14 * 60, 15 * 60, 16 * 60],
                 "evening": [17 * 60 + 30, 18 * 60, 18 * 60 + 30, 19 * 60, 19 * 60 + 30]}


def est_tokens(text: str) -> int:
    """Rough BPE-like proxy that charges digits and punctuation one token each (Qwen splits digits)."""
    n = 0
    for m in re.finditer(r"[A-Za-z]+|\d|[^\sA-Za-z\d]", text):
        w = m.group(0)
        n += -(-len(w) // 6) if w[0].isalpha() else 1
    return n


TOKEN_CAP = 900  # keep prompt+answer under this by est_tokens() so train_lora.py's --max-len 1024 never drops a row


def hhmm(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}"


def wchoice(rng: random.Random, pairs):
    return rng.choices([p[0] for p in pairs], [p[1] for p in pairs])[0]


# ----------------------------------------------------------------------------- scenarios
class Item:
    def __init__(self, summary, code, exam, kind, offset, due, rng):
        self.summary, self.code, self.exam, self.kind = summary, code, exam, kind
        self.offset, self.due = offset, due  # offset = whole days from today, due = minutes since midnight
        self.topics = rng.sample(COURSES[code], 3)
        self.prio = offset - (3 if exam else 0) + (0 if exam else 0.1)


def pick_courses(rng, n):
    return rng.sample(list(COURSES), n)


def history(rng, profile, today: dt.date):
    rows = []
    for k in range(7, 0, -1):  # oldest first, 7 entries ending today ("today" is the 7th: mostly empty, day just starting)
        d = today - dt.timedelta(days=k - 1)
        if k == 1:  # today so far
            sessions = 0 if profile in ("empty", "low", "sporadic") or rng.random() < 0.55 else 1
            mins = round(sessions * rng.uniform(12, 30))
        else:
            if profile == "empty":
                sessions, mins = 0, 0
            else:
                zero_p = {"low": 0.55, "sporadic": 0.7, "moderate": 0.12, "high": 0.06}[profile]
                lo_hi = {"low": (1, 2, 8, 25), "sporadic": (1, 3, 15, 35), "moderate": (2, 4, 22, 35), "high": (4, 7, 25, 40)}[profile]
                if rng.random() < zero_p:
                    sessions, mins = 0, 0
                else:
                    sessions = rng.randint(lo_hi[0], lo_hi[1])
                    mins = round(sessions * rng.uniform(lo_hi[2], lo_hi[3]))
        score = None
        if sessions:
            lo, hi = {"low": (35, 70), "sporadic": (40, 75), "moderate": (55, 85), "high": (70, 96), "empty": (50, 60)}[profile]
            score = rng.randint(lo, hi)
        rows.append({"date": d.isoformat(), "sessions": sessions, "focusSec": mins * 60 + (rng.randint(0, 29) if mins else 0),
                     "avgScore": score, "mins": mins})
    return rows


def gen_scenario(rng: random.Random, kind: str, js_dow: int):
    """kind: normal | empty_nodl | today | crunch | far | nohist"""
    # date with the requested weekday
    base = dt.date(2026, 8, 24) + dt.timedelta(days=rng.randint(0, 250))
    while (base.weekday() + 1) % 7 != js_dow:
        base += dt.timedelta(days=1)
    tz = wchoice(rng, TZ_WEIGHTS)
    chrono = rng.choices(["morning", "afternoon", "evening"], [4, 3, 3])[0]
    if kind == "today":
        chrono = rng.choice(["morning", "morning", "afternoon"])
    now_min = {"morning": rng.randint(7 * 60 + 30, 11 * 60 + 45), "afternoon": rng.randint(12 * 60, 16 * 60 + 45),
               "evening": rng.randint(17 * 60, 21 * 60 + 45)}[chrono]
    if kind == "today":
        now_min = rng.randint(7 * 60 + 30, 12 * 60)
    now = [base.year, base.month, base.day, now_min // 60, now_min % 60, rng.randint(0, 59)]
    pomo, brk = rng.choices([(25, 5), (50, 10), (30, 5), (45, 15)], [4, 3, 2, 2])[0]

    profile = rng.choices(["empty", "low", "sporadic", "moderate", "high"], [1, 3, 2, 4, 3])[0]
    if kind in ("empty_nodl", "nohist"):
        profile = "empty"
    hist = history(rng, profile, base)

    n_dl = {"normal": rng.choices([0, 1, 2, 3, 4, 5], [10, 18, 25, 22, 15, 10])[0], "empty_nodl": 0, "today": rng.choice([1, 1, 2]),
            "crunch": 5, "far": rng.choice([1, 2, 3]), "nohist": rng.choice([1, 2, 3])}[kind]
    codes = pick_courses(rng, n_dl)
    items: list[Item] = []
    for i, code in enumerate(codes):
        if kind == "today":
            offset = 0
        elif kind == "crunch":
            offset = rng.choice([0, 1, 1, 2, 2, 3, 3, 4]) if i else rng.choice([1, 2])
            offset = max(1, offset) if rng.random() < 0.8 else offset
        elif kind == "far":
            offset = rng.randint(7, 13)
        else:
            offset = rng.choices(range(1, 12), [4, 6, 7, 7, 6, 5, 4, 3, 2, 2, 1])[0]
        exam = rng.random() < (0.5 if kind != "crunch" else 0.4)
        if exam:
            title = rng.choice(EXAM_TITLES)
            due = rng.choice([9 * 60, 10 * 60, 11 * 60, 13 * 60, 14 * 60, 15 * 60 + 30, 17 * 60, 18 * 60 + 30, 19 * 60])
            akind = "exam"
        else:
            akind = rng.choice(list(ASSIGN))
            title = rng.choice(ASSIGN[akind][0])
            due = rng.choice([9 * 60, 11 * 60 + 59, 14 * 60, 17 * 60, 23 * 60 + 59, 23 * 60 + 59, 23 * 60 + 59])
        if kind == "today":
            due = rng.choice([17 * 60, 18 * 60 + 30, 20 * 60, 23 * 60 + 59])
        if offset == 0 and due <= now_min + 240:  # must still be upcoming, with room to study before it
            exam, akind, due = False, rng.choice(list(ASSIGN)), 23 * 60 + 59
            title = rng.choice(ASSIGN[akind][0])
        items.append(Item(f"{code} {title}", code, exam, akind, offset, due, rng))
    items.sort(key=lambda it: (it.offset, it.due))
    return {"kind": kind, "tz": tz, "now": now, "now_min": now_min, "date": base, "js_dow": js_dow, "chrono": chrono,
            "pomo": pomo, "brk": brk, "profile": profile, "hist": hist, "items": items}


# ----------------------------------------------------------------------------- prompt rendering
def node_render(scenarios) -> list[str]:
    payload = []
    for sc in scenarios:
        d0 = sc["date"]
        payload.append({
            "tz": sc["tz"], "now": sc["now"], "focusMinutes": sc["pomo"], "breakMinutes": sc["brk"],
            "last7": [{k: r[k] for k in ("date", "sessions", "focusSec", "avgScore")} for r in sc["hist"]],
            "deadlines": [{"summary": it.summary, "isExam": it.exam,
                           "at": [(d0 + dt.timedelta(days=it.offset)).year, (d0 + dt.timedelta(days=it.offset)).month,
                                  (d0 + dt.timedelta(days=it.offset)).day, it.due // 60, it.due % 60]} for it in sc["items"]],
        })
    out = subprocess.run(["node", str(HERE / "render_prompts.cjs")], input=json.dumps(payload), capture_output=True,
                         text=True, check=True, cwd=HERE)
    return json.loads(out.stdout)


def js_tostring(local: dt.datetime) -> str:
    off = int(local.utcoffset().total_seconds() // 60)
    sign = "+" if off >= 0 else "-"
    name = TZS[local.tzinfo.key][1 if local.dst() else 0]
    return (f"{DOW3[(local.weekday() + 1) % 7]} {MON3[local.month - 1]} {local.day:02d} {local.year} "
            f"{local.hour:02d}:{local.minute:02d}:{local.second:02d} GMT{sign}{abs(off) // 60:02d}{abs(off) % 60:02d} ({name})")


PROMPT_TMPL = '''You are a friendly study coach inside a desktop "study pet" app for a university student.
Today is {today}.

Upcoming deadlines:
{dl}

Focus history for the last 7 days (score 0-100 = share of time on study apps/sites):
{days}

The student uses {f}-minute pomodoros with {b}-minute breaks.

Create a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,
and fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.
Block lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.

Reply with ONLY a JSON object, no markdown fences, in exactly this shape:
{{"summary": "<2-3 encouraging sentences explaining the plan>",
 "blocks": [{{"day": <0-6, 0 = Sunday>, "time": "HH:MM" (24h), "minutes": <number>, "label": "<what to study>"}}]}}'''


def py_prompt(sc) -> str:
    z = ZoneInfo(sc["tz"])
    n = sc["now"]
    now = dt.datetime(n[0], n[1], n[2], n[3], n[4], n[5], tzinfo=z)
    dl = "\n".join(
        f"- {it.summary}{' (EXAM)' if it.exam else ''}: " + js_tostring(
            dt.datetime.combine(sc["date"] + dt.timedelta(days=it.offset), dt.time(it.due // 60, it.due % 60), tzinfo=z))
        for it in sc["items"]) or "- (no upcoming deadlines found)"
    days = "\n".join(f"- {r['date']}: {r['sessions']} sessions, {round(r['focusSec'] / 60)} focused min, avg score "
                     f"{r['avgScore'] if r['avgScore'] is not None else 'n/a'}" for r in sc["hist"])
    return PROMPT_TMPL.format(today=f"{DAY_NAMES[(now.weekday() + 1) % 7]} {js_tostring(now)}", dl=dl, days=days,
                              f=sc["pomo"], b=sc["brk"])


# ----------------------------------------------------------------------------- planner
def fit_units(width: int, p: int, gap: int = 30) -> int:
    n = 0
    while (n + 1) * p + n * gap <= width:
        n += 1
    return n


def when_phrase(offset: int, dow: int) -> str:
    if offset > 6:
        return f"in {offset} days"
    return "today" if offset == 0 else "tomorrow" if offset == 1 else f"on {DAY_NAMES[(dow + offset) % 7]}"


def plan_scenario(sc, rng: random.Random):
    """Returns {"summary","blocks"} or None when no sensible plan exists for this scenario."""
    p, brk = sc["pomo"], sc["brk"]
    items: list[Item] = sc["items"]
    in_win = [it for it in items if it.offset <= 6]
    L = max((it.offset for it in in_win), default=6)
    minimal = sc["kind"] in ("empty_nodl", "today", "crunch", "far", "nohist")
    max_blocks = rng.choice([3, 4, 5]) if minimal else rng.choices([5, 6, 7, 8, 9, 10], [2, 4, 4, 3, 1, 1])[0]
    if sc["kind"] == "crunch":
        max_blocks = rng.choice([5, 6, 7])

    # --- daily budget from recent habits
    mean_min = sum(r["mins"] for r in sc["hist"][:6]) / 6.0
    target = min(210, max(p, 1.3 * mean_min))
    budget = max(1, round(target / p))

    # --- per-day windows
    ws, we = {}, {}
    for d in range(L + 1):
        if d == 0:
            ws[d] = max(8 * 60, -(-(sc["now_min"] + rng.choice([30, 45, 60, 75])) // 15) * 15)
        else:
            ws[d] = rng.choice(CHRONO_STARTS[sc["chrono"]])
        we[d] = rng.choice([20 * 60, 21 * 60, 22 * 60]) if sc["chrono"] == "morning" else 22 * 60
    for it in items:  # on a deadline's own day, every block must end before it is due (exams: an hour before)
        if it.offset <= L:
            we[it.offset] = min(we[it.offset], it.due - (60 if it.exam else 30))

    def hard(d):
        return fit_units(we[d] - ws[d], p) if we[d] - ws[d] >= p else 0

    cap_soft = {d: min(budget, hard(d)) for d in range(L + 1)}
    used = {d: 0 for d in range(L + 1)}

    def allowed(it):
        last = min(it.offset - 1, L) if it.offset >= 1 else -1
        ds = [d for d in range(0, last + 1) if hard(d) > 0]
        if not ds and it.offset <= L:  # fall back to the due day itself, finishing before it is due
            d = it.offset
            we[d] = min(we[d], it.due - (60 if it.exam else 30))
            cap_soft[d] = min(budget, hard(d))
            ds = [d] if hard(d) > 0 else []
        return ds

    todo = sorted(items, key=lambda it: it.prio)
    allow = {id(it): allowed(it) for it in todo}
    todo = [it for it in todo if allow[id(it)]]
    maxu = 3 if p <= 30 else 2
    demand = {}
    for it in todo:
        mins = 200 + rng.choice([-25, 0, 25]) if it.exam else ASSIGN[it.kind][1]
        u = max(1, round(mins / p))
        if it.offset > 6:
            u = min(u, 3 if it.exam else 2)
        demand[id(it)] = u

    blocks: list[dict] = []  # {item, day, units}

    def grant(it, g_pref, soft=True):
        ds = allow[id(it)]
        cap = (lambda d: cap_soft[d]) if soft else hard
        cands = [d for d in ds if used[d] < cap(d)]
        if not cands:
            return False
        units_on = lambda d: sum(b["units"] for b in blocks if b["item"] is it and b["day"] == d)
        d = min(cands, key=lambda d: (units_on(d), d + rng.random() * 0.9))
        g = max(1, min(g_pref, cap(d) - used[d], remaining[id(it)]))
        ex = next((b for b in blocks if b["item"] is it and b["day"] == d and b["units"] < maxu), None)
        if ex:
            g = min(g, maxu - ex["units"])
            ex["units"] += g
        else:
            if len(blocks) >= max_blocks:
                return False
            g = min(g, maxu)
            blocks.append({"item": it, "day": d, "units": g})
        used[d] += g
        remaining[id(it)] -= g
        return True

    remaining = dict(demand)
    g_opts = [1, 2, 2, 3] if p <= 30 else [1, 1, 2]
    for it in todo[:2]:  # the two highest-priority items get ~60% of their demand first
        need = -(-demand[id(it)] * 6 // 10)
        while demand[id(it)] - remaining[id(it)] < need and grant(it, rng.choice(g_opts)):
            pass
    for it in todo:  # pass 1: everybody gets a first block, nearest/exams first
        if remaining[id(it)] == demand[id(it)]:
            grant(it, rng.choice(g_opts))
    progress = True
    while progress:  # pass 2: top up in priority order
        progress = False
        for it in todo:
            if remaining[id(it)] > 0 and grant(it, rng.choice(g_opts)):
                progress = True

    # --- make sure there are at least 3 blocks (recap blocks, ignoring the soft habit budget)
    filler_item = todo[0] if todo else None
    if minimal:
        min_blocks = 3
    elif todo:
        min_blocks = rng.choice([3, 4, 5]) if sc["profile"] in ("moderate", "high") else 3
    else:
        min_blocks = rng.choice([3, 4, 4, 5])
    guard = 0
    while len(blocks) < min_blocks and guard < 50:
        guard += 1
        ds = allow[id(filler_item)] if filler_item else [d for d in range(L + 1) if hard(d) > 0]
        ds = [d for d in ds if used[d] < hard(d)] or [d for d in range(L + 1) if used[d] < hard(d)]
        if not ds:
            if len(blocks) >= 3:
                break
            return None
        d = min(ds, key=lambda d: (used[d], d + rng.random() * 0.9))
        units = 1 if filler_item else max(1, min(rng.choice(g_opts), hard(d) - used[d], maxu))
        blocks.append({"item": filler_item, "day": d, "units": units, "filler": filler_item is not None})
        used[d] += units
    if len(blocks) < 3:
        return None

    # --- place blocks in time
    by_day: dict[int, list[dict]] = {}
    for b in blocks:
        by_day.setdefault(b["day"], []).append(b)
    for d, bl in by_day.items():
        bl.sort(key=lambda b: (b["item"].prio if b["item"] else 99, b["units"]))
        total = sum(b["units"] * p for b in bl)
        n = len(bl)
        width = we[d] - ws[d]
        gaps = [g for g in (30, 45, 60, 90) if total + (n - 1) * g <= width] if n > 1 else [0]
        if total > width or not gaps:
            return None
        g = rng.choice(gaps)
        leftover = width - (total + (n - 1) * g)
        t0 = ws[d] + min(leftover // 15 * 15, rng.choice([0, 0, 15, 30, 45]))
        for rnd in (True, False):  # prefer :00/:15/:30/:45 starts; fall back to exact packing if that overruns
            t, starts = t0, []
            for b in bl:
                if rnd:
                    t = -(-t // 15) * 15
                starts.append(t)
                t += b["units"] * p + g
            if starts[-1] + bl[-1]["units"] * p <= we[d]:
                break
        for b, st in zip(bl, starts):
            b["start"], b["minutes"] = st, b["units"] * p
    # --- labels
    per_item: dict[int, list[dict]] = {}
    for b in sorted(blocks, key=lambda b: (b["day"], b["start"])):
        per_item.setdefault(id(b["item"]) if b["item"] else 0, []).append(b)
    taken: set[str] = set()
    for key, bl in per_item.items():
        for i, b in enumerate(bl):
            lab = make_label(b["item"], i, len(bl), b, rng)
            for _ in range(12):  # keep labels distinct within a plan
                if lab not in taken:
                    break
                lab = make_label(b["item"], i, len(bl), b, rng)
            if lab in taken:
                lab = f"{lab} (part {i + 1})"
            taken.add(lab)
            b["label"] = lab
    out = []
    for b in sorted(blocks, key=lambda b: (b["day"], b["start"])):
        out.append({"day": (sc["js_dow"] + b["day"]) % 7, "time": hhmm(b["start"]), "minutes": b["minutes"],
                    "label": b["label"][:70]})
    first = next((it for it in todo if any(b["item"] is it and not b.get("filler") for b in blocks)), None)
    sc["_first"] = first
    sc["_scheduled"] = [it for it in todo if any(b["item"] is it for b in blocks)]
    sc["_n_days"] = len({b["day"] for b in blocks})
    sc["_starved"] = any(it.offset <= 6 and it not in sc["_scheduled"] for it in items)
    return {"summary": make_summary(sc, budget, rng), "blocks": out}


def make_label(it: Item | None, i: int, n: int, b: dict, rng: random.Random) -> str:
    if it is None:
        return rng.choice(GENERIC_LABELS)
    t = it.topics
    if it.offset == 0:
        return rng.choice([f"Final push: {it.summary}", f"{it.summary}: last review before it's due"]) if i == n - 1 else \
            f"{it.summary}: review {t[i % 3]}"
    if b.get("filler"):
        return rng.choice([f"Quick recap of {it.code} notes", f"{it.code}: flashcards and short review", f"Light {it.code} review: {t[0]}"])
    if it.offset > 6:
        steps = ["skim the material", f"review {t[0]}", "outline the main parts", f"review {t[1]}"]
        return f"Head start on {it.summary}: {steps[i % len(steps)]}"
    if it.exam:
        first = [f"{it.code} exam prep: review notes on {t[0]}", f"{it.code}: skim slides and {t[0]}", f"Start {it.code} exam review: {t[0]}"]
        mid = [f"{it.code}: practice problems on {t[1]}", f"{it.code} drills: {t[1]}", f"{it.code}: redo tricky {t[2]} questions"]
        last = [f"{it.code} final recap: key ideas and weak spots", f"{it.code}: mock exam, then fix mistakes", f"Last look at {it.code}: {t[2]}"]
        only = [f"{it.code} exam prep: {t[0]} + practice", f"{it.summary} review: {t[0]} + {t[1]}"]
        if n == 1:
            return rng.choice(only)
        return rng.choice(first) if i == 0 else rng.choice(last) if i == n - 1 else mid[(i - 1) % len(mid)]
    _, _, s1, s2 = ASSIGN[it.kind]
    if n == 1:
        return f"{it.summary}: {s1}" if len(it.summary) + len(s1) < 50 else it.summary
    return f"{it.summary}: {s1 if i < n - 1 else s2}"


def make_summary(sc, budget_units: int, rng: random.Random) -> str:
    p, brk = sc["pomo"], sc["brk"]
    dow = sc["js_dow"]
    first: Item | None = sc.get("_first")
    sched = [it for it in sc["_scheduled"] if it is not None]
    n_items = len(sched)
    prof = sc["profile"]
    if first is None:
        s1 = rng.choice(["Nothing is due soon, so this is a calm week to build a rhythm.",
                         "No deadlines in sight, so let's use the time to get ahead gently.",
                         "It's a quiet week on the calendar, so I kept things light and steady."])
    else:
        w = when_phrase(first.offset, dow)
        if n_items >= 3:
            s1 = rng.choice([f"You've got {n_items} things coming up, so I lined them up by what's closest, starting with {first.summary}.",
                             f"{first.summary} comes first, and the rest follow in order of what's due soonest."])
        elif first.exam:
            s1 = rng.choice([f"Your {first.summary} is {w}, so it gets the first and biggest blocks.",
                             f"{first.summary} is {w}, so I put it at the front of the plan.",
                             f"Your {first.summary} is {w}, so let's start there."])
        else:
            s1 = rng.choice([f"{first.summary} is due {w}, so that's our first stop.",
                             f"First up is {first.summary}, due {w}.",
                             f"{first.summary} is due {w}, so I'm putting it first."])
        if first.offset == 0:
            s1 = rng.choice([f"{first.summary} is due today, so the plan is short and focused.",
                             f"Today is the big day for {first.summary}, so I kept everything before it's due."])
    s2 = {
        "empty": ["I don't see any focus history yet, so I kept the sessions short and easy.",
                  "This is a fresh start, so the blocks stay gentle."],
        "low": ["Last week was pretty quiet, so I kept the plan small and doable.",
                "Your focus time was light lately, so I'm not piling on too much."],
        "sporadic": ["Last week was a bit stop-and-go, so I kept the plan small and doable.",
                     "Your focus time was light lately, so I'm not piling on too much."],
        "moderate": ["It matches the steady pace you've had lately.", "I sized the blocks to fit how you've been studying."],
        "high": ["You've been on a roll, so I gave you a bit more time each day.",
                 "Great focus lately, so I added a little extra study time."],
    }[prof]
    s2 = rng.choice(s2)
    if sc.get("_starved"):
        s2 = rng.choice(["I focused on the closest deadlines first and kept the load realistic.",
                         "There's a lot coming up, so I put the nearest ones first and kept each day doable."])
    s3 = rng.choice(["You've got this!", "I'll be cheering for you the whole way!", "One pomodoro at a time, and you'll get there.",
                     "Take your breaks too, I'll be right here.", "Bloop believes in you!",
                     f"Blocks are built from {p}-minute pomodoros with {brk}-minute breaks."])
    parts = [s1, s2] + ([s3] if rng.random() < 0.75 else [])
    return " ".join(parts)


# ----------------------------------------------------------------------------- nudges
SITES = ["youtube.com", "reddit.com", "tiktok.com", "instagram.com", "twitter.com", "x.com", "netflix.com", "twitch.tv",
         "facebook.com", "9gag.com", "buzzfeed.com", "espn.com", "pinterest.com", "amazon.com"]
APPS = ["Discord", "Steam", "Spotify", "Minecraft", "Snapchat", "WhatsApp", "Netflix", "Fortnite"]
PRE = "You are Bloop, a cute study pet. "
POST = " Write one short, kind {what} (max 60 characters)."


def mins(n: int) -> str:
    return f"{n} minute" + ("" if n == 1 else "s")


def nudge_prompt(kind: str, rng: random.Random):
    if kind == "drift":
        n = rng.choice([1, 2, 2, 3, 4, 5, 8, 10, 15])
        if rng.random() < 0.7:
            site = rng.choice(SITES)
            body = f"The student has been on {site} for {mins(n)} during a focus session."
            ctx = site
        else:
            app = rng.choice(APPS)
            body = f"The student has been using {app} for {mins(n)} during a focus session."
            ctx = app.lower()
        return PRE + body + POST.format(what="nudge"), ctx
    if kind == "welcome":
        n = rng.choice([1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20, 25])
        return PRE + f"The student just came back to their study app after {mins(n)} away." + POST.format(what="welcome-back nudge"), ""
    if kind == "break":
        f, b = (rng.choice([20, 25, 30, 35, 40, 45, 50, 60]), rng.choice([5, 5, 10, 15]))
        return PRE + f"The student just finished a {f}-minute focus block and a {b}-minute break is starting." + \
            POST.format(what="break-time nudge"), ""
    if kind == "back":
        f, b = (rng.choice([20, 25, 30, 35, 40, 45, 50, 60]), rng.choice([5, 5, 10, 15]))
        return PRE + f"The student's {b}-minute break is over and the next {f}-minute focus block is starting." + \
            POST.format(what="back-to-work nudge"), ""
    f = rng.choice([25, 30, 45, 50])
    k = rng.randint(1, 6)
    return PRE + f"The student just finished a focus session of {f * k} minutes ({k} pomodoros)." + \
        POST.format(what="session-complete nudge"), ""


def emoji_count(s: str) -> int:
    return sum(1 for ch in s if ord(ch) >= 0x1F000 or 0x2600 <= ord(ch) <= 0x27BF or 0x2B00 <= ord(ch) <= 0x2BFF)


def check_pool():
    allines = [l for v in POOL.values() for l in v] + [l for v in DRIFT_SITE.values() for l in v]
    assert len(allines) >= 150 and len(set(allines)) == len(allines), "pool must hold >=150 distinct lines"
    for l in allines:
        assert 0 < len(l) <= 60, (len(l), l)
        assert l == l.lower(), l
        assert emoji_count(l) <= 1, l
        assert "\n" not in l


def build_nudges(split: str, rng: random.Random, seen: set[str]):
    rows = []
    for kind, count in NUDGE_MIX[split].items():
        pool = list(POOL[kind])
        lines = pool[-EVAL_HOLDOUT:] if split == "eval" else pool[:-EVAL_HOLDOUT]
        rng.shuffle(lines)
        site_lines = {k: list(v) for k, v in DRIFT_SITE.items()} if (kind == "drift" and split == "train") else {}
        for _ in range(count):
            for _try in range(500):
                prompt, ctx = nudge_prompt(kind, rng)
                if prompt not in seen:
                    break
            else:
                raise RuntimeError("could not generate a unique nudge prompt")
            matches = [k for k in site_lines if k in ctx and site_lines[k]]
            if matches and rng.random() < 0.7:
                line = site_lines[matches[0]].pop(0)
            else:
                line = lines.pop(0)  # each line is used at most once per split
            seen.add(prompt)
            rows.append(("nudge", prompt, line))
    return rows


# ----------------------------------------------------------------------------- main
def build_split(split: str, seed_off: int, seen: set[str]):
    rng = random.Random(SEED + seed_off)
    n_plan, n_rob, n_nud = MIX[split]
    kinds = ["normal"] * n_plan
    rob = ["empty_nodl", "today", "crunch", "far", "nohist"]
    kinds += [rob[i % len(rob)] for i in range(n_rob)]
    rng.shuffle(kinds)
    rows, dow_i = [], rng.randint(0, 6)
    pending = []
    attempts = 0
    for kind in kinds:
        while True:
            attempts += 1
            sc = gen_scenario(rng, kind, dow_i % 7)
            plan = plan_scenario(sc, rng)
            if plan is None:
                continue
            if est_tokens(py_prompt(sc)) + est_tokens(json.dumps(plan, ensure_ascii=False)) > TOKEN_CAP:
                continue
            sc["_plan"] = plan
            pending.append(sc)
            dow_i += 1
            break
    prompts = node_render(pending)
    for sc, prompt in zip(pending, prompts):
        py = py_prompt(sc)
        assert py == prompt, f"python/node prompt mismatch:\n{py}\n----\n{prompt}"
        target = json.dumps(sc["_plan"], ensure_ascii=False)
        res = S.score_plan(target, prompt)
        if not (res["clean_json"] and res["schema_valid"] and res["all_rules"]) or prompt in seen:
            # planner bug or duplicate prompt: surface loudly rather than silently dropping
            raise RuntimeError(f"generated plan failed scoring ({sc['kind']}): {res}\n{target}")
        seen.add(prompt)
        rows.append((sc["kind"], prompt, target))
    rows += build_nudges(split, rng, seen)
    rng.shuffle(rows)
    return rows, attempts


def main():
    check_pool()
    seen: set[str] = set()
    train, _ = build_split("train", 1, seen)
    seen_train = set(seen)
    evalr, _ = build_split("eval", 2, seen)
    assert not (seen_train & {p for _, p, _ in evalr}), "eval prompt duplicates a train prompt"
    for name, rows in (("train", train), ("eval", evalr)):
        with open(HERE / f"{name}.jsonl", "w", encoding="utf-8") as f:
            for _, prompt, target in rows:
                f.write(json.dumps({"messages": [{"role": "user", "content": prompt},
                                                 {"role": "assistant", "content": target}]}, ensure_ascii=False) + "\n")
    print(f"wrote {len(train)} train and {len(evalr)} eval rows to {HERE}")


if __name__ == "__main__":
    main()
``````

### `ml/data/eval.jsonl`

<!-- FILE: ml/data/eval.jsonl sha256=4b6bab2fb75776ffbca71c7d52ef4fc65a09f631bd26516b9178dcfe502c9128 nl=1 -->
``````jsonl
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Sunday Sun Oct 04 2026 18:20:49 GMT-0400 (Eastern Daylight Time).\n\nUpcoming deadlines:\n- MA 165 Exam 3 (EXAM): Sun Oct 11 2026 18:30:00 GMT-0400 (Eastern Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-09-28: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-29: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-30: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-01: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-02: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-03: 1 sessions, 20 focused min, avg score 51\n- 2026-10-04: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"MA 165 Exam 3 is in 7 days, so I put it at the front of the plan. Your focus time was light lately, so I'm not piling on too much. I'll be cheering for you the whole way!\", \"blocks\": [{\"day\": 0, \"time\": \"20:00\", \"minutes\": 25, \"label\": \"Head start on MA 165 Exam 3: skim the material\"}, {\"day\": 1, \"time\": \"18:30\", \"minutes\": 25, \"label\": \"Head start on MA 165 Exam 3: review related rates\"}, {\"day\": 2, \"time\": \"19:30\", \"minutes\": 25, \"label\": \"Head start on MA 165 Exam 3: outline the main parts\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Wednesday Wed Oct 21 2026 12:40:07 GMT-0500 (Central Daylight Time).\n\nUpcoming deadlines:\n- (no upcoming deadlines found)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-10-15: 2 sessions, 64 focused min, avg score 63\n- 2026-10-16: 2 sessions, 45 focused min, avg score 81\n- 2026-10-17: 4 sessions, 111 focused min, avg score 80\n- 2026-10-18: 3 sessions, 73 focused min, avg score 60\n- 2026-10-19: 3 sessions, 93 focused min, avg score 70\n- 2026-10-20: 3 sessions, 88 focused min, avg score 70\n- 2026-10-21: 1 sessions, 13 focused min, avg score 69\n\nThe student uses 30-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Nothing is due soon, so this is a calm week to build a rhythm. It matches the steady pace you've had lately. Blocks are built from 30-minute pomodoros with 5-minute breaks.\", \"blocks\": [{\"day\": 3, \"time\": \"13:45\", \"minutes\": 60, \"label\": \"Review this week's lecture notes\"}, {\"day\": 4, \"time\": \"15:15\", \"minutes\": 60, \"label\": \"Catch up on any missed material\"}, {\"day\": 5, \"time\": \"14:15\", \"minutes\": 90, \"label\": \"Get ahead on upcoming readings\"}, {\"day\": 6, \"time\": \"13:30\", \"minutes\": 60, \"label\": \"Tidy notes and fix gaps\"}, {\"day\": 0, \"time\": \"14:15\", \"minutes\": 30, \"label\": \"Practice problems from class\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Sunday Sun Dec 06 2026 14:49:33 GMT-0800 (Pacific Standard Time).\n\nUpcoming deadlines:\n- ENGL 106 Problem Set 8: Thu Dec 10 2026 23:59:00 GMT-0800 (Pacific Standard Time)\n- HIST 110 Exam 2 (EXAM): Fri Dec 11 2026 10:00:00 GMT-0800 (Pacific Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-11-30: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-01: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-02: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-03: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-04: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-05: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-06: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your HIST 110 Exam 2 is on Friday, so it gets the first and biggest blocks. This is a fresh start, so the blocks stay gentle.\", \"blocks\": [{\"day\": 0, \"time\": \"15:45\", \"minutes\": 50, \"label\": \"HIST 110: skim slides and the Cold War\"}, {\"day\": 1, \"time\": \"16:00\", \"minutes\": 50, \"label\": \"HIST 110: practice problems on the Industrial Revolution\"}, {\"day\": 2, \"time\": \"15:15\", \"minutes\": 50, \"label\": \"HIST 110 drills: the Industrial Revolution\"}, {\"day\": 3, \"time\": \"13:30\", \"minutes\": 50, \"label\": \"ENGL 106 Problem Set 8: work through the problems\"}, {\"day\": 4, \"time\": \"16:45\", \"minutes\": 50, \"label\": \"HIST 110: mock exam, then fix mistakes\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Wednesday Wed Oct 07 2026 11:16:42 GMT-0500 (Central Daylight Time).\n\nUpcoming deadlines:\n- CS 251 Lab Report 2: Wed Oct 14 2026 23:59:00 GMT-0500 (Central Daylight Time)\n- BIO 110 Lab Report 3: Sun Oct 18 2026 23:59:00 GMT-0500 (Central Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-10-01: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-02: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-03: 1 sessions, 22 focused min, avg score 65\n- 2026-10-04: 2 sessions, 43 focused min, avg score 51\n- 2026-10-05: 2 sessions, 26 focused min, avg score 64\n- 2026-10-06: 2 sessions, 16 focused min, avg score 39\n- 2026-10-07: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 30-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"First up is CS 251 Lab Report 2, due in 7 days. Your focus time was light lately, so I'm not piling on too much. I'll be cheering for you the whole way!\", \"blocks\": [{\"day\": 3, \"time\": \"13:00\", \"minutes\": 30, \"label\": \"Head start on CS 251 Lab Report 2: skim the material\"}, {\"day\": 4, \"time\": \"08:30\", \"minutes\": 30, \"label\": \"Head start on CS 251 Lab Report 2: review recursion\"}, {\"day\": 5, \"time\": \"10:00\", \"minutes\": 30, \"label\": \"Head start on BIO 110 Lab Report 3: skim the material\"}, {\"day\": 6, \"time\": \"10:15\", \"minutes\": 30, \"label\": \"Head start on BIO 110 Lab Report 3: review photosynthesis\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Tuesday Tue Mar 09 2027 12:48:38 GMT-0800 (Pacific Standard Time).\n\nUpcoming deadlines:\n- MA 165 Online Quiz 2: Sat Mar 13 2027 11:59:00 GMT-0800 (Pacific Standard Time)\n- STAT 350 Exam 3 (EXAM): Mon Mar 15 2027 10:00:00 GMT-0700 (Pacific Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-03-03: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-04: 1 sessions, 13 focused min, avg score 65\n- 2027-03-05: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-06: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-07: 1 sessions, 9 focused min, avg score 44\n- 2027-03-08: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-09: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 45-minute pomodoros with 15-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your STAT 350 Exam 3 is on Monday, so let's start there. Last week was pretty quiet, so I kept the plan small and doable.\", \"blocks\": [{\"day\": 2, \"time\": \"14:00\", \"minutes\": 45, \"label\": \"STAT 350: skim slides and hypothesis tests\"}, {\"day\": 3, \"time\": \"13:00\", \"minutes\": 45, \"label\": \"STAT 350: practice problems on confidence intervals\"}, {\"day\": 4, \"time\": \"16:15\", \"minutes\": 45, \"label\": \"STAT 350 drills: confidence intervals\"}, {\"day\": 5, \"time\": \"13:30\", \"minutes\": 45, \"label\": \"MA 165 Online Quiz 2: review key ideas\"}, {\"day\": 0, \"time\": \"14:00\", \"minutes\": 45, \"label\": \"Last look at STAT 350: regression\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Saturday Sat Oct 31 2026 17:00:06 GMT-0600 (Mountain Daylight Time).\n\nUpcoming deadlines:\n- CS 251 Quiz 4: Mon Nov 09 2026 23:59:00 GMT-0700 (Mountain Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-10-25: 1 sessions, 30 focused min, avg score 45\n- 2026-10-26: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-27: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-28: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-29: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-30: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-31: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"CS 251 Quiz 4 is due in 9 days, so that's our first stop. Your focus time was light lately, so I'm not piling on too much.\", \"blocks\": [{\"day\": 6, \"time\": \"18:45\", \"minutes\": 25, \"label\": \"Head start on CS 251 Quiz 4: skim the material\"}, {\"day\": 0, \"time\": \"18:30\", \"minutes\": 25, \"label\": \"Head start on CS 251 Quiz 4: review Big-O analysis\"}, {\"day\": 1, \"time\": \"18:30\", \"minutes\": 25, \"label\": \"Quick recap of CS 251 notes\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Tuesday Tue Mar 09 2027 16:34:20 GMT-0500 (Eastern Standard Time).\n\nUpcoming deadlines:\n- ENGL 106 Midterm 2 (EXAM): Fri Mar 12 2027 19:00:00 GMT-0500 (Eastern Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-03-03: 1 sessions, 9 focused min, avg score 58\n- 2027-03-04: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-05: 2 sessions, 42 focused min, avg score 43\n- 2027-03-06: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-07: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-08: 2 sessions, 25 focused min, avg score 61\n- 2027-03-09: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 30-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your ENGL 106 Midterm 2 is on Friday, so it gets the first and biggest blocks. Your focus time was light lately, so I'm not piling on too much. You've got this!\", \"blocks\": [{\"day\": 2, \"time\": \"17:45\", \"minutes\": 30, \"label\": \"Start ENGL 106 exam review: close reading\"}, {\"day\": 3, \"time\": \"14:15\", \"minutes\": 30, \"label\": \"ENGL 106: practice problems on argument structure\"}, {\"day\": 4, \"time\": \"13:30\", \"minutes\": 30, \"label\": \"Last look at ENGL 106: citations\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Friday Fri Dec 11 2026 16:36:59 GMT-0500 (Eastern Standard Time).\n\nUpcoming deadlines:\n- PSY 120 Group Presentation: Mon Dec 14 2026 23:59:00 GMT-0500 (Eastern Standard Time)\n- CS 180 Final Exam (EXAM): Tue Dec 15 2026 15:30:00 GMT-0500 (Eastern Standard Time)\n- PHYS 172 Exam 1 (EXAM): Sun Dec 20 2026 13:00:00 GMT-0500 (Eastern Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-12-05: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-06: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-07: 4 sessions, 99 focused min, avg score 76\n- 2026-12-08: 4 sessions, 101 focused min, avg score 82\n- 2026-12-09: 2 sessions, 65 focused min, avg score 69\n- 2026-12-10: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-11: 1 sessions, 12 focused min, avg score 82\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your CS 180 Final Exam is on Tuesday, so it gets the first and biggest blocks. I focused on the closest deadlines first and kept the load realistic. One pomodoro at a time, and you'll get there.\", \"blocks\": [{\"day\": 5, \"time\": \"18:15\", \"minutes\": 50, \"label\": \"Start CS 180 exam review: functions\"}, {\"day\": 6, \"time\": \"15:15\", \"minutes\": 50, \"label\": \"CS 180: practice problems on file I/O\"}, {\"day\": 0, \"time\": \"14:00\", \"minutes\": 50, \"label\": \"CS 180 final recap: key ideas and weak spots\"}, {\"day\": 1, \"time\": \"16:00\", \"minutes\": 50, \"label\": \"Head start on PHYS 172 Exam 1: skim the material\"}, {\"day\": 2, \"time\": \"13:30\", \"minutes\": 50, \"label\": \"Head start on PHYS 172 Exam 1: review circuits\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Tuesday Tue Dec 01 2026 14:40:28 GMT-0800 (Pacific Standard Time).\n\nUpcoming deadlines:\n- ECON 251 Lab Report 3: Thu Dec 03 2026 14:00:00 GMT-0800 (Pacific Standard Time)\n- PHYS 172 Online Quiz 2: Sat Dec 05 2026 14:00:00 GMT-0800 (Pacific Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-11-25: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-26: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-27: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-28: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-29: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-30: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-01: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"ECON 251 Lab Report 3 is due on Thursday, so that's our first stop. This is a fresh start, so the blocks stay gentle. I'll be cheering for you the whole way!\", \"blocks\": [{\"day\": 2, \"time\": \"16:15\", \"minutes\": 50, \"label\": \"ECON 251 Lab Report 3: organize data and figures\"}, {\"day\": 3, \"time\": \"14:00\", \"minutes\": 50, \"label\": \"ECON 251 Lab Report 3: write conclusion and proofread\"}, {\"day\": 5, \"time\": \"13:30\", \"minutes\": 50, \"label\": \"PHYS 172 Online Quiz 2: review key ideas\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Wednesday Wed Oct 21 2026 19:51:10 GMT+0000 (Coordinated Universal Time).\n\nUpcoming deadlines:\n- MA 261 Exam 2 (EXAM): Sat Oct 24 2026 13:00:00 GMT+0000 (Coordinated Universal Time)\n- MA 165 Lab Report 3: Sat Oct 24 2026 17:00:00 GMT+0000 (Coordinated Universal Time)\n- ENGL 106 Lab Report 2: Tue Oct 27 2026 23:59:00 GMT+0000 (Coordinated Universal Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-10-15: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-16: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-17: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-18: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-19: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-20: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-21: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"MA 261 Exam 2 is on Saturday, so I put it at the front of the plan. There's a lot coming up, so I put the nearest ones first and kept each day doable. I'll be cheering for you the whole way!\", \"blocks\": [{\"day\": 3, \"time\": \"20:45\", \"minutes\": 50, \"label\": \"Start MA 261 exam review: Lagrange multipliers\"}, {\"day\": 4, \"time\": \"19:15\", \"minutes\": 50, \"label\": \"MA 261: practice problems on double integrals\"}, {\"day\": 5, \"time\": \"18:30\", \"minutes\": 50, \"label\": \"Last look at MA 261: gradients\"}, {\"day\": 0, \"time\": \"19:30\", \"minutes\": 50, \"label\": \"ENGL 106 Lab Report 2: organize data and figures\"}, {\"day\": 1, \"time\": \"18:45\", \"minutes\": 50, \"label\": \"ENGL 106 Lab Report 2: write conclusion and proofread\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Tuesday Tue Dec 29 2026 10:08:02 GMT-0600 (Central Standard Time).\n\nUpcoming deadlines:\n- CHEM 201 Group Presentation: Wed Dec 30 2026 23:59:00 GMT-0600 (Central Standard Time)\n- HIST 110 Exam 3 (EXAM): Sat Jan 02 2027 17:00:00 GMT-0600 (Central Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-12-23: 2 sessions, 48 focused min, avg score 61\n- 2026-12-24: 3 sessions, 72 focused min, avg score 75\n- 2026-12-25: 4 sessions, 126 focused min, avg score 64\n- 2026-12-26: 3 sessions, 86 focused min, avg score 74\n- 2026-12-27: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-28: 2 sessions, 60 focused min, avg score 68\n- 2026-12-29: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 30-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your HIST 110 Exam 3 is on Saturday, so let's start there. It matches the steady pace you've had lately. Bloop believes in you!\", \"blocks\": [{\"day\": 2, \"time\": \"11:30\", \"minutes\": 30, \"label\": \"HIST 110: skim slides and the Cold War\"}, {\"day\": 2, \"time\": \"12:45\", \"minutes\": 60, \"label\": \"CHEM 201 Group Presentation: build the slides\"}, {\"day\": 3, \"time\": \"09:00\", \"minutes\": 90, \"label\": \"HIST 110: practice problems on primary sources\"}, {\"day\": 4, \"time\": \"08:00\", \"minutes\": 30, \"label\": \"HIST 110 drills: primary sources\"}, {\"day\": 5, \"time\": \"09:30\", \"minutes\": 30, \"label\": \"Last look at HIST 110: key dates\"}]}"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student's 5-minute break is over and the next 50-minute focus block is starting. Write one short, kind back-to-work nudge (max 60 characters)."}, {"role": "assistant", "content": "break over! your goals are waiting"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Saturday Sat Nov 14 2026 20:58:25 GMT-0800 (Pacific Standard Time).\n\nUpcoming deadlines:\n- (no upcoming deadlines found)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-11-08: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-09: 1 sessions, 13 focused min, avg score 45\n- 2026-11-10: 2 sessions, 31 focused min, avg score 46\n- 2026-11-11: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-12: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-13: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-14: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"No deadlines in sight, so let's use the time to get ahead gently. Your focus time was light lately, so I'm not piling on too much. Take your breaks too, I'll be right here.\", \"blocks\": [{\"day\": 0, \"time\": \"18:45\", \"minutes\": 50, \"label\": \"Light revision: summarize key ideas\"}, {\"day\": 1, \"time\": \"18:00\", \"minutes\": 75, \"label\": \"Practice problems from class\"}, {\"day\": 2, \"time\": \"20:00\", \"minutes\": 25, \"label\": \"Review this week's lecture notes\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Monday Mon Jan 04 2027 19:25:21 GMT-0500 (Eastern Standard Time).\n\nUpcoming deadlines:\n- ECON 251 Group Presentation: Thu Jan 07 2027 11:59:00 GMT-0500 (Eastern Standard Time)\n- STAT 350 Exam 1 (EXAM): Tue Jan 12 2027 13:00:00 GMT-0500 (Eastern Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-12-29: 1 sessions, 17 focused min, avg score 57\n- 2026-12-30: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-31: 0 sessions, 0 focused min, avg score n/a\n- 2027-01-01: 2 sessions, 33 focused min, avg score 52\n- 2027-01-02: 0 sessions, 0 focused min, avg score n/a\n- 2027-01-03: 2 sessions, 18 focused min, avg score 53\n- 2027-01-04: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"ECON 251 Group Presentation is due on Thursday, so that's our first stop. Your focus time was light lately, so I'm not piling on too much. Bloop believes in you!\", \"blocks\": [{\"day\": 1, \"time\": \"20:45\", \"minutes\": 50, \"label\": \"ECON 251 Group Presentation: build the slides\"}, {\"day\": 2, \"time\": \"19:00\", \"minutes\": 50, \"label\": \"ECON 251 Group Presentation: practice the talk out loud\"}, {\"day\": 3, \"time\": \"19:00\", \"minutes\": 50, \"label\": \"Head start on STAT 350 Exam 1: skim the material\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Wednesday Wed Feb 03 2027 11:57:36 GMT-0500 (Eastern Standard Time).\n\nUpcoming deadlines:\n- STAT 350 Online Quiz 2: Wed Feb 03 2027 17:00:00 GMT-0500 (Eastern Standard Time)\n- CS 251 Group Presentation: Wed Feb 03 2027 23:59:00 GMT-0500 (Eastern Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-01-28: 0 sessions, 0 focused min, avg score n/a\n- 2027-01-29: 1 sessions, 23 focused min, avg score 73\n- 2027-01-30: 0 sessions, 0 focused min, avg score n/a\n- 2027-01-31: 3 sessions, 50 focused min, avg score 52\n- 2027-02-01: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-02: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-03: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 45-minute pomodoros with 15-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"STAT 350 Online Quiz 2 is due today, so the plan is short and focused. There's a lot coming up, so I put the nearest ones first and kept each day doable.\", \"blocks\": [{\"day\": 3, \"time\": \"13:15\", \"minutes\": 45, \"label\": \"STAT 350 Online Quiz 2: review probability rules\"}, {\"day\": 3, \"time\": \"14:30\", \"minutes\": 45, \"label\": \"STAT 350 Online Quiz 2: review regression\"}, {\"day\": 3, \"time\": \"15:45\", \"minutes\": 45, \"label\": \"Final push: STAT 350 Online Quiz 2\"}]}"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student just finished a focus session of 120 minutes (4 pomodoros). Write one short, kind session-complete nudge (max 60 characters)."}, {"role": "assistant", "content": "session done. future you says thank you"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Thursday Thu Dec 17 2026 19:40:28 GMT-0500 (Eastern Standard Time).\n\nUpcoming deadlines:\n- PSY 120 Exam 3 (EXAM): Sun Dec 20 2026 13:00:00 GMT-0500 (Eastern Standard Time)\n- ECON 251 Final Exam (EXAM): Tue Dec 22 2026 14:00:00 GMT-0500 (Eastern Standard Time)\n- ART 120 Lab Report 5: Wed Dec 23 2026 11:59:00 GMT-0500 (Eastern Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-12-11: 2 sessions, 38 focused min, avg score 72\n- 2026-12-12: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-13: 3 sessions, 49 focused min, avg score 62\n- 2026-12-14: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-15: 1 sessions, 35 focused min, avg score 58\n- 2026-12-16: 1 sessions, 28 focused min, avg score 75\n- 2026-12-17: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 45-minute pomodoros with 15-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"PSY 120 Exam 3 is on Sunday, so I put it at the front of the plan. There's a lot coming up, so I put the nearest ones first and kept each day doable. One pomodoro at a time, and you'll get there.\", \"blocks\": [{\"day\": 4, \"time\": \"21:00\", \"minutes\": 45, \"label\": \"Start PSY 120 exam review: memory models\"}, {\"day\": 5, \"time\": \"18:30\", \"minutes\": 45, \"label\": \"PSY 120: practice problems on cognitive biases\"}, {\"day\": 6, \"time\": \"19:00\", \"minutes\": 45, \"label\": \"PSY 120: mock exam, then fix mistakes\"}, {\"day\": 1, \"time\": \"18:15\", \"minutes\": 45, \"label\": \"ECON 251 Final Exam review: market structures + elasticity\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Thursday Thu Jan 21 2027 09:08:46 GMT-0600 (Central Standard Time).\n\nUpcoming deadlines:\n- MA 165 Exam 3 (EXAM): Wed Jan 27 2027 15:30:00 GMT-0600 (Central Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-01-15: 0 sessions, 0 focused min, avg score n/a\n- 2027-01-16: 3 sessions, 95 focused min, avg score 70\n- 2027-01-17: 0 sessions, 0 focused min, avg score n/a\n- 2027-01-18: 0 sessions, 0 focused min, avg score n/a\n- 2027-01-19: 1 sessions, 22 focused min, avg score 64\n- 2027-01-20: 1 sessions, 27 focused min, avg score 61\n- 2027-01-21: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"MA 165 Exam 3 is on Wednesday, so I put it at the front of the plan. Your focus time was light lately, so I'm not piling on too much.\", \"blocks\": [{\"day\": 4, \"time\": \"11:15\", \"minutes\": 25, \"label\": \"MA 165: skim slides and limits\"}, {\"day\": 5, \"time\": \"09:45\", \"minutes\": 25, \"label\": \"MA 165: practice problems on derivative rules\"}, {\"day\": 6, \"time\": \"09:30\", \"minutes\": 25, \"label\": \"MA 165 drills: derivative rules\"}, {\"day\": 0, \"time\": \"08:30\", \"minutes\": 25, \"label\": \"MA 165: redo tricky integration questions\"}, {\"day\": 1, \"time\": \"09:30\", \"minutes\": 25, \"label\": \"Last look at MA 165: integration\"}]}"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student has been on pinterest.com for 2 minutes during a focus session. Write one short, kind nudge (max 60 characters)."}, {"role": "assistant", "content": "pause the distractions, press play on focus"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student just finished a 60-minute focus block and a 5-minute break is starting. Write one short, kind break-time nudge (max 60 characters)."}, {"role": "assistant", "content": "relax your jaw, drop your shoulders, breathe"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Friday Fri Nov 06 2026 17:26:32 GMT-0600 (Central Standard Time).\n\nUpcoming deadlines:\n- (no upcoming deadlines found)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-10-31: 1 sessions, 23 focused min, avg score 45\n- 2026-11-01: 2 sessions, 18 focused min, avg score 54\n- 2026-11-02: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-03: 1 sessions, 11 focused min, avg score 64\n- 2026-11-04: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-05: 2 sessions, 50 focused min, avg score 48\n- 2026-11-06: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"It's a quiet week on the calendar, so I kept things light and steady. Your focus time was light lately, so I'm not piling on too much. You've got this!\", \"blocks\": [{\"day\": 5, \"time\": \"18:45\", \"minutes\": 50, \"label\": \"Get ahead on upcoming readings\"}, {\"day\": 6, \"time\": \"19:15\", \"minutes\": 50, \"label\": \"Make flashcards from class notes\"}, {\"day\": 0, \"time\": \"19:00\", \"minutes\": 100, \"label\": \"Light revision: summarize key ideas\"}, {\"day\": 1, \"time\": \"19:45\", \"minutes\": 50, \"label\": \"Review this week's lecture notes\"}, {\"day\": 2, \"time\": \"19:45\", \"minutes\": 50, \"label\": \"Plan next week's study goals\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Monday Mon Mar 08 2027 18:29:28 GMT-0800 (Pacific Standard Time).\n\nUpcoming deadlines:\n- PHYS 172 Exam 1 (EXAM): Thu Mar 11 2027 18:30:00 GMT-0800 (Pacific Standard Time)\n- CS 251 Midterm 2 (EXAM): Fri Mar 12 2027 17:00:00 GMT-0800 (Pacific Standard Time)\n- PSY 120 Midterm (EXAM): Sat Mar 13 2027 09:00:00 GMT-0800 (Pacific Standard Time)\n- ART 120 Reading Response 4: Mon Mar 15 2027 09:00:00 GMT-0700 (Pacific Daylight Time)\n- CS 180 Exam 2 (EXAM): Tue Mar 16 2027 15:30:00 GMT-0700 (Pacific Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-03-02: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-03: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-04: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-05: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-06: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-07: 1 sessions, 33 focused min, avg score 54\n- 2027-03-08: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"PHYS 172 Exam 1 is on Thursday, so I put it at the front of the plan. I focused on the closest deadlines first and kept the load realistic. Bloop believes in you!\", \"blocks\": [{\"day\": 1, \"time\": \"20:30\", \"minutes\": 25, \"label\": \"PHYS 172: skim slides and Newton's laws\"}, {\"day\": 2, \"time\": \"18:45\", \"minutes\": 25, \"label\": \"PHYS 172: practice problems on circuits\"}, {\"day\": 3, \"time\": \"18:30\", \"minutes\": 25, \"label\": \"PHYS 172 final recap: key ideas and weak spots\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Sunday Sun May 02 2027 11:33:51 GMT-0700 (Pacific Daylight Time).\n\nUpcoming deadlines:\n- (no upcoming deadlines found)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-04-26: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-27: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-28: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-29: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-30: 0 sessions, 0 focused min, avg score n/a\n- 2027-05-01: 0 sessions, 0 focused min, avg score n/a\n- 2027-05-02: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 30-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"It's a quiet week on the calendar, so I kept things light and steady. I don't see any focus history yet, so I kept the sessions short and easy. Blocks are built from 30-minute pomodoros with 5-minute breaks.\", \"blocks\": [{\"day\": 0, \"time\": \"13:45\", \"minutes\": 90, \"label\": \"Light revision: summarize key ideas\"}, {\"day\": 1, \"time\": \"10:15\", \"minutes\": 60, \"label\": \"Make flashcards from class notes\"}, {\"day\": 2, \"time\": \"08:30\", \"minutes\": 60, \"label\": \"Catch up on any missed material\"}, {\"day\": 3, \"time\": \"09:15\", \"minutes\": 60, \"label\": \"Practice problems from class\"}]}"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student has been on reddit.com for 5 minutes during a focus session. Write one short, kind nudge (max 60 characters)."}, {"role": "assistant", "content": "you can do this, one pomodoro at a time"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student just came back to their study app after 8 minutes away. Write one short, kind welcome-back nudge (max 60 characters)."}, {"role": "assistant", "content": "you're back and bloop is wiggling with joy"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Thursday Thu Dec 17 2026 17:26:15 GMT-0800 (Pacific Standard Time).\n\nUpcoming deadlines:\n- STAT 350 Midterm 1 (EXAM): Wed Dec 23 2026 18:30:00 GMT-0800 (Pacific Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-12-11: 4 sessions, 99 focused min, avg score 63\n- 2026-12-12: 2 sessions, 70 focused min, avg score 58\n- 2026-12-13: 3 sessions, 81 focused min, avg score 75\n- 2026-12-14: 4 sessions, 113 focused min, avg score 79\n- 2026-12-15: 4 sessions, 130 focused min, avg score 61\n- 2026-12-16: 3 sessions, 91 focused min, avg score 64\n- 2026-12-17: 1 sessions, 17 focused min, avg score 85\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"STAT 350 Midterm 1 is on Wednesday, so I put it at the front of the plan. I sized the blocks to fit how you've been studying. I'll be cheering for you the whole way!\", \"blocks\": [{\"day\": 4, \"time\": \"18:15\", \"minutes\": 50, \"label\": \"Start STAT 350 exam review: confidence intervals\"}, {\"day\": 5, \"time\": \"19:30\", \"minutes\": 25, \"label\": \"STAT 350: practice problems on regression\"}, {\"day\": 6, \"time\": \"19:00\", \"minutes\": 25, \"label\": \"STAT 350 drills: regression\"}, {\"day\": 0, \"time\": \"19:30\", \"minutes\": 75, \"label\": \"Last look at STAT 350: hypothesis tests\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Saturday Sat Jan 30 2027 21:10:54 GMT-0500 (Eastern Standard Time).\n\nUpcoming deadlines:\n- CS 180 Exam 2 (EXAM): Wed Feb 03 2027 09:00:00 GMT-0500 (Eastern Standard Time)\n- ECON 251 Project 3: Wed Feb 03 2027 14:00:00 GMT-0500 (Eastern Standard Time)\n- PSY 120 Lab Report 3: Thu Feb 04 2027 23:59:00 GMT-0500 (Eastern Standard Time)\n- ART 120 Exam 2 (EXAM): Sat Feb 06 2027 11:00:00 GMT-0500 (Eastern Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-01-24: 0 sessions, 0 focused min, avg score n/a\n- 2027-01-25: 0 sessions, 0 focused min, avg score n/a\n- 2027-01-26: 0 sessions, 0 focused min, avg score n/a\n- 2027-01-27: 0 sessions, 0 focused min, avg score n/a\n- 2027-01-28: 1 sessions, 8 focused min, avg score 59\n- 2027-01-29: 2 sessions, 19 focused min, avg score 35\n- 2027-01-30: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 30-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"CS 180 Exam 2 is on Wednesday, so I put it at the front of the plan. There's a lot coming up, so I put the nearest ones first and kept each day doable. One pomodoro at a time, and you'll get there.\", \"blocks\": [{\"day\": 0, \"time\": \"18:45\", \"minutes\": 30, \"label\": \"CS 180 exam prep: review notes on functions\"}, {\"day\": 1, \"time\": \"19:00\", \"minutes\": 30, \"label\": \"CS 180: practice problems on Python loops\"}, {\"day\": 2, \"time\": \"19:30\", \"minutes\": 30, \"label\": \"CS 180: mock exam, then fix mistakes\"}, {\"day\": 4, \"time\": \"18:15\", \"minutes\": 30, \"label\": \"Head start on ART 120 Exam 2: skim the material\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Monday Mon Feb 22 2027 16:17:50 GMT-0800 (Pacific Standard Time).\n\nUpcoming deadlines:\n- (no upcoming deadlines found)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-02-16: 3 sessions, 94 focused min, avg score 72\n- 2027-02-17: 2 sessions, 64 focused min, avg score 68\n- 2027-02-18: 2 sessions, 62 focused min, avg score 68\n- 2027-02-19: 3 sessions, 96 focused min, avg score 61\n- 2027-02-20: 4 sessions, 120 focused min, avg score 76\n- 2027-02-21: 4 sessions, 110 focused min, avg score 70\n- 2027-02-22: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"It's a quiet week on the calendar, so I kept things light and steady. I sized the blocks to fit how you've been studying.\", \"blocks\": [{\"day\": 1, \"time\": \"17:30\", \"minutes\": 50, \"label\": \"Tidy notes and fix gaps\"}, {\"day\": 2, \"time\": \"16:00\", \"minutes\": 100, \"label\": \"Light revision: summarize key ideas\"}, {\"day\": 3, \"time\": \"15:45\", \"minutes\": 100, \"label\": \"Make flashcards from class notes\"}, {\"day\": 4, \"time\": \"14:15\", \"minutes\": 50, \"label\": \"Get ahead on upcoming readings\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Monday Mon Feb 22 2027 15:21:54 GMT-0600 (Central Standard Time).\n\nUpcoming deadlines:\n- BIO 110 Midterm 1 (EXAM): Tue Feb 23 2027 11:00:00 GMT-0600 (Central Standard Time)\n- ENGL 106 Quiz 4: Tue Feb 23 2027 23:59:00 GMT-0600 (Central Standard Time)\n- CS 251 Group Project Part 1: Wed Feb 24 2027 23:59:00 GMT-0600 (Central Standard Time)\n- STAT 350 Paper Outline: Thu Feb 25 2027 11:59:00 GMT-0600 (Central Standard Time)\n- PSY 120 Project Milestone 2: Fri Feb 26 2027 17:00:00 GMT-0600 (Central Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-02-16: 1 sessions, 13 focused min, avg score 55\n- 2027-02-17: 1 sessions, 10 focused min, avg score 62\n- 2027-02-18: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-19: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-20: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-21: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-22: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your BIO 110 Midterm 1 is tomorrow, so it gets the first and biggest blocks. There's a lot coming up, so I put the nearest ones first and kept each day doable. You've got this!\", \"blocks\": [{\"day\": 1, \"time\": \"17:00\", \"minutes\": 50, \"label\": \"BIO 110: skim slides and cell respiration\"}, {\"day\": 1, \"time\": \"19:00\", \"minutes\": 50, \"label\": \"Light BIO 110 review: cell respiration\"}, {\"day\": 3, \"time\": \"13:30\", \"minutes\": 50, \"label\": \"STAT 350 Paper Outline: outline and draft\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Friday Fri Apr 02 2027 16:30:07 GMT-0700 (Pacific Daylight Time).\n\nUpcoming deadlines:\n- (no upcoming deadlines found)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-03-27: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-28: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-29: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-30: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-31: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-01: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-02: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Nothing is due soon, so this is a calm week to build a rhythm. This is a fresh start, so the blocks stay gentle. Take your breaks too, I'll be right here.\", \"blocks\": [{\"day\": 5, \"time\": \"17:15\", \"minutes\": 50, \"label\": \"Review this week's lecture notes\"}, {\"day\": 6, \"time\": \"15:30\", \"minutes\": 100, \"label\": \"Plan next week's study goals\"}, {\"day\": 0, \"time\": \"13:00\", \"minutes\": 100, \"label\": \"Light revision: summarize key ideas\"}]}"}]}
``````

### `ml/data/nudge_lines.py`

<!-- FILE: ml/data/nudge_lines.py sha256=205c462521ddad69bbc9b805a7cf2373ab190bcaa0d6bb310e88c95a5b161121 nl=1 -->
``````python
"""Hand-written pool of Bloop nudge lines (all lowercase-casual, <= 60 chars, at most one emoji).

POOL[kind] is a list of lines; DRIFT_SITE[key] holds lines that name a specific site/app and are only
used when the prompt's site/app contains `key`. Do not put digits in lines: the prompt's minute counts vary.
"""

POOL = {
    "drift": [
        "hey, that tab can wait. back to the books?",
        "psst... your focus session is still running",
        "bloop misses you. come back to your work?",
        "just a tiny detour, right? let's head back",
        "your future self says thanks for refocusing",
        "one deep breath, then back to studying 🌱",
        "scrolling can wait, you're doing so well",
        "you've got this, let's get back on track",
        "quick peek is over, time to refocus",
        "bloop is cheering for you to come back",
        "that can wait until your break, i promise",
        "gentle nudge: your study window is waiting",
        "ready to hop back in? i'll be right here",
        "oops, wandered off! let's go back together",
        "your focus streak is waiting for you 💪",
        "small detour, big comeback. let's go",
        "a few more minutes of focus, then a treat?",
        "i believe in you, now back to work",
        "break time is later. focus time is now",
        "let's close this tab and finish strong ✨",
        "your notes miss you, come say hi",
        "back to it? you're so close to done",
        "tiny nudge from your pet: refocus time",
        "no worries, everyone drifts. come on back",
        "you were doing great, let's pick it up again",
        "hey friend, remember your goal today?",
        "that's enough for now, back to studying",
        "bloop will wait here while you refocus",
        "a little focus now means more fun later",
        "pause the distractions, press play on focus",
        "let's save that for your break 🐾",
        "you can do this, one pomodoro at a time",
    ],
    "welcome": [
        "welcome back! let's pick up where you left off",
        "yay, you're back! ready to focus?",
        "there you are! i saved your spot 🐾",
        "welcome back, friend. one step at a time",
        "glad you're back, let's make this count",
        "nice to see you again! shall we continue?",
        "back in the zone? bloop is so proud ✨",
        "you came back, and that's what counts",
        "welcome back! your notes missed you",
        "hi again! let's get cozy and focus",
        "and we're back! deep breath, here we go",
        "good to have you back, you've got this",
        "no pressure, just pick up the next thing",
        "welcome back! small steps are still steps",
        "ready when you are, i'm right here",
        "hooray, focus mode is back on 🌟",
        "you're back! that was a quick trip",
        "right on time. let's get into it",
        "welcome back to the books, superstar",
        "your desk is warm and your pet is happy",
        "oh good, you're back! let's start gently",
        "back to focus. i never doubted you for a second",
        "welcome back! let's make the next bit count",
        "hey, you! ready for a fresh start?",
        "so happy you're here again 💛",
        "reset done. now let's get studying",
        "great choice coming back, keep it up",
        "look who's back! let's do this together",
        "welcome back, no guilt, just focus",
        "the session is rolling again. nice work!",
        "you're back and bloop is wiggling with joy",
        "take a breath, and let's begin again",
    ],
    "break": [
        "nice work! time for a little break ☕",
        "break time! stretch and sip some water",
        "you earned this break, go relax a bit",
        "pomodoro done! give your eyes a rest",
        "great focus! now go grab a snack 🍎",
        "time to stand up and stretch those legs",
        "break time, friend. you did amazing",
        "rest those brain cells for a few minutes",
        "well done! take a walk or look out a window",
        "you've earned a breather, enjoy it",
        "time to recharge. bloop is proud of you ✨",
        "snack, water, stretch. in any order!",
        "take a breather and let your mind wander",
        "good job! step away from the screen a bit",
        "look at something far away for a while",
        "easy now, you've done great work 🌱",
        "go ahead, rest. i'll keep your seat warm",
        "that was a solid block. enjoy your break",
        "deep breath in, deep breath out. well done",
        "pause the brain and refill your water 💧",
        "yay, a break! maybe a little dance?",
        "your break starts now, no studying allowed",
        "stretch your shoulders, you've been awesome",
        "step outside for fresh air if you can",
        "focus block complete. proud of you!",
        "reward time! a tiny treat is allowed 🍪",
        "relax your jaw, drop your shoulders, breathe",
        "good work. let your eyes rest for a while",
        "break time! i'll do some wiggles too",
    ],
    "back": [
        "break's over, ready for the next round?",
        "time to dive back in, you've got this",
        "refreshed? let's start the next block 🌟",
        "back to it! one pomodoro at a time",
        "okay, focus mode on. bloop is with you",
        "break done. let's get a little more done",
        "ready, set, focus! you can do this",
        "snack eaten, water sipped, let's go",
        "let's pick up the next task together",
        "back to the books, champion",
        "next block starts now. small steps count",
        "feeling rested? let's make this one good",
        "time to focus again, i believe in you",
        "easy start: just open your notes and go",
        "round two! you're doing great today",
        "break's finished, let's gently get going",
        "tiny step first: open the next task 🌱",
        "all recharged? time to shine ✨",
        "back to work, i'll cheer from the corner",
        "let's go! the next block is yours",
        "welcome back from break, ready to roll?",
        "back at it. a little more and you're done",
        "start with the easiest bit, then build up",
        "stretch done? great, focus time is here",
        "okay friend, deep breath and back in",
        "the timer is running, let's make it count",
        "you rested well, now let's get it done",
        "just start. the rest will follow 💪",
        "break over! your goals are waiting",
        "let's do this, one calm step at a time",
    ],
    "done": [
        "session complete! you were amazing today 🎉",
        "all done! bloop is so proud of you",
        "great work today, you earned a good rest",
        "you did it! time to relax, superstar",
        "wow, what a session. be proud of that",
        "that's a wrap! go treat yourself 🍪",
        "focus session finished. you're awesome ✨",
        "yay, you finished! see you next time",
        "another session in the bag, nice job",
        "you showed up and it paid off 🌟",
        "done for now! rest up, you've earned it",
        "so proud of your effort today 💛",
        "your brain worked hard, so let it rest",
        "mission accomplished! bloop did a happy dance",
        "well done! every session adds up",
        "great job sticking with it today",
        "that's all for this session. go celebrate!",
        "you finished strong. i'm doing wiggles 🐾",
        "time to close the books, you did great",
        "high five! another session done",
        "progress made today. that's what matters",
        "nap, snack, or walk? you pick, you earned it",
        "good work! come back tomorrow for more",
        "you crushed it today 💪",
        "study session over. you're a star",
        "look at you go! so much focus today",
        "finished! be kind to yourself and rest",
        "slow and steady wins, and you won today",
        "proud pet moment: you finished the whole thing",
        "session done. future you says thank you",
    ],
}

# Lines that name a site/app. Used for the "drift" kind when the prompt's site/app contains the key.
DRIFT_SITE = {
    "youtube": [
        "that video will still be there after your session",
        "youtube can wait, bloop saved you a study spot",
        "close the player, open the notes 📚",
    ],
    "reddit": [
        "the thread will keep scrolling without you",
        "reddit will still be there on your break",
    ],
    "tiktok": [
        "the next tiktok can wait, finish this first",
        "swipe back to your studies, you've got this",
    ],
    "instagram": [
        "the feed will keep. let's get back to it",
        "stories will still be there after your session",
    ],
    "netflix": [
        "the show will pause nicely. back to studying?",
        "your episode will wait for your break 🍿",
    ],
    "twitch": [
        "the stream can wait, you've got work to do",
        "streamers come and go, your focus stays",
    ],
    "discord": [
        "the chat can wait, your focus is on a roll",
        "messages will still be there after focus time",
    ],
    "steam": [
        "the game will wait, let's finish studying first",
        "save that quest for after your session 🎮",
    ],
    "twitter": [
        "the timeline can wait, back to your notes",
    ],
}

# Per kind, how many lines (from the end of POOL[kind]) are held out for eval.jsonl only.
EVAL_HOLDOUT = 3
``````

### `ml/data/render_prompts.cjs`

<!-- FILE: ml/data/render_prompts.cjs sha256=cd1fdd22a6957531fa46b67fb53a8ee33a5abd497ca27c6d1e27fca49a56a05c nl=1 -->
``````js
// Renders the exact study-plan prompt by running buildPrompt() extracted from src/main/plan.ts.
// Usage: node render_prompts.cjs < scenarios.json > prompts.json
// Input : [{tz, now:[y,m,d,h,mi,s], deadlines:[{summary,isExam,at:[y,m,d,h,mi]}],
//           last7:[{date,sessions,focusSec,avgScore}], focusMinutes, breakMinutes}]
// Output: ["<prompt>", ...]
const fs = require('fs')
const path = require('path')
const esbuild = require(path.resolve(__dirname, '../../node_modules/esbuild'))

const src = fs.readFileSync(path.resolve(__dirname, '../../src/main/plan.ts'), 'utf8')
const a = src.indexOf('const DAY_NAMES')
const bStart = src.indexOf('export function buildPrompt')
const bEnd = src.indexOf('\n}\n', bStart)
if (a < 0 || bStart < 0 || bEnd < 0) throw new Error('could not locate buildPrompt in plan.ts')
const snippet = src.slice(a, bEnd + 3).replace('export function buildPrompt', 'function buildPrompt')
// Types (Deadline, Stats, ...) are erased by esbuild; they are not imported here.
const js = esbuild.transformSync(snippet, { loader: 'ts', format: 'cjs' }).code
const buildPrompt = new Function(js + '\nreturn buildPrompt')()

const scenarios = JSON.parse(fs.readFileSync(0, 'utf8'))
const out = scenarios.map((s) => {
  process.env.TZ = s.tz
  const [y, mo, d, h, mi, se] = s.now
  const now = new Date(y, mo - 1, d, h, mi, se)
  const deadlines = s.deadlines.map((x, i) => ({
    uid: 'u' + i,
    summary: x.summary,
    isExam: x.isExam,
    start: new Date(x.at[0], x.at[1] - 1, x.at[2], x.at[3], x.at[4], 0).getTime()
  }))
  return buildPrompt(deadlines, { todayAvgScore: null, todayFocusSec: 0, todaySessions: 0, last7: s.last7 },
    { focusMinutes: s.focusMinutes, breakMinutes: s.breakMinutes }, now)
})
process.stdout.write(JSON.stringify(out))
``````

### `ml/data/train.jsonl`

<!-- FILE: ml/data/train.jsonl sha256=56346fe03f14b2e8579803d8b401f347ec4fbac391c663b931a16ddc4920fd13 nl=1 -->
``````jsonl
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Monday Mon Feb 15 2027 18:38:02 GMT-0500 (Eastern Standard Time).\n\nUpcoming deadlines:\n- STAT 350 Essay 2: Thu Feb 18 2027 23:59:00 GMT-0500 (Eastern Standard Time)\n- PHYS 172 Presentation: Fri Feb 19 2027 23:59:00 GMT-0500 (Eastern Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-02-09: 1 sessions, 10 focused min, avg score 67\n- 2027-02-10: 2 sessions, 20 focused min, avg score 52\n- 2027-02-11: 2 sessions, 21 focused min, avg score 37\n- 2027-02-12: 2 sessions, 19 focused min, avg score 36\n- 2027-02-13: 1 sessions, 23 focused min, avg score 41\n- 2027-02-14: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-15: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"First up is STAT 350 Essay 2, due on Thursday. Your focus time was light lately, so I'm not piling on too much.\", \"blocks\": [{\"day\": 1, \"time\": \"20:00\", \"minutes\": 25, \"label\": \"STAT 350 Essay 2: outline and draft\"}, {\"day\": 2, \"time\": \"19:45\", \"minutes\": 25, \"label\": \"STAT 350 Essay 2: outline and draft (part 2)\"}, {\"day\": 3, \"time\": \"18:00\", \"minutes\": 25, \"label\": \"STAT 350 Essay 2: revise and proofread\"}, {\"day\": 4, \"time\": \"17:30\", \"minutes\": 25, \"label\": \"PHYS 172 Presentation: build the slides\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Wednesday Wed Apr 21 2027 14:13:20 GMT-0400 (Eastern Daylight Time).\n\nUpcoming deadlines:\n- BIO 110 Reading Response 4: Wed Apr 28 2027 23:59:00 GMT-0400 (Eastern Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-04-15: 3 sessions, 68 focused min, avg score 67\n- 2027-04-16: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-17: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-18: 2 sessions, 31 focused min, avg score 67\n- 2027-04-19: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-20: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-21: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"BIO 110 Reading Response 4 is due in 7 days, so that's our first stop. Last week was a bit stop-and-go, so I kept the plan small and doable. Take your breaks too, I'll be right here.\", \"blocks\": [{\"day\": 3, \"time\": \"15:30\", \"minutes\": 50, \"label\": \"Head start on BIO 110 Reading Response 4: skim the material\"}, {\"day\": 4, \"time\": \"14:00\", \"minutes\": 50, \"label\": \"Quick recap of BIO 110 notes\"}, {\"day\": 5, \"time\": \"13:15\", \"minutes\": 50, \"label\": \"BIO 110: flashcards and short review\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Wednesday Wed Jan 27 2027 14:50:57 GMT-0800 (Pacific Standard Time).\n\nUpcoming deadlines:\n- SOC 100 Midterm 1 (EXAM): Thu Jan 28 2027 11:00:00 GMT-0800 (Pacific Standard Time)\n- ENGL 106 Quiz 3: Sat Jan 30 2027 11:59:00 GMT-0800 (Pacific Standard Time)\n- CS 180 Essay 2: Sun Jan 31 2027 11:59:00 GMT-0800 (Pacific Standard Time)\n- ART 120 Lab Report 3: Mon Feb 01 2027 23:59:00 GMT-0800 (Pacific Standard Time)\n- MA 261 Group Presentation: Sat Feb 06 2027 09:00:00 GMT-0800 (Pacific Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-01-21: 0 sessions, 0 focused min, avg score n/a\n- 2027-01-22: 2 sessions, 38 focused min, avg score 61\n- 2027-01-23: 3 sessions, 96 focused min, avg score 60\n- 2027-01-24: 0 sessions, 0 focused min, avg score n/a\n- 2027-01-25: 0 sessions, 0 focused min, avg score n/a\n- 2027-01-26: 2 sessions, 61 focused min, avg score 73\n- 2027-01-27: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"You've got 3 things coming up, so I lined them up by what's closest, starting with SOC 100 Midterm 1. I focused on the closest deadlines first and kept the load realistic. I'll be cheering for you the whole way!\", \"blocks\": [{\"day\": 3, \"time\": \"15:45\", \"minutes\": 50, \"label\": \"SOC 100 exam prep: case studies + practice\"}, {\"day\": 5, \"time\": \"15:45\", \"minutes\": 50, \"label\": \"ENGL 106 Quiz 3: review key ideas\"}, {\"day\": 1, \"time\": \"14:15\", \"minutes\": 50, \"label\": \"Head start on MA 261 Group Presentation: skim the material\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Monday Mon Feb 08 2027 16:41:03 GMT-0500 (Eastern Standard Time).\n\nUpcoming deadlines:\n- STAT 350 Problem Set 3: Wed Feb 10 2027 09:00:00 GMT-0500 (Eastern Standard Time)\n- ECON 251 Exam 2 (EXAM): Thu Feb 11 2027 09:00:00 GMT-0500 (Eastern Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-02-02: 2 sessions, 68 focused min, avg score 76\n- 2027-02-03: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-04: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-05: 4 sessions, 127 focused min, avg score 59\n- 2027-02-06: 4 sessions, 91 focused min, avg score 85\n- 2027-02-07: 3 sessions, 90 focused min, avg score 70\n- 2027-02-08: 1 sessions, 14 focused min, avg score 79\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your ECON 251 Exam 2 is on Thursday, so let's start there. It matches the steady pace you've had lately.\", \"blocks\": [{\"day\": 1, \"time\": \"18:30\", \"minutes\": 25, \"label\": \"Light ECON 251 review: GDP and inflation\"}, {\"day\": 1, \"time\": \"19:45\", \"minutes\": 75, \"label\": \"ECON 251: practice problems on elasticity\"}, {\"day\": 2, \"time\": \"14:15\", \"minutes\": 25, \"label\": \"Quick recap of ECON 251 notes\"}, {\"day\": 2, \"time\": \"16:15\", \"minutes\": 50, \"label\": \"ECON 251 final recap: key ideas and weak spots\"}, {\"day\": 2, \"time\": \"18:45\", \"minutes\": 25, \"label\": \"STAT 350 Problem Set 3: work through the problems\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Tuesday Tue Dec 22 2026 15:47:21 GMT-0800 (Pacific Standard Time).\n\nUpcoming deadlines:\n- (no upcoming deadlines found)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-12-16: 5 sessions, 168 focused min, avg score 89\n- 2026-12-17: 5 sessions, 143 focused min, avg score 93\n- 2026-12-18: 7 sessions, 279 focused min, avg score 72\n- 2026-12-19: 5 sessions, 180 focused min, avg score 79\n- 2026-12-20: 5 sessions, 199 focused min, avg score 70\n- 2026-12-21: 4 sessions, 126 focused min, avg score 71\n- 2026-12-22: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 45-minute pomodoros with 15-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"No deadlines in sight, so let's use the time to get ahead gently. You've been on a roll, so I gave you a bit more time each day.\", \"blocks\": [{\"day\": 2, \"time\": \"17:30\", \"minutes\": 90, \"label\": \"Catch up on any missed material\"}, {\"day\": 3, \"time\": \"15:45\", \"minutes\": 45, \"label\": \"Get ahead on upcoming readings\"}, {\"day\": 4, \"time\": \"15:30\", \"minutes\": 45, \"label\": \"Make flashcards from class notes\"}, {\"day\": 5, \"time\": \"15:00\", \"minutes\": 45, \"label\": \"Practice problems from class\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Friday Fri Aug 28 2026 09:28:14 GMT+0000 (Coordinated Universal Time).\n\nUpcoming deadlines:\n- (no upcoming deadlines found)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-08-22: 2 sessions, 51 focused min, avg score 81\n- 2026-08-23: 4 sessions, 117 focused min, avg score 56\n- 2026-08-24: 2 sessions, 64 focused min, avg score 70\n- 2026-08-25: 4 sessions, 131 focused min, avg score 84\n- 2026-08-26: 2 sessions, 46 focused min, avg score 79\n- 2026-08-27: 4 sessions, 91 focused min, avg score 63\n- 2026-08-28: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Nothing is due soon, so this is a calm week to build a rhythm. It matches the steady pace you've had lately.\", \"blocks\": [{\"day\": 5, \"time\": \"10:45\", \"minutes\": 100, \"label\": \"Catch up on any missed material\"}, {\"day\": 6, \"time\": \"09:15\", \"minutes\": 50, \"label\": \"Practice problems from class\"}, {\"day\": 0, \"time\": \"10:00\", \"minutes\": 100, \"label\": \"Get ahead on upcoming readings\"}, {\"day\": 1, \"time\": \"09:00\", \"minutes\": 100, \"label\": \"Tidy notes and fix gaps\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Friday Fri Feb 12 2027 17:43:07 GMT-0700 (Mountain Standard Time).\n\nUpcoming deadlines:\n- ECON 251 Quiz 4: Sat Feb 13 2027 09:00:00 GMT-0700 (Mountain Standard Time)\n- ENGL 106 Final Exam (EXAM): Sat Feb 13 2027 15:30:00 GMT-0700 (Mountain Standard Time)\n- SOC 100 Midterm (EXAM): Mon Feb 15 2027 10:00:00 GMT-0700 (Mountain Standard Time)\n- HIST 110 Discussion Post 3: Sat Feb 20 2027 09:00:00 GMT-0700 (Mountain Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-02-06: 4 sessions, 116 focused min, avg score 80\n- 2027-02-07: 6 sessions, 224 focused min, avg score 96\n- 2027-02-08: 6 sessions, 197 focused min, avg score 88\n- 2027-02-09: 4 sessions, 150 focused min, avg score 85\n- 2027-02-10: 6 sessions, 195 focused min, avg score 70\n- 2027-02-11: 4 sessions, 140 focused min, avg score 77\n- 2027-02-12: 1 sessions, 15 focused min, avg score 75\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"ENGL 106 Final Exam is tomorrow, so I put it at the front of the plan. There's a lot coming up, so I put the nearest ones first and kept each day doable. I'll be cheering for you the whole way!\", \"blocks\": [{\"day\": 5, \"time\": \"18:45\", \"minutes\": 25, \"label\": \"ENGL 106: skim slides and citations\"}, {\"day\": 5, \"time\": \"20:15\", \"minutes\": 75, \"label\": \"ENGL 106 final recap: key ideas and weak spots\"}, {\"day\": 0, \"time\": \"20:15\", \"minutes\": 75, \"label\": \"SOC 100 exam prep: survey methods + practice\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Thursday Thu Nov 05 2026 19:40:57 GMT-0800 (Pacific Standard Time).\n\nUpcoming deadlines:\n- ART 120 Final Exam (EXAM): Fri Nov 06 2026 14:00:00 GMT-0800 (Pacific Standard Time)\n- MA 261 Discussion Post 3: Sun Nov 08 2026 17:00:00 GMT-0800 (Pacific Standard Time)\n- CS 251 Paper Outline: Wed Nov 11 2026 17:00:00 GMT-0800 (Pacific Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-10-30: 2 sessions, 33 focused min, avg score 45\n- 2026-10-31: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-01: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-02: 1 sessions, 14 focused min, avg score 61\n- 2026-11-03: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-04: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-05: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"ART 120 Final Exam comes first, and the rest follow in order of what's due soonest. Last week was pretty quiet, so I kept the plan small and doable.\", \"blocks\": [{\"day\": 4, \"time\": \"20:30\", \"minutes\": 25, \"label\": \"ART 120 exam prep: artist profiles + practice\"}, {\"day\": 6, \"time\": \"19:45\", \"minutes\": 25, \"label\": \"MA 261 Discussion Post 3: read and take notes\"}, {\"day\": 1, \"time\": \"18:45\", \"minutes\": 25, \"label\": \"CS 251 Paper Outline: outline and draft\"}, {\"day\": 2, \"time\": \"18:00\", \"minutes\": 25, \"label\": \"CS 251 Paper Outline: revise and proofread\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Saturday Sat Feb 13 2027 17:10:19 GMT-0800 (Pacific Standard Time).\n\nUpcoming deadlines:\n- SOC 100 Essay 2: Wed Feb 17 2027 17:00:00 GMT-0800 (Pacific Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-02-07: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-08: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-09: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-10: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-11: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-12: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-13: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"SOC 100 Essay 2 is due on Wednesday, so I'm putting it first. Your focus time was light lately, so I'm not piling on too much.\", \"blocks\": [{\"day\": 6, \"time\": \"18:45\", \"minutes\": 50, \"label\": \"SOC 100 Essay 2: outline and draft\"}, {\"day\": 0, \"time\": \"18:00\", \"minutes\": 50, \"label\": \"SOC 100 Essay 2: outline and draft (part 2)\"}, {\"day\": 1, \"time\": \"19:15\", \"minutes\": 50, \"label\": \"SOC 100 Essay 2: revise and proofread\"}]}"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student has been on twitter.com for 2 minutes during a focus session. Write one short, kind nudge (max 60 characters)."}, {"role": "assistant", "content": "back to it? you're so close to done"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Monday Mon Jan 11 2027 10:56:06 GMT-0500 (Eastern Standard Time).\n\nUpcoming deadlines:\n- HIST 110 Final Exam (EXAM): Fri Jan 15 2027 10:00:00 GMT-0500 (Eastern Standard Time)\n- CS 180 Problem Set 8: Fri Jan 22 2027 09:00:00 GMT-0500 (Eastern Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-01-05: 0 sessions, 0 focused min, avg score n/a\n- 2027-01-06: 1 sessions, 26 focused min, avg score 61\n- 2027-01-07: 0 sessions, 0 focused min, avg score n/a\n- 2027-01-08: 0 sessions, 0 focused min, avg score n/a\n- 2027-01-09: 3 sessions, 104 focused min, avg score 50\n- 2027-01-10: 0 sessions, 0 focused min, avg score n/a\n- 2027-01-11: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your HIST 110 Final Exam is on Friday, so it gets the first and biggest blocks. Last week was a bit stop-and-go, so I kept the plan small and doable. Bloop believes in you!\", \"blocks\": [{\"day\": 1, \"time\": \"12:15\", \"minutes\": 25, \"label\": \"HIST 110 exam prep: review notes on the Industrial Revolution\"}, {\"day\": 2, \"time\": \"10:15\", \"minutes\": 25, \"label\": \"HIST 110: practice problems on primary sources\"}, {\"day\": 3, \"time\": \"09:45\", \"minutes\": 25, \"label\": \"HIST 110 drills: primary sources\"}, {\"day\": 4, \"time\": \"09:45\", \"minutes\": 25, \"label\": \"HIST 110: mock exam, then fix mistakes\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Saturday Sat Mar 13 2027 11:45:19 GMT-0700 (Mountain Standard Time).\n\nUpcoming deadlines:\n- CS 180 Online Quiz 2: Fri Mar 19 2027 23:59:00 GMT-0600 (Mountain Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-03-07: 5 sessions, 172 focused min, avg score 92\n- 2027-03-08: 5 sessions, 167 focused min, avg score 91\n- 2027-03-09: 4 sessions, 131 focused min, avg score 76\n- 2027-03-10: 7 sessions, 216 focused min, avg score 86\n- 2027-03-11: 6 sessions, 235 focused min, avg score 76\n- 2027-03-12: 5 sessions, 127 focused min, avg score 82\n- 2027-03-13: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"CS 180 Online Quiz 2 is due on Friday, so I'm putting it first. Great focus lately, so I added a little extra study time. You've got this!\", \"blocks\": [{\"day\": 6, \"time\": \"12:30\", \"minutes\": 75, \"label\": \"CS 180 Online Quiz 2: review key ideas\"}, {\"day\": 0, \"time\": \"10:30\", \"minutes\": 25, \"label\": \"Light CS 180 review: Python loops\"}, {\"day\": 1, \"time\": \"08:45\", \"minutes\": 25, \"label\": \"CS 180: flashcards and short review\"}, {\"day\": 2, \"time\": \"10:15\", \"minutes\": 25, \"label\": \"Quick recap of CS 180 notes\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Saturday Sat Nov 28 2026 20:04:02 GMT-0500 (Eastern Standard Time).\n\nUpcoming deadlines:\n- MA 261 Quiz 4: Thu Dec 03 2026 23:59:00 GMT-0500 (Eastern Standard Time)\n- ECON 251 Final Exam (EXAM): Fri Dec 04 2026 15:30:00 GMT-0500 (Eastern Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-11-22: 5 sessions, 164 focused min, avg score 74\n- 2026-11-23: 5 sessions, 172 focused min, avg score 78\n- 2026-11-24: 4 sessions, 139 focused min, avg score 76\n- 2026-11-25: 4 sessions, 109 focused min, avg score 76\n- 2026-11-26: 5 sessions, 150 focused min, avg score 87\n- 2026-11-27: 4 sessions, 111 focused min, avg score 73\n- 2026-11-28: 1 sessions, 26 focused min, avg score 95\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"ECON 251 Final Exam is on Friday, so I put it at the front of the plan. Great focus lately, so I added a little extra study time. Take your breaks too, I'll be right here.\", \"blocks\": [{\"day\": 6, \"time\": \"20:45\", \"minutes\": 50, \"label\": \"ECON 251: skim slides and elasticity\"}, {\"day\": 0, \"time\": \"18:30\", \"minutes\": 50, \"label\": \"ECON 251: practice problems on GDP and inflation\"}, {\"day\": 0, \"time\": \"20:15\", \"minutes\": 50, \"label\": \"MA 261 Quiz 4: review key ideas\"}, {\"day\": 1, \"time\": \"18:30\", \"minutes\": 100, \"label\": \"ECON 251: mock exam, then fix mistakes\"}, {\"day\": 1, \"time\": \"20:45\", \"minutes\": 50, \"label\": \"MA 261 Quiz 4: quick practice quiz\"}]}"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student's 5-minute break is over and the next 25-minute focus block is starting. Write one short, kind back-to-work nudge (max 60 characters)."}, {"role": "assistant", "content": "okay friend, deep breath and back in"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Tuesday Tue Dec 29 2026 13:35:29 GMT-0500 (Eastern Standard Time).\n\nUpcoming deadlines:\n- BIO 110 Midterm 1 (EXAM): Wed Dec 30 2026 13:00:00 GMT-0500 (Eastern Standard Time)\n- CS 180 Reading Response 4: Wed Jan 06 2027 23:59:00 GMT-0500 (Eastern Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-12-23: 4 sessions, 153 focused min, avg score 73\n- 2026-12-24: 5 sessions, 159 focused min, avg score 75\n- 2026-12-25: 7 sessions, 180 focused min, avg score 96\n- 2026-12-26: 5 sessions, 158 focused min, avg score 72\n- 2026-12-27: 5 sessions, 141 focused min, avg score 90\n- 2026-12-28: 6 sessions, 163 focused min, avg score 78\n- 2026-12-29: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 30-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"BIO 110 Midterm 1 is tomorrow, so I put it at the front of the plan. You've been on a roll, so I gave you a bit more time each day. One pomodoro at a time, and you'll get there.\", \"blocks\": [{\"day\": 2, \"time\": \"15:30\", \"minutes\": 60, \"label\": \"BIO 110: skim slides and cell respiration\"}, {\"day\": 2, \"time\": \"18:00\", \"minutes\": 90, \"label\": \"BIO 110: mock exam, then fix mistakes\"}, {\"day\": 2, \"time\": \"21:00\", \"minutes\": 60, \"label\": \"Head start on CS 180 Reading Response 4: skim the material\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Saturday Sat Mar 20 2027 11:14:58 GMT-0700 (Pacific Daylight Time).\n\nUpcoming deadlines:\n- MA 165 Online Quiz 2: Tue Mar 23 2027 23:59:00 GMT-0700 (Pacific Daylight Time)\n- BIO 110 Final Exam (EXAM): Thu Mar 25 2027 18:30:00 GMT-0700 (Pacific Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-03-14: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-15: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-16: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-17: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-18: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-19: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-20: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 45-minute pomodoros with 15-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your BIO 110 Final Exam is on Thursday, so it gets the first and biggest blocks. There's a lot coming up, so I put the nearest ones first and kept each day doable. Blocks are built from 45-minute pomodoros with 15-minute breaks.\", \"blocks\": [{\"day\": 6, \"time\": \"12:15\", \"minutes\": 45, \"label\": \"Start BIO 110 exam review: genetics\"}, {\"day\": 0, \"time\": \"09:15\", \"minutes\": 45, \"label\": \"BIO 110: practice problems on evolution\"}, {\"day\": 1, \"time\": \"10:45\", \"minutes\": 45, \"label\": \"BIO 110 drills: evolution\"}, {\"day\": 2, \"time\": \"09:00\", \"minutes\": 45, \"label\": \"BIO 110: redo tricky photosynthesis questions\"}, {\"day\": 3, \"time\": \"08:30\", \"minutes\": 45, \"label\": \"Last look at BIO 110: photosynthesis\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Thursday Thu Aug 27 2026 20:19:32 GMT-0700 (Pacific Daylight Time).\n\nUpcoming deadlines:\n- STAT 350 Midterm 1 (EXAM): Sat Aug 29 2026 19:00:00 GMT-0700 (Pacific Daylight Time)\n- ENGL 106 Lab Report 3: Sat Aug 29 2026 23:59:00 GMT-0700 (Pacific Daylight Time)\n- MA 261 Midterm 2 (EXAM): Tue Sep 01 2026 15:30:00 GMT-0700 (Pacific Daylight Time)\n- MA 165 Online Quiz 2: Sun Sep 06 2026 11:59:00 GMT-0700 (Pacific Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-08-21: 3 sessions, 92 focused min, avg score 46\n- 2026-08-22: 0 sessions, 0 focused min, avg score n/a\n- 2026-08-23: 0 sessions, 0 focused min, avg score n/a\n- 2026-08-24: 0 sessions, 0 focused min, avg score n/a\n- 2026-08-25: 0 sessions, 0 focused min, avg score n/a\n- 2026-08-26: 1 sessions, 32 focused min, avg score 42\n- 2026-08-27: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your STAT 350 Midterm 1 is on Saturday, so it gets the first and biggest blocks. I focused on the closest deadlines first and kept the load realistic.\", \"blocks\": [{\"day\": 4, \"time\": \"21:30\", \"minutes\": 25, \"label\": \"STAT 350: skim slides and hypothesis tests\"}, {\"day\": 5, \"time\": \"19:15\", \"minutes\": 25, \"label\": \"Last look at STAT 350: probability rules\"}, {\"day\": 0, \"time\": \"19:45\", \"minutes\": 25, \"label\": \"Start MA 261 exam review: gradients\"}, {\"day\": 1, \"time\": \"18:15\", \"minutes\": 25, \"label\": \"MA 261: mock exam, then fix mistakes\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Saturday Sat Mar 13 2027 09:43:34 GMT-0700 (Mountain Standard Time).\n\nUpcoming deadlines:\n- (no upcoming deadlines found)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-03-07: 1 sessions, 30 focused min, avg score 42\n- 2027-03-08: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-09: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-10: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-11: 1 sessions, 22 focused min, avg score 40\n- 2027-03-12: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-13: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 30-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Nothing is due soon, so this is a calm week to build a rhythm. Your focus time was light lately, so I'm not piling on too much. Take your breaks too, I'll be right here.\", \"blocks\": [{\"day\": 6, \"time\": \"10:45\", \"minutes\": 90, \"label\": \"Catch up on any missed material\"}, {\"day\": 0, \"time\": \"09:15\", \"minutes\": 90, \"label\": \"Review this week's lecture notes\"}, {\"day\": 1, \"time\": \"09:45\", \"minutes\": 30, \"label\": \"Plan next week's study goals\"}, {\"day\": 2, \"time\": \"09:00\", \"minutes\": 90, \"label\": \"Tidy notes and fix gaps\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Sunday Sun Sep 27 2026 17:45:13 GMT-0500 (Central Daylight Time).\n\nUpcoming deadlines:\n- (no upcoming deadlines found)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-09-21: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-22: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-23: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-24: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-25: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-26: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-27: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 45-minute pomodoros with 15-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Nothing is due soon, so this is a calm week to build a rhythm. I don't see any focus history yet, so I kept the sessions short and easy.\", \"blocks\": [{\"day\": 0, \"time\": \"18:45\", \"minutes\": 90, \"label\": \"Tidy notes and fix gaps\"}, {\"day\": 1, \"time\": \"19:00\", \"minutes\": 90, \"label\": \"Plan next week's study goals\"}, {\"day\": 2, \"time\": \"19:00\", \"minutes\": 45, \"label\": \"Catch up on any missed material\"}]}"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student just finished a focus session of 30 minutes (1 pomodoros). Write one short, kind session-complete nudge (max 60 characters)."}, {"role": "assistant", "content": "progress made today. that's what matters"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Thursday Thu Feb 25 2027 14:44:59 GMT-0500 (Eastern Standard Time).\n\nUpcoming deadlines:\n- (no upcoming deadlines found)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-02-19: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-20: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-21: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-22: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-23: 1 sessions, 15 focused min, avg score 62\n- 2027-02-24: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-25: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 45-minute pomodoros with 15-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"It's a quiet week on the calendar, so I kept things light and steady. Last week was pretty quiet, so I kept the plan small and doable. Bloop believes in you!\", \"blocks\": [{\"day\": 4, \"time\": \"15:30\", \"minutes\": 90, \"label\": \"Make flashcards from class notes\"}, {\"day\": 5, \"time\": \"16:00\", \"minutes\": 45, \"label\": \"Light revision: summarize key ideas\"}, {\"day\": 6, \"time\": \"14:00\", \"minutes\": 45, \"label\": \"Plan next week's study goals\"}, {\"day\": 0, \"time\": \"15:30\", \"minutes\": 45, \"label\": \"Tidy notes and fix gaps\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Saturday Sat Mar 20 2027 17:44:00 GMT-0700 (Pacific Daylight Time).\n\nUpcoming deadlines:\n- CS 251 Midterm 2 (EXAM): Mon Mar 22 2027 09:00:00 GMT-0700 (Pacific Daylight Time)\n- ENGL 106 Exam 3 (EXAM): Thu Mar 25 2027 15:30:00 GMT-0700 (Pacific Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-03-14: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-15: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-16: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-17: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-18: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-19: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-20: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your CS 251 Midterm 2 is on Monday, so it gets the first and biggest blocks. I don't see any focus history yet, so I kept the sessions short and easy. You've got this!\", \"blocks\": [{\"day\": 6, \"time\": \"19:15\", \"minutes\": 25, \"label\": \"Start CS 251 exam review: linked lists\"}, {\"day\": 0, \"time\": \"18:30\", \"minutes\": 25, \"label\": \"CS 251: mock exam, then fix mistakes\"}, {\"day\": 2, \"time\": \"18:00\", \"minutes\": 25, \"label\": \"ENGL 106: skim slides and close reading\"}, {\"day\": 3, \"time\": \"19:00\", \"minutes\": 25, \"label\": \"ENGL 106 final recap: key ideas and weak spots\"}]}"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student has been on espn.com for 3 minutes during a focus session. Write one short, kind nudge (max 60 characters)."}, {"role": "assistant", "content": "one deep breath, then back to studying 🌱"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student has been on netflix.com for 10 minutes during a focus session. Write one short, kind nudge (max 60 characters)."}, {"role": "assistant", "content": "just a tiny detour, right? let's head back"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Sunday Sun Nov 15 2026 15:11:47 GMT-0500 (Eastern Standard Time).\n\nUpcoming deadlines:\n- ENGL 106 Quiz 3: Mon Nov 23 2026 23:59:00 GMT-0500 (Eastern Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-11-09: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-10: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-11: 3 sessions, 74 focused min, avg score 74\n- 2026-11-12: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-13: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-14: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-15: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 45-minute pomodoros with 15-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"ENGL 106 Quiz 3 is due in 8 days, so that's our first stop. Your focus time was light lately, so I'm not piling on too much. Bloop believes in you!\", \"blocks\": [{\"day\": 0, \"time\": \"17:00\", \"minutes\": 45, \"label\": \"Head start on ENGL 106 Quiz 3: skim the material\"}, {\"day\": 1, \"time\": \"16:15\", \"minutes\": 45, \"label\": \"Head start on ENGL 106 Quiz 3: review close reading\"}, {\"day\": 2, \"time\": \"13:30\", \"minutes\": 45, \"label\": \"Quick recap of ENGL 106 notes\"}]}"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student's 15-minute break is over and the next 50-minute focus block is starting. Write one short, kind back-to-work nudge (max 60 characters)."}, {"role": "assistant", "content": "you rested well, now let's get it done"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Saturday Sat Jan 30 2027 12:39:24 GMT+0000 (Coordinated Universal Time).\n\nUpcoming deadlines:\n- PHYS 172 Essay 2: Sat Feb 06 2027 23:59:00 GMT+0000 (Coordinated Universal Time)\n- BIO 110 Final Exam (EXAM): Tue Feb 09 2027 14:00:00 GMT+0000 (Coordinated Universal Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-01-24: 3 sessions, 83 focused min, avg score 85\n- 2027-01-25: 3 sessions, 73 focused min, avg score 63\n- 2027-01-26: 2 sessions, 63 focused min, avg score 57\n- 2027-01-27: 0 sessions, 0 focused min, avg score n/a\n- 2027-01-28: 2 sessions, 62 focused min, avg score 79\n- 2027-01-29: 2 sessions, 53 focused min, avg score 79\n- 2027-01-30: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your BIO 110 Final Exam is in 10 days, so it gets the first and biggest blocks. It matches the steady pace you've had lately.\", \"blocks\": [{\"day\": 6, \"time\": \"14:00\", \"minutes\": 50, \"label\": \"Head start on BIO 110 Final Exam: skim the material\"}, {\"day\": 6, \"time\": \"16:30\", \"minutes\": 25, \"label\": \"Head start on PHYS 172 Essay 2: skim the material\"}, {\"day\": 0, \"time\": \"13:15\", \"minutes\": 25, \"label\": \"Head start on BIO 110 Final Exam: review genetics\"}, {\"day\": 0, \"time\": \"14:15\", \"minutes\": 25, \"label\": \"Head start on PHYS 172 Essay 2: review waves\"}]}"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student has been using Minecraft for 3 minutes during a focus session. Write one short, kind nudge (max 60 characters)."}, {"role": "assistant", "content": "your notes miss you, come say hi"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Friday Fri Sep 25 2026 10:00:45 GMT-0500 (Central Daylight Time).\n\nUpcoming deadlines:\n- CHEM 201 Final Exam (EXAM): Sat Sep 26 2026 14:00:00 GMT-0500 (Central Daylight Time)\n- ENGL 106 Homework 7: Mon Sep 28 2026 14:00:00 GMT-0500 (Central Daylight Time)\n- CS 180 Group Presentation: Fri Oct 02 2026 09:00:00 GMT-0500 (Central Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-09-19: 4 sessions, 136 focused min, avg score 62\n- 2026-09-20: 2 sessions, 45 focused min, avg score 79\n- 2026-09-21: 3 sessions, 79 focused min, avg score 72\n- 2026-09-22: 3 sessions, 67 focused min, avg score 70\n- 2026-09-23: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-24: 2 sessions, 66 focused min, avg score 67\n- 2026-09-25: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 30-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"CHEM 201 Final Exam comes first, and the rest follow in order of what's due soonest. I sized the blocks to fit how you've been studying. You've got this!\", \"blocks\": [{\"day\": 5, \"time\": \"11:15\", \"minutes\": 90, \"label\": \"CHEM 201 exam prep: equilibrium + practice\"}, {\"day\": 6, \"time\": \"08:30\", \"minutes\": 90, \"label\": \"ENGL 106 Homework 7: work through the problems\"}, {\"day\": 0, \"time\": \"09:00\", \"minutes\": 30, \"label\": \"ENGL 106 Homework 7: check answers and redo mistakes\"}, {\"day\": 0, \"time\": \"11:00\", \"minutes\": 30, \"label\": \"Head start on CS 180 Group Presentation: skim the material\"}, {\"day\": 1, \"time\": \"10:15\", \"minutes\": 30, \"label\": \"Head start on CS 180 Group Presentation: review debugging\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Monday Mon Sep 07 2026 17:30:32 GMT-0700 (Pacific Daylight Time).\n\nUpcoming deadlines:\n- CHEM 201 Group Project Part 1: Tue Sep 15 2026 23:59:00 GMT-0700 (Pacific Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-09-01: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-02: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-03: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-04: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-05: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-06: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-07: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 30-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"First up is CHEM 201 Group Project Part 1, due in 8 days. I don't see any focus history yet, so I kept the sessions short and easy. You've got this!\", \"blocks\": [{\"day\": 1, \"time\": \"18:15\", \"minutes\": 30, \"label\": \"Head start on CHEM 201 Group Project Part 1: skim the material\"}, {\"day\": 2, \"time\": \"18:30\", \"minutes\": 30, \"label\": \"Head start on CHEM 201 Group Project Part 1: review thermodynamics\"}, {\"day\": 3, \"time\": \"17:30\", \"minutes\": 30, \"label\": \"Light CHEM 201 review: thermodynamics\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Wednesday Wed Mar 10 2027 10:33:14 GMT-0700 (Mountain Standard Time).\n\nUpcoming deadlines:\n- CHEM 201 Project Milestone 2: Sun Mar 14 2027 17:00:00 GMT-0600 (Mountain Daylight Time)\n- ENGL 106 Quiz 4: Fri Mar 19 2027 23:59:00 GMT-0600 (Mountain Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-03-04: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-05: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-06: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-07: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-08: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-09: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-10: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 30-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"CHEM 201 Project Milestone 2 is due on Sunday, so I'm putting it first. I don't see any focus history yet, so I kept the sessions short and easy. You've got this!\", \"blocks\": [{\"day\": 3, \"time\": \"11:45\", \"minutes\": 30, \"label\": \"CHEM 201 Project Milestone 2: build the next milestone\"}, {\"day\": 4, \"time\": \"09:45\", \"minutes\": 30, \"label\": \"CHEM 201 Project Milestone 2: build the next milestone (part 2)\"}, {\"day\": 5, \"time\": \"10:00\", \"minutes\": 30, \"label\": \"CHEM 201 Project Milestone 2: build the next milestone (part 3)\"}, {\"day\": 6, \"time\": \"10:45\", \"minutes\": 30, \"label\": \"CHEM 201 Project Milestone 2: test and clean up\"}, {\"day\": 0, \"time\": \"10:00\", \"minutes\": 30, \"label\": \"Head start on ENGL 106 Quiz 4: skim the material\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Saturday Sat Feb 20 2027 18:52:36 GMT+0000 (Coordinated Universal Time).\n\nUpcoming deadlines:\n- PSY 120 Homework 7: Wed Feb 24 2027 17:00:00 GMT+0000 (Coordinated Universal Time)\n- ENGL 106 Paper Outline: Tue Mar 02 2027 17:00:00 GMT+0000 (Coordinated Universal Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-02-14: 3 sessions, 72 focused min, avg score 68\n- 2027-02-15: 4 sessions, 132 focused min, avg score 82\n- 2027-02-16: 3 sessions, 78 focused min, avg score 55\n- 2027-02-17: 2 sessions, 58 focused min, avg score 84\n- 2027-02-18: 3 sessions, 68 focused min, avg score 81\n- 2027-02-19: 4 sessions, 97 focused min, avg score 56\n- 2027-02-20: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 45-minute pomodoros with 15-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"PSY 120 Homework 7 is due on Wednesday, so I'm putting it first. I sized the blocks to fit how you've been studying.\", \"blocks\": [{\"day\": 6, \"time\": \"19:30\", \"minutes\": 45, \"label\": \"PSY 120 Homework 7: work through the problems\"}, {\"day\": 6, \"time\": \"21:15\", \"minutes\": 45, \"label\": \"Head start on ENGL 106 Paper Outline: skim the material\"}, {\"day\": 0, \"time\": \"18:45\", \"minutes\": 45, \"label\": \"PSY 120 Homework 7: check answers and redo mistakes\"}, {\"day\": 0, \"time\": \"21:00\", \"minutes\": 45, \"label\": \"Head start on ENGL 106 Paper Outline: review close reading\"}]}"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student has been on 9gag.com for 5 minutes during a focus session. Write one short, kind nudge (max 60 characters)."}, {"role": "assistant", "content": "scrolling can wait, you're doing so well"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student just finished a focus session of 60 minutes (2 pomodoros). Write one short, kind session-complete nudge (max 60 characters)."}, {"role": "assistant", "content": "wow, what a session. be proud of that"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Monday Mon Jan 11 2027 19:46:28 GMT-0500 (Eastern Standard Time).\n\nUpcoming deadlines:\n- ART 120 Exam 3 (EXAM): Sat Jan 16 2027 18:30:00 GMT-0500 (Eastern Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-01-05: 2 sessions, 32 focused min, avg score 58\n- 2027-01-06: 2 sessions, 36 focused min, avg score 64\n- 2027-01-07: 0 sessions, 0 focused min, avg score n/a\n- 2027-01-08: 0 sessions, 0 focused min, avg score n/a\n- 2027-01-09: 2 sessions, 43 focused min, avg score 40\n- 2027-01-10: 0 sessions, 0 focused min, avg score n/a\n- 2027-01-11: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your ART 120 Exam 3 is on Saturday, so let's start there. Your focus time was light lately, so I'm not piling on too much. You've got this!\", \"blocks\": [{\"day\": 1, \"time\": \"20:30\", \"minutes\": 50, \"label\": \"ART 120 exam prep: review notes on visual analysis\"}, {\"day\": 2, \"time\": \"20:15\", \"minutes\": 50, \"label\": \"ART 120: practice problems on terminology\"}, {\"day\": 3, \"time\": \"18:15\", \"minutes\": 50, \"label\": \"ART 120 drills: terminology\"}, {\"day\": 4, \"time\": \"19:00\", \"minutes\": 50, \"label\": \"ART 120: mock exam, then fix mistakes\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Wednesday Wed Sep 16 2026 15:00:59 GMT-0400 (Eastern Daylight Time).\n\nUpcoming deadlines:\n- CHEM 201 Quiz 4: Sat Sep 19 2026 23:59:00 GMT-0400 (Eastern Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-09-10: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-11: 2 sessions, 21 focused min, avg score 65\n- 2026-09-12: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-13: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-14: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-15: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-16: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"CHEM 201 Quiz 4 is due on Saturday, so I'm putting it first. Last week was pretty quiet, so I kept the plan small and doable. You've got this!\", \"blocks\": [{\"day\": 3, \"time\": \"16:30\", \"minutes\": 25, \"label\": \"CHEM 201 Quiz 4: review key ideas\"}, {\"day\": 4, \"time\": \"13:00\", \"minutes\": 25, \"label\": \"CHEM 201 Quiz 4: review key ideas (part 2)\"}, {\"day\": 5, \"time\": \"14:00\", \"minutes\": 25, \"label\": \"CHEM 201 Quiz 4: quick practice quiz\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Sunday Sun Apr 04 2027 07:59:26 GMT-0400 (Eastern Daylight Time).\n\nUpcoming deadlines:\n- PHYS 172 Group Presentation: Tue Apr 13 2027 17:00:00 GMT-0400 (Eastern Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-03-29: 5 sessions, 141 focused min, avg score 92\n- 2027-03-30: 4 sessions, 134 focused min, avg score 87\n- 2027-03-31: 7 sessions, 209 focused min, avg score 72\n- 2027-04-01: 7 sessions, 201 focused min, avg score 70\n- 2027-04-02: 7 sessions, 232 focused min, avg score 86\n- 2027-04-03: 6 sessions, 232 focused min, avg score 76\n- 2027-04-04: 1 sessions, 19 focused min, avg score 78\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"PHYS 172 Group Presentation is due in 9 days, so that's our first stop. Great focus lately, so I added a little extra study time. You've got this!\", \"blocks\": [{\"day\": 0, \"time\": \"09:00\", \"minutes\": 50, \"label\": \"Head start on PHYS 172 Group Presentation: skim the material\"}, {\"day\": 1, \"time\": \"09:00\", \"minutes\": 25, \"label\": \"Light PHYS 172 review: circuits\"}, {\"day\": 2, \"time\": \"08:30\", \"minutes\": 25, \"label\": \"Quick recap of PHYS 172 notes\"}, {\"day\": 3, \"time\": \"09:00\", \"minutes\": 25, \"label\": \"PHYS 172: flashcards and short review\"}, {\"day\": 4, \"time\": \"10:45\", \"minutes\": 25, \"label\": \"Light PHYS 172 review: circuits (part 5)\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Wednesday Wed Feb 03 2027 17:13:31 GMT-0500 (Eastern Standard Time).\n\nUpcoming deadlines:\n- ART 120 Exam 1 (EXAM): Sun Feb 07 2027 10:00:00 GMT-0500 (Eastern Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-01-28: 1 sessions, 29 focused min, avg score 48\n- 2027-01-29: 2 sessions, 57 focused min, avg score 62\n- 2027-01-30: 1 sessions, 28 focused min, avg score 67\n- 2027-01-31: 2 sessions, 36 focused min, avg score 72\n- 2027-02-01: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-02: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-03: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"ART 120 Exam 1 is on Sunday, so I put it at the front of the plan. Your focus time was light lately, so I'm not piling on too much. One pomodoro at a time, and you'll get there.\", \"blocks\": [{\"day\": 3, \"time\": \"18:15\", \"minutes\": 25, \"label\": \"ART 120: skim slides and artist profiles\"}, {\"day\": 4, \"time\": \"18:15\", \"minutes\": 25, \"label\": \"ART 120: practice problems on visual analysis\"}, {\"day\": 5, \"time\": \"18:45\", \"minutes\": 25, \"label\": \"ART 120 drills: visual analysis\"}, {\"day\": 6, \"time\": \"18:00\", \"minutes\": 25, \"label\": \"ART 120 final recap: key ideas and weak spots\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Wednesday Wed Nov 25 2026 14:03:57 GMT-0700 (Mountain Standard Time).\n\nUpcoming deadlines:\n- SOC 100 Exam 1 (EXAM): Sat Nov 28 2026 18:30:00 GMT-0700 (Mountain Standard Time)\n- ECON 251 Exam 3 (EXAM): Wed Dec 02 2026 19:00:00 GMT-0700 (Mountain Standard Time)\n- STAT 350 Group Project Part 1: Sat Dec 05 2026 23:59:00 GMT-0700 (Mountain Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-11-19: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-20: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-21: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-22: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-23: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-24: 2 sessions, 39 focused min, avg score 58\n- 2026-11-25: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 45-minute pomodoros with 15-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your SOC 100 Exam 1 is on Saturday, so let's start there. Your focus time was light lately, so I'm not piling on too much. You've got this!\", \"blocks\": [{\"day\": 3, \"time\": \"16:15\", \"minutes\": 45, \"label\": \"Start SOC 100 exam review: key concepts\"}, {\"day\": 4, \"time\": \"15:45\", \"minutes\": 45, \"label\": \"SOC 100: practice problems on social theory\"}, {\"day\": 5, \"time\": \"13:45\", \"minutes\": 45, \"label\": \"Last look at SOC 100: case studies\"}, {\"day\": 6, \"time\": \"13:45\", \"minutes\": 45, \"label\": \"Head start on ECON 251 Exam 3: skim the material\"}]}"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student has been on twitter.com for 1 minute during a focus session. Write one short, kind nudge (max 60 characters)."}, {"role": "assistant", "content": "the timeline can wait, back to your notes"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Saturday Sat Sep 19 2026 08:09:02 GMT-0500 (Central Daylight Time).\n\nUpcoming deadlines:\n- MA 165 Problem Set 5: Wed Sep 23 2026 09:00:00 GMT-0500 (Central Daylight Time)\n- STAT 350 Midterm 2 (EXAM): Wed Sep 23 2026 13:00:00 GMT-0500 (Central Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-09-13: 2 sessions, 33 focused min, avg score 46\n- 2026-09-14: 2 sessions, 33 focused min, avg score 51\n- 2026-09-15: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-16: 1 sessions, 15 focused min, avg score 43\n- 2026-09-17: 2 sessions, 25 focused min, avg score 46\n- 2026-09-18: 2 sessions, 32 focused min, avg score 37\n- 2026-09-19: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your STAT 350 Midterm 2 is on Wednesday, so it gets the first and biggest blocks. There's a lot coming up, so I put the nearest ones first and kept each day doable. Blocks are built from 25-minute pomodoros with 5-minute breaks.\", \"blocks\": [{\"day\": 6, \"time\": \"09:30\", \"minutes\": 25, \"label\": \"STAT 350: skim slides and probability rules\"}, {\"day\": 0, \"time\": \"08:30\", \"minutes\": 25, \"label\": \"STAT 350: practice problems on regression\"}, {\"day\": 1, \"time\": \"09:00\", \"minutes\": 25, \"label\": \"STAT 350 drills: regression\"}, {\"day\": 2, \"time\": \"09:30\", \"minutes\": 25, \"label\": \"STAT 350 final recap: key ideas and weak spots\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Tuesday Tue Feb 02 2027 09:33:04 GMT-0700 (Mountain Standard Time).\n\nUpcoming deadlines:\n- CS 180 Exam 2 (EXAM): Wed Feb 03 2027 09:00:00 GMT-0700 (Mountain Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-01-27: 4 sessions, 124 focused min, avg score 79\n- 2027-01-28: 7 sessions, 278 focused min, avg score 74\n- 2027-01-29: 4 sessions, 153 focused min, avg score 85\n- 2027-01-30: 6 sessions, 201 focused min, avg score 81\n- 2027-01-31: 6 sessions, 216 focused min, avg score 76\n- 2027-02-01: 7 sessions, 209 focused min, avg score 87\n- 2027-02-02: 1 sessions, 19 focused min, avg score 71\n\nThe student uses 30-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your CS 180 Exam 2 is tomorrow, so let's start there. Great focus lately, so I added a little extra study time. Blocks are built from 30-minute pomodoros with 5-minute breaks.\", \"blocks\": [{\"day\": 2, \"time\": \"10:15\", \"minutes\": 30, \"label\": \"CS 180 exam prep: review notes on debugging\"}, {\"day\": 2, \"time\": \"12:15\", \"minutes\": 30, \"label\": \"Light CS 180 review: debugging\"}, {\"day\": 2, \"time\": \"14:15\", \"minutes\": 90, \"label\": \"CS 180 drills: file I/O\"}, {\"day\": 2, \"time\": \"17:15\", \"minutes\": 90, \"label\": \"CS 180 final recap: key ideas and weak spots\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Friday Fri Nov 20 2026 20:14:22 GMT-0600 (Central Standard Time).\n\nUpcoming deadlines:\n- ART 120 Final Exam (EXAM): Sat Nov 21 2026 19:00:00 GMT-0600 (Central Standard Time)\n- ENGL 106 Homework 7: Tue Nov 24 2026 23:59:00 GMT-0600 (Central Standard Time)\n- BIO 110 Quiz 4: Fri Nov 27 2026 09:00:00 GMT-0600 (Central Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-11-14: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-15: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-16: 1 sessions, 23 focused min, avg score 57\n- 2026-11-17: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-18: 1 sessions, 13 focused min, avg score 62\n- 2026-11-19: 1 sessions, 15 focused min, avg score 53\n- 2026-11-20: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"You've got 3 things coming up, so I lined them up by what's closest, starting with ART 120 Final Exam. Last week was pretty quiet, so I kept the plan small and doable. Take your breaks too, I'll be right here.\", \"blocks\": [{\"day\": 5, \"time\": \"21:30\", \"minutes\": 25, \"label\": \"ART 120 exam prep: visual analysis + practice\"}, {\"day\": 0, \"time\": \"18:45\", \"minutes\": 25, \"label\": \"ENGL 106 Homework 7: work through the problems\"}, {\"day\": 1, \"time\": \"17:30\", \"minutes\": 25, \"label\": \"ENGL 106 Homework 7: check answers and redo mistakes\"}, {\"day\": 2, \"time\": \"17:45\", \"minutes\": 25, \"label\": \"Head start on BIO 110 Quiz 4: skim the material\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Monday Mon Sep 28 2026 18:08:34 GMT-0500 (Central Daylight Time).\n\nUpcoming deadlines:\n- STAT 350 Final Exam (EXAM): Thu Oct 01 2026 19:00:00 GMT-0500 (Central Daylight Time)\n- ART 120 Discussion Post 3: Wed Oct 07 2026 09:00:00 GMT-0500 (Central Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-09-22: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-23: 4 sessions, 89 focused min, avg score 79\n- 2026-09-24: 4 sessions, 134 focused min, avg score 67\n- 2026-09-25: 3 sessions, 88 focused min, avg score 72\n- 2026-09-26: 3 sessions, 87 focused min, avg score 78\n- 2026-09-27: 3 sessions, 68 focused min, avg score 77\n- 2026-09-28: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 45-minute pomodoros with 15-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your STAT 350 Final Exam is on Thursday, so it gets the first and biggest blocks. It matches the steady pace you've had lately. Bloop believes in you!\", \"blocks\": [{\"day\": 1, \"time\": \"19:30\", \"minutes\": 90, \"label\": \"Start STAT 350 exam review: hypothesis tests\"}, {\"day\": 2, \"time\": \"18:30\", \"minutes\": 45, \"label\": \"STAT 350: practice problems on probability rules\"}, {\"day\": 2, \"time\": \"19:45\", \"minutes\": 45, \"label\": \"Head start on ART 120 Discussion Post 3: skim the material\"}, {\"day\": 3, \"time\": \"19:30\", \"minutes\": 45, \"label\": \"STAT 350 final recap: key ideas and weak spots\"}, {\"day\": 3, \"time\": \"21:15\", \"minutes\": 45, \"label\": \"Head start on ART 120 Discussion Post 3: review terminology\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Thursday Thu Dec 03 2026 10:57:44 GMT-0600 (Central Standard Time).\n\nUpcoming deadlines:\n- ENGL 106 Midterm (EXAM): Wed Dec 09 2026 11:00:00 GMT-0600 (Central Standard Time)\n- SOC 100 Essay 2: Thu Dec 10 2026 17:00:00 GMT-0600 (Central Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-11-27: 1 sessions, 12 focused min, avg score 62\n- 2026-11-28: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-29: 1 sessions, 9 focused min, avg score 48\n- 2026-11-30: 2 sessions, 50 focused min, avg score 61\n- 2026-12-01: 1 sessions, 13 focused min, avg score 46\n- 2026-12-02: 2 sessions, 36 focused min, avg score 44\n- 2026-12-03: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your ENGL 106 Midterm is on Wednesday, so it gets the first and biggest blocks. Last week was pretty quiet, so I kept the plan small and doable. Take your breaks too, I'll be right here.\", \"blocks\": [{\"day\": 4, \"time\": \"12:00\", \"minutes\": 50, \"label\": \"ENGL 106: skim slides and argument structure\"}, {\"day\": 5, \"time\": \"09:15\", \"minutes\": 50, \"label\": \"ENGL 106: practice problems on thesis statements\"}, {\"day\": 6, \"time\": \"08:45\", \"minutes\": 50, \"label\": \"ENGL 106 drills: thesis statements\"}, {\"day\": 0, \"time\": \"09:45\", \"minutes\": 50, \"label\": \"Head start on SOC 100 Essay 2: skim the material\"}, {\"day\": 1, \"time\": \"08:30\", \"minutes\": 50, \"label\": \"Head start on SOC 100 Essay 2: review social theory\"}, {\"day\": 2, \"time\": \"10:15\", \"minutes\": 50, \"label\": \"Last look at ENGL 106: close reading\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Tuesday Tue Apr 13 2027 12:47:08 GMT+0000 (Coordinated Universal Time).\n\nUpcoming deadlines:\n- (no upcoming deadlines found)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-04-07: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-08: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-09: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-10: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-11: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-12: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-13: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Nothing is due soon, so this is a calm week to build a rhythm. I don't see any focus history yet, so I kept the sessions short and easy. I'll be cheering for you the whole way!\", \"blocks\": [{\"day\": 2, \"time\": \"13:30\", \"minutes\": 50, \"label\": \"Make flashcards from class notes\"}, {\"day\": 3, \"time\": \"16:00\", \"minutes\": 50, \"label\": \"Catch up on any missed material\"}, {\"day\": 4, \"time\": \"15:15\", \"minutes\": 75, \"label\": \"Light revision: summarize key ideas\"}]}"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student just finished a focus session of 180 minutes (4 pomodoros). Write one short, kind session-complete nudge (max 60 characters)."}, {"role": "assistant", "content": "focus session finished. you're awesome ✨"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Friday Fri Dec 11 2026 07:38:58 GMT-0700 (Mountain Standard Time).\n\nUpcoming deadlines:\n- SOC 100 Group Presentation: Sun Dec 13 2026 23:59:00 GMT-0700 (Mountain Standard Time)\n- HIST 110 Lab Report 3: Mon Dec 14 2026 23:59:00 GMT-0700 (Mountain Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-12-05: 6 sessions, 218 focused min, avg score 75\n- 2026-12-06: 7 sessions, 200 focused min, avg score 82\n- 2026-12-07: 7 sessions, 178 focused min, avg score 78\n- 2026-12-08: 4 sessions, 127 focused min, avg score 70\n- 2026-12-09: 6 sessions, 231 focused min, avg score 93\n- 2026-12-10: 6 sessions, 213 focused min, avg score 75\n- 2026-12-11: 1 sessions, 14 focused min, avg score 90\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"SOC 100 Group Presentation is due on Sunday, so I'm putting it first. You've been on a roll, so I gave you a bit more time each day.\", \"blocks\": [{\"day\": 5, \"time\": \"08:15\", \"minutes\": 100, \"label\": \"SOC 100 Group Presentation: build the slides\"}, {\"day\": 5, \"time\": \"10:45\", \"minutes\": 50, \"label\": \"HIST 110 Lab Report 3: organize data and figures\"}, {\"day\": 6, \"time\": \"09:45\", \"minutes\": 50, \"label\": \"HIST 110 Lab Report 3: organize data and figures (part 2)\"}, {\"day\": 0, \"time\": \"08:45\", \"minutes\": 50, \"label\": \"HIST 110 Lab Report 3: write conclusion and proofread\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Friday Fri Sep 11 2026 16:20:38 GMT-0500 (Central Daylight Time).\n\nUpcoming deadlines:\n- ART 120 Quiz 4: Wed Sep 16 2026 23:59:00 GMT-0500 (Central Daylight Time)\n- CS 251 Essay 2: Fri Sep 18 2026 23:59:00 GMT-0500 (Central Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-09-05: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-06: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-07: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-08: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-09: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-10: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-11: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 45-minute pomodoros with 15-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"ART 120 Quiz 4 is due on Wednesday, so I'm putting it first. This is a fresh start, so the blocks stay gentle.\", \"blocks\": [{\"day\": 5, \"time\": \"18:00\", \"minutes\": 45, \"label\": \"ART 120 Quiz 4: review key ideas\"}, {\"day\": 6, \"time\": \"14:45\", \"minutes\": 45, \"label\": \"ART 120 Quiz 4: quick practice quiz\"}, {\"day\": 0, \"time\": \"16:30\", \"minutes\": 45, \"label\": \"Head start on CS 251 Essay 2: skim the material\"}, {\"day\": 1, \"time\": \"13:15\", \"minutes\": 45, \"label\": \"Head start on CS 251 Essay 2: review linked lists\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Wednesday Wed Feb 03 2027 11:16:59 GMT-0500 (Eastern Standard Time).\n\nUpcoming deadlines:\n- MA 165 Problem Set 5: Wed Feb 10 2027 11:59:00 GMT-0500 (Eastern Standard Time)\n- BIO 110 Group Project Part 1: Sun Feb 14 2027 23:59:00 GMT-0500 (Eastern Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-01-28: 6 sessions, 203 focused min, avg score 95\n- 2027-01-29: 0 sessions, 0 focused min, avg score n/a\n- 2027-01-30: 7 sessions, 203 focused min, avg score 76\n- 2027-01-31: 6 sessions, 204 focused min, avg score 78\n- 2027-02-01: 7 sessions, 197 focused min, avg score 73\n- 2027-02-02: 4 sessions, 136 focused min, avg score 94\n- 2027-02-03: 1 sessions, 21 focused min, avg score 94\n\nThe student uses 30-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"MA 165 Problem Set 5 is due in 7 days, so that's our first stop. Great focus lately, so I added a little extra study time. Take your breaks too, I'll be right here.\", \"blocks\": [{\"day\": 3, \"time\": \"12:30\", \"minutes\": 30, \"label\": \"Head start on MA 165 Problem Set 5: skim the material\"}, {\"day\": 3, \"time\": \"13:45\", \"minutes\": 60, \"label\": \"Head start on BIO 110 Group Project Part 1: skim the material\"}, {\"day\": 4, \"time\": \"09:45\", \"minutes\": 30, \"label\": \"Head start on MA 165 Problem Set 5: review related rates\"}]}"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student just finished a focus session of 150 minutes (3 pomodoros). Write one short, kind session-complete nudge (max 60 characters)."}, {"role": "assistant", "content": "well done! every session adds up"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Tuesday Tue Oct 13 2026 20:20:04 GMT-0500 (Central Daylight Time).\n\nUpcoming deadlines:\n- CS 180 Project Milestone 2: Fri Oct 23 2026 14:00:00 GMT-0500 (Central Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-10-07: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-08: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-09: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-10: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-11: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-12: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-13: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 30-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"CS 180 Project Milestone 2 is due in 10 days, so that's our first stop. Last week was a bit stop-and-go, so I kept the plan small and doable. One pomodoro at a time, and you'll get there.\", \"blocks\": [{\"day\": 2, \"time\": \"21:30\", \"minutes\": 30, \"label\": \"Head start on CS 180 Project Milestone 2: skim the material\"}, {\"day\": 3, \"time\": \"18:45\", \"minutes\": 30, \"label\": \"Head start on CS 180 Project Milestone 2: review functions\"}, {\"day\": 4, \"time\": \"19:30\", \"minutes\": 30, \"label\": \"Light CS 180 review: functions\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Tuesday Tue Dec 15 2026 17:35:56 GMT-0800 (Pacific Standard Time).\n\nUpcoming deadlines:\n- MA 261 Midterm (EXAM): Fri Dec 18 2026 13:00:00 GMT-0800 (Pacific Standard Time)\n- ART 120 Final Exam (EXAM): Sat Dec 19 2026 09:00:00 GMT-0800 (Pacific Standard Time)\n- HIST 110 Lab Report 5: Wed Dec 23 2026 09:00:00 GMT-0800 (Pacific Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-12-09: 5 sessions, 163 focused min, avg score 91\n- 2026-12-10: 5 sessions, 132 focused min, avg score 72\n- 2026-12-11: 5 sessions, 176 focused min, avg score 79\n- 2026-12-12: 6 sessions, 208 focused min, avg score 87\n- 2026-12-13: 6 sessions, 167 focused min, avg score 84\n- 2026-12-14: 4 sessions, 106 focused min, avg score 78\n- 2026-12-15: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"MA 261 Midterm is on Friday, so I put it at the front of the plan. You've been on a roll, so I gave you a bit more time each day.\", \"blocks\": [{\"day\": 2, \"time\": \"19:15\", \"minutes\": 75, \"label\": \"MA 261: skim slides and gradients\"}, {\"day\": 3, \"time\": \"19:00\", \"minutes\": 50, \"label\": \"MA 261: mock exam, then fix mistakes\"}, {\"day\": 3, \"time\": \"20:45\", \"minutes\": 50, \"label\": \"ART 120: skim slides and art movements\"}, {\"day\": 4, \"time\": \"18:45\", \"minutes\": 25, \"label\": \"ART 120: practice problems on artist profiles\"}, {\"day\": 4, \"time\": \"19:45\", \"minutes\": 75, \"label\": \"Last look at ART 120: visual analysis\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Friday Fri Feb 12 2027 12:56:45 GMT-0700 (Mountain Standard Time).\n\nUpcoming deadlines:\n- MA 165 Exam 1 (EXAM): Sat Feb 13 2027 09:00:00 GMT-0700 (Mountain Standard Time)\n- ENGL 106 Problem Set 3: Wed Feb 17 2027 23:59:00 GMT-0700 (Mountain Standard Time)\n- MA 261 Homework 4: Wed Feb 17 2027 23:59:00 GMT-0700 (Mountain Standard Time)\n- HIST 110 Problem Set 3: Wed Feb 17 2027 23:59:00 GMT-0700 (Mountain Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-02-06: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-07: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-08: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-09: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-10: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-11: 2 sessions, 32 focused min, avg score 35\n- 2027-02-12: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 45-minute pomodoros with 15-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"MA 165 Exam 1 comes first, and the rest follow in order of what's due soonest. I focused on the closest deadlines first and kept the load realistic. Bloop believes in you!\", \"blocks\": [{\"day\": 5, \"time\": \"13:45\", \"minutes\": 45, \"label\": \"MA 165 Exam 1 review: integration + derivative rules\"}, {\"day\": 0, \"time\": \"13:30\", \"minutes\": 45, \"label\": \"ENGL 106 Problem Set 3: work through the problems\"}, {\"day\": 1, \"time\": \"14:00\", \"minutes\": 45, \"label\": \"ENGL 106 Problem Set 3: check answers and redo mistakes\"}, {\"day\": 2, \"time\": \"14:00\", \"minutes\": 45, \"label\": \"MA 261 Homework 4: work through the problems\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Thursday Thu Oct 29 2026 20:24:58 GMT-0400 (Eastern Daylight Time).\n\nUpcoming deadlines:\n- SOC 100 Final Exam (EXAM): Sun Nov 01 2026 18:30:00 GMT-0500 (Eastern Standard Time)\n- BIO 110 Final Exam (EXAM): Wed Nov 04 2026 13:00:00 GMT-0500 (Eastern Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-10-23: 4 sessions, 128 focused min, avg score 63\n- 2026-10-24: 4 sessions, 128 focused min, avg score 57\n- 2026-10-25: 4 sessions, 130 focused min, avg score 75\n- 2026-10-26: 3 sessions, 78 focused min, avg score 69\n- 2026-10-27: 4 sessions, 106 focused min, avg score 65\n- 2026-10-28: 2 sessions, 53 focused min, avg score 60\n- 2026-10-29: 1 sessions, 24 focused min, avg score 63\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your SOC 100 Final Exam is on Sunday, so let's start there. It matches the steady pace you've had lately. Bloop believes in you!\", \"blocks\": [{\"day\": 5, \"time\": \"17:45\", \"minutes\": 100, \"label\": \"SOC 100: skim slides and case studies\"}, {\"day\": 5, \"time\": \"20:15\", \"minutes\": 50, \"label\": \"BIO 110: skim slides and evolution\"}, {\"day\": 6, \"time\": \"18:30\", \"minutes\": 100, \"label\": \"SOC 100 final recap: key ideas and weak spots\"}, {\"day\": 6, \"time\": \"20:45\", \"minutes\": 50, \"label\": \"BIO 110: practice problems on genetics\"}, {\"day\": 1, \"time\": \"19:15\", \"minutes\": 50, \"label\": \"BIO 110 drills: genetics\"}, {\"day\": 2, \"time\": \"18:30\", \"minutes\": 50, \"label\": \"BIO 110 final recap: key ideas and weak spots\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Monday Mon Nov 16 2026 10:35:06 GMT-0800 (Pacific Standard Time).\n\nUpcoming deadlines:\n- CS 251 Midterm 1 (EXAM): Wed Nov 18 2026 10:00:00 GMT-0800 (Pacific Standard Time)\n- MA 165 Lab Report 3: Sun Nov 22 2026 23:59:00 GMT-0800 (Pacific Standard Time)\n- ART 120 Lab Report 3: Fri Nov 27 2026 23:59:00 GMT-0800 (Pacific Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-11-10: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-11: 1 sessions, 23 focused min, avg score 42\n- 2026-11-12: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-13: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-14: 2 sessions, 24 focused min, avg score 51\n- 2026-11-15: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-16: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"CS 251 Midterm 1 is on Wednesday, so I put it at the front of the plan. Last week was pretty quiet, so I kept the plan small and doable. One pomodoro at a time, and you'll get there.\", \"blocks\": [{\"day\": 1, \"time\": \"12:15\", \"minutes\": 25, \"label\": \"CS 251: skim slides and Big-O analysis\"}, {\"day\": 2, \"time\": \"10:15\", \"minutes\": 25, \"label\": \"CS 251: mock exam, then fix mistakes\"}, {\"day\": 3, \"time\": \"08:30\", \"minutes\": 25, \"label\": \"MA 165 Lab Report 3: organize data and figures\"}, {\"day\": 4, \"time\": \"09:45\", \"minutes\": 25, \"label\": \"MA 165 Lab Report 3: organize data and figures (part 2)\"}, {\"day\": 5, \"time\": \"09:30\", \"minutes\": 25, \"label\": \"MA 165 Lab Report 3: write conclusion and proofread\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Sunday Sun Dec 06 2026 10:27:06 GMT-0800 (Pacific Standard Time).\n\nUpcoming deadlines:\n- (no upcoming deadlines found)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-11-30: 5 sessions, 128 focused min, avg score 88\n- 2026-12-01: 5 sessions, 168 focused min, avg score 77\n- 2026-12-02: 4 sessions, 129 focused min, avg score 92\n- 2026-12-03: 6 sessions, 234 focused min, avg score 79\n- 2026-12-04: 6 sessions, 230 focused min, avg score 96\n- 2026-12-05: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-06: 1 sessions, 22 focused min, avg score 76\n\nThe student uses 45-minute pomodoros with 15-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"It's a quiet week on the calendar, so I kept things light and steady. Great focus lately, so I added a little extra study time. I'll be cheering for you the whole way!\", \"blocks\": [{\"day\": 0, \"time\": \"11:45\", \"minutes\": 45, \"label\": \"Plan next week's study goals\"}, {\"day\": 1, \"time\": \"09:15\", \"minutes\": 90, \"label\": \"Get ahead on upcoming readings\"}, {\"day\": 2, \"time\": \"09:30\", \"minutes\": 45, \"label\": \"Make flashcards from class notes\"}, {\"day\": 3, \"time\": \"09:45\", \"minutes\": 90, \"label\": \"Practice problems from class\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Wednesday Wed Apr 07 2027 14:19:31 GMT-0400 (Eastern Daylight Time).\n\nUpcoming deadlines:\n- ART 120 Presentation: Thu Apr 08 2027 14:00:00 GMT-0400 (Eastern Daylight Time)\n- PSY 120 Discussion Post 3: Thu Apr 08 2027 17:00:00 GMT-0400 (Eastern Daylight Time)\n- MA 165 Project Milestone 2: Fri Apr 09 2027 11:59:00 GMT-0400 (Eastern Daylight Time)\n- CHEM 201 Final Exam (EXAM): Fri Apr 09 2027 14:00:00 GMT-0400 (Eastern Daylight Time)\n- PHYS 172 Presentation: Fri Apr 09 2027 17:00:00 GMT-0400 (Eastern Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-04-01: 1 sessions, 17 focused min, avg score 59\n- 2027-04-02: 2 sessions, 49 focused min, avg score 68\n- 2027-04-03: 1 sessions, 18 focused min, avg score 66\n- 2027-04-04: 2 sessions, 38 focused min, avg score 42\n- 2027-04-05: 1 sessions, 8 focused min, avg score 47\n- 2027-04-06: 1 sessions, 18 focused min, avg score 61\n- 2027-04-07: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 30-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your CHEM 201 Final Exam is on Friday, so it gets the first and biggest blocks. I focused on the closest deadlines first and kept the load realistic. I'll be cheering for you the whole way!\", \"blocks\": [{\"day\": 3, \"time\": \"15:00\", \"minutes\": 30, \"label\": \"Start CHEM 201 exam review: acid-base titrations\"}, {\"day\": 3, \"time\": \"16:30\", \"minutes\": 30, \"label\": \"Quick recap of CHEM 201 notes\"}, {\"day\": 4, \"time\": \"13:00\", \"minutes\": 30, \"label\": \"CHEM 201 final recap: key ideas and weak spots\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Tuesday Tue Nov 03 2026 10:00:08 GMT-0500 (Eastern Standard Time).\n\nUpcoming deadlines:\n- (no upcoming deadlines found)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-10-28: 2 sessions, 59 focused min, avg score 68\n- 2026-10-29: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-30: 4 sessions, 95 focused min, avg score 75\n- 2026-10-31: 2 sessions, 54 focused min, avg score 77\n- 2026-11-01: 4 sessions, 139 focused min, avg score 63\n- 2026-11-02: 4 sessions, 103 focused min, avg score 78\n- 2026-11-03: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"No deadlines in sight, so let's use the time to get ahead gently. I sized the blocks to fit how you've been studying. Bloop believes in you!\", \"blocks\": [{\"day\": 2, \"time\": \"11:15\", \"minutes\": 25, \"label\": \"Practice problems from class\"}, {\"day\": 3, \"time\": \"09:15\", \"minutes\": 50, \"label\": \"Light revision: summarize key ideas\"}, {\"day\": 4, \"time\": \"09:30\", \"minutes\": 75, \"label\": \"Tidy notes and fix gaps\"}, {\"day\": 5, \"time\": \"09:45\", \"minutes\": 50, \"label\": \"Plan next week's study goals\"}, {\"day\": 6, \"time\": \"08:30\", \"minutes\": 75, \"label\": \"Get ahead on upcoming readings\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Monday Mon Feb 15 2027 14:24:58 GMT-0500 (Eastern Standard Time).\n\nUpcoming deadlines:\n- BIO 110 Lab Report 2: Thu Feb 18 2027 14:00:00 GMT-0500 (Eastern Standard Time)\n- ECON 251 Quiz 4: Thu Feb 18 2027 23:59:00 GMT-0500 (Eastern Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-02-09: 4 sessions, 157 focused min, avg score 71\n- 2027-02-10: 6 sessions, 174 focused min, avg score 93\n- 2027-02-11: 5 sessions, 181 focused min, avg score 78\n- 2027-02-12: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-13: 7 sessions, 230 focused min, avg score 71\n- 2027-02-14: 7 sessions, 198 focused min, avg score 70\n- 2027-02-15: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 45-minute pomodoros with 15-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"BIO 110 Lab Report 2 is due on Thursday, so I'm putting it first. You've been on a roll, so I gave you a bit more time each day. One pomodoro at a time, and you'll get there.\", \"blocks\": [{\"day\": 1, \"time\": \"16:00\", \"minutes\": 45, \"label\": \"BIO 110 Lab Report 2: organize data and figures\"}, {\"day\": 1, \"time\": \"18:15\", \"minutes\": 90, \"label\": \"ECON 251 Quiz 4: review key ideas\"}, {\"day\": 2, \"time\": \"16:30\", \"minutes\": 90, \"label\": \"BIO 110 Lab Report 2: write conclusion and proofread\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Thursday Thu Nov 19 2026 17:26:10 GMT-0500 (Eastern Standard Time).\n\nUpcoming deadlines:\n- ART 120 Midterm (EXAM): Sun Nov 22 2026 15:30:00 GMT-0500 (Eastern Standard Time)\n- CS 180 Project 3: Mon Nov 30 2026 14:00:00 GMT-0500 (Eastern Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-11-13: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-14: 2 sessions, 47 focused min, avg score 83\n- 2026-11-15: 3 sessions, 72 focused min, avg score 62\n- 2026-11-16: 2 sessions, 52 focused min, avg score 68\n- 2026-11-17: 3 sessions, 101 focused min, avg score 64\n- 2026-11-18: 2 sessions, 53 focused min, avg score 78\n- 2026-11-19: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your ART 120 Midterm is on Sunday, so let's start there. It matches the steady pace you've had lately. You've got this!\", \"blocks\": [{\"day\": 4, \"time\": \"19:15\", \"minutes\": 50, \"label\": \"ART 120: skim slides and artist profiles\"}, {\"day\": 4, \"time\": \"21:00\", \"minutes\": 25, \"label\": \"Head start on CS 180 Project 3: skim the material\"}, {\"day\": 5, \"time\": \"18:00\", \"minutes\": 50, \"label\": \"ART 120: practice problems on terminology\"}, {\"day\": 5, \"time\": \"20:30\", \"minutes\": 25, \"label\": \"Head start on CS 180 Project 3: review file I/O\"}, {\"day\": 6, \"time\": \"17:30\", \"minutes\": 75, \"label\": \"Last look at ART 120: art movements\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Tuesday Tue Mar 16 2027 19:45:39 GMT-0400 (Eastern Daylight Time).\n\nUpcoming deadlines:\n- SOC 100 Exam 3 (EXAM): Thu Mar 18 2027 13:00:00 GMT-0400 (Eastern Daylight Time)\n- BIO 110 Lab Report 5: Fri Mar 19 2027 17:00:00 GMT-0400 (Eastern Daylight Time)\n- PHYS 172 Exam 3 (EXAM): Thu Mar 25 2027 18:30:00 GMT-0400 (Eastern Daylight Time)\n- CS 180 Midterm (EXAM): Thu Mar 25 2027 18:30:00 GMT-0400 (Eastern Daylight Time)\n- MA 261 Presentation: Sat Mar 27 2027 17:00:00 GMT-0400 (Eastern Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-03-10: 4 sessions, 134 focused min, avg score 62\n- 2027-03-11: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-12: 4 sessions, 94 focused min, avg score 73\n- 2027-03-13: 2 sessions, 68 focused min, avg score 75\n- 2027-03-14: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-15: 4 sessions, 120 focused min, avg score 68\n- 2027-03-16: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your SOC 100 Exam 3 is on Thursday, so it gets the first and biggest blocks. I sized the blocks to fit how you've been studying. Bloop believes in you!\", \"blocks\": [{\"day\": 2, \"time\": \"21:00\", \"minutes\": 50, \"label\": \"SOC 100 exam prep: review notes on survey methods\"}, {\"day\": 3, \"time\": \"18:45\", \"minutes\": 75, \"label\": \"SOC 100: mock exam, then fix mistakes\"}, {\"day\": 3, \"time\": \"20:45\", \"minutes\": 25, \"label\": \"BIO 110 Lab Report 5: organize data and figures\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Sunday Sun Dec 20 2026 14:44:16 GMT-0700 (Mountain Standard Time).\n\nUpcoming deadlines:\n- PHYS 172 Exam 1 (EXAM): Fri Dec 25 2026 10:00:00 GMT-0700 (Mountain Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-12-14: 2 sessions, 57 focused min, avg score 65\n- 2026-12-15: 3 sessions, 82 focused min, avg score 60\n- 2026-12-16: 3 sessions, 103 focused min, avg score 55\n- 2026-12-17: 3 sessions, 89 focused min, avg score 75\n- 2026-12-18: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-19: 2 sessions, 67 focused min, avg score 75\n- 2026-12-20: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your PHYS 172 Exam 1 is on Friday, so it gets the first and biggest blocks. I sized the blocks to fit how you've been studying. One pomodoro at a time, and you'll get there.\", \"blocks\": [{\"day\": 0, \"time\": \"15:45\", \"minutes\": 50, \"label\": \"Start PHYS 172 exam review: energy conservation\"}, {\"day\": 1, \"time\": \"14:00\", \"minutes\": 75, \"label\": \"PHYS 172: practice problems on circuits\"}, {\"day\": 2, \"time\": \"13:00\", \"minutes\": 50, \"label\": \"PHYS 172 drills: circuits\"}, {\"day\": 3, \"time\": \"15:00\", \"minutes\": 25, \"label\": \"Quick recap of PHYS 172 notes\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Tuesday Tue Sep 22 2026 11:03:56 GMT-0700 (Pacific Daylight Time).\n\nUpcoming deadlines:\n- STAT 350 Midterm 2 (EXAM): Wed Sep 23 2026 18:30:00 GMT-0700 (Pacific Daylight Time)\n- SOC 100 Quiz 4: Mon Sep 28 2026 09:00:00 GMT-0700 (Pacific Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-09-16: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-17: 2 sessions, 66 focused min, avg score 64\n- 2026-09-18: 3 sessions, 84 focused min, avg score 57\n- 2026-09-19: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-20: 3 sessions, 71 focused min, avg score 63\n- 2026-09-21: 4 sessions, 108 focused min, avg score 67\n- 2026-09-22: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your STAT 350 Midterm 2 is tomorrow, so let's start there. I sized the blocks to fit how you've been studying.\", \"blocks\": [{\"day\": 2, \"time\": \"12:15\", \"minutes\": 50, \"label\": \"STAT 350 exam prep: confidence intervals + practice\"}, {\"day\": 3, \"time\": \"10:30\", \"minutes\": 50, \"label\": \"SOC 100 Quiz 4: review key ideas\"}, {\"day\": 4, \"time\": \"09:45\", \"minutes\": 50, \"label\": \"SOC 100 Quiz 4: quick practice quiz\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Saturday Sat Oct 24 2026 09:05:25 GMT-0400 (Eastern Daylight Time).\n\nUpcoming deadlines:\n- PSY 120 Midterm (EXAM): Sat Oct 24 2026 23:59:00 GMT-0400 (Eastern Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-10-18: 2 sessions, 47 focused min, avg score 59\n- 2026-10-19: 1 sessions, 17 focused min, avg score 65\n- 2026-10-20: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-21: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-22: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-23: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-24: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"PSY 120 Midterm is due today, so the plan is short and focused. Last week was pretty quiet, so I kept the plan small and doable. One pomodoro at a time, and you'll get there.\", \"blocks\": [{\"day\": 6, \"time\": \"10:45\", \"minutes\": 50, \"label\": \"PSY 120 Midterm: review memory models\"}, {\"day\": 6, \"time\": \"12:45\", \"minutes\": 50, \"label\": \"PSY 120 Midterm: review conditioning\"}, {\"day\": 6, \"time\": \"14:45\", \"minutes\": 50, \"label\": \"PSY 120 Midterm: last review before it's due\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Saturday Sat Dec 26 2026 09:41:41 GMT-0800 (Pacific Standard Time).\n\nUpcoming deadlines:\n- CHEM 201 Lab Report 3: Mon Dec 28 2026 14:00:00 GMT-0800 (Pacific Standard Time)\n- MA 165 Project 3: Fri Jan 01 2027 17:00:00 GMT-0800 (Pacific Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-12-20: 2 sessions, 70 focused min, avg score 85\n- 2026-12-21: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-22: 4 sessions, 100 focused min, avg score 82\n- 2026-12-23: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-24: 4 sessions, 130 focused min, avg score 81\n- 2026-12-25: 3 sessions, 80 focused min, avg score 61\n- 2026-12-26: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"CHEM 201 Lab Report 3 is due on Monday, so I'm putting it first. It matches the steady pace you've had lately.\", \"blocks\": [{\"day\": 6, \"time\": \"10:45\", \"minutes\": 50, \"label\": \"CHEM 201 Lab Report 3: organize data and figures\"}, {\"day\": 6, \"time\": \"12:15\", \"minutes\": 50, \"label\": \"MA 165 Project 3: build the next milestone\"}, {\"day\": 0, \"time\": \"08:00\", \"minutes\": 50, \"label\": \"CHEM 201 Lab Report 3: write conclusion and proofread\"}, {\"day\": 0, \"time\": \"10:00\", \"minutes\": 50, \"label\": \"MA 165 Project 3: build the next milestone (part 2)\"}, {\"day\": 1, \"time\": \"09:15\", \"minutes\": 50, \"label\": \"MA 165 Project 3: test and clean up\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Saturday Sat Dec 05 2026 19:30:58 GMT-0500 (Eastern Standard Time).\n\nUpcoming deadlines:\n- SOC 100 Exam 1 (EXAM): Tue Dec 08 2026 10:00:00 GMT-0500 (Eastern Standard Time)\n- CHEM 201 Quiz 4: Thu Dec 10 2026 14:00:00 GMT-0500 (Eastern Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-11-29: 7 sessions, 260 focused min, avg score 88\n- 2026-11-30: 6 sessions, 235 focused min, avg score 70\n- 2026-12-01: 7 sessions, 217 focused min, avg score 84\n- 2026-12-02: 6 sessions, 157 focused min, avg score 76\n- 2026-12-03: 6 sessions, 160 focused min, avg score 70\n- 2026-12-04: 4 sessions, 134 focused min, avg score 79\n- 2026-12-05: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"SOC 100 Exam 1 is on Tuesday, so I put it at the front of the plan. You've been on a roll, so I gave you a bit more time each day. You've got this!\", \"blocks\": [{\"day\": 6, \"time\": \"21:00\", \"minutes\": 50, \"label\": \"SOC 100: skim slides and survey methods\"}, {\"day\": 0, \"time\": \"19:45\", \"minutes\": 75, \"label\": \"SOC 100: practice problems on case studies\"}, {\"day\": 1, \"time\": \"18:45\", \"minutes\": 50, \"label\": \"SOC 100: mock exam, then fix mistakes\"}, {\"day\": 1, \"time\": \"21:05\", \"minutes\": 50, \"label\": \"CHEM 201 Quiz 4: review key ideas\"}, {\"day\": 3, \"time\": \"18:00\", \"minutes\": 25, \"label\": \"CHEM 201 Quiz 4: quick practice quiz\"}]}"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student has been using WhatsApp for 2 minutes during a focus session. Write one short, kind nudge (max 60 characters)."}, {"role": "assistant", "content": "you were doing great, let's pick it up again"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student just came back to their study app after 6 minutes away. Write one short, kind welcome-back nudge (max 60 characters)."}, {"role": "assistant", "content": "you came back, and that's what counts"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student has been on twitch.tv for 1 minute during a focus session. Write one short, kind nudge (max 60 characters)."}, {"role": "assistant", "content": "hey, that tab can wait. back to the books?"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student has been on instagram.com for 3 minutes during a focus session. Write one short, kind nudge (max 60 characters)."}, {"role": "assistant", "content": "the feed will keep. let's get back to it"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Friday Fri Oct 16 2026 08:40:46 GMT-0600 (Mountain Daylight Time).\n\nUpcoming deadlines:\n- PHYS 172 Project Milestone 2: Sat Oct 17 2026 23:59:00 GMT-0600 (Mountain Daylight Time)\n- ENGL 106 Exam 1 (EXAM): Sun Oct 18 2026 19:00:00 GMT-0600 (Mountain Daylight Time)\n- HIST 110 Project Milestone 2: Tue Oct 20 2026 09:00:00 GMT-0600 (Mountain Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-10-10: 3 sessions, 84 focused min, avg score 63\n- 2026-10-11: 4 sessions, 121 focused min, avg score 57\n- 2026-10-12: 2 sessions, 59 focused min, avg score 78\n- 2026-10-13: 4 sessions, 104 focused min, avg score 66\n- 2026-10-14: 4 sessions, 137 focused min, avg score 64\n- 2026-10-15: 4 sessions, 108 focused min, avg score 59\n- 2026-10-16: 1 sessions, 28 focused min, avg score 61\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"ENGL 106 Exam 1 comes first, and the rest follow in order of what's due soonest. It matches the steady pace you've had lately.\", \"blocks\": [{\"day\": 5, \"time\": \"10:30\", \"minutes\": 100, \"label\": \"ENGL 106 exam prep: review notes on argument structure\"}, {\"day\": 5, \"time\": \"12:45\", \"minutes\": 50, \"label\": \"PHYS 172 Project Milestone 2\"}, {\"day\": 6, \"time\": \"08:00\", \"minutes\": 50, \"label\": \"ENGL 106 final recap: key ideas and weak spots\"}, {\"day\": 6, \"time\": \"09:30\", \"minutes\": 100, \"label\": \"HIST 110 Project Milestone 2: build the next milestone\"}, {\"day\": 0, \"time\": \"08:00\", \"minutes\": 50, \"label\": \"HIST 110 Project Milestone 2: test and clean up\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Thursday Thu Oct 29 2026 21:40:38 GMT-0400 (Eastern Daylight Time).\n\nUpcoming deadlines:\n- CHEM 201 Midterm 2 (EXAM): Sun Nov 01 2026 17:00:00 GMT-0500 (Eastern Standard Time)\n- ECON 251 Quiz 4: Mon Nov 02 2026 14:00:00 GMT-0500 (Eastern Standard Time)\n- MA 165 Paper Outline: Sun Nov 08 2026 23:59:00 GMT-0500 (Eastern Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-10-23: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-24: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-25: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-26: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-27: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-28: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-29: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 45-minute pomodoros with 15-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"CHEM 201 Midterm 2 is on Sunday, so I put it at the front of the plan. I focused on the closest deadlines first and kept the load realistic. I'll be cheering for you the whole way!\", \"blocks\": [{\"day\": 5, \"time\": \"19:30\", \"minutes\": 45, \"label\": \"Start CHEM 201 exam review: acid-base titrations\"}, {\"day\": 5, \"time\": \"20:45\", \"minutes\": 45, \"label\": \"Light CHEM 201 review: acid-base titrations\"}, {\"day\": 6, \"time\": \"19:15\", \"minutes\": 45, \"label\": \"CHEM 201: mock exam, then fix mistakes\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Wednesday Wed Oct 07 2026 13:19:35 GMT-0400 (Eastern Daylight Time).\n\nUpcoming deadlines:\n- (no upcoming deadlines found)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-10-01: 4 sessions, 109 focused min, avg score 79\n- 2026-10-02: 3 sessions, 98 focused min, avg score 63\n- 2026-10-03: 3 sessions, 79 focused min, avg score 60\n- 2026-10-04: 4 sessions, 116 focused min, avg score 70\n- 2026-10-05: 4 sessions, 100 focused min, avg score 85\n- 2026-10-06: 4 sessions, 89 focused min, avg score 80\n- 2026-10-07: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"It's a quiet week on the calendar, so I kept things light and steady. It matches the steady pace you've had lately. Take your breaks too, I'll be right here.\", \"blocks\": [{\"day\": 3, \"time\": \"15:15\", \"minutes\": 75, \"label\": \"Make flashcards from class notes\"}, {\"day\": 4, \"time\": \"14:45\", \"minutes\": 75, \"label\": \"Practice problems from class\"}, {\"day\": 5, \"time\": \"15:30\", \"minutes\": 50, \"label\": \"Catch up on any missed material\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Sunday Sun Aug 30 2026 09:39:46 GMT-0500 (Central Daylight Time).\n\nUpcoming deadlines:\n- MA 165 Problem Set 5: Mon Sep 07 2026 17:00:00 GMT-0500 (Central Daylight Time)\n- ECON 251 Homework 7: Tue Sep 08 2026 14:00:00 GMT-0500 (Central Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-08-24: 0 sessions, 0 focused min, avg score n/a\n- 2026-08-25: 0 sessions, 0 focused min, avg score n/a\n- 2026-08-26: 2 sessions, 33 focused min, avg score 47\n- 2026-08-27: 0 sessions, 0 focused min, avg score n/a\n- 2026-08-28: 0 sessions, 0 focused min, avg score n/a\n- 2026-08-29: 0 sessions, 0 focused min, avg score n/a\n- 2026-08-30: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"MA 165 Problem Set 5 is due in 8 days, so I'm putting it first. Last week was pretty quiet, so I kept the plan small and doable. Blocks are built from 50-minute pomodoros with 10-minute breaks.\", \"blocks\": [{\"day\": 0, \"time\": \"11:45\", \"minutes\": 50, \"label\": \"Head start on MA 165 Problem Set 5: skim the material\"}, {\"day\": 1, \"time\": \"08:00\", \"minutes\": 50, \"label\": \"Head start on MA 165 Problem Set 5: review related rates\"}, {\"day\": 2, \"time\": \"08:30\", \"minutes\": 50, \"label\": \"Head start on ECON 251 Homework 7: skim the material\"}, {\"day\": 3, \"time\": \"09:30\", \"minutes\": 50, \"label\": \"Head start on ECON 251 Homework 7: review GDP and inflation\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Monday Mon Dec 07 2026 08:04:54 GMT-0500 (Eastern Standard Time).\n\nUpcoming deadlines:\n- CHEM 201 Midterm 1 (EXAM): Wed Dec 09 2026 10:00:00 GMT-0500 (Eastern Standard Time)\n- ENGL 106 Exam 3 (EXAM): Mon Dec 14 2026 18:30:00 GMT-0500 (Eastern Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-12-01: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-02: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-03: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-04: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-05: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-06: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-07: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 30-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your CHEM 201 Midterm 1 is on Wednesday, so it gets the first and biggest blocks. This is a fresh start, so the blocks stay gentle. I'll be cheering for you the whole way!\", \"blocks\": [{\"day\": 1, \"time\": \"09:30\", \"minutes\": 30, \"label\": \"CHEM 201 exam prep: review notes on acid-base titrations\"}, {\"day\": 2, \"time\": \"08:30\", \"minutes\": 30, \"label\": \"CHEM 201: mock exam, then fix mistakes\"}, {\"day\": 3, \"time\": \"08:30\", \"minutes\": 30, \"label\": \"Head start on ENGL 106 Exam 3: skim the material\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Wednesday Wed Apr 28 2027 13:08:29 GMT-0600 (Mountain Daylight Time).\n\nUpcoming deadlines:\n- PSY 120 Discussion Post 3: Thu Apr 29 2027 14:00:00 GMT-0600 (Mountain Daylight Time)\n- CS 251 Exam 2 (EXAM): Tue May 04 2027 13:00:00 GMT-0600 (Mountain Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-04-22: 1 sessions, 8 focused min, avg score 58\n- 2027-04-23: 1 sessions, 21 focused min, avg score 54\n- 2027-04-24: 2 sessions, 19 focused min, avg score 37\n- 2027-04-25: 2 sessions, 36 focused min, avg score 44\n- 2027-04-26: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-27: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-28: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 45-minute pomodoros with 15-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"PSY 120 Discussion Post 3 is due tomorrow, so that's our first stop. Last week was pretty quiet, so I kept the plan small and doable. Take your breaks too, I'll be right here.\", \"blocks\": [{\"day\": 3, \"time\": \"14:30\", \"minutes\": 45, \"label\": \"PSY 120 Discussion Post 3: read and take notes\"}, {\"day\": 5, \"time\": \"13:00\", \"minutes\": 45, \"label\": \"Start CS 251 exam review: linked lists\"}, {\"day\": 6, \"time\": \"15:15\", \"minutes\": 45, \"label\": \"CS 251: practice problems on hash tables\"}, {\"day\": 0, \"time\": \"15:15\", \"minutes\": 45, \"label\": \"CS 251 drills: hash tables\"}, {\"day\": 1, \"time\": \"13:30\", \"minutes\": 45, \"label\": \"Last look at CS 251: Big-O analysis\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Thursday Thu Sep 10 2026 09:53:09 GMT-0400 (Eastern Daylight Time).\n\nUpcoming deadlines:\n- MA 165 Midterm (EXAM): Thu Sep 10 2026 17:00:00 GMT-0400 (Eastern Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-09-04: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-05: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-06: 1 sessions, 29 focused min, avg score 62\n- 2026-09-07: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-08: 2 sessions, 57 focused min, avg score 47\n- 2026-09-09: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-10: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Today is the big day for MA 165 Midterm, so I kept everything before it's due. Last week was a bit stop-and-go, so I kept the plan small and doable. Bloop believes in you!\", \"blocks\": [{\"day\": 4, \"time\": \"11:30\", \"minutes\": 25, \"label\": \"MA 165 Midterm: review integration\"}, {\"day\": 4, \"time\": \"13:00\", \"minutes\": 25, \"label\": \"MA 165 Midterm: review limits\"}, {\"day\": 4, \"time\": \"14:30\", \"minutes\": 25, \"label\": \"MA 165 Midterm: last review before it's due\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Sunday Sun Aug 30 2026 19:06:39 GMT-0500 (Central Daylight Time).\n\nUpcoming deadlines:\n- ART 120 Final Exam (EXAM): Mon Aug 31 2026 17:00:00 GMT-0500 (Central Daylight Time)\n- ECON 251 Midterm (EXAM): Thu Sep 03 2026 14:00:00 GMT-0500 (Central Daylight Time)\n- CS 180 Homework 4: Fri Sep 04 2026 23:59:00 GMT-0500 (Central Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-08-24: 2 sessions, 62 focused min, avg score 61\n- 2026-08-25: 3 sessions, 96 focused min, avg score 80\n- 2026-08-26: 2 sessions, 46 focused min, avg score 78\n- 2026-08-27: 3 sessions, 77 focused min, avg score 69\n- 2026-08-28: 0 sessions, 0 focused min, avg score n/a\n- 2026-08-29: 4 sessions, 109 focused min, avg score 80\n- 2026-08-30: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 45-minute pomodoros with 15-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"You've got 3 things coming up, so I lined them up by what's closest, starting with ART 120 Final Exam. It matches the steady pace you've had lately. Take your breaks too, I'll be right here.\", \"blocks\": [{\"day\": 0, \"time\": \"21:15\", \"minutes\": 45, \"label\": \"ART 120 exam prep: art movements + practice\"}, {\"day\": 2, \"time\": \"19:15\", \"minutes\": 90, \"label\": \"ECON 251: skim slides and market structures\"}, {\"day\": 3, \"time\": \"19:30\", \"minutes\": 45, \"label\": \"ECON 251: mock exam, then fix mistakes\"}, {\"day\": 3, \"time\": \"20:45\", \"minutes\": 45, \"label\": \"CS 180 Homework 4: work through the problems\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Saturday Sat Jan 30 2027 15:09:05 GMT-0600 (Central Standard Time).\n\nUpcoming deadlines:\n- STAT 350 Presentation: Tue Feb 09 2027 14:00:00 GMT-0600 (Central Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-01-24: 1 sessions, 31 focused min, avg score 49\n- 2027-01-25: 0 sessions, 0 focused min, avg score n/a\n- 2027-01-26: 0 sessions, 0 focused min, avg score n/a\n- 2027-01-27: 0 sessions, 0 focused min, avg score n/a\n- 2027-01-28: 0 sessions, 0 focused min, avg score n/a\n- 2027-01-29: 1 sessions, 24 focused min, avg score 52\n- 2027-01-30: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"First up is STAT 350 Presentation, due in 10 days. Your focus time was light lately, so I'm not piling on too much. One pomodoro at a time, and you'll get there.\", \"blocks\": [{\"day\": 6, \"time\": \"16:15\", \"minutes\": 25, \"label\": \"Head start on STAT 350 Presentation: skim the material\"}, {\"day\": 0, \"time\": \"15:15\", \"minutes\": 25, \"label\": \"Head start on STAT 350 Presentation: review probability rules\"}, {\"day\": 1, \"time\": \"16:30\", \"minutes\": 25, \"label\": \"STAT 350: flashcards and short review\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Saturday Sat Jan 02 2027 07:47:34 GMT-0800 (Pacific Standard Time).\n\nUpcoming deadlines:\n- HIST 110 Exam 1 (EXAM): Wed Jan 06 2027 11:00:00 GMT-0800 (Pacific Standard Time)\n- ECON 251 Exam 3 (EXAM): Fri Jan 08 2027 10:00:00 GMT-0800 (Pacific Standard Time)\n- SOC 100 Midterm (EXAM): Wed Jan 13 2027 14:00:00 GMT-0800 (Pacific Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-12-27: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-28: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-29: 1 sessions, 13 focused min, avg score 36\n- 2026-12-30: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-31: 2 sessions, 40 focused min, avg score 58\n- 2027-01-01: 1 sessions, 8 focused min, avg score 58\n- 2027-01-02: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 30-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your HIST 110 Exam 1 is on Wednesday, so let's start there. Your focus time was light lately, so I'm not piling on too much.\", \"blocks\": [{\"day\": 6, \"time\": \"09:15\", \"minutes\": 30, \"label\": \"HIST 110 exam prep: review notes on key dates\"}, {\"day\": 0, \"time\": \"10:30\", \"minutes\": 30, \"label\": \"HIST 110: practice problems on the Cold War\"}, {\"day\": 1, \"time\": \"09:45\", \"minutes\": 30, \"label\": \"HIST 110 drills: the Cold War\"}, {\"day\": 2, \"time\": \"08:30\", \"minutes\": 30, \"label\": \"HIST 110 final recap: key ideas and weak spots\"}, {\"day\": 3, \"time\": \"09:30\", \"minutes\": 30, \"label\": \"ECON 251 Exam 3 review: elasticity + GDP and inflation\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Thursday Thu Apr 22 2027 07:38:22 GMT-0400 (Eastern Daylight Time).\n\nUpcoming deadlines:\n- ENGL 106 Exam 2 (EXAM): Fri Apr 23 2027 15:30:00 GMT-0400 (Eastern Daylight Time)\n- CHEM 201 Midterm 2 (EXAM): Sun Apr 25 2027 09:00:00 GMT-0400 (Eastern Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-04-16: 4 sessions, 104 focused min, avg score 76\n- 2027-04-17: 2 sessions, 60 focused min, avg score 84\n- 2027-04-18: 4 sessions, 106 focused min, avg score 82\n- 2027-04-19: 3 sessions, 87 focused min, avg score 85\n- 2027-04-20: 2 sessions, 53 focused min, avg score 74\n- 2027-04-21: 2 sessions, 44 focused min, avg score 83\n- 2027-04-22: 1 sessions, 29 focused min, avg score 64\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your ENGL 106 Exam 2 is tomorrow, so let's start there. It matches the steady pace you've had lately.\", \"blocks\": [{\"day\": 4, \"time\": \"09:00\", \"minutes\": 50, \"label\": \"Quick recap of ENGL 106 notes\"}, {\"day\": 4, \"time\": \"10:30\", \"minutes\": 50, \"label\": \"Light ENGL 106 review: thesis statements\"}, {\"day\": 4, \"time\": \"12:00\", \"minutes\": 100, \"label\": \"ENGL 106: mock exam, then fix mistakes\"}, {\"day\": 5, \"time\": \"09:00\", \"minutes\": 100, \"label\": \"CHEM 201: skim slides and kinetics\"}, {\"day\": 6, \"time\": \"10:45\", \"minutes\": 100, \"label\": \"Last look at CHEM 201: thermodynamics\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Monday Mon Oct 26 2026 07:39:00 GMT-0500 (Central Daylight Time).\n\nUpcoming deadlines:\n- STAT 350 Reading Response 4: Mon Nov 02 2026 14:00:00 GMT-0600 (Central Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-10-20: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-21: 1 sessions, 17 focused min, avg score 72\n- 2026-10-22: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-23: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-24: 2 sessions, 51 focused min, avg score 65\n- 2026-10-25: 2 sessions, 55 focused min, avg score 52\n- 2026-10-26: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 30-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"First up is STAT 350 Reading Response 4, due in 7 days. Your focus time was light lately, so I'm not piling on too much. Blocks are built from 30-minute pomodoros with 5-minute breaks.\", \"blocks\": [{\"day\": 1, \"time\": \"08:45\", \"minutes\": 30, \"label\": \"Head start on STAT 350 Reading Response 4: skim the material\"}, {\"day\": 2, \"time\": \"10:15\", \"minutes\": 30, \"label\": \"Head start on STAT 350 Reading Response 4: review probability rules\"}, {\"day\": 3, \"time\": \"09:30\", \"minutes\": 30, \"label\": \"STAT 350: flashcards and short review\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Tuesday Tue Nov 10 2026 14:09:32 GMT-0500 (Eastern Standard Time).\n\nUpcoming deadlines:\n- STAT 350 Exam 1 (EXAM): Fri Nov 13 2026 17:00:00 GMT-0500 (Eastern Standard Time)\n- PSY 120 Midterm 2 (EXAM): Sun Nov 15 2026 11:00:00 GMT-0500 (Eastern Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-11-04: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-05: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-06: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-07: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-08: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-09: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-10: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your STAT 350 Exam 1 is on Friday, so it gets the first and biggest blocks. This is a fresh start, so the blocks stay gentle. One pomodoro at a time, and you'll get there.\", \"blocks\": [{\"day\": 2, \"time\": \"15:30\", \"minutes\": 25, \"label\": \"Start STAT 350 exam review: hypothesis tests\"}, {\"day\": 3, \"time\": \"15:30\", \"minutes\": 25, \"label\": \"STAT 350: practice problems on regression\"}, {\"day\": 4, \"time\": \"14:00\", \"minutes\": 25, \"label\": \"STAT 350: mock exam, then fix mistakes\"}, {\"day\": 5, \"time\": \"14:15\", \"minutes\": 25, \"label\": \"PSY 120 exam prep: review notes on research methods\"}, {\"day\": 6, \"time\": \"15:45\", \"minutes\": 25, \"label\": \"PSY 120: mock exam, then fix mistakes\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Saturday Sat Nov 14 2026 10:26:55 GMT+0000 (Coordinated Universal Time).\n\nUpcoming deadlines:\n- SOC 100 Presentation: Mon Nov 16 2026 17:00:00 GMT+0000 (Coordinated Universal Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-11-08: 4 sessions, 118 focused min, avg score 66\n- 2026-11-09: 3 sessions, 83 focused min, avg score 66\n- 2026-11-10: 3 sessions, 97 focused min, avg score 72\n- 2026-11-11: 4 sessions, 130 focused min, avg score 67\n- 2026-11-12: 2 sessions, 45 focused min, avg score 85\n- 2026-11-13: 2 sessions, 62 focused min, avg score 84\n- 2026-11-14: 1 sessions, 25 focused min, avg score 83\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"SOC 100 Presentation is due on Monday, so I'm putting it first. It matches the steady pace you've had lately.\", \"blocks\": [{\"day\": 6, \"time\": \"11:30\", \"minutes\": 50, \"label\": \"SOC 100 Presentation: build the slides\"}, {\"day\": 6, \"time\": \"13:30\", \"minutes\": 50, \"label\": \"Light SOC 100 review: survey methods\"}, {\"day\": 0, \"time\": \"09:30\", \"minutes\": 50, \"label\": \"SOC 100 Presentation: build the slides (part 3)\"}, {\"day\": 0, \"time\": \"12:00\", \"minutes\": 50, \"label\": \"SOC 100: flashcards and short review\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Friday Fri Sep 11 2026 10:22:59 GMT-0600 (Mountain Daylight Time).\n\nUpcoming deadlines:\n- (no upcoming deadlines found)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-09-05: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-06: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-07: 4 sessions, 136 focused min, avg score 57\n- 2026-09-08: 3 sessions, 90 focused min, avg score 66\n- 2026-09-09: 3 sessions, 76 focused min, avg score 66\n- 2026-09-10: 4 sessions, 125 focused min, avg score 55\n- 2026-09-11: 1 sessions, 20 focused min, avg score 70\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Nothing is due soon, so this is a calm week to build a rhythm. It matches the steady pace you've had lately. One pomodoro at a time, and you'll get there.\", \"blocks\": [{\"day\": 5, \"time\": \"11:00\", \"minutes\": 50, \"label\": \"Make flashcards from class notes\"}, {\"day\": 6, \"time\": \"09:30\", \"minutes\": 100, \"label\": \"Get ahead on upcoming readings\"}, {\"day\": 0, \"time\": \"09:30\", \"minutes\": 50, \"label\": \"Plan next week's study goals\"}, {\"day\": 1, \"time\": \"08:30\", \"minutes\": 50, \"label\": \"Catch up on any missed material\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Thursday Thu Mar 18 2027 08:20:26 GMT-0400 (Eastern Daylight Time).\n\nUpcoming deadlines:\n- ECON 251 Paper Outline: Mon Mar 22 2027 23:59:00 GMT-0400 (Eastern Daylight Time)\n- CS 251 Problem Set 5: Sat Mar 27 2027 11:59:00 GMT-0400 (Eastern Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-03-12: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-13: 1 sessions, 24 focused min, avg score 45\n- 2027-03-14: 2 sessions, 18 focused min, avg score 37\n- 2027-03-15: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-16: 2 sessions, 44 focused min, avg score 46\n- 2027-03-17: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-18: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"ECON 251 Paper Outline is due on Monday, so I'm putting it first. Your focus time was light lately, so I'm not piling on too much. You've got this!\", \"blocks\": [{\"day\": 4, \"time\": \"09:00\", \"minutes\": 25, \"label\": \"ECON 251 Paper Outline: outline and draft\"}, {\"day\": 5, \"time\": \"09:45\", \"minutes\": 25, \"label\": \"ECON 251 Paper Outline: outline and draft (part 2)\"}, {\"day\": 6, \"time\": \"09:00\", \"minutes\": 25, \"label\": \"ECON 251 Paper Outline: outline and draft (part 3)\"}, {\"day\": 0, \"time\": \"09:15\", \"minutes\": 25, \"label\": \"ECON 251 Paper Outline: revise and proofread\"}, {\"day\": 1, \"time\": \"09:15\", \"minutes\": 25, \"label\": \"Head start on CS 251 Problem Set 5: skim the material\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Tuesday Tue Sep 15 2026 15:29:59 GMT+0100 (British Summer Time).\n\nUpcoming deadlines:\n- HIST 110 Presentation: Mon Sep 21 2026 23:59:00 GMT+0100 (British Summer Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-09-09: 6 sessions, 177 focused min, avg score 71\n- 2026-09-10: 4 sessions, 128 focused min, avg score 94\n- 2026-09-11: 5 sessions, 157 focused min, avg score 96\n- 2026-09-12: 7 sessions, 276 focused min, avg score 88\n- 2026-09-13: 5 sessions, 133 focused min, avg score 95\n- 2026-09-14: 6 sessions, 220 focused min, avg score 76\n- 2026-09-15: 1 sessions, 17 focused min, avg score 88\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"HIST 110 Presentation is due on Monday, so that's our first stop. You've been on a roll, so I gave you a bit more time each day. One pomodoro at a time, and you'll get there.\", \"blocks\": [{\"day\": 2, \"time\": \"16:00\", \"minutes\": 50, \"label\": \"HIST 110 Presentation: build the slides\"}, {\"day\": 3, \"time\": \"14:00\", \"minutes\": 50, \"label\": \"HIST 110 Presentation: build the slides (part 2)\"}, {\"day\": 4, \"time\": \"14:00\", \"minutes\": 50, \"label\": \"HIST 110: flashcards and short review\"}, {\"day\": 5, \"time\": \"13:30\", \"minutes\": 50, \"label\": \"Quick recap of HIST 110 notes\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Monday Mon May 03 2027 17:05:55 GMT-0400 (Eastern Daylight Time).\n\nUpcoming deadlines:\n- ART 120 Midterm (EXAM): Thu May 06 2027 09:00:00 GMT-0400 (Eastern Daylight Time)\n- HIST 110 Exam 3 (EXAM): Sun May 09 2027 11:00:00 GMT-0400 (Eastern Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-04-27: 2 sessions, 55 focused min, avg score 48\n- 2027-04-28: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-29: 1 sessions, 30 focused min, avg score 63\n- 2027-04-30: 3 sessions, 89 focused min, avg score 52\n- 2027-05-01: 1 sessions, 30 focused min, avg score 71\n- 2027-05-02: 0 sessions, 0 focused min, avg score n/a\n- 2027-05-03: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 45-minute pomodoros with 15-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"ART 120 Midterm is on Thursday, so I put it at the front of the plan. Last week was a bit stop-and-go, so I kept the plan small and doable. One pomodoro at a time, and you'll get there.\", \"blocks\": [{\"day\": 1, \"time\": \"18:30\", \"minutes\": 45, \"label\": \"ART 120 exam prep: review notes on visual analysis\"}, {\"day\": 2, \"time\": \"18:15\", \"minutes\": 45, \"label\": \"ART 120: practice problems on artist profiles\"}, {\"day\": 3, \"time\": \"18:15\", \"minutes\": 45, \"label\": \"ART 120 final recap: key ideas and weak spots\"}, {\"day\": 5, \"time\": \"19:45\", \"minutes\": 45, \"label\": \"HIST 110 exam prep: review notes on the Industrial Revolution\"}, {\"day\": 6, \"time\": \"18:15\", \"minutes\": 45, \"label\": \"Last look at HIST 110: key dates\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Saturday Sat Apr 03 2027 19:42:19 GMT-0600 (Mountain Daylight Time).\n\nUpcoming deadlines:\n- BIO 110 Exam 1 (EXAM): Mon Apr 05 2027 10:00:00 GMT-0600 (Mountain Daylight Time)\n- ECON 251 Midterm 2 (EXAM): Mon Apr 05 2027 18:30:00 GMT-0600 (Mountain Daylight Time)\n- PHYS 172 Midterm 2 (EXAM): Thu Apr 08 2027 15:30:00 GMT-0600 (Mountain Daylight Time)\n- ENGL 106 Midterm 2 (EXAM): Mon Apr 12 2027 10:00:00 GMT-0600 (Mountain Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-03-28: 3 sessions, 88 focused min, avg score 68\n- 2027-03-29: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-30: 4 sessions, 132 focused min, avg score 85\n- 2027-03-31: 2 sessions, 61 focused min, avg score 64\n- 2027-04-01: 3 sessions, 105 focused min, avg score 60\n- 2027-04-02: 3 sessions, 95 focused min, avg score 79\n- 2027-04-03: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"BIO 110 Exam 1 comes first, and the rest follow in order of what's due soonest. I focused on the closest deadlines first and kept the load realistic. You've got this!\", \"blocks\": [{\"day\": 6, \"time\": \"21:00\", \"minutes\": 50, \"label\": \"BIO 110 exam prep: review notes on evolution\"}, {\"day\": 0, \"time\": \"18:45\", \"minutes\": 100, \"label\": \"BIO 110: mock exam, then fix mistakes\"}, {\"day\": 2, \"time\": \"19:30\", \"minutes\": 100, \"label\": \"PHYS 172 exam prep: waves + practice\"}, {\"day\": 3, \"time\": \"18:45\", \"minutes\": 100, \"label\": \"Head start on ENGL 106 Midterm 2: skim the material\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Monday Mon Nov 02 2026 08:33:10 GMT-0700 (Mountain Standard Time).\n\nUpcoming deadlines:\n- ECON 251 Midterm 1 (EXAM): Tue Nov 03 2026 19:00:00 GMT-0700 (Mountain Standard Time)\n- MA 261 Reading Response: Fri Nov 06 2026 23:59:00 GMT-0700 (Mountain Standard Time)\n- SOC 100 Midterm 1 (EXAM): Sun Nov 08 2026 15:30:00 GMT-0700 (Mountain Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-10-27: 4 sessions, 107 focused min, avg score 66\n- 2026-10-28: 3 sessions, 75 focused min, avg score 73\n- 2026-10-29: 2 sessions, 67 focused min, avg score 61\n- 2026-10-30: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-31: 2 sessions, 69 focused min, avg score 62\n- 2026-11-01: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-02: 1 sessions, 17 focused min, avg score 84\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your ECON 251 Midterm 1 is tomorrow, so it gets the first and biggest blocks. There's a lot coming up, so I put the nearest ones first and kept each day doable. Bloop believes in you!\", \"blocks\": [{\"day\": 1, \"time\": \"10:00\", \"minutes\": 50, \"label\": \"ECON 251 Midterm 1 review: supply and demand + elasticity\"}, {\"day\": 2, \"time\": \"10:00\", \"minutes\": 50, \"label\": \"SOC 100: skim slides and key concepts\"}, {\"day\": 3, \"time\": \"10:00\", \"minutes\": 50, \"label\": \"SOC 100: practice problems on survey methods\"}, {\"day\": 4, \"time\": \"09:15\", \"minutes\": 50, \"label\": \"SOC 100 drills: survey methods\"}, {\"day\": 5, \"time\": \"08:30\", \"minutes\": 50, \"label\": \"SOC 100 final recap: key ideas and weak spots\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Saturday Sat Nov 07 2026 13:06:22 GMT-0800 (Pacific Standard Time).\n\nUpcoming deadlines:\n- CS 180 Exam 1 (EXAM): Wed Nov 11 2026 10:00:00 GMT-0800 (Pacific Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-11-01: 2 sessions, 43 focused min, avg score 46\n- 2026-11-02: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-03: 1 sessions, 16 focused min, avg score 50\n- 2026-11-04: 1 sessions, 23 focused min, avg score 54\n- 2026-11-05: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-06: 1 sessions, 13 focused min, avg score 66\n- 2026-11-07: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your CS 180 Exam 1 is on Wednesday, so let's start there. Your focus time was light lately, so I'm not piling on too much. Blocks are built from 25-minute pomodoros with 5-minute breaks.\", \"blocks\": [{\"day\": 6, \"time\": \"15:00\", \"minutes\": 25, \"label\": \"Start CS 180 exam review: file I/O\"}, {\"day\": 0, \"time\": \"15:00\", \"minutes\": 25, \"label\": \"CS 180: practice problems on Python loops\"}, {\"day\": 1, \"time\": \"14:15\", \"minutes\": 25, \"label\": \"CS 180 drills: Python loops\"}, {\"day\": 2, \"time\": \"15:15\", \"minutes\": 25, \"label\": \"CS 180 final recap: key ideas and weak spots\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Friday Fri Apr 23 2027 11:17:27 GMT-0400 (Eastern Daylight Time).\n\nUpcoming deadlines:\n- CHEM 201 Midterm 1 (EXAM): Sun Apr 25 2027 11:00:00 GMT-0400 (Eastern Daylight Time)\n- ECON 251 Exam 2 (EXAM): Sun Apr 25 2027 13:00:00 GMT-0400 (Eastern Daylight Time)\n- BIO 110 Essay Draft: Mon Apr 26 2027 09:00:00 GMT-0400 (Eastern Daylight Time)\n- SOC 100 Lab Report 2: Mon Apr 26 2027 23:59:00 GMT-0400 (Eastern Daylight Time)\n- MA 261 Midterm 1 (EXAM): Tue Apr 27 2027 13:00:00 GMT-0400 (Eastern Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-04-17: 2 sessions, 39 focused min, avg score 69\n- 2027-04-18: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-19: 2 sessions, 39 focused min, avg score 47\n- 2027-04-20: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-21: 3 sessions, 104 focused min, avg score 57\n- 2027-04-22: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-23: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 45-minute pomodoros with 15-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"CHEM 201 Midterm 1 is on Sunday, so I put it at the front of the plan. There's a lot coming up, so I put the nearest ones first and kept each day doable. Bloop believes in you!\", \"blocks\": [{\"day\": 5, \"time\": \"12:45\", \"minutes\": 45, \"label\": \"CHEM 201: skim slides and acid-base titrations\"}, {\"day\": 6, \"time\": \"09:45\", \"minutes\": 45, \"label\": \"Last look at CHEM 201: thermodynamics\"}, {\"day\": 0, \"time\": \"08:00\", \"minutes\": 45, \"label\": \"MA 261 Midterm 1 review: partial derivatives + Lagrange multipliers\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Tuesday Tue Apr 27 2027 18:08:12 GMT-0400 (Eastern Daylight Time).\n\nUpcoming deadlines:\n- HIST 110 Exam 2 (EXAM): Wed May 05 2027 11:00:00 GMT-0400 (Eastern Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-04-21: 7 sessions, 229 focused min, avg score 78\n- 2027-04-22: 6 sessions, 184 focused min, avg score 94\n- 2027-04-23: 4 sessions, 123 focused min, avg score 95\n- 2027-04-24: 4 sessions, 103 focused min, avg score 81\n- 2027-04-25: 5 sessions, 168 focused min, avg score 75\n- 2027-04-26: 6 sessions, 202 focused min, avg score 83\n- 2027-04-27: 1 sessions, 29 focused min, avg score 93\n\nThe student uses 30-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"HIST 110 Exam 2 is in 8 days, so I put it at the front of the plan. You've been on a roll, so I gave you a bit more time each day. You've got this!\", \"blocks\": [{\"day\": 2, \"time\": \"19:15\", \"minutes\": 60, \"label\": \"Head start on HIST 110 Exam 2: skim the material\"}, {\"day\": 3, \"time\": \"19:15\", \"minutes\": 30, \"label\": \"Head start on HIST 110 Exam 2: review the Cold War\"}, {\"day\": 4, \"time\": \"19:15\", \"minutes\": 30, \"label\": \"HIST 110: flashcards and short review\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Monday Mon Mar 08 2027 14:22:30 GMT-0500 (Eastern Standard Time).\n\nUpcoming deadlines:\n- STAT 350 Midterm 2 (EXAM): Sun Mar 14 2027 14:00:00 GMT-0400 (Eastern Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-03-02: 3 sessions, 75 focused min, avg score 77\n- 2027-03-03: 3 sessions, 97 focused min, avg score 70\n- 2027-03-04: 2 sessions, 69 focused min, avg score 71\n- 2027-03-05: 3 sessions, 102 focused min, avg score 82\n- 2027-03-06: 3 sessions, 99 focused min, avg score 67\n- 2027-03-07: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-08: 1 sessions, 18 focused min, avg score 63\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"STAT 350 Midterm 2 is on Sunday, so I put it at the front of the plan. I sized the blocks to fit how you've been studying. Blocks are built from 50-minute pomodoros with 10-minute breaks.\", \"blocks\": [{\"day\": 1, \"time\": \"16:00\", \"minutes\": 50, \"label\": \"Start STAT 350 exam review: confidence intervals\"}, {\"day\": 2, \"time\": \"13:00\", \"minutes\": 100, \"label\": \"STAT 350: practice problems on regression\"}, {\"day\": 3, \"time\": \"16:00\", \"minutes\": 50, \"label\": \"STAT 350 drills: regression\"}, {\"day\": 4, \"time\": \"13:45\", \"minutes\": 50, \"label\": \"Quick recap of STAT 350 notes\"}, {\"day\": 5, \"time\": \"16:00\", \"minutes\": 50, \"label\": \"Light STAT 350 review: confidence intervals\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Saturday Sat Nov 21 2026 17:26:26 GMT-0500 (Eastern Standard Time).\n\nUpcoming deadlines:\n- PHYS 172 Reading Response 4: Mon Nov 23 2026 09:00:00 GMT-0500 (Eastern Standard Time)\n- ECON 251 Exam 3 (EXAM): Thu Nov 26 2026 14:00:00 GMT-0500 (Eastern Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-11-15: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-16: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-17: 2 sessions, 24 focused min, avg score 58\n- 2026-11-18: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-19: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-20: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-21: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 45-minute pomodoros with 15-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your ECON 251 Exam 3 is on Thursday, so let's start there. There's a lot coming up, so I put the nearest ones first and kept each day doable. One pomodoro at a time, and you'll get there.\", \"blocks\": [{\"day\": 6, \"time\": \"18:45\", \"minutes\": 45, \"label\": \"ECON 251: skim slides and market structures\"}, {\"day\": 0, \"time\": \"19:45\", \"minutes\": 45, \"label\": \"ECON 251: practice problems on GDP and inflation\"}, {\"day\": 2, \"time\": \"18:00\", \"minutes\": 45, \"label\": \"ECON 251 drills: GDP and inflation\"}, {\"day\": 3, \"time\": \"17:30\", \"minutes\": 45, \"label\": \"ECON 251 final recap: key ideas and weak spots\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Monday Mon Apr 05 2027 14:20:45 GMT-0500 (Central Daylight Time).\n\nUpcoming deadlines:\n- CHEM 201 Exam 3 (EXAM): Sat Apr 10 2027 13:00:00 GMT-0500 (Central Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-03-30: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-31: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-01: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-02: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-03: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-04: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-05: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your CHEM 201 Exam 3 is on Saturday, so it gets the first and biggest blocks. This is a fresh start, so the blocks stay gentle. I'll be cheering for you the whole way!\", \"blocks\": [{\"day\": 1, \"time\": \"16:15\", \"minutes\": 25, \"label\": \"Start CHEM 201 exam review: thermodynamics\"}, {\"day\": 2, \"time\": \"15:45\", \"minutes\": 25, \"label\": \"CHEM 201: practice problems on acid-base titrations\"}, {\"day\": 3, \"time\": \"13:45\", \"minutes\": 25, \"label\": \"CHEM 201 drills: acid-base titrations\"}, {\"day\": 4, \"time\": \"14:15\", \"minutes\": 25, \"label\": \"CHEM 201: redo tricky equilibrium questions\"}, {\"day\": 5, \"time\": \"16:15\", \"minutes\": 25, \"label\": \"CHEM 201: mock exam, then fix mistakes\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Wednesday Wed Dec 02 2026 08:53:46 GMT-0500 (Eastern Standard Time).\n\nUpcoming deadlines:\n- MA 165 Final Exam (EXAM): Sun Dec 06 2026 19:00:00 GMT-0500 (Eastern Standard Time)\n- HIST 110 Group Project Part 1: Sat Dec 12 2026 09:00:00 GMT-0500 (Eastern Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-11-26: 4 sessions, 137 focused min, avg score 78\n- 2026-11-27: 2 sessions, 69 focused min, avg score 66\n- 2026-11-28: 4 sessions, 116 focused min, avg score 73\n- 2026-11-29: 3 sessions, 78 focused min, avg score 73\n- 2026-11-30: 3 sessions, 75 focused min, avg score 70\n- 2026-12-01: 4 sessions, 92 focused min, avg score 59\n- 2026-12-02: 1 sessions, 22 focused min, avg score 83\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your MA 165 Final Exam is on Sunday, so let's start there. I sized the blocks to fit how you've been studying. Blocks are built from 50-minute pomodoros with 10-minute breaks.\", \"blocks\": [{\"day\": 3, \"time\": \"10:45\", \"minutes\": 100, \"label\": \"MA 165 exam prep: review notes on related rates\"}, {\"day\": 4, \"time\": \"10:15\", \"minutes\": 50, \"label\": \"MA 165: practice problems on derivative rules\"}, {\"day\": 4, \"time\": \"11:45\", \"minutes\": 50, \"label\": \"Head start on HIST 110 Group Project Part 1: skim the material\"}, {\"day\": 5, \"time\": \"09:00\", \"minutes\": 50, \"label\": \"MA 165: mock exam, then fix mistakes\"}, {\"day\": 5, \"time\": \"11:30\", \"minutes\": 50, \"label\": \"Head start on HIST 110 Group Project Part 1: review key dates\"}]}"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student has been on twitter.com for 10 minutes during a focus session. Write one short, kind nudge (max 60 characters)."}, {"role": "assistant", "content": "i believe in you, now back to work"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Monday Mon Dec 28 2026 13:52:44 GMT+0000 (Coordinated Universal Time).\n\nUpcoming deadlines:\n- HIST 110 Online Quiz 2: Thu Dec 31 2026 23:59:00 GMT+0000 (Coordinated Universal Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-12-22: 2 sessions, 35 focused min, avg score 36\n- 2026-12-23: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-24: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-25: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-26: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-27: 2 sessions, 35 focused min, avg score 39\n- 2026-12-28: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"HIST 110 Online Quiz 2 is due on Thursday, so that's our first stop. Last week was pretty quiet, so I kept the plan small and doable.\", \"blocks\": [{\"day\": 1, \"time\": \"15:30\", \"minutes\": 25, \"label\": \"HIST 110 Online Quiz 2: review key ideas\"}, {\"day\": 2, \"time\": \"14:00\", \"minutes\": 25, \"label\": \"HIST 110 Online Quiz 2: review key ideas (part 2)\"}, {\"day\": 3, \"time\": \"16:15\", \"minutes\": 25, \"label\": \"HIST 110 Online Quiz 2: quick practice quiz\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Saturday Sat Mar 27 2027 11:22:08 GMT-0400 (Eastern Daylight Time).\n\nUpcoming deadlines:\n- CHEM 201 Problem Set 3: Wed Mar 31 2027 11:59:00 GMT-0400 (Eastern Daylight Time)\n- ART 120 Midterm (EXAM): Thu Apr 01 2027 13:00:00 GMT-0400 (Eastern Daylight Time)\n- MA 261 Homework 7: Tue Apr 06 2027 23:59:00 GMT-0400 (Eastern Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-03-21: 1 sessions, 18 focused min, avg score 68\n- 2027-03-22: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-23: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-24: 1 sessions, 10 focused min, avg score 50\n- 2027-03-25: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-26: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-27: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 30-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your ART 120 Midterm is on Thursday, so let's start there. There's a lot coming up, so I put the nearest ones first and kept each day doable. You've got this!\", \"blocks\": [{\"day\": 6, \"time\": \"12:45\", \"minutes\": 30, \"label\": \"Start ART 120 exam review: terminology\"}, {\"day\": 0, \"time\": \"08:30\", \"minutes\": 30, \"label\": \"ART 120: practice problems on visual analysis\"}, {\"day\": 1, \"time\": \"09:30\", \"minutes\": 30, \"label\": \"ART 120 drills: visual analysis\"}, {\"day\": 2, \"time\": \"10:45\", \"minutes\": 30, \"label\": \"ART 120 final recap: key ideas and weak spots\"}, {\"day\": 3, \"time\": \"09:45\", \"minutes\": 30, \"label\": \"Head start on MA 261 Homework 7: skim the material\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Thursday Thu Apr 08 2027 18:42:07 GMT+0100 (British Summer Time).\n\nUpcoming deadlines:\n- ART 120 Exam 2 (EXAM): Sat Apr 10 2027 11:00:00 GMT+0100 (British Summer Time)\n- CHEM 201 Midterm (EXAM): Sun Apr 11 2027 15:30:00 GMT+0100 (British Summer Time)\n- SOC 100 Homework 7: Thu Apr 15 2027 11:59:00 GMT+0100 (British Summer Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-04-02: 1 sessions, 11 focused min, avg score 37\n- 2027-04-03: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-04: 1 sessions, 21 focused min, avg score 51\n- 2027-04-05: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-06: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-07: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-08: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your ART 120 Exam 2 is on Saturday, so it gets the first and biggest blocks. I focused on the closest deadlines first and kept the load realistic.\", \"blocks\": [{\"day\": 4, \"time\": \"20:15\", \"minutes\": 25, \"label\": \"ART 120 exam prep: review notes on art movements\"}, {\"day\": 4, \"time\": \"21:30\", \"minutes\": 25, \"label\": \"ART 120: flashcards and short review\"}, {\"day\": 5, \"time\": \"17:30\", \"minutes\": 25, \"label\": \"ART 120 final recap: key ideas and weak spots\"}]}"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student just finished a focus session of 50 minutes (2 pomodoros). Write one short, kind session-complete nudge (max 60 characters)."}, {"role": "assistant", "content": "good work! come back tomorrow for more"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Saturday Sat May 01 2027 09:07:36 GMT-0700 (Pacific Daylight Time).\n\nUpcoming deadlines:\n- CS 251 Group Project Part 1: Mon May 10 2027 17:00:00 GMT-0700 (Pacific Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-04-25: 6 sessions, 230 focused min, avg score 87\n- 2027-04-26: 6 sessions, 181 focused min, avg score 90\n- 2027-04-27: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-28: 6 sessions, 229 focused min, avg score 76\n- 2027-04-29: 4 sessions, 117 focused min, avg score 85\n- 2027-04-30: 7 sessions, 186 focused min, avg score 91\n- 2027-05-01: 1 sessions, 18 focused min, avg score 94\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"CS 251 Group Project Part 1 is due in 9 days, so I'm putting it first. Great focus lately, so I added a little extra study time. I'll be cheering for you the whole way!\", \"blocks\": [{\"day\": 6, \"time\": \"10:15\", \"minutes\": 50, \"label\": \"Head start on CS 251 Group Project Part 1: skim the material\"}, {\"day\": 0, \"time\": \"10:15\", \"minutes\": 25, \"label\": \"Light CS 251 review: hash tables\"}, {\"day\": 1, \"time\": \"08:00\", \"minutes\": 25, \"label\": \"Quick recap of CS 251 notes\"}, {\"day\": 2, \"time\": \"08:00\", \"minutes\": 25, \"label\": \"CS 251: flashcards and short review\"}, {\"day\": 3, \"time\": \"08:15\", \"minutes\": 25, \"label\": \"Light CS 251 review: hash tables (part 5)\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Wednesday Wed Oct 14 2026 12:57:52 GMT+0000 (Coordinated Universal Time).\n\nUpcoming deadlines:\n- ECON 251 Final Exam (EXAM): Wed Oct 21 2026 11:00:00 GMT+0000 (Coordinated Universal Time)\n- CS 180 Midterm (EXAM): Thu Oct 22 2026 09:00:00 GMT+0000 (Coordinated Universal Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-10-08: 3 sessions, 94 focused min, avg score 78\n- 2026-10-09: 4 sessions, 125 focused min, avg score 62\n- 2026-10-10: 2 sessions, 45 focused min, avg score 60\n- 2026-10-11: 3 sessions, 73 focused min, avg score 57\n- 2026-10-12: 4 sessions, 118 focused min, avg score 77\n- 2026-10-13: 2 sessions, 56 focused min, avg score 66\n- 2026-10-14: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your ECON 251 Final Exam is in 7 days, so it gets the first and biggest blocks. I sized the blocks to fit how you've been studying. One pomodoro at a time, and you'll get there.\", \"blocks\": [{\"day\": 3, \"time\": \"14:15\", \"minutes\": 50, \"label\": \"Head start on ECON 251 Final Exam: skim the material\"}, {\"day\": 3, \"time\": \"15:45\", \"minutes\": 50, \"label\": \"Head start on CS 180 Midterm: skim the material\"}, {\"day\": 4, \"time\": \"16:15\", \"minutes\": 25, \"label\": \"Head start on ECON 251 Final Exam: review market structures\"}, {\"day\": 4, \"time\": \"18:15\", \"minutes\": 25, \"label\": \"Head start on CS 180 Midterm: review functions\"}, {\"day\": 5, \"time\": \"16:00\", \"minutes\": 25, \"label\": \"Quick recap of ECON 251 notes\"}]}"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student just came back to their study app after 7 minutes away. Write one short, kind welcome-back nudge (max 60 characters)."}, {"role": "assistant", "content": "your desk is warm and your pet is happy"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Monday Mon Apr 26 2027 17:24:09 GMT-0600 (Mountain Daylight Time).\n\nUpcoming deadlines:\n- PHYS 172 Exam 3 (EXAM): Tue Apr 27 2027 11:00:00 GMT-0600 (Mountain Daylight Time)\n- ECON 251 Quiz 4: Wed Apr 28 2027 11:59:00 GMT-0600 (Mountain Daylight Time)\n- SOC 100 Final Exam (EXAM): Wed Apr 28 2027 15:30:00 GMT-0600 (Mountain Daylight Time)\n- BIO 110 Final Exam (EXAM): Thu Apr 29 2027 19:00:00 GMT-0600 (Mountain Daylight Time)\n- ENGL 106 Paper Outline: Thu Apr 29 2027 23:59:00 GMT-0600 (Mountain Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-04-20: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-21: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-22: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-23: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-24: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-25: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-26: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 45-minute pomodoros with 15-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your PHYS 172 Exam 3 is tomorrow, so it gets the first and biggest blocks. I focused on the closest deadlines first and kept the load realistic. Bloop believes in you!\", \"blocks\": [{\"day\": 1, \"time\": \"18:45\", \"minutes\": 45, \"label\": \"PHYS 172 exam prep: review notes on energy conservation\"}, {\"day\": 1, \"time\": \"20:00\", \"minutes\": 45, \"label\": \"Quick recap of PHYS 172 notes\"}, {\"day\": 1, \"time\": \"21:15\", \"minutes\": 45, \"label\": \"PHYS 172: flashcards and short review\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Tuesday Tue Feb 09 2027 14:09:10 GMT-0800 (Pacific Standard Time).\n\nUpcoming deadlines:\n- STAT 350 Reading Response 4: Fri Feb 12 2027 14:00:00 GMT-0800 (Pacific Standard Time)\n- MA 261 Exam 2 (EXAM): Sat Feb 13 2027 13:00:00 GMT-0800 (Pacific Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-02-03: 1 sessions, 22 focused min, avg score 53\n- 2027-02-04: 3 sessions, 83 focused min, avg score 40\n- 2027-02-05: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-06: 2 sessions, 66 focused min, avg score 55\n- 2027-02-07: 1 sessions, 28 focused min, avg score 53\n- 2027-02-08: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-09: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your MA 261 Exam 2 is on Saturday, so it gets the first and biggest blocks. I focused on the closest deadlines first and kept the load realistic. Blocks are built from 25-minute pomodoros with 5-minute breaks.\", \"blocks\": [{\"day\": 2, \"time\": \"16:00\", \"minutes\": 50, \"label\": \"MA 261: skim slides and Lagrange multipliers\"}, {\"day\": 3, \"time\": \"16:30\", \"minutes\": 50, \"label\": \"MA 261: practice problems on gradients\"}, {\"day\": 4, \"time\": \"16:00\", \"minutes\": 50, \"label\": \"MA 261: mock exam, then fix mistakes\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Wednesday Wed Mar 31 2027 19:13:27 GMT-0700 (Pacific Daylight Time).\n\nUpcoming deadlines:\n- MA 165 Reading Response 4: Sun Apr 04 2027 09:00:00 GMT-0700 (Pacific Daylight Time)\n- SOC 100 Lab Report 2: Sun Apr 04 2027 14:00:00 GMT-0700 (Pacific Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-03-25: 3 sessions, 72 focused min, avg score 83\n- 2027-03-26: 4 sessions, 131 focused min, avg score 68\n- 2027-03-27: 3 sessions, 66 focused min, avg score 73\n- 2027-03-28: 2 sessions, 59 focused min, avg score 72\n- 2027-03-29: 2 sessions, 51 focused min, avg score 65\n- 2027-03-30: 3 sessions, 93 focused min, avg score 84\n- 2027-03-31: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 45-minute pomodoros with 15-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"MA 165 Reading Response 4 is due on Sunday, so I'm putting it first. It matches the steady pace you've had lately.\", \"blocks\": [{\"day\": 3, \"time\": \"20:00\", \"minutes\": 45, \"label\": \"MA 165 Reading Response 4: read and take notes\"}, {\"day\": 3, \"time\": \"21:15\", \"minutes\": 45, \"label\": \"SOC 100 Lab Report 2: organize data and figures\"}, {\"day\": 4, \"time\": \"18:15\", \"minutes\": 45, \"label\": \"MA 165 Reading Response 4: write the response\"}, {\"day\": 4, \"time\": \"19:45\", \"minutes\": 45, \"label\": \"SOC 100 Lab Report 2: organize data and figures (part 2)\"}, {\"day\": 5, \"time\": \"19:15\", \"minutes\": 45, \"label\": \"SOC 100 Lab Report 2: write conclusion and proofread\"}]}"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student just came back to their study app after 15 minutes away. Write one short, kind welcome-back nudge (max 60 characters)."}, {"role": "assistant", "content": "welcome back, no guilt, just focus"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student has been on youtube.com for 10 minutes during a focus session. Write one short, kind nudge (max 60 characters)."}, {"role": "assistant", "content": "oops, wandered off! let's go back together"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Sunday Sun Dec 27 2026 10:02:27 GMT-0700 (Mountain Standard Time).\n\nUpcoming deadlines:\n- ENGL 106 Homework 9: Mon Dec 28 2026 09:00:00 GMT-0700 (Mountain Standard Time)\n- HIST 110 Exam 2 (EXAM): Wed Dec 30 2026 13:00:00 GMT-0700 (Mountain Standard Time)\n- PHYS 172 Homework 4: Thu Dec 31 2026 23:59:00 GMT-0700 (Mountain Standard Time)\n- STAT 350 Problem Set 8: Mon Jan 04 2027 23:59:00 GMT-0700 (Mountain Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-12-21: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-22: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-23: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-24: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-25: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-26: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-27: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 30-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"You've got 3 things coming up, so I lined them up by what's closest, starting with HIST 110 Exam 2. I focused on the closest deadlines first and kept the load realistic. Take your breaks too, I'll be right here.\", \"blocks\": [{\"day\": 0, \"time\": \"11:15\", \"minutes\": 30, \"label\": \"Start HIST 110 exam review: key dates\"}, {\"day\": 2, \"time\": \"09:30\", \"minutes\": 30, \"label\": \"HIST 110: mock exam, then fix mistakes\"}, {\"day\": 3, \"time\": \"10:00\", \"minutes\": 30, \"label\": \"PHYS 172 Homework 4: work through the problems\"}, {\"day\": 4, \"time\": \"08:30\", \"minutes\": 30, \"label\": \"Head start on STAT 350 Problem Set 8: skim the material\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Friday Fri Apr 02 2027 13:03:14 GMT+0000 (Coordinated Universal Time).\n\nUpcoming deadlines:\n- ECON 251 Midterm 2 (EXAM): Sun Apr 04 2027 13:00:00 GMT+0000 (Coordinated Universal Time)\n- MA 261 Exam 1 (EXAM): Fri Apr 09 2027 15:30:00 GMT+0000 (Coordinated Universal Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-03-27: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-28: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-29: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-30: 2 sessions, 43 focused min, avg score 61\n- 2027-03-31: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-01: 2 sessions, 18 focused min, avg score 38\n- 2027-04-02: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your ECON 251 Midterm 2 is on Sunday, so let's start there. Last week was pretty quiet, so I kept the plan small and doable. Blocks are built from 25-minute pomodoros with 5-minute breaks.\", \"blocks\": [{\"day\": 5, \"time\": \"14:30\", \"minutes\": 25, \"label\": \"ECON 251: skim slides and elasticity\"}, {\"day\": 5, \"time\": \"16:00\", \"minutes\": 25, \"label\": \"Light ECON 251 review: elasticity\"}, {\"day\": 6, \"time\": \"16:15\", \"minutes\": 25, \"label\": \"ECON 251 final recap: key ideas and weak spots\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Sunday Sun Apr 11 2027 13:06:26 GMT-0400 (Eastern Daylight Time).\n\nUpcoming deadlines:\n- STAT 350 Reading Response 4: Wed Apr 21 2027 11:59:00 GMT-0400 (Eastern Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-04-05: 6 sessions, 235 focused min, avg score 96\n- 2027-04-06: 7 sessions, 250 focused min, avg score 81\n- 2027-04-07: 5 sessions, 160 focused min, avg score 86\n- 2027-04-08: 7 sessions, 242 focused min, avg score 75\n- 2027-04-09: 7 sessions, 200 focused min, avg score 76\n- 2027-04-10: 4 sessions, 132 focused min, avg score 84\n- 2027-04-11: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"First up is STAT 350 Reading Response 4, due in 10 days. Great focus lately, so I added a little extra study time. I'll be cheering for you the whole way!\", \"blocks\": [{\"day\": 0, \"time\": \"13:45\", \"minutes\": 50, \"label\": \"Head start on STAT 350 Reading Response 4: skim the material\"}, {\"day\": 1, \"time\": \"14:15\", \"minutes\": 25, \"label\": \"STAT 350: flashcards and short review\"}, {\"day\": 2, \"time\": \"13:30\", \"minutes\": 25, \"label\": \"Light STAT 350 review: probability rules\"}, {\"day\": 3, \"time\": \"15:00\", \"minutes\": 25, \"label\": \"Quick recap of STAT 350 notes\"}, {\"day\": 4, \"time\": \"14:00\", \"minutes\": 25, \"label\": \"STAT 350: flashcards and short review (part 5)\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Thursday Thu Nov 19 2026 10:15:29 GMT-0600 (Central Standard Time).\n\nUpcoming deadlines:\n- (no upcoming deadlines found)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-11-13: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-14: 2 sessions, 66 focused min, avg score 78\n- 2026-11-15: 3 sessions, 82 focused min, avg score 64\n- 2026-11-16: 4 sessions, 90 focused min, avg score 73\n- 2026-11-17: 4 sessions, 132 focused min, avg score 73\n- 2026-11-18: 3 sessions, 70 focused min, avg score 65\n- 2026-11-19: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"No deadlines in sight, so let's use the time to get ahead gently. It matches the steady pace you've had lately. Bloop believes in you!\", \"blocks\": [{\"day\": 4, \"time\": \"12:15\", \"minutes\": 50, \"label\": \"Plan next week's study goals\"}, {\"day\": 5, \"time\": \"08:30\", \"minutes\": 50, \"label\": \"Tidy notes and fix gaps\"}, {\"day\": 6, \"time\": \"10:15\", \"minutes\": 50, \"label\": \"Get ahead on upcoming readings\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Thursday Thu Mar 11 2027 11:28:16 GMT-0500 (Eastern Standard Time).\n\nUpcoming deadlines:\n- PHYS 172 Exam 1 (EXAM): Tue Mar 16 2027 15:30:00 GMT-0400 (Eastern Daylight Time)\n- CHEM 201 Lab Report 2: Thu Mar 18 2027 23:59:00 GMT-0400 (Eastern Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-03-05: 1 sessions, 20 focused min, avg score 59\n- 2027-03-06: 2 sessions, 26 focused min, avg score 45\n- 2027-03-07: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-08: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-09: 1 sessions, 20 focused min, avg score 57\n- 2027-03-10: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-11: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 30-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your PHYS 172 Exam 1 is on Tuesday, so let's start there. Last week was pretty quiet, so I kept the plan small and doable. You've got this!\", \"blocks\": [{\"day\": 4, \"time\": \"12:45\", \"minutes\": 30, \"label\": \"Start PHYS 172 exam review: circuits\"}, {\"day\": 5, \"time\": \"09:15\", \"minutes\": 30, \"label\": \"PHYS 172: practice problems on Newton's laws\"}, {\"day\": 6, \"time\": \"09:45\", \"minutes\": 30, \"label\": \"PHYS 172 drills: Newton's laws\"}, {\"day\": 0, \"time\": \"08:30\", \"minutes\": 30, \"label\": \"PHYS 172: mock exam, then fix mistakes\"}, {\"day\": 1, \"time\": \"10:00\", \"minutes\": 30, \"label\": \"Head start on CHEM 201 Lab Report 2: skim the material\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Friday Fri Oct 09 2026 12:05:23 GMT-0400 (Eastern Daylight Time).\n\nUpcoming deadlines:\n- (no upcoming deadlines found)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-10-03: 7 sessions, 205 focused min, avg score 96\n- 2026-10-04: 7 sessions, 276 focused min, avg score 93\n- 2026-10-05: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-06: 7 sessions, 235 focused min, avg score 92\n- 2026-10-07: 5 sessions, 181 focused min, avg score 93\n- 2026-10-08: 6 sessions, 185 focused min, avg score 87\n- 2026-10-09: 1 sessions, 18 focused min, avg score 88\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"No deadlines in sight, so let's use the time to get ahead gently. You've been on a roll, so I gave you a bit more time each day.\", \"blocks\": [{\"day\": 5, \"time\": \"13:30\", \"minutes\": 50, \"label\": \"Plan next week's study goals\"}, {\"day\": 6, \"time\": \"13:30\", \"minutes\": 50, \"label\": \"Tidy notes and fix gaps\"}, {\"day\": 0, \"time\": \"15:30\", \"minutes\": 75, \"label\": \"Review this week's lecture notes\"}, {\"day\": 1, \"time\": \"13:30\", \"minutes\": 50, \"label\": \"Get ahead on upcoming readings\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Monday Mon Feb 08 2027 14:28:56 GMT-0700 (Mountain Standard Time).\n\nUpcoming deadlines:\n- MA 165 Midterm 1 (EXAM): Wed Feb 17 2027 13:00:00 GMT-0700 (Mountain Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-02-02: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-03: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-04: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-05: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-06: 1 sessions, 24 focused min, avg score 71\n- 2027-02-07: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-08: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 45-minute pomodoros with 15-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your MA 165 Midterm 1 is in 9 days, so let's start there. Your focus time was light lately, so I'm not piling on too much. Blocks are built from 45-minute pomodoros with 15-minute breaks.\", \"blocks\": [{\"day\": 1, \"time\": \"16:00\", \"minutes\": 45, \"label\": \"Head start on MA 165 Midterm 1: skim the material\"}, {\"day\": 2, \"time\": \"16:00\", \"minutes\": 45, \"label\": \"Head start on MA 165 Midterm 1: review limits\"}, {\"day\": 3, \"time\": \"15:15\", \"minutes\": 45, \"label\": \"Head start on MA 165 Midterm 1: outline the main parts\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Sunday Sun Sep 20 2026 12:12:50 GMT-0500 (Central Daylight Time).\n\nUpcoming deadlines:\n- STAT 350 Reading Response 4: Sun Sep 27 2026 14:00:00 GMT-0500 (Central Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-09-14: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-15: 4 sessions, 131 focused min, avg score 55\n- 2026-09-16: 3 sessions, 86 focused min, avg score 71\n- 2026-09-17: 4 sessions, 107 focused min, avg score 62\n- 2026-09-18: 3 sessions, 80 focused min, avg score 81\n- 2026-09-19: 2 sessions, 67 focused min, avg score 81\n- 2026-09-20: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 45-minute pomodoros with 15-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"STAT 350 Reading Response 4 is due in 7 days, so I'm putting it first. It matches the steady pace you've had lately. One pomodoro at a time, and you'll get there.\", \"blocks\": [{\"day\": 0, \"time\": \"13:45\", \"minutes\": 45, \"label\": \"Head start on STAT 350 Reading Response 4: skim the material\"}, {\"day\": 1, \"time\": \"15:30\", \"minutes\": 45, \"label\": \"Head start on STAT 350 Reading Response 4: review probability rules\"}, {\"day\": 2, \"time\": \"14:00\", \"minutes\": 45, \"label\": \"Light STAT 350 review: probability rules\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Sunday Sun Oct 25 2026 16:39:12 GMT-0500 (Central Daylight Time).\n\nUpcoming deadlines:\n- SOC 100 Midterm 1 (EXAM): Tue Oct 27 2026 14:00:00 GMT-0500 (Central Daylight Time)\n- CS 180 Midterm (EXAM): Fri Oct 30 2026 09:00:00 GMT-0500 (Central Daylight Time)\n- CHEM 201 Midterm 2 (EXAM): Fri Oct 30 2026 17:00:00 GMT-0500 (Central Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-10-19: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-20: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-21: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-22: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-23: 2 sessions, 40 focused min, avg score 41\n- 2026-10-24: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-25: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your SOC 100 Midterm 1 is on Tuesday, so it gets the first and biggest blocks. I focused on the closest deadlines first and kept the load realistic. I'll be cheering for you the whole way!\", \"blocks\": [{\"day\": 0, \"time\": \"17:15\", \"minutes\": 50, \"label\": \"SOC 100 exam prep: review notes on case studies\"}, {\"day\": 1, \"time\": \"13:30\", \"minutes\": 50, \"label\": \"SOC 100 final recap: key ideas and weak spots\"}, {\"day\": 3, \"time\": \"16:00\", \"minutes\": 50, \"label\": \"CS 180 exam prep: review notes on Python loops\"}, {\"day\": 4, \"time\": \"15:45\", \"minutes\": 50, \"label\": \"CS 180 final recap: key ideas and weak spots\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Sunday Sun Feb 14 2027 20:21:00 GMT+0000 (Greenwich Mean Time).\n\nUpcoming deadlines:\n- ECON 251 Reading Response 4: Tue Feb 16 2027 11:59:00 GMT+0000 (Greenwich Mean Time)\n- PSY 120 Homework 4: Tue Feb 16 2027 11:59:00 GMT+0000 (Greenwich Mean Time)\n- ENGL 106 Exam 2 (EXAM): Mon Feb 22 2027 10:00:00 GMT+0000 (Greenwich Mean Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-02-08: 4 sessions, 158 focused min, avg score 88\n- 2027-02-09: 4 sessions, 118 focused min, avg score 75\n- 2027-02-10: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-11: 4 sessions, 128 focused min, avg score 84\n- 2027-02-12: 4 sessions, 148 focused min, avg score 77\n- 2027-02-13: 7 sessions, 207 focused min, avg score 95\n- 2027-02-14: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"ECON 251 Reading Response 4 is due on Tuesday, so that's our first stop. Great focus lately, so I added a little extra study time. I'll be cheering for you the whole way!\", \"blocks\": [{\"day\": 0, \"time\": \"21:00\", \"minutes\": 25, \"label\": \"ECON 251 Reading Response 4: read and take notes\"}, {\"day\": 1, \"time\": \"18:30\", \"minutes\": 25, \"label\": \"ECON 251 Reading Response 4: write the response\"}, {\"day\": 1, \"time\": \"20:00\", \"minutes\": 75, \"label\": \"PSY 120 Homework 4: work through the problems\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Friday Fri Feb 26 2027 21:41:33 GMT-0800 (Pacific Standard Time).\n\nUpcoming deadlines:\n- PHYS 172 Problem Set 3: Sun Feb 28 2027 17:00:00 GMT-0800 (Pacific Standard Time)\n- BIO 110 Exam 3 (EXAM): Mon Mar 01 2027 17:00:00 GMT-0800 (Pacific Standard Time)\n- HIST 110 Midterm 2 (EXAM): Tue Mar 02 2027 09:00:00 GMT-0800 (Pacific Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-02-20: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-21: 2 sessions, 16 focused min, avg score 60\n- 2027-02-22: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-23: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-24: 1 sessions, 12 focused min, avg score 48\n- 2027-02-25: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-26: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 30-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"BIO 110 Exam 3 is on Monday, so I put it at the front of the plan. I focused on the closest deadlines first and kept the load realistic.\", \"blocks\": [{\"day\": 6, \"time\": \"19:30\", \"minutes\": 30, \"label\": \"BIO 110 exam prep: review notes on photosynthesis\"}, {\"day\": 6, \"time\": \"20:30\", \"minutes\": 30, \"label\": \"Light BIO 110 review: photosynthesis\"}, {\"day\": 6, \"time\": \"21:30\", \"minutes\": 30, \"label\": \"Quick recap of BIO 110 notes\"}]}"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student's 10-minute break is over and the next 30-minute focus block is starting. Write one short, kind back-to-work nudge (max 60 characters)."}, {"role": "assistant", "content": "next block starts now. small steps count"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Thursday Thu Mar 11 2027 17:22:19 GMT-0800 (Pacific Standard Time).\n\nUpcoming deadlines:\n- CS 251 Essay 2: Sun Mar 21 2027 23:59:00 GMT-0700 (Pacific Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-03-05: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-06: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-07: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-08: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-09: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-10: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-11: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"CS 251 Essay 2 is due in 10 days, so I'm putting it first. I don't see any focus history yet, so I kept the sessions short and easy. You've got this!\", \"blocks\": [{\"day\": 4, \"time\": \"19:00\", \"minutes\": 50, \"label\": \"Head start on CS 251 Essay 2: skim the material\"}, {\"day\": 5, \"time\": \"18:30\", \"minutes\": 50, \"label\": \"Head start on CS 251 Essay 2: review Big-O analysis\"}, {\"day\": 6, \"time\": \"17:30\", \"minutes\": 50, \"label\": \"CS 251: flashcards and short review\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Tuesday Tue Mar 09 2027 18:17:00 GMT+0000 (Greenwich Mean Time).\n\nUpcoming deadlines:\n- BIO 110 Essay 2: Fri Mar 12 2027 14:00:00 GMT+0000 (Greenwich Mean Time)\n- MA 261 Discussion Post 3: Sun Mar 14 2027 11:59:00 GMT+0000 (Greenwich Mean Time)\n- CHEM 201 Reading Response: Wed Mar 17 2027 17:00:00 GMT+0000 (Greenwich Mean Time)\n- MA 165 Midterm 2 (EXAM): Fri Mar 19 2027 10:00:00 GMT+0000 (Greenwich Mean Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-03-03: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-04: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-05: 1 sessions, 12 focused min, avg score 58\n- 2027-03-06: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-07: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-08: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-09: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"BIO 110 Essay 2 is due on Friday, so that's our first stop. Your focus time was light lately, so I'm not piling on too much. Take your breaks too, I'll be right here.\", \"blocks\": [{\"day\": 2, \"time\": \"20:00\", \"minutes\": 25, \"label\": \"BIO 110 Essay 2: outline and draft\"}, {\"day\": 3, \"time\": \"19:30\", \"minutes\": 25, \"label\": \"BIO 110 Essay 2: outline and draft (part 2)\"}, {\"day\": 4, \"time\": \"18:30\", \"minutes\": 25, \"label\": \"BIO 110 Essay 2: revise and proofread\"}, {\"day\": 6, \"time\": \"17:30\", \"minutes\": 25, \"label\": \"MA 261 Discussion Post 3: read and take notes\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Wednesday Wed Nov 04 2026 16:23:59 GMT-0700 (Mountain Standard Time).\n\nUpcoming deadlines:\n- (no upcoming deadlines found)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-10-29: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-30: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-31: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-01: 2 sessions, 45 focused min, avg score 67\n- 2026-11-02: 2 sessions, 47 focused min, avg score 78\n- 2026-11-03: 2 sessions, 48 focused min, avg score 65\n- 2026-11-04: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"No deadlines in sight, so let's use the time to get ahead gently. It matches the steady pace you've had lately.\", \"blocks\": [{\"day\": 3, \"time\": \"18:00\", \"minutes\": 25, \"label\": \"Plan next week's study goals\"}, {\"day\": 4, \"time\": \"13:30\", \"minutes\": 75, \"label\": \"Get ahead on upcoming readings\"}, {\"day\": 5, \"time\": \"16:45\", \"minutes\": 50, \"label\": \"Make flashcards from class notes\"}, {\"day\": 6, \"time\": \"13:45\", \"minutes\": 50, \"label\": \"Practice problems from class\"}, {\"day\": 0, \"time\": \"13:00\", \"minutes\": 50, \"label\": \"Catch up on any missed material\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Monday Mon Dec 21 2026 10:31:12 GMT-0800 (Pacific Standard Time).\n\nUpcoming deadlines:\n- BIO 110 Presentation: Wed Dec 23 2026 17:00:00 GMT-0800 (Pacific Standard Time)\n- STAT 350 Midterm 1 (EXAM): Mon Dec 28 2026 10:00:00 GMT-0800 (Pacific Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-12-15: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-16: 1 sessions, 33 focused min, avg score 67\n- 2026-12-17: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-18: 2 sessions, 67 focused min, avg score 60\n- 2026-12-19: 3 sessions, 78 focused min, avg score 63\n- 2026-12-20: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-21: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"BIO 110 Presentation is due on Wednesday, so that's our first stop. Last week was a bit stop-and-go, so I kept the plan small and doable.\", \"blocks\": [{\"day\": 1, \"time\": \"12:00\", \"minutes\": 50, \"label\": \"BIO 110 Presentation: build the slides\"}, {\"day\": 2, \"time\": \"10:30\", \"minutes\": 50, \"label\": \"BIO 110 Presentation: practice the talk out loud\"}, {\"day\": 3, \"time\": \"08:45\", \"minutes\": 50, \"label\": \"Head start on STAT 350 Midterm 1: skim the material\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Wednesday Wed Dec 09 2026 13:19:37 GMT+0000 (Greenwich Mean Time).\n\nUpcoming deadlines:\n- (no upcoming deadlines found)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-12-03: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-04: 2 sessions, 36 focused min, avg score 46\n- 2026-12-05: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-06: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-07: 1 sessions, 19 focused min, avg score 63\n- 2026-12-08: 2 sessions, 24 focused min, avg score 57\n- 2026-12-09: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"No deadlines in sight, so let's use the time to get ahead gently. Your focus time was light lately, so I'm not piling on too much. You've got this!\", \"blocks\": [{\"day\": 3, \"time\": \"14:45\", \"minutes\": 75, \"label\": \"Get ahead on upcoming readings\"}, {\"day\": 4, \"time\": \"13:30\", \"minutes\": 50, \"label\": \"Practice problems from class\"}, {\"day\": 5, \"time\": \"14:00\", \"minutes\": 50, \"label\": \"Plan next week's study goals\"}, {\"day\": 6, \"time\": \"13:30\", \"minutes\": 75, \"label\": \"Catch up on any missed material\"}, {\"day\": 0, \"time\": \"14:30\", \"minutes\": 75, \"label\": \"Tidy notes and fix gaps\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Sunday Sun Apr 11 2027 11:34:39 GMT-0400 (Eastern Daylight Time).\n\nUpcoming deadlines:\n- CS 251 Group Presentation: Tue Apr 13 2027 23:59:00 GMT-0400 (Eastern Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-04-05: 3 sessions, 69 focused min, avg score 83\n- 2027-04-06: 4 sessions, 95 focused min, avg score 66\n- 2027-04-07: 3 sessions, 77 focused min, avg score 74\n- 2027-04-08: 4 sessions, 107 focused min, avg score 84\n- 2027-04-09: 3 sessions, 84 focused min, avg score 72\n- 2027-04-10: 2 sessions, 64 focused min, avg score 57\n- 2027-04-11: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"CS 251 Group Presentation is due on Tuesday, so that's our first stop. I sized the blocks to fit how you've been studying. I'll be cheering for you the whole way!\", \"blocks\": [{\"day\": 0, \"time\": \"13:00\", \"minutes\": 50, \"label\": \"CS 251 Group Presentation: build the slides\"}, {\"day\": 0, \"time\": \"14:45\", \"minutes\": 50, \"label\": \"Quick recap of CS 251 notes\"}, {\"day\": 1, \"time\": \"08:30\", \"minutes\": 50, \"label\": \"CS 251 Group Presentation: build the slides (part 3)\"}, {\"day\": 1, \"time\": \"10:00\", \"minutes\": 50, \"label\": \"Light CS 251 review: linked lists\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Wednesday Wed Apr 14 2027 14:05:41 GMT-0500 (Central Daylight Time).\n\nUpcoming deadlines:\n- ECON 251 Group Project Part 1: Sat Apr 17 2027 11:59:00 GMT-0500 (Central Daylight Time)\n- CHEM 201 Discussion Post 3: Sun Apr 25 2027 23:59:00 GMT-0500 (Central Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-04-08: 2 sessions, 69 focused min, avg score 64\n- 2027-04-09: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-10: 4 sessions, 121 focused min, avg score 65\n- 2027-04-11: 2 sessions, 59 focused min, avg score 85\n- 2027-04-12: 3 sessions, 97 focused min, avg score 58\n- 2027-04-13: 2 sessions, 65 focused min, avg score 75\n- 2027-04-14: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 30-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"ECON 251 Group Project Part 1 is due on Saturday, so I'm putting it first. It matches the steady pace you've had lately.\", \"blocks\": [{\"day\": 3, \"time\": \"16:00\", \"minutes\": 60, \"label\": \"ECON 251 Group Project Part 1: build the next milestone\"}, {\"day\": 3, \"time\": \"18:00\", \"minutes\": 30, \"label\": \"Head start on CHEM 201 Discussion Post 3: skim the material\"}, {\"day\": 4, \"time\": \"16:30\", \"minutes\": 90, \"label\": \"ECON 251 Group Project Part 1: build the next milestone (part 2)\"}, {\"day\": 5, \"time\": \"13:30\", \"minutes\": 30, \"label\": \"ECON 251 Group Project Part 1: test and clean up\"}, {\"day\": 5, \"time\": \"15:30\", \"minutes\": 30, \"label\": \"Head start on CHEM 201 Discussion Post 3: review kinetics\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Sunday Sun Feb 28 2027 07:57:41 GMT-0800 (Pacific Standard Time).\n\nUpcoming deadlines:\n- (no upcoming deadlines found)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-02-22: 1 sessions, 15 focused min, avg score 50\n- 2027-02-23: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-24: 1 sessions, 22 focused min, avg score 58\n- 2027-02-25: 1 sessions, 14 focused min, avg score 52\n- 2027-02-26: 1 sessions, 20 focused min, avg score 41\n- 2027-02-27: 2 sessions, 17 focused min, avg score 69\n- 2027-02-28: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"No deadlines in sight, so let's use the time to get ahead gently. Last week was pretty quiet, so I kept the plan small and doable. I'll be cheering for you the whole way!\", \"blocks\": [{\"day\": 0, \"time\": \"09:15\", \"minutes\": 50, \"label\": \"Light revision: summarize key ideas\"}, {\"day\": 1, \"time\": \"10:00\", \"minutes\": 50, \"label\": \"Review this week's lecture notes\"}, {\"day\": 2, \"time\": \"09:00\", \"minutes\": 100, \"label\": \"Plan next week's study goals\"}]}"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student just finished a focus session of 125 minutes (5 pomodoros). Write one short, kind session-complete nudge (max 60 characters)."}, {"role": "assistant", "content": "session complete! you were amazing today 🎉"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Tuesday Tue Oct 06 2026 21:37:09 GMT-0600 (Mountain Daylight Time).\n\nUpcoming deadlines:\n- SOC 100 Project 3: Fri Oct 09 2026 23:59:00 GMT-0600 (Mountain Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-09-30: 3 sessions, 83 focused min, avg score 75\n- 2026-10-01: 4 sessions, 120 focused min, avg score 64\n- 2026-10-02: 2 sessions, 57 focused min, avg score 65\n- 2026-10-03: 3 sessions, 82 focused min, avg score 60\n- 2026-10-04: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-05: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-06: 1 sessions, 27 focused min, avg score 77\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"First up is SOC 100 Project 3, due on Friday. I sized the blocks to fit how you've been studying. You've got this!\", \"blocks\": [{\"day\": 3, \"time\": \"18:00\", \"minutes\": 25, \"label\": \"Light SOC 100 review: key concepts\"}, {\"day\": 3, \"time\": \"19:30\", \"minutes\": 75, \"label\": \"SOC 100 Project 3: build the next milestone\"}, {\"day\": 4, \"time\": \"17:30\", \"minutes\": 75, \"label\": \"SOC 100 Project 3: test and clean up\"}]}"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student just came back to their study app after 3 minutes away. Write one short, kind welcome-back nudge (max 60 characters)."}, {"role": "assistant", "content": "so happy you're here again 💛"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Friday Fri Mar 19 2027 15:00:22 GMT-0400 (Eastern Daylight Time).\n\nUpcoming deadlines:\n- ECON 251 Online Quiz 2: Wed Mar 24 2027 14:00:00 GMT-0400 (Eastern Daylight Time)\n- STAT 350 Final Exam (EXAM): Sun Mar 28 2027 14:00:00 GMT-0400 (Eastern Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-03-13: 1 sessions, 33 focused min, avg score 63\n- 2027-03-14: 2 sessions, 49 focused min, avg score 52\n- 2027-03-15: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-16: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-17: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-18: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-19: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 30-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"ECON 251 Online Quiz 2 is due on Wednesday, so that's our first stop. Your focus time was light lately, so I'm not piling on too much.\", \"blocks\": [{\"day\": 5, \"time\": \"16:15\", \"minutes\": 30, \"label\": \"ECON 251 Online Quiz 2: review key ideas\"}, {\"day\": 6, \"time\": \"13:15\", \"minutes\": 30, \"label\": \"ECON 251 Online Quiz 2: quick practice quiz\"}, {\"day\": 0, \"time\": \"15:00\", \"minutes\": 30, \"label\": \"Head start on STAT 350 Final Exam: skim the material\"}, {\"day\": 1, \"time\": \"16:00\", \"minutes\": 30, \"label\": \"Head start on STAT 350 Final Exam: review hypothesis tests\"}, {\"day\": 2, \"time\": \"15:00\", \"minutes\": 30, \"label\": \"Head start on STAT 350 Final Exam: outline the main parts\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Thursday Thu Nov 05 2026 19:38:54 GMT-0600 (Central Standard Time).\n\nUpcoming deadlines:\n- ENGL 106 Midterm 1 (EXAM): Sat Nov 07 2026 10:00:00 GMT-0600 (Central Standard Time)\n- HIST 110 Essay 2: Sun Nov 08 2026 14:00:00 GMT-0600 (Central Standard Time)\n- MA 261 Project Milestone 2: Sun Nov 08 2026 23:59:00 GMT-0600 (Central Standard Time)\n- CS 180 Homework 7: Tue Nov 10 2026 11:59:00 GMT-0600 (Central Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-10-30: 5 sessions, 141 focused min, avg score 74\n- 2026-10-31: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-01: 6 sessions, 206 focused min, avg score 80\n- 2026-11-02: 6 sessions, 172 focused min, avg score 86\n- 2026-11-03: 7 sessions, 187 focused min, avg score 93\n- 2026-11-04: 4 sessions, 119 focused min, avg score 89\n- 2026-11-05: 1 sessions, 17 focused min, avg score 71\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"ENGL 106 Midterm 1 is on Saturday, so I put it at the front of the plan. There's a lot coming up, so I put the nearest ones first and kept each day doable. Take your breaks too, I'll be right here.\", \"blocks\": [{\"day\": 4, \"time\": \"20:15\", \"minutes\": 50, \"label\": \"ENGL 106 exam prep: review notes on close reading\"}, {\"day\": 5, \"time\": \"20:15\", \"minutes\": 100, \"label\": \"ENGL 106: mock exam, then fix mistakes\"}, {\"day\": 1, \"time\": \"19:15\", \"minutes\": 100, \"label\": \"CS 180 Homework 7: work through the problems\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Friday Fri Oct 23 2026 14:38:10 GMT-0500 (Central Daylight Time).\n\nUpcoming deadlines:\n- SOC 100 Quiz 3: Sat Oct 24 2026 09:00:00 GMT-0500 (Central Daylight Time)\n- CHEM 201 Midterm (EXAM): Sat Oct 24 2026 13:00:00 GMT-0500 (Central Daylight Time)\n- ECON 251 Lab Report 2: Sat Oct 24 2026 14:00:00 GMT-0500 (Central Daylight Time)\n- ENGL 106 Problem Set 3: Sat Oct 24 2026 14:00:00 GMT-0500 (Central Daylight Time)\n- PHYS 172 Exam 3 (EXAM): Sun Oct 25 2026 11:00:00 GMT-0500 (Central Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-10-17: 2 sessions, 48 focused min, avg score 64\n- 2026-10-18: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-19: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-20: 3 sessions, 48 focused min, avg score 56\n- 2026-10-21: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-22: 3 sessions, 77 focused min, avg score 40\n- 2026-10-23: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your CHEM 201 Midterm is tomorrow, so it gets the first and biggest blocks. There's a lot coming up, so I put the nearest ones first and kept each day doable. I'll be cheering for you the whole way!\", \"blocks\": [{\"day\": 5, \"time\": \"16:15\", \"minutes\": 50, \"label\": \"CHEM 201: skim slides and equilibrium\"}, {\"day\": 5, \"time\": \"18:00\", \"minutes\": 50, \"label\": \"CHEM 201: flashcards and short review\"}, {\"day\": 5, \"time\": \"19:45\", \"minutes\": 50, \"label\": \"Light CHEM 201 review: equilibrium\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Saturday Sat Jan 09 2027 17:42:23 GMT-0800 (Pacific Standard Time).\n\nUpcoming deadlines:\n- CHEM 201 Project 3: Wed Jan 13 2027 23:59:00 GMT-0800 (Pacific Standard Time)\n- PSY 120 Quiz 3: Sun Jan 17 2027 17:00:00 GMT-0800 (Pacific Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-01-03: 1 sessions, 16 focused min, avg score 42\n- 2027-01-04: 0 sessions, 0 focused min, avg score n/a\n- 2027-01-05: 0 sessions, 0 focused min, avg score n/a\n- 2027-01-06: 0 sessions, 0 focused min, avg score n/a\n- 2027-01-07: 0 sessions, 0 focused min, avg score n/a\n- 2027-01-08: 0 sessions, 0 focused min, avg score n/a\n- 2027-01-09: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 45-minute pomodoros with 15-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"First up is CHEM 201 Project 3, due on Wednesday. Your focus time was light lately, so I'm not piling on too much. Bloop believes in you!\", \"blocks\": [{\"day\": 6, \"time\": \"18:30\", \"minutes\": 45, \"label\": \"CHEM 201 Project 3: build the next milestone\"}, {\"day\": 0, \"time\": \"19:30\", \"minutes\": 45, \"label\": \"CHEM 201 Project 3: build the next milestone (part 2)\"}, {\"day\": 1, \"time\": \"19:30\", \"minutes\": 45, \"label\": \"CHEM 201 Project 3: test and clean up\"}, {\"day\": 2, \"time\": \"18:45\", \"minutes\": 45, \"label\": \"Head start on PSY 120 Quiz 3: skim the material\"}, {\"day\": 3, \"time\": \"19:30\", \"minutes\": 45, \"label\": \"Head start on PSY 120 Quiz 3: review memory models\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Monday Mon Apr 12 2027 19:36:30 GMT-0400 (Eastern Daylight Time).\n\nUpcoming deadlines:\n- CS 251 Group Presentation: Wed Apr 14 2027 11:59:00 GMT-0400 (Eastern Daylight Time)\n- ART 120 Essay Draft: Fri Apr 16 2027 11:59:00 GMT-0400 (Eastern Daylight Time)\n- HIST 110 Group Project Part 1: Sat Apr 17 2027 23:59:00 GMT-0400 (Eastern Daylight Time)\n- BIO 110 Quiz 3: Tue Apr 20 2027 23:59:00 GMT-0400 (Eastern Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-04-06: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-07: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-08: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-09: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-10: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-11: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-12: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"You've got 3 things coming up, so I lined them up by what's closest, starting with CS 251 Group Presentation. There's a lot coming up, so I put the nearest ones first and kept each day doable. Take your breaks too, I'll be right here.\", \"blocks\": [{\"day\": 1, \"time\": \"21:00\", \"minutes\": 50, \"label\": \"CS 251 Group Presentation: build the slides\"}, {\"day\": 2, \"time\": \"19:30\", \"minutes\": 50, \"label\": \"CS 251 Group Presentation: practice the talk out loud\"}, {\"day\": 4, \"time\": \"17:30\", \"minutes\": 50, \"label\": \"ART 120 Essay Draft: outline and draft\"}, {\"day\": 6, \"time\": \"18:15\", \"minutes\": 50, \"label\": \"Head start on BIO 110 Quiz 3: skim the material\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Monday Mon Dec 28 2026 20:57:43 GMT-0800 (Pacific Standard Time).\n\nUpcoming deadlines:\n- PHYS 172 Exam 3 (EXAM): Fri Jan 01 2027 17:00:00 GMT-0800 (Pacific Standard Time)\n- STAT 350 Midterm 2 (EXAM): Mon Jan 04 2027 15:30:00 GMT-0800 (Pacific Standard Time)\n- HIST 110 Quiz 3: Tue Jan 05 2027 14:00:00 GMT-0800 (Pacific Standard Time)\n- CS 251 Group Presentation: Wed Jan 06 2027 09:00:00 GMT-0800 (Pacific Standard Time)\n- CHEM 201 Online Quiz 2: Thu Jan 07 2027 09:00:00 GMT-0800 (Pacific Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-12-22: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-23: 1 sessions, 14 focused min, avg score 52\n- 2026-12-24: 1 sessions, 23 focused min, avg score 50\n- 2026-12-25: 2 sessions, 41 focused min, avg score 56\n- 2026-12-26: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-27: 1 sessions, 16 focused min, avg score 59\n- 2026-12-28: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"PHYS 172 Exam 3 is on Friday, so I put it at the front of the plan. Last week was pretty quiet, so I kept the plan small and doable. Bloop believes in you!\", \"blocks\": [{\"day\": 1, \"time\": \"21:30\", \"minutes\": 25, \"label\": \"PHYS 172: skim slides and circuits\"}, {\"day\": 2, \"time\": \"19:45\", \"minutes\": 25, \"label\": \"PHYS 172: practice problems on waves\"}, {\"day\": 3, \"time\": \"18:00\", \"minutes\": 25, \"label\": \"PHYS 172 drills: waves\"}, {\"day\": 4, \"time\": \"18:15\", \"minutes\": 25, \"label\": \"Last look at PHYS 172: Newton's laws\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Friday Fri Feb 26 2027 07:56:32 GMT-0800 (Pacific Standard Time).\n\nUpcoming deadlines:\n- STAT 350 Project Milestone 2: Tue Mar 02 2027 11:59:00 GMT-0800 (Pacific Standard Time)\n- CS 180 Exam 3 (EXAM): Tue Mar 02 2027 18:30:00 GMT-0800 (Pacific Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-02-20: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-21: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-22: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-23: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-24: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-25: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-26: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your CS 180 Exam 3 is on Tuesday, so let's start there. This is a fresh start, so the blocks stay gentle.\", \"blocks\": [{\"day\": 5, \"time\": \"09:30\", \"minutes\": 50, \"label\": \"Start CS 180 exam review: functions\"}, {\"day\": 6, \"time\": \"10:45\", \"minutes\": 50, \"label\": \"CS 180: practice problems on Python loops\"}, {\"day\": 0, \"time\": \"10:15\", \"minutes\": 50, \"label\": \"Last look at CS 180: file I/O\"}, {\"day\": 1, \"time\": \"09:00\", \"minutes\": 50, \"label\": \"STAT 350 Project Milestone 2\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Thursday Thu Sep 03 2026 08:07:32 GMT-0500 (Central Daylight Time).\n\nUpcoming deadlines:\n- (no upcoming deadlines found)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-08-28: 0 sessions, 0 focused min, avg score n/a\n- 2026-08-29: 0 sessions, 0 focused min, avg score n/a\n- 2026-08-30: 0 sessions, 0 focused min, avg score n/a\n- 2026-08-31: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-01: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-02: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-03: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"No deadlines in sight, so let's use the time to get ahead gently. This is a fresh start, so the blocks stay gentle. Take your breaks too, I'll be right here.\", \"blocks\": [{\"day\": 4, \"time\": \"09:00\", \"minutes\": 50, \"label\": \"Make flashcards from class notes\"}, {\"day\": 5, \"time\": \"09:00\", \"minutes\": 100, \"label\": \"Get ahead on upcoming readings\"}, {\"day\": 6, \"time\": \"08:30\", \"minutes\": 100, \"label\": \"Review this week's lecture notes\"}]}"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student just finished a 50-minute focus block and a 10-minute break is starting. Write one short, kind break-time nudge (max 60 characters)."}, {"role": "assistant", "content": "great focus! now go grab a snack 🍎"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Wednesday Wed Mar 24 2027 21:23:05 GMT-0500 (Central Daylight Time).\n\nUpcoming deadlines:\n- CS 251 Lab Report 2: Thu Mar 25 2027 23:59:00 GMT-0500 (Central Daylight Time)\n- BIO 110 Presentation: Thu Mar 25 2027 23:59:00 GMT-0500 (Central Daylight Time)\n- STAT 350 Midterm 1 (EXAM): Fri Mar 26 2027 13:00:00 GMT-0500 (Central Daylight Time)\n- PHYS 172 Exam 3 (EXAM): Fri Mar 26 2027 19:00:00 GMT-0500 (Central Daylight Time)\n- CS 180 Group Presentation: Sun Mar 28 2027 23:59:00 GMT-0500 (Central Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-03-18: 3 sessions, 93 focused min, avg score 71\n- 2027-03-19: 2 sessions, 64 focused min, avg score 65\n- 2027-03-20: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-21: 2 sessions, 48 focused min, avg score 65\n- 2027-03-22: 3 sessions, 72 focused min, avg score 68\n- 2027-03-23: 3 sessions, 83 focused min, avg score 57\n- 2027-03-24: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your STAT 350 Midterm 1 is on Friday, so let's start there. I focused on the closest deadlines first and kept the load realistic. One pomodoro at a time, and you'll get there.\", \"blocks\": [{\"day\": 4, \"time\": \"20:00\", \"minutes\": 75, \"label\": \"Start STAT 350 exam review: confidence intervals\"}, {\"day\": 6, \"time\": \"19:30\", \"minutes\": 75, \"label\": \"CS 180 Group Presentation: build the slides\"}, {\"day\": 0, \"time\": \"18:45\", \"minutes\": 25, \"label\": \"STAT 350: flashcards and short review\"}]}"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student just came back to their study app after 10 minutes away. Write one short, kind welcome-back nudge (max 60 characters)."}, {"role": "assistant", "content": "reset done. now let's get studying"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Thursday Thu Feb 25 2027 20:35:33 GMT-0700 (Mountain Standard Time).\n\nUpcoming deadlines:\n- PSY 120 Project 3: Sun Feb 28 2027 23:59:00 GMT-0700 (Mountain Standard Time)\n- BIO 110 Quiz 4: Mon Mar 01 2027 11:59:00 GMT-0700 (Mountain Standard Time)\n- ART 120 Final Exam (EXAM): Sat Mar 06 2027 14:00:00 GMT-0700 (Mountain Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-02-19: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-20: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-21: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-22: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-23: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-24: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-25: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 45-minute pomodoros with 15-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"PSY 120 Project 3 is due on Sunday, so I'm putting it first. I don't see any focus history yet, so I kept the sessions short and easy. Blocks are built from 45-minute pomodoros with 15-minute breaks.\", \"blocks\": [{\"day\": 5, \"time\": \"18:00\", \"minutes\": 45, \"label\": \"PSY 120 Project 3: build the next milestone\"}, {\"day\": 6, \"time\": \"19:15\", \"minutes\": 45, \"label\": \"PSY 120 Project 3: test and clean up\"}, {\"day\": 0, \"time\": \"19:15\", \"minutes\": 45, \"label\": \"BIO 110 Quiz 4: review key ideas\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Tuesday Tue Aug 25 2026 10:44:11 GMT-0400 (Eastern Daylight Time).\n\nUpcoming deadlines:\n- CHEM 201 Midterm (EXAM): Sat Aug 29 2026 17:00:00 GMT-0400 (Eastern Daylight Time)\n- ECON 251 Lab Report 2: Sat Aug 29 2026 23:59:00 GMT-0400 (Eastern Daylight Time)\n- CS 251 Exam 2 (EXAM): Tue Sep 01 2026 13:00:00 GMT-0400 (Eastern Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-08-19: 0 sessions, 0 focused min, avg score n/a\n- 2026-08-20: 3 sessions, 62 focused min, avg score 65\n- 2026-08-21: 0 sessions, 0 focused min, avg score n/a\n- 2026-08-22: 0 sessions, 0 focused min, avg score n/a\n- 2026-08-23: 0 sessions, 0 focused min, avg score n/a\n- 2026-08-24: 0 sessions, 0 focused min, avg score n/a\n- 2026-08-25: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"CHEM 201 Midterm is on Saturday, so I put it at the front of the plan. I focused on the closest deadlines first and kept the load realistic. I'll be cheering for you the whole way!\", \"blocks\": [{\"day\": 2, \"time\": \"11:45\", \"minutes\": 50, \"label\": \"CHEM 201: skim slides and acid-base titrations\"}, {\"day\": 3, \"time\": \"10:00\", \"minutes\": 50, \"label\": \"CHEM 201: practice problems on equilibrium\"}, {\"day\": 4, \"time\": \"09:30\", \"minutes\": 50, \"label\": \"CHEM 201: mock exam, then fix mistakes\"}, {\"day\": 5, \"time\": \"10:00\", \"minutes\": 50, \"label\": \"Head start on CS 251 Exam 2: skim the material\"}, {\"day\": 6, \"time\": \"09:30\", \"minutes\": 50, \"label\": \"Head start on CS 251 Exam 2: review Big-O analysis\"}]}"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student just came back to their study app after 25 minutes away. Write one short, kind welcome-back nudge (max 60 characters)."}, {"role": "assistant", "content": "ready when you are, i'm right here"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Sunday Sun Apr 11 2027 19:39:26 GMT-0400 (Eastern Daylight Time).\n\nUpcoming deadlines:\n- SOC 100 Midterm 1 (EXAM): Sat Apr 17 2027 18:30:00 GMT-0400 (Eastern Daylight Time)\n- ART 120 Group Project Part 1: Sat Apr 17 2027 23:59:00 GMT-0400 (Eastern Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-04-05: 5 sessions, 128 focused min, avg score 76\n- 2027-04-06: 5 sessions, 156 focused min, avg score 82\n- 2027-04-07: 7 sessions, 248 focused min, avg score 85\n- 2027-04-08: 6 sessions, 186 focused min, avg score 75\n- 2027-04-09: 5 sessions, 195 focused min, avg score 92\n- 2027-04-10: 4 sessions, 130 focused min, avg score 83\n- 2027-04-11: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your SOC 100 Midterm 1 is on Saturday, so it gets the first and biggest blocks. Great focus lately, so I added a little extra study time. Take your breaks too, I'll be right here.\", \"blocks\": [{\"day\": 0, \"time\": \"20:30\", \"minutes\": 50, \"label\": \"Start SOC 100 exam review: case studies\"}, {\"day\": 1, \"time\": \"18:30\", \"minutes\": 25, \"label\": \"SOC 100: practice problems on key concepts\"}, {\"day\": 1, \"time\": \"20:30\", \"minutes\": 50, \"label\": \"ART 120 Group Project Part 1\"}, {\"day\": 2, \"time\": \"20:00\", \"minutes\": 25, \"label\": \"SOC 100 drills: key concepts\"}, {\"day\": 3, \"time\": \"19:15\", \"minutes\": 50, \"label\": \"Last look at SOC 100: survey methods\"}]}"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student's 15-minute break is over and the next 25-minute focus block is starting. Write one short, kind back-to-work nudge (max 60 characters)."}, {"role": "assistant", "content": "easy start: just open your notes and go"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student's 10-minute break is over and the next 25-minute focus block is starting. Write one short, kind back-to-work nudge (max 60 characters)."}, {"role": "assistant", "content": "start with the easiest bit, then build up"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Tuesday Tue Dec 29 2026 21:04:35 GMT-0800 (Pacific Standard Time).\n\nUpcoming deadlines:\n- CS 251 Midterm 1 (EXAM): Fri Jan 01 2027 15:30:00 GMT-0800 (Pacific Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-12-23: 4 sessions, 101 focused min, avg score 75\n- 2026-12-24: 4 sessions, 101 focused min, avg score 74\n- 2026-12-25: 2 sessions, 52 focused min, avg score 80\n- 2026-12-26: 3 sessions, 90 focused min, avg score 71\n- 2026-12-27: 4 sessions, 91 focused min, avg score 75\n- 2026-12-28: 3 sessions, 73 focused min, avg score 77\n- 2026-12-29: 1 sessions, 24 focused min, avg score 68\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your CS 251 Midterm 1 is on Friday, so let's start there. I sized the blocks to fit how you've been studying. You've got this!\", \"blocks\": [{\"day\": 3, \"time\": \"18:30\", \"minutes\": 50, \"label\": \"Light CS 251 review: Big-O analysis\"}, {\"day\": 3, \"time\": \"20:20\", \"minutes\": 100, \"label\": \"CS 251: practice problems on linked lists\"}, {\"day\": 4, \"time\": \"19:00\", \"minutes\": 100, \"label\": \"Last look at CS 251: hash tables\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Monday Mon Dec 14 2026 12:10:32 GMT-0800 (Pacific Standard Time).\n\nUpcoming deadlines:\n- CHEM 201 Group Project Part 1: Sat Dec 19 2026 09:00:00 GMT-0800 (Pacific Standard Time)\n- CS 251 Quiz 3: Mon Dec 21 2026 23:59:00 GMT-0800 (Pacific Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-12-08: 2 sessions, 31 focused min, avg score 69\n- 2026-12-09: 2 sessions, 31 focused min, avg score 48\n- 2026-12-10: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-11: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-12: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-13: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-14: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"First up is CHEM 201 Group Project Part 1, due on Saturday. Last week was pretty quiet, so I kept the plan small and doable. You've got this!\", \"blocks\": [{\"day\": 1, \"time\": \"13:30\", \"minutes\": 25, \"label\": \"CHEM 201 Group Project Part 1: build the next milestone\"}, {\"day\": 2, \"time\": \"14:30\", \"minutes\": 25, \"label\": \"CHEM 201 Group Project Part 1: build the next milestone (part 2)\"}, {\"day\": 3, \"time\": \"13:45\", \"minutes\": 25, \"label\": \"CHEM 201 Group Project Part 1: build the next milestone (part 3)\"}, {\"day\": 4, \"time\": \"13:15\", \"minutes\": 25, \"label\": \"CHEM 201 Group Project Part 1: build the next milestone (part 4)\"}, {\"day\": 5, \"time\": \"13:00\", \"minutes\": 25, \"label\": \"CHEM 201 Group Project Part 1: test and clean up\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Tuesday Tue May 04 2027 14:25:35 GMT-0500 (Central Daylight Time).\n\nUpcoming deadlines:\n- PHYS 172 Exam 2 (EXAM): Thu May 06 2027 09:00:00 GMT-0500 (Central Daylight Time)\n- PSY 120 Exam 2 (EXAM): Fri May 07 2027 18:30:00 GMT-0500 (Central Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-04-28: 3 sessions, 89 focused min, avg score 56\n- 2027-04-29: 4 sessions, 137 focused min, avg score 55\n- 2027-04-30: 3 sessions, 103 focused min, avg score 71\n- 2027-05-01: 3 sessions, 94 focused min, avg score 70\n- 2027-05-02: 4 sessions, 95 focused min, avg score 59\n- 2027-05-03: 0 sessions, 0 focused min, avg score n/a\n- 2027-05-04: 1 sessions, 17 focused min, avg score 84\n\nThe student uses 30-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your PHYS 172 Exam 2 is on Thursday, so it gets the first and biggest blocks. I sized the blocks to fit how you've been studying. One pomodoro at a time, and you'll get there.\", \"blocks\": [{\"day\": 2, \"time\": \"15:45\", \"minutes\": 30, \"label\": \"PHYS 172: flashcards and short review\"}, {\"day\": 2, \"time\": \"17:00\", \"minutes\": 90, \"label\": \"PHYS 172: practice problems on Newton's laws\"}, {\"day\": 2, \"time\": \"19:15\", \"minutes\": 30, \"label\": \"PSY 120: skim slides and memory models\"}, {\"day\": 3, \"time\": \"14:45\", \"minutes\": 60, \"label\": \"Last look at PHYS 172: energy conservation\"}, {\"day\": 3, \"time\": \"16:45\", \"minutes\": 60, \"label\": \"PSY 120 final recap: key ideas and weak spots\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Monday Mon Sep 14 2026 15:20:36 GMT-0700 (Pacific Daylight Time).\n\nUpcoming deadlines:\n- MA 261 Reading Response 4: Fri Sep 18 2026 14:00:00 GMT-0700 (Pacific Daylight Time)\n- ENGL 106 Final Exam (EXAM): Fri Sep 18 2026 14:00:00 GMT-0700 (Pacific Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-09-08: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-09: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-10: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-11: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-12: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-13: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-14: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 30-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your ENGL 106 Final Exam is on Friday, so it gets the first and biggest blocks. There's a lot coming up, so I put the nearest ones first and kept each day doable. You've got this!\", \"blocks\": [{\"day\": 1, \"time\": \"16:45\", \"minutes\": 30, \"label\": \"Start ENGL 106 exam review: thesis statements\"}, {\"day\": 2, \"time\": \"13:30\", \"minutes\": 30, \"label\": \"ENGL 106: practice problems on citations\"}, {\"day\": 3, \"time\": \"16:15\", \"minutes\": 30, \"label\": \"ENGL 106 drills: citations\"}, {\"day\": 4, \"time\": \"14:30\", \"minutes\": 30, \"label\": \"ENGL 106 final recap: key ideas and weak spots\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Thursday Thu Jan 14 2027 13:47:55 GMT-0600 (Central Standard Time).\n\nUpcoming deadlines:\n- SOC 100 Reading Response 4: Sun Jan 17 2027 09:00:00 GMT-0600 (Central Standard Time)\n- PHYS 172 Midterm 2 (EXAM): Wed Jan 20 2027 18:30:00 GMT-0600 (Central Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-01-08: 2 sessions, 35 focused min, avg score 39\n- 2027-01-09: 0 sessions, 0 focused min, avg score n/a\n- 2027-01-10: 0 sessions, 0 focused min, avg score n/a\n- 2027-01-11: 1 sessions, 24 focused min, avg score 69\n- 2027-01-12: 1 sessions, 11 focused min, avg score 53\n- 2027-01-13: 2 sessions, 48 focused min, avg score 49\n- 2027-01-14: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 45-minute pomodoros with 15-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your PHYS 172 Midterm 2 is on Wednesday, so let's start there. I focused on the closest deadlines first and kept the load realistic. Bloop believes in you!\", \"blocks\": [{\"day\": 4, \"time\": \"15:15\", \"minutes\": 45, \"label\": \"PHYS 172: skim slides and waves\"}, {\"day\": 5, \"time\": \"14:30\", \"minutes\": 45, \"label\": \"PHYS 172: practice problems on energy conservation\"}, {\"day\": 6, \"time\": \"15:00\", \"minutes\": 45, \"label\": \"PHYS 172 drills: energy conservation\"}, {\"day\": 1, \"time\": \"16:00\", \"minutes\": 45, \"label\": \"Last look at PHYS 172: circuits\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Friday Fri Oct 16 2026 16:16:50 GMT-0400 (Eastern Daylight Time).\n\nUpcoming deadlines:\n- PSY 120 Presentation: Sun Oct 18 2026 23:59:00 GMT-0400 (Eastern Daylight Time)\n- ECON 251 Midterm 1 (EXAM): Mon Oct 26 2026 10:00:00 GMT-0400 (Eastern Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-10-10: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-11: 2 sessions, 33 focused min, avg score 74\n- 2026-10-12: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-13: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-14: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-15: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-16: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"PSY 120 Presentation is due on Sunday, so I'm putting it first. Last week was a bit stop-and-go, so I kept the plan small and doable. You've got this!\", \"blocks\": [{\"day\": 5, \"time\": \"17:30\", \"minutes\": 50, \"label\": \"PSY 120 Presentation: build the slides\"}, {\"day\": 6, \"time\": \"15:45\", \"minutes\": 50, \"label\": \"PSY 120 Presentation: practice the talk out loud\"}, {\"day\": 0, \"time\": \"14:00\", \"minutes\": 50, \"label\": \"Head start on ECON 251 Midterm 1: skim the material\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Friday Fri Dec 04 2026 09:46:44 GMT-0600 (Central Standard Time).\n\nUpcoming deadlines:\n- CHEM 201 Exam 1 (EXAM): Sun Dec 06 2026 15:30:00 GMT-0600 (Central Standard Time)\n- PHYS 172 Online Quiz 2: Mon Dec 07 2026 23:59:00 GMT-0600 (Central Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-11-28: 4 sessions, 141 focused min, avg score 71\n- 2026-11-29: 7 sessions, 254 focused min, avg score 89\n- 2026-11-30: 5 sessions, 129 focused min, avg score 92\n- 2026-12-01: 4 sessions, 157 focused min, avg score 96\n- 2026-12-02: 7 sessions, 198 focused min, avg score 84\n- 2026-12-03: 5 sessions, 152 focused min, avg score 73\n- 2026-12-04: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your CHEM 201 Exam 1 is on Sunday, so it gets the first and biggest blocks. Great focus lately, so I added a little extra study time. Bloop believes in you!\", \"blocks\": [{\"day\": 5, \"time\": \"11:00\", \"minutes\": 50, \"label\": \"CHEM 201 exam prep: review notes on thermodynamics\"}, {\"day\": 5, \"time\": \"13:30\", \"minutes\": 75, \"label\": \"CHEM 201: practice problems on equilibrium\"}, {\"day\": 5, \"time\": \"16:15\", \"minutes\": 50, \"label\": \"PHYS 172 Online Quiz 2: review key ideas\"}, {\"day\": 6, \"time\": \"08:30\", \"minutes\": 25, \"label\": \"CHEM 201 drills: equilibrium\"}, {\"day\": 6, \"time\": \"09:45\", \"minutes\": 75, \"label\": \"CHEM 201: mock exam, then fix mistakes\"}, {\"day\": 6, \"time\": \"11:45\", \"minutes\": 25, \"label\": \"PHYS 172 Online Quiz 2: quick practice quiz\"}]}"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student's 5-minute break is over and the next 45-minute focus block is starting. Write one short, kind back-to-work nudge (max 60 characters)."}, {"role": "assistant", "content": "back to work, i'll cheer from the corner"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student just came back to their study app after 2 minutes away. Write one short, kind welcome-back nudge (max 60 characters)."}, {"role": "assistant", "content": "hi again! let's get cozy and focus"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Tuesday Tue May 04 2027 11:44:11 GMT-0500 (Central Daylight Time).\n\nUpcoming deadlines:\n- STAT 350 Exam 2 (EXAM): Thu May 13 2027 18:30:00 GMT-0500 (Central Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-04-28: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-29: 2 sessions, 33 focused min, avg score 67\n- 2027-04-30: 0 sessions, 0 focused min, avg score n/a\n- 2027-05-01: 0 sessions, 0 focused min, avg score n/a\n- 2027-05-02: 0 sessions, 0 focused min, avg score n/a\n- 2027-05-03: 0 sessions, 0 focused min, avg score n/a\n- 2027-05-04: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"STAT 350 Exam 2 is in 9 days, so I put it at the front of the plan. Last week was a bit stop-and-go, so I kept the plan small and doable. Take your breaks too, I'll be right here.\", \"blocks\": [{\"day\": 2, \"time\": \"13:00\", \"minutes\": 50, \"label\": \"Head start on STAT 350 Exam 2: skim the material\"}, {\"day\": 3, \"time\": \"10:45\", \"minutes\": 50, \"label\": \"Head start on STAT 350 Exam 2: review regression\"}, {\"day\": 4, \"time\": \"08:30\", \"minutes\": 50, \"label\": \"Head start on STAT 350 Exam 2: outline the main parts\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Sunday Sun Mar 21 2027 13:12:21 GMT+0000 (Greenwich Mean Time).\n\nUpcoming deadlines:\n- MA 165 Problem Set 3: Wed Mar 24 2027 14:00:00 GMT+0000 (Greenwich Mean Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-03-15: 2 sessions, 51 focused min, avg score 68\n- 2027-03-16: 3 sessions, 91 focused min, avg score 80\n- 2027-03-17: 3 sessions, 103 focused min, avg score 55\n- 2027-03-18: 3 sessions, 66 focused min, avg score 78\n- 2027-03-19: 3 sessions, 95 focused min, avg score 62\n- 2027-03-20: 4 sessions, 100 focused min, avg score 56\n- 2027-03-21: 1 sessions, 27 focused min, avg score 75\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"First up is MA 165 Problem Set 3, due on Wednesday. I sized the blocks to fit how you've been studying. You've got this!\", \"blocks\": [{\"day\": 0, \"time\": \"14:00\", \"minutes\": 50, \"label\": \"MA 165 Problem Set 3: work through the problems\"}, {\"day\": 1, \"time\": \"13:30\", \"minutes\": 50, \"label\": \"MA 165 Problem Set 3: work through the problems (part 2)\"}, {\"day\": 2, \"time\": \"15:30\", \"minutes\": 25, \"label\": \"MA 165: flashcards and short review\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Tuesday Tue Nov 10 2026 15:00:10 GMT-0500 (Eastern Standard Time).\n\nUpcoming deadlines:\n- (no upcoming deadlines found)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-11-04: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-05: 2 sessions, 54 focused min, avg score 48\n- 2026-11-06: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-07: 1 sessions, 19 focused min, avg score 74\n- 2026-11-08: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-09: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-10: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 45-minute pomodoros with 15-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"No deadlines in sight, so let's use the time to get ahead gently. Last week was a bit stop-and-go, so I kept the plan small and doable.\", \"blocks\": [{\"day\": 2, \"time\": \"15:45\", \"minutes\": 90, \"label\": \"Get ahead on upcoming readings\"}, {\"day\": 3, \"time\": \"13:45\", \"minutes\": 45, \"label\": \"Make flashcards from class notes\"}, {\"day\": 4, \"time\": \"13:30\", \"minutes\": 45, \"label\": \"Review this week's lecture notes\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Thursday Thu Oct 15 2026 14:09:40 GMT-0400 (Eastern Daylight Time).\n\nUpcoming deadlines:\n- STAT 350 Online Quiz 2: Sun Oct 18 2026 09:00:00 GMT-0400 (Eastern Daylight Time)\n- MA 165 Midterm 1 (EXAM): Mon Oct 19 2026 11:00:00 GMT-0400 (Eastern Daylight Time)\n- SOC 100 Problem Set 8: Sun Oct 25 2026 23:59:00 GMT-0400 (Eastern Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-10-09: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-10: 3 sessions, 54 focused min, avg score 69\n- 2026-10-11: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-12: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-13: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-14: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-15: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 45-minute pomodoros with 15-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your MA 165 Midterm 1 is on Monday, so it gets the first and biggest blocks. I focused on the closest deadlines first and kept the load realistic. You've got this!\", \"blocks\": [{\"day\": 4, \"time\": \"15:15\", \"minutes\": 45, \"label\": \"MA 165 exam prep: review notes on derivative rules\"}, {\"day\": 5, \"time\": \"16:30\", \"minutes\": 45, \"label\": \"MA 165: practice problems on related rates\"}, {\"day\": 6, \"time\": \"16:00\", \"minutes\": 45, \"label\": \"Last look at MA 165: limits\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Saturday Sat Aug 29 2026 08:50:26 GMT-0700 (Pacific Daylight Time).\n\nUpcoming deadlines:\n- CS 180 Project Milestone 2: Mon Sep 07 2026 23:59:00 GMT-0700 (Pacific Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-08-23: 0 sessions, 0 focused min, avg score n/a\n- 2026-08-24: 0 sessions, 0 focused min, avg score n/a\n- 2026-08-25: 0 sessions, 0 focused min, avg score n/a\n- 2026-08-26: 0 sessions, 0 focused min, avg score n/a\n- 2026-08-27: 0 sessions, 0 focused min, avg score n/a\n- 2026-08-28: 0 sessions, 0 focused min, avg score n/a\n- 2026-08-29: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"CS 180 Project Milestone 2 is due in 9 days, so that's our first stop. I don't see any focus history yet, so I kept the sessions short and easy. Bloop believes in you!\", \"blocks\": [{\"day\": 6, \"time\": \"10:00\", \"minutes\": 25, \"label\": \"Head start on CS 180 Project Milestone 2: skim the material\"}, {\"day\": 0, \"time\": \"08:30\", \"minutes\": 25, \"label\": \"Head start on CS 180 Project Milestone 2: review file I/O\"}, {\"day\": 1, \"time\": \"08:30\", \"minutes\": 25, \"label\": \"Light CS 180 review: file I/O\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Sunday Sun Nov 22 2026 11:40:04 GMT+0000 (Greenwich Mean Time).\n\nUpcoming deadlines:\n- (no upcoming deadlines found)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-11-16: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-17: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-18: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-19: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-20: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-21: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-22: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 45-minute pomodoros with 15-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Nothing is due soon, so this is a calm week to build a rhythm. I don't see any focus history yet, so I kept the sessions short and easy. Bloop believes in you!\", \"blocks\": [{\"day\": 0, \"time\": \"12:30\", \"minutes\": 90, \"label\": \"Review this week's lecture notes\"}, {\"day\": 1, \"time\": \"08:30\", \"minutes\": 45, \"label\": \"Plan next week's study goals\"}, {\"day\": 2, \"time\": \"10:45\", \"minutes\": 45, \"label\": \"Get ahead on upcoming readings\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Thursday Thu Apr 01 2027 09:29:14 GMT-0500 (Central Daylight Time).\n\nUpcoming deadlines:\n- (no upcoming deadlines found)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-03-26: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-27: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-28: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-29: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-30: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-31: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-01: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 45-minute pomodoros with 15-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"No deadlines in sight, so let's use the time to get ahead gently. This is a fresh start, so the blocks stay gentle. You've got this!\", \"blocks\": [{\"day\": 4, \"time\": \"10:30\", \"minutes\": 45, \"label\": \"Review this week's lecture notes\"}, {\"day\": 5, \"time\": \"10:15\", \"minutes\": 45, \"label\": \"Get ahead on upcoming readings\"}, {\"day\": 6, \"time\": \"09:00\", \"minutes\": 45, \"label\": \"Practice problems from class\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Wednesday Wed Jan 13 2027 16:43:02 GMT-0500 (Eastern Standard Time).\n\nUpcoming deadlines:\n- PHYS 172 Project Milestone 2: Sat Jan 16 2027 09:00:00 GMT-0500 (Eastern Standard Time)\n- SOC 100 Final Exam (EXAM): Mon Jan 18 2027 13:00:00 GMT-0500 (Eastern Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-01-07: 1 sessions, 10 focused min, avg score 49\n- 2027-01-08: 0 sessions, 0 focused min, avg score n/a\n- 2027-01-09: 0 sessions, 0 focused min, avg score n/a\n- 2027-01-10: 2 sessions, 33 focused min, avg score 53\n- 2027-01-11: 2 sessions, 25 focused min, avg score 53\n- 2027-01-12: 0 sessions, 0 focused min, avg score n/a\n- 2027-01-13: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your SOC 100 Final Exam is on Monday, so it gets the first and biggest blocks. I focused on the closest deadlines first and kept the load realistic. You've got this!\", \"blocks\": [{\"day\": 3, \"time\": \"17:45\", \"minutes\": 50, \"label\": \"Start SOC 100 exam review: survey methods\"}, {\"day\": 4, \"time\": \"14:00\", \"minutes\": 50, \"label\": \"SOC 100: practice problems on key concepts\"}, {\"day\": 5, \"time\": \"14:15\", \"minutes\": 50, \"label\": \"SOC 100 drills: key concepts\"}, {\"day\": 0, \"time\": \"13:45\", \"minutes\": 50, \"label\": \"SOC 100 final recap: key ideas and weak spots\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Friday Fri Dec 04 2026 20:34:52 GMT-0600 (Central Standard Time).\n\nUpcoming deadlines:\n- CS 251 Essay 2: Wed Dec 09 2026 11:59:00 GMT-0600 (Central Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-11-28: 3 sessions, 73 focused min, avg score 59\n- 2026-11-29: 2 sessions, 48 focused min, avg score 77\n- 2026-11-30: 2 sessions, 45 focused min, avg score 83\n- 2026-12-01: 3 sessions, 88 focused min, avg score 61\n- 2026-12-02: 4 sessions, 121 focused min, avg score 59\n- 2026-12-03: 4 sessions, 135 focused min, avg score 73\n- 2026-12-04: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"CS 251 Essay 2 is due on Wednesday, so I'm putting it first. I sized the blocks to fit how you've been studying. Bloop believes in you!\", \"blocks\": [{\"day\": 5, \"time\": \"21:30\", \"minutes\": 25, \"label\": \"CS 251 Essay 2: outline and draft\"}, {\"day\": 6, \"time\": \"18:00\", \"minutes\": 75, \"label\": \"CS 251 Essay 2: outline and draft (part 2)\"}, {\"day\": 0, \"time\": \"20:00\", \"minutes\": 75, \"label\": \"CS 251 Essay 2: outline and draft (part 3)\"}, {\"day\": 1, \"time\": \"18:30\", \"minutes\": 25, \"label\": \"CS 251: flashcards and short review\"}, {\"day\": 2, \"time\": \"17:45\", \"minutes\": 25, \"label\": \"Quick recap of CS 251 notes\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Monday Mon Sep 07 2026 08:28:15 GMT-0400 (Eastern Daylight Time).\n\nUpcoming deadlines:\n- MA 261 Exam 3 (EXAM): Tue Sep 08 2026 18:30:00 GMT-0400 (Eastern Daylight Time)\n- SOC 100 Final Exam (EXAM): Fri Sep 11 2026 18:30:00 GMT-0400 (Eastern Daylight Time)\n- HIST 110 Lab Report 5: Thu Sep 17 2026 17:00:00 GMT-0400 (Eastern Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-09-01: 2 sessions, 63 focused min, avg score 61\n- 2026-09-02: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-03: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-04: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-05: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-06: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-07: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"MA 261 Exam 3 comes first, and the rest follow in order of what's due soonest. Your focus time was light lately, so I'm not piling on too much. I'll be cheering for you the whole way!\", \"blocks\": [{\"day\": 1, \"time\": \"10:15\", \"minutes\": 50, \"label\": \"MA 261 exam prep: double integrals + practice\"}, {\"day\": 2, \"time\": \"09:45\", \"minutes\": 50, \"label\": \"SOC 100 exam prep: review notes on key concepts\"}, {\"day\": 3, \"time\": \"10:00\", \"minutes\": 50, \"label\": \"SOC 100: practice problems on case studies\"}, {\"day\": 4, \"time\": \"09:30\", \"minutes\": 50, \"label\": \"SOC 100 final recap: key ideas and weak spots\"}, {\"day\": 5, \"time\": \"08:15\", \"minutes\": 50, \"label\": \"Head start on HIST 110 Lab Report 5: skim the material\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Tuesday Tue Aug 25 2026 15:02:13 GMT-0400 (Eastern Daylight Time).\n\nUpcoming deadlines:\n- HIST 110 Midterm 1 (EXAM): Sun Aug 30 2026 13:00:00 GMT-0400 (Eastern Daylight Time)\n- BIO 110 Project 3: Wed Sep 02 2026 23:59:00 GMT-0400 (Eastern Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-08-19: 6 sessions, 163 focused min, avg score 88\n- 2026-08-20: 5 sessions, 199 focused min, avg score 81\n- 2026-08-21: 5 sessions, 188 focused min, avg score 96\n- 2026-08-22: 6 sessions, 219 focused min, avg score 75\n- 2026-08-23: 5 sessions, 157 focused min, avg score 70\n- 2026-08-24: 6 sessions, 228 focused min, avg score 72\n- 2026-08-25: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your HIST 110 Midterm 1 is on Sunday, so let's start there. You've been on a roll, so I gave you a bit more time each day. Take your breaks too, I'll be right here.\", \"blocks\": [{\"day\": 2, \"time\": \"16:30\", \"minutes\": 25, \"label\": \"Start HIST 110 exam review: key dates\"}, {\"day\": 2, \"time\": \"18:00\", \"minutes\": 50, \"label\": \"Head start on BIO 110 Project 3: skim the material\"}, {\"day\": 3, \"time\": \"14:15\", \"minutes\": 50, \"label\": \"HIST 110: practice problems on primary sources\"}, {\"day\": 4, \"time\": \"16:30\", \"minutes\": 50, \"label\": \"HIST 110 drills: primary sources\"}, {\"day\": 5, \"time\": \"14:00\", \"minutes\": 75, \"label\": \"HIST 110 final recap: key ideas and weak spots\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Wednesday Wed Mar 10 2027 14:05:20 GMT-0800 (Pacific Standard Time).\n\nUpcoming deadlines:\n- STAT 350 Midterm 2 (EXAM): Thu Mar 11 2027 09:00:00 GMT-0800 (Pacific Standard Time)\n- CS 180 Midterm 2 (EXAM): Sat Mar 13 2027 10:00:00 GMT-0800 (Pacific Standard Time)\n- HIST 110 Exam 2 (EXAM): Mon Mar 15 2027 09:00:00 GMT-0700 (Pacific Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-03-04: 1 sessions, 10 focused min, avg score 47\n- 2027-03-05: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-06: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-07: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-08: 1 sessions, 22 focused min, avg score 63\n- 2027-03-09: 1 sessions, 11 focused min, avg score 44\n- 2027-03-10: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 30-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"You've got 3 things coming up, so I lined them up by what's closest, starting with STAT 350 Midterm 2. Last week was pretty quiet, so I kept the plan small and doable. Bloop believes in you!\", \"blocks\": [{\"day\": 3, \"time\": \"15:15\", \"minutes\": 30, \"label\": \"STAT 350 exam prep: regression + practice\"}, {\"day\": 5, \"time\": \"15:00\", \"minutes\": 30, \"label\": \"CS 180 exam prep: Python loops + practice\"}, {\"day\": 0, \"time\": \"15:30\", \"minutes\": 30, \"label\": \"HIST 110 exam prep: the Industrial Revolution + practice\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Wednesday Wed Mar 17 2027 09:44:31 GMT-0400 (Eastern Daylight Time).\n\nUpcoming deadlines:\n- HIST 110 Homework 9: Fri Mar 19 2027 23:59:00 GMT-0400 (Eastern Daylight Time)\n- ECON 251 Midterm (EXAM): Sat Mar 20 2027 11:00:00 GMT-0400 (Eastern Daylight Time)\n- ART 120 Quiz 4: Tue Mar 23 2027 23:59:00 GMT-0400 (Eastern Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-03-11: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-12: 2 sessions, 48 focused min, avg score 39\n- 2027-03-13: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-14: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-15: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-16: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-17: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 45-minute pomodoros with 15-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your ECON 251 Midterm is on Saturday, so it gets the first and biggest blocks. There's a lot coming up, so I put the nearest ones first and kept each day doable. One pomodoro at a time, and you'll get there.\", \"blocks\": [{\"day\": 3, \"time\": \"10:45\", \"minutes\": 45, \"label\": \"ECON 251: skim slides and market structures\"}, {\"day\": 4, \"time\": \"10:45\", \"minutes\": 45, \"label\": \"ECON 251: practice problems on supply and demand\"}, {\"day\": 5, \"time\": \"08:30\", \"minutes\": 45, \"label\": \"ECON 251: mock exam, then fix mistakes\"}, {\"day\": 6, \"time\": \"09:00\", \"minutes\": 45, \"label\": \"ART 120 Quiz 4: review key ideas\"}, {\"day\": 0, \"time\": \"10:00\", \"minutes\": 45, \"label\": \"ART 120 Quiz 4: quick practice quiz\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Friday Fri Nov 13 2026 17:37:59 GMT-0800 (Pacific Standard Time).\n\nUpcoming deadlines:\n- HIST 110 Discussion Post 3: Tue Nov 17 2026 09:00:00 GMT-0800 (Pacific Standard Time)\n- SOC 100 Paper Outline: Tue Nov 17 2026 23:59:00 GMT-0800 (Pacific Standard Time)\n- CS 251 Project Milestone 2: Wed Nov 18 2026 23:59:00 GMT-0800 (Pacific Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-11-07: 3 sessions, 86 focused min, avg score 73\n- 2026-11-08: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-09: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-10: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-11: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-12: 3 sessions, 75 focused min, avg score 71\n- 2026-11-13: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 30-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"HIST 110 Discussion Post 3 is due on Tuesday, so that's our first stop. There's a lot coming up, so I put the nearest ones first and kept each day doable.\", \"blocks\": [{\"day\": 5, \"time\": \"19:00\", \"minutes\": 30, \"label\": \"HIST 110 Discussion Post 3: read and take notes\"}, {\"day\": 6, \"time\": \"19:30\", \"minutes\": 30, \"label\": \"HIST 110 Discussion Post 3: write the response\"}, {\"day\": 0, \"time\": \"18:00\", \"minutes\": 30, \"label\": \"SOC 100 Paper Outline: outline and draft\"}, {\"day\": 1, \"time\": \"19:30\", \"minutes\": 30, \"label\": \"SOC 100 Paper Outline: revise and proofread\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Thursday Thu Aug 27 2026 10:42:38 GMT+0100 (British Summer Time).\n\nUpcoming deadlines:\n- CS 180 Exam 3 (EXAM): Sat Sep 05 2026 09:00:00 GMT+0100 (British Summer Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-08-21: 5 sessions, 159 focused min, avg score 85\n- 2026-08-22: 0 sessions, 0 focused min, avg score n/a\n- 2026-08-23: 4 sessions, 141 focused min, avg score 77\n- 2026-08-24: 6 sessions, 161 focused min, avg score 81\n- 2026-08-25: 6 sessions, 172 focused min, avg score 70\n- 2026-08-26: 7 sessions, 213 focused min, avg score 79\n- 2026-08-27: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your CS 180 Exam 3 is in 9 days, so it gets the first and biggest blocks. Great focus lately, so I added a little extra study time. You've got this!\", \"blocks\": [{\"day\": 4, \"time\": \"11:30\", \"minutes\": 25, \"label\": \"Head start on CS 180 Exam 3: skim the material\"}, {\"day\": 5, \"time\": \"10:15\", \"minutes\": 25, \"label\": \"Head start on CS 180 Exam 3: review Python loops\"}, {\"day\": 6, \"time\": \"08:45\", \"minutes\": 25, \"label\": \"Head start on CS 180 Exam 3: outline the main parts\"}, {\"day\": 0, \"time\": \"10:15\", \"minutes\": 25, \"label\": \"Quick recap of CS 180 notes\"}, {\"day\": 1, \"time\": \"08:00\", \"minutes\": 25, \"label\": \"Light CS 180 review: Python loops\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Friday Fri Nov 06 2026 20:42:20 GMT-0600 (Central Standard Time).\n\nUpcoming deadlines:\n- ECON 251 Presentation: Tue Nov 17 2026 11:59:00 GMT-0600 (Central Standard Time)\n- BIO 110 Project 3: Wed Nov 18 2026 09:00:00 GMT-0600 (Central Standard Time)\n- ART 120 Project Milestone 2: Thu Nov 19 2026 23:59:00 GMT-0600 (Central Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-10-31: 4 sessions, 135 focused min, avg score 66\n- 2026-11-01: 3 sessions, 81 focused min, avg score 85\n- 2026-11-02: 4 sessions, 106 focused min, avg score 58\n- 2026-11-03: 4 sessions, 98 focused min, avg score 80\n- 2026-11-04: 3 sessions, 91 focused min, avg score 76\n- 2026-11-05: 4 sessions, 92 focused min, avg score 79\n- 2026-11-06: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"ECON 251 Presentation comes first, and the rest follow in order of what's due soonest. I sized the blocks to fit how you've been studying. I'll be cheering for you the whole way!\", \"blocks\": [{\"day\": 5, \"time\": \"21:30\", \"minutes\": 25, \"label\": \"Head start on ECON 251 Presentation: skim the material\"}, {\"day\": 6, \"time\": \"18:45\", \"minutes\": 25, \"label\": \"Head start on ECON 251 Presentation: review supply and demand\"}, {\"day\": 6, \"time\": \"20:10\", \"minutes\": 25, \"label\": \"Head start on BIO 110 Project 3: skim the material\"}, {\"day\": 6, \"time\": \"21:35\", \"minutes\": 25, \"label\": \"Head start on ART 120 Project Milestone 2: skim the material\"}, {\"day\": 0, \"time\": \"18:00\", \"minutes\": 25, \"label\": \"Head start on BIO 110 Project 3: review cell respiration\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Wednesday Wed Dec 30 2026 08:55:12 GMT+0000 (Coordinated Universal Time).\n\nUpcoming deadlines:\n- MA 165 Midterm 2 (EXAM): Wed Dec 30 2026 23:59:00 GMT+0000 (Coordinated Universal Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-12-24: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-25: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-26: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-27: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-28: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-29: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-30: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"MA 165 Midterm 2 is due today, so the plan is short and focused. I don't see any focus history yet, so I kept the sessions short and easy. You've got this!\", \"blocks\": [{\"day\": 3, \"time\": \"10:45\", \"minutes\": 25, \"label\": \"MA 165 Midterm 2: review limits\"}, {\"day\": 3, \"time\": \"12:45\", \"minutes\": 25, \"label\": \"MA 165 Midterm 2: review related rates\"}, {\"day\": 3, \"time\": \"14:45\", \"minutes\": 25, \"label\": \"MA 165 Midterm 2: last review before it's due\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Tuesday Tue Mar 23 2027 17:50:24 GMT-0400 (Eastern Daylight Time).\n\nUpcoming deadlines:\n- (no upcoming deadlines found)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-03-17: 5 sessions, 130 focused min, avg score 72\n- 2027-03-18: 4 sessions, 124 focused min, avg score 77\n- 2027-03-19: 4 sessions, 108 focused min, avg score 82\n- 2027-03-20: 5 sessions, 192 focused min, avg score 73\n- 2027-03-21: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-22: 7 sessions, 200 focused min, avg score 87\n- 2027-03-23: 1 sessions, 12 focused min, avg score 73\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Nothing is due soon, so this is a calm week to build a rhythm. You've been on a roll, so I gave you a bit more time each day. Blocks are built from 50-minute pomodoros with 10-minute breaks.\", \"blocks\": [{\"day\": 2, \"time\": \"19:30\", \"minutes\": 50, \"label\": \"Get ahead on upcoming readings\"}, {\"day\": 3, \"time\": \"18:15\", \"minutes\": 50, \"label\": \"Tidy notes and fix gaps\"}, {\"day\": 4, \"time\": \"18:30\", \"minutes\": 50, \"label\": \"Light revision: summarize key ideas\"}, {\"day\": 5, \"time\": \"20:00\", \"minutes\": 50, \"label\": \"Catch up on any missed material\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Sunday Sun Oct 04 2026 17:23:55 GMT-0400 (Eastern Daylight Time).\n\nUpcoming deadlines:\n- CS 251 Reading Response: Tue Oct 06 2026 09:00:00 GMT-0400 (Eastern Daylight Time)\n- PHYS 172 Quiz 3: Tue Oct 13 2026 09:00:00 GMT-0400 (Eastern Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-09-28: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-29: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-30: 1 sessions, 21 focused min, avg score 50\n- 2026-10-01: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-02: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-03: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-04: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"CS 251 Reading Response is due on Tuesday, so I'm putting it first. Your focus time was light lately, so I'm not piling on too much.\", \"blocks\": [{\"day\": 0, \"time\": \"18:15\", \"minutes\": 25, \"label\": \"CS 251 Reading Response: read and take notes\"}, {\"day\": 0, \"time\": \"19:45\", \"minutes\": 25, \"label\": \"CS 251: flashcards and short review\"}, {\"day\": 1, \"time\": \"19:15\", \"minutes\": 25, \"label\": \"CS 251 Reading Response: write the response\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Tuesday Tue Nov 24 2026 13:38:42 GMT-0500 (Eastern Standard Time).\n\nUpcoming deadlines:\n- (no upcoming deadlines found)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-11-18: 7 sessions, 242 focused min, avg score 93\n- 2026-11-19: 5 sessions, 195 focused min, avg score 94\n- 2026-11-20: 6 sessions, 236 focused min, avg score 77\n- 2026-11-21: 6 sessions, 211 focused min, avg score 85\n- 2026-11-22: 5 sessions, 142 focused min, avg score 84\n- 2026-11-23: 6 sessions, 238 focused min, avg score 81\n- 2026-11-24: 1 sessions, 13 focused min, avg score 79\n\nThe student uses 30-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Nothing is due soon, so this is a calm week to build a rhythm. Great focus lately, so I added a little extra study time. Bloop believes in you!\", \"blocks\": [{\"day\": 2, \"time\": \"15:30\", \"minutes\": 60, \"label\": \"Review this week's lecture notes\"}, {\"day\": 3, \"time\": \"16:15\", \"minutes\": 60, \"label\": \"Catch up on any missed material\"}, {\"day\": 4, \"time\": \"15:30\", \"minutes\": 90, \"label\": \"Light revision: summarize key ideas\"}, {\"day\": 5, \"time\": \"13:15\", \"minutes\": 30, \"label\": \"Practice problems from class\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Friday Fri Oct 23 2026 15:55:29 GMT-0700 (Pacific Daylight Time).\n\nUpcoming deadlines:\n- ENGL 106 Problem Set 5: Sat Oct 24 2026 11:59:00 GMT-0700 (Pacific Daylight Time)\n- CS 180 Group Project Part 1: Mon Oct 26 2026 23:59:00 GMT-0700 (Pacific Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-10-17: 4 sessions, 139 focused min, avg score 60\n- 2026-10-18: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-19: 4 sessions, 130 focused min, avg score 83\n- 2026-10-20: 4 sessions, 95 focused min, avg score 80\n- 2026-10-21: 2 sessions, 56 focused min, avg score 64\n- 2026-10-22: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-23: 1 sessions, 21 focused min, avg score 67\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"First up is ENGL 106 Problem Set 5, due tomorrow. I sized the blocks to fit how you've been studying.\", \"blocks\": [{\"day\": 5, \"time\": \"17:15\", \"minutes\": 50, \"label\": \"Quick recap of ENGL 106 notes\"}, {\"day\": 5, \"time\": \"18:45\", \"minutes\": 50, \"label\": \"Light ENGL 106 review: close reading\"}, {\"day\": 5, \"time\": \"20:15\", \"minutes\": 100, \"label\": \"ENGL 106 Problem Set 5: work through the problems\"}, {\"day\": 0, \"time\": \"14:00\", \"minutes\": 100, \"label\": \"CS 180 Group Project Part 1\"}, {\"day\": 1, \"time\": \"14:15\", \"minutes\": 50, \"label\": \"ENGL 106: flashcards and short review\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Friday Fri Aug 28 2026 21:18:39 GMT-0700 (Pacific Daylight Time).\n\nUpcoming deadlines:\n- ENGL 106 Midterm 2 (EXAM): Wed Sep 09 2026 14:00:00 GMT-0700 (Pacific Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-08-22: 4 sessions, 125 focused min, avg score 76\n- 2026-08-23: 5 sessions, 190 focused min, avg score 83\n- 2026-08-24: 5 sessions, 175 focused min, avg score 74\n- 2026-08-25: 4 sessions, 121 focused min, avg score 74\n- 2026-08-26: 7 sessions, 239 focused min, avg score 76\n- 2026-08-27: 6 sessions, 191 focused min, avg score 81\n- 2026-08-28: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"ENGL 106 Midterm 2 is in 12 days, so I put it at the front of the plan. Great focus lately, so I added a little extra study time. One pomodoro at a time, and you'll get there.\", \"blocks\": [{\"day\": 6, \"time\": \"18:00\", \"minutes\": 50, \"label\": \"Head start on ENGL 106 Midterm 2: skim the material\"}, {\"day\": 0, \"time\": \"19:30\", \"minutes\": 100, \"label\": \"Head start on ENGL 106 Midterm 2: review thesis statements\"}, {\"day\": 1, \"time\": \"20:15\", \"minutes\": 50, \"label\": \"ENGL 106: flashcards and short review\"}]}"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student just finished a 30-minute focus block and a 10-minute break is starting. Write one short, kind break-time nudge (max 60 characters)."}, {"role": "assistant", "content": "you've earned a breather, enjoy it"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Saturday Sat Feb 20 2027 09:23:24 GMT+0000 (Greenwich Mean Time).\n\nUpcoming deadlines:\n- CS 251 Exam 2 (EXAM): Sun Feb 21 2027 15:30:00 GMT+0000 (Greenwich Mean Time)\n- PSY 120 Midterm 1 (EXAM): Mon Feb 22 2027 17:00:00 GMT+0000 (Greenwich Mean Time)\n- CS 180 Exam 3 (EXAM): Tue Feb 23 2027 14:00:00 GMT+0000 (Greenwich Mean Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-02-14: 2 sessions, 35 focused min, avg score 56\n- 2027-02-15: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-16: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-17: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-18: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-19: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-20: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"CS 251 Exam 2 comes first, and the rest follow in order of what's due soonest. Last week was a bit stop-and-go, so I kept the plan small and doable.\", \"blocks\": [{\"day\": 6, \"time\": \"11:30\", \"minutes\": 25, \"label\": \"CS 251 exam prep: linked lists + practice\"}, {\"day\": 0, \"time\": \"09:30\", \"minutes\": 25, \"label\": \"PSY 120 exam prep: research methods + practice\"}, {\"day\": 1, \"time\": \"08:00\", \"minutes\": 25, \"label\": \"CS 180 Exam 3 review: debugging + Python loops\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Monday Mon Dec 14 2026 18:12:01 GMT-0600 (Central Standard Time).\n\nUpcoming deadlines:\n- ECON 251 Exam 2 (EXAM): Wed Dec 16 2026 09:00:00 GMT-0600 (Central Standard Time)\n- SOC 100 Lab Report 5: Fri Dec 18 2026 23:59:00 GMT-0600 (Central Standard Time)\n- BIO 110 Lab Report 5: Mon Dec 21 2026 09:00:00 GMT-0600 (Central Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-12-08: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-09: 4 sessions, 129 focused min, avg score 55\n- 2026-12-10: 4 sessions, 105 focused min, avg score 59\n- 2026-12-11: 3 sessions, 89 focused min, avg score 75\n- 2026-12-12: 4 sessions, 137 focused min, avg score 56\n- 2026-12-13: 3 sessions, 69 focused min, avg score 65\n- 2026-12-14: 1 sessions, 23 focused min, avg score 70\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"ECON 251 Exam 2 comes first, and the rest follow in order of what's due soonest. It matches the steady pace you've had lately.\", \"blocks\": [{\"day\": 1, \"time\": \"19:15\", \"minutes\": 75, \"label\": \"ECON 251 exam prep: review notes on GDP and inflation\"}, {\"day\": 2, \"time\": \"18:00\", \"minutes\": 50, \"label\": \"ECON 251: mock exam, then fix mistakes\"}, {\"day\": 2, \"time\": \"20:00\", \"minutes\": 50, \"label\": \"SOC 100 Lab Report 5: organize data and figures\"}, {\"day\": 4, \"time\": \"19:00\", \"minutes\": 75, \"label\": \"SOC 100 Lab Report 5: write conclusion and proofread\"}, {\"day\": 5, \"time\": \"20:00\", \"minutes\": 50, \"label\": \"Head start on BIO 110 Lab Report 5: skim the material\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Tuesday Tue Nov 17 2026 15:55:34 GMT-0500 (Eastern Standard Time).\n\nUpcoming deadlines:\n- PHYS 172 Problem Set 8: Fri Nov 20 2026 23:59:00 GMT-0500 (Eastern Standard Time)\n- PSY 120 Midterm (EXAM): Tue Nov 24 2026 17:00:00 GMT-0500 (Eastern Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-11-11: 7 sessions, 192 focused min, avg score 85\n- 2026-11-12: 5 sessions, 135 focused min, avg score 89\n- 2026-11-13: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-14: 7 sessions, 259 focused min, avg score 77\n- 2026-11-15: 5 sessions, 191 focused min, avg score 92\n- 2026-11-16: 7 sessions, 185 focused min, avg score 77\n- 2026-11-17: 1 sessions, 16 focused min, avg score 81\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"PHYS 172 Problem Set 8 is due on Friday, so I'm putting it first. You've been on a roll, so I gave you a bit more time each day. Blocks are built from 25-minute pomodoros with 5-minute breaks.\", \"blocks\": [{\"day\": 2, \"time\": \"16:45\", \"minutes\": 50, \"label\": \"PHYS 172 Problem Set 8: work through the problems\"}, {\"day\": 2, \"time\": \"19:15\", \"minutes\": 25, \"label\": \"Head start on PSY 120 Midterm: skim the material\"}, {\"day\": 3, \"time\": \"16:30\", \"minutes\": 25, \"label\": \"PHYS 172 Problem Set 8: work through the problems (part 2)\"}, {\"day\": 3, \"time\": \"17:45\", \"minutes\": 50, \"label\": \"Head start on PSY 120 Midterm: review memory models\"}, {\"day\": 4, \"time\": \"15:15\", \"minutes\": 25, \"label\": \"PHYS 172 Problem Set 8: check answers and redo mistakes\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Tuesday Tue Oct 13 2026 12:37:50 GMT-0400 (Eastern Daylight Time).\n\nUpcoming deadlines:\n- (no upcoming deadlines found)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-10-07: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-08: 3 sessions, 99 focused min, avg score 78\n- 2026-10-09: 3 sessions, 95 focused min, avg score 71\n- 2026-10-10: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-11: 2 sessions, 50 focused min, avg score 85\n- 2026-10-12: 4 sessions, 131 focused min, avg score 56\n- 2026-10-13: 1 sessions, 15 focused min, avg score 62\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Nothing is due soon, so this is a calm week to build a rhythm. It matches the steady pace you've had lately. Blocks are built from 25-minute pomodoros with 5-minute breaks.\", \"blocks\": [{\"day\": 2, \"time\": \"13:30\", \"minutes\": 50, \"label\": \"Make flashcards from class notes\"}, {\"day\": 3, \"time\": \"14:00\", \"minutes\": 50, \"label\": \"Light revision: summarize key ideas\"}, {\"day\": 4, \"time\": \"14:00\", \"minutes\": 50, \"label\": \"Practice problems from class\"}, {\"day\": 5, \"time\": \"16:15\", \"minutes\": 50, \"label\": \"Get ahead on upcoming readings\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Monday Mon Feb 22 2027 12:47:53 GMT+0000 (Coordinated Universal Time).\n\nUpcoming deadlines:\n- (no upcoming deadlines found)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-02-16: 2 sessions, 52 focused min, avg score 68\n- 2027-02-17: 4 sessions, 102 focused min, avg score 75\n- 2027-02-18: 2 sessions, 68 focused min, avg score 81\n- 2027-02-19: 3 sessions, 69 focused min, avg score 67\n- 2027-02-20: 2 sessions, 49 focused min, avg score 57\n- 2027-02-21: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-22: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"No deadlines in sight, so let's use the time to get ahead gently. I sized the blocks to fit how you've been studying. One pomodoro at a time, and you'll get there.\", \"blocks\": [{\"day\": 1, \"time\": \"14:30\", \"minutes\": 25, \"label\": \"Tidy notes and fix gaps\"}, {\"day\": 2, \"time\": \"15:15\", \"minutes\": 50, \"label\": \"Make flashcards from class notes\"}, {\"day\": 3, \"time\": \"13:45\", \"minutes\": 50, \"label\": \"Get ahead on upcoming readings\"}, {\"day\": 4, \"time\": \"16:30\", \"minutes\": 75, \"label\": \"Light revision: summarize key ideas\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Thursday Thu Dec 31 2026 09:18:44 GMT-0600 (Central Standard Time).\n\nUpcoming deadlines:\n- CS 251 Midterm 2 (EXAM): Thu Dec 31 2026 18:30:00 GMT-0600 (Central Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-12-25: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-26: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-27: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-28: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-29: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-30: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-31: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"CS 251 Midterm 2 is due today, so the plan is short and focused. This is a fresh start, so the blocks stay gentle.\", \"blocks\": [{\"day\": 4, \"time\": \"10:00\", \"minutes\": 50, \"label\": \"CS 251 Midterm 2: review hash tables\"}, {\"day\": 4, \"time\": \"12:00\", \"minutes\": 50, \"label\": \"CS 251 Midterm 2: review Big-O analysis\"}, {\"day\": 4, \"time\": \"14:00\", \"minutes\": 50, \"label\": \"Final push: CS 251 Midterm 2\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Tuesday Tue Feb 09 2027 20:16:08 GMT-0700 (Mountain Standard Time).\n\nUpcoming deadlines:\n- SOC 100 Online Quiz 2: Wed Feb 10 2027 14:00:00 GMT-0700 (Mountain Standard Time)\n- HIST 110 Exam 2 (EXAM): Wed Feb 10 2027 18:30:00 GMT-0700 (Mountain Standard Time)\n- CS 180 Midterm (EXAM): Thu Feb 11 2027 19:00:00 GMT-0700 (Mountain Standard Time)\n- CHEM 201 Midterm 2 (EXAM): Sat Feb 13 2027 15:30:00 GMT-0700 (Mountain Standard Time)\n- MA 165 Group Presentation: Thu Feb 18 2027 17:00:00 GMT-0700 (Mountain Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-02-03: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-04: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-05: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-06: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-07: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-08: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-09: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 30-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"HIST 110 Exam 2 is tomorrow, so I put it at the front of the plan. There's a lot coming up, so I put the nearest ones first and kept each day doable.\", \"blocks\": [{\"day\": 2, \"time\": \"21:30\", \"minutes\": 30, \"label\": \"HIST 110: skim slides and the Industrial Revolution\"}, {\"day\": 5, \"time\": \"18:30\", \"minutes\": 30, \"label\": \"Quick recap of HIST 110 notes\"}, {\"day\": 5, \"time\": \"19:45\", \"minutes\": 30, \"label\": \"CHEM 201 Midterm 2 review: acid-base titrations + kinetics\"}]}"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student just came back to their study app after 1 minute away. Write one short, kind welcome-back nudge (max 60 characters)."}, {"role": "assistant", "content": "welcome back, friend. one step at a time"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student just came back to their study app after 4 minutes away. Write one short, kind welcome-back nudge (max 60 characters)."}, {"role": "assistant", "content": "hooray, focus mode is back on 🌟"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Thursday Thu Mar 25 2027 19:13:45 GMT-0600 (Mountain Daylight Time).\n\nUpcoming deadlines:\n- STAT 350 Project 3: Tue Mar 30 2027 11:59:00 GMT-0600 (Mountain Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-03-19: 2 sessions, 59 focused min, avg score 72\n- 2027-03-20: 2 sessions, 59 focused min, avg score 65\n- 2027-03-21: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-22: 3 sessions, 67 focused min, avg score 76\n- 2027-03-23: 4 sessions, 129 focused min, avg score 70\n- 2027-03-24: 3 sessions, 95 focused min, avg score 73\n- 2027-03-25: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"First up is STAT 350 Project 3, due on Tuesday. I sized the blocks to fit how you've been studying. Blocks are built from 25-minute pomodoros with 5-minute breaks.\", \"blocks\": [{\"day\": 4, \"time\": \"21:00\", \"minutes\": 50, \"label\": \"STAT 350 Project 3: build the next milestone\"}, {\"day\": 5, \"time\": \"19:15\", \"minutes\": 50, \"label\": \"STAT 350 Project 3: build the next milestone (part 2)\"}, {\"day\": 6, \"time\": \"18:15\", \"minutes\": 50, \"label\": \"STAT 350 Project 3: build the next milestone (part 3)\"}, {\"day\": 0, \"time\": \"19:00\", \"minutes\": 25, \"label\": \"STAT 350 Project 3: test and clean up\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Wednesday Wed Mar 24 2027 09:01:19 GMT-0700 (Pacific Daylight Time).\n\nUpcoming deadlines:\n- (no upcoming deadlines found)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-03-18: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-19: 3 sessions, 96 focused min, avg score 67\n- 2027-03-20: 2 sessions, 66 focused min, avg score 56\n- 2027-03-21: 2 sessions, 69 focused min, avg score 81\n- 2027-03-22: 4 sessions, 118 focused min, avg score 74\n- 2027-03-23: 3 sessions, 68 focused min, avg score 61\n- 2027-03-24: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 45-minute pomodoros with 15-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Nothing is due soon, so this is a calm week to build a rhythm. It matches the steady pace you've had lately. Blocks are built from 45-minute pomodoros with 15-minute breaks.\", \"blocks\": [{\"day\": 3, \"time\": \"09:45\", \"minutes\": 90, \"label\": \"Practice problems from class\"}, {\"day\": 4, \"time\": \"10:00\", \"minutes\": 90, \"label\": \"Light revision: summarize key ideas\"}, {\"day\": 5, \"time\": \"10:00\", \"minutes\": 90, \"label\": \"Review this week's lecture notes\"}]}"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student just finished a 60-minute focus block and a 10-minute break is starting. Write one short, kind break-time nudge (max 60 characters)."}, {"role": "assistant", "content": "your break starts now, no studying allowed"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Friday Fri Nov 13 2026 21:08:55 GMT-0700 (Mountain Standard Time).\n\nUpcoming deadlines:\n- SOC 100 Exam 2 (EXAM): Thu Nov 19 2026 17:00:00 GMT-0700 (Mountain Standard Time)\n- CS 251 Essay 2: Sat Nov 21 2026 23:59:00 GMT-0700 (Mountain Standard Time)\n- MA 165 Group Project Part 1: Tue Nov 24 2026 14:00:00 GMT-0700 (Mountain Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-11-07: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-08: 2 sessions, 23 focused min, avg score 37\n- 2026-11-09: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-10: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-11: 2 sessions, 24 focused min, avg score 58\n- 2026-11-12: 2 sessions, 42 focused min, avg score 68\n- 2026-11-13: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 45-minute pomodoros with 15-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"SOC 100 Exam 2 is on Thursday, so I put it at the front of the plan. Your focus time was light lately, so I'm not piling on too much. You've got this!\", \"blocks\": [{\"day\": 6, \"time\": \"18:30\", \"minutes\": 45, \"label\": \"SOC 100: skim slides and survey methods\"}, {\"day\": 0, \"time\": \"18:45\", \"minutes\": 45, \"label\": \"SOC 100: practice problems on key concepts\"}, {\"day\": 1, \"time\": \"19:30\", \"minutes\": 45, \"label\": \"Last look at SOC 100: case studies\"}, {\"day\": 2, \"time\": \"19:00\", \"minutes\": 45, \"label\": \"Head start on CS 251 Essay 2: skim the material\"}, {\"day\": 3, \"time\": \"18:00\", \"minutes\": 45, \"label\": \"Head start on CS 251 Essay 2: review Big-O analysis\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Friday Fri Mar 26 2027 17:21:57 GMT-0700 (Pacific Daylight Time).\n\nUpcoming deadlines:\n- ECON 251 Problem Set 5: Sun Mar 28 2027 17:00:00 GMT-0700 (Pacific Daylight Time)\n- CHEM 201 Quiz 3: Tue Mar 30 2027 23:59:00 GMT-0700 (Pacific Daylight Time)\n- CS 180 Presentation: Wed Mar 31 2027 23:59:00 GMT-0700 (Pacific Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-03-20: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-21: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-22: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-23: 2 sessions, 45 focused min, avg score 69\n- 2027-03-24: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-25: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-26: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"ECON 251 Problem Set 5 comes first, and the rest follow in order of what's due soonest. Last week was a bit stop-and-go, so I kept the plan small and doable. I'll be cheering for you the whole way!\", \"blocks\": [{\"day\": 5, \"time\": \"18:45\", \"minutes\": 50, \"label\": \"ECON 251 Problem Set 5: work through the problems\"}, {\"day\": 6, \"time\": \"20:15\", \"minutes\": 50, \"label\": \"ECON 251 Problem Set 5: check answers and redo mistakes\"}, {\"day\": 1, \"time\": \"20:00\", \"minutes\": 50, \"label\": \"CHEM 201 Quiz 3: review key ideas\"}, {\"day\": 2, \"time\": \"20:15\", \"minutes\": 50, \"label\": \"CS 180 Presentation: build the slides\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Thursday Thu Apr 29 2027 09:44:10 GMT-0700 (Pacific Daylight Time).\n\nUpcoming deadlines:\n- SOC 100 Exam 2 (EXAM): Tue May 04 2027 18:30:00 GMT-0700 (Pacific Daylight Time)\n- ENGL 106 Exam 3 (EXAM): Wed May 05 2027 18:30:00 GMT-0700 (Pacific Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-04-23: 3 sessions, 89 focused min, avg score 69\n- 2027-04-24: 2 sessions, 52 focused min, avg score 77\n- 2027-04-25: 2 sessions, 66 focused min, avg score 72\n- 2027-04-26: 3 sessions, 92 focused min, avg score 79\n- 2027-04-27: 3 sessions, 90 focused min, avg score 64\n- 2027-04-28: 3 sessions, 102 focused min, avg score 83\n- 2027-04-29: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 45-minute pomodoros with 15-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your SOC 100 Exam 2 is on Tuesday, so let's start there. It matches the steady pace you've had lately. I'll be cheering for you the whole way!\", \"blocks\": [{\"day\": 4, \"time\": \"11:00\", \"minutes\": 45, \"label\": \"Start SOC 100 exam review: survey methods\"}, {\"day\": 4, \"time\": \"12:45\", \"minutes\": 45, \"label\": \"Start ENGL 106 exam review: thesis statements\"}, {\"day\": 5, \"time\": \"10:00\", \"minutes\": 90, \"label\": \"Last look at SOC 100: social theory\"}, {\"day\": 6, \"time\": \"08:30\", \"minutes\": 45, \"label\": \"ENGL 106: practice problems on citations\"}, {\"day\": 0, \"time\": \"08:30\", \"minutes\": 45, \"label\": \"Last look at ENGL 106: argument structure\"}]}"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student just finished a 25-minute focus block and a 10-minute break is starting. Write one short, kind break-time nudge (max 60 characters)."}, {"role": "assistant", "content": "rest those brain cells for a few minutes"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Tuesday Tue Jan 12 2027 13:06:54 GMT-0600 (Central Standard Time).\n\nUpcoming deadlines:\n- MA 261 Exam 3 (EXAM): Sat Jan 16 2027 19:00:00 GMT-0600 (Central Standard Time)\n- SOC 100 Midterm 2 (EXAM): Sun Jan 17 2027 17:00:00 GMT-0600 (Central Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-01-06: 0 sessions, 0 focused min, avg score n/a\n- 2027-01-07: 0 sessions, 0 focused min, avg score n/a\n- 2027-01-08: 0 sessions, 0 focused min, avg score n/a\n- 2027-01-09: 0 sessions, 0 focused min, avg score n/a\n- 2027-01-10: 0 sessions, 0 focused min, avg score n/a\n- 2027-01-11: 0 sessions, 0 focused min, avg score n/a\n- 2027-01-12: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your MA 261 Exam 3 is on Saturday, so let's start there. Your focus time was light lately, so I'm not piling on too much. Blocks are built from 50-minute pomodoros with 10-minute breaks.\", \"blocks\": [{\"day\": 2, \"time\": \"15:15\", \"minutes\": 50, \"label\": \"MA 261: skim slides and gradients\"}, {\"day\": 3, \"time\": \"13:00\", \"minutes\": 50, \"label\": \"MA 261: practice problems on Lagrange multipliers\"}, {\"day\": 4, \"time\": \"15:00\", \"minutes\": 50, \"label\": \"Last look at MA 261: double integrals\"}, {\"day\": 5, \"time\": \"16:00\", \"minutes\": 50, \"label\": \"Start SOC 100 exam review: survey methods\"}, {\"day\": 6, \"time\": \"15:45\", \"minutes\": 50, \"label\": \"SOC 100: mock exam, then fix mistakes\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Saturday Sat Dec 05 2026 12:01:58 GMT-0500 (Eastern Standard Time).\n\nUpcoming deadlines:\n- HIST 110 Midterm (EXAM): Sat Dec 12 2026 14:00:00 GMT-0500 (Eastern Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-11-29: 1 sessions, 29 focused min, avg score 72\n- 2026-11-30: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-01: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-02: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-03: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-04: 2 sessions, 51 focused min, avg score 75\n- 2026-12-05: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your HIST 110 Midterm is in 7 days, so it gets the first and biggest blocks. Last week was a bit stop-and-go, so I kept the plan small and doable. You've got this!\", \"blocks\": [{\"day\": 6, \"time\": \"13:00\", \"minutes\": 50, \"label\": \"Head start on HIST 110 Midterm: skim the material\"}, {\"day\": 0, \"time\": \"14:30\", \"minutes\": 50, \"label\": \"Head start on HIST 110 Midterm: review primary sources\"}, {\"day\": 1, \"time\": \"16:30\", \"minutes\": 50, \"label\": \"Head start on HIST 110 Midterm: outline the main parts\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Sunday Sun Mar 14 2027 20:14:41 GMT-0500 (Central Daylight Time).\n\nUpcoming deadlines:\n- (no upcoming deadlines found)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-03-08: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-09: 2 sessions, 43 focused min, avg score 53\n- 2027-03-10: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-11: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-12: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-13: 1 sessions, 13 focused min, avg score 40\n- 2027-03-14: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"No deadlines in sight, so let's use the time to get ahead gently. Last week was pretty quiet, so I kept the plan small and doable.\", \"blocks\": [{\"day\": 0, \"time\": \"21:00\", \"minutes\": 50, \"label\": \"Get ahead on upcoming readings\"}, {\"day\": 1, \"time\": \"18:15\", \"minutes\": 50, \"label\": \"Plan next week's study goals\"}, {\"day\": 2, \"time\": \"18:15\", \"minutes\": 50, \"label\": \"Review this week's lecture notes\"}, {\"day\": 3, \"time\": \"18:00\", \"minutes\": 50, \"label\": \"Practice problems from class\"}]}"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student's 10-minute break is over and the next 50-minute focus block is starting. Write one short, kind back-to-work nudge (max 60 characters)."}, {"role": "assistant", "content": "the timer is running, let's make it count"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Saturday Sat May 01 2027 15:32:07 GMT-0700 (Pacific Daylight Time).\n\nUpcoming deadlines:\n- CS 180 Project Milestone 2: Sun May 02 2027 09:00:00 GMT-0700 (Pacific Daylight Time)\n- ECON 251 Presentation: Tue May 04 2027 09:00:00 GMT-0700 (Pacific Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-04-25: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-26: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-27: 2 sessions, 47 focused min, avg score 49\n- 2027-04-28: 2 sessions, 23 focused min, avg score 54\n- 2027-04-29: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-30: 1 sessions, 9 focused min, avg score 49\n- 2027-05-01: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 30-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"CS 180 Project Milestone 2 is due tomorrow, so that's our first stop. Your focus time was light lately, so I'm not piling on too much. I'll be cheering for you the whole way!\", \"blocks\": [{\"day\": 6, \"time\": \"17:30\", \"minutes\": 30, \"label\": \"CS 180 Project Milestone 2: build the next milestone\"}, {\"day\": 6, \"time\": \"18:30\", \"minutes\": 30, \"label\": \"Light CS 180 review: Python loops\"}, {\"day\": 1, \"time\": \"15:00\", \"minutes\": 30, \"label\": \"ECON 251 Presentation: build the slides\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Sunday Sun Mar 14 2027 20:45:33 GMT-0700 (Pacific Daylight Time).\n\nUpcoming deadlines:\n- ART 120 Midterm 2 (EXAM): Sat Mar 20 2027 18:30:00 GMT-0700 (Pacific Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-03-08: 4 sessions, 109 focused min, avg score 71\n- 2027-03-09: 2 sessions, 51 focused min, avg score 80\n- 2027-03-10: 4 sessions, 132 focused min, avg score 82\n- 2027-03-11: 3 sessions, 102 focused min, avg score 59\n- 2027-03-12: 2 sessions, 63 focused min, avg score 68\n- 2027-03-13: 4 sessions, 126 focused min, avg score 69\n- 2027-03-14: 1 sessions, 22 focused min, avg score 85\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"ART 120 Midterm 2 is on Saturday, so I put it at the front of the plan. I sized the blocks to fit how you've been studying.\", \"blocks\": [{\"day\": 1, \"time\": \"17:45\", \"minutes\": 50, \"label\": \"Start ART 120 exam review: visual analysis\"}, {\"day\": 2, \"time\": \"18:15\", \"minutes\": 50, \"label\": \"ART 120: practice problems on art movements\"}, {\"day\": 3, \"time\": \"17:30\", \"minutes\": 50, \"label\": \"ART 120 drills: art movements\"}, {\"day\": 4, \"time\": \"20:00\", \"minutes\": 50, \"label\": \"Last look at ART 120: terminology\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Monday Mon Sep 21 2026 17:22:11 GMT-0700 (Pacific Daylight Time).\n\nUpcoming deadlines:\n- MA 261 Midterm 2 (EXAM): Mon Sep 28 2026 14:00:00 GMT-0700 (Pacific Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-09-15: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-16: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-17: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-18: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-19: 1 sessions, 32 focused min, avg score 52\n- 2026-09-20: 3 sessions, 69 focused min, avg score 56\n- 2026-09-21: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"MA 261 Midterm 2 is in 7 days, so I put it at the front of the plan. Last week was a bit stop-and-go, so I kept the plan small and doable.\", \"blocks\": [{\"day\": 1, \"time\": \"19:15\", \"minutes\": 50, \"label\": \"Head start on MA 261 Midterm 2: skim the material\"}, {\"day\": 2, \"time\": \"18:45\", \"minutes\": 50, \"label\": \"Head start on MA 261 Midterm 2: review gradients\"}, {\"day\": 3, \"time\": \"19:30\", \"minutes\": 50, \"label\": \"Head start on MA 261 Midterm 2: outline the main parts\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Wednesday Wed Oct 21 2026 10:50:16 GMT-0700 (Pacific Daylight Time).\n\nUpcoming deadlines:\n- ENGL 106 Paper Outline: Sun Oct 25 2026 23:59:00 GMT-0700 (Pacific Daylight Time)\n- HIST 110 Exam 2 (EXAM): Mon Oct 26 2026 10:00:00 GMT-0700 (Pacific Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-10-15: 2 sessions, 50 focused min, avg score 67\n- 2026-10-16: 1 sessions, 15 focused min, avg score 37\n- 2026-10-17: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-18: 1 sessions, 10 focused min, avg score 59\n- 2026-10-19: 0 sessions, 0 focused min, avg score n/a\n- 2026-10-20: 1 sessions, 22 focused min, avg score 42\n- 2026-10-21: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 45-minute pomodoros with 15-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your HIST 110 Exam 2 is on Monday, so it gets the first and biggest blocks. Last week was pretty quiet, so I kept the plan small and doable. I'll be cheering for you the whole way!\", \"blocks\": [{\"day\": 3, \"time\": \"11:30\", \"minutes\": 45, \"label\": \"Start HIST 110 exam review: key dates\"}, {\"day\": 4, \"time\": \"10:00\", \"minutes\": 45, \"label\": \"HIST 110: practice problems on the Industrial Revolution\"}, {\"day\": 5, \"time\": \"08:15\", \"minutes\": 45, \"label\": \"HIST 110 drills: the Industrial Revolution\"}, {\"day\": 6, \"time\": \"08:30\", \"minutes\": 45, \"label\": \"ENGL 106 Paper Outline: outline and draft\"}, {\"day\": 0, \"time\": \"08:00\", \"minutes\": 45, \"label\": \"HIST 110: mock exam, then fix mistakes\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Friday Fri Mar 26 2027 13:58:53 GMT-0400 (Eastern Daylight Time).\n\nUpcoming deadlines:\n- MA 261 Online Quiz 2: Mon Apr 05 2027 23:59:00 GMT-0400 (Eastern Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-03-20: 7 sessions, 267 focused min, avg score 82\n- 2027-03-21: 6 sessions, 209 focused min, avg score 88\n- 2027-03-22: 7 sessions, 250 focused min, avg score 77\n- 2027-03-23: 6 sessions, 185 focused min, avg score 91\n- 2027-03-24: 6 sessions, 169 focused min, avg score 82\n- 2027-03-25: 6 sessions, 220 focused min, avg score 77\n- 2027-03-26: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"First up is MA 261 Online Quiz 2, due in 10 days. Great focus lately, so I added a little extra study time. Take your breaks too, I'll be right here.\", \"blocks\": [{\"day\": 5, \"time\": \"15:00\", \"minutes\": 100, \"label\": \"Head start on MA 261 Online Quiz 2: skim the material\"}, {\"day\": 6, \"time\": \"13:45\", \"minutes\": 50, \"label\": \"Quick recap of MA 261 notes\"}, {\"day\": 0, \"time\": \"14:30\", \"minutes\": 50, \"label\": \"MA 261: flashcards and short review\"}, {\"day\": 1, \"time\": \"13:00\", \"minutes\": 50, \"label\": \"Light MA 261 review: Lagrange multipliers\"}]}"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student has been on reddit.com for 3 minutes during a focus session. Write one short, kind nudge (max 60 characters)."}, {"role": "assistant", "content": "your future self says thanks for refocusing"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Sunday Sun Jan 03 2027 09:37:46 GMT-0500 (Eastern Standard Time).\n\nUpcoming deadlines:\n- (no upcoming deadlines found)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-12-28: 2 sessions, 62 focused min, avg score 64\n- 2026-12-29: 3 sessions, 79 focused min, avg score 70\n- 2026-12-30: 3 sessions, 70 focused min, avg score 60\n- 2026-12-31: 2 sessions, 62 focused min, avg score 80\n- 2027-01-01: 2 sessions, 62 focused min, avg score 81\n- 2027-01-02: 2 sessions, 45 focused min, avg score 75\n- 2027-01-03: 1 sessions, 13 focused min, avg score 67\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"It's a quiet week on the calendar, so I kept things light and steady. It matches the steady pace you've had lately. Blocks are built from 25-minute pomodoros with 5-minute breaks.\", \"blocks\": [{\"day\": 0, \"time\": \"11:30\", \"minutes\": 50, \"label\": \"Light revision: summarize key ideas\"}, {\"day\": 1, \"time\": \"10:30\", \"minutes\": 25, \"label\": \"Tidy notes and fix gaps\"}, {\"day\": 2, \"time\": \"09:30\", \"minutes\": 50, \"label\": \"Make flashcards from class notes\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Thursday Thu Dec 10 2026 18:30:19 GMT+0000 (Greenwich Mean Time).\n\nUpcoming deadlines:\n- (no upcoming deadlines found)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-12-04: 6 sessions, 158 focused min, avg score 84\n- 2026-12-05: 7 sessions, 178 focused min, avg score 85\n- 2026-12-06: 5 sessions, 146 focused min, avg score 86\n- 2026-12-07: 6 sessions, 166 focused min, avg score 76\n- 2026-12-08: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-09: 6 sessions, 196 focused min, avg score 72\n- 2026-12-10: 1 sessions, 21 focused min, avg score 93\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Nothing is due soon, so this is a calm week to build a rhythm. Great focus lately, so I added a little extra study time. Bloop believes in you!\", \"blocks\": [{\"day\": 4, \"time\": \"19:00\", \"minutes\": 50, \"label\": \"Catch up on any missed material\"}, {\"day\": 5, \"time\": \"19:30\", \"minutes\": 50, \"label\": \"Plan next week's study goals\"}, {\"day\": 6, \"time\": \"19:00\", \"minutes\": 50, \"label\": \"Get ahead on upcoming readings\"}]}"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student has been on youtube.com for 1 minute during a focus session. Write one short, kind nudge (max 60 characters)."}, {"role": "assistant", "content": "that video will still be there after your session"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Wednesday Wed Nov 18 2026 10:14:59 GMT-0600 (Central Standard Time).\n\nUpcoming deadlines:\n- (no upcoming deadlines found)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-11-12: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-13: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-14: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-15: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-16: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-17: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-18: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Nothing is due soon, so this is a calm week to build a rhythm. I don't see any focus history yet, so I kept the sessions short and easy. Blocks are built from 25-minute pomodoros with 5-minute breaks.\", \"blocks\": [{\"day\": 3, \"time\": \"11:45\", \"minutes\": 25, \"label\": \"Practice problems from class\"}, {\"day\": 4, \"time\": \"10:00\", \"minutes\": 25, \"label\": \"Catch up on any missed material\"}, {\"day\": 5, \"time\": \"08:30\", \"minutes\": 75, \"label\": \"Make flashcards from class notes\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Wednesday Wed Feb 10 2027 10:42:44 GMT-0500 (Eastern Standard Time).\n\nUpcoming deadlines:\n- (no upcoming deadlines found)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-02-04: 4 sessions, 95 focused min, avg score 84\n- 2027-02-05: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-06: 2 sessions, 57 focused min, avg score 83\n- 2027-02-07: 3 sessions, 103 focused min, avg score 56\n- 2027-02-08: 3 sessions, 94 focused min, avg score 78\n- 2027-02-09: 4 sessions, 122 focused min, avg score 79\n- 2027-02-10: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 30-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"No deadlines in sight, so let's use the time to get ahead gently. It matches the steady pace you've had lately. Bloop believes in you!\", \"blocks\": [{\"day\": 3, \"time\": \"12:30\", \"minutes\": 90, \"label\": \"Catch up on any missed material\"}, {\"day\": 4, \"time\": \"09:00\", \"minutes\": 30, \"label\": \"Review this week's lecture notes\"}, {\"day\": 5, \"time\": \"10:00\", \"minutes\": 30, \"label\": \"Get ahead on upcoming readings\"}, {\"day\": 6, \"time\": \"10:15\", \"minutes\": 60, \"label\": \"Light revision: summarize key ideas\"}, {\"day\": 0, \"time\": \"09:00\", \"minutes\": 90, \"label\": \"Make flashcards from class notes\"}]}"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student just finished a 30-minute focus block and a 15-minute break is starting. Write one short, kind break-time nudge (max 60 characters)."}, {"role": "assistant", "content": "pomodoro done! give your eyes a rest"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student just finished a 35-minute focus block and a 15-minute break is starting. Write one short, kind break-time nudge (max 60 characters)."}, {"role": "assistant", "content": "pause the brain and refill your water 💧"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Sunday Sun Sep 20 2026 09:16:28 GMT-0700 (Pacific Daylight Time).\n\nUpcoming deadlines:\n- CHEM 201 Exam 3 (EXAM): Mon Sep 21 2026 17:00:00 GMT-0700 (Pacific Daylight Time)\n- STAT 350 Group Presentation: Sun Sep 27 2026 14:00:00 GMT-0700 (Pacific Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-09-14: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-15: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-16: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-17: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-18: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-19: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-20: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your CHEM 201 Exam 3 is tomorrow, so it gets the first and biggest blocks. This is a fresh start, so the blocks stay gentle.\", \"blocks\": [{\"day\": 0, \"time\": \"10:15\", \"minutes\": 25, \"label\": \"Start CHEM 201 exam review: acid-base titrations\"}, {\"day\": 0, \"time\": \"11:15\", \"minutes\": 25, \"label\": \"Light CHEM 201 review: acid-base titrations\"}, {\"day\": 1, \"time\": \"08:45\", \"minutes\": 25, \"label\": \"Head start on STAT 350 Group Presentation: skim the material\"}]}"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student just finished a 40-minute focus block and a 15-minute break is starting. Write one short, kind break-time nudge (max 60 characters)."}, {"role": "assistant", "content": "you earned this break, go relax a bit"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Tuesday Tue Sep 01 2026 08:33:13 GMT+0000 (Coordinated Universal Time).\n\nUpcoming deadlines:\n- MA 261 Online Quiz 2: Wed Sep 02 2026 23:59:00 GMT+0000 (Coordinated Universal Time)\n- ENGL 106 Final Exam (EXAM): Sun Sep 06 2026 19:00:00 GMT+0000 (Coordinated Universal Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-08-26: 7 sessions, 193 focused min, avg score 83\n- 2026-08-27: 5 sessions, 144 focused min, avg score 94\n- 2026-08-28: 4 sessions, 135 focused min, avg score 71\n- 2026-08-29: 5 sessions, 182 focused min, avg score 71\n- 2026-08-30: 7 sessions, 235 focused min, avg score 74\n- 2026-08-31: 7 sessions, 207 focused min, avg score 74\n- 2026-09-01: 1 sessions, 28 focused min, avg score 95\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"MA 261 Online Quiz 2 is due tomorrow, so that's our first stop. Great focus lately, so I added a little extra study time. Take your breaks too, I'll be right here.\", \"blocks\": [{\"day\": 2, \"time\": \"09:30\", \"minutes\": 75, \"label\": \"MA 261 Online Quiz 2: review key ideas\"}, {\"day\": 2, \"time\": \"11:45\", \"minutes\": 25, \"label\": \"ENGL 106 exam prep: review notes on close reading\"}, {\"day\": 3, \"time\": \"09:15\", \"minutes\": 75, \"label\": \"ENGL 106: practice problems on argument structure\"}, {\"day\": 4, \"time\": \"09:30\", \"minutes\": 25, \"label\": \"ENGL 106 drills: argument structure\"}, {\"day\": 5, \"time\": \"09:30\", \"minutes\": 75, \"label\": \"ENGL 106: mock exam, then fix mistakes\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Thursday Thu Nov 12 2026 09:38:12 GMT+0000 (Greenwich Mean Time).\n\nUpcoming deadlines:\n- CHEM 201 Exam 2 (EXAM): Sun Nov 15 2026 09:00:00 GMT+0000 (Greenwich Mean Time)\n- MA 261 Final Exam (EXAM): Mon Nov 16 2026 11:00:00 GMT+0000 (Greenwich Mean Time)\n- MA 165 Presentation: Mon Nov 16 2026 23:59:00 GMT+0000 (Greenwich Mean Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-11-06: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-07: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-08: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-09: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-10: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-11: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-12: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your CHEM 201 Exam 2 is on Sunday, so it gets the first and biggest blocks. There's a lot coming up, so I put the nearest ones first and kept each day doable. I'll be cheering for you the whole way!\", \"blocks\": [{\"day\": 4, \"time\": \"11:15\", \"minutes\": 50, \"label\": \"CHEM 201 exam prep: review notes on thermodynamics\"}, {\"day\": 5, \"time\": \"08:00\", \"minutes\": 50, \"label\": \"CHEM 201: practice problems on acid-base titrations\"}, {\"day\": 6, \"time\": \"09:15\", \"minutes\": 50, \"label\": \"CHEM 201: mock exam, then fix mistakes\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Wednesday Wed Sep 02 2026 15:55:27 GMT-0500 (Central Daylight Time).\n\nUpcoming deadlines:\n- ECON 251 Quiz 3: Thu Sep 03 2026 11:59:00 GMT-0500 (Central Daylight Time)\n- MA 165 Midterm 1 (EXAM): Sat Sep 05 2026 09:00:00 GMT-0500 (Central Daylight Time)\n- CHEM 201 Exam 1 (EXAM): Sun Sep 06 2026 15:30:00 GMT-0500 (Central Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-08-27: 5 sessions, 141 focused min, avg score 90\n- 2026-08-28: 7 sessions, 279 focused min, avg score 88\n- 2026-08-29: 7 sessions, 227 focused min, avg score 86\n- 2026-08-30: 6 sessions, 166 focused min, avg score 76\n- 2026-08-31: 4 sessions, 145 focused min, avg score 94\n- 2026-09-01: 4 sessions, 111 focused min, avg score 73\n- 2026-09-02: 1 sessions, 19 focused min, avg score 76\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"MA 165 Midterm 1 is on Saturday, so I put it at the front of the plan. I focused on the closest deadlines first and kept the load realistic. You've got this!\", \"blocks\": [{\"day\": 3, \"time\": \"17:45\", \"minutes\": 100, \"label\": \"MA 165 exam prep: review notes on related rates\"}, {\"day\": 3, \"time\": \"20:15\", \"minutes\": 50, \"label\": \"CHEM 201: skim slides and kinetics\"}, {\"day\": 5, \"time\": \"14:00\", \"minutes\": 100, \"label\": \"Last look at MA 165: integration\"}, {\"day\": 5, \"time\": \"16:15\", \"minutes\": 100, \"label\": \"CHEM 201 final recap: key ideas and weak spots\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Thursday Thu Dec 31 2026 07:54:11 GMT+0000 (Greenwich Mean Time).\n\nUpcoming deadlines:\n- MA 165 Final Exam (EXAM): Sat Jan 02 2027 11:00:00 GMT+0000 (Greenwich Mean Time)\n- CS 251 Midterm 1 (EXAM): Sun Jan 03 2027 11:00:00 GMT+0000 (Greenwich Mean Time)\n- PSY 120 Lab Report 5: Sat Jan 09 2027 23:59:00 GMT+0000 (Greenwich Mean Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-12-25: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-26: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-27: 3 sessions, 94 focused min, avg score 41\n- 2026-12-28: 2 sessions, 35 focused min, avg score 70\n- 2026-12-29: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-30: 1 sessions, 30 focused min, avg score 40\n- 2026-12-31: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 30-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"MA 165 Final Exam comes first, and the rest follow in order of what's due soonest. Your focus time was light lately, so I'm not piling on too much.\", \"blocks\": [{\"day\": 4, \"time\": \"09:45\", \"minutes\": 30, \"label\": \"MA 165 exam prep: review notes on integration\"}, {\"day\": 5, \"time\": \"09:30\", \"minutes\": 30, \"label\": \"MA 165: mock exam, then fix mistakes\"}, {\"day\": 6, \"time\": \"09:30\", \"minutes\": 30, \"label\": \"CS 251 exam prep: linked lists + practice\"}, {\"day\": 0, \"time\": \"09:30\", \"minutes\": 30, \"label\": \"Head start on PSY 120 Lab Report 5: skim the material\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Sunday Sun Dec 06 2026 21:42:54 GMT-0600 (Central Standard Time).\n\nUpcoming deadlines:\n- ENGL 106 Exam 1 (EXAM): Thu Dec 10 2026 10:00:00 GMT-0600 (Central Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-11-30: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-01: 2 sessions, 45 focused min, avg score 59\n- 2026-12-02: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-03: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-04: 1 sessions, 23 focused min, avg score 47\n- 2026-12-05: 1 sessions, 22 focused min, avg score 66\n- 2026-12-06: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 30-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your ENGL 106 Exam 1 is on Thursday, so it gets the first and biggest blocks. Your focus time was light lately, so I'm not piling on too much. You've got this!\", \"blocks\": [{\"day\": 1, \"time\": \"18:00\", \"minutes\": 30, \"label\": \"Start ENGL 106 exam review: close reading\"}, {\"day\": 2, \"time\": \"19:00\", \"minutes\": 30, \"label\": \"ENGL 106: practice problems on thesis statements\"}, {\"day\": 3, \"time\": \"19:00\", \"minutes\": 30, \"label\": \"ENGL 106: mock exam, then fix mistakes\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Sunday Sun Dec 20 2026 16:39:14 GMT-0700 (Mountain Standard Time).\n\nUpcoming deadlines:\n- CS 251 Exam 1 (EXAM): Tue Dec 22 2026 13:00:00 GMT-0700 (Mountain Standard Time)\n- HIST 110 Quiz 3: Thu Dec 24 2026 09:00:00 GMT-0700 (Mountain Standard Time)\n- ART 120 Homework 4: Sun Dec 27 2026 23:59:00 GMT-0700 (Mountain Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-12-14: 2 sessions, 30 focused min, avg score 51\n- 2026-12-15: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-16: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-17: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-18: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-19: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-20: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your CS 251 Exam 1 is on Tuesday, so it gets the first and biggest blocks. Last week was a bit stop-and-go, so I kept the plan small and doable.\", \"blocks\": [{\"day\": 0, \"time\": \"18:15\", \"minutes\": 25, \"label\": \"Start CS 251 exam review: linked lists\"}, {\"day\": 1, \"time\": \"15:15\", \"minutes\": 25, \"label\": \"CS 251: mock exam, then fix mistakes\"}, {\"day\": 3, \"time\": \"16:15\", \"minutes\": 25, \"label\": \"HIST 110 Quiz 3: review key ideas\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Sunday Sun Feb 07 2027 19:44:46 GMT-0700 (Mountain Standard Time).\n\nUpcoming deadlines:\n- CS 180 Midterm 1 (EXAM): Thu Feb 11 2027 19:00:00 GMT-0700 (Mountain Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-02-01: 2 sessions, 18 focused min, avg score 35\n- 2027-02-02: 2 sessions, 44 focused min, avg score 66\n- 2027-02-03: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-04: 2 sessions, 31 focused min, avg score 51\n- 2027-02-05: 2 sessions, 47 focused min, avg score 56\n- 2027-02-06: 2 sessions, 38 focused min, avg score 57\n- 2027-02-07: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your CS 180 Midterm 1 is on Thursday, so it gets the first and biggest blocks. Last week was pretty quiet, so I kept the plan small and doable. Bloop believes in you!\", \"blocks\": [{\"day\": 0, \"time\": \"20:45\", \"minutes\": 25, \"label\": \"Start CS 180 exam review: debugging\"}, {\"day\": 1, \"time\": \"17:30\", \"minutes\": 50, \"label\": \"CS 180: practice problems on file I/O\"}, {\"day\": 2, \"time\": \"19:30\", \"minutes\": 50, \"label\": \"CS 180 drills: file I/O\"}, {\"day\": 3, \"time\": \"19:30\", \"minutes\": 50, \"label\": \"CS 180: mock exam, then fix mistakes\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Friday Fri Dec 11 2026 10:16:35 GMT-0800 (Pacific Standard Time).\n\nUpcoming deadlines:\n- ART 120 Midterm (EXAM): Sun Dec 13 2026 10:00:00 GMT-0800 (Pacific Standard Time)\n- PSY 120 Exam 1 (EXAM): Thu Dec 17 2026 13:00:00 GMT-0800 (Pacific Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-12-05: 2 sessions, 49 focused min, avg score 61\n- 2026-12-06: 3 sessions, 83 focused min, avg score 56\n- 2026-12-07: 4 sessions, 128 focused min, avg score 67\n- 2026-12-08: 3 sessions, 73 focused min, avg score 65\n- 2026-12-09: 4 sessions, 123 focused min, avg score 83\n- 2026-12-10: 4 sessions, 139 focused min, avg score 70\n- 2026-12-11: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 45-minute pomodoros with 15-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your ART 120 Midterm is on Sunday, so let's start there. It matches the steady pace you've had lately.\", \"blocks\": [{\"day\": 5, \"time\": \"11:30\", \"minutes\": 90, \"label\": \"Start ART 120 exam review: terminology\"}, {\"day\": 5, \"time\": \"14:30\", \"minutes\": 45, \"label\": \"PSY 120 exam prep: review notes on conditioning\"}, {\"day\": 6, \"time\": \"09:15\", \"minutes\": 45, \"label\": \"ART 120: mock exam, then fix mistakes\"}, {\"day\": 6, \"time\": \"11:00\", \"minutes\": 90, \"label\": \"PSY 120: practice problems on research methods\"}, {\"day\": 1, \"time\": \"10:45\", \"minutes\": 45, \"label\": \"Last look at PSY 120: cognitive biases\"}]}"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student just finished a 25-minute focus block and a 15-minute break is starting. Write one short, kind break-time nudge (max 60 characters)."}, {"role": "assistant", "content": "go ahead, rest. i'll keep your seat warm"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Thursday Thu Apr 08 2027 20:38:41 GMT+0100 (British Summer Time).\n\nUpcoming deadlines:\n- PHYS 172 Lab Report 3: Fri Apr 09 2027 23:59:00 GMT+0100 (British Summer Time)\n- PSY 120 Project 3: Sun Apr 18 2027 11:59:00 GMT+0100 (British Summer Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-04-02: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-03: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-04: 3 sessions, 68 focused min, avg score 60\n- 2027-04-05: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-06: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-07: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-08: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"First up is PHYS 172 Lab Report 3, due tomorrow. Your focus time was light lately, so I'm not piling on too much. You've got this!\", \"blocks\": [{\"day\": 5, \"time\": \"18:00\", \"minutes\": 50, \"label\": \"PHYS 172 Lab Report 3: organize data and figures\"}, {\"day\": 5, \"time\": \"19:35\", \"minutes\": 50, \"label\": \"Light PHYS 172 review: Newton's laws\"}, {\"day\": 5, \"time\": \"21:10\", \"minutes\": 50, \"label\": \"PHYS 172: flashcards and short review\"}]}"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student just finished a 25-minute focus block and a 5-minute break is starting. Write one short, kind break-time nudge (max 60 characters)."}, {"role": "assistant", "content": "that was a solid block. enjoy your break"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Saturday Sat Apr 10 2027 09:00:56 GMT-0400 (Eastern Daylight Time).\n\nUpcoming deadlines:\n- PSY 120 Midterm 2 (EXAM): Mon Apr 19 2027 14:00:00 GMT-0400 (Eastern Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-04-04: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-05: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-06: 3 sessions, 85 focused min, avg score 61\n- 2027-04-07: 0 sessions, 0 focused min, avg score n/a\n- 2027-04-08: 1 sessions, 24 focused min, avg score 71\n- 2027-04-09: 2 sessions, 44 focused min, avg score 66\n- 2027-04-10: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"PSY 120 Midterm 2 is in 9 days, so I put it at the front of the plan. Last week was a bit stop-and-go, so I kept the plan small and doable. Take your breaks too, I'll be right here.\", \"blocks\": [{\"day\": 6, \"time\": \"10:45\", \"minutes\": 25, \"label\": \"Head start on PSY 120 Midterm 2: skim the material\"}, {\"day\": 0, \"time\": \"08:15\", \"minutes\": 25, \"label\": \"Head start on PSY 120 Midterm 2: review research methods\"}, {\"day\": 1, \"time\": \"08:30\", \"minutes\": 25, \"label\": \"Head start on PSY 120 Midterm 2: outline the main parts\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Sunday Sun Nov 22 2026 07:34:00 GMT-0500 (Eastern Standard Time).\n\nUpcoming deadlines:\n- ART 120 Presentation: Sun Nov 22 2026 23:59:00 GMT-0500 (Eastern Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-11-16: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-17: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-18: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-19: 2 sessions, 42 focused min, avg score 41\n- 2026-11-20: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-21: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-22: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 45-minute pomodoros with 15-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Today is the big day for ART 120 Presentation, so I kept everything before it's due. Your focus time was light lately, so I'm not piling on too much. Bloop believes in you!\", \"blocks\": [{\"day\": 0, \"time\": \"09:00\", \"minutes\": 45, \"label\": \"ART 120 Presentation: review artist profiles\"}, {\"day\": 0, \"time\": \"10:30\", \"minutes\": 45, \"label\": \"ART 120 Presentation: review visual analysis\"}, {\"day\": 0, \"time\": \"12:00\", \"minutes\": 45, \"label\": \"ART 120 Presentation: last review before it's due\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Sunday Sun Oct 25 2026 15:48:34 GMT-0700 (Pacific Daylight Time).\n\nUpcoming deadlines:\n- ECON 251 Online Quiz 2: Wed Oct 28 2026 11:59:00 GMT-0700 (Pacific Daylight Time)\n- ENGL 106 Reading Response 4: Fri Oct 30 2026 23:59:00 GMT-0700 (Pacific Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-10-19: 3 sessions, 72 focused min, avg score 59\n- 2026-10-20: 4 sessions, 94 focused min, avg score 74\n- 2026-10-21: 2 sessions, 53 focused min, avg score 85\n- 2026-10-22: 2 sessions, 45 focused min, avg score 68\n- 2026-10-23: 4 sessions, 135 focused min, avg score 76\n- 2026-10-24: 3 sessions, 80 focused min, avg score 77\n- 2026-10-25: 1 sessions, 26 focused min, avg score 72\n\nThe student uses 30-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"ECON 251 Online Quiz 2 is due on Wednesday, so that's our first stop. It matches the steady pace you've had lately. Take your breaks too, I'll be right here.\", \"blocks\": [{\"day\": 0, \"time\": \"16:45\", \"minutes\": 60, \"label\": \"ECON 251 Online Quiz 2: review key ideas\"}, {\"day\": 0, \"time\": \"18:15\", \"minutes\": 30, \"label\": \"ENGL 106 Reading Response 4: read and take notes\"}, {\"day\": 1, \"time\": \"13:00\", \"minutes\": 30, \"label\": \"ENGL 106 Reading Response 4: write the response\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Saturday Sat Dec 26 2026 21:05:06 GMT-0600 (Central Standard Time).\n\nUpcoming deadlines:\n- ART 120 Online Quiz 2: Tue Dec 29 2026 17:00:00 GMT-0600 (Central Standard Time)\n- MA 261 Exam 3 (EXAM): Tue Jan 05 2027 17:00:00 GMT-0600 (Central Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-12-20: 3 sessions, 70 focused min, avg score 65\n- 2026-12-21: 0 sessions, 0 focused min, avg score n/a\n- 2026-12-22: 3 sessions, 94 focused min, avg score 79\n- 2026-12-23: 4 sessions, 93 focused min, avg score 56\n- 2026-12-24: 4 sessions, 88 focused min, avg score 76\n- 2026-12-25: 2 sessions, 61 focused min, avg score 74\n- 2026-12-26: 1 sessions, 20 focused min, avg score 59\n\nThe student uses 30-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"First up is ART 120 Online Quiz 2, due on Tuesday. It matches the steady pace you've had lately. Blocks are built from 30-minute pomodoros with 5-minute breaks.\", \"blocks\": [{\"day\": 0, \"time\": \"19:00\", \"minutes\": 60, \"label\": \"ART 120 Online Quiz 2: review key ideas\"}, {\"day\": 0, \"time\": \"21:30\", \"minutes\": 30, \"label\": \"Head start on MA 261 Exam 3: skim the material\"}, {\"day\": 1, \"time\": \"17:30\", \"minutes\": 60, \"label\": \"Head start on MA 261 Exam 3: review gradients\"}]}"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student has been using Steam for 2 minutes during a focus session. Write one short, kind nudge (max 60 characters)."}, {"role": "assistant", "content": "the game will wait, let's finish studying first"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student just finished a focus session of 90 minutes (2 pomodoros). Write one short, kind session-complete nudge (max 60 characters)."}, {"role": "assistant", "content": "you did it! time to relax, superstar"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student's 15-minute break is over and the next 20-minute focus block is starting. Write one short, kind back-to-work nudge (max 60 characters)."}, {"role": "assistant", "content": "let's go! the next block is yours"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Wednesday Wed Sep 30 2026 14:22:56 GMT-0400 (Eastern Daylight Time).\n\nUpcoming deadlines:\n- SOC 100 Online Quiz 2: Fri Oct 02 2026 23:59:00 GMT-0400 (Eastern Daylight Time)\n- PSY 120 Midterm 2 (EXAM): Mon Oct 05 2026 18:30:00 GMT-0400 (Eastern Daylight Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-09-24: 6 sessions, 183 focused min, avg score 73\n- 2026-09-25: 4 sessions, 116 focused min, avg score 89\n- 2026-09-26: 7 sessions, 245 focused min, avg score 83\n- 2026-09-27: 4 sessions, 131 focused min, avg score 90\n- 2026-09-28: 0 sessions, 0 focused min, avg score n/a\n- 2026-09-29: 7 sessions, 249 focused min, avg score 84\n- 2026-09-30: 1 sessions, 24 focused min, avg score 74\n\nThe student uses 45-minute pomodoros with 15-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your PSY 120 Midterm 2 is on Monday, so it gets the first and biggest blocks. Great focus lately, so I added a little extra study time.\", \"blocks\": [{\"day\": 3, \"time\": \"15:45\", \"minutes\": 45, \"label\": \"PSY 120: skim slides and research methods\"}, {\"day\": 3, \"time\": \"17:15\", \"minutes\": 45, \"label\": \"SOC 100 Online Quiz 2: review key ideas\"}, {\"day\": 4, \"time\": \"15:45\", \"minutes\": 45, \"label\": \"PSY 120: practice problems on memory models\"}, {\"day\": 4, \"time\": \"18:00\", \"minutes\": 45, \"label\": \"SOC 100 Online Quiz 2: quick practice quiz\"}, {\"day\": 5, \"time\": \"15:30\", \"minutes\": 45, \"label\": \"PSY 120 drills: memory models\"}, {\"day\": 6, \"time\": \"13:00\", \"minutes\": 45, \"label\": \"PSY 120: mock exam, then fix mistakes\"}]}"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Wednesday Wed Mar 03 2027 17:02:07 GMT-0600 (Central Standard Time).\n\nUpcoming deadlines:\n- MA 261 Midterm 2 (EXAM): Sat Mar 06 2027 11:00:00 GMT-0600 (Central Standard Time)\n- ECON 251 Exam 3 (EXAM): Wed Mar 10 2027 10:00:00 GMT-0600 (Central Standard Time)\n- ART 120 Midterm 2 (EXAM): Thu Mar 11 2027 09:00:00 GMT-0600 (Central Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2027-02-25: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-26: 3 sessions, 104 focused min, avg score 40\n- 2027-02-27: 0 sessions, 0 focused min, avg score n/a\n- 2027-02-28: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-01: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-02: 0 sessions, 0 focused min, avg score n/a\n- 2027-03-03: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 50-minute pomodoros with 10-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"MA 261 Midterm 2 is on Saturday, so I put it at the front of the plan. Your focus time was light lately, so I'm not piling on too much. You've got this!\", \"blocks\": [{\"day\": 3, \"time\": \"18:30\", \"minutes\": 50, \"label\": \"MA 261: skim slides and partial derivatives\"}, {\"day\": 4, \"time\": \"19:00\", \"minutes\": 50, \"label\": \"MA 261: practice problems on gradients\"}, {\"day\": 5, \"time\": \"18:15\", \"minutes\": 50, \"label\": \"MA 261: mock exam, then fix mistakes\"}]}"}]}
{"messages": [{"role": "user", "content": "You are Bloop, a cute study pet. The student just finished a focus session of 135 minutes (3 pomodoros). Write one short, kind session-complete nudge (max 60 characters)."}, {"role": "assistant", "content": "high five! another session done"}]}
{"messages": [{"role": "user", "content": "You are a friendly study coach inside a desktop \"study pet\" app for a university student.\nToday is Monday Mon Nov 16 2026 15:07:22 GMT-0600 (Central Standard Time).\n\nUpcoming deadlines:\n- CS 251 Midterm 2 (EXAM): Wed Nov 18 2026 11:00:00 GMT-0600 (Central Standard Time)\n- ECON 251 Midterm 2 (EXAM): Mon Nov 23 2026 11:00:00 GMT-0600 (Central Standard Time)\n\nFocus history for the last 7 days (score 0-100 = share of time on study apps/sites):\n- 2026-11-10: 2 sessions, 64 focused min, avg score 64\n- 2026-11-11: 3 sessions, 87 focused min, avg score 67\n- 2026-11-12: 4 sessions, 138 focused min, avg score 74\n- 2026-11-13: 0 sessions, 0 focused min, avg score n/a\n- 2026-11-14: 2 sessions, 45 focused min, avg score 65\n- 2026-11-15: 3 sessions, 74 focused min, avg score 66\n- 2026-11-16: 0 sessions, 0 focused min, avg score n/a\n\nThe student uses 25-minute pomodoros with 5-minute breaks.\n\nCreate a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,\nand fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.\nBlock lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.\n\nReply with ONLY a JSON object, no markdown fences, in exactly this shape:\n{\"summary\": \"<2-3 encouraging sentences explaining the plan>\",\n \"blocks\": [{\"day\": <0-6, 0 = Sunday>, \"time\": \"HH:MM\" (24h), \"minutes\": <number>, \"label\": \"<what to study>\"}]}"}, {"role": "assistant", "content": "{\"summary\": \"Your CS 251 Midterm 2 is on Wednesday, so it gets the first and biggest blocks. It matches the steady pace you've had lately. Take your breaks too, I'll be right here.\", \"blocks\": [{\"day\": 1, \"time\": \"15:45\", \"minutes\": 25, \"label\": \"CS 251: flashcards and short review\"}, {\"day\": 1, \"time\": \"16:45\", \"minutes\": 50, \"label\": \"CS 251: practice problems on recursion\"}, {\"day\": 1, \"time\": \"18:15\", \"minutes\": 50, \"label\": \"Head start on ECON 251 Midterm 2: skim the material\"}, {\"day\": 2, \"time\": \"15:15\", \"minutes\": 25, \"label\": \"CS 251 drills: recursion\"}, {\"day\": 2, \"time\": \"17:15\", \"minutes\": 75, \"label\": \"Last look at CS 251: linked lists\"}]}"}]}
``````

### `ml/data/validate.py`

<!-- FILE: ml/data/validate.py sha256=e015e9ad6d6e495258cf64b050ef9e45eaf9a8d251c7b0adb16334d49e057ec3 nl=1 -->
``````python
#!/usr/bin/env python3
"""Validates ml/data/train.jsonl + eval.jsonl with ml/train/scoring.py. Exit 0 and write READY only when clean.

    python3 ml/data/validate.py            # validate (and write READY if everything passes)
    python3 ml/data/validate.py --no-ready # validate only
"""
from __future__ import annotations

import hashlib
import json
import re
import statistics
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "train"))
import scoring as S  # noqa: E402

CHARS_PER_TOKEN = 3.5
MAX_LEN_DEFAULT = 1024  # train_lora.py --max-len default
SENT = re.compile(r"[.!?](?:\s+|$)")


def emoji_count(s: str) -> int:
    return sum(1 for ch in s if ord(ch) >= 0x1F000 or 0x2600 <= ord(ch) <= 0x27BF or 0x2B00 <= ord(ch) <= 0x2BFF)


def est_tokens(text: str) -> int:
    """Digit-aware BPE proxy (same as build_dataset.est_tokens): words ~ len/6 tokens, each digit and punctuation mark 1."""
    n = 0
    for m in re.finditer(r"[A-Za-z]+|\d|[^\sA-Za-z\d]", text):
        w = m.group(0)
        n += -(-len(w) // 6) if w[0].isalpha() else 1
    return n


def load(path: Path):
    rows = []
    for ln, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if line.strip():
            rows.append((ln, json.loads(line)))
    return rows


def extra_plan_checks(plan: dict, prompt: str, ctx: dict) -> dict:
    """Checks beyond scoring.py that a good teacher plan should also satisfy."""
    res = {}
    blocks = plan["blocks"]
    n_sent = len(SENT.findall(plan["summary"].strip()))
    res["summary_2_3_sentences"] = 2 <= n_sent <= 3
    res["summary_short"] = len(plan["summary"]) <= 330
    res["no_overlap"] = True
    res["not_in_past_today"] = True
    res["before_due_time"] = True
    res["chronological"] = True
    m = re.search(r"Today is \w+ [^\n]*? (\d\d):(\d\d):\d\d", prompt)
    now_min = int(m.group(1)) * 60 + int(m.group(2)) if m else None
    today_dow = ctx["today_dow"]
    spans = []
    last_key = (-1, -1)
    for b in blocks:
        off = (b["day"] - today_dow) % 7
        st = S.parse_hhmm(b["time"])
        spans.append((off, st, st + b["minutes"]))
        if (off, st) < last_key:
            res["chronological"] = False
        last_key = (off, st)
        if off == 0 and now_min is not None and st < now_min:
            res["not_in_past_today"] = False
    spans.sort()
    for a, b in zip(spans, spans[1:]):
        if a[0] == b[0] and b[1] < a[2]:
            res["no_overlap"] = False
    # blocks on a deadline's own day must end before it is due (when the due time is in the prompt)
    sec = re.search(r"Upcoming deadlines:\n([\s\S]*?)\n\s*\n", prompt)
    for line in (sec.group(1).splitlines() if sec else []):
        d = S.find_date(line)
        tm = re.search(r" (\d\d):(\d\d):\d\d GMT", line)
        if not d or not tm or ctx["today"] is None:
            continue
        off = (d - ctx["today"]).days
        due = int(tm.group(1)) * 60 + int(tm.group(2))
        for o, st, en in spans:
            if o == off and en > due:
                res["before_due_time"] = False
    return res


def main() -> int:
    no_ready = "--no-ready" in sys.argv
    problems: list[str] = []
    files = {"train": HERE / "train.jsonl", "eval": HERE / "eval.jsonl"}
    data = {}
    for name, p in files.items():
        if not p.exists():
            print(f"missing {p}")
            return 1
        data[name] = load(p)

    stats = {}
    all_prompts: dict[str, str] = {}
    for name, rows in data.items():
        plan_res, plan_extra, nudge_res = [], [], []
        tok = {"plan": [], "nudge": []}
        proxy = []
        tok_p, tok_a = {"plan": [], "nudge": []}, {"plan": [], "nudge": []}
        for ln, row in rows:
            tag = f"{name}.jsonl:{ln}"
            msgs = row.get("messages") if isinstance(row, dict) else None
            if not (isinstance(msgs, list) and len(msgs) == 2 and [m.get("role") for m in msgs] == ["user", "assistant"]
                    and all(isinstance(m.get("content"), str) and m["content"].strip() for m in msgs) and set(row) == {"messages"}):
                problems.append(f"{tag}: bad message schema (need exactly user+assistant, no system)")
                continue
            prompt, answer = msgs[0]["content"], msgs[1]["content"]
            if prompt in all_prompts:
                problems.append(f"{tag}: duplicate prompt (also {all_prompts[prompt]})")
            all_prompts[prompt] = tag
            if answer != answer.strip():
                problems.append(f"{tag}: assistant content has leading/trailing whitespace")
            if S.is_plan_prompt(prompt):
                kind = "plan"
                r = S.score_plan(answer, prompt)
                ctx = S.parse_context(prompt)
                if ctx["today"] is None or ctx["today_dow"] is None:
                    problems.append(f"{tag}: could not parse today's date from the prompt")
                if "```" in answer:
                    problems.append(f"{tag}: code fence in answer")
                plan_res.append(r)
                for k in ("parsed", "clean_json", "schema_valid", "blocks_3_10", "hours_ok", "pomodoro_ok", "all_rules"):
                    if r[k] is not True:
                        problems.append(f"{tag}: plan check {k} = {r[k]} {r['errors']}")
                if r["before_deadline"] is False:
                    problems.append(f"{tag}: plan check before_deadline failed")
                if r["schema_valid"]:
                    obj = json.loads(answer)
                    if set(obj) != {"summary", "blocks"} or any(set(b) != {"day", "time", "minutes", "label"} for b in obj["blocks"]):
                        problems.append(f"{tag}: unexpected keys")
                    ex = extra_plan_checks(obj, prompt, ctx)
                    plan_extra.append(ex)
                    for k, v in ex.items():
                        if not v:
                            problems.append(f"{tag}: extra check {k} failed")
            else:
                kind = "nudge"
                r = S.score_nudge(answer)
                nudge_res.append(r)
                if not (r["nonempty"] and r["single_line"] and r["le60"]):
                    problems.append(f"{tag}: nudge check failed {r}")
                if emoji_count(answer) > 1:
                    problems.append(f"{tag}: more than one emoji")
                if answer != answer.lower():
                    problems.append(f"{tag}: nudge is not lowercase")
                if not prompt.startswith("You are Bloop, a cute study pet. ") or not prompt.endswith("(max 60 characters)."):
                    problems.append(f"{tag}: nudge prompt does not follow the documented format")
            proxy.append(est_tokens(prompt) + est_tokens(answer))
            tok_p[kind].append(len(prompt) / CHARS_PER_TOKEN)
            tok_a[kind].append(len(answer) / CHARS_PER_TOKEN)
            tok[kind].append((len(prompt) + len(answer)) / CHARS_PER_TOKEN)
        stats[name] = dict(proxy=proxy, plans=plan_res, extra=plan_extra, nudges=nudge_res, tok=tok, tok_p=tok_p, tok_a=tok_a)

    # train/eval overlap on prompts and on nudge targets
    tp = {m["messages"][0]["content"] for _, m in data["train"] if isinstance(m, dict)}
    ep = {m["messages"][0]["content"] for _, m in data["eval"] if isinstance(m, dict)}
    if tp & ep:
        problems.append(f"{len(tp & ep)} eval prompts also appear in train")
    tn = {m["messages"][1]["content"] for _, m in data["train"] if not S.is_plan_prompt(m["messages"][0]["content"])}
    en = {m["messages"][1]["content"] for _, m in data["eval"] if not S.is_plan_prompt(m["messages"][0]["content"])}
    leak = tn & en
    if leak:
        problems.append(f"{len(leak)} eval nudge lines also appear in train")

    # ------------------------------------------------------------------ report
    print("=== scoring.py validation of the assistant targets ===")
    for name in ("train", "eval"):
        st = stats[name]
        n_all = len(st["plans"]) + len(st["nudges"])
        agg = S.aggregate_plans(st["plans"])
        nag = S.aggregate_nudges(st["nudges"])
        print(f"\n[{name}] {n_all} examples: {len(st['plans'])} plan ({100 * len(st['plans']) / n_all:.0f}%), "
              f"{len(st['nudges'])} nudge ({100 * len(st['nudges']) / n_all:.0f}%)")
        print("  plans : " + ", ".join(f"{k}={S.pct(v)}" for k, v in agg.items() if k != "n"))
        applicable = sum(1 for r in st["plans"] if r["before_deadline"] is not None)
        print(f"          before_deadline applicable to {applicable}/{len(st['plans'])} plans (no in-window deadline = n/a)")
        if st["extra"]:
            ex_keys = list(st["extra"][0])
            print("  extra : " + ", ".join(f"{k}={100 * sum(e[k] for e in st['extra']) / len(st['extra']):.0f}%" for k in ex_keys))
        print(f"  nudges: le60={S.pct(nag['le60_rate'])}, single_line={S.pct(nag['single_line_rate'])}, "
              f"max len={max((r['len'] for r in st['nudges']), default=0)}")
        for kind in ("plan", "nudge"):
            tt = st["tok"][kind]
            if not tt:
                continue
            ps, as_ = st["tok_p"][kind], st["tok_a"][kind]
            q = sorted(tt)
            print(f"  tokens (chars/{CHARS_PER_TOKEN}) {kind:5s} n={len(tt):3d}: prompt mean {statistics.mean(ps):.0f}, "
                  f"answer mean {statistics.mean(as_):.0f}, total mean {statistics.mean(tt):.0f} / p95 {q[int(0.95 * (len(q) - 1))]:.0f} "
                  f"/ max {max(tt):.0f}")
    for n in stats:
        px = sorted(stats[n]["proxy"])
        print(f"\n[{n}] digit-aware token proxy (digits/punctuation = 1 token each), prompt+answer: mean {statistics.mean(px):.0f}, "
              f"p95 {px[int(0.95 * (len(px) - 1))]}, max {px[-1]} (train_lora.py --max-len default {MAX_LEN_DEFAULT})")
        if px[-1] > 960:
            problems.append(f"{n}: an example may exceed --max-len {MAX_LEN_DEFAULT} (proxy {px[-1]})")

    if problems:
        print(f"\nFAILED: {len(problems)} problem(s)")
        for p in problems[:50]:
            print("  -", p)
        return 1

    n_train, n_eval = len(data["train"]), len(data["eval"])
    sha = hashlib.sha256((HERE / "train.jsonl").read_bytes()).hexdigest()
    print(f"\nALL CHECKS PASSED (100% on schema and rules for plans, length for nudges)")
    if not no_ready:
        np_train, np_eval = len(stats["train"]["plans"]), len(stats["eval"]["plans"])
        (HERE / "READY").write_text(
            f"train: {n_train} examples ({np_train} plan, {len(stats['train']['nudges'])} nudge)\n"
            f"eval: {n_eval} examples ({np_eval} plan, {len(stats['eval']['nudges'])} nudge)\n"
            f"train.jsonl sha256: {sha}\n")
        print(f"wrote {HERE / 'READY'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
``````

### `ml/publish.sh`

<!-- FILE: ml/publish.sh sha256=4b6845d13bf37f080c8550586eeed0b42ed8ff6b2b03c6195547b850c2ec4271 nl=1 -->
``````bash
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
``````

### `ml/run_mac.sh`

<!-- FILE: ml/run_mac.sh sha256=b8f7994a2f40ce003ac34cdbc7b3d1e714c8669a23bd3407ef007a6d2fd189e3 nl=1 -->
``````bash
#!/usr/bin/env bash
# One command: train -> merge -> GGUF -> Q4_K_M -> eval, on an Apple Silicon Mac (PyTorch MPS).
#
#   bash ml/run_mac.sh                 # everything; finished steps are skipped on re-run
#   FORCE=1 bash ml/run_mac.sh         # redo all steps
#   DRY_RUN=1 bash ml/run_mac.sh       # only set up + time a few steps and print the ETA
#   TRAIN_ARGS="--max-len 768 --grad-checkpointing" bash ml/run_mac.sh   # extra flags for train_lora.py
#   SKIP_EVAL=1 / SKIP_BASE=1          # skip eval / skip converting the base model for comparison
#   BASE=mit bash ml/run_mac.sh        # train the LoRA on top of MIT's weight-space edit
#                                      # (RikiyaT/Qwen3.5-0.8B-weight-space-programming); the eval then also
#                                      # converts that checkpoint and compares base / mit-edit / tuned.
#                                      # BASE takes an HF id or local path too; default Qwen/Qwen3.5-0.8B.
#
# Untested end to end in the authoring sandbox - see ml/README.md.
set -euo pipefail

ML_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$ML_DIR/.venv"
OUT="$ML_DIR/out"
DONE="$OUT/.done"
TRAIN_ARGS="${TRAIN_ARGS:-}"
QWEN_BASE="Qwen/Qwen3.5-0.8B"
MIT_BASE="RikiyaT/Qwen3.5-0.8B-weight-space-programming"
BASE="${BASE:-$QWEN_BASE}"
case "$(printf '%s' "$BASE" | tr '[:upper:]' '[:lower:]')" in
  qwen|base) BASE="$QWEN_BASE" ;;
  mit|wsp)   BASE="$MIT_BASE" ;;
esac
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

echo "    base model: $BASE"

step "3/7" "Timing a few steps (ETA)"
# shellcheck disable=SC2086
"$PY" "$ML_DIR/train/train_lora.py" --base "$BASE" --dry-run $TRAIN_ARGS
if [[ -n "${DRY_RUN:-}" ]]; then echo; echo "DRY_RUN set - stopping here."; exit 0; fi

step "4/7" "Training LoRA + merging (loss on assistant tokens only)"
# a merged model trained on a different base does not count as done
SAME_BASE=0
if [[ -f "$OUT/merged/bloop_merge_info.json" ]] && grep -qF "\"base_model\": \"$BASE\"" "$OUT/merged/bloop_merge_info.json"; then SAME_BASE=1; fi
if finished train && [[ -f "$OUT/merged/config.json" && "$SAME_BASE" == "1" ]]; then skip "training"; else
  # shellcheck disable=SC2086
  "$PY" "$ML_DIR/train/train_lora.py" --base "$BASE" $TRAIN_ARGS
  mark train
  rm -f "$OUT/bloop-qwen3.5-0.8b-Q4_K_M.gguf" "$DONE/eval"   # the old GGUF/eval belong to the previous run
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
  if [[ "$BASE" == "$MIT_BASE" && ! -f "$OUT/mit-qwen3.5-0.8b-Q4_K_M.gguf" ]]; then
    echo "    preparing MIT's weight-space edit (the LoRA's base) for the side-by-side eval ..."
    "$PY" -c "from huggingface_hub import snapshot_download; snapshot_download('$MIT_BASE', local_dir='$ML_DIR/cache/mit', allow_patterns=['*.json','*.safetensors','*.txt','*.jinja','*.model'])"
    bash "$ML_DIR/train/convert_quantize.sh" --src "$ML_DIR/cache/mit" --name mit
  fi
fi
mark gguf

step "6/7" "Evaluation (base [/ mit-edit] vs tuned, with and without JSON grammar)"
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
  * Try it now in Bloop:  Settings -> AI -> Use Local -> Bloop model -> Import .gguf...  and pick the .gguf above.
  * Ship it in the app:   npm run model:bundle -- <file.gguf>   then   npm run build
  * Try it in Ollama:     cd ml && ollama create bloop -f Modelfile && ollama run bloop
  * Publish for everyone: hf auth login && bash ml/publish.sh <your-hf-username>
                          (prints BLOOP_MODEL_URL / BLOOP_MODEL_SHA256 / BLOOP_MODEL_BYTES for src/main/ai/local/bloop.ts)
MSG
``````

### `ml/train/convert_quantize.sh`

<!-- FILE: ml/train/convert_quantize.sh sha256=03afef565ed53df65ced7cfd6f7129d51bf6989b79fc02c33bca7b6c938c645e nl=1 -->
``````bash
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
``````

### `ml/train/eval.py`

<!-- FILE: ml/train/eval.py sha256=bc1eac5c41945fdf4cfc144002c1e27f3999dcffdae0fcf713b5fae3b16b5cd5 nl=1 -->
``````python
#!/usr/bin/env python3
"""Evaluate the base and tuned Bloop GGUFs on ml/data/eval.jsonl with llama.cpp's llama-server.

Up to four variants are compared, in this order (each is skipped when its GGUF does not exist):
  base        untouched Qwen/Qwen3.5-0.8B                       --base-gguf
  mit-edit    MIT's weight-space edit of the base               --mit-gguf
  tuned       the Bloop LoRA (on whichever base it was trained)  --tuned-gguf
  tuned+edit  the Bloop LoRA + a weight-space edit (ml/wsp)      --tuned-edit-gguf
By default only base + tuned exist, which is the original behaviour.

For every model it runs the plan prompts twice (free generation, and with a JSON-schema grammar) and the
nudge prompts once, then writes ml/eval/REPORT.md (+ results.json) and fills the table in ml/MODEL_CARD.md.

    python ml/train/eval.py --base-gguf ml/out/base-qwen3.5-0.8b-Q4_K_M.gguf \
                            --tuned-gguf ml/out/bloop-qwen3.5-0.8b-Q4_K_M.gguf

Only the stdlib is needed. Untested end to end (no llama.cpp in the authoring sandbox); scoring.py is unit-tested.
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import scoring as S  # noqa: E402

ML_DIR = Path(__file__).resolve().parent.parent
VARIANTS = ("base", "mit-edit", "tuned", "tuned+edit")
CARD_START, CARD_END = "<!-- EVAL_TABLE_START -->", "<!-- EVAL_TABLE_END -->"


def select_variants(paths: dict, exists=os.path.exists, skip: tuple = ()) -> tuple[list, list]:
    """Pure: ([(name, path)] in VARIANTS order for existing files, [(name, path)] missing). Unknown names last."""
    order = [v for v in VARIANTS if v in paths] + [v for v in paths if v not in VARIANTS]
    present, missing = [], []
    for name in order:
        path = paths[name]
        if name in skip or not path:
            continue
        (present if exists(path) else missing).append((name, path))
    return present, missing


def present_variants(results: dict) -> list:
    return [v for v in VARIANTS if v in results] + [v for v in results if v not in VARIANTS]


def find_server(explicit: str | None) -> str:
    cands = [explicit] if explicit else []
    cands += [str(ML_DIR / "cache" / "llama.cpp" / "build" / "bin" / "llama-server"), shutil.which("llama-server") or ""]
    for c in cands:
        if c and Path(c).exists():
            return c
    raise SystemExit("llama-server not found. Run ml/train/convert_quantize.sh first (it builds it) or pass --server-bin.")


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Server:
    def __init__(self, binary: str, gguf: str, ctx: int, ngl: int, log: Path):
        self.port = free_port()
        self.url = f"http://127.0.0.1:{self.port}"
        cmd = [binary, "-m", gguf, "--host", "127.0.0.1", "--port", str(self.port), "-c", str(ctx), "-ngl", str(ngl), "--jinja"]
        self.log = open(log, "w")
        self.proc = subprocess.Popen(cmd, stdout=self.log, stderr=subprocess.STDOUT)

    def wait_ready(self, timeout: float = 300) -> None:
        t0 = time.time()
        while time.time() - t0 < timeout:
            if self.proc.poll() is not None:
                raise SystemExit(f"llama-server exited early (code {self.proc.returncode}); see {self.log.name}")
            try:
                with urllib.request.urlopen(self.url + "/health", timeout=2) as r:
                    if r.status == 200:
                        return
            except (urllib.error.URLError, ConnectionError, OSError):
                pass
            time.sleep(1)
        raise SystemExit("llama-server did not become healthy in time")

    def chat(self, messages: list[dict], max_tokens: int, temperature: float, seed: int, schema: dict | None) -> tuple[str, float]:
        body: dict = {"messages": messages, "max_tokens": max_tokens, "temperature": temperature, "seed": seed, "stream": False}
        if schema is not None:
            body["response_format"] = {"type": "json_schema", "json_schema": {"name": "plan", "strict": True, "schema": schema}}
        req = urllib.request.Request(self.url + "/v1/chat/completions", data=json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json"})
        t0 = time.time()
        with urllib.request.urlopen(req, timeout=600) as r:
            data = json.load(r)
        dt = time.time() - t0
        return (data["choices"][0]["message"].get("content") or ""), dt

    def stop(self) -> None:
        self.proc.terminate()
        try:
            self.proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            self.proc.kill()
        self.log.close()


def load_eval(path: Path, limit: int) -> list[dict]:
    items = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        msgs = json.loads(line)["messages"]
        prompt_msgs = msgs[:-1]
        user = next((m["content"] for m in reversed(prompt_msgs) if m["role"] == "user"), "")
        items.append({"messages": prompt_msgs, "prompt": user, "reference": msgs[-1]["content"],
                      "kind": "plan" if S.is_plan_prompt(user) else "nudge"})
    if limit:  # keep the plan/nudge mix: take the first `limit` of each kind
        out, seen = [], {"plan": 0, "nudge": 0}
        for it in items:
            if seen[it["kind"]] < limit:
                out.append(it)
                seen[it["kind"]] += 1
        items = out
    return items


def run_model(name: str, gguf: str, items: list[dict], args, binary: str, log_dir: Path) -> dict:
    print(f"\n=== {name}: {gguf}")
    srv = Server(binary, gguf, args.ctx, args.ngl, log_dir / f"server-{name}.log")
    result: dict = {"gguf": gguf, "size_bytes": Path(gguf).stat().st_size, "modes": {}}
    try:
        srv.wait_ready()
        latencies: list[float] = []
        for mode in ("free", "grammar"):
            plan_scores, samples = [], []
            for i, it in enumerate(i for i in items if i["kind"] == "plan"):
                text, dt = srv.chat(it["messages"], args.max_tokens, args.temperature, args.seed + i,
                                    S.PLAN_SCHEMA if mode == "grammar" else None)
                latencies.append(dt)
                sc = S.score_plan(text, it["prompt"])
                plan_scores.append(sc)
                if len(samples) < args.samples:
                    samples.append({"prompt_tail": it["prompt"][-200:], "output": text, "score": sc, "latency_s": round(dt, 2)})
                print(f"  [{name}/{mode}] plan {i + 1}: parsed={sc['parsed']} valid={sc['schema_valid']} rules={sc['all_rules']} {dt:.1f}s")
            result["modes"][mode] = {"plans": S.aggregate_plans(plan_scores), "plan_samples": samples}
        nud_scores, nud_samples = [], []
        for i, it in enumerate(i for i in items if i["kind"] == "nudge"):
            text, dt = srv.chat(it["messages"], 120, args.temperature, args.seed + i, None)
            latencies.append(dt)
            sc = S.score_nudge(text)
            nud_scores.append(sc)
            if len(nud_samples) < args.samples:
                nud_samples.append({"prompt_tail": it["prompt"][-200:], "output": text, "score": sc, "latency_s": round(dt, 2)})
        result["nudges"] = {**S.aggregate_nudges(nud_scores), "samples": nud_samples}
        result["avg_latency_s"] = sum(latencies) / len(latencies) if latencies else None
    finally:
        srv.stop()
    return result


def table(results: dict) -> str:
    cols = [(m, mode) for m in present_variants(results) for mode in ("free", "grammar")]
    head = "| Metric | " + " | ".join(f"{m} / {'grammar' if mo == 'grammar' else 'free'}" for m, mo in cols) + " |"
    sep = "|---|" + "---|" * len(cols)
    rows = []

    def row(label, fn):
        rows.append(f"| {label} | " + " | ".join(fn(results[m], mo) for m, mo in cols) + " |")

    plan = lambda r, mo: r["modes"][mo]["plans"]
    row("Plans evaluated (n)", lambda r, mo: str(plan(r, mo)["n"]))
    row("Plan JSON parse rate", lambda r, mo: S.pct(plan(r, mo)["parse_rate"]))
    row("Clean JSON only (no fences/prose)", lambda r, mo: S.pct(plan(r, mo)["clean_json_rate"]))
    row("Schema-valid rate", lambda r, mo: S.pct(plan(r, mo)["schema_valid_rate"]))
    row("Rule: 3-10 blocks", lambda r, mo: S.pct(plan(r, mo)["blocks_3_10"]))
    row("Rule: within 08:00-22:00", lambda r, mo: S.pct(plan(r, mo)["hours_ok"]))
    row("Rule: blocks before deadline weekday", lambda r, mo: S.pct(plan(r, mo)["before_deadline"]))
    row("Rule: minutes ~ pomodoro multiples", lambda r, mo: S.pct(plan(r, mo)["pomodoro_ok"]))
    row("All rules pass (of all plans)", lambda r, mo: S.pct(plan(r, mo)["all_rules"]))
    row("Nudge <= 60 chars", lambda r, mo: S.pct(r["nudges"]["le60_rate"]) if mo == "free" else "n/a (no grammar)")
    row("Avg latency per request (s)", lambda r, mo: f"{r['avg_latency_s']:.1f}" if r.get("avg_latency_s") is not None else "n/a")
    return "\n".join([head, sep, *rows])


def write_report(results: dict, args, path: Path) -> str:
    tbl = table(results)
    lines = ["# Bloop model evaluation", "",
             f"Generated {time.strftime('%Y-%m-%d %H:%M')} on {platform.platform()} (llama.cpp llama-server, temperature {args.temperature}).",
             f"Eval file: `{args.eval_file}`.", "",
             "`free` = unconstrained generation; `grammar` = JSON-schema constrained decoding (plan prompts only).",
             "Rule checks are computed over schema-valid plans; the last rule row counts unparseable replies as failures.", "",
             "## Side-by-side", "", tbl, "", "## Files", ""]
    for m in present_variants(results):
        if m in results:
            lines.append(f"- {m}: `{results[m]['gguf']}` ({results[m]['size_bytes'] / 1e6:.0f} MB)")
    lines += ["", "## Samples", ""]
    for m in present_variants(results):
        if m not in results:
            continue
        for mode in ("free", "grammar"):
            for s in results[m]["modes"][mode]["plan_samples"][: args.samples]:
                lines += [f"### {m} / {mode} / plan ({s['latency_s']}s, valid={s['score']['schema_valid']}, rules={s['score']['all_rules']})",
                          "```", s["output"].strip()[:1500], "```", ""]
        for s in results[m]["nudges"]["samples"][: args.samples]:
            lines += [f"### {m} / nudge ({s['latency_s']}s, {s['score']['len']} chars)", "```", s["output"].strip(), "```", ""]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")
    return tbl


def update_model_card(card: Path, tbl: str) -> None:
    if not card.exists():
        return
    txt = card.read_text(encoding="utf-8")
    if CARD_START not in txt or CARD_END not in txt:
        print(f"[card] markers not found in {card}; skipped")
        return
    a, b = txt.index(CARD_START), txt.index(CARD_END)
    card.write_text(txt[: a + len(CARD_START)] + "\n" + tbl + "\n" + txt[b:], encoding="utf-8")
    print(f"[card] eval table written to {card}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base-gguf", default=str(ML_DIR / "out" / "base-qwen3.5-0.8b-Q4_K_M.gguf"))
    ap.add_argument("--tuned-gguf", default=str(ML_DIR / "out" / "bloop-qwen3.5-0.8b-Q4_K_M.gguf"))
    ap.add_argument("--mit-gguf", default=str(ML_DIR / "out" / "mit-qwen3.5-0.8b-Q4_K_M.gguf"),
                    help="MIT's weight-space edit of the base (convert_quantize.sh --name mit); skipped if missing")
    ap.add_argument("--tuned-edit-gguf", default=str(ML_DIR / "out" / "bloop-edit-qwen3.5-0.8b-Q4_K_M.gguf"),
                    help="Bloop LoRA + weight-space edit (ml/wsp, convert_quantize.sh --name bloop-edit); skipped if missing")
    ap.add_argument("--eval-file", default=str(ML_DIR / "data" / "eval.jsonl"))
    ap.add_argument("--report", default=str(ML_DIR / "eval" / "REPORT.md"))
    ap.add_argument("--model-card", default=str(ML_DIR / "MODEL_CARD.md"))
    ap.add_argument("--server-bin", default=None)
    ap.add_argument("--limit", type=int, default=0, help="max examples per kind (plan/nudge); 0 = all")
    ap.add_argument("--max-tokens", type=int, default=1024)
    ap.add_argument("--temperature", type=float, default=0.2)
    ap.add_argument("--ctx", type=int, default=4096)
    ap.add_argument("--ngl", type=int, default=99, help="GPU layers (ignored by CPU-only builds)")
    ap.add_argument("--samples", type=int, default=2)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--skip-base", action="store_true")
    ap.add_argument("--skip-mit", action="store_true")
    ap.add_argument("--skip-tuned-edit", action="store_true")
    args = ap.parse_args()

    items = load_eval(Path(args.eval_file), args.limit)
    n_plan = sum(1 for i in items if i["kind"] == "plan")
    print(f"[eval] {len(items)} examples ({n_plan} plan, {len(items) - n_plan} nudge)")
    binary = find_server(args.server_bin)
    report = Path(args.report)
    log_dir = report.parent
    log_dir.mkdir(parents=True, exist_ok=True)

    skip = tuple(n for n, flag in (("base", args.skip_base), ("mit-edit", args.skip_mit),
                                   ("tuned+edit", args.skip_tuned_edit)) if flag)
    present, missing = select_variants({"base": args.base_gguf, "mit-edit": args.mit_gguf, "tuned": args.tuned_gguf,
                                        "tuned+edit": args.tuned_edit_gguf}, skip=skip)
    for name, path in missing:
        if name == "base":
            print(f"[eval] base GGUF missing ({path}); skipping base")
        elif name != "tuned":
            print(f"[eval] ({name} not found at {path}; skipped)")
    names = [n for n, _ in present]
    if "tuned" not in names and not any(n in names for n in ("mit-edit", "tuned+edit")):
        raise SystemExit(f"tuned GGUF not found: {args.tuned_gguf}")
    print(f"[eval] variants: {', '.join(names)}")
    results: dict = {}
    for name, path in present:
        results[name] = run_model(name, path, items, args, binary, log_dir)

    (log_dir / "results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    tbl = write_report(results, args, report)
    update_model_card(Path(args.model_card), tbl)
    print("\n" + tbl + f"\n\nReport: {report}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
``````

### `ml/train/requirements.txt`

<!-- FILE: ml/train/requirements.txt sha256=d19d181d2f7f71fc1da7837d82b325d89d58c341701a29d09c3691fb8d683ed4 nl=1 -->
``````text
# Training stack for the Bloop model (Apple Silicon MPS / CUDA / CPU).
# Qwen3.5 needs a recent transformers (native qwen3_5 architecture); these are lower bounds with a major-version cap.
# torch: on Colab the preinstalled torch is used; on a Mac pip installs the default arm64 wheel (MPS included).
torch>=2.8
transformers>=5.2,<6
peft>=0.17
datasets>=4.0
accelerate>=1.10
huggingface_hub>=1.0
safetensors>=0.5
sentencepiece
protobuf
numpy
``````

### `ml/train/scoring.py`

<!-- FILE: ml/train/scoring.py sha256=ec87bcfdcaaf52baf35781b433fa064bca957e5a42f1bb9dba5266063b3e2422 nl=1 -->
``````python
"""Pure (stdlib-only) scoring helpers for the Bloop model evaluation.

Two kinds of prompts exist in the dataset:
  * plan prompts  - the study-plan prompt from src/main/plan.ts (asks for a JSON object)
  * nudge prompts - everything else (short encouraging line, <= 60 chars)

All functions are deterministic and unit-tested in test_scoring.py.
"""
from __future__ import annotations

import json
import re
from datetime import date, datetime
from typing import Any, Optional

NUDGE_MAX_CHARS = 60
DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
MONTHS = {m: i for i, m in enumerate(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}

# JSON schema used for grammar-constrained decoding (llama.cpp converts it to a GBNF grammar).
PLAN_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "blocks": {
            "type": "array",
            "minItems": 3,
            "maxItems": 10,
            "items": {
                "type": "object",
                "properties": {
                    "day": {"type": "integer", "minimum": 0, "maximum": 6},
                    "time": {"type": "string", "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$"},
                    "minutes": {"type": "integer", "minimum": 5, "maximum": 240},
                    "label": {"type": "string"},
                },
                "required": ["day", "time", "minutes", "label"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["summary", "blocks"],
    "additionalProperties": False,
}


# --------------------------------------------------------------------------- JSON extraction
def extract_json(text: str) -> Any:
    """Mirror of extractJson() in src/main/plan.ts: strip a code fence, take first '{' .. last '}'."""
    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    body = m.group(1) if m else text
    start, end = body.find("{"), body.rfind("}")
    if start == -1 or end <= start:
        raise ValueError("no JSON object in response")
    return json.loads(body[start : end + 1])


def try_extract_json(text: str) -> Optional[Any]:
    try:
        return extract_json(text)
    except (ValueError, json.JSONDecodeError):
        return None


def is_clean_json(text: str) -> bool:
    """True when the whole reply is exactly one JSON object (no fences, no prose)."""
    try:
        return isinstance(json.loads(text.strip()), dict)
    except (ValueError, json.JSONDecodeError):
        return False


# --------------------------------------------------------------------------- schema
def _is_int(v: Any) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def _is_num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def parse_hhmm(s: Any) -> Optional[int]:
    """'HH:MM' -> minutes since midnight, or None if malformed."""
    if not isinstance(s, str):
        return None
    m = re.fullmatch(r"(\d{1,2}):(\d{2})", s.strip())
    if not m:
        return None
    h, mm = int(m.group(1)), int(m.group(2))
    if h > 23 or mm > 59:
        return None
    return h * 60 + mm


def schema_errors(plan: Any) -> list[str]:
    """Structural validation matching what parsePlan() in plan.ts needs. Empty list == valid."""
    errs: list[str] = []
    if not isinstance(plan, dict):
        return ["top level is not an object"]
    if not isinstance(plan.get("summary"), str) or not plan["summary"].strip():
        errs.append("summary missing or not a non-empty string")
    blocks = plan.get("blocks")
    if not isinstance(blocks, list) or not blocks:
        errs.append("blocks missing or empty")
        return errs
    for i, b in enumerate(blocks):
        if not isinstance(b, dict):
            errs.append(f"blocks[{i}] not an object")
            continue
        if not _is_int(b.get("day")) or not 0 <= b["day"] <= 6:
            errs.append(f"blocks[{i}].day must be an integer 0-6")
        if parse_hhmm(b.get("time")) is None:
            errs.append(f"blocks[{i}].time must be HH:MM")
        if not _is_num(b.get("minutes")) or b["minutes"] <= 0:
            errs.append(f"blocks[{i}].minutes must be a positive number")
        if not isinstance(b.get("label"), str) or not b["label"].strip():
            errs.append(f"blocks[{i}].label must be a non-empty string")
    return errs


def is_schema_valid(plan: Any) -> bool:
    return not schema_errors(plan)


# --------------------------------------------------------------------------- prompt context
def is_plan_prompt(prompt: str) -> bool:
    p = prompt.lower()
    return "study plan" in p and ("json" in p or '"blocks"' in p)


_DATE_JS = re.compile(r"\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,? (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* (\d{1,2}),? (\d{4})")
_DATE_ISO = re.compile(r"(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)")


def find_date(line: str) -> Optional[date]:
    """First date in a line: JS Date.toString() style ('Tue Nov 10 2026 ...') or ISO ('2026-11-10')."""
    m = _DATE_JS.search(line)
    if m:
        try:
            return date(int(m.group(3)), MONTHS[m.group(1)], int(m.group(2)))
        except ValueError:
            return None
    m = _DATE_ISO.search(line)
    if m:
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            return None
    return None


def parse_context(prompt: str) -> dict:
    """Pull today's date/weekday, pomodoro/break minutes and deadlines out of a plan prompt."""
    ctx: dict = {"today": None, "today_dow": None, "pomodoro": 25, "break": 5, "deadlines": []}
    m = re.search(r"Today is (Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)([^\n]*)", prompt)
    if m:
        ctx["today_dow"] = DAY_NAMES.index(m.group(1))
        ctx["today"] = find_date(m.group(2))
    m = re.search(r"uses (?:a )?(\d+)[- ]minute pomodoro", prompt)
    if m:
        ctx["pomodoro"] = int(m.group(1))
    m = re.search(r"(\d+)[- ]minute breaks", prompt)
    if m:
        ctx["break"] = int(m.group(1))
    sec = re.search(r"Upcoming deadlines:\n([\s\S]*?)\n\s*\n", prompt)
    if sec:
        for line in sec.group(1).splitlines():
            line = line.strip()
            if not line.startswith("-") or "no upcoming deadlines" in line:
                continue
            d = find_date(line)
            if d:
                ctx["deadlines"].append({"line": line, "date": d, "exam": "(EXAM)" in line})
    if ctx["today"] is None:  # fall back to the earliest known anchor: weekday only
        pass
    return ctx


# --------------------------------------------------------------------------- rule checks
def check_block_count(plan: dict) -> bool:
    b = plan.get("blocks") if isinstance(plan, dict) else None
    return isinstance(b, list) and 3 <= len(b) <= 10


def check_hours(plan: dict, lo: int = 8 * 60, hi: int = 22 * 60) -> bool:
    """Every block starts at/after 08:00 and ends at/before 22:00."""
    for b in plan.get("blocks", []):
        start = parse_hhmm(b.get("time"))
        mins = b.get("minutes")
        if start is None or not _is_num(mins):
            return False
        if start < lo or start + mins > hi:
            return False
    return True


def deadline_offsets(ctx: dict) -> list[int]:
    """Days from today (0-6) for deadlines that fall inside the 7-day planning window."""
    if ctx.get("today") is None:
        return []
    return [o for o in ((d["date"] - ctx["today"]).days for d in ctx["deadlines"]) if 0 <= o <= 6]


def check_before_deadline(plan: dict, ctx: dict) -> Optional[bool]:
    """No block lies after the last in-window deadline's weekday. None when not applicable."""
    offs = deadline_offsets(ctx)
    if not offs or ctx.get("today_dow") is None:
        return None
    last = max(offs)
    for b in plan.get("blocks", []):
        day = b.get("day")
        if not _is_int(day):
            return False
        if (day - ctx["today_dow"]) % 7 > last:
            return False
    return True


def minutes_ok(minutes: Any, pomodoro: int, brk: int = 5) -> bool:
    """Roughly a multiple of the pomodoro length (or of focus+break)."""
    if not _is_num(minutes) or minutes <= 0 or pomodoro <= 0:
        return False
    for unit in {pomodoro, pomodoro + brk}:
        k = round(minutes / unit)
        if k >= 1 and abs(minutes - k * unit) <= max(5, 0.2 * unit):
            return True
    return False


def check_pomodoro(plan: dict, ctx: dict) -> bool:
    return all(minutes_ok(b.get("minutes"), ctx.get("pomodoro", 25), ctx.get("break", 5)) for b in plan.get("blocks", []))


def score_plan(text: str, prompt: str) -> dict:
    """Score one model reply to a plan prompt. Rule fields are None when the plan could not be checked."""
    ctx = parse_context(prompt)
    obj = try_extract_json(text)
    res: dict = {"parsed": obj is not None, "clean_json": is_clean_json(text), "schema_valid": False,
                 "blocks_3_10": None, "hours_ok": None, "before_deadline": None, "pomodoro_ok": None,
                 "all_rules": None, "errors": []}
    if obj is None:
        return res
    errs = schema_errors(obj)
    res["errors"] = errs
    res["schema_valid"] = not errs
    if errs:
        return res
    res["blocks_3_10"] = check_block_count(obj)
    res["hours_ok"] = check_hours(obj)
    res["before_deadline"] = check_before_deadline(obj, ctx)
    res["pomodoro_ok"] = check_pomodoro(obj, ctx)
    res["all_rules"] = all(res[k] is not False for k in ("blocks_3_10", "hours_ok", "before_deadline", "pomodoro_ok"))
    return res


def score_nudge(text: str) -> dict:
    t = text.strip()
    return {"nonempty": bool(t), "single_line": "\n" not in t, "len": len(t), "le60": bool(t) and len(t) <= NUDGE_MAX_CHARS}


# --------------------------------------------------------------------------- aggregation
def rate(values: list[Optional[bool]]) -> Optional[float]:
    """Share of True among non-None values; None when nothing applies."""
    vs = [v for v in values if v is not None]
    return (sum(1 for v in vs if v) / len(vs)) if vs else None


def aggregate_plans(results: list[dict]) -> dict:
    n = len(results)
    return {
        "n": n,
        "parse_rate": rate([r["parsed"] for r in results]),
        "clean_json_rate": rate([r["clean_json"] for r in results]),
        "schema_valid_rate": rate([r["schema_valid"] for r in results]),
        "blocks_3_10": rate([r["blocks_3_10"] for r in results]),
        "hours_ok": rate([r["hours_ok"] for r in results]),
        "before_deadline": rate([r["before_deadline"] for r in results]),
        "pomodoro_ok": rate([r["pomodoro_ok"] for r in results]),
        # strict: counted over ALL plans, so unparseable replies count as failures
        "all_rules": rate([bool(r["all_rules"]) for r in results]),
    }


def aggregate_nudges(results: list[dict]) -> dict:
    return {"n": len(results), "le60_rate": rate([r["le60"] for r in results]),
            "single_line_rate": rate([r["single_line"] for r in results])}


def pct(x: Optional[float]) -> str:
    return "n/a" if x is None else f"{100 * x:.0f}%"
``````

### `ml/train/test_eval_helpers.py`

<!-- FILE: ml/train/test_eval_helpers.py sha256=8b3487997af7270f03c00459ffe8fe866210c439a4751be8a00a9f19a7ea3630 nl=1 -->
``````python
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import eval as E  # noqa: E402  (stdlib only)


def fake_result(name):
    plans = {"n": 2, "parse_rate": 1.0, "clean_json_rate": 0.5, "schema_valid_rate": 1.0, "blocks_3_10": 1.0,
             "hours_ok": 1.0, "before_deadline": None, "pomodoro_ok": 0.5, "all_rules": 0.5}
    mode = {"plans": plans, "plan_samples": []}
    return {"gguf": f"{name}.gguf", "size_bytes": 5e8, "modes": {"free": mode, "grammar": mode},
            "nudges": {"n": 2, "le60_rate": 1.0, "single_line_rate": 1.0, "samples": []}, "avg_latency_s": 1.0}


class VariantTests(unittest.TestCase):
    PATHS = {"base": "b.gguf", "mit-edit": "m.gguf", "tuned": "t.gguf", "tuned+edit": "te.gguf"}

    def test_default_is_base_and_tuned(self):
        present, missing = E.select_variants(self.PATHS, exists=lambda p: p in ("b.gguf", "t.gguf"))
        self.assertEqual(present, [("base", "b.gguf"), ("tuned", "t.gguf")])
        self.assertEqual([n for n, _ in missing], ["mit-edit", "tuned+edit"])

    def test_all_four_in_order_and_skip(self):
        shuffled = dict(reversed(list(self.PATHS.items())))
        present, _ = E.select_variants(shuffled, exists=lambda p: True)
        self.assertEqual([n for n, _ in present], ["base", "mit-edit", "tuned", "tuned+edit"])
        present, _ = E.select_variants(self.PATHS, exists=lambda p: True, skip=("base", "mit-edit"))
        self.assertEqual([n for n, _ in present], ["tuned", "tuned+edit"])

    def test_table_columns(self):
        res = {n: fake_result(n) for n in ("tuned", "base", "tuned+edit")}
        self.assertEqual(E.present_variants(res), ["base", "tuned", "tuned+edit"])
        head = E.table(res).splitlines()[0]
        self.assertEqual(head.count("/ free"), 3)
        self.assertLess(head.index("base / free"), head.index("tuned / free"))
        self.assertLess(head.index("tuned / grammar"), head.index("tuned+edit / free"))


if __name__ == "__main__":
    unittest.main()
``````

### `ml/train/test_scoring.py`

<!-- FILE: ml/train/test_scoring.py sha256=1b79b62033851fce5836e9e374257ea1c771bb15481689914fe457182d4b782a nl=1 -->
``````python
import sys
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import scoring as S  # noqa: E402

PROMPT = """You are a friendly study coach inside a desktop "study pet" app for a university student.
Today is Wednesday Wed Nov 04 2026 10:00:00 GMT+0100 (CET).

Upcoming deadlines:
- Calculus midterm (EXAM): Mon Nov 09 2026 09:00:00 GMT+0100 (CET)
- Essay draft: Fri Nov 20 2026 23:59:00 GMT+0100 (CET)

Focus history for the last 7 days (score 0-100 = share of time on study apps/sites):
- 2026-11-03: 2 sessions, 50 focused min, avg score 80

The student uses 25-minute pomodoros with 5-minute breaks.

Create a realistic study plan for the next 7 days ... Use 3-10 blocks.
Reply with ONLY a JSON object, no markdown fences, in exactly this shape:
{"summary": "...", "blocks": [{"day": 0, "time": "HH:MM", "minutes": 25, "label": "x"}]}"""

GOOD = {"summary": "You got this!", "blocks": [
    {"day": 3, "time": "09:00", "minutes": 50, "label": "Limits"},
    {"day": 4, "time": "10:00", "minutes": 75, "label": "Derivatives"},
    {"day": 5, "time": "14:00", "minutes": 25, "label": "Practice"},
    {"day": 6, "time": "09:30", "minutes": 100, "label": "Integrals"},
    {"day": 0, "time": "15:00", "minutes": 50, "label": "Past paper"}]}


def plan(blocks, summary="ok"):
    return {"summary": summary, "blocks": blocks}


class Json(unittest.TestCase):
    def test_fenced_and_prose(self):
        self.assertEqual(S.extract_json('Sure!\n```json\n{"a": 1}\n```'), {"a": 1})
        self.assertEqual(S.extract_json('blah {"a": {"b": 2}} trailing'), {"a": {"b": 2}})

    def test_failures(self):
        self.assertIsNone(S.try_extract_json("no json here"))
        self.assertIsNone(S.try_extract_json('{"a": '))

    def test_clean(self):
        self.assertTrue(S.is_clean_json(' {"a": 1}\n'))
        self.assertFalse(S.is_clean_json('```json\n{"a": 1}\n```'))
        self.assertFalse(S.is_clean_json("[1]"))


class Schema(unittest.TestCase):
    def test_valid(self):
        self.assertTrue(S.is_schema_valid(GOOD))

    def test_invalid(self):
        self.assertFalse(S.is_schema_valid([]))
        self.assertFalse(S.is_schema_valid({"summary": "x"}))
        self.assertFalse(S.is_schema_valid(plan([{"day": 7, "time": "09:00", "minutes": 25, "label": "a"}])))
        self.assertFalse(S.is_schema_valid(plan([{"day": 1, "time": "9am", "minutes": 25, "label": "a"}])))
        self.assertFalse(S.is_schema_valid(plan([{"day": True, "time": "09:00", "minutes": 25, "label": "a"}])))
        self.assertFalse(S.is_schema_valid(plan([{"day": 1, "time": "09:00", "minutes": 0, "label": "a"}])))
        self.assertFalse(S.is_schema_valid(plan([{"day": 1, "time": "09:00", "minutes": 25, "label": ""}])))
        self.assertFalse(S.is_schema_valid(plan([], "x")))

    def test_hhmm(self):
        self.assertEqual(S.parse_hhmm("08:30"), 510)
        self.assertEqual(S.parse_hhmm("8:05"), 485)
        self.assertIsNone(S.parse_hhmm("24:00"))
        self.assertIsNone(S.parse_hhmm(900))


class Context(unittest.TestCase):
    def test_plan_prompt_detection(self):
        self.assertTrue(S.is_plan_prompt(PROMPT))
        self.assertFalse(S.is_plan_prompt("The student drifted to YouTube for 3 minutes. Write one short nudge."))

    def test_parse(self):
        c = S.parse_context(PROMPT)
        self.assertEqual(c["today"], date(2026, 11, 4))
        self.assertEqual(c["today_dow"], 3)
        self.assertEqual((c["pomodoro"], c["break"]), (25, 5))
        self.assertEqual([d["date"] for d in c["deadlines"]], [date(2026, 11, 9), date(2026, 11, 20)])
        self.assertTrue(c["deadlines"][0]["exam"])
        self.assertEqual(S.deadline_offsets(c), [5])  # only the exam is inside the 7-day window

    def test_no_deadlines(self):
        c = S.parse_context(PROMPT.replace("- Calculus midterm (EXAM): Mon Nov 09 2026 09:00:00 GMT+0100 (CET)\n- Essay draft: Fri Nov 20 2026 23:59:00 GMT+0100 (CET)", "- (no upcoming deadlines found)"))
        self.assertEqual(c["deadlines"], [])

    def test_iso_dates(self):
        self.assertEqual(S.find_date("- Quiz: 2026-11-06T09:00"), date(2026, 11, 6))


class Rules(unittest.TestCase):
    def test_block_count(self):
        self.assertTrue(S.check_block_count(GOOD))
        self.assertFalse(S.check_block_count(plan(GOOD["blocks"][:2])))
        self.assertFalse(S.check_block_count(plan(GOOD["blocks"] * 3)))

    def test_hours(self):
        self.assertTrue(S.check_hours(GOOD))
        self.assertFalse(S.check_hours(plan([{"day": 1, "time": "07:30", "minutes": 25, "label": "a"}])))
        self.assertFalse(S.check_hours(plan([{"day": 1, "time": "21:30", "minutes": 50, "label": "a"}])))
        self.assertTrue(S.check_hours(plan([{"day": 1, "time": "21:00", "minutes": 60, "label": "a"}])))  # ends 22:00 exactly

    def test_before_deadline(self):
        c = S.parse_context(PROMPT)  # today Wed(3), exam Mon(1) offset 5 -> Mon is the last allowed day
        self.assertTrue(S.check_before_deadline(GOOD, c))  # days 3,4,5,6,0 -> offsets 0..4
        late = plan([{"day": 2, "time": "09:00", "minutes": 25, "label": "a"}])  # Tuesday = offset 6 > 5
        self.assertFalse(S.check_before_deadline(late, c))
        on_day = plan([{"day": 1, "time": "09:00", "minutes": 25, "label": "a"}])  # Monday = offset 5
        self.assertTrue(S.check_before_deadline(on_day, c))
        none = S.parse_context("Today is Wednesday Wed Nov 04 2026\n\nUpcoming deadlines:\n- (no upcoming deadlines found)\n\nx")
        self.assertIsNone(S.check_before_deadline(GOOD, none))

    def test_pomodoro(self):
        for m in (25, 50, 75, 100, 52, 30, 60):
            self.assertTrue(S.minutes_ok(m, 25, 5), m)
        for m in (10, 40, 0, -5, "25"):
            self.assertFalse(S.minutes_ok(m, 25, 5), m)
        self.assertTrue(S.minutes_ok(90, 45, 10))

    def test_nudge(self):
        self.assertTrue(S.score_nudge("Hey, tiny step back to your notes?")["le60"])
        self.assertFalse(S.score_nudge("x" * 61)["le60"])
        self.assertTrue(S.score_nudge("x" * 60)["le60"])
        self.assertFalse(S.score_nudge("   ")["le60"])
        self.assertFalse(S.score_nudge("a\nb")["single_line"])


class EndToEnd(unittest.TestCase):
    def test_good_plan(self):
        import json
        r = S.score_plan(json.dumps(GOOD), PROMPT)
        self.assertTrue(r["parsed"] and r["clean_json"] and r["schema_valid"])
        self.assertTrue(r["all_rules"], r)

    def test_fenced_plan_not_clean(self):
        import json
        r = S.score_plan("```json\n" + json.dumps(GOOD) + "\n```", PROMPT)
        self.assertTrue(r["parsed"]); self.assertFalse(r["clean_json"]); self.assertTrue(r["schema_valid"])

    def test_garbage(self):
        r = S.score_plan("I cannot help", PROMPT)
        self.assertFalse(r["parsed"]); self.assertFalse(r["all_rules"] or False)

    def test_aggregate(self):
        import json
        bad = plan([{"day": 1, "time": "06:00", "minutes": 13, "label": "a"}] * 3)
        rs = [S.score_plan(json.dumps(GOOD), PROMPT), S.score_plan(json.dumps(bad), PROMPT), S.score_plan("nope", PROMPT)]
        a = S.aggregate_plans(rs)
        self.assertAlmostEqual(a["parse_rate"], 2 / 3)
        self.assertAlmostEqual(a["schema_valid_rate"], 2 / 3)
        self.assertAlmostEqual(a["hours_ok"], 0.5)
        self.assertAlmostEqual(a["pomodoro_ok"], 0.5)
        self.assertAlmostEqual(a["all_rules"], 1 / 3)
        self.assertEqual(S.pct(None), "n/a"); self.assertEqual(S.pct(0.5), "50%")

    def test_schema_constant(self):
        self.assertEqual(S.PLAN_SCHEMA["required"], ["summary", "blocks"])


if __name__ == "__main__":
    unittest.main()
``````

### `ml/train/test_train_helpers.py`

<!-- FILE: ml/train/test_train_helpers.py sha256=bf24414b056d5fac63be052f266973ce81bfa27d00b2afea0ab0af6835151cd2 nl=1 -->
``````python
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import train_lora as T  # noqa: E402  (imports fine without torch)


class Helpers(unittest.TestCase):
    def test_lr_schedule(self):
        lrs = [T.lr_at(s, 100, 2e-4, 5) for s in range(100)]
        self.assertAlmostEqual(lrs[0], 2e-4 / 5)
        self.assertAlmostEqual(lrs[4], 2e-4)
        self.assertTrue(all(a >= b - 1e-12 for a, b in zip(lrs[5:], lrs[6:])))
        self.assertGreaterEqual(min(lrs), 2e-5 - 1e-12)
        self.assertAlmostEqual(T.lr_at(100, 100, 2e-4, 5), 2e-5)

    def test_split(self):
        steps = T.split_batches(list(range(19)), 1, 8)
        self.assertEqual([len(s) for s in steps], [8, 8, 3])
        steps = T.split_batches(list(range(10)), 2, 2)
        self.assertEqual([[len(m) for m in s] for s in steps], [[2, 2], [2, 2], [2]])

    def test_eta_and_fmt(self):
        self.assertAlmostEqual(T.estimate_eta(1.0, 100, 30, 2, 1), 200 + 20)
        self.assertEqual(T.fmt_duration(3725), "1h 02m")
        self.assertEqual(T.fmt_duration(65), "1m 05s")
        self.assertEqual(T.fmt_duration(4), "4s")

    def test_resolve_base(self):
        self.assertEqual(T.resolve_base(""), "Qwen/Qwen3.5-0.8B")
        self.assertEqual(T.resolve_base("mit"), "RikiyaT/Qwen3.5-0.8B-weight-space-programming")
        self.assertEqual(T.resolve_base("MIT"), T.MIT_WSP_BASE)
        self.assertEqual(T.resolve_base("ml/out/merged"), "ml/out/merged")

    def test_base_flag(self):
        self.assertEqual(T.parse_args([]).model, "Qwen/Qwen3.5-0.8B")
        self.assertEqual(T.parse_args(["--base", "mit"]).model, T.MIT_WSP_BASE)
        self.assertEqual(T.parse_args(["--model", "x/y"]).model, "x/y")  # old flag still works


if __name__ == "__main__":
    unittest.main()
``````

### `ml/train/train_lora.py`

<!-- FILE: ml/train/train_lora.py sha256=f5afd709d8b08c8b6beb53595b51e246c5c795dcdb930d9e41c5d8434e7ee5c8 nl=1 -->
``````python
#!/usr/bin/env python3
"""LoRA fine-tune Qwen/Qwen3.5-0.8B (or another --base) for the Bloop model, then merge the adapter.

Usage (from the repo root, inside ml/.venv):
    python ml/train/train_lora.py --dry-run          # time a few steps, print ETA, stop
    python ml/train/train_lora.py                    # full run: train -> adapter -> merged model
    python ml/train/train_lora.py --merge-only       # re-merge an existing adapter
    python ml/train/train_lora.py --base mit         # LoRA on top of MIT's weight-space edit
                                                     # (RikiyaT/Qwen3.5-0.8B-weight-space-programming)

Devices: cuda (fp16 autocast, T4 has no bf16) -> mps (fp32 by default, --dtype bf16 optional) -> cpu.

NOTE: written without being able to run it end to end (see ml/README.md).
The pure helpers (lr schedule, ETA formatting, token masking arithmetic) do not need torch,
so this module can be imported with only the stdlib.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random
import statistics
import sys
import time
from pathlib import Path

# Must be set before torch is imported so unsupported MPS ops fall back to the CPU.
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

ML_DIR = Path(__file__).resolve().parent.parent
END_TOKEN = "<|im_end|>"

# Base checkpoints the LoRA can start from (--base / BASE=). Any other HF id or local path is accepted too.
DEFAULT_BASE = "Qwen/Qwen3.5-0.8B"
MIT_WSP_BASE = "RikiyaT/Qwen3.5-0.8B-weight-space-programming"  # MIT CSAIL weight-space edit of the base (Apache-2.0)
BASE_ALIASES = {"qwen": DEFAULT_BASE, "base": DEFAULT_BASE, "mit": MIT_WSP_BASE, "wsp": MIT_WSP_BASE}


# --------------------------------------------------------------------------- pure helpers
def lr_at(step: int, total_steps: int, base_lr: float, warmup_steps: int, min_ratio: float = 0.1) -> float:
    """Linear warmup then cosine decay to base_lr * min_ratio. `step` is 0-based (the step about to run)."""
    if total_steps <= 0:
        return base_lr
    if warmup_steps > 0 and step < warmup_steps:
        return base_lr * (step + 1) / warmup_steps
    denom = max(1, total_steps - warmup_steps)
    progress = min(1.0, max(0.0, (step - warmup_steps) / denom))
    cos = 0.5 * (1.0 + math.cos(math.pi * progress))
    return base_lr * (min_ratio + (1.0 - min_ratio) * cos)


def fmt_duration(seconds: float) -> str:
    seconds = int(round(max(0.0, seconds)))
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h}h {m:02d}m"
    if m:
        return f"{m}m {s:02d}s"
    return f"{s}s"


def split_batches(indices: list[int], micro_batch: int, accum: int) -> list[list[list[int]]]:
    """Group example indices into optimizer steps, each a list of micro-batches."""
    micros = [indices[i : i + micro_batch] for i in range(0, len(indices), micro_batch)]
    return [micros[i : i + accum] for i in range(0, len(micros), accum)]


def estimate_eta(micro_seconds: float, n_train: int, n_eval: int, epochs: int, micro_batch: int) -> float:
    """Total seconds: training micro-batches + one eval pass per epoch (forward only ~ 1/3 of train cost)."""
    train_micros = math.ceil(n_train / micro_batch) * epochs
    eval_micros = math.ceil(n_eval / micro_batch) * epochs
    return micro_seconds * train_micros + (micro_seconds / 3.0) * eval_micros


def resolve_base(name: str) -> str:
    """'qwen'/'base' -> Qwen/Qwen3.5-0.8B, 'mit'/'wsp' -> MIT's edited checkpoint; anything else unchanged."""
    name = (name or "").strip()
    if not name:
        return DEFAULT_BASE
    return BASE_ALIASES.get(name.lower(), name)


def read_jsonl(path: Path) -> list[dict]:
    rows = []
    with open(path, encoding="utf-8") as f:
        for ln, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError as e:
                raise SystemExit(f"{path}:{ln}: invalid JSON ({e})")
    return rows


# --------------------------------------------------------------------------- CLI
def parse_args(argv=None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--base", "--model", dest="model", default=DEFAULT_BASE,
                   help=f"base checkpoint: HF id or local path (default {DEFAULT_BASE}). Aliases: qwen, mit "
                        f"(= {MIT_WSP_BASE}, to train the LoRA on top of MIT's weight-space edit). --model is the old name")
    p.add_argument("--train-file", default=str(ML_DIR / "data" / "train.jsonl"))
    p.add_argument("--eval-file", default=str(ML_DIR / "data" / "eval.jsonl"))
    p.add_argument("--out-dir", default=str(ML_DIR / "out"), help="adapter/ and merged/ are created inside")
    p.add_argument("--device", choices=["auto", "cuda", "mps", "cpu"], default="auto")
    p.add_argument("--dtype", choices=["auto", "fp32", "fp16", "bf16"], default="auto",
                   help="weight dtype. auto: cuda->fp32 weights + fp16 autocast, mps->fp32, cpu->fp32")
    p.add_argument("--max-len", type=int, default=1024, help="examples longer than this (prompt+answer tokens) are dropped")
    p.add_argument("--lr", type=float, default=2e-4)
    p.add_argument("--epochs", type=int, default=2)
    p.add_argument("--warmup-ratio", type=float, default=0.05)
    p.add_argument("--min-lr-ratio", type=float, default=0.1, help="cosine floor as a fraction of --lr")
    p.add_argument("--batch-size", type=int, default=8, help="effective batch size (micro-batch * grad accumulation)")
    p.add_argument("--micro-batch", type=int, default=1, help="per-step batch; the 248k vocab makes logits big, keep small")
    p.add_argument("--weight-decay", type=float, default=0.0)
    p.add_argument("--max-grad-norm", type=float, default=1.0)
    p.add_argument("--lora-r", type=int, default=16)
    p.add_argument("--lora-alpha", type=int, default=32)
    p.add_argument("--lora-dropout", type=float, default=0.05)
    p.add_argument("--lora-targets", default="all-linear", help='"all-linear" or comma-separated module names')
    p.add_argument("--grad-checkpointing", action="store_true", help="save memory at ~30%% more time")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--enable-thinking", choices=["default", "false"], default="default",
                   help='pass enable_thinking=False to the chat template ("false") or use the template default')
    p.add_argument("--trust-remote-code", action="store_true", help="only if transformers lacks native qwen3_5 support")
    p.add_argument("--bench-steps", type=int, default=4, help="micro-batches to time before the real run (first is warmup)")
    p.add_argument("--skip-bench", action="store_true")
    p.add_argument("--dry-run", action="store_true", help="stop after the timing / ETA")
    p.add_argument("--merge-only", action="store_true", help="skip training, merge out-dir/adapter into the base model")
    p.add_argument("--no-merge", action="store_true", help="train and save the adapter only")
    p.add_argument("--max-train", type=int, default=0, help="debug: use only the first N training rows")
    p.add_argument("--max-eval", type=int, default=0, help="debug: use only the first N eval rows")
    args = p.parse_args(argv)
    args.model = resolve_base(args.model)
    return args


# --------------------------------------------------------------------------- torch-dependent parts
def pick_device(want: str):
    import torch

    if want != "auto":
        return torch.device(want)
    if torch.cuda.is_available():
        return torch.device("cuda")
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def resolve_dtypes(device, want: str):
    """Returns (weight_dtype, autocast_dtype or None)."""
    import torch

    if want == "fp32":
        return torch.float32, (torch.float16 if device.type == "cuda" else None)
    if want == "fp16":
        return torch.float16, torch.float16
    if want == "bf16":
        return torch.bfloat16, torch.bfloat16
    # auto
    if device.type == "cuda":
        return torch.float32, torch.float16  # T4: no bf16; fp32 master weights + fp16 autocast + GradScaler
    return torch.float32, None


def sync(device):
    import torch

    if device.type == "cuda":
        torch.cuda.synchronize()
    elif device.type == "mps":
        torch.mps.synchronize()


def set_seed(seed: int):
    import torch

    random.seed(seed)
    try:
        import numpy as np

        np.random.seed(seed)
    except ImportError:
        pass
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def check_linear_attention_kernels(device):
    """Qwen3.5 mixes Gated DeltaNet (linear attention) layers with full attention. transformers has a pure
    PyTorch fallback; the fused kernels from flash-linear-attention / causal-conv1d are only a CUDA speed-up."""
    have_fla = have_conv = False
    try:
        import fla  # noqa: F401

        have_fla = True
    except Exception:
        pass
    try:
        import causal_conv1d  # noqa: F401

        have_conv = True
    except Exception:
        pass
    if device.type == "cuda":
        if have_fla and have_conv:
            print("[kernels] flash-linear-attention + causal-conv1d found: fast path on.")
        else:
            print(f"[kernels] fla={have_fla} causal-conv1d={have_conv}. Missing fused kernels -> the PyTorch fallback "
                  "is used (slower but correct). Optional: pip install flash-linear-attention causal-conv1d")
    else:
        print("[kernels] non-CUDA device: the pure PyTorch linear-attention fallback is used (expected, slower).")


def load_base(model_id: str, dtype, trust: bool):
    """Qwen3.5 checkpoints are multimodal (Qwen3_5ForConditionalGeneration with a vision tower). We load that
    class first so the merged model keeps the exact architecture/keys llama.cpp's converter expects."""
    import transformers
    from transformers import AutoModelForCausalLM

    classes = []
    if hasattr(transformers, "AutoModelForImageTextToText"):
        classes.append(transformers.AutoModelForImageTextToText)
    classes.append(AutoModelForCausalLM)
    errors = []
    for cls in classes:
        for key in ("dtype", "torch_dtype"):  # `torch_dtype` was renamed `dtype` in newer transformers
            try:
                model = cls.from_pretrained(model_id, trust_remote_code=trust, **{key: dtype})
                print(f"[model] loaded with {cls.__name__} -> {type(model).__name__}")
                return model
            except TypeError as e:
                errors.append(f"{cls.__name__}({key}): {e}")
                continue
            except Exception as e:  # noqa: BLE001
                errors.append(f"{cls.__name__}: {e}")
                break
    raise SystemExit(
        "Could not load the model. Make sure transformers is new enough for Qwen3.5 "
        f"(pip install -U 'transformers>=5.2'); or pass --trust-remote-code.\n  " + "\n  ".join(errors)
    )


def build_examples(rows, tok, max_len: int, enable_thinking: str, label: str):
    """Tokenise rows into (input_ids, labels) with loss on the assistant answer only."""
    tmpl_kwargs = {"enable_thinking": False} if enable_thinking == "false" else {}
    out, dropped, bad = [], 0, 0
    shown = False
    for r in rows:
        msgs = r.get("messages")
        if not msgs or msgs[-1].get("role") != "assistant" or not any(m.get("role") == "user" for m in msgs[:-1]):
            bad += 1
            continue
        prompt_text = tok.apply_chat_template(msgs[:-1], tokenize=False, add_generation_prompt=True, **tmpl_kwargs)
        if not shown:
            tail = prompt_text[-60:].replace("\n", "\\n")
            print(f"[data] {label}: prompt template tail = ...{tail!r}")
            if "<think>" in prompt_text[-30:] and "</think>" not in prompt_text[-30:]:
                print("[data] WARNING: the generation prompt opens a <think> block. If the app runs the model in "
                      "non-thinking mode, re-run with --enable-thinking false so training matches inference.")
            shown = True
        prompt_ids = tok(prompt_text, add_special_tokens=False)["input_ids"]
        answer_ids = tok(msgs[-1]["content"].strip() + END_TOKEN, add_special_tokens=False)["input_ids"]
        if len(prompt_ids) + len(answer_ids) > max_len:
            dropped += 1
            continue
        ids = prompt_ids + answer_ids
        labels = [-100] * len(prompt_ids) + answer_ids
        out.append((ids, labels))
    if bad:
        print(f"[data] {label}: skipped {bad} malformed rows")
    if dropped:
        print(f"[data] {label}: dropped {dropped} rows longer than {max_len} tokens")
    if not out:
        raise SystemExit(f"[data] {label}: no usable examples")
    lens = [len(x[0]) for x in out]
    sup = [sum(1 for t in x[1] if t != -100) for x in out]
    print(f"[data] {label}: {len(out)} examples, tokens mean={statistics.mean(lens):.0f} max={max(lens)}, "
          f"supervised tokens mean={statistics.mean(sup):.0f}")
    return out


def collate(batch, pad_id: int, device):
    import torch

    longest = max(len(x[0]) for x in batch)
    ids = torch.full((len(batch), longest), pad_id, dtype=torch.long)
    lab = torch.full((len(batch), longest), -100, dtype=torch.long)
    att = torch.zeros((len(batch), longest), dtype=torch.long)
    for i, (a, b) in enumerate(batch):
        ids[i, : len(a)] = torch.tensor(a)
        lab[i, : len(b)] = torch.tensor(b)
        att[i, : len(a)] = 1
    return ids.to(device), att.to(device), lab.to(device)


def forward_loss(model, batch_tensors, autocast_dtype, device):
    import torch

    ids, att, lab = batch_tensors
    ctx = torch.autocast(device_type=device.type, dtype=autocast_dtype) if autocast_dtype else _nullctx()
    with ctx:
        out = model(input_ids=ids, attention_mask=att, labels=lab)
    n_tok = int((lab[:, 1:] != -100).sum().item())
    return out.loss, n_tok


class _nullctx:
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def evaluate(model, data, args, pad_id, device, autocast_dtype) -> float:
    import torch

    model.eval()
    total, count = 0.0, 0
    with torch.no_grad():
        for i in range(0, len(data), args.micro_batch):
            b = collate(data[i : i + args.micro_batch], pad_id, device)
            loss, n = forward_loss(model, b, autocast_dtype, device)
            total += float(loss.item()) * n
            count += n
    model.train()
    return total / max(1, count)


def linear_lora_targets(model) -> list:
    """Exact names of plain nn.Linear layers in the text model (no vision tower, MTP head or lm_head).

    peft's "all-linear" also picks up Qwen3.5's non-standard modules (Gated DeltaNet internals), which
    peft can't wrap. Listing exact names avoids that and keeps the fine-tune text-only.
    """
    import re

    import torch

    skip = re.compile(r"(visual|vision_tower|vision_model|mtp|lm_head|embed)", re.I)
    names, skipped = [], {}
    for name, mod in model.named_modules():
        if not name or skip.search(name):
            continue
        if type(mod) is torch.nn.Linear:
            names.append(name)
        elif isinstance(mod, torch.nn.Linear):  # Linear subclasses: peft may not support them
            skipped[type(mod).__name__] = skipped.get(type(mod).__name__, 0) + 1
    suffixes = sorted({n.rsplit(".", 1)[-1] for n in names})
    print(f"[lora] {len(names)} linear layers targeted; kinds: {', '.join(suffixes)}")
    if skipped:
        print(f"[lora] skipped Linear subclasses: {skipped}")
    if not names:
        raise SystemExit("[lora] found no nn.Linear layers to adapt; pass --lora-targets explicitly")
    return names


def make_peft_model(model, args):
    from peft import LoraConfig, get_peft_model

    targets = args.lora_targets
    if targets == "all-linear":
        targets = linear_lora_targets(model)
    else:
        targets = [t.strip() for t in targets.split(",") if t.strip()]
    cfg = LoraConfig(r=args.lora_r, lora_alpha=args.lora_alpha, lora_dropout=args.lora_dropout,
                     target_modules=targets, bias="none", task_type="CAUSAL_LM")
    pm = get_peft_model(model, cfg)
    pm.print_trainable_parameters()
    return pm


def save_tokenizer_files(model_id: str, tok, dest: Path, trust: bool):
    tok.save_pretrained(dest)
    try:  # the processor/preprocessor configs make the merged dir a faithful copy of the base architecture
        from transformers import AutoProcessor

        AutoProcessor.from_pretrained(model_id, trust_remote_code=trust).save_pretrained(dest)
    except Exception as e:  # noqa: BLE001
        print(f"[save] (processor not saved: {type(e).__name__}) - fine for text-only GGUF conversion")


def merge_and_save(peft_model, tok, args, merged_dir: Path):
    import torch

    print("[merge] merging LoRA into the base weights ...")
    merged = peft_model.merge_and_unload()
    merged = merged.to(torch.bfloat16).to("cpu")  # bf16 = the base checkpoint's dtype; llama.cpp converts to f16
    merged_dir.mkdir(parents=True, exist_ok=True)
    merged.save_pretrained(merged_dir, safe_serialization=True)
    save_tokenizer_files(args.model, tok, merged_dir, args.trust_remote_code)
    (merged_dir / "bloop_merge_info.json").write_text(json.dumps(
        {"base_model": args.model, "lora_r": args.lora_r, "lora_alpha": args.lora_alpha, "seed": args.seed}, indent=2))
    print(f"[merge] merged model saved to {merged_dir}")


def main(argv=None) -> int:
    args = parse_args(argv)
    import torch
    from transformers import AutoTokenizer

    set_seed(args.seed)
    out_dir = Path(args.out_dir)
    adapter_dir, merged_dir = out_dir / "adapter", out_dir / "merged"
    out_dir.mkdir(parents=True, exist_ok=True)

    device = pick_device(args.device)
    weight_dtype, autocast_dtype = resolve_dtypes(device, args.dtype)
    print(f"[env] base model: {args.model}")
    print(f"[env] torch {torch.__version__} | device={device} | weights={weight_dtype} | autocast={autocast_dtype}")
    try:
        import transformers
        import peft

        print(f"[env] transformers {transformers.__version__} | peft {peft.__version__}")
        import transformers.models.qwen3_5  # noqa: F401
    except ImportError as e:
        if "qwen3_5" in str(e):
            print("[env] WARNING: this transformers has no qwen3_5 module. Upgrade: pip install -U 'transformers>=5.2' "
                  "(or pass --trust-remote-code).")
        else:
            raise
    check_linear_attention_kernels(device)
    if device.type == "cpu":
        print("[env] WARNING: CPU training of a 0.8B model takes hours. Prefer a Mac with MPS or a Colab T4.")

    tok = AutoTokenizer.from_pretrained(args.model, trust_remote_code=args.trust_remote_code)
    pad_id = tok.pad_token_id if tok.pad_token_id is not None else tok.eos_token_id

    if args.merge_only:
        from peft import PeftModel

        base = load_base(args.model, torch.bfloat16, args.trust_remote_code)
        pm = PeftModel.from_pretrained(base, adapter_dir)
        merge_and_save(pm, tok, args, merged_dir)
        return 0

    train_rows, eval_rows = read_jsonl(Path(args.train_file)), read_jsonl(Path(args.eval_file))
    if args.max_train:
        train_rows = train_rows[: args.max_train]
    if args.max_eval:
        eval_rows = eval_rows[: args.max_eval]
    train = build_examples(train_rows, tok, args.max_len, args.enable_thinking, "train")
    evald = build_examples(eval_rows, tok, args.max_len, args.enable_thinking, "eval")

    model = load_base(args.model, weight_dtype, args.trust_remote_code)
    model.config.use_cache = False
    if args.grad_checkpointing:
        model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
        model.enable_input_require_grads()
    model.to(device)
    model = make_peft_model(model, args)
    model.train()

    params = [p for p in model.parameters() if p.requires_grad]
    opt = torch.optim.AdamW(params, lr=args.lr, weight_decay=args.weight_decay, betas=(0.9, 0.999))
    use_scaler = device.type == "cuda" and autocast_dtype == torch.float16
    scaler = torch.amp.GradScaler("cuda") if use_scaler else None

    accum = max(1, math.ceil(args.batch_size / args.micro_batch))
    rng = random.Random(args.seed)
    steps_per_epoch = math.ceil(math.ceil(len(train) / args.micro_batch) / accum)
    total_steps = steps_per_epoch * args.epochs
    warmup = max(1, int(round(total_steps * args.warmup_ratio)))
    print(f"[plan] {len(train)} train / {len(evald)} eval examples | micro-batch {args.micro_batch} x accum {accum} "
          f"= effective {args.micro_batch * accum} | {steps_per_epoch} steps/epoch x {args.epochs} = {total_steps} steps "
          f"(warmup {warmup})")

    def backward(loss):
        (scaler.scale(loss) if scaler else loss).backward()

    # ---- timing: a few real forward/backward passes whose gradients are discarded
    if not args.skip_bench:
        n_bench = max(2, args.bench_steps)
        idx = list(range(len(train)))
        rng_b = random.Random(args.seed + 1)
        rng_b.shuffle(idx)
        times = []
        print(f"[bench] timing {n_bench} micro-batches (not counted, weights untouched) ...")
        for k in range(n_bench):
            b = collate([train[i] for i in idx[k * args.micro_batch : (k + 1) * args.micro_batch]] or [train[0]],
                        pad_id, device)
            sync(device)
            t0 = time.time()
            loss, _ = forward_loss(model, b, autocast_dtype, device)
            backward(loss)
            sync(device)
            times.append(time.time() - t0)
            print(f"[bench]   micro-batch {k + 1}/{n_bench}: {times[-1]:.2f}s (loss {loss.item():.3f})")
        opt.zero_grad(set_to_none=True)
        per_micro = statistics.median(times[1:])  # first one includes warmup/compilation
        eta = estimate_eta(per_micro, len(train), len(evald), args.epochs, args.micro_batch)
        print(f"[bench] ~{per_micro:.2f}s per micro-batch  =>  estimated total time {fmt_duration(eta)} "
              f"for {args.epochs} epochs (+ merge)")
        if device.type == "cuda":
            print(f"[bench] peak GPU memory {torch.cuda.max_memory_allocated() / 2**30:.1f} GiB")
        if args.dry_run:
            print("[dry-run] stopping after timing. Remove --dry-run for the full run.")
            return 0
    elif args.dry_run:
        print("[dry-run] --skip-bench given, nothing to do.")
        return 0

    # ---- training
    log_path = out_dir / "train_log.jsonl"
    log = open(log_path, "w", encoding="utf-8")

    def write_log(rec):
        log.write(json.dumps(rec) + "\n")
        log.flush()

    base_eval = evaluate(model, evald, args, pad_id, device, autocast_dtype)
    print(f"[eval] epoch 0 (before training): eval loss {base_eval:.4f}")
    write_log({"epoch": 0, "eval_loss": base_eval})

    step, t_start = 0, time.time()
    for epoch in range(1, args.epochs + 1):
        order = list(range(len(train)))
        rng.shuffle(order)
        run_loss, run_n = 0.0, 0
        for group in split_batches(order, args.micro_batch, accum):
            lr = lr_at(step, total_steps, args.lr, warmup, args.min_lr_ratio)
            for g in opt.param_groups:
                g["lr"] = lr
            n_micro = len(group)
            for mb in group:
                loss, n_tok = forward_loss(model, collate([train[i] for i in mb], pad_id, device), autocast_dtype, device)
                backward(loss / n_micro)
                run_loss += float(loss.item())
                run_n += 1
            if scaler:
                scaler.unscale_(opt)
            gn = torch.nn.utils.clip_grad_norm_(params, args.max_grad_norm)
            if scaler:
                scaler.step(opt)
                scaler.update()
            else:
                opt.step()
            opt.zero_grad(set_to_none=True)
            step += 1
            if step % 10 == 0 or step == total_steps:
                avg = run_loss / max(1, run_n)
                elapsed = time.time() - t_start
                remaining = elapsed / step * (total_steps - step)
                print(f"[train] epoch {epoch}/{args.epochs} step {step}/{total_steps} loss {avg:.4f} lr {lr:.2e} "
                      f"gnorm {float(gn):.2f} | elapsed {fmt_duration(elapsed)} remaining ~{fmt_duration(remaining)}")
                write_log({"epoch": epoch, "step": step, "loss": avg, "lr": lr})
                run_loss, run_n = 0.0, 0
        ev = evaluate(model, evald, args, pad_id, device, autocast_dtype)
        print(f"[eval] epoch {epoch}: eval loss {ev:.4f}")
        write_log({"epoch": epoch, "step": step, "eval_loss": ev})
        adapter_dir.mkdir(parents=True, exist_ok=True)
        model.save_pretrained(adapter_dir)  # overwritten each epoch, so a crash keeps the last good adapter
    log.close()
    tok.save_pretrained(adapter_dir)
    print(f"[save] adapter saved to {adapter_dir}  (log: {log_path})")

    if args.no_merge:
        return 0
    merge_and_save(model, tok, args, merged_dir)
    print("[done] next: bash ml/train/convert_quantize.sh")
    return 0


if __name__ == "__main__":
    sys.exit(main())
``````

### `ml/wsp/README.md`

<!-- FILE: ml/wsp/README.md sha256=71d502315ec98d671b35aeb6b0fe8738c8e7cbb4612b575851c241302cc93900 nl=1 -->
``````markdown
# Weight-space programming for the Bloop model

A harness for an editor (an LLM agent such as Codex, or a person) to **read and edit the Bloop model's weights directly, without gradients**. The editor works in a Python session that holds the weights and has a small budget of forward passes on practice data.

This reproduces the setup of MIT CSAIL's **weight-space programming** work (Nov 2026, [blog post](https://rikiyat.github.io/blog/weight-space-programming/)). In that work, an editor LLM (GPT-6 Astra) worked on Qwen3.5-0.8B with a budget of 10, 25 or 50 forward passes. It found that the model's looping came from one direction written by the MLPs of layers 15 and 19. It subtracted that direction from 64 output columns of `mlp.down_proj` in each of those layers: 131,072 weights, or 0.016% of the model. MATH-500 went from 7.9 to 48.1 and IFEval from 21.0 to 62.3. The edited checkpoint is public as [RikiyaT/Qwen3.5-0.8B-weight-space-programming](https://huggingface.co/RikiyaT/Qwen3.5-0.8B-weight-space-programming) (Apache-2.0). Only `model.language_model.layers.{15,19}.mlp.down_proj.weight` differ from `Qwen/Qwen3.5-0.8B`. All credit for the method and the checkpoint goes to the MIT authors. This directory is an independent re-implementation of the setup for Bloop's own tasks.

Bloop's tasks are different from MIT's:
- **Study-plan JSON.** The prompt comes from `buildPrompt` in `src/main/plan.ts`. The model runs with thinking OFF and must return a short output that matches a JSON schema and follows rules: 3-10 blocks, 08:00-22:00, before the deadline, pomodoro multiples.
- **Short nudge lines** of at most 60 characters.

Scoring reuses `ml/train/scoring.py`.

## Files

| File | What |
|---|---|
| `harness.py` | `Workspace`: loading, budget, generate/score, activations, directions, logit lens, edits, guardrails, save, final test |
| `presets.py` | `apply_mit_edit`, `mit_directions`, `find_loop_direction`, `read_hub_tensor`, `delta_structure` |
| `apply_patch.py` | Re-applies `patch.safetensors` onto a base model (`--mode replace` or `--mode delta`) |
| `wsp_core.py` | The pure stdlib parts: budget, splits, scoring glue, projection math reference, guardrail, edit log, patch metadata |
| `session.ipynb` | Starter notebook covering setup, baseline, diagnose, directions, edits, verify, final_test, save, GGUF and eval |
| `test_harness_pure.py` | Stdlib unit tests: `python3 -m unittest discover -s ml/wsp` |

To run the harness with Codex, see `docs/codex-weight-space-prompt.md`.

## Quick start

```python
import sys; sys.path.insert(0, "ml/wsp")
from harness import Workspace
import presets

ws = Workspace("ml/out/merged", budget=50)                  # or "Qwen/Qwen3.5-0.8B", or "mit"
base = ws.generate("dev", n=64)                              # 1 pass; thinking OFF, temperature 0
rep = presets.find_loop_direction(ws, generation=base)       # 1 pass (activations)
L = rep["suggested"][0]["layer"]; d = rep["directions"][L]
ws.logit_lens(d)                                             # free
eid = ws.edit_subtract_direction(L, d, columns=64)           # free, logged, revertible
after = ws.generate("dev", n=64)                             # 1 pass
ws.revert(eid)  # if it got worse
ws.final_test()                                              # once; locks the session
ws.save("ml/out/wsp")                                        # model/ + patch + edits.json + EDIT_REPORT.md
```

Next, run `bash ml/train/convert_quantize.sh --src ml/out/wsp/model --name bloop-edit`, then `python ml/train/eval.py --tuned-edit-gguf ml/out/bloop-edit-qwen3.5-0.8b-Q4_K_M.gguf`.

## Budget rules

- **One forward pass** means generating for up to 64 prompts, or reading activations for up to 128 texts. A call over N items costs `ceil(N/64)` or `ceil(N/128)` passes. One `activations()` call reads any number of layers in the same pass. The default budget is 50, and 10 and 25 match MIT's other settings. MIT's own pass was larger: up to 512 problems or 1,024 texts. For that, use `Workspace(..., gen_per_pass=512, act_per_pass=1024)`.
- A call that would overspend is **refused before it runs**, so nothing is charged partially. The remaining budget is printed after every call and appears in `ws.status()`.
- **Free**: `score`, `logit_lens`, `top_columns`, `weight`, `diff_summary`, every edit and revert, `mit_directions`, and directions computed from tensors you already hold.
- **Splits**: `dev` is a deterministic subset of `train.jsonl` (`dev_size=128`, `seed=0`), and it is the practice data. `test` is `eval.jsonl` and is **locked**. `ws.generate("test")` raises an error. `ws.final_test()` runs it once on the current weights without spending budget, records the metrics and locks the session. After that, generate, activations and edits are refused, but `save()` still works.

## Edit math

`down_proj` is an `nn.Linear(intermediate, hidden)`, so its weight `W` has shape **[hidden, intermediate]** (PyTorch stores `[out_features, in_features]`). The MLP output is `W a`, where `a` holds the intermediate neuron activations. So column `j`, written `W[:, j]`, is the vector that neuron `j` **writes into the residual stream**. A direction `d` lives in the hidden (residual) space, and the harness normalizes it to unit length.

**Default: `orientation="neuron_columns"`** (MIT-style, "output columns" = neurons' write vectors)

```
W[:, J] <- W[:, J] - s * d (dᵀ W[:, J])          for the selected columns J
```

- With `s = 1`, the selected neurons no longer write anything along `d`: `dᵀ W'[:, j] = 0`. Every component orthogonal to `d` is unchanged (`vᵀ W' = vᵀ W` for `v ⊥ d`), and the other columns are untouched. For any input, `W' a - W a` lies along `d`.
- `0 < s < 1` removes only part of the component, and `s = 2` reflects it.
- `columns=None` uses all columns, which is the full `(I - s d dᵀ) W`. That usually exceeds the cap. `columns=k` selects the top-k columns by `|dᵀ W[:, j]|` (see `top_columns`, which also has `by="cos"`). `columns=[...]` takes explicit indices.
- This is the default because the numbers match MIT's: 64 columns × hidden 1,024 = 65,536 weights per layer, and × 2 layers = 131,072.

**Alternative: `orientation="hidden_rows"`**

```
W[R, :] <- W[R, :] - s * d[R] (dᵀ W)             for the selected residual coordinates R
```

This applies only the rows `R` of the full projection-removal update. The rows are ranked by `|d_i|`, and the edit changes `k × intermediate` weights. It is included because "output columns" can be read either way. It removes `d` only partly, unless `R` covers the support of `d`.

`presets.delta_structure(MIT - base)` reports which columns or rows MIT's published delta touches, and how close it is to rank 1. Running it settles which interpretation MIT used, without spending any budget.

The other edits are generic and low-level:
- `edit_scale(name, index, factor)` computes `W[index] *= factor`.
- `edit_add(name, index, value)` computes `W[index] += value`.
- `edit_set(name, tensor)` replaces the whole tensor. `apply_mit_edit(mode="replace")` uses it.

The index can be `None` (the whole tensor), an int, a slice, a list, or a tuple of these. Edits are computed in fp32 and stored in the model's dtype.

**Revert.** Every touched tensor keeps its starting copy. `revert(id)` restores the originals and replays the remaining active edits in order, so overlapping edits revert correctly. `revert_all()` restores everything.

## Guardrails

- **Changed-parameter cap.** The default is `max_changed_frac=0.001`, or 0.1% of all parameters (about 0.8M weights). The harness counts the elements that differ from the session's starting weights and refuses any edit that would end above the cap. Raising the cap is a deliberate, logged act: set `ws.max_changed_frac` and write a note explaining why.
- **Read-only tensors.** Embeddings (`embed_tokens`), the unembedding (`lm_head`), the vision tower and the MTP head are read-only by default (`protected=` overrides).
- **Hashes.** Every edit logs sha256 hashes of the tensor before and after. The patch records them in the base model's dtype, and `apply_patch.py --mode replace` refuses a base whose hash does not match.
- **Self-check.** On first use, the torch projection is checked against the pure-Python reference implementation, which the unit tests cover.

## MIT presets

- `presets.apply_mit_edit(ws, mode="replace")` copies MIT's two tensors in. It is correct only when the loaded model is the plain `Qwen/Qwen3.5-0.8B`. It warns when the current tensors differ from Qwen's, or when the model is a LoRA merge (it detects `bloop_merge_info.json`). On a merged model, the guardrail normally refuses anyway, because the whole tensor changes.
- `presets.apply_mit_edit(ws, mode="delta")` adds `(MIT - Qwen base)` and moves exactly MIT's 131,072-weight change onto a fine-tuned model. Use this mode for a LoRA-merged Bloop model.
- `presets.mit_directions(ws)` recovers MIT's per-layer direction (the top singular vector of the delta) and its columns. `ws.edit_subtract_direction(L, x["direction"], columns=x["cols"])` then projects the fine-tuned model's own write vectors, instead of pasting in MIT's numbers.
- `presets.find_loop_direction(ws)` is the reproduction recipe:
  1. Generate on `dev` and split the outputs into loopers (those that hit the token limit or are repetitive) and finishers.
  2. Take the mean MLP output over the assistant tokens at every layer.
  3. Compute the difference-of-means direction on one half and Cohen's d on the other half.
  4. Rank the layers, then show the logit lens and the top 64 columns for the best ones.

Tensors are fetched from the Hub with HTTP range requests, so the harness downloads only about 7 MB per tensor. It falls back to a full download if the range request fails.

**Training on top of MIT's edit instead:**
- `python ml/train/train_lora.py --base mit` (or `--base RikiyaT/Qwen3.5-0.8B-weight-space-programming`)
- `BASE=mit bash ml/run_mac.sh`
- `BASE = MIT_BASE` in `ml/colab/train_bloop.ipynb`

`eval.py` then compares base, mit-edit, tuned and tuned+edit, using whichever GGUFs exist.

## Outputs of `save(out_dir)`

| Path | What |
|---|---|
| `model/` | Full edited HF model, saved in the source checkpoint's dtype (bf16 for Qwen). Ready for `convert_quantize.sh` |
| `patch.safetensors` | Only the changed tensors (`<name>`) plus fp32 deltas (`delta::<name>`). The metadata holds the format, base model, and before/after hashes |
| `patch.json` | The same metadata, readable |
| `edits.json` | Settings, ops with parameters and hashes, budget log, metrics history, diff, final test, notes |
| `EDIT_REPORT.md`, `notes.md` | Human-readable summary and the append-only notes |

Bf16 rounding can drop extremely small changes. The patch export prints how many changes were lost.

## Honest limits

- **Editing can remove an obstacle, but it cannot add an ability.** MIT's gain came from removing a failure mode (endless loops with thinking ON, 32k-token answers) that hid an ability the model already had. Their counterexample was **Gemma 3 270M**. It rarely looped (8.5% of answers hit the token limit), and the editor found no single component to switch off. MATH-500 went from 6.8 only to 7.7 at best, and to 7.0 at 50 passes.
- **The result may not transfer to Bloop.** Bloop runs with thinking OFF and produces short JSON or one-line outputs, where loops may be rare. If `find_loop_direction` reports `too_few_examples`, MIT's obstacle is not Bloop's obstacle. Look at the failures before editing anything. Check whether they are broken JSON, rule violations or overlong nudges. Grammar-constrained decoding in the app already removes most JSON-validity failures.
- **The budget limits what you can learn.** MIT's big jump happened only at 50 passes, and at 10 or 25 passes the loops barely went away. With 64 dev prompts per pass, the measurement noise on a pass rate is several percentage points, so do not over-read small changes. The locked test is the only clean number.
- MIT's reported results come from one blog post. The edit math above is our reading of "subtract the direction from 64 output columns". Running `delta_structure` on the published checkpoint checks that reading.

## What is untested

The authoring sandbox could not install or run torch, transformers or llama.cpp, and could not download models. Everything here was checked statically:
- `py_compile` on every file.
- 32 stdlib unit tests covering budget, splits, the scoring glue, the projection math on pure-Python matrices, the guardrail, the edit log and replay semantics, index serialization, name matching, safetensors header parsing and patch metadata.
- Notebook JSON validity and cell syntax.

The following have **never been run**:
- Model loading, generation and the hooks (including the Qwen3.5 hybrid-attention module names and left-padded batch generation through the Gated DeltaNet layers).
- `logit_lens` with the final norm.
- The torch edit path, save/patch, `apply_patch.py`, Hub range reads, and the presets.

The torch projection checks itself against the tested reference on first use. Expect small fixes on the first real run. If batched generation looks wrong, set `ws.gen_batch_size = 1`.
``````

### `ml/wsp/apply_patch.py`

<!-- FILE: ml/wsp/apply_patch.py sha256=98099d88e9fabc39824482cc4853505c4414d712517ac7ee85f33a81f6edf02d nl=1 -->
``````python
#!/usr/bin/env python3
"""Re-apply a weight-space patch (patch.safetensors from Workspace.save/export_patch) onto a base model.

    python ml/wsp/apply_patch.py --base ml/out/merged --patch ml/out/wsp/patch.safetensors --out ml/out/wsp-applied
    python ml/wsp/apply_patch.py --base Qwen/Qwen3.5-0.8B --patch p.safetensors --out out --mode delta

--mode replace (default): write the patched tensors as they are. The base tensors must match the hashes the
    patch recorded (i.e. the same model the session started from); otherwise it stops (use --force or delta).
--mode delta: add the recorded fp32 delta (after - before) to the base tensors. Use it to carry an edit onto a
    different but compatible model (e.g. another LoRA merge of the same base).

The output is a copy of the base checkpoint directory with only the affected shard(s) rewritten.
Needs torch + safetensors (+ huggingface_hub for a Hub id). Untested end to end in the authoring sandbox.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import wsp_core as C  # noqa: E402


def shard_map(model_dir: Path) -> dict[str, str]:
    """{tensor key: shard filename} for a HF checkpoint directory."""
    idx = model_dir / "model.safetensors.index.json"
    if idx.exists():
        return dict(json.loads(idx.read_text())["weight_map"])
    from safetensors import safe_open

    out = {}
    for f in sorted(model_dir.glob("*.safetensors")):
        with safe_open(str(f), "pt") as sf:
            for k in sf.keys():
                out[k] = f.name
    return out


def plan_targets(patch_tensors: list[str], base_keys: list[str]) -> dict[str, str]:
    """{patch tensor name: base checkpoint key}; raises if a tensor cannot be matched (pure)."""
    out = {}
    for name in patch_tensors:
        k = C.match_param_name(name, base_keys)
        if k is None:
            raise SystemExit(f"cannot find {name} in the base checkpoint")
        out[name] = k
    return out


def resolve_base_dir(base: str) -> Path:
    p = Path(base)
    if p.is_dir():
        return p
    from huggingface_hub import snapshot_download

    return Path(snapshot_download(base, allow_patterns=["*.json", "*.safetensors", "*.txt", "*.jinja", "*.model"]))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", required=True, help="base model dir or HF id")
    ap.add_argument("--patch", required=True, help="patch.safetensors")
    ap.add_argument("--out", required=True, help="output model dir (a copy of the base with the patch applied)")
    ap.add_argument("--mode", choices=["replace", "delta"], default="replace")
    ap.add_argument("--force", action="store_true", help="replace even if the base tensor hash does not match")
    args = ap.parse_args(argv)

    import torch
    from safetensors import safe_open
    from safetensors.torch import load_file, save_file

    with safe_open(args.patch, "pt") as pf:
        meta = C.parse_patch_metadata(pf.metadata())
        patch = {k: pf.get_tensor(k) for k in pf.keys()}
    base_dir = resolve_base_dir(args.base)
    out = Path(args.out)
    if out.resolve() == base_dir.resolve():
        raise SystemExit("--out must differ from the base directory")
    shutil.copytree(base_dir, out, dirs_exist_ok=True)  # follows HF-cache symlinks (copies the content)
    smap = shard_map(out)
    targets = plan_targets(meta["tensors"], list(smap))
    by_shard: dict[str, list[str]] = {}
    for name, key in targets.items():
        by_shard.setdefault(smap[key], []).append(name)

    report = []
    for shard, names in by_shard.items():
        path = out / shard
        tensors = load_file(str(path))
        for name in names:
            key, ent = targets[name], meta["entries"][name]
            base_t = tensors[key]
            if list(base_t.shape) != ent["shape"]:
                raise SystemExit(f"{key}: shape {list(base_t.shape)} != patch {ent['shape']}")
            if args.mode == "replace":
                h = C.tensor_sha256(base_t.to(patch[name].dtype))
                if h != ent["before_sha256"] and not args.force:
                    raise SystemExit(f"{key}: the base tensor is not the one the patch was made from (hash mismatch). "
                                     "Use --mode delta to add the change instead, or --force to overwrite.")
                new = patch[name].to(base_t.dtype)
            else:
                new = (base_t.float() + patch[C.delta_key(name)].float()).to(base_t.dtype)
            changed = int((new != base_t).sum())
            tensors[key] = new.contiguous()
            report.append({"tensor": key, "changed": changed, "shard": shard})
            print(f"[apply] {key}: {changed:,} weights changed ({args.mode})")
        save_file(tensors, str(path), metadata={"format": "pt"})
    (out / "wsp_patch_applied.json").write_text(json.dumps(
        {"patch": str(args.patch), "mode": args.mode, "base": str(args.base), "patch_base_model": meta["base_model"],
         "tensors": report}, indent=2), encoding="utf-8")
    print(f"[apply] done -> {out}")
    _ = torch
    return 0


if __name__ == "__main__":
    sys.exit(main())
``````

### `ml/wsp/harness.py`

<!-- FILE: ml/wsp/harness.py sha256=824297da00ca5edd94f5afc43c3380ee6340c10d4d0c2c310b23c754918f8cc5 nl=1 -->
``````python
"""Weight-space programming harness for the Bloop model.

An editor (an LLM agent such as Codex, or you) drives this from a Python REPL or notebook. It reads activations
and weights, edits weights directly (no gradients), and spends a limited forward-pass budget on practice data.
This follows MIT CSAIL's "weight-space programming" (https://rikiyat.github.io/blog/weight-space-programming/).

    from harness import Workspace
    ws = Workspace("ml/out/merged", budget=50)          # or "Qwen/Qwen3.5-0.8B"
    base = ws.generate("dev", n=64)                      # 1 forward pass
    d = ws.contrast_direction(base.finished(), base.loopers(), layer=15)   # 1 pass
    ws.logit_lens(d)                                     # free
    cols = ws.top_columns(15, d, k=64)                   # free
    eid = ws.edit_subtract_direction(15, d, columns=cols)
    ws.generate("dev", n=64)                             # verify (1 pass)
    ws.final_test(); ws.save("ml/out/wsp")

Budget: 1 forward pass = generate for <= 64 prompts, or read activations for <= 128 texts. Pure functions
(score, logit_lens, top_columns, diff_summary, edits, weight reads) are free.

torch / transformers are imported lazily inside methods, so this module imports with only the stdlib.
NOTE: written without being able to run torch (see README "What is untested").
"""
from __future__ import annotations

import contextlib
import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Optional, Sequence, Union

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

WSP_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(WSP_DIR))
import wsp_core as C  # noqa: E402
from wsp_core import (  # noqa: E402,F401  (re-exported for the editor)
    DEFAULT_ORIENTATION, ORIENTATIONS, POSITIONS, SITES, BudgetExceeded, Generation, GuardrailError,
    LockedSplitError, SessionLocked, WSPError, compare_table, fmt_metrics, score as _score_pure,
)
import train_lora as TL  # noqa: E402  (stdlib-importable; ml/train is on sys.path via wsp_core)

DTYPES = {"fp32": "float32", "fp16": "float16", "bf16": "bfloat16"}


def _torch_dtype(name: str):
    import torch

    return getattr(torch, DTYPES.get(name, name))


class Workspace:
    """A Python session holding the Bloop model's weights, a forward-pass budget, edit tools and guardrails."""

    # ------------------------------------------------------------------ setup
    def __init__(self, model: str = "ml/out/merged", data_dir: str = "ml/data", budget: int = 50,
                 device: str = "auto", dev_size: int = 128, seed: int = 0, *, dtype: str = "auto",
                 thinking: bool = False, max_changed_frac: float = C.DEFAULT_MAX_CHANGED_FRAC,
                 protected: Sequence[str] = C.DEFAULT_PROTECTED, gen_per_pass: int = C.DEFAULT_GEN_PER_PASS,
                 act_per_pass: int = C.DEFAULT_ACT_PER_PASS, gen_batch_size: Optional[int] = None,
                 act_batch_size: Optional[int] = None, trust_remote_code: bool = False):
        import torch
        from transformers import AutoTokenizer

        self.model_ref = C.resolve_model_ref(model)
        self.seed = seed
        self.thinking = bool(thinking)
        self.max_changed_frac = float(max_changed_frac)
        self.protected = tuple(protected)
        self.trust_remote_code = trust_remote_code
        self.device = TL.pick_device(device)
        # fp32 by default everywhere: exact edits, no fp16 overflow on a T4. dtype="fp16" halves memory.
        self.dtype = torch.float32 if dtype == "auto" else _torch_dtype(dtype)
        self.gen_batch_size = gen_batch_size or (16 if self.device.type == "cuda" else 4)
        self.act_batch_size = act_batch_size or (8 if self.device.type == "cuda" else 2)
        torch.manual_seed(seed)

        print(f"[wsp] loading {self.model_ref} on {self.device} ({self.dtype}) ...")
        self.tok = AutoTokenizer.from_pretrained(self.model_ref, trust_remote_code=trust_remote_code)
        self.model = TL.load_base(self.model_ref, self.dtype, trust_remote_code)
        self.model.to(self.device)
        self.model.eval()
        for p in self.model.parameters():
            p.requires_grad_(False)

        self._params = dict(self.model.named_parameters())
        self._modules = dict(self.model.named_modules())
        self.total_params = sum(p.numel() for p in self.model.parameters())
        self._layers = C.find_decoder_layers(self._modules)
        if not self._layers:
            raise WSPError("could not find the decoder layers (expected '...layers.<i>' modules)")
        norm_name = C.final_norm_name(next(iter(self._layers.values())))
        self._final_norm = self._modules.get(norm_name)
        self.eos_ids = self._eos_ids()
        self.pad_id = self.tok.pad_token_id if self.tok.pad_token_id is not None else self.eos_ids[0]

        self.budget = C.Budget(budget, gen_per_pass, act_per_pass)
        self.data_dir = Path(data_dir) if Path(data_dir).exists() else C.REPO_ROOT / data_dir
        self.splits = C.load_splits(self.data_dir, dev_size, seed)
        for w in self.splits.warnings:
            print(f"[wsp] WARNING: {w}")

        self._orig: dict[str, Any] = {}      # pre-session copies (CPU) of every tensor ever touched
        self._changed: dict[str, int] = {}   # tensor -> #elements differing from the original
        self._payloads: dict[str, dict] = {}  # edit id -> tensors needed to replay the edit
        self.log = C.EditLog()
        self._notes = C.Notes()
        self.history: list[dict] = []
        self.final: Optional[dict] = None
        self.locked = False
        self._gen_calls = 0
        self._selfchecked = False
        self.last_contrast: dict = {}
        print(f"[wsp] {len(self._layers)} decoder layers, {self.total_params:,} params, "
              f"edit cap {100 * self.max_changed_frac:.3f}% (= {int(self.max_changed_frac * self.total_params):,} weights). "
              f"Splits: {self.splits.sizes()}. Thinking={'ON' if self.thinking else 'OFF'}. Budget: {self.budget.summary()}")

    def _eos_ids(self) -> list[int]:
        ids: list[int] = []
        for t in (TL.END_TOKEN, "<|endoftext|>"):
            i = self.tok.convert_tokens_to_ids(t)
            if isinstance(i, int) and i >= 0 and i != getattr(self.tok, "unk_token_id", None):
                ids.append(i)
        if self.tok.eos_token_id is not None:
            ids.append(self.tok.eos_token_id)
        gc = getattr(self.model, "generation_config", None)
        g = getattr(gc, "eos_token_id", None) if gc is not None else None
        ids += g if isinstance(g, list) else ([g] if isinstance(g, int) else [])
        return list(dict.fromkeys(ids))

    # ------------------------------------------------------------------ small utilities
    @property
    def n_layers(self) -> int:
        return len(self._layers)

    def status(self) -> str:
        s = (f"model={self.model_ref} | budget {self.budget.summary()} | active edits {self.log.active_ids() or '-'} | "
             f"changed {sum(self._changed.values()):,} params | locked={self.locked}")
        print(s)
        return s

    def __repr__(self):
        return f"<Workspace {self.model_ref} budget={self.budget.remaining}/{self.budget.total} edits={len(self.log.active())}>"

    def param_names(self, pattern: Optional[str] = None) -> list[str]:
        import re

        return [n for n in self._params if pattern is None or re.search(pattern, n)]

    def layer_param(self, layer: int, module: str = "mlp.down_proj") -> str:
        if layer not in self._layers:
            raise KeyError(f"layer {layer} not in 0..{self.n_layers - 1}")
        name = f"{self._layers[layer]}.{module}.weight"
        if name not in self._params:
            raise KeyError(f"{name} is not a parameter (check the module name: ws.param_names(r'layers\\.{layer}\\.'))")
        return name

    def weight(self, name_or_layer: Union[str, int], module: str = "mlp.down_proj"):
        """A detached float32 CPU copy of a weight (free, read-only)."""
        name = self.layer_param(name_or_layer, module) if isinstance(name_or_layer, int) else name_or_layer
        return self._params[name].detach().float().cpu().clone()

    def original(self, name: str):
        """The tensor as it was when the session started (CPU, model dtype)."""
        return (self._orig[name] if name in self._orig else self._params[name].detach().cpu()).clone()

    def notes(self, text: Optional[str] = None) -> list[dict]:
        """Append a note (append-only, saved with the edits). With no argument, print and return all notes."""
        if text is not None:
            self._notes.add(text, self.budget.remaining)
        items = list(self._notes.items)
        if text is None:
            for n in items:
                print(f"- {n['t']} [{n['budget_left']} left] {n['text']}")
        return items

    def _check_unlocked(self):
        if self.locked:
            raise SessionLocked("final_test() already ran: the session is locked. save() still works.")

    def _charge(self, kind: str, n: int, label: str):
        c = self.budget.charge(kind, n, label)
        print(f"[budget] -{c} pass(es) for {label or kind} ({n} items) -> {self.budget.summary()}")

    def _render(self, messages: list[dict], thinking: bool) -> str:
        try:
            return self.tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True,
                                                enable_thinking=bool(thinking))
        except TypeError:
            return self.tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)

    def _items(self, split_or_prompts, n, kind, offset) -> list[dict]:
        if isinstance(split_or_prompts, str):
            items = self.splits.get(split_or_prompts)
        elif isinstance(split_or_prompts, Generation):
            items = C.normalize_prompt_items(split_or_prompts.outputs)
        else:
            items = C.normalize_prompt_items(list(split_or_prompts))
        return C.take_items(items, n, kind, offset)

    # ------------------------------------------------------------------ generation (costs budget)
    def generate(self, split_or_prompts: Any = "dev", n: Optional[int] = 64, max_new_tokens: int = 512,
                 thinking: Optional[bool] = None, temperature: float = 0.0, *, kind: Optional[str] = None,
                 offset: int = 0, top_p: float = 0.95, label: str = "", _charge: bool = True) -> Generation:
        """Generate for a split ('dev') or a list of prompts and score every output.

        Cost: ceil(#prompts / 64) forward passes. n=None takes the whole split. kind='plan'|'nudge' filters;
        without it plan and nudge prompts are interleaved so a small n keeps the mix. Returns a Generation with
        .outputs (text, hit_limit, n_new_tokens, score), .metrics, .loopers(), .finished(), .failures(), .show(i).
        """
        self._check_unlocked()
        items = self._items(split_or_prompts, n, kind, offset)
        if not items:
            raise ValueError("no prompts selected (empty split? see the warnings printed at load)")
        thinking = self.thinking if thinking is None else thinking
        label = label or (split_or_prompts if isinstance(split_or_prompts, str) else "prompts")
        if _charge:
            self._charge("generate", len(items), f"generate[{label}]")
        raw = self._generate_raw(items, max_new_tokens, thinking, temperature, top_p)
        sc = C.score(raw, items)
        outs = [dict(r, score=s) for r, s in zip(raw, sc["per_example"])]
        gen = Generation(outs, sc["metrics"], label)
        self._record(label, sc["metrics"], extra={"max_new_tokens": max_new_tokens, "thinking": thinking,
                                                  "temperature": temperature})
        print(f"[generate] {label}: {fmt_metrics(sc['metrics'])}")
        return gen

    def _record(self, label: str, metrics: dict, extra: Optional[dict] = None):
        self.history.append({"t": time.strftime("%Y-%m-%dT%H:%M:%S"), "label": label, "metrics": metrics,
                             "active_edits": self.log.active_ids(), "budget_left": self.budget.remaining, **(extra or {})})

    def _generate_raw(self, items: list[dict], max_new_tokens: int, thinking: bool, temperature: float,
                      top_p: float) -> list[dict]:
        import torch

        tok = self.tok
        old_side = tok.padding_side
        tok.padding_side = "left"  # decoder-only batch generation needs left padding
        self._gen_calls += 1
        torch.manual_seed(self.seed + self._gen_calls)
        res: list[dict] = []
        try:
            for i in range(0, len(items), self.gen_batch_size):
                chunk = items[i : i + self.gen_batch_size]
                ptexts = [self._render(it["messages"], thinking) for it in chunk]
                enc = tok(ptexts, return_tensors="pt", padding=True, add_special_tokens=False).to(self.device)
                kw: dict = dict(max_new_tokens=max_new_tokens, pad_token_id=self.pad_id, eos_token_id=self.eos_ids)
                if temperature and temperature > 0:
                    kw.update(do_sample=True, temperature=temperature, top_p=top_p)
                else:
                    kw.update(do_sample=False, temperature=None, top_p=None, top_k=None)
                with torch.no_grad():
                    out = self.model.generate(**enc, **kw)
                new = out[:, enc["input_ids"].shape[1] :].cpu().tolist()
                for it, pt, ids in zip(chunk, ptexts, new):
                    k, hit = C.trim_at_eos(ids, self.eos_ids, max_new_tokens)
                    text = tok.decode(ids[:k], skip_special_tokens=True)
                    res.append({"id": it["id"], "kind": it["kind"], "prompt": it["prompt"], "prompt_text": pt,
                                "text": text, "hit_limit": hit, "n_new_tokens": k, "item": it})
        finally:
            tok.padding_side = old_side
        return res

    def score(self, outputs: Sequence[Any], examples: Sequence[dict]) -> dict:
        """Pure scoring (no budget): outputs = strings or dicts with 'text'; examples = prompt items."""
        r = _score_pure(outputs, examples)
        print(f"[score] {fmt_metrics(r['metrics'])}")
        return r

    # ------------------------------------------------------------------ activations (costs budget)
    def _encode_text(self, t: Any, max_len: int) -> tuple[list[int], int]:
        """-> (token ids, start of the assistant span)."""
        if isinstance(t, str):
            ptxt, ctxt = "", t
        elif isinstance(t, dict) and "prompt_text" in t and "text" in t:
            ptxt, ctxt = t["prompt_text"], t["text"]
        elif isinstance(t, dict) and "messages" in t or (isinstance(t, list) and t and isinstance(t[0], dict)):
            msgs = t["messages"] if isinstance(t, dict) else t
            if msgs[-1].get("role") == "assistant":
                ptxt, ctxt = self._render(msgs[:-1], self.thinking), msgs[-1].get("content", "")
            else:
                ptxt, ctxt = self._render(msgs, self.thinking), ""
        else:
            raise TypeError(f"unsupported text item {type(t).__name__}")
        p = self.tok(ptxt, add_special_tokens=False)["input_ids"] if ptxt else []
        c = self.tok(ctxt, add_special_tokens=False)["input_ids"] if ctxt else []
        ids = (p + c)[:max_len]
        if not ids:
            raise ValueError("empty text")
        return ids, min(len(p), len(ids) - 1)

    def _site_module(self, layer: int, site: str):
        if layer not in self._layers:
            raise KeyError(f"layer {layer} not in 0..{self.n_layers - 1}")
        pre = self._layers[layer]
        if site == "mlp_out":
            names = [f"{pre}.mlp"]
        elif site == "resid":
            names = [pre]
        elif site == "attn_out":  # Qwen3.5 is hybrid: full-attention layers have self_attn, DeltaNet layers linear_attn
            names = [f"{pre}.{s}" for s in ("self_attn", "linear_attn", "attn", "attention")]
        else:
            raise ValueError(f"site must be one of {SITES}")
        for n in names:
            if n in self._modules:
                return self._modules[n]
        raise KeyError(f"no module for site {site!r} at layer {layer} (tried {names})")

    def _forward_no_logits(self, ids, att):
        try:  # logits_to_keep=1 avoids materialising [B, T, 248k] logits
            self.model(input_ids=ids, attention_mask=att, use_cache=False, logits_to_keep=1)
        except TypeError:
            self.model(input_ids=ids, attention_mask=att, use_cache=False)

    def activations(self, texts: Sequence[Any], layers: Union[int, Sequence[int]], site: str = "mlp_out",
                    position: str = "last", *, max_len: int = 2048, _charge: bool = True):
        """Read activations with forward hooks. Cost: ceil(#texts / 128) passes (all layers in one pass).

        texts: raw strings, generation outputs (prompt_text + text), chat rows/messages (last = assistant).
        site: mlp_out (output of layers.i.mlp = what the MLP writes) | resid (decoder layer output) |
              attn_out (self_attn or linear_attn output).
        position: last (last token) | mean (mean over the assistant span; whole text for raw strings) |
                  all_assistant (every assistant token; returns a list of [t_i, hidden] tensors per layer).
        Returns a CPU float32 tensor [n, hidden] (or a list) for an int layer, else {layer: ...}.
        """
        import torch

        self._check_unlocked()
        if position not in POSITIONS:
            raise ValueError(f"position must be one of {POSITIONS}")
        single = isinstance(layers, int)
        layer_list = [layers] if single else list(layers)
        texts = list(texts.outputs if isinstance(texts, Generation) else texts)
        if not texts:
            raise ValueError("no texts")
        enc = [self._encode_text(t, max_len) for t in texts]
        if _charge:
            self._charge("activations", len(texts), f"activations[{site}@{layer_list}]")
        store: dict[int, list] = {L: [] for L in layer_list}
        meta: list[tuple[int, int]] = []

        def make_hook(L):
            def hook(_mod, _inp, out):
                h = out[0] if isinstance(out, (tuple, list)) else out
                h = getattr(h, "last_hidden_state", h).detach()
                for b, (n_tok, start) in enumerate(meta):
                    if position == "last":
                        v = h[b, n_tok - 1]
                    elif position == "mean":
                        v = h[b, start:n_tok].float().mean(0)
                    else:
                        v = h[b, start:n_tok]
                    store[L].append(v.float().cpu())
            return hook

        handles = [self._site_module(L, site).register_forward_hook(make_hook(L)) for L in layer_list]
        try:
            with torch.no_grad():
                for i in range(0, len(enc), self.act_batch_size):
                    chunk = enc[i : i + self.act_batch_size]
                    T = max(len(ids) for ids, _ in chunk)
                    ids = torch.full((len(chunk), T), self.pad_id, dtype=torch.long)
                    att = torch.zeros((len(chunk), T), dtype=torch.long)
                    for b, (x, _) in enumerate(chunk):  # right padding: causal, so padding never affects real tokens
                        ids[b, : len(x)] = torch.tensor(x)
                        att[b, : len(x)] = 1
                    meta[:] = [(len(x), s) for x, s in chunk]
                    self._forward_no_logits(ids.to(self.device), att.to(self.device))
        finally:
            for h in handles:
                h.remove()
        out = {L: (store[L] if position == "all_assistant" else torch.stack(store[L])) for L in layer_list}
        return out[layer_list[0]] if single else out

    # ------------------------------------------------------------------ directions
    def contrast_direction(self, good_texts, bad_texts, layer: Union[int, Sequence[int]], site: str = "mlp_out",
                           position: str = "mean"):
        """Unit difference of means, pointing from good to bad: d = normalize(mean(bad) - mean(good)).

        Accepts texts (costs one activations call for good+bad together) or precomputed [n, hidden] tensors
        (free). Returns a tensor for an int layer, else {layer: tensor}. Stats in ws.last_contrast.
        """
        import torch

        if position == "all_assistant":
            raise ValueError("use position='mean' or 'last' for directions")
        single = isinstance(layer, int)
        layer_list = [layer] if single else list(layer)
        if isinstance(good_texts, torch.Tensor) and isinstance(bad_texts, torch.Tensor):
            if not single:
                raise ValueError("precomputed tensors work with a single layer")
            acts = {layer: torch.cat([good_texts.float(), bad_texts.float()])}
            ng = good_texts.shape[0]
        else:
            good, bad = list(good_texts), list(bad_texts)
            if len(good) < 2 or len(bad) < 2:
                raise ValueError(f"need >= 2 good and >= 2 bad texts (got {len(good)} / {len(bad)})")
            acts = self.activations(good + bad, layer_list, site, position)
            if single:
                acts = {layer: acts}
            ng = len(good)
        dirs, self.last_contrast = {}, {}
        for L in layer_list:
            A = acts[L]
            g, b = A[:ng], A[ng:]
            diff = b.mean(0) - g.mean(0)
            d = diff / diff.norm().clamp_min(1e-12)
            pg, pb = (g @ d).tolist(), (b @ d).tolist()
            st = {"cohens_d_in_sample": C.cohens_d(pg, pb), "diff_norm": float(diff.norm()),
                  "mean_act_norm": float(A.norm(dim=1).mean()), "n_good": ng, "n_bad": A.shape[0] - ng}
            self.last_contrast[L] = st
            dirs[L] = d
            print(f"[contrast] layer {L} {site}: d'={st['cohens_d_in_sample']:.2f} (in-sample) "
                  f"|diff|={st['diff_norm']:.3f} vs |act|~{st['mean_act_norm']:.3f}")
        return dirs[layer] if single else dirs

    def pca_directions(self, texts, layer: int, site: str = "mlp_out", k: int = 5, position: str = "mean"):
        """Top-k principal directions of the activations (costs one activations call unless a tensor is given).
        Returns (components [k, hidden], explained-variance ratios)."""
        import torch

        X = texts.float() if isinstance(texts, torch.Tensor) else self.activations(texts, layer, site, position)
        Xc = X - X.mean(0, keepdim=True)
        _, S_, Vh = torch.linalg.svd(Xc, full_matrices=False)
        var = S_ ** 2
        ratio = (var / var.sum().clamp_min(1e-12))[:k].tolist()
        print(f"[pca] layer {layer} {site}: explained " + ", ".join(f"{r:.1%}" for r in ratio))
        return Vh[:k].clone(), ratio

    def logit_lens(self, direction, top_k: int = 20, apply_norm: bool = True) -> dict:
        """Tokens a residual-stream direction promotes / suppresses via the unembedding (free, weights only)."""
        import torch

        with torch.no_grad():
            W = self.model.get_output_embeddings().weight  # [vocab, hidden]
            x = direction.detach().float().to(W.device).reshape(-1)
            if x.numel() != W.shape[1]:
                raise ValueError(f"direction has {x.numel()} dims, hidden size is {W.shape[1]}")
            x = x / x.norm().clamp_min(1e-12)
            if apply_norm and self._final_norm is not None:
                nw = next(self._final_norm.parameters(), None)
                x = self._final_norm(x.to(nw.dtype if nw is not None else W.dtype).unsqueeze(0)).squeeze(0)
            logits = (W @ x.to(W.dtype)).float()
            top = torch.topk(logits, top_k)
            bot = torch.topk(-logits, top_k)
        fmt = lambda ids, vals: [(self.tok.decode([int(i)]), round(float(v), 3)) for i, v in zip(ids, vals)]
        res = {"promoted": fmt(top.indices.tolist(), top.values.tolist()),
               "suppressed": fmt(bot.indices.tolist(), (-bot.values).tolist())}
        print("[logit_lens] promoted:  " + " ".join(repr(t) for t, _ in res["promoted"]))
        print("[logit_lens] suppressed: " + " ".join(repr(t) for t, _ in res["suppressed"]))
        return res

    def top_columns(self, layer: int, direction, k: int = 64, module: str = "mlp.down_proj",
                    orientation: str = DEFAULT_ORIENTATION, by: str = "dot") -> list[int]:
        """Columns (intermediate neurons) of down_proj whose write vectors are most aligned with `direction` (free).

        neuron_columns: score_j = |d . W[:, j]| (by='dot') or that divided by ||W[:, j]|| (by='cos').
        hidden_rows:    score_i = |d_i| (rows = residual coordinates).
        """
        import torch

        W = self._params[self.layer_param(layer, module)].detach().float()
        d = direction.detach().float().to(W.device).reshape(-1)
        d = d / d.norm().clamp_min(1e-12)
        if d.numel() != W.shape[0]:
            raise ValueError(f"direction has {d.numel()} dims; {module} writes {W.shape[0]}")
        if orientation == "neuron_columns":
            s = (d @ W).abs()
            if by == "cos":
                s = s / W.norm(dim=0).clamp_min(1e-12)
        elif orientation == "hidden_rows":
            s = d.abs()
        else:
            raise ValueError(f"orientation must be one of {ORIENTATIONS}")
        k = min(k, s.numel())
        vals, idx = torch.topk(s, k)
        share = float((vals ** 2).sum() / (s ** 2).sum().clamp_min(1e-12))
        print(f"[top_columns] layer {layer} {module} ({orientation}): top {k} hold {share:.1%} of the "
              f"direction's squared {'write' if orientation == 'neuron_columns' else 'weight'} mass")
        return [int(i) for i in idx.tolist()]

    # ------------------------------------------------------------------ edits
    def _selfcheck_projection(self):
        """Compare the torch projection with the pure reference once, on a tiny random matrix."""
        import random as _r

        rng = _r.Random(0)
        W = [[rng.uniform(-1, 1) for _ in range(5)] for _ in range(6)]
        d = [rng.uniform(-1, 1) for _ in range(6)]
        for orient, idx in (("neuron_columns", [0, 3]), ("hidden_rows", [1, 4, 5])):
            ref = C.project_out_py(W, d, idx, 0.7, orient)
            got = self._project_out_torch(_as_tensor(W), _as_tensor(d), idx, 0.7, orient).tolist()
            err = max(abs(a - b) for ra, rb in zip(ref, got) for a, b in zip(ra, rb))
            if err > 1e-5:
                raise WSPError(f"projection self-check failed ({orient}, max err {err})")
        self._selfchecked = True

    @staticmethod
    def _project_out_torch(W, d, idx, strength: float, orientation: str):
        """Torch mirror of wsp_core.project_out_py. W [out, in], d in output space. Returns float32."""
        import torch

        Wf = W.detach().float().clone()
        u = d.detach().float().to(Wf.device).reshape(-1)
        u = u / u.norm().clamp_min(1e-12)
        ix = torch.as_tensor(list(idx), dtype=torch.long, device=Wf.device)
        if orientation == "neuron_columns":
            sub = Wf[:, ix]                         # [out, k]  write vectors of the selected neurons
            coef = u @ sub                          # [k]       their components along u
            Wf[:, ix] = sub - strength * torch.outer(u, coef)
        elif orientation == "hidden_rows":
            coef = u @ Wf                           # [in]
            Wf[ix, :] = Wf[ix, :] - strength * torch.outer(u[ix], coef)
        else:
            raise ValueError(f"orientation must be one of {ORIENTATIONS}")
        return Wf

    def _compute(self, op: str, cur, params: dict, payload: dict):
        """New value (in cur's dtype/device) for one edit applied on top of `cur`."""
        Wf = cur.detach().float()
        if op == "subtract_direction":
            new = self._project_out_torch(Wf, payload["d"], params["columns"], params["strength"], params["orientation"])
        elif op == "scale":
            new = Wf.clone()
            ix = C.index_from_json(params["index"])
            ix = Ellipsis if ix is None else ix
            new[ix] = new[ix] * float(params["factor"])
        elif op == "add":
            new = Wf.clone()
            ix = C.index_from_json(params["index"])
            ix = Ellipsis if ix is None else ix
            v = payload["value"]
            new[ix] = new[ix] + (v.float().to(new.device) if hasattr(v, "float") else float(v))
        elif op == "set":
            v = payload["value"]
            if tuple(v.shape) != tuple(cur.shape):
                raise ValueError(f"shape {tuple(v.shape)} != {tuple(cur.shape)}")
            new = v.float().to(Wf.device)
        else:
            raise ValueError(f"unknown op {op}")
        return new.to(cur.dtype)

    def _apply_edit(self, op: str, name: str, params: dict, payload: dict, note: str = "") -> str:
        import torch

        self._check_unlocked()
        if name not in self._params:
            raise KeyError(f"{name} is not a parameter")
        if C.is_protected(name, self.protected):
            raise GuardrailError(f"{name} is read-only (embeddings / unembedding / vision tower / MTP). "
                                 f"Pass protected=() to Workspace to override.")
        p = self._params[name]
        if name not in self._orig:
            self._orig[name] = p.detach().cpu().clone()
        before = C.tensor_sha256(p)
        new = self._compute(op, p.data, params, payload)
        changed = int((new.cpu() != self._orig[name]).sum())
        counts = dict(self._changed)
        counts[name] = changed
        ok, frac = C.check_change_cap(counts, self.total_params, self.max_changed_frac)
        if not ok:
            raise GuardrailError(f"refused: the edit would leave {sum(counts.values()):,} params changed = {100 * frac:.4f}% "
                                 f"of the model, above the cap {100 * self.max_changed_frac:.3f}%. Edit fewer columns, "
                                 f"or raise ws.max_changed_frac deliberately (and note why).")
        with torch.no_grad():
            p.data.copy_(new)
        self._changed[name] = changed
        eid = self.log.add(op, name, params, before, C.tensor_sha256(p), changed, note)
        self._payloads[eid] = payload
        if changed == 0:
            print(f"[edit] WARNING: {eid} changed nothing (strength too small for dtype {p.dtype}?)")
        print(f"[edit] {eid} {op} on {name}: {changed:,} weights differ from the original in this tensor; "
              f"model total {100 * frac:.4f}% (cap {100 * self.max_changed_frac:.3f}%)")
        return eid

    def edit_subtract_direction(self, layer: int, direction, columns: Union[None, int, Sequence[int]] = None,
                                strength: float = 1.0, module: str = "mlp.down_proj",
                                orientation: str = DEFAULT_ORIENTATION, note: str = "") -> str:
        """Projection removal on a layer's weight W [out, in] (down_proj: [hidden, intermediate]); d is normalised.

        orientation='neuron_columns' (default, MIT-style): W[:, J] -= s * d (d^T W[:, J]) for the selected
            columns J (intermediate neurons). Their write vectors lose their d-component (s=1); every other
            component and every other column is untouched. 64 columns x hidden 1024 = 65,536 weights.
        orientation='hidden_rows': W[R, :] -= s * d[R] (d^T W) for the selected residual coordinates R.
        columns: None = all (full (I - s d d^T) W; usually above the cap), int k = top_columns(k), or indices.
        """
        if not self._selfchecked:
            self._selfcheck_projection()
        name = self.layer_param(layer, module)
        W = self._params[name]
        d = direction.detach().float().cpu().reshape(-1)
        if d.numel() != W.shape[0]:
            raise ValueError(f"direction has {d.numel()} dims; {module} output has {W.shape[0]}")
        d = d / d.norm().clamp_min(1e-12)
        n_idx = W.shape[1] if orientation == "neuron_columns" else W.shape[0]
        if columns is None:
            idx = list(range(n_idx))
        elif isinstance(columns, int) and not isinstance(columns, bool):
            idx = self.top_columns(layer, d, k=columns, module=module, orientation=orientation)
        else:
            idx = [int(c) for c in (columns.tolist() if hasattr(columns, "tolist") else columns)]
        if not idx or min(idx) < 0 or max(idx) >= n_idx:
            raise ValueError(f"column indices must be in 0..{n_idx - 1}")
        params = {"layer": layer, "module": module, "orientation": orientation, "strength": float(strength),
                  "columns": idx, "direction": [round(float(x), 8) for x in d.tolist()],
                  "direction_sha256": C.tensor_sha256(d)}
        return self._apply_edit("subtract_direction", name, params, {"d": d}, note)

    def edit_scale(self, tensor_name: str, index_slice: Any, factor: float, note: str = "") -> str:
        """W[index_slice] *= factor. index_slice: None (whole tensor), int, slice, list or a tuple of those,
        e.g. (slice(None), [5, 9]) = columns 5 and 9."""
        params = {"index": C.index_to_json(index_slice), "factor": float(factor)}
        return self._apply_edit("scale", tensor_name, params, {}, note)

    def edit_add(self, tensor_name: str, index_slice: Any, value: Any, note: str = "") -> str:
        """W[index_slice] += value (scalar or tensor broadcastable to the slice)."""
        payload = {"value": value.detach().cpu().clone() if hasattr(value, "detach") else float(value)}
        params = {"index": C.index_to_json(index_slice),
                  "value": (C.tensor_sha256(payload["value"]) if hasattr(value, "detach") else float(value)),
                  "value_shape": list(value.shape) if hasattr(value, "shape") else []}
        return self._apply_edit("add", tensor_name, params, payload, note)

    def edit_set(self, tensor_name: str, value, note: str = "") -> str:
        """Replace a whole tensor (used by presets.apply_mit_edit(mode='replace'))."""
        v = value.detach().cpu().clone()
        return self._apply_edit("set", tensor_name, {"value_sha256": C.tensor_sha256(v), "shape": list(v.shape)},
                                {"value": v}, note)

    def _replay(self):
        import torch

        with torch.no_grad():
            for name, orig in self._orig.items():
                self._params[name].data.copy_(orig.to(self._params[name].device))
            for e in self.log.active():
                p = self._params[e["tensor"]]
                p.data.copy_(self._compute(e["op"], p.data, e["params"], self._payloads[e["id"]]))
            for name, orig in self._orig.items():
                self._changed[name] = int((self._params[name].detach().cpu() != orig).sum())

    def revert(self, edit_id: str) -> None:
        """Undo one edit (the remaining edits are replayed from the original weights, in order)."""
        self._check_unlocked()
        self.log.mark_reverted(edit_id)
        self._replay()
        print(f"[revert] {edit_id} reverted; active edits: {self.log.active_ids() or '-'}")

    def revert_all(self) -> None:
        self._check_unlocked()
        for eid in self.log.active_ids():
            self.log.mark_reverted(eid)
        self._replay()
        print("[revert] all edits reverted")

    def diff_summary(self) -> dict:
        """Tensors changed vs the session's starting weights, #params changed, % of the model (free)."""
        rows = []
        for name, orig in self._orig.items():
            ch = int((self._params[name].detach().cpu() != orig).sum())
            if ch:
                rows.append({"name": name, "changed": ch, "numel": orig.numel()})
        total = sum(r["changed"] for r in rows)
        res = {"tensors": rows, "changed_params": total, "total_params": self.total_params,
               "fraction": total / self.total_params, "percent": 100 * total / self.total_params,
               "cap_fraction": self.max_changed_frac, "active_edits": self.log.active_ids()}
        print(f"[diff] {total:,} params in {len(rows)} tensor(s) = {res['percent']:.4f}% of the model "
              f"(cap {100 * self.max_changed_frac:.3f}%)")
        for r in rows:
            print(f"    {r['name']}: {r['changed']:,}/{r['numel']:,}")
        return res

    # ------------------------------------------------------------------ comparisons / final test
    @contextlib.contextmanager
    def _original_weights(self):
        import torch

        saved = {n: self._params[n].detach().clone() for n in self._orig}
        try:
            with torch.no_grad():
                for n, o in self._orig.items():
                    self._params[n].data.copy_(o.to(self._params[n].device))
            yield
        finally:
            with torch.no_grad():
                for n, s in saved.items():
                    self._params[n].data.copy_(s)

    def compare_bases(self, n: int = 32, split: str = "dev", max_new_tokens: int = 512, other: Optional[str] = None,
                      thinking: Optional[bool] = None, **kw) -> dict:
        """Score the current (edited) model and a reference on the same items. Costs 2 x ceil(n/64) passes.

        other=None: the reference is this session's starting weights (edits temporarily undone).
        other='Qwen/Qwen3.5-0.8B' (or a path): load that model temporarily (needs memory for two models).
        """
        items = self._items(split, n, kw.pop("kind", None), kw.pop("offset", 0))
        need = 2 * self.budget.cost("generate", len(items))
        if not self.budget.can_afford(need):
            raise BudgetExceeded(f"compare_bases needs {need} passes, {self.budget.remaining} left")
        cur = self.generate(items, None, max_new_tokens, thinking, label="compare:current", **kw)
        if other is None:
            with self._original_weights():
                ref = self.generate(items, None, max_new_tokens, thinking, label="compare:start-weights", **kw)
            ref_name = "start weights"
        else:
            import torch

            ref_path = C.resolve_model_ref(other)
            mine = self.model
            self.model = TL.load_base(ref_path, self.dtype, self.trust_remote_code).to(self.device).eval()
            try:
                ref = self.generate(items, None, max_new_tokens, thinking, label=f"compare:{other}", **kw)
            finally:
                self.model = mine
                if self.device.type == "cuda":
                    torch.cuda.empty_cache()
            ref_name = other
        tbl = compare_table({"current": cur.metrics, ref_name: ref.metrics})
        print(tbl)
        return {"current": cur, "reference": ref, "table": tbl}

    def final_test(self, max_new_tokens: int = 512, thinking: Optional[bool] = None, temperature: float = 0.0) -> Generation:
        """Run the LOCKED eval split once on the current weights (not charged to the budget), record the metrics,
        then lock the session: no more generate / activations / edits. save() still works."""
        self._check_unlocked()
        items = self.splits.take_test()
        if not items:
            raise WSPError("eval.jsonl is empty or missing")
        gen = self.generate(items, None, max_new_tokens, thinking, temperature, label="FINAL TEST", _charge=False)
        self.final = {"t": time.strftime("%Y-%m-%dT%H:%M:%S"), "metrics": gen.metrics, "n": len(items),
                      "active_edits": self.log.active_ids(), "budget_used": self.budget.used,
                      "max_new_tokens": max_new_tokens, "thinking": self.thinking if thinking is None else thinking,
                      "samples": [{k: o[k] for k in ("id", "kind", "text")} for o in gen.outputs[:6]]}
        self.locked = True
        print("[final_test] recorded; the session is now locked.")
        return gen

    # ------------------------------------------------------------------ saving
    def _source_dtype(self):
        import torch

        cfg = self.model.config
        for c in (cfg, getattr(cfg, "text_config", None)):
            if c is None:
                continue
            v = getattr(c, "torch_dtype", None) or getattr(c, "dtype", None)
            if isinstance(v, torch.dtype):
                return v
            if isinstance(v, str) and hasattr(torch, v):
                return getattr(torch, v)
        return torch.bfloat16

    def state(self) -> dict:
        return {"format": "bloop-wsp-session/1", "model": self.model_ref, "saved_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                "settings": {"device": str(self.device), "dtype": str(self.dtype), "thinking": self.thinking,
                             "max_changed_frac": self.max_changed_frac, "protected": list(self.protected),
                             "seed": self.seed, "dev_size": len(self.splits.dev)},
                "budget": self.budget.to_json(), "edits": self.log.to_json(), "metrics_history": self.history,
                "final_test": self.final, "notes": list(self._notes.items), "splits": self.splits.sizes(),
                "reference": {"method": "weight-space programming (MIT CSAIL)", "blog": C.MIT_BLOG,
                              "checkpoint": C.MIT_REPO}}

    def export_patch(self, out_dir: str, save_dtype=None) -> Optional[Path]:
        """Write patch.safetensors (changed tensors + fp32 deltas) and patch.json. Returns the path or None."""
        import torch
        from safetensors.torch import save_file

        out = Path(out_dir)
        out.mkdir(parents=True, exist_ok=True)
        sd = save_dtype or self._source_dtype()
        tensors, entries = {}, {}
        for name, orig in self._orig.items():
            cur = self._params[name].detach().cpu()
            if not bool((cur != orig).any()):
                continue
            after, before = cur.to(sd).contiguous(), orig.to(sd).contiguous()
            tensors[name] = after
            tensors[C.delta_key(name)] = (after.float() - before.float()).contiguous()
            entries[name] = {"shape": list(after.shape), "dtype": str(sd).replace("torch.", ""),
                             "before_sha256": C.tensor_sha256(before), "after_sha256": C.tensor_sha256(after),
                             "changed": int((after != before).sum())}
        if not tensors:
            print("[patch] no changed tensors; nothing to export")
            return None
        meta = C.build_patch_metadata(self.model_ref, entries, {"edits": [e["id"] for e in self.log.active()],
                                                                 "total_params": self.total_params})
        path = out / "patch.safetensors"
        save_file(tensors, str(path), metadata=meta)
        (out / "patch.json").write_text(json.dumps({"metadata": C.parse_patch_metadata(meta)}, indent=2), encoding="utf-8")
        lost = {n: e for n, e in entries.items() if e["changed"] < self._changed.get(n, 0)}
        if lost:
            print(f"[patch] note: rounding to {sd} drops some tiny changes: "
                  + ", ".join(f"{n}: {self._changed[n]} -> {e['changed']}" for n, e in lost.items()))
        print(f"[patch] {path} ({len(entries)} tensor(s)); apply with: python ml/wsp/apply_patch.py --base <model> "
              f"--patch {path} --out <dir> [--mode delta]")
        _ = torch  # keep the lazy import explicit
        return path

    def save(self, out_dir: str = "ml/out/wsp", save_dtype: str = "auto", full_model: bool = True) -> Path:
        """Write <out_dir>/model (full edited HF model, source dtype by default), patch.safetensors, patch.json,
        edits.json (ops, hashes, budget, metrics history, final test, notes) and EDIT_REPORT.md."""
        import torch

        out = Path(out_dir)
        out.mkdir(parents=True, exist_ok=True)
        sd = self._source_dtype() if save_dtype == "auto" else _torch_dtype(save_dtype)
        self.export_patch(str(out), sd)
        if full_model:
            mdir = out / "model"
            mdir.mkdir(parents=True, exist_ok=True)
            if sd == self.dtype:
                self.model.save_pretrained(mdir, safe_serialization=True)
            else:
                # Convert a CPU copy of the state dict (the live model keeps its dtype and its fp32 buffers).
                # Tensors that share storage (tied embeddings) stay shared so save_pretrained drops the duplicate.
                # Unedited weights round-trip exactly when sd is the checkpoint's own dtype.
                state, seen = {}, {}
                for k, v in self.model.state_dict().items():
                    key = (v.data_ptr(), tuple(v.shape), v.dtype)
                    if key not in seen:
                        seen[key] = v.detach().to("cpu", sd if v.is_floating_point() else v.dtype)
                    state[k] = seen[key]
                self.model.save_pretrained(mdir, state_dict=state, safe_serialization=True)
                del state, seen
            TL.save_tokenizer_files(self.model_ref, self.tok, mdir, self.trust_remote_code)
            src_info = Path(self.model_ref) / "bloop_merge_info.json"
            info = json.loads(src_info.read_text()) if src_info.exists() else {}
            info["wsp"] = {"source_model": self.model_ref, "edits": self.log.active_ids(), "patch": "../patch.safetensors"}
            (mdir / "bloop_merge_info.json").write_text(json.dumps(info, indent=2), encoding="utf-8")
            print(f"[save] full model -> {mdir} ({str(sd).replace('torch.', '')})")
        st = self.state()
        st["diff"] = self.diff_summary()
        (out / "edits.json").write_text(json.dumps(st, indent=2, default=str), encoding="utf-8")
        (out / "EDIT_REPORT.md").write_text(C.render_report(st), encoding="utf-8")
        (out / "notes.md").write_text("".join(f"- {n['t']} [{n['budget_left']} left] {n['text']}\n"
                                              for n in st["notes"]), encoding="utf-8")
        print(f"[save] {out}/edits.json, EDIT_REPORT.md, notes.md")
        _ = torch
        return out


def _as_tensor(x):
    import torch

    return torch.tensor(x, dtype=torch.float32)
``````

### `ml/wsp/presets.py`

<!-- FILE: ml/wsp/presets.py sha256=0c9872d1da2f4c8220ddc9e4f10d844e81aa6849bf945c6f20be28a8f5d99f40 nl=1 -->
``````python
"""Presets for the weight-space harness.

* apply_mit_edit(ws, mode="replace" | "delta"): bring MIT CSAIL's published edit
  (RikiyaT/Qwen3.5-0.8B-weight-space-programming, Apache-2.0) into the current model. Only
  model.language_model.layers.{15,19}.mlp.down_proj.weight differ from Qwen/Qwen3.5-0.8B.
* mit_directions(ws): recover MIT's per-layer direction and edited columns from the published delta, so you
  can re-apply *the direction* to a fine-tuned model with ws.edit_subtract_direction (free, weights only).
* find_loop_direction(ws): a reproduction recipe for MIT's diagnosis (looping vs finishing outputs ->
  difference of MLP-output means per layer -> rank layers by held-out separation).

Tensors are read from the Hub with HTTP range requests (only the ~7 MB of each tensor, not the 1.7 GB file),
falling back to a full download. torch / huggingface_hub are imported lazily.
"""
from __future__ import annotations

import json
import sys
import warnings
from pathlib import Path
from typing import Optional, Sequence

sys.path.insert(0, str(Path(__file__).resolve().parent))
import wsp_core as C  # noqa: E402

_TORCH_DTYPES = {"BF16": "bfloat16", "F16": "float16", "F32": "float32"}


# --------------------------------------------------------------------------- reading tensors from the Hub
def _weight_file(repo: str, key: str, revision: Optional[str]) -> str:
    from huggingface_hub import hf_hub_download

    try:
        idx = hf_hub_download(repo, "model.safetensors.index.json", revision=revision)
        wm = json.loads(Path(idx).read_text())["weight_map"]
        if key in wm:
            return wm[key]
        hit = C.match_param_name(key, wm)
        if hit:
            return wm[hit]
        raise KeyError(f"{key} not in {repo}'s weight map")
    except KeyError:
        raise
    except Exception:  # noqa: BLE001  (no index -> single-file checkpoint)
        return "model.safetensors"


def read_hub_tensor(repo: str, key: str, revision: Optional[str] = None):
    """One tensor from a Hub safetensors checkpoint (range request; full download as a fallback)."""
    import torch

    fname = _weight_file(repo, key, revision)
    try:
        from huggingface_hub import HfFileSystem

        fs = HfFileSystem()
        path = f"{repo}@{revision}/{fname}" if revision else f"{repo}/{fname}"
        with fs.open(path, "rb") as f:
            head8 = f.read(8)
            n = int.from_bytes(head8, "little")
            _, header = C.parse_safetensors_header(head8 + f.read(n))
            real = key if key in header else C.match_param_name(key, [k for k in header if k != "__metadata__"])
            if real is None:
                raise KeyError(f"{key} not in {repo}/{fname}")
            a, b = C.tensor_byte_range(header, n, real)
            f.seek(a)
            buf = f.read(b - a)
        info = header[real]
        dt = getattr(torch, _TORCH_DTYPES[info["dtype"]])
        return torch.frombuffer(bytearray(buf), dtype=dt).reshape(info["shape"]).clone()
    except (KeyError, ValueError):
        raise
    except Exception as e:  # noqa: BLE001
        print(f"[hub] range read failed ({type(e).__name__}: {e}); downloading {repo}/{fname} instead")
        from huggingface_hub import hf_hub_download
        from safetensors import safe_open

        local = hf_hub_download(repo, fname, revision=revision)
        with safe_open(local, "pt") as sf:
            real = key if key in sf.keys() else C.match_param_name(key, list(sf.keys()))
            return sf.get_tensor(real)


def delta_structure(delta) -> dict:
    """Which columns/rows a weight delta touches and how rank-1 it is. For an MIT-style edit
    W[:, J] -= d d^T W[:, J], the delta is nonzero only in columns J and its top left singular vector is +-d."""
    import torch

    D = delta.float()
    nz = D != 0
    cols = torch.nonzero(nz.any(0)).flatten().tolist()
    rows = torch.nonzero(nz.any(1)).flatten().tolist()
    sub = D[:, cols] if cols else D
    U, S_, _ = torch.linalg.svd(sub, full_matrices=False)
    energy = float(S_[0] ** 2 / (S_ ** 2).sum().clamp_min(1e-30)) if S_.numel() else 0.0
    return {"changed": int(nz.sum()), "n_cols": len(cols), "n_rows": len(rows), "cols": cols,
            "rank1_energy": energy, "direction": U[:, 0].clone() if S_.numel() else None,
            "fro_norm": float(D.norm())}


# --------------------------------------------------------------------------- MIT edit
def _mit_pairs(ws, layers, repo, base_repo, revision, need_base: bool):
    names = ws.param_names()
    for L in layers:
        key = C.MIT_KEY.format(L)
        name = C.match_param_name(key, names)
        if name is None:
            raise C.WSPError(f"cannot map {key} onto this model's parameters")
        mit = read_hub_tensor(repo, key, revision)
        base = read_hub_tensor(base_repo, key) if need_base else None
        yield L, key, name, mit, base


def apply_mit_edit(ws, mode: str = "replace", layers: Sequence[int] = C.MIT_LAYERS, repo: str = C.MIT_REPO,
                   base_repo: str = C.QWEN_BASE_REPO, revision: Optional[str] = None, check_base: bool = True) -> list[str]:
    """Bring MIT's two edited down_proj tensors into the current model. Returns the edit ids.

    mode="replace": copy MIT's tensors in. Correct ONLY when the current model is the plain base
        (Qwen/Qwen3.5-0.8B): on a LoRA-merged Bloop model it would also throw away whatever the LoRA learned in
        these two tensors (and the guardrail will usually refuse, since the whole tensor changes).
    mode="delta": add (MIT - Qwen base) to the current tensors. Use this for a LoRA-merged model: it transfers
        exactly MIT's change (131,072 weights) on top of the fine-tune.
    """
    if mode not in ("replace", "delta"):
        raise ValueError("mode must be 'replace' or 'delta'")
    if "weight-space-programming" in str(ws.model_ref):
        warnings.warn("the loaded model already IS MIT's edited checkpoint; applying the edit again is a no-op "
                      "(replace) or doubles it (delta).")
    merged_info = Path(str(ws.model_ref)) / "bloop_merge_info.json"
    if mode == "replace" and merged_info.exists():
        warnings.warn("this looks like a LoRA-merged Bloop model (bloop_merge_info.json). mode='replace' discards the "
                      "LoRA's change to these tensors; use mode='delta' (MIT - Qwen base, added).")
    ids = []
    for L, key, name, mit, base in _mit_pairs(ws, layers, repo, base_repo, revision, mode == "delta" or check_base):
        cur0 = ws.original(name)
        if base is not None:
            st = delta_structure(mit.float() - base.float())
            print(f"[mit] layer {L}: MIT changed {st['changed']:,} weights in {st['n_cols']} columns x {st['n_rows']} rows "
                  f"(rank-1 energy {st['rank1_energy']:.3f})")
            if mode == "replace" and not bool((cur0.to(base.dtype) == base).all()):
                warnings.warn(f"layer {L}: the current tensor differs from {base_repo}'s; 'replace' will overwrite "
                              f"that difference. Prefer mode='delta' for fine-tuned models.")
        if mode == "replace":
            ids.append(ws.edit_set(name, mit, note=f"preset:mit replace L{L} from {repo}"))
        else:
            ids.append(ws.edit_add(name, None, mit.float() - base.float(), note=f"preset:mit delta L{L} ({repo} - {base_repo})"))
    ws.notes(f"apply_mit_edit(mode={mode}, layers={list(layers)}) -> {ids}")
    return ids


def mit_directions(ws, layers: Sequence[int] = C.MIT_LAYERS, repo: str = C.MIT_REPO,
                   base_repo: str = C.QWEN_BASE_REPO, revision: Optional[str] = None) -> dict:
    """{layer: {"direction", "columns", "rank1_energy", ...}} recovered from MIT's delta (free; downloads ~28 MB).

    Re-use on a fine-tuned model:  info = mit_directions(ws)
        for L, x in info.items(): ws.edit_subtract_direction(L, x["direction"], columns=x["columns"])
    (the fine-tune's own write vectors are projected, rather than pasting MIT's numbers in)."""
    out = {}
    for L, key, name, mit, base in _mit_pairs(ws, layers, repo, base_repo, revision, True):
        st = delta_structure(mit.float() - base.float())
        st["tensor"] = name
        out[L] = st
        print(f"[mit] layer {L}: {st['n_cols']} columns, rank-1 energy {st['rank1_energy']:.3f}")
    return out


# --------------------------------------------------------------------------- diagnosis recipe
def find_loop_direction(ws, layers: Optional[Sequence[int]] = None, n: int = 64, split: str = "dev",
                        max_new_tokens: int = 512, thinking: Optional[bool] = None, temperature: float = 0.0,
                        site: str = "mlp_out", position: str = "mean", min_group: int = 4, top: int = 3,
                        k_columns: int = 64, generation=None, seed: int = 0) -> dict:
    """Reproduce MIT's diagnosis on Bloop data. Cost: 1 generate pass (skip it by passing `generation=`)
    + ceil((#good + #bad) / 128) activation passes (all candidate layers at once).

    1. Generate on dev; 'bad' = hit the token limit or looping, 'good' = finished cleanly.
    2. Read the MLP outputs (site) at every candidate layer, mean over the assistant tokens.
    3. Per layer: direction from one half of each group, Cohen's d of the projections on the other half
       (held-out separation, so the ranking is not just overfitting). Rank layers by it.
    4. For the top layers: the full-data direction, its logit lens and the top-k down_proj columns.

    With thinking OFF and short JSON outputs, loops may be rare: if there are fewer than `min_group` bad
    outputs the recipe stops and says so (try thinking=True, a larger n, or temperature 0.6 to elicit them).
    """
    gen = generation if generation is not None else ws.generate(split, n=n, max_new_tokens=max_new_tokens,
                                                                thinking=thinking, temperature=temperature,
                                                                label="find_loop_direction")
    bad, good = gen.loopers(), gen.finished()
    report: dict = {"n_good": len(good), "n_bad": len(bad), "status": "ok"}
    print(f"[loop] {len(bad)} looping/limit outputs vs {len(good)} finished")
    if len(bad) < min_group or len(good) < min_group:
        report["status"] = "too_few_examples"
        report["advice"] = ("Not enough of both groups. Loops may simply be rare on these thinking-off tasks, which "
                            "would mean MIT's obstacle is not Bloop's obstacle. Options: thinking=True, a larger n, "
                            "temperature=0.6, or contrast failures vs passes instead (gen.failures()/gen.passes()).")
        print("[loop] " + report["advice"])
        return report
    layers = list(layers) if layers is not None else list(range(ws.n_layers))
    acts = ws.activations(good + bad, layers, site, position)
    ng = len(good)
    ga, gb = C.split_halves(ng, seed)
    ba, bb = C.split_halves(len(bad), seed + 1)
    held, insample, dirs = {}, {}, {}
    for L in layers:
        A = acts[L]
        G, B = A[:ng], A[ng:]
        d_half = B[ba].mean(0) - G[ga].mean(0)
        d_half = d_half / d_half.norm().clamp_min(1e-12)
        held[L] = C.cohens_d((G[gb] @ d_half).tolist(), (B[bb] @ d_half).tolist())
        d = B.mean(0) - G.mean(0)
        d = d / d.norm().clamp_min(1e-12)
        dirs[L] = d
        insample[L] = C.cohens_d((G @ d).tolist(), (B @ d).tolist())
    ranked = C.rank_layers(held)
    print("[loop] layers by held-out separation (Cohen's d): " + ", ".join(f"L{L}={s:.2f}" for L, s in ranked[:8]))
    suggestions = []
    for L, s in ranked[:top]:
        lens = ws.logit_lens(dirs[L], top_k=12)
        cols = ws.top_columns(L, dirs[L], k=k_columns)
        suggestions.append({"layer": L, "heldout_d": s, "insample_d": insample[L], "columns": cols,
                            "promoted": [t for t, _ in lens["promoted"]]})
    report.update({"ranked": ranked, "insample": insample, "directions": dirs, "suggested": suggestions,
                   "site": site, "position": position,
                   "next": "for s in report['suggested'][:2]: ws.edit_subtract_direction(s['layer'], "
                           "report['directions'][s['layer']], columns=s['columns']); then ws.generate('dev', n=64)"})
    ws.notes(f"find_loop_direction: {len(bad)} bad / {len(good)} good; top layers {[L for L, _ in ranked[:top]]}")
    return report
``````

### `ml/wsp/session.ipynb`

<!-- FILE: ml/wsp/session.ipynb sha256=ef99df7abfbfb1e19f2fc9b1151acaaf179c74d9fba19cba745219e579561999 nl=1 -->
``````json
{
 "cells": [
  {
   "cell_type": "markdown",
   "metadata": {},
   "id": "title",
   "source": [
    "# Weight-space programming session for the Bloop model\n",
    "\n",
    "Edit the Bloop model's weights **directly, without gradients**: read activations, find a direction that causes a failure, subtract it from a few MLP write vectors, then verify. This follows MIT CSAIL's [weight-space programming](https://rikiyat.github.io/blog/weight-space-programming/) (Nov 2026). Their editor removed one \"looping\" direction from 64 `down_proj` columns in layers 15 and 19 of Qwen3.5-0.8B (131,072 weights): MATH-500 went from 7.9 to 48.1. The edited checkpoint is [RikiyaT/Qwen3.5-0.8B-weight-space-programming](https://huggingface.co/RikiyaT/Qwen3.5-0.8B-weight-space-programming).\n",
    "\n",
    "**Rules of the session** (the harness enforces them):\n",
    "- A budget of **50 forward passes**. One pass means generating for ≤ 64 prompts, or reading activations for ≤ 128 texts. Weight reads, `score`, `logit_lens`, `top_columns` and edits are free.\n",
    "- Practice data is `dev`, a fixed subset of `train.jsonl`. `test` (`eval.jsonl`) is locked and runs once, through `ws.final_test()`.\n",
    "- Edits may change at most **0.1%** of the parameters. Embeddings, the unembedding and the vision tower are read-only.\n",
    "- Every edit is logged with tensor hashes and can be reverted. Write your reasoning with `ws.notes(...)`.\n",
    "\n",
    "Works on a Colab T4 (fp32 by default, or `dtype=\"fp16\"`), and on CPU or Apple MPS (slowly). Untested end to end: see `ml/wsp/README.md`."
   ]
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "id": "s1",
   "source": [
    "## 1. Setup and GPU check"
   ]
  },
  {
   "cell_type": "code",
   "metadata": {},
   "id": "setup-env",
   "execution_count": null,
   "outputs": [],
   "source": [
    "!pip uninstall -y -q torchao  # Colab's old torchao (0.10) makes new peft refuse to load; we don't use it\n",
    "import os, sys\n",
    "IN_COLAB = \"google.colab\" in sys.modules\n",
    "if IN_COLAB:\n",
    "    REPO_URL = \"https://github.com/Bndrwe/StudyPet.git\"   # private repo: upload bloop-ml.zip and unzip to /content/StudyPet instead\n",
    "    if not os.path.isdir(\"/content/StudyPet\"):\n",
    "        if os.path.exists(\"/content/bloop-ml.zip\"):\n",
    "            !mkdir -p /content/StudyPet && unzip -o -q /content/bloop-ml.zip -d /content/StudyPet\n",
    "        else:\n",
    "            !git clone --depth 1 {REPO_URL} /content/StudyPet\n",
    "    %cd /content/StudyPet\n",
    "    !grep -v '^torch' ml/train/requirements.txt > /tmp/req.txt && pip install -q -U -r /tmp/req.txt\n",
    "else:\n",
    "    # local: run from the repo root, inside ml/.venv (bash ml/run_mac.sh creates it)\n",
    "    while not os.path.isdir(\"ml/wsp\") and os.getcwd() != \"/\":\n",
    "        os.chdir(\"..\")\n",
    "print(\"cwd:\", os.getcwd())"
   ]
  },
  {
   "cell_type": "code",
   "metadata": {},
   "id": "gpu-check",
   "execution_count": null,
   "outputs": [],
   "source": [
    "import torch\n",
    "if torch.cuda.is_available():\n",
    "    print(\"CUDA:\", torch.cuda.get_device_name(0), f\"{torch.cuda.get_device_properties(0).total_memory / 2**30:.0f} GiB\")\n",
    "elif getattr(torch.backends, \"mps\", None) and torch.backends.mps.is_available():\n",
    "    print(\"Apple MPS: works, but generation is slow. Consider a smaller n per call.\")\n",
    "else:\n",
    "    print(\"CPU only: works, but expect minutes per generate() call. On Colab: Runtime -> Change runtime type -> T4 GPU.\")"
   ]
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "id": "s2",
   "source": [
    "## 2. Load the model\n",
    "\n",
    "`MODEL` is usually the merged Bloop LoRA (`ml/out/merged`, from `train_lora.py`). You can also use the plain base (`\"Qwen/Qwen3.5-0.8B\"`) or MIT's checkpoint (`\"mit\"`). Thinking is **off**, as in the app. On a T4, fp32 (about 3.5 GB) fits and keeps edits exact. `dtype=\"fp16\"` halves the memory."
   ]
  },
  {
   "cell_type": "code",
   "metadata": {},
   "id": "load",
   "execution_count": null,
   "outputs": [],
   "source": [
    "sys.path.insert(0, \"ml/wsp\")\n",
    "from harness import Workspace\n",
    "import presets\n",
    "\n",
    "MODEL = \"ml/out/merged\" if os.path.exists(\"ml/out/merged/config.json\") else \"Qwen/Qwen3.5-0.8B\"\n",
    "ws = Workspace(MODEL, data_dir=\"ml/data\", budget=50, device=\"auto\", dev_size=128, seed=0)\n",
    "ws.status()"
   ]
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "id": "s3",
   "source": [
    "## 3. Baseline on dev (1 pass)"
   ]
  },
  {
   "cell_type": "code",
   "metadata": {},
   "id": "baseline",
   "execution_count": null,
   "outputs": [],
   "source": [
    "base = ws.generate(\"dev\", n=64, max_new_tokens=512)      # thinking OFF, temperature 0\n",
    "print(base.metrics[\"plans\"]); print(base.metrics[\"nudges\"])\n",
    "ws.notes(f\"baseline dev: primary {base.metrics['primary']:.2f}, hit_limit {base.metrics['hit_limit_rate']}, looping {base.metrics['looping_rate']}\")"
   ]
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "id": "s4",
   "source": [
    "## 4. Diagnose failures (free)\n",
    "\n",
    "Read the failures before forming a hypothesis. Is the JSON broken, the schema wrong, or a rule violated? Does the output loop or hit the token limit? Does `<think>` leak? Looping is MIT's obstacle, but Bloop's may differ."
   ]
  },
  {
   "cell_type": "code",
   "metadata": {},
   "id": "diagnose",
   "execution_count": null,
   "outputs": [],
   "source": [
    "from collections import Counter\n",
    "fails = base.failures()\n",
    "print(len(fails), \"failures /\", len(base), \"| loopers:\", len(base.loopers()))\n",
    "print(Counter(e.split(\" \")[0] for o in fails if o[\"kind\"] == \"plan\" for e in o[\"score\"][\"detail\"].get(\"errors\", [])))\n",
    "print(Counter((o[\"kind\"], o[\"score\"][\"hit_limit\"], o[\"score\"][\"looping\"], o[\"score\"][\"think_leak\"]) for o in fails))\n",
    "for i, o in enumerate(base.outputs):\n",
    "    if not o[\"score\"][\"ok\"]:\n",
    "        base.show(i, chars=600)\n",
    "        break"
   ]
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "id": "s5",
   "source": [
    "## 5. Find directions\n",
    "\n",
    "**A. MIT's recipe.** Contrast looping and finishing outputs, take the difference of MLP-output means at every layer, and rank the layers by held-out separation. This reuses the baseline generations, so it costs only the activation read (1 pass for ≤ 128 texts).\n",
    "\n",
    "**B. If loops are rare** (likely with thinking off and short JSON), contrast failures with passes instead.\n",
    "\n",
    "**C. MIT's own direction**, recovered from their published delta (free, about 28 MB download)."
   ]
  },
  {
   "cell_type": "code",
   "metadata": {},
   "id": "find-loop",
   "execution_count": null,
   "outputs": [],
   "source": [
    "report = presets.find_loop_direction(ws, generation=base)\n",
    "if report[\"status\"] == \"ok\":\n",
    "    for s in report[\"suggested\"]:\n",
    "        print(s[\"layer\"], round(s[\"heldout_d\"], 2), s[\"promoted\"][:8])"
   ]
  },
  {
   "cell_type": "code",
   "metadata": {},
   "id": "contrast-fail",
   "execution_count": null,
   "outputs": [],
   "source": [
    "# B: failures vs passes at a few candidate layers (1 pass)\n",
    "if len(base.failures()) >= 4 and len(base.passes()) >= 4:\n",
    "    dirs = ws.contrast_direction(base.passes(), base.failures(), layer=[11, 15, 19, 21], site=\"mlp_out\")\n",
    "    for L, d in dirs.items():\n",
    "        print(\"layer\", L, ws.last_contrast[L]); ws.logit_lens(d, top_k=12)"
   ]
  },
  {
   "cell_type": "code",
   "metadata": {},
   "id": "mit-dirs",
   "execution_count": null,
   "outputs": [],
   "source": [
    "# C: MIT's directions and columns (free; needs internet)\n",
    "mit = presets.mit_directions(ws)\n",
    "for L, x in mit.items():\n",
    "    print(L, x[\"n_cols\"], \"cols, rank-1 energy\", round(x[\"rank1_energy\"], 3)); ws.logit_lens(x[\"direction\"], top_k=10)"
   ]
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "id": "s6",
   "source": [
    "## 6. Try edits (free until you verify)\n",
    "\n",
    "`edit_subtract_direction` uses the default `orientation=\"neuron_columns\"`: `W[:, J] -= s * d (dᵀ W[:, J])` on the `down_proj` columns `J`, which are the intermediate neurons' write vectors. Pick one option below."
   ]
  },
  {
   "cell_type": "code",
   "metadata": {},
   "id": "edit",
   "execution_count": null,
   "outputs": [],
   "source": [
    "# Option 1: your own direction (from 5A)\n",
    "if report[\"status\"] == \"ok\":\n",
    "    ids = [ws.edit_subtract_direction(s[\"layer\"], report[\"directions\"][s[\"layer\"]], columns=64, strength=1.0,\n",
    "                                      note=f\"loop dir, heldout d'={s['heldout_d']:.2f}\") for s in report[\"suggested\"][:2]]\n",
    "\n",
    "# Option 2: MIT's directions applied to *this* model's write vectors\n",
    "# ids = [ws.edit_subtract_direction(L, x[\"direction\"], columns=x[\"cols\"], note=\"MIT direction\") for L, x in mit.items()]\n",
    "\n",
    "# Option 3: MIT's exact weight change. Use mode=\"delta\" for a LoRA-merged model, \"replace\" only for the plain base.\n",
    "# ids = presets.apply_mit_edit(ws, mode=\"delta\")\n",
    "\n",
    "ws.diff_summary()"
   ]
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "id": "s7",
   "source": [
    "## 7. Verify on dev (1-2 passes); keep or revert"
   ]
  },
  {
   "cell_type": "code",
   "metadata": {},
   "id": "verify",
   "execution_count": null,
   "outputs": [],
   "source": [
    "after = ws.generate(\"dev\", n=64, max_new_tokens=512, label=\"after-edit\")\n",
    "from harness import compare_table\n",
    "print(compare_table({\"baseline\": base.metrics, \"edited\": after.metrics}))\n",
    "# Worse? ws.revert(ids[-1])  or  ws.revert_all()\n",
    "# Side by side on the same items, current vs start weights (2 passes): ws.compare_bases(n=32)\n",
    "ws.notes(f\"after edits {ws.log.active_ids()}: primary {after.metrics['primary']:.2f} (baseline {base.metrics['primary']:.2f})\")"
   ]
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "id": "s8",
   "source": [
    "## 8. final_test (once, locked)\n",
    "\n",
    "This runs `eval.jsonl` on the current weights, records the metrics and locks the session. Run it only once you have decided on the edits."
   ]
  },
  {
   "cell_type": "code",
   "metadata": {},
   "id": "final",
   "execution_count": null,
   "outputs": [],
   "source": [
    "final = ws.final_test(max_new_tokens=512)\n",
    "print(final.metrics)"
   ]
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "id": "s9",
   "source": [
    "## 9. Save the model and patch\n",
    "\n",
    "This writes the following to `ml/out/wsp/`:\n",
    "- `model/`: the full edited model, in the checkpoint's own dtype.\n",
    "- `patch.safetensors` and `patch.json`: only the changed tensors, plus fp32 deltas.\n",
    "- `edits.json`: ops, hashes, budget, metrics history, final test and notes.\n",
    "- `EDIT_REPORT.md` and `notes.md`.\n",
    "\n",
    "`apply_patch.py` re-applies the patch onto a base model."
   ]
  },
  {
   "cell_type": "code",
   "metadata": {},
   "id": "save",
   "execution_count": null,
   "outputs": [],
   "source": [
    "ws.save(\"ml/out/wsp\")\n",
    "print(open(\"ml/out/wsp/EDIT_REPORT.md\").read()[:3000])\n",
    "# Re-apply onto another merge of the same base:\n",
    "# !python ml/wsp/apply_patch.py --base ml/out/merged --patch ml/out/wsp/patch.safetensors --out ml/out/wsp-applied --mode delta"
   ]
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "id": "s10",
   "source": [
    "## 10. Convert to GGUF (Q4_K_M) with `ml/train/convert_quantize.sh`"
   ]
  },
  {
   "cell_type": "code",
   "metadata": {},
   "id": "gguf",
   "execution_count": null,
   "outputs": [],
   "source": [
    "!bash ml/train/convert_quantize.sh --src ml/out/wsp/model --name bloop-edit"
   ]
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "id": "s11",
   "source": [
    "## 11. Evaluate with `ml/train/eval.py`\n",
    "\n",
    "The eval compares every variant whose GGUF exists: base, mit-edit (`--name mit`), tuned (`bloop`) and tuned+edit (`bloop-edit`). It writes `ml/eval/REPORT.md`."
   ]
  },
  {
   "cell_type": "code",
   "metadata": {},
   "id": "eval",
   "execution_count": null,
   "outputs": [],
   "source": [
    "!python ml/train/eval.py --limit 25 --tuned-edit-gguf ml/out/bloop-edit-qwen3.5-0.8b-Q4_K_M.gguf\n",
    "print(open(\"ml/eval/REPORT.md\").read()[:6000])"
   ]
  }
 ],
 "metadata": {
  "accelerator": "GPU",
  "colab": {
   "name": "session.ipynb",
   "provenance": [],
   "gpuType": "T4"
  },
  "kernelspec": {
   "display_name": "Python 3",
   "name": "python3"
  },
  "language_info": {
   "name": "python"
  }
 },
 "nbformat": 4,
 "nbformat_minor": 5
}
``````

### `ml/wsp/test_harness_pure.py`

<!-- FILE: ml/wsp/test_harness_pure.py sha256=ee4cc588d95b48f840a0b7079b70ba75ef4ec83205ad9e53a828845592dbfe01 nl=1 -->
``````python
"""Stdlib-only tests for the pure parts of the weight-space harness (no torch needed).

    python -m unittest discover -s ml/wsp
"""
import json
import random
import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import wsp_core as C  # noqa: E402
import harness  # noqa: E402,F401  (must import without torch)
import presets  # noqa: E402,F401
import apply_patch as AP  # noqa: E402

PLAN_PROMPT = """You are a friendly study coach inside a desktop "study pet" app for a university student.
Today is Monday Mon Nov 09 2026 10:00:00 GMT+0000.

Upcoming deadlines:
- Calculus (EXAM): Thu Nov 12 2026 09:00:00 GMT+0000

Focus history for the last 7 days (score 0-100 = share of time on study apps/sites):
- 2026-11-08: 2 sessions, 50 focused min, avg score 80

The student uses 25-minute pomodoros with 5-minute breaks.

Create a realistic study plan for the next 7 days. Use 3-10 blocks.
Reply with ONLY a JSON object, no markdown fences, in exactly this shape:
{"summary": "...", "blocks": [{"day": 1, "time": "HH:MM", "minutes": 25, "label": "x"}]}"""

GOOD_PLAN = json.dumps({"summary": "Focus on calculus first.", "blocks": [
    {"day": 1, "time": "10:00", "minutes": 50, "label": "Calc limits"},
    {"day": 2, "time": "10:00", "minutes": 50, "label": "Calc derivatives"},
    {"day": 3, "time": "18:00", "minutes": 25, "label": "Calc review"}]})


def rows(n_plan=5, n_nudge=5):
    out = []
    for i in range(n_plan):
        out.append({"messages": [{"role": "user", "content": PLAN_PROMPT}, {"role": "assistant", "content": GOOD_PLAN}]})
    for i in range(n_nudge):
        out.append({"messages": [{"role": "system", "content": "be kind"},
                                 {"role": "user", "content": f"Write a nudge #{i}"},
                                 {"role": "assistant", "content": "Back to it!"}]})
    return out


def matmul_vec_left(u, W):  # u^T W
    return [sum(u[i] * W[i][j] for i in range(len(W))) for j in range(len(W[0]))]


def close(a, b, tol=1e-9):
    return abs(a - b) <= tol


class BudgetTests(unittest.TestCase):
    def test_costs(self):
        b = C.Budget(10)
        self.assertEqual(b.cost("generate", 1), 1)
        self.assertEqual(b.cost("generate", 64), 1)
        self.assertEqual(b.cost("generate", 65), 2)
        self.assertEqual(b.cost("activations", 128), 1)
        self.assertEqual(b.cost("activations", 129), 2)
        self.assertEqual(b.cost("generate", 0), 0)
        with self.assertRaises(ValueError):
            b.cost("train", 1)

    def test_charge_and_refuse(self):
        b = C.Budget(3)
        self.assertEqual(b.charge("generate", 100, "x"), 2)
        self.assertEqual(b.remaining, 1)
        with self.assertRaises(C.BudgetExceeded):
            b.charge("generate", 65)  # needs 2, has 1: refused whole, nothing charged
        self.assertEqual(b.remaining, 1)
        b.charge("activations", 128)
        self.assertEqual(b.remaining, 0)
        with self.assertRaises(C.BudgetExceeded):
            b.charge("activations", 1)
        self.assertEqual(len(b.log), 2)
        self.assertEqual(b.to_json()["used"], 3)

    def test_custom_sizes(self):
        b = C.Budget(5, gen_per_pass=512, act_per_pass=1024)  # MIT's definition
        self.assertEqual(b.cost("generate", 512), 1)
        self.assertEqual(b.cost("activations", 1025), 2)


class SplitTests(unittest.TestCase):
    def test_dev_deterministic_and_test_locked(self):
        r = rows(20, 20)
        a, b = C.Splits(r, rows(2, 2), dev_size=8, seed=3), C.Splits(r, rows(2, 2), dev_size=8, seed=3)
        self.assertEqual(a.dev_idx, b.dev_idx)
        self.assertEqual(len(a.dev), 8)
        self.assertNotEqual(a.dev_idx, C.Splits(r, [], dev_size=8, seed=4).dev_idx)
        with self.assertRaises(C.LockedSplitError):
            a.get("test")
        t = a.take_test()
        self.assertEqual(len(t), 4)
        self.assertTrue(all(x["id"].startswith("test:") for x in t))
        with self.assertRaises(C.LockedSplitError):
            a.take_test()
        with self.assertRaises(KeyError):
            a.get("train")

    def test_items(self):
        items = C.rows_to_items(rows(1, 1), "dev")
        self.assertEqual(items[0]["kind"], "plan")
        self.assertEqual(items[1]["kind"], "nudge")
        self.assertEqual(items[1]["messages"][-1]["role"], "user")  # assistant answer stripped
        self.assertEqual(items[1]["reference"], "Back to it!")

    def test_take_items_interleaves(self):
        items = C.rows_to_items(rows(5, 3), "dev")
        got = C.take_items(items, 4)
        self.assertEqual([g["kind"] for g in got], ["plan", "nudge", "plan", "nudge"])
        self.assertEqual(len(C.take_items(items, None, kind="plan")), 5)
        self.assertEqual(len(C.take_items(items, 100)), 8)
        self.assertEqual(C.take_items(items, 2, offset=2), got[2:4])

    def test_normalize_prompts(self):
        items = C.normalize_prompt_items(["hello", [{"role": "user", "content": PLAN_PROMPT}], rows(0, 1)[0]])
        self.assertEqual([i["kind"] for i in items], ["nudge", "plan", "nudge"])
        again = C.normalize_prompt_items([{"item": items[1], "text": "x"}])
        self.assertIs(again[0], items[1])
        with self.assertRaises(TypeError):
            C.normalize_prompt_items([42])

    def test_load_splits_missing_dir(self):
        sp = C.load_splits(Path("/nonexistent/wsp"), 8, 0)
        self.assertEqual(sp.dev, [])
        self.assertTrue(any("READY" in w for w in sp.warnings))


class ScoringGlueTests(unittest.TestCase):
    def test_repeat_and_loop(self):
        self.assertEqual(C.repeated_ngram_ratio("a b c d e f g"), 0.0)
        loop = "I will study now. " * 40
        self.assertGreater(C.repeated_ngram_ratio(loop), 0.8)
        self.assertTrue(C.is_looping(loop))
        self.assertFalse(C.is_looping("short text"))
        self.assertTrue(C.leaked_think("<think>hmm</think>{}"))

    def test_trim_at_eos(self):
        self.assertEqual(C.trim_at_eos([5, 6, 2, 0, 0], [2], 5), (2, False))
        self.assertEqual(C.trim_at_eos([5, 6, 7], [2], 3), (3, True))
        self.assertEqual(C.trim_at_eos([5, 6], [2], 3), (2, False))

    def test_score(self):
        items = C.rows_to_items(rows(1, 2), "dev")
        outs = [GOOD_PLAN, "Back to it!", {"text": "x " * 80, "hit_limit": True, "n_new_tokens": 512}]
        r = C.score(outs, items)
        per = r["per_example"]
        self.assertTrue(per[0]["ok"])
        self.assertTrue(per[0]["detail"]["schema_valid"])
        self.assertTrue(per[1]["ok"])
        self.assertFalse(per[2]["ok"])  # > 60 chars
        m = r["metrics"]
        self.assertEqual((m["n"], m["n_plan"], m["n_nudge"]), (3, 1, 2))
        self.assertAlmostEqual(m["primary"], 2 / 3)
        self.assertEqual(m["hit_limit_rate"], 1.0)  # only one example reports hit_limit
        self.assertEqual(m["plans"]["schema_valid_rate"], 1.0)
        self.assertIn("primary=67%", C.fmt_metrics(m))
        with self.assertRaises(ValueError):
            C.score(["a"], items)

    def test_generation_helpers(self):
        items = C.rows_to_items(rows(1, 1), "dev")
        sc = C.score([GOOD_PLAN, "word " * 80], items)
        outs = [{"id": it["id"], "kind": it["kind"], "prompt": it["prompt"], "prompt_text": "P", "text": t,
                 "score": s, "item": it} for it, t, s in zip(items, [GOOD_PLAN, "word " * 80], sc["per_example"])]
        g = C.Generation(outs, sc["metrics"], "dev")
        self.assertEqual(len(g.loopers()), 1)
        self.assertEqual(len(g.finished()), 1)
        self.assertEqual(len(g.failures()), 1)
        self.assertNotIn("item", json.dumps(g.to_json()))
        self.assertIn("primary", compare := C.compare_table({"a": g.metrics, "b": g.metrics}))
        self.assertIn("| metric | a | b |", compare)


class ProjectionMathTests(unittest.TestCase):
    def setUp(self):
        rng = random.Random(1)
        self.out_dim, self.in_dim = 6, 9  # down_proj layout: [hidden(out), intermediate(in)]
        self.W = [[rng.uniform(-1, 1) for _ in range(self.in_dim)] for _ in range(self.out_dim)]
        self.d = [rng.uniform(-1, 1) for _ in range(self.out_dim)]
        self.u = C.normalize(self.d)

    def orth(self, seed):
        """A random vector orthogonal to d."""
        rng = random.Random(seed)
        v = [rng.uniform(-1, 1) for _ in range(self.out_dim)]
        c = sum(a * b for a, b in zip(v, self.u))
        return [a - c * b for a, b in zip(v, self.u)]

    def test_neuron_columns_removes_component(self):
        cols = [1, 4, 7]
        W2 = C.project_out_py(self.W, self.d, cols, 1.0, "neuron_columns")
        dW2 = matmul_vec_left(self.u, W2)
        dW = matmul_vec_left(self.u, self.W)
        for j in range(self.in_dim):
            if j in cols:
                self.assertTrue(close(dW2[j], 0.0, 1e-12), j)  # d-component removed from selected columns
            else:
                self.assertTrue(close(dW2[j], dW[j]), j)
                self.assertEqual([r[j] for r in W2], [r[j] for r in self.W])  # other columns untouched exactly
        for s in range(3):  # anything orthogonal to d reads the same: v^T W' = v^T W
            v = self.orth(s)
            for a, b in zip(matmul_vec_left(v, W2), matmul_vec_left(v, self.W)):
                self.assertTrue(close(a, b, 1e-12))

    def test_output_orthogonal_part_unchanged(self):
        """For any input x, W'x differs from Wx only along d."""
        W2 = C.project_out_py(self.W, self.d, [0, 2, 3], 1.0, "neuron_columns")
        x = [random.Random(9).uniform(-1, 1) for _ in range(self.in_dim)]
        y = [sum(r[j] * x[j] for j in range(self.in_dim)) for r in self.W]
        y2 = [sum(r[j] * x[j] for j in range(self.in_dim)) for r in W2]
        diff = [a - b for a, b in zip(y2, y)]
        c = sum(a * b for a, b in zip(diff, self.u))
        resid = [a - c * b for a, b in zip(diff, self.u)]
        self.assertTrue(all(abs(r) < 1e-12 for r in resid))

    def test_strength_and_normalisation(self):
        cols = [0, 5]
        half = C.project_out_py(self.W, self.d, cols, 0.5, "neuron_columns")
        flip = C.project_out_py(self.W, [3 * x for x in self.d], cols, 2.0, "neuron_columns")  # scale of d irrelevant
        dW = matmul_vec_left(self.u, self.W)
        for j in cols:
            self.assertTrue(close(matmul_vec_left(self.u, half)[j], 0.5 * dW[j], 1e-12))
            self.assertTrue(close(matmul_vec_left(self.u, flip)[j], -dW[j], 1e-12))

    def test_full_projection_equivalence(self):
        """idx=None in either orientation = (I - d d^T) W."""
        a = C.project_out_py(self.W, self.d, None, 1.0, "neuron_columns")
        b = C.project_out_py(self.W, self.d, None, 1.0, "hidden_rows")
        for ra, rb in zip(a, b):
            for x, y in zip(ra, rb):
                self.assertTrue(close(x, y, 1e-12))
        self.assertTrue(all(abs(v) < 1e-12 for v in matmul_vec_left(self.u, a)))

    def test_hidden_rows_only_touches_rows(self):
        rows_ = [0, 3]
        W2 = C.project_out_py(self.W, self.d, rows_, 1.0, "hidden_rows")
        for i in range(self.out_dim):
            if i not in rows_:
                self.assertEqual(W2[i], self.W[i])
        self.assertNotEqual(W2[0], self.W[0])

    def test_errors_and_topk(self):
        with self.assertRaises(ValueError):
            C.project_out_py(self.W, [1.0] * 5, None)
        with self.assertRaises(ValueError):
            C.project_out_py(self.W, [0.0] * 6, None)
        with self.assertRaises(ValueError):
            C.project_out_py(self.W, self.d, None, 1.0, "rows")
        self.assertEqual(C.top_k_indices([0.1, -5, 3, 3], 3), [1, 2, 3])

    def test_mit_count(self):
        """64 columns x hidden 1024 x 2 layers = 131,072 = MIT's reported count (the default orientation)."""
        self.assertEqual(64 * 1024 * 2, 131072)
        self.assertAlmostEqual(131072 / 0.8e9 * 100, 0.016, places=3)


class GuardrailTests(unittest.TestCase):
    def test_cap(self):
        total = 800_000_000
        ok, frac = C.check_change_cap({"a": 65536, "b": 65536}, total, 0.001)
        self.assertTrue(ok)
        self.assertAlmostEqual(frac, 131072 / total)
        ok, _ = C.check_change_cap({"a": 800_001}, total, 0.001)
        self.assertFalse(ok)
        self.assertTrue(C.check_change_cap({"a": 800_000}, total, 0.001)[0])  # exactly at the cap is allowed
        self.assertEqual(C.changed_fraction({}, 0), 0.0)

    def test_protected(self):
        P = C.is_protected
        self.assertTrue(P("model.language_model.embed_tokens.weight"))
        self.assertTrue(P("lm_head.weight"))
        self.assertTrue(P("model.visual.blocks.0.attn.qkv.weight"))
        self.assertTrue(P("mtp.layers.0.mlp.down_proj.weight"))
        self.assertFalse(P("model.language_model.layers.15.mlp.down_proj.weight"))
        self.assertFalse(P("model.language_model.layers.3.mlp.down_proj.weight", ()))


class EditLogTests(unittest.TestCase):
    def test_log_and_revert(self):
        log = C.EditLog()
        a = log.add("subtract_direction", "t1", {"k": 64}, "h0", "h1", 65536, "first")
        b = log.add("scale", "t2", {"factor": 0.5}, "h2", "h3", 10)
        self.assertEqual((a, b), ("e1", "e2"))
        self.assertEqual(log.active_ids(), ["e1", "e2"])
        log.mark_reverted("e1")
        self.assertEqual(log.active_ids(), ["e2"])
        with self.assertRaises(C.WSPError):
            log.mark_reverted("e1")
        with self.assertRaises(KeyError):
            log.get("e9")
        j = log.to_json()
        self.assertEqual(j[0]["status"], "reverted")
        self.assertEqual(j[0]["before_sha256"], "h0")
        j[1]["status"] = "hacked"  # to_json is a copy
        self.assertEqual(log.get("e2")["status"], "active")

    def test_replay_semantics(self):
        """Revert replays the remaining edits from the originals (mirrors Workspace._replay)."""
        orig = {"t": [1.0, 2.0, 3.0]}
        ops = {"scale": lambda v, p: [x * p["f"] for x in v], "add": lambda v, p: [x + p["a"] for x in v]}
        log = C.EditLog()
        log.add("scale", "t", {"f": 2.0}, "", "", 3)
        log.add("add", "t", {"a": 1.0}, "", "", 3)

        def replay():
            cur = {k: list(v) for k, v in orig.items()}
            for e in log.active():
                cur[e["tensor"]] = ops[e["op"]](cur[e["tensor"]], e["params"])
            return cur

        self.assertEqual(replay()["t"], [3.0, 5.0, 7.0])
        log.mark_reverted("e1")
        self.assertEqual(replay()["t"], [2.0, 3.0, 4.0])

    def test_notes_append_only(self):
        n = C.Notes()
        n.add("hypothesis: loops come from L15", 40)
        items = n.items
        self.assertIsInstance(items, tuple)
        items[0]["text"] = "changed"
        self.assertEqual(n.items[0]["text"], "hypothesis: loops come from L15")
        self.assertFalse(hasattr(n, "remove"))

    def test_index_json_roundtrip(self):
        for idx in (None, Ellipsis, 3, slice(None, 10, 2), [1, 5, 9], (slice(None), [5, 9]), range(3)):
            j = C.index_to_json(idx)
            json.dumps(j)
            back = C.index_from_json(j)
            self.assertEqual(back, list(idx) if isinstance(idx, range) else idx)
        with self.assertRaises(TypeError):
            C.index_to_json(True)

    def test_report(self):
        st = {"model": "m", "saved_at": "now", "budget": C.Budget(50).to_json(), "edits": [], "diff": {},
              "metrics_history": [], "final_test": None, "notes": []}
        md = C.render_report(st)
        self.assertIn("0/50 forward passes used", md)
        self.assertIn("Not run.", md)


class NamesAndPatchTests(unittest.TestCase):
    MODS = ["", "model", "model.visual.blocks.0", "model.language_model", "model.language_model.layers.0",
            "model.language_model.layers.1", "model.language_model.layers.1.mlp", "model.visual.blocks",
            "mtp.layers.0", "model.language_model.norm"]

    def test_find_layers(self):
        got = C.find_decoder_layers(self.MODS)
        self.assertEqual(got, {0: "model.language_model.layers.0", 1: "model.language_model.layers.1"})
        self.assertEqual(C.find_decoder_layers(["model.layers.0", "model.layers.1"]), {0: "model.layers.0", 1: "model.layers.1"})
        self.assertEqual(C.final_norm_name(got[0]), "model.language_model.norm")

    def test_match_param(self):
        mit = C.MIT_KEY.format(15)
        names = ["model.layers.15.mlp.down_proj.weight", "model.layers.5.mlp.down_proj.weight",
                 "mtp.layers.15.mlp.down_proj.weight"]
        self.assertEqual(C.match_param_name(mit, names), "model.layers.15.mlp.down_proj.weight")
        self.assertEqual(C.match_param_name(mit, [mit, "x"]), mit)
        self.assertIsNone(C.match_param_name(mit, ["model.layers.16.mlp.down_proj.weight"]))
        self.assertEqual(AP.plan_targets([mit], names), {mit: names[0]})
        with self.assertRaises(SystemExit):
            AP.plan_targets(["layers.99.mlp.down_proj.weight"], names)

    def test_safetensors_header(self):
        header = {"a": {"dtype": "BF16", "shape": [2, 2], "data_offsets": [0, 8]},
                  "b": {"dtype": "F32", "shape": [1], "data_offsets": [8, 12]}, "__metadata__": {"format": "pt"}}
        hb = json.dumps(header).encode()
        blob = struct.pack("<Q", len(hb)) + hb + bytes(range(12))
        n, h = C.parse_safetensors_header(blob)
        self.assertEqual(n, len(hb))
        a0, a1 = C.tensor_byte_range(h, n, "b")
        self.assertEqual(blob[a0:a1], bytes([8, 9, 10, 11]))
        with self.assertRaises(ValueError):
            C.parse_safetensors_header(blob[:10])

    def test_patch_metadata(self):
        entries = {"model.language_model.layers.15.mlp.down_proj.weight": {
            "shape": [1024, 3584], "dtype": "bfloat16", "before_sha256": "aa", "after_sha256": "bb", "changed": 65536}}
        meta = C.build_patch_metadata("ml/out/merged", entries, {"edits": ["e1"], "total_params": 10})
        self.assertTrue(all(isinstance(k, str) and isinstance(v, str) for k, v in meta.items()))
        p = C.parse_patch_metadata(meta)
        self.assertEqual(p["tensors"], list(entries))
        self.assertEqual(p["entries"], entries)
        self.assertEqual(json.loads(p["extra"]["edits"]), ["e1"])
        with self.assertRaises(ValueError):
            C.parse_patch_metadata({"format": "other"})
        self.assertTrue(C.is_delta_key(C.delta_key("x")))

    def test_cohens_d_rank(self):
        self.assertGreater(C.cohens_d([0, 0.1, -0.1], [1, 1.1, 0.9]), 5)
        self.assertEqual(C.cohens_d([1], [2]), 0.0)
        self.assertEqual(C.rank_layers({3: 0.5, 15: 2.0, 19: 1.5}), [(15, 2.0), (19, 1.5), (3, 0.5)])
        a, b = C.split_halves(9, 0)
        self.assertEqual(sorted(a + b), list(range(9)))
        self.assertEqual(C.split_halves(9, 0), (a, b))

    def test_resolve_model_ref(self):
        self.assertEqual(C.resolve_model_ref("Qwen/Qwen3.5-0.8B"), "Qwen/Qwen3.5-0.8B")
        self.assertEqual(C.resolve_model_ref("mit"), C.MIT_REPO)
        with self.assertRaises(FileNotFoundError):
            C.resolve_model_ref("ml/out/does-not-exist")


if __name__ == "__main__":
    unittest.main()
``````

### `ml/wsp/wsp_core.py`

<!-- FILE: ml/wsp/wsp_core.py sha256=8ae271788839941d4d72fc438811a111d005f25f3bd66631e659c9647a513152 nl=1 -->
``````python
"""Pure (stdlib-only) parts of the weight-space programming harness.

Everything here imports and runs without torch, and the stdlib unit tests in test_harness_pure.py cover it:
budget accounting, split locking, scoring glue, loop indicators, the projection-removal math on
pure-Python matrices, the changed-fraction guardrail, the edit log, index (de)serialisation, layer/param
name matching, safetensors header parsing and patch metadata.

The only function that touches torch is `tensor_sha256`, which imports nothing and only calls tensor methods.
"""
from __future__ import annotations

import hashlib
import json
import math
import random
import re
import sys
import time
from pathlib import Path
from typing import Any, Callable, Iterable, Optional, Sequence

WSP_DIR = Path(__file__).resolve().parent
ML_DIR = WSP_DIR.parent
REPO_ROOT = ML_DIR.parent
sys.path.insert(0, str(ML_DIR / "train"))
import scoring as S  # noqa: E402  (stdlib only)

# --------------------------------------------------------------------------- constants
DEFAULT_GEN_PER_PASS = 64      # one "forward pass" of budget = generating for <= 64 prompts
DEFAULT_ACT_PER_PASS = 128     # ... or reading activations for <= 128 texts
DEFAULT_MAX_CHANGED_FRAC = 0.001  # 0.1 % of all parameters
DEFAULT_PROTECTED = (
    r"(^|\.)embed_tokens(\.|$)",
    r"(^|\.)lm_head(\.|$)",
    r"(^|\.)(visual|vision_tower|vision_model|vision_encoder)(\.|$)",
    r"(^|\.)mtp(\.|$)",
)
SITES = ("mlp_out", "resid", "attn_out")
POSITIONS = ("last", "mean", "all_assistant")

# Projection-removal orientation (see README "Edit math").
#   neuron_columns (default, matches MIT's 64 x 1024 = 65,536 weights per layer):
#       down_proj.weight has shape [hidden, intermediate] (nn.Linear stores [out_features, in_features]).
#       Column j = W[:, j] is intermediate neuron j's *write vector* into the residual stream.
#       W[:, J] <- W[:, J] - s * d (d^T W[:, J])     (d in hidden space, unit norm)
#   hidden_rows:
#       pick rows R (residual-stream coordinates, ranked by |d_i|) and apply only those rows of the full
#       projection-removal update: W[R, :] <- W[R, :] - s * d[R] (d^T W)
#       (changes k * intermediate weights; included because "output columns" is ambiguous.)
ORIENTATIONS = ("neuron_columns", "hidden_rows")
DEFAULT_ORIENTATION = "neuron_columns"

MIT_REPO = "RikiyaT/Qwen3.5-0.8B-weight-space-programming"
QWEN_BASE_REPO = "Qwen/Qwen3.5-0.8B"
MIT_LAYERS = (15, 19)
MIT_KEY = "model.language_model.layers.{}.mlp.down_proj.weight"
MIT_BLOG = "https://rikiyat.github.io/blog/weight-space-programming/"

PATCH_FORMAT = "bloop-wsp-patch/1"
DELTA_PREFIX = "delta::"


# --------------------------------------------------------------------------- errors
class WSPError(RuntimeError):
    pass


class BudgetExceeded(WSPError):
    pass


class LockedSplitError(WSPError):
    pass


class GuardrailError(WSPError):
    pass


class SessionLocked(WSPError):
    pass


# --------------------------------------------------------------------------- budget
class Budget:
    """Forward-pass budget. Costs are computed for the whole call up front; a call that would overspend is
    refused before anything runs (no partial charging)."""

    def __init__(self, total: int, gen_per_pass: int = DEFAULT_GEN_PER_PASS, act_per_pass: int = DEFAULT_ACT_PER_PASS):
        if total < 0 or gen_per_pass <= 0 or act_per_pass <= 0:
            raise ValueError("budget sizes must be positive")
        self.total = int(total)
        self.gen_per_pass = int(gen_per_pass)
        self.act_per_pass = int(act_per_pass)
        self.used = 0
        self.log: list[dict] = []

    @property
    def remaining(self) -> int:
        return self.total - self.used

    def cost(self, kind: str, n_items: int) -> int:
        if n_items <= 0:
            return 0
        if kind == "generate":
            per = self.gen_per_pass
        elif kind == "activations":
            per = self.act_per_pass
        else:
            raise ValueError(f"unknown budget kind {kind!r} (generate | activations)")
        return math.ceil(n_items / per)

    def can_afford(self, passes: int) -> bool:
        return passes <= self.remaining

    def charge(self, kind: str, n_items: int, label: str = "") -> int:
        c = self.cost(kind, n_items)
        if c > self.remaining:
            raise BudgetExceeded(
                f"budget exhausted: {label or kind} on {n_items} items needs {c} forward pass(es), "
                f"only {self.remaining}/{self.total} left. Use score()/logit_lens()/top_columns() (free), "
                f"or fewer items.")
        self.used += c
        self.log.append({"t": time.strftime("%Y-%m-%dT%H:%M:%S"), "kind": kind, "items": n_items, "passes": c,
                         "label": label, "remaining": self.remaining})
        return c

    def summary(self) -> str:
        return f"{self.remaining}/{self.total} forward passes left ({self.used} used)"

    def to_json(self) -> dict:
        return {"total": self.total, "used": self.used, "remaining": self.remaining,
                "gen_per_pass": self.gen_per_pass, "act_per_pass": self.act_per_pass, "log": list(self.log)}


# --------------------------------------------------------------------------- data / splits
def read_jsonl(path: Path) -> list[dict]:
    rows = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def kind_of(prompt: str) -> str:
    return "plan" if S.is_plan_prompt(prompt) else "nudge"


def rows_to_items(rows: Sequence[dict], prefix: str, indices: Optional[Sequence[int]] = None) -> list[dict]:
    """Chat rows -> prompt items {id, messages (no final assistant), prompt, reference, kind}."""
    out = []
    idx = range(len(rows)) if indices is None else indices
    for i in idx:
        msgs = rows[i].get("messages") or []
        if not msgs:
            continue
        ref = None
        if msgs[-1].get("role") == "assistant":
            ref, msgs = msgs[-1].get("content"), msgs[:-1]
        user = next((m.get("content", "") for m in reversed(msgs) if m.get("role") == "user"), "")
        if not user:
            continue
        out.append({"id": f"{prefix}:{i}", "messages": msgs, "prompt": user, "reference": ref, "kind": kind_of(user)})
    return out


def dev_indices(n_rows: int, dev_size: int, seed: int) -> list[int]:
    """Deterministic subset of train row indices (sorted)."""
    k = max(0, min(dev_size, n_rows))
    return sorted(random.Random(seed).sample(range(n_rows), k))


class Splits:
    """'dev' = deterministic subset of train.jsonl; 'test' = eval.jsonl, LOCKED (one use via take_test())."""

    def __init__(self, train_rows: Sequence[dict], eval_rows: Sequence[dict], dev_size: int = 128, seed: int = 0):
        self.dev_idx = dev_indices(len(train_rows), dev_size, seed)
        self.dev = rows_to_items(train_rows, "dev", self.dev_idx)
        self._test = rows_to_items(eval_rows, "test")
        self.test_used = False
        self.warnings: list[str] = []

    def get(self, name: str) -> list[dict]:
        if name == "dev":
            return list(self.dev)
        if name == "test":
            raise LockedSplitError("'test' is locked. It can be used exactly once, through ws.final_test().")
        raise KeyError(f"unknown split {name!r} (use 'dev', or pass a list of prompts)")

    def take_test(self) -> list[dict]:
        if self.test_used:
            raise LockedSplitError("the locked test split was already used (final_test runs once per session).")
        self.test_used = True
        return list(self._test)

    def sizes(self) -> dict:
        kinds = lambda items: {k: sum(1 for i in items if i["kind"] == k) for k in ("plan", "nudge")}
        return {"dev": len(self.dev), "dev_kinds": kinds(self.dev), "test": len(self._test), "test_used": self.test_used}


def load_splits(data_dir: Path, dev_size: int, seed: int) -> Splits:
    data_dir = Path(data_dir)
    tr, ev = data_dir / "train.jsonl", data_dir / "eval.jsonl"
    warns = []
    if not (data_dir / "READY").exists():
        warns.append(f"{data_dir}/READY not found: the dataset may still be being written.")
    train_rows = read_jsonl(tr) if tr.exists() else []
    eval_rows = read_jsonl(ev) if ev.exists() else []
    if not train_rows:
        warns.append(f"{tr} missing or empty: no 'dev' split. Pass prompts explicitly.")
    if not eval_rows:
        warns.append(f"{ev} missing or empty: final_test() will have nothing to run.")
    sp = Splits(train_rows, eval_rows, dev_size, seed)
    sp.warnings = warns
    return sp


def take_items(items: Sequence[dict], n: Optional[int] = None, kind: Optional[str] = None, offset: int = 0) -> list[dict]:
    """Filter by kind, interleave plan/nudge (so a small n keeps the mix), then slice [offset:offset+n]."""
    if kind is not None:
        pool = [i for i in items if i["kind"] == kind]
    else:
        plans = [i for i in items if i["kind"] == "plan"]
        nudges = [i for i in items if i["kind"] != "plan"]
        pool = []
        for a, b in _zip_longest(plans, nudges):
            pool += [x for x in (a, b) if x is not None]
    end = None if n is None else offset + n
    return pool[offset:end]


def _zip_longest(a, b):
    for i in range(max(len(a), len(b))):
        yield (a[i] if i < len(a) else None, b[i] if i < len(b) else None)


def normalize_prompt_items(objs: Sequence[Any]) -> list[dict]:
    """Accept user-prompt strings, message lists, chat rows ({"messages": ...}), dataset items or generation
    outputs (which carry an "item") and return prompt items."""
    out = []
    for i, o in enumerate(objs):
        if isinstance(o, str):
            out.append({"id": f"p:{i}", "messages": [{"role": "user", "content": o}], "prompt": o,
                        "reference": None, "kind": kind_of(o)})
        elif isinstance(o, dict) and "item" in o and isinstance(o["item"], dict):
            out.append(o["item"])
        elif isinstance(o, dict) and "messages" in o and "kind" in o and "id" in o:
            out.append(o)
        elif isinstance(o, dict) and "messages" in o:
            out += [dict(x, id=f"p:{i}") for x in rows_to_items([o], "p")]
        elif isinstance(o, list) and o and isinstance(o[0], dict) and "role" in o[0]:
            out += [dict(x, id=f"p:{i}") for x in rows_to_items([{"messages": o}], "p")]
        else:
            raise TypeError(f"prompt #{i}: unsupported type {type(o).__name__}")
    return out


# --------------------------------------------------------------------------- loop / length indicators
def repeated_ngram_ratio(text: str, n: int = 4) -> float:
    """1 - unique/total over word n-grams (0 = no repetition, -> 1 = one phrase repeated forever)."""
    toks = text.split()
    grams = [tuple(toks[i : i + n]) for i in range(len(toks) - n + 1)]
    if not grams:
        return 0.0
    return 1.0 - len(set(grams)) / len(grams)


def n_ngrams(text: str, n: int = 4) -> int:
    return max(0, len(text.split()) - n + 1)


def leaked_think(text: str) -> bool:
    return "<think>" in text or "</think>" in text


def is_looping(text: str, threshold: float = 0.5, min_ngrams: int = 16, n: int = 4) -> bool:
    return n_ngrams(text, n) >= min_ngrams and repeated_ngram_ratio(text, n) >= threshold


def trim_at_eos(ids: Sequence[int], eos_ids: Iterable[int], max_new_tokens: int) -> tuple[int, bool]:
    """(number of real generated tokens before the first EOS, hit_token_limit)."""
    eos = set(eos_ids)
    for k, t in enumerate(ids):
        if t in eos:
            return k, False
    return len(ids), len(ids) >= max_new_tokens


# --------------------------------------------------------------------------- scoring glue
def score_one(text: str, item: dict, hit_limit: Optional[bool] = None, n_new_tokens: Optional[int] = None) -> dict:
    prompt = item.get("prompt", "")
    kind = item.get("kind") or kind_of(prompt)
    if kind == "plan":
        detail = S.score_plan(text, prompt)
        ok = bool(detail["schema_valid"]) and bool(detail["all_rules"])
    else:
        detail = S.score_nudge(text)
        ok = bool(detail["le60"]) and bool(detail["single_line"])
    return {"id": item.get("id"), "kind": kind, "ok": ok, "hit_limit": hit_limit, "n_new_tokens": n_new_tokens,
            "repeat_ratio": round(repeated_ngram_ratio(text), 4), "looping": is_looping(text),
            "think_leak": leaked_think(text), "detail": detail}


def _mean(xs: Sequence[float]) -> Optional[float]:
    return sum(xs) / len(xs) if xs else None


def aggregate(per: Sequence[dict]) -> dict:
    plans = [p["detail"] for p in per if p["kind"] == "plan"]
    nudges = [p["detail"] for p in per if p["kind"] != "plan"]
    lim = [p["hit_limit"] for p in per]
    return {
        "n": len(per), "n_plan": len(plans), "n_nudge": len(nudges),
        "primary": S.rate([p["ok"] for p in per]),  # share of examples that fully pass (plan: schema+all rules; nudge: <=60, one line)
        "plans": S.aggregate_plans(plans) if plans else None,
        "nudges": S.aggregate_nudges(nudges) if nudges else None,
        "hit_limit_rate": S.rate(lim),
        "looping_rate": S.rate([p["looping"] for p in per]),
        "loop_or_limit_rate": S.rate([bool(p["looping"] or p["hit_limit"]) for p in per]),
        "think_leak_rate": S.rate([p["think_leak"] for p in per]),
        "mean_repeat_ratio": _mean([p["repeat_ratio"] for p in per]),
        "mean_new_tokens": _mean([p["n_new_tokens"] for p in per if p["n_new_tokens"] is not None]),
    }


def score(outputs: Sequence[Any], examples: Sequence[dict]) -> dict:
    """Pure scoring. outputs: strings or dicts with "text" (+ optional hit_limit / n_new_tokens)."""
    if len(outputs) != len(examples):
        raise ValueError(f"{len(outputs)} outputs vs {len(examples)} examples")
    per = []
    for o, ex in zip(outputs, examples):
        if isinstance(o, str):
            per.append(score_one(o, ex))
        else:
            per.append(score_one(o["text"], ex, o.get("hit_limit"), o.get("n_new_tokens")))
    return {"per_example": per, "metrics": aggregate(per)}


def fmt_metrics(m: dict) -> str:
    p = m.get("plans") or {}
    nd = m.get("nudges") or {}
    parts = [f"n={m['n']}", f"primary={S.pct(m['primary'])}"]
    if p:
        parts += [f"plan json={S.pct(p['parse_rate'])}", f"schema={S.pct(p['schema_valid_rate'])}",
                  f"rules={S.pct(p['all_rules'])}"]
    if nd:
        parts.append(f"nudge<=60={S.pct(nd['le60_rate'])}")
    parts += [f"hit_limit={S.pct(m['hit_limit_rate'])}", f"looping={S.pct(m['looping_rate'])}",
              f"think_leak={S.pct(m['think_leak_rate'])}"]
    if m.get("mean_new_tokens") is not None:
        parts.append(f"tokens~{m['mean_new_tokens']:.0f}")
    return " | ".join(parts)


METRIC_ROWS = [
    ("primary (full pass)", lambda m: m["primary"]),
    ("plan JSON parsed", lambda m: (m["plans"] or {}).get("parse_rate")),
    ("plan schema valid", lambda m: (m["plans"] or {}).get("schema_valid_rate")),
    ("plan all rules", lambda m: (m["plans"] or {}).get("all_rules")),
    ("nudge <= 60 chars", lambda m: (m["nudges"] or {}).get("le60_rate")),
    ("hit token limit", lambda m: m["hit_limit_rate"]),
    ("looping", lambda m: m["looping_rate"]),
    ("leaked <think>", lambda m: m["think_leak_rate"]),
]


def compare_table(named: dict) -> str:
    names = list(named)
    lines = ["| metric | " + " | ".join(names) + " |", "|---|" + "---|" * len(names)]
    for label, fn in METRIC_ROWS:
        lines.append(f"| {label} | " + " | ".join(S.pct(fn(named[k])) for k in names) + " |")
    return "\n".join(lines)


class Generation:
    """Result of Workspace.generate(): .outputs (list of dicts), .metrics, helpers to slice good/bad."""

    def __init__(self, outputs: list[dict], metrics: dict, label: str = ""):
        self.outputs = outputs
        self.metrics = metrics
        self.label = label

    def __len__(self):
        return len(self.outputs)

    def __iter__(self):
        return iter(self.outputs)

    def __getitem__(self, i):
        return self.outputs[i]

    @property
    def texts(self) -> list[str]:
        return [o["text"] for o in self.outputs]

    def where(self, pred: Callable[[dict], bool]) -> list[dict]:
        return [o for o in self.outputs if pred(o)]

    def failures(self) -> list[dict]:
        return self.where(lambda o: not o["score"]["ok"])

    def passes(self) -> list[dict]:
        return self.where(lambda o: o["score"]["ok"])

    def loopers(self) -> list[dict]:
        """Outputs that hit the token limit or look repetitive."""
        return self.where(lambda o: bool(o["score"]["hit_limit"] or o["score"]["looping"]))

    def finished(self) -> list[dict]:
        return self.where(lambda o: not (o["score"]["hit_limit"] or o["score"]["looping"]))

    def show(self, i: int, chars: int = 1200) -> str:
        o = self.outputs[i]
        s = (f"--- {o['id']} ({o['kind']}) ok={o['score']['ok']} hit_limit={o['score']['hit_limit']} "
             f"repeat={o['score']['repeat_ratio']} tokens={o['score']['n_new_tokens']}\n"
             f"PROMPT ...{o['prompt'][-300:]}\nOUTPUT {o['text'][:chars]}")
        print(s)
        return s

    def __repr__(self):
        return f"<Generation {self.label or ''} {fmt_metrics(self.metrics)}>"

    def to_json(self) -> dict:
        return {"label": self.label, "metrics": self.metrics,
                "outputs": [{k: v for k, v in o.items() if k != "item"} for o in self.outputs]}


# --------------------------------------------------------------------------- edit math (pure reference)
def _norm(v: Sequence[float]) -> float:
    return math.sqrt(sum(x * x for x in v))


def normalize(v: Sequence[float]) -> list[float]:
    n = _norm(v)
    if n == 0:
        raise ValueError("zero direction")
    return [x / n for x in v]


def project_out_py(W: Sequence[Sequence[float]], d: Sequence[float], idx: Optional[Sequence[int]] = None,
                   strength: float = 1.0, orientation: str = DEFAULT_ORIENTATION) -> list[list[float]]:
    """Reference implementation on a list-of-rows matrix W [out][in] (nn.Linear layout), d in output space.

    neuron_columns: for j in idx (columns = input units): W[:, j] -= s * d * (d . W[:, j])
    hidden_rows:    for i in idx (rows = output coords):  W[i, :] -= s * d[i] * (d^T W)
    d is normalised first. idx=None means all columns / all rows (= full projection removal (I - s d d^T) W).
    """
    if orientation not in ORIENTATIONS:
        raise ValueError(f"orientation must be one of {ORIENTATIONS}")
    out_dim, in_dim = len(W), len(W[0])
    if len(d) != out_dim:
        raise ValueError(f"direction has {len(d)} dims, W has {out_dim} output rows")
    u = normalize(d)
    new = [list(r) for r in W]
    if orientation == "neuron_columns":
        cols = range(in_dim) if idx is None else idx
        for j in cols:
            c = sum(u[i] * W[i][j] for i in range(out_dim))
            for i in range(out_dim):
                new[i][j] = W[i][j] - strength * u[i] * c
    else:
        coef = [sum(u[i] * W[i][j] for i in range(out_dim)) for j in range(in_dim)]
        rows = range(out_dim) if idx is None else idx
        for i in rows:
            for j in range(in_dim):
                new[i][j] = W[i][j] - strength * u[i] * coef[j]
    return new


def top_k_indices(scores: Sequence[float], k: int) -> list[int]:
    """Indices of the k largest |score| (ties -> lower index first)."""
    order = sorted(range(len(scores)), key=lambda i: (-abs(scores[i]), i))
    return order[: max(0, k)]


# --------------------------------------------------------------------------- guardrails
def changed_fraction(counts: dict, total: int) -> float:
    return sum(counts.values()) / total if total else 0.0


def check_change_cap(counts: dict, total: int, cap: float) -> tuple[bool, float]:
    frac = changed_fraction(counts, total)
    return frac <= cap + 1e-15, frac


def is_protected(name: str, patterns: Sequence[str] = DEFAULT_PROTECTED) -> bool:
    return any(re.search(p, name) for p in patterns)


# --------------------------------------------------------------------------- index (de)serialisation
def index_to_json(idx: Any) -> Any:
    if idx is None:
        return None
    if idx is Ellipsis:
        return "..."
    if isinstance(idx, bool):
        raise TypeError("bool index not supported")
    if isinstance(idx, int):
        return idx
    if isinstance(idx, slice):
        return {"slice": [idx.start, idx.stop, idx.step]}
    if isinstance(idx, tuple):
        return {"tuple": [index_to_json(x) for x in idx]}
    if hasattr(idx, "tolist"):
        idx = idx.tolist()
    if isinstance(idx, (list, range)):
        return [int(x) for x in idx]
    raise TypeError(f"unsupported index {idx!r}")


def index_from_json(j: Any) -> Any:
    if j is None:
        return None
    if j == "...":
        return Ellipsis
    if isinstance(j, int):
        return j
    if isinstance(j, list):
        return list(j)
    if isinstance(j, dict) and "slice" in j:
        return slice(*j["slice"])
    if isinstance(j, dict) and "tuple" in j:
        return tuple(index_from_json(x) for x in j["tuple"])
    raise TypeError(f"bad index json {j!r}")


# --------------------------------------------------------------------------- model / param names
_LAYER_RE = re.compile(r"^(?P<prefix>(?:.*\.)?layers)\.(?P<i>\d+)$")
_NOT_TEXT = re.compile(r"(^|\.)(visual|vision_tower|vision_model|vision_encoder|mtp)(\.|$)")


def find_decoder_layers(module_names: Iterable[str]) -> dict[int, str]:
    """{layer index: module name} for the text decoder (vision tower / MTP excluded)."""
    by_prefix: dict[str, dict[int, str]] = {}
    for n in module_names:
        if _NOT_TEXT.search(n):
            continue
        m = _LAYER_RE.match(n)
        if m:
            by_prefix.setdefault(m.group("prefix"), {})[int(m.group("i"))] = n
    if not by_prefix:
        return {}
    lm = [p for p in by_prefix if "language_model" in p]
    best = lm[0] if lm else max(by_prefix, key=lambda p: len(by_prefix[p]))
    return dict(sorted(by_prefix[best].items()))


def final_norm_name(layer_module_name: str) -> str:
    """'model.language_model.layers.3' -> 'model.language_model.norm'."""
    parent = layer_module_name.rsplit(".layers.", 1)[0]
    return f"{parent}.norm"


def canonical_key(key: str) -> str:
    i = key.find("layers.")
    if i >= 0:
        return key[i:]
    parts = key.split(".")
    return ".".join(parts[-2:])


def match_param_name(key: str, names: Iterable[str]) -> Optional[str]:
    """Map a checkpoint key (e.g. MIT's 'model.language_model.layers.15.mlp.down_proj.weight') to a name in
    `names` (the loaded model's parameter names, which can differ in prefix). Exact match first, then a
    unique suffix match from 'layers.' on. Vision/MTP names never match a text key."""
    names = list(names)
    if key in names:
        return key
    suf = canonical_key(key)
    cands = [n for n in names if (n == suf or n.endswith("." + suf)) and not _NOT_TEXT.search(n)]
    if len(cands) == 1:
        return cands[0]
    lm = [c for c in cands if "language_model" in c]
    if len(lm) == 1:
        return lm[0]
    return None


def resolve_model_ref(ref: str, repo_root: Path = REPO_ROOT) -> str:
    """Local path (cwd- or repo-relative) or a Hugging Face id ('owner/name')."""
    from train_lora import resolve_base  # stdlib-importable

    ref = resolve_base(ref)
    p = Path(ref).expanduser()
    if p.exists():
        return str(p)
    q = Path(repo_root) / ref
    if q.exists():
        return str(q)
    looks_local = ref.startswith(("ml/", "./", "../", "/", "~")) or ref.count("/") != 1
    if looks_local:
        raise FileNotFoundError(f"model {ref!r} not found locally. Train/merge first (ml/out/merged) or pass a HF id.")
    return ref


# --------------------------------------------------------------------------- edit log / notes
class EditLog:
    def __init__(self):
        self.entries: list[dict] = []
        self._next = 1

    def add(self, op: str, tensor: str, params: dict, before_sha256: str, after_sha256: str,
            changed_params: int, note: str = "") -> str:
        eid = f"e{self._next}"
        self._next += 1
        self.entries.append({"id": eid, "op": op, "tensor": tensor, "params": params, "before_sha256": before_sha256,
                             "after_sha256": after_sha256, "changed_params_in_tensor": int(changed_params),
                             "status": "active", "note": note, "t": time.strftime("%Y-%m-%dT%H:%M:%S")})
        return eid

    def get(self, eid: str) -> dict:
        for e in self.entries:
            if e["id"] == eid:
                return e
        raise KeyError(f"no edit {eid!r}")

    def mark_reverted(self, eid: str) -> dict:
        e = self.get(eid)
        if e["status"] != "active":
            raise WSPError(f"edit {eid} is already {e['status']}")
        e["status"] = "reverted"
        e["reverted_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
        return e

    def active(self) -> list[dict]:
        return [e for e in self.entries if e["status"] == "active"]

    def active_ids(self) -> list[str]:
        return [e["id"] for e in self.active()]

    def to_json(self) -> list[dict]:
        return json.loads(json.dumps(self.entries))


class Notes:
    """Append-only log."""

    def __init__(self):
        self._items: list[dict] = []

    def add(self, text: str, budget_left: Optional[int] = None) -> dict:
        rec = {"t": time.strftime("%Y-%m-%dT%H:%M:%S"), "text": str(text), "budget_left": budget_left}
        self._items.append(rec)
        return dict(rec)

    @property
    def items(self) -> tuple:
        return tuple(dict(x) for x in self._items)


# --------------------------------------------------------------------------- layer ranking
def mean(xs: Sequence[float]) -> float:
    return sum(xs) / len(xs)


def cohens_d(a: Sequence[float], b: Sequence[float]) -> float:
    """(mean(b) - mean(a)) / pooled std. Positive when b projects higher."""
    if len(a) < 2 or len(b) < 2:
        return 0.0
    ma, mb = mean(a), mean(b)
    va = sum((x - ma) ** 2 for x in a) / (len(a) - 1)
    vb = sum((x - mb) ** 2 for x in b) / (len(b) - 1)
    pooled = math.sqrt(((len(a) - 1) * va + (len(b) - 1) * vb) / (len(a) + len(b) - 2))
    return (mb - ma) / max(pooled, 1e-12)


def split_halves(n: int, seed: int = 0) -> tuple[list[int], list[int]]:
    idx = list(range(n))
    random.Random(seed).shuffle(idx)
    h = n // 2
    return sorted(idx[:h]), sorted(idx[h:])


def rank_layers(scores: dict) -> list[tuple[int, float]]:
    return sorted(scores.items(), key=lambda kv: (-kv[1], kv[0]))


# --------------------------------------------------------------------------- safetensors / patch
SAFETENSORS_DTYPES = {"BF16": "bfloat16", "F16": "float16", "F32": "float32", "F64": "float64",
                      "I64": "int64", "I32": "int32", "I16": "int16", "I8": "int8", "U8": "uint8", "BOOL": "bool"}


def parse_safetensors_header(prefix: bytes) -> tuple[int, dict]:
    """Parse the 8-byte little-endian length + JSON header at the start of a .safetensors file."""
    import struct

    if len(prefix) < 8:
        raise ValueError("need at least 8 bytes")
    (n,) = struct.unpack("<Q", prefix[:8])
    if len(prefix) < 8 + n:
        raise ValueError(f"header is {n} bytes; read more")
    return n, json.loads(prefix[8 : 8 + n].decode("utf-8"))


def tensor_byte_range(header: dict, header_len: int, key: str) -> tuple[int, int]:
    info = header[key]
    a, b = info["data_offsets"]
    base = 8 + header_len
    return base + a, base + b


def delta_key(name: str) -> str:
    return DELTA_PREFIX + name


def is_delta_key(k: str) -> bool:
    return k.startswith(DELTA_PREFIX)


def build_patch_metadata(base_model: str, entries: dict, extra: Optional[dict] = None) -> dict:
    """safetensors metadata must be str -> str."""
    meta = {"format": PATCH_FORMAT, "base_model": str(base_model), "tensors": json.dumps(sorted(entries)),
            "entries": json.dumps(entries, sort_keys=True), "created": time.strftime("%Y-%m-%dT%H:%M:%S")}
    for k, v in (extra or {}).items():
        meta[str(k)] = v if isinstance(v, str) else json.dumps(v)
    return meta


def parse_patch_metadata(meta: dict) -> dict:
    if not meta or meta.get("format") != PATCH_FORMAT:
        raise ValueError(f"not a {PATCH_FORMAT} patch (format={None if not meta else meta.get('format')!r})")
    return {"base_model": meta.get("base_model"), "tensors": json.loads(meta["tensors"]),
            "entries": json.loads(meta["entries"]), "created": meta.get("created"),
            "extra": {k: v for k, v in meta.items() if k not in ("format", "base_model", "tensors", "entries", "created")}}


def tensor_sha256(t: Any) -> str:
    """sha256 over dtype, shape and raw bytes of a torch tensor (no torch import needed here)."""
    t = t.detach().cpu().contiguous()
    h = hashlib.sha256(f"{t.dtype}|{tuple(t.shape)}|".encode())
    try:
        import torch  # local: only reached with a real tensor

        h.update(t.view(torch.uint8).numpy().tobytes())
    except Exception:  # noqa: BLE001  (fallback for exotic dtypes)
        h.update(t.float().numpy().tobytes())
    return h.hexdigest()


# --------------------------------------------------------------------------- report
def render_report(state: dict) -> str:
    L = ["# Weight-space edit report", "",
         f"Model: `{state.get('model')}`  ", f"Saved: {state.get('saved_at')}  ",
         f"Method: gradient-free weight edits, after MIT CSAIL's weight-space programming ({MIT_BLOG}).", "",
         "## Budget", "", f"{state['budget']['used']}/{state['budget']['total']} forward passes used "
         f"(1 pass = generate <= {state['budget']['gen_per_pass']} prompts or read <= {state['budget']['act_per_pass']} texts).", "",
         "## Edits", ""]
    edits = state.get("edits") or []
    if not edits:
        L.append("(none)")
    else:
        L += ["| id | status | op | tensor | changed params | note |", "|---|---|---|---|---|---|"]
        for e in edits:
            L.append(f"| {e['id']} | {e['status']} | {e['op']} | `{e['tensor']}` | {e['changed_params_in_tensor']} | {e.get('note', '')} |")
    d = state.get("diff") or {}
    if d:
        L += ["", "## Diff vs the loaded model", "",
              f"{d.get('changed_params', 0):,} parameters changed in {len(d.get('tensors', []))} tensor(s) = "
              f"{100 * d.get('fraction', 0):.4f}% of {d.get('total_params', 0):,} (cap {100 * d.get('cap_fraction', 0):.3f}%)."]
        for t in d.get("tensors", []):
            L.append(f"- `{t['name']}`: {t['changed']:,} / {t['numel']:,}")
    hist = state.get("metrics_history") or []
    if hist:
        L += ["", "## Metrics history (dev / practice)", "",
              "| # | label | n | primary | plan schema | plan rules | nudge<=60 | hit limit | looping | active edits |",
              "|---|---|---|---|---|---|---|---|---|---|"]
        for i, h in enumerate(hist, 1):
            m = h["metrics"]
            p, nd = m.get("plans") or {}, m.get("nudges") or {}
            L.append(f"| {i} | {h.get('label', '')} | {m['n']} | {S.pct(m['primary'])} | {S.pct(p.get('schema_valid_rate'))} | "
                     f"{S.pct(p.get('all_rules'))} | {S.pct(nd.get('le60_rate'))} | {S.pct(m['hit_limit_rate'])} | "
                     f"{S.pct(m['looping_rate'])} | {','.join(h.get('active_edits', [])) or '-'} |")
    ft = state.get("final_test")
    L += ["", "## Final test (locked eval.jsonl, run once)", ""]
    L.append(fmt_metrics(ft["metrics"]) if ft else "Not run.")
    notes = state.get("notes") or []
    if notes:
        L += ["", "## Notes", ""] + [f"- {n['t']} (budget left {n.get('budget_left')}): {n['text']}" for n in notes]
    return "\n".join(L) + "\n"
``````

### `src/main/plan.ts`

<!-- FILE: src/main/plan.ts sha256=a257603774f386ecccba0c65ebb87ab4c613f5c57f50acf5b5f4ba92a5a6f644 nl=1 -->
``````ts
// AI study plan. Generation goes through the AI registry (src/main/ai/registry.ts), which picks
// the user's provider: the Bloop model, an Ollama model or a cloud provider. API keys (including
// the .env ANTHROPIC_API_KEY fallback, read by the cloud side) stay in the main process.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import dotenv from 'dotenv'
import type { Deadline, PlanBlock, Reminder, Result, Settings, Stats, StudyPlan } from '@shared/types'
import { DEFAULT_SYSTEM_PROMPT } from '@shared/ai'
import type { CompleteOptions } from './ai/types'

export interface EnvDirsInput {
  packaged: boolean
  platform: NodeJS.Platform
  userData: string
  /** process.execPath */
  exePath: string
  /** dev only: the project root and the working directory */
  projectRoot?: string
  cwd?: string
  /** Linux AppImage: process.env.APPIMAGE (the .AppImage file itself, not the mount point) */
  appImage?: string
  /** Windows portable: process.env.PORTABLE_EXECUTABLE_FILE (the .exe, not the temp unpack dir) */
  portableExe?: string
}

/**
 * Where a `.env` may live, in priority order. A packaged app has no project folder (and its cwd is
 * `/` or wherever it was launched from), so it only looks in the user-data folder and in the
 * folder that holds the app: next to Bloop.app on macOS, next to Bloop.exe (or the portable .exe)
 * on Windows, next to the .AppImage (or the install dir) on Linux.
 */
export function envSearchDirs(i: EnvDirsInput): string[] {
  if (!i.packaged) return [...new Set([i.cwd, i.projectRoot, i.userData].filter((d): d is string => !!d))]
  let besideApp: string
  if (i.platform === 'darwin') {
    // .../Bloop.app/Contents/MacOS/Bloop -> folder containing Bloop.app
    const m = i.exePath.match(/^(.*?)[\\/][^\\/]+\.app[\\/]Contents[\\/]MacOS[\\/]/)
    besideApp = m?.[1] || dirname(i.exePath)
  } else if (i.platform === 'win32') besideApp = dirname(i.portableExe || i.exePath)
  else besideApp = dirname(i.appImage || i.exePath)
  return [...new Set([i.userData, besideApp])]
}

/** The only variable Bloop takes from a .env file (a .env next to the app may be untrusted). */
const ENV_KEYS = ['ANTHROPIC_API_KEY'] as const

let envLoaded = false
/**
 * Read ANTHROPIC_API_KEY from the first .env (in `dirs` order) that sets it, unless it is already
 * in the environment. Nothing else in the file is applied. Only the main process reads it: the
 * key never reaches a renderer.
 */
export function loadEnv(dirs: string[]): string[] {
  if (envLoaded) return []
  envLoaded = true
  const loaded: string[] = []
  for (const d of dirs) {
    const p = join(d, '.env')
    if (!existsSync(p)) continue
    let parsed: Record<string, string>
    try {
      parsed = dotenv.parse(readFileSync(p))
    } catch (e) {
      console.log(`[bloop] couldn't read ${p}: ${(e as Error).message}`)
      continue
    }
    for (const k of ENV_KEYS) {
      const v = parsed[k]?.trim()
      if (v && !process.env[k]) {
        process.env[k] = v
        loaded.push(p)
        console.log(`[bloop] ${k} loaded from ${p}`)
      }
    }
  }
  if (!loaded.length) console.log(`[bloop] no .env key loaded (looked in: ${dirs.join(', ')})`)
  return loaded
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** The plan prompt. The dataset in ml/ mirrors this exact text: don't change the wording casually. */
export function buildPrompt(deadlines: Deadline[], stats: Stats, settings: Settings, now: Date): string {
  const dl = deadlines.length
    ? deadlines
        .map((d) => `- ${String(d.summary).replace(/[\r\n]+/g, ' ').slice(0, 120)}${d.isExam ? ' (EXAM)' : ''}: ${new Date(d.start).toString()}`)
        .join('\n')
    : '- (no upcoming deadlines found)'
  const days = stats.last7
    .map((d) => `- ${d.date}: ${d.sessions} sessions, ${Math.round(d.focusSec / 60)} focused min, avg score ${d.avgScore ?? 'n/a'}`)
    .join('\n')
  return `You are a friendly study coach inside a desktop "study pet" app for a university student.
Today is ${DAY_NAMES[now.getDay()]} ${now.toString()}.

Upcoming deadlines:
${dl}

Focus history for the last 7 days (score 0-100 = share of time on study apps/sites):
${days}

The student uses ${settings.focusMinutes}-minute pomodoros with ${settings.breakMinutes}-minute breaks.

Create a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,
and fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.
Block lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.

Reply with ONLY a JSON object, no markdown fences, in exactly this shape:
{"summary": "<2-3 encouraging sentences explaining the plan>",
 "blocks": [{"day": <0-6, 0 = Sunday>, "time": "HH:MM" (24h), "minutes": <number>, "label": "<what to study>"}]}`
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : text
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('no JSON object in response')
  return JSON.parse(body.slice(start, end + 1))
}

export function parsePlan(text: string, now = Date.now()): StudyPlan {
  const raw = extractJson(text) as { summary?: unknown; blocks?: unknown }
  const blocks: PlanBlock[] = []
  if (Array.isArray(raw.blocks)) {
    for (const b of raw.blocks as Record<string, unknown>[]) {
      const day = Number(b?.day)
      const m = String(b?.time ?? '').match(/^(\d{1,2}):(\d{2})/)
      const minutes = Math.round(Number(b?.minutes))
      if (!Number.isInteger(day) || day < 0 || day > 6 || !m) continue
      const h = Number(m[1])
      const mm = Number(m[2])
      if (h > 23 || mm > 59) continue
      blocks.push({
        day,
        time: `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
        minutes: Number.isFinite(minutes) && minutes > 0 ? Math.min(minutes, 600) : 25,
        label: String(b?.label ?? 'Study').slice(0, 120) || 'Study'
      })
    }
  }
  if (!blocks.length) throw new Error('plan had no valid blocks')
  return {
    generatedAt: now,
    summary: typeof raw.summary === 'string' ? raw.summary : 'Here is your study plan!',
    blocks
  }
}

/** JSON schema the plan must follow (local runtimes enforce it as a grammar / Ollama `format`). */
export const PLAN_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    blocks: {
      type: 'array',
      minItems: 1,
      maxItems: 10,
      items: {
        type: 'object',
        properties: {
          day: { enum: [0, 1, 2, 3, 4, 5, 6] },
          time: { type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' },
          minutes: { type: 'integer', minimum: 5, maximum: 600 },
          label: { type: 'string' }
        },
        required: ['day', 'time', 'minutes', 'label'],
        additionalProperties: false
      }
    }
  },
  required: ['summary', 'blocks'],
  additionalProperties: false
}

export type GenerateText = (prompt: string, opts?: CompleteOptions) => Promise<string>

async function defaultGenerateText(prompt: string, opts?: CompleteOptions): Promise<string> {
  const { generateText } = await import('./ai/registry')
  return generateText(prompt, opts)
}

/** The user's instructions (Settings → AI → Advanced), or the default if they can't be read. */
async function defaultSystemPrompt(): Promise<string> {
  try {
    const [{ effectiveSystemPrompt }, store] = await Promise.all([import('./ai/prompts'), import('./store')])
    return effectiveSystemPrompt(store.getAiSettings())
  } catch {
    return DEFAULT_SYSTEM_PROMPT
  }
}

export async function generatePlan(
  deadlines: Deadline[],
  stats: Stats,
  settings: Settings,
  generate: GenerateText = defaultGenerateText,
  /** The system prompt; default: the one saved in AiSettings (or DEFAULT_SYSTEM_PROMPT). */
  system?: string
): Promise<Result<StudyPlan>> {
  let text: string
  try {
    text = await generate(buildPrompt(deadlines, stats, settings, new Date()), {
      system: system ?? (await defaultSystemPrompt()),
      jsonSchema: PLAN_JSON_SCHEMA,
      maxTokens: 2048,
      timeoutMs: 180_000
    })
  } catch (e) {
    return { ok: false, error: (e as Error).message || String(e) }
  }
  try {
    const plan = parsePlan(text)
    console.log(`[bloop] plan generated: ${plan.blocks.length} blocks`)
    return { ok: true, value: plan }
  } catch (e) {
    return { ok: false, error: `The AI's answer wasn't a usable plan. Try again. (${(e as Error).message})` }
  }
}

/** Convert plan blocks to reminders (one per block, on that weekday). */
export function planToReminders(plan: StudyPlan): Reminder[] {
  return plan.blocks.map((b, i) => ({
    id: `plan-${plan.generatedAt.toString(36)}-${i}`,
    days: [b.day],
    time: b.time,
    label: `${b.label} (${b.minutes} min)`,
    enabled: true
  }))
}
``````
