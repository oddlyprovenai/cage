"""News for the agent, READ-ONLY, from free sources without API keys (tested from the Mac on 2026-11-11):

- Crypto: Cointelegraph, CoinDesk, Decrypt and The Block (RSS).
- Macro and regulators: ECB, Federal Reserve and SEC (official RSS).
- Per company: Yahoo Finance RSS by ticker and Google News RSS (only reliable sources from allowlist).
- Earnings calendar: Nasdaq public calendar API (US-listed companies).
- History for event studies: GDELT DOC API, respecting rate limit (one request per 5 s).
CNMV returned 403 to automated clients: not used. No anti-bot checks are bypassed.

Security: news text is ALWAYS data. It is stored escaped, never executed or passed as instructions
to a model, and cannot alter risk limits: it can only BRAKE (pause an asset on severe events).
"""
from __future__ import annotations

import hashlib
import html
import json
import re
import time
import unicodedata
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from urllib.parse import quote_plus, urlparse

from trading import data

STORE = data.HOME / "news.json"
MAX_XML = 2_000_000

FEEDS = {
    "Cointelegraph": "https://cointelegraph.com/rss",
    "CoinDesk": "https://www.coindesk.com/arc/outboundfeeds/rss",
    "Decrypt": "https://decrypt.co/feed",
    "The Block": "https://www.theblock.co/rss.xml",
    "ECB": "https://www.ecb.europa.eu/rss/press.html",
    "Federal Reserve": "https://www.federalreserve.gov/feeds/press_all.xml",
    "SEC": "https://www.sec.gov/news/pressreleases.rss",
}
YAHOO_RSS = "https://feeds.finance.yahoo.com/rss/2.0/headline?s={}&region=US&lang=en-US"
GNEWS = "https://news.google.com/rss/search?q={}&hl=en-US&gl=US&ceid=US:en"
# Accepted outlets when news arrives via an aggregator (Google News / Yahoo). The rest are discarded.
RELIABLE = {"reuters.com", "bloomberg.com", "ft.com", "wsj.com", "cnbc.com", "marketwatch.com", "barrons.com", "apnews.com",
            "bbc.com", "bbc.co.uk", "economist.com", "nytimes.com", "theguardian.com", "finance.yahoo.com", "investors.com",
            "expansion.com", "cincodias.elpais.com", "elpais.com", "eleconomista.es", "lavanguardia.com", "handelsblatt.com",
            "lesechos.fr", "coindesk.com", "cointelegraph.com", "theblock.co", "decrypt.co", "techcrunch.com", "theverge.com",
            "fortune.com", "forbes.com", "businessinsider.com", "axios.com", "sec.gov", "ecb.europa.eu", "federalreserve.gov"}
RELIABLE_NAMES = {"Reuters", "Bloomberg", "Financial Times", "The Wall Street Journal", "CNBC", "MarketWatch", "Barron's",
                  "Associated Press", "AP News", "BBC", "The Economist", "The New York Times", "The Guardian", "Yahoo Finance",
                  "Investor's Business Daily", "Expansión", "Cinco Días", "El País", "elEconomista", "CoinDesk",
                  "Cointelegraph", "The Block", "Decrypt", "TechCrunch", "Fortune", "Forbes", "Business Insider", "Axios"}

