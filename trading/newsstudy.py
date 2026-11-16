"""News event study, OUT-OF-SAMPLE and without looking into the future.

Data: daily GDELT timeline (article volume and mean tone in English) for each crypto, from 2023 to today,
requested respecting GDELT rate limits (>= 10 s between requests, exponential backoff on 429).
Causality: news from day d (UTC) is only used for day d+1 performance (close to close), so
everything published on day d was already public before that trade.

Tests, with the first 70% of days for development and the final 30% as test:
1) Event study: days with news spike (volume z > 2) and days of very negative tone (z < -2): next-day
   return and absolute movement compared to other days.
2) Daily model with and without news features (logistic regression, 6 crypto pool): test Brier score.
"""
from __future__ import annotations

import hashlib
import json
import math
import time
from urllib.parse import quote

import numpy as np

from trading import data, rdata
from trading import rfeat as F

OUT = data.HOME / "news_study.json"
CACHE = data.DATA / "gdelt"
QUERIES = {"BTCUSDT": "bitcoin", "ETHUSDT": "ethereum", "SOLUSDT": "solana", "XRPUSDT": "xrp ripple",
           "DOGEUSDT": "dogecoin", "BNBUSDT": "(\"binance coin\" OR bnb)"}


def gdelt(query: str, mode: str, start="20230101000000", end=None) -> dict[str, float]:
    p = CACHE / (hashlib.sha1(f"{query}|{mode}|{start}".encode()).hexdigest()[:16] + ".json")
    if p.is_file() and time.time() - p.stat().st_mtime < 86400:
        return json.loads(p.read_text())
    end = end or time.strftime("%Y%m%d000000", time.gmtime())
    url = (f"https://api.gdeltproject.org/api/v2/doc/doc?query={quote(query + ' sourcelang:english')}&mode={mode}"
           f"&format=json&startdatetime={start}&enddatetime={end}")
    wait = 15
    for _ in range(6):
        time.sleep(10)  # always >= 10 s between requests (GDELT asks for >= 5)
        try:
            d = data.get_json(url, timeout=90)
            rows = d["timeline"][0]["data"]
            out = {r["date"][:8]: float(r["value"]) for r in rows}
            data.private_write(p, json.dumps(out).encode())
            return out
        except Exception:  # noqa: BLE001 - 429 or slow: wait longer and retry
            time.sleep(wait)
            wait *= 2
    raise RuntimeError(f"GDELT did not respond for {query}")


def daily_closes(sym: str) -> dict[str, float]:
    d = F.load(sym)
    m = (d["t"] // 3_600_000) % 24 == 23
    return {time.strftime("%Y%m%d", time.gmtime(t / 1000)): c for t, c in zip(d["t"][m], d["c"][m])}


def zscore(x: np.ndarray, n: int = 60) -> np.ndarray:
    out = np.full(len(x), np.nan)
    for i in range(n, len(x)):
        w = x[i - n:i]  # past days only
        sd = w.std()
        out[i] = (x[i] - w.mean()) / sd if sd > 0 else 0.0
    return out


def run(log=print) -> dict:
    rows = []
    for sym, q in QUERIES.items():
        vol, tone = gdelt(q, "timelinevolraw"), gdelt(q, "timelinetone")
        px = daily_closes(sym)
        days = sorted(set(vol) & set(tone) & set(px))
        v = np.array([vol[d] for d in days])
        t = np.array([tone[d] for d in days])
        c = np.array([px[d] for d in days])
        r_next = np.full(len(days), np.nan)
        r_next[:-1] = np.log(c[1:] / c[:-1])  # next-day return: news from day d was already public
        r_prev = np.full(len(days), np.nan)
        r_prev[1:] = np.log(c[1:] / c[:-1])
        vz, tz = zscore(np.log1p(v)), zscore(t)
        for i in range(len(days)):
            if np.isfinite(vz[i]) and np.isfinite(r_next[i]) and np.isfinite(r_prev[i]):
                rows.append((sym, days[i], vz[i], tz[i], r_prev[i], r_next[i]))
        log(f"{sym}: {len(days)} days")
    rows.sort(key=lambda x: x[1])
    cut = rows[int(len(rows) * 0.7)][1]
    res = {"from": rows[0][1], "to": rows[-1][1], "test_from": cut, "n": len(rows), "events": {}, "model": {}}
    for part, sel in (("desarrollo", [r for r in rows if r[1] < cut]), ("prueba", [r for r in rows if r[1] >= cut])):
        base_abs = np.mean([abs(r[5]) for r in sel])
        for name, cond in (("pico de noticias", lambda r: r[2] > 2), ("tono muy negativo", lambda r: r[3] < -2), ("tono muy positivo", lambda r: r[3] > 2)):
            ev = [r[5] for r in sel if cond(r)]
            rest = [r[5] for r in sel if not cond(r)]
            if len(ev) < 5:
                continue
            m, s = float(np.mean(ev)), float(np.std(ev, ddof=1))
            tstat = (m - np.mean(rest)) / (s / math.sqrt(len(ev))) if s else 0.0
            res["events"].setdefault(name, {})[part] = {"n": len(ev), "next_ret": m, "others": float(np.mean(rest)), "t": float(tstat),
                                                        "abs_move": float(np.mean(np.abs(ev))), "abs_base": float(base_abs)}
    # daily model with and without news (logistic regression), trained on dev and measured on test
    from sklearn.linear_model import LogisticRegression
    from sklearn.preprocessing import StandardScaler
    tr = [r for r in rows if r[1] < cut]
    te = [r for r in rows if r[1] >= cut]
    ytr, yte = np.array([r[5] > 0 for r in tr]), np.array([r[5] > 0 for r in te])
    for name, cols in (("sin noticias", [4]), ("con noticias", [4, 2, 3])):
        Xtr, Xte = np.array([[r[c] for c in cols] for r in tr]), np.array([[r[c] for c in cols] for r in te])
        sc = StandardScaler().fit(Xtr)
        m = LogisticRegression(C=0.1).fit(sc.transform(Xtr), ytr)
        p = m.predict_proba(sc.transform(Xte))[:, 1]
        res["model"][name] = {"brier": float(np.mean((p - yte) ** 2)), "hit": float(np.mean((p > 0.5) == yte))}
    res["model"]["base"] = {"brier": float(np.mean((yte.mean() - yte) ** 2)), "hit": float(max(yte.mean(), 1 - yte.mean()))}
    better = res["model"]["con noticias"]["brier"] < min(res["model"]["sin noticias"]["brier"], res["model"]["base"]["brier"]) - 0.001
    res["verdict"] = ("News improves the model out-of-sample" if better else
                      "News does NOT reliably improve the model: remains as context and risk brake")
    res["uses_news_as_signal"] = bool(better)
    res["ts"] = int(time.time())
    data.private_write(OUT, json.dumps(res, ensure_ascii=False).encode())
    return res


if __name__ == "__main__":
    print(json.dumps(run(), ensure_ascii=False, indent=1))
