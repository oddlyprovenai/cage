"""Honest, out-of-sample (walk-forward) evaluation: train on past and test on the next block,
advancing through time. Never evaluated on data seen during training.

Metrics: schema validity, Brier, calibration curve, directional accuracy, and backtest after costs
(return, Sharpe, maximum drawdown) vs buy and hold.
"""
from __future__ import annotations

import math
import time

from trading import risk
from trading.broker import FEE, SLIPPAGE
from trading.model import Reflex, dataset, validate
from trading.state import features


def brier(p: list[float], y: list[int]) -> float:
    return sum((a - b) ** 2 for a, b in zip(p, y)) / len(p) if p else float("nan")


def calibration(p: list[float], y: list[int], bins: int = 10) -> list[dict]:
    out = []
    for k in range(bins):
        lo, hi = k / bins, (k + 1) / bins
        sel = [(a, b) for a, b in zip(p, y) if lo <= a < hi or (k == bins - 1 and a == 1.0)]
        if sel:
            out.append({"bin": round((lo + hi) / 2, 2), "pred": round(sum(a for a, _ in sel) / len(sel), 4),
                        "obs": round(sum(b for _, b in sel) / len(sel), 4), "n": len(sel)})
    return out


def max_drawdown(eq: list[float]) -> float:
    peak, dd = eq[0] if eq else 1, 0.0
    for v in eq:
        peak = max(peak, v)
        dd = max(dd, 1 - v / peak)
    return dd


def sharpe(eq: list[float], periods_per_year: int = 24 * 365) -> float:
    r = [math.log(b / a) for a, b in zip(eq, eq[1:]) if a > 0 and b > 0]
    if len(r) < 2:
        return 0.0
    m = sum(r) / len(r)
    sd = math.sqrt(sum((x - m) ** 2 for x in r) / (len(r) - 1))
    return 0.0 if sd == 0 else m / sd * math.sqrt(periods_per_year)


def walk_forward(c: list[dict], train_n: int = 6000, test_n: int = 720, h: int = 4, stride: int = 2,
                 lim: risk.Limits | None = None, spread_bps: float = 1.0) -> dict:
    """One-month blocks (720 h): trains on prior `train_n` candles and paper-trades the next block."""
    lim = lim or risk.Limits()
    P, Y, schema_ok, schema_n, hits, dir_n = [], [], 0, 0, 0, 0
    eq, bh = [1.0], [1.0]
    pos, peak, folds = 0.0, 1.0, 0
    start = max(train_n, 100)
    t0 = time.time()
    while start + test_n + h < len(c):
        X, y, _ = dataset(c, start - train_n, start, h, stride)
        m = Reflex.train(X, y)
        folds += 1
        for i in range(start, start + test_n):
            f = features(c, i)
            ret = c[i + 1]["c"] / c[i]["c"] - 1
            try:
                d = m.decide(f, spread_bps, "safe")
                validate(d)
                schema_ok += 1
            except (ValueError, TypeError, KeyError):
                d = None
            schema_n += 1
            if i + h < len(c):
                yy = 1 if c[i + h]["c"] > c[i]["c"] else 0
                P.append(d["p_up"] if d else 0.5)
                Y.append(yy)
                if d and d["direction"] != "neutral":
                    dir_n += 1
                    hits += (d["direction"] == "long") == (yy == 1)
            dd = 1 - eq[-1] / peak
            pf = {"drawdown": dd, "day_pnl_pct": 0.0}
            tgt = risk.target(d, pf, lim, False)[0] if d else 0.0
            cost = abs(tgt - pos) * (FEE + SLIPPAGE + spread_bps / 2e4)
            pos = tgt
            eq.append(eq[-1] * (1 + pos * ret - cost))
            bh.append(bh[-1] * (1 + ret))
            peak = max(peak, eq[-1])
        start += test_n
    trades = None
    return {"folds": folds, "samples": len(P), "schema_valid": schema_ok / schema_n if schema_n else None,
            "brier": brier(P, Y), "brier_base": brier([sum(Y) / len(Y)] * len(Y), Y) if Y else None,
            "calibration": calibration(P, Y), "directional_acc": hits / dir_n if dir_n else None, "directional_n": dir_n,
            "coverage": dir_n / len(P) if P else 0, "ret": eq[-1] - 1, "bh_ret": bh[-1] - 1, "sharpe": sharpe(eq),
            "bh_sharpe": sharpe(bh), "max_dd": max_drawdown(eq), "bh_max_dd": max_drawdown(bh),
            "exposure": None, "trades": trades, "equity": eq[:: max(1, len(eq) // 300)], "bh": bh[:: max(1, len(bh) // 300)],
            "from": c[train_n]["t"] if len(c) > train_n else None, "to": c[-1]["t"], "seconds": round(time.time() - t0, 1)}
