"""Study "20 per market", part 3: what happens NEXT? Statistics without lookahead bias and with multiple testing.

Hypotheses specified BEFORE seeing results (all count for correction):
 A. After an episode (rise/drop) of each cause, excess over market at 5, 20 and 60 sessions, measured from close
    of NEXT day (actionable). Clustered by date to avoid counting the same market day 20 times.
 B. Post-earnings drift: positive surprise and rise -> keeps rising; negative surprise and drop -> keeps falling.
 C. 12-1 month momentum within each market (top 5 vs bottom 5, next month).
 D. Weekly reversal (worst 5 of the week vs best 5, next week).
 E. Seasonality: November-April vs May-October; turn of month vs rest.
Development up to 2021-12-31; reserved NEW holdout 2022-01-01 -> today (these hypotheses were never inspected there).
A pattern "is supported" if: significant in dev after Benjamini-Hochberg (q = 5%), same sign and p < 0.05 in
the holdout, and (if tradable) effect exceeds round-trip costs. Otherwise, "not supported".
"""
from __future__ import annotations

import json
import math
import random
import statistics as stx
import time

from trading import data
from trading.movers import DIR
from trading.universe import MARKETS

SPLIT = "2022-01-01"
COST_RT = {"equity": 0.003, "crypto": 0.004}  # round-trip with spread (conservative)
GROUPS = {"resultados": ["resultados"], "previsiones/analistas": ["previsiones", "analistas"],
          "otra noticia": ["legal/regulación", "fusiones/operaciones", "producto/negocio", "directivos", "cripto", "macro"],
          "sector": ["sector"], "mercado/macro": ["mercado/macro"], "sin causa": ["sin causa identificada"]}


def _p_norm(t):
    return math.erfc(abs(t) / math.sqrt(2))


def clustered(rows: list[tuple[str, float]], seed=7) -> dict | None:
    """rows: (date, value). Mean by date -> t-test and 95% bootstrap over dates."""
    by = {}
    for d, v in rows:
        by.setdefault(d, []).append(v)
    xs = [sum(v) / len(v) for v in by.values()]
    if len(xs) < 8:
        return {"n": len(rows), "n_dates": len(xs), "mean": stx.fmean(xs) if xs else None, "p": None, "ci": None}
    m, sd = stx.fmean(xs), stx.stdev(xs)
    t = m / (sd / math.sqrt(len(xs))) if sd else 0
    rnd = random.Random(seed)
    bs = sorted(stx.fmean(rnd.choices(xs, k=len(xs))) for _ in range(1000))
    return {"n": len(rows), "n_dates": len(xs), "mean": m, "t": t, "p": _p_norm(t), "ci": [bs[25], bs[974]]}


def bh(pvals: list[float], q=0.05) -> list[bool]:
    idx = sorted(range(len(pvals)), key=lambda i: pvals[i])
    k = 0
    for r, i in enumerate(idx, 1):
        if pvals[i] <= q * r / len(pvals):
            k = r
    ok = set(idx[:k])
    return [i in ok for i in range(len(pvals))]


def _cause_group(c):
    return next((g for g, cs in GROUPS.items() if c in cs), None)


def episode_tests(E: dict) -> list[dict]:
    tests = []
    for kind in ("equity", "crypto"):
        for direction in ("baja", "sube"):
            for g in GROUPS:
                for h in (5, 20, 60):
                    rows = {"dev": [], "hold": []}
                    for a in E.values():
                        if a.get("error") or (a["market"] == "crypto") != (kind == "crypto"):
                            continue
                        for e in a["episodes"]:
                            if e["dir"] == direction and _cause_group(e.get("cause")) == g and f"nx{h}" in e:
                                rows["dev" if e["date"] < SPLIT else "hold"].append((e["date"], e[f"nx{h}"]))
                    if len(rows["dev"]) < 10:
                        continue
                    tests.append({"family": "A", "name": f"{'Cripto' if kind == 'crypto' else 'Acciones'}: tras {direction} por {g}, {h} sesiones",
                                  "kind": kind, "dir": direction, "group": g, "h": h, "dev": clustered(rows["dev"]), "hold": clustered(rows["hold"]),
                                  "tradable": True})
    # B: deriva tras resultados según sorpresa
    for sign, direction in (("+", "sube"), ("-", "baja")):
        for h in (20, 60):
            rows = {"dev": [], "hold": []}
            for a in E.values():
                for e in a.get("episodes", []):
                    s = _num(e.get("surprise"))
                    if e.get("cause") == "resultados" and e["dir"] == direction and s is not None and (s > 0) == (sign == "+") and f"nx{h}" in e:
                        rows["dev" if e["date"] < SPLIT else "hold"].append((e["date"], e[f"nx{h}"]))
            if len(rows["dev"]) >= 10:
                tests.append({"family": "B", "name": f"Deriva tras resultados: sorpresa {sign} y {direction}, {h} sesiones", "kind": "equity",
                              "dir": direction, "h": h, "dev": clustered(rows["dev"]), "hold": clustered(rows["hold"]), "tradable": True})
    return tests


