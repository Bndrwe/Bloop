#!/usr/bin/env python3
"""Evaluate the base and tuned Bloop GGUFs on ml/data/eval.jsonl with llama.cpp's llama-server.

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
CARD_START, CARD_END = "<!-- EVAL_TABLE_START -->", "<!-- EVAL_TABLE_END -->"


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
    cols = [(m, mode) for m in ("base", "tuned") if m in results for mode in ("free", "grammar")]
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
    for m in ("base", "tuned"):
        if m in results:
            lines.append(f"- {m}: `{results[m]['gguf']}` ({results[m]['size_bytes'] / 1e6:.0f} MB)")
    lines += ["", "## Samples", ""]
    for m in ("base", "tuned"):
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
    args = ap.parse_args()

    items = load_eval(Path(args.eval_file), args.limit)
    n_plan = sum(1 for i in items if i["kind"] == "plan")
    print(f"[eval] {len(items)} examples ({n_plan} plan, {len(items) - n_plan} nudge)")
    binary = find_server(args.server_bin)
    report = Path(args.report)
    log_dir = report.parent
    log_dir.mkdir(parents=True, exist_ok=True)

    results: dict = {}
    if not args.skip_base:
        if Path(args.base_gguf).exists():
            results["base"] = run_model("base", args.base_gguf, items, args, binary, log_dir)
        else:
            print(f"[eval] base GGUF missing ({args.base_gguf}); comparing tuned only")
    if not Path(args.tuned_gguf).exists():
        raise SystemExit(f"tuned GGUF not found: {args.tuned_gguf}")
    results["tuned"] = run_model("tuned", args.tuned_gguf, items, args, binary, log_dir)

    (log_dir / "results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    tbl = write_report(results, args, report)
    update_model_card(Path(args.model_card), tbl)
    print("\n" + tbl + f"\n\nReport: {report}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
