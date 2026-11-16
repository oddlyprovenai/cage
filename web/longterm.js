/* Cage · Investor Agent: unified 24/7 portfolio (trading + long-term crypto + stocks/ETFs) and strategies
   measured against their benchmark. All in paper; "real" orders are proposals executed by you. */
(() => {
"use strict";
const M = window.Cage;
const { st, $, $$, esc, I, TABS, VIEWS, BIND, HOOKS, toast, render, empty, line, donut } = M;
const P = M.tradingParts;
const eur = (v, d = 0) => v === null || v === undefined ? "—" : new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: d, minimumFractionDigits: d }).format(v);
const pc = (v, d = 1) => v === null || v === undefined || !isFinite(v) ? "—" : (100 * v).toFixed(d).replace(".", ",") + " %";
const NAME = { "IWDA.AS": "MSCI World", "EMIM.AS": "Emerging Markets", "IEAG.AS": "Euro Bonds", "XEON.DE": "Liquidity", "4GLD.DE": "Gold", BTCUSDT: "Bitcoin", ETHUSDT: "Ethereum", SOLUSDT: "Solana", AAPL: "Apple", MSFT: "Microsoft", NVDA: "NVIDIA", AMZN: "Amazon", GOOGL: "Alphabet", META: "Meta", "ASML.AS": "ASML", "SAP.DE": "SAP", "NOVO-B.CO": "Novo Nordisk", "MC.PA": "LVMH", "BRK-B": "Berkshire", JNJ: "J&J" };
const COLORS = ["#F0592A", "#3E5BDB", "#1E9E5A", "#E0A33A", "#8E5BD9", "#26A6B5", "#D94F8C", "#6B6F78"];
const KIND = { etf: "Stocks & ETFs", crypto: "Long-term crypto" };

// Cage passes to agent (without password) only the profile and contribution from Investment tab
const after = HOOKS.afterLoad;
HOOKS.afterLoad = () => {
  after();
  const ip = st.data.invest_profile || {};
  M.api("/api/trading/control", { body: { action: "lt_config", risk: ip.risk || "moderado", monthly: ip.monthly_contribution ?? null } }).catch(() => {});
};

