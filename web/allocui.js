/* Cage · Agent → "Allocator" (what to buy and how much, with separate roles) and "20 per market" (episodes, causes,
   and what typically follows, with statistical tests). All in paper; live mode remains off. */
(() => {
"use strict";
const M = window.Cage;
const { st, $, $$, esc, VIEWS, BIND, toast, render, empty } = M;
const pc = (v, d = 1) => v === null || v === undefined || !isFinite(v) ? "—" : (100 * v).toFixed(d).replace(".", ",") + " %";
const sp = (v, d = 1) => v === null || v === undefined || !isFinite(v) ? "—" : (v > 0 ? "+" : "") + pc(v, d);
const n2 = v => v === null || v === undefined ? "—" : (+v).toFixed(2).replace(".", ",");
const eur = v => v === null || v === undefined ? "—" : new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
const NAME = { "IWDA.AS": "MSCI World", "EMIM.AS": "Emerging Markets", "IEAG.AS": "Euro Bonds", "XEON.DE": "Liquidity", "4GLD.DE": "Gold", BTCUSDT: "Bitcoin", ETHUSDT: "Ethereum", SOLUSDT: "Solana" };
const MK = { us: "US", eu: "Europe", asia: "Asia", crypto: "Crypto" };
const TABS2 = { asignador: "Allocator", mercados: "20 per market" };

function asignador(t) {
  const a = t.allocator || {};
  if (!a.target) return empty("The allocator decides at the next daily update", "The 24/7 service runs it once a day with live prices.");
  const ev = a.eval || {}, ms = ev.methods || {}, f = a.fast || {};
  const rows = Object.entries(a.target).sort((x, y) => y[1] - x[1]);
  const pAl = M.prov({ src: "allocator (Yahoo + Binance, daily closes)", ts: a.ts, kind: "diario" });
  return `<div class="grid g-ov stagger">
    <div class="card span6 honest"><h3>Today's decision ${pAl}</h3><p>Selected method: <b>${esc(ms[a.method]?.label || a.method)}</b>. ${a.method === "indexed" ? "No optimization method beats indexed with sufficient margin after costs and taxes, so indexed is retained." : "This method beats indexed according to the pre-set rule."} ${esc(ev.rule || "")}</p>
      <p class="small muted">Analyst proposes → Risk can veto → Executor applies in paper. Live mode: <b>DISABLED</b>; for stocks there are only proposals that you would execute yourself.</p></div>
    <div class="card span3"><h3>Allocation & rationale ${pAl}</h3><div class="list">${rows.map(([s, w]) => { const y = (a.why || {})[s] || {}; return `<div class="li"><div class="t"><b>${esc(NAME[s] || s)} · ${pc(w)}</b><small>${esc(y.role || (s === "XEON.DE" && f.share ? "includes fast sleeve in liquidity" : ""))}${y.why_pct ? " · " + esc(y.why_pct) : ""}${y.trend ? " · " + esc(y.trend) : ""}</small><small class="muted">${esc(y.news_note || "")}${(y.news || []).map(n => ` · <a href="${esc(n.link || "#")}" target="_blank" rel="noopener noreferrer">${esc(n.title.slice(0, 70))}</a>`).join("")}</small><small class="muted">Invalidated by: ${esc(y.invalidate || "—")}</small></div></div>`; }).join("")}</div></div>
    <div class="card span3"><h3>Fast sleeve ${pAl}</h3><div class="big num">${pc(f.share, 0)}</div><p><b>${esc(f.status || "")}</b>${f.n_tests ? ` · ${f.n_tests} hypotheses tested in "20 per market", ${(f.supported || []).length} supported` : " · \"20 per market\" study still in progress"}.</p>
      <form id="fastF" class="row wrap"><label class="small">Size (0–10%)</label><input class="in w-auto" name="share" type="number" min="0" max="10" step="1" value="${Math.round(100 * (f.share ?? 0.05))}"><button class="btn sm" type="submit">Save</button>${f.halted ? `<button class="btn sm ghost" type="button" id="fastReset">Reactivate</button>` : ""}</form>
      <p class="small muted">Individual maximum loss: 15% from its peak; if reached, paused until you reactivate it.</p>
      ${(a.vetoes || []).length ? `<h3>Risk vetoes today</h3><ul class="notes">${a.vetoes.map(v => `<li>${esc(v)}</li>`).join("")}</ul>` : `<p class="small muted">Risk has not vetoed anything today.</p>`}</div>
    <div class="card span6"><h3>Measured methods (${esc(ev.from || "")} → ${esc(ev.to || "")}, profile ${esc(ev.profile || "")}, costs and taxes included) ${M.prov({ src: "Local backtest (Yahoo + Binance)", ts: ev.to || a.ts, kind: "calc" })}</h3><div class="scroll"><table class="tbl"><thead><tr><th>Method</th><th class="r">Annual ret.</th><th class="r">Volatility</th><th class="r">Max drawdown</th><th class="r">Sharpe</th><th class="r">Taxes</th></tr></thead><tbody>${Object.entries(ms).map(([k, r]) => `<tr class="${k === a.method ? "on" : ""}"><td>${esc(r.label)}${k === a.method ? " ✓" : ""}</td><td class="r num">${pc(r.cagr, 2)}</td><td class="r num">${pc(r.vol)}</td><td class="r num">${pc(r.max_dd)}</td><td class="r num">${n2(r.sharpe)}</td><td class="r num">${eur(r.taxes)}</td></tr>`).join("")}</tbody></table></div>
      <p class="small muted">${ms.index && ms[a.method] ? (ms[a.method].cagr >= ms.index.cagr ? "The chosen portfolio returned more than the index in this period." : `The chosen portfolio does NOT beat the index in return (${pc(ms[a.method].cagr, 2)} vs ${pc(ms.index.cagr, 2)}): in exchange it has lower volatility and smaller drawdown, per your profile.`) : ""} ${ev.n_variants || 0} methods evaluated.</p></div>
    ${reevalCard(t)}
    <div class="card span6"><h3>Paper value ${M.prov({ src: "Allocator (paper)", ts: a.ts, kind: "paper" })}</h3><p class="big num">${eur(a.value)}</p><p class="small muted">Contributed ${eur(a.book?.contributed)} · fees ${eur(a.book?.fees)} · estimated taxes ${eur(a.book?.taxes)}</p>
      ${(a.proposals || []).length ? `<h3>Latest order proposals</h3><table class="tbl"><tbody>${a.proposals.slice(-8).reverse().map(o => `<tr><td>${esc(o.day)}</td><td>${o.side === "compra" ? "Buy" : "Sell"} ${esc(NAME[o.sym] || o.sym)}</td><td class="r num">${o.qty}</td><td class="small muted">${esc(o.reason)}</td></tr>`).join("")}</tbody></table>` : ""}</div>
  </div>`;
}

function reevalCard(t) {
  const R = t.reevals || [], r = R[R.length - 1];
  const notes = (t.lt_notes || []).map(n => `<li>${esc(n.note)}</li>`).join("");
  if (!r) return "";
  const P = Object.entries(r.papers || {}), V = Object.entries(r.round3?.variants || {}).filter(([, x]) => x.n).sort((a, b) => (b[1].excess_mean_daily || 0) - (a[1].excess_mean_daily || 0));
  return `<div class="card span6"><h3>Monthly re-evaluation with new data <span class="badge m">${esc(r.month)}</span> ${M.prov({ src: "Out-of-sample (/api/trading)", ts: r.month || st.data?.updated, kind: "calc" })}</h3>
    <p class="small">Selected rules are NOT re-selected each month (that would overfit): we only measure how they perform with data that arrived afterwards. That out-of-sample period grows every month.</p>
    <table class="tbl"><thead><tr><th>Paper portfolio</th><th>Since</th><th class="r">Return</th><th class="r">MSCI World same period</th></tr></thead><tbody>${P.map(([k, x]) => `<tr><td>${esc(k)}</td><td>${esc(x.from || "—")}</td><td class="r num">${x.ret == null ? esc(x.note || "—") : sp(x.ret, 2)}</td><td class="r num">${sp(x.index_ret, 2)}</td></tr>`).join("")}</tbody></table>
    <p class="small muted">Round 3 (crypto) since ${esc(r.round3?.since || "—")}: ${V.length ? V.slice(0, 4).map(([k, x]) => `${esc(k)} ${sp(x.excess_mean_daily * 365, 1)}/yr excess (${x.n} days)`).join(" · ") : "no new days yet"}. ${r.movers?.since ? "New episodes of \"20 per market\" since " + esc(r.movers.since) + "." : ""} Over a few weeks, these figures are noise: they become meaningful as months accumulate.</p>
    ${notes ? `<ul class="notes small">${notes}</ul>` : ""}</div>`;
}

const CAUSE = { resultados: "earnings", previsiones: "guidance", analistas: "analysts", "legal/regulación": "legal/regulation", "fusiones/operaciones": "M&A/deals", "producto/negocio": "product/business", directivos: "executives", cripto: "crypto", macro: "macro", sector: "sector", "mercado/macro": "market/macro", "sin causa identificada": "no identified cause", "sin datos de noticias (antes de 2017)": "no news data (before 2017)" };
const causeEn = c => CAUSE[c] || c || "—";
function mercados(t) {
  const m = t.movers || {};
  if (!m.cards) return empty("The \"20 per market\" study is running", "Downloads 16 years of prices, detects abnormal moves, and attributes causes from earnings and news. Takes a few hours due to news rate limits.");
  const mk = st.mvMk || "us", cards = Object.entries(m.cards).filter(([, c]) => c.market === mk);
  const tests = (m.tests || []);
  const sel = st.mvSym && m.cards[st.mvSym] ? st.mvSym : null;
  const pMv = M.prov({ src: "20 per market study (Yahoo + GDELT)", ts: m.split || st.data?.updated, kind: "calc" });
  return `<div class="grid g-ov stagger">
    <div class="card span6 honest"><h3>What has statistical support ${pMv}</h3><p>${(m.supported || []).length ? "<b>Supported</b> (development + holdout + costs): " + m.supported.map(esc).join(" · ") : "<b>No pattern passes all tests.</b> What appears to repeat in the past does not hold out-of-sample or does not cover costs, so it does not inform decisions."}</p>
      <p class="small muted">${m.n_episodes} episodes across ${Object.keys(m.cards).length} assets; ${m.attributed} with identified cause (remainder: «no identified cause», never hallucinated). ${m.n_tests} hypotheses tested with Benjamini-Hochberg correction; development up to ${esc(m.split)} and holdout thereafter. ${esc(m.bias || "")}</p></div>
    <div class="card span6"><h3>Tests <span class="badge m">${m.n_tests} hypotheses</span> ${pMv}</h3><div class="scroll"><table class="tbl"><thead><tr><th>Hypothesis</th><th class="r">Development</th><th class="r">95% CI</th><th class="r">Cases</th><th class="r">Holdout</th><th class="r">Cases</th><th>Verdict</th></tr></thead><tbody>${tests.map(x => `<tr><td>${esc(x.name)}</td><td class="r num ${x.dev_sig_bh ? "pos" : ""}">${sp(x.dev?.mean, 2)}</td><td class="r num small">${x.dev?.ci ? sp(x.dev.ci[0], 1) + " / " + sp(x.dev.ci[1], 1) : "—"}</td><td class="r num">${x.dev?.n_dates ?? "—"}</td><td class="r num">${sp(x.hold?.mean, 2)}</td><td class="r num">${x.hold?.n_dates ?? "—"}</td><td>${x.supported ? "✔ supported" : x.dev_sig_bh ? "does not hold" : "not significant"}</td></tr>`).join("")}</tbody></table></div>
      <p class="small muted">Excess returns over respective market, measured from the close of the day following the episode (the actionable trade). Dates grouped to avoid double-counting the same market day.</p></div>
    <div class="card span2"><h3>Companies ${pMv}</h3><div class="seg" id="mvMk">${Object.entries(MK).map(([k, l]) => `<button data-mk="${k}" class="${k === mk ? "on" : ""}">${l}</button>`).join("")}</div>
      <div class="list">${cards.map(([s, c]) => `<button class="li linkish" data-sym="${esc(s)}"><div class="t"><b>${esc(c.name || s)}</b><small>${c.error ? "no data" : `${c.n} episodes · after drops, 20 sessions: ${sp(c.after_drop?.[20]?.mean)}`}</small></div></button>`).join("")}</div></div>
    <div class="card span4" id="mvCard">${sel ? "" : `<h3>Company detail ${pMv}</h3>` + empty("Select a company", "You will see its sharp rises and drops, likely cause, and subsequent performance.")}</div>
  </div>`;
}

async function card(sym) {
  const box = $("#mvCard");
  if (!box) return;
  box.innerHTML = `<div class="bub typing"><i></i><i></i><i></i></div>`;
  try {
    const c = await M.api("/api/trading/movers", { body: { sym } });
    const causes = Object.entries(c.causes || {}).sort((a, b) => b[1] - a[1]);
    const row = (lbl, o) => `<tr><td>${lbl}</td>${[5, 20, 60].map(h => `<td class="r num">${sp(o?.[h]?.mean)}<small class="muted"> (${o?.[h]?.n ?? 0}; ${pc(o?.[h]?.pos, 0)} rise)</small></td>`).join("")}</tr>`;
    box.innerHTML = `<h3>${esc(c.name)} <span class="badge m">${esc(sym)}</span> ${M.prov({ src: "Yahoo Finance + GDELT", ts: c.episodes?.[0]?.date || st.data?.updated, kind: "calc" })}</h3>
      <table class="tbl"><thead><tr><th>After…</th><th class="r">5 sessions</th><th class="r">20 sessions</th><th class="r">60 sessions</th></tr></thead><tbody>${row("a sharp drop", c.after_drop)}${row("a sharp rise", c.after_rise)}</tbody></table>
      <p class="small muted">Excess over its market. Median days to recover price after a drop: ${c.recover_median || "—"}. Averages for this single company: with few cases they are noise; rely on the hypothesis testing table.</p>
      <p><b>Causes:</b> ${causes.map(([k, v]) => `${esc(causeEn(k))} ${v}`).join(" · ")}</p>
      <div class="scroll"><table class="tbl"><thead><tr><th>Date</th><th class="r">Day</th><th class="r">Own</th><th>Probable cause</th><th class="r">+20 sess.</th></tr></thead><tbody>${(c.episodes || []).map(e => `<tr><td>${esc(e.date)}</td><td class="r num ${e.ret > 0 ? "pos" : "neg"}">${sp(e.ret)}</td><td class="r num">${sp(e.own)}</td><td><b>${esc(causeEn(e.cause))}</b>${(e.evidence || []).length ? `<br><small class="muted">${e.evidence.map(esc).join(" · ")}</small>` : ""}</td><td class="r num">${sp(e.nx20)}</td></tr>`).join("")}</tbody></table></div>`;
  } catch (e) { box.innerHTML = `<p class="small neg">${esc(e.message)}</p>`; }
}

const base = VIEWS.trading;
VIEWS.trading = () => {
  const tab = st.trTab || "cartera";
  const btns = on => Object.entries(TABS2).map(([k, l]) => `<button data-tt="${k}"${k === on ? ' class="on"' : ""}>${l}</button>`).join("");
  if (!TABS2[tab]) return base().replace('<div class="seg" id="trTabs">', '<div class="seg" id="trTabs">' + btns(null));
  st.trTab = "resumen";
  let html = base();
  st.trTab = tab;
  html = html.replace('data-tt="resumen" class="on"', 'data-tt="resumen" class=""').replace('<div class="seg" id="trTabs">', '<div class="seg" id="trTabs">' + btns(tab));
  const cut = html.indexOf('<div class="grid g-ov stagger">', html.indexOf('class="disc"'));
  const t = st.trading || {};
  return (cut > 0 ? html.slice(0, cut) : html) + (tab === "asignador" ? asignador(t) : mercados(t));
};
const bt = BIND.trading;
BIND.trading = v => {
  bt && bt(v);
  const tab = st.trTab || "";
  if (tab === "asignador") {
    const f = $("#fastF", v);
    if (f) f.onsubmit = async e => { e.preventDefault(); try { await M.api("/api/trading/fast", { body: { share: (+f.share.value || 0) / 100 } }); toast("Saved: applies on next update"); } catch (er) { toast(er.message); } };
    const r = $("#fastReset", v);
    if (r) r.onclick = async () => { try { await M.api("/api/trading/fast", { body: { share: (st.trading?.allocator?.fast?.share ?? 0.05), reset: true } }); toast("Sleeve reactivated"); } catch (er) { toast(er.message); } };
  }
  if (tab === "mercados") {
    $$("[data-mk]", v).forEach(b => b.onclick = () => { st.mvMk = b.dataset.mk; st.mvSym = null; render(true); });
    $$("[data-sym]", v).forEach(b => b.onclick = () => { st.mvSym = b.dataset.sym; card(b.dataset.sym); });
    if (st.mvSym) card(st.mvSym);
  }
};
})();
