"""REAL MONEY path: exists, but is OFF until the user activates it themselves in Cage.

Safeguards (in code; the model cannot change them):
- Real switch off by default; reread just before every order, alongside the kill switch.
- Spot trading-only keys: rejected if they allow withdrawals, transfers, margin or futures (Binance
  /sapi/v1/account/apiRestrictions). No leverage or derivatives: spot buy/sell only (no shorts).
- Maximum capital set by the user; 15% drawdown on that capital → closes everything and turns off until the user reactivates.
- Maximum daily loss, maximum position size, 1/4 Kelly cap (risk.py).
- Automatic halt if data is stale, if real position does not match expected, or if API fails.
- Gradual ramp: first 10 orders at 25% size. User confirmation of each order (optional,
  enabled by default). Complete audit log of every order with comparison against simulated execution.
Keys are stored encrypted (AES-256-GCM) with a random key residing in macOS Keychain; never in plaintext,
never in logs or responses.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import math
import os
import secrets
import subprocess
import time
import urllib.parse

from trading import data

LIVE, TESTNET = "https://api.binance.com", "https://testnet.binance.vision"
KEYS = data.HOME / "real-keys.json"
ORDERS = data.HOME / "real-orders.jsonl"
INFLIGHT = data.HOME / "real-inflight.json"  # unconfirmed sent order: halts if present at startup
MAX_PRICE_DEV = 0.05  # order book price vs last candle: > 5% is considered absurd
CONTROL = data.HOME / "control.json"
KC_SERVICE, KC_ACCOUNT = "cage-trading", "keys-wrap"
RAMP_ORDERS, RAMP_SIZE = 10, 0.25
DD_STOP = 0.15


class Halt(Exception):
    """Halts real mode: records reason and turns real switch off."""


# ---------------------------------------------------------------- keys (encrypted, never plaintext)
def _kc_get() -> bytes | None:
    r = subprocess.run(["security", "find-generic-password", "-s", KC_SERVICE, "-a", KC_ACCOUNT, "-w"],
                       capture_output=True, text=True, check=False)
    return base64.b64decode(r.stdout.strip()) if r.returncode == 0 and r.stdout.strip() else None


def _kc_set(token: bytes) -> None:
    # token is random (not the exchange key); real secret never passes through args
    subprocess.run(["security", "add-generic-password", "-U", "-s", KC_SERVICE, "-a", KC_ACCOUNT, "-w",
                    base64.b64encode(token).decode()], capture_output=True, check=True)


def store_keys(api_key: str, api_secret: str, testnet: bool) -> None:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    token = secrets.token_bytes(32)
    nonce = secrets.token_bytes(12)
    blob = AESGCM(token).encrypt(nonce, json.dumps({"k": api_key, "s": api_secret}).encode(), b"cage-real-keys")
    _kc_set(token)
    data.private_write(KEYS, json.dumps({"testnet": testnet, "hint": mask(api_key), "n": base64.b64encode(nonce).decode(),
                                          "c": base64.b64encode(blob).decode(), "saved": int(time.time())}).encode())


def load_keys() -> tuple[str, str, bool] | None:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    if not KEYS.is_file():
        return None
    meta, token = json.loads(KEYS.read_text()), _kc_get()
    if not token:
        return None
    raw = AESGCM(token).decrypt(base64.b64decode(meta["n"]), base64.b64decode(meta["c"]), b"cage-real-keys")
    d = json.loads(raw)
    return d["k"], d["s"], bool(meta.get("testnet"))


def forget_keys() -> None:
    KEYS.unlink(missing_ok=True)
    subprocess.run(["security", "delete-generic-password", "-s", KC_SERVICE, "-a", KC_ACCOUNT], capture_output=True, check=False)


def keys_info() -> dict:
    if not KEYS.is_file():
        return {"saved": False}
    m = json.loads(KEYS.read_text())
    return {"saved": True, "hint": m.get("hint"), "testnet": m.get("testnet"), "date": m.get("saved")}


def mask(k: str) -> str:
    return (k[:4] + "…" + k[-4:]) if len(k) > 10 else "…"


# ---------------------------------------------------------------- API firmada (sin dependencias)
class Binance:
    def __init__(self, key: str, secret: str, testnet: bool):
        self._k, self._s, self.base, self.testnet = key, secret.encode(), (TESTNET if testnet else LIVE), testnet

    def __repr__(self) -> str:  # never shows keys
        return f"Binance(testnet={self.testnet}, key={mask(self._k)})"

    def _req(self, method: str, path: str, params: dict | None = None, signed: bool = True):
        import urllib.request

        q = dict(params or {})
        if signed:
            q["timestamp"] = int(time.time() * 1000)
            q["recvWindow"] = 5000
            qs = urllib.parse.urlencode(q)
            q_s = qs + "&signature=" + hmac.new(self._s, qs.encode(), hashlib.sha256).hexdigest()
        else:
            q_s = urllib.parse.urlencode(q)
        url = f"{self.base}{path}" + (f"?{q_s}" if q_s else "")
        req = urllib.request.Request(url, method=method, headers={"X-MBX-APIKEY": self._k, "User-Agent": data.UA})
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                return json.loads(r.read())
        except Exception as exc:  # noqa: BLE001 - never include signed URL or headers in error
            raise Halt(f"API error on {path}: {type(exc).__name__}") from None

    def restrictions(self) -> dict:
        return self._req("GET", "/sapi/v1/account/apiRestrictions")

    def account(self) -> dict:
        return self._req("GET", "/api/v3/account")

    def filters(self, sym: str) -> dict:
        info = self._req("GET", "/api/v3/exchangeInfo", {"symbol": sym}, signed=False)["symbols"][0]
        f = {x["filterType"]: x for x in info["filters"]}
        return {"step": float(f["LOT_SIZE"]["stepSize"]), "min_qty": float(f["LOT_SIZE"]["minQty"]),
                "min_notional": float((f.get("NOTIONAL") or f.get("MIN_NOTIONAL") or {}).get("minNotional", 5))}

    def market(self, sym: str, side: str, qty: float, client_id: str | None = None) -> dict:
        p = {"symbol": sym, "side": side.upper(), "type": "MARKET", "quantity": f"{qty:.8f}".rstrip("0").rstrip(".")}
        if client_id:  # Binance rejects a second send with same ID: protects against duplicate orders
            p["newClientOrderId"] = client_id
        return self._req("POST", "/api/v3/order", p)


def check_permissions(api: Binance) -> dict:
    """Spot trading only. On live network verification is required; testnet does not offer this endpoint and is accepted."""
    if api.testnet:
        api.account()
        return {"ok": True, "detail": "testnet: permissions not verifiable, simulated money"}
    r = api.restrictions()
    bad = [k for k in ("enableWithdrawals", "enableInternalTransfer", "enableMargin", "enableFutures",
                       "permitsUniversalTransfer", "enableVanillaOptions") if r.get(k)]
    if bad:
        return {"ok": False, "detail": "rejected: key allows " + ", ".join(bad) + ". Create one with spot trading only."}
    if not r.get("enableSpotAndMarginTrading"):
        return {"ok": False, "detail": "key does not allow spot trading"}
    return {"ok": True, "detail": "spot trading only, no withdrawals"}


# ---------------------------------------------------------------- real execution with guardrails
def floor_step(q: float, step: float) -> float:
    return math.floor(q / step) * step if step else q


def guard(ctl: dict, st: dict, now: float, candle_t: int | None, book_t: int | None) -> None:
    """Called right before EACH real order. Any failure → Halt (nothing sent)."""
    real = ctl.get("real") or {}
    if not real.get("enabled"):
        raise Halt("real mode is off")
    if ctl.get("kill"):
        raise Halt("kill switch active")
    if not candle_t or now * 1000 - candle_t > 2.5 * 3600_000:
        raise Halt("stale candle data")
    if not book_t or now * 1000 - book_t > 120_000:
        raise Halt("stale or missing order book")
    rs = st.get("real", {})
    if rs.get("peak") and rs.get("equity") is not None and 1 - rs["equity"] / rs["peak"] >= DD_STOP:
        raise Halt("15% drawdown on real capital")
    if INFLIGHT.is_file():
        raise Halt("unconfirmed real order from before restart: check account before continuing")


def sane_price(price: float, ref: float | None) -> None:
    """Anomalous price (data or order book error): do not trade."""
    if not price or price <= 0 or not ref or abs(price / ref - 1) > MAX_PRICE_DEV:
        raise Halt(f"anomalous price: {price} vs last candle {ref}")


def execute(api: Binance, ctl: dict, st: dict, sym: str, target_frac: float, price: float, snap: dict,
            now: float | None = None) -> dict | None:
    """Moves real position of `sym` towards target_frac × capital (spot: never short). Returns record."""
    now = now or time.time()
    guard(ctl, st, now, snap.get("candle_t"), snap.get("book_t"))
    real, rs = ctl["real"], st.setdefault("real", {"orders": 0, "expected": {}})
    capital = float(real["capital"])
    base = sym.replace("USDT", "")
    acct = {b["asset"]: float(b["free"]) + float(b["locked"]) for b in api.account()["balances"]}
    held, usdt = acct.get(base, 0.0), acct.get("USDT", 0.0)
    exp = rs["expected"].get(sym)
    if exp is not None and abs(held - exp) > max(1e-8, 0.01 * max(exp, held)):
        raise Halt(f"position mismatch on {sym}: expected {exp}, real {held}")
    tgt = max(0.0, target_frac)  # spot: no shorts
    if rs["orders"] < RAMP_ORDERS:
        tgt *= RAMP_SIZE
    want_value = min(tgt * capital, float(real.get("max_position", 0.2)) * capital)
    dq = want_value / price - held
    f = api.filters(sym)
    q = floor_step(abs(dq), f["step"])
    if q < f["min_qty"] or q * price < max(f["min_notional"], 10):
        return None
    if dq > 0 and q * price > min(usdt, capital - sum((rs.get("value") or {}).values())):
        raise Halt("order would exceed maximum capital set by the user")
    side = "BUY" if dq > 0 else "SELL"
    try:  # switch and kill switch reread from disk just before sending
        ctl = json.loads(CONTROL.read_text())
    except (OSError, ValueError):
        raise Halt("cannot read control: nothing sent") from None
    guard(ctl, st, time.time(), snap.get("candle_t"), snap.get("book_t"))
    if ctl.get("real", {}).get("confirm_each") and not approved(ctl, sym, side, q):
        rs["pending"] = {"sym": sym, "side": side, "qty": q, "price": price, "ts": int(now), "id": secrets.token_hex(4)}
        return {"pending": rs["pending"]}
    sane_price(price, snap.get("ref_close"))
    cid = "cage-" + hashlib.sha1(f"{sym}|{snap.get('candle_t')}|{side}".encode()).hexdigest()[:24]
    if cid in (rs.get("sent") or []):
        return None  # already sent this exact order on this candle: never duplicate
    data.private_write(INFLIGHT, json.dumps({"sym": sym, "side": side, "qty": q, "cid": cid, "ts": int(time.time())}).encode())
    r = api.market(sym, side, q, cid)
    rs.setdefault("sent", []).append(cid)
    rs["sent"] = rs["sent"][-200:]
    fills = r.get("fills") or []
    filled = sum(float(x["qty"]) for x in fills) or float(r.get("executedQty", 0))
    avg = (sum(float(x["price"]) * float(x["qty"]) for x in fills) / filled) if fills and filled else price
    half = (snap.get("spread_bps") or 2.0) / 2e4
    sim = price * (1 + half + 0.0005) if side == "BUY" else price * (1 - half - 0.0005)
    INFLIGHT.unlink(missing_ok=True)  # confirmed by exchange
    rs["orders"] += 1
    rs["expected"][sym] = held + (filled if side == "BUY" else -filled)
    rec = {"ts": int(now), "sym": sym, "side": side, "qty": filled, "avg": avg, "sim": round(sim, 6),
           "slip_vs_sim_bps": round(1e4 * (avg / sim - 1) * (1 if side == "BUY" else -1), 2), "testnet": api.testnet,
           "status": r.get("status"), "order_id": r.get("orderId"), "ramp": rs["orders"] <= RAMP_ORDERS}
    with os.fdopen(os.open(ORDERS, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600), "a") as fh:
        fh.write(json.dumps(rec) + "\n")
    rs.pop("pending", None)
    return rec


def approved(ctl: dict, sym: str, side: str, qty: float) -> bool:
    a = (ctl.get("real") or {}).get("approve") or {}
    return bool(a) and a.get("sym") == sym and a.get("side") == side and abs(a.get("qty", 0) - qty) <= 0.02 * qty \
        and time.time() - a.get("ts", 0) < 600


def close_all(api: Binance, syms: list[str]) -> list[dict]:
    """Sells all holdings in agent symbols (when halting due to drawdown or deactivating). Reduces risk only."""
    acct = {b["asset"]: float(b["free"]) for b in api.account()["balances"]}
    out = []
    for sym in syms:
        q = floor_step(acct.get(sym.replace("USDT", ""), 0.0), api.filters(sym)["step"])
        if q > 0:
            try:
                out.append(api.market(sym, "SELL", q))
            except Halt:
                continue
    return out


def update_equity(api: Binance, st: dict, prices: dict, capital: float) -> dict:
    acct = {b["asset"]: float(b["free"]) + float(b["locked"]) for b in api.account()["balances"]}
    value = {s: acct.get(s.replace("USDT", ""), 0.0) * p for s, p in prices.items() if p}
    rs = st.setdefault("real", {"orders": 0, "expected": {}})
    eq = min(capital, acct.get("USDT", 0.0)) + sum(value.values()) if rs.get("orders") else capital
    rs.update(value=value, equity=eq, peak=max(rs.get("peak") or capital, eq), ts=int(time.time()))
    return rs
