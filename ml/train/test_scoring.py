import sys
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import scoring as S  # noqa: E402

PROMPT = """You are a friendly study coach inside a desktop "study pet" app for a university student.
Today is Wednesday Wed Nov 04 2026 10:00:00 GMT+0100 (CET).

Upcoming deadlines:
- Calculus midterm (EXAM): Mon Nov 09 2026 09:00:00 GMT+0100 (CET)
- Essay draft: Fri Nov 20 2026 23:59:00 GMT+0100 (CET)

Focus history for the last 7 days (score 0-100 = share of time on study apps/sites):
- 2026-11-03: 2 sessions, 50 focused min, avg score 80

The student uses 25-minute pomodoros with 5-minute breaks.

Create a realistic study plan for the next 7 days ... Use 3-10 blocks.
Reply with ONLY a JSON object, no markdown fences, in exactly this shape:
{"summary": "...", "blocks": [{"day": 0, "time": "HH:MM", "minutes": 25, "label": "x"}]}"""

GOOD = {"summary": "You got this!", "blocks": [
    {"day": 3, "time": "09:00", "minutes": 50, "label": "Limits"},
    {"day": 4, "time": "10:00", "minutes": 75, "label": "Derivatives"},
    {"day": 5, "time": "14:00", "minutes": 25, "label": "Practice"},
    {"day": 6, "time": "09:30", "minutes": 100, "label": "Integrals"},
    {"day": 0, "time": "15:00", "minutes": 50, "label": "Past paper"}]}


def plan(blocks, summary="ok"):
    return {"summary": summary, "blocks": blocks}


class Json(unittest.TestCase):
    def test_fenced_and_prose(self):
        self.assertEqual(S.extract_json('Sure!\n```json\n{"a": 1}\n```'), {"a": 1})
        self.assertEqual(S.extract_json('blah {"a": {"b": 2}} trailing'), {"a": {"b": 2}})

    def test_failures(self):
        self.assertIsNone(S.try_extract_json("no json here"))
        self.assertIsNone(S.try_extract_json('{"a": '))

    def test_clean(self):
        self.assertTrue(S.is_clean_json(' {"a": 1}\n'))
        self.assertFalse(S.is_clean_json('```json\n{"a": 1}\n```'))
        self.assertFalse(S.is_clean_json("[1]"))


class Schema(unittest.TestCase):
    def test_valid(self):
        self.assertTrue(S.is_schema_valid(GOOD))

    def test_invalid(self):
        self.assertFalse(S.is_schema_valid([]))
        self.assertFalse(S.is_schema_valid({"summary": "x"}))
        self.assertFalse(S.is_schema_valid(plan([{"day": 7, "time": "09:00", "minutes": 25, "label": "a"}])))
        self.assertFalse(S.is_schema_valid(plan([{"day": 1, "time": "9am", "minutes": 25, "label": "a"}])))
        self.assertFalse(S.is_schema_valid(plan([{"day": True, "time": "09:00", "minutes": 25, "label": "a"}])))
        self.assertFalse(S.is_schema_valid(plan([{"day": 1, "time": "09:00", "minutes": 0, "label": "a"}])))
        self.assertFalse(S.is_schema_valid(plan([{"day": 1, "time": "09:00", "minutes": 25, "label": ""}])))
        self.assertFalse(S.is_schema_valid(plan([], "x")))

    def test_hhmm(self):
        self.assertEqual(S.parse_hhmm("08:30"), 510)
        self.assertEqual(S.parse_hhmm("8:05"), 485)
        self.assertIsNone(S.parse_hhmm("24:00"))
        self.assertIsNone(S.parse_hhmm(900))


class Context(unittest.TestCase):
    def test_plan_prompt_detection(self):
        self.assertTrue(S.is_plan_prompt(PROMPT))
        self.assertFalse(S.is_plan_prompt("The student drifted to YouTube for 3 minutes. Write one short nudge."))

    def test_parse(self):
        c = S.parse_context(PROMPT)
        self.assertEqual(c["today"], date(2026, 11, 4))
        self.assertEqual(c["today_dow"], 3)
        self.assertEqual((c["pomodoro"], c["break"]), (25, 5))
        self.assertEqual([d["date"] for d in c["deadlines"]], [date(2026, 11, 9), date(2026, 11, 20)])
        self.assertTrue(c["deadlines"][0]["exam"])
        self.assertEqual(S.deadline_offsets(c), [5])  # only the exam is inside the 7-day window

    def test_no_deadlines(self):
        c = S.parse_context(PROMPT.replace("- Calculus midterm (EXAM): Mon Nov 09 2026 09:00:00 GMT+0100 (CET)\n- Essay draft: Fri Nov 20 2026 23:59:00 GMT+0100 (CET)", "- (no upcoming deadlines found)"))
        self.assertEqual(c["deadlines"], [])

    def test_iso_dates(self):
        self.assertEqual(S.find_date("- Quiz: 2026-11-06T09:00"), date(2026, 11, 6))


