/* Cage · Agent: Real paper results since installation, model research (42 variants, deflated Sharpe,
   holdout split), systematic strategies, long-term planning, alerts, and metrics reviewed before real mode can be enabled. */
(() => {
"use strict";
const M = window.Cage;
const { st, esc, VIEWS, empty, line } = M;
const pc = (v, d = 1) => v === null || v === undefined || !isFinite(v) ? "—" : (100 * v).toFixed(d).replace(".", ",") + " %";
const n2 = v => v === null || v === undefined ? "—" : (+v).toFixed(2).replace(".", ",");
const n4 = v => v === null || v === undefined ? "—" : (+v).toFixed(4).replace(".", ",");
const eur = v => v === null || v === undefined ? "—" : new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
const H = { 4: "4 h", 24: "1 day", 168: "1 week" };

function alertsCard(t) {
  const a = t.alerts || [];
  return a.length ? `<div class="warn">${a.map(x => `<div class="li"><span class="lic">!</span><div class="t"><b>${esc(x)}</b><small>While active, the agent does not trade this asset.</small></div></div>`).join("")}</div>` : "";
}

function resultados(t) {
  const E = (t.equity || []).filter(e => e[2]?.BTCUSDT);
  const u = t.uptime || {}, start = t.paper?.start || 10000;
  const btc0 = E[0]?.[2].BTCUSDT;
  const lt = t.longterm?.sleeves || {};
  const pf = t.portfolio || {};
  const ts = E.at(-1)?.[0] ? E.at(-1)[0] * 1000 : (t.ts ? t.ts * 1000 : st.data?.updated), pPaper = M.prov({ src: "Binance (paper)", ts, kind: "paper" }), pSys = M.prov({ src: "24/7 Service (/api/trading)", ts, kind: "real" });
  return `<div class="grid g-ov stagger">
    <div class="card span2"><div class="lbl">Paper trading since installation ${pPaper}</div><div class="big num">${pc((pf.equity ?? start) / start - 1, 2)}</div>
      <p class="small muted">${E.length ? `since ${new Date(E[0][0] * 1000).toLocaleDateString("en-US")} · ${E.length} hours logged` : "no history yet"}</p></div>
    <div class="card span2"><div class="lbl">Bitcoin in same period ${M.prov({ src: "Binance (BTCUSDT)", ts, kind: "real" })}</div><div class="big num">${btc0 ? pc(E.at(-1)[2].BTCUSDT / btc0 - 1, 2) : "—"}</div><p class="small muted">buy and hold, no fees</p></div>
    <div class="card span2"><div class="lbl">24/7 Service uptime ${pSys}</div><div class="big num">${u.pct ? pc(u.pct, 1) : "—"}</div><p class="small muted">${u.hours ? `${u.hours} h since tracking · Mac sleeping counts as downtime` : "tracked since this version"}</p></div>
    <div class="card span4"><h3>Real paper equity curve vs index ${pPaper}</h3>${E.length >= 2 ? line(E.map(e => new Date(e[0] * 1000).toLocaleDateString("en-US", { day: "2-digit", month: "2-digit" })), [{ name: "Agent (paper)", color: "var(--acc)", values: E.map(e => e[1]), area: true }, { name: "Bitcoin", color: "var(--blue)", values: E.map(e => +(start * e[2].BTCUSDT / btc0).toFixed(2)) }], { h: 230, min: "auto", smooth: false }) : empty("No curve yet", "One data point is saved per hour while service runs.")}</div>
    <div class="card span2"><h3>Long-term in paper ${M.prov({ src: "Yahoo Finance + Binance (paper)", ts, kind: "paper" })}</h3><div class="list">${Object.entries(lt).filter(([, s]) => !s.disabled).map(([k, s]) => `<div class="li"><div class="t"><b>${k === "etf" ? "Stocks & ETFs" : "Crypto"}</b><small>since ${esc(s.started || "")} · contributed ${eur(s.book?.contributed)}</small></div><span class="num ${s.value >= s.book?.contributed ? "pos" : "neg"}">${eur(s.value)}</span></div>`).join("") || empty("No data", "")}</div>
      <p class="small muted">Value vs contributed; benchmark index is in Strategies.</p></div>
  </div>`;
}

function onchainCard(o, bc) {
  if (!bc?.saved && !o?.ts) return `<div class="card span6" data-noprov="sin datos aún"><h3>On-chain data (Blockchair)</h3><p class="small">Connect your Blockchair API key in <b>Connect</b> and the agent will measure fees, congestion, activity, volume, and dormant coins moving on Bitcoin and Ethereum, under identical validation rules (2017-2019 holdout never touched by these variables).</p></div>`;
  if (!o?.ts) return `<div class="card span6" data-noprov="estudio pendiente"><h3>On-chain data (Blockchair)</h3><p class="small">Key connected (${esc(bc.hint || "")}). Study will run on next 24/7 agent update, within your rate limits.</p></div>`;
  const V = Object.entries(o.variants || {}).sort((a, b) => b[1].excess_sharpe - a[1].excess_sharpe);
  const snap = o.snapshot?.bitcoin || {};
  return `<div class="card span6"><h3>On-chain data (Blockchair) <span class="badge m">${o.n_variants} variants evaluated</span> ${M.prov({ src: "Blockchair + Binance", ts: o.ts, kind: "estudio" })}</h3>
    <p>${o.adopted.length ? "<b>Pass all tests:</b> " + o.adopted.map(esc).join(", ") : "<b>No on-chain variable passes validation</b>: retained as context only, no trade decisions."} Development ${esc(o.dev[0])} → today; holdout split ${esc(o.reserved[0])} → ${esc(o.reserved[1])}. Exchange flows: ${esc(o.exchange_flows)}.</p>
    <div class="scroll"><table class="tbl"><thead><tr><th>Rule</th><th class="r">Excess Sharpe</th><th class="r">DSR</th><th class="r">Holdout BTC</th><th class="r">Holdout ETH</th></tr></thead><tbody>${V.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r num ${v.excess_sharpe > 0 ? "pos" : "neg"}">${n2(v.excess_sharpe)}</td><td class="r num">${n2(v.dsr)}</td><td class="r num">${n2(v.reserved?.BTCUSDT?.dsharpe)}</td><td class="r num">${n2(v.reserved?.ETHUSDT?.dsharpe)}</td></tr>`).join("")}</tbody></table></div>
    <p class="small muted">Currently on Bitcoin: ${snap.transactions_24h ?? "—"} transactions in 24 h · median fee ${snap.median_transaction_fee_usd_24h != null ? (+snap.median_transaction_fee_usd_24h).toFixed(2).replace(".", ",") + " $" : "—"} · ${snap.mempool_transactions ?? "—"} unconfirmed. Today's quota: ${o.usage?.points ?? "?"} of ${o.usage?.limit ?? "?"} points.</p></div>`;
}

