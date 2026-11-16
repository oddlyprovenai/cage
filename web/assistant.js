/* Cage · Assistant (phase 4): dashboard-wide suggestions, area-level autonomy with logging and undo,
   Claude inbox, read-only web research, subscriber funnel per project, and mode-based local AI chat.
   The AI only makes internal and reversible changes autonomously (engine.js → SAFE). Money, orders,
   messages, purchases, and cancellations: never. */
(() => {
"use strict";
const M = window.Cage, E = window.Engine;
const { st, $, $$, esc, uid, today, I, VIEWS, BIND, A, HOOKS, money, fdate, P, toast, modal, save, render, head, empty } = M;
const D = () => st.data;
const AREAS = [["proyectos", "Projects", "create tasks and follow-up reminders"], ["finanzas", "Finances", "categorize expenses based on what you already categorized"],
  ["suscripciones", "Subscriptions", "flag subscriptions for review (never cancel them)"], ["salud", "Health", "fill the meal plan from your library"]];
const LEVELS = [["propone", "Proposes"], ["autonoma", "Autonomous"], ["nunca", "Never alone"]];
const AS = () => { const d = D(); d.assistant ||= {}; d.assistant.autonomy ||= {}; d.assistant.log ||= []; d.assistant.dismissed ||= []; d.assistant.snoozed ||= {}; d.claude_inbox ||= []; return d.assistant; };

function pending() {
  const a = AS(), t = today(), skip = new Set(a.dismissed), done = new Set(a.log.filter(l => !l.undone).map(l => l.sid));
  return E.suggestions(D()).concat(M.extraSuggestions ? M.extraSuggestions() : []).filter(s => !skip.has(s.id) && !done.has(s.id) && !(a.snoozed[s.id] && a.snoozed[s.id] > t));
}
function run(s, auto = false) {
  const a = AS(), r = E.apply(D(), s.action, uid, today());
  a.log.unshift({ id: uid(), sid: s.id, ts: Date.now(), area: s.area, desc: r.desc, undo: r.undo, auto });
  a.log = a.log.slice(0, 200);
  return r;
}
function accept(id) {
  const s = pending().find(x => x.id === id); if (!s) return;
  if (s.action) { try { const r = run(s); toast("Done: " + r.desc); } catch (e) { toast(e.message); return; } }
  else AS().dismissed.push(s.id);
  save(); render(true);
}
function undoLog(id) {
  const l = AS().log.find(x => x.id === id); if (!l || l.undone) return;
  E.undo(D(), l.undo); l.undone = true; save(); toast("Undone: " + l.desc); render(true);
}
// what the AI does autonomously when opening the dashboard (only areas set to "Autonomous" and only internal reversible actions)
HOOKS.afterLoad = () => {
  const acts = E.autoActions(D()); if (!acts.length) return;
  let n = 0; acts.slice(0, 10).forEach(s => { try { run(s, true); n++; } catch { /* ignore */ } });
  if (n) { save(); toast(`The assistant made ${n} change${n > 1 ? "s" : ""} for you · you can undo them in Assistant`); render(true); }
};

function sugRow(s) {
  return `<div class="li"><span class="lic">${esc(s.area[0])}</span><div class="t"><b>${esc(s.title)}</b><small>${esc(s.area)} · ${esc(s.why || "")}${s.action ? "" : " · informational"}</small></div>
    <button class="btn sm" data-accept="${esc(s.id)}">${s.action ? "Accept" : "Understood"}</button><button class="btn sm ghost" data-snooze="${esc(s.id)}" title="Remind tomorrow">Tomorrow</button><button class="ico" data-dismiss="${esc(s.id)}" aria-label="Dismiss">✕</button></div>`;
}
function bindSug(v) {
  $$("[data-accept]", v).forEach(b => b.onclick = () => accept(b.dataset.accept));
  $$("[data-snooze]", v).forEach(b => b.onclick = () => { const t = new Date(Date.now() + 864e5); AS().snoozed[b.dataset.snooze] = E.iso(t); save(); render(true); });
  $$("[data-dismiss]", v).forEach(b => b.onclick = () => { AS().dismissed.push(b.dataset.dismiss); save(); render(true); });
  $$("[data-undo]", v).forEach(b => b.onclick = () => undoLog(b.dataset.undo));
}

/* ---------- Hoy: daily proposals ---------- */
const hoyHook = HOOKS.hoy;
HOOKS.hoy = () => {
  const P5 = pending().slice(0, 5);
  return hoyHook() + `<div class="card span6"><h3>Assistant proposals <span class="row"><span class="badge m">${P5.length ? "rules on your data" : "up to date"}</span>${M.prov({ src: "Local rules (engine.js)", ts: D().updated, kind: "calc" })}<button class="btn sm ghost" data-go="ia">View all ${I.arrow}</button></span></h3>
    <div class="list">${P5.map(sugRow).join("") || empty("Nothing to propose", "When there is something useful (renewals, budgets, overdue tasks…) it will appear here.")}</div></div>`;
};
const hoyBind = BIND.hoy; BIND.hoy = v => { hoyBind && hoyBind(v); bindSug(v); };

/* ---------- Subscriber funnel per project ---------- */
HOOKS.proyecto = p => {
  const F = (p.funnel || []).slice().sort((a, b) => a.month.localeCompare(b.month)), last = F.at(-1);
  const rate = (a, b) => a ? (100 * b / a).toFixed(1).replace(".", ",") + " %" : "—";
  return `<div class="card span6"><h3>Subscriber funnel ${M.prov({ src: "Vault (funnel)", ts: last?.month || D().updated, kind: "real" })} <span class="row"><button class="btn sm ghost" data-funnel="${esc(p.id)}">${I.plus} Month</button><button class="btn sm ghost" data-drafts="${esc(p.id)}">Message drafts</button></span></h3>
    ${last ? `<div class="funnel">${[["Visits", last.visits], ["Signups", last.signups], ["Paid", last.paid]].map(([l, v], i, a) => `<div class="fstep" data-i="${i}"><small>${l}</small><b class="num">${(+v).toLocaleString("es-ES")}</b>${i ? `<em>${rate(a[i - 1][1], v)}</em>` : ""}</div>`).join("")}</div>
      <p class="small muted">Latest month: ${esc(last.month)} · ${F.length} recorded months · project income in Finances</p>` : empty("No funnel data", "Record visits, signups, and paid users per month (from your site, store, or App Store) to track conversion.")}</div>`;
};
const projBind = BIND.proyectos; BIND.proyectos = v => {
  projBind && projBind(v);
  $$("[data-funnel]", v).forEach(b => b.onclick = () => { const p = P(b.dataset.funnel); modal("Funnel · " + p.name, [{ name: "month", label: "Month", type: "month", value: today().slice(0, 7), req: true }, { name: "visits", label: "Visits", type: "number", req: true }, { name: "signups", label: "Signups", type: "number", req: true }, { name: "paid", label: "Paid", type: "number", req: true }], o => {
    p.funnel ||= []; p.funnel = p.funnel.filter(x => x.month !== o.month).concat({ month: o.month, visits: +o.visits || 0, signups: +o.signups || 0, paid: +o.paid || 0 }); save(); render();
  }); });
  $$("[data-drafts]", v).forEach(b => b.onclick = () => drafts(P(b.dataset.drafts)));
};
// drafts that you review and send yourself: the dashboard never sends messages
function drafts(p) {
  const name = p.name, desc = p.description || "";
  const T = [["Welcome new signups", `Hi {name},\n\nThanks for signing up for ${name}. ${desc ? desc + "." : ""}\nThis week you can start with {first step}. If you have any questions, reply to this email: I read every one.\n\nBest,\nYou`],
    ["Invitation to upgrade to paid", `Hi {name},\n\nYou've been using ${name} for {days} days. If it's helping you, the paid plan includes {benefits} for {price}.\nNo lock-in: cancel anytime.\n\nYou`],
    ["Win back churned users", `Hi {name},\n\nI've improved ${name} since you tried it: {updates}.\nWould you like to give it another try? Here is {offer} if you return this month.\n\nYou`]];
  modal("Drafts · " + name, T.map(([l, t], i) => ({ name: "d" + i, label: l + " (copy and send yourself)", type: "textarea", value: t })), () => true, "Close");
}

/* ---------- Assistant View ---------- */
const chatView = VIEWS.ia, chatBind = BIND.ia;
VIEWS.ia = () => {
  const a = AS(), S = pending(), L = a.log.slice(0, 20), inbox = D().claude_inbox.slice().reverse(), R = st.research;
  const chat = chatView().replace('<form class="composer" id="cf">', `<form class="composer" id="cf"><select class="in w-auto" id="aiMode" title="Mode">${[["", "General"], ["finanzas", "Money"], ["salud", "Health"], ["proyectos", "Projects"]].map(([k, l]) => `<option value="${k}" ${st.aiMode === k ? "selected" : ""}>${l}</option>`).join("")}</select>`);
  return head("Assistant", "Suggests, acts only when you let it (always undoable), and helps you research.") +
  `<div class="grid g-ov stagger">
    <div class="card span3" data-noprov="settings"><h3>Autonomy by area</h3><p class="sub">“Autonomous” only allows internal and reversible changes. Money, orders, messages, purchases, and cancellations: always done by you.</p>
      ${AREAS.map(([k, l, what]) => `<div class="li"><div class="t"><b>${l}</b><small>Autonomous = ${what}</small></div><div class="seg">${LEVELS.map(([v, lv]) => `<button class="${(a.autonomy[k] || "propone") === v ? "on" : ""}" data-auto="${k}" data-lv="${v}">${lv}</button>`).join("")}</div></div>`).join("")}
      <div class="li"><div class="t"><b>Money and investment</b><small>Moving money, investing, or placing buy/sell orders</small></div><span class="badge">Never alone</span></div></div>
    <div class="card span3"><h3>Suggestions <span class="badge m">${S.length}</span> ${M.prov({ src: "Local rules (engine.js)", ts: D().updated, kind: "calc" })}</h3><div class="list scroll-s">${S.map(sugRow).join("") || empty("All up to date", "There is nothing to propose right now.")}</div></div>
    <div class="card span3"><h3>Action log ${M.prov({ src: "Vault (assistant.log)", ts: L[0]?.ts || D().updated, kind: "real" })}</h3><div class="list scroll-s">${L.map(l => `<div class="li"><span class="lic">${l.auto ? I.spark : "✓"}</span><div class="t"><b class="${l.undone ? "done-t" : ""}">${esc(l.desc)}</b><small>${l.auto ? "AI alone" : "accepted by you"} · ${new Date(l.ts).toLocaleString("en-GB")}</small></div>${l.undone ? '<span class="badge m">undone</span>' : `<button class="btn sm ghost" data-undo="${esc(l.id)}">Undo</button>`}</div>`).join("") || empty("No actions yet", "Whatever you accept or the AI does will appear here, with an undo button.")}</div></div>
    <div class="card span3"><h3>Inbox for Claude ${M.prov({ src: "Vault (claude_inbox)", ts: inbox[0] ? inbox[0].ts * 1000 : D().updated, kind: "real" })}</h3><p class="sub">Leave whatever you want Claude to do here; it reads it in its next session (with Claude access enabled) and replies here.</p>
      <form id="inboxF" class="row"><input class="in" name="t" placeholder="E.g.: add finance results to SPIKE when finished" maxlength="1000" autocomplete="off"><button class="btn" type="submit">Send</button></form>
      <div class="list">${inbox.slice(0, 6).map(m => `<div class="li"><span class="lic">${m.status === "respondida" ? "✓" : "…"}</span><div class="t"><b>${esc(m.text)}</b><small>${new Date(m.ts * 1000).toLocaleString("en-GB")} · ${m.status === "respondida" ? "Claude: " + esc(m.reply || "") : "pending"}</small></div></div>`).join("") || ""}
      ${D().settings && !st.agent ? `<p class="small neg">Claude access is disabled (Account): Claude will not be able to read the inbox.</p>` : ""}</div></div>
    <div class="card span6" data-noprov="search"><h3>Web research <span class="badge m">read-only · visible sources</span></h3>
      <form id="resF" class="row"><input class="in" name="q" placeholder="Search or paste a URL (e.g. index fund fees in Europe)" autocomplete="off" maxlength="300"><button class="btn" type="submit">Search</button></form>
      <p class="small muted">Never logs in, fills forms, or buys anything. Searches go out to DuckDuckGo from your Mac.</p>
      <div id="resOut">${R ? R.html : ""}</div></div>
  </div><h2 class="sec">Conversation with local AI</h2>${chat}`;
};
BIND.ia = v => {
  chatBind && chatBind(v); bindSug(v);
  $("#aiMode", v)?.addEventListener("change", e => { st.aiMode = e.target.value; });
  $$("[data-auto]", v).forEach(b => b.onclick = () => { AS().autonomy[b.dataset.auto] = b.dataset.lv; save(); toast(`${b.dataset.auto}: ${b.textContent}`); HOOKS.afterLoad(); render(true); });
  $("#inboxF", v).onsubmit = e => { e.preventDefault(); const t = e.target.t.value.trim(); if (!t) return; D().claude_inbox.push({ id: uid(), ts: Math.floor(Date.now() / 1000), from: "you", text: t, status: "pendiente" }); save(); toast("Added to Claude's inbox"); render(true); };
  $("#resF", v).onsubmit = async e => {
    e.preventDefault(); const q = e.target.q.value.trim(); if (!q) return; const out = $("#resOut", v);
    out.innerHTML = `<div class="bub typing"><i></i><i></i><i></i></div>`;
    try {
      if (/^https?:\/\//.test(q)) { const r = await M.api("/api/research", { body: { url: q } }); showPage(r, out); return; }
      const r = await M.api("/api/research", { body: { q } });
      st.research = { html: `<div class="list">${r.results.map((x, i) => `<div class="li"><span class="lic">${i + 1}</span><div class="t"><b>${esc(x.title)}</b><small>${esc(x.snippet)}</small><small class="src">${esc(x.url)}</small></div><button class="btn sm ghost" data-read="${esc(x.url)}">Read</button></div>`).join("") || empty("No results", "")}</div>` };
      out.innerHTML = st.research.html; bindRead(out);
    } catch (er) { out.innerHTML = `<p class="small neg">${esc(er.message)}</p>`; }
  };
  bindRead(v);
};
function bindRead(root) {
  $$("[data-read]", root).forEach(b => b.onclick = async () => {
    const out = $("#resOut"); out.innerHTML = `<div class="bub typing"><i></i><i></i><i></i></div>`;
    try { showPage(await M.api("/api/research", { body: { url: b.dataset.read } }), out); } catch (er) { out.innerHTML = `<p class="small neg">${esc(er.message)}</p>`; }
  });
}
function showPage(r, out) {
  st.research = { html: `<div class="page"><b>${esc(r.title || r.url)}</b><small class="src">Source: ${esc(r.url)}</small><pre>${esc(r.text.slice(0, 3000))}${r.text.length > 3000 ? "\n…" : ""}</pre></div>` };
  out.innerHTML = st.research.html;
}

// tools context for chat: the AI explains, figures come from engine
HOOKS.chatExtra = () => {
  const f = E.finance(D()), h = E.health(D()), ip = E.investPlan(D());
  const extra = [`Finances: net worth ${f.netWorth.toFixed(0)} €, liquidity ${f.liquid.toFixed(0)} €, avg expense ${f.avgExpense.toFixed(0)} €/mo, avg income ${f.avgIncome.toFixed(0)} €/mo, subscriptions ${f.subsMonthly.toFixed(0)} €/mo, emergency fund ${f.emergencyMonths?.toFixed(1) ?? "?"} months.`,
    `Investment (dashboard plan, profile ${ip.target.label}): ${ip.steps.map(s => `${s.title}: ${s.ok ? "ok" : "pending"} (${s.why})`).join(" | ")}`,
    h.tdee ? `Health: weight ${h.last} kg, goal ${D().health.profile.target_weight || "?"} kg, TDEE ${h.tdee}, target ${h.target} kcal, today ${h.todayKcal} kcal.` : "Health: profile incomplete."].join("\n");
  return { mode_area: st.aiMode || "", context_extra: extra };
};
M.assistant = { pending, accept, undoLog, run, AS };
})();
