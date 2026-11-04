#!/usr/bin/env python3
"""LoRA fine-tune Qwen/Qwen3.5-0.8B for the Bloop model, then merge the adapter.

Usage (from the repo root, inside ml/.venv):
    python ml/train/train_lora.py --dry-run          # time a few steps, print ETA, stop
    python ml/train/train_lora.py                    # full run: train -> adapter -> merged model
    python ml/train/train_lora.py --merge-only       # re-merge an existing adapter

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
    p.add_argument("--model", default="Qwen/Qwen3.5-0.8B", help="HF model id or local path")
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
    return p.parse_args(argv)


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


def make_peft_model(model, args):
    from peft import LoraConfig, get_peft_model

    targets = args.lora_targets
    if targets != "all-linear":
        targets = [t.strip() for t in targets.split(",") if t.strip()]
    kw = dict(r=args.lora_r, lora_alpha=args.lora_alpha, lora_dropout=args.lora_dropout,
              target_modules=targets, bias="none", task_type="CAUSAL_LM")
    try:
        # keep the vision tower (and any MTP head) untouched: text-only fine-tune
        cfg = LoraConfig(exclude_modules=r".*(visual|vision_tower|vision_model|mtp).*", **kw)
    except TypeError:
        print("[lora] this peft has no exclude_modules; vision-tower linears will get adapters too (harmless).")
        cfg = LoraConfig(**kw)
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
