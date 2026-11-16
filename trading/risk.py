"""Policy and risk in code: the model proposes, this decides. No model can bypass these rules.

Fires only if setup_quality >= 2, confidence > 0.80 and risk_state == "safe". Sizing: fractional Kelly
from calibrated probability, capped at 1/4 Kelly and maximum position limit. Limits: 15% drawdown, daily loss,
kill switch checked before EVERY order.
"""
from __future__ import annotations

import math
from dataclasses import asdict, dataclass


@dataclass
class Limits:
    min_quality: int = 2
    min_conf: float = 0.80
    kelly_cap: float = 0.25      # at most 1/4 Kelly
    max_position: float = 0.20   # maximum fraction of capital in one asset
    max_drawdown: float = 0.15
    near_drawdown: float = 0.10
    max_daily_loss: float = 0.03
    max_gross: float = 0.40      # total gross exposure across assets: BTC/ETH/SOL co-move (correlation ~0.8)

    def to_dict(self) -> dict:
        return asdict(self)


def risk_state(pf: dict, lim: Limits) -> str:
    dd, day = pf.get("drawdown", 0.0), pf.get("day_pnl_pct", 0.0)
    if dd >= lim.max_drawdown or day <= -lim.max_daily_loss:
        return "reduce"
    if dd >= lim.near_drawdown or day <= -lim.max_daily_loss / 2:
        return "near_limit"
    return "safe"


def kelly_fraction(p: float, payoff: float = 1.0) -> float:
    """Kelly fraction for binary bet: f = p - (1 - p)/b. Negative -> 0."""
    return max(0.0, p - (1 - p) / payoff)


def target(decision: dict, pf: dict, lim: Limits, kill: bool) -> tuple[float, str]:
    """Target capital fraction in asset (+ long, - short, 0 out) and rationale."""
    if kill:
        return 0.0, "kill switch active: all to cash"
    rs = risk_state(pf, lim)
    if rs == "reduce":
        return 0.0, "risk limit reached: reduce to zero"
    d = decision
    if d["direction"] == "neutral":
        return 0.0, "no clear direction"
    if d["setup_quality"] < lim.min_quality:
        return 0.0, f"quality {d['setup_quality']} < {lim.min_quality}"
    if d["prob"] <= lim.min_conf:
        return 0.0, f"confidence {d['prob']:.2f} <= {lim.min_conf:.2f}"
    if rs != "safe" or d["risk_state"] != "safe":
        return 0.0, "risk near limit: no new positions opened"
    f = min(lim.kelly_cap * kelly_fraction(d["prob"]), lim.max_position)
    return (f if d["direction"] == "long" else -f), f"valid signal: {f:.1%} of capital (¼ Kelly with cap)"


def cap_gross(target: float, already: float, lim: Limits) -> float:
    """Caps a target so total gross exposure (absolute value) does not exceed `max_gross`."""
    room = max(0.0, lim.max_gross - already)
    return math.copysign(min(abs(target), room), target) if target else 0.0
