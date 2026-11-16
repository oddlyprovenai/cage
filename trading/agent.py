#!/usr/bin/env python3
"""24/7 Agent loop (user service separate from Cage). Operates in PAPER mode by default.

Every minute: checks kill switch and limits with current price. With each closed hourly candle: updates data,
computes state, queries reflex and applies risk policy. Every night (03:00): retrains and evaluates
walk-forward; only promotes a model if it improves out-of-sample. Escalates to local LLM (if RAM available) when
confidence is < 0.60 or crisis regime, for explanation only: never decides.
"""
from __future__ import annotations

import json
import os
import sys
import time
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from trading import data, evaluate, news, real, risk  # noqa: E402
from trading.broker import PaperBroker  # noqa: E402
from trading.model import Reflex, dataset  # noqa: E402
from trading.state import snapshot, features  # noqa: E402

SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"]
H = data.HOME
STATE, CONTROL, MODELS, EVAL, LOG = H / "state.json", H / "control.json", H / "models", H / "eval.json", H / "agent.log"


def jread(p: Path, default):
    try:
        return json.loads(p.read_text())
    except (OSError, ValueError):
        return default


def jwrite(p: Path, obj) -> None:
    data.private_write(p, json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode())


def log(msg: str) -> None:
    """Secret-free logging: keys and signed headers are never written."""
    LOG.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(LOG.parent, 0o700)
    with os.fdopen(os.open(LOG, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600), "a") as f:
        f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + msg[:500] + "\n")
    if LOG.stat().st_size > 2_000_000:
        LOG.write_text(LOG.read_text()[-500_000:])


def control() -> dict:
    return {"kill": False, "paused": False, **jread(CONTROL, {})}


# ---------------------------------------------------------------- models
def model_for(sym: str) -> Reflex | None:
    return Reflex.load(MODELS / f"{sym}.json")


def nightly(syms=SYMBOLS) -> dict:
    """Retrain + walk-forward evaluation. Promotes only if candidate improves out-of-sample Brier."""
    rep = {"ts": int(time.time()), "symbols": {}}
    for s in syms:
        c = data.update_candles(s)
        ev = evaluate.walk_forward(c)
        X, y, _ = dataset(c, len(c) - 6000, len(c), 4, 2)
        cand = Reflex.train(X, y, {"trained": int(time.time()), "symbol": s})
        # fair comparison on last month, which neither has seen
        Xh, yh, _ = dataset(c, len(c) - 6720, len(c) - 720, 4, 2)
        holdout_c = Reflex.train(Xh, yh)
        test = [i for i in range(len(c) - 720, len(c) - 4)]
        cur = model_for(s)
        pb = lambda m: evaluate.brier([m.prob_up(features(c, i)) for i in test], [1 if c[i + 4]["c"] > c[i]["c"] else 0 for i in test])  # noqa: E731
        b_new, b_cur = pb(holdout_c), (pb(cur) if cur else None)
        base = evaluate.brier([0.5] * len(test), [1 if c[i + 4]["c"] > c[i]["c"] else 0 for i in test])
        promote = cur is None or b_new < b_cur
        if promote:
            MODELS.mkdir(parents=True, exist_ok=True, mode=0o700)
            cand.p.update(holdout_brier=b_new, base_brier=base, skill=b_new < base)
            cand.save(MODELS / f"{s}.json")
        rep["symbols"][s] = {**{k: v for k, v in ev.items()}, "holdout_brier_new": b_new, "holdout_brier_cur": b_cur,
                             "holdout_brier_base": base, "promoted": promote}
        log(f"night {s}: brier wf {ev['brier']:.4f} (base {ev['brier_base']:.4f}) acc {ev['directional_acc']} "
            f"holdout new {b_new:.4f} current {b_cur} → {'promoted' if promote else 'keeping current'}")
    jwrite(EVAL, rep)
    return rep