class Rules(unittest.TestCase):
    def test_block_count(self):
        self.assertTrue(S.check_block_count(GOOD))
        self.assertFalse(S.check_block_count(plan(GOOD["blocks"][:2])))
        self.assertFalse(S.check_block_count(plan(GOOD["blocks"] * 3)))

    def test_hours(self):
        self.assertTrue(S.check_hours(GOOD))
        self.assertFalse(S.check_hours(plan([{"day": 1, "time": "07:30", "minutes": 25, "label": "a"}])))
        self.assertFalse(S.check_hours(plan([{"day": 1, "time": "21:30", "minutes": 50, "label": "a"}])))
        self.assertTrue(S.check_hours(plan([{"day": 1, "time": "21:00", "minutes": 60, "label": "a"}])))  # ends 22:00 exactly

    def test_before_deadline(self):
        c = S.parse_context(PROMPT)  # today Wed(3), exam Mon(1) offset 5 -> Mon is the last allowed day
        self.assertTrue(S.check_before_deadline(GOOD, c))  # days 3,4,5,6,0 -> offsets 0..4
        late = plan([{"day": 2, "time": "09:00", "minutes": 25, "label": "a"}])  # Tuesday = offset 6 > 5
        self.assertFalse(S.check_before_deadline(late, c))
        on_day = plan([{"day": 1, "time": "09:00", "minutes": 25, "label": "a"}])  # Monday = offset 5
        self.assertTrue(S.check_before_deadline(on_day, c))
        none = S.parse_context("Today is Wednesday Wed Nov 04 2026\n\nUpcoming deadlines:\n- (no upcoming deadlines found)\n\nx")
        self.assertIsNone(S.check_before_deadline(GOOD, none))

    def test_pomodoro(self):
        for m in (25, 50, 75, 100, 52, 30, 60):
            self.assertTrue(S.minutes_ok(m, 25, 5), m)
        for m in (10, 40, 0, -5, "25"):
            self.assertFalse(S.minutes_ok(m, 25, 5), m)
        self.assertTrue(S.minutes_ok(90, 45, 10))

    def test_nudge(self):
        self.assertTrue(S.score_nudge("Hey, tiny step back to your notes?")["le60"])
        self.assertFalse(S.score_nudge("x" * 61)["le60"])
        self.assertTrue(S.score_nudge("x" * 60)["le60"])
        self.assertFalse(S.score_nudge("   ")["le60"])
        self.assertFalse(S.score_nudge("a\nb")["single_line"])


class EndToEnd(unittest.TestCase):
    def test_good_plan(self):
        import json
        r = S.score_plan(json.dumps(GOOD), PROMPT)
        self.assertTrue(r["parsed"] and r["clean_json"] and r["schema_valid"])
        self.assertTrue(r["all_rules"], r)

    def test_fenced_plan_not_clean(self):
        import json
        r = S.score_plan("```json\n" + json.dumps(GOOD) + "\n```", PROMPT)
        self.assertTrue(r["parsed"]); self.assertFalse(r["clean_json"]); self.assertTrue(r["schema_valid"])

    def test_garbage(self):
        r = S.score_plan("I cannot help", PROMPT)
        self.assertFalse(r["parsed"]); self.assertFalse(r["all_rules"] or False)

    def test_aggregate(self):
        import json
        bad = plan([{"day": 1, "time": "06:00", "minutes": 13, "label": "a"}] * 3)
        rs = [S.score_plan(json.dumps(GOOD), PROMPT), S.score_plan(json.dumps(bad), PROMPT), S.score_plan("nope", PROMPT)]
        a = S.aggregate_plans(rs)
        self.assertAlmostEqual(a["parse_rate"], 2 / 3)
        self.assertAlmostEqual(a["schema_valid_rate"], 2 / 3)
        self.assertAlmostEqual(a["hours_ok"], 0.5)
        self.assertAlmostEqual(a["pomodoro_ok"], 0.5)
        self.assertAlmostEqual(a["all_rules"], 1 / 3)
        self.assertEqual(S.pct(None), "n/a"); self.assertEqual(S.pct(0.5), "50%")

    def test_schema_constant(self):
        self.assertEqual(S.PLAN_SCHEMA["required"], ["summary", "blocks"])


if __name__ == "__main__":
    unittest.main()
