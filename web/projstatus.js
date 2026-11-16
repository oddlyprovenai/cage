/* Cage · Unified project status dashboard (stoplight, last progress, blocker, next step; read-only from repos, tasks,
   and SPIKE) and "Only you can answer": pending decisions that no one else can make. */
(() => {
"use strict";
const M = window.Cage, E = window.Engine;
const { st, $$, esc, VIEWS, BIND, HOOKS, save, render } = M;
const D = () => st.data;
const LIGHT = { verde: "pos", "ámbar": "warn", rojo: "neg", gris: "muted" };

function board() {
  const rows = E.projectStatus(D(), st.commits || [], st.spike || []);
  return `<div class="card span6 projboard"><h3>Project Status ${M.prov({ src: "Git + vault + SPIKE", ts: D().updated, kind: "real" })}</h3><table class="tbl"><thead><tr><th></th><th>Project</th><th>Last progress</th><th>Blocker</th><th>Next step</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td><span class="dot ${LIGHT[r.light]}" title="${esc(r.light)}">●</span></td><td><b>${esc(r.name)}</b><br><small class="muted">${r.open} open tasks</small>${r.spec ? `<br><small>${r.spec.accepted.length ? "accepted: " + r.spec.accepted.map(esc).join(", ") : ""}${r.spec.rejected.length ? " · rejected (for now): " + r.spec.rejected.map(esc).join(", ") : ""}${r.spec.running.length ? " · in progress: " + r.spec.running.map(esc).join(", ") : ""}</small>` : ""}</td>
      <td>${r.last ? `${esc(r.last.what.slice(0, 70))}<br><small class="muted">${r.age} day${r.age === 1 ? "" : "s"} ago</small>` : `<small class="muted">${st.commits === null ? "reading…" : "no progress recorded"}</small>`}</td>
      <td>${r.block ? esc(r.block) : '<small class="muted">—</small>'}</td><td>${r.next ? esc(r.next) : '<small class="muted">define next step</small>'}</td></tr>`).join("")}</tbody></table>
    <p class="small muted">Green: progress in the last 7 days and no blockers. Amber: paused for more than 7 days or has a blocker. Red: more than 21 days without progress. Data from repositories, tasks, and SPIKE training runs (read-only).</p></div>`;
}

function decisions() {
  const d = D(), dis = new Set(d.decisions_dismissed || []), out = [];
  const add = (id, title, why, go) => { if (!dis.has(id)) out.push({ id, title, why, go }); };
  if (st.mail && !st.mail.configured) add("mail", "Connect your email", "Requires your Gmail app password; only you can generate it.", "correo");
  if (!d.calendar) add("cal", "Connect your calendar", "Paste the private iCal address from Google Calendar.", "agenda");
  if (!d.health_apple) add("health", "Export data from Apple Health app", "From iPhone: Health → your photo → Export all health data; leave it in Downloads.", "salud");
  if (st.bk && !st.bk.dest) add("backup", "Choose where to store a copy outside your Mac", "External drive or iCloud Drive (it will be encrypted).", "cuenta");
  (d.projects || []).filter(p => !p.description && !p.folder && !p.spike && p.kind !== "invest").forEach(p => add("what-" + p.id, `What is "${p.name}" and what do you want to achieve?`, "With a single sentence and a folder or repository, I can track its progress.", "proyectos"));
  if (!(d.accounts || []).length) add("accounts", "Set up your real accounts and balances", "Without real balances, net worth and emergency cushion cannot be calculated.", "finanzas");
  if (!d.invest_profile?.risk) add("risk", "Confirm your risk profile", "Currently using \"moderado\" by default.", "inversion");
  add("broker", "Choose a broker for stocks and ETFs (if you ever trade live)", "Cage is not connected to a broker: currently it only suggests orders.", "trading");
  add("capital", "Set maximum capital for real money", "Live mode is disabled; if you enable it, you set the limit.", "trading");
  add("sec", "Set a contact email for SEC queries (EDGAR)", "The SEC requires a contact email for automated queries; Cage will not use yours without permission.", "trading");
  return out;
}

function decisionsCard(full) {
  const ds = decisions();
  if (!ds.length) return "";
  return `<div class="card ${full ? "span6" : "span3"} decide" data-noprov="decisiones"><h3>Only you can answer <span class="badge m">${ds.length}</span></h3><div class="list">${ds.slice(0, full ? 20 : 5).map(x => `<div class="li"><div class="t"><b>${esc(x.title)}</b><small>${esc(x.why)}</small></div><button class="btn sm ghost" data-dgo="${esc(x.go)}">Go</button><button class="btn sm ghost" data-ddis="${esc(x.id)}" title="Already decided or not applicable">Done</button></div>`).join("")}</div></div>`;
}

const vp = VIEWS.proyectos;
VIEWS.proyectos = () => {
  const base = vp(), card = board() + decisionsCard(true);
  const i = base.indexOf('<div class="grid');
  if (i < 0) return card + base;
  const j = base.indexOf(">", i) + 1;
  return base.slice(0, j) + card + base.slice(j);
};
const hoy = HOOKS.hoy;
HOOKS.hoy = () => hoy() + decisionsCard(false);
function bind(v) {
  $$("[data-dgo]", v).forEach(b => { b.onclick = () => M.go(b.dataset.dgo); });
  $$("[data-ddis]", v).forEach(b => { b.onclick = () => { const d = D(); d.decisions_dismissed = [...new Set([...(d.decisions_dismissed || []), b.dataset.ddis])]; save(); render(true); }; });
}
const bp = BIND.proyectos;
BIND.proyectos = v => { if (bp) bp(v); bind(v); };
const bh = BIND.hoy;
BIND.hoy = v => { if (bh) bh(v); bind(v); };
})();
