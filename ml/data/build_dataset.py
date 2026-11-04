#!/usr/bin/env python3
"""Regenerates ml/data/train.jsonl and ml/data/eval.jsonl (deterministic, fixed seed).

    python3 ml/data/build_dataset.py            # writes train.jsonl / eval.jsonl
    python3 ml/data/validate.py                 # validates them, writes READY when clean

Study-plan prompts are rendered by the REAL buildPrompt() from src/main/plan.ts (ml/data/render_prompts.cjs
extracts and transpiles it), then cross-checked against an independent Python re-implementation below.
Plan targets come from a rule-based planner that satisfies every check in ml/train/scoring.py.
"""
from __future__ import annotations

import datetime as dt
import json
import random
import re
import subprocess
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "train"))
import scoring as S  # noqa: E402
from nudge_lines import DRIFT_SITE, EVAL_HOLDOUT, POOL  # noqa: E402

SEED = 20261104
N_TRAIN, N_EVAL = 240, 30
# (plans, robustness plans, nudges) per split. 70% / 10% / 20%.
MIX = {"train": (168, 24, 48), "eval": (21, 3, 6)}
NUDGE_MIX = {"train": {"drift": 14, "welcome": 9, "break": 9, "back": 8, "done": 8},
             "eval": {"drift": 2, "welcome": 1, "break": 1, "back": 1, "done": 1}}

DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
DOW3 = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
TZS = {  # tz -> (standard name, daylight name) as printed by V8's Date.toString()
    "America/New_York": ("Eastern Standard Time", "Eastern Daylight Time"),
    "America/Chicago": ("Central Standard Time", "Central Daylight Time"),
    "America/Denver": ("Mountain Standard Time", "Mountain Daylight Time"),
    "America/Los_Angeles": ("Pacific Standard Time", "Pacific Daylight Time"),
    "Europe/London": ("Greenwich Mean Time", "British Summer Time"),
    "UTC": ("Coordinated Universal Time", "Coordinated Universal Time"),
}
TZ_WEIGHTS = [("America/New_York", 4), ("America/Chicago", 3), ("America/Denver", 1),
              ("America/Los_Angeles", 3), ("Europe/London", 1), ("UTC", 1)]

# ----------------------------------------------------------------------------- courses
COURSES = {
    "CHEM 201": ["equilibrium", "acid-base titrations", "thermodynamics", "kinetics"],
    "CS 251": ["linked lists", "recursion", "hash tables", "Big-O analysis"],
    "MA 261": ["partial derivatives", "double integrals", "gradients", "Lagrange multipliers"],
    "HIST 110": ["the Industrial Revolution", "primary sources", "key dates", "the Cold War"],
    "PSY 120": ["memory models", "conditioning", "research methods", "cognitive biases"],
    "ECON 251": ["supply and demand", "elasticity", "market structures", "GDP and inflation"],
    "BIO 110": ["cell respiration", "genetics", "photosynthesis", "evolution"],
    "ENGL 106": ["thesis statements", "citations", "close reading", "argument structure"],
    "PHYS 172": ["Newton's laws", "energy conservation", "circuits", "waves"],
    "STAT 350": ["hypothesis tests", "confidence intervals", "regression", "probability rules"],
    "CS 180": ["Python loops", "functions", "debugging", "file I/O"],
    "MA 165": ["limits", "derivative rules", "integration", "related rates"],
    "SOC 100": ["social theory", "survey methods", "key concepts", "case studies"],
    "ART 120": ["art movements", "visual analysis", "artist profiles", "terminology"],
}
EXAM_TITLES = ["Midterm", "Midterm 2", "Midterm 1", "Final Exam", "Exam 1", "Exam 2", "Exam 3"]
# kind -> (titles, demand minutes, first step, last step)
ASSIGN = {
    "hw": (["Homework 4", "Homework 7", "Homework 9", "Problem Set 3", "Problem Set 5", "Problem Set 8"], 110,
           "work through the problems", "check answers and redo mistakes"),
    "lab": (["Lab Report 2", "Lab Report 3", "Lab Report 5"], 150, "organize data and figures", "write conclusion and proofread"),
    "essay": (["Essay Draft", "Essay 2", "Paper Outline", "Research Essay"], 170, "outline and draft", "revise and proofread"),
    "project": (["Project Milestone 2", "Project 3", "Group Project Part 1"], 170, "build the next milestone", "test and clean up"),
    "reading": (["Reading Response", "Reading Response 4", "Discussion Post 3"], 70, "read and take notes", "write the response"),
    "quiz": (["Quiz 3", "Quiz 4", "Online Quiz 2"], 75, "review key ideas", "quick practice quiz"),
    "talk": (["Presentation", "Group Presentation"], 120, "build the slides", "practice the talk out loud"),
}
GENERIC_LABELS = ["Review this week's lecture notes", "Get ahead on upcoming readings", "Make flashcards from class notes",
                  "Practice problems from class", "Plan next week's study goals", "Light revision: summarize key ideas",
                  "Tidy notes and fix gaps", "Catch up on any missed material"]

