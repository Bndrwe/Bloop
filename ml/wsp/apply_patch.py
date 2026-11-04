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
