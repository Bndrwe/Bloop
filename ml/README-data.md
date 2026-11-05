# Bloop SFT dataset

`ml/data/train.jsonl` (240 rows) and `ml/data/eval.jsonl` (30 rows). One JSON object per line:
`{"messages":[{"role":"user","content":...},{"role":"assistant","content":...}]}`. No system prompt (the app sends none).
`ml/data/READY` is written by `validate.py` only when everything passes; `ml/run_mac.sh` checks for it.

## Task mix

| Task | train | eval | share |
|---|---|---|---|
| Study plan (normal scenarios, 0-5 deadlines) | 168 | 21 | ~70% |
| Study plan, robustness (no history + no deadlines, deadlines today, 5-deadline crunch, only far deadlines, no history + deadlines) | 24 | 3 | ~10% |
| Nudges (drift 14/2, welcome-back 9/1, break 9/1, back-to-work 8/1, session-done 8/1) | 48 | 6 | ~20% |

Plans cover every weekday as "today" (round-robin), 6 time zones, pomodoro settings 25/5, 50/10, 30/5 and 45/15, 14 courses,
exam and assignment mixes, empty/low/sporadic/moderate/high focus histories, and morning/afternoon/evening habits.
The prompt carries no explicit habit-time info, so chronotype is tied to the clock in "Today is ..." (early now -> morning blocks, late now -> evening blocks).

## Study plan format

User message: **byte-identical output of `buildPrompt()` in `src/main/plan.ts`**. `ml/data/render_prompts.cjs` extracts `DAY_NAMES` + `buildPrompt`
from the live source, transpiles it with the repo's esbuild and runs it under `TZ=<scenario tz>`. `build_dataset.py` also re-implements the template
and `Date.toString()` in Python and asserts that every one of the 216 plan prompts matches the node output exactly.
If you change the wording in `plan.ts`, just rebuild.

Assistant message: only the JSON `{"summary": "...", "blocks": [{"day":0-6,"time":"HH:MM","minutes":n,"label":"..."}]}` (no fences, `json.dumps` default separators).
Planner rules (all checked by `scoring.py` plus extra checks in `validate.py`):

- 3-6 blocks in the data (limit is 3-10; long prompts + long answers are capped, see below), listed chronologically; times between 08:00 and 22:00 and every block ends by 22:00.
- Blocks sit only on days up to the farthest in-window deadline, studying for a deadline on the days before its due day (a block on the due day only if it ends before the due time: 60 min before for exams, 30 for assignments). Blocks never start before "now" on day 0.
- Exams count 3 days "closer" than assignments in priority; the nearest/top two items get most of their demand first.
- Daily load is `1.3 x mean focused min of the last 6 days`, clamped to [1 pomodoro, 210 min], so a quiet week gets a small plan.
- `minutes` are exact multiples of the pomodoro length.
- Summary: 2-3 short warm sentences naming the first priority, its weekday (or today/tomorrow), and the pacing reasoning.

## Nudge format

Note: today the app only calls the model for the study plan (`generateText` in `src/main/plan.ts`). The in-app pet nudges are fixed lines in `src/main/session.ts`, not model output, so these nudge prompts are a training/eval task for the model, not text the app currently sends.

User message (exact; `{...}` are filled, singular "1 minute"):

```
You are Bloop, a cute study pet. The student has been on {site} for {n} minute(s) during a focus session. Write one short, kind nudge (max 60 characters).
You are Bloop, a cute study pet. The student has been using {App} for {n} minute(s) during a focus session. Write one short, kind nudge (max 60 characters).
You are Bloop, a cute study pet. The student just came back to their study app after {n} minute(s) away. Write one short, kind welcome-back nudge (max 60 characters).
You are Bloop, a cute study pet. The student just finished a {f}-minute focus block and a {b}-minute break is starting. Write one short, kind break-time nudge (max 60 characters).
You are Bloop, a cute study pet. The student's {b}-minute break is over and the next {f}-minute focus block is starting. Write one short, kind back-to-work nudge (max 60 characters).
You are Bloop, a cute study pet. The student just finished a focus session of {m} minutes ({k} pomodoros). Write one short, kind session-complete nudge (max 60 characters).
```

None contains "study plan", so `scoring.is_plan_prompt` classifies them as nudges (scored on length <= 60, one line).
Assistant message: a single lowercase-casual line, <= 60 chars, at most one emoji. The hand-written pool is in `ml/data/nudge_lines.py`
(171 distinct lines: drift 32 generic + 18 site/app specific, welcome 32, break 29, back 30, done 30). The last 3 lines of each generic pool are
held out for eval only, so no eval target appears in train. Each line is used at most once per split.

## Regenerate / validate

```
python3 ml/data/build_dataset.py     # needs node + the repo's node_modules/esbuild; fixed seed 20261104; output is deterministic
python3 ml/data/validate.py          # scoring.py over every row; writes ml/data/READY only on a clean pass
```

`validate.py` checks: exact message schema, no duplicate prompts, no train/eval prompt or nudge-target overlap, and for plans `parsed`, `clean_json`,
`schema_valid`, `blocks_3_10`, `hours_ok`, `before_deadline`, `pomodoro_ok`, `all_rules` all 100% (before_deadline is n/a when no deadline falls in the next 7 days; applicable to
~75% of plans), plus summary sentence count, no overlaps, chronological order, nothing in the past today and nothing after a same-day due time; for nudges `le60`, one line, lowercase, <= 1 emoji, documented format.
It prints token stats (chars/3.5 and a digit-aware proxy).

## Notes for the trainer

- Token length: plans are digit-heavy (Qwen splits digits), so chars/3.5 underestimates. The generator caps prompt+answer at 900 on the digit-aware proxy, which is why no
  plan has more than 6 blocks; the default `--max-len 1024` should drop nothing. The tokenizer was not available here, so confirm with the `[data]` lines train_lora.py prints.
- Dates are in 2026-2027 and the time zones are US/UK/UTC; `Date.toString()` text is part of the prompt, so the model sees the real format.
- 240 rows is small. The plans are rule-based, so expect the model to learn the format and the rules well but write fairly templated summaries/labels.
- Unused pool lines (about 120 of 171 are not used in these 54 nudge rows) are there for adding more nudge rows: raise `NUDGE_MIX` and `MIX` in `build_dataset.py`.
