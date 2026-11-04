import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import eval as E  # noqa: E402  (stdlib only)


def fake_result(name):
    plans = {"n": 2, "parse_rate": 1.0, "clean_json_rate": 0.5, "schema_valid_rate": 1.0, "blocks_3_10": 1.0,
             "hours_ok": 1.0, "before_deadline": None, "pomodoro_ok": 0.5, "all_rules": 0.5}
    mode = {"plans": plans, "plan_samples": []}
    return {"gguf": f"{name}.gguf", "size_bytes": 5e8, "modes": {"free": mode, "grammar": mode},
            "nudges": {"n": 2, "le60_rate": 1.0, "single_line_rate": 1.0, "samples": []}, "avg_latency_s": 1.0}


class VariantTests(unittest.TestCase):
    PATHS = {"base": "b.gguf", "mit-edit": "m.gguf", "tuned": "t.gguf", "tuned+edit": "te.gguf"}

    def test_default_is_base_and_tuned(self):
        present, missing = E.select_variants(self.PATHS, exists=lambda p: p in ("b.gguf", "t.gguf"))
        self.assertEqual(present, [("base", "b.gguf"), ("tuned", "t.gguf")])
        self.assertEqual([n for n, _ in missing], ["mit-edit", "tuned+edit"])

    def test_all_four_in_order_and_skip(self):
        shuffled = dict(reversed(list(self.PATHS.items())))
        present, _ = E.select_variants(shuffled, exists=lambda p: True)
        self.assertEqual([n for n, _ in present], ["base", "mit-edit", "tuned", "tuned+edit"])
        present, _ = E.select_variants(self.PATHS, exists=lambda p: True, skip=("base", "mit-edit"))
        self.assertEqual([n for n, _ in present], ["tuned", "tuned+edit"])

    def test_table_columns(self):
        res = {n: fake_result(n) for n in ("tuned", "base", "tuned+edit")}
        self.assertEqual(E.present_variants(res), ["base", "tuned", "tuned+edit"])
        head = E.table(res).splitlines()[0]
        self.assertEqual(head.count("/ free"), 3)
        self.assertLess(head.index("base / free"), head.index("tuned / free"))
        self.assertLess(head.index("tuned / grammar"), head.index("tuned+edit / free"))


if __name__ == "__main__":
    unittest.main()
