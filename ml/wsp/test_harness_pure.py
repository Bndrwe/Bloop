"""Stdlib-only tests for the pure parts of the weight-space harness (no torch needed).

    python -m unittest discover -s ml/wsp
"""
import json
import random
import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import wsp_core as C  # noqa: E402
import harness  # noqa: E402,F401  (must import without torch)
import presets  # noqa: E402,F401
import apply_patch as AP  # noqa: E402

PLAN_PROMPT = """You are a friendly study coach inside a desktop "study pet" app for a university student.
Today is Monday Mon Nov 09 2026 10:00:00 GMT+0000.

Upcoming deadlines:
- Calculus (EXAM): Thu Nov 12 2026 09:00:00 GMT+0000

Focus history for the last 7 days (score 0-100 = share of time on study apps/sites):
- 2026-11-08: 2 sessions, 50 focused min, avg score 80

The student uses 25-minute pomodoros with 5-minute breaks.

Create a realistic study plan for the next 7 days. Use 3-10 blocks.
Reply with ONLY a JSON object, no markdown fences, in exactly this shape:
{"summary": "...", "blocks": [{"day": 1, "time": "HH:MM", "minutes": 25, "label": "x"}]}"""

GOOD_PLAN = json.dumps({"summary": "Focus on calculus first.", "blocks": [
    {"day": 1, "time": "10:00", "minutes": 50, "label": "Calc limits"},
    {"day": 2, "time": "10:00", "minutes": 50, "label": "Calc derivatives"},
    {"day": 3, "time": "18:00", "minutes": 25, "label": "Calc review"}]})


def rows(n_plan=5, n_nudge=5):
    out = []
    for i in range(n_plan):
        out.append({"messages": [{"role": "user", "content": PLAN_PROMPT}, {"role": "assistant", "content": GOOD_PLAN}]})
    for i in range(n_nudge):
        out.append({"messages": [{"role": "system", "content": "be kind"},
                                 {"role": "user", "content": f"Write a nudge #{i}"},
                                 {"role": "assistant", "content": "Back to it!"}]})
    return out


def matmul_vec_left(u, W):  # u^T W
    return [sum(u[i] * W[i][j] for i in range(len(W))) for j in range(len(W[0]))]


def close(a, b, tol=1e-9):
    return abs(a - b) <= tol


class BudgetTests(unittest.TestCase):
    def test_costs(self):
        b = C.Budget(10)
        self.assertEqual(b.cost("generate", 1), 1)
        self.assertEqual(b.cost("generate", 64), 1)
        self.assertEqual(b.cost("generate", 65), 2)
        self.assertEqual(b.cost("activations", 128), 1)
        self.assertEqual(b.cost("activations", 129), 2)
        self.assertEqual(b.cost("generate", 0), 0)
        with self.assertRaises(ValueError):
            b.cost("train", 1)

    def test_charge_and_refuse(self):
        b = C.Budget(3)
        self.assertEqual(b.charge("generate", 100, "x"), 2)
        self.assertEqual(b.remaining, 1)
        with self.assertRaises(C.BudgetExceeded):
            b.charge("generate", 65)  # needs 2, has 1: refused whole, nothing charged
        self.assertEqual(b.remaining, 1)
        b.charge("activations", 128)
        self.assertEqual(b.remaining, 0)
        with self.assertRaises(C.BudgetExceeded):
            b.charge("activations", 1)
        self.assertEqual(len(b.log), 2)
        self.assertEqual(b.to_json()["used"], 3)

    def test_custom_sizes(self):
        b = C.Budget(5, gen_per_pass=512, act_per_pass=1024)  # MIT's definition
        self.assertEqual(b.cost("generate", 512), 1)
        self.assertEqual(b.cost("activations", 1025), 2)


