"""Non-custodial route: standard wallet, allowlist, no third-party sends, price caps and FIFO (offline)."""
from __future__ import annotations

import base64
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
pytest.importorskip("solders")
from solders.hash import Hash  # noqa: E402
from solders.instruction import AccountMeta, Instruction  # noqa: E402
from solders.keypair import Keypair  # noqa: E402
from solders.message import MessageV0  # noqa: E402
from solders.pubkey import Pubkey  # noqa: E402
from solders.system_program import TransferParams, transfer  # noqa: E402
from solders.transaction import VersionedTransaction  # noqa: E402

from trading import dex, dexwallet, taxreport  # noqa: E402

VECTOR = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"


def tx_with(ixs, payer):
    msg = MessageV0.try_compile(payer.pubkey(), ixs, [], Hash.default())
    return base64.b64encode(bytes(VersionedTransaction(msg, [payer]))).decode()


def test_wallet_standard_derivation_and_quiz():
    assert dexwallet.address(VECTOR) == "HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk"  # Phantom/Solflare
    w = dexwallet.new_mnemonic()
    assert len(w.split()) == 24 and dexwallet.valid(w)
    pos = dexwallet.quiz(w)
    ws = w.split()
    assert dexwallet.check_quiz(w, {i: ws[i - 1] for i in pos})
    assert not dexwallet.check_quiz(w, {i: "mal" for i in pos})


def test_rejects_unlisted_program():
    kp = Keypair()
    evil = Instruction(Pubkey.new_unique(), b"\x01", [AccountMeta(kp.pubkey(), True, True)])
    with pytest.raises(dex.Stop):
        dex.inspect(tx_with([evil], kp), str(kp.pubkey()))


def test_rejects_transfer_to_someone_else_but_allows_own_wsol():
    kp = Keypair()
    other = Pubkey.new_unique()
    with pytest.raises(dex.Stop):
        dex.inspect(tx_with([transfer(TransferParams(from_pubkey=kp.pubkey(), to_pubkey=other, lamports=1000))], kp), str(kp.pubkey()))
    own = Pubkey.from_string(dex.ata(str(kp.pubkey()), dex.WSOL))
    r = dex.inspect(tx_with([transfer(TransferParams(from_pubkey=kp.pubkey(), to_pubkey=own, lamports=1000))], kp), str(kp.pubkey()))
    assert "System (wrap own SOL only)" in r["programs"]


def test_rejects_foreign_fee_payer():
    kp, other = Keypair(), Keypair()
    own = Pubkey.from_string(dex.ata(str(other.pubkey()), dex.WSOL))
    tx = tx_with([transfer(TransferParams(from_pubkey=other.pubkey(), to_pubkey=own, lamports=1))], other)
    with pytest.raises(dex.Stop):
        dex.inspect(tx, str(kp.pubkey()))


def test_quote_limits_and_second_price_source():
    q = {"slippageBps": 50, "priceImpactPct": "0.001", "inAmount": str(100 * 10**6), "outAmount": str(int(1.2 * 10**9))}
    assert dex.check_quote(q, "USDC", "SOL", ref_price=83.0)["gap"] < 0.01
    with pytest.raises(dex.Stop):
        dex.check_quote(q, "USDC", "SOL", ref_price=90.0)  # Jupiter 83,3 vs 90: difiere > 1 %
    with pytest.raises(dex.Stop):
        dex.check_quote({**q, "priceImpactPct": "0.02"}, "USDC", "SOL", ref_price=83.0)
    with pytest.raises(dex.Stop):
        dex.check_quote({**q, "slippageBps": 300}, "USDC", "SOL", ref_price=83.0)
    with pytest.raises(dex.Stop):
        dex.quote("USDC", "BONK", 10)  # token fuera de la lista blanca


