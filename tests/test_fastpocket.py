"""Fast pocket: supported BUY patterns only; stop on loss."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from trading import fastpocket as F  # noqa: E402


def test_only_supported_long_patterns():
    mv = {"tests": [
        {"family": "A", "name": "Acciones: tras baja por sin causa, 5 sesiones", "kind": "equity", "dir": "baja", "group": "sin causa", "h": 5,
         "supported": True, "dev": {"mean": 0.01}, "hold": {"mean": 0.008}},
        {"family": "A", "name": "x", "kind": "equity", "dir": "sube", "group": "resultados", "h": 20,
         "supported": True, "dev": {"mean": -0.01}, "hold": {"mean": -0.01}},  # negativo: sería en corto → fuera
        {"family": "C", "name": "momentum", "kind": "equity", "supported": True, "dev": {"mean": 0.01}, "hold": {"mean": 0.01}},
        {"family": "A", "name": "y", "kind": "equity", "dir": "baja", "group": "sector", "h": 5,
         "supported": False, "dev": {"mean": 0.02}, "hold": {"mean": 0.02}}]}
    rs = F.rules(mv)
    assert [r["h"] for r in rs] == [5] and rs[0]["group"] == "sin causa"


def test_stop_halts(monkeypatch):
    pk = {"cash": 50.0, "pos": [{"sym": "X", "kind": "crypto", "entry_day": "2026-01-01", "entry": 100.0, "qty": 0.5, "h": 99, "rule": "r"}],
          "peak": 100.0}
    monkeypatch.setattr(F.movers, "fetch", lambda s, max_age_h=6: {"2026-01-01": 100.0, "2026-01-02": 40.0})
    out = F.step(pk, 100.0, [], "2026-01-02")
    assert out["value"] == 70.0 and out["halted"]
