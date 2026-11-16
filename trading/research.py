"""Market research with real public data, sources and dates. No fabrication.

Market regime (dominance, stablecoins, TVL, BTC trend) and 5–10 candidates with: thesis (from numbers),
confirmed catalysts (only those provided by sources) vs speculation, bear case, and invalidation condition.
Items unavailable in free sources are explicitly noted. Estimates are tagged as such.
"""
from __future__ import annotations

import time

from trading import data

STABLE = {"USDT", "USDC", "DAI", "FDUSD", "TUSD", "USDE", "USDS", "PYUSD", "USD1", "BUSD", "USDD", "RLUSD", "USDTB"}
WRAPPED = {"WBTC", "WETH", "STETH", "WSTETH", "WEETH", "CBBTC", "WBETH", "RETH", "BTCB", "SOLVBTC", "LBTC", "JITOSOL"}


def regime(ctx: dict, btc: dict | None) -> dict:
    notes = []
    if btc and btc.get("chg30") is not None:
        notes.append(f"BTC {btc['chg30']:+.1f}% in 30 days")
    if ctx.get("stablecoins_30d_pct") is not None:
        notes.append(f"stablecoins {ctx['stablecoins_30d_pct']:+.2f}% in 30 days (liquidity {'inflowing' if ctx['stablecoins_30d_pct'] > 0 else 'outflowing'})")
    if ctx.get("defi_tvl_30d_pct") is not None:
        notes.append(f"DeFi TVL {ctx['defi_tvl_30d_pct']:+.1f}% in 30 days")
    if ctx.get("btc_dominance") is not None:
        notes.append(f"BTC dominance {ctx['btc_dominance']}%")
    b30 = (btc or {}).get("chg30") or 0
    name = "bullish" if b30 > 10 else "bearish" if b30 < -10 else "ranging"
    risk_on = (ctx.get("stablecoins_30d_pct") or 0) > 0 and b30 > 0
    return {"name": name, "risk_on": risk_on, "notes": notes,
            "summary": f"{name.capitalize()} market{' with inflowing liquidity' if risk_on else ''}. Based on data, not forecasts."}


def candidates(markets: list[dict], n: int = 8) -> list[dict]:
    """Sorts by adjusted relative momentum (30 d without chasing vertical surges), with minimum liquidity."""
    pegged = lambda m: 0.97 < (m["price"] or 0) < 1.03 and abs(m["chg30"] or 0) < 2  # noqa: E731 - new stablecoins
    rows = [m for m in markets if m["symbol"] not in STABLE | WRAPPED and not pegged(m)
            and (m["volume"] or 0) > 50e6 and m["chg30"] is not None]
    for m in rows:
        overheat = (m["chg7"] or 0) > 40
        m["score"] = (m["chg30"] or 0) * 0.6 + (m["chg7"] or 0) * 0.4 - (40 if overheat else 0)
    out = []
    for m in sorted(rows, key=lambda r: -r["score"])[:n]:
        bull = []
        if (m["chg30"] or 0) > 0:
            bull.append(f"positive 30-day trend ({m['chg30']:+.1f}%)")
        if (m["chg7"] or 0) > 0:
            bull.append(f"continues rising this week ({m['chg7']:+.1f}%)")
        if (m["volume"] or 0) / max(1, m["mcap"] or 1) > 0.1:
            bull.append("high volume relative to market cap")
        if m["symbol"] in ("XAUT", "PAXG"):
            bull.insert(0, "tokenized gold (safe haven, not speculative crypto)")
        out.append({
            "symbol": m["symbol"], "name": m["name"], "price": m["price"], "mcap": m["mcap"],
            "thesis": "; ".join(bull) or "weak momentum: candidate solely due to liquidity",
            "catalysts_confirmed": [],  # no reliable free catalyst source: intentionally empty
            "speculation": "Catalysts (listings, upgrades, unlocks): no reliable free source. Verify before acting.",
            "bear_case": f"Down {abs(m['ath_drop'] or 0):.0f}% from all-time highs; crypto momentum turns fast and volatility is high.",
            "invalidation": f"Daily close below {m['price'] * 0.85:,.4g} $ (−15% from today) or loss of 30-day momentum.",
            "estimate": "The invalidation condition is a system rule, not a forecast.",
            "source": "api.coingecko.com/api/v3/coins/markets", "updated": m["updated"]})
    return out


def run() -> dict:
    ctx = data.fetch_context()
    try:
        mk = data.fetch_markets(60)
    except Exception as exc:  # noqa: BLE001
        return {"ts": int(time.time()), "error": f"no market data: {str(exc)[:120]}", "context": ctx}
    btc = next((m for m in mk if m["symbol"] == "BTC"), None)
    return {"ts": int(time.time()), "date": time.strftime("%Y-%m-%d %H:%M"), "context": ctx, "regime": regime(ctx, btc),
            "candidates": candidates(mk), "disclaimer": "Automated research with public data. Not financial advice."}
