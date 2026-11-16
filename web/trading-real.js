/* Cage · Trading (2): research, live mode (disabled and locked by default), and tab registration. */
(() => {
"use strict";
const M = window.Cage, P = M.tradingParts;
const { st, $, $$, esc, I, TABS, VIEWS, BIND, toast, render, head, empty } = M;
const { usd, pc, load, act } = P;

function investigacion(t) {
  const R = t.research;
  if (!R || !R.context) return empty("No research yet", "The agent generates it hourly with public data. You can also request it now.") + `<button class="btn sm" data-tc="research">Research now</button>`;
  const c = R.context, src = c.sources || {};
  const big = v => v === null || v === undefined ? "no data" : v >= 1e12 ? (v / 1e12).toFixed(2).replace(".", ",") + " $B" : (v / 1e9).toFixed(1).replace(".", ",") + " $B";
  return `<div class="grid g-ov stagger">
    <div class="card span6"><h3>Market regime · ${esc(R.regime?.name || "")} <span class="row"><span class="badge m">${esc(R.date || "")}</span>${M.prov({ src: Object.values(src).join(" + ") || "Public sources", ts: R.date || st.data?.updated, kind: "real" })}<button class="btn sm ghost" data-tc="research">Refresh</button></span></h3>
      <p>${esc(R.regime?.summary || "")}</p><ul class="notes">${(R.regime?.notes || []).map(x => `<li>${esc(x)}</li>`).join("")}</ul>
      <div class="kv"><span>BTC dominance</span><b>${c.btc_dominance ?? "no data"} %</b><span>Stablecoins</span><b>${big(c.stablecoins_usd)} (${c.stablecoins_30d_pct ?? "?"} % 30 d)</b><span>DeFi TVL</span><b>${big(c.defi_tvl_usd)} (${c.defi_tvl_30d_pct ?? "?"} % 30 d)</b><span>Token unlocks</span><b class="muted">no reliable free source: not shown</b></div>
      <p class="small muted">Sources: ${Object.values(src).map(esc).join(" · ") || "—"}</p></div>
    ${(R.candidates || []).map(x => `<div class="card span3 cand"><h3>${esc(x.symbol)} <span class="badge m">${esc(x.name)}</span> ${M.prov({ src: x.source || "Public sources", ts: x.updated || R.date || st.data?.updated, kind: "real" })}</h3>
      <p class="small"><b>Thesis (data):</b> ${esc(x.thesis)}</p>
      <p class="small"><b>Confirmed catalysts:</b> ${x.catalysts_confirmed.length ? x.catalysts_confirmed.map(esc).join(", ") : "none verifiable with free sources"}</p>
      <p class="small muted"><b>Speculation:</b> ${esc(x.speculation)}</p>
      <p class="small"><b>Bear case:</b> ${esc(x.bear_case)}</p>
      <p class="small"><b>Invalidation:</b> ${esc(x.invalidation)} <i class="muted">(${esc(x.estimate)})</i></p>
      <small class="src">${esc(x.source)} · ${esc((x.updated || "").slice(0, 16).replace("T", " "))}</small></div>`).join("")}
  </div><p class="small muted">${esc(R.disclaimer || "")}</p>`;
}

function realView(t) {
  const r = t.control?.real || {}, k = t.keys || {}, S = t.eval?.symbols || {}, rs = t.real_state || {};
  const measured = Object.entries(S).map(([s, x]) => `<tr><td>${esc(s.replace("USDT", ""))}</td><td class="r num">${pc(x.directional_acc)}</td><td class="r num">${pc(x.ret, 2)}</td><td class="r num">${pc(x.bh_ret)}</td><td class="r num">${pc(x.max_dd)}</td><td>${x.holdout_brier_new < x.holdout_brier_base ? "with edge" : "no edge"}</td></tr>`).join("");
  const paperRet = t.portfolio ? t.portfolio.equity / (t.paper?.start || 10000) - 1 : null;
  if (r.enabled) return `<div class="grid g-ov stagger">
    <div class="card span6 neg-bg"><h3>Live mode ACTIVE ${r.testnet ? '<span class="badge b">testnet: paper money</span>' : '<span class="badge">real money</span>'} ${M.prov({ src: "Binance spot", ts: t.ts ? t.ts * 1000 : st.data?.updated, kind: r.testnet ? "paper" : "real" })}</h3>
      <p>Max capital ${usd(r.capital, 0)} · max position ${pc(r.max_position, 0)} · ${r.confirm_each ? "confirm each order" : "no confirmation per order"} · orders sent ${rs.orders || 0} (first 10 at 25%).</p>
      <p class="small">Real equity: ${usd(rs.equity)} · peak ${usd(rs.peak)} · automatically stops at −15%.</p>
      <button class="btn acc" data-tc="real_off">Disable live mode now</button></div>
    ${rs.pending ? `<div class="card span6"><h3>Order awaiting your confirmation ${M.prov({ src: "Agent (/api/trading)", ts: rs.pending.ts * 1000, kind: "real" })}</h3><p><b>${rs.pending.side === "BUY" ? "Buy" : "Sell"} ${rs.pending.qty} ${esc(rs.pending.sym.replace("USDT", ""))}</b> at ~${usd(rs.pending.price)} (${new Date(rs.pending.ts * 1000).toLocaleTimeString("en-US")}). Expires in 10 min.</p><button class="btn" data-approve="${esc(rs.pending.id)}">Confirm this order</button></div>` : ""}
    <div class="card span6"><h3>Real order log ${M.prov({ src: "Binance (/api/trading)", ts: t.real_orders?.at(-1)?.ts ? t.real_orders.at(-1).ts * 1000 : st.data?.updated, kind: "real" })}</h3><div class="scroll"><table class="tbl"><thead><tr><th>Date</th><th>Order</th><th class="r">Fill price</th><th class="r">Simulated</th><th class="r">Difference</th></tr></thead><tbody>
      ${(t.real_orders || []).slice().reverse().map(o => `<tr><td>${new Date(o.ts * 1000).toLocaleString("en-US")}</td><td>${o.side} ${o.qty} ${esc(o.sym)}${o.testnet ? " (testnet)" : ""}</td><td class="r num">${usd(o.avg, 4)}</td><td class="r num">${usd(o.sim, 4)}</td><td class="r num">${(o.slip_vs_sim_bps ?? 0).toFixed(1)} bps</td></tr>`).join("") || `<tr><td colspan="5">${empty("No real orders", "")}</td></tr>`}</tbody></table></div></div></div>`;
  return `<div class="grid g-ov stagger">
    <div class="card span6 locked" data-noprov="aviso"><h3>${I.lock} Live mode disabled and locked</h3><p>The agent operates only in paper mode. To use real money you must explicitly enable it here after reviewing measured results. <b>You can lose money</b>: past performance does not guarantee future results.</p>
      ${r.halted ? `<p class="small neg">Last stop: ${esc(r.halted)}</p>` : ""}</div>
    <div class="card span6"><h3>1 · Measured results (out-of-sample, net of costs) ${M.prov({ src: "Walk-forward (/api/trading)", ts: t.eval?.ts ? t.eval.ts * 1000 : st.data?.updated, kind: "calc" })}</h3>${measured ? `<table class="tbl"><thead><tr><th>Asset</th><th class="r">Accuracy</th><th class="r">Agent</th><th class="r">Buy & hold</th><th class="r">Drawdown</th><th>Model</th></tr></thead><tbody>${measured}</tbody></table>` : empty("No measurements yet", "")}
      <p class="small">Live paper: ${pc(paperRet, 2)} since inception. ${Object.values(S).every(x => !(x.holdout_brier_new < x.holdout_brier_base)) ? "<b>Today the model has no measurable edge: even if you enable live mode, it will not open positions.</b>" : ""}</p></div>
    <div class="card span3" data-noprov="formulario"><h3>2 · Exchange API keys (Binance)</h3>
      ${k.saved ? `<p>Saved: <b>${esc(k.hint)}</b> ${k.testnet ? '<span class="badge b">testnet</span>' : '<span class="badge">real</span>'}</p><button class="btn sm ghost" data-forget>Delete keys</button>` : ""}
      <form id="keysF" autocomplete="off"><div class="f"><label>API key</label><input class="in" name="key" type="password" autocomplete="off" spellcheck="false"></div>
        <div class="f"><label>API secret</label><input class="in" name="secret" type="password" autocomplete="off" spellcheck="false"></div>
        <div class="li"><div class="t"><b>Testnet (no real money)</b><small>Recommended for initial testing</small></div><input type="checkbox" name="testnet" checked></div>
        <button class="btn" type="submit">Verify & save</button></form>
      ${k.saved && k.testnet ? `<button class="btn sm ghost" data-testnet>Test execution path on testnet</button><p class="small muted" id="tnOut"></p>` : ""}
      <p class="small muted">Create a key with <b>spot trading only</b> and no withdrawals: if it allows withdrawals, margin, or futures, it is rejected. Saved encrypted (key stored in macOS Keychain) and never displayed or logged.</p></div>
    <div class="card span3" data-noprov="formulario"><h3>3 · Enable</h3><form id="actF">
      <div class="f"><label>Maximum capital allowed (USDT)</label><input class="in" name="capital" type="number" min="10" step="1" required></div>
      <div class="f"><label>Maximum position per asset</label><select class="in" name="max_position"><option value="0.1">10 %</option><option value="0.2" selected>20 %</option><option value="0.3">30 %</option></select></div>
      <div class="li"><div class="t"><b>Confirm each order</b><small>Recommended: agent proposes and you confirm</small></div><input type="checkbox" name="confirm_each" checked></div>
      <div class="f"><label>Type «${esc(t.phrase)}»</label><input class="in" name="phrase" autocomplete="off"></div>
      <button class="btn acc" type="submit">Enable live mode</button></form>
      <p class="small muted">Hard limits: 15% drawdown (closes all and stops), 3% daily loss limit, ¼ Kelly sizing, spot only, stops on data or API errors.</p></div>
  </div>`;
}

const TR = [["resumen", "Summary"], ["evaluacion", "Evaluation"], ["investigacion", "Market"], ["real", "Live mode"]];
VIEWS.trading = () => {
  const t = T(), tab = st.trTab || "resumen";
  if (!t) { load(); return head("Trading", "Loading…"); }
  if (t.error) return head("Trading", "") + empty("Could not connect to agent", esc(t.error));
  const body = { resumen: P.resumen, evaluacion: P.evaluacion, investigacion, real: realView }[tab](t);
  return head("Investor Agent", `Trading, long-term crypto, and stocks/ETFs 24/7 with real data and <b>simulated</b> trades. ${t.control?.real?.enabled ? "Live mode ACTIVE." : "Real money: disabled."}`,
    `<div class="seg" id="trTabs">${TR.map(([k, l]) => `<button data-tt="${k}" class="${tab === k ? "on" : ""}">${l}</button>`).join("")}</div>`) +
    `<div class="disc">${I.shield}<div><b>Paper mode by default.</b> Not financial advice. Simulated trades use real prices with commissions and slippage. Live mode can only be enabled by you and can always be turned off.</div></div>` + body;
};
function T() { return st.trading; }
BIND.trading = v => {
  $$("[data-tt]", v).forEach(b => b.onclick = () => { st.trTab = b.dataset.tt; render(); });
  $$("[data-tc]", v).forEach(b => b.onclick = () => {
    const a = b.dataset.tc;
    if (a === "kill_on" && !confirm("Activate the kill switch? The agent will liquidate all positions to cash.")) return;
    act("control", { action: a }, { start: "Agent started", stop: "Agent stopped", kill_on: "Kill switch activated", kill_off: "Kill switch deactivated", retrain: "Retraining requested: takes a few seconds", research: "Research requested", real_off: "Live mode disabled" }[a]);
  });
  $$("[data-approve]", v).forEach(b => b.onclick = () => act("control", { action: "approve", id: b.dataset.approve }, "Order confirmed"));
  $("[data-testnet]", v)?.addEventListener("click", async () => { const o = $("#tnOut", v); o.textContent = "Testing with paper money…"; try { const r = await M.api("/api/trading/control", { body: { action: "testnet_check" } }); o.textContent = r.detail + (r.steps ? " · " + r.steps.map(x => x[0]).join(" → ") : ""); } catch (e) { o.textContent = e.message; } });
  $("[data-forget]", v)?.addEventListener("click", () => { if (confirm("Delete exchange keys?")) act("forget", {}, "Keys deleted"); });
  const kf = $("#keysF", v);
  if (kf) kf.onsubmit = async e => { e.preventDefault(); const body = { key: kf.key.value.trim(), secret: kf.secret.value.trim(), testnet: kf.testnet.checked }; kf.key.value = kf.secret.value = ""; await act("keys", body, "Keys verified and saved"); };
  const af = $("#actF", v);
  if (af) af.onsubmit = e => { e.preventDefault(); if (!confirm("You are about to allow trades with real money within your limits. Are you sure?")) return; act("activate", { capital: +af.capital.value, max_position: +af.max_position.value, confirm_each: af.confirm_each.checked, phrase: af.phrase.value.trim() }, "Live mode enabled"); };
  clearInterval(st.trTimer); st.trTimer = setInterval(() => { if (st.tab === "trading" && !document.hidden) load(); else clearInterval(st.trTimer); }, 30000);
};
// tab after Inversión
const i = TABS.findIndex(t => t[0] === "inversion");
TABS.splice(i + 1, 0, ["trading", "Trading"]);
})();
