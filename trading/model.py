"""Local reflex: logistic regression (IRLS, pure Python) + isotonic calibration, trained from scratch on
saved public candles. Lightweight (KB) and fast (ms). Returns a typed, validated schema.

No third-party models or foreign AI outputs: the only training data is real prices.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

from trading.state import FEATURES, features, label

REGIMES = ("trending", "mean_reverting", "high_vol", "crisis")
DIRECTIONS = ("long", "short", "neutral")
RISK = ("safe", "near_limit", "reduce")
MARGIN = 0.03  # neutral band around 0.5


# ---------------------------------------------------------------- minimal linear algebra
def _solve(a: list[list[float]], b: list[float]) -> list[float]:
    n = len(b)
    m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for col in range(n):
        piv = max(range(col, n), key=lambda r: abs(m[r][col]))
        m[col], m[piv] = m[piv], m[col]
        p = m[col][col] or 1e-12
        for r in range(n):
            if r != col and m[r][col]:
                f = m[r][col] / p
                m[r] = [x - f * y for x, y in zip(m[r], m[col])]
    return [m[i][n] / (m[i][i] or 1e-12) for i in range(n)]


def _sig(z: float) -> float:
    return 1 / (1 + math.exp(-max(-35.0, min(35.0, z))))


def fit_logistic(X: list[list[float]], y: list[int], l2: float = 1.0, iters: int = 12) -> list[float]:
    """Newton-Raphson (IRLS) with L2 regularization. X already standardized; w[0] is bias."""
    d = len(X[0]) + 1
    w = [0.0] * d
    for _ in range(iters):
        H = [[0.0] * d for _ in range(d)]
        g = [0.0] * d
        for xi, yi in zip(X, y):
            z = [1.0] + xi
            p = _sig(sum(a * b for a, b in zip(w, z)))
            s, e = p * (1 - p), p - yi
            for j in range(d):
                g[j] += e * z[j]
                zj = s * z[j]
                Hj = H[j]
                for k in range(j, d):
                    Hj[k] += zj * z[k]
        for j in range(d):
            for k in range(j):
                H[j][k] = H[k][j]
            if j:
                H[j][j] += l2
                g[j] += l2 * w[j]
        step = _solve(H, g)
        w = [a - b for a, b in zip(w, step)]
        if max(abs(s) for s in step) < 1e-6:
            break
    return w


def fit_isotonic(p: list[float], y: list[int], min_n: int = 150, prior: float = 20.0) -> list[tuple[float, float]]:
    """Pool-adjacent-violators with blocks of at least `min_n` samples and mean smoothing (prior in
    pseudo-observations). Avoids typical isotonic overfitting at tails with few samples."""
    pts = sorted(zip(p, y))
    if not pts:
        return []
    base = sum(t for _, t in pts) / len(pts)
    out: list[list] = []
    for x, t in pts:
        out.append([x, float(t), 1])
        while len(out) > 1 and (out[-2][1] / out[-2][2] >= out[-1][1] / out[-1][2] or out[-2][2] < min_n):
            x2, s2, n2 = out.pop()
            out[-1] = [x2, out[-1][1] + s2, out[-1][2] + n2]
    if len(out) > 1 and out[-1][2] < min_n:
        x2, s2, n2 = out.pop()
        out[-1] = [x2, out[-1][1] + s2, out[-1][2] + n2]
    return [(x, (s + prior * base) / (n + prior)) for x, s, n in out]


def apply_isotonic(curve: list[tuple[float, float]], p: float) -> float:
    if not curve:
        return p
    for x, v in curve:
        if p <= x:
            return min(0.99, max(0.01, v))
    return min(0.99, max(0.01, curve[-1][1]))


# ---------------------------------------------------------------- dataset
def dataset(c: list[dict], start: int, end: int, h: int = 4, stride: int = 1):
    X, y, idx = [], [], []
    for i in range(max(start, 80), min(end, len(c) - h), stride):
        f, lab = features(c, i), label(c, i, h)
        if f is None or lab is None:
            continue
        X.append([f[k] for k in FEATURES])
        y.append(lab)
        idx.append(i)
    return X, y, idx


class Reflex:
    def __init__(self, params: dict | None = None):
        self.p = params or {}

    # -- training: standardizes, fits on first part and calibrates on last part (no time mixing)
    @classmethod
    def train(cls, X: list[list[float]], y: list[int], meta: dict | None = None, calib_frac: float = 0.25) -> "Reflex":
        n = len(X)
        cut = int(n * (1 - calib_frac))
        cols = list(zip(*X[:cut]))
        mu = [sum(col) / len(col) for col in cols]
        sd = [math.sqrt(sum((v - m) ** 2 for v in col) / max(1, len(col) - 1)) or 1.0 for col, m in zip(cols, mu)]
        Z = [[(v - m) / s for v, m, s in zip(row, mu, sd)] for row in X]
        w = fit_logistic(Z[:cut], y[:cut])
        raw = [_sig(w[0] + sum(a * b for a, b in zip(w[1:], z))) for z in Z[cut:]]
        vols = sorted(r[FEATURES.index("vol24")] for r in X[:cut])
        q = lambda f: vols[min(len(vols) - 1, int(f * len(vols)))]  # noqa: E731
        return cls({"w": w, "mu": mu, "sd": sd, "iso": fit_isotonic(raw, y[cut:]) if raw else [],
                    "vol_p80": q(0.80), "vol_p99": q(0.99), "n": n, **(meta or {})})

    def prob_up(self, f: dict) -> float:
        x = [(f[k] - m) / s for k, m, s in zip(FEATURES, self.p["mu"], self.p["sd"])]
        raw = _sig(self.p["w"][0] + sum(a * b for a, b in zip(self.p["w"][1:], x)))
        return apply_isotonic(self.p["iso"], raw)

    def regime(self, f: dict) -> str:
        if f["r24"] < -0.10 or f["vol24"] > self.p["vol_p99"]:
            return "crisis"
        if f["vol24"] > self.p["vol_p80"]:
            return "high_vol"
        return "trending" if abs(f["trend72"]) > 1.0 else "mean_reverting"

    def decide(self, f: dict, spread_bps: float | None = None, risk_state: str = "safe") -> dict:
        p = self.prob_up(f)
        direction = "long" if p >= 0.5 + MARGIN else "short" if p <= 0.5 - MARGIN else "neutral"
        conf = max(p, 1 - p)
        reg = self.regime(f)
        q = 0
        if conf >= 0.60:
            q += 1
        if (reg == "trending" and direction != "neutral" and (f["trend72"] > 0) == (direction == "long")) or \
           (reg == "mean_reverting" and ((direction == "long" and f["rsi14"] < 0.35) or (direction == "short" and f["rsi14"] > 0.65))):
            q += 1
        if spread_bps is not None and spread_bps < 5 and reg not in ("high_vol", "crisis"):
            q += 1
        out = {"regime": reg, "direction": direction, "prob": round(conf, 4), "p_up": round(p, 4),
               "setup_quality": q, "risk_state": risk_state, "escalate": conf < 0.60 or reg == "crisis"}
        validate(out)
        return out

    def save(self, path: Path) -> None:
        from trading.data import private_write
        private_write(path, json.dumps(self.p).encode())

    @classmethod
    def load(cls, path: Path) -> "Reflex | None":
        return cls(json.loads(path.read_text())) if path.is_file() else None


def validate(o: dict) -> dict:
    """Typed reflex schema. Raises ValueError if anything doesn't match (policy never receives garbage)."""
    if o.get("regime") not in REGIMES or o.get("direction") not in DIRECTIONS or o.get("risk_state") not in RISK:
        raise ValueError("enum out of range")
    if not isinstance(o.get("prob"), float) or not 0.5 <= o["prob"] <= 1.0:
        raise ValueError("prob outside [0.5, 1]")
    if not isinstance(o.get("setup_quality"), int) or not 0 <= o["setup_quality"] <= 3:
        raise ValueError("setup_quality outside 0..3")
    if not isinstance(o.get("escalate"), bool):
        raise ValueError("escalate is not boolean")
    return o
