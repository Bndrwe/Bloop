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