function round3(q) {
  if (!q || !q.rows) return "";
  return `<div class="card span6"><h3>Round 3: on-chain data, funding, basis, and regimes <span class="badge m">${q.n} variants evaluated</span> ${M.prov({ src: "Local backtest (/api/trading)", ts: st.data?.updated, kind: "calc" })}</h3>
    <p>${q.adopted.length ? "<b>Adopted:</b> " + q.adopted.map(esc).join(", ") : "<b>No variant reliably beats buy and hold</b>: indexed portfolio retained and agent remains idle."} Development in BTC and ETH since 2020; new holdout with ${(q.holdout || []).length} cryptos never used before (${(q.holdout || []).map(s => esc(s.replace("USDT", ""))).join(", ")}).</p>
    <div class="scroll"><table class="tbl"><thead><tr><th>Variant</th><th class="r">Excess Sharpe</th><th class="r">DSR</th><th class="r">Max drawdown</th><th class="r">Holdout: wins</th></tr></thead><tbody>${q.rows.map(v => `<tr><td>${esc(v.name)}</td><td class="r num ${v.ex_sharpe > 0 ? "pos" : "neg"}">${n2(v.ex_sharpe)}</td><td class="r num">${n2(v.dsr)}</td><td class="r num">${pc(v.max_dd, 0)}</td><td class="r num">${v.hold_wins}/${(q.holdout || []).length}</td></tr>`).join("")}</tbody></table></div>
    <p class="small muted">Buy and hold: Sharpe ${n2(q.bh?.sharpe)}, max drawdown ${pc(q.bh?.max_dd, 0)}. DSR = probability excess is genuine (requires ≥ 0.95). Stablecoins (Aave, comparative only, not activated): ${(Array.isArray(q.yields) ? q.yields : []).map(y => `${esc(y.chain)} ${n2(y.apy_365d_mean)} %`).join(" · ")}. Exchange flows not used: only available on paid tiers.</p></div>`;
}

