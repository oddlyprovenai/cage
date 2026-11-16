"""NON-CUSTODIAL ROUTE: spot swaps on Solana via Jupiter, signed with the user's own wallet.

Choice (see docs/DEX.md): Solana (cent network fees) + Jupiter (consolidated, audited aggregator with
the best route between pools). Spot only: USDC ⇄ SOL / cbBTC / wETH. No leverage, perps, bridges or mixers.

Code safeguards (in addition to risk.py and kill switch):
- Allowlist of TOKENS and PROGRAMS: any instruction from an unlisted program → not signed.
- No send function: the only permitted transfer is wrapping SOL to own wSOL account;
  withdrawals can only go to the address the user sets in Cage.
- On Solana there are no ERC-20 "approvals": tokens only leave the account in the signed instruction itself.
- Every transaction is SIMULATED before signing across two different RPCs and the result checked.
- Caps: slippage 0.5%, price impact 0.5%, network fee, and price contrasted with Binance (≤ 1%).
- Maximum capital: lesser of wallet balance and the cap set by the user. Halts if an RPC fails or they disagree.
- Real mode is OFF by default and every order is confirmed by the user with active session (seed is in encrypted
  vault and only read then).
"""
from __future__ import annotations

import base64
import json
import subprocess
import time

from trading import data

RPCS = ["https://api.mainnet-beta.solana.com", "https://solana-rpc.publicnode.com"]
DEVNET = "https://api.devnet.solana.com"
JUP = "https://lite-api.jup.ag/swap/v1"
USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
WSOL = "So11111111111111111111111111111111111111112"
TOKENS = {  # symbol → (mint, decimals, Binance pair to contrast price)
    "USDC": (USDC, 6, None),
    "SOL": (WSOL, 9, "SOLUSDT"),
    "cbBTC": ("cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij", 8, "BTCUSDT"),
    "wETH": ("7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs", 8, "ETHUSDT"),
}
PROGRAMS = {
    "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4": "Jupiter v6",
    "ComputeBudget111111111111111111111111111111": "Compute Budget",
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA": "SPL Token",
    "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb": "SPL Token-2022",
    "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL": "Associated Token Account",
    "11111111111111111111111111111111": "System (wrap own SOL only)",
}
MAX_SLIPPAGE_BPS = 50
MAX_IMPACT = 0.005
MAX_PRICE_GAP = 0.01
MAX_PRIORITY_LAMPORTS = 200_000  # ≈ 0.0002 SOL max validator tip
MAX_SOL_FEE = 0.01               # max total transaction fee (SOL)


class Stop(Exception):
    """Something does not match: nothing is signed."""


def _post(url: str, body: dict, timeout: int = 20) -> dict:
    out = subprocess.run(["curl", "-sS", "--fail", "--max-time", str(timeout), "-A", data.UA, "-H", "Content-Type: application/json",
                          "-d", json.dumps(body), url], capture_output=True, timeout=timeout + 5, check=False)
    if out.returncode:
        raise Stop(f"no response from {url.split('/')[2]}")
    return json.loads(out.stdout)


