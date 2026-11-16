"""Causal features and triple-barrier labels for research (numpy).

Causality: each feature at candle i uses only candles <= i (backward windows, positive lags).
Funding is point-in-time: the latest published with fundingTime <= close of candle i. Labels are the only
component looking into the future and never enter as features. Anti-leakage test in tests/test_research.py.
"""
from __future__ import annotations

import json

import numpy as np

from trading import rdata

FEATS = ["r1", "r4", "r12", "r24", "r72", "r168", "rv24", "rv168", "rv_ratio", "rsi14", "d_sma50", "d_sma200", "vz", "range24",
         "fund", "fund_3d", "btc_r24", "btc_r168", "corr_btc", "hour_s", "hour_c", "dow_s", "dow_c"]


def load(sym: str) -> dict:
    c = np.array(json.loads((rdata.DIR / f"{sym}-1h.json").read_text()), dtype=float)
    p = rdata.DIR / f"{sym}-funding.json"
    f = np.array(json.loads(p.read_text()), dtype=float) if p.is_file() else np.zeros((0, 2))
    return {"t": c[:, 0].astype(np.int64), "o": c[:, 1], "h": c[:, 2], "l": c[:, 3], "c": c[:, 4], "qv": c[:, 5], "f": f}


def _roll(x, n, fn):
    out = np.full(len(x), np.nan)
    if len(x) < n:
        return out
    w = np.lib.stride_tricks.sliding_window_view(x, n)
    out[n - 1:] = fn(w, axis=1)
    return out


def _lag(x, k):
    out = np.full(len(x), np.nan)
    out[k:] = x[:-k]
    return out


def features(d: dict, btc: dict | None = None) -> np.ndarray:
    c, lc = d["c"], np.log(d["c"])
    r = np.diff(lc, prepend=np.nan)
    F = {}
    for k in (1, 4, 12, 24, 72, 168):
        F[f"r{k}"] = lc - _lag(lc, k)
    F["rv24"] = _roll(r, 24, np.std)
    F["rv168"] = _roll(r, 168, np.std)
    F["rv_ratio"] = F["rv24"] / F["rv168"]
    up, dn = np.clip(np.nan_to_num(r), 0, None), np.clip(-np.nan_to_num(r), 0, None)
    gu, gd = _roll(up, 14, np.sum), _roll(dn, 14, np.sum)
    F["rsi14"] = gu / (gu + gd + 1e-12)
    F["d_sma50"] = lc - np.log(_roll(c, 50, np.mean))
    F["d_sma200"] = lc - np.log(_roll(c, 200, np.mean))
    lv = np.log1p(d["qv"])
    F["vz"] = (_roll(lv, 24, np.mean) - _roll(lv, 168, np.mean)) / (_roll(lv, 168, np.std) + 1e-9)
    F["range24"] = np.log(_roll(d["h"], 24, np.max) / _roll(d["l"], 24, np.min))
    # point-in-time funding (last published before candle close)
    close_t = d["t"] + 3_600_000 - 1
    if len(d["f"]):
        idx = np.searchsorted(d["f"][:, 0], close_t, side="right") - 1
        fr = np.where(idx >= 0, d["f"][np.clip(idx, 0, None), 1], np.nan)
        F["fund"] = fr
        F["fund_3d"] = _roll(np.nan_to_num(fr), 72, np.mean)
    else:
        F["fund"] = F["fund_3d"] = np.full(len(c), np.nan)
    if btc is not None:
        bl = np.log(btc["c"])
        F["btc_r24"], F["btc_r168"] = bl - _lag(bl, 24), bl - _lag(bl, 168)
        br = np.diff(bl, prepend=np.nan)
        a, b = np.nan_to_num(r), np.nan_to_num(br)
        ma, mb = _roll(a, 168, np.mean), _roll(b, 168, np.mean)
        cov = _roll(a * b, 168, np.mean) - ma * mb
        F["corr_btc"] = cov / (_roll(a, 168, np.std) * _roll(b, 168, np.std) + 1e-12)
    else:
        F["btc_r24"] = F["btc_r168"] = F["corr_btc"] = np.full(len(c), np.nan)
    hrs = (d["t"] // 3_600_000) % 24
    dow = (d["t"] // 86_400_000 + 3) % 7  # 1970-01-01 was Thursday
    F["hour_s"], F["hour_c"] = np.sin(2 * np.pi * hrs / 24), np.cos(2 * np.pi * hrs / 24)
    F["dow_s"], F["dow_c"] = np.sin(2 * np.pi * dow / 7), np.cos(2 * np.pi * dow / 7)
    return np.column_stack([F[k] for k in FEATS])


def triple_barrier(d: dict, h: int, k: float = 1.0) -> tuple[np.ndarray, np.ndarray]:
    """Label at candle i: 1 if +k·σ·√h is hit before −k·σ·√h in the next h candles, 0 if opposite; if
    neither is hit, sign of return at h. σ = hourly volatility of prior 168 candles (causal).
    Returns (label, realized log return to exit) for evaluating trades."""
    c, hi, lo = d["c"], d["h"], d["l"]
    r = np.diff(np.log(c), prepend=np.nan)
    sig = _roll(r, 168, np.std) * np.sqrt(h) * k
    n = len(c)
    y, ret = np.full(n, np.nan), np.full(n, np.nan)
    for i in range(168, n - h):
        if not np.isfinite(sig[i]):
            continue
        up, dn = c[i] * np.exp(sig[i]), c[i] * np.exp(-sig[i])
        hh, ll = hi[i + 1: i + h + 1], lo[i + 1: i + h + 1]
        a = np.argmax(hh >= up) if (hh >= up).any() else h
        b = np.argmax(ll <= dn) if (ll <= dn).any() else h
        if a < b:
            y[i], ret[i] = 1, np.log(up / c[i])
        elif b < a:
            y[i], ret[i] = 0, np.log(dn / c[i])
        else:  # neither (or both in the same candle: take close, without assuming order)
            y[i], ret[i] = float(c[i + h] > c[i]), np.log(c[i + h] / c[i])
    return y, ret
