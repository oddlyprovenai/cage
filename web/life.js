/* Cage · Life: finances, subscriptions, and health. Uses helpers exposed by app.js (window.Cage) and pure
   engines from engine.js (window.Engine). No fabricated data: empty states with add buttons. */
(() => {
"use strict";
const M = window.Cage, E = window.Engine;
const { st, $, $$, esc, uid, today, I, VIEWS, BIND, A, money, fdate, P, sum, toast, modal, save, render, head, empty, bars, line, donut } = M;
const D = () => st.data;
const CATS = ["Food", "Housing", "Transport", "Leisure", "Health", "Clothing", "Subscriptions", "Education", "Work", "Gifts", "Other"];
const COLORS = ["#F0592A", "#3E5BDB", "#1E9E5A", "#E0A33A", "#8E5BD9", "#26A6B5", "#D94F8C", "#6B6F78"];
const pct = v => v === null || v === undefined || !isFinite(v) ? "—" : (100 * v).toFixed(1).replace(".", ",") + " %";
const catOpts = () => [...new Set([...CATS, ...D().ledger.map(e => e.category).filter(Boolean)])].map(c => [c, c]);
const accOpts = () => [["", "— No account —"], ...D().accounts.map(a => [a.id, a.name])];
const acc = id => D().accounts.find(a => a.id === id);
const CYC = { weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly", yearly: "Yearly" };
const USE = { "lo uso": "g", poco: "", nada: "" };
const kcalFmt = v => v === null || v === undefined ? "—" : Math.round(v).toLocaleString("es-ES");

/* ---------- money: single point to create and delete transactions (adjusts account balance) ---------- */
function addMove(m) {
  const e = { id: uid(), date: m.date || today(), project: m.project || "", type: m.type || "expense", amount: +m.amount,
    category: (m.category || "").trim(), note: (m.note || "").trim(), account: m.account || "", sub: m.sub || "" };
  D().ledger.push(e);
  const a = acc(e.account); if (a) a.balance = +(+a.balance + (e.type === "income" ? e.amount : -e.amount)).toFixed(2);
  return e;
}
function delMove(id) {
  const e = D().ledger.find(x => x.id === id); if (!e) return;
  const a = acc(e.account); if (a) a.balance = +(+a.balance - (e.type === "income" ? e.amount : -e.amount)).toFixed(2);
  D().ledger = D().ledger.filter(x => x !== e);
}

Object.assign(A, {
  spend(type = "expense") {
    modal(type === "income" ? "Quick income" : "Quick expense", [
      { name: "amount", label: "Amount (€)", type: "number", step: "0.01", req: true },
      { name: "category", label: "Category", type: "select", options: catOpts(), value: type === "income" ? "Work" : "Food" },
      { name: "account", label: "Account", type: "select", options: accOpts(), value: D().accounts[0]?.id || "" },
      { name: "note", label: "Note", value: "" }, { name: "date", label: "Date", type: "date", value: today() },
      { name: "project", label: "Project (optional)", type: "select", options: [["", "— Personal —"], ...D().projects.map(p => [p.id, p.name])], value: st.proj === "all" ? "" : st.proj },
      { name: "type", label: "Type", type: "select", options: [["expense", "Expense"], ["income", "Income"]], value: type }], o => {
      if (!(+o.amount > 0)) { toast("Invalid amount"); return false; }
      addMove(o); save(); toast(`${o.type === "income" ? "Income" : "Expense"} of ${money(+o.amount)} saved`); render();
    });
  },
  money() { A.spend(); },
  account(a) {
    modal(a ? "Edit " + a.name : "New account", [{ name: "name", label: "Name", value: a?.name || "", req: true },
      { name: "type", label: "Type", type: "select", value: a?.type || "cuenta", options: [["cuenta", "Checking account"], ["ahorro", "Savings"], ["efectivo", "Cash"], ["broker", "Broker (tracking only)"], ["deuda", "Debt / credit card"]] },
      { name: "balance", label: "Current balance (€, negative if debt)", type: "number", step: "0.01", value: a?.balance ?? "", req: true },
      ...(a ? [{ name: "del", label: "Type DELETE to remove", value: "" }] : [])], o => {
      if (a && (o.del === "BORRAR" || o.del === "DELETE")) { D().accounts = D().accounts.filter(x => x !== a); save(); render(); return; }
      const v = { name: o.name.trim(), type: o.type, balance: +o.balance || 0, updated: today() };
      a ? Object.assign(a, v) : D().accounts.push({ id: uid(), ...v }); save(); render();
    });
  },
  budget(b) {
    modal(b ? "Budget for " + b.category : "New monthly budget", [
      { name: "category", label: "Category", type: "select", options: catOpts(), value: b?.category || "Food" },
      { name: "monthly", label: "Monthly limit (€)", type: "number", step: "1", value: b?.monthly ?? "", req: true },
      ...(b ? [{ name: "del", label: "Type DELETE to remove", value: "" }] : [])], o => {
      if (b && (o.del === "BORRAR" || o.del === "DELETE")) { D().budgets = D().budgets.filter(x => x !== b); save(); render(); return; }
      if (!(+o.monthly > 0)) { toast("Invalid limit"); return false; }
      const ex = b || D().budgets.find(x => x.category === o.category);
      ex ? Object.assign(ex, { category: o.category, monthly: +o.monthly }) : D().budgets.push({ id: uid(), category: o.category, monthly: +o.monthly });
      save(); render();
    });
  },
  sub(s) {
    modal(s ? "Edit " + s.name : "New subscription", [{ name: "name", label: "Service", value: s?.name || "", req: true },
      { name: "amount", label: "Price (€)", type: "number", step: "0.01", value: s?.amount ?? "", req: true },
      { name: "cycle", label: "Cycle", type: "select", value: s?.cycle || "monthly", options: Object.entries(CYC) },
      { name: "next", label: "Next renewal", type: "date", value: s?.next || "", req: true },
      { name: "category", label: "Category", type: "select", options: catOpts(), value: s?.category || "Subscriptions" },
      { name: "usage", label: "Usage", type: "select", value: s?.usage || "lo uso", options: [["lo uso", "Active use"], ["poco", "Rarely"], ["nada", "Never"]] },
      { name: "account", label: "Charged to", type: "select", options: accOpts(), value: s?.account || "" },
      { name: "active", label: "Status", type: "select", value: s?.active === false ? "0" : "1", options: [["1", "Active"], ["0", "Cancelled"]] },
      ...(s ? [{ name: "del", label: "Type DELETE to remove", value: "" }] : [])], o => {
      if (s && (o.del === "BORRAR" || o.del === "DELETE")) { D().subscriptions = D().subscriptions.filter(x => x !== s); save(); render(); return; }
      if (!(+o.amount >= 0)) { toast("Invalid price"); return false; }
      const v = { name: o.name.trim(), amount: +o.amount, cycle: o.cycle, next: o.next, category: o.category, usage: o.usage, account: o.account, active: o.active === "1" };
      s ? Object.assign(s, v) : D().subscriptions.push({ id: uid(), created: today(), ...v }); save(); render();
    });
  },
});

// expected subscription charge → real transaction with one click, and advances to next date
function confirmCharge(id) {
  const s = D().subscriptions.find(x => x.id === id); if (!s) return;
  addMove({ type: "expense", amount: s.amount, category: s.category || "Subscriptions", note: "Subscription " + s.name, date: s.next, account: s.account, sub: s.id });
  s.next = E.nextDate(s.next, s.cycle); save(); toast(`Charge for ${s.name} recorded · next ${fdate(s.next)}`); render();
}
function skipCharge(id) { const s = D().subscriptions.find(x => x.id === id); if (s) { s.next = E.nextDate(s.next, s.cycle); save(); render(); } }
function renewalRow(s) {
  const when = s.days < 0 ? `overdue on ${fdate(s.next)}` : s.days === 0 ? "today" : `in ${s.days} days · ${fdate(s.next)}`;
  return `<div class="li"><span class="lic">${esc(s.name[0] || "?")}</span><div class="t"><b>${esc(s.name)} · ${money(s.amount)}</b><small>${when} · expected charge</small></div>
    <button class="btn sm" data-charge="${esc(s.id)}">Confirm charge</button><button class="btn sm ghost" data-skip="${esc(s.id)}" title="Not charged this cycle">Skip</button></div>`;
}
function bindMoney(v) {
  $$("[data-charge]", v).forEach(b => b.onclick = () => confirmCharge(b.dataset.charge));
  $$("[data-skip]", v).forEach(b => b.onclick = () => skipCharge(b.dataset.skip));
}

M.life = { addMove, delMove, confirmCharge, renewalRow, bindMoney, pct, CATS, COLORS, CYC, USE, kcalFmt, acc, catOpts };
})();
