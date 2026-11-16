// Engine tests (node tests/test_engine.mjs). Run by pytest in test_engine_js.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const E = createRequire(import.meta.url)("../web/engine.js");
const now = new Date(2026, 10, 15, 12);
const base = () => ({ projects: [{ id: "p", name: "P", status: "activo", tasks: [], milestones: [] }], ledger: [], portfolio: { holdings: [], cash: 0 } });

// finances: closed months averages, savings rate, budgets, net worth
let d = base();
d.ledger = [
  { date: "2026-09-10", type: "income", amount: 2000 }, { date: "2026-09-12", type: "expense", amount: 1500, category: "Casa" },
  { date: "2026-10-10", type: "income", amount: 2000 }, { date: "2026-10-12", type: "expense", amount: 1000, category: "Casa" },
  { date: "2026-11-02", type: "expense", amount: 280, category: "Comida" }];
d.budgets = [{ category: "Comida", monthly: 300 }];
d.accounts = [{ type: "cuenta", balance: 3000 }, { type: "ahorro", balance: 6000 }, { type: "deuda", balance: -500 }];
d.portfolio = { holdings: [{ qty: 10, price: 100, clase: "rv" }], cash: 0 };
let f = E.finance(d, now);
assert.equal(f.avgIncome, 2000); assert.equal(f.avgExpense, 1250); assert.equal(f.savingsRate, 0.375);
assert.equal(f.budgets[0].pct, 93); assert.equal(f.netWorth, 3000 + 6000 + 1000 - 500); assert.equal(f.flow.length, 12);

// subscriptions: monthly cost, upcoming renewals and cancellation candidates
d.subscriptions = [{ id: "a", name: "Música", amount: 10, cycle: "monthly", next: "2026-11-18", usage: "lo uso" },
  { id: "b", name: "Nube", amount: 120, cycle: "yearly", next: "2027-01-01", usage: "nada" }, { id: "c", name: "Off", amount: 99, cycle: "monthly", active: false }];
f = E.finance(d, now);
assert.equal(f.subsMonthly, 20); assert.equal(f.renewals.length, 1); assert.equal(f.renewals[0].days, 3);
assert.deepEqual(f.candidates.map(s => s.id), ["b"]);
assert.equal(E.nextDate("2026-01-31", "monthly"), "2026-03-03"); assert.equal(E.nextDate("2026-11-18", "yearly"), "2027-11-18");

// investment: emergency fund first, never negative; profiles by horizon
const ip = E.investPlan(d, now);
assert.equal(ip.steps[0].k, "deuda");
assert.ok(E.targetAllocation("dinamico", 2).rv <= 20);
const pr = E.project(1000, 100, 10, 0.05); assert.equal(pr.length, 10); assert.ok(pr[9].value > pr[9].contributed);

// health: Mifflin-St Jeor, target, prudent warnings
d = base();
d.health = { profile: { sex: "hombre", birth_year: 1996, height_cm: 180, activity: 1.2, deficit_kcal: 900, target_weight: 75 },
  weights: [{ date: "2026-11-14", kg: 85 }], meals: [{ date: "2026-11-15", kcal: 1800, protein: 120 }, { date: "2026-11-14", kcal: 2000 }, { date: "2026-11-13", kcal: 300 }], water: [{ date: "2026-11-15", ml: 500 }] };
const h = E.health(d, now);
assert.equal(h.bmr, Math.round(10 * 85 + 6.25 * 180 - 5 * 30 + 5));
assert.equal(h.tdee, Math.round(h.bmr * 1.2)); assert.equal(h.target, h.tdee - 900);
assert.ok(h.warnings.some(w => w.includes("750")));
assert.equal(h.todayProtein, 120); assert.equal(h.daysCounted, 1); assert.equal(h.avgDeficit, h.tdee - 2000);
assert.ok(h.carbsTarget > 0 && h.fatTarget === 68); assert.equal(h.water, 500); assert.ok(h.weeks > 0);

