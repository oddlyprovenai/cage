/* Cage · Progress: your evolution with real data. A daily snapshot when opening Cage (charts grow on their own),
   project timelines, net worth and weight over time, habits with streaks, exportable weekly and monthly reports,
   and daily encrypted backup status. */
(() => {
"use strict";
const M = window.Cage, E = window.Engine;
const { st, $, $$, esc, uid, today, I, TABS, VIEWS, BIND, A, HOOKS, money, fdate, sum, toast, modal, save, render, head, empty, line, bars } = M;
const D = () => st.data;
const dd = s => s.slice(8) + "/" + s.slice(5, 7);

// daily snapshot on open (and after saving the first change of the day)
const after = HOOKS.afterLoad;
HOOKS.afterLoad = () => {
  after();
  const had = D().history.at(-1)?.date === E.iso(new Date());
  E.recordDaily(D());
  if (!had) save();
  M.api("/api/backups").then(b => { st.backups = b; }).catch(() => {});
};

Object.assign(A, {
  habit() {
    modal("New habit", [{ name: "name", label: "Habit (e.g., Workout, Read 20 min)", req: true }], o => {
      D().habits.push({ id: uid(), name: o.name.trim(), log: [], created: today() }); save(); render();
    });
  },
});
function toggleHabit(id, day) {
  const h = D().habits.find(x => x.id === id); if (!h) return;
  h.log = h.log.includes(day) ? h.log.filter(x => x !== day) : [...h.log, day].sort();
  save(); render(true);
}

function download(name, text) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/markdown" })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function period(kind) {
  const n = new Date(), to = E.iso(n);
  if (kind === "semana") { const m = new Date(n); m.setDate(m.getDate() - (m.getDay() + 6) % 7); return [E.iso(m), to]; }
  return [to.slice(0, 8) + "01", to];
}

VIEWS.progreso = () => {
  const d = D(), H = d.history, C = (st.commits || []).filter(c => !c.error);
  const W = d.health.weights.slice(-90);
  const days30 = [...Array(30)].map((_, i) => E.iso(Date.now() - (29 - i) * 864e5));
  const projRows = d.projects.map(p => {
    const cw = E.weekly(C.filter(c => c.project === p.id).map(c => c.ts * 1000), 12);
    const tw = E.weekly(p.tasks.filter(t => t.done_at).map(t => t.done_at), 12);
    const msd = p.milestones.filter(m => m.done).length;
    return { p, cw, tw, msd };
  });
  const lastWeek = projRows.reduce((a, r) => a + r.tw.at(-1).n, 0), commitsWeek = projRows.reduce((a, r) => a + r.cw.at(-1).n, 0);
  const b = st.backups;
  const pVault = M.prov({ src: "Encrypted vault", ts: d.updated, kind: "real" }), pHist = M.prov({ src: "Vault (history)", ts: H.at(-1)?.date || d.updated, kind: "real" }), pGit = M.prov({ src: "Local Git + vault", ts: C[0] ? C[0].ts * 1000 : d.updated, kind: "real" });
  return head("Progress", `Your evolution with real data. ${H.length} ${H.length === 1 ? "daily snapshot" : "daily snapshots"} since ${H[0] ? fdate(H[0].date) : "today"}: charts grow on their own each day you open Cage.`,
    `<div class="row"><button class="btn ghost" data-rep="semana">Weekly report</button><button class="btn" data-rep="mes">Monthly report</button></div>`) +
  `<div class="grid g-ov stagger">
    <div class="card mini"><div class="lbl">Tasks completed this week ${pVault}</div><div class="mid num" data-count="${lastWeek}" data-fmt="int">0</div></div>
    <div class="card mini"><div class="lbl">Commits this week ${pGit}</div><div class="mid num" data-count="${commitsWeek}" data-fmt="int">0</div></div>
    <div class="card mini"><div class="lbl">Milestones completed ${pVault}</div><div class="mid num" data-count="${sum(projRows, r => r.msd)}" data-fmt="int">0</div></div>
    <div class="card mini"><div class="lbl">Best habit streak ${pVault}</div><div class="mid num">${d.habits.length ? Math.max(...d.habits.map(h => E.streak(h.log))) + " days" : "—"}</div></div>
    <div class="card span2"><div class="lbl">Daily encrypted backup ${M.prov({ src: "Server (/api/backups)", ts: b?.last || d.updated, kind: "real" })}</div><div class="mid">${b ? (b.last ? "Today ✓" : "Pending") : "…"}</div><p class="small muted">${b ? `${b.daily} ${b.daily === 1 ? "backup" : "backups"} · kept for 30 days, encrypted, in Cage's private folder` : ""}</p></div>
    <div class="card span3"><h3>Net worth <span class="badge m">daily snapshots</span> ${pHist}</h3>${H.length >= 2 ? line(H.map(x => dd(x.date)), [{ name: "Net worth", color: "var(--acc)", values: H.map(x => x.net_worth), area: true }], { h: 200, fmt: v => money(v, 0), min: "auto", smooth: false }) : empty("Starts today", "Tomorrow you will have the second data point; one is added each day you open Cage.")}</div>
    <div class="card span3"><h3>Weight ${M.prov({ src: "Vault (health.weights)", ts: W.at(-1)?.date || d.updated, kind: "real" })}</h3>${W.length >= 2 ? line(W.map(w => dd(w.date)), [{ name: "Weight", color: "var(--blue)", values: W.map(w => w.kg), area: true }], { h: 200, fmt: v => v + " kg", min: "auto", smooth: false }) : empty("Not enough entries", `<button class="btn sm" data-act="weight">Log weight</button>`)}</div>
    ${projRows.map(({ p, cw, tw, msd }) => `<div class="card span3"><h3><span class="row"><span class="lic c" data-c="${esc(p.color)}">${esc(p.letter)}</span>${esc(p.name)}</span><span class="row"><span class="badge m">12 weeks</span>${pGit}</span></h3>
      ${cw.some(x => x.n) || tw.some(x => x.n) ? bars(cw.map(x => dd(x.week)), [{ name: "Commits", color: "var(--acc)", values: cw.map(x => x.n) }, { name: "Tasks completed", color: "var(--blue)", values: tw.map(x => x.n) }], { h: 170 }) : empty("No recorded activity", p.repo_paths.length ? "No commits in 12 weeks." : "No git repository; completed tasks will appear here.")}
      <div class="row between small"><span class="muted">${p.tasks.filter(t => t.status !== "done").length} open · ${msd}/${p.milestones.length} milestones</span><span>${(p.kpis || []).slice(0, 2).map(k => `${esc(k.label)}: <b>${esc(k.history?.at(-1)?.value ?? "—")}</b>`).join(" · ")}</span></div></div>`).join("")}
    <div class="card span6"><h3>Habits ${pVault} <button class="btn sm ghost" data-act="habit">${I.plus} Habit</button></h3>
      ${d.habits.length ? `<div class="habits"><div class="hrow head"><span></span>${days30.map(x => `<i title="${x}">${+x.slice(8)}</i>`).join("")}<b>Streak</b></div>
        ${d.habits.map(h => `<div class="hrow"><span>${esc(h.name)}</span>${days30.map(x => `<button class="hd ${h.log.includes(x) ? "on" : ""}" data-hab="${esc(h.id)}" data-day="${x}" aria-label="${esc(h.name)} ${x}"></button>`).join("")}<b class="num">${E.streak(h.log)}</b></div>`).join("")}</div>`
        : empty("No habits", "Create one and check off each day you complete it: you'll see your streak and the last 30 days.")}</div>
    <div class="card span6"><h3>Daily snapshots <span class="badge m">${H.length}</span> ${pHist}</h3><div class="scroll"><table class="tbl"><thead><tr><th>Date</th><th class="r">Net worth</th><th class="r">Monthly expense</th><th class="r">Subs/month</th><th class="r">Weight</th><th class="r">Open tasks</th><th class="r">Done</th></tr></thead><tbody>
      ${H.slice(-14).reverse().map(x => `<tr><td>${fdate(x.date)}</td><td class="r num">${money(x.net_worth, 0)}</td><td class="r num">${money(x.expense_month, 0)}</td><td class="r num">${money(x.subs_monthly, 0)}</td><td class="r num">${x.weight ?? "—"}</td><td class="r num">${x.tasks_open}</td><td class="r num">${x.tasks_done}</td></tr>`).join("")}</tbody></table></div></div>
  </div>`;
};
BIND.progreso = v => {
  $$("[data-hab]", v).forEach(b => b.onclick = () => toggleHabit(b.dataset.hab, b.dataset.day));
  $$("[data-rep]", v).forEach(b => b.onclick = () => {
    const [from, to] = period(b.dataset.rep), md = E.report(D(), from, to, st.commits || []);
    const m = $("#modal");
    m.innerHTML = `<div class="card"><h3>${b.dataset.rep === "semana" ? "Weekly" : "Monthly"} report <button class="ico" data-x aria-label="Close">✕</button></h3><pre class="rep">${esc(md)}</pre>
      <div class="row"><button class="btn" data-dl>Download .md</button><button class="btn ghost" data-cp>Copy</button></div></div>`;
    m.hidden = false;
    const close = () => { m.hidden = true; m.innerHTML = ""; };
    $("[data-x]", m).onclick = close; m.onclick = e => { if (e.target === m) close(); };
    $("[data-dl]", m).onclick = () => download(`cage-report-${from}_${to}.md`, md);
    $("[data-cp]", m).onclick = () => navigator.clipboard?.writeText(md).then(() => toast("Report copied"), () => toast("Could not copy"));
  });
};
TABS.splice(1, 0, ["progreso", "Progress"]);
})();
