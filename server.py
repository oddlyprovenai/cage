#!/usr/bin/env python3
"""Cage: personal private dashboard. Local server (127.0.0.1 only), no dependencies except `cryptography`.

Base: HQ (interface, envelope-encrypted vault, revocable Claude access). Retains configured projects,
live SPIKE reading (signals.py), and security checks.
"""
from __future__ import annotations

import argparse
import hmac
import json
import re
import os
import secrets
import sys
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import signals
import vault
from seed import seed

WEB = Path(__file__).resolve().parent / "web"
STATIC = {"/": "index.html", "/app.css": "app.css", "/app.js": "app.js", "/charts.js": "charts.js",
          "/engine.js": "engine.js", "/life.js": "life.js",
          "/life-money.js": "life-money.js", "/life-health.js": "life-health.js",
          "/assistant.js": "assistant.js", "/invest.js": "invest.js", "/guide.js": "guide.js",
          "/trading.js": "trading.js", "/progress.js": "progress.js", "/review.js": "review.js", "/tools.js": "tools.js", "/motion.js": "motion.js", "/icons.js": "icons.js", "/trading-real.js": "trading-real.js", "/longterm.js": "longterm.js", "/results.js": "results.js", "/news.js": "news.js", "/dexui.js": "dexui.js", "/allocui.js": "allocui.js", "/mail.js": "mail.js", "/lifeui.js": "lifeui.js", "/system.js": "system.js", "/brief.js": "brief.js", "/docs.js": "docs.js", "/projstatus.js": "projstatus.js", "/memoryui.js": "memoryui.js", "/prov.js": "prov.js", "/bench.js": "bench.js", "/connect.js": "connect.js"}
CTYPES = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
          ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml"}
MAX_BODY = 8 * 1024 * 1024
# Without an open session or requests for this duration, the server shuts down (0 MB when not in use).
IDLE_EXIT = int(os.environ.get("CAGE_IDLE_EXIT", 120))
COOKIE = "mando_session"
CSRF_HEADER = "X-Cage-CSRF"
META = vault.HOME / "meta.json"
SETUP_TOKEN = vault.HOME / "setup-token"
ABS_SESSION = 12 * 3600


class State:
    lock = threading.RLock()
    dek: bytes | None = None
    sessions: dict[str, dict] = {}
    setup_token: str | None = None
    port = int(os.environ.get("CAGE_PORT", 8787))
    last_seen = time.time()


S = State()


# ---------------------------------------------------------------- utilities
def now() -> float:
    return time.time()


def meta() -> dict:
    try:
        return json.loads(META.read_text())
    except (FileNotFoundError, ValueError):
        return {"failures": 0, "locked_until": 0, "last_failure": 0}


def save_meta(m: dict) -> None:
    vault.ensure_home()
    vault._atomic_write(META, json.dumps(m).encode())


def idle_limit() -> int:
    try:
        return max(1, int(load_data()["settings"].get("idle_minutes", 15))) * 60
    except Exception:
        return 15 * 60


SECRET = "_secrets"  # part of the vault that NEVER leaves the server (seed of the self-hosted wallet)


# Written only by the server (its own endpoints): always preserved on browser save and does not count
# towards versioning, so a server write does not cause false conflicts or get overwritten by stale copies.
SERVER_KEYS = ("audit", SECRET, "mail", "memory", "dex_wallet", "dex_trades", "dex_trial", "calendar", "reminders", "health_apple")


