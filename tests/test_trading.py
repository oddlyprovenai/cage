"""Trading agent: causality, schema, risk, paper and real mode guardrails (offline, no money)."""
from __future__ import annotations

import importlib
import json
import math
import random
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def synth(n=3000, seed=1, drift=0.0):
    r, p, out = random.Random(seed), 100.0, []
    for i in range(n):
        o = p
        p *= math.exp(r.gauss(drift, 0.01))
        out.append({"t": i * 3600_000, "o": o, "h": max(o, p) * 1.002, "l": min(o, p) * 0.998, "c": p,
                    "v": 1.0, "qv": 1000 + r.random() * 100, "n": 10, "close_t": i * 3600_000 + 3599_999})
    return out


@pytest.fixture()
def T(tmp_path, monkeypatch):
    monkeypatch.setenv("CAGE_HOME", str(tmp_path))
    import trading.data
    importlib.reload(trading.data)
    mods = {}
    for m in ("state", "model", "risk", "broker", "evaluate", "real", "agent"):
        mods[m] = importlib.reload(importlib.import_module("trading." + m))
    return type("T", (), mods)


def test_features_are_causal(T):
    c = synth(400)
    f = T.state.features(c, 300)
    future = [dict(k, c=k["c"] * 7, h=k["h"] * 7, l=k["l"] * 7, qv=1e9) for k in c[301:]]
    assert T.state.features(c[:301] + future, 300) == f  # changing future changes nothing
    assert T.state.features(c, 50) is None  # without sufficient history, None


def test_snapshot_is_compact_and_timestamped(T):
    c = synth(200)
    s = T.state.snapshot("BTCUSDT", c, {"ts": 5, "bids": [(99.9, 1)], "asks": [(100.1, 2)]}, {"drawdown": 0.01, "equity": 10000})
    assert len(json.dumps(s)) / 4 < 400 and s["candle_t"] == c[-1]["t"] and s["book_t"] == 5
    assert s["imbalance"] == round((1 - 2) / 3, 3)


def test_reflex_schema_always_valid(T):
    c = synth(3000)
    X, y, _ = T.model.dataset(c, 0, 2500, 4, 2)
    m = T.model.Reflex.train(X, y)
    for i in range(2500, 2990):
        d = m.decide(T.state.features(c, i), 1.0, "safe")
        assert T.model.validate(d) is d
    with pytest.raises(ValueError):
        T.model.validate({**d, "setup_quality": 4})
    with pytest.raises(ValueError):
        T.model.validate({**d, "regime": "luna"})


def test_isotonic_is_monotone_and_not_extreme(T):
    r = random.Random(3)
    p = [r.random() for _ in range(2000)]
    y = [1 if r.random() < q else 0 for q in p]
    cur = T.model.fit_isotonic(p, y)
    vals = [v for _, v in cur]
    assert vals == sorted(vals) and 0.02 < vals[0] and vals[-1] < 0.98


def test_policy_only_fires_on_strong_safe_signals(T):
    lim, pf = T.risk.Limits(), {"drawdown": 0.0, "day_pnl_pct": 0.0}
    good = {"direction": "long", "prob": 0.85, "setup_quality": 2, "risk_state": "safe"}
    f, _ = T.risk.target(good, pf, lim, False)
    assert 0 < f <= 0.25 * (0.85 - 0.15) + 1e-9 and f <= lim.max_position
    assert T.risk.target({**good, "prob": 0.80}, pf, lim, False)[0] == 0          # confidence <= 0.80
    assert T.risk.target({**good, "setup_quality": 1}, pf, lim, False)[0] == 0    # quality < 2
    assert T.risk.target(good, pf, lim, True)[0] == 0                             # kill switch
    assert T.risk.target(good, {"drawdown": 0.15, "day_pnl_pct": 0}, lim, False)[0] == 0  # drawdown 15%
    assert T.risk.target(good, {"drawdown": 0.0, "day_pnl_pct": -0.031}, lim, False)[0] == 0  # daily loss
    assert T.risk.target({**good, "direction": "short"}, pf, lim, False)[0] < 0   # paper allows shorts


