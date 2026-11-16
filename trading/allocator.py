"""Allocator: decides WHAT to invest in and WHAT PERCENTAGE, with three separate roles and auditable log.

- Analyst: proposes CORE weights with several pre-specified methods (indexed by profile, risk parity,
  mean-variance with shrinkage, and minimum variance; caps per asset and joint crypto) and chooses with a rule written
  here, measured in backtest with costs and taxes: a method replaces indexed only if Sharpe improves ≥ 0.10,
  annual return drops no more than 0.25 points, and drawdown is not worse. Otherwise, indexed.
- Risk Officer (can VETO): profile caps, joint crypto, anomalous data, news brake, fast pocket stop.
- Executor: applies on PAPER and records order PROPOSALS (no broker for equities: executed by user).
Fast pocket: defaults to 5% (max 10%, user can lower it). Operates only patterns that passed tests in
the "20 per market" study (`movers.json` → `supported`). If none pass, stays in cash and panel reports it.
Fast pocket max drawdown: 15% from its peak → halts until reactivated by user.
Everything is benchmarked against the index (MSCI World) after costs and taxes. Real mode: OFF.
"""
from __future__ import annotations

import json
import math
import time

from trading import data, longterm as T, ltdata as L

STATE = data.HOME / "allocator.json"
LOG = data.HOME / "allocator-log.jsonl"
CORE = ["IWDA.AS", "EMIM.AS", "IEAG.AS", "XEON.DE", "4GLD.DE", "BTCUSDT", "ETHUSDT", "SOLUSDT"]
RISKY = ["IWDA.AS", "EMIM.AS", "4GLD.DE", "CRYPTO"]
CRYPTO_MIX = {"BTCUSDT": 0.6, "ETHUSDT": 0.3, "SOLUSDT": 0.1}
CAPS = {"IWDA.AS": 1.0, "EMIM.AS": 0.30, "4GLD.DE": 0.15}  # max fraction of equity portion
FAST_DEFAULT, FAST_MAX, FAST_STOP = 0.05, 0.10, 0.15
LOOK = 36  # months of history to estimate (no lookahead)
ROLE = {"IWDA.AS": "core global equities (~1,400 companies from developed markets)",
        "EMIM.AS": "emerging markets diversification", "IEAG.AS": "stabilizer: euro bonds",
        "XEON.DE": "cash buffer", "4GLD.DE": "partial hedge (gold)", "CRYPTO": "small, volatile crypto allocation (BTC/ETH/SOL 60/30/10)"}


# ---------------------------------------------------------------- estimación (solo con datos hasta el día i)
def _monthly(px, days, i, syms):
    ends = [k for k in range(1, i + 1) if days[k][:7] != days[k - 1][:7]][-(LOOK + 1):]
    rets = {s: [] for s in syms}
    for a, b in zip(ends, ends[1:]):
        for s in syms:
            if s == "CRYPTO":
                parts = [(w, px[c][a], px[c][b]) for c, w in CRYPTO_MIX.items() if px[c][a] and px[c][b]]
                tot = sum(w for w, _, _ in parts)
                rets[s].append(sum(w * (y / x - 1) for w, x, y in parts) / tot if tot else None)
            else:
                rets[s].append(px[s][b] / px[s][a] - 1 if px[s][a] and px[s][b] else None)
    ok = [k for k in range(len(ends) - 1) if all(rets[s][k] is not None for s in syms)]
    return {s: [rets[s][k] for k in ok] for s in syms}


def _cov(R, syms, shrink=0.5):
    n = len(R[syms[0]])
    mu = {s: sum(R[s]) / n for s in syms}
    C = [[sum((R[a][k] - mu[a]) * (R[b][k] - mu[b]) for k in range(n)) / max(1, n - 1) for b in syms] for a in syms]
    return [[C[i][j] * (1 if i == j else 1 - shrink) for j in range(len(syms))] for i in range(len(syms))], mu


def _solve(A, b):
    n = len(b)
    M = [row[:] + [b[i]] for i, row in enumerate(A)]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(M[r][c]))
        M[c], M[p] = M[p], M[c]
        if abs(M[c][c]) < 1e-14:
            return None
        for r in range(n):
            if r != c:
                f = M[r][c] / M[c][c]
                M[r] = [x - f * y for x, y in zip(M[r], M[c])]
    return [M[i][n] / M[i][i] for i in range(n)]


