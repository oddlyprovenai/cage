"""Data for model research (public, no key): 4 years of 1h candles from 15 liquid Binance
spot pairs and historical funding rates of their perpetuals (Binance futures, public). Free historical open interest
only covers ~30 days, so it is not used (reported in the paper). Directory: ~/.cage/trading/data/research (0600).
"""
from __future__ import annotations

import json
import time

from trading import data

PAIRS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT", "AVAXUSDT", "LINKUSDT",
         "DOTUSDT", "LTCUSDT", "TRXUSDT", "ATOMUSDT", "NEARUSDT", "BCHUSDT"]
DIR = data.DATA / "research"
H = 3_600_000


def candles(sym: str, days: int = 1460) -> list[list]:
    """[t, o, h, l, c, quote_volume] per hour, closed. Incremental."""
    p = DIR / f"{sym}-1h.json"
    have = json.loads(p.read_text()) if p.is_file() else []
    start = have[-1][0] + H if have else int(time.time() * 1000) - days * 86_400_000
    now = time.time() * 1000
    for _ in range(60):
        raw = data.get_json(f"{data.BINANCE}/klines?symbol={sym}&interval=1h&limit=1000&startTime={start}")
        rows = [[int(k[0]), float(k[1]), float(k[2]), float(k[3]), float(k[4]), float(k[7])] for k in raw if int(k[6]) < now]
        if not rows:
            break
        have += rows
        start = rows[-1][0] + H
        if len(raw) < 1000:
            break
    data.private_write(p, json.dumps(have, separators=(",", ":")).encode())
    return have


def funding(sym: str, days: int = 1460) -> list[list]:
    """[t, rate] every 8 h for USDT-M perpetual. Empty list if pair has no perpetual."""
    p = DIR / f"{sym}-funding.json"
    have = json.loads(p.read_text()) if p.is_file() else []
    start = have[-1][0] + 1 if have else int(time.time() * 1000) - days * 86_400_000
    for _ in range(10):
        try:
            raw = data.get_json(f"https://fapi.binance.com/fapi/v1/fundingRate?symbol={sym}&limit=1000&startTime={start}")
        except Exception:  # noqa: BLE001
            break
        rows = [[int(r["fundingTime"]), float(r["fundingRate"])] for r in raw]
        if not rows:
            break
        have += rows
        start = rows[-1][0] + 1
        if len(raw) < 1000:
            break
    data.private_write(p, json.dumps(have, separators=(",", ":")).encode())
    return have


if __name__ == "__main__":
    for s in PAIRS:
        c, f = candles(s), funding(s)
        print(s, len(c), "candles", time.strftime("%Y-%m-%d", time.gmtime(c[0][0] / 1000)) if c else "-", len(f), "funding", flush=True)