# ---------------------------------------------------------------- local LLM (explains only)
def explain(sym: str, snap: dict, dec: dict, endpoint: str = "http://127.0.0.1:8080/v1") -> str | None:
    try:
        import server  # reuse RAM brake and local call without proxy or redirects
        free = server.free_ram_gb()
        if free is not None and free < server.MIN_FREE_GB:
            return None
        js = server.ai_call(endpoint, {"temperature": 0.2, "max_tokens": 160, "keep_alive": "2m", "messages": [
            {"role": "system", "content": "You explain in English, in 2 sentences, why a trading system is in doubt. You do not give orders."},
            {"role": "user", "content": f"State: {json.dumps(snap)}\nReflex: {json.dumps(dec)}"}]}, timeout=30)
        return js["choices"][0]["message"]["content"][:400]
    except Exception:  # noqa: BLE001 - AI is optional
        return None


# ---------------------------------------------------------------- un ciclo
def step(st: dict, ctl: dict, now: float | None = None, fetch_book=data.fetch_book, candles=None) -> dict:
    now = now or time.time()
    lim = risk.Limits(**{k: v for k, v in ctl.get("limits", {}).items() if k in risk.Limits.__dataclass_fields__})
    br = PaperBroker(st.get("paper"))
    st.setdefault("decisions", {})
    prices, snaps = {}, {}
    gross_used = 0.0
    cs = candles or {}
    for s in SYMBOLS:
        c = cs.get(s) or (jread(recent_path(s), []) if candles is not None else data.load_candles(s))
        if not c:
            continue
        prices[s] = c[-1]["c"]
    day = time.strftime("%Y-%m-%d", time.localtime(now))
    pf = br.portfolio(prices, day)
    for s in SYMBOLS:
        c = cs.get(s) or (jread(recent_path(s), []) if candles is not None else data.load_candles(s))
        if len(c) < 100:
            continue
        try:
            book = fetch_book(s)
        except Exception:  # noqa: BLE001
            book = None
        snap = snapshot(s, c, book, pf)
        snap["ref_close"] = c[-1]["c"]
        if snap["mid"] and abs(snap["mid"] / c[-1]["c"] - 1) > real.MAX_PRICE_DEV:  # absurd order book: no trade
            st.setdefault("decisions", {})[s] = {"error": f"anomalous order book price ({snap['mid']} vs candle {c[-1]['c']}): no trade"}
            log(f"ALERT: anomalous price in {s}")
            continue
        snaps[s] = snap
        m = model_for(s)
        rs = risk.risk_state(pf, lim)
        if m is None:
            st["decisions"][s] = {"error": "no model yet (trained tonight or with 'Retrain')"}
            continue
        f = features(c, len(c) - 1)
        dec = m.decide(f, snap["spread_bps"], rs)
        if not m.p.get("skill", False):
            dec_note = "model does not beat base rate out-of-sample: no trade"
            tgt, why = 0.0, dec_note
        else:
            tgt, why = risk.target(dec, pf, lim, ctl.get("kill") or ctl.get("paused"))
        tgt = risk.cap_gross(tgt, gross_used, lim)  # joint cap: correlated assets do not exceed 40% combined
        # news: BRAKE only (pause on severe event or imminent earnings); never open or expand
        nst = news_state()
        brake = news.risk_brake(nst, s, now)
        if brake and tgt != 0.0:
            tgt, why = 0.0, "news brake: " + brake
        gross_used += abs(tgt)
        considered = [{k: x[k] for k in ("title", "link", "published", "via", "kinds", "grave")} for x in news.for_asset(nst, s, 2)[:3]]
        price = snap["mid"] or prices[s]
        t = br.rebalance(s, tgt, price, int(now * 1000), snap["spread_bps"], why)
        if t:
            log(f"paper {t['side']} {s} {t['qty']} @ {t['price']} · {why}")
        if (ctl.get("real") or {}).get("enabled"):
            real_step(st, ctl, s, tgt, price, snap, prices, now)
        exp = None
        if dec["escalate"] and now - st.get("last_explain", {}).get(s, 0) > 3600:
            exp = explain(s, snap, dec)
            st.setdefault("last_explain", {})[s] = now
        st["decisions"][s] = {**dec, "target": tgt, "why": why, "ts": int(now), "candle_t": snap["candle_t"],
                              "explain": exp or st["decisions"].get(s, {}).get("explain"), "news": considered, "news_brake": brake}
        # live predictions to measure real Brier on paper when resolved
        st.setdefault("live", []).append({"s": s, "t": snap["candle_t"], "p": dec["p_up"], "c": c[-1]["c"]})
        st["live"] = st["live"][-3000:]
    pf = br.portfolio({s: snaps.get(s, {}).get("mid") or prices.get(s) for s in prices}, day)
    st["paper"] = br.s
    st["snapshots"] = snaps
    hist = st.setdefault("equity", [])
    if not hist or now - hist[-1][0] >= 3600:
        hist.append([int(now), round(pf["equity"], 2), {s: prices.get(s) for s in SYMBOLS}])
        st["equity"] = hist[-24 * 365:]
    st["portfolio"] = {"equity": pf["equity"], "drawdown": pf["drawdown"], "day_pnl_pct": pf["day_pnl_pct"]}
    st["ts"] = int(now)
    health(st, cs or {s: (jread(recent_path(s), []) if candles is not None else data.load_candles(s)) for s in SYMBOLS}, now)
    audit_decisions(st, now)
    return st