def test_paper_broker_charges_costs(T):
    b = T.broker.PaperBroker(cash=10_000)
    b.rebalance("BTCUSDT", 0.2, 100.0, 0, 2.0, "x")
    b.rebalance("BTCUSDT", 0.0, 100.0, 1, 2.0, "x")
    assert b.equity({"BTCUSDT": 100.0}) < 10_000  # round-trip at same price: loses fees and slippage
    assert all(t["paper"] for t in b.s["trades"])


def test_walk_forward_no_edge_on_random_walk(T):
    r = T.evaluate.walk_forward(synth(9000, seed=7), train_n=6000, test_n=720)
    assert r["folds"] >= 3 and r["schema_valid"] == 1.0
    assert abs(r["brier"] - 0.25) < 0.02            # random walk: no edge to be found
    assert r["max_dd"] < 0.15


# ---------------------------------------------------------------- real money: guardrails
class FakeAPI:
    testnet = True

    def __init__(self, *a):
        self.orders = []

    def account(self):
        return {"balances": [{"asset": "USDT", "free": "1000", "locked": "0"}, {"asset": "BTC", "free": "0", "locked": "0"}]}

    def filters(self, s):
        return {"step": 0.00001, "min_qty": 0.00001, "min_notional": 5}

    def market(self, s, side, q, cid=None):
        self.orders.append((s, side, q))
        return {"status": "FILLED", "fills": [{"price": "100", "qty": str(q)}], "orderId": 1}


def snap_now(now):
    return {"candle_t": int(now * 1000) - 600_000, "book_t": int(now * 1000) - 1000, "spread_bps": 1.0, "ref_close": 100.0}


def test_no_real_order_when_switch_off(T):
    import time
    api, now = FakeAPI(), time.time()
    for ctl in ({}, {"real": {"enabled": False, "capital": 500}}, {"kill": True, "real": {"enabled": True, "capital": 500}}):
        T.real.CONTROL.parent.mkdir(parents=True, exist_ok=True)
        T.real.CONTROL.write_text(json.dumps(ctl))
        with pytest.raises(T.real.Halt):
            T.real.execute(api, ctl, {}, "BTCUSDT", 0.2, 100.0, snap_now(now), now)
    assert api.orders == []


def test_switch_reread_from_disk_before_sending(T):
    import time
    api, now = FakeAPI(), time.time()
    ctl = {"real": {"enabled": True, "capital": 500, "max_position": 0.2}}
    T.real.CONTROL.parent.mkdir(parents=True, exist_ok=True)
    T.real.CONTROL.write_text(json.dumps({"real": {"enabled": False}}))  # user turned it off just before
    with pytest.raises(T.real.Halt):
        T.real.execute(api, ctl, {}, "BTCUSDT", 0.2, 100.0, snap_now(now), now)
    assert api.orders == []


def test_real_limits_ramp_and_stale_data(T):
    import time
    api, now = FakeAPI(), time.time()
    ctl = {"real": {"enabled": True, "capital": 500, "max_position": 0.2}}
    T.real.CONTROL.parent.mkdir(parents=True, exist_ok=True)
    T.real.CONTROL.write_text(json.dumps(ctl))
    st = {}
    rec = T.real.execute(api, ctl, st, "BTCUSDT", 0.2, 100.0, snap_now(now), now)
    assert rec["qty"] * 100 <= 500 * 0.2 * 0.25 + 1e-6  # gradual ramp-up: 25% of size, position cap
    with pytest.raises(T.real.Halt):  # 3-hour-old candles
        T.real.execute(api, ctl, st, "BTCUSDT", 0.2, 100.0, {**snap_now(now), "candle_t": int(now * 1000) - 3 * 3600_000}, now)
    st["real"]["expected"]["BTCUSDT"] = 5.0  # live account does not match expected state
    with pytest.raises(T.real.Halt):
        T.real.execute(api, ctl, st, "BTCUSDT", 0.2, 100.0, snap_now(now), now)
    with pytest.raises(T.real.Halt):  # 15% drawdown
        T.real.execute(api, ctl, {"real": {"orders": 0, "expected": {}, "peak": 500, "equity": 420}}, "BTCUSDT", 0.2, 100.0, snap_now(now), now)
    assert all(side == "BUY" for _, side, _ in api.orders) and len(api.orders) == 1


