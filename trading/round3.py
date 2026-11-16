"""Round 3 performance (crypto, daily/long-term horizon). All with public keyless data.

Design specified BEFORE looking at results (and recorded here):
- Development: BTC and ETH, 2020-01-01 -> today (already seen in earlier rounds: not proof on their own).
- NEW holdout, never before loaded by Cage: ETC, XLM, FIL, UNI, AAVE, ALGO, HBAR, VET (includes coins that
  collapsed, reducing survivorship bias vs BTC/ETH). Cross-asset holdout: same calendar, so only
  partially independent (cryptos co-move). Disclosed in the report.
- Counted variants (all, including failing ones) -> deflated Sharpe based on that trial count.
- Exposure between 0 and 1 (no leverage), decided with YESTERDAY's data and applied TODAY; cost per exposure change
  0.10% (Binance) or 0.05% (permissionless route, measured) — both reported.
- A variant is only adopted if: in development its deflated Sharpe > 0.95 AND in the holdout it beats buy and hold
  in Sharpe on at least 6 of 8 assets and on average. Otherwise, index strategy is retained and agent does not trade.
Additionally: valuation-based DCA (Mayer multiple) vs fixed DCA, rebalancing bands, and stablecoin yields
(the latter ONLY as comparative benchmark: not enabled).
"""
from __future__ import annotations

import json
import math
import statistics as stx
import time
from datetime import datetime, timezone

from trading import data, longterm, ltdata, ltpaper
from trading.rml import deflated_sharpe

DIR = data.DATA / "round3"
DEV = ["BTCUSDT", "ETHUSDT"]
HOLD = ["ETCUSDT", "XLMUSDT", "FILUSDT", "UNIUSDT", "AAVEUSDT", "ALGOUSDT", "HBARUSDT", "VETUSDT"]
FAPI = "https://fapi.binance.com/fapi/v1"
DAY = 86_400_000
START = "2020-01-01"
COSTS = {"binance": 0.0010, "dex": 0.0005}


def _day(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, timezone.utc).strftime("%Y-%m-%d")


def _cached(name: str, fetch, max_age=20 * 3600):
    DIR.mkdir(parents=True, exist_ok=True)
    p = DIR / name
    if p.is_file() and time.time() - p.stat().st_mtime < max_age:
        return json.loads(p.read_text())
    v = fetch()
    data.private_write(p, json.dumps(v, separators=(",", ":")).encode())
    return v


def _paged(url: str, t_idx: int, step: int) -> list:
    out, start = [], int(datetime(2019, 9, 1, tzinfo=timezone.utc).timestamp() * 1000)
    now = time.time() * 1000
    for _ in range(40):
        rows = data.get_json(f"{url}&startTime={start}")
        if not rows:
            break
        out += rows
        start = int(rows[-1][t_idx] if isinstance(rows[-1], list) else rows[-1]["fundingTime"]) + step
        if start > now or len(rows) < 500:
            break
        time.sleep(0.3)
    return out


def closes(sym):
    def f():
        rows = _paged(f"{data.BINANCE}/klines?symbol={sym}&interval=1d&limit=1000", 0, DAY)
        return {_day(int(k[0])): float(k[4]) for k in rows if int(k[6]) < time.time() * 1000}
    return _cached(f"{sym}-1d.json", f)


def funding(sym):
    def f():
        rows = _paged(f"{FAPI}/fundingRate?symbol={sym}&limit=1000", 0, 1)
        by = {}
        for r in rows:
            by.setdefault(_day(int(r["fundingTime"])), []).append(float(r["fundingRate"]))
        return {d: sum(v) for d, v in by.items()}  # daily sum (≈3 payments)
    return _cached(f"{sym}-funding.json", f)


def basis(sym):
    def f():
        rows = _paged(f"{FAPI}/premiumIndexKlines?symbol={sym}&interval=1d&limit=1000", 0, DAY)
        return {_day(int(k[0])): float(k[4]) for k in rows}
    return _cached(f"{sym}-basis.json", f)


