"""Simple systematic strategies as alternatives to the model. Standard parameters specified upfront, real
daily data, costs 0.15% per side, spot long/cash only. Each is benchmarked against its buy-and-hold index.

- tsmom: time-series momentum per asset (126-day return > 0) with a 20% annualized volatility target
  (60-day vol), capped at 100%, 15-crypto equal-weight portfolio, weekly rebalancing.
- xsmom: cross-sectional momentum: weekly top 3 cryptos by 30-day return (skipping last day).
- riskparity: MSCI World, euro bonds, gold and bitcoin inverse-volatility weighted (60-day vol), monthly.
"""
from __future__ import annotations

import datetime as dt
import math

import numpy as np

from trading import ltdata, rdata
from trading import rfeat as F

COST = 0.0015


def crypto_daily():
    """Daily closes (00:00 UTC) for 15 pairs from research hourly candles."""
    out, days = {}, None
    for s in rdata.PAIRS:
        d = F.load(s)
        m = (d["t"] // 3_600_000) % 24 == 23  # close of last hour of the day
        ser = {int(t // 86_400_000): c for t, c in zip(d["t"][m], d["c"][m])}
        out[s] = ser
        days = set(ser) if days is None else days & set(ser)
    D = sorted(days)
    return [dt.date(1970, 1, 1) + dt.timedelta(days=x) for x in D], np.array([[out[s][x] for s in rdata.PAIRS] for x in D])


def backtest(px: np.ndarray, weights_fn, rebalance_every: int, start: int):
    """px: (days, assets). weights_fn(i) -> weights (sum <= 1; remainder in zero-yield cash)."""
    n, k = px.shape
    w = np.zeros(k)
    eq = [1.0]
    for i in range(start, n - 1):
        if (i - start) % rebalance_every == 0:
            new = weights_fn(i - 1) if i > start else weights_fn(i)  # yesterday's signal, today's execution
            eq[-1] *= 1 - COST * np.abs(new - w).sum()
            w = new
        r = px[i + 1] / px[i] - 1
        g = float(w @ r)
        eq.append(eq[-1] * (1 + g))
        w = w * (1 + r) / (1 + g) if (1 + g) else w
    return np.array(eq)


def metrics(eq: np.ndarray, per_year=365):
    r = eq[1:] / eq[:-1] - 1
    yrs = len(r) / per_year
    sd = r.std(ddof=1)
    return {"cagr": float(eq[-1] ** (1 / yrs) - 1), "vol": float(sd * math.sqrt(per_year)),
            "max_dd": float(np.max(1 - eq / np.maximum.accumulate(eq))), "sharpe": float(r.mean() / sd * math.sqrt(per_year)) if sd else 0.0,
            "sr_period": float(r.mean() / sd) if sd else 0.0, "n": int(len(r)),
            "skew": float(((r - r.mean()) ** 3).mean() / sd ** 3) if sd else 0.0, "kurt": float(((r - r.mean()) ** 4).mean() / sd ** 4) if sd else 3.0,
            "curve": [float(x) for x in eq[:: max(1, len(eq) // 200)]]}


def run() -> dict:
    days, px = crypto_daily()
    k = px.shape[1]
    lr = np.vstack([np.zeros(k), np.diff(np.log(px), axis=0)])
    start = 200

    def tsmom(i):
        mom = np.log(px[i] / px[i - 126])
        vol = lr[i - 59: i + 1].std(0) * math.sqrt(365)
        w = np.where(mom > 0, np.minimum(1.0, 0.20 / np.maximum(vol, 1e-6)), 0.0) / k
        return w

    def xsmom(i):
        mom = px[i - 1] / px[i - 30] - 1
        top = np.argsort(mom)[-3:]
        w = np.zeros(k)
        w[top] = 1 / 3
        return w

    res = {"crypto_from": str(days[start]), "crypto_to": str(days[-1])}
    ew = backtest(px, lambda i: np.ones(k) / k, 30, start)
    btc = backtest(px, lambda i: np.eye(k)[0], 10**9, start)
    res["strategies"] = {
        "btc_hold": {"label": "Bitcoin, buy and hold (benchmark)", **metrics(btc)},
        "ew_hold": {"label": "15 equal-weight cryptos, monthly rebalance", **metrics(ew)},
        "tsmom": {"label": "Trend with 20% volatility target", **metrics(backtest(px, tsmom, 7, start))},
        "xsmom": {"label": "Cross-sectional momentum (top 3 weekly)", **metrics(backtest(px, xsmom, 7, start))},
    }
    # risk parity across asset classes (common trading days with European ETFs)
    dd, tab, _ = ltdata.table(["IWDA.AS", "IEAG.AS", "4GLD.DE", "BTCUSDT"])
    P = np.array([tab[s] for s in ["IWDA.AS", "IEAG.AS", "4GLD.DE", "BTCUSDT"]], dtype=float).T
    ok = np.isfinite(P).all(1) & (P > 0).all(1)
    P = P[ok]
    L = np.vstack([np.zeros(4), np.diff(np.log(P), axis=0)])

    def rp(i):
        v = L[i - 59: i + 1].std(0)
        w = 1 / np.maximum(v, 1e-9)
        return w / w.sum()
    s0 = 260
    res["rp_from"] = [d for d, o in zip(dd, ok) if o][s0]
    res["strategies"]["iwda_hold"] = {"label": "MSCI World, buy and hold (benchmark)", **metrics(backtest(P, lambda i: np.eye(4)[0], 10**9, s0), 365)}
    res["strategies"]["riskparity"] = {"label": "Risk parity: equities, bonds, gold and bitcoin", **metrics(backtest(P, rp, 30, s0), 365)}
    return res
