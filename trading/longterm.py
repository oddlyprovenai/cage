"""Long-term investing (stocks/ETFs and crypto): simple and auditable strategies, honest backtest and paper
portfolios. Parameters are standard literature choices (12-1 momentum, 200-day moving average, 5-point bands),
fixed BEFORE looking at results: the entire backtest is out-of-sample with respect to parameter choice. If a
strategy does not beat its index after estimated costs and taxes, the default choice is the indexed one.

Costs: 0.10% commission + 0.05% slippage per trade (0.10% + 0.10% in crypto). Taxes: 21% estimate
on realized capital gains (Spain savings average bracket), always marked as an ESTIMATE.
"""
from __future__ import annotations

import math

PROFILES = {"conservador": {"rv": 0.30, "rf": 0.60, "liq": 0.10, "crypto": 0.00},
            "moderado": {"rv": 0.60, "rf": 0.35, "liq": 0.05, "crypto": 0.05},
            "dinamico": {"rv": 0.85, "rf": 0.10, "liq": 0.05, "crypto": 0.10}}
COST = {"etf": 0.0015, "crypto": 0.0020}
MIN_EDGE, MIN_EDGE_BIASED = 0.01, 0.03
BIASED = {"core_sat", "trend"}  # universes chosen today (surviving companies and cryptos)
TAX = 0.21  # indicative average rate (for quick net value estimates only)
# Spanish savings tax base brackets (state + regional, 2025): ESTIMATE, not tax advice.
BRACKETS = [(6_000, 0.19), (50_000, 0.21), (200_000, 0.23), (300_000, 0.27), (float("inf"), 0.30)]


def spanish_tax(gain: float) -> float:
    """Tax on positive annual net capital gain, by brackets."""
    tax, prev = 0.0, 0.0
    for top, rate in BRACKETS:
        if gain <= prev:
            break
        tax += (min(gain, top) - prev) * rate
        prev = top
    return tax


def settle_year(state: dict, year: str) -> float:
    """Settles the year: gains and losses offset; net losses carry forward 4 years."""
    net = state.get("realized", {}).pop(year, 0.0)
    carry = [c for c in state.get("carry", []) if int(year) - int(c[0]) <= 4]
    while net > 0 and carry:  # offset against previous years' losses
        y, loss = carry.pop(0)
        use = min(net, loss)
        net -= use
        if loss - use > 0:
            carry.insert(0, [y, loss - use])
    if net < 0:
        carry.append([year, -net])
        net = 0.0
    state["carry"] = carry
    tax = spanish_tax(net)
    state["taxes"] = state.get("taxes", 0.0) + tax
    state["cash"] -= tax
    return tax
BAND = 0.05
MAX_SAT = 0.08      # máximo por empresa satélite (concentración)
MAX_CRYPTO = 0.70   # máximo por cripto dentro de su cartera


def sma(col: list, i: int, n: int) -> float | None:
    vals = [v for v in col[max(0, i - n + 1): i + 1] if v]
    return sum(vals) / len(vals) if len(vals) == n else None


def momentum(col: list, i: int, look: int = 252, skip: int = 21) -> float | None:
    a, b = (col[i - look] if i >= look else None), (col[i - skip] if i >= skip else None)
    return b / a - 1 if a and b else None


# ---------------------------------------------------------------- estrategias: devuelven pesos objetivo (suman ≤ 1)
def w_index(px, i, prof):
    return {"IWDA.AS": 1.0}


def w_indexed(px, i, prof):
    p = PROFILES[prof]
    rv = p["rv"] / (1 - p["crypto"]) if p["crypto"] < 1 else p["rv"]
    tot = p["rv"] + p["rf"] + p["liq"]
    w = {"IWDA.AS": 0.85 * p["rv"] / tot, "EMIM.AS": 0.15 * p["rv"] / tot, "IEAG.AS": p["rf"] / tot, "XEON.DE": p["liq"] / tot}
    del rv
    return {k: v for k, v in w.items() if px[k][i]}