class SplitTests(unittest.TestCase):
    def test_dev_deterministic_and_test_locked(self):
        r = rows(20, 20)
        a, b = C.Splits(r, rows(2, 2), dev_size=8, seed=3), C.Splits(r, rows(2, 2), dev_size=8, seed=3)
        self.assertEqual(a.dev_idx, b.dev_idx)
        self.assertEqual(len(a.dev), 8)
        self.assertNotEqual(a.dev_idx, C.Splits(r, [], dev_size=8, seed=4).dev_idx)
        with self.assertRaises(C.LockedSplitError):
            a.get("test")
        t = a.take_test()
        self.assertEqual(len(t), 4)
        self.assertTrue(all(x["id"].startswith("test:") for x in t))
        with self.assertRaises(C.LockedSplitError):
            a.take_test()
        with self.assertRaises(KeyError):
            a.get("train")

    def test_items(self):
        items = C.rows_to_items(rows(1, 1), "dev")
        self.assertEqual(items[0]["kind"], "plan")
        self.assertEqual(items[1]["kind"], "nudge")
        self.assertEqual(items[1]["messages"][-1]["role"], "user")  # assistant answer stripped
        self.assertEqual(items[1]["reference"], "Back to it!")

    def test_take_items_interleaves(self):
        items = C.rows_to_items(rows(5, 3), "dev")
        got = C.take_items(items, 4)
        self.assertEqual([g["kind"] for g in got], ["plan", "nudge", "plan", "nudge"])
        self.assertEqual(len(C.take_items(items, None, kind="plan")), 5)
        self.assertEqual(len(C.take_items(items, 100)), 8)
        self.assertEqual(C.take_items(items, 2, offset=2), got[2:4])

    def test_normalize_prompts(self):
        items = C.normalize_prompt_items(["hello", [{"role": "user", "content": PLAN_PROMPT}], rows(0, 1)[0]])
        self.assertEqual([i["kind"] for i in items], ["nudge", "plan", "nudge"])
        again = C.normalize_prompt_items([{"item": items[1], "text": "x"}])
        self.assertIs(again[0], items[1])
        with self.assertRaises(TypeError):
            C.normalize_prompt_items([42])

    def test_load_splits_missing_dir(self):
        sp = C.load_splits(Path("/nonexistent/wsp"), 8, 0)
        self.assertEqual(sp.dev, [])
        self.assertTrue(any("READY" in w for w in sp.warnings))


class ScoringGlueTests(unittest.TestCase):
    def test_repeat_and_loop(self):
        self.assertEqual(C.repeated_ngram_ratio("a b c d e f g"), 0.0)
        loop = "I will study now. " * 40
        self.assertGreater(C.repeated_ngram_ratio(loop), 0.8)
        self.assertTrue(C.is_looping(loop))
        self.assertFalse(C.is_looping("short text"))
        self.assertTrue(C.leaked_think("<think>hmm</think>{}"))

    def test_trim_at_eos(self):
        self.assertEqual(C.trim_at_eos([5, 6, 2, 0, 0], [2], 5), (2, False))
        self.assertEqual(C.trim_at_eos([5, 6, 7], [2], 3), (3, True))
        self.assertEqual(C.trim_at_eos([5, 6], [2], 3), (2, False))

    def test_score(self):
        items = C.rows_to_items(rows(1, 2), "dev")
        outs = [GOOD_PLAN, "Back to it!", {"text": "x " * 80, "hit_limit": True, "n_new_tokens": 512}]
        r = C.score(outs, items)
        per = r["per_example"]
        self.assertTrue(per[0]["ok"])
        self.assertTrue(per[0]["detail"]["schema_valid"])
        self.assertTrue(per[1]["ok"])
        self.assertFalse(per[2]["ok"])  # > 60 chars
        m = r["metrics"]
        self.assertEqual((m["n"], m["n_plan"], m["n_nudge"]), (3, 1, 2))
        self.assertAlmostEqual(m["primary"], 2 / 3)
        self.assertEqual(m["hit_limit_rate"], 1.0)  # only one example reports hit_limit
        self.assertEqual(m["plans"]["schema_valid_rate"], 1.0)
        self.assertIn("primary=67%", C.fmt_metrics(m))
        with self.assertRaises(ValueError):
            C.score(["a"], items)

    def test_generation_helpers(self):
        items = C.rows_to_items(rows(1, 1), "dev")
        sc = C.score([GOOD_PLAN, "word " * 80], items)
        outs = [{"id": it["id"], "kind": it["kind"], "prompt": it["prompt"], "prompt_text": "P", "text": t,
                 "score": s, "item": it} for it, t, s in zip(items, [GOOD_PLAN, "word " * 80], sc["per_example"])]
        g = C.Generation(outs, sc["metrics"], "dev")
        self.assertEqual(len(g.loopers()), 1)
        self.assertEqual(len(g.finished()), 1)
        self.assertEqual(len(g.failures()), 1)
        self.assertNotIn("item", json.dumps(g.to_json()))
        self.assertIn("primary", compare := C.compare_table({"a": g.metrics, "b": g.metrics}))
        self.assertIn("| metric | a | b |", compare)


