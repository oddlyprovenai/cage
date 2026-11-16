"""READ-ONLY web research for Cage's assistant.

- Only GET, no cookies, no credentials, no forms, no JavaScript: never logs in or purchases.
- Blocks local and private addresses (including after redirects), so a page cannot make the dashboard
  attack the Mac itself or the home network (SSRF).
- Limits: 1.5 MB per page, 12 s, 5 redirects. Always returns the source URL.
"""
from __future__ import annotations

import html
import ipaddress
import re
import socket
from urllib.parse import parse_qs, quote_plus, urljoin, urlparse

MAX_BYTES = 1_500_000
UA = "Cage/0.3 (panel personal; lectura)"


def public_url(url: str) -> str:
    u = urlparse(url)
    if u.scheme not in ("http", "https") or not u.hostname:
        raise ValueError("http(s) addresses only")
    if u.username or u.password:
        raise ValueError("no credentials in URL")
    try:
        infos = socket.getaddrinfo(u.hostname, u.port or (443 if u.scheme == "https" else 80), type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise ValueError("domain not found") from exc
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global:
            raise ValueError("local or private address blocked")
    return url


def fetch(url: str, timeout: float = 12) -> tuple[str, str]:
    """(final url, html) following up to 5 redirects, checking each hop."""
    import urllib.error
    import urllib.request

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k):
            return None

    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    for _ in range(6):
        public_url(url)
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,text/plain"})
        try:
            r = opener.open(req, timeout=timeout)
        except urllib.error.HTTPError as e:  # type: ignore[attr-defined]
            if e.code in (301, 302, 303, 307, 308) and e.headers.get("Location"):
                url = urljoin(url, e.headers["Location"])
                continue
            raise ValueError(f"page responded {e.code}") from None
        except (urllib.error.URLError, OSError):
            # Python TLS unavailable in some environments: system curl, one hop at a time (no -L),
            # so each redirect passes through public_url again.
            code, headers, body = _curl(url, timeout)
            if code in (301, 302, 303, 307, 308) and headers.get("location"):
                url = urljoin(url, headers["location"])
                continue
            if code >= 400:
                raise ValueError(f"page responded {code}") from None
            ctype = headers.get("content-type", "")
            if not ("html" in ctype or "text" in ctype or "json" in ctype):
                raise ValueError("not a text page") from None
            m = re.search(r"charset=([\w-]+)", ctype)
            return url, body.decode(m.group(1) if m else "utf-8", "replace")
        with r:
            ctype = r.headers.get("Content-Type", "")
            if not ("html" in ctype or "text" in ctype or "json" in ctype):
                raise ValueError("not a text page")
            raw = r.read(MAX_BYTES + 1)[:MAX_BYTES]
            charset = r.headers.get_content_charset() or "utf-8"
            return r.geturl(), raw.decode(charset, "replace")
    raise ValueError("too many redirects")


def _curl(url: str, timeout: float) -> tuple[int, dict, bytes]:
    import subprocess
    import tempfile

    with tempfile.NamedTemporaryFile() as hdr:
        r = subprocess.run(["curl", "-sS", "--max-time", str(int(timeout)), "--max-filesize", str(MAX_BYTES), "--proto", "=http,https",
                            "-A", UA, "-H", "Accept: text/html,text/plain", "-D", hdr.name, url],
                           capture_output=True, timeout=timeout + 5, check=False)
        if r.returncode not in (0, 63):  # 63 = too large: truncated
            raise ValueError("could not connect")
        lines = open(hdr.name, encoding="latin-1").read().split("\r\n")
    statuses = [ln for ln in lines if ln.startswith("HTTP/")]
    code = int(statuses[-1].split()[1]) if statuses else 0
    headers = {k.strip().lower(): v.strip() for k, _, v in (ln.partition(":") for ln in lines if ":" in ln)}
    return code, headers, r.stdout[:MAX_BYTES]


def text_of(page: str) -> tuple[str, str]:
    title = html.unescape(re.sub(r"\s+", " ", (re.search(r"<title[^>]*>(.*?)</title>", page, re.S | re.I) or [None, ""])[1])).strip()
    body = re.sub(r"(?is)<(script|style|noscript|svg|head|nav|footer|form)[^>]*>.*?</\1>", " ", page)
    body = re.sub(r"(?i)<br\s*/?>|</p>|</h[1-6]>|</li>", "\n", body)
    body = html.unescape(re.sub(r"<[^>]+>", " ", body))
    body = "\n".join(ln.strip() for ln in re.sub(r"[ \t\r\f\v]+", " ", body).splitlines() if len(ln.strip()) > 2)
    return title[:200], body[:20000]


def search(q: str) -> list[dict]:
    """DuckDuckGo results (HTML version, no JavaScript or account)."""
    q = q.strip()[:200]
    if not q:
        return []
    _, page = fetch("https://html.duckduckgo.com/html/?q=" + quote_plus(q))
    out = []
    for m in re.finditer(r'class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>.*?class="result__snippet"[^>]*>(.*?)</', page, re.S):
        href = html.unescape(m.group(1))
        if "uddg=" in href:
            href = parse_qs(urlparse(href).query).get("uddg", [href])[0]
        if href.startswith("//"):
            href = "https:" + href
        title = html.unescape(re.sub(r"<[^>]+>", "", m.group(2))).strip()
        snip = html.unescape(re.sub(r"<[^>]+>", "", m.group(3))).strip()
        if href.startswith("http"):
            out.append({"title": title[:200], "url": href, "snippet": snip[:300]})
        if len(out) >= 8:
            break
    return out


def search_wikipedia(q: str, lang: str = "es") -> list[dict]:
    """Fallback when web search is blocked: public Wikipedia API (no key)."""
    import json as _json

    _, page = fetch(f"https://{lang}.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=6&srsearch=" + quote_plus(q[:200]))
    rows = _json.loads(page).get("query", {}).get("search", [])
    return [{"title": r["title"], "url": f"https://{lang}.wikipedia.org/wiki/" + quote_plus(r["title"].replace(" ", "_")),
             "snippet": html.unescape(re.sub(r"<[^>]+>", "", r.get("snippet", "")))[:300], "engine": "Wikipedia"} for r in rows]


def search_any(q: str) -> dict:
    """Searches DuckDuckGo; if no results (block or limit), Wikipedia. Reports which engine responded."""
    try:
        r = search(q)
        if r:
            return {"engine": "DuckDuckGo", "results": r}
    except ValueError:
        pass
    return {"engine": "Wikipedia (DuckDuckGo did not respond)", "results": search_wikipedia(q)}


def read(url: str) -> dict:
    final, page = fetch(url)
    title, body = text_of(page)
    return {"url": final, "title": title, "text": body}
