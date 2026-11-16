"""Non-custodial route actions from Cage. Always with active user session (decrypted vault).

- create: generates the 24 words and returns them ONCE for the user to note; saved in the secret section of the vault.
- confirm: user types 3 random words; until then the wallet cannot be used.
- status / balances: public address and balances (do not need the seed).
- prepare: quotes, contrasts, builds, inspects and simulates (does not sign).
- activate / off: real switch for this route, disabled by default (exact phrase + maximum capital).
- execute: only with the switch turned on, no kill switch and within capital: signs with the seed and sends.
- tax_csv: FIFO report in euros of operations made through this route.
None of this returns or logs the seed, except `create` (once only, to the user's screen).
"""
from __future__ import annotations

import json
import time

from trading import data, dex, dexwallet, taxreport

PHRASE = "ACTIVATE REAL WALLET"
SOL_RESERVE = 0.015          # SOL never exchanged (network fees + token account rent, ~0.002 SOL each)
TRIAL_EUR = 20.0
TARGET = {"cbBTC": 0.60, "wETH": 0.30, "SOL": 0.10}
BAND, MIN_TRADE_USD = 0.10, 5.0
POLICY = ("BTC/ETH/SOL 60/30/10 basket (cbBTC, wETH and SOL on Solana), because no strategy has shown a measured edge. "
          "It rebalances only if a part deviates more than 10 points and each trade is at least $5 (so "
          "fees do not eat into results). 0.015 SOL is always kept for fees. Cap: 20 €. Each trade is confirmed by you.")


def prices() -> dict:
    from trading import data as _d
    out = {"USDC": 1.0}
    for sym, (_, _, pair) in dex.TOKENS.items():
        if pair:
            out[sym] = float(_d.get_json(f"{_d.BINANCE}/ticker/price?symbol={pair}")["price"])
    return out


def eurusd() -> float | None:
    try:
        rows = json.loads((data.DATA / "daily" / "EURUSD_X.json").read_text())["rows"]
        return float(rows[-1][1])
    except (OSError, ValueError, KeyError, IndexError):
        return None


def rebalance_plan(bal: dict, px: dict) -> list[dict]:
    """Proposed operations (via USDC) to approach 60/30/10. Only if deviation > 10 pts and ≥ $5."""
    usable = dict(bal)
    usable["SOL"] = max(0.0, usable.get("SOL", 0) - SOL_RESERVE)
    val = {k: usable.get(k, 0) * px[k] for k in ("USDC", *TARGET)}
    total = sum(val.values())
    if total < MIN_TRADE_USD:
        return []
    plan = []
    for k, t in TARGET.items():
        cur = val.get(k, 0) / total
        diff = (t - cur) * total
        if abs(t - cur) > BAND or (val["USDC"] > MIN_TRADE_USD and diff > MIN_TRADE_USD):
            if diff >= MIN_TRADE_USD:
                plan.append({"sym_in": "USDC", "sym_out": k, "amount_usd": round(diff, 2), "why": f"{k} at {100 * cur:.0f}% (target {100 * t:.0f}%)"})
            elif diff <= -MIN_TRADE_USD:
                plan.append({"sym_in": k, "sym_out": "USDC", "amount": round(-diff / px[k], 8), "amount_usd": round(-diff, 2), "why": f"{k} at {100 * cur:.0f}% (target {100 * t:.0f}%)"})
    return sorted(plan, key=lambda x: x["sym_in"] == "USDC")  # first sales (free up USDC), then purchases
SECRET = "_secrets"


def _ctl() -> dict:
    try:
        return json.loads((data.HOME / "control.json").read_text())
    except (OSError, ValueError):
        return {}


def _save_ctl(c: dict) -> None:
    data.private_write(data.HOME / "control.json", json.dumps(c).encode())


def _w(d: dict) -> dict:
    return d.setdefault("dex_wallet", {})


