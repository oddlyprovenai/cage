/* Cage · Assistant tools (block F).
   1) Commands that work WITHOUT local AI: expense, income, task, weight, meal, summary, report, search,
      simulate, remember… Figures come directly from the engine; nothing made up.
   2) With local AI: tool protocol ```cage {"tool": …}```. Read tools (query, calculate, search)
      run automatically and return their results to the model; tools that change state appear as action buttons
      and only apply if you accept (or if area is "Autonomous" and action is internal and reversible). Never moves
      money or sends anything externally.
   3) Preferences memory stored inside the encrypted vault. */
(() => {
"use strict";
const M = window.Cage, E = window.Engine;
const { st, $, esc, uid, today, VIEWS, BIND, HOOKS, money, fdate, toast, save, render } = M;
const D = () => st.data, AS = () => M.assistant.AS();
const num = s => +String(s).replace(/\./g, "").replace(",", ".");
const eur = v => money(v);
const TABN = { finanzas: "Finances", salud: "Health", proyectos: "Projects", suscripciones: "Subscriptions", inversion: "Investment", progreso: "Progress", trading: "Trading", hoy: "Today" };
const link = t => [t, TABN[t] || t];
const proj = name => { const n = (name || "").toLowerCase(); return D().projects.find(p => p.name.toLowerCase().includes(n) || p.id === n); };

/* ---------- queries (read) ---------- */
function summary(area) {
  const d = D(), f = E.finance(d), h = E.health(d), ip = E.investPlan(d);
  const a = (area || "").toLowerCase();
  if (a.startsWith("fin") || a.startsWith("din") || a.startsWith("mon")) return { text: `Net worth ${eur(f.netWorth)} (accounts ${eur(f.liquid)}, portfolio ${eur(f.invested)}${f.debt ? `, debts ${eur(f.debt)}` : ""}). This month: income ${eur(f.incomeMonth)}, expenses ${eur(f.expenseMonth)}. Savings rate (2 closed months): ${f.savingsRate === null ? "no data" : (100 * f.savingsRate).toFixed(1).replace(".", ",") + " %"}.${f.budgets.filter(b => b.pct >= 80).map(b => ` ${b.category} at ${b.pct} % of budget.`).join("")}`, links: [link("finanzas")] };
  if (a.startsWith("sus") || a.startsWith("sub")) return { text: `${d.subscriptions.filter(s => s.active !== false).length} active subscriptions: ${eur(f.subsMonthly)}/mo (${eur(f.subsYearly)}/yr). Renewals in 7 days: ${f.renewals.map(s => s.name).join(", ") || "none"}. Cancellation candidates: ${f.candidates.map(s => s.name).join(", ") || "none"}.`, links: [link("suscripciones")] };
  if (a.startsWith("sal") || a.startsWith("hea") || a.startsWith("pes") || a.startsWith("wei")) return { text: h.tdee ? `Weight ${h.last} kg (7-day avg ${h.avg7?.toFixed(1).replace(".", ",")}). Daily expenditure ${h.tdee} kcal, target ${h.target} kcal; today you have ${h.todayKcal} kcal and ${(h.water / 1000).toFixed(2).replace(".", ",")} L of water.${h.eta ? ` At current pace you reach your goal around ${fdate(h.eta)}.` : ""}${h.warnings.length ? " Alerts: " + h.warnings.join(" ") : ""}` : "Your health profile is incomplete: add height, birth year, and a weight.", links: [link("salud")] };
  if (a.startsWith("inv")) return { text: `Profile ${ip.target.label} (${ip.target.rv}/${ip.target.rf}/${ip.target.liquidez}). ${ip.steps.map(s => `${s.ok ? "✓" : "·"} ${s.title}: ${s.why}`).join(" ")} Educational: not advice and no orders are executed.`, links: [link("inversion")] };
  if (a.startsWith("pro")) return { text: d.projects.map(p => `${p.name}: ${p.tasks.filter(t => t.status !== "done").length} open tasks, ${p.milestones.filter(m => m.done).length}/${p.milestones.length} milestones${p.milestones.find(m => !m.done) ? `, next: ${p.milestones.find(m => !m.done).title}` : ""}.`).join(" "), links: [link("proyectos")] };
  const sg = M.assistant.pending().slice(0, 3);
  return { text: `Today: ${sg.length ? sg.map(s => s.title).join(" · ") : "nothing urgent"}. Net worth ${eur(f.netWorth)}; spent this month ${eur(f.expenseMonth)}.${h.tdee ? ` Eaten today ${h.todayKcal}/${h.target} kcal.` : ""}`, links: [link("hoy")] };
}

/* ---------- commands (without AI) ---------- */
const HELP = "I can do, without needing local AI:\n• expense 12.50 food [note] · income 1800 salary\n• task review contract in SPIKE\n• weight 82.4 · ate oatmeal\n• summary finances | health | projects | subscriptions | investment | agent\n• report weekly | monthly\n• simulate 200 per month 20 years\n• search compound interest\n• remember that I prefer… · what do you remember · forget 2";
async function command(text) {
  const t = text.trim(), l = t.toLowerCase();
  let m;
  if (/^(help|ayuda|what can you do|qué puedes hacer|que puedes hacer|commands|comandos)\b/.test(l)) return { tool: "help", text: HELP };
  if ((m = l.match(/^(?:expense|gasto|spent|gast[ée]|paid|pagu[ée])\s+([\d.,]+)\s*€?\s*(?:on\s+|for\s+|en\s+)?(\S+)?\s*(.*)$/))) {
    const amount = num(m[1]); if (!(amount > 0)) return { text: "I didn't understand the amount." };
    const cat = m[2] ? m[2][0].toUpperCase() + m[2].slice(1) : "Other";
    M.life.addMove({ type: "expense", amount, category: cat, note: m[3] || cat, account: D().accounts[0]?.id || "" }); save();
    return { tool: "expense", text: `Recorded: expense of ${eur(amount)} on ${cat}${D().accounts[0] ? ` (account ${D().accounts[0].name})` : ""}.`, links: [link("finanzas")] };
  }
  if ((m = l.match(/^(?:income|ingreso|earned|cobr[ée])\s+([\d.,]+)\s*€?\s*(.*)$/))) {
    const amount = num(m[1]); if (!(amount > 0)) return { text: "I didn't understand the amount." };
    M.life.addMove({ type: "income", amount, category: "Work", note: m[2] || "Income", account: D().accounts[0]?.id || "" }); save();
    return { tool: "income", text: `Recorded: income of ${eur(amount)}.`, links: [link("finanzas")] };
  }
  if ((m = t.match(/^(?:task|tarea)\s+(.+?)(?:\s+(?:in|on|en)\s+([^\s].*))?$/i))) {
    const p = proj(m[2]) || (st.proj !== "all" && D().projects.find(x => x.id === st.proj)) || D().projects[0];
    p.tasks.push({ id: uid(), title: m[1].slice(0, 200), status: "todo", priority: "media", due: "", created: today(), source: "you" }); save();
    return { tool: "task", text: `Task “${m[1]}” added to ${p.name}.`, links: [link("proyectos")] };
  }
  if ((m = l.match(/^(?:weight|peso)\s+([\d.,]+)/))) {
    const kg = num(m[1]); if (!(kg > 20 && kg < 400)) return { text: "Invalid weight." };
    const H = D().health; H.weights = H.weights.filter(w => w.date !== today()).concat({ date: today(), kg }).sort((a, b) => a.date.localeCompare(b.date)); save();
    return { tool: "weight", text: `Today's weight: ${String(kg).replace(".", ",")} kg.`, links: [link("salud")] };
  }
  if ((m = l.match(/^(?:ate|eaten|breakfast|lunch|dinner|com[ií]|he comido|desayun[ée]|cen[ée])\s+(.+)$/))) {
    const f = D().health.foods.find(x => x.name.toLowerCase().includes(m[1].trim()));
    if (!f) return { text: `“${m[1]}” is not in your food library. Add it once from Health → Food and then you can log it like this.`, links: [link("salud")] };
    D().health.meals.push({ id: uid(), date: today(), slot: M.health.slotNow(), name: f.name, kcal: f.kcal, protein: f.protein, carbs: f.carbs, fat: f.fat }); save();
    return { tool: "food", text: `${f.name}: ${f.kcal} kcal logged.`, links: [link("salud")] };
  }
  if (/^(?:summary|status|resumen|cómo va|como va|estado)\s*(?:of\s+the\s+|of\s+|del?\s*)?(?:agent|trading|investor|agente|inversor)/.test(l)) {
    const t = await M.api("/api/trading"), r = t.research_ml || {}, lt = t.longterm?.sleeves || {};
    const eq = t.portfolio?.equity ?? 10000, start = t.paper?.start || 10000;
    return { tool: "agent", text: `Agent ${t.running ? "running" : "stopped"} (paper mode). Trading: ${((eq / start - 1) * 100).toFixed(2).replace(".", ",")} % since install; ${r.n_variants ? `model has no reliable edge after ${r.n_variants} variants, so it does not trade` : "model not yet evaluated"}. Long term: ${Object.entries(lt).filter(([, x]) => !x.disabled).map(([k, x]) => `${k === "etf" ? "stocks/ETF" : "crypto"} ${money(x.value)} of ${money(x.book?.contributed)} contributed`).join(", ") || "no portfolio yet"}. ${(t.alerts || []).length ? "Alerts: " + t.alerts.join("; ") + ". " : ""}You can lose money; not regulated financial advice.`, links: [["trading", "Agent"]] };
  }
  if ((m = l.match(/^(?:summary|status|resumen|cómo va|como va|estado)\s*(?:of|del|mis|mi)?\s*(.*)$/))) return { tool: "query", ...summary(m[1]) };
  if ((m = l.match(/^(?:report|informe)\s+(weekly|monthly|semanal|mensual)/))) {
    const isWeekly = m[1] === "weekly" || m[1] === "semanal";
    const n = new Date(), to = E.iso(n), from = isWeekly ? E.iso(new Date(n - ((n.getDay() + 6) % 7) * 864e5)) : to.slice(0, 8) + "01";
    return { tool: "report", text: E.report(D(), from, to, st.commits || []), links: [link("progreso")] };
  }
  if ((m = l.match(/^(?:simulate|simula)\s+([\d.,]+)\s*(?:€\s*)?(?:per month|al mes)\s+(\d+)\s*(?:years|años)?(?:\s+(?:with|con)\s+([\d.,]+))?/))) {
    const sc = E.scenarios(num(m[3] || 0), num(m[1]), +m[2], E.investPlan(D()).profile, 0.02);
    return { tool: "simulator", text: sc.map(x => `${x.name} (${(100 * x.ret).toFixed(1).replace(".", ",")} %): ${eur(x.final)} in today's euros, contributing ${eur(x.contributed)}`).join("\n") + "\nHypotheses visible, no guarantee. Educational.", links: [link("inversion")] };
  }
  if ((m = t.match(/^(?:search|find|busca(?:r)?)\s+(.+)$/i))) {
    const r = await M.api("/api/research", { body: { q: m[1] } });
    return { tool: "web search · " + r.engine, text: r.results.slice(0, 5).map((x, i) => `${i + 1}. ${x.title} — ${x.snippet}`).join("\n") || "No results.", sources: r.results.slice(0, 5).map(x => x.url) };
  }
  if ((m = t.match(/^(?:remember(?:\s+that)?|recuerda(?:\s+que)?)\s+(.+)$/i))) {
    (AS().memory ||= []).push({ id: uid(), text: m[1].slice(0, 300), date: today() }); save();
    return { tool: "memory", text: `I'll remember: “${m[1]}”. I'll keep it in mind in my responses.` };
  }
  if (/^(?:what do you remember|(?:qué|que) recuerdas)/.test(l)) { const mem = AS().memory || []; return { tool: "memory", text: mem.length ? mem.map((x, i) => `${i + 1}. ${x.text} (${fdate(x.date)})`).join("\n") : "You haven't asked me to remember anything yet." }; }
  if ((m = l.match(/^(?:forget|olvida)\s+(\d+)/))) { const mem = AS().memory || []; const x = mem.splice(+m[1] - 1, 1)[0]; save(); return { tool: "memory", text: x ? `Forgot: “${x.text}”.` : "No memory at that index." }; }
  return null;
}

/* ---------- tool protocol for local AI ---------- */
const TOOLS_PROMPT = `You can use tools by writing a block like this (one per tool):
\`\`\`cage
{"tool": "consultar", "area": "finanzas|salud|proyectos|suscripciones|inversion"}
\`\`\`
Read tools (executed and result returned to you): consultar {area}, calcular {"tool":"calcular","mensual":200,"anos":20,"inicial":0}, buscar {"tool":"buscar","q":"…"}.
State-changing tools (the user accepts via a button): {"tool":"tarea","proyecto":"…","titulo":"…"}, {"tool":"recordatorio","titulo":"…"}.
You cannot move money, invest, send messages, or buy anything. Use only data from tools; if something is missing, say so.`;
function blocks(text) {
  const out = []; const re = /```cage\s*([\s\S]*?)```/g; let m;
  while ((m = re.exec(text))) { try { out.push(JSON.parse(m[1])); } catch { /* malformed block: ignore */ } }
  return out;
}
async function runRead(b) {
  if (b.tool === "consultar") return summary(b.area).text;
  if (b.tool === "calcular") return E.scenarios(+b.inicial || 0, +b.mensual || 0, Math.min(50, +b.anos || 10), E.investPlan(D()).profile, 0.02).map(x => `${x.name}: ${Math.round(x.final)} € (contributed ${Math.round(x.contributed)} €)`).join("; ");
  if (b.tool === "buscar") { const r = await M.api("/api/research", { body: { q: String(b.q || "").slice(0, 200) } }); return r.results.slice(0, 5).map(x => `${x.title}: ${x.snippet} (${x.url})`).join("\n") || "no results"; }
  return null;
}
function toAction(b) {
  if (b.tool === "tarea") { const p = proj(b.proyecto) || D().projects[0]; return { label: `Create task “${String(b.titulo || "").slice(0, 60)}” in ${p.name}`, action: { type: "task", project: p.id, title: String(b.titulo || "").slice(0, 200) }, area: "proyectos" }; }
  if (b.tool === "recordatorio") return { label: `Create reminder “${String(b.titulo || "").slice(0, 60)}”`, action: { type: "reminder", title: String(b.titulo || "").slice(0, 200) }, area: "proyectos" };
  return null;
}

/* ---------- conversation ---------- */
function chat() {
  const d = D(); let c = d.chats.find(x => x.id === st.chat);
  if (!c) { c = { id: uid(), title: "Conversation", project: st.proj, messages: [] }; d.chats.unshift(c); st.chat = c.id; }
  return c;
}
async function send(q) {
  const c = chat();
  if (c.title === "Nueva conversación" || c.title === "New conversation" || c.title === "Conversación" || c.title === "Conversation") c.title = q.slice(0, 40);
  c.messages.push({ role: "user", content: q });
  render(true);
  try {
    const local = await command(q);
    if (local) { c.messages.push({ role: "assistant", content: local.text, tool: local.tool, links: local.links, sources: local.sources }); save(); render(true); return; }
  } catch (e) { c.messages.push({ role: "assistant", content: "Could not: " + e.message }); save(); render(true); return; }
  const msgs = c.messages.filter(m => !m.tool).map(m => ({ role: m.role, content: m.content })).slice(-16);
  for (let round = 0; round < 3; round++) {
    let r;
    try { r = await M.api("/api/ai/chat", { body: { messages: msgs, project: c.project === "all" ? null : c.project, ...HOOKS.chatExtra() } }); }
    catch (e) {
      const why = /memory|memoria/i.test(e.message) ? e.message : /no disponible|unavailable|refused|desactivada|disabled/i.test(e.message) ? "Local AI is not running (SPIKE API, llama.cpp, or Ollama on this Mac)." : e.message;
      c.messages.push({ role: "assistant", tool: "no AI", content: `${why}\n\nIn the meantime I can do many things without it: type “help”.` }); save(); render(true); return;
    }
    const B = blocks(r.content), reads = B.filter(b => ["consultar", "calcular", "buscar"].includes(b.tool));
    const clean = r.content.replace(/```cage[\s\S]*?```/g, "").trim();
    if (reads.length && round < 2) {
      msgs.push({ role: "assistant", content: r.content });
      for (const b of reads) msgs.push({ role: "user", content: `[result of ${b.tool}] ${await runRead(b).catch(e => "error: " + e.message)}` });
      continue;
    }
    const acts = B.map(toAction).filter(Boolean);
    const auto = AS().autonomy || {}, applied = [];
    acts.forEach(a => { if (auto[a.area] === "autonoma") { try { M.assistant.run({ id: "chat-" + uid(), area: "Proyectos", action: a.action }, true); a.done = true; applied.push(a.label); } catch { /* */ } } });
    c.messages.push({ role: "assistant", content: (clean || "Done.") + (applied.length ? `\n(I did this automatically, you can undo it in the log: ${applied.join("; ")})` : ""), actions: acts.map(a => ({ label: a.label, action: a.action, done: !!a.done })) });
    save(); render(true); return;
  }
}

// chat form routes through here (local commands first, then AI with tools)
const ia = BIND.ia;
BIND.ia = v => {
  ia && ia(v);
  const f = $("#cf", v); if (!f) return;
  f.q.placeholder = "Ask a question or give a command (type “help”)…";
  f.onsubmit = e => { e.preventDefault(); const q = f.q.value.trim(); if (!q) return; f.q.value = ""; send(q); };
  v.querySelectorAll("[data-chatact]").forEach(b => b.onclick = () => {
    const [mi, ai] = b.dataset.chatact.split(":").map(Number), msg = chat().messages[mi], a = msg?.actions?.[ai];
    if (!a || a.done) return;
    try { M.assistant.run({ id: "chat-" + uid(), area: "Proyectos", action: a.action }); a.done = true; save(); toast("Done: " + a.label); render(true); } catch (er) { toast(er.message); }
  });
};
// memory and tool protocol in AI context
const extra = HOOKS.chatExtra;
HOOKS.chatExtra = () => {
  const x = extra(), mem = (AS().memory || []).map(m => "- " + m.text).join("\n");
  return { ...x, context_extra: (x.context_extra || "") + (mem ? "\nPreferences you asked me to remember:\n" + mem : "") + "\n\n" + TOOLS_PROMPT };
};
// memory card in Assistant
const iaView = VIEWS.ia;
VIEWS.ia = () => iaView().replace('<h2 class="sec">', `<div class="card memc"><h3>Assistant memory <span class="badge m">${(AS().memory || []).length}</span></h3><p class="sub">Encrypted storage. Type in chat “remember that…” to add, “what do you remember” to view, and “forget N” to delete.</p><div class="list">${(AS().memory || []).map((m, i) => `<div class="li"><span class="lic">${i + 1}</span><div class="t"><b>${esc(m.text)}</b><small>${fdate(m.date)}</small></div></div>`).join("") || ""}</div></div><h2 class="sec">`);
M.tools = { command, blocks, summary };
})();
