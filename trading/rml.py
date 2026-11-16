"""Rigorous trading model research round (out-of-sample, after costs, no cheating).

Design, specified BEFORE seeing results:
- 15 pairs, 4 years of hourly candles. Horizons: 4 h, 24 h and 168 h. Triple barrier label: ±1·σ·√h.
- Final 120-day RESERVED period: inspected only once, with the single variant selected in development.
- Development: walk-forward with expanding window and 90-day test blocks; purge of h hours between end of
  training and start of test (no training label overlaps with test).
- Models: regularized logistic regression, gradient boosting (histograms) and ensemble (mean); isotonic calibration
  on last 20% (temporal) of each training set. Meta-labeling: a second model decides when NOT to trade.
- Non-overlapping trades (one every h hours per asset), fee+slippage 0.15% per side.
- ALL tested variants are counted and deflated Sharpe (Bailey & López de Prado) is computed.
"""
from __future__ import annotations

import json
import math
import time

import numpy as np
from scipy.stats import kurtosis, norm, skew
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

from trading import data, rdata
from trading import rfeat as F

COST = 0.0015
HOLDOUT_DAYS, BLOCK_DAYS, MIN_TRAIN_DAYS = 120, 90, 365
HORIZONS = (4, 24, 168)
THRESHOLDS = (0.55, 0.60)
OUT = data.HOME / "research_ml.json"


def build(h: int):
    btc = F.load("BTCUSDT")
    X, Y, R, T, A, B = [], [], [], [], [], []
    for ai, s in enumerate(rdata.PAIRS):
        d = F.load(s)
        f = F.features(d, btc)
        # volatility-normalized momentum (comparable across assets)
        rv = f[:, F.FEATS.index("rv168")]
        for k in (1, 4, 12, 24, 72, 168):
            j = F.FEATS.index(f"r{k}")
            f[:, j] = f[:, j] / (rv * math.sqrt(k) + 1e-12)
        y, ret = F.triple_barrier(d, h)
        bh = np.full(len(d["c"]), np.nan)
        bh[:-h] = np.log(d["c"][h:] / d["c"][:-h])
        ok = np.isfinite(f).all(1) & np.isfinite(y)
        idx = np.where(ok)[0]
        X.append(f[idx]); Y.append(y[idx]); R.append(ret[idx]); T.append(d["t"][idx]); A.append(np.full(len(idx), ai)); B.append(bh[idx])
    return np.vstack(X), np.concatenate(Y), np.concatenate(R), np.concatenate(T), np.concatenate(A), np.concatenate(B)


def fit_predict(kind, Xtr, ytr, Xte):
    n = len(Xtr)
    cut = int(n * 0.8)
    if kind == "lr":
        sc = StandardScaler().fit(Xtr[:cut])
        m = LogisticRegression(C=0.05, max_iter=500).fit(sc.transform(Xtr[:cut]), ytr[:cut])
        raw_c, raw_t = m.predict_proba(sc.transform(Xtr[cut:]))[:, 1], m.predict_proba(sc.transform(Xte))[:, 1]
    elif kind == "gbm":
        m = HistGradientBoostingClassifier(max_depth=3, learning_rate=0.05, max_iter=150, l2_regularization=1.0,
                                           min_samples_leaf=200, random_state=0).fit(Xtr[:cut], ytr[:cut])
        raw_c, raw_t = m.predict_proba(Xtr[cut:])[:, 1], m.predict_proba(Xte)[:, 1]
    else:  # ensemble
        a_c, a_t = fit_predict("lr", Xtr, ytr, np.vstack([Xtr[cut:], Xte]))
        b_c, b_t = fit_predict("gbm", Xtr, ytr, np.vstack([Xtr[cut:], Xte]))
        k = n - cut
        return (a_t[:k] + b_t[:k]) / 2, (a_t[k:] + b_t[k:]) / 2
    iso = IsotonicRegression(out_of_bounds="clip", y_min=0.02, y_max=0.98).fit(raw_c, ytr[cut:])
    return iso.predict(raw_c), iso.predict(raw_t)