function investigacion(t) {
  const r = t.research_ml || {}, S = t.systematic?.strategies || {};
  if (!r.n_variants) return empty("No research round", "");
  const ho = r.holdout || {};
  const pMl = M.prov({ src: "Purged walk-forward (/api/trading)", ts: t.eval?.ts ? t.eval.ts * 1000 : st.data?.updated, kind: "calc" });
  return `<div class="grid g-ov stagger">
    <div class="card span6 honest"><h3>Conclusion ${pMl}</h3><p><b>No statistically reliable edge.</b> Tested <b>${r.n_variants} variants</b> (3 horizons, logistic regression, gradient boosting, ensemble, and meta-labeling, across 15 pairs and 4 years of data) using purged walk-forward and net of costs. None improves over the base rate Brier, and the best shows a deflated Sharpe of <b>${n2(r.top?.[0]?.dsr)}</b> (requires ≥ 0.95). Across the 120 reserved holdout days (inspected exactly once): accuracy <b>${pc(ho.hit)}</b>, return <b>${pc(ho.ret, 2)}</b> vs <b>${pc(ho.buy_hold_equal_weight)}</b> for equal-weight buy and hold. Therefore the agent <b>does not trade</b> with the model; standards are not lowered.</p>
      <p class="small muted">Note: in holdout, ensemble was evaluated at 0.55 without meta-filter (code simplification); not rerun because holdout is only viewed once. Free historical open interest only covers ~30 days and historical dominance is not free: not used.</p></div>
    <div class="card span3"><h3>Brier by horizon ${pMl}</h3><table class="tbl"><thead><tr><th>Horizon</th><th class="r">Best model</th><th class="r">Base rate</th></tr></thead><tbody>${Object.entries(r.by_h || {}).map(([h, b]) => `<tr><td>${H[h] || h}</td><td class="r num neg">${n4(b.best_brier)}</td><td class="r num">${n4(b.base)}</td></tr>`).join("")}</tbody></table><p class="small muted">Lower is better. No model beats the base rate.</p></div>
    <div class="card span3"><h3>Best variants (development) ${pMl}</h3><div class="scroll"><table class="tbl"><thead><tr><th>Variant</th><th class="r">Accuracy</th><th class="r">Sharpe</th><th class="r">Drawdown</th><th class="r">DSR</th></tr></thead><tbody>${(r.top || []).slice(0, 6).map(v => `<tr><td>${H[v.h]} · ${esc(v.model)} · ${v.thr}${v.long_only ? " · long only" : ""}</td><td class="r num">${pc(v.hit)}</td><td class="r num">${n2(v.sharpe)}</td><td class="r num">${pc(v.max_dd, 0)}</td><td class="r num">${n2(v.dsr)}</td></tr>`).join("")}</tbody></table></div></div>
    ${round3(t.round3)}
    ${onchainCard(t.onchain, t.blockchair)}
    <div class="card span6"><h3>Simple systematic strategies <span class="badge m">real daily data, costs included</span> ${M.prov({ src: "Daily data (Yahoo + Binance)", ts: t.systematic?.crypto_to || st.data?.updated, kind: "calc" })}</h3><div class="scroll"><table class="tbl"><thead><tr><th>Strategy</th><th class="r">Annual ret.</th><th class="r">Volatility</th><th class="r">Max drawdown</th><th class="r">Sharpe</th></tr></thead><tbody>
      ${Object.values(S).map(v => `<tr><td><b>${esc(v.label)}</b></td><td class="r num">${pc(v.cagr)}</td><td class="r num">${pc(v.vol)}</td><td class="r num">${pc(v.max_dd)}</td><td class="r num">${n2(v.sharpe)}</td></tr>`).join("")}</tbody></table></div>
      <p class="small">Trend with volatility target and risk parity <b>significantly reduce drawdown</b>, but <b>do not beat their index in return</b> and statistical significance is insufficient. Indexed default is retained. Crypto: ${esc(t.systematic?.crypto_from || "")} → ${esc(t.systematic?.crypto_to || "")} (short period).</p></div>
  </div>`;
}