def data_version(d: dict) -> str:
    """Version = hash of browser-edited content (not the file timestamp)."""
    import hashlib
    owned = {k: v for k, v in d.items() if k not in SERVER_KEYS}
    return hashlib.sha256(json.dumps(owned, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()[:20]


def user_initial() -> str:
    """First letter of the user's name once the vault is unlocked; a generic «C» (Cage) before that."""
    try:
        if S.dek:
            name = str(vault.load(S.dek).get("profile", {}).get("name") or "").strip()
            ch = next((c for c in name if c.isalnum()), "")
            if ch:
                return ch.upper()
    except Exception:  # noqa: BLE001 — the logo must never break the page
        pass
    return "C"


def logo_svg(initial: str) -> str:
    """Cage brand mark with an initial: dark rounded tile, warm glow, three rising bars and the letter."""
    from html import escape
    ch = escape(initial[:1].upper() or "C")
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024" role="img" aria-label="{ch}">
<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2A2B31"/><stop offset="1" stop-color="#0D0E11"/></linearGradient>
<radialGradient id="glow" cx="0.7" cy="0.2" r="0.7"><stop offset="0" stop-color="#F0592A" stop-opacity="0.30"/><stop offset="1" stop-color="#F0592A" stop-opacity="0"/></radialGradient>
<linearGradient id="ink" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFA06A"/><stop offset="0.5" stop-color="#F0592A"/><stop offset="1" stop-color="#C9370F"/></linearGradient></defs>
<rect x="64" y="64" width="896" height="896" rx="200" fill="url(#bg)"/><rect x="64" y="64" width="896" height="896" rx="200" fill="url(#glow)"/>
<rect x="66" y="66" width="892" height="892" rx="198" fill="none" stroke="#fff" stroke-opacity="0.09" stroke-width="4"/>
<rect x="210" y="690" width="56" height="90" rx="28" fill="#fff" fill-opacity="0.28"/><rect x="290" y="620" width="56" height="160" rx="28" fill="#fff" fill-opacity="0.5"/>
<rect x="370" y="550" width="56" height="230" rx="28" fill="#fff" fill-opacity="0.85"/>
<text x="610" y="560" text-anchor="middle" dominant-baseline="middle" font-family="-apple-system, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif" font-weight="800" font-size="520" fill="url(#ink)">{ch}</text>
</svg>"""


def public(d: dict) -> dict:
    """Data sent to the browser: without the secret part."""
    return {k: v for k, v in d.items() if k not in (SECRET, "mail")}  # email is served via /api/mail


def load_data() -> dict:
    with S.lock:
        if S.dek is None:
            raise PermissionError
        return vault.load(S.dek)


def audit(data: dict, event: str) -> None:
    data.setdefault("audit", []).append({"ts": int(now()), "event": event})
    data["audit"] = data["audit"][-300:]


def wipe() -> None:
    with S.lock:
        S.dek = None
        S.sessions.clear()


def should_exit(t: float) -> bool:
    """Shut down when idle: no sessions and no requests within IDLE_EXIT seconds."""
    return IDLE_EXIT > 0 and not S.sessions and t - S.last_seen > IDLE_EXIT


def reaper(exit_fn=lambda: os._exit(0)) -> None:
    while True:
        time.sleep(10)
        with S.lock:
            if should_exit(now()):
                S.dek = None
                exit_fn()
                return
            if not S.sessions:
                continue
            lim = idle_limit() if S.dek else 0
            t = now()
            for k in [k for k, s in S.sessions.items()
                      if t - s["last"] > lim or t - s["created"] > ABS_SESSION]:
                del S.sessions[k]
            if not S.sessions:
                S.dek = None


def is_local_url(url: str) -> bool:
    try:
        u = urllib.parse.urlparse(url)
        if u.scheme not in ("http", "https") or not u.hostname:
            return False
        if u.hostname == "localhost":
            return True
        import ipaddress

        return ipaddress.ip_address(u.hostname).is_loopback
    except ValueError:
        return False


def _opener():
    """No proxy and no redirects: a "local" AI that redirects to another machine cannot leak data.
    urllib.request (and ssl) are only loaded when AI is used."""
    import urllib.request

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):  # noqa: ANN002, ANN003
            return None

    return urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())


def system_health(d: dict) -> dict:
    """Fast self-check (local reads only): each service with ok / aviso / fallo status and recommended fix."""
    import shutil

    import offsite
    now, H = time.time(), vault.HOME / "trading"
    out = []

    def add(name, state, detail, fix=""):
        out.append({"name": name, "state": state, "detail": detail, "fix": fix})

    def rj(p):
        try:
            return json.loads(p.read_text())
        except (OSError, ValueError):
            return {}
    add("Encrypted vault", "ok", f"open · {len(d.get('audit', []))} events in log")
    st = rj(H / "state.json")
    age = now - st.get("ts", 0)
    if not st:
        add("24/7 Agent", "aviso", "not installed (optional)", "install it with ./install.sh --with-agent to run the paper agent 24/7")
    elif age > 15 * 60:
        add("24/7 Agent", "fallo", f"no heartbeat for {int(age / 60)} min", "watchdog will restart it; if it continues, notify Claude")
    else:
        add("24/7 Agent", "ok" if str(st.get("status")) == "ok" else "aviso", f"heartbeat {int(age)} s ago · {str(st.get('status'))[:80]}")
    for h in st.get("health", []):
        add("Market data", "aviso", h)
    w = rj(H / "watchdog.json")
    if (w.get("last") or {}).get("ts", 0) > now - 86400:
        add("Watchdog", "aviso", f"{w['last']['why']} → {w['last']['action']}")
    for name, f, maxh in (("News", "news.json", 6), ("Long-term", "longterm.json", 72), ("Allocator", "allocator.json", 72)):
        j = rj(H / f)
        a = (now - j.get("ts", 0)) / 3600 if j.get("ts") else None
        add(name, "ok" if a is not None and a <= maxh else "aviso", f"updated {a:.0f} h ago" if a is not None else "no data yet",
            "" if a is not None and a <= maxh else "updates automatically with 24/7 agent")
    o = offsite.info()
    lo = o.get("last_ok") or {}
    if lo and now - lo["ts"] < 2 * 86400:
        add("Backups", "ok", f"{o['daily']} daily backups · last restore test passed" + (f" · destination {o['dest']}" if o.get("dest") else " · this Mac only"),
            "" if o.get("dest") else "choose an external drive or iCloud Drive in Account to have an offsite backup")
    else:
        add("Backups", "aviso", (o.get("last") or {}).get("error") or "no restore test yet", "runs automatically on sign-in; or click «Backup now» in Account")
    free = shutil.disk_usage(str(Path.home())).free / 1e9
    add("Disk", "ok" if free > 20 else "aviso" if free > 8 else "fallo", f"{free:.0f} GB free")
    for key, name in (("mail", "Mail"), ("calendar", "Calendar")):
        m = d.get(key) if key != "mail" else (vault.load(S.dek).get("mail") if S.dek else None)
        if m:
            a = (now - m.get("fetched", 0)) / 3600
            add(name, "ok" if a < 48 else "aviso", f"read {a:.0f} h ago", "" if a < 48 else "click Refresh in its tab")
    return {"ts": int(now), "checks": out, "worst": "fallo" if any(c["state"] == "fallo" for c in out) else "aviso" if any(c["state"] == "aviso" for c in out) else "ok"}


def _memory_soon(d: dict) -> None:
    """Regenerates shared memory tier in a background thread (without anything private)."""
    import memory
    import obsidian

    def go():
        try:
            vp = d.get("settings", {}).get("obsidian_vault") or str(Path.home() / "Documents" / "Obsidian Vault")
            try:
                ob = obsidian.project_notes(inside_home(vp), d.get("projects", []))
            except (OSError, ValueError):
                ob = None
            memory.export(d, spike_live(d), ob)
        except Exception as exc:  # noqa: BLE001 — retried on next save
            sys.stderr.write(f"memory: {type(exc).__name__}\n")
    threading.Thread(target=go, daemon=True).start()


def _offsite_soon(dek: bytes) -> None:
    """External backup + daily restore test, in a background thread (does not delay login)."""
    import offsite
    if not offsite.due():
        return

    def go():
        try:
            with S.lock:
                offsite.run(dek)
        except Exception:  # noqa: BLE001 — result (or failure) saved in offsite.json and shown in Cage
            pass
    threading.Thread(target=go, daemon=True).start()


def zipfile_error():
    import zipfile
    return zipfile.BadZipFile


def imaplib_error():
    import imaplib
    return imaplib.IMAP4.error


def ai_call(endpoint: str, payload: dict, timeout: int = 240) -> dict:
    if not is_local_url(endpoint):
        raise ValueError("local models only (127.0.0.1 / localhost)")
    import urllib.request

    req = urllib.request.Request(endpoint.rstrip("/") + "/chat/completions",
                                 data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    with _opener().open(req, timeout=timeout) as r:  # never via proxy or redirects
        return json.loads(r.read())


def ai_status(endpoint: str) -> dict:
    if not is_local_url(endpoint):
        return {"ok": False, "error": "non-local endpoint"}
    try:
        with _opener().open(endpoint.rstrip("/") + "/models", timeout=3) as r:
            js = json.loads(r.read())
        models = [m.get("id") for m in js.get("data", []) if isinstance(m, dict)]
        return {"ok": True, "models": models}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)[:200]}


def context_for_ai(data: dict, project_id: str | None) -> str:
    cur = data["profile"].get("currency", "EUR")
    lines = [f"Today is {time.strftime('%Y-%m-%d')}. User: {data['profile'].get('name', 'you')}."]
    for p in data["projects"]:
        if project_id and p["id"] != project_id:
            continue
        inc = sum(e["amount"] for e in data["ledger"] if e.get("project") == p["id"] and e["type"] == "income")
        exp = sum(e["amount"] for e in data["ledger"] if e.get("project") == p["id"] and e["type"] == "expense")
        lines.append(f"\n## {p['name']} ({p.get('status', '')}) — {p.get('description', '')}")
        lines.append(f"Income {inc:.2f} {cur}, expenses {exp:.2f} {cur}, net {inc - exp:.2f} {cur}.")
        for k in p.get("kpis", []):
            h = k.get("history") or []
            if h:
                lines.append(f"KPI {k['label']}: {h[-1]['value']} {k.get('unit', '')} ({h[-1]['date']})")
        for m in p.get("milestones", []):
            lines.append(f"Milestone [{'done' if m.get('done') else 'pending'}] {m['title']} {m.get('date', '')}")
        for t in p.get("tasks", []):
            if t.get("status") != "done":
                lines.append(f"Task [{t.get('status')}/{t.get('priority', '')}] {t['title']} {t.get('due', '')}")
    for g in data.get("goals", []):
        if not project_id or g.get("project") == project_id:
            tgt = f" (target {g['target']} {g.get('unit', '')})" if g.get("target") else ""
            lines.append(f"GOAL, not actual income: {g['label']}{tgt}")
    if not project_id or project_id == "inversion":
        pf = data.get("portfolio", {})
        lines.append(f"\nPortfolio: cash {pf.get('cash', 0)} {cur}, {len(pf.get('holdings', []))} positions.")
    import memory
    extra = memory.for_local_ai(data)
    return ("\n".join(lines) + ("\n\n" + extra if extra else ""))[:14000]


SYSTEM = ("You are the local assistant for the user's personal dashboard. You manage their projects and propose "
          "concrete, concise next steps in English. Use only the provided data; if information is missing, say so. "
          "Never recommend executing real investment orders: analysis and simulation only.")
MODES = {
    "finanzas": "Money and investing mode: explain with rigor and prudence, like a financial educator. Numbers come "
                "from the dashboard tools (provided in context): do not recalculate or invent returns. "
                "Remember you are not a regulated advisor, real orders are never executed, and investing involves risk.",
    "salud": "Health mode: discuss habits, nutrition, and weight with prudence. Do not provide medical advice; for health "
             "concerns recommend a professional. Do not propose deficits greater than 750 kcal/day.",
    "proyectos": "Projects mode: prioritize by impact and propose concrete tasks with due dates.",
}
MIN_FREE_GB = 3.0


def free_ram_gb() -> float | None:
    """Approximate free RAM (free + inactive + speculative) reading vm_stat; None if unavailable."""
    import subprocess

    try:
        out = subprocess.run(["vm_stat"], capture_output=True, text=True, timeout=3, check=True).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    page = int((re.search(r"page size of (\d+)", out) or [0, 16384])[1])
    pages = sum(int(m.group(2)) for m in re.finditer(r"Pages (free|inactive|speculative):\s+(\d+)", out))
    return round(pages * page / 2**30, 1)


def evals_summary() -> dict:
    """Finance exam: number of prepared questions and REAL scores saved by evals/run_exam.py (if any)."""
    exam = Path(__file__).resolve().parent / "evals" / "finanzas_es.jsonl"
    n = sum(1 for ln in exam.read_text(encoding="utf-8").splitlines() if ln.strip()) if exam.is_file() else 0
    results = []
    for f in sorted((vault.HOME / "evals").glob("*.json")):
        try:
            r = json.loads(f.read_text(encoding="utf-8"))
            if isinstance(r.get("n"), int) and isinstance(r.get("correct"), int) and r["n"] > 0:
                results.append({k: r[k] for k in ("model", "n", "correct", "date") if k in r})
        except (OSError, ValueError):
            continue
    return {"questions": n, "results": results}


def inside_home(path: str) -> Path:
    p = Path(os.path.expanduser(path)).resolve()
    home = Path.home().resolve()
    if home not in p.parents and p != home:
        raise ValueError("path outside your home folder")
    return p


def spike_live(data: dict) -> list[dict]:
    """Board and training runs for each SPIKE project, read (read-only) from its own repository."""
    out = []
    for p in data["projects"]:
        if not p.get("spike") or not p.get("folder"):
            continue
        try:
            folder = inside_home(p["folder"])
            runs = inside_home(p["runs"]) if p.get("runs") else None
            out.append({"project": p["id"], **signals.spike_status(folder, runs)})
        except (OSError, ValueError, KeyError) as exc:
            out.append({"project": p["id"], "error": str(exc)[:200]})
    return out


def git_log(path: str, days: int = 180) -> list[dict]:
    p = inside_home(path)
    if not (p / ".git").exists():
        raise ValueError(f"{path} is not a git repository")
    import subprocess

    out = subprocess.run(["git", "-C", str(p), "log", f"--since={days}.days", "--no-merges",
                          "--pretty=format:%h%x1f%at%x1f%an%x1f%s", "-n", "2000"],
                         capture_output=True, text=True, timeout=20)
    res = []
    for line in out.stdout.splitlines():
        parts = line.split("\x1f")
        if len(parts) == 4:
            res.append({"hash": parts[0], "ts": int(parts[1]), "author": parts[2], "subject": parts[3][:200]})
    return res


# ------------------------------------------------------------------ handler
class H(BaseHTTPRequestHandler):
    server_version = "Cage"
    sys_version = ""

    def log_message(self, fmt, *args):  # no content logging
        sys.stderr.write("%s %s\n" % (self.command, self.path.split("?")[0]))

    # -- common security
    def _host_ok(self) -> bool:
        return self.headers.get("Host", "") in (f"127.0.0.1:{S.port}", f"localhost:{S.port}")

    def _origin_ok(self) -> bool:
        if self.headers.get("Sec-Fetch-Site", "same-origin") not in ("same-origin", "none"):
            return False
        o = self.headers.get("Origin")
        return o is None or o in (f"http://127.0.0.1:{S.port}", f"http://localhost:{S.port}")

    def _headers(self, code: int, ctype: str, length: int, extra: dict | None = None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.send_header("Content-Security-Policy",
                         "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
                         "connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; "
                         "form-action 'self'; frame-ancestors 'none'")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()

    def _json(self, code: int, obj, extra: dict | None = None):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self._headers(code, "application/json; charset=utf-8", len(body), extra)
        self.wfile.write(body)

    def _body(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        if n < 0 or n > MAX_BODY:
            raise ValueError("body too large")
        raw = self.rfile.read(n) if n else b"{}"
        obj = json.loads(raw or b"{}")
        if not isinstance(obj, dict):
            raise ValueError("invalid JSON")
        return obj

    def _cookie_token(self) -> str | None:
        for part in (self.headers.get("Cookie") or "").split(";"):
            k, _, v = part.strip().partition("=")
            if k == COOKIE:
                return v
        return None

    def _session(self, need_csrf: bool) -> dict | None:
        tok = self._cookie_token()
        with S.lock:
            s = S.sessions.get(tok or "")
            if not s or S.dek is None:
                return None
            t = now()
            if t - s["last"] > idle_limit() or t - s["created"] > ABS_SESSION:
                del S.sessions[tok]
                if not S.sessions:
                    S.dek = None
                return None
            if need_csrf and not hmac.compare_digest(self.headers.get(CSRF_HEADER, ""), s["csrf"]):
                return None
            s["last"] = t
            return s

    def _new_session(self) -> dict:
        tok = secrets.token_urlsafe(32)
        s = {"csrf": secrets.token_urlsafe(32), "created": now(), "last": now()}
        S.sessions[tok] = s
        cookie = f"{COOKIE}={tok}; HttpOnly; SameSite=Strict; Path=/; Max-Age={ABS_SESSION}"
        return {"cookie": cookie, "csrf": s["csrf"]}

    # -- verbs
    def do_GET(self):
        if not self._host_ok():
            return self._json(421, {"error": "host not allowed"})
        S.last_seen = now()
        path = urllib.parse.urlparse(self.path).path
        if path in ("/logo.svg", "/favicon.svg"):  # the user's initial (a generic "C" before unlocking)
            body = logo_svg(user_initial()).encode()
            self._headers(200, "image/svg+xml", len(body))
            return self.wfile.write(body)
        if path in STATIC:
            f = WEB / STATIC[path]
            body = f.read_bytes()
            ctype = CTYPES.get(f.suffix, "application/octet-stream")
            self._headers(200, ctype, len(body))
            return self.wfile.write(body)
        if path.startswith("/3d/") and re.fullmatch(r"/3d/(icons/[a-z]+(\.png)?\.webp|logo3d\.(webp|png))", path):
            f = WEB / path[1:]
            if f.is_file():  # Blender 3D assets, only if rendered (whitelist by pattern)
                body = f.read_bytes()
                self._headers(200, "image/png" if f.suffix == ".png" else "image/webp", len(body))
                return self.wfile.write(body)
            return self._json(404, {"error": "not found"})
        if path == "/api/state":
            m = meta()
            sess = self._session(False)
            return self._json(200, {
                "setup": not vault.exists(),
                "unlocked": sess is not None,
                "csrf": sess["csrf"] if sess else None,
                "locked_until": max(0, int(m.get("locked_until", 0) - now())),
            })
        if not path.startswith("/api/"):
            return self._json(404, {"error": "not found"})
        s = self._session(need_csrf=True)
        if not s:
            return self._json(401, {"error": "locked"})
        try:
            if path == "/api/data":
                d = load_data()
                return self._json(200, {"data": public(d), "version": data_version(d), "updated": int(vault.mtime() // 1_000_000),
                                        "agent": vault.agent_enabled()})
            if path == "/api/notes":
                import obsidian

                d = load_data()
                vp = d["settings"].get("obsidian_vault") or str(Path.home() / "Documents" / "Obsidian Vault")
                try:
                    return self._json(200, obsidian.project_notes(inside_home(vp), d["projects"]))
                except (OSError, ValueError) as exc:
                    return self._json(200, {"vault": vp, "error": str(exc)[:200], "projects": {}, "recent": []})
            if path == "/api/trading":
                from trading import panel

                return self._json(200, panel.status())
            if path == "/api/backups":
                import offsite
                return self._json(200, offsite.info())
            if path == "/api/memory":
                import memory
                d = vault.load(S.dek)
                return self._json(200, {"graph": memory.graph(d, spike_live(d)), "facts": memory.mem(d)["facts"][-500:],
                                        "shared_dir": str(memory.shared_dir()), "exported": int(memory.shared_dir().stat().st_mtime) if memory.shared_dir().exists() else None})
            if path == "/api/bench":
                import benchmark
                return self._json(200, {**benchmark.build(), "coach": benchmark.coach(), "local": benchmark.local_exams()})
            if path == "/api/health":
                return self._json(200, system_health(load_data()))
            if path == "/api/evals":
                return self._json(200, evals_summary())
            if path == "/api/spike":
                return self._json(200, {"spike": spike_live(load_data())})
            if path == "/api/ai/status":
                d = load_data()
                return self._json(200, ai_status(d["settings"]["ai"]["endpoint"]))
            if path == "/api/git":
                q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                pid = (q.get("project") or [""])[0]
                d = load_data()
                out = []
                for p in d["projects"]:
                    if pid and p["id"] != pid:
                        continue
                    for rp in p.get("repo_paths", []):
                        try:
                            out += [{**c, "project": p["id"], "repo": rp} for c in git_log(rp)]
                        except Exception as exc:  # noqa: BLE001
                            out.append({"error": str(exc)[:200], "project": p["id"], "repo": rp})
                return self._json(200, {"commits": out})
            if path == "/api/export":
                body = vault.VAULT.read_bytes()
                d = load_data()
                audit(d, "encrypted backup export")
                vault.save(S.dek, d)
                fn = f"cage-{time.strftime('%Y%m%d')}.vault.json"
                self._headers(200, "application/json", len(body),
                              {"Content-Disposition": f'attachment; filename="{fn}"'})
                return self.wfile.write(body)
        except PermissionError:
            return self._json(401, {"error": "locked"})
        return self._json(404, {"error": "not found"})

    def do_POST(self):
        if not self._host_ok() or not self._origin_ok():
            return self._json(403, {"error": "origin not allowed"})
        S.last_seen = now()
        if self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
            return self._json(415, {"error": "JSON expected"})  # cross-site form cannot reach here
        path = urllib.parse.urlparse(self.path).path
        try:
            body = self._body()
        except (ValueError, json.JSONDecodeError) as exc:
            return self._json(400, {"error": str(exc)})
        try:
            if path == "/api/setup":
                return self._setup(body)
            if path == "/api/login":
                return self._login(body)
            s = self._session(need_csrf=True)
            if not s:
                return self._json(401, {"error": "locked"})
            if path == "/api/logout":
                wipe()
                return self._json(200, {"ok": True},
                                  {"Set-Cookie": f"{COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"})
            if path == "/api/data":
                return self._save(body)
            if path == "/api/password":
                with S.lock:
                    vault.unlock_password(str(body.get("old", "")))  # verifies current
                    vault.change_password(S.dek, str(body.get("new", "")))
                    d = vault.load(S.dek)
                    audit(d, "password changed")
                    vault.save(S.dek, d)
                return self._json(200, {"ok": True})
            if path == "/api/agent":
                with S.lock:
                    on = bool(body.get("enabled"))
                    vault.set_agent(S.dek, on)
                    d = vault.load(S.dek)
                    audit(d, f"Claude access {'enabled' if on else 'disabled'}")
                    vault.save(S.dek, d)
                return self._json(200, {"agent": vault.agent_enabled()})
            if path == "/api/backups":
                import offsite
                try:
                    if body.get("action") == "dest":
                        offsite.set_dest(body.get("path") or None)
                        with S.lock:
                            d = vault.load(S.dek)
                            audit(d, "backups: destination " + (str(body.get("path"))[:80] if body.get("path") else "local only"))
                            vault.save(S.dek, d)
                    elif body.get("action") == "run":
                        with S.lock:
                            offsite.run(S.dek, force=True)
                    return self._json(200, offsite.info())
                except (ValueError, OSError) as exc:
                    return self._json(400, {"error": str(exc)[:200]})
            if path == "/api/memory":
                import memory
                try:
                    with S.lock:
                        d = vault.load(S.dek)
                        a = body.get("action")
                        if a == "add":
                            memory.add_fact(d, body.get("text", ""), "owner", body.get("topic", "general"), body.get("ref", ""), body.get("project", ""))
                        elif a in ("verify", "delete"):
                            facts = memory.mem(d)["facts"]
                            f = next((x for x in facts if x["id"] == body.get("id")), None)
                            if not f:
                                raise ValueError("fact not found")
                            if a == "verify":
                                f["verified"] = True
                            else:
                                facts.remove(f)
                        else:
                            raise ValueError("unknown action")
                        audit(d, f"memory: {a}")
                        vault.save(S.dek, d)
                    _memory_soon(d)
                    return self._json(200, {"ok": True})
                except ValueError as exc:
                    return self._json(400, {"error": str(exc)[:200]})
            if path == "/api/mail":
                return self._mail(body)
            if path == "/api/life":
                return self._life(body)
            if path.startswith("/api/trading/"):
                return self._trading(path, body)
            if path == "/api/research":
                return self._research(body)
            if path == "/api/ai/chat":
                return self._ai_chat(body)
        except vault.VaultError as exc:
            return self._json(400, {"error": str(exc)})
        except PermissionError:
            return self._json(401, {"error": "locked"})
        return self._json(404, {"error": "not found"})

    # -- actions
    def _setup(self, body: dict):
        with S.lock:
            if vault.exists():
                return self._json(409, {"error": "already configured"})
            if not S.setup_token or not hmac.compare_digest(str(body.get("token", "")), S.setup_token):
                return self._json(403, {"error": "invalid setup code"})
            data = seed(str(body.get("name") or "you")[:40], vault.HOME / "settings.json")
            audit(data, "dashboard created")
            S.dek = vault.create(str(body.get("password", "")), data)
            S.setup_token = None
            SETUP_TOKEN.unlink(missing_ok=True)
            sess = self._new_session()
        return self._json(200, {"ok": True, "csrf": sess["csrf"]}, {"Set-Cookie": sess["cookie"]})

    def _login(self, body: dict):
        m = meta()
        if m.get("locked_until", 0) > now():
            return self._json(429, {"error": "too many attempts", "retry": int(m["locked_until"] - now())})
        if not vault.exists():
            return self._json(409, {"error": "not configured"})
        try:
            dek = vault.unlock_password(str(body.get("password", "")))
        except vault.VaultError:
            m["failures"] = m.get("failures", 0) + 1
            m["last_failure"] = int(now())
            if m["failures"] >= 5:
                m["locked_until"] = now() + min(3600, 30 * 2 ** (m["failures"] - 5))
            save_meta(m)
            return self._json(401, {"error": "incorrect password"})
        with S.lock:
            S.dek = dek
            d = vault.load(dek)
            if m.get("failures"):
                audit(d, f"{m['failures']} failed attempt(s) before sign-in")
            audit(d, "login")
            vault.save(dek, d)
            vault.daily_backup()
            _offsite_soon(dek)
            _memory_soon(d)
            save_meta({"failures": 0, "locked_until": 0, "last_failure": m.get("last_failure", 0)})
            sess = self._new_session()
        return self._json(200, {"ok": True, "csrf": sess["csrf"]}, {"Set-Cookie": sess["cookie"]})

    def _save(self, body: dict):
        data = body.get("data")
        need = {"profile", "settings", "projects", "ledger", "portfolio"}
        if not isinstance(data, dict) or not need <= data.keys():
            return self._json(400, {"error": "incomplete data"})
        if not is_local_url(str(data["settings"].get("ai", {}).get("endpoint", ""))):
            return self._json(400, {"error": "AI model must be local (127.0.0.1 / localhost)"})
        with S.lock:
            cur = vault.load(S.dek)
            if str(body.get("version")) != data_version(cur):  # someone else (Claude, another tab) changed YOUR data
                return self._json(409, {"error": "data changed (did Claude edit it?)",
                                        "data": public(cur), "version": data_version(cur)})
            for k in SERVER_KEYS:  # server-managed keys are preserved as is: browser never writes them
                if k in cur:
                    data[k] = cur[k]
                else:
                    data.pop(k, None)
            vault.save(S.dek, data)
            vault.daily_backup()
            _memory_soon(data)
            return self._json(200, {"ok": True, "version": data_version(data), "updated": int(vault.mtime() // 1_000_000)})

    def _trading(self, path: str, body: dict):
        from trading import panel

        what = path.rsplit("/", 1)[1]
        if what == "wallet":  # unregistered route: requires decrypted vault; seed never logged
            from trading import dex, dexpanel
            try:
                with S.lock:
                    d = vault.load(S.dek)
                    res, changed = dexpanel.handle(d, body)
                    if changed or body.get("action") in ("activate", "off", "execute"):
                        audit(d, f"unregistered wallet: {str(body.get('action'))[:20]}")
                        vault.save(S.dek, d)
                return self._json(200, res)
            except (ValueError, KeyError, dex.Stop) as exc:
                return self._json(400, {"error": str(exc)[:200]})
            except Exception as exc:  # noqa: BLE001
                return self._json(502, {"error": f"Could not complete: {type(exc).__name__}"})
        if what == "blockchair":  # user key: encrypted with keychain key; never sent back in full to browser
            from trading import blockchair as bc
            a = str(body.get("action", ""))
            try:
                if a == "save":
                    bc.store_key(str(body.get("key", "")))
                    try:
                        r = bc.test()
                    except Exception as exc:  # noqa: BLE001 — saved but reported as test failed
                        r = {"ok": False, "error": str(exc)[:160]}
                elif a == "test":
                    r = bc.test()
                elif a == "forget":
                    bc.forget()
                    r = {"ok": True}
                else:
                    r = {}
                r = {**r, **bc.info()}
            except (ValueError, bc.ApiError, bc.Quota) as exc:
                return self._json(400, {"error": str(exc)[:200], **bc.info()})
            with S.lock:
                d = vault.load(S.dek)
                audit(d, f"blockchair: {a or 'status'}")
                vault.save(S.dek, d)
            return self._json(200, r)
        if what == "movers":  # read-only: company profile from «Market 20» study
            return self._json(200, panel.movers_card(str(body.get("sym", ""))[:20]))
        try:
            if what == "fast":
                r = panel.set_fast(body)
            elif what == "control":
                r = panel.control(str(body.get("action", "")), body)
            elif what == "keys":
                r = panel.save_keys(body)
            elif what == "forget":
                from trading import real
                real.forget_keys()
                r = {"ok": True}
            elif what == "activate":
                r = panel.activate(body)
            else:
                return self._json(404, {"error": "not found"})
        except (ValueError, OSError) as exc:  # panel/real messages never leak keys
            return self._json(400, {"error": str(exc)[:200]})
        except Exception as exc:  # noqa: BLE001 - API Halt: no details that could contain secrets
            return self._json(502, {"error": f"Could not complete: {type(exc).__name__}"})
        with S.lock:
            d = vault.load(S.dek)
            audit(d, f"trading: {what} {body.get('action', '')}".strip())
            vault.save(S.dek, d)
        return self._json(200, r)

    def _mail(self, body: dict):
        """Read-only email. App password lives in secret section of the vault."""
        import inbox

        a = str(body.get("action", ""))
        try:
            if a == "status":
                d = load_data()
                m = d.get("mail") or {}
                return self._json(200, {"configured": bool(m.get("user")), "user": m.get("user"), "fetched": m.get("fetched"),
                                        "items": m.get("items", []), "proposals": inbox.proposals(m.get("items", []), d.get("subscriptions", [])),
                                        "error": m.get("error")})
            if a in ("save", "refresh"):
                with S.lock:
                    d = vault.load(S.dek)
                    sec = d.setdefault(SECRET, {})
                    if a == "save":
                        user, pw = str(body.get("user", "")).strip()[:120], str(body.get("password", "")).replace(" ", "")[:120]
                        host = str(body.get("host") or "").strip()[:80] or inbox.host_for(user)
                        if "@" not in user or not pw:
                            raise ValueError("enter your email and app password")
                        cred = {"user": user, "password": pw, "host": host}
                    else:
                        cred = sec.get("mail")
                        if not cred:
                            raise ValueError("connect your email first")
                try:  # outside lock: network can take time
                    items = inbox.fetch(cred["user"], cred["password"], cred.get("host"))
                except (imaplib_error(), OSError) as exc:
                    raise ValueError("could not read email: " + ("incorrect user or app password" if "auth" in str(exc).lower() or "login" in str(exc).lower() or "credential" in str(exc).lower() else type(exc).__name__)) from None
                with S.lock:
                    d = vault.load(S.dek)
                    if a == "save":
                        d.setdefault(SECRET, {})["mail"] = cred
                    d["mail"] = {"user": cred["user"], "host": cred.get("host"), "items": items, "fetched": int(time.time())}
                    audit(d, "email: connected" if a == "save" else "email: updated")
                    vault.save(S.dek, d)
                return self._json(200, {"ok": True, "n": len(items)})
            if a == "forget":
                with S.lock:
                    d = vault.load(S.dek)
                    d.setdefault(SECRET, {}).pop("mail", None)
                    d.pop("mail", None)
                    audit(d, "email: disconnected")
                    vault.save(S.dek, d)
                return self._json(200, {"ok": True})
            if a == "draft":
                d = load_data()
                m = next((x for x in (d.get("mail") or {}).get("items", []) if x["id"] == body.get("id")), None)
                if not m:
                    raise ValueError("email not found")
                ai = d["settings"]["ai"]
                payload = {"messages": inbox.draft_prompt(m, str(body.get("extra", ""))), "temperature": 0.4, "max_tokens": 500, "keep_alive": "2m"}
                if ai.get("model"):
                    payload["model"] = ai["model"]
                try:
                    js = ai_call(ai["endpoint"], payload)  # local models only: email does not leave Mac
                except (OSError, KeyError, ValueError, TimeoutError) as exc:
                    return self._json(502, {"error": f"Local AI unavailable: {str(exc)[:120]}"})
                return self._json(200, {"draft": js["choices"][0]["message"]["content"]})
        except ValueError as exc:
            return self._json(400, {"error": str(exc)[:200]})
        return self._json(404, {"error": "unknown action"})

    def _life(self, body: dict):
        """Calendar (private .ics), Apple Reminders, and iPhone Health. All read-only and local."""
        import lifesrc

        a = str(body.get("action", ""))
        try:
            if a in ("cal_save", "cal_refresh"):
                with S.lock:
                    d = vault.load(S.dek)
                    url = str(body.get("url", "")).strip()[:600] if a == "cal_save" else (d.get(SECRET, {}).get("calendar_url") or "")
                if not url:
                    raise ValueError("paste the private iCal address of your calendar")
                events = lifesrc.parse_ics(lifesrc.fetch_ics(url))
                with S.lock:
                    d = vault.load(S.dek)
                    if a == "cal_save":
                        d.setdefault(SECRET, {})["calendar_url"] = url
                    d["calendar"] = {"events": events, "fetched": int(time.time())}
                    audit(d, "calendar: updated")
                    vault.save(S.dek, d)
                return self._json(200, {"ok": True, "n": len(events)})
            if a == "cal_forget":
                with S.lock:
                    d = vault.load(S.dek)
                    d.get(SECRET, {}).pop("calendar_url", None)
                    d.pop("calendar", None)
                    vault.save(S.dek, d)
                return self._json(200, {"ok": True})
            if a == "reminders":
                items = lifesrc.reminders()
                with S.lock:
                    d = vault.load(S.dek)
                    d["reminders"] = {"items": items, "fetched": int(time.time())}
                    vault.save(S.dek, d)
                return self._json(200, {"ok": True, "n": len(items)})
            if a == "health_find":
                f = lifesrc.find_export()
                return self._json(200, {"file": f.name if f else None, "size_mb": round(f.stat().st_size / 1e6, 1) if f else None})
            if a == "health_import":
                f = lifesrc.find_export()
                if not f:
                    raise ValueError("Health export.zip not found in Downloads")
                summ = lifesrc.import_health(f)
                with S.lock:
                    d = vault.load(S.dek)
                    d["health_apple"] = summ
                    audit(d, "health: imported Health app export")
                    vault.save(S.dek, d)
                return self._json(200, {"ok": True, "days": len(summ["days"])})
        except (ValueError, OSError, zipfile_error()) as exc:
            return self._json(400, {"error": str(exc)[:240]})
        return self._json(404, {"error": "unknown action"})

    def _research(self, body: dict):
        import research

        try:
            if body.get("url"):
                return self._json(200, research.read(str(body["url"])[:2000]))
            return self._json(200, research.search_any(str(body.get("q", ""))))
        except (ValueError, OSError, TimeoutError) as exc:
            return self._json(502, {"error": f"Could not read: {str(exc)[:160]}"})

    def _ai_chat(self, body: dict):
        d = load_data()
        ai = d["settings"]["ai"]
        msgs = [m for m in body.get("messages", []) if isinstance(m, dict)
                and m.get("role") in ("user", "assistant") and isinstance(m.get("content"), str)][-20:]
        free = free_ram_gb()
        need = float(ai.get("min_free_gb", MIN_FREE_GB))
        if free is not None and free < need:  # do not compete with SPIKE training
            return self._json(503, {"error": f"Low free memory ({free} GB < {need} GB): local AI not started. "
                                             "Rule-based suggestions continue to work."})
        mode = MODES.get(str(body.get("mode_area", "")), "")
        extra = str(body.get("context_extra", ""))[:4000]
        sys_msg = (SYSTEM + ("\n" + mode if mode else "") + "\n\nCurrent data:\n"
                   + context_for_ai(d, body.get("project") or None) + ("\n\nTools summary:\n" + extra if extra else ""))
        if body.get("mode") == "next_steps":
            msgs = [{"role": "user", "content":
                     "Propose 3 to 5 concrete next steps. Respond ONLY with JSON: "
                     '[{"project":"<id>","title":"...","priority":"alta|media|baja","why":"..."}]. '
                     "Valid ids: " + ", ".join(p["id"] for p in d["projects"])}]
        payload = {"messages": [{"role": "system", "content": sys_msg}] + msgs,
                   "temperature": 0.4, "max_tokens": 900, "keep_alive": "2m"}  # Ollama offloads model after 2 min
        if ai.get("model"):
            payload["model"] = ai["model"]
        try:
            js = ai_call(ai["endpoint"], payload)
            text = js["choices"][0]["message"]["content"]
        except (OSError, KeyError, ValueError, TimeoutError) as exc:  # URLError is an OSError
            return self._json(502, {"error": f"Local AI unavailable: {str(exc)[:160]}"})
        return self._json(200, {"content": text})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=S.port)
    a = ap.parse_args()
    S.port = a.port
    vault.ensure_home()
    if not vault.exists():
        S.setup_token = secrets.token_urlsafe(24)
        vault._atomic_write(SETUP_TOKEN, S.setup_token.encode())
        print(f"First time: open Cage.app (one-time code is in {SETUP_TOKEN})", flush=True)
    else:
        SETUP_TOKEN.unlink(missing_ok=True)
    threading.Thread(target=reaper, daemon=True).start()
    ThreadingHTTPServer.daemon_threads = True
    srv = ThreadingHTTPServer(("127.0.0.1", S.port), H)
    print(f"Cage at http://127.0.0.1:{S.port}", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
