"""Automatic monthly re-evaluation with NEW data (prospective), without re-selecting anything.

Re-selecting variants each month on all history would cause overfitting. Here the rules remain FIXED and we only measure
how they perform with data that has arrived since selection. This forward period grows each month and is the cleanest
possible test (nobody saw it before deciding):
1. Paper portfolios (allocator, long term) vs their benchmark, since inception.
2. Round 3 variants (crypto): excess over buy-and-hold since study date.
3. Patterns from the "20 per market" study: episodes after the study and subsequent performance.
Once a year (or if the user requests it), full research is repeated with a new holdout period.
"""
from __future__ import annotations

import json
import math
import statistics as stx
import time

from trading import data

OUT = data.HOME / "reevals.json"


def _rj(p, default=None):
    try:
        return json.loads(p.read_text())
    except (OSError, ValueError):
        return default if default is not None else {}


def _ci(xs):
    if len(xs) < 5:
        return None
    m, sd = stx.fmean(xs), stx.stdev(xs)
    h = 1.96 * sd / math.sqrt(len(xs))
    return [m - h, m + h]


def papers() -> dict:
    """Value of paper portfolios vs benchmark over same period (with identical contributions)."""
    from trading import ltdata as L
    out = {}
    a = _rj(data.HOME / "allocator.json")
    lt = _rj(data.HOME / "longterm.json")
    for name, hist in (("allocator", a.get("history")), *[(f"long term · {k}", (s or {}).get("history")) for k, s in (lt.get("sleeves") or {}).items()]):
        if not hist or len(hist) < 2:
            out[name] = {"days": len(hist or []), "note": "still few days"}
            continue
        try:
            idx = dict(L.load("IWDA.AS")["rows"])
        except Exception:  # noqa: BLE001
            idx = {}
        d0, d1 = hist[0][0], hist[-1][0]
        r_book = (hist[-1][1] - (hist[-1][2] - hist[0][2])) / hist[0][1] - 1 if hist[0][1] else None  # excluding contributions
        i0 = next((idx[k] for k in sorted(idx) if k >= d0), None)
        i1 = next((idx[k] for k in sorted(idx, reverse=True) if k <= d1), None)
        out[name] = {"from": d0, "to": d1, "days": len(hist), "ret": r_book, "index_ret": (i1 / i0 - 1) if i0 and i1 else None}
    return out


def round3_forward() -> dict:
    from trading import round3
    r3 = _rj(data.HOME / "round3.json")
    if not r3:
        return {}
    since = time.strftime("%Y-%m-%d", time.gmtime(r3["ts"]))
    res = {}
    for name, rule in round3.VARIANTS.items():
        ex = []
        for s in round3.DEV + round3.HOLD:
            try:
                f = round3.frame(s, round3.market())
            except Exception:  # noqa: BLE001
                continue
            k0 = next((i for i, d in enumerate(f["days"]) if d > since), None)
            if k0 is None or k0 < 201:
                continue
            for i in range(k0, len(f["days"])):
                r = f["px"][i] / f["px"][i - 1] - 1
                ex.append(rule(f, i - 1) * r - r)
        res[name] = {"n": len(ex), "excess_mean_daily": stx.fmean(ex) if ex else None, "ci": _ci(ex)}
    return {"since": since, "variants": res}


def movers_forward() -> dict:
    mv = _rj(data.HOME / "movers.json")
    if not mv:
        return {}
    since = time.strftime("%Y-%m-%d", time.gmtime(mv["ts"]))
    from trading import movers
    from trading.universe import MARKETS
    rows, cand = {}, {}
    for m, d in MARKETS.items():
        for s in d["tickers"]:
            try:
                a = movers.analyse(m, s, recent=80)
            except Exception:  # noqa: BLE001
                continue
            new = [e for e in a["episodes"] if e["date"] > since]
            if new and m != "crypto":  # cause (earnings) to track "post-earnings drift" candidates
                from trading import moverwhy
                moverwhy.attribute({s: {**a, "episodes": new}}, log=lambda *_: None)
            for e in new:
                if "nx5" in e:
                    rows.setdefault((("crypto" if m == "crypto" else "equity"), e["dir"]), []).append(e["nx5"])
                if e.get("cause") == "resultados" and e["dir"] == "sube":
                    for h in (20, 60):
                        if f"nx{h}" in e:
                            cand.setdefault(f"after rise from earnings, {h} sessions", []).append(e[f"nx{h}"])
    return {"since": since, "candidates": {k: {"n": len(v), "mean": stx.fmean(v), "ci": _ci(v)} for k, v in cand.items()},
            "after_5_sessions": {f"{k}·{dr}": {"n": len(v), "mean": stx.fmean(v), "ci": _ci(v)} for (k, dr), v in rows.items()}}


def run(force: bool = False) -> dict:
    hist = _rj(OUT, {"runs": []})
    month = time.strftime("%Y-%m")
    if not force and hist["runs"] and hist["runs"][-1]["month"] == month:
        return hist
    rep = {"month": month, "ts": int(time.time()), "papers": papers()}
    for k, fn in (("round3", round3_forward), ("movers", movers_forward)):
        try:
            rep[k] = fn()
        except Exception as exc:  # noqa: BLE001 - logged, not invented
            rep[k] = {"error": str(exc)[:160]}
    hist["runs"] = (hist["runs"] + [rep])[-36:]
    data.private_write(OUT, json.dumps(hist, default=float).encode())
    return hist


if __name__ == "__main__":
    print(json.dumps(run(force=True)["runs"][-1], default=float)[:2000])
