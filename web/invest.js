/* Cage · Financial manager and investments (Phase 5). All calculated by engine.js; AI only explains.
   Educational: not regulated professional advice and NEVER executes orders. */
(() => {
"use strict";
const M = window.Cage, E = window.Engine;
const { st, $, $$, esc, uid, today, I, VIEWS, BIND, A, money, fdate, sum, toast, modal, save, render, head, empty, line, donut } = M;
const D = () => st.data, IP = () => (D().invest_profile ||= {});
const CLS = { rv: ["Equities", "#F0592A"], rf: ["Fixed income", "#3E5BDB"], liquidez: ["Liquidity", "#1E9E5A"], cripto: ["Crypto", "#8E5BD9"], otro: ["Other", "#6B6F78"] };
const BLOCKS = {
  rv: "Global index equity fund or ETF (e.g. tracking MSCI World or MSCI ACWI)",
  rf: "EUR index bond fund (government or aggregate), with duration matching your horizon",
  liquidez: "Money market fund or interest-bearing account/deposit for emergency fund and cash reserve",
};
const PDESC = {
  conservador: "Prioritizes capital preservation: higher fixed income and cash. Slower growth with smaller drawdowns.",
  moderado: "Balanced: long-term growth accepting temporary 15–25% drawdowns.",
  dinamico: "Maximum long-term growth. May drop 30–40% in a bad year: only suitable with long horizon and emergency cushion.",
};
const DISC = `<div class="disc">${I.shield}<div><b>Educational tool.</b> Not regulated professional financial advice nor a personalized recommendation. Cage never executes orders nor connects to brokers. Investing involves risk of loss.</div></div>`;

Object.assign(A, {
  quiz() {
    modal("Your investor profile (5 questions)", E.QUIZ.map((x, i) => ({ name: "q" + i, label: x.q, type: "select", options: x.a.map(([l, v]) => [String(v), l]), value: String(IP().answers?.[i] || "") })), o => {
      const ans = E.QUIZ.map((_, i) => +o["q" + i] || 1), prof = E.riskProfile(ans);
      Object.assign(IP(), { answers: ans, risk: prof, quiz_date: today() });
      save(); toast("Profile: " + E.PROFILES[prof].label); render();
    }, "Calculate profile");
  },
  iprofile() {
    const p = IP();
    modal("Investment plan", [
      { name: "horizon_years", label: "Horizon (years)", type: "number", value: p.horizon_years ?? 10, req: true },
      { name: "emergency_months", label: "Emergency fund (months of expenses, 3–6)", type: "number", value: p.emergency_months ?? 6, req: true },
      { name: "monthly_contribution", label: "Monthly contribution (€)", type: "number", step: "1", value: p.monthly_contribution ?? "" },
      { name: "risk", label: "Profile (or take the quiz)", type: "select", value: p.risk || "moderado", options: Object.entries(E.PROFILES).map(([k, v]) => [k, v.label]) }], o => {
      Object.assign(p, { horizon_years: Math.max(1, +o.horizon_years || 10), emergency_months: Math.min(12, Math.max(1, +o.emergency_months || 6)), monthly_contribution: o.monthly_contribution === "" ? undefined : Math.max(0, +o.monthly_contribution), risk: o.risk });
      save(); render();
    });
  },
  holding(h) {
    const pf = D().portfolio;
    modal(h ? "Edit " + h.symbol : "New position", [{ name: "symbol", label: "Short name or ISIN", value: h?.symbol || "", req: true }, { name: "name", label: "Description", value: h?.name || "" },
      { name: "clase", label: "Asset class", type: "select", value: h?.clase || "rv", options: Object.entries(CLS).map(([k, v]) => [k, v[0]]) },
      { name: "qty", label: "Shares / Units", type: "number", step: "any", value: h?.qty ?? "", req: true }, { name: "avg_cost", label: "Average cost", type: "number", step: "any", value: h?.avg_cost ?? "", req: true },
      { name: "price", label: "Current price per unit", type: "number", step: "any", value: h?.price ?? "", req: true }, ...(h ? [{ name: "del", label: "Type DELETE to remove it", value: "" }] : [])], o => {
      if (h && (o.del === "DELETE" || o.del === "BORRAR")) { pf.holdings = pf.holdings.filter(x => x !== h); save(); render(); return; }
      const v = { symbol: o.symbol.trim().toUpperCase(), name: o.name.trim(), clase: o.clase, qty: +o.qty, avg_cost: +o.avg_cost, price: +o.price, updated: today() };
      h ? Object.assign(h, v) : pf.holdings.push({ id: uid(), ...v }); save(); render();
    });
  },
});

function bar(pct, c) { return `<div class="meter"><i data-w="${Math.min(100, pct)}%" data-c="${c}"></i></div>`; }
VIEWS.inversion = () => {
  const ip = E.investPlan(D()), p = IP(), pf = D().portfolio, H = pf.holdings, T = ip.target, al = ip.allocation;
  const seg = st.invTab || "plan";
  const tabs = `<div class="seg" id="invTabs">${[["plan", "Plan"], ["cartera", "Portfolio"], ["simulador", "Simulator"], ["examen", "AI Exam"]].map(([k, l]) => `<button data-it="${k}" class="${seg === k ? "on" : ""}">${l}</button>`).join("")}</div>`;
  let body = "";
  if (seg === "plan") {
    const split = ip.monthly ? E.rebalanceSplit(H, T, ip.monthly) : null;
    const pProf = M.prov({ src: "Vault (invest_profile)", ts: p.quiz_date || D().updated, kind: "real" }), pCalc = M.prov({ src: "Calculation (engine.js)", ts: p.quiz_date || D().updated, kind: "calc" });
    body = `<div class="grid g-ov stagger">
      <div class="card span2"><h3>Your profile ${pProf} <button class="btn sm ghost" data-act="iprofile">Edit</button></h3>
        <div class="big">${esc(T.label)}</div><p class="small muted">${p.quiz_date ? "Quiz from " + fdate(p.quiz_date) : "No quiz yet"} · horizon ${ip.horizon} years</p>
        <p class="small">${esc(PDESC[ip.profile] || "")}</p>
        <button class="btn sm" data-act="quiz">${p.quiz_date ? "Retake quiz" : "Take quiz (1 min)"}</button></div>
      <div class="card span2"><h3>Target allocation ${pCalc}</h3><div class="dwrap">${donut([["rv", T.rv], ["rf", T.rf], ["liquidez", T.liquidez]].map(([k, v]) => ({ label: CLS[k][0], value: v, color: CLS[k][1] })), { size: 150 })}</div>
        <div class="legend">${["rv", "rf", "liquidez"].map(k => `<span><i data-c="${CLS[k][1]}"></i>${CLS[k][0]} ${T[k]} %</span>`).join("")}</div></div>
      <div class="card span2"><h3>Monthly contribution ${pCalc}</h3><div class="big num" data-count="${ip.monthly}">0</div>
        <p class="small muted">${p.monthly_contribution === undefined ? "Suggestion: half your average savings. Change in Edit." : "Set by you."}</p>
        ${split ? `<div class="list">${["rv", "rf", "liquidez"].map(k => `<div class="li"><span class="lic c" data-c="${CLS[k][1]}">${k === "liquidez" ? "L" : k.toUpperCase()}</span><div class="t"><b>${CLS[k][0]}</b><small>${esc(BLOCKS[k])}</small></div><span class="num">${money(split[k])}</span></div>`).join("")}</div>
        <p class="small muted">Monthly breakdown to reach target without selling anything.</p>` : ""}</div>
      <div class="card span6"><h3>Getting started plan <span class="badge m">step by step</span> ${pCalc}</h3><div class="steps">
        ${ip.steps.map((s, i) => `<div class="step ${s.ok ? "ok" : ""}"><span class="n">${s.ok ? "✓" : i + 1}</span><div><b>${esc(s.title)}</b><p class="small muted">${esc(s.why)}</p></div></div>`).join("")}</div></div>
      <div class="card span6"><h3>Low-cost model portfolio · ${esc(T.label)} ${pCalc}</h3><div class="list">
        ${["rv", "rf", "liquidez"].map(k => `<div class="li"><span class="lic c" data-c="${CLS[k][1]}">${T[k]}%</span><div class="t"><b>${CLS[k][0]}</b><small>${esc(BLOCKS[k])}</small></div></div>`).join("")}</div>
        <p class="small muted">Look for funds with low total expense ratio (TER), ideally below 0.3%, and contribute monthly. This is a generic asset allocation structure, not a specific product recommendation.</p></div>
    </div>`;
  } else if (seg === "cartera") {
    const val = sum(H, h => h.qty * h.price), cost = sum(H, h => h.qty * h.avg_cost), pl = val - cost;
    const pPort = M.prov({ src: "Vault (portfolio)", ts: H[0]?.updated || D().updated, kind: "real" }), pCalc = M.prov({ src: "Calculation (engine.js)", ts: D().updated, kind: "calc" });
    body = `<div class="grid g-ov stagger">
      <div class="card span2"><div class="lbl">Portfolio value ${pPort}</div><div class="big num" data-count="${val + (+pf.cash || 0)}">0</div><p class="small ${pl >= 0 ? "pos" : "neg"}">${pl >= 0 ? "+" : ""}${money(pl)} (${cost ? (100 * pl / cost).toFixed(1).replace(".", ",") : "0,0"} %)</p>
        <div class="row"><button class="btn sm" data-act="holding">${I.plus} Position</button><button class="btn sm ghost" data-act="cash">Cash</button></div></div>
      <div class="card span4"><h3>Actual vs target <span class="badge ${ip.drift > 5 ? "" : "g"}">drift ${ip.drift.toFixed(1).replace(".", ",")} pts</span> ${pCalc}</h3>
        ${al.total ? ["rv", "rf", "liquidez", "cripto", "otro"].filter(k => al.pct[k] || T[k]).map(k => `<div class="mac"><div class="row between"><span>${CLS[k][0]}</span><b class="num">${al.pct[k]} % <small class="muted">/ ${T[k] ?? 0} %</small></b></div>${bar(al.pct[k], CLS[k][1])}</div>`).join("") + (ip.drift > 5 ? `<p class="small">Proposal: direct upcoming contributions to underweight assets (Plan tab). Only sell if drift exceeds 10 points.</p>` : "") : empty("No positions", "Add your funds with their asset class to compare against your profile.")}</div>
      <div class="card span6"><h3>Positions ${pPort}</h3><div class="scroll"><table class="tbl"><thead><tr><th>Asset</th><th>Class</th><th class="r">Units</th><th class="r">Average cost</th><th class="r">Value</th><th class="r">Gain/Loss</th><th></th></tr></thead><tbody>
        ${H.map(h => { const g = h.qty * (h.price - h.avg_cost); return `<tr><td><b>${esc(h.symbol)}</b><br><small class="muted">${esc(h.name || "")} · price as of ${fdate(h.updated)}</small></td><td><span class="badge m">${esc(CLS[h.clase || "otro"][0])}</span></td><td class="r num">${h.qty}</td><td class="r num">${money(h.avg_cost)}</td><td class="r num">${money(h.qty * h.price)}</td><td class="r num ${g >= 0 ? "pos" : "neg"}">${g >= 0 ? "+" : ""}${money(g)}</td><td class="r"><button class="btn sm ghost" data-edit-h="${esc(h.id)}">Edit</button></td></tr>`; }).join("") || `<tr><td colspan="7">${empty("Empty portfolio", "Only positions you log appear here; update prices manually.")}</td></tr>`}
      </tbody></table></div></div></div>`;
  } else if (seg === "simulador") {
    const S = st.sim ||= { initial: Math.round(ip.idle) || 0, monthly: ip.monthly || 100, years: Math.min(40, ip.horizon || 10), infl: 1 };
    const sc = E.scenarios(+S.initial, +S.monthly, +S.years, ip.profile, S.infl ? 0.02 : 0);
    const pSim = M.prov({ src: "Simulation (engine.js)", ts: D().updated, kind: "paper" });
    body = `<div class="grid g-ov stagger">
      <div class="card span2" data-noprov="formulario"><h3>Parameters</h3><form id="simF">
        <div class="f"><label>Initial capital (€)</label><input class="in" name="initial" type="number" value="${S.initial}"></div>
        <div class="f"><label>Monthly contribution (€)</label><input class="in" name="monthly" type="number" value="${S.monthly}"></div>
        <div class="f"><label>Years</label><input class="in" name="years" type="number" min="1" max="50" value="${S.years}"></div>
        <div class="li"><div class="t"><b>Adjust for inflation (2%)</b><small>Results in today's euros</small></div><button type="button" class="tg ${S.infl ? "on" : ""}" id="tgInfl" aria-label="Inflation"></button></div></form></div>
      <div class="card span4"><h3>Trajectory · ${esc(ip.target.label)} profile ${pSim}</h3>
        <div class="legend">${sc.map((x, i) => `<span><i data-c="${["#A3A7AF", "var(--acc)", "var(--pos)"][i]}"></i>${x.name} ${(100 * x.ret).toFixed(1).replace(".", ",")} %</span>`).join("")}<span><i data-c="var(--blue)"></i>Contributed</span></div>
        ${line(sc[1].pts.map(x => "a" + x.year), [...sc.map((x, i) => ({ name: x.name, color: ["#A3A7AF", "var(--acc)", "var(--pos)"][i], values: x.pts.map(y => Math.round(y.value)) })), { name: "Contributed", color: "var(--blue)", values: sc[1].pts.map(y => Math.round(y.contributed)) }], { h: 240, fmt: v => money(v, 0), smooth: false })}</div>
      <div class="card span6"><h3>Results after ${S.years} years ${pSim}</h3><table class="tbl"><thead><tr><th>Scenario</th><th class="r">Assumed annual return</th><th class="r">Contributed</th><th class="r">Final value</th><th class="r">Gain</th></tr></thead><tbody>
        ${sc.map(x => `<tr><td><b>${x.name}</b></td><td class="r num">${(100 * x.ret).toFixed(1).replace(".", ",")} %${S.infl ? ` (real ${(100 * x.real).toFixed(1).replace(".", ",")} %)` : ""}</td><td class="r num">${money(x.contributed, 0)}</td><td class="r num">${money(x.final, 0)}</td><td class="r num pos">${money(x.final - x.contributed, 0)}</td></tr>`).join("")}</tbody></table>
        <p class="small muted">Assumptions: constant return of profile (${(100 * E.PROFILES[ip.profile].ret).toFixed(1).replace(".", ",")}%) ± 2 points, monthly compounding, net of fees and taxes. Real markets do not rise in a straight line: negative years will occur.</p></div></div>`;
  } else {
    const ev = st.evals;
    body = `<div class="grid g-ov stagger"><div class="card span6"><h3>Personal finance exam for AI ${M.prov({ src: "SPIKE (/api/evals)", ts: ev?.results?.[0]?.date || D().updated, kind: "real" })}</h3>
      <p class="sub">Measures whether a model correctly computes financial basics (compound interest, savings, budgeting, inflation, debt). Programmatically generated questions with verifiable numeric answers; not authored by an AI.</p>
      ${ev === undefined || ev === null ? empty("Loading…", "") : ev.results.length ? `<table class="tbl"><thead><tr><th>Model</th><th class="r">Correct</th><th class="r">Score</th><th>Date</th></tr></thead><tbody>${ev.results.map(r => `<tr><td><b>${esc(r.model)}</b></td><td class="r num">${r.correct}/${r.n}</td><td class="r num">${(100 * r.correct / r.n).toFixed(1).replace(".", ",")} %</td><td>${esc(r.date)}</td></tr>`).join("")}</tbody></table>` : empty(`No evaluation yet · ${ev.questions} questions prepared`, "Scores will appear once the exam runs against the base model and the SPIKE finance specialist (when training concludes). No hallucinated scores.")}</div></div>`;
  }
  return head("Investments", "Getting started plan, portfolio, simulator, and AI exam. All numbers calculated by the dashboard; AI only explains.", tabs) + DISC + body;
};
BIND.inversion = v => {
  $$("[data-it]", v).forEach(b => b.onclick = () => { st.invTab = b.dataset.it; if (b.dataset.it === "examen" && st.evals === undefined) loadEvals(); render(); });
  $$("[data-edit-h]", v).forEach(b => b.onclick = () => A.holding(D().portfolio.holdings.find(h => h.id === b.dataset.editH)));
  const f = $("#simF", v);
  if (f) {
    if (st.simFocus) { const el = f[st.simFocus]; if (el) { el.focus(); const n = el.value.length; try { el.setSelectionRange(n, n); } catch { /* number */ } } }
    f.onfocusin = e => { st.simFocus = e.target.name; };
    f.oninput = () => { Object.assign(st.sim, { initial: Math.max(0, +f.initial.value || 0), monthly: Math.max(0, +f.monthly.value || 0), years: Math.min(50, Math.max(1, +f.years.value || 1)) }); clearTimeout(f._t); f._t = setTimeout(() => render(true), 350); };
    $("#tgInfl", v).onclick = () => { st.sim.infl = !st.sim.infl; render(true); };
  }
};
function loadEvals() { st.evals = null; M.api("/api/evals").then(r => { st.evals = r; render(true); }).catch(() => { st.evals = { questions: 0, results: [] }; render(true); }); }
})();
