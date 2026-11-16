"""Round 3: signal uses strictly YESTERDAY's data and excess is measured vs buy and hold."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from trading import round3  # noqa: E402


def frame(px):
    days = [f"2020-{1 + i // 28:02d}-{1 + i % 28:02d}" for i in range(len(px))]
    return {"days": days, "px": px}


def test_signal_never_sees_today():
    px = [100.0] * 210 + [100.0 * (1.1 if i % 2 else 0.9) for i in range(100)]
    f = frame(px)
    seen = []
    round3.backtest(f, lambda fr, i: seen.append(i) or 1.0, 0.0)
    assert all(i < j for i, j in zip(seen, range(200, len(px))))  # signal index < day being traded
    assert seen == list(range(199, len(px) - 1))


def test_costs_reduce_returns():
    px = [100.0 + i for i in range(400)]
    f = frame(px)
    alt = lambda fr, i: 1.0 if i % 2 else 0.0  # noqa: E731
    assert sum(round3.backtest(f, alt, 0.001)) < sum(round3.backtest(f, alt, 0.0))