def _cap(w: dict, caps: dict) -> dict:
    """Pesos ≥ 0 que suman 1 respetando topes (reparte el exceso entre los que no están topados)."""
    w = {k: max(0.0, v) for k, v in w.items()}
    t = sum(w.values()) or 1
    w = {k: v / t for k, v in w.items()}
    for _ in range(20):
        over = {k: v - caps.get(k, 1) for k, v in w.items() if v > caps.get(k, 1) + 1e-12}
        if not over:
            break
        free = [k for k in w if k not in over and w[k] < caps.get(k, 1)]
        ex = sum(over.values())
        for k in over:
            w[k] = caps.get(k, 1)
        base = sum(w[k] for k in free) or len(free) or 1
        for k in free:
            w[k] += ex * (w[k] / base if sum(w[k2] for k2 in free) else 1 / len(free))
    return w


def risky_weights(method, px, days, i, prof):
    p = T.PROFILES[prof]
    syms = RISKY if p["crypto"] > 0 else [s for s in RISKY if s != "CRYPTO"]
    c = p["crypto"]
    rv_total = (1 - c) * p["rv"] + c  # la cripto es una parte del total; el resto se reparte como la indexada
    caps = dict(CAPS, CRYPTO=c / rv_total if rv_total else 0)
    if method == "indexed":
        w = {"IWDA.AS": 0.85, "EMIM.AS": 0.15}
        if p["crypto"]:
            w = {k: v * (1 - caps["CRYPTO"]) for k, v in w.items()} | {"CRYPTO": caps["CRYPTO"]}
        return w
    R = _monthly(px, days, i, syms)
    if len(R[syms[0]]) < 24:
        return risky_weights("indexed", px, days, i, prof)
    C, mu = _cov(R, syms)
    if method == "riskparity":
        w = {s: 1 / math.sqrt(C[k][k]) for k, s in enumerate(syms)}
    elif method == "minvar":
        x = _solve(C, [1.0] * len(syms))
        w = dict(zip(syms, x)) if x else {s: 1 for s in syms}
    elif method == "meanvar":  # medias contraídas al 75 % hacia la media común (las medias estimadas son ruido)
        g = sum(mu.values()) / len(mu)
        m = [0.25 * mu[s] + 0.75 * g for s in syms]
        x = _solve(C, m)
        w = dict(zip(syms, x)) if x else {s: 1 for s in syms}
    return _cap(w, caps)


def core_weights(method, px, days, i, prof):
    """Pesos finales sobre símbolos reales: renta variable (método) + bonos y liquidez fijados por el perfil."""
    p = T.PROFILES[prof]
    c = p["crypto"]
    tot = p["rv"] + p["rf"] + p["liq"]
    rv = (1 - c) * p["rv"] / tot + c
    out = {"IEAG.AS": (1 - c) * p["rf"] / tot, "XEON.DE": (1 - c) * p["liq"] / tot}
    for s, w in risky_weights(method, px, days, i, prof).items():
        if s == "CRYPTO":
            for c, cw in CRYPTO_MIX.items():
                if px[c][i]:
                    out[c] = out.get(c, 0) + rv * w * cw
        elif px[s][i]:
            out[s] = out.get(s, 0) + rv * w
    return out


METHODS = {"indexed": "Indexed by profile", "riskparity": "Risk parity (inverse volatility)",
           "minvar": "Minimum variance (shrunk covariance)", "meanvar": "Mean-variance with shrunk means"}


def backtest(prof="moderado", refresh=True):
    days, px, meta = L.table(CORE, refresh=refresh)
    start_i = next(k for k, d in enumerate(days) if d >= "2019-01-01")
    span = (__import__("datetime").date.fromisoformat(days[-1]) - __import__("datetime").date.fromisoformat(days[start_i])).days / 365.25
    res = {}
    for m in METHODS:
        b, idx = T.run(days, px, lambda px_, i, pr, m=m: core_weights(m, px_, days, i, pr), prof, "etf", start_i=start_i)
        res[m] = {"label": METHODS[m], **T.metrics(idx, span), "taxes": b.s["taxes"], "fees": b.s["fees"], "trades": len(b.s["log"])}
    b, idx = T.run(days, px, T.w_index, prof, "etf", start_i=start_i)
    res["index"] = {"label": "MSCI World Index", **T.metrics(idx, span), "taxes": b.s["taxes"], "fees": b.s["fees"], "trades": len(b.s["log"])}
    base = res["indexed"]
    for m in ("riskparity", "minvar", "meanvar"):
        r = res[m]
        r["adopt"] = bool(r["sharpe"] >= base["sharpe"] + 0.10 and r["cagr"] >= base["cagr"] - 0.0025 and r["max_dd"] <= base["max_dd"])
    pick = max((m for m in ("riskparity", "minvar", "meanvar") if res[m]["adopt"]), key=lambda m: res[m]["sharpe"], default="indexed")
    return {"from": days[start_i], "to": days[-1], "profile": prof, "methods": res, "chosen": pick, "n_variants": len(METHODS),
            "rule": "Replaces indexed only if Sharpe ≥ +0.10, annual return ≥ −0.25 pts, and max drawdown no worse."}, (days, px, meta)


