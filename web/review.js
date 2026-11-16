/* Cage · Self-reviewing projects (block E). On launch, the assistant inspects each project with real data:
   commits from its repos, SPIKE training status (read-only, without interfering), and Obsidian notes (read-only).
   Detects bottlenecks, proposes or creates next steps based on autonomy settings, and summarizes what has happened
   since your last visit. Internal and reversible actions only. */
(() => {
"use strict";
const M = window.Cage, E = window.Engine;
const { st, esc, I, HOOKS, BIND, fdate, save, empty } = M;
const D = () => st.data, AS = () => M.assistant.AS();
const DAY = 864e5, STALE_DAYS = 14;
const norm = t => String(t).toLowerCase().normalize("NFD").replace(/[^\w ]+/g, "").replace(/\s+/g, " ").trim();

// on launch: remember previous visit and prior snapshot of SPIKE training
const after = HOOKS.afterLoad;
HOOKS.afterLoad = () => {
  const a = AS();
  st.prevVisit = a.last_visit || null;
  st.prevSpike = a.spike_seen || {};
  a.last_visit = Date.now();
  after();
  save();
};

// when SPIKE data arrives, persist its status for the next visit
function rememberSpike() {
  const seen = {};
  (st.spike || []).forEach(s => (s.training || []).forEach(t => { seen[s.project + ":" + t.specialist] = t.verdict || "in progress"; }));
  if (Object.keys(seen).length && JSON.stringify(seen) !== JSON.stringify(AS().spike_seen)) { AS().spike_seen = seen; save(); }
}

M.extraSuggestions = () => {
  const out = [], now = Date.now(), d = D();
  d.projects.forEach(p => {
    if (p.status !== "activo") return;
    // bottleneck: repo without commits in 14 days
    if (p.repo_paths.length && st.commits) {
      const last = Math.max(0, ...st.commits.filter(c => !c.error && c.project === p.id).map(c => c.ts * 1000));
      if (!last || now - last > STALE_DAYS * DAY) out.push({ id: `stale-${p.id}-${E.iso(now).slice(0, 7)}`, area: "Projects", areaKey: "proyectos", pr: 2,
        title: `${p.name} looks stalled`, why: last ? `No commits since ${fdate(E.iso(last))}` : "No commits in 180 days",
        action: { type: "task", project: p.id, title: `Review what is blocking ${p.name}`, priority: "alta" } });
    }
    // Obsidian next steps not yet converted to tasks
    const n = st.notes?.projects?.[p.id];
    if (n) {
      const have = new Set(p.tasks.map(t => norm(t.title)));
      n.main.steps.filter(x => !have.has(norm(x))).slice(0, 3).forEach(x => out.push({ id: `ob-${p.id}-${norm(x).slice(0, 40)}`, area: "Projects", areaKey: "proyectos", pr: 3,
        title: `Obsidian step for ${p.name}: ${x}`, why: "In your note but not in your tasks", action: { type: "task", project: p.id, title: x } }));
    }
  });
  // SPIKE: accepted training runs with pending milestone → mark milestone
  (st.spike || []).forEach(s => {
    const p = d.projects.find(x => x.id === s.project); if (!p) return;
    (s.training || []).filter(t => t.verdict === "aceptado").forEach(t => {
      const key = norm(t.specialist).split(" ")[0].replace(/\d+$/, "");
      const es = { medicine: "medicina", finance: "finanzas", marketing: "marketing", law: "derecho", code: "codigo" }[key] || key;
      const m = p.milestones.find(x => !x.done && (norm(x.title).includes(key) || norm(x.title).includes(es)));
      if (m) out.push({ id: `ms-${p.id}-${m.id}`, area: "Projects", areaKey: "proyectos", pr: 1, title: `Mark milestone: ${m.title}`,
        why: `SPIKE: ${t.specialist} listed as accepted in its repository`, action: { type: "milestone_done", project: p.id, milestone: m.id } });
    });
  });
  return out;
};

// autonomy: automatically apply project reviews if area allows it (once data has loaded)
let autoDone = false;
function autoReview() {
  if (autoDone || st.commits === null || st.notes === null || st.spike == null) return;
  autoDone = true;
  rememberSpike();
  if ((AS().autonomy || {}).proyectos !== "autonoma") return;
  const done = new Set(AS().log.map(l => l.sid)), skip = new Set(AS().dismissed);
  const acts = M.extraSuggestions().filter(s => s.action && E.SAFE.has(s.action.type) && !done.has(s.id) && !skip.has(s.id)).slice(0, 5);
  acts.forEach(s => { try { M.assistant.run(s, true); } catch { /* ignore */ } });
  if (acts.length) { save(); M.toast(`The assistant reviewed your projects and made ${acts.length} change${acts.length > 1 ? "s" : ""} (undo in Assistant)`); }
}

// "since your last visit"
function since() {
  const t0 = st.prevVisit, d = D(), items = [];
  if (!t0) return null;
  const C = (st.commits || []).filter(c => !c.error && c.ts * 1000 > t0);
  const byP = {}; C.forEach(c => byP[c.project] = (byP[c.project] || 0) + 1);
  Object.entries(byP).forEach(([pid, n]) => items.push([I.commit, `${n} commit${n > 1 ? "s" : ""} in ${d.projects.find(p => p.id === pid)?.name || pid}`, C.find(c => c.project === pid)?.subject || ""]));
  (st.spike || []).forEach(s => (s.training || []).forEach(t => {
    const k = s.project + ":" + t.specialist, was = st.prevSpike?.[k], now = t.verdict || "in progress";
    if (was !== undefined && was !== now) items.push([I.spark, `SPIKE · ${t.specialist}: ${was} → ${now}`, t.last]);
    else if (was === undefined && Object.keys(st.prevSpike || {}).length) items.push([I.spark, `SPIKE · new training run: ${t.specialist}`, t.last]);
  }));
  (st.notes?.recent || []).filter(n => n.mtime * 1000 > t0).slice(0, 4).forEach(n => items.push([I.flag, `Note updated: ${n.title}`, n.where === "." ? "Root" : n.where]));
  const closed = d.projects.flatMap(p => p.tasks.filter(x => x.done_at && new Date(x.done_at + "T23:59:59") > t0).map(x => x.title));
  if (closed.length) items.push(["✓", `${closed.length} closed task${closed.length > 1 ? "s" : ""}`, closed.slice(0, 3).join(" · ")]);
  const auto = AS().log.filter(l => l.auto && l.ts > t0);
  if (auto.length) items.push([I.spark, `The assistant made ${auto.length} change${auto.length > 1 ? "s" : ""}`, auto.slice(0, 2).map(l => l.desc).join(" · ")]);
  return { t0, items };
}

const hoy = HOOKS.hoy;
HOOKS.hoy = () => {
  autoReview();
  const s = since(), loading = st.commits === null || st.notes === null || st.spike == null;
  const card = !s ? "" : `<div class="card span6 since"><h3>Since your last visit <span class="badge m">${new Date(s.t0).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span> ${M.prov({ src: "Git + Obsidian + SPIKE", ts: s.t0, kind: "real" })}</h3>
    <div class="list">${s.items.map(([ic, t, sub]) => `<div class="li"><span class="lic">${ic}</span><div class="t"><b>${esc(t)}</b><small>${esc(sub || "")}</small></div></div>`).join("") || (loading ? empty("Checking your projects…", "") : empty("Nothing new", "No commits, notes, or SPIKE changes since then."))}</div></div>`;
  return card + hoy();
};
})();