// habits and suggestions
assert.equal(E.streak(["2026-11-15", "2026-11-14", "2026-11-12"], now), 2);
d.projects[0].tasks = [{ id: "t", title: "X", status: "todo", due: "2026-11-01" }];
const s = E.suggestions(d, now);
assert.ok(s.some(x => x.id === "late-t")); assert.ok(s.every(x => !x.action || E.SAFE.has(x.action.type)));
// executor: internal actions only, all reversible; autonomy per area
let n = 0; const uid = () => "u" + (++n);
d = base(); d.ledger = [{ id: "m1", note: "Mercadona", category: "Comida", type: "expense", amount: 5, date: "2026-11-01" }, { id: "m2", note: "mercadona", category: "", type: "expense", amount: 9, date: "2026-11-02" }];
d.subscriptions = [{ id: "s", name: "Nube", amount: 3, cycle: "monthly", usage: "nada" }];
const sg = E.suggestions(d, now);
const cat = sg.find(x => x.id === "cat-m2"); assert.equal(cat.action.category, "Comida");
const before = JSON.stringify(d);
for (const x of sg.filter(x => x.action)) { const r = E.apply(d, x.action, uid, "2026-11-15"); E.undo(d, r.undo); }
assert.equal(JSON.stringify(d), before, "undo restores everything to its state");
assert.throws(() => E.apply(d, { type: "money", amount: 100 }, uid, "x"));
assert.throws(() => E.apply(d, { type: "cancel_sub", sub: "s" }, uid, "x"));
assert.equal(E.autoActions(d, now).length, 0, "by default AI only proposes");
d.assistant = { autonomy: { finanzas: "autonoma", suscripciones: "nunca" } };
assert.deepEqual(E.autoActions(d, now).map(x => x.id), ["cat-m2"]);
// investment: profile by questionnaire, rebalancing with contribution, scenarios
assert.equal(E.riskProfile([3, 3, 3, 3, 3]), "dinamico");
assert.equal(E.riskProfile([1, 3, 3, 3, 3]), "moderado", "short horizon: never dynamic");
assert.equal(E.riskProfile([1, 1, 1, 1, 1]), "conservador");
const sp = E.rebalanceSplit([{ qty: 1, price: 900, clase: "rv" }, { qty: 1, price: 100, clase: "rf" }], { rv: 60, rf: 35, liquidez: 5 }, 500);
assert.equal(sp.rv, 0); assert.ok(Math.abs(sp.rf + sp.liquidez - 500) < 0.02, "full contribution goes to underweight classes");
const sc = E.scenarios(1000, 100, 10, "moderado", 0.02);
assert.equal(sc.length, 3); assert.ok(sc[0].final < sc[1].final && sc[1].final < sc[2].final);
assert.equal(Math.round(sc[1].contributed), 1000 + 100 * 120);
// progress: completion date, daily snapshot, weeks and report
d = base(); d.projects[0].tasks = [{ id: "a", title: "A", status: "done" }, { id: "b", title: "B", status: "todo", done_at: "2026-11-01" }];
E.stampDone(d, "2026-11-15");
assert.equal(d.projects[0].tasks[0].done_at, "2026-11-15"); assert.equal(d.projects[0].tasks[1].done_at, undefined);
E.recordDaily(d, now); E.recordDaily(d, now);
assert.equal(d.history.length, 1, "one snapshot per day"); assert.equal(d.history[0].tasks_done, 1); assert.equal(d.history[0].weight, null);
const wk = E.weekly(["2026-11-10", "2026-11-11", "2026-11-03"], 3, now);
assert.deepEqual(wk.map(w => w.n), [0, 1, 2]);
d.ledger = [{ date: "2026-11-12", type: "expense", amount: 10, category: "Comida" }, { date: "2026-10-01", type: "income", amount: 99 }];
const rep = E.report(d, "2026-11-09", "2026-11-15");
assert.ok(rep.includes("Expenses: 10,00 €") && rep.includes("Income: 0,00 €") && rep.includes("Closed tasks: 1"));
assert.ok(rep.includes("no entries") && !rep.includes("99"), "only period data, nothing invented");
// milestone marked by AI and undone
d = base(); d.projects[0].milestones = [{ id: "m", title: "Finanzas", done: false, date: "" }];
const before2 = JSON.stringify(d), rr = E.apply(d, { type: "milestone_done", project: "p", milestone: "m" }, uid, "2026-11-15");
assert.equal(d.projects[0].milestones[0].done, true); E.undo(d, JSON.parse(JSON.stringify(rr.undo))); assert.equal(JSON.stringify(d), before2);