def market():
    def f():
        st = data.get_json("https://stablecoins.llama.fi/stablecoincharts/all")
        tvl = data.get_json("https://api.llama.fi/v2/historicalChainTvl")
        tx = data.get_json("https://api.blockchain.info/charts/n-transactions?timespan=all&format=json&sampled=false")
        return {"stable": {_day(int(r["date"]) * 1000): r["totalCirculatingUSD"]["peggedUSD"] for r in st},
                "tvl": {_day(int(r["date"]) * 1000): r["tvl"] for r in tvl},
                "btc_tx": {_day(int(r["x"]) * 1000): r["y"] for r in tx["values"]}}
    return _cached("market.json", f)


def _ffill(days, m):
    out, last = [], None
    for d in days:
        last = m.get(d, last)
        out.append(last)
    return out


def _growth(col, i, n):
    a, b = (col[i - n] if i >= n else None), col[i]
    return (b / a - 1) if a and b else None


def _mean(col, i, n):
    xs = [x for x in col[max(0, i - n + 1): i + 1] if x is not None]
    return sum(xs) / len(xs) if len(xs) >= n // 2 else None


# ---------------------------------------------------------------- variantes (fijadas de antemano; todas cuentan)
def _v_fund(T):
    return lambda f, i: 0.5 if (m := _mean(f["fund"], i, 30)) is not None and m * 365 > T else 1.0


def _v_basis(T):
    return lambda f, i: 0.5 if (m := _mean(f["basis"], i, 7)) is not None and m > T else 1.0


def _v_growth(key, n, low):
    return lambda f, i: low if (g := _growth(f[key], i, n)) is not None and g < 0 else 1.0


def _v_trend(low):
    def fn(f, i):
        ma = _mean(f["px"], i, 200)
        return 1.0 if ma is None or f["px"][i] > ma else low
    return fn


def _v_vol(target):
    def fn(f, i):
        r = [math.log(f["px"][j] / f["px"][j - 1]) for j in range(max(1, i - 29), i + 1) if f["px"][j - 1]]
        if len(r) < 20:
            return 1.0
        v = stx.pstdev(r) * math.sqrt(365)
        return min(1.0, target / v) if v else 1.0
    return fn


def _v_combo(f, i):
    return min(_v_trend(0.0)(f, i), _v_growth("stable", 30, 0.5)(f, i))


VARIANTS = {
    "funding>10%": _v_fund(0.10), "funding>25%": _v_fund(0.25), "funding>50%": _v_fund(0.50),
    "basis>0.05%": _v_basis(0.0005), "basis>0.10%": _v_basis(0.0010),
    "stablecoins30d<0→50%": _v_growth("stable", 30, 0.5), "stablecoins30d<0→0%": _v_growth("stable", 30, 0.0),
    "TVL30d<0→50%": _v_growth("tvl", 30, 0.5), "txBTC90d<0→50%": _v_growth("btc_tx", 90, 0.5),
    "tendencia200→0%": _v_trend(0.0), "tendencia200→50%": _v_trend(0.5),
    "vol-objetivo60%": _v_vol(0.60), "vol-objetivo80%": _v_vol(0.80),
    "tendencia+stablecoins": _v_combo,
}


def frame(sym, mk):
    px = closes(sym)
    days = [d for d in sorted(px) if d >= "2019-09-01"]
    fu, ba = funding(sym), basis(sym)
    return {"days": days, "px": [px[d] for d in days], "fund": [fu.get(d) for d in days], "basis": [ba.get(d) for d in days],
            "stable": _ffill(days, mk["stable"]), "tvl": _ffill(days, mk["tvl"]), "btc_tx": _ffill(days, mk["btc_tx"])}


def backtest(f, rule, cost):
    """Net daily returns since START (or since asset reaches 200 days)."""
    s = max(next((i for i, d in enumerate(f["days"]) if d >= START), len(f["days"])), 200)
    out, e_prev = [], 1.0
    for i in range(s, len(f["days"])):
        e = 1.0 if rule is None else rule(f, i - 1)  # signal using YESTERDAY's data
        r = f["px"][i] / f["px"][i - 1] - 1
        out.append(e * r - cost * abs(e - e_prev))
        e_prev = e
    return out