def _num(s):
    try:
        return float(str(s).replace("%", "").replace(",", ""))
    except (TypeError, ValueError):
        return None


def _panel(market):
    px = {}
    for s in MARKETS[market]["tickers"]:
        p = DIR / (s.replace("^", "_") + ".json")
        if p.is_file():
            px[s] = json.loads(p.read_text())
    return px


def _period_closes(px, key):
    """Last close of each period (key: date -> period label function)."""
    out = {}
    for s, ser in px.items():
        for d in sorted(ser):
            out.setdefault(key(d), {})[s] = ser[d]
    return [(k, out[k]) for k in sorted(out)]


def _ls(series, look, skip, k=5):
    """Long top k / short worst k portfolio by return of `look` periods skipping `skip`; returns (date, spread)."""
    rows = []
    for t in range(look + 1, len(series) - 1):
        cur, past, recent, nxt = series[t][1], series[t - look][1], series[t - skip][1], series[t + 1][1]
        sc = {s: recent[s] / past[s] - 1 for s in cur if s in past and s in recent and s in nxt and past[s] and recent[s]}
        if len(sc) < 2 * k + 2:
            continue
        order = sorted(sc, key=sc.get)
        fwd = {s: nxt[s] / cur[s] - 1 for s in sc if cur.get(s)}
        lo, hi = order[:k], order[-k:]
        rows.append((series[t][0], stx.fmean(fwd[s] for s in hi) - stx.fmean(fwd[s] for s in lo)))
    return rows


def cross_tests() -> list[dict]:
    import datetime as dt
    tests = []
    for kind, markets in (("equity", ["us", "eu", "asia"]), ("crypto", ["crypto"])):
        mom, rev = [], []
        for m in markets:
            px = _panel(m)
            mon = _period_closes(px, lambda d: d[:7])
            mom += [(f"{d}-{m}", v) for d, v in _ls(mon, 12, 1)]
            wk = _period_closes(px, lambda d: "%d-%02d" % dt.date.fromisoformat(d).isocalendar()[:2])
            rev += [(f"{d}-{m}", -v) for d, v in _ls(wk, 1, 0)]  # -: buy losers, sell winners
        for name, rows, label in (("C", mom, "Momentum 12-1: top 5 minus bottom 5, next month"),
                                  ("D", rev, "Weekly reversal: bottom 5 minus top 5, next week")):
            dev = [(d, v) for d, v in rows if d[:7] < SPLIT[:7]]
            hold = [(d, v) for d, v in rows if d[:7] >= SPLIT[:7]]
            tests.append({"family": name, "name": f"{'Crypto' if kind == 'crypto' else 'Equities'} · {label}", "kind": kind,
                          "dev": clustered(dev), "hold": clustered(hold), "tradable": True, "two_legs": True})
    # E: seasonality on indices (or BTC). Difference of means per year (winter-summer) and per month (turn of month-rest)
    for kind, syms in (("equity", ["^GSPC", "^STOXX", "^N225"]), ("crypto", ["BTCUSDT"])):
        win, tom = {"dev": [], "hold": []}, {"dev": [], "hold": []}
        for s in syms:
            p = DIR / (s.replace("^", "_") + ".json")
            if not p.is_file():
                continue
            ser = json.loads(p.read_text())
            ds = sorted(ser)
            per_year, per_month = {}, {}
            for i in range(1, len(ds)):
                r = ser[ds[i]] / ser[ds[i - 1]] - 1
                y = int(ds[i][:4]) - (1 if int(ds[i][5:7]) <= 4 else 0)  # "seasonal" year: Nov-Apr crosses calendar year
                per_year.setdefault(y, {"w": [], "s": []})["w" if int(ds[i][5:7]) in (11, 12, 1, 2, 3, 4) else "s"].append(r)
                last = i + 1 < len(ds) and ds[i + 1][:7] != ds[i][:7]
                first3 = any(i - k >= 0 and ds[i - k][:7] != ds[i][:7] for k in (1, 2, 3))
                per_month.setdefault(ds[i][:7], {"t": [], "o": []})["t" if (last or first3) else "o"].append(r)
            for y, v in per_year.items():
                if v["w"] and v["s"]:
                    win["dev" if f"{y + 1}-05" <= SPLIT[:7] else "hold"].append((f"{y}{s}", stx.fmean(v["w"]) - stx.fmean(v["s"])))
            for mth, v in per_month.items():
                if v["t"] and v["o"]:
                    tom["dev" if mth < SPLIT[:7] else "hold"].append((mth + s, stx.fmean(v["t"]) - stx.fmean(v["o"])))
        for name, rows, label in (("E", win, "Seasonality: November-April minus May-October (mean daily return)"),
                                  ("E", tom, "Turn of month minus other days (mean daily return)")):
            tests.append({"family": name, "name": f"{'Crypto' if kind == 'crypto' else 'Equities'} · {label}", "kind": kind,
                          "dev": clustered(rows["dev"]), "hold": clustered(rows["hold"]), "tradable": False})
    return tests


