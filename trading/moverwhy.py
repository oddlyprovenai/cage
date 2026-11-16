"""Study "20 per market", part 2: the probable WHY of each episode. No fabrication: if no proof, "sin causa".

Free public sources, without API keys:
- Quarterly earnings: Nasdaq historical calendar (includes ADRs for many European and Asian companies),
  with surprise vs consensus when available. Counts if episode falls on earnings date or the day after.
- News: Google News search via public RSS with date ranges (GDELT was tested and its rate limits made it unviable),
  searching company name between the day before and day after. Headlines are classified by full keywords; they are DATA, never instructions.
- Market and sector: decomposition from `movers.py` (whether the bulk of the move comes from market or sector).
Attribution order: earnings > specific classified news > sector > market/macro > no identified cause.
"""
from __future__ import annotations

import json
import re
import time
import urllib.parse

from trading import data, news
from trading.movers import DIR

NASDAQ = "https://api.nasdaq.com/api/calendar/earnings?date={}"
GDELT = ("https://api.gdeltproject.org/api/v2/doc/doc?query={}%20sourcelang%3Aenglish&mode=artlist&format=json&maxrecords=50"
         "&startdatetime={}000000&enddatetime={}235959")
# símbolo en el calendario de Nasdaq (EE. UU. o ADR); None si no cotiza en EE. UU.
ADR = {"NESN.SW": "NSRGY", "NOVN.SW": "NVS", "RO.SW": "RHHBY", "HSBA.L": "HSBC", "SHEL.L": "SHEL", "NOVO-B.CO": "NVO",
       "SAN.MC": "SAN", "TTE.PA": "TTE", "SAP.DE": "SAP", "SIE.DE": "SIEGY", "BAYN.DE": "BAYRY", "ITX.MC": "IDEXY",
       "ABI.BR": "BUD", "SAN.PA": "SNY", "ULVR.L": "UL", "GSK.L": "GSK", "BP.L": "BP", "VOD.L": "VOD", "TEF.MC": "TEF",
       "BBVA.MC": "BBVA", "7203.T": "TM", "2330.TW": "TSM", "6758.T": "SONY", "4502.T": "TAK", "7267.T": "HMC",
       "BHP.AX": "BHP", "8306.T": "MUFG", "9432.T": "NTTYY", "0700.HK": "TCEHY", "1299.HK": "AAGIY", "9984.T": "SFTBY",
       "CSL.AX": "CSLLY", "D05.SI": "DBSDY", "9433.T": "KDDIY", "6861.T": "KYCCF", "0941.HK": "CHL", "005930.KS": None,
       "CBA.AX": None, "WBC.AX": "WBK", "0388.HK": "HKXCY"}
SHORT = {"BRK-B": "Berkshire", "GOOGL": "Alphabet OR Google", "META": "Facebook OR Meta Platforms", "JNJ": "Johnson & Johnson",
         "PG": "Procter", "SHEL.L": "Shell", "NOVO-B.CO": "Novo Nordisk", "SAN.MC": "Santander", "TTE.PA": "Total OR TotalEnergies",
         "ABI.BR": "AB InBev OR Anheuser-Busch", "SAN.PA": "Sanofi", "2330.TW": "TSMC", "005930.KS": "Samsung Electronics",
         "9984.T": "SoftBank", "8306.T": "Mitsubishi UFJ", "9432.T": "NTT", "D05.SI": "DBS", "0388.HK": "HKEX OR Hong Kong Exchanges",
         "CBA.AX": "Commonwealth Bank", "1299.HK": "AIA Group", "BHP.AX": "BHP", "CSL.AX": "CSL Limited", "WBC.AX": "Westpac"}