def stats(r):
    if len(r) < 60:
        return None
    mu, sd = stx.fmean(r), stx.pstdev(r)
    eq, peak, dd = 1.0, 1.0, 0.0
    for x in r:
        eq *= 1 + x
        peak = max(peak, eq)
        dd = max(dd, 1 - eq / peak)
    n = len(r)
    sk = sum((x - mu) ** 3 for x in r) / n / sd ** 3 if sd else 0
    ku = sum((x - mu) ** 4 for x in r) / n / sd ** 4 if sd else 3
    return {"sharpe": mu / sd * math.sqrt(365) if sd else 0, "cagr": eq ** (365 / n) - 1, "max_dd": dd, "n": n,
            "sr_d": mu / sd if sd else 0, "skew": sk, "kurt": ku}


def _avg(rs):
    n = min(len(r) for r in rs)
    return [sum(r[-n:][k] for r in rs) / len(rs) for k in range(n)]


# ---------------------------------------------------------------- Valuation DCA and bands
def dca(f, mult=None, monthly=300.0, cash_yield=0.0):
    """Contributes `monthly` per month to a pot; invests monthly×mult (if available). Final value with identical contributions."""
    s = max(next(i for i, d in enumerate(f["days"]) if d >= START), 200)
    qty, cash, month, put = 0.0, 0.0, None, 0.0
    for i in range(s, len(f["days"])):
        cash *= (1 + cash_yield) ** (1 / 365)
        if f["days"][i][:7] != month:
            month = f["days"][i][:7]
            cash += monthly
            put += monthly
            k = 1.0
            if mult:
                ma = _mean(f["px"], i - 1, 200)
                mayer = f["px"][i - 1] / ma if ma else 1.0
                k = mult(mayer)
            buy = min(cash, monthly * k)
            qty += buy * (1 - COSTS["binance"]) / f["px"][i]
            cash -= buy
    return {"final": qty * f["px"][-1] + cash, "put": put, "cash_left": cash}


def mayer_rule(m):
    return 1.5 if m < 0.9 else 1.0 if m < 1.5 else 0.5 if m < 2.4 else 0.0


def bands_study():
    out = {}
    for kind in ("etf", "crypto"):
        days, px, _ = ltdata.table(ltpaper.SLEEVES[kind], refresh=False)
        start_i = next(i for i, d in enumerate(days) if d >= ("2021-01-01" if kind == "crypto" else "2018-01-01"))
        fn = longterm.STRATS[kind]["indexed"][1]
        rows = {}
        for band in (0.025, 0.05, 0.10, 0.20):
            longterm.BAND = band
            b, idx = longterm.run(days, px, fn, "moderado", kind, start_i=start_i)
            rows[f"{band:.3f}"] = {"total": idx[-1] - 1, "trades": len(b.s["log"]), "fees": b.s["fees"], "taxes": b.s["taxes"]}
        longterm.BAND = 0.05
        out[kind] = rows
    return out


def stable_yields():
    """Comparative only: average 1-year APY of largest audited USDC pools (Aave v3, Compound v3)."""
    pools = data.get_json("https://yields.llama.fi/pools")["data"]
    pick = [p for p in pools if p.get("symbol") == "USDC" and p.get("project") in ("aave-v3", "compound-v3")
            and p.get("chain") in ("Ethereum", "Base", "Arbitrum") and (p.get("tvlUsd") or 0) > 50e6]
    res = []
    for p in sorted(pick, key=lambda p: -p["tvlUsd"])[:4]:
        time.sleep(1)
        ch = data.get_json(f"https://yields.llama.fi/chart/{p['pool']}")["data"][-365:]
        apys = [x["apy"] for x in ch if x.get("apy") is not None]
        res.append({"project": p["project"], "chain": p["chain"], "tvl_musd": round(p["tvlUsd"] / 1e6),
                    "apy_365d_mean": round(stx.fmean(apys), 2) if apys else None, "apy_now": round(p.get("apy") or 0, 2)})
    return res


