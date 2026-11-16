"""PAPER Broker: executes against real price with fee and slippage, without touching money.

`RealBroker` exists only to make the boundary clear: it has no implementation and always refuses.
"""
from __future__ import annotations

FEE = 0.001        # 0.10% per trade (typical spot taker fee)
SLIPPAGE = 0.0005  # 0.05% additional slippage on half-spread


class PaperBroker:
    def __init__(self, state: dict | None = None, cash: float = 10_000.0):
        self.s = state or {"cash": cash, "start": cash, "positions": {}, "trades": [], "peak": cash,
                           "day": None, "day_start_equity": cash, "fees": 0.0}

    def equity(self, prices: dict[str, float]) -> float:
        return self.s["cash"] + sum(p["qty"] * prices.get(sym, p["avg"]) for sym, p in self.s["positions"].items())

    def portfolio(self, prices: dict[str, float], day: str) -> dict:
        eq = self.equity(prices)
        if self.s["day"] != day:
            self.s["day"], self.s["day_start_equity"] = day, eq
        self.s["peak"] = max(self.s["peak"], eq)
        return {"equity": eq, "drawdown": 1 - eq / self.s["peak"], "positions": self.s["positions"],
                "day_pnl_pct": eq / self.s["day_start_equity"] - 1}

    def rebalance(self, sym: str, frac: float, price: float, ts: int, spread_bps: float | None, reason: str) -> dict | None:
        """Moves position of `sym` to `frac` × capital. Shorts permitted only on paper (simulates a perpetual)."""
        eq = self.equity({sym: price})
        pos = self.s["positions"].get(sym, {"qty": 0.0, "avg": price})
        want = frac * eq / price
        dq = want - pos["qty"]
        if abs(dq * price) < max(10.0, 0.002 * eq):  # tiny changes do not offset fee
            return None
        half = (spread_bps or 2.0) / 2e4
        fill = price * (1 + half + SLIPPAGE) if dq > 0 else price * (1 - half - SLIPPAGE)
        fee = abs(dq) * fill * FEE
        self.s["cash"] -= dq * fill + fee
        self.s["fees"] += fee
        new = pos["qty"] + dq
        if abs(new) < 1e-12:
            self.s["positions"].pop(sym, None)
        else:
            if pos["qty"] == 0 or (pos["qty"] > 0) != (new > 0):  # new position or flipped direction
                avg = fill
            elif pos["qty"] * dq > 0:  # expand in same direction: weighted average price
                avg = (pos["avg"] * abs(pos["qty"]) + fill * abs(dq)) / abs(new)
            else:  # reduce: average price does not change
                avg = pos["avg"]
            self.s["positions"][sym] = {"qty": new, "avg": avg}
        t = {"ts": ts, "sym": sym, "side": "buy" if dq > 0 else "sell", "qty": round(abs(dq), 8), "price": round(fill, 4),
             "fee": round(fee, 4), "reason": reason, "paper": True}
        self.s["trades"].append(t)
        self.s["trades"] = self.s["trades"][-500:]
        return t


class RealBroker:
    """Intentionally not implemented. Real money requires: explicit user decision, own configured keys,
    and manual confirmation for each order. This code never sends real orders."""

    def __init__(self, *a, **k):
        raise PermissionError("Real money disabled and locked: Cage operates on paper only.")
