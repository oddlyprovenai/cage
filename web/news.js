/* Cage · News connected to the agent: filterable list by asset with source, timestamp, and link; price chart with
   markers for each news item; active circuit breakers; earnings calendar; event study results; alerts in Today
   for assets you hold in your portfolio. News text is DATA: always escaped, never instructions. */
(() => {
"use strict";
const M = window.Cage;
const { st, $, $$, esc, VIEWS, BIND, HOOKS, render, empty, line } = M;
const NAME = { BTCUSDT: "Bitcoin", ETHUSDT: "Ethereum", SOLUSDT: "Solana", BNBUSDT: "BNB", XRPUSDT: "XRP", DOGEUSDT: "Dogecoin", AAPL: "Apple", MSFT: "Microsoft", NVDA: "NVIDIA", AMZN: "Amazon", GOOGL: "Alphabet", META: "Meta", "ASML.AS": "ASML", "SAP.DE": "SAP", "NOVO-B.CO": "Novo Nordisk", "MC.PA": "LVMH", "BRK-B": "Berkshire", JNJ: "J&J", "IWDA.AS": "MSCI World", "IEAG.AS": "Euro Bonds", MACRO: "Macro" };
const when = ts => new Date(ts * 1000).toLocaleString("en-US", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const pc = (v, d = 1) => v === null || v === undefined || !isFinite(v) ? "—" : (100 * v).toFixed(d).replace(".", ",") + " %";

function newsRow(x) {
  return `<div class="li news"><span class="lic ${x.grave ? "grave" : ""}">${x.grave ? "!" : "·"}</span><div class="t"><a class="nt" href="${esc(x.link)}" target="_blank" rel="noopener noreferrer">${esc(x.title)}</a>
    <small>${esc(x.origin || x.via)} · ${when(x.published)} · ${x.assets.map(a => esc(NAME[a] || a)).join(", ")}${x.kinds.length ? " · " + x.kinds.map(esc).join(", ") : ""}</small></div></div>`;
}
M.newsRow = newsRow;

function noticias(t) {
  const n = t.news || {}, items = n.items || [], sel = st.newsAsset || "all";
  const assets = [...new Set(items.flatMap(x => x.assets))].sort((a, b) => items.filter(x => x.assets.includes(b)).length - items.filter(x => x.assets.includes(a)).length);
  const shown = items.filter(x => sel === "all" || x.assets.includes(sel)).slice(0, 60);
  const study = n.study || {};
  const px = st.newsPrices?.asset === sel ? st.newsPrices.rows : null;
  let chart = "";
  if (sel !== "all" && sel !== "MACRO") {
    if (!px) { M.api("/api/trading/control", { body: { action: "prices", asset: sel } }).then(r => { st.newsPrices = r; render(true); }).catch(() => {}); chart = empty("Loading prices…", ""); }
    else if (px.length > 2) {
      const days = px.map(r => r[0]);
      const marks = items.filter(x => x.assets.includes(sel)).map(x => { const d = new Date(x.published * 1000).toISOString().slice(0, 10); const i = days.findIndex(k => k >= d); return { i, tip: x.title.slice(0, 90), color: x.grave ? "var(--neg)" : "var(--acc)" }; }).filter(m => m.i >= 0);
      chart = line(days.map(d => d.slice(8) + "/" + d.slice(5, 7)), [{ name: NAME[sel] || sel, color: "var(--blue)", values: px.map(r => +r[1].toFixed(4)), area: true }], { w: 1100, h: 220, min: "auto", smooth: false, marks }) + `<p class="small muted">Daily close in quoting currency (90 days). Each marker is a news item; in red, severe ones. Hover to read.</p>`;
    } else chart = empty("No cached prices for this asset", "");
  }
  const st2 = study.model ? `Out-of-sample study (${esc(study.from || "")} → ${esc(study.to || "")}, test from ${esc(study.test_from || "")}): Brier with news ${(+study.model["con noticias"].brier).toFixed(4).replace(".", ",")}, without news ${(+study.model["sin noticias"].brier).toFixed(4).replace(".", ",")}, base rate ${(+study.model.base.brier).toFixed(4).replace(".", ",")}. <b>${esc(study.verdict)}</b>.` : "Event study pending.";
  const ts = n.ts ? n.ts * 1000 : st.data?.updated, pNews = M.prov({ src: "Public RSS + Nasdaq (/api/trading)", ts, kind: "real" });
  return `<div class="grid g-ov stagger">
    <div class="card span6 honest"><h3>How the agent uses news ${pNews}</h3><p>${st2} News <b>never opens or expands</b> positions: it only acts as a circuit breaker (pausing an asset for 24 h upon hack, delisting, sanction, or insolvency, and around earnings releases). Its text is treated as data, never as instruction.</p>
      <p class="small muted">Verified free keyless sources: ${(n.sources || []).length} feeds (Cointelegraph, CoinDesk, Decrypt, The Block, ECB, Federal Reserve, SEC, Yahoo Finance, and Google News filtered to reliable outlets; Nasdaq earnings calendar; GDELT for the study). Updated ${n.ts ? when(n.ts) : "—"}${Object.keys(n.errors || {}).length ? ` · with error: ${Object.keys(n.errors).map(esc).join(", ")}` : ""}.</p></div>
    <div class="card span3"><h3>Active circuit breakers ${pNews}</h3><div class="list">${Object.entries(n.brakes || {}).map(([a, why]) => `<div class="li"><span class="lic grave">!</span><div class="t"><b>${esc(NAME[a] || a)}</b><small>${esc(why)}</small></div></div>`).join("") || empty("None", "No assets paused by news.")}</div></div>
    <div class="card span3"><h3>Upcoming earnings ${M.prov({ src: "Nasdaq Calendar", ts, kind: "real" })}</h3><div class="list">${Object.entries(n.earnings || {}).map(([a, d]) => `<div class="li"><span class="lic">R</span><div class="t"><b>${esc(NAME[a] || a)}</b><small>reports earnings on ${esc(d)}</small></div></div>`).join("") || empty("None in 10 days", "Nasdaq public calendar.")}</div></div>
    <div class="card span6"><div class="row between wrap"><div class="row wrap">${["all", ...assets].map(a => `<button class="chip ${sel === a ? "on" : ""}" data-na="${esc(a)}">${a === "all" ? "All" : esc(NAME[a] || a)} <small class="muted">${a === "all" ? items.length : items.filter(x => x.assets.includes(a)).length}</small></button>`).join("")}</div>${pNews}</div>
      ${chart}<div class="list">${shown.map(newsRow).join("") || empty("No news", "")}</div></div>
  </div>`;
}

// "News" section in agent tab
const base = VIEWS.trading;
VIEWS.trading = () => {
  const tab = st.trTab || "cartera";
  if (tab !== "noticias") return base().replace('<div class="seg" id="trTabs">', `<div class="seg" id="trTabs"><button data-tt="noticias">News</button>`);
  st.trTab = "resumen";
  let html = base();
  st.trTab = tab;
  html = html.replace('data-tt="resumen" class="on"', 'data-tt="resumen" class=""').replace('<div class="seg" id="trTabs">', `<div class="seg" id="trTabs"><button data-tt="noticias" class="on">News</button>`);
  const t = st.trading;
  if (!t || t.error) return html;
  const cut = html.indexOf('<div class="grid g-ov stagger">', html.indexOf('class="disc"'));
  return (cut > 0 ? html.slice(0, cut) : html) + noticias(t);
};
const bt = BIND.trading;
BIND.trading = v => { bt && bt(v); $$("[data-na]", v).forEach(b => b.onclick = () => { st.newsAsset = b.dataset.na; st.newsPrices = null; render(true); }); };

// alerts in Today: severe news or earnings for assets held by the user (registered live portfolio + paper portfolios)
let cache = null;
const after = HOOKS.afterLoad;
HOOKS.afterLoad = () => { after(); M.api("/api/trading").then(r => { cache = r; if (st.tab === "hoy") render(true); }).catch(() => {}); };
const hoy = HOOKS.hoy;
HOOKS.hoy = () => {
  const n = cache?.news;
  if (!n) return hoy();
  const held = new Set([...(st.data.portfolio?.holdings || []).map(h => String(h.symbol).toUpperCase()), ...Object.values(cache.longterm?.sleeves || {}).flatMap(s => Object.keys(s.weights || {}))]);
  const match = a => held.has(a) || held.has(a.replace("USDT", "")) || held.has((NAME[a] || "").toUpperCase());
  const alerts = [...Object.entries(n.brakes || {}).filter(([a]) => match(a)).map(([a, w]) => `<div class="li"><span class="lic grave">!</span><div class="t"><b>${esc(NAME[a] || a)}</b><small>${esc(w)}</small></div></div>`),
    ...(n.items || []).filter(x => x.grave && x.assets.some(match) && Date.now() / 1000 - x.published < 3 * 86400).slice(0, 3).map(newsRow)];
  return (alerts.length ? `<div class="card span6 newsalert"><h3>Important news for your portfolio ${M.prov({ src: "Public RSS + Nasdaq", ts: n.ts ? n.ts * 1000 : st.data?.updated, kind: "real" })} <button class="btn sm ghost" data-go="trading">View ${"→"}</button></h3><div class="list">${alerts.join("")}</div></div>` : "") + hoy();
};
})();
