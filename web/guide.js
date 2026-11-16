/* Cage · Interactive guide (phase 6): ~2-minute initial tour highlighting each section, mini-guides per module
   with practical tasks that check off automatically when completed, and a "?" on each card explaining what it shows
   and where data comes from. Progress is saved encrypted in your data (guide). */
(() => {
"use strict";
const M = window.Cage;
const { st, $, $$, esc, TABS, HOOKS, save, go, toast } = M;
const D = () => st.data, G = () => (st.data.guide ||= { tour: null, seen: [] });

/* ---------- initial walkthrough ---------- */
const TOUR = [
  { tab: "hoy", sel: ".brand", t: "Welcome to Cage", x: "Your private dashboard: everything is saved encrypted on this Mac with your password. This tour takes about 2 minutes." },
  { tab: "hoy", sel: "#tabs", t: "Tabs", x: "Each area of your life has its own tab. Shortcut: keys 1 to 9." },
  { tab: "hoy", sel: "#projRail", t: "Projects", x: "Pick a project to filter the whole dashboard, or click the grid to see them all." },
  { tab: "hoy", sel: "#btnSpend", t: "Quick expense", x: "Log an expense in seconds from any screen. Shortcut: g." },
  { tab: "hoy", sel: "#btnAdd", t: "Quick add", x: "Tasks, meals, weight, subscriptions… Shortcut: n. To search: ⌘K." },
  { tab: "hoy", sel: ".quick", t: "Today's focus", x: "Type a task and press Enter. Below you see overdue, today's, and in-progress items." },
  { tab: "finanzas", sel: ".fin-hero", t: "Finances", x: "Net worth = accounts + portfolio − debts. You set balances; each transaction updates them." },
  { tab: "suscripciones", sel: ".head", t: "Subscriptions", x: "What you pay monthly and yearly, what renews this week, and what you could cancel." },
  { tab: "salud", sel: ".head", t: "Health", x: "Complete your profile and log weight and meals: calculates caloric burn and deficit with standard formulas." },
  { tab: "progreso", sel: ".head", t: "Progress", x: "Every day you open Cage, a snapshot of your data is saved: see how projects, net worth, weight, and habits evolve." },
  { tab: "trading", sel: "#trTabs", t: "Investing agent", x: "24/7 paper trading for crypto and stocks/ETFs with live data. Check Results & Research: no live edge currently, so real trading is off. You can lose money; not financial advice." },
  { tab: "inversion", sel: "#invTabs", t: "Investment", x: "Getting-started plan, portfolio, simulator, and AI exam. Educational: never executes real orders." },
  { tab: "ia", sel: ".head", t: "Assistant", x: "Proposes actions and, only if enabled per area, makes internal changes that you can always undo." },
  { tab: "cuenta", sel: ".head", t: "Account & security", x: "Password, auto-lock, Claude access, and encrypted backups. Click ? anytime to reopen this guide." },
];
let ov = null, step = 0;
function startTour(i = 0) { step = i; G().tour = "en curso"; show(); }
function endTour(done) {
  ov?.remove(); ov = null; G().tour = done ? "hecho" : "saltado"; save();
  if (done) toast("Tour completed. Module mini-guides are available via the ? button");
}
function show() {
  const s = TOUR[step];
  if (st.tab !== s.tab) { go(s.tab); setTimeout(show, 450); return; }
  const el = $(s.sel);
  if (!el) { step < TOUR.length - 1 ? (step++, show()) : endTour(true); return; }
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  setTimeout(() => {
    const r = el.getBoundingClientRect(), pad = 8;
    ov?.remove(); ov = document.createElement("div"); ov.className = "tour";
    ov.innerHTML = `<div class="tour-hole"></div><div class="tour-card card" role="dialog" aria-label="${esc(s.t)}"><small class="muted">${step + 1} of ${TOUR.length}</small>
      <h3>${esc(s.t)}</h3><p>${esc(s.x)}</p><div class="tour-bar"><i></i></div>
      <div class="row between"><button class="btn sm ghost" data-t="skip">Skip</button><div class="row">${step ? '<button class="btn sm ghost" data-t="prev">Previous</button>' : ""}<button class="btn sm" data-t="next">${step === TOUR.length - 1 ? "Finish" : "Next"}</button></div></div></div>`;
    document.body.appendChild(ov);
    const hole = $(".tour-hole", ov), card = $(".tour-card", ov);
    Object.assign(hole.style, { left: r.left - pad + "px", top: r.top - pad + "px", width: r.width + 2 * pad + "px", height: r.height + 2 * pad + "px" });
    $(".tour-bar i", ov).style.width = (100 * (step + 1) / TOUR.length) + "%";
    const below = r.bottom + 16 + 220 < innerHeight;
    card.style.top = (below ? r.bottom + 16 : Math.max(16, r.top - 16 - card.offsetHeight)) + "px";
    card.style.left = Math.min(innerWidth - card.offsetWidth - 16, Math.max(16, r.left)) + "px";
    $$("[data-t]", ov).forEach(b => b.onclick = () => { const a = b.dataset.t; if (a === "skip") endTour(false); else if (a === "prev") { step--; show(); } else if (step === TOUR.length - 1) endTour(true); else { step++; show(); } });
    $("[data-t=next]", ov).focus();
  }, 380);
}
document.addEventListener("keydown", e => { if (!ov) return; if (e.key === "Escape") endTour(false); if (e.key === "ArrowRight") $("[data-t=next]", ov)?.click(); if (e.key === "ArrowLeft") $("[data-t=prev]", ov)?.click(); }, true);

/* ---------- mini-guides per module: practical tasks verified against real data ---------- */
const GUIDES = [
  ["Finances", "finanzas", [["Create your first account with its balance", d => d.accounts.length > 0], ["Record an expense with key g", d => d.ledger.some(e => e.type === "expense")], ["Set a monthly budget for a category", d => d.budgets.length > 0]]],
  ["Subscriptions", "suscripciones", [["Add a subscription", d => d.subscriptions.length > 0], ["Set its usage (active / low / none)", d => d.subscriptions.some(s => s.usage)], ["Confirm an expected charge", d => d.ledger.some(e => e.sub)]]],
  ["Health", "salud", [["Complete your health profile", d => !!d.health.profile.height_cm], ["Log your weight", d => d.health.weights.length > 0], ["Log a meal and save it to your library", d => d.health.foods.length > 0], ["Write a one-day meal plan", d => Object.values(d.health.plan || {}).some(x => Object.values(x || {}).some(Boolean))]]],
  ["Investment", "inversion", [["Take the risk profile questionnaire", d => !!d.invest_profile?.quiz_date], ["Set your monthly contribution", d => d.invest_profile?.monthly_contribution !== undefined], ["Add a holding with its asset class", d => d.portfolio.holdings.some(h => h.clase)]]],
  ["Progress", "progreso", [["Create a habit", d => (d.habits || []).length > 0], ["Check it off today", d => (d.habits || []).some(h => (h.log || []).includes(new Date().toISOString().slice(0, 10)))]]],
  ["Assistant", "ia", [["Accept or dismiss a suggestion", d => (d.assistant?.log || []).length > 0 || (d.assistant?.dismissed || []).length > 0], ["Choose autonomy for an area", d => Object.keys(d.assistant?.autonomy || {}).length > 0], ["Leave a request in Claude's inbox", d => (d.claude_inbox || []).length > 0]]],
  ["Projects", "proyectos", [["Add a task with key n", d => d.projects.some(p => p.tasks.some(t => t.source === "owner" || t.source === "you"))], ["Record a KPI", d => d.projects.some(p => p.kpis.length)], ["Record a month in subscriber funnel", d => d.projects.some(p => (p.funnel || []).length)]]],
];
function guideMenu() {
  const d = D(), rows = GUIDES.map(([name, tab, tasks]) => ({ name, tab, tasks: tasks.map(([t, ok]) => ({ t, ok: !!ok(d) })) }));
  const all = rows.flatMap(r => r.tasks), pct = Math.round(100 * all.filter(x => x.ok).length / all.length);
  const m = $("#modal");
  m.innerHTML = `<div class="card guide"><h3>Cage Guide <button class="ico" data-x aria-label="Close">✕</button></h3>
    <div class="row between"><span class="lbl">Your progress</span><b class="num">${pct} %</b></div><div class="meter"><i></i></div>
    <div class="row"><button class="btn sm" data-g="tour">${G().tour === "hecho" || G().tour === "done" ? "Repeat tour (2 min)" : "Start tour (2 min)"}</button><span class="small muted">Shortcut: ?</span></div>
    ${rows.map(r => `<div class="gmod"><div class="row between"><b>${esc(r.name)}</b><button class="btn sm ghost" data-g="${r.tab}">Go</button></div>
      ${r.tasks.map(x => `<div class="li"><span class="ck ${x.ok ? "on" : ""}"></span><div class="t"><span class="${x.ok ? "done-t" : ""}">${esc(x.t)}</span></div></div>`).join("")}</div>`).join("")}
    <p class="small muted">Tasks are automatically checked off when you complete them. Each card has a “?” explaining what it shows and where data comes from.</p></div>`;
  m.hidden = false;
  $(".meter i", m).style.width = pct + "%";
  const close = () => { m.hidden = true; m.innerHTML = ""; };
  $$("[data-x]", m).forEach(b => b.onclick = close); m.onclick = e => { if (e.target === m) close(); };
  $$("[data-g]", m).forEach(b => b.onclick = () => { close(); b.dataset.g === "tour" ? startTour(0) : go(b.dataset.g); });
}
HOOKS.help = guideMenu;

/* ---------- "?" on each card ---------- */
const HELP = {
  "Today's focus": "Overdue tasks, due today, in progress, and high priority from your projects. Comes from tasks you create in Projects.",
  "Next milestone": "The first incomplete milestone of each project (Projects → Milestones).",
  "Goals": "Your goals. Progress compares against real data: recorded monthly income or completed milestones. Never counted as profits.",
  "Recent notes": "Most recently modified notes in your Obsidian vault. Read-only: Cage never writes to it.",
  "Renewals": "Subscription charges in the next 7 days (or overdue unconfirmed). “Confirm charge” creates the actual expense.",
  "Health today": "What you ate today vs your kcal target, water and latest weight. Comes from the Health tab.",
  "Monthly money": "Expenses and income recorded this month, and budgets over 80%.",
  "Assistant proposals": "Rules applied to your data (nothing made up): renewals, budgets, tasks, health, investing. Accepting applies the action; everything can be undone.",
  "Cash flow": "Recorded monthly income and expenses across 12 months.",
  "Monthly expenses by category": "Breakdown of this month's expenses based on the categories you set.",
  "Budgets": "Monthly limit by category. Alerts at 80% and 100% based on this month's spending.",
  "Accounts": "Balances you enter. Transactions assigned to an account adjust it automatically; edit anytime.",
  "Upcoming charges (next 7 days)": "Upcoming renewals based on date and billing cycle of each subscription.",
  "Charges in the next 7 days": "Upcoming renewals based on date and billing cycle of each subscription.",
  "Cancellation candidates": "Subscriptions marked as low or no use, sorted by cost. Cancellations must be made directly with the service.",
  "All": "All your subscriptions with their monthly equivalent cost (yearly ÷ 12, weekly × 52 ÷ 12).",
  "Weight": "Your weight logs and 7-day moving average, smoothing out daily water fluctuations.",
  "Today's macros": "Target protein 1.8g/kg; fat 0.8g/kg; carbs from remaining kcal. Water guideline: 35ml/kg.",
  "Last 7 days": "Kcal consumed each day vs your expenditure (Mifflin-St Jeor TDEE × activity + logged exercise).",
  "Weekly meal plan": "Your custom meal plan. The assistant can populate empty days from your food library if permitted.",
  "Today's meals": "What you log today with kcal and macros. Foods saved in your library can be added with one click.",
  "Your profile": "Determined by the 5-question quiz: horizon, drop reaction, goal, emergency fund, and experience.",
  "Target allocation": "Equities, fixed income, and cash for your profile, adjusted if your horizon is short.",
  "Monthly contribution": "The amount you choose, or half your average surplus. Allocation directs new money to underweight classes.",
  "Getting started plan": "Prudent order: high-interest debt → emergency fund → idle cash → periodic contributions → rebalancing.",
  "Actual vs target": "Your current asset allocation vs profile target. More than 5 points drift: rebalance.",
  "Autonomy by area": "Propose: suggest only. Autonomous: executes internal, reversible changes automatically. Never: completely manual. Money and orders: never autonomous.",
  "Action log": "Everything you accepted or the AI executed, with full undo capability.",
  "Claude inbox": "Requests for Claude, stored encrypted. Claude reads them via the Cage CLI if access is enabled.",
  "Web research": "Searches and reads web pages in read-only mode, showing sources. Never logs in or makes purchases.",
  "Subscriber funnel": "Visits → signups → paid per month that you track, with conversion rates per step.",
  "Live SPIKE": "Read directly from the SPIKE repository: team board and status of each training run.",
  "Obsidian": "Project note in your vault: status, next steps and log. Read-only.",
  "Commits": "Git commits in project repositories over the last 30 days.",
  "KPIs": "Metrics you log with dates. SPIKE KPIs come from its evaluation results.",
  "Current decisions": "Output from the local shadow model on the latest hourly candle: regime, direction with calibrated probability, quality 0–3 and risk. Code policy decides if trades execute.",
  "Paper capital": "Simulated balance: real Binance prices with fee (0.10%) and slippage. Not real money.",
  "Out-of-sample results": "Walk-forward: trained on past data, tested on the unseen following month after costs. Compared to buy-and-hold.",
  "Honest assessment": "Why 95% win rate is not pursued: in real markets, that only happens by overfitting the past.",
  "Market regime": "Dominance, stablecoins, and TVL from public sources (CoinGecko, DefiLlama), with timestamps.",
  "Allocation": "Paper balance across the three agent parts: trading, long-term crypto, and stocks/ETFs. Simulated: not real money.",
  "Stocks and ETFs": "Long-term paper portfolio with European UCITS ETFs and satellites if beating the benchmark. Monthly contributions and band rebalancing. Real orders are proposed for you to execute in your broker.",
  "Long-term crypto": "Paper basket of BTC/ETH/SOL weighted by your risk profile. Spot only, with concentration caps.",
  "How to read this": "Backtest with real data and transaction costs; estimated 21% tax. If a strategy doesn't beat the index, the index is used. You may lose money; not regulated financial advice.",
  "Expenses by category": "Expenses over the last 12 months grouped by category.",
  "Income vs expenses": "Monthly trend of recorded income and expenses over the last 12 months.",
  "Performance by project": "Income, expenses, open tasks and milestones for each project. Only transactions assigned to that project.",
  "Profile": "Your name and dashboard currency.",
  "Security": "AES-256-GCM encryption with your password, Claude access (revocable), auto-lock, and encrypted backup.",
  "Local AI": "AI server running on this Mac (SPIKE, llama.cpp, or Ollama). Remote servers are never allowed.",
  "Activity log": "Key events and access logs (logins, password changes, Claude access). Written by the server, not the browser.",
};

// Spanish aliases so both English and Spanish card titles match
HELP["Foco de hoy"] = HELP["Today's focus"];
HELP["Siguiente hito"] = HELP["Next milestone"];
HELP["Objetivos"] = HELP["Goals"];
HELP["Últimas notas"] = HELP["Recent notes"];
HELP["Renovaciones"] = HELP["Renewals"];
HELP["Salud hoy"] = HELP["Health today"];
HELP["Dinero del mes"] = HELP["Monthly money"];
HELP["Propuestas del asistente"] = HELP["Assistant proposals"];
HELP["Flujo de caja"] = HELP["Cash flow"];
HELP["Gasto del mes por categoría"] = HELP["Monthly expenses by category"];
HELP["Presupuestos"] = HELP["Budgets"];
HELP["Cuentas"] = HELP["Accounts"];
HELP["Cargos de los próximos 7 días"] = HELP["Charges in the next 7 days"];
HELP["Candidatas a cancelar"] = HELP["Cancellation candidates"];
HELP["Todas"] = HELP["All"];
HELP["Peso"] = HELP["Weight"];
HELP["Macros de hoy"] = HELP["Today's macros"];
HELP["Últimos 7 días"] = HELP["Last 7 days"];
HELP["Plan de comidas semanal"] = HELP["Weekly meal plan"];
HELP["Comidas de hoy"] = HELP["Today's meals"];
HELP["Tu perfil"] = HELP["Your profile"];
HELP["Objetivo de reparto"] = HELP["Target allocation"];
HELP["Aportación mensual"] = HELP["Monthly contribution"];
HELP["Plan para empezar"] = HELP["Getting started plan"];
HELP["Real vs objetivo"] = HELP["Actual vs target"];
HELP["Autonomía por área"] = HELP["Autonomy by area"];
HELP["Registro de acciones"] = HELP["Action log"];
HELP["Bandeja para Claude"] = HELP["Claude inbox"];
HELP["Investigar en la web"] = HELP["Web research"];
HELP["Embudo de suscriptores"] = HELP["Subscriber funnel"];
HELP["SPIKE en vivo"] = HELP["Live SPIKE"];
HELP["Obsidian"] = HELP["Obsidian"];
HELP["Commits"] = HELP["Commits"];
HELP["KPIs"] = HELP["KPIs"];
HELP["Decisiones actuales"] = HELP["Current decisions"];
HELP["Capital en papel"] = HELP["Paper capital"];
HELP["Resultados fuera de muestra"] = HELP["Out-of-sample results"];
HELP["Lectura honesta"] = HELP["Honest assessment"];
HELP["Régimen de mercado"] = HELP["Market regime"];
HELP["Reparto"] = HELP["Allocation"];
HELP["Acciones y ETF"] = HELP["Stocks and ETFs"];
HELP["Cripto a largo plazo"] = HELP["Long-term crypto"];
HELP["Cómo leer esto"] = HELP["How to read this"];
HELP["Gastos por categoría"] = HELP["Expenses by category"];
HELP["Ingresos vs gastos"] = HELP["Income vs expenses"];
HELP["Rendimiento por proyecto"] = HELP["Performance by project"];
HELP["Perfil"] = HELP["Profile"];
HELP["Seguridad"] = HELP["Security"];
HELP["IA local"] = HELP["Local AI"];
HELP["Registro de actividad"] = HELP["Activity log"];

const prevAfter = HOOKS.afterRender;
HOOKS.afterRender = v => {
  prevAfter(v);
  $$(".card > h3", v).forEach(h => {
    if (h.querySelector(".qh")) return;
    const title = (h.firstChild?.textContent || "").trim(), key = Object.keys(HELP).find(k => title.startsWith(k));
    if (!key) return;
    const b = document.createElement("button"); b.className = "qh"; b.type = "button"; b.textContent = "?"; b.setAttribute("aria-label", "About " + key);
    b.onclick = e => { e.stopPropagation(); pop(b, key); };
    h.firstChild.after(b);
  });
};
function pop(b, key) {
  $(".qpop")?.remove();
  const p = document.createElement("div"); p.className = "qpop card"; p.innerHTML = `<b>${esc(key)}</b><p>${esc(HELP[key])}</p>`;
  document.body.appendChild(p);
  const r = b.getBoundingClientRect();
  p.style.top = r.bottom + 8 + "px"; p.style.left = Math.min(innerWidth - p.offsetWidth - 12, Math.max(12, r.left - 20)) + "px";
  setTimeout(() => document.addEventListener("click", () => p.remove(), { once: true }), 0);
}

// First time visiting: initial tour (can be skipped; does not automatically reappear)
const after = HOOKS.afterLoad;
HOOKS.afterLoad = () => { after(); if (!G().tour) setTimeout(() => startTour(0), 900); };
M.guide = { startTour, guideMenu, HELP, TOUR };
})();

