"""Fast pocket in PAPER: trades ONLY patterns from the "20 per market" study with statistical support.

Only buy patterns can be used (no short selling spot): episodes from A/B families whose mean
effect is POSITIVE in development and in the holdout split. Rule, identical to that measured in the study:
signal is YESTERDAY's episode (with its cause), entered at TODAY's close, held for `h` sessions. Max 5 equal
positions; costs 0.15% per side in equities and 0.20% in crypto. If the pocket drops 15% from its peak, it halts.
For equities there are only PROPOSALS (no broker); for crypto, paper. Real mode: off.
"""
from __future__ import annotations

import time

from trading import movers, moverwhy
from trading.universe import MARKETS

MAX_POS, STOP = 5, 0.15
COST = {"equity": 0.0015, "crypto": 0.0020}


def rules(movers_json: dict) -> list[dict]:
    out = []
    for t in movers_json.get("tests", []):
        if t.get("supported") and t.get("family") in ("A", "B") and (t["dev"] or {}).get("mean", 0) > 0 and (t["hold"] or {}).get("mean", 0) > 0:
            out.append({"name": t["name"], "kind": t["kind"], "dir": t["dir"], "group": t.get("group"), "h": t["h"],
                        "surprise": t["name"].split("sorpresa ")[1][0] if t["family"] == "B" else None})
    return out


def _match(rule, e, market):
    if (market == "crypto") != (rule["kind"] == "crypto") or e["dir"] != rule["dir"]:
        return False
    if rule["surprise"]:
        from trading.moverstats import _num
        s = _num(e.get("surprise"))
        return e.get("cause") == "resultados" and s is not None and (s > 0) == (rule["surprise"] == "+")
    from trading.moverstats import _cause_group
    return _cause_group(e.get("cause")) == rule["group"]


def step(pk: dict, budget: float, rs: list[dict], today: str, log=print) -> dict:
    """One day: closes expired positions, finds yesterday's signals, opens up to 5 positions. `budget`: pocket target value."""
    pk.setdefault("cash", budget)
    pk.setdefault("pos", [])
    pk.setdefault("trades", [])
    if pk.get("day") == today:
        return pk
    prices = {}
    for p in list(pk["pos"]):
        px = movers.fetch(p["sym"], max_age_h=6)
        last = px[max(px)]
        prices[p["sym"]] = last
        p["held"] = sum(1 for d in px if d > p["entry_day"])
        if p["held"] >= p["h"]:
            cost = COST[p["kind"]]
            pk["cash"] += p["qty"] * last * (1 - cost)
            pk["trades"].append({**p, "exit_day": max(px), "exit": last, "ret": last / p["entry"] * (1 - cost) / (1 + cost) - 1})
            pk["pos"].remove(p)
    if not pk.get("halted") and rs:
        signals = []
        for m, d in MARKETS.items():
            for s in d["tickers"]:
                if any(p["sym"] == s for p in pk["pos"]):
                    continue
                try:
                    a = movers.analyse(m, s, recent=3)
                except Exception:  # noqa: BLE001 — no data today, do not trade asset
                    continue
                for e in a["episodes"][-1:]:
                    days = sorted(movers.fetch(s, max_age_h=6))
                    if len(days) < 2 or e["date"] != days[-2]:  # signal must be from YESTERDAY
                        continue
                    moverwhy.attribute({s: {**a, "episodes": [e]}}, log=lambda *_: None)
                    for r in rs:
                        if _match(r, e, m):
                            signals.append((abs(e["z"]), s, m, r, days[-1]))
        free = MAX_POS - len(pk["pos"])
        for _, s, m, r, day in sorted(signals, reverse=True)[:max(0, free)]:
            kind = "crypto" if m == "crypto" else "equity"
            px = movers.fetch(s, max_age_h=6)[day]
            alloc = min(pk["cash"], budget / MAX_POS)
            qty = alloc * (1 - COST[kind]) / px
            if qty > 0:
                pk["cash"] -= alloc
                pk["pos"].append({"sym": s, "kind": kind, "entry_day": day, "entry": px, "qty": qty, "h": r["h"], "rule": r["name"],
                                  "proposal": kind == "equity"})
                prices[s] = px
    val = pk["cash"] + sum(p["qty"] * prices.get(p["sym"], p["entry"]) for p in pk["pos"])
    pk["value"] = val
    pk["peak"] = max(pk.get("peak") or val, val)
    if val < pk["peak"] * (1 - STOP) and not pk.get("halted"):
        pk["halted"] = f"{today}: loss of {1 - val / pk['peak']:.0%} from peak"
    pk["day"] = today
    pk["trades"] = pk["trades"][-200:]
    pk["ts"] = int(time.time())
    return pk
