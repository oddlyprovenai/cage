/* Cage · System status: self-check upon opening (services + each tab) and backups in Account. */
(() => {
"use strict";
const M = window.Cage;
const { st, $, $$, esc, TABS, VIEWS, BIND, HOOKS, toast, render } = M;
const ICON = { ok: "●", aviso: "▲", fallo: "■" };

let noprov = [];
function tabTest() {
  // each tab renders off-screen with your current data: if any fails, it reports which
  const bad = [], keep = st.tab;
  noprov = [];
  for (const [id, l] of TABS) {
    if (!VIEWS[id]) continue;
    try {
      st.tab = id; const html = VIEWS[id]();
      if (typeof html !== "string") bad.push(`${l}: returns no content`);
      else if (M.prov) { const box = document.createElement("div"); box.innerHTML = html; const miss = M.prov.missing(box); if (miss.length) noprov.push(`${l} (${miss.length})`); }
    }
    catch (e) { bad.push(`${l}: ${String(e.message || e).slice(0, 80)}`); }
  }
  st.tab = keep;
  return bad;
}

async function check() {
  try {
    const h = await M.api("/api/health");
    const bad = tabTest();
    h.checks.push(bad.length ? { name: "Tabs", state: "fallo", detail: bad.join(" · "), fix: "notify Claude with this text" } : { name: "Tabs", state: "ok", detail: `${TABS.length} tabs rendered without errors` });
    if (bad.length) h.worst = "fallo";
    h.checks.push(noprov.length ? { name: "Data provenance", state: "aviso", detail: "Cards with numbers without source/date: " + noprov.join(" · "), fix: "in progress: source and timestamp being added to each card" } : { name: "Data provenance", state: "ok", detail: "all cards with numbers have source, timestamp, and status" });
    if (noprov.length && h.worst === "ok") h.worst = "aviso";
    st.health = h;
  } catch (e) { st.health = { worst: "fallo", checks: [{ name: "Server", state: "fallo", detail: e.message }] }; }
  if (st.tab === "hoy" || st.tab === "cuenta") render(true);
}

const after = HOOKS.afterLoad;
HOOKS.afterLoad = () => { after(); setTimeout(check, 1200); };

function card(full) {
  const h = st.health;
  if (!h) return "";
  const shown = full ? h.checks : h.checks.filter(c => c.state !== "ok");
  const pSys = M.prov({ src: "/api/health + tabTest", ts: Date.now(), kind: "real", short: "now" });
  if (!full && !shown.length) return `<div class="card span2 sys ok"><h3>System status ${pSys}</h3><p><span class="dot ok">●</span> Everything operational (${h.checks.length} checks)</p></div>`;
  return `<div class="card ${full ? "span6" : "span3"} sys ${h.worst}"><h3>System status ${pSys} <button class="btn sm ghost" data-sys="re">Check</button></h3>
    <div class="list">${shown.map(c => `<div class="li"><span class="dot ${c.state}">${ICON[c.state]}</span><div class="t"><b>${esc(c.name)}</b><small>${esc(c.detail)}</small>${c.fix ? `<small class="muted">${esc(c.fix)}</small>` : ""}</div></div>`).join("")}</div></div>`;
}
const hoy = HOOKS.hoy;
HOOKS.hoy = () => hoy() + card(false);

async function backups() {
  try { st.bk = await M.api("/api/backups"); } catch (e) { st.bk = { error: e.message }; }
  if (st.tab === "cuenta") render(true);
}
const vc = VIEWS.cuenta;
VIEWS.cuenta = () => {
  const b = st.bk;
  if (!b) backups();
  const last = b?.last_ok;
  const bk = !b ? "" : `<div class="card span6"><h3>Backups ${M.prov({ src: "/api/backups", ts: last?.ts ? last.ts * 1000 : st.data?.updated, kind: "real" })}</h3>
    <p>Cage saves an encrypted backup daily on this Mac (${b.daily || 0} saved). They can only be opened with your password.${last ? ` Last restore test: <b>successful</b> (${new Date(last.ts * 1000).toLocaleString("en-US")}).` : ""}</p>
    ${b.last && !b.last.ok ? `<p class="neg small">${esc(b.last.error || "")}</p>` : ""}
    <div class="f"><label>Backup outside the data folder</label><select class="in" id="bkDest"><option value="">Only on this Mac (default)</option>${(b.candidates || []).map(c => `<option value="${esc(c.path)}"${c.path === b.dest ? " selected" : ""}>${esc(c.kind)}: ${esc(c.name)}${c.note ? " — " + esc(c.note) : ""}</option>`).join("")}</select></div>
    <div class="row wrap"><button class="btn sm" data-bk="save">Save destination</button><button class="btn sm ghost" data-bk="run">Backup & test now</button></div>
    <p class="small muted">The ${b.keep} most recent backups are kept at the destination. If you connect an external drive, it will appear in the list.</p></div>`;
  const base = vc();
  const i = base.lastIndexOf("</div>");
  return (i > 0 ? base.slice(0, i) + card(true) + bk + base.slice(i) : base + card(true) + bk);
};
const bc = BIND.cuenta;
BIND.cuenta = v => {
  bc && bc(v);
  $$("[data-bk]", v).forEach(btn => btn.onclick = async () => {
    btn.disabled = true;
    try {
      if (btn.dataset.bk === "save") {
        const p = $("#bkDest", v).value;
        if (p && !confirm("Also save an encrypted backup to that destination every day?")) { btn.disabled = false; return; }
        st.bk = await M.api("/api/backups", { body: { action: "dest", path: p || null } });
        toast(p ? "Destination saved" : "Backups only on this Mac");
      } else { st.bk = await M.api("/api/backups", { body: { action: "run" } }); toast(st.bk.last?.ok ? "Backup created and restore tested" : (st.bk.last?.error || "Failed")); }
    } catch (e) { toast(e.message); }
    render(true);
  });
};
const bind = v => $$("[data-sys=re]", v).forEach(b => b.onclick = () => { st.health = null; check(); });
const bh = BIND.hoy;
BIND.hoy = v => { bh && bh(v); bind(v); };
const bc2 = BIND.cuenta;
BIND.cuenta = v => { bc2(v); bind(v); };
M.system = { check, tabTest };
})();