def test_module_has_no_send_function():
    src = (ROOT / "trading" / "dex.py").read_text()
    for bad in ("def withdraw", "def send(", "def transfer", "transfer(TransferParams"):
        assert bad not in src


def test_fifo_tax_report_in_euros():
    trades = [{"date": "2026-01-02", "asset": "SOL", "side": "buy", "qty": 10, "price_usd": 100, "fee_usd": 1},
              {"date": "2026-02-02", "asset": "SOL", "side": "buy", "qty": 10, "price_usd": 120, "fee_usd": 1},
              {"date": "2026-03-02", "asset": "SOL", "side": "sell", "qty": 15, "price_usd": 150, "fee_usd": 2}]
    rows = taxreport.fifo(trades, {"2026-01-02": 1.0, "2026-02-02": 1.0, "2026-03-02": 1.0})
    r = rows[0]
    assert r["valor_adquisicion_eur"] == pytest.approx(1001 + 5 * 120.1, abs=0.01)  # 10 a 100,1 € + 5 a 120,1 € (con comisión)
    assert r["valor_transmision_eur"] == pytest.approx(2248) and r["fecha_adquisicion"] == "2026-01-02"
    with pytest.raises(ValueError):
        taxreport.fifo([{"date": "2026-01-01", "asset": "X", "side": "sell", "qty": 1, "price_usd": 1}])
    assert "FIFO" in taxreport.to_csv(rows)


def test_trial_rebalance_plan_keeps_sol_reserve_and_min_trade():
    from trading import dexpanel as P
    px = {"USDC": 1.0, "SOL": 80.0, "cbBTC": 60000.0, "wETH": 2000.0}
    plan = P.rebalance_plan({"USDC": 0.0, "SOL": 0.29, "cbBTC": 0.0, "wETH": 0.0}, px)  # ~23 $ en SOL
    sells = [x for x in plan if x["sym_in"] == "SOL"]
    assert sells and sells[0]["amount"] <= 0.29 - P.SOL_RESERVE + 1e-9   # nunca toca la reserva
    assert all(x["amount_usd"] >= P.MIN_TRADE_USD for x in plan)
    assert plan[0]["sym_in"] != "USDC"                                      # primero vender, luego comprar
    assert P.rebalance_plan({"USDC": 3.0, "SOL": 0.015, "cbBTC": 0, "wETH": 0}, px) == []  # demasiado poco: no se opera


def test_sent_trade_is_recorded_even_without_confirmation(monkeypatch):
    from trading import dexpanel as P
    words = dexwallet.new_mnemonic()
    d = {"_secrets": {"dex_words": words}, "dex_wallet": {"address": dexwallet.address(words), "confirmed": True}}
    monkeypatch.setattr(P, "_ctl", lambda: {"dex": {"enabled": True, "capital": 25}})
    monkeypatch.setattr(dex, "prepare", lambda *a, **k: {"tx": "x", "quote": {"outAmount": "100000", "inAmount": "10000000"},
                                                          "check": {"price": 100.0, "ref": 100.0}, "fee_sol": 0.00001, "route": ["r"]})
    monkeypatch.setattr(dex, "submit", lambda tx, kp: "SIG123")
    monkeypatch.setattr(dex, "confirm", lambda sig, wait_s=60: "pendiente")
    r, save = P.handle(d, {"action": "execute", "sym_in": "USDC", "sym_out": "SOL", "amount": 10})
    assert save and r["trade"]["status"] == "pendiente" and d["dex_trades"][0]["signature"] == "SIG123"
    with pytest.raises(ValueError):  # con una pendiente no se lanza otra
        P.handle(d, {"action": "execute", "sym_in": "USDC", "sym_out": "SOL", "amount": 5})
    monkeypatch.setattr(dex, "confirm", lambda sig, wait_s=60: "confirmada")
    r, save = P.handle(d, {"action": "reconcile"})
    assert save and r["pending"] == 0 and d["dex_trades"][0]["status"] == "confirmada"