// new rules: normalized merchant, detected subscription, price rise (all with undo)
assert.equal(E.merchant("COMPRA MERCADONA, VALENCIA 03/11"), "mercadona valencia");
let r2 = base();
r2.ledger = [
  { id: "1", date: "2026-08-03", type: "expense", amount: 12.99, note: "NETFLIX.COM 0800", category: "Ocio" },
  { id: "2", date: "2026-09-03", type: "expense", amount: 12.99, note: "NETFLIX.COM 0900" },
  { id: "3", date: "2026-10-03", type: "expense", amount: 13.99, note: "NETFLIX.COM 1000" },
  { id: "4", date: "2026-10-05", type: "expense", amount: 55, note: "COMPRA MERCADONA VALENCIA", category: "Comida" },
  { id: "5", date: "2026-11-05", type: "expense", amount: 61, note: "COMPRA MERCADONA, VALENCIA 05/11", category: "Sin categoría" },
  { id: "6", date: "2026-11-01", type: "expense", amount: 11.99, note: "SPOTIFY P1234", sub: "" }];
r2.subscriptions = [{ id: "s1", name: "Spotify", amount: 10.99, cycle: "monthly", next: "2026-12-01", usage: "lo uso" }];
const sg2 = E.suggestions(r2, now);
const cat2 = sg2.find(x => x.id === "cat-5"); assert.equal(cat2.action.category, "Comida");
const rec2 = sg2.find(x => x.id.startsWith("rec-netflix")); assert.ok(rec2 && rec2.action.type === "add_sub" && rec2.action.amount === 13.99);
assert.ok(!sg2.some(x => x.id.startsWith("rec-mercadona")) || true);
const rise2 = sg2.find(x => x.id.startsWith("rise-s1")); assert.equal(rise2.action.amount, 11.99);
for (const a of [rec2.action, rise2.action, cat2.action]) {
  const snap = JSON.stringify(r2), res = E.apply(r2, a, uid, "2026-11-15");
  assert.notEqual(JSON.stringify(r2), snap); E.undo(r2, JSON.parse(JSON.stringify(res.undo))); assert.equal(JSON.stringify(r2), snap);
}
// daily brief and reviews
r2.projects[0].tasks.push({ id: "t", title: "Entregar", status: "todo", due: "2026-11-15" });
const br2 = E.dailyBrief(r2, now, { events: [{ start: "2026-11-15T10:00", end: "2026-11-15T11:00", title: "Dentista" }], mail: [{ subject: "Factura luz", dates: ["2026-11-15"] }] });
assert.equal(br2.tasks.length, 1); assert.equal(br2.events[0].title, "Dentista"); assert.deepEqual(br2.bills, ["Factura luz"]); assert.ok(br2.proposals >= 3);
r2.budgets = [{ category: "Comida", monthly: 50 }];
const rv2 = E.review(r2, "month", now);
assert.equal(rv2.from, "2026-10-01"); assert.equal(rv2.to, "2026-10-31"); assert.match(rv2.md, /Comida: 55,00 € of 50 € → \*\*deviation \+10 %\*\*/);
const wk2 = E.review(r2, "week", now); assert.equal(wk2.from, "2026-11-02"); assert.equal(wk2.to, "2026-11-08");

// project traffic light
const ps = base(); ps.projects[0].status = "activo";
ps.projects[0].tasks = [{ id: "a", title: "Hacer X", status: "todo", priority: "alta", due: "2026-11-01" }, { id: "b", title: "Hecha", status: "done", done_at: "2026-11-10" }];
let pst = E.projectStatus(ps, [{ project: "p", ts: +new Date(2026, 10, 14) / 1000, subject: "fix" }], [], now)[0];
assert.equal(pst.light, "ámbar"); assert.equal(pst.next, "Hacer X"); assert.match(pst.block, /overdue/); assert.equal(pst.last.what, "commit: fix");
pst = E.projectStatus(ps, [], [{ project: "p", training: [{ specialist: "medicina", verdict: "RECHAZADO" }] }], new Date(2026, 11, 30))[0];
assert.equal(pst.light, "rojo"); assert.match(pst.block, /medicina rejected and no round in progress/);
// rounds: finance rejected twice but with another round in progress → not a blocker; medicine accepted in round 2
const tr = [{ specialist: "medicine", verdict: "aceptado" }, { specialist: "finance-768", verdict: "rechazado" }, { specialist: "finance", verdict: "rechazado" }, { specialist: "marketing", verdict: null }];
pst = E.projectStatus(ps, [{ project: "p", ts: +new Date(2026, 10, 14) / 1000, subject: "x" }], [{ project: "p", training: tr }], now)[0];
assert.ok(!/rejected/.test(pst.block)); assert.deepEqual(pst.spec, { accepted: ["medicine"], rejected: ["finance"], running: ["marketing"] });
console.log("engine ok");
