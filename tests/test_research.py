"""Model research: feature causality, triple barrier, and deflated Sharpe (offline)."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
pytest.importorskip("sklearn")
from trading import rfeat as F  # noqa: E402
from trading import rml  # noqa: E402


def synth(n=3000, seed=0):
    r = np.random.default_rng(seed)
    c = 100 * np.exp(np.cumsum(r.normal(0, 0.01, n)))
    t = (np.arange(n) * 3_600_000 + 1_700_000_000_000).astype(np.int64)
    return {"t": t, "o": c, "h": c * 1.003, "l": c * 0.997, "c": c, "qv": r.uniform(1e5, 2e5, n), "f": np.column_stack([t[::8], r.normal(0, 1e-4, len(t[::8]))])}


def test_features_causal():
    d, b = synth(), synth(seed=1)
    X = F.features(d, b)
    i = 2000
    d2 = {k: (v.copy() if hasattr(v, "copy") else v) for k, v in d.items()}
    for k in ("c", "h", "l", "qv"):
        d2[k][i + 1:] *= 5
    d2["f"][d2["f"][:, 0] > d["t"][i] + 3_600_000, 1] = 0.5
    assert np.allclose(X[: i + 1], F.features(d2, b)[: i + 1], equal_nan=True)


def test_triple_barrier_labels():
    d = synth()
    y, ret = F.triple_barrier(d, 24)
    ok = np.isfinite(y)
    assert set(np.unique(y[ok])) <= {0.0, 1.0} and 0.4 < y[ok].mean() < 0.6
    assert np.all(np.isnan(y[-24:]))  # insufficient future data, no label


def test_deflated_sharpe_penalises_many_trials():
    one, _ = rml.deflated_sharpe(0.05, 1000, 0.0, 3.0, [0.05, 0.0])
    many, _ = rml.deflated_sharpe(0.05, 1000, 0.0, 3.0, list(np.random.default_rng(0).normal(0, 0.03, 200)) + [0.05])
    assert many < one