# ---------------------------------------------------------------- roles
def analyst(prof, method, days, px, i):
    w = core_weights(method, px, days, i, prof)
    R = _monthly(px, days, i, [s for s in RISKY if s != "CRYPTO" or T.PROFILES[prof]["crypto"]])
    vols = {s: (sum(x * x for x in r) / len(r)) ** 0.5 * math.sqrt(12) for s, r in R.items() if r}
    why = {}
    from trading import news
    nst = news.load()
    for s, x in sorted(w.items(), key=lambda kv: -kv[1]):
        recent = news.for_asset(nst, s, 7)
        key = "CRYPTO" if s in CRYPTO_MIX else s
        tr = T.sma(px[s], i, 200)
        why[s] = {"weight": round(x, 4), "role": ROLE.get(key, ""),
                  "why_pct": (f"profile {prof}: {'bonds' if s == 'IEAG.AS' else 'cash'} set by profile" if s in ("IEAG.AS", "XEON.DE")
                              else f"'{METHODS[method]}' method within equity allocation" + (f"; 3-year volatility {vols[key]:.0%}" if key in vols else "")),
                  "trend": None if not tr else ("above" if px[s][i] > tr else "below") + " 200-session average (data point, not signal)",
                  "news": [{"title": n["title"][:140], "link": n.get("link"), "grave": bool(n.get("grave"))} for n in recent[:3]],
                  "news_note": ("7-day news: can only pause buys (news study showed no predictive edge)" if recent
                                else "no relevant news in 7 days"),
                  "invalidate": ("if you switch profile or method no longer meets rule at monthly review" if s not in CRYPTO_MIX
                                 else "if combined crypto exceeds profile cap or you switch profile")}
    return w, why


def risk_officer(w: dict, prof: str, meta: dict, st: dict) -> tuple[dict, list[str]]:
    from trading import news
    p, vetoes = T.PROFILES[prof], []
    w = dict(w)
    cr = sum(v for k, v in w.items() if k in CRYPTO_MIX)
    if cr > p["crypto"] + 1e-6:
        f = p["crypto"] / cr if cr else 0
        for k in CRYPTO_MIX:
            if k in w:
                w[k] *= f
        vetoes.append(f"crypto trimmed to {p['crypto']:.0%} (profile cap)")
    for s, m in meta.items():
        if m.get("anomalies") and w.get(s):
            vetoes.append(f"{s}: anomalous data ({'; '.join(m['anomalies'])[:80]}): no further buying today")
            w[s] = min(w[s], (st.get("weights") or {}).get(s, 0))
    nst = news.load()
    for s in list(w):
        why = news.risk_brake(nst, s)
        if why and w[s] > (st.get("weights") or {}).get(s, 0):
            vetoes.append(f"{s}: buying paused by news ({why[:80]})")
            w[s] = (st.get("weights") or {}).get(s, 0)
    return w, vetoes


def fast_pocket(st: dict, cfg: dict) -> dict:
    """Fast pocket: supported patterns only; if none, cash."""
    pk = st.get("fast") or {"value": None, "peak": None, "halted": None}
    share = min(FAST_MAX, max(0.0, float(cfg.get("fast_share", FAST_DEFAULT))))
    try:
        mv = json.loads((data.HOME / "movers.json").read_text())
        supported = mv.get("supported", [])
        n_tests = mv.get("n_tests")
    except (OSError, ValueError):
        supported, n_tests = [], None
    from trading import fastpocket
    rs = fastpocket.rules(mv) if supported else []
    pk.update(share=share, supported=supported, n_tests=n_tests, rules=[r["name"] for r in rs],
              status=("halted due to maximum loss" if pk.get("halted") else
                      "trading supported buy patterns (paper)" if rs else
                      "in cash: supported patterns are not buys (no shorting spot)" if supported else
                      "in cash: no pattern passed tests"))
    return pk


