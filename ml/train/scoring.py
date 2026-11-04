"""Pure (stdlib-only) scoring helpers for the Bloop model evaluation.

Two kinds of prompts exist in the dataset:
  * plan prompts  - the study-plan prompt from src/main/plan.ts (asks for a JSON object)
  * nudge prompts - everything else (short encouraging line, <= 60 chars)

All functions are deterministic and unit-tested in test_scoring.py.
"""
from __future__ import annotations

import json
import re
from datetime import date, datetime
from typing import Any, Optional

NUDGE_MAX_CHARS = 60
DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
MONTHS = {m: i for i, m in enumerate(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}

# JSON schema used for grammar-constrained decoding (llama.cpp converts it to a GBNF grammar).
PLAN_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "blocks": {
            "type": "array",
            "minItems": 3,
            "maxItems": 10,
            "items": {
                "type": "object",
                "properties": {
                    "day": {"type": "integer", "minimum": 0, "maximum": 6},
                    "time": {"type": "string", "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$"},
                    "minutes": {"type": "integer", "minimum": 5, "maximum": 240},
                    "label": {"type": "string"},
                },
                "required": ["day", "time", "minutes", "label"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["summary", "blocks"],
    "additionalProperties": False,
}


# --------------------------------------------------------------------------- JSON extraction
def extract_json(text: str) -> Any:
    """Mirror of extractJson() in src/main/plan.ts: strip a code fence, take first '{' .. last '}'."""
    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    body = m.group(1) if m else text
    start, end = body.find("{"), body.rfind("}")
    if start == -1 or end <= start:
        raise ValueError("no JSON object in response")
    return json.loads(body[start : end + 1])


def try_extract_json(text: str) -> Optional[Any]:
    try:
        return extract_json(text)
    except (ValueError, json.JSONDecodeError):
        return None


def is_clean_json(text: str) -> bool:
    """True when the whole reply is exactly one JSON object (no fences, no prose)."""
    try:
        return isinstance(json.loads(text.strip()), dict)
    except (ValueError, json.JSONDecodeError):
        return False


# --------------------------------------------------------------------------- schema
def _is_int(v: Any) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def _is_num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def parse_hhmm(s: Any) -> Optional[int]:
    """'HH:MM' -> minutes since midnight, or None if malformed."""
    if not isinstance(s, str):
        return None
    m = re.fullmatch(r"(\d{1,2}):(\d{2})", s.strip())
    if not m:
        return None
    h, mm = int(m.group(1)), int(m.group(2))
    if h > 23 or mm > 59:
        return None
    return h * 60 + mm


def schema_errors(plan: Any) -> list[str]:
    """Structural validation matching what parsePlan() in plan.ts needs. Empty list == valid."""
    errs: list[str] = []
    if not isinstance(plan, dict):
        return ["top level is not an object"]
    if not isinstance(plan.get("summary"), str) or not plan["summary"].strip():
        errs.append("summary missing or not a non-empty string")
    blocks = plan.get("blocks")
    if not isinstance(blocks, list) or not blocks:
        errs.append("blocks missing or empty")
        return errs
    for i, b in enumerate(blocks):
        if not isinstance(b, dict):
            errs.append(f"blocks[{i}] not an object")
            continue
        if not _is_int(b.get("day")) or not 0 <= b["day"] <= 6:
            errs.append(f"blocks[{i}].day must be an integer 0-6")
        if parse_hhmm(b.get("time")) is None:
            errs.append(f"blocks[{i}].time must be HH:MM")
        if not _is_num(b.get("minutes")) or b["minutes"] <= 0:
            errs.append(f"blocks[{i}].minutes must be a positive number")
        if not isinstance(b.get("label"), str) or not b["label"].strip():
            errs.append(f"blocks[{i}].label must be a non-empty string")
    return errs


def is_schema_valid(plan: Any) -> bool:
    return not schema_errors(plan)


# --------------------------------------------------------------------------- prompt context
def is_plan_prompt(prompt: str) -> bool:
    p = prompt.lower()
    return "study plan" in p and ("json" in p or '"blocks"' in p)


_DATE_JS = re.compile(r"\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,? (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* (\d{1,2}),? (\d{4})")
_DATE_ISO = re.compile(r"(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)")


def find_date(line: str) -> Optional[date]:
    """First date in a line: JS Date.toString() style ('Tue Nov 10 2026 ...') or ISO ('2026-11-10')."""
    m = _DATE_JS.search(line)
    if m:
        try:
            return date(int(m.group(3)), MONTHS[m.group(1)], int(m.group(2)))
        except ValueError:
            return None
    m = _DATE_ISO.search(line)
    if m:
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            return None
    return None


def parse_context(prompt: str) -> dict:
    """Pull today's date/weekday, pomodoro/break minutes and deadlines out of a plan prompt."""
    ctx: dict = {"today": None, "today_dow": None, "pomodoro": 25, "break": 5, "deadlines": []}
    m = re.search(r"Today is (Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)([^\n]*)", prompt)
    if m:
        ctx["today_dow"] = DAY_NAMES.index(m.group(1))
        ctx["today"] = find_date(m.group(2))
    m = re.search(r"uses (?:a )?(\d+)[- ]minute pomodoro", prompt)
    if m:
        ctx["pomodoro"] = int(m.group(1))
    m = re.search(r"(\d+)[- ]minute breaks", prompt)
    if m:
        ctx["break"] = int(m.group(1))
    sec = re.search(r"Upcoming deadlines:\n([\s\S]*?)\n\s*\n", prompt)
    if sec:
        for line in sec.group(1).splitlines():
            line = line.strip()
            if not line.startswith("-") or "no upcoming deadlines" in line:
                continue
            d = find_date(line)
            if d:
                ctx["deadlines"].append({"line": line, "date": d, "exam": "(EXAM)" in line})
    if ctx["today"] is None:  # fall back to the earliest known anchor: weekday only
        pass
    return ctx


# --------------------------------------------------------------------------- rule checks
def check_block_count(plan: dict) -> bool:
    b = plan.get("blocks") if isinstance(plan, dict) else None
    return isinstance(b, list) and 3 <= len(b) <= 10


def check_hours(plan: dict, lo: int = 8 * 60, hi: int = 22 * 60) -> bool:
    """Every block starts at/after 08:00 and ends at/before 22:00."""
    for b in plan.get("blocks", []):
        start = parse_hhmm(b.get("time"))
        mins = b.get("minutes")
        if start is None or not _is_num(mins):
            return False
        if start < lo or start + mins > hi:
            return False
    return True


def deadline_offsets(ctx: dict) -> list[int]:
    """Days from today (0-6) for deadlines that fall inside the 7-day planning window."""
    if ctx.get("today") is None:
        return []
    return [o for o in ((d["date"] - ctx["today"]).days for d in ctx["deadlines"]) if 0 <= o <= 6]


def check_before_deadline(plan: dict, ctx: dict) -> Optional[bool]:
    """No block lies after the last in-window deadline's weekday. None when not applicable."""
    offs = deadline_offsets(ctx)
    if not offs or ctx.get("today_dow") is None:
        return None
    last = max(offs)
    for b in plan.get("blocks", []):
        day = b.get("day")
        if not _is_int(day):
            return False
        if (day - ctx["today_dow"]) % 7 > last:
            return False
    return True


def minutes_ok(minutes: Any, pomodoro: int, brk: int = 5) -> bool:
    """Roughly a multiple of the pomodoro length (or of focus+break)."""
    if not _is_num(minutes) or minutes <= 0 or pomodoro <= 0:
        return False
    for unit in {pomodoro, pomodoro + brk}:
        k = round(minutes / unit)
        if k >= 1 and abs(minutes - k * unit) <= max(5, 0.2 * unit):
            return True
    return False


def check_pomodoro(plan: dict, ctx: dict) -> bool:
    return all(minutes_ok(b.get("minutes"), ctx.get("pomodoro", 25), ctx.get("break", 5)) for b in plan.get("blocks", []))


def score_plan(text: str, prompt: str) -> dict:
    """Score one model reply to a plan prompt. Rule fields are None when the plan could not be checked."""
    ctx = parse_context(prompt)
    obj = try_extract_json(text)
    res: dict = {"parsed": obj is not None, "clean_json": is_clean_json(text), "schema_valid": False,
                 "blocks_3_10": None, "hours_ok": None, "before_deadline": None, "pomodoro_ok": None,
                 "all_rules": None, "errors": []}
    if obj is None:
        return res
    errs = schema_errors(obj)
    res["errors"] = errs
    res["schema_valid"] = not errs
    if errs:
        return res
    res["blocks_3_10"] = check_block_count(obj)
    res["hours_ok"] = check_hours(obj)
    res["before_deadline"] = check_before_deadline(obj, ctx)
    res["pomodoro_ok"] = check_pomodoro(obj, ctx)
    res["all_rules"] = all(res[k] is not False for k in ("blocks_3_10", "hours_ok", "before_deadline", "pomodoro_ok"))
    return res


def score_nudge(text: str) -> dict:
    t = text.strip()
    return {"nonempty": bool(t), "single_line": "\n" not in t, "len": len(t), "le60": bool(t) and len(t) <= NUDGE_MAX_CHARS}


# --------------------------------------------------------------------------- aggregation
def rate(values: list[Optional[bool]]) -> Optional[float]:
    """Share of True among non-None values; None when nothing applies."""
    vs = [v for v in values if v is not None]
    return (sum(1 for v in vs if v) / len(vs)) if vs else None


def aggregate_plans(results: list[dict]) -> dict:
    n = len(results)
    return {
        "n": n,
        "parse_rate": rate([r["parsed"] for r in results]),
        "clean_json_rate": rate([r["clean_json"] for r in results]),
        "schema_valid_rate": rate([r["schema_valid"] for r in results]),
        "blocks_3_10": rate([r["blocks_3_10"] for r in results]),
        "hours_ok": rate([r["hours_ok"] for r in results]),
        "before_deadline": rate([r["before_deadline"] for r in results]),
        "pomodoro_ok": rate([r["pomodoro_ok"] for r in results]),
        # strict: counted over ALL plans, so unparseable replies count as failures
        "all_rules": rate([bool(r["all_rules"]) for r in results]),
    }


def aggregate_nudges(results: list[dict]) -> dict:
    return {"n": len(results), "le60_rate": rate([r["le60"] for r in results]),
            "single_line_rate": rate([r["single_line"] for r in results])}


def pct(x: Optional[float]) -> str:
    return "n/a" if x is None else f"{100 * x:.0f}%"
