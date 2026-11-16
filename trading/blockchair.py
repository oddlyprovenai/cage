"""Blockchair (blockchair.com): on-chain data, READ-ONLY, with the user's key.

- The key is entered by the user in Cage (Connect). It is encrypted (AES-GCM) with a random key residing in macOS
  Keychain, just like the Binance keys: the 24/7 agent needs it without the vault password. Never saved in
  plaintext, logs, Memory, or shown on screen (only its first 4 and last 4 characters).
- Quota: counts daily requests and "points" (request_cost), halting BEFORE the plan limit
  (90% of daily max reported by Blockchair; defaults to 900). Local URL cache to avoid duplicates.
- Errors never include the URL (which would carry the key).
"""
from __future__ import annotations

import base64
import hashlib
import json
import secrets
import subprocess
import time
import urllib.parse

from trading import data

API = "https://api.blockchair.com"
KEYF = data.HOME / "blockchair-key.json"
USAGE = data.HOME / "blockchair-usage.json"
CACHE = data.DATA / "blockchair"
KC_SERVICE, KC_ACCOUNT = "cage-blockchair", "key-wrap"
DEFAULT_DAILY = 900
CHAINS = {"BTCUSDT": "bitcoin", "ETHUSDT": "ethereum"}


class Quota(Exception):
    """Daily reserved cap reached: no more requests made today."""


class ApiError(Exception):
    pass


# ---------------------------------------------------------------- key (encrypted, never plaintext)
def _kc_get() -> bytes | None:
    r = subprocess.run(["security", "find-generic-password", "-s", KC_SERVICE, "-a", KC_ACCOUNT, "-w"],
                       capture_output=True, text=True, check=False)
    return base64.b64decode(r.stdout.strip()) if r.returncode == 0 and r.stdout.strip() else None


def _kc_set(token: bytes) -> None:
    subprocess.run(["security", "add-generic-password", "-U", "-s", KC_SERVICE, "-a", KC_ACCOUNT, "-w",
                    base64.b64encode(token).decode()], capture_output=True, check=True)


def mask(k: str) -> str:
    return (k[:4] + "…" + k[-4:]) if len(k) > 10 else "…"


def store_key(key: str) -> None:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    key = key.strip()
    if not 16 <= len(key) <= 128 or any(c.isspace() for c in key):
        raise ValueError("invalid Blockchair key format")
    token, nonce = secrets.token_bytes(32), secrets.token_bytes(12)
    blob = AESGCM(token).encrypt(nonce, key.encode(), b"cage-blockchair")
    _kc_set(token)
    data.private_write(KEYF, json.dumps({"hint": mask(key), "n": base64.b64encode(nonce).decode(),
                                         "c": base64.b64encode(blob).decode(), "saved": int(time.time())}).encode())


def load_key() -> str | None:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    if not KEYF.is_file():
        return None
    meta, token = json.loads(KEYF.read_text()), _kc_get()
    if not token:
        return None
    return AESGCM(token).decrypt(base64.b64decode(meta["n"]), base64.b64decode(meta["c"]), b"cage-blockchair").decode()


def forget() -> None:
    KEYF.unlink(missing_ok=True)
    subprocess.run(["security", "delete-generic-password", "-s", KC_SERVICE, "-a", KC_ACCOUNT], capture_output=True, check=False)


def info() -> dict:
    if not KEYF.is_file():
        return {"saved": False}
    m = json.loads(KEYF.read_text())
    return {"saved": True, "hint": m.get("hint"), "date": m.get("saved"), "plan": m.get("plan"), "usage": usage()}


# ---------------------------------------------------------------- quota and calls
def usage() -> dict:
    try:
        u = json.loads(USAGE.read_text())
    except (OSError, ValueError):
        u = {}
    today = time.strftime("%Y-%m-%d")
    if u.get("date") != today:
        u = {"date": today, "requests": 0, "points": 0.0, "limit": u.get("limit", DEFAULT_DAILY)}
    return u


def _spend(cost: float) -> None:
    u = usage()
    u["requests"] += 1
    u["points"] = round(u["points"] + float(cost or 1), 3)
    data.private_write(USAGE, json.dumps(u).encode())


def _curl(url: str, timeout: int = 40) -> dict:
    # URL (with key) passes via stdin, not as argument: prevents showing up in process list
    try:
        r = subprocess.run(["curl", "-sS", "-m", str(timeout), "-A", "Cage (reading)", "-K", "-"],
                           input=f'url = "{url}"\n'.encode(), capture_output=True, timeout=timeout + 5)
    except subprocess.TimeoutExpired:
        raise ApiError("Blockchair timed out") from None  # without command: would carry key
    if r.returncode != 0:
        raise ApiError("no response from Blockchair")
    try:
        return json.loads(r.stdout)
    except ValueError:
        raise ApiError("invalid response from Blockchair") from None


