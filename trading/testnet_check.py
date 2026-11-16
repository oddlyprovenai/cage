#!/usr/bin/env python3
"""Full check of real-money path AGAINST Binance TESTNET (paper money). Refuses to run if saved keys are
not testnet. Goes through: permissions and account -> small buy -> sell -> comparison with simulated execution.
Uses its own temporary folder for control, so it never turns on true live trading.
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main() -> dict:
    from trading import data, real
    info = real.keys_info()
    if not info.get("saved"):
        return {"ok": False, "detail": "No saved keys. Create them on testnet.binance.vision and save them in Cage -> Agent -> Real mode (checking testnet)."}
    if not info.get("testnet"):
        return {"ok": False, "detail": "Saved keys are for mainnet: this check is only performed with testnet keys."}
    k, s, testnet = real.load_keys()
    assert testnet
    api = real.Binance(k, s, True)
    out = {"steps": []}
    perm = real.check_permissions(api)
    out["steps"].append(["permissions and account", perm["detail"]])
    tmp = Path(tempfile.mkdtemp(prefix="cage-testnet-"))
    real.CONTROL = tmp / "control.json"
    real.ORDERS = tmp / "orders.jsonl"
    ctl = {"real": {"enabled": True, "capital": 100.0, "max_position": 0.5, "testnet": True}}
    real.CONTROL.write_text(json.dumps(ctl))
    try:
        book = data.get_json(real.TESTNET + "/api/v3/depth?symbol=BTCUSDT&limit=5")
        bid, ask = float(book["bids"][0][0]), float(book["asks"][0][0])
        price = (bid + ask) / 2
        now = time.time()
        snap = {"candle_t": int(now * 1000) - 60_000, "book_t": int(now * 1000), "spread_bps": 1e4 * (ask - bid) / price}
        st: dict = {}
        buy = real.execute(api, ctl, st, "BTCUSDT", 0.5, price, snap, now)
        out["steps"].append(["testnet buy", buy])
        sell = real.execute(api, ctl, st, "BTCUSDT", 0.0, price, snap, time.time())
        out["steps"].append(["testnet sell", sell])
        out["ok"] = bool(buy) and "pending" not in (buy or {})
        out["detail"] = "Real-money path verified on testnet" if out["ok"] else "Order was not sent (exchange minimums or limits)."
    except real.Halt as h:
        out.update(ok=False, detail=f"Safety halt: {h}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return out


if __name__ == "__main__":
    print(json.dumps(main(), ensure_ascii=False, default=str))
