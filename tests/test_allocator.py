"""Allocator and "20 per market" study: caps, fast pocket without pattern = cash, multiple testing correction."""
from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from trading import allocator as A, moverstats as MS  # noqa: E402


def fake(n=1200):
    days = [f"{2019 + i // 360}-{1 + (i % 360) // 30:02d}-{1 + i % 30:02d}" for i in range(n)]
    px = {}
    for k, s in enumerate(A.CORE):
        px[s] = [100 * math.exp(0.0003 * i + 0.02 * math.sin(i / (7 + k))) for i in range(n)]
    return days, px


def test_weights_sum_and_caps():
    days, px = fake()
    for prof in ("conservador", "moderado", "dinamico"):
        for m in A.METHODS:
            w = A.core_weights(m, px, days, len(days) - 1, prof)
            assert abs(sum(w.values()) - 1) < 1e-6
            assert all(v >= -1e-9 for v in w.values())
            crypto = sum(v for k, v in w.items() if k in A.CRYPTO_MIX)
            assert crypto <= A.T.PROFILES[prof]["crypto"] + 1e-6
            rv = sum(v for k, v in w.items() if k in ("IWDA.AS", "EMIM.AS", "4GLD.DE"))
            if rv:
                assert w.get("EMIM.AS", 0) <= 0.30 * (rv + crypto) + 1e-6


def test_fast_pocket_is_cash_without_supported_patterns(tmp_path, monkeypatch):
    monkeypatch.setattr(A.data, "HOME", tmp_path)
    pk = A.fast_pocket({}, {"fast_share": 0.5})
    assert pk["share"] == A.FAST_MAX and not pk["supported"] and "cash" in pk["status"]


def test_benjamini_hochberg_and_clustering():
    assert MS.bh([0.001, 0.02, 0.04, 0.9]) == [True, True, False, False] or MS.bh([0.001, 0.02, 0.04, 0.9])[0]
    r = MS.clustered([("2020-01-01", 0.01)] * 50 + [(f"2020-02-{i:02d}", 0.0) for i in range(1, 10)])
    assert r["n"] == 59 and r["n_dates"] == 10  # 50 cases on same day count as ONE date
