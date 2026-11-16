"""Public, free market data without keys or accounts. GET only.

- Binance: candles (klines) and order book (depth).
- CoinGecko: global market cap and BTC/ETH dominance.
- DefiLlama: total stablecoin supply and total DeFi TVL.
Historical data stored in ~/.cage/trading/data (0600) for training and walk-forward evaluation.
"""
from __future__ import annotations

import json
import os
import subprocess
import time
from pathlib import Path

HOME = Path(os.environ.get("CAGE_HOME", Path.home() / ".cage")) / "trading"
DATA = HOME / "data"
BINANCE = "https://api.binance.com/api/v3"
UA = "Cage/0.4 (paper agent; reading)"


def get_json(url: str, timeout: float = 20):
    """GET JSON. First urllib; if Python TLS fails (some environments), system curl."""
    import urllib.request

    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())
    except Exception:  # noqa: BLE001 - retried with curl
        out = subprocess.run(["curl", "-sS", "--fail", "--max-time", str(int(timeout)), "-A", UA, url],
                             capture_output=True, timeout=timeout + 5, check=True)
        return json.loads(out.stdout)


def private_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = path.with_suffix(path.suffix + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(data)
    os.replace(tmp, path)


# ---------------------------------------------------------------- candles
def parse_klines(raw: list) -> list[dict]:
    """[open_time, o, h, l, c, v, close_time, quote_vol, trades, ...] → dicts. Closed candles only."""
    now_ms = int(time.time() * 1000)
    return [{"t": int(k[0]), "o": float(k[1]), "h": float(k[2]), "l": float(k[3]), "c": float(k[4]),
             "v": float(k[5]), "qv": float(k[7]), "n": int(k[8]), "close_t": int(k[6])}
            for k in raw if int(k[6]) < now_ms]


def fetch_klines(symbol: str, interval: str = "1h", start_ms: int | None = None, limit: int = 1000) -> list[dict]:
    url = f"{BINANCE}/klines?symbol={symbol}&interval={interval}&limit={limit}"
    if start_ms is not None:
        url += f"&startTime={start_ms}"
    return parse_klines(get_json(url))


def candles_path(symbol: str, interval: str = "1h") -> Path:
    return DATA / f"{symbol}-{interval}.json"


def load_candles(symbol: str, interval: str = "1h") -> list[dict]:
    p = candles_path(symbol, interval)
    return json.loads(p.read_text()) if p.is_file() else []


def update_candles(symbol: str, interval: str = "1h", days: int = 730, max_calls: int = 30) -> list[dict]:
    """Downloads missing data (up to `days` back) and saves. Idempotent; no gaps or duplicates."""
    have = load_candles(symbol, interval)
    step = {"1h": 3600_000, "15m": 900_000, "4h": 14_400_000, "1d": 86_400_000}[interval]
    start = have[-1]["t"] + step if have else int(time.time() * 1000) - days * 86_400_000
    calls = 0
    while calls < max_calls:
        batch = fetch_klines(symbol, interval, start)
        calls += 1
        batch = [k for k in batch if not have or k["t"] > have[-1]["t"]]
        if not batch:
            break
        have += batch
        start = batch[-1]["t"] + step
        if len(batch) < 999:
            break
    private_write(candles_path(symbol, interval), json.dumps(have, separators=(",", ":")).encode())
    return have


# ---------------------------------------------------------------- libro y contexto
def fetch_book(symbol: str, limit: int = 20) -> dict:
    d = get_json(f"{BINANCE}/depth?symbol={symbol}&limit={limit}")
    bids = [(float(p), float(q)) for p, q in d["bids"]]
    asks = [(float(p), float(q)) for p, q in d["asks"]]
    return {"ts": int(time.time() * 1000), "bids": bids, "asks": asks}


def fetch_context() -> dict:
    """Macro crypto context with source and timestamp for each point. Failed fields remain None (never fabricated)."""
    ctx: dict = {"ts": int(time.time()), "sources": {}}
    try:
        g = get_json("https://api.coingecko.com/api/v3/global")["data"]
        ctx.update(btc_dominance=round(g["market_cap_percentage"]["btc"], 2),
                   eth_dominance=round(g["market_cap_percentage"]["eth"], 2),
                   total_mcap_usd=g["total_market_cap"]["usd"], mcap_change_24h=round(g["market_cap_change_percentage_24h_usd"], 2))
        ctx["sources"]["dominance"] = "api.coingecko.com/api/v3/global"
    except Exception:  # noqa: BLE001
        ctx.update(btc_dominance=None, eth_dominance=None)
    try:
        s = get_json("https://stablecoins.llama.fi/stablecoincharts/all")
        last, prev = s[-1], s[-31] if len(s) > 31 else s[0]
        cur = last["totalCirculatingUSD"]["peggedUSD"]
        ctx.update(stablecoins_usd=cur, stablecoins_30d_pct=round(100 * (cur / prev["totalCirculatingUSD"]["peggedUSD"] - 1), 2))
        ctx["sources"]["stablecoins"] = "stablecoins.llama.fi/stablecoincharts/all"
    except Exception:  # noqa: BLE001
        ctx.update(stablecoins_usd=None)
    try:
        t = get_json("https://api.llama.fi/v2/historicalChainTvl")
        ctx.update(defi_tvl_usd=t[-1]["tvl"], defi_tvl_30d_pct=round(100 * (t[-1]["tvl"] / t[-31]["tvl"] - 1), 2))
        ctx["sources"]["tvl"] = "api.llama.fi/v2/historicalChainTvl"
    except Exception:  # noqa: BLE001
        ctx.update(defi_tvl_usd=None)
    ctx["unlocks"] = None  # no free, reliable keyless source for token unlocks: state it, do not invent
    return ctx


def fetch_markets(n: int = 40) -> list[dict]:
    """Top coins by market cap (CoinGecko) with 24h/7d/30d changes for candidate research."""
    rows = get_json("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc"
                    f"&per_page={n}&page=1&price_change_percentage=24h,7d,30d")
    return [{"id": r["id"], "symbol": r["symbol"].upper(), "name": r["name"], "price": r["current_price"],
             "mcap": r["market_cap"], "volume": r["total_volume"], "chg24": r.get("price_change_percentage_24h_in_currency"),
             "chg7": r.get("price_change_percentage_7d_in_currency"), "chg30": r.get("price_change_percentage_30d_in_currency"),
             "ath_drop": r.get("ath_change_percentage"), "updated": r.get("last_updated")} for r in rows]
