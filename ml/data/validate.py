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
