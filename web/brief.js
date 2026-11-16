/* Cage · "Your Day" in Today (what's due today, what happened yesterday, proposals) and weekly/monthly reviews generated
   automatically when opening Cage for the first time each week/month. Only from your logged data. */
(() => {
"use strict";
const M = window.Cage, E = window.Engine;
const { st, $, $$, esc, VIEWS, BIND, HOOKS, save, empty } = M;
const D = () => st.data;
const eur = v => (+v).toFixed(2).replace(".", ",") + " €";

function ext() { return { events: D().calendar?.events || [], reminders: D().reminders?.items || [], mail: st.mail?.items || [] }; }

const after = HOOKS.afterLoad;
function makeReviews() {
  const d = D(), now = new Date();
  d.reviews ||= [];
  let made = 0;
  for (const kind of ["week", "month"]) {
    const r = E.review(d, kind, now, st.commits || []);
    if (!d.reviews.some(x => x.kind === kind && x.from === r.from)) {
      d.reviews.push({ ...r, created: new Date().toISOString().slice(0, 16) });
      made++;
    }
  }
  if (made) { d.reviews = d.reviews.slice(-60); save(); }
}
// deferred: on startup other modules save concurrently and a version conflict would discard reviews
HOOKS.afterLoad = () => { after(); setTimeout(makeReviews, 4000); };

const hoy = HOOKS.hoy;
HOOKS.hoy = () => {
  const b = E.dailyBrief(D(), new Date(), ext());
  const rows = [
    ...b.tasks.map(t => [t.late ? "Overdue" : "Today", `${t.title}`, t.project]),
    ...b.events.map(e => ["Calendar", e.title, e.allday ? "all day" : e.start.slice(11, 16)]),
    ...b.reminders.map(r => ["Reminder", r.title, r.list || ""]),
    ...b.renewals.map(r => ["Renewal", r.title, `${eur(r.amount)} · ${r.days === 0 ? "today" : `in ${r.days} days`}`]),
    ...b.bills.map(x => ["Email", x, "today's date in email"]),
    ...b.docs.map(x => ["Document", x.title, `expires on ${x.expires}`]),
  ];
  const last = (D().reviews || []).slice(-1)[0];
  const card = `<div class="card span3 brief"><h3>Your Day ${M.prov({ src: "your data + calendar + email", ts: Date.now(), kind: "tu", short: "now" })}</h3>
    ${rows.length ? `<div class="list">${rows.slice(0, 10).map(([k, t, s]) => `<div class="li"><span class="badge m">${esc(k)}</span><div class="t"><b>${esc(t)}</b><small>${esc(s)}</small></div></div>`).join("")}</div>` : `<p>Nothing due today.</p>`}
    <p class="small muted">Yesterday you spent ${eur(b.spentYesterday)}. ${b.proposals ? `${b.proposals} proposal${b.proposals > 1 ? "s" : ""} from Assistant${b.top.length ? ": " + b.top.map(esc).join(" · ") : ""}.` : "No pending proposals."}${last ? ` Last review: ${last.kind === "week" ? "weekly" : "monthly"} ${esc(last.from)} → ${esc(last.to)} (in Reports).` : ""}</p></div>`;
  return card + hoy();
};

const vi = VIEWS.informes;
VIEWS.informes = () => {
  const R = (D().reviews || []).slice().reverse();
  const sel = st.revSel ?? 0, r = R[sel];
  const card = `<div class="card span6"><h3>Automated reviews <span class="badge m">${R.length}</span> ${M.prov({ src: "Calculated from vault + Git", ts: r?.created || D().updated, kind: "calc" })}</h3>${R.length ? `<div class="row wrap">${R.slice(0, 12).map((x, i) => `<button class="btn sm ${i === sel ? "" : "ghost"}" data-rev="${i}">${x.kind === "week" ? "Week" : "Month"} ${esc(x.from.slice(5))}</button>`).join("")}<span class="spacer"></span><button class="btn sm ghost" data-rev-dl>Download</button></div>
    <pre class="md">${esc(r.md)}</pre>` : empty("No reviews yet", "They are generated automatically every Monday (previous week) and on the 1st of each month (previous month).")}</div>`;
  const base = vi(), i = base.lastIndexOf("</div>");
  return i > 0 ? base.slice(0, i) + card + base.slice(i) : base + card;
};
const bi = BIND.informes;
BIND.informes = v => {
  bi && bi(v);
  $$("[data-rev]", v).forEach(b => b.onclick = () => { st.revSel = +b.dataset.rev; M.render(true); });
  const dl = $("[data-rev-dl]", v);
  if (dl) dl.onclick = () => { const r = (D().reviews || []).slice().reverse()[st.revSel ?? 0]; const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([r.md], { type: "text/markdown" })); a.download = `cage-review-${r.kind}-${r.from}.md`; a.click(); };
};
})();
