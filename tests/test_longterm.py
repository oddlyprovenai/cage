"""Long-term investing: no lookahead, costs and taxes, bands, default rule and paper without real orders."""
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


@pytest.fixture()
def T(tmp_path, monkeypatch):
    monkeypatch.setenv("CAGE_HOME", str(tmp_path))
    import trading.data
    importlib.reload(trading.data)
    mods = {m: importlib.reload(importlib.import_module("trading." + m)) for m in ("ltdata", "longterm", "ltpaper", "panel")}
    return type("T", (), mods)


def fake(n=1400, seed=3):
    import datetime as dt
    r = random.Random(seed)
    days = [(dt.date(2019, 1, 1) + dt.timedelta(days=i)).isoformat() for i in range(n)]
    syms = ["IWDA.AS", "EMIM.AS", "IEAG.AS", "XEON.DE", "4GLD.DE", "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "ASML.AS",
            "SAP.DE", "NOVO-B.CO", "MC.PA", "BRK-B", "JNJ", "BTCUSDT", "ETHUSDT", "SOLUSDT"]
    px = {}
    for s in syms:
        p, col = 100.0, []
        for _ in days:
            p *= math.exp(r.gauss(0.0003, 0.012))
            col.append(p)
        px[s] = col
    return days, px


def test_strategies_never_look_ahead(T):
    days, px = fake()
    i = 900
    for kind in ("etf", "crypto"):
        for _, fn in T.longterm.STRATS[kind].values():
            w = fn(px, i, "moderado")
            fut = {s: col[: i + 1] + [v * 3 for v in col[i + 1:]] for s, col in px.items()}
            assert fn(fut, i, "moderado") == w


def test_weights_are_valid_and_concentration_capped(T):
    days, px = fake()
    for prof in T.longterm.PROFILES:
        w = T.longterm.w_core_satellite(px, 900, prof)
        assert abs(sum(w.values()) - 1) < 1e-6 and all(v >= 0 for v in w.values())
        assert all(w[s] <= T.longterm.MAX_SAT + 1e-9 for s in w if s not in ("IWDA.AS", "EMIM.AS", "IEAG.AS", "XEON.DE"))
    assert max(T.longterm.w_crypto_core(px, 900, "moderado").values()) <= T.longterm.MAX_CRYPTO


def test_book_charges_fees_and_estimated_taxes(T):
    b = T.longterm.Book(1000.0)
    b.trade("X", 10, 50.0, "2026-03-01", "t")
    b.trade("X", -10, 60.0, "2026-04-01", "t")
    assert b.s["fees"] > 0 and b.s["realized"]["2026"] == pytest.approx(100)
    T.longterm.settle_year(b.s, "2026")
    assert b.s["taxes"] == pytest.approx(19.0)  # primer tramo del ahorro: 19 %


def test_spanish_brackets_and_loss_carryforward(T):
    t = T.longterm.spanish_tax
    assert t(6_000) == pytest.approx(1_140) and t(10_000) == pytest.approx(1_140 + 840)
    assert t(0) == 0 and t(-500) == 0
    st = {"cash": 0.0, "realized": {"2025": -1_000.0, "2026": 1_500.0}}
    T.longterm.settle_year(st, "2025")
    assert st["taxes"] == 0 and st["carry"] == [["2025", 1_000.0]]
    T.longterm.settle_year(st, "2026")
    assert st["taxes"] == pytest.approx(0.19 * 500)  # la pérdida de 2025 compensa


def test_backtest_uses_yesterdays_signal(T):
    """La estrategia decide con datos hasta el día anterior: cambiar el precio de HOY no cambia la decisión de hoy."""
    days, px = fake()
    calls = []

    def spy(p, i, prof):
        calls.append(i)
        return {"IWDA.AS": 1.0}
    T.longterm.run(days, px, spy, start_i=300)
    assert all(i < len(days) - 1 for i in calls) and 300 not in calls[1:]


def test_default_is_indexed_unless_active_beats_index_and_indexed(T):
    days, px = fake()
    e = T.longterm.evaluate(days, px, "etf")
    r = e["strategies"]
    m = T.longterm.MIN_EDGE_BIASED
    beats = r["core_sat"]["cagr"] > r["index"]["cagr"] + m and r["core_sat"]["cagr"] > r["indexed"]["cagr"] + m and \
        r["core_sat"]["max_dd"] <= r["indexed"]["max_dd"] + 0.05
    assert e["default"] == ("core_sat" if beats else "indexed")
    assert all(0 <= v["max_dd"] < 1 for v in r.values())


def test_paper_sleeves_follow_profile_and_never_send(T, monkeypatch):
    days, px = fake()
    monkeypatch.setattr(T.ltdata, "table", lambda syms, refresh=True: (days, {s: px[s] for s in syms}, {s: {"source": "prueba", "last": days[-1]} for s in syms}))
    T.panel.control("lt_config", {"risk": "conservador", "monthly": 0})
    st = T.ltpaper.daily(refresh=False)
    assert st["sleeves"]["crypto"].get("disabled")  # perfil conservador: sin cripto
    assert st["config"]["monthly"] == 0.0
    e = st["sleeves"]["etf"]
    assert abs(sum(e["weights"].values()) - 1) < 0.02 and e["value"] <= 10_000
    assert all("proposal" in p["note"] for p in e["proposals"])
    T.panel.control("lt_config", {"risk": "dinamico", "monthly": 500})
    st = T.ltpaper.daily(refresh=False)
    assert st["sleeves"]["crypto"]["book"]["contributed"] == pytest.approx(10_000 * 0.10)


def test_longterm_has_no_order_sending_path():
    """Long-term component only simulates and PROPOSES: never imports real path or calls exchanges."""
    for f in ("ltpaper.py", "longterm.py", "ltdata.py"):
        src = (ROOT / "trading" / f).read_text()
        assert "import real" not in src and "from trading import real" not in src and "/api/v3/order" not in src


def test_data_anomalies_detected(T):
    rows = [["2026-01-01", 100.0], ["2026-01-02", 101.0], ["2026-01-02", 101.0], ["2026-01-05", 20.0], ["2026-01-06", -1.0]]
    a = T.ltdata.anomalies(rows)
    assert any("repeated" in x for x in a) and any("jump" in x for x in a) and any("non-positive" in x for x in a)
    assert T.ltdata.anomalies([["2026-01-01", 100.0], ["2026-01-02", 140.0]], crypto=True) == []