function cartera(t) {
  const lt = t.longterm || {}, S = lt.sleeves || {}, cfg = lt.config || {};
  const tradeEq = t.portfolio?.equity ?? t.paper?.start ?? 10000, fx = lt.eurusd;
  const parts = [["Trading (paper)", fx ? tradeEq / fx.rate : null, null], ...Object.entries(S).filter(([, s]) => !s.disabled).map(([k, s]) => [KIND[k], s.value, s.book?.contributed])];
  const total = parts.reduce((a, p) => a + (p[1] || 0), 0);
  if (!Object.keys(S).length) return empty("The long-term portfolio is created at the next daily update", "The 24/7 agent updates it once a day with live prices.");
  const pLt = M.prov({ src: "Yahoo Finance + Binance (paper)", ts: fx?.date || (t.ts ? t.ts * 1000 : st.data?.updated), kind: "paper" });
  return `<div class="grid g-ov stagger">
    <div class="card span2"><div class="lbl">Total paper value ${pLt}</div><div class="big num">${eur(total)}</div><p class="small muted">${fx ? `Trading in USD converted at EURUSD ${fx.rate.toFixed(4).replace(".", ",")} from ${esc(fx.date)} (Yahoo Finance)` : "No exchange rate: trading not included"}</p></div>
    <div class="card span4"><h3>Allocation ${pLt}</h3><div class="row wrap">${parts.map(([l, v, c], i) => `<div class="part"><span class="flag" data-c="${COLORS[i]}"></span><b>${esc(l)}</b><span class="num">${eur(v)}</span><small class="muted">${c ? "contributed " + eur(c) : ""}</small></div>`).join("")}</div>
      <p class="small muted">Profile <b>${esc(cfg.risk || "moderado")}</b> · contribution ${eur(cfg.monthly)}/month (${pc(cfg.crypto_share, 0)} to crypto)${cfg.defaults ? " · default values: change in Investments → Plan" : ""}</p></div>
    ${Object.entries(S).map(([k, s]) => s.disabled ? `<div class="card span3" data-noprov="desactivado"><h3>${KIND[k]}</h3>${empty("Without this sleeve", esc(s.disabled))}</div>` : sleeveCard(k, s, lt.eval?.[k])).join("")}
  </div>`;
}
function newsFor(sym) {
  const it = (st.trading?.news?.items || []).filter(n => n.assets.includes(sym) && Date.now() / 1000 - n.published < 7 * 86400);
  return it.length ? ` <a class="badge ${it.some(n => n.grave) ? "" : "m"} nlink" href="${esc(it[0].link)}" target="_blank" rel="noopener noreferrer" title="${esc(it[0].title)}">${it.length} news item${it.length > 1 ? "s" : ""}</a>` : "";
}
function sleeveCard(k, s, ev) {
  const keys = [...new Set([...Object.keys(s.target || {}), ...Object.keys(s.weights || {})])].sort((a, b) => (s.target[b] || 0) - (s.target[a] || 0));
  const H = s.history || [], strat = ev?.strategies?.[s.strategy];
  const log = (s.book?.log || []).slice().reverse().slice(0, 8);
  return `<div class="card span3"><h3>${KIND[k]} <span class="badge m">${esc(strat?.label || s.strategy)}</span> ${M.prov({ src: k === "etf" ? "Yahoo Finance (paper)" : "Binance (paper)", ts: H.at(-1)?.[0] || st.data?.updated, kind: "paper" })}</h3>
    <div class="row between"><div><div class="mid num">${eur(s.value)}</div><small class="muted">contributed ${eur(s.book?.contributed)} · fees ${eur(s.book?.fees, 2)} · est. taxes ${eur(s.book?.taxes, 2)}</small></div></div>
    <div class="lbl">Current vs target allocation</div>
    ${keys.map(x => `<div class="mac"><div class="row between"><span>${esc(NAME[x] || x)}${newsFor(x)}</span><b class="num">${pc(s.weights[x] || 0, 1)} <small class="muted">/ ${pc(s.target[x] || 0, 1)}</small></b></div><div class="meter"><i data-w="${Math.min(100, 100 * (s.weights[x] || 0))}%" data-c="${Math.abs((s.weights[x] || 0) - (s.target[x] || 0)) > 0.05 ? "var(--neg)" : "var(--acc)"}"></i></div></div>`).join("")}
    ${H.length >= 2 ? line(H.map(h => h[0].slice(5)), [{ name: "Value", color: "var(--acc)", values: H.map(h => h[1]), area: true }, { name: "Contributed", color: "var(--blue)", values: H.map(h => h[2]) }], { h: 150, fmt: v => eur(v), min: "auto", smooth: false }) : `<p class="small muted">The curve grows each day.</p>`}
    <div class="lbl">Upcoming actions (proposals for real money)</div>
    <div class="list">${(s.proposals || []).slice(0, 6).map(o => `<div class="li"><span class="lic">${o.side === "compra" ? I.up : I.down}</span><div class="t"><b>${o.side === "compra" ? "Buy" : "Sell"} ${esc(NAME[o.sym] || o.sym)}</b><small>${o.qty} at ~${eur(o.price, 2)} · ${esc(o.reason)}</small></div></div>`).join("") || `<p class="small muted">Nothing pending: reviewed daily and monthly with your contribution.</p>`}</div>
    <div class="lbl">Decision log</div>
    <div class="list scroll-s">${log.map(o => `<div class="li"><div class="t"><small>${esc(o.day)} · ${o.side === "compra" ? "Buy" : "Sell"} ${esc(NAME[o.sym] || o.sym)} ${o.qty} at ${eur(o.price, 2)} — ${esc(o.reason)}</small></div></div>`).join("") || ""}</div></div>`;
}