# ---------------------------------------------------------------- reliability: data, reconciliation, alerts, logging
DECISIONS = H / "decisions.jsonl"


def data_issues(c: list[dict], now: float) -> list[str]:
    """Stale candles (> 2 h) or gaps in the last 200 hours."""
    out = []
    if not c:
        return ["no candles"]
    age_h = (now * 1000 - c[-1]["close_t"]) / 3_600_000
    if age_h > 2:
        out.append(f"candles lagging {age_h:.0f} h")
    gaps = sum(1 for a, b in zip(c[-200:], c[-199:]) if b["t"] - a["t"] != 3_600_000)
    if gaps:
        out.append(f"{gaps} gaps in the last 200 h")
    return out


def reconcile(paper: dict) -> list[str]:
    """Paper portfolio must be consistent: finite numbers, no impossible negative cash, valid positions."""
    import math
    out = []
    if not math.isfinite(paper.get("cash", 0.0)):
        out.append("non-numeric cash")
    for s, p in (paper.get("positions") or {}).items():
        if not (math.isfinite(p.get("qty", 0)) and math.isfinite(p.get("avg", 0)) and p.get("avg", 0) > 0):
            out.append(f"invalid position in {s}")
    if paper.get("cash", 0.0) < -2 * paper.get("start", 10_000):
        out.append("negative cash out of range")
    return out


