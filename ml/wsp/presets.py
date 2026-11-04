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
