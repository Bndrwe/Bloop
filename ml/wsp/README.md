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