class ProjectionMathTests(unittest.TestCase):
    def setUp(self):
        rng = random.Random(1)
        self.out_dim, self.in_dim = 6, 9  # down_proj layout: [hidden(out), intermediate(in)]
        self.W = [[rng.uniform(-1, 1) for _ in range(self.in_dim)] for _ in range(self.out_dim)]
        self.d = [rng.uniform(-1, 1) for _ in range(self.out_dim)]
        self.u = C.normalize(self.d)

    def orth(self, seed):
        """A random vector orthogonal to d."""
        rng = random.Random(seed)
        v = [rng.uniform(-1, 1) for _ in range(self.out_dim)]
        c = sum(a * b for a, b in zip(v, self.u))
        return [a - c * b for a, b in zip(v, self.u)]

    def test_neuron_columns_removes_component(self):
        cols = [1, 4, 7]
        W2 = C.project_out_py(self.W, self.d, cols, 1.0, "neuron_columns")
        dW2 = matmul_vec_left(self.u, W2)
        dW = matmul_vec_left(self.u, self.W)
        for j in range(self.in_dim):
            if j in cols:
                self.assertTrue(close(dW2[j], 0.0, 1e-12), j)  # d-component removed from selected columns
            else:
                self.assertTrue(close(dW2[j], dW[j]), j)
                self.assertEqual([r[j] for r in W2], [r[j] for r in self.W])  # other columns untouched exactly
        for s in range(3):  # anything orthogonal to d reads the same: v^T W' = v^T W
            v = self.orth(s)
            for a, b in zip(matmul_vec_left(v, W2), matmul_vec_left(v, self.W)):
                self.assertTrue(close(a, b, 1e-12))

    def test_output_orthogonal_part_unchanged(self):
        """For any input x, W'x differs from Wx only along d."""
        W2 = C.project_out_py(self.W, self.d, [0, 2, 3], 1.0, "neuron_columns")
        x = [random.Random(9).uniform(-1, 1) for _ in range(self.in_dim)]
        y = [sum(r[j] * x[j] for j in range(self.in_dim)) for r in self.W]
        y2 = [sum(r[j] * x[j] for j in range(self.in_dim)) for r in W2]
        diff = [a - b for a, b in zip(y2, y)]
        c = sum(a * b for a, b in zip(diff, self.u))
        resid = [a - c * b for a, b in zip(diff, self.u)]
        self.assertTrue(all(abs(r) < 1e-12 for r in resid))

    def test_strength_and_normalisation(self):
        cols = [0, 5]
        half = C.project_out_py(self.W, self.d, cols, 0.5, "neuron_columns")
        flip = C.project_out_py(self.W, [3 * x for x in self.d], cols, 2.0, "neuron_columns")  # scale of d irrelevant
        dW = matmul_vec_left(self.u, self.W)
        for j in cols:
            self.assertTrue(close(matmul_vec_left(self.u, half)[j], 0.5 * dW[j], 1e-12))
            self.assertTrue(close(matmul_vec_left(self.u, flip)[j], -dW[j], 1e-12))

    def test_full_projection_equivalence(self):
        """idx=None in either orientation = (I - d d^T) W."""
        a = C.project_out_py(self.W, self.d, None, 1.0, "neuron_columns")
        b = C.project_out_py(self.W, self.d, None, 1.0, "hidden_rows")
        for ra, rb in zip(a, b):
            for x, y in zip(ra, rb):
                self.assertTrue(close(x, y, 1e-12))
        self.assertTrue(all(abs(v) < 1e-12 for v in matmul_vec_left(self.u, a)))

    def test_hidden_rows_only_touches_rows(self):
        rows_ = [0, 3]
        W2 = C.project_out_py(self.W, self.d, rows_, 1.0, "hidden_rows")
        for i in range(self.out_dim):
            if i not in rows_:
                self.assertEqual(W2[i], self.W[i])
        self.assertNotEqual(W2[0], self.W[0])

    def test_errors_and_topk(self):
        with self.assertRaises(ValueError):
            C.project_out_py(self.W, [1.0] * 5, None)
        with self.assertRaises(ValueError):
            C.project_out_py(self.W, [0.0] * 6, None)
        with self.assertRaises(ValueError):
            C.project_out_py(self.W, self.d, None, 1.0, "rows")
        self.assertEqual(C.top_k_indices([0.1, -5, 3, 3], 3), [1, 2, 3])

    def test_mit_count(self):
        """64 columns x hidden 1024 x 2 layers = 131,072 = MIT's reported count (the default orientation)."""
        self.assertEqual(64 * 1024 * 2, 131072)
        self.assertAlmostEqual(131072 / 0.8e9 * 100, 0.016, places=3)


