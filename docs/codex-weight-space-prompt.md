# Brief for Codex: weight-space editing of the Bloop model (MIT-style)

Use this **after** the training run from `docs/codex-colab-prompt.md` has finished. You need a merged Bloop model at `ml/out/bloop-merged`, or the plain base. Paste everything below the line into Codex. It works in Colab on a free T4 (upload `ml/` as a zip, same as the training brief) or on an Apple Silicon Mac (`ml/.venv`).

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
from ml.wsp.harness import Workspace
from ml.wsp import presets
ws = Workspace(model="ml/out/bloop-merged", data_dir="ml/data", budget=50)   # or model="Qwen/Qwen3.5-0.8B"
base = ws.generate("dev")                    # costs budget; returns outputs + per-example scores
acts = ws.activations(texts, layers=[...], site="mlp_out")
d    = ws.contrast_direction(good_texts, bad_texts, layer=L, site="mlp_out")
ws.logit_lens(d)                             # free: which tokens the direction promotes
cols = ws.top_columns(L, d, k=64)
eid  = ws.edit_subtract_direction(L, d, columns=cols, strength=1.0)
ws.revert(eid); ws.diff_summary(); ws.notes("why I did this")
presets.apply_mit_edit(ws, mode="delta")     # MIT's own edit, as a baseline to beat
ws.final_test()                              # ONE shot on the locked eval set
ws.save("ml/out/bloop-wsp")                  # full model + edits.json + EDIT_REPORT.md + patch
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
6. **Final (1 pass):** call `ws.final_test()` once on the best configuration, then `ws.save("ml/out/bloop-wsp")`.
7. **Export:** `bash ml/train/convert_quantize.sh --src ml/out/bloop-wsp --name bloop-qwen3.5-0.8b-wsp --quant Q4_K_M`. Then run `ml/train/eval.py` to compare **base, mit-edit, bloop-tuned and bloop-tuned+wsp** (with and without the JSON grammar). Print the size and sha256 of the final GGUF.
8. **Optional:** retrain the LoRA on top of MIT's checkpoint: `BASE=RikiyaT/Qwen3.5-0.8B-weight-space-programming bash ml/run_mac.sh`, or set `BASE` in the Colab notebook. Compare it in the same eval.

## Rules

- **No gradient training in this session.** Only direct weight edits through the harness. LoRA training belongs to the separate training brief.
- **Budget:** never exceed 50 forward passes. Don't look at the `test` split before `final_test()`, and call it exactly once.
- **Edits stay small:** never edit embeddings, the unembedding or the vision tower.
- **Reversible:** every edit must stay reversible and logged with a reason in `ws.notes`.
- **Honest results:** if no edit beats the baseline, say so and ship nothing. If the MIT edit or plain fine-tuning is better, recommend that.
- **Don't publish anything.** If uploading to Hugging Face is needed, stop and ask me for a token. Never invent one.
- **Two failures:** if a step fails twice, stop and show me the error.

## Report back

- **Metrics table:** dev and final-test results (schema-valid %, rule pass %, nudge pass %, loop/token-limit %, latency) for base, MIT edit, your edit, and tuned plus edit.
- **The edit:** layers, site, k, strength, # params changed, % of the model, and the logit-lens tokens that explain it.
- **Budget:** how many forward passes you used.
- **Output:** the path of `ml/out/bloop-wsp`, the patch file, and the GGUF size and sha256.
- **Recommendation:** which variant Bloop should ship, and why.
