"""Blockchair: encrypted key (never plaintext or in errors), quota halts before limit and cache."""
from __future__ import annotations

import importlib
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
KEY = "test-key-aaaaaaaaaaaaaaaaaaaaaaaa"  # fake, not a real key


@pytest.fixture()
def B(tmp_path, monkeypatch):
    monkeypatch.setenv("CAGE_HOME", str(tmp_path))
    from trading import data
    importlib.reload(data)
    from trading import blockchair
    importlib.reload(blockchair)
    box = {}
    monkeypatch.setattr(blockchair, "_kc_set", lambda t: box.update(t=t))   # sin tocar el llavero real
    monkeypatch.setattr(blockchair, "_kc_get", lambda: box.get("t"))
    calls = []

    def fake_curl(url, timeout=40):
        calls.append(url)
        return {"data": {"best_block_height": 1}, "context": {"code": 200, "request_cost": 2}}
    monkeypatch.setattr(blockchair, "_curl", fake_curl)
    blockchair._calls = calls
    return blockchair


def test_key_encrypted_and_masked(B):
    B.store_key(KEY)
    raw = B.KEYF.read_text()
    assert KEY not in raw and B.load_key() == KEY
    assert B.info()["hint"] == "test…aaaa" and KEY not in json.dumps(B.info())
    with pytest.raises(ValueError):
        B.store_key("corta")


def test_quota_stops_before_limit_and_cache_avoids_repeats(B):
    B.store_key(KEY)
    u = B.usage()
    u["limit"] = 10
    B.data.private_write(B.USAGE, json.dumps(u).encode())
    B.call("/bitcoin/stats", ttl=3600)
    B.call("/bitcoin/stats", ttl=3600)            # caché: no gasta
    assert len(B._calls) == 1 and B.usage()["points"] == 2
    for i in range(4):
        B.call(f"/bitcoin/x{i}", ttl=0)            # 2 + 4×2 = 10 puntos (la 4.ª entra: 8 < 9)
    with pytest.raises(B.Quota):                    # 10 ≥ 90 % de 10: se para antes de pasarse más
        B.call("/bitcoin/otra", ttl=0)
    assert len(B._calls) == 5


def test_errors_never_carry_the_key(B, monkeypatch):
    B.store_key(KEY)
    monkeypatch.setattr(B, "_curl", lambda url, timeout=40: {"data": None, "context": {"code": 430, "error": "bloqueado"}})
    with pytest.raises(B.ApiError) as e:
        B.call("/bitcoin/stats", ttl=0)
    assert KEY not in str(e.value)
    src = (Path(B.__file__)).read_text()
    assert '"-K", "-"' in src  # la URL con la clave va por la entrada estándar, no como argumento visible
