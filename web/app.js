/* Cage — frontend (base Cage HQ). All local; no external dependencies. */
(() => {
"use strict";
const { bars, line, spark, donut, esc, fmtK } = window.Charts;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => crypto.getRandomValues(new Uint32Array(2)).reduce((a, b) => a + b.toString(36), "").slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);
const MES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const I = {
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  bell: '<svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24"><path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  out: '<svg viewBox="0 0 24 24"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg>',
  grid: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="6" rx="2"/><rect x="14" y="4" width="6" height="6" rx="2"/><rect x="4" y="14" width="6" height="6" rx="2"/><rect x="14" y="14" width="6" height="6" rx="2"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  arrow: '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M7 17 17 7M8 7h9v9"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M17 7 7 17M16 17H7V8"/></svg>',
  commit: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.5"/><path d="M3 12h5.5M15.5 12H21"/></svg>',
  spark: '<svg viewBox="0 0 24 24"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/></svg>',
  send: '<svg viewBox="0 0 24 24"><path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/></svg>',
  flag: '<svg viewBox="0 0 24 24"><path d="M5 21V4h11l-2 4 2 4H5"/></svg>',
  shield: '<svg viewBox="0 0 24 24"><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/></svg>',
};

const TABS = [
  ["hoy", "Today"], ["proyectos", "Projects"], ["finanzas", "Finances"], ["suscripciones", "Subscriptions"],
  ["salud", "Health"], ["inversion", "Investment"], ["ia", "Assistant"], ["informes", "Reports"], ["cuenta", "Account"],
];

const st = { data: null, version: "", csrf: "", tab: "hoy", proj: "all", notes: null, commits: null, aiStatus: null,
  chat: null, actFilter: "all", invView: "real", lastAct: Date.now() };

/* ---------------- API ---------------- */
async function api(path, opt = {}) {
  let r;
  try {
    r = await fetch(path, {
      method: opt.method || (opt.body ? "POST" : "GET"),
      headers: { "Content-Type": "application/json", "X-Cage-CSRF": st.csrf || "" },
      body: opt.body ? JSON.stringify(opt.body) : undefined, credentials: "same-origin", cache: "no-store",
    });
  } catch { throw new Error("Cage shut down due to inactivity. Open it again using “Cage” on your Desktop."); }
  let js = {};
  try { js = await r.json(); } catch { /* download */ }
  if (r.status === 401 && !opt.noGate) { gateLogin(); throw new Error("locked"); }
  if (!r.ok) { const e = new Error(js.error || r.statusText); e.status = r.status; e.body = js; throw e; }
  // a server action that writes to the vault (wallet, memory, email, agenda…) bumps the version: your data
  // is reloaded so the next save doesn't overwrite what the server just wrote
  if ((opt.body || opt.method === "POST") && path !== "/api/data" && /^\/api\/(trading\/wallet|memory|mail|life|backups|agent)/.test(path)) syncAfterServerWrite();
  return js;
}
let syncT = null;
function syncAfterServerWrite() {
  clearTimeout(syncT);
  syncT = setTimeout(async () => {
    if (saveT || saving) { syncAfterServerWrite(); return; }  // first your pending changes are saved; then reloaded
    try {
      const r = await api("/api/data");
      if (!saveT && !saving) {
        // what the server writes (wallet, agenda, Health…) doesn't change the version: only that slice is copied
        for (const k of ["dex_wallet", "dex_trades", "dex_trial", "calendar", "reminders", "health_apple", "memory"]) { if (k in r.data) st.data[k] = r.data[k]; else delete st.data[k]; }
        if (String(r.version) !== String(st.version)) { st.data = normalize(r.data); st.version = r.version; }
        st.updated = r.updated;
        const a = document.activeElement;
        if (!(a && /INPUT|TEXTAREA|SELECT/.test(a.tagName))) render(true);
      }
    } catch { /* keep what's there */ }
  }, 300);
}

let saveT = null;
function save() { clearTimeout(saveT); saveT = setTimeout(() => { saveT = null; doSave(); }, 350); }
let saving = null, again = false;
async function doSave() {
  if (saving) { again = true; return saving; }  // queued: never two saves at once (they would conflict)
  saving = doSave1();
  try { await saving; } finally { saving = null; if (again) { again = false; doSave(); } }
}
async function doSave1() {
  try {
    window.Engine?.stampDone(st.data);
    const r = await api("/api/data", { body: { data: st.data, version: st.version } });
    st.version = r.version; st.updated = r.updated;
  } catch (e) {
    if (e.status === 409) { st.data = normalize(e.body.data); st.version = e.body.version; toast("Data updated by another session (Claude). Reloaded."); render(); }
    else if (e.message !== "locked") toast("Could not save: " + e.message);
  }
}

/* ---------------- helpers ---------------- */
const cur = () => st.data?.profile?.currency || "EUR";
const money = (v, d = 2) => new Intl.NumberFormat("es-ES", { style: "currency", currency: cur(), maximumFractionDigits: d, minimumFractionDigits: d }).format(v || 0);
const fdate = s => { if (!s) return ""; const d = new Date(s.length <= 10 ? s + "T00:00:00" : s); return `${d.getDate()} ${MES[d.getMonth()]} ${d.getFullYear()}`; };
const P = id => st.data.projects.find(p => p.id === id);
const projs = () => st.proj === "all" ? st.data.projects : st.data.projects.filter(p => p.id === st.proj);
const ledger = () => st.data.ledger.filter(e => st.proj === "all" || e.project === st.proj);
const sum = (a, f) => a.reduce((s, x) => s + (f ? f(x) : x), 0);
function months(n = 12) { const d = new Date(), r = []; for (let i = n - 1; i >= 0; i--) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); r.push([x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0"), MES[x.getMonth()]]); } return r; }
function byMonth(entries, type) { const ms = months(); return ms.map(([k]) => sum(entries.filter(e => e.type === type && e.date.startsWith(k)), e => +e.amount)); }
const greet = () => { const h = new Date().getHours(); return h < 6 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; };
const projColor = id => P(id)?.color || "#888";
const prov = o => window.Cage?.prov ? window.Cage.prov(o) : "";
function toast(m) { const t = $("#toast"); t.textContent = m; t.hidden = false; t.style.animation = "none"; void t.offsetWidth; t.style.animation = ""; clearTimeout(t._t); t._t = setTimeout(() => t.hidden = true, 3200); }

function post(root) {
  $$("[data-i]", root).forEach(e => e.style.setProperty("--i", e.dataset.i));
  $$("[data-c]", root).forEach(e => e.style.setProperty("--c", e.dataset.c));
  $$("[data-w]", root).forEach(e => requestAnimationFrame(() => requestAnimationFrame(() => e.style.setProperty("--w", e.dataset.w))));
  $$("[data-len]", root).forEach(e => e.style.setProperty("--len", e.dataset.len));
  $$("[data-count]", root).forEach(countUp);
}
function countUp(el) {
  const to = +el.dataset.count, fmt = el.dataset.fmt || "money", t0 = performance.now(), D = 900;
  const f = v => fmt === "money" ? money(v) : fmt === "int" ? Math.round(v).toLocaleString("es-ES") : (Math.round(v * 10) / 10).toLocaleString("es-ES");
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || el.closest(".no-anim")) { el.textContent = f(to); return; }
  const step = t => { const p = Math.min(1, (t - t0) / D), e = 1 - Math.pow(1 - p, 3); el.textContent = f(to * e); if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
// tooltips
const tip = document.createElement("div"); tip.className = "tip"; tip.hidden = true; document.body.appendChild(tip);
document.addEventListener("mouseover", e => { const t = e.target.closest?.("[data-tip]"); if (!t) { tip.hidden = true; return; } tip.textContent = t.dataset.tip; tip.hidden = false; });
document.addEventListener("mousemove", e => { if (!tip.hidden) { tip.style.left = e.clientX + "px"; tip.style.top = e.clientY + "px"; } });

/* ---------------- modal ---------------- */
function modal(title, fields, onOk, okText = "Save") {
  const m = $("#modal");
  m.innerHTML = `<form class="card"><h3>${esc(title)}<button type="button" class="ico" data-x aria-label="Close">✕</button></h3>${fields.map(f => {
    const v = f.value ?? "";
    if (f.type === "select") return `<div class="f"><label>${esc(f.label)}</label><select class="in" name="${f.name}">${f.options.map(o => `<option value="${esc(o[0])}" ${String(o[0]) === String(v) ? "selected" : ""}>${esc(o[1])}</option>`).join("")}</select></div>`;
    if (f.type === "textarea") return `<div class="f"><label>${esc(f.label)}</label><textarea class="in" name="${f.name}">${esc(v)}</textarea></div>`;
    return `<div class="f"><label>${esc(f.label)}</label><input class="in" name="${f.name}" type="${f.type || "text"}" value="${esc(v)}" ${f.step ? `step="${f.step}"` : ""} ${f.req ? "required" : ""} autocomplete="off"></div>`;
  }).join("")}<div class="row"><button class="btn" type="submit">${esc(okText)}</button><button class="btn ghost" type="button" data-x>Cancel</button></div></form>`;
  m.hidden = false;
  const form = $("form", m);
  form.onsubmit = e => { e.preventDefault(); const o = Object.fromEntries(new FormData(form)); if (onOk(o) !== false) close(); };
  const close = () => { m.hidden = true; m.innerHTML = ""; };
  $$("[data-x]", m).forEach(b => b.onclick = close);
  m.onclick = e => { if (e.target === m) close(); };
  setTimeout(() => $("input,select,textarea", form)?.focus(), 50);
}

/* ---------------- gate (setup / login) ---------------- */
function showGate(html) { $("#app").hidden = true; const g = $("#gate"); g.hidden = false; g.innerHTML = html; post(g); }
function strength(p) { let s = 0; if (p.length >= 12) s++; if (p.length >= 16) s++; if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++; if (/\d/.test(p)) s++; if (/[^\w]/.test(p)) s++; return s; }

function gateSetup(token) {
  showGate(`<form class="card stagger" id="sf"><div class="gate-logo"><img class="logo xl" src="/logo.svg" alt="Cage"></div>
    <h1>Create your password</h1><p class="muted">Your password encrypts all data on this Mac. It cannot be recovered: keep it safe.</p>
    <div class="f"><label>Your name</label><input class="in" name="name" value="" placeholder="e.g. Alex" maxlength="40" required autocomplete="given-name"></div>
    <div class="f"><label>Password (min. 12 characters)</label><input class="in" name="p1" type="password" autocomplete="new-password" required minlength="12"></div>
    <div class="meter"><i id="mt"></i></div>
    <div class="f"><label>Repeat password</label><input class="in" name="p2" type="password" autocomplete="new-password" required></div>
    <p class="small neg" id="err"></p><button class="btn acc" type="submit">Create password and enter</button></form>`);
  const f = $("#sf");
  f.p1.oninput = () => { const s = strength(f.p1.value), mt = $("#mt"); mt.style.setProperty("--w", s * 20 + "%"); mt.style.setProperty("--c", s < 3 ? "var(--neg)" : s < 4 ? "#E0A33A" : "var(--pos)"); };
  f.onsubmit = async e => {
    e.preventDefault();
    if (f.p1.value !== f.p2.value) return fail("Passwords do not match");
    if (f.p1.value.length < 12) return fail("Minimum 12 characters");
    try { const r = await api("/api/setup", { body: { token, password: f.p1.value, name: f.name.value }, noGate: true }); st.csrf = r.csrf; history.replaceState(null, "", "/"); await loadAll(); }
    catch (er) { fail(er.message); }
  };
  const fail = m => { $("#err").textContent = m; f.classList.remove("shake"); void f.offsetWidth; f.classList.add("shake"); };
}

function gateLogin(msg = "") {
  st.data = null; st.csrf = "";
  showGate(`<form class="card stagger" id="lf"><div class="gate-logo"><img class="logo xl" src="/logo.svg" alt="Cage"></div>
    <h1>Cage</h1><p class="muted">Private dashboard. Encrypted data on this Mac.</p>
    <div class="f"><label>Password</label><input class="in" name="p" type="password" autocomplete="current-password" required autofocus></div>
    <p class="small neg" id="err">${esc(msg)}</p><button class="btn acc" type="submit">${I.lock.replace("<svg", '<svg width="15"')} Unlock</button></form>`);
  const f = $("#lf"); setTimeout(() => f.p.focus(), 60);
  f.onsubmit = async e => {
    e.preventDefault();
    try { const r = await api("/api/login", { body: { password: f.p.value }, noGate: true }); st.csrf = r.csrf; await loadAll(); }
    catch (er) { f.p.value = ""; $("#err").textContent = er.status === 429 ? `Too many attempts. Wait ${er.body.retry}s.` : er.message; f.classList.remove("shake"); void f.offsetWidth; f.classList.add("shake"); }
  };
}

async function loadAll() {
  const r = await api("/api/data");
  st.data = r.data; st.version = r.version; st.updated = r.updated; st.agent = r.agent; st.data.goals ||= []; normalize(st.data);
  $("#gate").hidden = true; $("#app").hidden = false;
  shell(); render(); HOOKS.afterLoad();
  api("/api/ai/status").then(s => { st.aiStatus = s; if (st.tab === "ia") render(true); }).catch(() => {});
  api("/api/git").then(s => { st.commits = s.commits; if (["hoy", "progreso", "proyectos"].includes(st.tab)) render(true); }).catch(() => { st.commits = []; render(true); });
  api("/api/notes").then(n => { st.notes = n; if (["hoy", "proyectos"].includes(st.tab)) render(true); }).catch(() => { st.notes = { error: "unavailable", projects: {}, recent: [] }; });
  api("/api/spike").then(s => { st.spike = s.spike; if (["hoy", "proyectos"].includes(st.tab)) render(true); }).catch(() => { st.spike = []; render(true); });
}

function normalize(d) {
  for (const k of ["accounts", "budgets", "subscriptions", "habits", "goals", "chats", "history"]) d[k] ||= [];
  d.health ||= {}; d.health.profile ||= {}; d.health.plan ||= {};
  for (const k of ["weights", "meals", "foods", "water", "exercise", "sleep"]) d.health[k] ||= [];
  d.portfolio ||= { cash: 0, holdings: [], paper_trades: [] }; d.portfolio.paper_trades ||= [];
  d.invest_profile ||= {};
  return d;
}

/* ---------------- shell ---------------- */
function shell() {
  const nav = $("#tabs");
  $$(".tab", nav).forEach(b => b.remove());
  TABS.forEach(([id, l]) => { const b = document.createElement("button"); b.className = "tab"; b.dataset.tab = id; b.textContent = l; b.onclick = () => go(id); nav.appendChild(b); });
  $("#btnAdd").innerHTML = I.plus; $("#btnHelp").textContent = "?"; $("#btnSpend").innerHTML = I.down; $("#btnSearch").innerHTML = I.search; $("#btnBell").insertAdjacentHTML("afterbegin", I.bell); $("#btnClock").innerHTML = I.clock;
  $('[data-theme-set="light"]').innerHTML = I.sun; $('[data-theme-set="dark"]').innerHTML = I.moon;
  $("#btnLock").innerHTML = I.lock; $("#btnLogout").innerHTML = I.out;
  const ini = ((st.data.profile.name || "C").match(/[\p{L}\p{N}]/u) || ["C"])[0].toUpperCase();
  $$("img.logo").forEach(i => { i.src = "/logo.svg?i=" + encodeURIComponent(ini); });  // logo with user's initial
  $("#userName").textContent = st.data.profile.name; $("#userAv").textContent = (st.data.profile.name[0] || "U").toUpperCase();
  rail(); themeBtns(); bell();
}
function rail() {
  const r = $("#projRail");
  r.innerHTML = `<button class="pj ${st.proj === "all" ? "on" : ""}" data-p="all" data-tip="All projects">${I.grid}</button>` +
    st.data.projects.map(p => `<button class="pj ${st.proj === p.id ? "on" : ""}" data-p="${esc(p.id)}" data-tip="${esc(p.name)}">${esc(p.letter || p.name[0])}<i data-c="${esc(p.color)}"></i></button>`).join("");
  $$(".pj", r).forEach(b => b.onclick = () => { st.proj = b.dataset.p; rail(); render(); });
  post(r);
}
function moveInd(instant) {
  const on = $(`.tab[data-tab="${st.tab}"]`), ind = $("#tabInd");
  $$(".tab").forEach(t => t.classList.toggle("on", t === on));
  if (!on) return;
  if (instant) ind.style.transition = "none";
  ind.classList.add("blur");
  ind.style.width = on.offsetWidth + "px"; ind.style.transform = `translateX(${on.offsetLeft}px)`;
  setTimeout(() => ind.classList.remove("blur"), 450);
  if (instant) { void ind.offsetWidth; ind.style.transition = ""; }
  const nav = $("#tabs"); if (on.offsetLeft < nav.scrollLeft || on.offsetLeft + on.offsetWidth > nav.scrollLeft + nav.clientWidth) nav.scrollTo({ left: on.offsetLeft - 20, behavior: "smooth" });
}
function go(tab) {
  if (tab === st.tab) return;
  const v = $("#view"), dir = TABS.findIndex(t => t[0] === tab) > TABS.findIndex(t => t[0] === st.tab) ? "r" : "l";
  v.classList.remove("enter-r", "enter-l"); v.classList.add("leaving", "leave-" + dir);
  st.tab = tab; moveInd();
  setTimeout(() => { v.classList.remove("leaving", "leave-r", "leave-l"); render(); v.classList.add("enter-" + dir); setTimeout(() => v.classList.remove("enter-" + dir), 450); scrollTo({ top: 0 }); }, 170);
}
function bell() {
  const n = overdue().length; $("#bellDot").hidden = !n;
}
function overdue() { const t = today(); return st.data.projects.flatMap(p => p.tasks.filter(x => x.status !== "done" && x.due && x.due < t).map(x => ({ ...x, p }))); }

/* theme with circular reveal like the video */
function getTheme() { try { return localStorage.getItem("cage-theme") || "light"; } catch { return "light"; } }
function themeBtns() { const t = document.documentElement.dataset.theme || "light"; $$("[data-theme-set]").forEach(b => b.classList.toggle("on", b.dataset.themeSet === t)); }
function setTheme(t, ev) {
  if ((document.documentElement.dataset.theme || "light") === t) return;
  const apply = () => { document.documentElement.dataset.theme = t; themeBtns(); try { localStorage.setItem("cage-theme", t); } catch {} };
  if (!document.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) return apply();
  const x = ev?.clientX ?? 40, y = ev?.clientY ?? 140, r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const ds = document.documentElement.style; ds.setProperty("--tx", x + "px"); ds.setProperty("--ty", y + "px"); ds.setProperty("--tr", r + "px");
  document.startViewTransition(apply);
}

/* ---------------- next steps (reglas) ---------------- */
function ruleSteps() {
  const t = today(), out = [];
  for (const p of projs()) {
    p.tasks.filter(x => x.status !== "done" && x.due && x.due < t).forEach(x => out.push({ p, title: x.title, why: `Overdue on ${fdate(x.due)}`, pr: 0, task: x }));
    p.tasks.filter(x => x.status === "doing").forEach(x => out.push({ p, title: x.title, why: "In progress", pr: 1, task: x }));
    p.tasks.filter(x => x.status === "todo" && x.priority === "alta").forEach(x => out.push({ p, title: x.title, why: "High priority", pr: 2, task: x }));
    const nm = p.milestones.find(m => !m.done); if (nm) out.push({ p, title: nm.title, why: "Next milestone" + (nm.date ? " · " + fdate(nm.date) : ""), pr: 3 });
    if (!p.description) out.push({ p, title: `Define the goal for ${p.name}`, why: "No description", pr: 4, fix: "edit" });
    if (!st.data.ledger.some(e => e.project === p.id)) out.push({ p, title: `Record income and expenses for ${p.name}`, why: "No performance data", pr: 5, fix: "money" });
    if (!p.tasks.length) out.push({ p, title: `Add the first tasks for ${p.name}`, why: "No tasks", pr: 5, fix: "task" });
  }
  return out.sort((a, b) => a.pr - b.pr);
}

/* ---------------- render ---------------- */
function render(quiet = false) {
  if (!st.data) return;
  const sy = scrollY;
  $("#view").classList.toggle("no-anim", quiet); // late-arriving data: without repeating entrance animation
  moveInd(!render.done); render.done = true;
  const v = $("#view");
  v.innerHTML = VIEWS[st.tab]();
  $$(".stagger > *", v).forEach((e, i) => e.style.setProperty("--i", i));
  post(v); (BIND[st.tab] || (() => {}))(v); bindCommon(v); bell(); HOOKS.afterRender(v);
  if (quiet) scrollTo(0, sy);
}
function head(t, s, right = "") { return `<div class="head"><div><h1>${t}</h1><p>${s}</p></div>${right}</div>`; }
const scopeName = () => st.proj === "all" ? "all your projects" : P(st.proj).name;
function empty(t, s) { return `<div class="empty"><svg class="empty-ico" viewBox="0 0 56 44" aria-hidden="true"><rect x="6" y="6" width="44" height="30" rx="8" fill="none" stroke="currentColor" stroke-opacity=".28" stroke-width="1.8"/><path d="M16 17h24M16 24h14" stroke="currentColor" stroke-opacity=".45" stroke-width="1.8" stroke-linecap="round"/><circle class="empty-dot" cx="41" cy="13" r="4.5" fill="var(--acc)"/></svg><b>${t}</b><span class="empty-s">${s || ""}</span></div>`; }

const HOOKS = { hoy: () => "", proyecto: () => "", afterLoad: () => {}, chatExtra: () => ({}), afterRender: () => {}, help: () => {} }; // life.js adds cards to Today
const VIEWS = {
  hoy() {
    const f = focus(), N = st.notes, d = new Date();
    const fecha = d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
    const total = f.late.length + f.dueToday.length + f.doing.length;
    const lastInc = ledger().filter(e => e.type === "income").at(-1)?.date || null;
    return head(`${greet()}, ${esc(st.data.profile.name)}`, `${fecha.charAt(0).toUpperCase() + fecha.slice(1)} · focus of ${esc(scopeName())}`,
      `<span class="small muted kbd-hint">Shortcuts: <kbd>1</kbd>–<kbd>${Math.min(9, TABS.length)}</kbd> tabs · <kbd>g</kbd> expense · <kbd>n</kbd> task · <kbd>a</kbd> add · <kbd>⌘K</kbd> search</span>`) +
    `<div class="grid g-ov stagger">
      <div class="card span6 quick" data-noprov="quick task form"><form id="qf" class="row"><span class="lic">${I.plus}</span><input class="in" name="t" placeholder="Add a quick task… (Enter)" autocomplete="off" maxlength="200">
        <select class="in w-auto" name="p">${st.data.projects.map(p => `<option value="${esc(p.id)}" ${p.id === (st.proj === "all" ? st.data.projects[0]?.id : st.proj) ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>
        <select class="in w-auto" name="pr"><option value="alta">High</option><option value="media" selected>Medium</option><option value="baja">Low</option></select><button class="btn" type="submit">Add</button></form></div>
      <div class="card mini ${f.late.length ? "neg-bg" : ""}"><div class="lbl">Overdue ${prov({ src: "your tasks", ts: f.late[0]?.x?.due || null, kind: "tu" })}</div><div class="mid num" data-count="${f.late.length}" data-fmt="int">0</div></div>
      <div class="card mini"><div class="lbl">Due today ${prov({ src: "your tasks", ts: today(), kind: "tu" })}</div><div class="mid num" data-count="${f.dueToday.length}" data-fmt="int">0</div></div>
      <div class="card mini"><div class="lbl">In progress ${prov({ src: "your tasks", ts: f.doing[0]?.x?.created || null, kind: "tu" })}</div><div class="mid num" data-count="${f.doing.length}" data-fmt="int">0</div></div>
      <div class="card mini pos-bg"><div class="lbl">Pending milestones ${prov({ src: "your projects", ts: f.next[0]?.m?.date || null, kind: "tu" })}</div><div class="mid num" data-count="${f.next.length}" data-fmt="int">0</div></div>
      <div class="card span2"><div class="lbl">Real income this month ${prov({ src: "your transactions", ts: lastInc, kind: "tu" })}</div><div class="mid num" data-count="${sum(ledger().filter(e => e.type === "income" && e.date.startsWith(months()[11][0])), e => +e.amount)}">0</div><p class="small muted">Only what you record yourself.</p></div>
      <div class="card span4"><h3>Today's focus ${prov({ src: "your tasks", ts: today(), kind: "tu" })}<span class="badge m">${total + Math.min(4, f.high.length)} ${total + Math.min(4, f.high.length) === 1 ? "task" : "tasks"}</span></h3><div class="list">
        ${[...f.late.map(o => taskRow(o, "overdue", "")), ...f.dueToday.map(o => taskRow(o, "today", "b")), ...f.doing.map(o => taskRow(o, "in progress")), ...f.high.slice(0, 4).map(o => taskRow(o, "high"))].join("") || empty("Nothing urgent", "No overdue, due today, or in-progress tasks. Choose a milestone on the right.")}</div></div>
      <div class="card span2"><h3>Next milestone ${prov({ src: "your projects", ts: f.next[0]?.m?.date || null, kind: "tu" })}</h3><div class="list">${f.next.map(({ p, m }) => `<div class="li"><span class="lic c" data-c="${esc(p.color)}">${esc(p.letter)}</span><div class="t"><b>${esc(m.title)}</b><small>${esc(p.name)}${m.date ? " · " + fdate(m.date) : ""}</small></div></div>`).join("") || empty("No milestones", "Add them in Projects.")}</div></div>
      ${HOOKS.hoy()}
      ${goalsCard().replace('class="card span6"', 'class="card span4"')}
      <div class="card span2"><h3>Latest notes ${prov({ src: "Obsidian vault", ts: N?.recent?.[0]?.mtime || null, kind: "tu" })}<span class="badge m">Obsidian</span></h3><div class="list">${N === null ? empty("Reading…", "") : N.error && !N.recent.length ? empty("No vault access", esc(N.error)) : N.recent.slice(0, 6).map(x => `<a class="li link" href="${esc(x.url)}"><span class="lic">${I.flag}</span><div class="t"><b>${esc(x.title)}</b><small>${esc(x.where === "." ? "Root" : x.where)} · ${new Date(x.mtime * 1000).toLocaleDateString("en-GB")}</small></div></a>`).join("") || empty("No notes", "")}</div></div>
    </div>`;
  },
  proyectos() {
    const p = st.proj === "all" ? st.data.projects[0] : P(st.proj);
    if (!p) return head("Projects", "") + empty("No projects", "Create the first one.");
    const done = p.milestones.filter(m => m.done).length, tot = p.milestones.length;
    const k = p.kpis[0], kv = k?.history?.at(-1);
    const net = sum(st.data.ledger.filter(e => e.project === p.id), e => e.type === "income" ? +e.amount : -e.amount);
    const cols = [["todo", "To Do"], ["doing", "In Progress"], ["done", "Done"]];
    const commits = (st.commits || []).filter(c => !c.error && c.project === p.id);
    return head(esc(p.name), esc(p.description || "No description yet."), `<div class="row"><button class="btn ghost" data-act="editproj">Edit</button><button class="btn" data-act="newproj">${I.plus} New project</button></div>`) +
    `<div class="row wrap" id="pchips">${st.data.projects.map(x => `<button class="chip ${x.id === p.id ? "on" : ""}" data-p="${esc(x.id)}">${esc(x.name)}</button>`).join("")}</div><br>
    <div class="grid g-ov stagger">
      <div class="span4"><div class="hero" data-c="${esc(p.color)}"><div class="row between"><span class="tag">${esc(p.kind || "Project")} · ${esc(p.status)}</span><span class="meta">${commits.length} commits · 180 days</span></div>
        <div class="hv num">${kv ? `<span data-count="${kv.value}" data-fmt="dec">0</span><small>${esc(k.unit)} · ${esc(k.label)}</small>` : `<span data-count="${net}">0</span><small>net</small>`}</div>
        <div class="bar"><i data-w="${tot ? Math.round(100 * done / tot) : 0}%"></i></div>
        <div class="row between"><span class="meta">${done}/${tot} milestones completed</span><span class="meta">Net ${money(net)}</span></div><br>
        <div class="row"><button class="btn" data-act="kpi">${I.plus} Record KPI</button><button class="btn" data-act="money">${I.plus} Transaction</button></div></div></div>
      <div class="card span2"><h3>Milestones ${prov({ src: "your milestones", ts: p.milestones.at(-1)?.date || null, kind: "tu" })}<button class="btn sm ghost" data-act="milestone">${I.plus}</button></h3><div class="list">
        ${p.milestones.map(m => `<div class="li"><button class="ck ${m.done ? "on" : ""}" data-ms="${esc(m.id)}" aria-label="Complete"></button><div class="t"><b class="${m.done ? "done-t" : ""}">${esc(m.title)}</b><small>${fdate(m.date)}</small></div><button class="ico" data-del-ms="${esc(m.id)}" aria-label="Delete">✕</button></div>`).join("") || empty("No milestones", "Add key milestones for the project.")}</div></div>
      <div class="card span6"><h3>Tasks ${prov({ src: "your tasks", ts: p.tasks.at(-1)?.created || null, kind: "tu" })}<button class="btn sm ghost" data-act="task">${I.plus} Task</button></h3>
        <div class="kan">${cols.map(([c, l]) => `<div class="col" data-col="${c}"><h4>${l}<span>${p.tasks.filter(t => t.status === c).length}</span></h4>${p.tasks.filter(t => t.status === c).map(t => `<div class="task" draggable="true" data-task="${esc(t.id)}"><b class="${c === "done" ? "done-t" : ""}">${esc(t.title)}</b><small>${esc(t.priority || "")}${t.due ? " · " + fdate(t.due) : ""}${t.source === "ia" ? " · suggested by AI" : ""}</small></div>`).join("")}</div>`).join("")}</div>
        <p class="small muted">Drag cards between columns. Double-click to edit.</p></div>
      <div class="card span3"><h3>KPIs ${prov({ src: "your KPIs", ts: kv?.date || null, kind: "tu" })}</h3><div class="list">${p.kpis.map(k => { const h = k.history || []; return `<div class="li"><div class="t"><b>${esc(k.label)}</b><small>${h.length ? fdate(h.at(-1).date) : "no data"}</small></div><div class="w120">${spark(h.map(x => +x.value), p.color)}</div><span class="num mid">${h.length ? esc(h.at(-1).value) : "—"}<small class="small muted"> ${esc(k.unit || "")}</small></span></div>`; }).join("") || empty("No KPIs", "Track metrics (users, sales, accuracy…).")}</div></div>
      ${notesCard(p)}
      ${HOOKS.proyecto(p)}
      ${p.spike ? spikeCard(p) : ""}
      ${commitsCard(p)}
      <div class="card ${p.repo_paths.length ? "span3" : "span6"}" data-noprov="repository list and links"><h3>Repos and links</h3><div class="list">${p.repo_paths.map(r => `<div class="li"><span class="lic">${I.commit}</span><div class="t"><b>${esc(r)}</b><small>local git repo</small></div></div>`).join("")}${p.links.map(l => `<div class="li"><span class="lic">${I.arrow}</span><div class="t"><b>${esc(l.label)}</b><small>${esc(l.url)}</small></div></div>`).join("") || ""}${!p.repo_paths.length && !p.links.length ? empty("No repos", "Add repo folder in Edit to see commits.") : ""}</div></div>
    </div>`;
  },

  inversion() {
    const pf = st.data.portfolio, H = pf.holdings;
    const val = sum(H, h => h.qty * h.price), cost = sum(H, h => h.qty * h.avg_cost), tot = val + (+pf.cash || 0), pl = val - cost;
    const paper = paperPositions();
    const colors = ["#F0592A", "#3E5BDB", "#1E9E5A", "#E0A33A", "#8E5BD9", "#26A6B5", "#D94F8C"];
    return head("Investment", "Tracking and simulation. 100% local dashboard: <b>real orders are never executed</b>.", `<div class="seg" id="invSeg"><button data-v="real" class="${st.invView === "real" ? "on" : ""}">Portfolio</button><button data-v="paper" class="${st.invView === "paper" ? "on" : ""}">Simulator</button></div>`) +
    (st.invView === "real" ? `<div class="grid g-ov stagger">
      <div class="span4"><div class="hero"><div class="row between"><span class="tag">${I.shield.replace("<svg", '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"')} Tracking only</span><span class="meta">Prices entered manually</span></div>
        <div class="hv num"><span data-count="${tot}">0</span><small>total value</small></div>
        <div class="bar"><i data-w="${tot ? Math.max(2, Math.round(100 * val / tot)) : 0}%"></i></div>
        <div class="row between"><span class="meta">Invested ${money(val)} · cash ${money(+pf.cash || 0)}</span><span class="meta">${pl >= 0 ? "+" : ""}${money(pl)} (${cost ? (100 * pl / cost).toFixed(1) : "0.0"}%)</span></div><br>
        <div class="row"><button class="btn" data-act="holding">${I.plus} Position</button><button class="btn" data-act="cash">Cash</button></div></div></div>
      <div class="card span2"><h3>Allocation ${prov({ src: "your portfolio", ts: H[0]?.updated || null, kind: "tu" })}</h3>${H.length ? `<div class="dwrap">${donut(H.map((h, i) => ({ label: h.symbol, value: h.qty * h.price, color: colors[i % 7] })), { size: 170 })}</div><div class="legend">${H.map((h, i) => `<span><i data-c="${colors[i % 7]}"></i>${esc(h.symbol)}</span>`).join("")}</div>` : empty("No positions", "Add your positions to see the allocation.")}</div>
      <div class="card span6"><h3>Positions ${prov({ src: "your portfolio", ts: H[0]?.updated || null, kind: "tu" })}</h3><table class="tbl"><thead><tr><th>Asset</th><th class="r">Quantity</th><th class="r">Avg Cost</th><th class="r">Price</th><th class="r">Value</th><th class="r">P&L</th><th></th></tr></thead><tbody>
        ${H.map(h => { const g = h.qty * (h.price - h.avg_cost); return `<tr><td><b>${esc(h.symbol)}</b> <small class="muted">${esc(h.name || "")}</small><br><small class="muted">price as of ${fdate(h.updated)}</small></td><td class="r num">${h.qty}</td><td class="r num">${money(h.avg_cost)}</td><td class="r num">${money(h.price)}</td><td class="r num">${money(h.qty * h.price)}</td><td class="r num ${g >= 0 ? "pos" : "neg"}">${g >= 0 ? "+" : ""}${money(g)}</td><td class="r"><button class="btn sm ghost" data-edit-h="${esc(h.id)}">Edit</button></td></tr>`; }).join("") || `<tr><td colspan="7">${empty("Empty portfolio", "Nothing fabricated: only what you record yourself appears here.")}</td></tr>`}
      </tbody></table></div></div>` :
    `<div class="grid g-ov stagger">
      <div class="span4"><div class="hero dk"><div class="row between"><span class="tag">Simulator · paper money</span><span class="meta">${pf.paper_trades.length} trades</span></div>
        <div class="hv num"><span data-count="${paper.value}">0</span><small>simulated value</small></div>
        <div class="row between"><span class="meta">Starting capital ${money(pf.paper_start || 10000)}</span><span class="meta">${paper.value - (pf.paper_start || 10000) >= 0 ? "+" : ""}${money(paper.value - (pf.paper_start || 10000))}</span></div><br>
        <div class="row"><button class="btn" data-act="paper">${I.plus} Paper trade</button></div></div></div>
      <div class="card span2" data-noprov="educational rules"><h3>Rules</h3><div class="list"><div class="li"><span class="lic">${I.shield}</span><div class="t"><b>No real orders</b><small>This dashboard does not connect to brokers or exchanges.</small></div></div><div class="li"><span class="lic">${I.spark}</span><div class="t"><b>AI only analyzes</b><small>Never decides or executes trades.</small></div></div></div></div>
      <div class="card span6"><h3>Paper trades ${prov({ src: "your simulator", ts: pf.paper_trades.at(-1)?.date || null, kind: "tu" })}</h3><table class="tbl"><thead><tr><th>Date</th><th>Asset</th><th>Side</th><th class="r">Quantity</th><th class="r">Price</th><th class="r">Amount</th></tr></thead><tbody>
      ${pf.paper_trades.slice().reverse().map(t => `<tr><td>${fdate(t.date)}</td><td><b>${esc(t.symbol)}</b></td><td><span class="badge ${t.side === "buy" ? "g" : ""}">${t.side === "buy" ? "buy" : "sell"}</span></td><td class="r num">${t.qty}</td><td class="r num">${money(t.price)}</td><td class="r num">${money(t.qty * t.price)}</td></tr>`).join("") || `<tr><td colspan="6">${empty("No trades", "Practice strategies risk-free before the investment project.")}</td></tr>`}
      </tbody></table></div></div>`);
  },

  ia() {
    const chats = st.data.chats;
    if (!st.chat && chats.length) st.chat = chats[0].id;
    const c = chats.find(x => x.id === st.chat);
    const s = st.aiStatus, ep = st.data.settings.ai.endpoint;
    return `<div class="chat stagger">
      <div class="card convs" data-noprov="conversation list"><div class="row between"><h1 class="mid">Conversations</h1><button class="btn sm" data-act="newchat">${I.plus}</button></div>
        <button class="btn acc" data-act="steps">${I.spark} Suggest next steps</button>
        <div class="list">${chats.map(x => `<button class="conv ${x.id === st.chat ? "on" : ""}" data-chat="${esc(x.id)}"><span class="lic">${I.spark}</span><span class="t"><b>${esc(x.title)}</b><small class="muted">${esc(x.project === "all" ? "All" : P(x.project)?.name || "")} · ${x.messages.length} messages</small></span></button>`).join("") || `<p class="small muted">No conversations.</p>`}</div></div>
      <div class="card msgs" data-noprov="chat with local AI"><div class="mh"><img class="logo" src="/logo.svg" alt=""><div class="t"><b>Local assistant</b><br><small class="${s?.ok ? "pos" : "neg"}">${s === null || s === undefined ? "checking…" : s.ok ? "connected · " + esc((s.models || [])[0] || st.data.settings.ai.model || "local model") : "offline"}</small></div>
          <span class="badge m">${esc(ep)}</span></div>
        <div class="stream" id="stream">
          ${!s?.ok ? `<div class="bub err">Local AI does not respond at ${esc(ep)}. It works with any OpenAI-compatible local server (SPIKE local API, llama.cpp, or Ollama). In the meantime, “Next steps” uses rules over your data. You can change the endpoint in Account.</div>` : ""}
          ${(c?.messages || []).map((m, mi) => `<div class="bub ${m.role === "user" ? "me" : ""} ${m.tool ? "toolb" : ""}">${m.tool ? `<small class="tooln">${esc(m.tool)}</small>` : ""}${esc(m.content)}${(m.links || []).map(l => `<button class="btn sm ghost golink" data-go="${esc(l[0])}">${esc(l[1])} →</button>`).join("")}${(m.actions || []).map((x, ai) => `<button class="btn sm golink" data-chatact="${mi}:${ai}" ${x.done ? "disabled" : ""}>${x.done ? "Done ✓" : esc(x.label)}</button>`).join("")}${(m.sources || []).map(u => `<a class="src" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a>`).join("")}</div>`).join("")}
          <div id="sugs"></div>
        </div>
        <form class="composer" id="cf"><input class="in" name="q" placeholder="Ask about your projects… (context: ${esc(scopeName())})" autocomplete="off"><button class="btn" type="submit">${I.send}</button></form></div>
    </div>`;
  },

  informes() {
    const L = ledger(), ms = months(), I12 = byMonth(L, "income"), E12 = byMonth(L, "expense");
    const inc = sum(I12), exp = sum(E12), net = inc - exp;
    const cats = {}; L.filter(e => e.type === "expense").forEach(e => cats[e.category || "Other"] = (cats[e.category || "Other"] || 0) + +e.amount);
    const colors = ["#3E5BDB", "#E0A33A", "#F0592A", "#E0453A", "#1E9E5A", "#8E5BD9", "#26A6B5"];
    const ci = Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([l, v], i) => ({ label: l, value: v, color: colors[i % 7] }));
    const per = st.data.projects.map(p => { const e = st.data.ledger.filter(x => x.project === p.id); const a = sum(e.filter(x => x.type === "income"), x => +x.amount), b = sum(e.filter(x => x.type === "expense"), x => +x.amount); return { p, a, b }; });
    const lastMov = L.at(-1)?.date || null;
    return head("Reports", `Last 12 months for ${esc(scopeName())}.`, `<button class="btn ghost" data-act="csv">Export CSV</button>`) +
    `<div class="grid g-ov stagger">
      <div class="card span2"><h3>Expenses by category ${prov({ src: "your transactions", ts: lastMov, kind: "tu" })}</h3>${ci.length ? `<div class="dwrap">${donut(ci, { size: 190 })}</div><div class="legend">${ci.map(c => `<span><i data-c="${c.color}"></i>${esc(c.label)}</span>`).join("")}</div>` : empty("No expenses", "Record categorized expenses.")}</div>
      <div class="card span2"><h3>Income vs expenses ${prov({ src: "your transactions", ts: lastMov, kind: "tu" })}</h3>${L.length ? line(ms.map(x => x[1]), [{ name: "Income", color: "var(--blue)", values: I12, area: true }, { name: "Expenses", color: "var(--acc)", values: E12 }], { h: 210, fmt: v => money(v) }) : empty("No data", "Will appear once you record transactions.")}</div>
      <div class="card span2"><div class="grid"><div class="lbl">Net profit (12m) ${prov({ src: "your transactions", ts: lastMov, kind: "tu" })}</div><div class="mid num ${net >= 0 ? "" : "neg"}" data-count="${net}">0</div>
        <div class="lbl">Average monthly expense</div><div class="mid num" data-count="${exp / 12}">0</div>
        <div class="lbl">Margin</div><div class="mid num">${inc ? (100 * net / inc).toFixed(1) + " %" : "—"}</div></div></div>
      <div class="card span6"><h3>Performance by project ${prov({ src: "your transactions and projects", ts: lastMov, kind: "tu" })}</h3><table class="tbl"><thead><tr><th>Project</th><th>Status</th><th class="r">Income</th><th class="r">Expenses</th><th class="r">Net</th><th class="r">Open tasks</th><th class="r">Milestones</th></tr></thead><tbody>
        ${per.map(({ p, a, b }) => `<tr><td><div class="row"><span class="lic c" data-c="${esc(p.color)}">${esc(p.letter)}</span><b>${esc(p.name)}</b></div></td><td><span class="badge m">${esc(p.status)}</span></td><td class="r num">${money(a)}</td><td class="r num">${money(b)}</td><td class="r num ${a - b >= 0 ? "pos" : "neg"}">${money(a - b)}</td><td class="r num">${p.tasks.filter(t => t.status !== "done").length}</td><td class="r num">${p.milestones.filter(m => m.done).length}/${p.milestones.length}</td></tr>`).join("")}
      </tbody></table></div></div>`;
  },

  cuenta() {
    const s = st.data.settings, A = st.data.audit.slice().reverse().slice(0, 40);
    return head("Account", "Profile, security, local AI, and activity log.") +
    `<div class="grid g-ov stagger">
      <div class="card span2" data-noprov="profile settings"><h3>Profile</h3><div class="row"><span class="avatar">${esc(st.data.profile.name[0] || "U").toUpperCase()}</span><b class="mid">${esc(st.data.profile.name)}</b></div><br>
        <div class="f"><label>Name</label><input class="in" id="pfName" value="${esc(st.data.profile.name)}" maxlength="40"></div>
        <div class="f"><label>Currency</label><select class="in" id="pfCur">${["EUR", "USD", "GBP"].map(c => `<option ${c === cur() ? "selected" : ""}>${c}</option>`).join("")}</select></div></div>
      <div class="card span2" data-noprov="security settings"><h3>Security</h3>
        <div class="li"><div class="t"><b>AES-256-GCM encryption</b><small>Key derived with scrypt. Only on this Mac.</small></div><span class="tg on"></span></div>
        <div class="li"><div class="t"><b>Claude access</b><small>Allows Claude to configure dashboard, AI, and data (revocable).</small></div><button class="tg acc ${st.agent ? "on" : ""}" id="tgAgent" aria-label="Claude access"></button></div>
        <div class="li"><div class="t"><b>Auto-lock</b><small>Inactivity minutes</small></div><input class="in" id="idleMin" type="number" min="1" max="240" value="${s.idle_minutes}"></div>
        <br><div class="row wrap"><button class="btn" data-act="pwd">Change password</button><button class="btn ghost" data-act="export">Export encrypted backup</button></div></div>
      <div class="card span2" data-noprov="local AI settings"><h3>Local AI</h3>
        <div class="f"><label>Endpoint (127.0.0.1 / localhost only)</label><input class="in" id="aiEp" value="${esc(s.ai.endpoint)}"></div>
        <div class="f"><label>Model (optional)</label><input class="in" id="aiModel" value="${esc(s.ai.model || "")}" placeholder="e.g. spike-core"></div>
        <div class="row"><button class="btn" data-act="aisave">Save and test</button><span class="small ${st.aiStatus?.ok ? "pos" : "neg"}">${st.aiStatus ? (st.aiStatus.ok ? "Connected" : "No connection") : ""}</span></div></div>
      <div class="card span6"><h3>Activity log ${prov({ src: "server log", ts: A[0]?.ts || null, kind: "calculo" })}</h3><div class="list">${A.map(a => `<div class="li"><span class="lic">${I.shield}</span><div class="t"><b>${esc(a.event)}</b><small>${new Date(a.ts * 1000).toLocaleString("en-GB")}</small></div></div>`).join("")}</div></div>
    </div>`;
  },
};

/* Hoy: daily focus with dashboard contents (overdue, in progress, next milestone) */
function focus() {
  const t = today(), P2 = projs();
  const late = P2.flatMap(p => p.tasks.filter(x => x.status !== "done" && x.due && x.due < t).map(x => ({ p, x })));
  const dueToday = P2.flatMap(p => p.tasks.filter(x => x.status !== "done" && x.due === t).map(x => ({ p, x })));
  const doing = P2.flatMap(p => p.tasks.filter(x => x.status === "doing").map(x => ({ p, x })));
  const high = P2.flatMap(p => p.tasks.filter(x => x.status === "todo" && x.priority === "alta").map(x => ({ p, x })));
  const next = P2.map(p => ({ p, m: p.milestones.find(m => !m.done) })).filter(o => o.m);
  return { late, dueToday, doing, high, next };
}
function taskRow({ p, x }, tag, cls = "m") {
  return `<div class="li"><button class="ck" data-done-task="${esc(x.id)}" data-pid="${esc(p.id)}" aria-label="Mark done"></button><div class="t"><b>${esc(x.title)}</b><small>${esc(p.name)}${x.due ? " · " + fdate(x.due) : ""}</small></div><span class="badge ${cls}">${tag}</span></div>`;
}
function commitsCard(p) {
  if (!p.repo_paths.length) return "";
  const days = [...Array(30)].map((_, i) => { const d = new Date(Date.now() - (29 - i) * 864e5); return d.toISOString().slice(0, 10); });
  const C = (st.commits || []).filter(c => !c.error && c.project === p.id);
  const cpd = days.map(d => C.filter(c => new Date(c.ts * 1000).toISOString().slice(0, 10) === d).length);
  return `<div class="card span3"><h3>Commits ${prov({ src: "git local", ts: C[0]?.ts || null, kind: "repo" })}<span class="badge m">30 days · ${sum(cpd)}</span></h3>${st.commits === null ? empty("Reading git…", "") : line(days.map(d => d.slice(8)), [{ name: "Commits", color: "var(--acc)", values: cpd, area: true }], { h: 190 })}
    <div class="list">${C.slice(0, 4).map(c => `<div class="li"><span class="lic">${I.commit}</span><div class="t"><b>${esc(c.subject)}</b><small>${esc(c.hash)} · ${fdate(new Date(c.ts * 1000).toISOString())}</small></div></div>`).join("")}</div></div>`;
}
function notesCard(p) {
  const n = st.notes?.projects?.[p.id];
  if (!st.notes) return `<div class="card span3" data-noprov="reading Obsidian notes"><h3>Obsidian</h3>${empty("Reading notes…", "")}</div>`;
  if (!n) return `<div class="card span3" data-noprov="no Obsidian note"><h3>Obsidian</h3>${empty("No note", st.notes.error ? esc(st.notes.error) : `No folder for ${esc(p.name)} in Projects/ of vault.`)}</div>`;
  const m = n.main;
  return `<div class="card span3"><h3>Obsidian ${prov({ src: "Obsidian vault", ts: m.mtime || st.notes?.recent?.[0]?.mtime || null, kind: "tu" })}<a class="btn sm ghost" href="${esc(m.url)}">Open note ${I.arrow}</a></h3>
    <p class="sub">Read-only · ${esc(n.folder)}${m.estado ? ` · status: <b>${esc(m.estado)}</b>` : ""}</p>
    ${m.steps.length ? `<div class="lbl">Next steps (Obsidian)</div><div class="list">${m.steps.map(x => `<div class="li"><span class="lic">${I.flag}</span><div class="t"><b>${esc(x)}</b></div><button class="btn sm ghost" data-ob-task="${esc(x)}" data-pid="${esc(p.id)}">${I.plus} Task</button></div>`).join("")}</div>` : ""}
    ${m.log.length ? `<div class="lbl">Recent log</div><div class="list">${m.log.map(x => `<div class="li"><div class="t"><small>${esc(x)}</small></div></div>`).join("")}</div>` : ""}
    ${n.notes.length > 1 ? `<div class="row wrap">${n.notes.filter(x => x.title !== m.title).map(x => `<a class="chip" href="${esc(x.url)}">${esc(x.title)}</a>`).join("")}</div>` : ""}</div>`;
}
/* Goals: targets, never earnings. Progress is compared to REAL income recorded this month. */
function goalsCard() {
  const G = st.data.goals.filter(g => st.proj === "all" || g.project === st.proj), m = months()[11][0];
  return `<div class="card span6"><h3>Goals ${prov({ src: "your goals and transactions", ts: st.data.ledger.at(-1)?.date || null, kind: "tu" })}<span class="row"><span class="badge b">targets · not earnings</span><button class="btn sm ghost" data-act="goal">${I.plus} Goal</button></span></h3>
    <div class="list">${G.map(g => {
      const real = sum(st.data.ledger.filter(e => e.project === g.project && e.type === "income" && e.date.startsWith(m)), e => +e.amount);
      const ms = P(g.project)?.milestones || [], msDone = ms.filter(x => x.done).length;
      const pct = g.target ? Math.min(100, Math.round(100 * real / g.target)) : ms.length ? Math.round(100 * msDone / ms.length) : null;
      return `<div class="li"><span class="lic c" data-c="${esc(projColor(g.project))}">${I.flag}</span><div class="t"><b>${esc(g.label)}</b><small>${esc(P(g.project)?.name || "General")}${g.note ? " · " + esc(g.note) : ""}</small>
        ${g.target ? `<div class="meter goal"><i data-w="${pct}%" data-c="var(--blue)"></i></div><small>Actual this month: ${money(real)} of a goal of ${money(g.target, 0)}${g.unit === "€/mes" || g.unit === "€/mo" ? "/mo" : ""} (${pct} %)</small>` : pct !== null ? `<div class="meter goal"><i data-w="${pct}%" data-c="var(--pos)"></i></div><small>Milestones for ${esc(P(g.project).name)}: ${msDone} of ${ms.length} (${pct} %)</small>` : `<small class="muted">No metric yet: add milestones to the project.</small>`}</div>
        <span class="badge m">goal</span><button class="ico" data-del-goal="${esc(g.id)}" aria-label="Delete goal">✕</button></div>`;
    }).join("") || empty("No goals", "Add targets; they never count as income.")}</div></div>`;
}
function spikeCard(p) {
  const s = (st.spike || []).find(x => x.project === p.id);
  if (!s) return `<div class="card span6"><h3>SPIKE live ${prov({ src: "repo SPIKE", ts: null, kind: "repo" })}</h3>${empty(st.spike == null ? "Reading repository…" : "No data", esc(p.folder || ""))}</div>`;
  if (s.error) return `<div class="card span6"><h3>SPIKE live ${prov({ src: "repo SPIKE", ts: null, kind: "repo" })}</h3>${empty("Could not read", esc(s.error))}</div>`;
  const b = s.board, T = s.training || [];
  return `<div class="card span6"><h3>SPIKE live ${prov({ src: "repo SPIKE", ts: s.ts || Date.now(), kind: "repo" })}<span class="badge m">read from ${esc(p.folder)}</span></h3>
    ${b ? `<p class="sub">Team board: ${b.total} tasks · ${Object.entries(b.by_status).map(([k, v]) => `${esc(k)} ${v}`).join(" · ")}</p>` : ""}
    <div class="list">${T.map(t => `<div class="li"><span class="lic c" data-c="${esc(p.color)}">${esc(t.specialist[0].toUpperCase())}</span><div class="t"><b>${esc(t.specialist)}</b><small>${esc(t.last)}</small></div><span class="badge ${t.verdict === "aceptado" ? "g" : t.verdict === "rechazado" ? "" : "m"}">${esc(t.verdict || "in progress")}</span></div>`).join("") || empty("No training runs", "No folders in training/runs.")}</div></div>`;
}
function projCard(p, hot) {
  const open = p.tasks.filter(t => t.status !== "done").length, k = p.kpis[0], kv = k?.history?.at(-1);
  return `<div class="offer ${hot ? "hot" : ""}" data-c="${esc(p.color)}"><span class="oi">${esc(p.letter)}</span><b>${esc(p.name)}</b>
    <p>${kv ? `${esc(k.label)}: <b>${esc(kv.value)} ${esc(k.unit)}</b>` : esc(p.description || "No data yet")}</p>
    <div class="row between"><small class="muted">${open} open tasks</small><button class="btn sm ${hot ? "acc" : ""}" data-open="${esc(p.id)}">Open</button></div></div>`;
}
function stepRow(s) {
  return `<div class="li"><span class="lic c" data-c="${esc(s.p.color)}">${esc(s.p.letter)}</span><div class="t"><b>${esc(s.title)}</b><small>${esc(s.p.name)} · ${esc(s.why)}</small></div>${s.fix ? `<button class="btn sm ghost" data-fix="${s.fix}" data-pid="${esc(s.p.id)}">Do</button>` : `<span class="badge ${s.pr === 0 ? "" : "m"}">${s.pr === 0 ? "overdue" : s.pr === 1 ? "in progress" : s.pr === 2 ? "high" : "milestone"}</span>`}</div>`;
}
function paperPositions() {
  const pf = st.data.portfolio; let cash = +(pf.paper_start || 10000); const pos = {};
  pf.paper_trades.forEach(t => { const a = t.qty * t.price; if (t.side === "buy") { cash -= a; pos[t.symbol] = (pos[t.symbol] || 0) + +t.qty; } else { cash += a; pos[t.symbol] = (pos[t.symbol] || 0) - t.qty; } });
  const last = {}; pf.paper_trades.forEach(t => last[t.symbol] = +t.price);
  return { cash, pos, value: cash + sum(Object.entries(pos), ([s, q]) => q * last[s]) };
}

/* ---------------- acciones ---------------- */
const projOpts = () => st.data.projects.map(p => [p.id, p.name]);
const curPid = () => st.proj === "all" ? (st.tab === "proyectos" ? st.data.projects[0]?.id : "") : st.proj;
const A = {
  money(pid) {
    modal("New transaction", [
      { name: "type", label: "Type", type: "select", options: [["income", "Income"], ["expense", "Expense"]] },
      { name: "amount", label: `Amount (${cur()})`, type: "number", step: "0.01", req: true },
      { name: "project", label: "Project", type: "select", options: [["", "— General —"], ...projOpts()], value: pid || curPid() },
      { name: "category", label: "Category", value: "" }, { name: "note", label: "Description", value: "" },
      { name: "date", label: "Date", type: "date", value: today() }], o => {
      if (!(+o.amount > 0)) { toast("Invalid amount"); return false; }
      st.data.ledger.push({ id: uid(), date: o.date || today(), project: o.project, type: o.type, amount: +o.amount, category: o.category.trim(), note: o.note.trim() });
      save(); render();
    });
  },
  newproj() {
    modal("New project", [{ name: "name", label: "Name", req: true }, { name: "kind", label: "Type", value: "" }, { name: "color", label: "Color", type: "color", value: "#3E5BDB" }, { name: "description", label: "Description", type: "textarea" }], o => {
      const id = (o.name.toLowerCase().normalize("NFD").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "") || "p") + "-" + uid().slice(0, 3);
      st.data.projects.push({ id, name: o.name.trim(), letter: o.name.trim()[0].toUpperCase(), color: o.color, status: "activo", kind: o.kind, description: o.description, repo_paths: [], links: [], kpis: [], milestones: [], tasks: [] });
      st.proj = id; save(); rail(); render();
    });
  },
  editproj() {
    const p = st.proj === "all" ? st.data.projects[0] : P(st.proj);
    modal("Edit " + p.name, [{ name: "name", label: "Name", value: p.name, req: true }, { name: "letter", label: "Initial", value: p.letter }, { name: "status", label: "Status", type: "select", value: p.status, options: [["activo", "Active"], ["planificado", "Planned"], ["pausado", "Paused"], ["terminado", "Completed"]] },
      { name: "kind", label: "Type", value: p.kind }, { name: "color", label: "Color", type: "color", value: p.color }, { name: "description", label: "Description", type: "textarea", value: p.description },
      { name: "repos", label: "Git repos (local paths, one per line)", type: "textarea", value: p.repo_paths.join("\n") },
      { name: "links", label: "Links (Name | URL, one per line)", type: "textarea", value: p.links.map(l => l.label + " | " + l.url).join("\n") },
      { name: "del", label: "Type DELETE to remove the project", value: "" }], o => {
      if (o.del === "BORRAR" || o.del === "DELETE") { st.data.projects = st.data.projects.filter(x => x !== p); st.proj = "all"; save(); rail(); render(); return; }
      Object.assign(p, { name: o.name.trim(), letter: (o.letter || o.name)[0].toUpperCase(), status: o.status, kind: o.kind, color: o.color, description: o.description.trim(),
        repo_paths: o.repos.split("\n").map(s => s.trim()).filter(Boolean),
        links: o.links.split("\n").map(s => s.split("|").map(x => x.trim())).filter(x => x[0] && /^https?:\/\//.test(x[1] || "")).map(x => ({ label: x[0], url: x[1] })) });
      save(); rail(); render(); api("/api/git").then(s => { st.commits = s.commits; render(true); }).catch(() => {});
    });
  },
  task(pid, preset = {}) {
    const p = P(pid || curPid()) || st.data.projects[0];
    modal("New task", [{ name: "title", label: "Task", req: true, value: preset.title || "" }, { name: "project", label: "Project", type: "select", options: projOpts(), value: p.id },
      { name: "priority", label: "Priority", type: "select", value: preset.priority || "media", options: [["alta", "High"], ["media", "Medium"], ["baja", "Low"]] }, { name: "due", label: "Due date", type: "date" }], o => {
      P(o.project).tasks.push({ id: uid(), title: o.title.trim(), status: "todo", priority: o.priority, due: o.due, created: today(), source: preset.source || "you" }); save(); render();
    });
  },
  milestone() { const p = st.proj === "all" ? st.data.projects[0] : P(st.proj); modal("New milestone", [{ name: "title", label: "Milestone", req: true }, { name: "date", label: "Target date", type: "date" }], o => { p.milestones.push({ id: uid(), title: o.title.trim(), done: false, date: o.date }); save(); render(); }); },
  kpi() {
    const p = st.proj === "all" ? st.data.projects[0] : P(st.proj);
    modal("Record KPI", [{ name: "k", label: "KPI", type: "select", options: [["new", "+ New KPI"], ...p.kpis.map(k => [k.id, k.label])], value: p.kpis[0]?.id || "new" }, { name: "label", label: "Name (if new)" }, { name: "unit", label: "Unit (if new)" }, { name: "value", label: "Value", type: "number", step: "any", req: true }, { name: "date", label: "Date", type: "date", value: today() }], o => {
      let k = p.kpis.find(x => x.id === o.k);
      if (!k) { if (!o.label.trim()) { toast("Enter a name for the KPI"); return false; } k = { id: uid(), label: o.label.trim(), unit: o.unit.trim(), history: [] }; p.kpis.push(k); }
      k.history.push({ date: o.date || today(), value: +o.value }); k.history.sort((a, b) => a.date.localeCompare(b.date)); save(); render();
    });
  },
  holding(h) {
    const pf = st.data.portfolio;
    modal(h ? "Edit " + h.symbol : "New position", [{ name: "symbol", label: "Symbol", value: h?.symbol || "", req: true }, { name: "name", label: "Name", value: h?.name || "" }, { name: "qty", label: "Quantity", type: "number", step: "any", value: h?.qty ?? "", req: true }, { name: "avg_cost", label: "Average cost", type: "number", step: "any", value: h?.avg_cost ?? "", req: true }, { name: "price", label: "Current price", type: "number", step: "any", value: h?.price ?? "", req: true }, ...(h ? [{ name: "del", label: "Type DELETE to remove", value: "" }] : [])], o => {
      if (h && (o.del === "BORRAR" || o.del === "DELETE")) { pf.holdings = pf.holdings.filter(x => x !== h); save(); render(); return; }
      const v = { symbol: o.symbol.trim().toUpperCase(), name: o.name.trim(), qty: +o.qty, avg_cost: +o.avg_cost, price: +o.price, updated: today() };
      h ? Object.assign(h, v) : pf.holdings.push({ id: uid(), ...v }); save(); render();
    });
  },
  quick() {
    modal("Quick add", [{ name: "k", label: "What would you like to add?", type: "select", options: [["spend", "Quick expense"], ["task", "Task"], ["money", "Income or expense"], ["sub", "Subscription"], ["meal", "Meal"], ["weight", "Weight"], ["milestone", "Milestone"], ["kpi", "KPI"], ["goal", "Goal (target)"], ["newproj", "Project"]] }], o => { setTimeout(() => A[o.k](), 30); }, "Continue");
  },
  goal() {
    modal("New goal (target, not earnings)", [{ name: "label", label: "Goal", req: true }, { name: "project", label: "Project", type: "select", options: [["", "— General —"], ...projOpts()], value: curPid() },
      { name: "target", label: `Monthly target amount (${cur()}, optional)`, type: "number", step: "0.01" }, { name: "note", label: "Note", value: "" }], o => {
      st.data.goals.push({ id: uid(), project: o.project, label: o.label.trim(), target: +o.target > 0 ? +o.target : null, unit: +o.target > 0 ? "€/mes" : "", note: o.note.trim() }); save(); render();
    });
  },
  cash() { modal("Available cash", [{ name: "cash", label: cur(), type: "number", step: "0.01", value: st.data.portfolio.cash }], o => { st.data.portfolio.cash = +o.cash || 0; save(); render(); }); },
  paper() {
    modal("Paper trade", [{ name: "symbol", label: "Symbol", req: true }, { name: "side", label: "Side", type: "select", options: [["buy", "Buy"], ["sell", "Sell"]] }, { name: "qty", label: "Quantity", type: "number", step: "any", req: true }, { name: "price", label: "Price", type: "number", step: "any", req: true }], o => {
      st.data.portfolio.paper_trades.push({ id: uid(), date: today(), symbol: o.symbol.trim().toUpperCase(), side: o.side, qty: +o.qty, price: +o.price }); save(); render();
    }, "Simulate");
  },
  newchat() { const c = { id: uid(), title: "New conversation", project: st.proj, messages: [] }; st.data.chats.unshift(c); st.chat = c.id; save(); render(); },
  async steps() {
    const box = $("#sugs"); if (!box) return;
    box.innerHTML = `<div class="bub typing"><i></i><i></i><i></i></div>`;
    let items = [], src = "Local AI";
    try {
      const r = await api("/api/ai/chat", { body: { mode: "next_steps", project: st.proj === "all" ? null : st.proj } });
      const m = r.content.match(/\[[\s\S]*\]/); items = JSON.parse(m ? m[0] : "[]").filter(x => x && x.title).slice(0, 6);
    } catch (e) { src = "rules (local AI unavailable)"; }
    if (!items.length) { items = ruleSteps().slice(0, 5).map(s => ({ project: s.p.id, title: s.title, priority: s.pr <= 2 ? "alta" : "media", why: s.why })); if (src === "Local AI") src = "rules"; }
    box.innerHTML = `<p class="small muted">Suggestions · source: ${esc(src)}</p>` + items.map((x, i) => `<div class="sug"><span class="lic c" data-c="${esc(projColor(x.project))}">${esc(P(x.project)?.letter || "?")}</span><div class="t"><b>${esc(x.title)}</b><br><small class="muted">${esc(P(x.project)?.name || "")} · ${esc(x.why || "")}</small></div><button class="btn sm" data-addsug="${i}">Add</button></div>`).join("");
    post(box);
    $$("[data-addsug]", box).forEach(b => b.onclick = () => { const x = items[+b.dataset.addsug]; const p = P(x.project) || st.data.projects[0]; p.tasks.push({ id: uid(), title: String(x.title).slice(0, 200), status: "todo", priority: ["alta", "media", "baja"].includes(x.priority) ? x.priority : "media", due: "", created: today(), source: src.startsWith("IA") || src.startsWith("Local") ? "ia" : "reglas" }); save(); b.textContent = "Added"; b.disabled = true; });
  },
  csv() {
    const rows = [["date", "project", "type", "amount", "category", "description"], ...ledger().map(e => [e.date, P(e.project)?.name || "", e.type, e.amount, e.category, e.note])];
    const q = v => /^[=+\-@]/.test(String(v)) ? "'" + v : v; // prevents formula injection
    const csv = rows.map(r => r.map(v => `"${String(q(v ?? "")).replace(/"/g, '""')}"`).join(",")).join("\n");
    dl(new Blob([csv], { type: "text/csv" }), "cage-transactions.csv");
  },
  async export() { const r = await fetch("/api/export", { headers: { "X-Cage-CSRF": st.csrf } }); if (r.ok) dl(await r.blob(), `cage-${today()}.vault.json`); else toast("Could not export"); },
  pwd() {
    modal("Change password", [{ name: "old", label: "Current", type: "password", req: true }, { name: "n1", label: "New (min. 12)", type: "password", req: true }, { name: "n2", label: "Repeat new", type: "password", req: true }], o => {
      if (o.n1 !== o.n2) { toast("Passwords do not match"); return false; }
      api("/api/password", { body: { old: o.old, new: o.n1 } }).then(() => toast("Password changed")).catch(e => toast(e.message));
    });
  },
  async aisave() {
    const ep = $("#aiEp").value.trim();
    if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/.test(ep)) { toast("Local endpoints only"); return; }
    st.data.settings.ai.endpoint = ep; st.data.settings.ai.model = $("#aiModel").value.trim();
    await doSave(); st.aiStatus = await api("/api/ai/status").catch(() => ({ ok: false })); render();
  },
};
function dl(blob, name) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }

function bindCommon(v) {
  $$("[data-act]", v).forEach(b => b.onclick = e => { e.preventDefault(); A[b.dataset.act](); });
  $$("[data-go]", v).forEach(b => b.onclick = () => go(b.dataset.go));
  $$("[data-open]", v).forEach(b => b.onclick = () => { st.proj = b.dataset.open; rail(); go("proyectos"); });
  $$("[data-done-task]", v).forEach(b => b.onclick = () => { const x = P(b.dataset.pid)?.tasks.find(y => y.id === b.dataset.doneTask); if (x) { x.status = "done"; save(); toast("Done: " + x.title); render(); } });
  $$("[data-ob-task]", v).forEach(b => b.onclick = () => A.task(b.dataset.pid, { title: b.dataset.obTask, source: "obsidian" }));
  $$("[data-del-goal]", v).forEach(b => b.onclick = () => { if (b.dataset.armed) { st.data.goals = st.data.goals.filter(g => g.id !== b.dataset.delGoal); save(); render(); } else { b.dataset.armed = 1; b.textContent = "?"; } });
  $$("[data-fix]", v).forEach(b => b.onclick = () => { const f = b.dataset.fix, pid = b.dataset.pid; if (f === "money") A.money(pid); else if (f === "task") A.task(pid); else { st.proj = pid; rail(); st.tab = "proyectos"; render(); A.editproj(); } });
}
const BIND = {
  hoy(v) {
    $("#qf", v).onsubmit = e => {
      e.preventDefault(); const f = e.target, t = f.t.value.trim(); if (!t) return;
      const p = P(f.p.value); if (!p) return;
      p.tasks.push({ id: uid(), title: t.slice(0, 200), status: "todo", priority: f.pr.value, due: "", created: today(), source: "you" });
      save(); toast(`Task added to ${p.name}`); render(); setTimeout(() => $("#qf input")?.focus(), 50);
    };
  },
  actividad(v) {
    $$("[data-f]", v).forEach(b => b.onclick = () => { st.actFilter = b.dataset.f; render(); });
    $$("[data-del-mov]", v).forEach(b => b.onclick = () => { if (b.dataset.armed) { st.data.ledger = st.data.ledger.filter(e => e.id !== b.dataset.delMov); save(); render(); } else { b.dataset.armed = 1; b.textContent = "Are you sure?"; } });
  },
  proyectos(v) {
    const p = st.proj === "all" ? st.data.projects[0] : P(st.proj); if (!p) return;
    $$("#pchips [data-p]", v).forEach(b => b.onclick = () => { st.proj = b.dataset.p; rail(); render(); });
    $$("[data-ms]", v).forEach(b => b.onclick = () => { const m = p.milestones.find(x => x.id === b.dataset.ms); m.done = !m.done; if (m.done && !m.date) m.date = today(); save(); render(); });
    $$("[data-del-ms]", v).forEach(b => b.onclick = () => { p.milestones = p.milestones.filter(x => x.id !== b.dataset.delMs); save(); render(); });
    let drag = null;
    $$(".task", v).forEach(t => {
      t.ondragstart = () => { drag = t.dataset.task; t.classList.add("dragging"); };
      t.ondragend = () => t.classList.remove("dragging");
      t.ondblclick = () => { const x = p.tasks.find(y => y.id === t.dataset.task); modal("Edit task", [{ name: "title", label: "Task", value: x.title, req: true }, { name: "priority", label: "Priority", type: "select", value: x.priority, options: [["alta", "High"], ["media", "Medium"], ["baja", "Low"]] }, { name: "due", label: "Due date", type: "date", value: x.due }, { name: "status", label: "Status", type: "select", value: x.status, options: [["todo", "To Do"], ["doing", "In Progress"], ["done", "Done"], ["delete", "Delete"]] }], o => { if (o.status === "delete") p.tasks = p.tasks.filter(y => y !== x); else Object.assign(x, { title: o.title.trim(), priority: o.priority, due: o.due, status: o.status }); save(); render(); }); };
    });
    $$(".col", v).forEach(c => {
      c.ondragover = e => { e.preventDefault(); c.classList.add("drop"); };
      c.ondragleave = () => c.classList.remove("drop");
      c.ondrop = e => { e.preventDefault(); const x = p.tasks.find(y => y.id === drag); if (x) { x.status = c.dataset.col; save(); render(); } };
    });
  },
  inversion(v) {
    $$("#invSeg button", v).forEach(b => b.onclick = () => { st.invView = b.dataset.v; render(); });
    $$("[data-edit-h]", v).forEach(b => b.onclick = () => A.holding(st.data.portfolio.holdings.find(h => h.id === b.dataset.editH)));
  },
  ia(v) {
    const s = $("#stream", v); s.scrollTop = s.scrollHeight;
    $$("[data-chat]", v).forEach(b => b.onclick = () => { st.chat = b.dataset.chat; render(); });
    $("#cf", v).onsubmit = async e => {
      e.preventDefault(); const q = e.target.q.value.trim(); if (!q) return;
      let c = st.data.chats.find(x => x.id === st.chat);
      if (!c) { c = { id: uid(), title: q.slice(0, 40), project: st.proj, messages: [] }; st.data.chats.unshift(c); st.chat = c.id; }
      if (c.title === "Nueva conversación" || c.title === "New conversation") c.title = q.slice(0, 40);
      c.messages.push({ role: "user", content: q }); e.target.q.value = "";
      s.insertAdjacentHTML("beforeend", `<div class="bub me">${esc(q)}</div><div class="bub typing" id="typing"><i></i><i></i><i></i></div>`); s.scrollTop = s.scrollHeight;
      try { const r = await api("/api/ai/chat", { body: { messages: c.messages, project: c.project === "all" ? null : c.project, ...HOOKS.chatExtra() } }); c.messages.push({ role: "assistant", content: r.content }); }
      catch (er) { $("#typing")?.remove(); s.insertAdjacentHTML("beforeend", `<div class="bub err">${esc(er.message)}</div>`); save(); return; }
      save(); render();
    };
  },
  cuenta(v) {
    $("#pfName", v).onchange = e => { st.data.profile.name = e.target.value.trim() || "you"; save(); shell(); };
    $("#pfCur", v).onchange = e => { st.data.profile.currency = e.target.value; save(); };
    $("#idleMin", v).onchange = e => { st.data.settings.idle_minutes = Math.max(1, Math.min(240, +e.target.value || 15)); save(); };
    $("#tgAgent", v).onclick = async () => { try { const r = await api("/api/agent", { body: { enabled: !st.agent } }); st.agent = r.agent; toast(st.agent ? "Claude can configure the dashboard" : "Claude access revoked"); render(); } catch (e) { toast(e.message); } };
  },
};

/* ---------------- search (⌘K) ---------------- */
function palette() {
  const m = $("#modal");
  m.innerHTML = `<div class="card"><input class="in" id="pq" placeholder="Search projects, tasks, transactions…" autocomplete="off"><div id="pr" class="list"></div></div>`;
  m.hidden = false; const q = $("#pq"); q.focus();
  const run = () => {
    const t = q.value.toLowerCase(), out = [];
    st.data.projects.forEach(p => { if (p.name.toLowerCase().includes(t)) out.push({ l: p.name, s: "Project", f: () => { st.proj = p.id; rail(); st.tab = "proyectos"; render(); } });
      p.tasks.forEach(x => { if (t && x.title.toLowerCase().includes(t)) out.push({ l: x.title, s: "Task · " + p.name, f: () => { st.proj = p.id; rail(); st.tab = "proyectos"; render(); } }); }); });
    TABS.forEach(([id, l]) => { if (l.toLowerCase().includes(t)) out.push({ l, s: "Section", f: () => go(id) }); });
    st.data.ledger.forEach(e => { if (t && (e.note + " " + e.category).toLowerCase().includes(t)) out.push({ l: e.note || e.category, s: "Transaction · " + money(e.amount), f: () => go("finanzas") }); });
    $("#pr").innerHTML = out.slice(0, 12).map((o, i) => `<div class="pal-r" data-k="${i}"><b>${esc(o.l)}</b><small class="muted">${esc(o.s)}</small></div>`).join("") || `<p class="small muted">No results</p>`;
    $$("#pr [data-k]").forEach(r => r.onclick = () => { m.hidden = true; out[+r.dataset.k].f(); });
  };
  q.oninput = run; run();
  q.onkeydown = e => { if (e.key === "Enter") $("#pr [data-k]")?.click(); if (e.key === "Escape") m.hidden = true; };
  m.onclick = e => { if (e.target === m) m.hidden = true; };
}

/* ---------------- boot ---------------- */
async function lockNow() { try { await api("/api/logout", { body: {}, noGate: true }); } catch {} gateLogin("Dashboard locked."); }
function wire() {
  $$("[data-theme-set]").forEach(b => b.onclick = e => setTheme(b.dataset.themeSet, e));
  $("#btnLock").onclick = lockNow; $("#btnLogout").onclick = lockNow; $("#btnUser").onclick = () => go("cuenta");
  $("#btnSearch").onclick = palette; $("#btnAdd").onclick = () => st.data && A.quick(); $("#btnHelp").onclick = () => st.data && HOOKS.help(); $("#btnSpend").onclick = () => st.data && A.spend();
  $("#btnBell").onclick = () => { const o = overdue(); toast(o.length ? `${o.length} overdue task(s): ${o.map(x => x.title).slice(0, 3).join(", ")}` : "No notifications"); };
  $("#btnClock").onclick = () => { const left = st.data.settings.idle_minutes * 60 - (Date.now() - st.lastAct) / 1000; toast(`Auto-lock in ${Math.max(0, Math.ceil(left / 60))} min of inactivity`); };
  document.addEventListener("keydown", e => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k" && st.data) { e.preventDefault(); palette(); }
    if (e.key === "Escape") $("#modal").hidden = true;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "") || document.activeElement?.isContentEditable;
    if (!st.data || typing || e.metaKey || e.ctrlKey || e.altKey || !$("#modal").hidden) return;
    if (/^[1-9]$/.test(e.key) && TABS[+e.key - 1]) { e.preventDefault(); go(TABS[+e.key - 1][0]); }
    else if (e.key === "n") { e.preventDefault(); A.task(); }
    else if (e.key === "a") { e.preventDefault(); A.quick(); }
    else if (e.key === "g" && A.spend) { e.preventDefault(); A.spend(); }
    else if (e.key === "?") { e.preventDefault(); HOOKS.help(); }
  });
  ["mousemove", "keydown", "click", "scroll", "touchstart"].forEach(ev => document.addEventListener(ev, () => st.lastAct = Date.now(), { passive: true }));
  setInterval(() => { if (st.data && Date.now() - st.lastAct > st.data.settings.idle_minutes * 60e3) lockNow(); }, 15e3);
  // Server shuts down after 2 min of inactivity; while there is active interaction on screen we keep it alive.
  setInterval(() => { if (!document.hidden && Date.now() - st.lastAct < 100e3) fetch("/api/state", { cache: "no-store" }).catch(() => {}); }, 30e3);
  addEventListener("resize", () => st.data && moveInd(true));
}
async function boot() {
  document.documentElement.dataset.theme = getTheme();
  wire();
  const s = await api("/api/state", { noGate: true });
  const tok = (location.hash.match(/setup=([\w-]+)/) || [])[1];
  if (s.setup) return tok ? gateSetup(tok) : showGate(`<div class="card"><h1>Cage</h1><p class="muted">Dashboard has no password yet. Open it with “Cage” on your Desktop to create one.</p></div>`);
  if (s.unlocked) { st.csrf = s.csrf; return loadAll(); }
  gateLogin(s.locked_until ? `Too many attempts. Wait ${s.locked_until}s.` : "");
}
// life.js (finances, subscriptions, health) registers here before boot
window.Cage = { api, st, $, $$, esc, uid, today, MES, I, TABS, VIEWS, BIND, A, money, fdate, P, projs, sum, months, toast, modal,
  HOOKS, normalize, save, doSave, render, rail, go, head, empty, post, cur, bars, line, spark, donut, fmtK, taskRow, goalsCard };
addEventListener("DOMContentLoaded", boot);
})();
