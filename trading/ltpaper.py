"""Long-term 24/7 PAPER portfolios (stocks/ETFs and crypto). Once daily: real prices, contributions on the first
day of each month, band rebalancing, and logging each decision with rationale. Orders that would be executed with real
money are stored as PROPOSALS for the user to execute manually (no broker connected for equities).
"""
from __future__ import annotations

import json
import time

from trading import data, longterm as T, ltdata as L

STATE = data.HOME / "longterm.json"
CONFIG = data.HOME / "invest_config.json"
SLEEVES = {"etf": list(L.ETF) + list(L.STOCKS), "crypto": list(L.CRYPTO)}


def config() -> dict:
    """Configured by user in Cage (profile, monthly contribution). Defaults if none yet: shown in the panel."""
    try:
        c = json.loads(CONFIG.read_text())
    except (OSError, ValueError):
        c = {}
    prof = c.get("risk") if c.get("risk") in T.PROFILES else "moderado"
    monthly = float(c["monthly"]) if c.get("monthly") is not None else 300.0
    share = T.PROFILES[prof]["crypto"]
    return {"risk": prof, "monthly": monthly, "start": float(c.get("start") or 10_000.0), "crypto_share": share,
            "defaults": not c, "strategy": c.get("strategy") or {}}


def load_state() -> dict:
    try:
        return json.loads(STATE.read_text())
    except (OSError, ValueError):
        return {"sleeves": {}, "eval": {}}


def daily(now: float | None = None, refresh: bool = True, force: bool = False) -> dict:
    now = now or time.time()
    cfg, st = config(), load_state()
    today = time.strftime("%Y-%m-%d", time.localtime(now))
    for kind, syms in SLEEVES.items():
        days, px, meta = L.table(syms, refresh=refresh)
        ev = st["eval"].get(kind)
        if force or not ev or now - ev.get("ts", 0) > 7 * 86400 or ev.get("profile") != cfg["risk"] or (kind == "etf" and "plan" not in ev):
            ev = T.evaluate(days, px, kind, cfg["risk"])
            ev["ts"] = int(now)
            ev["sources"] = {s: m["source"] + " · " + (m["last"] or "?") for s, m in meta.items()}
            ev["anomalies"] = {s: m["anomalies"] for s, m in meta.items() if m.get("anomalies")}
            if kind == "etf":  # profile planning: frontier, worst real drawdowns and plan Monte Carlo
                w = T.w_indexed(px, len(days) - 1, cfg["risk"])
                m = T.monthly_returns(days, px, w)
                yrs = int(cfg.get("horizon") or 20)
                start = cfg["start"] * (1 - cfg["crypto_share"])
                mon = cfg["monthly"] * (1 - cfg["crypto_share"])
                ev["plan"] = {"frontier": T.frontier(days, px), "worst": T.worst_drawdowns(days, px, w), "weights": w,
                              "mc": T.monte_carlo(m, yrs, start, mon),
                              "mc_prudent": T.monte_carlo([x - 0.03 / 12 for x in m], yrs, start, mon),
                              "caveat": "Available history (2016-2026) was exceptionally strong for equities; prudent scenario subtracts 3 points annually."}
            st["eval"][kind] = ev
        share = cfg["crypto_share"] if kind == "crypto" else 1 - cfg["crypto_share"]
        if share <= 0:
            st["sleeves"][kind] = {"disabled": f"Your {cfg['risk']} profile does not include crypto."}
            continue
        sl = st["sleeves"].get(kind) or {}
        strategy = cfg["strategy"].get(kind) or ev["default"]
        if sl.get("disabled") or not sl.get("book"):
            sl = {"book": T.Book(cfg["start"] * share, kind=kind).s, "started": today, "history": [], "month": None}
        b = T.Book(state=sl["book"], kind=kind)
        if sl.get("tax_year") and sl["tax_year"] != today[:4]:  # year end: bracketed taxes (estimate)
            T.settle_year(b.s, sl["tax_year"])
        sl["tax_year"] = today[:4]
        i = len(days) - 1
        prices = {s: px[s][i] for s in px if px[s][i]}
        fn = T.STRATS[kind][strategy][1]
        target = fn(px, i, cfg["risk"])
        cur = b.weights(prices)
        # news: on severe event or imminent earnings PAUSE purchases of that asset (no forced sales)
        from trading import news
        nst = news.load()
        paused = {}
        for sym in list(target):
            why = news.risk_brake(nst, sym, now)
            if why and target[sym] > cur.get(sym, 0):
                paused[sym] = why
                target[sym] = cur.get(sym, 0)
        # unallocated funds remain in cash this turn (weights no longer sum to 1)
        reason = None
        if sl.get("month") != today[:7]:
            if sl.get("month"):
                b.contribute(cfg["monthly"] * share)
            sl["month"] = today[:7]
            reason = "monthly contribution + rebalance"
        elif any(abs(target.get(s, 0) - cur.get(s, 0)) > T.BAND for s in set(target) | set(cur)):
            reason = "rebalance: a position drifted outside its 5-point band"
        orders = []
        if reason:
            breach = any(abs(target.get(s, 0) - cur.get(s, 0)) > T.BAND for s in set(target) | set(cur))
            first = not sl["history"]
            before = len(b.s["log"])
            # with contribution only underweighted assets are bought; sold only if something breaches band
            b.rebalance(target, prices, today, reason, only_buy=not (breach or first))
            orders = b.s["log"][before:]
        val = b.value(prices)
        if not sl["history"] or sl["history"][-1][0] != today:
            sl["history"].append([today, round(val, 2), round(b.s["contributed"], 2)])
        else:
            sl["history"][-1] = [today, round(val, 2), round(b.s["contributed"], 2)]
        sl["history"] = sl["history"][-3650:]
        sl["paused"] = paused
        sl.update(book=b.s, strategy=strategy, target={k: round(v, 4) for k, v in target.items()},
                  weights={k: round(v, 4) for k, v in b.weights(prices).items()}, value=round(val, 2),
                  proposals=[{**o, "note": "proposal for you to execute (paper already simulated)"} for o in orders] or sl.get("proposals", []),
                  updated=int(now), share=share)
        st["sleeves"][kind] = sl
    st["config"] = cfg
    st["ts"] = int(now)
    data.private_write(STATE, json.dumps(st, separators=(",", ":")).encode())
    return st
