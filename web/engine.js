/* Cage calculation engines: finances, investment, health and suggestions. Pure functions (no DOM), tested in
   tests/test_engine.mjs. Everything is educational and deterministic: never executes orders or invents data. */
(function (root) {
  "use strict";
  const sum = (a, f = x => x) => a.reduce((s, x) => s + (+f(x) || 0), 0);
  const ym = d => d.slice(0, 7);
  // local date (not UTC): avoids day jump at midnight
  const iso = d => { d = new Date(d); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  function lastMonths(n, now = new Date()) {
    const r = [];
    for (let i = n - 1; i >= 0; i--) { const x = new Date(now.getFullYear(), now.getMonth() - i, 1); r.push(x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0")); }
    return r;
  }
  const CYCLE = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };
  const eur = v => Math.round(v).toLocaleString("es-ES") + " €";
  const CYC_EN = { weekly: "weekly", monthly: "monthly", quarterly: "quarterly", yearly: "yearly" };
  const CYC_ES = CYC_EN;
  const monthlyOf = s => (+s.amount || 0) * (CYCLE[s.cycle] ?? 1);

  /* ---------------- money ---------------- */
  function finance(d, now = new Date()) {
    const L = d.ledger || [], ms = lastMonths(3, now), cur = ms[2];
    const inc = m => sum(L.filter(e => e.type === "income" && ym(e.date) === m), e => e.amount);
    const exp = m => sum(L.filter(e => e.type === "expense" && ym(e.date) === m), e => e.amount);
    const closed = ms.slice(0, 2).filter(m => inc(m) || exp(m));
    const base = closed.length ? closed : [cur];
    const avgInc = sum(base, inc) / base.length, avgExp = sum(base, exp) / base.length;
    const subs = (d.subscriptions || []).filter(s => s.active !== false);
    const subsMonthly = sum(subs, monthlyOf);
    const accounts = d.accounts || [];
    const liquid = sum(accounts.filter(a => ["cuenta", "ahorro", "efectivo"].includes(a.type)), a => a.balance);
    const debt = sum(accounts.filter(a => a.type === "deuda"), a => Math.abs(a.balance));
    const pf = d.portfolio || {}, invested = sum(pf.holdings || [], h => h.qty * h.price) + (+pf.cash || 0);
    const monthExp = Math.max(avgExp, subsMonthly);
    const efMonths = +(d.invest_profile?.emergency_months ?? 6);
    const budgets = (d.budgets || []).map(b => {
      const spent = sum(L.filter(e => e.type === "expense" && ym(e.date) === cur && (e.category || "Otros") === b.category), e => e.amount);
      return { ...b, spent, pct: b.monthly ? Math.round(100 * spent / b.monthly) : 0 };
    });
    const candidates = subs.filter(s => s.usage === "nada" || s.usage === "poco").sort((a, b) => monthlyOf(b) - monthlyOf(a));
    const renewals = subs.filter(s => s.next).map(s => ({ ...s, days: Math.round((new Date(s.next + "T00:00:00") - new Date(now.toDateString())) / 864e5) }))
      .filter(s => s.days <= 7).sort((a, b) => a.days - b.days);
    return {
      month: cur, incomeMonth: inc(cur), expenseMonth: exp(cur), avgIncome: avgInc, avgExpense: avgExp,
      savingsRate: avgInc ? (avgInc - avgExp) / avgInc : null, surplus: avgInc - avgExp,
      subsMonthly, subsYearly: subsMonthly * 12, liquid, debt, invested, netWorth: liquid + invested - debt,
      emergencyTarget: monthExp * efMonths, emergencyMonths: monthExp ? liquid / monthExp : null, budgets, renewals, candidates,
      flow: lastMonths(12, now).map(m => ({ month: m, income: inc(m), expense: exp(m) })),
    };
  }

  /* ---------------- investment (educational) ---------------- */
  const PROFILES = {
    conservador: { rv: 30, rf: 60, liquidez: 10, ret: 0.035, label: "Conservative" },
    moderado: { rv: 60, rf: 35, liquidez: 5, ret: 0.05, label: "Moderate" },
    dinamico: { rv: 85, rf: 10, liquidez: 5, ret: 0.065, label: "Dynamic" },
  };
  function targetAllocation(profile = "moderado", horizon = 10) {
    const p = { ...(PROFILES[profile] || PROFILES.moderado) };
    if (horizon < 3) { p.rv = Math.min(p.rv, 20); p.liquidez = Math.max(p.liquidez, 30); p.rf = 100 - p.rv - p.liquidez; }
    else if (horizon < 7) { p.rv = Math.min(p.rv, 50); p.rf = 100 - p.rv - p.liquidez; }
    return p;
  }
  function allocation(holdings) {
    const tot = sum(holdings, h => h.qty * h.price), out = { rv: 0, rf: 0, liquidez: 0, cripto: 0, otro: 0 };
    holdings.forEach(h => { out[h.clase in out ? h.clase : "otro"] += h.qty * h.price; });
    Object.keys(out).forEach(k => out[k] = tot ? Math.round(1000 * out[k] / tot) / 10 : 0);
    return { total: tot, pct: out };
  }
  // future value of monthly contributions with monthly compound interest
  function project(initial, monthly, years, rate) {
    const r = rate / 12, pts = [];
    let v = initial, aport = initial;
    for (let m = 1; m <= years * 12; m++) { v = v * (1 + r) + monthly; aport += monthly; if (m % 12 === 0) pts.push({ year: m / 12, value: v, contributed: aport }); }
    return pts;
  }
  function investPlan(d, now = new Date()) {
    const f = finance(d, now), ip = d.invest_profile || {};
    const prof = ip.risk || "moderado", horizon = +(ip.horizon_years ?? 10), target = targetAllocation(prof, horizon);
    const steps = [];
    if (f.debt > 0) steps.push({ k: "deuda", title: "Pay off high-interest debt before investing", why: `You have ${eur(f.debt)} in recorded debt. A loan at 7–20% yields less than paying it off.`, ok: false });
    const efOk = f.emergencyMonths !== null && f.emergencyMonths >= (+(ip.emergency_months ?? 6));
    steps.push({ k: "colchon", title: "Emergency fund", why: f.emergencyTarget ? `Target ${eur(f.emergencyTarget)} (${ip.emergency_months ?? 6} months of expenses). You currently cover ${f.emergencyMonths?.toFixed(1).replace(".", ",")} months.` : "Record accounts and expenses to calculate it.", ok: efOk });
    const idle = Math.max(0, f.liquid - f.emergencyTarget);
    steps.push({ k: "excedente", title: "Idle money above emergency fund", why: idle > 0 ? `${eur(idle)} could stop sitting idle (based on your ${target.label.toLowerCase()} profile).` : "No surplus over emergency fund yet.", ok: idle > 0 && efOk, amount: idle });
    const monthly = Math.max(0, Math.round(+(ip.monthly_contribution ?? Math.max(0, f.surplus * 0.5))));
    steps.push({ k: "aportacion", title: "Periodic contribution (DCA)", why: monthly ? `${eur(monthly)}/month in diversified, low-cost index funds, split ${target.rv}/${target.rf}/${target.liquidez} (Equities/Bonds/Cash).` : "Define how much you can contribute each month.", ok: monthly > 0, amount: monthly });
    const al = allocation((d.portfolio || {}).holdings || []);
    const drift = al.total ? Math.max(Math.abs(al.pct.rv - target.rv), Math.abs(al.pct.rf - target.rf)) : 0;
    steps.push({ k: "rebalanceo", title: "Rebalancing", why: al.total ? `Maximum drift from target: ${drift.toFixed(1).replace(".", ",")} pts${drift > 5 ? " → rebalancing with new contributions recommended" : " (within 5-point margin)"}.` : "No portfolio recorded yet.", ok: !al.total || drift <= 5 });
    return { profile: prof, horizon, target, allocation: al, drift, monthly, idle, steps, finance: f };
  }

  // Profile questionnaire (5 questions, 1–3 points each) → profile. Longer horizon and higher risk tolerance = more equities.
  const QUIZ = [
    { q: "When will you need this money?", a: [["In less than 3 years", 1], ["Between 3 and 7 years", 2], ["In more than 7 years", 3]] },
    { q: "If your investment drops 20% in a year, what do you do?", a: [["Sell to avoid further losses", 1], ["Wait without doing anything", 2], ["Keep contributing or contribute more", 3]] },
    { q: "What matters more to you?", a: [["Not losing money", 1], ["Balance between security and growth", 2], ["Maximum long-term growth", 3]] },
    { q: "Do you have an emergency fund covering 3–6 months of expenses?", a: [["No", 1], ["Partially", 2], ["Yes", 3]] },
    { q: "How much investing experience do you have?", a: [["None", 1], ["Some (funds, deposits)", 2], ["Substantial (stocks, ETFs)", 3]] },
  ];
  function riskProfile(answers) {
    const pts = answers.reduce((a, b) => a + (+b || 0), 0);
    if (answers[0] === 1 || answers[3] === 1) return pts <= 9 ? "conservador" : "moderado"; // short horizon or no emergency fund: never dynamic
    return pts <= 8 ? "conservador" : pts <= 12 ? "moderado" : "dinamico";
  }
  // Splits a contribution across asset classes to move closer to target without selling (rebalancing with new money).
  function rebalanceSplit(holdings, target, amount) {
    const cls = ["rv", "rf", "liquidez"], cur = {}; cls.forEach(c => cur[c] = 0);
    holdings.forEach(h => { if (h.clase in cur) cur[h.clase] += h.qty * h.price; });
    const total = sum(cls, c => cur[c]) + amount, need = {};
    cls.forEach(c => need[c] = Math.max(0, total * target[c] / 100 - cur[c]));
    const tn = sum(cls, c => need[c]) || 1, out = {};
    cls.forEach(c => out[c] = Math.round(100 * amount * need[c] / tn) / 100);
    return out;
  }
  // Simulator scenarios: profile return ±2 points; with inflation, in today's euros.
  function scenarios(initial, monthly, years, profile = "moderado", inflation = 0) {
    const base = (PROFILES[profile] || PROFILES.moderado).ret;
    return [["Pessimistic", base - 0.02], ["Base", base], ["Optimistic", base + 0.02]].map(([name, ret]) => {
      const real = (1 + ret) / (1 + inflation) - 1, pts = project(initial, monthly, years, real);
      return { name, ret, real, pts, final: pts.at(-1)?.value ?? initial, contributed: pts.at(-1)?.contributed ?? initial };
    });
  }

  /* ---------------- health ---------------- */
  function age(birthYear, now = new Date()) { return birthYear ? now.getFullYear() - +birthYear : null; }
  function bmr(p, kg, now = new Date()) {
    const a = age(p.birth_year, now);
    if (!kg || !p.height_cm || a === null) return null;
    return Math.round(10 * kg + 6.25 * p.height_cm - 5 * a + (p.sex === "mujer" || p.sex === "female" ? -161 : 5));
  }
  function health(d, now = new Date()) {
    const h = d.health || {}, p = h.profile || {}, W = (h.weights || []).slice().sort((a, b) => a.date.localeCompare(b.date));
    const today = iso(now);
    const last = W.at(-1)?.kg ?? null;
    const avg7 = (() => { const cut = iso(now - 7 * 864e5); const r = W.filter(w => w.date > cut); return r.length ? sum(r, w => w.kg) / r.length : null; })();
    const b = bmr(p, last, now), tdee = b ? Math.round(b * (+p.activity || 1.375)) : null;
    const deficitGoal = +(p.deficit_kcal ?? 400);
    const target = tdee ? tdee - deficitGoal : null;
    const day = dt => sum((h.meals || []).filter(m => m.date === dt), m => m.kcal);
    const burned = dt => sum((h.exercise || []).filter(e => e.date === dt), e => e.kcal);
    const days7 = [...Array(7)].map((_, i) => iso(now - (6 - i) * 864e5));
    // only closed days (not today) and genuinely logged (≥ 800 kcal): a partial day would inflate deficit
    const logged = days7.filter(dt => dt !== iso(now) && day(dt) >= 800);
    const avgDef = tdee && logged.length ? sum(logged, dt => tdee + burned(dt) - day(dt)) / logged.length : null;
    const toLose = last && p.target_weight ? last - p.target_weight : null;
    const weeks = toLose > 0 && avgDef > 0 ? Math.ceil(toLose * 7700 / avgDef / 7) : null;
    const macros = (h.meals || []).filter(m => m.date === today);
    const water = sum((h.water || []).filter(w => w.date === today), w => w.ml);
    const sleep = (h.sleep || []).filter(s => s.date === today).at(-1)?.hours ?? null;
    const sleep7 = (() => { const r = (h.sleep || []).filter(s => days7.includes(s.date)); return r.length ? sum(r, s => s.hours) / r.length : null; })();
    const warnings = [];
    if (deficitGoal > 750) warnings.push("A deficit of more than 750 kcal/day is aggressive: consult a healthcare professional.");
    if (target && target < (p.sex === "mujer" || p.sex === "female" ? 1200 : 1500)) warnings.push("Target intake is below the prudent minimum.");
    if (W.length && (now - new Date(W.at(-1).date + "T00:00:00")) / 864e5 > 7) warnings.push("You haven't logged your weight in over a week.");
    return {
      last, avg7, bmr: b, tdee, target, deficitGoal, todayKcal: day(today), todayBurned: burned(today),
      todayProtein: sum(macros, m => m.protein), todayCarbs: sum(macros, m => m.carbs), todayFat: sum(macros, m => m.fat),
      fatTarget: last ? Math.round(last * 0.8) : null,
      carbsTarget: last && target ? Math.max(0, Math.round((target - last * 1.8 * 4 - last * 0.8 * 9) / 4)) : null, daysCounted: logged.length,
      water, waterTarget: last ? Math.round(last * 35 / 250) * 250 : 2000, sleep, sleep7, weekDeficit: avgDef !== null ? Math.round(avgDef * 7) : null, proteinTarget: last ? Math.round(last * 1.8) : null,
      avgDeficit: avgDef, toLose, weeks, eta: weeks ? iso(+now + weeks * 7 * 864e5) : null,
      bmi: last && p.height_cm ? last / Math.pow(p.height_cm / 100, 2) : null, warnings, days7: days7.map(dt => ({ date: dt, kcal: day(dt), burned: burned(dt) })),
    };
  }

  /* ---------------- habits ---------------- */
  function streak(log, now = new Date()) {
    const s = new Set(log || []); let n = 0;
    for (let i = 0; ; i++) { const d = iso(now - i * 864e5); if (s.has(d)) n++; else if (i > 0) break; }
    return n;
  }

  /* ---------------- assistant suggestions ---------------- */
  // Each suggestion can carry an action. SAFE = actions autopilot can execute alone.
  // Internal and reversible actions the AI can perform autonomously if the area is set to "autonoma".
  // Money, orders, external messages, purchases and cancellations are NEVER here.
  const SAFE = new Set(["task", "reminder", "categorize", "flag_sub", "plan_meal", "milestone_done", "add_sub", "sub_amount"]);
  // Normalized merchant from bank description: «COMPRA MERCADONA, VALENCIA 03/11» → «mercadona valencia»
  const STOP = new Set(["compra", "pago", "tarjeta", "recibo", "cargo", "adeudo", "transferencia", "tpv", "en", "de", "la", "el", "sl", "sa", "s.l", "s.a", "com", "www", "es", "eu", "purchase", "payment", "card", "bill", "charge", "debit", "transfer", "pos", "at", "in", "of", "the", "and"]);
  function merchant(note) {
    return String(note || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z ]+/g, " ")
      .split(/\s+/).filter(w => w.length > 2 && !STOP.has(w)).slice(0, 2).join(" ");
  }
  // Recurring monthly charges with similar amount (±15%) not in Subscriptions.
  function recurring(d, now = new Date()) {
    const by = {}, cut = iso(new Date(now.getFullYear(), now.getMonth() - 4, 1));
    (d.ledger || []).filter(e => e.type === "expense" && e.date >= cut && !e.sub).forEach(e => { const k = merchant(e.note); if (k) (by[k] ||= []).push(e); });
    const have = (d.subscriptions || []).map(x => merchant(x.name)).filter(Boolean);
    const out = [];
    Object.entries(by).forEach(([k, xs]) => {
      const months = [...new Set(xs.map(e => e.date.slice(0, 7)))];
      if (months.length < 2 || xs.length > months.length + 1) return;
      const amts = xs.map(e => +e.amount), m = amts.reduce((a, b) => a + b, 0) / amts.length;
      if (amts.some(a => Math.abs(a - m) > 0.15 * m) || have.some(h => h.split(" ")[0] === k.split(" ")[0])) return;
      const last = xs.slice().sort((a, b) => a.date.localeCompare(b.date)).at(-1);
      out.push({ key: k, name: last.note, amount: +amts.at(-1).toFixed(2), months: months.length, last: last.date });
    });
    return out;
  }
  // Subscriptions whose latest recorded charge is higher than current price (+3%).
  function priceRises(d) {
    const out = [];
    (d.subscriptions || []).filter(s => s.active !== false && +s.amount > 0).forEach(s => {
      const k = merchant(s.name).split(" ")[0];
      const hits = (d.ledger || []).filter(e => e.type === "expense" && (e.sub === s.id || (k && merchant(e.note).split(" ")[0] === k))).sort((a, b) => a.date.localeCompare(b.date));
      const last = hits.at(-1);
      if (last && +last.amount > +s.amount * 1.03) out.push({ sub: s.id, name: s.name, from: +s.amount, to: +last.amount, date: last.date });
    });
    return out;
  }
  const AREA_OF = {
    Projects: "proyectos", Money: "finanzas", Subscriptions: "suscripciones", Health: "salud", Investment: "inversion", Habits: "salud",
    Proyectos: "proyectos", Dinero: "finanzas", Suscripciones: "suscripciones", Salud: "salud", Inversión: "inversion", Hábitos: "salud"
  };
  function suggestions(d, now = new Date()) {
    const out = [], t = iso(now), f = finance(d, now), h = health(d, now), ip = investPlan(d, now);
    (d.projects || []).forEach(p => {
      p.tasks.filter(x => x.status !== "done" && x.due && x.due < t).forEach(x => out.push({ id: "late-" + x.id, area: "Projects", pr: 0, title: `Overdue task: ${x.title}`, why: `${p.name} · overdue on ${x.due}` }));
      if (p.status === "activo" && !p.tasks.some(x => x.status !== "done")) out.push({ id: "next-" + p.id, area: "Projects", pr: 3, title: `Define next step for ${p.name}`, why: "No open tasks", action: { type: "task", project: p.id, title: `Define next step for ${p.name}` } });
    });
    f.budgets.filter(b => b.pct >= 90).forEach(b => out.push({ id: "bud-" + b.category, area: "Money", pr: 1, title: `Budget for ${b.category} at ${b.pct}%`, why: `Spent ${Math.round(b.spent)} of ${b.monthly} this month` }));
    f.renewals.forEach(s => out.push({ id: "sub-" + s.id + s.next, area: "Money", pr: 1, title: `${s.name} renews ${s.days < 0 ? "(charge pending confirmation)" : s.days === 0 ? "today" : `in ${s.days} days`}`, why: `${(+s.amount).toFixed(2).replace(".", ",")} € (${CYC_EN[s.cycle] || s.cycle}). Are you still using it?`, action: { type: "task", project: "", title: `Review subscription ${s.name} before ${s.next}`, due: s.next } }));
    if (f.subsMonthly && f.avgIncome && f.subsMonthly / f.avgIncome > 0.1) out.push({ id: "subs-weight", area: "Money", pr: 2, title: "Subscriptions exceed 10% of your income", why: `${Math.round(f.subsMonthly)}/month in subscriptions` });
    ip.steps.filter(s => s.k === "colchon" && !s.ok).forEach(s => out.push({ id: "ef", area: "Investment", pr: 2, title: "Complete emergency fund before investing", why: s.why }));
    if (ip.idle > 0 && ip.steps.find(s => s.k === "colchon")?.ok) out.push({ id: "idle", area: "Investment", pr: 2, title: "You have idle cash above your emergency fund", why: `${Math.round(ip.idle).toLocaleString("es-ES")} € uninvested. Review investment plan (simulation, no real orders).`, action: { type: "task", project: "inversion", title: "Review investment plan and decide monthly contribution" } });
    if (ip.drift > 5) out.push({ id: "drift", area: "Investment", pr: 2, title: "Portfolio drifted from your profile", why: `${ip.drift.toFixed(1)} pts deviation` });
    h.warnings.forEach((w, i) => out.push({ id: "h" + i, area: "Health", pr: 1, title: w, why: "Health", action: (w.includes("peso") || w.includes("weight")) ? { type: "reminder", title: "Weigh myself tomorrow fasting" } : undefined }));
    if (h.tdee && !h.todayKcal) out.push({ id: "meal-" + t, area: "Health", pr: 3, title: "Log what you eat today", why: `Target ${h.target} kcal` });
    (d.habits || []).forEach(x => { if (!(x.log || []).includes(t)) out.push({ id: "hab-" + x.id + t, area: "Habits", pr: 4, title: `Pending habit: ${x.name}`, why: `Streak: ${streak(x.log, now)} days` }); });
    // uncategorized expenses whose merchant you already categorized before
    const known = {}, uncat = c => !c || c === "Sin categoría" || c === "Uncategorized";
    (d.ledger || []).forEach(e => { if (!uncat(e.category) && e.note) { known[e.note.toLowerCase()] = e.category; const m = merchant(e.note); if (m) known["m:" + m] = e.category; } });
    const guess = e => known[e.note.toLowerCase()] || known["m:" + merchant(e.note)];
    (d.ledger || []).filter(e => uncat(e.category) && e.note && guess(e)).slice(0, 20).forEach(e => out.push({ id: "cat-" + e.id, area: "Money", pr: 3, title: `Categorize “${e.note}” as ${guess(e)}`, why: "You previously categorized this merchant that way", action: { type: "categorize", move: e.id, category: guess(e) } }));
    recurring(d, now).forEach(r => out.push({ id: "rec-" + r.key, area: "Subscriptions", pr: 2, title: `Is ${r.name} a subscription?`, why: `Similar charge across ${r.months} months (latest ${r.amount.toFixed(2).replace(".", ",")} € on ${r.last})`, action: { type: "add_sub", name: r.name, amount: r.amount, next: nextDate(r.last, "monthly") } }));
    priceRises(d).forEach(r => out.push({ id: "rise-" + r.sub + r.date, area: "Subscriptions", pr: 1, title: `${r.name} had a price increase`, why: `${r.from.toFixed(2).replace(".", ",")} € → ${r.to.toFixed(2).replace(".", ",")} € (charge on ${r.date})`, action: { type: "sub_amount", sub: r.sub, amount: r.to } }));
    // unused subscriptions → flag them for review (never auto-cancelled)
    (d.subscriptions || []).filter(s => s.active !== false && s.usage === "nada" && !s.review).forEach(s => out.push({ id: "rev-" + s.id, area: "Subscriptions", pr: 2, title: `Review ${s.name}: marked as unused`, why: `${monthlyOf(s).toFixed(2).replace(".", ",")} €/month. Cancel directly with the service.`, action: { type: "flag_sub", sub: s.id } }));
    // today's meal plan empty and food library available → propose meals with what you usually eat
    const dow = (now.getDay() + 6) % 7, foods = d.health?.foods || [];
    if (foods.length >= 2 && !Object.values((d.health?.plan || {})[dow] || {}).some(Boolean)) {
      const by = s => foods.slice().sort((a, b) => b.kcal - a.kcal)[s]?.name || "";
      out.push({ id: "plan-" + dow + iso(now), area: "Health", pr: 4, title: "Fill today's meal plan from your library", why: "Your plan for today is empty", action: { type: "plan_meal", day: dow, plan: { desayuno: foods.at(-1).name, comida: by(0), cena: by(1), snacks: "" } } });
    }
    out.forEach(x => { x.areaKey = AREA_OF[x.area] || "proyectos"; });
    return out.sort((a, b) => a.pr - b.pr);
  }

  /* ---------------- action executor with undo ---------------- */
  // Returns { desc, undo } or throws if action is not internal/reversible.
  function apply(d, a, uid, today) {
    if (!SAFE.has(a.type)) throw new Error("action not permitted for AI: " + a.type);
    if (a.type === "task" || a.type === "reminder") {
      const p = (d.projects || []).find(x => x.id === a.project) || (d.projects || [])[0];
      if (!p) throw new Error("no projects found");
      const t = { id: uid(), title: String(a.title).slice(0, 200), status: "todo", priority: a.priority || "media", due: a.due || "", created: today, source: "ia" };
      p.tasks.push(t);
      return { desc: `${a.type === "reminder" ? "Reminder" : "Task"} “${t.title}” in ${p.name}`, undo: { type: "remove_task", project: p.id, task: t.id } };
    }
    if (a.type === "categorize") {
      const e = (d.ledger || []).find(x => x.id === a.move); if (!e) throw new Error("transaction not found");
      const prev = e.category; e.category = a.category;
      return { desc: `Category for “${e.note}” → ${a.category}`, undo: { type: "set_category", move: e.id, category: prev } };
    }
    if (a.type === "flag_sub") {
      const s = (d.subscriptions || []).find(x => x.id === a.sub); if (!s) throw new Error("subscription not found");
      const prev = "review" in s ? s.review : undefined; s.review = true;
      return { desc: `${s.name} marked for review`, undo: { type: "set_review", sub: s.id, review: prev } };
    }
    if (a.type === "milestone_done") {
      const p = (d.projects || []).find(x => x.id === a.project), m = p?.milestones.find(x => x.id === a.milestone);
      if (!m) throw new Error("milestone not found");
      const prev = { done: m.done, date: m.date }; m.done = true; m.date = m.date || today;
      return { desc: `Milestone “${m.title}” marked as done`, undo: { type: "set_milestone", project: p.id, milestone: m.id, prev } };
    }
    if (a.type === "add_sub") {
      d.subscriptions ||= [];
      const x = { id: uid(), created: today, name: String(a.name).slice(0, 80), amount: +a.amount, cycle: "monthly", next: a.next, category: "Suscripciones", usage: "lo uso", account: "", active: true, source: "regla" };
      d.subscriptions.push(x);
      return { desc: `Subscription “${x.name}” added (${x.amount} €/month)`, undo: { type: "remove_sub", sub: x.id } };
    }
    if (a.type === "sub_amount") {
      const x = (d.subscriptions || []).find(y => y.id === a.sub); if (!x) throw new Error("subscription not found");
      const prev = x.amount; x.amount = +a.amount;
      return { desc: `Price of ${x.name}: ${prev} → ${x.amount} €`, undo: { type: "set_sub_amount", sub: x.id, amount: prev } };
    }
    if (a.type === "plan_meal") {
      d.health ||= {}; d.health.plan ||= {};
      const prev = d.health.plan[a.day] ? { ...d.health.plan[a.day] } : null; d.health.plan[a.day] = { ...a.plan };
      return { desc: "Today's meal plan filled", undo: { type: "set_plan", day: a.day, plan: prev } };
    }
  }
  function undo(d, u) {
    if (u.type === "remove_task") { const p = (d.projects || []).find(x => x.id === u.project); if (p) p.tasks = p.tasks.filter(t => t.id !== u.task); }
    else if (u.type === "set_category") { const e = (d.ledger || []).find(x => x.id === u.move); if (e) e.category = u.category; }
    else if (u.type === "set_review") { const s = (d.subscriptions || []).find(x => x.id === u.sub); if (s) { if (u.review === undefined) delete s.review; else s.review = u.review; } }
    else if (u.type === "set_milestone") { const m = (d.projects || []).find(x => x.id === u.project)?.milestones.find(x => x.id === u.milestone); if (m) Object.assign(m, u.prev); }
    else if (u.type === "remove_sub") { d.subscriptions = (d.subscriptions || []).filter(x => x.id !== u.sub); }
    else if (u.type === "set_sub_amount") { const x = (d.subscriptions || []).find(y => y.id === u.sub); if (x) x.amount = u.amount; }
    else if (u.type === "set_plan") { if (u.plan) d.health.plan[u.day] = u.plan; else delete d.health.plan[u.day]; }
  }
  // What the AI would do alone right now according to the autonomy of each area ("propone" | "autonoma" | "nunca" or English equivalents).
  function autoActions(d, now = new Date()) {
    const A = d.assistant || {}, auto = A.autonomy || {}, done = new Set((A.log || []).map(l => l.sid)), skip = new Set(A.dismissed || []);
    return suggestions(d, now).filter(s => s.action && SAFE.has(s.action.type) && (auto[s.areaKey] === "autonoma" || auto[s.areaKey] === "autonomous") && !done.has(s.id) && !skip.has(s.id));
  }

  // Next date in a cycle
  function nextDate(date, cycle) {
    const d = new Date(date + "T00:00:00");
    if (cycle === "weekly") d.setDate(d.getDate() + 7); else if (cycle === "yearly") d.setFullYear(d.getFullYear() + 1);
    else if (cycle === "quarterly") d.setMonth(d.getMonth() + 3); else d.setMonth(d.getMonth() + 1);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  /* ---------------- progress ---------------- */
  // Task completion date: set when moved to "done" and removed if reopened. Called before saving.
  function stampDone(d, today = iso(new Date())) {
    (d.projects || []).forEach(p => p.tasks.forEach(t => {
      if (t.status === "done" && !t.done_at) t.done_at = today;
      else if (t.status !== "done" && t.done_at) delete t.done_at;
    }));
    return d;
  }
  // Daily metrics snapshot (only existing data; missing values stay null).
  function snapshotOf(d, now = new Date()) {
    const f = finance(d, now), h = health(d, now), T = (d.projects || []).flatMap(p => p.tasks);
    return {
      date: iso(now), net_worth: +f.netWorth.toFixed(2), liquid: +f.liquid.toFixed(2), invested: +f.invested.toFixed(2),
      income_month: +f.incomeMonth.toFixed(2), expense_month: +f.expenseMonth.toFixed(2), subs_monthly: +f.subsMonthly.toFixed(2),
      weight: h.last, tasks_open: T.filter(t => t.status !== "done").length, tasks_done: T.filter(t => t.status === "done").length,
      milestones_done: (d.projects || []).reduce((a, p) => a + (p.milestones || []).filter(m => m.done).length, 0),
      kpis: Object.fromEntries((d.projects || []).flatMap(p => (p.kpis || []).map(k => [p.id + ":" + k.label, k.history?.at(-1)?.value ?? null]))),
    };
  }
  // Adds today's snapshot if missing (one per day; kept for 3 years).
  function recordDaily(d, now = new Date()) {
    d.history ||= [];
    const snap = snapshotOf(d, now);
    if (d.history.at(-1)?.date === snap.date) d.history[d.history.length - 1] = snap; else d.history.push(snap);
    d.history = d.history.slice(-1100);
    return snap;
  }
  // Weekly count (Mondays) of ISO dates or timestamps, for the last n weeks.
  function weekly(dates, n = 12, now = new Date()) {
    const monday = x => { const y = new Date(x); y.setHours(0, 0, 0, 0); y.setDate(y.getDate() - (y.getDay() + 6) % 7); return +y; };
    const end = monday(now), weeks = [...Array(n)].map((_, i) => end - (n - 1 - i) * 7 * 864e5), counts = weeks.map(() => 0);
    dates.forEach(x => { const t = typeof x === "number" ? x : new Date(x + "T12:00:00").getTime(); const k = weeks.indexOf(monday(t)); if (k >= 0) counts[k]++; });
    return weeks.map((w, i) => ({ week: iso(w), n: counts[i] }));
  }
  // Report for a period [from, to] with recorded data only. Returns Markdown.
  function report(d, from, to, commits = []) {
    const inP = x => x && x >= from && x <= to, L = (d.ledger || []).filter(e => inP(e.date));
    const inc = sum(L.filter(e => e.type === "income"), e => e.amount), exp = sum(L.filter(e => e.type === "expense"), e => e.amount);
    const cats = {}; L.filter(e => e.type === "expense").forEach(e => cats[e.category || "Other"] = (cats[e.category || "Other"] || 0) + +e.amount);
    const done = (d.projects || []).flatMap(p => p.tasks.filter(t => inP(t.done_at)).map(t => `${p.name}: ${t.title}`));
    const ms = (d.projects || []).flatMap(p => (p.milestones || []).filter(m => m.done && inP(m.date)).map(m => `${p.name}: ${m.title}`));
    const W = (d.health?.weights || []).filter(w => inP(w.date));
    const H = (d.history || []).filter(x => inP(x.date));
    const C = commits.filter(c => !c.error && inP(iso(c.ts * 1000)));
    const e = v => v.toFixed(2).replace(".", ",") + " €", kg = v => String(v).replace(".", ",") + " kg";
    const lines = [`# Report ${from} → ${to}`, "", "## Money",
      `- Income: ${e(inc)} · Expenses: ${e(exp)} · Net: ${e(inc - exp)}`,
      ...Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c, v]) => `- ${c}: ${e(v)}`),
      H.length >= 2 ? `- Net worth: ${e(H[0].net_worth)} → ${e(H.at(-1).net_worth)}` : "- Net worth: not enough snapshots in the period",
      "", "## Projects", `- Closed tasks: ${done.length}`, ...done.slice(0, 15).map(x => "  - " + x),
      `- Completed milestones: ${ms.length}`, ...ms.map(x => "  - " + x), `- Commits: ${C.length}`,
      "", "## Health", W.length >= 2 ? `- Weight: ${kg(W[0].kg)} → ${kg(W.at(-1).kg)} (${(W.at(-1).kg - W[0].kg).toFixed(1).replace(".", ",")} kg)` : `- Weight: ${W.length ? kg(W[0].kg) + " (one entry)" : "no entries"}`,
      "", "_Generated by Cage from your recorded data. Nothing estimated._"];
    return lines.join("\n");
  }

  // Daily brief: what is due today, what happened yesterday and how many proposals exist. `ext`: server agenda/mail.
  function dailyBrief(d, now = new Date(), ext = {}) {
    const t = iso(now), y = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)), f = finance(d, now);
    const tasks = (d.projects || []).flatMap(p => p.tasks.filter(x => x.status !== "done" && x.due && x.due <= t).map(x => ({ title: x.title, project: p.name, late: x.due < t })));
    const ren = f.renewals.filter(s => s.days >= 0 && s.days <= 2).map(s => ({ title: s.name, amount: +s.amount, days: s.days }));
    const ev = (ext.events || []).filter(e => e.start.slice(0, 10) === t);
    const rem = (ext.reminders || []).filter(r => r.due && r.due.slice(0, 10) <= t);
    const bills = (ext.mail || []).filter(m => (m.dates || []).includes(t)).map(m => m.subject);
    const spentY = sum((d.ledger || []).filter(e => e.type === "expense" && e.date === y), e => e.amount);
    const sug = suggestions(d, now);
    const docs = (d.documents || []).filter(x => x.expires && x.expires >= t && (new Date(x.expires) - now) / 864e5 <= 30).map(x => ({ title: x.name, expires: x.expires }));
    return { date: t, tasks, renewals: ren, events: ev, reminders: rem, bills, docs, spentYesterday: +spentY.toFixed(2), proposals: sug.length, top: sug.slice(0, 3).map(s => s.title) };
  }
  // Weekly review (previous week) or monthly review (previous month) with targets and deviations. Markdown.
  function review(d, kind, now = new Date(), commits = []) {
    let from, to;
    if (kind === "week") { const m = new Date(now); m.setDate(m.getDate() - ((m.getDay() + 6) % 7) - 7); from = iso(m); const e = new Date(m); e.setDate(e.getDate() + 6); to = iso(e); }
    else { from = iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)); to = iso(new Date(now.getFullYear(), now.getMonth(), 0)); }
    const md = [report(d, from, to, commits).replace(/^# Report/, `# ${kind === "week" ? "Weekly" : "Monthly"} review`).replace(/\n_Generated by Cage[^\n]*_$/, "")];
    const L = (d.ledger || []).filter(e => e.type === "expense" && e.date >= from && e.date <= to);
    const scale = kind === "week" ? 7 / 30.4 : 1;
    const dev = (d.budgets || []).map(b => { const sp = sum(L.filter(e => (e.category || "Other") === b.category), e => e.amount); return { c: b.category, sp, lim: b.monthly * scale }; });
    md.push("## Budgets", ...(dev.length ? dev.map(x => `- ${x.c}: ${x.sp.toFixed(2).replace(".", ",")} € of ${x.lim.toFixed(0)} €${x.sp > x.lim ? " → **deviation +" + Math.round(100 * (x.sp / x.lim - 1)) + " %**" : " (within limit)"}`) : ["- No budgets defined"]));
    md.push("", "## Goals", ...((d.goals || []).length ? d.goals.map(g => `- ${g.label}${g.target != null ? `: ${g.current ?? "?"} / ${g.target} ${g.unit || ""}` : ""}${g.note ? ` — ${g.note}` : ""}`) : ["- No goals"]));
    const ha = d.health_apple?.days || {}, days = Object.entries(ha).filter(([k]) => k >= from && k <= to).map(([, v]) => v);
    const avg = k => { const xs = days.map(v => v[k]).filter(x => x != null); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; };
    if (days.length) md.push("", "## Activity (Apple Health)", `- Steps/day: ${avg("steps") ? Math.round(avg("steps")) : "—"} · Sleep: ${avg("sleep_h") ? avg("sleep_h").toFixed(1).replace(".", ",") + " h" : "—"} · Resting HR: ${avg("rhr") ? Math.round(avg("rhr")) : "—"}`);
    const hab = (d.habits || []).map(h => ({ n: h.name, k: (h.log || []).filter(x => x >= from && x <= to).length }));
    if (hab.length) md.push("", "## Habits", ...hab.map(h => `- ${h.n}: ${h.k} days`));
    md.push("", "_Generated only by Cage from your recorded data. Nothing estimated._");
    return { kind, from, to, md: md.join("\n") };
  }

  // Project traffic light with real data: latest progress (commit, closed task or milestone), blocker and next step.
  function projectStatus(d, commits = [], spike = [], now = new Date()) {
    const PR = { alta: 0, media: 1, baja: 2, high: 0, medium: 1, low: 2 };
    return (d.projects || []).map(p => {
      const C = (commits || []).filter(c => !c.error && c.project === p.id).sort((a, b) => b.ts - a.ts);
      const doneT = p.tasks.filter(t => t.done_at).sort((a, b) => b.done_at.localeCompare(a.done_at));
      const ms = (p.milestones || []).filter(m => m.done && m.date).sort((a, b) => b.date.localeCompare(a.date));
      const cands = [C[0] && { ts: C[0].ts * 1000, what: "commit: " + C[0].subject }, doneT[0] && { ts: +new Date(doneT[0].done_at + "T12:00"), what: "task: " + doneT[0].title },
        ms[0] && { ts: +new Date(ms[0].date + "T12:00"), what: "milestone: " + ms[0].title }].filter(Boolean).sort((a, b) => b.ts - a.ts);
      const last = cands[0] || null, age = last ? Math.floor((now - last.ts) / 864e5) : null;
      const open = p.tasks.filter(t => t.status !== "done").sort((a, b) => (PR[a.priority] ?? 1) - (PR[b.priority] ?? 1) || (a.due || "9").localeCompare(b.due || "9"));
      const late = open.filter(t => t.due && t.due < iso(now));
      const blocked = open.filter(t => t.status === "blocked" || /bloquead|block/i.test(t.title));
      const sp = (spike || []).find(x => x.project === p.id);
      const T = sp?.training || [], base = n => String(n).replace(/-\d+$/, "");
      const accepted = [...new Set(T.filter(t => /acept|accept/i.test(t.verdict || "")).map(t => base(t.specialist)))];
      const running = [...new Set(T.filter(t => !t.verdict).map(t => base(t.specialist)))];
      const rejected = [...new Set(T.filter(t => /rechaz|reject/i.test(t.verdict || "")).map(t => base(t.specialist)))].filter(n => !accepted.includes(n));
      // a rejection doesn't block if another round is running (cycle continues); only blocks if nothing left running
      const spBlock = rejected.length && !running.length ? `specialist ${rejected.join(", ")} rejected and no round in progress` : "";
      const spec = T.length ? { accepted, rejected, running } : null;
      const block = blocked[0]?.title || spBlock || (late.length ? `${late.length} overdue task(s)` : "");
      let light = "verde";
      if (p.status === "pausado" || p.status === "archivado" || p.status === "paused" || p.status === "archived") light = "gris";
      else if (age === null || age > 21 || (block && late.length > 2)) light = "rojo";
      else if (age > 7 || block) light = "ámbar";
      return { id: p.id, name: p.name, color: p.color, light, last, age, block, spec, next: open[0]?.title || null, open: open.length };
    });
  }

  const api = { projectStatus, dailyBrief, review, merchant, recurring, priceRises, stampDone, snapshotOf, recordDaily, weekly, report, QUIZ, riskProfile, rebalanceSplit, scenarios, apply, undo, autoActions, AREA_OF, iso, nextDate, finance, investPlan, targetAllocation, allocation, project, health, bmr, streak, suggestions, monthlyOf, lastMonths, PROFILES, SAFE };
  if (typeof module !== "undefined") module.exports = api; else root.Engine = api;
})(typeof window !== "undefined" ? window : globalThis);
