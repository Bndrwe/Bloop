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
