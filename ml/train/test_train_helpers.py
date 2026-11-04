import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import train_lora as T  # noqa: E402  (imports fine without torch)


class Helpers(unittest.TestCase):
    def test_lr_schedule(self):
        lrs = [T.lr_at(s, 100, 2e-4, 5) for s in range(100)]
        self.assertAlmostEqual(lrs[0], 2e-4 / 5)
        self.assertAlmostEqual(lrs[4], 2e-4)
        self.assertTrue(all(a >= b - 1e-12 for a, b in zip(lrs[5:], lrs[6:])))
        self.assertGreaterEqual(min(lrs), 2e-5 - 1e-12)
        self.assertAlmostEqual(T.lr_at(100, 100, 2e-4, 5), 2e-5)

    def test_split(self):
        steps = T.split_batches(list(range(19)), 1, 8)
        self.assertEqual([len(s) for s in steps], [8, 8, 3])
        steps = T.split_batches(list(range(10)), 2, 2)
        self.assertEqual([[len(m) for m in s] for s in steps], [[2, 2], [2, 2], [2]])

    def test_eta_and_fmt(self):
        self.assertAlmostEqual(T.estimate_eta(1.0, 100, 30, 2, 1), 200 + 20)
        self.assertEqual(T.fmt_duration(3725), "1h 02m")
        self.assertEqual(T.fmt_duration(65), "1m 05s")
        self.assertEqual(T.fmt_duration(4), "4s")


if __name__ == "__main__":
    unittest.main()
