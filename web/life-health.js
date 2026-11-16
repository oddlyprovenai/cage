/* Cage · Health (weight, meals, water, exercise, sleep, weekly plan) and life cards in Today. Calculations in engine.js.
   No medical advice: standard formulas only (Mifflin-St Jeor) and prudent alerts. */
(() => {
"use strict";
const M = window.Cage, E = window.Engine, L = M.life;
const { st, $, $$, esc, uid, today, I, VIEWS, BIND, A, HOOKS, money, fdate, sum, toast, modal, save, render, head, empty, line, bars } = M;
const D = () => st.data, H = () => st.data.health;
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const SLOTS = [["desayuno", "Breakfast"], ["comida", "Lunch"], ["cena", "Dinner"], ["snacks", "Snacks"]];
const k = L.kcalFmt;

Object.assign(A, {
  hprofile() {
    const p = H().profile;
    modal("Your health profile", [
      { name: "sex", label: "Sex (for formula)", type: "select", value: p.sex || "hombre", options: [["hombre", "Male"], ["mujer", "Female"]] },
      { name: "birth_year", label: "Birth year", type: "number", value: p.birth_year ?? "", req: true },
      { name: "height_cm", label: "Height (cm)", type: "number", value: p.height_cm ?? "", req: true },
      { name: "activity", label: "Activity level", type: "select", value: String(p.activity || 1.375), options: [["1.2", "Sedentary (desk job)"], ["1.375", "Light (1–3 days/week)"], ["1.55", "Moderate (3–5 days/week)"], ["1.725", "High (6–7 days/week)"], ["1.9", "Very high (physical job + training)"]] },
      { name: "target_weight", label: "Target weight (kg)", type: "number", step: "0.1", value: p.target_weight ?? "" },
      { name: "target_date", label: "Target date (optional)", type: "date", value: p.target_date || "" },
      { name: "deficit_kcal", label: "Daily deficit (kcal; prudent 300–500)", type: "number", value: p.deficit_kcal ?? 400 }], o => {
      H().profile = { sex: o.sex, birth_year: +o.birth_year, height_cm: +o.height_cm, activity: +o.activity, target_weight: +o.target_weight || null, target_date: o.target_date, deficit_kcal: Math.max(0, +o.deficit_kcal || 0) };
      save(); render();
    });
  },
  weight() {
    modal("Log weight", [{ name: "kg", label: "Weight (kg)", type: "number", step: "0.1", req: true, value: H().weights.at(-1)?.kg ?? "" }, { name: "date", label: "Date", type: "date", value: today() }], o => {
      if (!(+o.kg > 20 && +o.kg < 400)) { toast("Invalid weight"); return false; }
      H().weights = H().weights.filter(w => w.date !== o.date).concat({ date: o.date, kg: +o.kg }).sort((a, b) => a.date.localeCompare(b.date));
      save(); toast("Weight saved"); render();
    });
  },
  meal(pre = {}) {
    const foods = H().foods;
    modal("Log meal", [
      { name: "food", label: "From your library", type: "select", options: [["", "— New food —"], ...foods.map(f => [f.id, `${f.name} · ${f.kcal} kcal`])], value: pre.food || "" },
      { name: "slot", label: "Meal", type: "select", options: SLOTS, value: pre.slot || slotNow() },
      { name: "name", label: "Name (if new)", value: "" }, { name: "kcal", label: "kcal", type: "number" },
      { name: "protein", label: "Protein (g)", type: "number", step: "0.1" }, { name: "carbs", label: "Carbs (g)", type: "number", step: "0.1" }, { name: "fat", label: "Fat (g)", type: "number", step: "0.1" },
      { name: "keep", label: "Save to your library?", type: "select", options: [["1", "Yes"], ["0", "No"]], value: "1" },
      { name: "date", label: "Date", type: "date", value: today() }], o => {
      let f = foods.find(x => x.id === o.food);
      if (!f) {
        if (!o.name.trim() || !(+o.kcal >= 0) || o.kcal === "") { toast("Enter name and kcal"); return false; }
        f = { id: uid(), name: o.name.trim(), kcal: +o.kcal, protein: +o.protein || 0, carbs: +o.carbs || 0, fat: +o.fat || 0 };
        if (o.keep === "1") foods.push(f);
      }
      H().meals.push({ id: uid(), date: o.date || today(), slot: o.slot, name: f.name, kcal: f.kcal, protein: f.protein, carbs: f.carbs, fat: f.fat });
      save(); toast(`${f.name}: ${f.kcal} kcal`); render();
    });
  },
  water(ml = 250) { H().water.push({ date: today(), ml }); save(); render(true); },
  exercise() {
    modal("Log exercise", [{ name: "name", label: "Activity", req: true }, { name: "minutes", label: "Minutes", type: "number" }, { name: "kcal", label: "Calories burned (estimate)", type: "number", req: true }, { name: "date", label: "Date", type: "date", value: today() }], o => {
      H().exercise.push({ id: uid(), date: o.date, name: o.name.trim(), minutes: +o.minutes || 0, kcal: +o.kcal || 0 }); save(); render();
    });
  },
  sleep() {
    modal("Log sleep", [{ name: "hours", label: "Hours slept", type: "number", step: "0.25", req: true }, { name: "date", label: "Night ending on", type: "date", value: today() }], o => {
      H().sleep = H().sleep.filter(s => s.date !== o.date).concat({ date: o.date, hours: +o.hours }); save(); render();
    });
  },
  planday(i) {
    const p = H().plan, day = p[i] || {};
    modal("Plan · " + DAYS[i], SLOTS.map(([s, l]) => ({ name: s, label: l, type: "textarea", value: day[s] || "" })), o => {
      p[i] = Object.fromEntries(SLOTS.map(([s]) => [s, o[s].trim()])); save(); render();
    });
  },
});
function slotNow() { const h = new Date().getHours(); return h < 11 ? "desayuno" : h < 17 ? "comida" : h < 22 ? "cena" : "snacks"; }
M.health = { DAYS, SLOTS, slotNow };

function ring(value, target, label, color = "var(--acc)") {
  const p = target ? Math.min(1, value / target) : 0, R = 52, C = 2 * Math.PI * R;
  return `<svg class="chart ring" viewBox="0 0 130 130"><circle cx="65" cy="65" r="${R}" fill="none" stroke="var(--line)" stroke-width="12"/>
    <circle class="dn" data-len="${(C * p).toFixed(1)}" cx="65" cy="65" r="${R}" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round" transform="rotate(-90 65 65)"/>
    <text x="65" y="62" text-anchor="middle" class="ring-v">${k(value)}</text><text x="65" y="82" text-anchor="middle">${esc(label)}</text></svg>`;
}

VIEWS.salud = () => {
  const h = E.health(D()), p = H().profile, W = H().weights.slice(-60), t = today();
  const ready = !!h.tdee;
  const meals = H().meals.filter(m => m.date === t), ex = H().exercise.filter(e => e.date === t);
  const avg = W.map((w, i) => { const r = W.slice(Math.max(0, i - 6), i + 1); return +(sum(r, x => x.kg) / r.length).toFixed(2); });
  const dow = (new Date().getDay() + 6) % 7, plan = H().plan[dow] || {};
  const pHealth = M.prov({ src: "Vault (health)", ts: W.at(-1)?.date || D().updated, kind: "real" }), pCalc = M.prov({ src: "Mifflin-St Jeor (engine.js)", ts: D().updated, kind: "calc" });
  return head("Health", "Weight, nutrition, deficit, water, exercise, and sleep. Standard formulas, not medical advice.",
    `<div class="row"><button class="btn ghost" data-act="hprofile">Profile</button><button class="btn ghost" data-act="weight">${I.plus} Weight</button><button class="btn" data-act="meal">${I.plus} Meal</button></div>`) +
  (h.warnings.length ? `<div class="warn stagger">${h.warnings.map(w => `<div class="li"><span class="lic">!</span><div class="t"><b>${esc(w)}</b></div></div>`).join("")}</div>` : "") +
  `<div class="grid g-ov stagger">
    ${ready ? "" : `<div class="card span6 cta" data-noprov="notice"><div class="row between wrap"><div><b>Complete your profile</b><p class="small muted">With height, birth year, sex, activity, and weight I can calculate your daily energy expenditure (Mifflin-St Jeor) and deficit.</p></div><div class="row"><button class="btn" data-act="hprofile">Complete profile</button><button class="btn ghost" data-act="weight">Log weight</button></div></div></div>`}
    <div class="card span2 center"><div class="lbl">Today ${pHealth}</div>${ring(h.todayKcal, h.target || 0, h.target ? `of ${k(h.target)} kcal` : "kcal")}
      <p class="small muted">${h.target ? `You have <b>${k(Math.max(0, h.target - h.todayKcal + h.todayBurned))}</b> kcal left${h.todayBurned ? ` (includes ${k(h.todayBurned)} from exercise)` : ""}` : "Complete your profile to see your target"}</p></div>
    <div class="card mini"><div class="lbl">Weight ${pHealth}</div><div class="mid num">${h.last ? h.last.toLocaleString("es-ES") + " kg" : "—"}</div><p class="small muted">${h.avg7 ? "7-day avg " + h.avg7.toFixed(1).replace(".", ",") : "no records"}</p></div>
    <div class="card mini"><div class="lbl">Target ${pCalc}</div><div class="mid num">${p.target_weight ? p.target_weight + " kg" : "—"}</div><p class="small muted">${h.eta ? "at current pace: " + fdate(h.eta) : h.toLose > 0 ? "log meals to estimate" : ""}${p.target_date ? " · goal " + fdate(p.target_date) : ""}</p></div>
    <div class="card mini"><div class="lbl">Daily expenditure (TDEE) ${pCalc}</div><div class="mid num">${k(h.tdee)}</div><p class="small muted">${h.bmr ? "basal " + k(h.bmr) + " kcal" : "profile needed"}</p></div>
    <div class="card mini ${h.avgDeficit > 0 ? "pos-bg" : ""}"><div class="lbl">Weekly deficit ${pCalc}</div><div class="mid num">${h.weekDeficit !== null ? k(h.weekDeficit) : "—"}</div><p class="small muted">${h.avgDeficit !== null ? `≈ ${(h.weekDeficit / 7700).toFixed(2).replace(".", ",")} kg/week · ${h.daysCounted} complete days` : "log complete days (≥ 800 kcal)"}</p></div>
    <div class="card span4"><h3>Weight <span class="badge m">${W.length} logs</span> ${pHealth}</h3>
      <div class="legend"><span><i data-c="var(--blue)"></i>Weight</span><span><i data-c="var(--acc)"></i>7-day moving avg</span></div>
      ${W.length >= 2 ? line(W.map(w => w.date.slice(8) + "/" + w.date.slice(5, 7)), [{ name: "Weight", color: "var(--blue)", values: W.map(w => w.kg) }, { name: "7-day avg", color: "var(--acc)", values: avg, area: true }], { h: 220, fmt: v => v + " kg", min: "auto" }) : empty("Log your weight", "With two entries you'll see the trend and 7-day moving average.")}</div>
    <div class="card span2"><h3>Today's macros ${pHealth}</h3>
      ${[["Protein", h.todayProtein, h.proteinTarget, "var(--blue)"], ["Carbs", h.todayCarbs, h.carbsTarget, "#E0A33A"], ["Fat", h.todayFat, h.fatTarget, "var(--acc)"]].map(([l, v, tg, c]) => `<div class="mac"><div class="row between"><span>${l}</span><b class="num">${Math.round(v)} g${tg ? ` / ${tg}` : ""}</b></div><div class="meter"><i data-w="${tg ? Math.min(100, 100 * v / tg) : Math.min(100, v)}%" data-c="${c}"></i></div></div>`).join("")}
      <div class="row between water"><div><div class="lbl">Water</div><b class="num">${(h.water / 1000).toFixed(2).replace(".", ",")} / ${(h.waterTarget / 1000).toFixed(1).replace(".", ",")} L</b></div><div class="row"><button class="btn sm ghost" data-water="250">+250 ml</button><button class="btn sm ghost" data-water="500">+500</button></div></div>
      <div class="row between"><div><div class="lbl">Sleep</div><b class="num">${h.sleep !== null ? h.sleep + " h" : "—"}</b> <small class="muted">${h.sleep7 ? "7-day avg " + h.sleep7.toFixed(1).replace(".", ",") + " h" : ""}</small></div><button class="btn sm ghost" data-act="sleep">Log</button></div></div>
    <div class="card span3"><h3>Today's meals ${pHealth} <button class="btn sm ghost" data-act="meal">${I.plus}</button></h3><div class="list">
      ${meals.map(m => `<div class="li"><span class="lic">${esc(m.slot?.[0]?.toUpperCase() || "·")}</span><div class="t"><b>${esc(m.name)}</b><small>${esc(m.slot || "")} · P ${Math.round(m.protein || 0)} · C ${Math.round(m.carbs || 0)} · F ${Math.round(m.fat || 0)}</small></div><span class="num">${k(m.kcal)} kcal</span><button class="ico" data-del-meal="${esc(m.id)}" aria-label="Delete">✕</button></div>`).join("") || empty("Nothing logged today", "Add meals; saved meals stay in your library to add in one click.")}
      ${H().foods.length ? `<div class="lbl">Library</div><div class="row wrap">${H().foods.slice(0, 12).map(f => `<button class="chip" data-food="${esc(f.id)}">${esc(f.name)} · ${f.kcal}</button>`).join("")}</div>` : ""}</div></div>
    <div class="card span3"><h3>Last 7 days <span class="badge m">kcal</span> ${pHealth}</h3>
      ${h.days7.some(x => x.kcal) ? bars(h.days7.map(x => x.date.slice(8)), [{ name: "Intake", color: "var(--acc)", values: h.days7.map(x => x.kcal) }, { name: "Burned (TDEE + exercise)", color: "var(--blueSoft)", values: h.days7.map(x => h.tdee ? h.tdee + x.burned : 0) }], { h: 200, fmt: v => k(v) + " kcal" }) : empty("No meals this week", "")}
      <div class="row between"><div class="lbl">Exercise today: ${ex.length ? ex.map(e => esc(e.name)).join(", ") + " · " + k(h.todayBurned) + " kcal" : "none"}</div><button class="btn sm ghost" data-act="exercise">${I.plus} Exercise</button></div></div>
    <div class="card span6"><h3>Weekly meal plan <span class="badge m">today: ${M.health.DAYS[dow]}</span> ${pHealth}</h3>
      <div class="plan">${M.health.DAYS.map((d, i) => { const x = H().plan[i] || {}; return `<button class="pday ${i === dow ? "on" : ""}" data-plan="${i}"><b>${d}</b>${M.health.SLOTS.map(([s, l]) => `<small><i>${l}</i>${esc(x[s] || "—")}</small>`).join("")}</button>`; }).join("")}</div>
      ${Object.values(plan).some(Boolean) ? "" : `<p class="small muted">Click a day to write its plan.</p>`}</div>
  </div>`;
};
BIND.salud = v => {
  $$("[data-water]", v).forEach(b => b.onclick = () => A.water(+b.dataset.water));
  $$("[data-food]", v).forEach(b => b.onclick = () => { const f = H().foods.find(x => x.id === b.dataset.food); H().meals.push({ id: uid(), date: today(), slot: M.health.slotNow(), name: f.name, kcal: f.kcal, protein: f.protein, carbs: f.carbs, fat: f.fat }); save(); toast(`${f.name} added`); render(true); });
  $$("[data-del-meal]", v).forEach(b => b.onclick = () => { H().meals = H().meals.filter(m => m.id !== b.dataset.delMeal); save(); render(true); });
  $$("[data-plan]", v).forEach(b => b.onclick = () => A.planday(+b.dataset.plan));
};

/* ---------- Hoy: 7-day renewals, health, and month's money ---------- */
HOOKS.hoy = () => {
  const f = E.finance(D()), h = E.health(D());
  const pSubs = M.prov({ src: "Vault (subscriptions)", ts: D().updated, kind: "real" }), pHealth = M.prov({ src: "Vault (health)", ts: D().updated, kind: "real" }), pVault = M.prov({ src: "Encrypted vault", ts: D().updated, kind: "real" });
  return `<div class="card span2"><h3>Renewals <span class="badge m">7 days</span> ${pSubs}</h3><div class="list">${f.renewals.map(L.renewalRow).join("") || empty("No charges this week", `<button class="btn sm ghost" data-go="suscripciones">View subscriptions</button>`)}</div></div>
    <div class="card span2"><h3>Health today ${pHealth} <button class="btn sm ghost" data-go="salud">${I.arrow}</button></h3>
      ${h.tdee ? `<div class="row between"><span class="lbl">Eaten</span><b class="num">${k(h.todayKcal)} / ${k(h.target)} kcal</b></div><div class="meter"><i data-w="${Math.min(100, 100 * h.todayKcal / h.target)}%" data-c="var(--acc)"></i></div>
        <div class="row between"><span class="lbl">Water</span><b class="num">${(h.water / 1000).toFixed(2).replace(".", ",")} L</b></div><div class="row between"><span class="lbl">Weight</span><b class="num">${h.last ?? "—"} kg</b></div>
        <div class="row"><button class="btn sm ghost" data-water="250">+ Water</button><button class="btn sm ghost" data-act="meal">+ Meal</button></div>` : empty("Set up Health", `<button class="btn sm" data-act="hprofile">Complete profile</button>`)}</div>
    <div class="card span2"><h3>Month's money ${pVault} <button class="btn sm ghost" data-go="finanzas">${I.arrow}</button></h3>
      <div class="row between"><span class="lbl">Spent</span><b class="num">${money(f.expenseMonth)}</b></div><div class="row between"><span class="lbl">Income</span><b class="num">${money(f.incomeMonth)}</b></div>
      ${f.budgets.filter(b => b.pct >= 80).map(b => `<p class="small neg">${esc(b.category)} at ${b.pct} % of budget</p>`).join("")}
      <button class="btn sm" data-act="spend">${I.plus} Quick expense</button></div>`;
};
const hoyBind = BIND.hoy;
BIND.hoy = v => { hoyBind && hoyBind(v); L.bindMoney(v); $$("[data-water]", v).forEach(b => b.onclick = () => A.water(+b.dataset.water)); };
})();