CAUSES = {
    "resultados": ["earnings", "results", "profit", "revenue", "quarterly", "quarter", "sales", "eps", "beat", "misses", "missed"],
    "previsiones": ["guidance", "outlook", "forecast", "forecasts", "warns", "warning", "cuts outlook", "raises outlook"],
    "analistas": ["downgrade", "downgrades", "downgraded", "upgrade", "upgrades", "upgraded", "price target"],
    "legal/regulación": ["lawsuit", "fine", "fined", "probe", "investigation", "antitrust", "regulator", "regulators", "ban",
                         "sec", "doj", "settlement", "court", "sanctions", "tariff", "tariffs"],
    "fusiones/operaciones": ["merger", "acquisition", "acquire", "acquires", "takeover", "bid", "deal", "spin-off", "spinoff",
                             "buyback", "dividend", "stake"],
    "producto/negocio": ["launch", "recall", "fda", "approval", "trial", "contract", "outage", "drug", "vaccine", "flaw", "flaws",
                         "bug", "vulnerability", "breach", "data breach", "security", "strike", "shortage", "orders", "deliveries"],
    "directivos": ["resigns", "resignation", "steps down", "ousted", "fired", "new ceo", "names ceo", "ceo exit", "succession"],
    "cripto": ["hack", "hacked", "exploit", "etf", "listing", "delisting", "delist", "upgrade", "fork", "halving", "stablecoin"],
    "macro": ["fed", "rates", "inflation", "recession", "war", "election", "crisis", "covid", "pandemic", "brexit", "default"],
}


def _cached(name, fetch):
    p = DIR / "why" / name
    if p.is_file():
        return json.loads(p.read_text())
    v = fetch()
    p.parent.mkdir(parents=True, exist_ok=True)
    data.private_write(p, json.dumps(v, separators=(",", ":")).encode())
    return v


def _curl_json(url: str, timeout: int = 25):
    import subprocess
    out = subprocess.run(["curl", "-sS", "--fail", "--max-time", str(timeout), "-A", "Mozilla/5.0 (Cage; lectura)", url],
                         capture_output=True, timeout=timeout + 5, check=True)
    return json.loads(out.stdout)


def earnings_day(day: str) -> dict:
    def f():
        for k in range(3):
            try:
                rows = ((_curl_json(NASDAQ.format(day)).get("data") or {}).get("rows")) or []
                return {r["symbol"]: r.get("surprise") for r in rows}
            except Exception:  # noqa: BLE001
                time.sleep(2 + 3 * k)
        return {"_error": True}
    return _cached(f"earn-{day}.json", f)


def prefetch_earnings(days: set[str], log=print, workers=4) -> None:
    from concurrent.futures import ThreadPoolExecutor
    todo = sorted(d for d in days if not (DIR / "why" / f"earn-{d}.json").is_file())
    log(f"earnings calendar: {len(todo)} days to download")
    with ThreadPoolExecutor(workers) as ex:
        for k, _ in enumerate(ex.map(earnings_day, todo), 1):
            if k % 200 == 0:
                log(f"  {k}/{len(todo)}")


GNEWS = "https://news.google.com/rss/search?q={}+after:{}+before:{}&hl=en-US&gl=US&ceid=US:en"


def headlines(sym: str, name: str, d0: str, d1: str) -> list:
    """Google News headlines (public RSS, supports historical dates) between d0 and d1. [title, source, reliable?]."""
    import xml.etree.ElementTree as ET
    q = SHORT.get(sym, name)
    q = "(" + q.replace(" OR ", " OR ") + ")" if " OR " in q else f'"{q}"'

    def f():
        time.sleep(2.0)
        for k in range(4):
            try:
                import subprocess
                out = subprocess.run(["curl", "-sS", "--fail", "--max-time", "25", "-A", "Mozilla/5.0 (Cage; read)",
                                      GNEWS.format(urllib.parse.quote(q), d0, _next(d1, 1))], capture_output=True, timeout=35, check=True)
                root = ET.fromstring(out.stdout)
                res = []
                for it in root.iter("item"):
                    title = (it.findtext("title") or "").strip()
                    src_el = it.find("source")
                    src = (src_el.text or "").strip() if src_el is not None else ""
                    if src and title.endswith(" - " + src):
                        title = title[: -len(src) - 3]
                    dom = news.domain(src_el.get("url", "")) if src_el is not None else ""
                    item = {"link": src_el.get("url", "") if src_el is not None else "", "title": title, "via": "gnews", "origin": src}
                    if title and not news.promotional(title):
                        res.append([title, dom or src, bool(news.reliable(item))])
                    return res[:50]
            except Exception:  # noqa: BLE001 - rate limit or transient error: back off
                time.sleep(20 * (k + 1))
        return None
    v = _cached(f"gn-{sym}-{d0}.json", f)
    if v is None:
        (DIR / "why" / f"gn-{sym}-{d0}.json").unlink(missing_ok=True)
    return v or []


