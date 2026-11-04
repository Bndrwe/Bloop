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
