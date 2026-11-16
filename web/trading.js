/* Cage · Trading: 24/7 PAPER agent with real data; honest evaluation; live mode disabled and locked
   until you enable it here after reviewing measured results. */
(() => {
"use strict";
const M = window.Cage;
const { st, $, $$, esc, I, VIEWS, BIND, toast, render, head, empty, line } = M;
const usd = (v, d = 2) => v === null || v === undefined ? "—" : new Intl.NumberFormat("es-ES", { style: "currency", currency: "USD", maximumFractionDigits: d, minimumFractionDigits: d }).format(v);
const pc = (v, d = 1) => v === null || v === undefined || !isFinite(v) ? "—" : (100 * v).toFixed(d).replace(".", ",") + " %";
const n4 = v => v === null || v === undefined ? "—" : (+v).toFixed(4).replace(".", ",");
const T = () => st.trading;
const REG = { trending: "trending", mean_reverting: "range-bound", high_vol: "high volatility", crisis: "crisis" };
const DIR = { long: "bullish", short: "bearish", neutral: "neutral" };
const RS = { safe: "safe", near_limit: "near limit", reduce: "reduce" };

function load(quiet = true) { M.api("/api/trading").then(r => { st.trading = r; if (st.tab === "trading") render(quiet); }).catch(e => { st.trading = { error: e.message }; if (st.tab === "trading") render(quiet); }); }
async function act(path, body, ok) {
  try { await M.api("/api/trading/" + path, { body }); if (ok) toast(ok); load(); }
  catch (e) { toast(e.message); }
}

function resumen(t) {
  const pf = t.portfolio || {}, paper = t.paper || {}, start = paper.start || 10000;
  const E = (t.equity || []).filter(e => e[2]?.BTCUSDT), lab = E.map(e => new Date(e[0] * 1000).toLocaleDateString("en-US", { day: "2-digit", month: "2-digit" }));
  const btc0 = E.find(e => e[2]?.BTCUSDT)?.[2].BTCUSDT;
  const D = t.decisions || {};
  const ts = t.ts ? t.ts * 1000 : st.data?.updated, pPaper = M.prov({ src: "Binance spot (paper)", ts, kind: "paper" }), pSys = M.prov({ src: "Local service (/api/trading)", ts, kind: "real" });
  return `<div class="grid g-ov stagger">
    <div class="card span2"><div class="lbl">Paper capital ${pPaper}</div><div class="big num">${usd(pf.equity ?? start)}</div>
      <p class="small ${((pf.equity ?? start) - start) >= 0 ? "pos" : "neg"}">${usd((pf.equity ?? start) - start)} since ${usd(start, 0)} · fees ${usd(paper.fees || 0)}</p></div>
    <div class="card span2"><div class="lbl">24/7 Agent ${pSys}</div><div class="mid">${t.running ? '<span class="pos">● Running</span>' : '<span class="muted">● Stopped</span>'}</div>
      <p class="small muted">${t.running ? `RAM ${t.rss_mb ?? "?"} MB · last cycle ${t.ts ? new Date(t.ts * 1000).toLocaleTimeString("en-US") : "—"}` : "Consumes nothing while stopped"}${t.status && t.status !== "ok" ? " · " + esc(t.status) : ""}</p>
      <div class="row wrap"><button class="btn sm" data-tc="${t.running ? "stop" : "start"}">${t.running ? "Stop" : "Start"}</button><button class="btn sm ghost" data-tc="retrain">Retrain and evaluate</button></div></div>
    <div class="card span2 ${t.control?.kill ? "neg-bg" : ""}" data-noprov="control"><div class="lbl">Kill switch</div><div class="mid">${t.control?.kill ? '<span class="neg">Triggered: everything to cash</span>' : "Inactive"}</div>
      <p class="small muted">Checked before every order, in paper and live.</p><button class="btn sm ${t.control?.kill ? "" : "acc"}" data-tc="${t.control?.kill ? "kill_off" : "kill_on"}">${t.control?.kill ? "Deactivate" : "Activate kill switch"}</button></div>
    <div class="card span6"><h3>Current decisions <span class="badge m">local reflex · policy in code</span> ${pPaper}</h3><div class="scroll"><table class="tbl"><thead><tr><th>Asset</th><th>Regime</th><th>Direction</th><th class="r">Confidence</th><th class="r">Quality</th><th>Risk</th><th class="r">Target</th><th>Reason</th></tr></thead><tbody>
      ${Object.entries(D).map(([s, d]) => d.error ? `<tr><td><b>${esc(s)}</b></td><td colspan="7" class="muted">${esc(d.error)}</td></tr>` : `<tr><td><b>${esc(s.replace("USDT", ""))}</b>${d.escalate ? ' <span class="badge">uncertain</span>' : ""}</td><td>${esc(REG[d.regime] || d.regime)}</td><td>${esc(DIR[d.direction] || d.direction)}</td><td class="r num">${pc(d.prob)}</td><td class="r num">${d.setup_quality}/3</td><td>${esc(RS[d.risk_state] || d.risk_state)}</td><td class="r num">${pc(d.target)}</td><td><small>${esc(d.why)}</small>${d.explain ? `<br><small class="muted">AI: ${esc(d.explain)}</small>` : ""}${(d.news || []).length ? `<span class="dnews">${d.news.map(x => `<a href="${esc(x.link)}" target="_blank" rel="noopener noreferrer" title="${esc(x.title)}">📰 ${esc(x.title)}</a>`).join("")}</span>` : ""}</td></tr>`).join("") || `<tr><td colspan="8">${empty("No decisions yet", "Start the agent: the first hourly candle produces the first decision.")}</td></tr>`}
    </tbody></table></div><p class="small muted">Trades only if quality ≥ 2, confidence &gt; 80%, and safe risk; ¼ Kelly position sizing with cap. If the model does not beat the out-of-sample base rate, it does not trade.</p></div>
    <div class="card span4"><h3>Paper capital vs buy and hold BTC ${pPaper}</h3>${E.length >= 2 && btc0 ? line(lab, [{ name: "Agent", color: "var(--acc)", values: E.map(e => e[1]), area: true }, { name: "BTC", color: "var(--blue)", values: E.map(e => +(start * e[2].BTCUSDT / btc0).toFixed(2)) }], { h: 220, fmt: v => usd(v, 0), min: "auto", smooth: false }) : empty("Chart appears after a few hours", "One data point is saved per hour.")}</div>
    <div class="card span2"><h3>Paper trades ${pPaper}</h3><div class="list scroll-s">${(t.trades || []).slice().reverse().map(x => `<div class="li"><span class="lic">${x.side === "buy" ? I.up : I.down}</span><div class="t"><b>${esc(x.side === "buy" ? "Buy" : "Sell")} ${esc(x.sym.replace("USDT", ""))} · ${usd(x.price)}</b><small>${new Date(x.ts).toLocaleString("en-US")} · fee ${usd(x.fee)}</small></div></div>`).join("") || empty("None yet", "The agent only trades when there is a valid signal.")}</div></div>
  </div>`;
}

function evaluacion(t) {
  const S = t.eval?.symbols || {};
  const rows = Object.entries(S);
  if (!rows.length) return empty("No evaluation yet", "Click «Retrain and evaluate» or wait for the nightly review (03:00).");
  const first = rows[0][1];
  const pEv = M.prov({ src: "Walk-forward Binance (/api/trading)", ts: t.eval?.ts ? t.eval.ts * 1000 : st.data?.updated, kind: "calc" });
  return `<div class="grid g-ov stagger">
    <div class="card span6 honest"><h3>Honest interpretation ${pEv}</h3><p>Directional accuracy above 95% is unrealistic in financial markets: top professional systems operate around 51–55%, and aiming higher leads to <b>overfitting</b> (looks perfect on historical data, fails in the future). That is why performance is measured <b>out-of-sample</b> (walk-forward: trains on past data, tests on the following month) and <b>net of costs</b>.</p>
      <p class="small muted">Evaluation from ${new Date(t.eval.ts * 1000).toLocaleString("en-US")} · hourly Binance candles · ${first.folds} test months per asset.</p></div>
    <div class="card span6"><h3>Out-of-sample results ${pEv}</h3><div class="scroll"><table class="tbl"><thead><tr><th>Asset</th><th class="r">Valid schema</th><th class="r">Brier</th><th class="r">Base Brier</th><th class="r">Directional acc.</th><th class="r">Agent return</th><th class="r">Buy and hold</th><th class="r">Sharpe</th><th class="r">Max drawdown</th><th>Active model</th></tr></thead><tbody>
      ${rows.map(([s, r]) => `<tr><td><b>${esc(s.replace("USDT", ""))}</b></td><td class="r num">${pc(r.schema_valid, 1)}</td><td class="r num ${r.brier < r.brier_base ? "pos" : "neg"}">${n4(r.brier)}</td><td class="r num">${n4(r.brier_base)}</td><td class="r num">${pc(r.directional_acc)} <small class="muted">(${r.directional_n})</small></td><td class="r num">${pc(r.ret, 2)}</td><td class="r num">${pc(r.bh_ret)}</td><td class="r num">${(r.sharpe || 0).toFixed(2).replace(".", ",")}</td><td class="r num">${pc(r.max_dd)} <small class="muted">vs ${pc(r.bh_max_dd, 0)}</small></td><td>${r.holdout_brier_new < r.holdout_brier_base ? '<span class="badge g">with edge</span>' : '<span class="badge m">no edge · inactive</span>'}</td></tr>`).join("")}
    </tbody></table></div><p class="small muted">Brier: probability calibration error (lower is better; 0.25 = coin toss). If it does not beat the base rate, the model adds no value and the agent risks no capital.</p></div>
    ${rows.map(([s, r]) => `<div class="card span2"><h3>Calibration · ${esc(s.replace("USDT", ""))} ${pEv}</h3>${r.calibration?.length ? line(r.calibration.map(b => pc(b.pred, 0)), [{ name: "Observed", color: "var(--acc)", values: r.calibration.map(b => +(100 * b.obs).toFixed(1)) }, { name: "Perfect", color: "var(--blue)", values: r.calibration.map(b => +(100 * b.pred).toFixed(1)) }], { h: 170, fmt: v => v + " %", min: "auto", smooth: false }) : ""}<p class="small muted">If the lines align, when predicting 60% it is correct 60% of the time.</p></div>`).join("")}
  </div>`;
}
M.tradingParts = { resumen, evaluacion, usd, pc, n4, load, act };
})();