def classify(items: list, crypto: bool) -> tuple[str | None, list[str]]:
    """Reliable outlets count even with a single headline; without reliable outlets, 2 headlines from different domains are required."""
    rel = [t for t, _, r in items if r]
    if rel:
        titles = rel
    else:
        titles = [t for t, _, _ in items]
    votes, doms = {}, {}
    for t, d, _ in items:
        low = t.lower()
        for cause, words in CAUSES.items():
            if any(re.search(r"\b" + re.escape(w) + r"\b", low) for w in words):
                doms.setdefault(cause, set()).add(d)
    for t in titles:
        low = t.lower()
        for cause, words in CAUSES.items():
            if cause == "cripto" and not crypto:
                continue
            if any(re.search(r"\b" + re.escape(w) + r"\b", low) for w in words):
                votes[cause] = votes.get(cause, 0) + 1
    if not rel:
        votes = {c: v for c, v in votes.items() if len(doms.get(c, ())) >= 2}
    if not votes:
        return None, []
    top = max(votes, key=votes.get)
    ev = [t for t in titles if any(re.search(r"\b" + re.escape(w) + r"\b", t.lower()) for w in CAUSES[top])][:3]
    return top, ev


def _next(day: str, k: int) -> str:
    import datetime as dt
    return (dt.date.fromisoformat(day) + dt.timedelta(days=k)).isoformat()


def attribute(eps_all: dict, log=print, news_from="2011-01-01") -> dict:
    need = set()
    for sym, a in eps_all.items():
        if not a.get("error") and a["market"] != "crypto" and (a["market"] == "us" or ADR.get(sym)):
            for e in a["episodes"]:
                need |= {e["date"], _next(e["date"], -1)} | ({_next(e["date"], -3)} if _weekday(e["date"]) == 0 else set())
    prefetch_earnings(need, log)
    n = 0
    for sym, a in eps_all.items():
        if a.get("error"):
            continue
        crypto = a["market"] == "crypto"
        adr = sym if a["market"] == "us" else ADR.get(sym)
        for e in a["episodes"]:
            e["cause"], e["evidence"], e["surprise"] = None, [], None
            if adr and not crypto:  # earnings on that day or eve (after-market release)?
                for d in (e["date"], _next(e["date"], -1), _next(e["date"], -3) if _weekday(e["date"]) == 0 else None):
                    if not d:
                        continue
                    cal = earnings_day(d)
                    if adr in cal:
                        e["cause"], e["surprise"] = "resultados", cal[adr]
                        e["evidence"] = [f"Quarterly results published on {d} (Nasdaq)" + (f"; surprise {cal[adr]} % vs consensus" if cal[adr] not in (None, "", "N/A") else "")]
                        break
            if not e["cause"] and e["kind"] == "propio" and e["date"] >= news_from:
                c, ev = classify(headlines(sym, a["name"], _next(e["date"], -1), _next(e["date"], 1)), crypto)
                if c:
                    e["cause"], e["evidence"] = c, ev
                n += 1
                if n % 50 == 0:
                    log(f"news: {n} episodes consulted")
            if not e["cause"]:
                if e["kind"] == "sector":
                    e["cause"] = "sector"
                elif e["kind"] == "mercado":
                    e["cause"] = "mercado/macro"
                else:
                    e["cause"] = "sin causa identificada" if e["date"] >= news_from or adr else "sin datos de noticias (antes de 2017)"
    data.private_write(DIR / "episodes_why.json", json.dumps(eps_all, separators=(",", ":")).encode())
    return eps_all
    data.private_write(DIR / "episodes_why.json", json.dumps(eps_all, separators=(",", ":")).encode())
    return eps_all


def _weekday(day: str) -> int:
    import datetime as dt
    return dt.date.fromisoformat(day).weekday()


if __name__ == "__main__":
    attribute(json.loads((DIR / "episodes.json").read_text()))