def main():
    t0 = time.time()
    mk = market()
    F = {s: frame(s, mk) for s in DEV + HOLD}
    out = {"design": __doc__.strip().split("\n\n")[1], "dev": DEV, "holdout": HOLD, "n_variants": len(VARIANTS), "costs": COSTS}
    for cname, cost in COSTS.items():
        bh_dev = stats(_avg([backtest(F[s], None, 0) for s in DEV]))
        res = {}
        srs = []
        bh = _avg([backtest(F[s], None, 0) for s in DEV])
        for name, rule in VARIANTS.items():
            v = _avg([backtest(F[s], rule, cost) for s in DEV])
            dev, ex = stats(v), stats([x - y for x, y in zip(v, bh)])  # daily excess vs buy-and-hold
            srs.append(ex["sr_d"])
            h = len(v) // 2
            res[name] = {"dev": dev, "excess": ex, "dev_first_half_dsharpe": stats(v[:h])["sharpe"] - stats(bh[:h])["sharpe"],
                         "dev_second_half_dsharpe": stats(v[h:])["sharpe"] - stats(bh[h:])["sharpe"],
                         "switches": sum(1 for i in range(1, len(F["BTCUSDT"]["days"])) if F["BTCUSDT"]["days"][i] >= START
                                         and rule(F["BTCUSDT"], i - 1) != rule(F["BTCUSDT"], i - 2))}
        for name, r in res.items():
            d = r["excess"]
            r["dsr"] = deflated_sharpe(d["sr_d"], d["n"], d["skew"], d["kurt"], srs)[0]  # is EXCESS genuine?
            hs = {}
            for s in HOLD:
                a, b = stats(backtest(F[s], VARIANTS[name], cost)), stats(backtest(F[s], None, 0))
                if a and b:
                    hs[s] = {"sharpe": a["sharpe"], "bh_sharpe": b["sharpe"], "cagr": a["cagr"], "bh_cagr": b["cagr"],
                             "max_dd": a["max_dd"], "bh_dd": b["max_dd"]}
            r["holdout"] = hs
            r["hold_wins"] = sum(v["sharpe"] > v["bh_sharpe"] for v in hs.values())
            r["hold_mean_dsharpe"] = stx.fmean(v["sharpe"] - v["bh_sharpe"] for v in hs.values()) if hs else None
            r["adopt"] = bool(r["dsr"] > 0.95 and r["hold_wins"] >= 6 and (r["hold_mean_dsharpe"] or 0) > 0
                             and r["dev_first_half_dsharpe"] > 0 and r["dev_second_half_dsharpe"] > 0)
        best = max(res, key=lambda k: res[k]["dev"]["sharpe"])
        out[cname] = {"bh_dev": bh_dev, "variants": res, "best_dev": best, "adopted": [k for k, v in res.items() if v["adopt"]]}
    out["dca"] = {s: {"fijo": dca(F[s]), "mayer": dca(F[s], mayer_rule)} for s in DEV + HOLD}
    out["bands"] = bands_study()
    try:
        out["stable_yields"] = stable_yields()
    except Exception as e:  # noqa: BLE001 - comparative data only
        out["stable_yields"] = {"error": str(e)[:120]}
    out["exchange_flows"] = "not included: exchange flow data is only available on paid or gated services (Glassnode, CryptoQuant)"
    out.update(ts=int(time.time()), seconds=round(time.time() - t0))
    data.private_write(data.HOME / "round3.json", json.dumps(out, default=float).encode())
    return out


if __name__ == "__main__":
    o = main()
    for c in COSTS:
        print("==", c, "B&H dev Sharpe %.2f" % o[c]["bh_dev"]["sharpe"], "adoptadas:", o[c]["adopted"])
        for k, v in sorted(o[c]["variants"].items(), key=lambda kv: -kv[1]["dev"]["sharpe"]):
            print(f"{k:24s} exSR {v['excess']['sharpe']:+.2f} mitades {v['dev_first_half_dsharpe']:+.2f}/{v['dev_second_half_dsharpe']:+.2f} cambios {v['switches']} devSR {v['dev']['sharpe']:.2f} cagr {v['dev']['cagr']:+.1%} dd {v['dev']['max_dd']:.0%} DSR {v['dsr']:.2f} | reserva gana {v['hold_wins']}/8 ΔSR {v['hold_mean_dsharpe']:+.2f}")
    print("DCA:", {s: round(v["mayer"]["final"] / v["fijo"]["final"] - 1, 3) for s, v in o["dca"].items()})
    print("bandas:", json.dumps(o["bands"])[:600])
    print("stable:", o["stable_yields"])