class GuardrailTests(unittest.TestCase):
    def test_cap(self):
        total = 800_000_000
        ok, frac = C.check_change_cap({"a": 65536, "b": 65536}, total, 0.001)
        self.assertTrue(ok)
        self.assertAlmostEqual(frac, 131072 / total)
        ok, _ = C.check_change_cap({"a": 800_001}, total, 0.001)
        self.assertFalse(ok)
        self.assertTrue(C.check_change_cap({"a": 800_000}, total, 0.001)[0])  # exactly at the cap is allowed
        self.assertEqual(C.changed_fraction({}, 0), 0.0)

    def test_protected(self):
        P = C.is_protected
        self.assertTrue(P("model.language_model.embed_tokens.weight"))
        self.assertTrue(P("lm_head.weight"))
        self.assertTrue(P("model.visual.blocks.0.attn.qkv.weight"))
        self.assertTrue(P("mtp.layers.0.mlp.down_proj.weight"))
        self.assertFalse(P("model.language_model.layers.15.mlp.down_proj.weight"))
        self.assertFalse(P("model.language_model.layers.3.mlp.down_proj.weight", ()))


class EditLogTests(unittest.TestCase):
    def test_log_and_revert(self):
        log = C.EditLog()
        a = log.add("subtract_direction", "t1", {"k": 64}, "h0", "h1", 65536, "first")
        b = log.add("scale", "t2", {"factor": 0.5}, "h2", "h3", 10)
        self.assertEqual((a, b), ("e1", "e2"))
        self.assertEqual(log.active_ids(), ["e1", "e2"])
        log.mark_reverted("e1")
        self.assertEqual(log.active_ids(), ["e2"])
        with self.assertRaises(C.WSPError):
            log.mark_reverted("e1")
        with self.assertRaises(KeyError):
            log.get("e9")
        j = log.to_json()
        self.assertEqual(j[0]["status"], "reverted")
        self.assertEqual(j[0]["before_sha256"], "h0")
        j[1]["status"] = "hacked"  # to_json is a copy
        self.assertEqual(log.get("e2")["status"], "active")

    def test_replay_semantics(self):
        """Revert replays the remaining edits from the originals (mirrors Workspace._replay)."""
        orig = {"t": [1.0, 2.0, 3.0]}
        ops = {"scale": lambda v, p: [x * p["f"] for x in v], "add": lambda v, p: [x + p["a"] for x in v]}
        log = C.EditLog()
        log.add("scale", "t", {"f": 2.0}, "", "", 3)
        log.add("add", "t", {"a": 1.0}, "", "", 3)

        def replay():
            cur = {k: list(v) for k, v in orig.items()}
            for e in log.active():
                cur[e["tensor"]] = ops[e["op"]](cur[e["tensor"]], e["params"])
            return cur

        self.assertEqual(replay()["t"], [3.0, 5.0, 7.0])
        log.mark_reverted("e1")
        self.assertEqual(replay()["t"], [2.0, 3.0, 4.0])

    def test_notes_append_only(self):
        n = C.Notes()
        n.add("hypothesis: loops come from L15", 40)
        items = n.items
        self.assertIsInstance(items, tuple)
        items[0]["text"] = "changed"
        self.assertEqual(n.items[0]["text"], "hypothesis: loops come from L15")
        self.assertFalse(hasattr(n, "remove"))

    def test_index_json_roundtrip(self):
        for idx in (None, Ellipsis, 3, slice(None, 10, 2), [1, 5, 9], (slice(None), [5, 9]), range(3)):
            j = C.index_to_json(idx)
            json.dumps(j)
            back = C.index_from_json(j)
            self.assertEqual(back, list(idx) if isinstance(idx, range) else idx)
        with self.assertRaises(TypeError):
            C.index_to_json(True)

    def test_report(self):
        st = {"model": "m", "saved_at": "now", "budget": C.Budget(50).to_json(), "edits": [], "diff": {},
              "metrics_history": [], "final_test": None, "notes": []}
        md = C.render_report(st)
        self.assertIn("0/50 forward passes used", md)
        self.assertIn("Not run.", md)