def test_spot_only_never_shorts(T):
    import time
    api, now = FakeAPI(), time.time()
    ctl = {"real": {"enabled": True, "capital": 500}}
    T.real.CONTROL.parent.mkdir(parents=True, exist_ok=True)
    T.real.CONTROL.write_text(json.dumps(ctl))
    assert T.real.execute(api, ctl, {}, "BTCUSDT", -0.2, 100.0, snap_now(now), now) is None and api.orders == []


def test_confirm_each_order_queues_instead_of_sending(T):
    import time
    api, now = FakeAPI(), time.time()
    ctl = {"real": {"enabled": True, "capital": 500, "confirm_each": True}}
    T.real.CONTROL.parent.mkdir(parents=True, exist_ok=True)
    T.real.CONTROL.write_text(json.dumps(ctl))
    st = {}
    r = T.real.execute(api, ctl, st, "BTCUSDT", 0.2, 100.0, snap_now(now), now)
    assert "pending" in r and api.orders == []


def test_withdrawal_keys_rejected(T):
    class R(FakeAPI):
        testnet = False

        def __init__(self, perms):
            super().__init__()
            self.p = perms

        def restrictions(self):
            return self.p
    assert not T.real.check_permissions(R({"enableWithdrawals": True, "enableSpotAndMarginTrading": True}))["ok"]
    assert not T.real.check_permissions(R({"enableFutures": True, "enableSpotAndMarginTrading": True}))["ok"]
    assert T.real.check_permissions(R({"enableSpotAndMarginTrading": True}))["ok"]


def test_keys_never_in_repr_logs_or_errors(T, monkeypatch):
    secret, key = "S3CRET-" + "x" * 40, "KEY-" + "y" * 40
    api = T.real.Binance(key, secret, True)
    assert secret not in repr(api) and key not in repr(api)
    monkeypatch.setattr(T.real.Binance, "_req", lambda self, *a, **k: (_ for _ in ()).throw(T.real.Halt("API error on /api/v3/order: URLError")))
    with pytest.raises(T.real.Halt) as e:
        api.market("BTCUSDT", "BUY", 1)
    assert secret not in str(e.value) and key not in str(e.value)
    T.agent.log("test " + repr(api))
    assert secret not in T.agent.LOG.read_text() and key not in T.agent.LOG.read_text()


def test_real_step_disables_on_halt(T):
    import time
    T.real.CONTROL.parent.mkdir(parents=True, exist_ok=True)
    ctl = {"real": {"enabled": True, "capital": 500}}
    T.real.CONTROL.write_text(json.dumps(ctl))
    monkey_keys = lambda: None  # noqa: E731 - no keys -> halt
    T.real.load_keys = monkey_keys
    st = {}
    T.agent.real_step(st, ctl, "BTCUSDT", 0.2, 100.0, snap_now(time.time()), {"BTCUSDT": 100.0}, time.time())
    saved = json.loads(T.real.CONTROL.read_text())
    assert saved["real"]["enabled"] is False and "keys" in saved["real"]["halted"]