def walk(h, X, Y, T, kind, start_t, end_t):
    """Out-of-sample predictions in [start_t, end_t) by 90-day blocks, with h-hour purge."""
    P = np.full(len(Y), np.nan)
    blk = BLOCK_DAYS * 86_400_000
    t0 = start_t
    while t0 < end_t:
        t1 = min(t0 + blk, end_t)
        tr = T < t0 - h * 3_600_000          # purge: training labels end before block
        te = (T >= t0) & (T < t1)
        if tr.sum() > 2000 and te.sum():
            _, P[te] = fit_predict(kind, X[tr], Y[tr], X[te])
        t0 = t1
    return P


def trades(h, P, R, T, A, Bh, thr, sel, long_only=False):
    """One trade every h hours per asset; returns net returns per period (equal-weight portfolio)."""
    per = {}
    hits = n = 0
    for a in np.unique(A[sel]):
        m = sel & (A == a)
        idx = np.where(m)[0]
        last = -10**18
        for i in idx[np.argsort(T[idx])]:
            if T[i] - last < h * 3_600_000:
                continue
            p = P[i]
            side = 1 if p > thr else (-1 if p < 1 - thr and not long_only else 0)
            if side == 0:
                continue
            last = T[i]
            r = side * (math.exp(R[i]) - 1) - 2 * COST
            key = int(T[i] // (h * 3_600_000))
            per.setdefault(key, []).append(r)
            n += 1
            hits += r > 0
    # all periods of the slice count (no position = 0%): otherwise annualized Sharpe is inflated
    ts = T[sel]
    if not len(ts):
        return np.zeros(0), None, 0
    k0, k1 = int(ts.min() // (h * 3_600_000)), int(ts.max() // (h * 3_600_000))
    # portfolio distributes capital across 15 assets: each trade weighs 1/15
    na = len(np.unique(A[sel]))
    rets = np.array([sum(per.get(k, [])) / na for k in range(k0, k1 + 1)])
    return rets, (hits / n if n else None), n


def stats(rets, h):
    if len(rets) < 3:
        return {"sharpe": 0.0, "ret": 0.0, "max_dd": 0.0, "n_periods": len(rets)}
    ppy = 8760 / h
    eq = np.cumprod(1 + rets)
    dd = float(np.max(1 - eq / np.maximum.accumulate(eq)))
    sd = rets.std(ddof=1)
    return {"sharpe": float(rets.mean() / sd * math.sqrt(ppy)) if sd else 0.0, "sr_period": float(rets.mean() / sd) if sd else 0.0,
            "ret": float(eq[-1] - 1), "max_dd": dd, "n_periods": int(len(rets)), "skew": float(skew(rets)), "kurt": float(kurtosis(rets, fisher=False))}


def deflated_sharpe(sr, n_obs, sk, ku, sr_trials):
    """Probability that Sharpe (per period) is genuine given how many variants were tested."""
    N = max(2, len(sr_trials))
    v = float(np.var(sr_trials, ddof=1)) if len(sr_trials) > 1 else 0.0
    g = 0.5772156649
    sr0 = math.sqrt(max(v, 1e-12)) * ((1 - g) * norm.ppf(1 - 1 / N) + g * norm.ppf(1 - 1 / (N * math.e)))
    den = math.sqrt(max(1e-12, 1 - sk * sr + (ku - 1) / 4 * sr ** 2))
    return float(norm.cdf((sr - sr0) * math.sqrt(max(1, n_obs - 1)) / den)), sr0


def brier(p, y):
    m = np.isfinite(p)
    return float(np.mean((p[m] - y[m]) ** 2)) if m.any() else None


def run(log=print) -> dict:
    t_start = time.time()
    rep = {"design": __doc__.strip().splitlines()[2:], "variants": [], "holdout": None, "ts": int(t_start)}
    cache = {}
    for h in HORIZONS:
        X, Y, R, T, A, B = cache[h] = build(h)
        t_end = T.max()
        hold_t = t_end - HOLDOUT_DAYS * 86_400_000
        dev_start = T.min() + MIN_TRAIN_DAYS * 86_400_000
        dev = (T >= dev_start) & (T < hold_t - h * 3_600_000)
        base = float(np.mean((Y[dev] - Y[dev].mean()) ** 2))
        for kind in ("lr", "gbm", "ens"):
            P = walk(h, X, Y, T, kind, dev_start, hold_t - h * 3_600_000)
            b = brier(P[dev], Y[dev])
            for thr in THRESHOLDS:
                for lo in (False, True):
                    rets, hit, n = trades(h, P, R, T, A, B, thr, dev & np.isfinite(P), lo)
                    st = stats(rets, h)
                    rep["variants"].append({"h": h, "model": kind, "thr": thr, "long_only": lo, "brier": b, "brier_base": base,
                                            "hit": hit, "trades": n, **st})
            log(f"h={h} {kind}: brier {b:.4f} (base {base:.4f})")
        # meta-labeling on ensemble: does proposed side succeed? If unlikely, do not trade
        P = walk(h, X, Y, T, "ens", dev_start, hold_t - h * 3_600_000)
        side_ok = (np.where(P > 0.5, 1, 0) == Y).astype(float)
        Xm = np.column_stack([X, np.abs(np.nan_to_num(P) - 0.5)])
        M = walk(h, Xm, side_ok, T, "gbm", dev_start + 180 * 86_400_000, hold_t - h * 3_600_000)
        Pm = np.where(np.isfinite(M) & (M > 0.55), np.where(P > 0.5, 0.99, 0.01), 0.5)
        for lo in (False, True):
            rets, hit, n = trades(h, Pm, R, T, A, B, 0.6, dev & np.isfinite(M), lo)
            rep["variants"].append({"h": h, "model": "ens+meta", "thr": 0.55, "long_only": lo, "brier": brier(P[dev], Y[dev]),
                                    "brier_base": base, "hit": hit, "trades": n, **stats(rets, h)})
        if "bh_dev" not in rep:  # buy and hold equal-weight over same development period
            vals = []
            for sym in rdata.PAIRS:
                d = F.load(sym)
                i0, i1 = np.searchsorted(d["t"], dev_start), np.searchsorted(d["t"], hold_t) - 1
                vals.append(d["c"][i1] / d["c"][i0] - 1)
            rep["bh_dev"] = float(np.mean(vals))
            rep["dev_from"] = time.strftime("%Y-%m-%d", time.gmtime(dev_start / 1000))
        log(f"h={h} meta done")
    srs = [v.get("sr_period", 0.0) for v in rep["variants"]]
    for v in rep["variants"]:
        v["dsr"], v["sr0"] = deflated_sharpe(v.get("sr_period", 0.0), v["n_periods"], v.get("skew", 0.0), v.get("kurt", 3.0), srs)
    rep["n_variants"] = len(rep["variants"])
    best = max(rep["variants"], key=lambda v: (v["dsr"], v["sharpe"]))
    rep["chosen"] = {k: best[k] for k in ("h", "model", "thr", "long_only")}
    # SOLE look at holdout, with selected variant
    h = best["h"]
    X, Y, R, T, A, B = cache[h]
    hold_t = T.max() - HOLDOUT_DAYS * 86_400_000
    hold = T >= hold_t
    tr_end = hold_t
    kind = "ens" if best["model"] == "ens+meta" else best["model"]
    P = walk(h, X, Y, T, kind, tr_end, T.max() + 1)
    rets, hit, n = trades(h, P, R, T, A, B, best["thr"], hold & np.isfinite(P), best["long_only"])
    bh_ret = float(np.mean([math.exp(np.log(F.load(s)["c"][-1] / F.load(s)["c"][np.searchsorted(F.load(s)["t"], hold_t)])) - 1 for s in rdata.PAIRS]))
    rep["holdout"] = {"from": time.strftime("%Y-%m-%d", time.gmtime(hold_t / 1000)), "brier": brier(P[hold], Y[hold]),
                      "brier_base": float(np.mean((Y[hold] - Y[hold].mean()) ** 2)), "hit": hit, "trades": n, **stats(rets, h),
                      "buy_hold_equal_weight": bh_ret, "note": "inspected only once"}
    rep["seconds"] = round(time.time() - t_start, 1)
    data.private_write(OUT, json.dumps(rep, ensure_ascii=False, default=float).encode())
    return rep


if __name__ == "__main__":
    r = run()
    print("variants:", r["n_variants"], "chosen:", r["chosen"], "holdout:", r["holdout"])