def handle(d: dict, body: dict) -> tuple[dict, bool]:
    """Returns (response, should vault be saved?)."""
    a = body.get("action")
    w, sec = _w(d), d.setdefault(SECRET, {})
    if a == "status":
        c = _ctl().get("dex") or {}
        return {"address": w.get("address"), "confirmed": w.get("confirmed", False), "created": w.get("created"),
                "enabled": bool(c.get("enabled")), "capital": c.get("capital"), "trades": d.get("dex_trades", [])[-50:],
                "phrase": PHRASE, "halted": c.get("halted"), "quiz": None if w.get("confirmed") else w.get("quiz")}, False
    if a == "discard":  # only an unconfirmed and empty wallet (if user did not write down the words)
        if not w.get("address") or w.get("confirmed"):
            raise ValueError("only an unconfirmed wallet can be discarded")
        if any(float(v) > 0 for v in dex.balances(w["address"]).values()):
            raise ValueError("this wallet has funds: cannot be discarded")
        d.pop("dex_wallet", None)
        sec.pop("dex_words", None)
        return {"ok": True}, True
    if a == "create":
        if w.get("address"):
            raise ValueError("you already have a wallet; to change it, first empty it and delete it")
        words = dexwallet.new_mnemonic()
        sec["dex_words"] = words
        w.update(address=dexwallet.address(words), created=int(time.time()), confirmed=False, quiz=dexwallet.quiz(words))
        return {"words": words.split(), "address": w["address"], "quiz": w["quiz"]}, True  # ONLY time they leave
    if a == "confirm":
        words = sec.get("dex_words")
        if not words or not dexwallet.check_quiz(words, {int(k): v for k, v in (body.get("answers") or {}).items() if int(k) in w.get("quiz", [])}):
            raise ValueError("the words do not match: check what you wrote down")
        w.update(confirmed=True, quiz=None)
        return {"ok": True}, True
    if a == "balances":
        if not w.get("address"):
            raise ValueError("no wallet")
        return {"balances": dex.balances(w["address"])}, False
    if a == "prepare":
        if not w.get("confirmed"):
            raise ValueError("confirm first that you have written down the words")
        r = dex.prepare(body["sym_in"], body["sym_out"], float(body["amount"]), w["address"])
        r.pop("tx")  # the transaction is rebuilt upon execution, with fresh price
        return r, False
    if a == "activate":
        if body.get("phrase") != PHRASE:
            raise ValueError(f"type exactly '{PHRASE}'")
        if not w.get("confirmed"):
            raise ValueError("first create and confirm the wallet")
        cap = float(body.get("capital", 0))
        if not 10 <= cap <= 100_000:
            raise ValueError("maximum capital between 10 and 100,000 USDC")
        c = _ctl()
        c["dex"] = {"enabled": True, "capital": cap, "activated_at": int(time.time())}
        _save_ctl(c)
        return {"ok": True}, False
    if a == "off":
        c = _ctl()
        c.setdefault("dex", {})["enabled"] = False
        _save_ctl(c)
        return {"ok": True}, False
    if a == "execute":
        c = _ctl()
        if not (c.get("dex") or {}).get("enabled"):
            raise ValueError("non-custodial route is turned off")
        if c.get("kill"):
            raise ValueError("kill switch active")
        amount = float(body["amount"])
        usd_value = amount if body["sym_in"] == "USDC" else amount * dex.check_quote(dex.quote(body["sym_in"], body["sym_out"], amount), body["sym_in"], body["sym_out"])["ref"]
        live = [t for t in d.get("dex_trades", []) if t.get("status") != "fallida"]
        used = sum(t["usd"] for t in live if t["side"] == "buy") - sum(t["usd"] for t in live if t["side"] == "sell")
        if body["sym_in"] == "USDC" and used + usd_value > float(c["dex"]["capital"]):
            raise ValueError("would exceed the maximum capital you set")
        if body["sym_in"] == "SOL":  # always keep SOL for fees and to open token accounts
            bal = dex.balances(w["address"])
            if bal["SOL"] - amount < SOL_RESERVE:
                raise ValueError(f"leave at least {SOL_RESERVE} SOL in the wallet for fees (you have {bal['SOL']:.4f})")
        if any(t.get("status") == "pendiente" for t in d.get("dex_trades", [])):
            raise ValueError("there is a pending unconfirmed transaction: click 'Check pending' before making another")
        words = sec.get("dex_words")
        kp = dexwallet.keypair(words)
        prep = dex.prepare(body["sym_in"], body["sym_out"], amount, str(kp.pubkey()))
        sig = dex.submit(prep["tx"], kp)
        del kp, words
        asset = body["sym_out"] if body["sym_in"] == "USDC" else body["sym_in"]
        dec = dex.TOKENS[asset][1]
        qty = (int(prep["quote"]["outAmount"]) if body["sym_in"] == "USDC" else int(prep["quote"]["inAmount"])) / 10 ** dec
        rec = {"ts": int(time.time()), "date": time.strftime("%Y-%m-%d"), "asset": asset, "side": "buy" if body["sym_in"] == "USDC" else "sell",
               "qty": qty, "price_usd": prep["check"]["price"], "usd": qty * prep["check"]["price"], "fee_usd": prep["fee_sol"] * (prep["check"]["ref"] if asset == "SOL" else 0),
               "signature": sig, "route": prep["route"], "status": "pendiente"}
        d.setdefault("dex_trades", []).append(rec)  # recorded BEFORE waiting: never lose a sent transaction
        try:
            rec["status"] = dex.confirm(sig)
        except dex.Stop as exc:
            rec["status"] = "fallida"
            return {"ok": False, "error": str(exc), "signature": sig, "trade": rec}, True
        return {"ok": True, "signature": sig, "trade": rec}, True
    if a == "reconcile":
        changed = False
        for t in d.get("dex_trades", []):
            if t.get("status") == "pendiente":
                try:
                    t["status"] = dex.confirm(t["signature"], wait_s=2)
                except dex.Stop:
                    t["status"] = "fallida"
                changed = True
        return {"ok": True, "pending": sum(t.get("status") == "pendiente" for t in d.get("dex_trades", []))}, changed
    if a == "trial_start":
        if not w.get("confirmed"):
            raise ValueError("first create and confirm the wallet")
        bal = dex.balances(w["address"])
        px = prices()
        value = sum(bal[k] * px[k] for k in bal)
        if value < 5:
            raise ValueError(f"the wallet has ${value:.2f}: send the 20 € first")
        d["dex_trial"] = {"ts": int(time.time()), "date": time.strftime("%Y-%m-%d"), "balances": bal, "prices": px, "value_usd": value,
                          "eurusd": eurusd(), "cap_eur": TRIAL_EUR}
        return {"ok": True, "trial": d["dex_trial"]}, True
    if a == "trial":
        tr = d.get("dex_trial")
        if not tr:
            return {"trial": None, "policy": POLICY}, False
        bal = dex.balances(w["address"])
        px = prices()
        now = sum(bal[k] * px[k] for k in bal)
        hold = sum(tr["balances"][k] * px[k] for k in tr["balances"])          # do nothing since inception
        btc = tr["value_usd"] / tr["prices"]["cbBTC"] * px["cbBTC"]             # all in BTC since inception
        fx = eurusd() or tr.get("eurusd") or 1.0
        return {"trial": tr, "policy": POLICY, "now_usd": now, "hold_usd": hold, "btc_usd": btc, "eurusd": fx,
                "now_eur": now / fx, "plan": rebalance_plan(bal, px)}, False
    if a == "tax_csv":
        fx = {}
        try:
            fx = {k: v for k, v in json.loads((data.DATA / "daily" / "EURUSD_X.json").read_text())["rows"]}
        except (OSError, ValueError, KeyError):
            pass
        rows = taxreport.fifo([{**t, "fee_usd": t.get("fee_usd", 0)} for t in d.get("dex_trades", []) if t.get("status", "confirmada") == "confirmada"], fx)
        return {"csv": taxreport.to_csv(rows), "rows": len(rows)}, False
    raise ValueError("unknown action")