function estrategias(t) {
  const E = t.longterm?.eval || {};
  if (!Object.keys(E).length) return empty("No evaluation yet", "Calculated on next daily update of agent.");
  return `<div class="grid g-ov stagger">
    <div class="card span6 honest" data-noprov="explicación"><h3>How to read this</h3><p>Backtest using real historical data, contributing monthly as you would, with fees, slippage, and estimated 21% tax on realized gains. Standard parameters fixed before evaluating results. <b>Time-weighted return</b>: not inflated by contributions. <b>Past performance is no guarantee of future results; you can lose money.</b> Not regulated financial advice.</p></div>
    ${Object.entries(E).map(([k, ev]) => `<div class="card span6"><h3>${KIND[k]} <span class="badge m">${esc(ev.from)} → ${esc(ev.to)} · profile ${esc(ev.profile)}</span> ${M.prov({ src: Object.values(ev.sources || {})[0] || "Local backtest", ts: ev.to || st.data?.updated, kind: "calc" })}</h3>
      <div class="scroll"><table class="tbl"><thead><tr><th>Strategy</th><th class="r">Annual ret.</th><th class="r">Volatility</th><th class="r">Max drawdown</th><th class="r">Sharpe</th><th class="r">vs index</th><th class="r">Final / contributed</th><th class="r">Fees</th><th class="r">Taxes (est.)</th><th></th></tr></thead><tbody>
      ${Object.entries(ev.strategies).map(([key, r]) => `<tr><td><b>${esc(r.label)}</b></td><td class="r num">${pc(r.cagr)}</td><td class="r num">${pc(r.vol)}</td><td class="r num">${pc(r.max_dd)}</td><td class="r num">${r.sharpe.toFixed(2).replace(".", ",")}</td><td class="r num ${key === "index" ? "" : r.vs_index >= 0 ? "pos" : "neg"}">${key === "index" ? "benchmark" : (r.vs_index >= 0 ? "+" : "") + pc(r.vs_index)}</td><td class="r num">${eur(r.final)} / ${eur(r.contributed)}</td><td class="r num">${eur(r.fees)}</td><td class="r num">${eur(r.taxes_est)}</td><td>${key === ev.default ? '<span class="badge g">used</span>' : ""}</td></tr>`).join("")}</tbody></table></div>
      ${ev.bias ? `<p class="small neg">${esc(ev.bias)}</p>` : ""}${ev.anomalies && Object.keys(ev.anomalies).length ? `<p class="small neg">Data anomalies: ${Object.entries(ev.anomalies).map(([k, v]) => esc(k + ": " + v.join(", "))).join(" · ")}</p>` : ""}
      <p class="small">${ev.default === "indexed" ? `The active strategy <b>does not beat</b> the index and the indexed strategy with sufficient margin (1% per year; 3% with survivorship bias) after costs and taxes: the agent uses the <b>indexed</b> strategy.` : `The active strategy beats the index and the indexed strategy in this period; nevertheless it may not repeat.`}</p>
      ${line(ev.strategies.index.curve.map((_, i) => ""), Object.entries(ev.strategies).map(([key, r], i) => ({ name: r.label, color: [ "var(--blue)", "var(--acc)", "var(--pos)"][i], values: r.curve.map(v => +(100 * v).toFixed(1)) })), { h: 200, fmt: v => v + " (base 100)", smooth: false })}
      <p class="small muted">Sources: ${Object.values(ev.sources || {}).slice(0, 3).map(esc).join(" · ")}…</p></div>`).join("")}
  </div>`;
}

// insert sections into agent tab
const base = VIEWS.trading;
VIEWS.trading = () => {
  const tab = st.trTab || "cartera", t = st.trading;
  const extra = { cartera: "24/7 Portfolio", estrategias: "Strategies" };
  if (extra[tab]) st.trTab = "resumen";
  let html = base();
  st.trTab = tab;
  if (extra[tab]) html = html.replace('data-tt="resumen" class="on"', 'data-tt="resumen" class=""');
  html = html.replace('<div class="seg" id="trTabs">', `<div class="seg" id="trTabs">${Object.entries(extra).map(([k, l]) => `<button data-tt="${k}" class="${tab === k ? "on" : ""}">${l}</button>`).join("")}`);
  if (!t || t.error || !extra[tab]) return html;
  const cut = html.indexOf('<div class="grid g-ov stagger">', html.indexOf('class="disc"'));
  return (cut > 0 ? html.slice(0, cut) : html) + (tab === "cartera" ? cartera(t) : estrategias(t));
};
const tabIdx = TABS.findIndex(x => x[0] === "trading");
if (tabIdx >= 0) TABS[tabIdx][1] = "Agent";
})();
