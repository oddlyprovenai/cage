"""On-chain study with Blockchair (BTC and ETH), with the same rigor as earlier rounds.

Design specified BEFORE looking at results:
- Daily data from Blockchair blocks table: transactions, fees (USD), volume (USD), coin days
  destroyed (CDD, BTC only). Exchange flows: Blockchair does not label exchange addresses -> "no data" (reported).
- Variants (all count for deflated Sharpe): exposure 1 or 0.5 according to a rule with YESTERDAY's data.
- Development: 2020-01-01 -> today. RESERVED period: 2017-07-01 -> 2019-12-31 (daily BTC and ETH from those
  years were never used to select rules with these variables). Costs 0.10% per exposure change.
- A variant only enters if: excess DSR over buy and hold > 0.95, improves in both halves of development,
  and in the reserved period improves Sharpe in both BTC and ETH. Otherwise, remains as CONTEXT in panel.
"""
from __future__ import annotations

import json
import math
import statistics as stx
import time

from trading import blockchair as bc, data, movers
from trading.rml import deflated_sharpe

OUT = data.HOME / "onchain.json"
DEV, RESERVED = ("2020-01-01", None), ("2017-07-01", "2019-12-31")
COST = 0.001
ASSETS = {"BTCUSDT": "bitcoin", "ETHUSDT": "ethereum"}


def series(chain: str) -> dict[str, dict]:
    rows = bc.daily(chain, "2017-01-01", time.strftime("%Y-%m-%d"))
    out = {}
    for r in rows:
        d = str(r.get("date"))[:10]
        if chain == "bitcoin":
            out[d] = {"tx": r.get("sum(transaction_count)"), "fee": r.get("sum(fee_total_usd)"), "vol": r.get("sum(output_total_usd)"), "cdd": r.get("sum(cdd_total)")}
        else:
            out[d] = {"tx": r.get("sum(transaction_count)"), "fee": r.get("sum(fee_total_usd)"), "vol": r.get("sum(value_total_usd)"), "cdd": None}
    return out


def _mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def _z(col, i, short, long):
    a, b = _mean(col[max(0, i - short + 1): i + 1]), col[max(0, i - long + 1): i + 1]
    b = [x for x in b if x is not None]
    if a is None or len(b) < long // 2:
        return None
    m, sd = stx.fmean(b), stx.pstdev(b)
    return (a - m) / sd if sd else None


def _growth(col, i, n):
    a, b = _mean(col[max(0, i - 6): i + 1]), _mean(col[max(0, i - n - 6): i - n + 1]) if i >= n else None
    return (a / b - 1) if a and b else None


VARIANTS = {
    "comisiones altas (z30/365 > 2) → 50 %": lambda f, i: 0.5 if (z := _z(f["fee"], i, 30, 365)) is not None and z > 2 else 1.0,
    "comisiones bajando (30 d) → 50 %": lambda f, i: 0.5 if (g := _growth(f["fee"], i, 30)) is not None and g < 0 else 1.0,
    "transacciones bajando (30 d) → 50 %": lambda f, i: 0.5 if (g := _growth(f["tx"], i, 30)) is not None and g < 0 else 1.0,
    "volumen bajando (30 d) → 50 %": lambda f, i: 0.5 if (g := _growth(f["vol"], i, 30)) is not None and g < 0 else 1.0,
    "monedas viejas moviéndose (CDD z7/365 > 2) → 50 %": lambda f, i: 0.5 if f["cdd"][i] is not None and (z := _z(f["cdd"], i, 7, 365)) is not None and z > 2 else 1.0,
    "volumen disparado (z7/365 > 2) → 50 %": lambda f, i: 0.5 if (z := _z(f["vol"], i, 7, 365)) is not None and z > 2 else 1.0,
}


def frame(sym: str, chain: str) -> dict:
    px = movers.fetch(sym)
    oc = series(chain)
    days = [d for d in sorted(px) if d in oc]
    return {"days": days, "px": [px[d] for d in days], **{k: [oc[d][k] for d in days] for k in ("tx", "fee", "vol", "cdd")}}


def run_rule(f, rule, lo, hi):
    out, prev = [], 1.0
    for i in range(1, len(f["days"])):
        d = f["days"][i]
        if d < lo or (hi and d > hi):
            continue
        e = 1.0 if rule is None else rule(f, i - 1)
        r = f["px"][i] / f["px"][i - 1] - 1
        out.append(e * r - COST * abs(e - prev))
        prev = e
    return out


def stats(r):
    if len(r) < 60:
        return None
    mu, sd = stx.fmean(r), stx.pstdev(r)
    n = len(r)
    sk = sum((x - mu) ** 3 for x in r) / n / sd ** 3 if sd else 0
    ku = sum((x - mu) ** 4 for x in r) / n / sd ** 4 if sd else 3
    return {"sharpe": mu / sd * math.sqrt(365) if sd else 0, "sr_d": mu / sd if sd else 0, "n": n, "skew": sk, "kurt": ku}


def main() -> dict:
    t0 = time.time()
    F = {s: frame(s, c) for s, c in ASSETS.items()}
    res, srs = {}, []
    for name, rule in VARIANTS.items():
        ex = []
        halves, reserved = [], {}
        for s, f in F.items():
            v, b = run_rule(f, rule, DEV[0], DEV[1]), run_rule(f, None, DEV[0], DEV[1])
            ex += [x - y for x, y in zip(v, b)]
            h = len(v) // 2
            halves.append((stats(v[:h])["sharpe"] - stats(b[:h])["sharpe"], stats(v[h:])["sharpe"] - stats(b[h:])["sharpe"]))
            rv, rb = stats(run_rule(f, rule, *RESERVED)), stats(run_rule(f, None, *RESERVED))
            reserved[s] = {"dsharpe": (rv["sharpe"] - rb["sharpe"]) if rv and rb else None}
        st = stats(ex)
        srs.append(st["sr_d"])
        res[name] = {"excess_sharpe": st["sharpe"], "_st": st, "halves": halves, "reserved": reserved}
    for name, r in res.items():
        st = r.pop("_st")
        r["dsr"] = deflated_sharpe(st["sr_d"], st["n"], st["skew"], st["kurt"], srs)[0]
        r["adopt"] = bool(r["dsr"] > 0.95 and all(a > 0 and b > 0 for a, b in r["halves"])
                          and all((x["dsharpe"] or 0) > 0 for x in r["reserved"].values()))
    out = {"ts": int(time.time()), "dev": DEV, "reserved": RESERVED, "n_variants": len(VARIANTS), "variants": res,
           "adopted": [k for k, v in res.items() if v["adopt"]], "seconds": round(time.time() - t0),
           "exchange_flows": "no data: Blockchair does not label exchange addresses",
           "snapshot": {c: bc.snapshot(c) for c in ASSETS.values()}, "usage": bc.usage()}
    data.private_write(OUT, json.dumps(out, default=float).encode())
    return out


if __name__ == "__main__":
    o = main()
    for k, v in o["variants"].items():
        print(f"{k:52s} exceso SR {v['excess_sharpe']:+.2f} DSR {v['dsr']:.2f} reservado {[round(x['dsharpe'] or 0, 2) for x in v['reserved'].values()]} adopt {v['adopt']}")