def summarize(E: dict) -> dict:
    tests = episode_tests(E) + cross_tests()
    ps = [t["dev"]["p"] if t["dev"] and t["dev"].get("p") is not None else 1.0 for t in tests]
    sig = bh(ps)
    for t, s in zip(tests, sig):
        d, h = t["dev"], t["hold"] or {}
        t["dev_sig_bh"] = s
        same = d.get("mean") is not None and h.get("mean") is not None and (d["mean"] > 0) == (h["mean"] > 0)
        t["hold_ok"] = bool(same and h.get("p") is not None and h["p"] < 0.05)
        cost = COST_RT[t["kind"]] * (2 if t.get("two_legs") else 1)
        t["beats_costs"] = (not t["tradable"]) or (h.get("mean") is not None and abs(h["mean"]) > cost)
        t["supported"] = bool(s and t["hold_ok"] and t["beats_costs"])
    # summary by company: what typically happens after its drops and rises
    cards = {}
    for sym, a in E.items():
        if a.get("error"):
            cards[sym] = {"error": a["error"]}
            continue
        eps = a["episodes"]
        def avg(direction, h):
            xs = [e[f"nx{h}"] for e in eps if e["dir"] == direction and f"nx{h}" in e]
            return {"n": len(xs), "mean": stx.fmean(xs) if xs else None, "pos": sum(x > 0 for x in xs) / len(xs) if xs else None}
        causes = {}
        for e in eps:
            causes[e.get("cause") or "?"] = causes.get(e.get("cause") or "?", 0) + 1
        cards[sym] = {"name": a["name"], "market": a["market"], "sector": a["sector"], "n": len(eps), "causes": causes,
                      "after_drop": {h: avg("baja", h) for h in (5, 20, 60)}, "after_rise": {h: avg("sube", h) for h in (5, 20, 60)},
                      "episodes": sorted(eps, key=lambda e: e["date"], reverse=True)[:60],
                      "recover_median": stx.median([e["recover_days"] for e in eps if e["dir"] == "baja" and e.get("recover_days")] or [0])}
    n_eps = sum(len(a.get("episodes", [])) for a in E.values())
    attributed = sum(1 for a in E.values() for e in a.get("episodes", []) if e.get("cause") and not e["cause"].startswith("sin"))
    return {"ts": int(time.time()), "split": SPLIT, "n_tests": len(tests), "tests": tests, "cards": cards, "n_episodes": n_eps,
            "attributed": attributed, "supported": [t["name"] for t in tests if t["supported"]],
            "bias": ("Universe selected by market cap at end of 2015 (crypto: 2021-01-01), with losers included. Companies that "
                     "delisted (no free data) are omitted: residual survivorship bias. News only from 2017 onwards and only "
                     "English headlines from reliable outlets; earnings via Nasdaq calendar (companies without ADR: no earnings date).")}


if __name__ == "__main__":
    E = json.loads((DIR / "episodes_why.json").read_text())
    out = summarize(E)
    data.private_write(data.HOME / "movers.json", json.dumps(out, default=float, separators=(",", ":")).encode())
    print(out["n_episodes"], "episodes,", out["attributed"], "attributed;", out["n_tests"], "hypotheses")
    for t in out["tests"]:
        d, h = t["dev"], t["hold"] or {}
        f = lambda x: "—" if x is None else f"{x:+.2%}"  # noqa: E731
        print(f"{'✔' if t['supported'] else ' '} {t['name'][:78]:78s} dev {f(d.get('mean'))} p={d.get('p') or 1:.3f} n={d.get('n_dates')} | res {f(h.get('mean'))} p={(h.get('p') or 1):.3f} n={h.get('n_dates')}")
