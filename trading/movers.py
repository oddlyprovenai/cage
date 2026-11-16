"""Study "20 per market", part 1: data and episodes.

For each asset: daily return decomposed into market + sector + idiosyncratic component (250-day rolling
regression with data prior to the day, without lookahead bias). An EPISODE is a day with abnormal movement:
idiosyncratic part > 3 standard deviations (or, in crypto, against Bitcoin), or extreme total movement
dragged by the market.
Then performance 1, 5, 20 and 60 sessions later is measured (in excess over the market).
Causes are attributed in `moverwhy.py`; nothing is fabricated here.
"""
from __future__ import annotations

import json
import math
import time

from trading import data
from trading.universe import MARKETS, SECTOR_ETF, index_for

DIR = data.DATA / "movers"
START = 1262304000  # 2010-01-01
YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart/{}?period1={}&period2={}&interval=1d"
WIN, Z, Z_TOTAL = 250, 3.0, 4.0
AFTER = (1, 5, 20, 60)


def _day(ts):
    return time.strftime("%Y-%m-%d", time.gmtime(ts))


def fetch(sym: str, max_age_h=20) -> dict[str, float]:
    DIR.mkdir(parents=True, exist_ok=True)
    p = DIR / (sym.replace("^", "_").replace("=", "_") + ".json")
    if p.is_file() and time.time() - p.stat().st_mtime < max_age_h * 3600:
        return json.loads(p.read_text())
    if sym.endswith("USDT"):
        out, start = {}, START * 1000
        for _ in range(8):
            raw = data.get_json(f"{data.BINANCE}/klines?symbol={sym}&interval=1d&limit=1000&startTime={start}")
            out.update({_day(k[0] / 1000): float(k[4]) for k in raw if int(k[6]) < time.time() * 1000})
            if len(raw) < 1000:
                break
            start = raw[-1][0] + 86_400_000
    else:
        r = data.get_json(YAHOO.format(sym, START, int(time.time())))["chart"]["result"][0]
        adj = r["indicators"].get("adjclose", [{}])[0].get("adjclose") or r["indicators"]["quote"][0]["close"]
        off = r["meta"].get("gmtoffset", 0)  # LOCAL trading day
        out = {_day(t + off): round(x, 6) for t, x in zip(r.get("timestamp") or [], adj) if x}
    data.private_write(p, json.dumps(out, separators=(",", ":")).encode())
    time.sleep(0.4)
    return out


def _ols2(y, x1, x2):
    """y ≈ a + b1·x1 + b2·x2 (x2 may be omitted). Returns (a, b1, b2, residual_sd)."""
    n = len(y)
    if x2 is None:
        mx, my = sum(x1) / n, sum(y) / n
        sxx = sum((a - mx) ** 2 for a in x1) or 1e-12
        b1 = sum((a - mx) * (b - my) for a, b in zip(x1, y)) / sxx
        a0 = my - b1 * mx
        res = [b - a0 - b1 * a for a, b in zip(x1, y)]
        return a0, b1, 0.0, math.sqrt(sum(r * r for r in res) / max(1, n - 2))
    m1, m2, my = sum(x1) / n, sum(x2) / n, sum(y) / n
    s11 = sum((a - m1) ** 2 for a in x1)
    s22 = sum((a - m2) ** 2 for a in x2)
    s12 = sum((a - m1) * (b - m2) for a, b in zip(x1, x2))
    s1y = sum((a - m1) * (c - my) for a, c in zip(x1, y))
    s2y = sum((b - m2) * (c - my) for b, c in zip(x2, y))
    det = s11 * s22 - s12 * s12
    if abs(det) < 1e-18:
        return _ols2(y, x1, None)
    b1 = (s1y * s22 - s2y * s12) / det
    b2 = (s2y * s11 - s1y * s12) / det
    a0 = my - b1 * m1 - b2 * m2
    res = [c - a0 - b1 * a - b2 * b for a, b, c in zip(x1, x2, y)]
    return a0, b1, b2, math.sqrt(sum(r * r for r in res) / max(1, n - 3))


def _rets(px: dict, days: list[str]) -> list[float | None]:
    out, prev = [], None
    for d in days:
        v = px.get(d)
        out.append(v / prev - 1 if v and prev else None)
        if v:
            prev = v
    return out