def test_reliability_detects_stale_data_gaps_and_bad_paper(T):
    import time
    now = time.time()
    c = [{"t": int((now - 3600 * (300 - i)) * 1000) // 3_600_000 * 3_600_000, "close_t": 0, "c": 1.0} for i in range(300)]
    for k in c:
        k["close_t"] = k["t"] + 3_599_999
    assert T.agent.data_issues(c, now) == []
    assert any("lagging" in x for x in T.agent.data_issues(c[:-5], now))
    gap = c[:250] + c[251:]
    assert any("gaps" in x for x in T.agent.data_issues(gap, now))
    assert T.agent.reconcile({"cash": float("nan"), "positions": {}})
    assert T.agent.reconcile({"cash": 100.0, "positions": {"X": {"qty": 1.0, "avg": 0.0}}})
    st = {"decisions": {"BTCUSDT": {"target": 0.2, "why": "x", "candle_t": 1}}, "paper": {"cash": 1.0, "start": 1.0, "positions": {}}}
    T.agent.health(st, {"BTCUSDT": c[:-5]}, now)
    assert st["decisions"]["BTCUSDT"]["target"] == 0.0 and st["alerts"]
    T.agent.audit_decisions(st, now)
    assert len(T.agent.DECISIONS.read_text().splitlines()) == 1
    T.agent.audit_decisions(st, now)  # same candle not logged twice
    assert len(T.agent.DECISIONS.read_text().splitlines()) == 1


def test_testnet_check_refuses_without_testnet_keys(T, monkeypatch):
    import trading.testnet_check as tc
    monkeypatch.setattr(T.real, "keys_info", lambda: {"saved": False})
    assert tc.main()["ok"] is False
    monkeypatch.setattr(T.real, "keys_info", lambda: {"saved": True, "testnet": False})
    r = tc.main()
    assert r["ok"] is False and "testnet" in r["detail"]


# ---------------------------------------------------------------- review (h): one test per bug found
def test_gross_exposure_cap_for_correlated_assets(T):
    lim = T.risk.Limits()
    assert T.risk.cap_gross(0.2, 0.0, lim) == 0.2 and T.risk.cap_gross(0.2, 0.3, lim) == pytest.approx(0.1)
    assert T.risk.cap_gross(-0.2, 0.4, lim) == 0.0


def test_absurd_price_halts_real(T):
    with pytest.raises(T.real.Halt):
        T.real.sane_price(200.0, 100.0)
    with pytest.raises(T.real.Halt):
        T.real.sane_price(0.0, 100.0)
    T.real.sane_price(101.0, 100.0)


def test_restart_mid_order_blocks_until_reviewed(T):
    import time
    api, now = FakeAPI(), time.time()
    ctl = {"real": {"enabled": True, "capital": 500, "max_position": 0.2}}
    T.real.CONTROL.parent.mkdir(parents=True, exist_ok=True)
    T.real.CONTROL.write_text(json.dumps(ctl))
    T.real.INFLIGHT.write_text("{}")  # an in-flight order was left unconfirmed
    with pytest.raises(T.real.Halt):
        T.real.execute(api, ctl, {}, "BTCUSDT", 0.2, 100.0, snap_now(now), now)
    assert api.orders == []


def test_duplicate_order_not_resent(T):
    import time
    api, now = FakeAPI(), time.time()
    ctl = {"real": {"enabled": True, "capital": 500, "max_position": 0.2}}
    T.real.CONTROL.parent.mkdir(parents=True, exist_ok=True)
    T.real.CONTROL.write_text(json.dumps(ctl))
    st = {}
    T.real.execute(api, ctl, st, "BTCUSDT", 0.2, 100.0, snap_now(now), now)
    st["real"]["expected"] = {}  # even if account appears missing it, same order for same candle not duplicated
    assert T.real.execute(api, ctl, st, "BTCUSDT", 0.2, 100.0, snap_now(now), now) is None
    assert len(api.orders) == 1 and not T.real.INFLIGHT.exists()


def test_api_down_halts_and_turns_real_off(T):
    import time

    class Down(FakeAPI):
        def account(self):
            raise T.real.Halt("API error on /api/v3/account: URLError")
    ctl = {"real": {"enabled": True, "capital": 500}}
    T.real.CONTROL.parent.mkdir(parents=True, exist_ok=True)
    T.real.CONTROL.write_text(json.dumps(ctl))
    T.real.load_keys = lambda: ("k" * 20, "s" * 20, True)
    st = {}
    T.agent.real_step(st, ctl, "BTCUSDT", 0.2, 100.0, snap_now(time.time()), {"BTCUSDT": 100.0}, time.time(), api_factory=Down)
    assert json.loads(T.real.CONTROL.read_text())["real"]["enabled"] is False


def test_mac_asleep_then_wakes_with_stale_data(T):
    import time
    wake = time.time()
    c = [{"t": int((wake - 9 * 3600 - 3600 * (300 - i)) * 1000) // 3_600_000 * 3_600_000, "c": 1.0} for i in range(300)]
    for k in c:
        k["close_t"] = k["t"] + 3_599_999
    assert any("lagging" in x for x in T.agent.data_issues(c, wake))  # 9 h asleep: does not trade without data
