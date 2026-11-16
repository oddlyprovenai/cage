"""Deterministic state engine: CAUSAL numeric features (only using closed candles up to t) and compact snapshot.

`features(c, i)` inspects strictly c[:i+1]. The anti-leakage test mutates all candles after i and verifies that the
result does not change. Labels (`label`) are the only component looking into the future and never enter features.
"""
from __future__ import annotations

import math

FEATURES = ["r1", "r4", "r24", "r72", "vol24", "vol_ratio", "rsi14", "dist_sma50", "range24", "vz24", "trend72"]
WARMUP = 80  # candles needed before first valid feature vector


def _ret(c, i, k):
    return math.log(c[i]["c"] / c[i - k]["c"])


def _vol(c, i, k):
    rs = [math.log(c[j]["c"] / c[j - 1]["c"]) for j in range(i - k + 1, i + 1)]
    m = sum(rs) / k
    return math.sqrt(sum((x - m) ** 2 for x in rs) / (k - 1))


def _rsi(c, i, k=14):
    g = l = 0.0
    for j in range(i - k + 1, i + 1):
        d = c[j]["c"] - c[j - 1]["c"]
        g, l = (g + d, l) if d > 0 else (g, l - d)
    return 50.0 if g + l == 0 else 100 * g / (g + l)


def features(c: list[dict], i: int) -> dict | None:
    """Features at candle i (closed). None if insufficient history."""
    if i < WARMUP or i >= len(c):
        return None
    vol24, vol168 = _vol(c, i, 24), _vol(c, i, 72)
    sma50 = sum(c[j]["c"] for j in range(i - 49, i + 1)) / 50
    hi, lo = max(c[j]["h"] for j in range(i - 23, i + 1)), min(c[j]["l"] for j in range(i - 23, i + 1))
    vols = [c[j]["qv"] for j in range(i - 71, i + 1)]
    vm = sum(vols) / len(vols)
    vs = math.sqrt(sum((v - vm) ** 2 for v in vols) / (len(vols) - 1)) or 1.0
    vz = (sum(c[j]["qv"] for j in range(i - 23, i + 1)) / 24 - vm) / vs
    r72 = _ret(c, i, 72)
    return {"r1": _ret(c, i, 1), "r4": _ret(c, i, 4), "r24": _ret(c, i, 24), "r72": r72, "vol24": vol24,
            "vol_ratio": vol24 / vol168 if vol168 else 1.0, "rsi14": _rsi(c, i) / 100, "dist_sma50": math.log(c[i]["c"] / sma50),
            "range24": math.log(hi / lo), "vz24": max(-5.0, min(5.0, vz)), "trend72": r72 / (vol168 * math.sqrt(72) or 1)}


def label(c: list[dict], i: int, h: int = 4) -> int | None:
    """1 if price rises in the next h candles, 0 if it drops. Future-looking: ONLY for training and evaluation."""
    if i + h >= len(c):
        return None
    return 1 if c[i + h]["c"] > c[i]["c"] else 0


def book_stats(book: dict | None) -> dict:
    if not book or not book.get("bids") or not book.get("asks"):
        return {"mid": None, "spread_bps": None, "imbalance": None}
    bb, ba = book["bids"][0][0], book["asks"][0][0]
    mid = (bb + ba) / 2
    bq, aq = sum(q for _, q in book["bids"][:10]), sum(q for _, q in book["asks"][:10])
    return {"mid": mid, "spread_bps": 1e4 * (ba - bb) / mid, "imbalance": (bq - aq) / (bq + aq) if bq + aq else 0.0}


def snapshot(symbol: str, c: list[dict], book: dict | None, portfolio: dict) -> dict:
    """Compact state (< 400 tokens) with causal timestamps: candle used and book time."""
    i = len(c) - 1
    f = features(c, i) or {}
    b = book_stats(book)
    return {"symbol": symbol, "candle_t": c[i]["t"] if c else None, "book_t": (book or {}).get("ts"),
            "price": c[i]["c"] if c else None, "mid": b["mid"], "spread_bps": _r(b["spread_bps"], 2), "imbalance": _r(b["imbalance"], 3),
            "vol24": _r(f.get("vol24"), 5), "r24": _r(f.get("r24"), 4), "r72": _r(f.get("r72"), 4), "rsi14": _r(f.get("rsi14"), 3),
            "trend72": _r(f.get("trend72"), 3), "inventory": _r(portfolio.get("positions", {}).get(symbol, {}).get("qty", 0.0), 6),
            "drawdown": _r(portfolio.get("drawdown", 0.0), 4), "equity": _r(portfolio.get("equity"), 2)}


def _r(x, n):
    return None if x is None else round(x, n)