def call(path: str, params: dict | None = None, ttl: int = 3600, key: str | None = None) -> dict:
    """GET with key, cache and quota. Raises Quota before exceeding 90% of daily limit."""
    params = dict(params or {})
    ident = path + "?" + urllib.parse.urlencode(sorted(params.items()))
    cp = CACHE / (hashlib.sha256(ident.encode()).hexdigest()[:24] + ".json")
    if ttl and cp.is_file() and time.time() - cp.stat().st_mtime < ttl:
        return json.loads(cp.read_text())
    u = usage()
    if u["points"] >= 0.9 * float(u.get("limit") or DEFAULT_DAILY):
        raise Quota(f"reserved daily cap reached ({u['points']:.0f} of {u.get('limit')} points)")
    key = key or load_key()
    if key:
        params["key"] = key
    js = _curl(f"{API}{path}?{urllib.parse.urlencode(params)}")
    ctx = js.get("context") or {}
    _spend(ctx.get("request_cost", 1))
    if ctx.get("code") != 200:
        raise ApiError(f"Blockchair responded {ctx.get('code')}: {str(ctx.get('error') or '')[:120]}")
    CACHE.mkdir(parents=True, exist_ok=True)
    data.private_write(cp, json.dumps(js).encode())
    return js


def test(key: str | None = None) -> dict:
    """Minimal test: key status (plan, expiration and quota) and an inexpensive query."""
    key = key or load_key()
    if not key:
        raise ValueError("no saved key")
    plan = {}
    try:
        p = _curl(f"{API}/premium/stats?{urllib.parse.urlencode({'key': key})}")
        d = p.get("data") or {}
        if (p.get("context") or {}).get("code") == 200 and d:
            plan = {k: d.get(k) for k in ("valid_until", "max_requests_per_day", "requests_today", "requests_left", "max_requests_in_parallel") if k in d}
    except ApiError:
        pass
    js = call("/bitcoin/stats", ttl=0, key=key)
    if plan.get("max_requests_per_day"):
        u = usage()
        u["limit"] = int(plan["max_requests_per_day"])
        data.private_write(USAGE, json.dumps(u).encode())
    if KEYF.is_file():
        m = json.loads(KEYF.read_text())
        m["plan"] = plan
        data.private_write(KEYF, json.dumps(m).encode())
    return {"ok": True, "plan": plan, "usage": usage(), "best_block": js["data"].get("best_block_height"),
            "request_cost": (js.get("context") or {}).get("request_cost")}


# ---------------------------------------------------------------- data
def snapshot(chain: str = "bitcoin") -> dict:
    d = call(f"/{chain}/stats", ttl=600)["data"]
    keys = ("transactions_24h", "volume_24h", "mempool_transactions", "mempool_size", "mempool_total_fee_usd",
            "average_transaction_fee_usd_24h", "median_transaction_fee_usd_24h", "suggested_transaction_fee_per_byte_sat",
            "hashrate_24h", "cdd_24h", "largest_transaction_24h", "hodling_addresses", "market_price_usd")
    return {k: d.get(k) for k in keys if k in d} | {"ts": int(time.time()), "chain": chain}


def whales(chain: str = "bitcoin", min_usd: float = 25e6, limit: int = 10) -> list[dict]:
    """Recent large transactions (informational: neither buy nor sell signal)."""
    field = "output_total_usd" if chain == "bitcoin" else "value_usd"
    js = call(f"/{chain}/transactions", {"q": f"{field}({int(min_usd)}..)", "s": "id(desc)", "limit": limit}, ttl=1800)
    out = []
    for t in js.get("data") or []:
        out.append({"chain": chain, "hash": t.get("hash"), "time": t.get("time"), "usd": t.get(field),
                    "link": f"https://blockchair.com/{chain}/transaction/{t.get('hash')}"})
    return out


def daily(chain: str, start: str, end: str) -> list[dict]:
    """Daily series from blocks table (one aggregation request per stretch)."""
    if chain == "bitcoin":
        a = "date,sum(transaction_count),sum(fee_total_usd),sum(output_total_usd),sum(cdd_total),avg(size)"
    else:
        a = "date,sum(transaction_count),sum(fee_total_usd),sum(value_total_usd),avg(gas_used)"
    js = call(f"/{chain}/blocks", {"a": a, "q": f"time({start}..{end})", "limit": 10000}, ttl=30 * 86400)
    return js.get("data") or []
