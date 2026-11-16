/* Cage · Agent → "No registration": self-custody wallet on Solana + Jupiter. Explains limitations (not anonymous),
   creates wallet displaying the 24 words ONCE (never stored in page), verifies they were noted down, simulates swaps
   with all safety checks, and executes only if you enable it. Exportable FIFO tax report. */
(() => {
"use strict";
const M = window.Cage;
const { st, $, $$, esc, VIEWS, BIND, toast, render, empty } = M;
const W = () => st.dexw;
async function call(body) { return M.api("/api/trading/wallet", { body }); }
async function refresh() { try { st.dexw = await call({ action: "status" }); } catch (e) { st.dexw = { error: e.message }; } render(true); }

function view() {
  const w = W();
  if (!w) { refresh(); return empty("Loading…", ""); }
  if (w.error) return empty("Not available", esc(w.error));
  const info = `<div class="card span6 honest" data-noprov="explicación"><h3>Trading without registration: what it is and what it isn't</h3>
    <p>With a <b>self-custody wallet</b> and a decentralized exchange (Jupiter, on Solana) you can buy and sell wrapped SOL, BTC, and ETH <b>without creating an account</b> anywhere. But:</p>
    <ul class="notes"><li><b>It is not anonymous.</b> All transactions are public and permanent on-chain; and on-ramping euros typically requires identity verification.</li>
    <li><b>If you lose the 24 words, you lose the funds.</b> No one can recover them. If someone sees them, they can take them.</li>
    <li><b>Taxes still apply:</b> capital gains must be declared. An exportable FIFO report in EUR is provided here for tax filing.</li>
    <li>Cage has no feature to transfer funds to external addresses: to withdraw funds, import your seed words into any wallet (Phantom, Solflare).</li></ul>
    <p class="small muted">Measured costs with live prices: 0.00–0.05% per swap plus network fees (cents), compared to Binance's 0.10% fee. Tradeoffs and alternatives in docs/DEX.md.</p></div>`;
  if (!w.address) return `<div class="grid g-ov stagger">${info}<div class="card span6" data-noprov="formulario"><h3>Create your wallet</h3><p>Generated locally on this Mac and stored encrypted in your vault. I will show you the 24 words <b>only once</b>: have pen and paper ready and ensure nobody is watching your screen.</p><button class="btn acc" data-dx="create">Create wallet</button><div id="dxWords"></div></div></div>`;
  if (!w.confirmed) return `<div class="grid g-ov stagger">${info}<div class="card span6" data-noprov="formulario"><h3>Confirm you have written down your words</h3><div id="dxWords"></div><p class="small muted">If you didn't write them down, this wallet cannot be used: discard it (only if empty) and create a new one.</p><button class="btn sm ghost" data-dx="discard">Discard wallet</button></div></div>`;
  const tr = w.trades || [];
  return `<div class="grid g-ov stagger">${info}
    <div class="card span3"><h3>Your wallet ${M.prov({ src: "Solana RPC (/api/trading/wallet)", ts: st.data?.updated, kind: "real" })}</h3><p class="small">Public address (to receive funds):</p><code class="addr">${esc(w.address)}</code>
      <div class="row wrap"><button class="btn sm ghost" data-dx="copy">Copy address</button><button class="btn sm ghost" data-dx="balances">View balances</button></div><div id="dxBal"></div></div>
    <div class="card span3 ${w.enabled ? "neg-bg" : ""}" data-noprov="control"><h3>${w.enabled ? "Live trading ACTIVE" : "Live trading disabled"}</h3>
      ${w.enabled ? `<p>Max capital ${esc(w.capital)} USDC.</p><button class="btn acc" data-dx="off">Disable now</button>` : `<form id="dxAct"><div class="f"><label>Max capital (USDC)</label><input class="in" name="capital" type="number" min="10"></div><div class="f"><label>Type «${esc(w.phrase)}»</label><input class="in" name="phrase" autocomplete="off"></div><button class="btn" type="submit">Enable</button></form><p class="small muted">You confirm each order while your session is unlocked. ${w.halted ? "Last stop: " + esc(w.halted) : ""}</p>`}</div>
    <div class="card span6"><h3>Simulate a swap (full verification, unsigned) ${M.prov({ src: "Jupiter + Binance (/api/trading/wallet)", ts: st.data?.updated, kind: "paper" })}</h3>
      <form id="dxPrep" class="row wrap"><select class="in w-auto" name="pair"><option value="USDC>SOL">USDC → SOL</option><option value="SOL>USDC">SOL → USDC</option><option value="USDC>cbBTC">USDC → BTC (cbBTC)</option><option value="cbBTC>USDC">BTC → USDC</option><option value="USDC>wETH">USDC → ETH (wETH)</option><option value="wETH>USDC">ETH → USDC</option></select>
      <input class="in w-auto" name="amount" type="number" step="any" min="0" value="10"><button class="btn" type="submit">Simulate</button></form><div id="dxOut"></div></div>
    ${trialCard(w)}
    <div class="card span6"><h3>Live transactions for this wallet ${M.prov({ src: "Solana + vault", ts: tr.at(-1)?.ts || st.data?.updated, kind: "tu" })} <button class="btn sm ghost" data-dx="tax">Tax report (CSV)</button>${tr.some(t => t.status === "pendiente") ? ` <button class="btn sm" data-dx="reconcile">Check pending</button>` : ""}</h3>
      ${tr.length ? `<table class="tbl"><thead><tr><th>Date</th><th>Operation</th><th class="r">Quantity</th><th class="r">Price</th><th>Signature</th></tr></thead><tbody>${tr.slice().reverse().map(t => `<tr><td>${esc(t.date)}</td><td>${t.side === "buy" ? "Buy" : "Sell"} ${esc(t.asset)}</td><td class="r num">${t.qty}</td><td class="r num">${(+t.price_usd).toFixed(4)} $</td><td><a href="https://solscan.io/tx/${esc(t.signature)}" target="_blank" rel="noopener noreferrer">${esc(String(t.signature).slice(0, 10))}…</a> <span class="badge ${t.status === "fallida" ? "" : "m"}">${esc(t.status || "confirmed")}</span></td></tr>`).join("")}</tbody></table>` : empty("None yet", "")}</div></div>`;
}

function trialCard(w) {
  const T = st.dexTrial, usd = v => v == null ? "—" : (+v).toFixed(2).replace(".", ",") + " $", pct = (a, b) => b ? ((a / b - 1) * 100).toFixed(1).replace(".", ",") + " %" : "—";
  if (T === undefined) { call({ action: "trial" }).then(r => { st.dexTrial = r; render(true); }).catch(e => { st.dexTrial = { error: e.message }; render(true); }); }
  const steps = `<ol class="notes"><li>Create and confirm your wallet (above). Write down the 24 words on paper.</li>
      <li><b>Buy about €20 in SOL</b> on a regulated exchange. In Spain and the EU all exchanges require identity verification (by law; Cage will not help circumvent it). If you already have an account (Binance, Bit2Me, Bitpanda, Kraken, Coinbase…), use that. Before buying, check the <b>SOL withdrawal fee</b> and minimums: on €20, a €1 fee is 5%.</li>
      <li><b>Withdraw SOL to your wallet address</b> (button «Copy address» above) selecting the <b>Solana (SOL) network</b>. Double check that the first 4 and last 4 characters match before confirming: sending to the wrong address or network cannot be undone. SOL is preferred over USDC: a small amount of SOL is required for network fees.</li>
      <li>Once received (click «View balances»), continue to the next step.</li>
      <li>Click «Start trial»: Cage records current balances and prices as a benchmark.</li>
      <li>Enable live operations with the safety phrase and a max capital of 25 USDC (~€20).</li>
      <li>Execute trades proposed by the plan one by one. Nothing moves automatically.</li></ol>`;
  if (!T || T.error || !T.trial) return `<div class="card span6"><h3>Trial with €20 in real funds</h3>${T?.error ? `<p class="small neg">${esc(T.error)}</p>` : ""}${steps}
      <p class="small"><b>Policy:</b> ${esc(T?.policy || "")}</p>
      <p class="small muted">With €20, multi-week results will reflect mostly market variance and fees; the goal is learning the real-world flow. Opening cbBTC and wETH token accounts costs ~0.002 SOL each (reclaimed when closing accounts).</p>
      <button class="btn" data-dx="trial_start">Start trial</button></div>`;
  const plan = T.plan || [];
  return `<div class="card span6"><h3>Trial with €20 in real funds <span class="badge m">since ${esc(T.trial.date)}</span> ${M.prov ? M.prov({ src: "balances across 2 RPCs + Binance prices", ts: Date.now(), kind: "mercado", short: "now" }) : ""}</h3>
    <div class="row wrap kpis"><div><div class="lbl">Now</div><b class="num">${usd(T.now_usd)}</b> <small class="muted">${(T.now_eur || 0).toFixed(2).replace(".", ",")} €</small></div>
      <div><div class="lbl">At start</div><b class="num">${usd(T.trial.value_usd)}</b></div>
      <div><div class="lbl">If you did nothing</div><b class="num">${usd(T.hold_usd)}</b> <small class="muted">${pct(T.now_usd, T.hold_usd)} vs this</small></div>
      <div><div class="lbl">If all BTC</div><b class="num">${usd(T.btc_usd)}</b> <small class="muted">${pct(T.now_usd, T.btc_usd)} vs this</small></div></div>
    <h4 class="dayh">Agent current plan</h4>${plan.length ? `<div class="list">${plan.map(x => `<div class="li"><div class="t"><b>${x.sym_in === "USDC" ? `Buy ${esc(x.sym_out)} for ${usd(x.amount_usd)}` : `Sell ${x.amount} ${esc(x.sym_in)} (${usd(x.amount_usd)})`}</b><small>${esc(x.why)}</small></div></div>`).join("")}</div><p class="small muted">To execute: simulate each trade below with that amount and, if all checks pass, click «Execute with real funds».</p>` : `<p class="small">Nothing to do: basket is within target bands.</p>`}
    <p class="small muted">${esc(T.policy)}</p></div>`;
}

function showWords(r) {
  const box = $("#dxWords");
  box.innerHTML = `<div class="seed warnbox"><b>Write down these 24 words on paper, in order. Do not take a screenshot or copy them to your computer.</b>
    <ol class="words">${r.words.map(x => `<li>${esc(x)}</li>`).join("")}</ol>
    <button class="btn" data-dx="written">I have written them down</button></div>`;
  $("[data-dx=written]", box).onclick = () => quiz(r.quiz);
  r.words.length = 0;  // not saved in page
}
function quiz(pos) {
  const box = $("#dxWords");
  box.innerHTML = `<form id="dxQuiz"><p>Type these words from your paper:</p>${pos.map(i => `<div class="f"><label>Word #${i}</label><input class="in" name="w${i}" autocomplete="off" spellcheck="false"></div>`).join("")}<button class="btn" type="submit">Verify</button></form>`;
  $("#dxQuiz").onsubmit = async e => {
    e.preventDefault();
    const answers = Object.fromEntries(pos.map(i => [i, e.target["w" + i].value.trim().toLowerCase()]));
    try { await call({ action: "confirm", answers }); toast("Wallet ready"); refresh(); } catch (er) { toast(er.message); }
  };
}

const base = VIEWS.trading;
VIEWS.trading = () => {
  const tab = st.trTab || "cartera";
  if (tab !== "sinregistro") return base().replace('<div class="seg" id="trTabs">', '<div class="seg" id="trTabs"><button data-tt="sinregistro">No registration</button>');
  st.trTab = "resumen";
  let html = base();
  st.trTab = tab;
  html = html.replace('data-tt="resumen" class="on"', 'data-tt="resumen" class=""').replace('<div class="seg" id="trTabs">', '<div class="seg" id="trTabs"><button data-tt="sinregistro" class="on">No registration</button>');
  const cut = html.indexOf('<div class="grid g-ov stagger">', html.indexOf('class="disc"'));
  return (cut > 0 ? html.slice(0, cut) : html) + view();
};
const bt = BIND.trading;
BIND.trading = v => {
  bt && bt(v);
  if ((st.trTab || "") !== "sinregistro") return;
  const w = W();
  if (w && w.address && !w.confirmed && w.quiz && $("#dxWords", v) && !$("#dxWords", v).innerHTML) quiz(w.quiz);
  $$("[data-dx]", v).forEach(b => b.onclick = async () => {
    const a = b.dataset.dx;
    try {
      if (a === "create") { if (!confirm("Is anyone watching your screen and do you have paper ready to write down 24 words?")) return; const r = await call({ action: "create" }); st.dexw = { ...st.dexw, address: r.address }; showWords(r); }
      else if (a === "copy") { await navigator.clipboard.writeText(W().address); toast("Address copied"); }
      else if (a === "balances") { const r = await call({ action: "balances" }); $("#dxBal").innerHTML = `<div class="list">${Object.entries(r.balances).map(([k, x]) => `<div class="li"><div class="t"><b>${esc(k)}</b></div><span class="num">${(+x).toFixed(6)}</span></div>`).join("")}</div>`; }
      else if (a === "discard") { if (!confirm("Discard this unconfirmed wallet?")) return; await call({ action: "discard" }); toast("Discarded"); refresh(); }
      else if (a === "off") { await call({ action: "off" }); toast("Live trading disabled"); refresh(); }
      else if (a === "trial_start") { if (!confirm("Have you already sent €20 to the wallet? Cage will record current balances and prices as a starting point.")) return; await call({ action: "trial_start" }); st.dexTrial = undefined; toast("Trial started"); render(true); }
      else if (a === "reconcile") { const r = await call({ action: "reconcile" }); toast(r.pending ? `${r.pending} still pending` : "All confirmed"); refresh(); }
      else if (a === "tax") { const r = await call({ action: "tax_csv" }); const el = document.createElement("a"); el.href = URL.createObjectURL(new Blob([r.csv], { type: "text/csv" })); el.download = "cage-crypto-fifo.csv"; el.click(); }
    } catch (e) { toast(e.message); }
  });
  const act = $("#dxAct", v);
  if (act) act.onsubmit = async e => { e.preventDefault(); if (!confirm("You are about to allow live trades from your wallet, confirming each one. Are you sure?")) return; try { await call({ action: "activate", capital: +act.capital.value, phrase: act.phrase.value.trim() }); toast("Enabled"); refresh(); } catch (er) { toast(er.message); } };
  const prep = $("#dxPrep", v);
  if (prep) prep.onsubmit = async e => {
    e.preventDefault();
    const [i, o] = prep.pair.value.split(">"), amount = +prep.amount.value, out = $("#dxOut", v);
    out.innerHTML = `<div class="bub typing"><i></i><i></i><i></i></div>`;
    try {
      const r = await call({ action: "prepare", sym_in: i, sym_out: o, amount });
      const cmp = M.prov({ src: "Jupiter vs Binance", ts: Date.now(), kind: "paper", compare: { a: +r.check.price, b: +r.check.ref, srcA: "Jupiter", srcB: "Binance", tol: 0.01 } });
      out.innerHTML = `<div class="list"><div class="li"><div class="t"><b>Route: ${r.route.map(esc).join(" → ")} ${cmp}</b><small>price ${(+r.check.price).toFixed(4)} $ · Binance ${(+r.check.ref).toFixed(4)} $ · difference ${(100 * r.check.gap).toFixed(3).replace(".", ",")} %</small></div></div>
        <div class="li"><div class="t"><b>Programs: ${r.inspect.programs.map(esc).join(", ")}</b><small>all whitelisted · no third-party transfers</small></div></div>
        <div class="li"><div class="t"><b>Simulation passed on 2 RPCs</b><small>max network fee ${(+r.fee_sol).toFixed(6)} SOL · max slippage 0.5%</small></div></div></div>
        ${W().enabled ? `<button class="btn acc" id="dxExec">Execute with real funds</button>` : `<p class="small muted">To execute live, enable live trading.</p>`}`;
      const ex = $("#dxExec", out);
      if (ex) ex.onclick = async () => { if (!confirm(`Execute ${amount} ${i} → ${o} with real funds?`)) return; try { const x = await call({ action: "execute", sym_in: i, sym_out: o, amount }); toast(!x.ok ? "Network error: " + x.error : x.trade.status === "pendiente" ? "Sent; pending confirmation: click «Check pending» in one minute (do not re-submit)" : "Done: " + x.signature.slice(0, 10) + "…"); st.dexTrial = undefined; refresh(); } catch (er) { toast(er.message); } };
    } catch (er) { out.innerHTML = `<p class="small neg">${esc(er.message)}</p>`; }
  };
};
})();
