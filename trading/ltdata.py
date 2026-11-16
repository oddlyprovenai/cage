"""Daily data for long-term investing (public, free, keyless). Always with source and date.

- Stocks and ETFs: public Yahoo Finance chart API (adjusted close for dividends and splits).
  Converted to euros with daily exchange rates from same source (EURUSD=X, EURDKK=X).
- Crypto: Binance daily candles (USDT) converted to euros with EURUSD.
Cache in ~/.cage/trading/data/daily (0600).
"""
from __future__ import annotations

import json
import time

from trading import data

DAILY = data.DATA / "daily"
YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart/{}?range=10y&interval=1d"
SOURCE = {"yahoo": "Yahoo Finance (public chart API, adjusted close)", "binance": "Binance (public daily candles)"}

ETF = {"IWDA.AS": "iShares Core MSCI World (UCITS, EUR)", "EMIM.AS": "iShares Core MSCI EM IMI (UCITS, EUR)",
       "IEAG.AS": "iShares Core Euro Aggregate Bond (UCITS, EUR)", "XEON.DE": "Xtrackers EUR Overnight Rate (liquidity)",
       "4GLD.DE": "Xetra-Gold (physical gold, EUR)"}
STOCKS = {"AAPL": "Apple", "MSFT": "Microsoft", "NVDA": "NVIDIA", "AMZN": "Amazon", "GOOGL": "Alphabet", "META": "Meta",
          "ASML.AS": "ASML", "SAP.DE": "SAP", "NOVO-B.CO": "Novo Nordisk", "MC.PA": "LVMH", "BRK-B": "Berkshire Hathaway",
          "JNJ": "Johnson & Johnson"}
CRYPTO = {"BTCUSDT": "Bitcoin", "ETHUSDT": "Ethereum", "SOLUSDT": "Solana"}
FX = {"USD": "EURUSD=X", "DKK": "EURDKK=X"}


def _day(ts: float) -> str:
    return time.strftime("%Y-%m-%d", time.gmtime(ts))


def fetch_yahoo(sym: str) -> dict:
    r = data.get_json(YAHOO.format(sym))["chart"]["result"][0]
    adj = r["indicators"].get("adjclose", [{}])[0].get("adjclose") or r["indicators"]["quote"][0]["close"]
    rows = [(_day(t), round(p, 6)) for t, p in zip(r["timestamp"], adj) if p]
    return {"sym": sym, "currency": r["meta"]["currency"], "source": SOURCE["yahoo"], "fetched": int(time.time()), "rows": rows}


def fetch_binance_daily(sym: str) -> dict:
    out, start = [], int(time.time() * 1000) - 3650 * 86_400_000
    for _ in range(5):
        raw = data.get_json(f"{data.BINANCE}/klines?symbol={sym}&interval=1d&limit=1000&startTime={start}")
        out += [(_day(k[0] / 1000), float(k[4])) for k in raw if int(k[6]) < time.time() * 1000]
        if len(raw) < 1000:
            break
        start = raw[-1][0] + 86_400_000
    return {"sym": sym, "currency": "USD", "source": SOURCE["binance"], "fetched": int(time.time()), "rows": out}


def load(sym: str, max_age_h: float = 20) -> dict:
    """Cached series; refreshes if older than `max_age_h` hours. Without network, uses cache and reports its date."""
    p = DAILY / (sym.replace("=", "_") + ".json")
    cur = json.loads(p.read_text()) if p.is_file() else None
    if cur and time.time() - cur["fetched"] < max_age_h * 3600:
        return cur
    try:
        new = fetch_binance_daily(sym) if sym in CRYPTO else fetch_yahoo(sym)
        data.private_write(p, json.dumps(new, separators=(",", ":")).encode())
        return new
    except Exception:  # noqa: BLE001
        if cur:
            return cur
        raise


def anomalies(rows: list, crypto: bool = False) -> list[str]:
    """Data quality issues: repeated or out-of-order dates, non-positive prices and impossible daily jumps
    (> 50% in stocks/ETFs, > 60% in crypto), typical of a poorly applied split adjustment."""
    out, lim = [], 0.60 if crypto else 0.50
    for (d0, p0), (d1, p1) in zip(rows, rows[1:]):
        if d1 <= d0:
            out.append(f"repeated or out-of-order date {d1}")
        if not p1 or p1 <= 0:
            out.append(f"non-positive price {d1}")
        elif p0 and abs(p1 / p0 - 1) > lim:
            out.append(f"jump of {100 * (p1 / p0 - 1):+.0f}% on {d1}")
    return out[:10]


def table(syms: list[str], refresh: bool = True) -> tuple[list[str], dict[str, list[float | None]], dict]:
    """Common dates and prices IN EUROS per symbol (forward-filled; None before asset existed)."""
    series, meta = {}, {}
    fx = {cur: dict((load(t) if refresh else json.loads((DAILY / (t.replace("=", "_") + ".json")).read_text()))["rows"])
          for cur, t in FX.items()}  # also without refresh: always in euros
    for s in syms:
        d = load(s) if refresh else json.loads((DAILY / (s + ".json")).read_text())
        rate = fx.get(d["currency"])
        if d["currency"] != "EUR" and rate is None:  # never mix currencies: no rate, no price
            raise ValueError(f"no exchange rate {d['currency']}→EUR for {s}")
        rows = {}
        last_fx = None
        for day, px in d["rows"]:
            if rate is not None:
                last_fx = rate.get(day, last_fx)
                if not last_fx:
                    continue
                px = px / last_fx
            rows[day] = px
        series[s] = rows
        meta[s] = {"source": d["source"], "currency": d["currency"], "fetched": d["fetched"], "last": d["rows"][-1][0] if d["rows"] else None,
                   "anomalies": anomalies(d["rows"], s in CRYPTO)}
    days = sorted({k for r in series.values() for k in r if k >= "2017-01-01"})
    out = {}
    for s, rows in series.items():
        col, last = [], None
        for day in days:
            last = rows.get(day, last)
            col.append(last)
        out[s] = col
    return days, out, meta
