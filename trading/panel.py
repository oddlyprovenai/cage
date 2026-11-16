"""Bridge between Cage (web server) and trading agent: state reading and user actions.

Everything that changes real mode goes through here and requires user session + CSRF (verified by server.py).
Exchange keys enter via `save_keys` and never leave: not in responses, not in logs, not in errors.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
import time

from trading import data, real

H = data.HOME
LABEL = "org.cage.trading"
PHRASE = "ACTIVATE REAL MONEY"


def _read(name: str, default):
    try:
        return json.loads((H / name).read_text())
    except (OSError, ValueError):
        return default


def _write(name: str, obj) -> None:
    data.private_write(H / name, json.dumps(obj, ensure_ascii=False).encode())


def agent_pid() -> int | None:
    r = subprocess.run(["pgrep", "-f", "trading/agent.py"], capture_output=True, text=True, check=False)
    pids = [int(x) for x in r.stdout.split() if x.isdigit() and int(x) != os.getpid()]
    return pids[0] if pids else None


def agent_rss_mb(pid: int | None) -> float | None:
    if not pid:
        return None
    r = subprocess.run(["ps", "-o", "rss=", "-p", str(pid)], capture_output=True, text=True, check=False)
    return round(int(r.stdout.strip()) / 1024, 1) if r.stdout.strip().isdigit() else None


def status() -> dict:
    st, ev, rs, ctl = _read("state.json", {}), _read("eval.json", {}), _read("research.json", {}), _read("control.json", {})
    pid = agent_pid()
    paper = st.get("paper") or {}
    real_ctl = {k: v for k, v in (ctl.get("real") or {}).items() if k != "approve"}
    return {"running": bool(pid), "rss_mb": agent_rss_mb(pid), "status": st.get("status"), "ts": st.get("ts"),
            "decisions": st.get("decisions", {}), "portfolio": st.get("portfolio"), "snapshots": st.get("snapshots", {}),
            "equity": st.get("equity", [])[-24 * 30:], "trades": (paper.get("trades") or [])[-40:],
            "paper": {k: paper.get(k) for k in ("cash", "start", "fees", "positions")},
            "eval": ev, "research": rs, "control": {"kill": bool(ctl.get("kill")), "stop": bool(ctl.get("stop")), "real": real_ctl},
            "real_state": {k: v for k, v in (st.get("real") or {}).items() if k in ("orders", "equity", "peak", "pending", "last_halt", "value")},
            "real_orders": _tail(H / "real-orders.jsonl", 30), "keys": real.keys_info(), "phrase": PHRASE,
            "longterm": longterm_view(), "research_ml": research_ml_view(), "systematic": _read("research_systematic.json", {}), "round3": round3_view(), "onchain": _read("onchain.json", {}), "blockchair": __import__("trading.blockchair", fromlist=["info"]).info(), "allocator": _read("allocator.json", {}), "reevals": (_read("reevals.json", {}).get("runs") or [])[-6:], "lt_notes": (_read("longterm.json", {}).get("notes") or [])[-3:], "movers": movers_view(),
            "alerts": st.get("alerts", []), "uptime": uptime(st), "news": news_view()}


def price_series(asset: str, days: int = 90) -> dict:
    """Recent daily closes of an asset (local cache, without downloading) for the news chart."""
    from trading import ltdata, rdata
    from trading import rfeat as F
    rows = []
    try:
        if asset in ltdata.ETF or asset in ltdata.STOCKS or asset in ltdata.CRYPTO:
            rows = json.loads((ltdata.DAILY / (asset + ".json")).read_text())["rows"]
        elif asset in rdata.PAIRS:
            d = F.load(asset)
            rows = [[time.strftime("%Y-%m-%d", time.gmtime(t / 1000)), float(c)] for t, c in zip(d["t"], d["c"]) if (t // 3_600_000) % 24 == 23]
    except (OSError, ValueError, KeyError):
        rows = []
    return {"asset": asset, "rows": rows[-days:]}


def news_view() -> dict:
    from trading import news
    n = news.load()
    items = n.get("items", [])[:250]
    brakes = {a: news.risk_brake(n, a) for a in news.ASSETS}
    return {"ts": n.get("ts"), "items": items, "earnings": n.get("earnings", {}), "errors": n.get("errors", {}),
            "brakes": {a: b for a, b in brakes.items() if b}, "study": _read("news_study.json", {}), "sources": n.get("sources", [])}


def movers_view() -> dict:
    """Summary of the "20 per market" study (full cards are requested separately: /api/trading/movers?sym=)."""
    r = _read("movers.json", {})
    if not r:
        return {}
    cards = {s: {k: c.get(k) for k in ("name", "market", "sector", "n", "causes", "after_drop", "after_rise", "recover_median", "error")}
             for s, c in (r.get("cards") or {}).items()}
    return {k: r.get(k) for k in ("ts", "split", "n_tests", "tests", "n_episodes", "attributed", "supported", "bias")} | {"cards": cards}


def set_fast(body: dict) -> dict:
    """The user adjusts the fast pocket (0–10%) or reactivates it after a halt."""
    from trading import allocator, ltpaper
    try:
        c = json.loads(ltpaper.CONFIG.read_text())
    except (OSError, ValueError):
        c = {}
    share = float(body.get("share", allocator.FAST_DEFAULT))
    if not 0 <= share <= allocator.FAST_MAX:
        raise ValueError("the fast pocket is between 0% and 10%")
    c["fast_share"] = share
    data.private_write(ltpaper.CONFIG, json.dumps(c).encode())
    if body.get("reset"):
        st = _read("allocator.json", {})
        (st.get("fast") or {}).update(halted=None, peak=None)
        data.private_write(allocator.STATE, json.dumps(st, separators=(",", ":")).encode())
    return {"ok": True, "share": share}


def movers_card(sym: str) -> dict:
    return ((_read("movers.json", {}).get("cards") or {}).get(sym)) or {}


def round3_view() -> dict:
    r = _read("round3.json", {})
    if not r:
        return {}
    v = r.get("binance", {}).get("variants", {})
    rows = sorted(({"name": k, "ex_sharpe": x["excess"]["sharpe"], "dsr": x["dsr"], "sharpe": x["dev"]["sharpe"], "max_dd": x["dev"]["max_dd"],
                    "hold_wins": x["hold_wins"], "hold_dsharpe": x["hold_mean_dsharpe"]} for k, x in v.items()), key=lambda z: -z["ex_sharpe"])
    return {"ts": r.get("ts"), "n": r.get("n_variants"), "holdout": r.get("holdout"), "bh": r.get("binance", {}).get("bh_dev"),
            "rows": rows, "adopted": r.get("binance", {}).get("adopted", []), "bands": r.get("bands"), "yields": r.get("stable_yields"),
            "dca": {s: x["mayer"]["final"] / x["fijo"]["final"] - 1 for s, x in (r.get("dca") or {}).items()}}


def research_ml_view() -> dict:
    r = _read("research_ml.json", {})
    if not r:
        return {}
    V = sorted(r.get("variants", []), key=lambda v: -v.get("dsr", 0))
    keep = ("h", "model", "thr", "long_only", "brier", "brier_base", "hit", "trades", "sharpe", "ret", "max_dd", "dsr")
    by_h = {}
    for v in r.get("variants", []):
        b = by_h.setdefault(v["h"], {"best_brier": 9, "base": v["brier_base"]})
        b["best_brier"] = min(b["best_brier"], v["brier"] or 9)
    return {"n_variants": r.get("n_variants"), "top": [{k: v.get(k) for k in keep} for v in V[:8]], "chosen": r.get("chosen"),
            "holdout": r.get("holdout"), "bh_dev": r.get("bh_dev"), "dev_from": r.get("dev_from"), "ts": r.get("ts"), "by_h": by_h}


def uptime(st: dict) -> dict:
    u = st.get("uptime") or {}
    hrs = u.get("hours") or []
    if not hrs:
        return {}
    span = max(1, int(time.time() // 3600) - hrs[0] + 1)
    return {"since": u.get("since"), "pct": min(1.0, len(set(hrs)) / span), "hours": span}


def longterm_view() -> dict:
    lt = _read("longterm.json", {})
    fx = _read("data/daily/EURUSD_X.json", {}).get("rows") or []
    lt["eurusd"] = {"date": fx[-1][0], "rate": fx[-1][1]} if fx else None
    for sl in (lt.get("sleeves") or {}).values():
        if isinstance(sl, dict) and sl.get("book"):
            sl["book"] = {k: v for k, v in sl["book"].items() if k != "log"} | {"log": sl["book"].get("log", [])[-40:]}
            sl["history"] = sl.get("history", [])[-730:]
    return lt


def _tail(path, n):
    try:
        return [json.loads(x) for x in path.read_text().splitlines()[-n:]]
    except (OSError, ValueError):
        return []


def control(action: str, body: dict) -> dict:
    ctl = _read("control.json", {})
    if action == "start":
        ctl["stop"] = False
        _write("control.json", ctl)
        subprocess.run(["launchctl", "kickstart", f"gui/{os.getuid()}/{LABEL}"], capture_output=True, check=False)
    elif action == "stop":
        ctl["stop"] = True
    elif action in ("kill_on", "kill_off"):
        ctl["kill"] = action == "kill_on"
    elif action in ("retrain", "research"):
        ctl[action] = True
    elif action == "real_off":
        ctl.setdefault("real", {})["enabled"] = False
        ctl["real"]["halted"] = "turned off by user"
    elif action == "lt_config":
        risk = body.get("risk") if body.get("risk") in ("conservador", "moderado", "dinamico") else "moderado"
        monthly = None if body.get("monthly") in (None, "") else max(0.0, min(100_000.0, float(body["monthly"])))
        cfg = {"risk": risk, "monthly": monthly, "start": max(0.0, min(1e7, float(body.get("start") or 10_000)))}
        strat = body.get("strategy") or {}
        cfg["strategy"] = {k: v for k, v in strat.items() if k in ("etf", "crypto") and v in ("index", "indexed", "core_sat", "trend")}
        _write("invest_config.json", cfg)
        return {"ok": True}
    elif action == "testnet_check":  # child process: never touches real control
        r = subprocess.run([sys.executable, str(Path(__file__).with_name("testnet_check.py"))], capture_output=True, text=True, timeout=120, check=False)
        try:
            return json.loads(r.stdout.strip().splitlines()[-1])
        except (ValueError, IndexError):
            return {"ok": False, "detail": "the test did not finish"}
    elif action == "prices":
        return price_series(str(body.get("asset", ""))[:20])
    elif action == "approve":
        p = (_read("state.json", {}).get("real") or {}).get("pending")
        if not p or p.get("id") != body.get("id"):
            raise ValueError("no such pending order")
        ctl.setdefault("real", {})["approve"] = {**p, "ts": int(time.time())}
    else:
        raise ValueError("unknown action")
    _write("control.json", ctl)
    return {"ok": True}


def save_keys(body: dict, check=True) -> dict:
    key, secret, testnet = str(body.get("key", "")).strip(), str(body.get("secret", "")).strip(), bool(body.get("testnet", True))
    if not (16 <= len(key) <= 128 and 16 <= len(secret) <= 128) or not key.isalnum() or not secret.isalnum():
        raise ValueError("invalid key format")
    if check:
        perm = real.check_permissions(real.Binance(key, secret, testnet))
        if not perm["ok"]:
            raise ValueError(perm["detail"])
    real.store_keys(key, secret, testnet)
    return {"ok": True, "keys": real.keys_info()}


def activate(body: dict) -> dict:
    """Real mode activation by user: exact phrase, valid keys, visible measured results and maximum capital."""
    if body.get("phrase") != PHRASE:
        raise ValueError(f"type exactly '{PHRASE}'")
    if not real.keys_info().get("saved"):
        raise ValueError("save trading-only keys first")
    if not _read("eval.json", {}).get("symbols"):
        raise ValueError("no measured results yet: wait for the first evaluation")
    cap = float(body.get("capital", 0))
    if not 10 <= cap <= 1_000_000:
        raise ValueError("maximum capital between 10 and 1,000,000 USDT")
    ctl = _read("control.json", {})
    ctl["real"] = {"enabled": True, "capital": cap, "max_position": min(0.5, max(0.01, float(body.get("max_position", 0.2)))),
                   "confirm_each": bool(body.get("confirm_each", True)), "activated_at": int(time.time()),
                   "testnet": real.keys_info().get("testnet")}
    _write("control.json", ctl)
    return {"ok": True}