def daily(now=None, refresh=True) -> dict:
    now = now or time.time()
    today = time.strftime("%Y-%m-%d", time.localtime(now))
    from trading import ltpaper
    cfg = ltpaper.config()
    try:
        st = json.loads(STATE.read_text())
    except (OSError, ValueError):
        st = {}
    if not st.get("eval") or now - st["eval"].get("ts", 0) > 7 * 86400 or st["eval"].get("profile") != cfg["risk"]:
        ev, (days, px, meta) = backtest(cfg["risk"], refresh)
        ev["ts"] = int(now)
        st["eval"] = ev
    else:
        days, px, meta = L.table(CORE, refresh=refresh)
    method = st["eval"]["chosen"]
    i = len(days) - 1
    w, why = analyst(cfg["risk"], method, days, px, i)
    try:
        raw = json.loads(ltpaper.CONFIG.read_text())
    except (OSError, ValueError):
        raw = {}
    fast = fast_pocket(st, raw)
    core_share = 1 - fast["share"]
    w = {k: v * core_share for k, v in w.items()}
    if fast.get("rules") and not fast.get("halted"):  # el bolsillo opera su parte del capital, aparte del núcleo
        from trading import fastpocket
        rs = fastpocket.rules(json.loads((data.HOME / "movers.json").read_text()))
        book_val = (st.get("value") or cfg["start"])
        fast.update(fastpocket.step(fast, fast.get("budget") or fast["share"] * book_val, rs, today))
        fast.setdefault("budget", fast["share"] * book_val)
        fast["pnl"] = fast["value"] - fast["budget"]
    # el libro reserva el bolsillo en liquidez; el bolsillo opera esa reserva de forma NOCIONAL y su resultado se
    # muestra aparte (pnl), para no contar dos veces el mismo dinero
    w["XEON.DE"] = w.get("XEON.DE", 0) + fast["share"]
    w, vetoes = risk_officer(w, cfg["risk"], meta, st)
    # ejecutor (papel)
    prices = {s: px[s][i] for s in px if px[s][i]}
    b = T.Book(state=st.get("book") or T.Book(cfg["start"], kind="etf").s, kind="etf")
    if st.get("tax_year") and st["tax_year"] != today[:4]:
        T.settle_year(b.s, st["tax_year"])
    st["tax_year"] = today[:4]
    reason, before = None, len(b.s["log"])
    cur = b.weights(prices)
    if st.get("month") != today[:7]:
        if st.get("month"):
            b.contribute(cfg["monthly"])
        st["month"] = today[:7]
        reason = "monthly contribution"
    breach = any(abs(w.get(s, 0) - cur.get(s, 0)) > T.BAND for s in set(w) | set(cur))
    if breach and not reason:
        reason = "band rebalancing"
    if reason:
        b.rebalance(w, prices, today, reason, only_buy=not (breach or not st.get("history")))
    orders = b.s["log"][before:]
    val = b.value(prices)
    hist = st.get("history") or []
    if not hist or hist[-1][0] != today:
        hist.append([today, round(val, 2), round(b.s["contributed"], 2)])
    else:
        hist[-1] = [today, round(val, 2), round(b.s["contributed"], 2)]
    st.update(book=b.s, history=hist[-3650:], target={k: round(v, 4) for k, v in w.items()}, why=why, vetoes=vetoes, fast=fast,
              weights={k: round(v, 4) for k, v in b.weights(prices).items()}, value=round(val, 2), method=method, ts=int(now),
              proposals=[{**o, "note": "proposal: paper already simulated; with real money you would execute it"} for o in orders] or st.get("proposals", []),
              real="OFF")
    data.private_write(STATE, json.dumps(st, separators=(",", ":")).encode())
    with open(LOG, "a") as f:  # auditable log: what analyst proposed, what risk vetoed, what executor did
        f.write(json.dumps({"ts": int(now), "day": today, "method": method, "target": st["target"], "vetoes": vetoes,
                            "orders": orders, "fast": {k: fast.get(k) for k in ("share", "status")}, "value": round(val, 2)}) + "\n")
    LOG.chmod(0o600)
    return st


if __name__ == "__main__":
    ev, _ = backtest("moderado", refresh=False)
    for m, r in ev["methods"].items():
        print(f"{r['label'][:44]:44s} CAGR {r['cagr']:+.2%} vol {r['vol']:.1%} DD {r['max_dd']:.1%} Sharpe {r['sharpe']:.2f} imp {r['taxes']:.0f} adopt {r.get('adopt')}")
    print("elegido:", ev["chosen"], ev["from"], ev["to"])