# asset -> (keywords to relate, ticker on Yahoo/Nasdaq if any, Google News search query)
ASSETS = {
    "BTCUSDT": (["bitcoin", "btc"], None, "bitcoin"), "ETHUSDT": (["ethereum", "ether", "eth"], None, "ethereum"),
    "SOLUSDT": (["solana"], None, "solana crypto"), "BNBUSDT": (["bnb", "binance coin"], None, None),
    "XRPUSDT": (["xrp", "ripple"], None, None), "DOGEUSDT": (["dogecoin", "doge"], None, None),
    "AAPL": (["apple", "aapl", "iphone"], "AAPL", None), "MSFT": (["microsoft", "msft"], "MSFT", None),
    "NVDA": (["nvidia", "nvda"], "NVDA", None), "AMZN": (["amazon", "amzn"], "AMZN", None),
    "GOOGL": (["alphabet", "google", "googl"], "GOOGL", None), "META": (["meta platforms", "facebook", "instagram"], "META", None),
    "ASML.AS": (["asml"], "ASML", None), "SAP.DE": (["sap se", " sap "], "SAP", None), "NOVO-B.CO": (["novo nordisk", "wegovy", "ozempic"], "NVO", None),
    "MC.PA": (["lvmh", "louis vuitton"], None, "LVMH"), "BRK-B": (["berkshire"], "BRK-B", None), "JNJ": (["johnson & johnson", "j&j"], "JNJ", None),
    "IWDA.AS": (["msci world", "global stocks", "world stocks"], None, None), "IEAG.AS": (["euro bond", "bund", "eurozone bonds"], None, None),
}
MACRO_WORDS = ["federal reserve", "fed ", "ecb", "bce", "interest rate", "rate cut", "rate hike", "inflation", "cpi", "recession",
               "tipos de interés", "inflación", "payrolls", "unemployment"]
KINDS = [  # (kind, keywords, severe for risk?) "x*" = starts with x; without * = exact word
    ("hackeo", ["hacked", "hack", "exploit*", "breach*", "drained", "stolen", "hackeo", "hackeado"], True),
    ("exclusión", ["delist*", "suspends trading", "halts trading", "halted trading", "exclusion de cotizacion"], True),
    ("sanción", ["sanctioned", "sec charges", "charged with", "sued by", "fined", "indicted", "indictment", "sancion*", "multa*"], True),
    ("insolvencia", ["bankrupt*", "insolven*", "chapter 11", "quiebra"], True),
    ("resultados", ["earnings", "quarterly results", "q1 ", "q2 ", "q3 ", "q4 ", "revenue", "guidance", "resultados trimestrales"], False),
    ("regulación", ["regulat", "sec ", "mica", "approval", "approves", "etf approval", "regulación"], False),
    ("macro", MACRO_WORDS, False),
    ("calificación", ["upgrade", "downgrade", "price target", "rating"], False),
]


def norm(t: str) -> str:
    t = unicodedata.normalize("NFKD", t.lower())
    return re.sub(r"[^a-z0-9 ]+", " ", "".join(c for c in t if not unicodedata.combining(c))).strip()


def clean(text: str, n: int = 400) -> str:
    """Plain text, stripped of HTML and control characters, truncated. Stored as DATA."""
    t = html.unescape(re.sub(r"<[^>]+>", " ", text or ""))
    t = re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", "", t)
    return re.sub(r"\s+", " ", t).strip()[:n]


def domain(url: str) -> str:
    h = (urlparse(url).hostname or "").lower()
    return h[4:] if h.startswith("www.") else h


PROMO = re.compile(r"(recogni[sz]ed|named|awarded|wins|winner).{0,80}(partner|award|of the year)|partner of the year|"
                   r"announces? (strategic )?(partnership|collaboration|availability|launch)|to (present|participate) at|"
                   r"webinar|press release|sponsored|join(s|ed) .{0,40} program", re.I)


def promotional(title: str) -> bool:
    """Press releases and promotional content republished by aggregators: not asset news."""
    return bool(PROMO.search(title))


def reliable(item: dict) -> bool:
    if promotional(item["title"]):
        return False
    if item["via"] in FEEDS:
        return True
    d = domain(item.get("origin_url") or item["link"])
    return item.get("origin") in RELIABLE_NAMES or any(d == r or d.endswith("." + r) for r in RELIABLE)


def _has(t: str, w: str) -> bool:
    """Whole word (or prefix if ending with *) in normalized text surrounded by spaces."""
    return (" " + norm(w.rstrip("*")) + ("" if w.endswith("*") else " ")) in t


def classify(title: str) -> tuple[list[str], bool]:
    t = " " + norm(title) + " "
    kinds = [k for k, words, _ in KINDS if any(_has(t, w) for w in words)]
    return kinds, any(g for k, _, g in KINDS if k in kinds)