def rpc(method: str, params: list, url: str | None = None) -> dict:
    r = _post(url or RPCS[0], {"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
    if "error" in r:
        raise Stop(f"RPC {method}: {str(r['error'])[:120]}")
    return r["result"]


def rpc_both(method: str, params: list) -> list:
    """The same query to two independent RPCs; if either fails, halt."""
    return [rpc(method, params, u) for u in RPCS]


def ata(owner: str, mint: str, token_program: str = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") -> str:
    from solders.pubkey import Pubkey
    pda, _ = Pubkey.find_program_address([bytes(Pubkey.from_string(owner)), bytes(Pubkey.from_string(token_program)),
                                          bytes(Pubkey.from_string(mint))], Pubkey.from_string("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"))
    return str(pda)


# ---------------------------------------------------------------- quotation and construction
def quote(sym_in: str, sym_out: str, amount_ui: float) -> dict:
    if sym_in not in TOKENS or sym_out not in TOKENS or "USDC" not in (sym_in, sym_out) or sym_in == sym_out:
        raise Stop("only USDC ⇄ SOL/cbBTC/wETH (allowlist)")
    mi, di, _ = TOKENS[sym_in]
    mo, _, _ = TOKENS[sym_out]
    raw = int(amount_ui * 10 ** di)
    q = data.get_json(f"{JUP}/quote?inputMint={mi}&outputMint={mo}&amount={raw}&slippageBps={MAX_SLIPPAGE_BPS}&restrictIntermediateTokens=true")
    if "outAmount" not in q:
        raise Stop(f"Jupiter did not quote: {str(q)[:120]}")
    return q


def check_quote(q: dict, sym_in: str, sym_out: str, ref_price: float | None = None) -> dict:
    """Impact, slippage and price against Binance as second source."""
    if int(q.get("slippageBps", 9999)) > MAX_SLIPPAGE_BPS:
        raise Stop("slippage above cap")
    if float(q.get("priceImpactPct") or 0) > MAX_IMPACT:
        raise Stop(f"price impact {100 * float(q['priceImpactPct']):.2f}% > 0.5%")
    asset = sym_out if sym_in == "USDC" else sym_in
    _, dec, pair = TOKENS[asset]
    ref = ref_price or float(data.get_json(f"{data.BINANCE}/ticker/price?symbol={pair}")["price"])
    if sym_in == "USDC":
        px = (int(q["inAmount"]) / 1e6) / (int(q["outAmount"]) / 10 ** dec)
    else:
        px = (int(q["outAmount"]) / 1e6) / (int(q["inAmount"]) / 10 ** dec)
    gap = abs(px / ref - 1)
    if gap > MAX_PRICE_GAP:
        raise Stop(f"Jupiter price ({px:.4f}) differs {100 * gap:.2f}% from Binance ({ref:.4f})")
    return {"price": px, "ref": ref, "gap": gap}


def build(q: dict, owner: str) -> str:
    body = {"quoteResponse": q, "userPublicKey": owner, "wrapAndUnwrapSol": True, "dynamicComputeUnitLimit": True,
            "prioritizationFeeLamports": {"priorityLevelWithMaxLamports": {"maxLamports": MAX_PRIORITY_LAMPORTS, "priorityLevel": "medium"}}}
    r = _post(f"{JUP}/swap", body, 30)
    if "swapTransaction" not in r:
        raise Stop(f"Jupiter did not build transaction: {str(r)[:120]}")
    return r["swapTransaction"]


def inspect(tx_b64: str, owner: str) -> dict:
    """Allowlist of programs and no transfers to third parties. Does not sign anything."""
    from solders.transaction import VersionedTransaction
    tx = VersionedTransaction.from_bytes(base64.b64decode(tx_b64))
    msg = tx.message
    keys = [str(k) for k in msg.account_keys]
    if keys[0] != owner:
        raise Stop("transaction payer is not your wallet")
    used = []
    wsol = ata(owner, WSOL)
    for ix in msg.instructions:
        prog = keys[ix.program_id_index]
        if prog not in PROGRAMS:
            raise Stop(f"program not allowed: {prog}")
        used.append(PROGRAMS[prog])
        raw = bytes(ix.data)
        if prog == "11111111111111111111111111111111":
            kind = int.from_bytes(raw[:4], "little") if len(raw) >= 4 else -1
            if kind != 2:
                raise Stop("system instruction not allowed")
            dest = keys[ix.accounts[1]] if len(ix.accounts) > 1 and ix.accounts[1] < len(keys) else None
            if dest != wsol:  # only wrap SOL to YOUR wSOL account
                raise Stop("transfer to an account that is not yours: blocked")
    return {"programs": sorted(set(used)), "n_instructions": len(msg.instructions)}


def simulate(tx_b64: str) -> dict:
    """Simulation on TWO RPCs (unsigned: sigVerify false). If they fail or disagree, do not sign."""
    cfg = {"encoding": "base64", "sigVerify": False, "replaceRecentBlockhash": True, "commitment": "processed"}
    res = rpc_both("simulateTransaction", [tx_b64, cfg])
    errs = [r["value"].get("err") for r in res]
    if any(errs):
        if "AccountNotFound" in str(errs) or "InsufficientFunds" in str(errs):
            raise Stop("wallet has insufficient funds for this operation (requires input token and some SOL for network fees)")
        raise Stop(f"simulation failed: {str(errs)[:160]}")
    units = [r["value"].get("unitsConsumed") for r in res]
    return {"ok": True, "units": units, "logs": (res[0]["value"].get("logs") or [])[-3:]}


def fee_sol(tx_b64: str) -> float:
    from solders.message import to_bytes_versioned
    from solders.transaction import VersionedTransaction
    msg = VersionedTransaction.from_bytes(base64.b64decode(tx_b64)).message
    r = rpc("getFeeForMessage", [base64.b64encode(to_bytes_versioned(msg)).decode(), {"commitment": "processed"}])
    base = (r.get("value") or 5000) / 1e9
    return base + MAX_PRIORITY_LAMPORTS / 1e9


def prepare(sym_in: str, sym_out: str, amount_ui: float, owner: str, ref_price: float | None = None) -> dict:
    """Everything except signing: quote, contrast, build, inspect, simulate and estimate network fee."""
    q = quote(sym_in, sym_out, amount_ui)
    chk = check_quote(q, sym_in, sym_out, ref_price)
    tx = build(q, owner)
    ins = inspect(tx, owner)
    sim = simulate(tx)
    fee = fee_sol(tx)
    if fee > MAX_SOL_FEE:
        raise Stop(f"network fee {fee:.5f} SOL above cap")
    return {"tx": tx, "quote": {k: q[k] for k in ("inAmount", "outAmount", "otherAmountThreshold", "priceImpactPct", "slippageBps")},
            "check": chk, "inspect": ins, "simulation": sim, "fee_sol": fee, "route": [r["swapInfo"]["label"] for r in q["routePlan"]]}


def submit(tx_b64: str, kp) -> str:
    """Signs with wallet keypair (in memory, only with user session) and sends to the network.
    Returns the signature IMMEDIATELY, so it is recorded before waiting for confirmation."""
    from solders.transaction import VersionedTransaction
    tx = VersionedTransaction.from_bytes(base64.b64decode(tx_b64))
    if str(tx.message.account_keys[0]) != str(kp.pubkey()):
        raise Stop("transaction is not from this wallet")
    signed = VersionedTransaction(tx.message, [kp])
    raw = base64.b64encode(bytes(signed)).decode()
    return rpc("sendTransaction", [raw, {"encoding": "base64", "skipPreflight": False, "maxRetries": 3}])


def confirm(sig: str, wait_s: int = 60) -> str:
    """'confirmada' | 'pendiente' (no response yet: do NOT retry; reconciled later). Raises Stop if failed on-chain."""
    for _ in range(max(1, wait_s // 2)):
        st = rpc("getSignatureStatuses", [[sig], {"searchTransactionHistory": True}])["value"][0]
        if st and st.get("confirmationStatus") in ("confirmed", "finalized"):
            if st.get("err"):
                raise Stop(f"transaction failed on-chain: {st['err']}")
            return "confirmada"
        time.sleep(2)
    return "pendiente"


def sign_and_send(tx_b64: str, kp) -> str:
    sig = submit(tx_b64, kp)
    if confirm(sig) != "confirmada":
        raise Stop("no confirmation within 60 s: check explorer before retrying")
    return sig


def balances(owner: str) -> dict:
    """Wallet balances (SOL + allowlist tokens), contrasted across two RPCs."""
    a, b = rpc_both("getBalance", [owner])
    if a["value"] != b["value"]:
        raise Stop("RPCs disagree on balance")
    out = {"SOL": a["value"] / 1e9}
    for sym, (mint, dec, _) in TOKENS.items():
        if sym == "SOL":
            continue
        r = rpc("getTokenAccountsByOwner", [owner, {"mint": mint}, {"encoding": "jsonParsed"}])
        out[sym] = sum(float(x["account"]["data"]["parsed"]["info"]["tokenAmount"]["uiAmount"] or 0) for x in r["value"])
    return out