function plan(t) {
  const p = t.longterm?.eval?.etf?.plan;
  if (!p) return "";
  const mc = p.mc || {}, pr = p.mc_prudent || {};
  const pPlan = M.prov({ src: "Historical data 2016-2026 (Yahoo)", ts: t.longterm?.eval?.etf?.to || st.data?.updated, kind: "calc" });
  return `<div class="card span3"><h3>Risk frontier (historical) ${pPlan}</h3>${line(p.frontier.map(x => x.equity + "%"), [{ name: "Annual return", color: "var(--acc)", values: p.frontier.map(x => +(100 * x.ret).toFixed(1)) }, { name: "Volatility", color: "var(--blue)", values: p.frontier.map(x => +(100 * x.vol).toFixed(1)) }], { h: 180, fmt: v => v + " %", smooth: false })}<p class="small muted">From 0% to 100% in equities (MSCI World), remainder in euro bonds.</p></div>
    <div class="card span3"><h3>Worst real drawdowns for your profile ${pPlan}</h3><div class="list">${(p.worst || []).map(w => `<div class="li"><span class="lic">↓</span><div class="t"><b>−${pc(w.dd)}</b><small>${esc(w.from)} → ${esc(w.to)}</small></div></div>`).join("")}</div><p class="small muted">Stress test with 2016-2026 data. A worse crisis is always possible.</p></div>
    <div class="card span6"><h3>Monte Carlo simulation · ${mc.years || "?"} years ${M.prov({ src: "Monte Carlo simulation", ts: t.longterm?.eval?.etf?.to || st.data?.updated, kind: "paper" })}</h3><table class="tbl"><thead><tr><th>Scenario</th><th class="r">Unfavorable (10%)</th><th class="r">Median (50%)</th><th class="r">Favorable (90%)</th><th class="r">Prob. of ending below contributions</th></tr></thead><tbody>
      <tr><td>Historical (after estimated taxes)</td><td class="r num">${eur(mc.p10_net)}</td><td class="r num">${eur(mc.p50_net)}</td><td class="r num">${eur(mc.p90_net)}</td><td class="r num">${pc(mc.prob_loss)}</td></tr>
      <tr><td>Prudent (−3 points per year)</td><td class="r num">${eur(pr.p10_net)}</td><td class="r num">${eur(pr.p50_net)}</td><td class="r num">${eur(pr.p90_net)}</td><td class="r num">${pc(pr.prob_loss)}</td></tr></tbody></table>
      <p class="small muted">Contributed: ${eur(mc.contributed)}. ${esc(p.caveat || "")} ${esc(mc.note || "")} Median in today's euros: ${eur(mc.p50_real)}.</p></div>`;
}

// integrate sections into agent tab
const base = VIEWS.trading;
VIEWS.trading = () => {
  const tab = st.trTab || "cartera", t = st.trading;
  const extra = { resultados: "Results", modelo: "AI Research" };
  if (extra[tab]) st.trTab = "resumen";
  let html = base();
  st.trTab = tab;
  if (extra[tab]) html = html.replace('data-tt="resumen" class="on"', 'data-tt="resumen" class=""');
  html = html.replace('<div class="seg" id="trTabs">', `<div class="seg" id="trTabs">${Object.entries(extra).map(([k, l]) => `<button data-tt="${k}" class="${tab === k ? "on" : ""}">${l}</button>`).join("")}`);
  if (!t || t.error) return html;
  const disc = html.indexOf('</div></div>', html.indexOf('class="disc"')) + 12;
  html = html.slice(0, disc) + alertsCard(t) + html.slice(disc);
  if (extra[tab]) {
    const cut = html.indexOf('<div class="grid g-ov stagger">', disc);
    return (cut > 0 ? html.slice(0, cut) : html) + (tab === "resultados" ? resultados(t) : investigacion(t));
  }
  if (tab === "estrategias") html = html.replace(/<\/div>\s*$/, plan(t) + "</div>");
  if (tab === "real") {  // before live mode: real measured data
    const cut = html.indexOf('<div class="grid g-ov stagger">', disc);
    if (cut > 0) html = html.slice(0, cut) + `<div class="card span6 honest prereal"><h3>Before anything: measured reality ${M.prov({ src: "Measurement summary (/api/trading)", ts: t.ts ? t.ts * 1000 : st.data?.updated, kind: "calc" })}</h3><p>${t.research_ml?.n_variants ? `Model: ${t.research_ml.n_variants} variants tested, <b>${(t.research_ml.top?.[0]?.dsr || 0) >= 0.95 ? "with statistical edge" : "no reliable edge"}</b> (deflated Sharpe ${n2(t.research_ml.top?.[0]?.dsr)}; holdout ${pc(t.research_ml.holdout?.ret, 2)} vs ${pc(t.research_ml.holdout?.buy_hold_equal_weight)} buy and hold).` : "Model: <b>not measured yet</b>."} Paper since install: ${pc((t.portfolio?.equity ?? 10000) / (t.paper?.start || 10000) - 1, 2)}. 24/7 Uptime: ${t.uptime?.pct ? pc(t.uptime.pct) : "—"}. Active alerts: ${(t.alerts || []).length}.</p></div>` + html.slice(cut);
  }
  return html;
};
})();