def in_title(asset: str, title: str) -> bool:
    t = " " + norm(title) + " "
    return any((" " + norm(k) + " ") in t for k in ASSETS.get(asset, ([], None, None))[0])


def relate(title: str, summary: str = "") -> list[str]:
    t = " " + norm(title + " " + summary) + " "
    out = [a for a, (kw, _, _) in ASSETS.items() if any((" " + norm(k) + " ") in t for k in kw)]
    if any(_has(t, w.strip() + ("" if w.endswith(" ") else "*")) for w in MACRO_WORDS):
        out.append("MACRO")
    return out


def parse_rss(raw: bytes, via: str) -> list[dict]:
    if len(raw) > MAX_XML:
        raise ValueError("RSS too large")
    if b"<!ENTITY" in raw[:4096]:
        raise ValueError("RSS with entities: rejected")  # protection against malicious XML
    root = ET.fromstring(raw)
    out = []
    for it in root.iter("item"):
        title = clean(it.findtext("title") or "", 300)
        link = (it.findtext("link") or "").strip()
        pub = it.findtext("pubDate") or it.findtext("{http://purl.org/dc/elements/1.1/}date")
        try:
            ts = int(parsedate_to_datetime(pub).timestamp()) if pub and "," in pub else int(time.mktime(time.strptime(pub[:19], "%Y-%m-%dT%H:%M:%S")))
        except (TypeError, ValueError, IndexError):
            continue  # without a reliable publication date it cannot be used (avoids lookahead bias)
        src = it.find("source")
        if not title or not link.startswith("http"):
            continue
        out.append({"title": title, "link": link, "published": ts, "via": via, "summary": clean(it.findtext("description") or "", 300),
                    "origin": clean(src.text, 80) if src is not None and src.text else None,
                    "origin_url": src.get("url") if src is not None else None})
    return out


def fetch_rss(url: str, via: str) -> list[dict]:
    import subprocess
    try:
        import urllib.request
        req = urllib.request.Request(url, headers={"User-Agent": data.UA, "Accept": "application/rss+xml, application/xml"})
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read(MAX_XML + 1)
    except Exception:  # noqa: BLE001
        raw = subprocess.run(["curl", "-sSL", "--fail", "--max-time", "20", "--max-filesize", str(MAX_XML), "-A", data.UA, url],
                             capture_output=True, timeout=30, check=True).stdout
    return parse_rss(raw, via)


def earnings_calendar(days: int = 10) -> dict[str, str]:
    """Upcoming earnings dates for tracked tickers (Nasdaq public calendar)."""
    want = {v[1]: a for a, v in ASSETS.items() if v[1]}
    out = {}
    for k in range(days):
        day = time.strftime("%Y-%m-%d", time.localtime(time.time() + k * 86400))
        try:
            rows = data.get_json(f"https://api.nasdaq.com/api/calendar/earnings?date={day}")["data"].get("rows") or []
        except Exception:  # noqa: BLE001
            continue
        for r in rows:
            sym = (r.get("symbol") or "").replace(".", "-")
            if sym in want and want[sym] not in out:
                out[want[sym]] = day
        time.sleep(0.5)
    return out


def onchain_items(min_usd: float = 50e6) -> list[dict]:
    """Very large transactions in the last few hours on Bitcoin and Ethereum. Informational only: Cage's
    on-chain study showed no predictive power for these variables (see Research); they neither brake nor trigger trades."""
    from trading import blockchair as bc
    if not bc.info().get("saved"):
        return []
    out = []
    for asset, chain, name in (("BTCUSDT", "bitcoin", "Bitcoin"), ("ETHUSDT", "ethereum", "Ethereum")):
        for w in bc.whales(chain, min_usd=min_usd, limit=5):
            try:
                import calendar
                ts = calendar.timegm(time.strptime(str(w["time"])[:19], "%Y-%m-%d %H:%M:%S"))  # Blockchair gives UTC
            except (TypeError, ValueError):
                continue
            usd = float(w.get("usd") or 0)
            out.append({"id": "bc-" + str(w["hash"])[:16], "title": f"Large transfer on {name} network: {usd / 1e6:,.0f} M$ in one transaction".replace(",", "."),
                        "link": w["link"], "published": ts, "via": "Blockchair", "origin": "Blockchair",
                        "summary": "On-chain data (not a news story or buy/sell signal).",
                        "assets": [asset], "kinds": ["on-chain"], "grave": False, "fetched": int(time.time())})
    return out