def health(st: dict, candles: dict, now: float) -> None:
    alerts = []
    for s, c in candles.items():
        alerts += [f"{s}: {x}" for x in data_issues(c, now)]
    alerts += reconcile(st.get("paper") or {})
    if alerts:  # questionable data: no trade: target to zero on this turn
        for s in st.get("decisions", {}):
            if any(a.startswith(s) for a in alerts):
                st["decisions"][s]["why"] = "questionable data: no trade (" + "; ".join(a for a in alerts if a.startswith(s)) + ")"
                st["decisions"][s]["target"] = 0.0
    prev = set(st.get("alerts", []))
    st["alerts"] = alerts
    for a in alerts:
        if a not in prev:
            log("ALERT: " + a)
    # uptime: one heartbeat per hour since installation
    hb = st.setdefault("uptime", {"since": int(now), "hours": []})
    hr = int(now // 3600)
    if not hb["hours"] or hb["hours"][-1] != hr:
        hb["hours"].append(hr)
        hb["hours"] = hb["hours"][-24 * 400:]


def audit_decisions(st: dict, now: float) -> None:
    """Auditable log: one line per asset and candle with the decision and rationale (rotates at 20 MB)."""
    last = st.setdefault("audited", {})
    lines = []
    for s, d in (st.get("decisions") or {}).items():
        if d.get("candle_t") and last.get(s) != d["candle_t"]:
            last[s] = d["candle_t"]
            lines.append(json.dumps({"ts": int(now), "sym": s, "candle_t": d["candle_t"], **{k: d.get(k) for k in
                                     ("regime", "direction", "prob", "setup_quality", "risk_state", "target", "why")}}, ensure_ascii=False))
    if lines:
        with os.fdopen(os.open(DECISIONS, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600), "a") as f:
            f.write("\n".join(lines) + "\n")
        if DECISIONS.stat().st_size > 20_000_000:
            DECISIONS.write_text("\n".join(DECISIONS.read_text().splitlines()[-50_000:]) + "\n")


_NEWS = {"t": 0, "st": {}}


def news_state() -> dict:
    """Saved news (gathered by child process every hour); reread at most every 5 minutes."""
    if time.time() - _NEWS["t"] > 300:
        _NEWS.update(t=time.time(), st=news.load())
    return _NEWS["st"]


def disable_real(reason: str) -> None:
    """Turns off real mode (reactivated only by user in Cage)."""
    ctl = jread(CONTROL, {})
    ctl.setdefault("real", {}).update(enabled=False, halted=reason, halted_at=int(time.time()))
    jwrite(CONTROL, ctl)
    log("REAL MODE OFF: " + reason)


def real_step(st: dict, ctl: dict, sym: str, tgt: float, price: float, snap: dict, prices: dict, now: float,
              api_factory=None) -> None:
    try:
        keys = real.load_keys()
        if not keys:
            raise real.Halt("no saved keys")
        api = (api_factory or real.Binance)(*keys)
        rs = real.update_equity(api, st, prices, float(ctl["real"]["capital"]))
        if rs.get("peak") and 1 - rs["equity"] / rs["peak"] >= real.DD_STOP:
            real.close_all(api, SYMBOLS)
            raise real.Halt("15% drawdown on real capital: positions closed")
        rec = real.execute(api, ctl, st, sym, tgt, price, snap, now)
        if rec and "pending" not in rec:
            log(f"REAL {'testnet ' if rec['testnet'] else ''}{rec['side']} {sym} {rec['qty']} @ {rec['avg']} (sim {rec['sim']})")
    except real.Halt as h:
        st.setdefault("real", {})["last_halt"] = str(h)
        disable_real(str(h))
        ctl.setdefault("real", {})["enabled"] = False


def do_research() -> None:
    from trading import research
    try:
        jwrite(H / "research.json", research.run())
    except Exception as exc:  # noqa: BLE001
        log(f"research without data: {str(exc)[:120]}")


RECENT = 1000  # candles kept in memory by live loop (full history only used by child process)


def recent_path(s: str) -> Path:
    return data.DATA / f"{s}-recent.json"


def refresh(nightly_due: bool = False, flags: tuple = ()) -> None:
    """Heavy work in a CHILD PROCESS: downloads candles, saves recent ones, researches and retrains if due.
    This keeps the 24/7 loop memory footprint small."""
    for s in SYMBOLS:
        c = data.update_candles(s, max_calls=3)
        data.private_write(recent_path(s), json.dumps(c[-RECENT:], separators=(",", ":")).encode())
    if nightly_due or "retrain" in flags or not all(model_for(s) for s in SYMBOLS):
        nightly()
    do_research()
    try:  # news: free keyless sources, read-only
        st_n = news.collect()
        log(f"news: {len(st_n['items'])} related · sources with error: {len(st_n['errors'])}")
    except Exception as exc:  # noqa: BLE001
        log(f"news without data: {str(exc)[:120]}")
    try:  # long-term portfolios: once daily (or when retrain requested)
        from trading import ltpaper
        st = ltpaper.load_state()
        if "retrain" in flags or time.strftime("%Y-%m-%d", time.localtime(st.get("ts", 0))) != time.strftime("%Y-%m-%d"):
            ltpaper.daily(force="retrain" in flags)
            log("long term: paper portfolios updated")
        from trading import allocator
        try:
            ast = json.loads(allocator.STATE.read_text())
        except (OSError, ValueError):
            ast = {}
        if "retrain" in flags or time.strftime("%Y-%m-%d", time.localtime(ast.get("ts", 0))) != time.strftime("%Y-%m-%d"):
            allocator.daily()
            log("allocator: distribution decided and applied on paper")
        from trading import blockchair as bc
        if bc.info().get("saved"):  # on-chain study: upon connecting key and then once a month, within quota
            oc = jread(H / "onchain.json", {})
            if time.time() - oc.get("ts", 0) > 30 * 86400:
                try:
                    from trading import onchain
                    r = onchain.main()
                    log(f"on-chain: {r['n_variants']} variants, adopted {len(r['adopted'])}")
                except Exception as exc:  # noqa: BLE001 — quota, network or data: retried another day
                    log(f"on-chain pending: {type(exc).__name__}: {str(exc)[:120]}")
        from trading import reeval
        before = len(jread(reeval.OUT, {"runs": []})["runs"])
        if len(reeval.run()["runs"]) != before:
            log("monthly reevaluation with new data recorded")
    except Exception as exc:  # noqa: BLE001 - without data, keep last
        log(f"long term without data: {str(exc)[:160]}")


WATCH = H / "watchdog.json"
HANG_S, MAX_RESTARTS = 45 * 60, 3


def watchdog_start(beat: list) -> None:
    """Watchdog without extra processes: if loop does not advance in 45 min, agent exits with error and launchd restarts it
    (KeepAlive). At most 3 restarts per day; after that leaves a warning to avoid loop."""
    import threading

    def run():
        while True:
            time.sleep(60)
            if time.time() - beat[0] > HANG_S:
                w = jread(WATCH, {})
                today = time.strftime("%Y-%m-%d")
                n = w.get("restarts", {}).get(today, 0)
                w.setdefault("restarts", {})[today] = n + 1
                w["restarts"] = dict(list(w["restarts"].items())[-14:])
                w["last"] = {"ts": int(time.time()), "why": f"loop did not advance in {int((time.time() - beat[0]) / 60)} min"}
                if n < MAX_RESTARTS:
                    w["last"]["action"] = "automatic restart"
                    jwrite(WATCH, w)
                    log("watchdog: loop hung; exiting for launchd to restart me")
                    os._exit(3)
                w["last"]["action"] = "restart limit reached: notice in Cage"
                jwrite(WATCH, w)
                beat[0] = time.time()  # do not repeat notice every minute
    threading.Thread(target=run, daemon=True).start()


def freshness(live: dict, now: float | None = None) -> list[str]:
    """Stale data → warning (trading component stops operating with questionable data)."""
    now = now or time.time()
    out = []
    for s, c in live.items():
        if c and now - c[-1]["t"] / 1000 > 3 * 3600:
            out.append(f"{s}: last candles from {int((now - c[-1]['t'] / 1000) / 3600)} h ago")
    try:
        lt = jread(H / "longterm.json", {})
        if lt.get("ts") and now - lt["ts"] > 3 * 86400:
            out.append(f"long term not updated for {int((now - lt['ts']) / 86400)} days")
        nw = jread(H / "news.json", {})
        if nw.get("ts") and now - nw["ts"] > 6 * 3600:
            out.append(f"news not updated for {int((now - nw['ts']) / 3600)} h")
    except Exception:  # noqa: BLE001
        pass
    return out


def child(args: list[str]) -> None:
    import subprocess
    subprocess.run([sys.executable, str(Path(__file__).resolve()), *args], timeout=1800, check=False)


def main() -> None:
    H.mkdir(parents=True, exist_ok=True)
    os.chmod(H, 0o700)
    log("agent started (paper)")
    st = jread(STATE, {})
    last_hour = last_night = None
    live: dict = {}
    beat = [time.time()]
    watchdog_start(beat)
    while True:
        beat[0] = time.time()
        try:
            ctl = control()
            if ctl.get("stop"):
                log("stopped from Cage")
                break
            hour = time.strftime("%Y-%m-%d %H")
            flags = [f for f in ("retrain", "research") if ctl.get(f)]
            if hour != last_hour or flags:
                due = time.strftime("%H") == "03" and last_night != time.strftime("%Y-%m-%d")
                child(["--refresh"] + (["--nightly"] if due else []) + [f"--{f}" for f in flags])
                if due:
                    last_night = time.strftime("%Y-%m-%d")
                if flags:
                    c2 = jread(CONTROL, {})
                    for f in flags:
                        c2[f] = False
                    jwrite(CONTROL, c2)
                live = {s: jread(recent_path(s), []) for s in SYMBOLS}
                last_hour = hour
            st = step(st, ctl, candles=live)
            st["status"] = "ok"
            st["health"] = freshness(live)
        except Exception as exc:  # noqa: BLE001 - data failure stops trades, not the process
            st["status"] = f"error: {str(exc)[:200]}"
            log("error: " + traceback.format_exc()[-400:])
        jwrite(STATE, st)
        time.sleep(60)


if __name__ == "__main__":
    if "--refresh" in sys.argv:
        refresh("--nightly" in sys.argv, tuple(a[2:] for a in sys.argv if a in ("--retrain", "--research")))
    else:
        main()
