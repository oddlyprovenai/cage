"""On-chain study: rules using yesterday's data, disjoint holdout segment, and adoption criteria (offline)."""
from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from trading import onchain as O  # noqa: E402


def frame(n=2400):
    import datetime as dt
    d0 = dt.date(2017, 6, 1)
    days = [(d0 + dt.timedelta(days=i)).isoformat() for i in range(n)]
    px = [100 * math.exp(0.0006 * i + 0.05 * math.sin(i / 17)) for i in range(n)]
    return {"days": days, "px": px, "tx": [1000 + i for i in range(n)], "fee": [10 + (i % 50) for i in range(n)],
            "vol": [5e6 + 1e4 * math.sin(i / 9) for i in range(n)], "cdd": [1e5 for _ in range(n)]}


def test_rules_use_yesterday_and_segments_are_disjoint():
    f = frame()
    seen = []
    O.run_rule(f, lambda fr, i: seen.append(i) or 1.0, *O.RESERVED)
    lo = f["days"].index(O.RESERVED[0])
    hi = f["days"].index(O.RESERVED[1])
    assert seen[0] == lo - 1 and seen[-1] == hi - 1  # signal for day d uses d-1
    dev = O.run_rule(f, None, O.DEV[0], O.DEV[1])
    res = O.run_rule(f, None, *O.RESERVED)
    assert len(dev) + len(res) <= len(f["days"])  # non-overlapping
    assert O.RESERVED[1] < O.DEV[0]


def test_all_variants_run_and_costs_apply():
    f = frame()
    for name, rule in O.VARIANTS.items():
        r = O.run_rule(f, rule, O.DEV[0], None)
        assert len(r) > 300, name
    flip = lambda fr, i: 0.5 if i % 2 else 1.0  # noqa: E731
    assert sum(O.run_rule(f, flip, O.DEV[0], None)) < sum(O.run_rule(f, lambda fr, i: 0.75, O.DEV[0], None)) + 1  # costs apply