def analyse(market: str, sym: str, recent: int | None = None) -> dict:
    """`recent`: only the last N days (daily fast pocket usage)."""
    name, sector = MARKETS[market]["tickers"][sym]
    px = fetch(sym)
    idx_sym = index_for(market, sym)
    idx = fetch(idx_sym) if idx_sym and idx_sym != sym else {}
    sec_sym = SECTOR_ETF.get(MARKETS[market]["sectors"] or "", {}).get(sector)
    sec = fetch(sec_sym) if sec_sym else {}
    days = sorted(px)
    r = _rets(px, days)
    rm = _rets(idx, days) if idx else [0.0] * len(days)
    rs = _rets(sec, days) if sec else [None] * len(days)
    if MARKETS[market]["sectors"] == "global" and sec:  # US ETF closes later: use previous day
        rs = [None] + rs[:-1]
    dec, eps = [], []
    for i in range(max(WIN + 1, len(days) - recent) if recent else WIN + 1, len(days)):
        if r[i] is None:
            dec.append(None)
            continue
        hist = [k for k in range(i - WIN, i) if r[k] is not None and rm[k] is not None]
        if len(hist) < WIN * 0.7:
            dec.append(None)
            continue
        use_sec = sum(rs[k] is not None for k in hist) > WIN * 0.7 and rs[i] is not None
        hist2 = [k for k in hist if not use_sec or rs[k] is not None]
        a0, b1, b2, sd = _ols2([r[k] for k in hist2], [rm[k] for k in hist2], [rs[k] for k in hist2] if use_sec else None)
        # sector as difference from explained market: market part = b1·rm; sector = b2·rs
        mkt = b1 * (rm[i] or 0)
        sct = b2 * rs[i] if use_sec else 0.0
        own = r[i] - a0 - mkt - sct
        dec.append((own, sd, mkt, sct))
        total_sd = math.sqrt(sum(r[k] ** 2 for k in hist) / len(hist))
        kind = None
        if sd and abs(own) > Z * sd:
            kind = "propio"
        elif total_sd and abs(r[i]) > Z_TOTAL * total_sd:
            kind = "sector" if abs(sct) > abs(mkt) else "mercado"
        if kind:
            eps.append({"i": i, "date": days[i], "ret": r[i], "own": own, "z": own / sd if sd else 0, "mkt": mkt, "sector": sct,
                        "kind": kind, "dir": "sube" if r[i] > 0 else "baja"})
    # after the episode: excess over market (beta 1 for simplicity and avoiding future estimation)
    for e in eps:
        i = e.pop("i")
        for h in AFTER:
            if i + h < len(days):
                a = px[days[i + h]] / px[days[i]] - 1
                b = (idx[days[i + h]] / idx[days[i]] - 1) if idx and days[i + h] in idx and days[i] in idx else 0.0
                e[f"ex{h}"] = a - b
                e[f"r{h}"] = a
            if i + 1 + h < len(days):  # actionable: entering at close of NEXT DAY (signal is already known)
                a = px[days[i + 1 + h]] / px[days[i + 1]] - 1
                b = (idx[days[i + 1 + h]] / idx[days[i + 1]] - 1) if idx and days[i + 1 + h] in idx and days[i + 1] in idx else 0.0
                e[f"nx{h}"] = a - b
        # recovery: sessions until returning to prior eve price (drops) or losing the rise
        p0 = px[days[i - 1]]
        rec = None
        for k in range(i + 1, min(len(days), i + 500)):
            if (e["dir"] == "baja" and px[days[k]] >= p0) or (e["dir"] == "sube" and px[days[k]] <= p0):
                rec = k - i
                break
        e["recover_days"] = rec
    return {"sym": sym, "name": name, "sector": sector, "market": market, "index": idx_sym, "sector_etf": sec_sym,
            "first": days[0], "last": days[-1], "n_days": len(days), "episodes": eps}


def run_all(log=print) -> dict:
    out = {}
    for m, d in MARKETS.items():
        for s in d["tickers"]:
            try:
                out[s] = analyse(m, s)
                log(f"{s}: {len(out[s]['episodes'])} episodes")
            except Exception as e:  # noqa: BLE001 - reported, never fabricated
                out[s] = {"sym": s, "market": m, "error": str(e)[:120]}
                log(f"{s}: ERROR {e}")
    data.private_write(DIR / "episodes.json", json.dumps(out, separators=(",", ":")).encode())
    return out


if __name__ == "__main__":
    run_all()
