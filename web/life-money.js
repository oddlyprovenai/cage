/* Cage · Finances and Subscriptions (views). */
(() => {
"use strict";
const M = window.Cage, E = window.Engine, L = M.life;
const { st, $$, esc, I, VIEWS, BIND, A, money, fdate, P, sum, save, render, head, empty, bars, donut } = M;
const D = () => st.data;
const MESES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const mlabel = m => MESES[+m.slice(5) - 1];

VIEWS.finanzas = () => {
  const f = E.finance(D()), led = D().ledger.slice().sort((a, b) => b.date.localeCompare(a.date) || 0);
  const filt = st.finFilter || "all", rows = filt === "all" ? led : led.filter(e => e.type === filt);
  const monthExp = D().ledger.filter(e => e.type === "expense" && e.date.startsWith(f.month));
  const cats = {}; monthExp.forEach(e => cats[e.category || "Other"] = (cats[e.category || "Other"] || 0) + +e.amount);
  const ci = Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([l, v], i) => ({ label: l, value: v, color: L.COLORS[i % 8] }));
  const hasFlow = f.flow.some(x => x.income || x.expense);
  const pVault = M.prov({ src: "Encrypted vault", ts: D().updated, kind: "real" }), pCalc = M.prov({ src: "Local calculation (engine.js)", ts: D().updated, kind: "calc" });
  return head("Finances", "Accounts, transactions, budgets, and net worth. Only what you record yourself.",
    `<div class="row"><button class="btn ghost" data-act="account">${I.plus} Account</button><button class="btn" data-act="spend">${I.plus} Transaction</button></div>`) +
  `<div class="grid g-ov stagger">
    <div class="card span2 fin-hero"><div class="lbl">Net worth ${pVault}</div><div class="big num" data-count="${f.netWorth}">0</div>
      <p class="small muted">Accounts ${money(f.liquid)} · portfolio ${money(f.invested)}${f.debt ? ` · debts −${money(f.debt)}` : ""}</p></div>
    <div class="card mini pos-bg"><div class="lbl">Month's income ${pVault}</div><div class="mid num" data-count="${f.incomeMonth}">0</div></div>
    <div class="card mini neg-bg"><div class="lbl">Month's expenses ${pVault}</div><div class="mid num" data-count="${f.expenseMonth}">0</div></div>
    <div class="card mini"><div class="lbl">Savings rate ${pCalc}</div><div class="mid num">${L.pct(f.savingsRate)}</div><p class="small muted">average 2 closed months</p></div>
    <div class="card mini"><div class="lbl">Average flow ${pCalc}</div><div class="mid num ${f.surplus < 0 ? "neg" : ""}">${money(f.surplus, 0)}</div><p class="small muted">per month</p></div>
    <div class="card span4"><h3>Cash flow <span class="badge m">12 months</span> ${pVault}</h3>
      <div class="legend"><span><i data-c="var(--blue)"></i>Income</span><span><i data-c="var(--acc)"></i>Expenses</span></div>
      ${hasFlow ? bars(f.flow.map(x => mlabel(x.month)), [{ name: "Income", color: "var(--blue)", values: f.flow.map(x => x.income) }, { name: "Expenses", color: "var(--acc)", values: f.flow.map(x => x.expense) }], { fmt: v => money(v) }) : empty("No transactions yet", `Press <kbd>g</kbd> or “Transaction” to record the first one.`)}</div>
    <div class="card span2"><h3>Month's expenses by category ${pVault}</h3>${ci.length ? `<div class="dwrap">${donut(ci, { size: 170 })}</div><div class="legend">${ci.map(c => `<span><i data-c="${c.color}"></i>${esc(c.label)} ${money(c.value, 0)}</span>`).join("")}</div>` : empty("No expenses this month", "")}</div>
    <div class="card span3"><h3>Budgets ${pVault} <button class="btn sm ghost" data-act="budget">${I.plus}</button></h3><div class="list">
      ${f.budgets.map(b => `<div class="li"><div class="t"><b>${esc(b.category)}</b><div class="meter"><i data-w="${Math.min(100, b.pct)}%" data-c="${b.pct >= 100 ? "var(--neg)" : b.pct >= 80 ? "#E0A33A" : "var(--pos)"}"></i></div><small>${money(b.spent, 0)} of ${money(b.monthly, 0)} · ${b.pct} %${b.pct >= 100 ? " · exceeded" : b.pct >= 80 ? " · near limit" : ""}</small></div><button class="btn sm ghost" data-budget="${esc(b.id)}">Edit</button></div>`).join("") || empty("No budgets", "Set a monthly limit by category and I'll warn you at 80% and 100%.")}</div></div>
    <div class="card span3"><h3>Accounts ${pVault} <button class="btn sm ghost" data-act="account">${I.plus}</button></h3><div class="list">
      ${D().accounts.map(a => `<div class="li"><span class="lic">${esc((a.name[0] || "?").toUpperCase())}</span><div class="t"><b>${esc(a.name)}</b><small>${esc(a.type)} · balance as of ${fdate(a.updated)}</small></div><span class="num ${a.balance < 0 ? "neg" : ""}">${money(a.balance)}</span><button class="btn sm ghost" data-acc="${esc(a.id)}">Edit</button></div>`).join("") || empty("No accounts", "Add your accounts with their current balance; transactions will adjust it.")}</div></div>
    <div class="card span6"><div class="row between wrap"><div class="row wrap">${[["all", "All"], ["income", "Income"], ["expense", "Expenses"]].map(([k, l]) => `<button class="chip ${filt === k ? "on" : ""}" data-ff="${k}">${l}</button>`).join("")}</div><span class="small muted">${rows.length} transactions ${pVault}</span></div>
      <div class="scroll"><table class="tbl"><thead><tr><th>Description</th><th>Category</th><th>Account</th><th>Project</th><th class="r">Amount</th><th></th></tr></thead><tbody>
      ${rows.slice(0, 300).map(e => `<tr><td><div class="row"><span class="lic">${e.type === "income" ? I.up : I.down}</span><div><b>${esc(e.note || (e.type === "income" ? "Income" : "Expense"))}</b><br><small class="muted">${fdate(e.date)}</small></div></div></td><td><span class="badge m">${esc(e.category || "—")}</span></td><td>${esc(L.acc(e.account)?.name || "—")}</td><td>${esc(P(e.project)?.name || "Personal")}</td><td class="r num ${e.type === "income" ? "pos" : "neg"}">${e.type === "income" ? "+" : "−"}${money(+e.amount)}</td><td class="r"><button class="btn sm ghost" data-del-mov="${esc(e.id)}">Delete</button></td></tr>`).join("") || `<tr><td colspan="6">${empty("No transactions", "Record an expense with <kbd>g</kbd> from any screen.")}</td></tr>`}
      </tbody></table></div></div>
  </div>`;
};
BIND.finanzas = v => {
  $$("[data-ff]", v).forEach(b => b.onclick = () => { st.finFilter = b.dataset.ff; render(); });
  $$("[data-budget]", v).forEach(b => b.onclick = () => A.budget(D().budgets.find(x => x.id === b.dataset.budget)));
  $$("[data-acc]", v).forEach(b => b.onclick = () => A.account(D().accounts.find(x => x.id === b.dataset.acc)));
  $$("[data-del-mov]", v).forEach(b => b.onclick = () => { if (b.dataset.armed) { L.delMove(b.dataset.delMov); save(); render(); } else { b.dataset.armed = 1; b.textContent = "Are you sure?"; } });
};

VIEWS.suscripciones = () => {
  const f = E.finance(D()), S = D().subscriptions.slice().sort((a, b) => (a.active === false) - (b.active === false) || (a.next || "").localeCompare(b.next || ""));
  const act = S.filter(s => s.active !== false);
  const pSubs = M.prov({ src: "Vault (subscriptions)", ts: D().updated, kind: "real" }), pCalc = M.prov({ src: "Subscription calculation", ts: D().updated, kind: "calc" });
  return head("Subscriptions", "What you pay every month without realizing. Each renewal is an expected charge that you confirm with one click.",
    `<button class="btn" data-act="sub">${I.plus} Subscription</button>`) +
  `<div class="grid g-ov stagger">
    <div class="card span2"><div class="lbl">Monthly cost ${pSubs}</div><div class="big num" data-count="${f.subsMonthly}">0</div><p class="small muted">${act.length} active${f.avgIncome ? ` · ${L.pct(f.subsMonthly / f.avgIncome)} of your income` : ""}</p></div>
    <div class="card span2"><div class="lbl">Annual cost ${pCalc}</div><div class="big num" data-count="${f.subsYearly}">0</div><p class="small muted">if nothing changes</p></div>
    <div class="card span2"><div class="lbl">Potential savings ${pCalc}</div><div class="big num" data-count="${sum(f.candidates, E.monthlyOf) * 12}">0</div><p class="small muted">per year cancelling those you rarely or never use</p></div>
    <div class="card span3"><h3>Charges in next 7 days ${pSubs}</h3><div class="list">${f.renewals.map(L.renewalRow).join("") || empty("Nothing upcoming", "No renewals this week.")}</div></div>
    <div class="card span3"><h3>Cancellation candidates ${pCalc}</h3><div class="list">${f.candidates.map(s => `<div class="li"><span class="lic">${esc(s.name[0])}</span><div class="t"><b>${esc(s.name)}</b><small>usage: ${esc(s.usage)} · ${money(E.monthlyOf(s))}/mo</small></div><button class="btn sm ghost" data-cancel-sub="${esc(s.id)}">Mark cancelled</button></div>`).join("") || empty("None", "Set the usage for each subscription (active use / rarely / never) and cancellation candidates will appear here.")}</div></div>
    <div class="card span6"><h3>All ${pSubs}</h3><div class="scroll"><table class="tbl"><thead><tr><th>Service</th><th>Cycle</th><th>Next</th><th>Category</th><th>Usage</th><th class="r">Price</th><th class="r">Monthly</th><th></th></tr></thead><tbody>
      ${S.map(s => `<tr class="${s.active === false ? "off" : ""}"><td><b>${esc(s.name)}</b>${s.active === false ? ' <span class="badge m">cancelled</span>' : ""}</td><td>${esc(L.CYC[s.cycle] || s.cycle)}</td><td>${fdate(s.next)}</td><td><span class="badge m">${esc(s.category || "—")}</span></td>
        <td><select class="in sel-sm" data-usage="${esc(s.id)}">${[["lo uso", "active use"], ["poco", "rarely"], ["nada", "never"]].map(([u, l]) => `<option value="${u}" ${s.usage === u ? "selected" : ""}>${l}</option>`).join("")}</select></td>
        <td class="r num">${money(s.amount)}</td><td class="r num">${money(E.monthlyOf(s))}</td><td class="r"><button class="btn sm ghost" data-edit-sub="${esc(s.id)}">Edit</button></td></tr>`).join("") || `<tr><td colspan="8">${empty("No subscriptions", "Add Netflix, Spotify, iCloud, gym… and see what they really cost you.")}</td></tr>`}
    </tbody></table></div></div>
  </div>`;
};
BIND.suscripciones = v => {
  L.bindMoney(v);
  const S = id => D().subscriptions.find(x => x.id === id);
  $$("[data-edit-sub]", v).forEach(b => b.onclick = () => A.sub(S(b.dataset.editSub)));
  $$("[data-cancel-sub]", v).forEach(b => b.onclick = () => { S(b.dataset.cancelSub).active = false; save(); render(); });
  $$("[data-usage]", v).forEach(s => s.onchange = () => { S(s.dataset.usage).usage = s.value; save(); render(true); });
};
})();