def w_core_satellite(px, i, prof, sats=("AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "ASML.AS", "SAP.DE", "NOVO-B.CO", "MC.PA", "BRK-B", "JNJ"), k=4):
    core = {s: 0.7 * w for s, w in w_indexed(px, i, prof).items()}
    cand = []
    for s in sats:
        m, ma = momentum(px[s], i), sma(px[s], i, 200)
        if m is not None and ma and px[s][i] > ma and m > 0:
            cand.append((m, s))
    pick = [s for _, s in sorted(cand, reverse=True)[:k]]
    each = min(MAX_SAT, 0.30 / k)
    w = dict(core)
    for s in pick:
        w[s] = each
    left = 1 - sum(w.values())  # lo que no se asigna a satélites vuelve al núcleo
    for s in core:
        w[s] += left * core[s] / 0.7
    return {k2: v for k2, v in w.items() if v > 1e-9}


CRYPTO_W = {"BTCUSDT": 0.6, "ETHUSDT": 0.3, "SOLUSDT": 0.1}


def w_btc(px, i, prof):
    return {"BTCUSDT": 1.0}


def w_crypto_core(px, i, prof):
    w = {s: v for s, v in CRYPTO_W.items() if px[s][i]}
    t = sum(w.values())
    return {s: min(MAX_CRYPTO, v / t) for s, v in w.items()}


def w_crypto_trend(px, i, prof):
    """Same as core, but each crypto only if above its 200-day moving average; otherwise cash."""
    out = {}
    for s, v in w_crypto_core(px, i, prof).items():
        ma = sma(px[s], i, 200)
        if ma and px[s][i] > ma:
            out[s] = v
    return out


STRATS = {"etf": {"index": ("MSCI World Index (buy & hold)", w_index),
                  "indexed": ("Indexed by profile (ETF core)", w_indexed),
                  "core_sat": ("ETF core + 30% momentum satellites", w_core_satellite)},
          "crypto": {"index": ("Bitcoin (buy & hold)", w_btc),
                     "indexed": ("BTC/ETH/SOL 60/30/10 basket", w_crypto_core),
                     "trend": ("Trend-filtered basket (200 days)", w_crypto_trend)}}


# ---------------------------------------------------------------- portfolio (paper and backtest share the same engine)
class Book:
    def __init__(self, cash=0.0, state=None, kind="etf"):
        self.s = state or {"cash": cash, "pos": {}, "contributed": cash, "fees": 0.0, "taxes": 0.0, "log": []}
        self.cost = COST[kind]

    def value(self, prices):
        return self.s["cash"] + sum(p["qty"] * (prices.get(s) or p["avg"]) for s, p in self.s["pos"].items())

    def weights(self, prices):
        v = self.value(prices) or 1
        return {s: p["qty"] * (prices.get(s) or p["avg"]) / v for s, p in self.s["pos"].items()}

    def contribute(self, amount):
        self.s["cash"] += amount
        self.s["contributed"] += amount

    def trade(self, sym, qty, price, day, reason):
        pos = self.s["pos"].get(sym, {"qty": 0.0, "avg": price})
        fee = abs(qty) * price * self.cost
        if qty > 0:
            pos["avg"] = (pos["avg"] * pos["qty"] + price * qty) / (pos["qty"] + qty)
        else:
            gain = (price - pos["avg"]) * (-qty)  # accumulated per year and settled at year end (brackets)
            y = str(day)[:4]
            self.s.setdefault("realized", {})[y] = self.s.get("realized", {}).get(y, 0.0) + gain
        pos["qty"] += qty
        self.s["cash"] -= qty * price + fee
        self.s["fees"] += fee
        if pos["qty"] <= 1e-12:
            self.s["pos"].pop(sym, None)
        else:
            self.s["pos"][sym] = pos
        self.s["log"].append({"day": day, "sym": sym, "side": "compra" if qty > 0 else "venta", "qty": round(abs(qty), 8),
                              "price": round(price, 4), "reason": reason})
        self.s["log"] = self.s["log"][-400:]

    def rebalance(self, target, prices, day, reason, only_buy=False):
        v = self.value(prices)
        cur = self.weights(prices)
        orders = []
        for s in set(cur) | set(target):
            if not prices.get(s):
                continue
            d = (target.get(s, 0) - cur.get(s, 0)) * v / prices[s]
            if abs(d * prices[s]) < max(5.0, 0.001 * v) or (only_buy and d < 0):
                continue
            orders.append((d, s))
        for d, s in sorted(orders):  # first sales (free up cash), then purchases
            if d > 0:
                d = min(d, max(0.0, self.s["cash"]) / (prices[s] * (1 + self.cost)))
            if abs(d) > 1e-12:
                self.trade(s, d, prices[s], day, reason)
        return orders


def run(days, px, strat, prof="moderado", kind="etf", start=10_000.0, monthly=300.0, start_i=260):
    """Daily backtest: contribution on the first day of each month + monthly band rebalance.
    Time-weighted rate of return (TWR), which is not distorted by cash inflows."""
    b = Book(start, kind=kind)
    idx, prev_v, month = [1.0], None, None
    for i in range(start_i, len(days)):
        prices = {s: px[s][i] for s in px if px[s][i]}
        flow = 0.0
        if days[i][:7] != month:
            month = days[i][:7]
            if prev_v is not None:
                b.contribute(monthly)
                flow = monthly
            tgt = strat(px, i - 1, prof)  # signal with YESTERDAY close, execution at TODAY price (no lookahead)
            cur = b.weights(prices)
            if prev_v is None or any(abs(tgt.get(s, 0) - cur.get(s, 0)) > BAND for s in set(tgt) | set(cur)):
                b.rebalance(tgt, prices, days[i], "band rebalancing")
            else:
                b.rebalance(tgt, prices, days[i], "monthly contribution", only_buy=True)
        if i > start_i and days[i][:4] != days[i - 1][:4]:  # year change: taxes for previous year
            settle_year(b.s, days[i - 1][:4])
        v = b.value(prices)
        if prev_v:
            idx.append(idx[-1] * (v - flow) / prev_v)
        prev_v = v
    settle_year(b.s, days[-1][:4])  # current year, as if declared today (estimate)
    return b, idx


def metrics(idx, yrs, per_year=252):
    """`yrs`: calendar years between first and last date."""
    r = [b / a - 1 for a, b in zip(idx, idx[1:]) if a > 0]
    mu = sum(r) / len(r) if r else 0
    sd = math.sqrt(sum((x - mu) ** 2 for x in r) / max(1, len(r) - 1)) if r else 0
    peak, dd = 1.0, 0.0
    for v in idx:
        peak = max(peak, v)
        dd = max(dd, 1 - v / peak)
    return {"cagr": idx[-1] ** (1 / yrs) - 1 if yrs > 0 else 0, "vol": sd * math.sqrt(per_year), "max_dd": dd,
            "sharpe": (mu / sd * math.sqrt(per_year)) if sd else 0.0, "total": idx[-1] - 1}


def evaluate(days, px, kind, prof="moderado", monthly=300.0):
    per = 365 if kind == "crypto" else 252
    start_i = next(i for i, d in enumerate(days) if d >= ("2021-01-01" if kind == "crypto" else "2018-01-01"))
    import datetime as _dt
    span = (_dt.date.fromisoformat(days[-1]) - _dt.date.fromisoformat(days[start_i])).days / 365.25
    per = round((len(days) - start_i) / span) if span else per  # actual trading sessions per year to annualize volatility
    res = {}
    for key, (label, fn) in STRATS[kind].items():
        b, idx = run(days, px, fn, prof, kind, monthly=monthly, start_i=start_i)
        prices = {s: px[s][-1] for s in px if px[s][-1]}
        m = metrics(idx, span, per)
        res[key] = {"label": label, **m, "final": b.value(prices), "contributed": b.s["contributed"], "fees": b.s["fees"],
                    "taxes_est": b.s["taxes"], "trades": len(b.s["log"]), "curve": idx[:: max(1, len(idx) // 200)]}
    bench = res["index"]
    for key, r in res.items():
        r["vs_index"] = r["cagr"] - bench["cagr"]
    best = max((k for k in res if k != "index"), key=lambda k: res[k]["cagr"])
    alt = next(k for k in res if k not in ("index", "indexed"))
    # active only wins if it beats benchmark AND indexed after costs and taxes, by a margin that is
    # not noise (1 pt per year; 3 if universe has survivorship bias), without deepening drawdown (≤ +5 pts drawdown)
    margin = MIN_EDGE_BIASED if alt in BIASED else MIN_EDGE
    beats = (res[alt]["cagr"] > bench["cagr"] + margin and res[alt]["cagr"] > res["indexed"]["cagr"] + margin
             and res[alt]["max_dd"] <= res["indexed"]["max_dd"] + 0.05)
    for k in res:
        res[k]["biased"] = k in BIASED
    return {"kind": kind, "profile": prof, "from": days[start_i], "to": days[-1], "monthly": monthly, "strategies": res,
            "default": alt if beats else "indexed", "best_cagr": best,
            "note": ("Standard parameters fixed in advance; previous day signal executed next day; costs included; "
                     "Spanish savings taxes by brackets with loss carryforward as an ESTIMATE."),
            "bias": ("Survivorship bias: companies and cryptos in the universe were chosen TODAY among those that survived "
                     "and grew; results of satellite or basket strategies are likely OPTIMISTIC. The index does not have this bias.")}


# ---------------------------------------------------------------- planning: frontier, stress and Monte Carlo
def monthly_returns(days, px, weights: dict) -> list[float]:
    """Monthly returns of a fixed-weight portfolio rebalanced monthly (no costs: for planning)."""
    ends = [i for i in range(1, len(days)) if days[i][:7] != days[i - 1][:7]] + [len(days) - 1]
    out, prev = [], None
    for i in ends:
        if prev is not None:
            r = 0.0
            tot = 0.0
            for s, w in weights.items():
                a, b = px[s][prev], px[s][i]
                if a and b:
                    r += w * (b / a - 1)
                    tot += w
            if tot > 0.5:
                out.append(r / tot)
        prev = i
    return out


def frontier(days, px) -> list[dict]:
    """Historical annualized return and volatility of MSCI World / euro bond mixes, from 0% to 100% in equities."""
    pts = []
    for eq in range(0, 101, 10):
        m = monthly_returns(days, px, {"IWDA.AS": eq / 100, "IEAG.AS": 1 - eq / 100} if eq < 100 else {"IWDA.AS": 1.0})
        if len(m) < 24:
            continue
        mu = sum(m) / len(m)
        sd = math.sqrt(sum((x - mu) ** 2 for x in m) / (len(m) - 1))
        growth = math.prod(1 + x for x in m) ** (12 / len(m)) - 1
        pts.append({"equity": eq, "ret": growth, "vol": sd * math.sqrt(12)})
    return pts


def worst_drawdowns(days, px, weights: dict, n: int = 3) -> list[dict]:
    """The n worst real drawdowns (peak to trough) of profile portfolio, with dates."""
    m = monthly_returns(days, px, weights)
    ends = [days[i] for i in range(1, len(days)) if days[i][:7] != days[i - 1][:7]] + [days[-1]]
    eq, peak, peak_i, out, cur = [1.0], 1.0, 0, [], None
    for r in m:
        eq.append(eq[-1] * (1 + r))
    for i, v in enumerate(eq):
        if v >= peak:
            if cur:
                out.append(cur)
                cur = None
            peak, peak_i = v, i
        else:
            dd = 1 - v / peak
            if not cur or dd > cur["dd"]:
                cur = {"dd": dd, "from": ends[peak_i][:7], "to": ends[min(i, len(ends) - 1)][:7]}
    if cur:
        out.append(cur)
    return sorted(out, key=lambda x: -x["dd"])[:n]


def monte_carlo(m: list[float], years: int, start: float, monthly: float, paths: int = 2000, block: int = 12,
                inflation: float = 0.02, seed: int = 7) -> dict:
    """Block bootstrap (12 months) of REAL monthly returns of profile portfolio. Returns a range
    (10/50/90 percentiles), not a single figure. 21% tax on gain at end as an ESTIMATE."""
    import random
    rnd = random.Random(seed)
    n, finals = years * 12, []
    if len(m) < block:
        return {}
    for _ in range(paths):
        v, k = start, 0
        while k < n:
            j = rnd.randrange(0, len(m) - block + 1)
            for r in m[j: j + block]:
                if k >= n:
                    break
                v = v * (1 + r) + monthly
                k += 1
        finals.append(v)
    finals.sort()
    contributed = start + monthly * n
    q = lambda p: finals[int(p * (len(finals) - 1))]  # noqa: E731
    after_tax = lambda v: v - max(0.0, v - contributed) * TAX  # noqa: E731
    real = (1 + inflation) ** years
    return {"years": years, "contributed": contributed, "p10": q(0.10), "p50": q(0.50), "p90": q(0.90),
            "p10_net": after_tax(q(0.10)), "p50_net": after_tax(q(0.50)), "p90_net": after_tax(q(0.90)),
            "p50_real": after_tax(q(0.50)) / real, "prob_loss": sum(1 for f in finals if f < contributed) / len(finals),
            "paths": paths, "months_of_history": len(m), "note": "Bootstrap of real months; 21% tax and 2% inflation as estimates."}