CHRONO_STARTS = {"morning": [8 * 60, 8 * 60 + 30, 9 * 60, 9 * 60 + 30, 10 * 60],
                 "afternoon": [13 * 60, 13 * 60 + 30, 14 * 60, 15 * 60, 16 * 60],
                 "evening": [17 * 60 + 30, 18 * 60, 18 * 60 + 30, 19 * 60, 19 * 60 + 30]}


def est_tokens(text: str) -> int:
    """Rough BPE-like proxy that charges digits and punctuation one token each (Qwen splits digits)."""
    n = 0
    for m in re.finditer(r"[A-Za-z]+|\d|[^\sA-Za-z\d]", text):
        w = m.group(0)
        n += -(-len(w) // 6) if w[0].isalpha() else 1
    return n


TOKEN_CAP = 900  # keep prompt+answer under this by est_tokens() so train_lora.py's --max-len 1024 never drops a row


def hhmm(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}"


def wchoice(rng: random.Random, pairs):
    return rng.choices([p[0] for p in pairs], [p[1] for p in pairs])[0]


# ----------------------------------------------------------------------------- scenarios
class Item:
    def __init__(self, summary, code, exam, kind, offset, due, rng):
        self.summary, self.code, self.exam, self.kind = summary, code, exam, kind
        self.offset, self.due = offset, due  # offset = whole days from today, due = minutes since midnight
        self.topics = rng.sample(COURSES[code], 3)
        self.prio = offset - (3 if exam else 0) + (0 if exam else 0.1)


def pick_courses(rng, n):
    return rng.sample(list(COURSES), n)


def history(rng, profile, today: dt.date):
    rows = []
    for k in range(7, 0, -1):  # oldest first, 7 entries ending today ("today" is the 7th: mostly empty, day just starting)
        d = today - dt.timedelta(days=k - 1)
        if k == 1:  # today so far
            sessions = 0 if profile in ("empty", "low", "sporadic") or rng.random() < 0.55 else 1
            mins = round(sessions * rng.uniform(12, 30))
        else:
            if profile == "empty":
                sessions, mins = 0, 0
            else:
                zero_p = {"low": 0.55, "sporadic": 0.7, "moderate": 0.12, "high": 0.06}[profile]
                lo_hi = {"low": (1, 2, 8, 25), "sporadic": (1, 3, 15, 35), "moderate": (2, 4, 22, 35), "high": (4, 7, 25, 40)}[profile]
                if rng.random() < zero_p:
                    sessions, mins = 0, 0
                else:
                    sessions = rng.randint(lo_hi[0], lo_hi[1])
                    mins = round(sessions * rng.uniform(lo_hi[2], lo_hi[3]))
        score = None
        if sessions:
            lo, hi = {"low": (35, 70), "sporadic": (40, 75), "moderate": (55, 85), "high": (70, 96), "empty": (50, 60)}[profile]
            score = rng.randint(lo, hi)
        rows.append({"date": d.isoformat(), "sessions": sessions, "focusSec": mins * 60 + (rng.randint(0, 29) if mins else 0),
                     "avgScore": score, "mins": mins})
    return rows


def gen_scenario(rng: random.Random, kind: str, js_dow: int):
    """kind: normal | empty_nodl | today | crunch | far | nohist"""
    # date with the requested weekday
    base = dt.date(2026, 8, 24) + dt.timedelta(days=rng.randint(0, 250))
    while (base.weekday() + 1) % 7 != js_dow:
        base += dt.timedelta(days=1)
    tz = wchoice(rng, TZ_WEIGHTS)
    chrono = rng.choices(["morning", "afternoon", "evening"], [4, 3, 3])[0]
    if kind == "today":
        chrono = rng.choice(["morning", "morning", "afternoon"])
    now_min = {"morning": rng.randint(7 * 60 + 30, 11 * 60 + 45), "afternoon": rng.randint(12 * 60, 16 * 60 + 45),
               "evening": rng.randint(17 * 60, 21 * 60 + 45)}[chrono]
    if kind == "today":
        now_min = rng.randint(7 * 60 + 30, 12 * 60)
    now = [base.year, base.month, base.day, now_min // 60, now_min % 60, rng.randint(0, 59)]
    pomo, brk = rng.choices([(25, 5), (50, 10), (30, 5), (45, 15)], [4, 3, 2, 2])[0]

    profile = rng.choices(["empty", "low", "sporadic", "moderate", "high"], [1, 3, 2, 4, 3])[0]
    if kind in ("empty_nodl", "nohist"):
        profile = "empty"
    hist = history(rng, profile, base)

    n_dl = {"normal": rng.choices([0, 1, 2, 3, 4, 5], [10, 18, 25, 22, 15, 10])[0], "empty_nodl": 0, "today": rng.choice([1, 1, 2]),
            "crunch": 5, "far": rng.choice([1, 2, 3]), "nohist": rng.choice([1, 2, 3])}[kind]
    codes = pick_courses(rng, n_dl)
    items: list[Item] = []
    for i, code in enumerate(codes):
        if kind == "today":
            offset = 0
        elif kind == "crunch":
            offset = rng.choice([0, 1, 1, 2, 2, 3, 3, 4]) if i else rng.choice([1, 2])
            offset = max(1, offset) if rng.random() < 0.8 else offset
        elif kind == "far":
            offset = rng.randint(7, 13)
        else:
            offset = rng.choices(range(1, 12), [4, 6, 7, 7, 6, 5, 4, 3, 2, 2, 1])[0]
        exam = rng.random() < (0.5 if kind != "crunch" else 0.4)
        if exam:
            title = rng.choice(EXAM_TITLES)
            due = rng.choice([9 * 60, 10 * 60, 11 * 60, 13 * 60, 14 * 60, 15 * 60 + 30, 17 * 60, 18 * 60 + 30, 19 * 60])
            akind = "exam"
        else:
            akind = rng.choice(list(ASSIGN))
            title = rng.choice(ASSIGN[akind][0])
            due = rng.choice([9 * 60, 11 * 60 + 59, 14 * 60, 17 * 60, 23 * 60 + 59, 23 * 60 + 59, 23 * 60 + 59])
        if kind == "today":
            due = rng.choice([17 * 60, 18 * 60 + 30, 20 * 60, 23 * 60 + 59])
        if offset == 0 and due <= now_min + 240:  # must still be upcoming, with room to study before it
            exam, akind, due = False, rng.choice(list(ASSIGN)), 23 * 60 + 59
            title = rng.choice(ASSIGN[akind][0])
        items.append(Item(f"{code} {title}", code, exam, akind, offset, due, rng))
    items.sort(key=lambda it: (it.offset, it.due))
    return {"kind": kind, "tz": tz, "now": now, "now_min": now_min, "date": base, "js_dow": js_dow, "chrono": chrono,
            "pomo": pomo, "brk": brk, "profile": profile, "hist": hist, "items": items}


# ----------------------------------------------------------------------------- prompt rendering
def node_render(scenarios) -> list[str]:
    payload = []
    for sc in scenarios:
        d0 = sc["date"]
        payload.append({
            "tz": sc["tz"], "now": sc["now"], "focusMinutes": sc["pomo"], "breakMinutes": sc["brk"],
            "last7": [{k: r[k] for k in ("date", "sessions", "focusSec", "avgScore")} for r in sc["hist"]],
            "deadlines": [{"summary": it.summary, "isExam": it.exam,
                           "at": [(d0 + dt.timedelta(days=it.offset)).year, (d0 + dt.timedelta(days=it.offset)).month,
                                  (d0 + dt.timedelta(days=it.offset)).day, it.due // 60, it.due % 60]} for it in sc["items"]],
        })
    out = subprocess.run(["node", str(HERE / "render_prompts.cjs")], input=json.dumps(payload), capture_output=True,
                         text=True, check=True, cwd=HERE)
    return json.loads(out.stdout)


def js_tostring(local: dt.datetime) -> str:
    off = int(local.utcoffset().total_seconds() // 60)
    sign = "+" if off >= 0 else "-"
    name = TZS[local.tzinfo.key][1 if local.dst() else 0]
    return (f"{DOW3[(local.weekday() + 1) % 7]} {MON3[local.month - 1]} {local.day:02d} {local.year} "
            f"{local.hour:02d}:{local.minute:02d}:{local.second:02d} GMT{sign}{abs(off) // 60:02d}{abs(off) % 60:02d} ({name})")


PROMPT_TMPL = '''You are a friendly study coach inside a desktop "study pet" app for a university student.
Today is {today}.

Upcoming deadlines:
{dl}

Focus history for the last 7 days (score 0-100 = share of time on study apps/sites):
{days}

The student uses {f}-minute pomodoros with {b}-minute breaks.

Create a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,
and fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.
Block lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.

Reply with ONLY a JSON object, no markdown fences, in exactly this shape:
{{"summary": "<2-3 encouraging sentences explaining the plan>",
 "blocks": [{{"day": <0-6, 0 = Sunday>, "time": "HH:MM" (24h), "minutes": <number>, "label": "<what to study>"}}]}}'''


def py_prompt(sc) -> str:
    z = ZoneInfo(sc["tz"])
    n = sc["now"]
    now = dt.datetime(n[0], n[1], n[2], n[3], n[4], n[5], tzinfo=z)
    dl = "\n".join(
        f"- {it.summary}{' (EXAM)' if it.exam else ''}: " + js_tostring(
            dt.datetime.combine(sc["date"] + dt.timedelta(days=it.offset), dt.time(it.due // 60, it.due % 60), tzinfo=z))
        for it in sc["items"]) or "- (no upcoming deadlines found)"
    days = "\n".join(f"- {r['date']}: {r['sessions']} sessions, {round(r['focusSec'] / 60)} focused min, avg score "
                     f"{r['avgScore'] if r['avgScore'] is not None else 'n/a'}" for r in sc["hist"])
    return PROMPT_TMPL.format(today=f"{DAY_NAMES[(now.weekday() + 1) % 7]} {js_tostring(now)}", dl=dl, days=days,
                              f=sc["pomo"], b=sc["brk"])


# ----------------------------------------------------------------------------- planner
def fit_units(width: int, p: int, gap: int = 30) -> int:
    n = 0
    while (n + 1) * p + n * gap <= width:
        n += 1
    return n


def when_phrase(offset: int, dow: int) -> str:
    if offset > 6:
        return f"in {offset} days"
    return "today" if offset == 0 else "tomorrow" if offset == 1 else f"on {DAY_NAMES[(dow + offset) % 7]}"


def plan_scenario(sc, rng: random.Random):
    """Returns {"summary","blocks"} or None when no sensible plan exists for this scenario."""
    p, brk = sc["pomo"], sc["brk"]
    items: list[Item] = sc["items"]
    in_win = [it for it in items if it.offset <= 6]
    L = max((it.offset for it in in_win), default=6)
    minimal = sc["kind"] in ("empty_nodl", "today", "crunch", "far", "nohist")
    max_blocks = rng.choice([3, 4, 5]) if minimal else rng.choices([5, 6, 7, 8, 9, 10], [2, 4, 4, 3, 1, 1])[0]
    if sc["kind"] == "crunch":
        max_blocks = rng.choice([5, 6, 7])

    # --- daily budget from recent habits
    mean_min = sum(r["mins"] for r in sc["hist"][:6]) / 6.0
    target = min(210, max(p, 1.3 * mean_min))
    budget = max(1, round(target / p))

    # --- per-day windows
    ws, we = {}, {}
    for d in range(L + 1):
        if d == 0:
            ws[d] = max(8 * 60, -(-(sc["now_min"] + rng.choice([30, 45, 60, 75])) // 15) * 15)
        else:
            ws[d] = rng.choice(CHRONO_STARTS[sc["chrono"]])
        we[d] = rng.choice([20 * 60, 21 * 60, 22 * 60]) if sc["chrono"] == "morning" else 22 * 60
    for it in items:  # on a deadline's own day, every block must end before it is due (exams: an hour before)
        if it.offset <= L:
            we[it.offset] = min(we[it.offset], it.due - (60 if it.exam else 30))

    def hard(d):
        return fit_units(we[d] - ws[d], p) if we[d] - ws[d] >= p else 0

    cap_soft = {d: min(budget, hard(d)) for d in range(L + 1)}
    used = {d: 0 for d in range(L + 1)}

    def allowed(it):
        last = min(it.offset - 1, L) if it.offset >= 1 else -1
        ds = [d for d in range(0, last + 1) if hard(d) > 0]
        if not ds and it.offset <= L:  # fall back to the due day itself, finishing before it is due
            d = it.offset
            we[d] = min(we[d], it.due - (60 if it.exam else 30))
            cap_soft[d] = min(budget, hard(d))
            ds = [d] if hard(d) > 0 else []
        return ds

    todo = sorted(items, key=lambda it: it.prio)
    allow = {id(it): allowed(it) for it in todo}
    todo = [it for it in todo if allow[id(it)]]
    maxu = 3 if p <= 30 else 2
    demand = {}
    for it in todo:
        mins = 200 + rng.choice([-25, 0, 25]) if it.exam else ASSIGN[it.kind][1]
        u = max(1, round(mins / p))
        if it.offset > 6:
            u = min(u, 3 if it.exam else 2)
        demand[id(it)] = u

    blocks: list[dict] = []  # {item, day, units}

    def grant(it, g_pref, soft=True):
        ds = allow[id(it)]
        cap = (lambda d: cap_soft[d]) if soft else hard
        cands = [d for d in ds if used[d] < cap(d)]
        if not cands:
            return False
        units_on = lambda d: sum(b["units"] for b in blocks if b["item"] is it and b["day"] == d)
        d = min(cands, key=lambda d: (units_on(d), d + rng.random() * 0.9))
        g = max(1, min(g_pref, cap(d) - used[d], remaining[id(it)]))
        ex = next((b for b in blocks if b["item"] is it and b["day"] == d and b["units"] < maxu), None)
        if ex:
            g = min(g, maxu - ex["units"])
            ex["units"] += g
        else:
            if len(blocks) >= max_blocks:
                return False
            g = min(g, maxu)
            blocks.append({"item": it, "day": d, "units": g})
        used[d] += g
        remaining[id(it)] -= g
        return True

    remaining = dict(demand)
    g_opts = [1, 2, 2, 3] if p <= 30 else [1, 1, 2]
    for it in todo[:2]:  # the two highest-priority items get ~60% of their demand first
        need = -(-demand[id(it)] * 6 // 10)
        while demand[id(it)] - remaining[id(it)] < need and grant(it, rng.choice(g_opts)):
            pass
    for it in todo:  # pass 1: everybody gets a first block, nearest/exams first
        if remaining[id(it)] == demand[id(it)]:
            grant(it, rng.choice(g_opts))
    progress = True
    while progress:  # pass 2: top up in priority order
        progress = False
        for it in todo:
            if remaining[id(it)] > 0 and grant(it, rng.choice(g_opts)):
                progress = True

    # --- make sure there are at least 3 blocks (recap blocks, ignoring the soft habit budget)
    filler_item = todo[0] if todo else None
    if minimal:
        min_blocks = 3
    elif todo:
        min_blocks = rng.choice([3, 4, 5]) if sc["profile"] in ("moderate", "high") else 3
    else:
        min_blocks = rng.choice([3, 4, 4, 5])
    guard = 0
    while len(blocks) < min_blocks and guard < 50:
        guard += 1
        ds = allow[id(filler_item)] if filler_item else [d for d in range(L + 1) if hard(d) > 0]
        ds = [d for d in ds if used[d] < hard(d)] or [d for d in range(L + 1) if used[d] < hard(d)]
        if not ds:
            if len(blocks) >= 3:
                break
            return None
        d = min(ds, key=lambda d: (used[d], d + rng.random() * 0.9))
        units = 1 if filler_item else max(1, min(rng.choice(g_opts), hard(d) - used[d], maxu))
        blocks.append({"item": filler_item, "day": d, "units": units, "filler": filler_item is not None})
        used[d] += units
    if len(blocks) < 3:
        return None

    # --- place blocks in time
    by_day: dict[int, list[dict]] = {}
    for b in blocks:
        by_day.setdefault(b["day"], []).append(b)
    for d, bl in by_day.items():
        bl.sort(key=lambda b: (b["item"].prio if b["item"] else 99, b["units"]))
        total = sum(b["units"] * p for b in bl)
        n = len(bl)
        width = we[d] - ws[d]
        gaps = [g for g in (30, 45, 60, 90) if total + (n - 1) * g <= width] if n > 1 else [0]
        if total > width or not gaps:
            return None
        g = rng.choice(gaps)
        leftover = width - (total + (n - 1) * g)
        t0 = ws[d] + min(leftover // 15 * 15, rng.choice([0, 0, 15, 30, 45]))
        for rnd in (True, False):  # prefer :00/:15/:30/:45 starts; fall back to exact packing if that overruns
            t, starts = t0, []
            for b in bl:
                if rnd:
                    t = -(-t // 15) * 15
                starts.append(t)
                t += b["units"] * p + g
            if starts[-1] + bl[-1]["units"] * p <= we[d]:
                break
        for b, st in zip(bl, starts):
            b["start"], b["minutes"] = st, b["units"] * p
    # --- labels
    per_item: dict[int, list[dict]] = {}
    for b in sorted(blocks, key=lambda b: (b["day"], b["start"])):
        per_item.setdefault(id(b["item"]) if b["item"] else 0, []).append(b)
    taken: set[str] = set()
    for key, bl in per_item.items():
        for i, b in enumerate(bl):
            lab = make_label(b["item"], i, len(bl), b, rng)
            for _ in range(12):  # keep labels distinct within a plan
                if lab not in taken:
                    break
                lab = make_label(b["item"], i, len(bl), b, rng)
            if lab in taken:
                lab = f"{lab} (part {i + 1})"
            taken.add(lab)
            b["label"] = lab
    out = []
    for b in sorted(blocks, key=lambda b: (b["day"], b["start"])):
        out.append({"day": (sc["js_dow"] + b["day"]) % 7, "time": hhmm(b["start"]), "minutes": b["minutes"],
                    "label": b["label"][:70]})
    first = next((it for it in todo if any(b["item"] is it and not b.get("filler") for b in blocks)), None)
    sc["_first"] = first
    sc["_scheduled"] = [it for it in todo if any(b["item"] is it for b in blocks)]
    sc["_n_days"] = len({b["day"] for b in blocks})
    sc["_starved"] = any(it.offset <= 6 and it not in sc["_scheduled"] for it in items)
    return {"summary": make_summary(sc, budget, rng), "blocks": out}


def make_label(it: Item | None, i: int, n: int, b: dict, rng: random.Random) -> str:
    if it is None:
        return rng.choice(GENERIC_LABELS)
    t = it.topics
    if it.offset == 0:
        return rng.choice([f"Final push: {it.summary}", f"{it.summary}: last review before it's due"]) if i == n - 1 else \
            f"{it.summary}: review {t[i % 3]}"
    if b.get("filler"):
        return rng.choice([f"Quick recap of {it.code} notes", f"{it.code}: flashcards and short review", f"Light {it.code} review: {t[0]}"])
    if it.offset > 6:
        steps = ["skim the material", f"review {t[0]}", "outline the main parts", f"review {t[1]}"]
        return f"Head start on {it.summary}: {steps[i % len(steps)]}"
    if it.exam:
        first = [f"{it.code} exam prep: review notes on {t[0]}", f"{it.code}: skim slides and {t[0]}", f"Start {it.code} exam review: {t[0]}"]
        mid = [f"{it.code}: practice problems on {t[1]}", f"{it.code} drills: {t[1]}", f"{it.code}: redo tricky {t[2]} questions"]
        last = [f"{it.code} final recap: key ideas and weak spots", f"{it.code}: mock exam, then fix mistakes", f"Last look at {it.code}: {t[2]}"]
        only = [f"{it.code} exam prep: {t[0]} + practice", f"{it.summary} review: {t[0]} + {t[1]}"]
        if n == 1:
            return rng.choice(only)
        return rng.choice(first) if i == 0 else rng.choice(last) if i == n - 1 else mid[(i - 1) % len(mid)]
    _, _, s1, s2 = ASSIGN[it.kind]
    if n == 1:
        return f"{it.summary}: {s1}" if len(it.summary) + len(s1) < 50 else it.summary
    return f"{it.summary}: {s1 if i < n - 1 else s2}"


def make_summary(sc, budget_units: int, rng: random.Random) -> str:
    p, brk = sc["pomo"], sc["brk"]
    dow = sc["js_dow"]
    first: Item | None = sc.get("_first")
    sched = [it for it in sc["_scheduled"] if it is not None]
    n_items = len(sched)
    prof = sc["profile"]
    if first is None:
        s1 = rng.choice(["Nothing is due soon, so this is a calm week to build a rhythm.",
                         "No deadlines in sight, so let's use the time to get ahead gently.",
                         "It's a quiet week on the calendar, so I kept things light and steady."])
    else:
        w = when_phrase(first.offset, dow)
        if n_items >= 3:
            s1 = rng.choice([f"You've got {n_items} things coming up, so I lined them up by what's closest, starting with {first.summary}.",
                             f"{first.summary} comes first, and the rest follow in order of what's due soonest."])
        elif first.exam:
            s1 = rng.choice([f"Your {first.summary} is {w}, so it gets the first and biggest blocks.",
                             f"{first.summary} is {w}, so I put it at the front of the plan.",
                             f"Your {first.summary} is {w}, so let's start there."])
        else:
            s1 = rng.choice([f"{first.summary} is due {w}, so that's our first stop.",
                             f"First up is {first.summary}, due {w}.",
                             f"{first.summary} is due {w}, so I'm putting it first."])
        if first.offset == 0:
            s1 = rng.choice([f"{first.summary} is due today, so the plan is short and focused.",
                             f"Today is the big day for {first.summary}, so I kept everything before it's due."])
    s2 = {
        "empty": ["I don't see any focus history yet, so I kept the sessions short and easy.",
                  "This is a fresh start, so the blocks stay gentle."],
        "low": ["Last week was pretty quiet, so I kept the plan small and doable.",
                "Your focus time was light lately, so I'm not piling on too much."],
        "sporadic": ["Last week was a bit stop-and-go, so I kept the plan small and doable.",
                     "Your focus time was light lately, so I'm not piling on too much."],
        "moderate": ["It matches the steady pace you've had lately.", "I sized the blocks to fit how you've been studying."],
        "high": ["You've been on a roll, so I gave you a bit more time each day.",
                 "Great focus lately, so I added a little extra study time."],
    }[prof]
    s2 = rng.choice(s2)
    if sc.get("_starved"):
        s2 = rng.choice(["I focused on the closest deadlines first and kept the load realistic.",
                         "There's a lot coming up, so I put the nearest ones first and kept each day doable."])
    s3 = rng.choice(["You've got this!", "I'll be cheering for you the whole way!", "One pomodoro at a time, and you'll get there.",
                     "Take your breaks too, I'll be right here.", "Bloop believes in you!",
                     f"Blocks are built from {p}-minute pomodoros with {brk}-minute breaks."])
    parts = [s1, s2] + ([s3] if rng.random() < 0.75 else [])
    return " ".join(parts)


# ----------------------------------------------------------------------------- nudges
SITES = ["youtube.com", "reddit.com", "tiktok.com", "instagram.com", "twitter.com", "x.com", "netflix.com", "twitch.tv",
         "facebook.com", "9gag.com", "buzzfeed.com", "espn.com", "pinterest.com", "amazon.com"]
APPS = ["Discord", "Steam", "Spotify", "Minecraft", "Snapchat", "WhatsApp", "Netflix", "Fortnite"]
PRE = "You are Bloop, a cute study pet. "
POST = " Write one short, kind {what} (max 60 characters)."


def mins(n: int) -> str:
    return f"{n} minute" + ("" if n == 1 else "s")


def nudge_prompt(kind: str, rng: random.Random):
    if kind == "drift":
        n = rng.choice([1, 2, 2, 3, 4, 5, 8, 10, 15])
        if rng.random() < 0.7:
            site = rng.choice(SITES)
            body = f"The student has been on {site} for {mins(n)} during a focus session."
            ctx = site
        else:
            app = rng.choice(APPS)
            body = f"The student has been using {app} for {mins(n)} during a focus session."
            ctx = app.lower()
        return PRE + body + POST.format(what="nudge"), ctx
    if kind == "welcome":
        n = rng.choice([1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20, 25])
        return PRE + f"The student just came back to their study app after {mins(n)} away." + POST.format(what="welcome-back nudge"), ""
    if kind == "break":
        f, b = (rng.choice([20, 25, 30, 35, 40, 45, 50, 60]), rng.choice([5, 5, 10, 15]))
        return PRE + f"The student just finished a {f}-minute focus block and a {b}-minute break is starting." + \
            POST.format(what="break-time nudge"), ""
    if kind == "back":
        f, b = (rng.choice([20, 25, 30, 35, 40, 45, 50, 60]), rng.choice([5, 5, 10, 15]))
        return PRE + f"The student's {b}-minute break is over and the next {f}-minute focus block is starting." + \
            POST.format(what="back-to-work nudge"), ""
    f = rng.choice([25, 30, 45, 50])
    k = rng.randint(1, 6)
    return PRE + f"The student just finished a focus session of {f * k} minutes ({k} pomodoros)." + \
        POST.format(what="session-complete nudge"), ""


def emoji_count(s: str) -> int:
    return sum(1 for ch in s if ord(ch) >= 0x1F000 or 0x2600 <= ord(ch) <= 0x27BF or 0x2B00 <= ord(ch) <= 0x2BFF)


def check_pool():
    allines = [l for v in POOL.values() for l in v] + [l for v in DRIFT_SITE.values() for l in v]
    assert len(allines) >= 150 and len(set(allines)) == len(allines), "pool must hold >=150 distinct lines"
    for l in allines:
        assert 0 < len(l) <= 60, (len(l), l)
        assert l == l.lower(), l
        assert emoji_count(l) <= 1, l
        assert "\n" not in l


def build_nudges(split: str, rng: random.Random, seen: set[str]):
    rows = []
    for kind, count in NUDGE_MIX[split].items():
        pool = list(POOL[kind])
        lines = pool[-EVAL_HOLDOUT:] if split == "eval" else pool[:-EVAL_HOLDOUT]
        rng.shuffle(lines)
        site_lines = {k: list(v) for k, v in DRIFT_SITE.items()} if (kind == "drift" and split == "train") else {}
        for _ in range(count):
            for _try in range(500):
                prompt, ctx = nudge_prompt(kind, rng)
                if prompt not in seen:
                    break
            else:
                raise RuntimeError("could not generate a unique nudge prompt")
            matches = [k for k in site_lines if k in ctx and site_lines[k]]
            if matches and rng.random() < 0.7:
                line = site_lines[matches[0]].pop(0)
            else:
                line = lines.pop(0)  # each line is used at most once per split
            seen.add(prompt)
            rows.append(("nudge", prompt, line))
    return rows


# ----------------------------------------------------------------------------- main
def build_split(split: str, seed_off: int, seen: set[str]):
    rng = random.Random(SEED + seed_off)
    n_plan, n_rob, n_nud = MIX[split]
    kinds = ["normal"] * n_plan
    rob = ["empty_nodl", "today", "crunch", "far", "nohist"]
    kinds += [rob[i % len(rob)] for i in range(n_rob)]
    rng.shuffle(kinds)
    rows, dow_i = [], rng.randint(0, 6)
    pending = []
    attempts = 0
    for kind in kinds:
        while True:
            attempts += 1
            sc = gen_scenario(rng, kind, dow_i % 7)
            plan = plan_scenario(sc, rng)
            if plan is None:
                continue
            if est_tokens(py_prompt(sc)) + est_tokens(json.dumps(plan, ensure_ascii=False)) > TOKEN_CAP:
                continue
            sc["_plan"] = plan
            pending.append(sc)
            dow_i += 1
            break
    prompts = node_render(pending)
    for sc, prompt in zip(pending, prompts):
        py = py_prompt(sc)
        assert py == prompt, f"python/node prompt mismatch:\n{py}\n----\n{prompt}"
        target = json.dumps(sc["_plan"], ensure_ascii=False)
        res = S.score_plan(target, prompt)
        if not (res["clean_json"] and res["schema_valid"] and res["all_rules"]) or prompt in seen:
            # planner bug or duplicate prompt: surface loudly rather than silently dropping
            raise RuntimeError(f"generated plan failed scoring ({sc['kind']}): {res}\n{target}")
        seen.add(prompt)
        rows.append((sc["kind"], prompt, target))
    rows += build_nudges(split, rng, seen)
    rng.shuffle(rows)
    return rows, attempts


def main():
    check_pool()
    seen: set[str] = set()
    train, _ = build_split("train", 1, seen)
    seen_train = set(seen)
    evalr, _ = build_split("eval", 2, seen)
    assert not (seen_train & {p for _, p, _ in evalr}), "eval prompt duplicates a train prompt"
    for name, rows in (("train", train), ("eval", evalr)):
        with open(HERE / f"{name}.jsonl", "w", encoding="utf-8") as f:
            for _, prompt, target in rows:
                f.write(json.dumps({"messages": [{"role": "user", "content": prompt},
                                                 {"role": "assistant", "content": target}]}, ensure_ascii=False) + "\n")
    print(f"wrote {len(train)} train and {len(evalr)} eval rows to {HERE}")


if __name__ == "__main__":
    main()