class NamesAndPatchTests(unittest.TestCase):
    MODS = ["", "model", "model.visual.blocks.0", "model.language_model", "model.language_model.layers.0",
            "model.language_model.layers.1", "model.language_model.layers.1.mlp", "model.visual.blocks",
            "mtp.layers.0", "model.language_model.norm"]

    def test_find_layers(self):
        got = C.find_decoder_layers(self.MODS)
        self.assertEqual(got, {0: "model.language_model.layers.0", 1: "model.language_model.layers.1"})
        self.assertEqual(C.find_decoder_layers(["model.layers.0", "model.layers.1"]), {0: "model.layers.0", 1: "model.layers.1"})
        self.assertEqual(C.final_norm_name(got[0]), "model.language_model.norm")

    def test_match_param(self):
        mit = C.MIT_KEY.format(15)
        names = ["model.layers.15.mlp.down_proj.weight", "model.layers.5.mlp.down_proj.weight",
                 "mtp.layers.15.mlp.down_proj.weight"]
        self.assertEqual(C.match_param_name(mit, names), "model.layers.15.mlp.down_proj.weight")
        self.assertEqual(C.match_param_name(mit, [mit, "x"]), mit)
        self.assertIsNone(C.match_param_name(mit, ["model.layers.16.mlp.down_proj.weight"]))
        self.assertEqual(AP.plan_targets([mit], names), {mit: names[0]})
        with self.assertRaises(SystemExit):
            AP.plan_targets(["layers.99.mlp.down_proj.weight"], names)

    def test_safetensors_header(self):
        header = {"a": {"dtype": "BF16", "shape": [2, 2], "data_offsets": [0, 8]},
                  "b": {"dtype": "F32", "shape": [1], "data_offsets": [8, 12]}, "__metadata__": {"format": "pt"}}
        hb = json.dumps(header).encode()
        blob = struct.pack("<Q", len(hb)) + hb + bytes(range(12))
        n, h = C.parse_safetensors_header(blob)
        self.assertEqual(n, len(hb))
        a0, a1 = C.tensor_byte_range(h, n, "b")
        self.assertEqual(blob[a0:a1], bytes([8, 9, 10, 11]))
        with self.assertRaises(ValueError):
            C.parse_safetensors_header(blob[:10])

    def test_patch_metadata(self):
        entries = {"model.language_model.layers.15.mlp.down_proj.weight": {
            "shape": [1024, 3584], "dtype": "bfloat16", "before_sha256": "aa", "after_sha256": "bb", "changed": 65536}}
        meta = C.build_patch_metadata("ml/out/merged", entries, {"edits": ["e1"], "total_params": 10})
        self.assertTrue(all(isinstance(k, str) and isinstance(v, str) for k, v in meta.items()))
        p = C.parse_patch_metadata(meta)
        self.assertEqual(p["tensors"], list(entries))
        self.assertEqual(p["entries"], entries)
        self.assertEqual(json.loads(p["extra"]["edits"]), ["e1"])
        with self.assertRaises(ValueError):
            C.parse_patch_metadata({"format": "other"})
        self.assertTrue(C.is_delta_key(C.delta_key("x")))

    def test_cohens_d_rank(self):
        self.assertGreater(C.cohens_d([0, 0.1, -0.1], [1, 1.1, 0.9]), 5)
        self.assertEqual(C.cohens_d([1], [2]), 0.0)
        self.assertEqual(C.rank_layers({3: 0.5, 15: 2.0, 19: 1.5}), [(15, 2.0), (19, 1.5), (3, 0.5)])
        a, b = C.split_halves(9, 0)
        self.assertEqual(sorted(a + b), list(range(9)))
        self.assertEqual(C.split_halves(9, 0), (a, b))

    def test_resolve_model_ref(self):
        self.assertEqual(C.resolve_model_ref("Qwen/Qwen3.5-0.8B"), "Qwen/Qwen3.5-0.8B")
        self.assertEqual(C.resolve_model_ref("mit"), C.MIT_REPO)
        with self.assertRaises(FileNotFoundError):
            C.resolve_model_ref("ml/out/does-not-exist")


if __name__ == "__main__":
    unittest.main()