def collect() -> dict:
    """Download, filter, deduplicate and relate. Retains 30 days."""
    old = load()
    items = {x["id"]: x for x in old.get("items", []) if not promotional(x["title"])}
    for x in items.values():  # rules may improve: reapplied to stored items
        if x.get("via") == "Blockchair":
            continue  # on-chain alerts: already have asset and kind
        x["kinds"], x["grave"] = classify(x["title"])
        x["assets"] = relate(x["title"], x.get("summary", ""))
    errors, fetched = {}, []
    sources = dict(FEEDS)
    for a, (_, tk, q) in ASSETS.items():
        if tk:
            sources[f"Yahoo Finance · {tk}"] = YAHOO_RSS.format(tk)
        if q:
            sources[f"Google News · {q}"] = GNEWS.format(quote_plus(q))
    for via, url in sources.items():
        try:
            fetched += fetch_rss(url, via.split(" · ")[0] if via.startswith(("Yahoo", "Google")) else via)
        except Exception as exc:  # noqa: BLE001
            errors[via] = str(exc)[:120]
    seen = {norm(x["title"])[:80] for x in items.values()}
    cut = time.time() - 30 * 86400
    for it in fetched:
        if it["published"] < cut or it["published"] > time.time() + 3600:
            continue
        key = norm(it["title"])[:80]
        if key in seen or not reliable(it):
            continue
        seen.add(key)
        kinds, grave = classify(it["title"])
        it.update(id=hashlib.sha1(key.encode()).hexdigest()[:12], assets=relate(it["title"], it["summary"]), kinds=kinds, grave=grave,
                  fetched=int(time.time()))
        if it["assets"]:
            items[it["id"]] = it
    try:  # large on-chain movements for portfolio assets (BTC and ETH), if the user connected Blockchair
        for it in onchain_items():
            items.setdefault(it["id"], it)
    except Exception as exc:  # noqa: BLE001 — no key, no quota or no network: record and continue
        errors["Blockchair"] = str(exc)[:120]
    keep = sorted((x for x in items.values() if x["published"] >= cut), key=lambda x: -x["published"])[:3000]
    try:
        cal = earnings_calendar()
    except Exception:  # noqa: BLE001
        cal = old.get("earnings", {})
    st = {"ts": int(time.time()), "items": keep, "errors": errors, "earnings": cal, "sources": list(sources)}
    data.private_write(STORE, json.dumps(st, ensure_ascii=False, separators=(",", ":")).encode())
    return st


def load() -> dict:
    try:
        return json.loads(STORE.read_text())
    except (OSError, ValueError):
        return {"items": [], "earnings": {}}


def for_asset(st: dict, asset: str, days: int = 7) -> list[dict]:
    cut = time.time() - days * 86400
    return [x for x in st.get("items", []) if asset in x["assets"] and x["published"] >= cut]


def risk_brake(st: dict, asset: str, now: float | None = None) -> str | None:
    """Brake: a severe event in the last 24 h or earnings in the next 2 days -> pause the asset.
    Can only reduce risk; never opens or enlarges positions."""
    now = now or time.time()
    for x in st.get("items", []):
        if asset in x["assets"] and x.get("grave") and now - x["published"] < 86400 and in_title(asset, x["title"]):
            return f"severe event ({', '.join(k for k in x['kinds'] if k in ('hackeo', 'exclusión', 'sanción', 'insolvencia'))}): {x['title'][:90]}"
    day = (st.get("earnings") or {}).get(asset)
    if day:
        d = time.mktime(time.strptime(day, "%Y-%m-%d"))
        if -86400 < d - now < 2 * 86400:
            return f"earnings on {day}"
    return None
