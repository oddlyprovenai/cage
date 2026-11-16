/* Cage · Step-by-step connection wizard (G1).
   Guides you through the dashboard connections, tests each one immediately, and shows real server output.
   Credentials are only sent to the corresponding local endpoint and never stored in localStorage or console. */
(() => {
"use strict";
const M = window.Cage;
const { st, $, $$, esc, TABS, VIEWS, BIND, HOOKS, A, toast, render, head } = M;
const D = () => st.data;

const results = {};
let loadingMail = false, loadingBk = false;

function ensureStatus() {
  if (st.mail === undefined && !loadingMail && M.api) {
    loadingMail = true;
    M.api("/api/mail", { body: { action: "status" } })
      .then(r => { st.mail = r; loadingMail = false; if (st.tab === "conectar" || st.tab === "hoy") render(true); })
      .catch(e => { st.mail = { configured: false, error: e.message }; loadingMail = false; if (st.tab === "conectar" || st.tab === "hoy") render(true); });
  }
  if (st.bc === undefined && M.api) {
    st.bc = null;
    M.api("/api/trading/blockchair", { body: { action: "" } })
      .then(r => { st.bc = r; if (st.tab === "conectar") render(true); })
      .catch(() => { st.bc = { saved: false }; });
  }
  if (st.bk === undefined && !loadingBk && M.api) {
    loadingBk = true;
    M.api("/api/backups")
      .then(r => { st.bk = r; loadingBk = false; if (st.tab === "conectar" || st.tab === "hoy") render(true); })
      .catch(e => { st.bk = { dest: null, error: e.message }; loadingBk = false; if (st.tab === "conectar" || st.tab === "hoy") render(true); });
  }
}

async function reloadData() {
  try {
    const r = await M.api("/api/data");
    st.data = M.normalize ? M.normalize(r.data) : r.data;
    st.version = r.version;
  } catch { /* retain current state */ }
}

function stepsState() {
  const d = D() || {};
  const mailOk = st.mail == null ? null : Boolean(st.mail.configured);
  const calOk = Boolean(d.calendar);
  const remOk = Boolean(d.reminders);
  const healthOk = Boolean(d.health_apple);
  const bankOk = Boolean((d.ledger || []).length > 0);
  const accOk = Boolean((d.accounts || []).length > 0);
  const invOk = Boolean(d.invest_profile?.risk);
  const bkOk = st.bk == null ? null : Boolean(st.bk.dest);

  return [
    {
      id: "mail",
      num: 1,
      title: "Mail (IMAP read-only)",
      ok: mailOk,
      statusText: mailOk === null ? "unverified" : mailOk ? `Connected (${st.mail.user || "email"})` : "not connected",
      ts: st.mail?.fetched || null,
      desc: "Reads your inbox in read-only mode to detect invoices, subscriptions, appointments and important deadlines.",
      help: "Gmail app password: Google Account → Security → 2-Step Verification → App passwords.",
    },
    {
      id: "cal",
      num: 2,
      title: "Calendar (private iCal)",
      ok: calOk,
      statusText: calOk ? `Connected (${(d.calendar.events || []).length} events)` : "not connected",
      ts: d.calendar?.fetched || null,
      desc: "Shows your upcoming events in Agenda and Today without modifying or creating anything in your calendar.",
      help: "Google Calendar → Settings → your calendar → Integrate calendar → «Secret address in iCal format».",
    },
    {
      id: "reminders",
      num: 3,
      title: "Apple Reminders",
      ok: remOk,
      statusText: remOk ? `Connected (${(d.reminders.items || []).length} pending)` : "not connected",
      ts: d.reminders?.fetched || null,
      desc: "Reads your pending reminders directly from the Reminders app on this Mac.",
      help: "Notice: when clicking Test, macOS will request Automation permission to control «Reminders» (read-only).",
    },
    {
      id: "health",
      num: 4,
      title: "iPhone Health",
      ok: healthOk,
      statusText: healthOk ? `Connected (${Object.keys(d.health_apple.days || {}).length} days)` : "not connected",
      ts: d.health_apple?.imported || null,
      desc: "Imports steps, sleep, resting heart rate, weight and active energy from the export.zip file in Downloads.",
      help: "iPhone → Health → picture → Export All Health Data → AirDrop (place export.zip in Downloads).",
    },
    {
      id: "bank",
      num: 5,
      title: "Bank (CSV statement)",
      ok: bankOk,
      statusText: bankOk ? `${d.ledger.length} transaction(s)` : "no transactions",
      ts: d.ledger?.at?.(-1)?.date || null,
      desc: "Imports your bank CSV statement from Finances. Processed locally in the browser, detecting duplicates.",
      help: "Download the CSV from your online banking and use the «Import CSV statement» button in Finances.",
    },
    {
      id: "accounts",
      num: 6,
      title: "Accounts and balances",
      ok: accOk,
      statusText: accOk ? `${d.accounts.length} account(s)` : "no accounts",
      ts: d.accounts?.[0]?.updated || null,
      desc: "Register your checking, savings, or cash accounts with their current balance to calculate net worth and liquidity.",
      help: "Each transaction assigned to an account will update its balance automatically.",
    },
    {
      id: "invest",
      num: 7,
      title: "Risk profile and contribution",
      ok: invOk,
      statusText: invOk ? `Profile ${d.invest_profile.risk}${d.invest_profile.monthly_contribution != null ? " · " + M.money(d.invest_profile.monthly_contribution) + "/month" : ""}` : "not configured",
      ts: d.invest_profile?.quiz_date || null,
      desc: "Define your risk tolerance with the 5-question test and set your monthly contribution target.",
      help: "In Investment → Plan you can take the 1-minute quiz and adjust your horizon and contribution.",
    },
    {
      id: "backup",
      num: 8,
      title: "Off-Mac backup",
      ok: bkOk,
      statusText: bkOk === null ? "unverified" : bkOk ? `Destination: ${st.bk.dest}` : "on this Mac only",
      ts: st.bk?.last_ok?.ts || st.bk?.last?.ts || null,
      desc: "Keeps a daily encrypted backup (AES-256-GCM) on an external drive or iCloud Drive with restore verification.",
      help: "Choose destination in Account → Backups and click «Save destination».",
    },
    {
      id: "blockchair",
      num: 9,
      title: "Blockchair (on-chain data)",
      ok: st.bc == null ? null : Boolean(st.bc.saved),
      statusText: st.bc == null ? "unverified" : st.bc.saved ? `Key ${st.bc.hint} · today ${st.bc.usage?.points ?? 0}/${st.bc.usage?.limit ?? "?"} points` : "not connected",
      ts: st.bc?.date || null,
      desc: "Bitcoin and Ethereum blockchain data (fees, congestion, activity, large movements) for the investing agent, read-only.",
      help: "Paste your Blockchair API key. Stored encrypted on this Mac and never displayed in full again. Cage respects your plan quota.",
    },
  ];
}

function summaryCounts() {
  const steps = stepsState();
  const done = steps.filter(s => s.ok === true).length;
  const unknown = steps.filter(s => s.ok === null).length;
  return { steps, done, total: steps.length, unknown };
}

function badgeFor(s) {
  if (s.ok === true) return `<span class="badge g">✔ ${esc(s.statusText)}</span>`;
  if (s.ok === null) return `<span class="badge m">unverified</span>`;
  return `<span class="badge">${esc(s.statusText)}</span>`;
}

function resBox(id) {
  const r = results[id];
  if (!r) return "";
  return `<div class="conn-res ${r.ok ? "ok" : "err"}" role="status"><b>${r.ok ? "✔" : "✘"}</b> <span>${esc(r.msg)}</span></div>`;
}

function stepBody(s) {
  if (s.id === "mail") {
    return `<form class="conn-form" id="cnMailF" autocomplete="off">
      <div class="f2">
        <div class="f"><label>Your email</label><input class="in" name="user" type="email" placeholder="name@gmail.com" value="${esc(st.mail?.user || "")}" autocomplete="username"></div>
        <div class="f"><label>App password</label><input class="in" name="password" type="password" placeholder="16 characters without spaces" autocomplete="off"></div>
      </div>
      <div class="f"><label>IMAP server (optional; automatic for Gmail, Outlook, iCloud and Yahoo)</label><input class="in" name="host" placeholder="imap.gmail.com"></div>
      <div class="row wrap">
        <button class="btn sm acc" type="submit">Connect and test</button>
        <button class="btn sm ghost" type="button" data-cn-test="mail">Test status</button>
      </div>
    </form>`;
  }
  if (s.id === "cal") {
    return `<form class="conn-form" id="cnCalF" autocomplete="off">
      <div class="f"><label>Secret address in iCal format (.ics)</label><input class="in" name="url" placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" autocomplete="off"></div>
      <div class="row wrap">
        <button class="btn sm acc" type="submit">Connect and test</button>
        <button class="btn sm ghost" type="button" data-cn-test="cal">Test</button>
      </div>
    </form>`;
  }
  if (s.id === "reminders") {
    return `<div class="row wrap">
      <button class="btn sm acc" type="button" data-cn-test="reminders">Test Reminders</button>
      <button class="btn sm ghost" type="button" data-go="agenda">Open Agenda</button>
    </div>`;
  }
  if (s.id === "health") {
    return `<div class="row wrap">
      <button class="btn sm acc" type="button" data-cn-test="health">Test and import Health</button>
      <button class="btn sm ghost" type="button" data-go="salud">Open Health</button>
    </div>`;
  }
  if (s.id === "bank") {
    return `<div class="row wrap">
      <button class="btn sm acc" type="button" data-go="finanzas">Go to Finances (import CSV)</button>
      <button class="btn sm ghost" type="button" data-cn-test="bank">Test</button>
    </div>`;
  }
  if (s.id === "accounts") {
    return `<div class="row wrap">
      <button class="btn sm acc" type="button" data-cn-act="account">Add account</button>
      <button class="btn sm ghost" type="button" data-cn-test="accounts">Test</button>
    </div>`;
  }
  if (s.id === "blockchair") {
    const plan = st.bc?.plan && Object.keys(st.bc.plan).length ? `<p class="small muted">Plan: ${Object.entries(st.bc.plan).map(([k, v]) => esc(k) + " " + esc(v)).join(" · ")}</p>` : "";
    return `<form class="conn-form" id="cnBcF" autocomplete="off">
      <div class="f"><label>Blockchair API key</label><input class="in" name="key" type="password" placeholder="${st.bc?.saved ? "saved: " + esc(st.bc.hint) + " (enter another to change it)" : "paste your key here"}" autocomplete="off"></div>
      ${plan}
      <div class="row wrap">
        <button class="btn sm acc" type="submit">Save and test</button>
        <button class="btn sm ghost" type="button" data-cn-test="blockchair">Test</button>
        ${st.bc?.saved ? `<button class="btn sm ghost" type="button" data-cn-bc="forget">Forget key</button>` : ""}
      </div>
    </form>`;
  }
  if (s.id === "invest") {
    return `<div class="row wrap">
      <button class="btn sm acc" type="button" data-go="inversion">Go to Investment</button>
      <button class="btn sm ghost" type="button" data-cn-test="invest">Test</button>
    </div>`;
  }
  return `<div class="row wrap">
    <button class="btn sm acc" type="button" data-go="cuenta">Go to Account (Backups)</button>
    <button class="btn sm ghost" type="button" data-cn-test="backup">Test</button>
  </div>`;
}

TABS.push(["conectar", "Connect"]);

VIEWS.conectar = () => {
  ensureStatus();
  const { steps, done, total, unknown } = summaryCounts();
  const pct = Math.round(100 * done / total);
  const provChip = M.prov ? M.prov({ src: "local check", ts: Date.now(), kind: "calculo" }) : "";
  return head("Connect", "Step-by-step wizard to connect your sources and instantly verify everything responds. Your credentials are encrypted in your vault.") +
    `<div class="grid g-ov stagger">
      <div class="card span6 conn-summary">
        <h3><span>Progress: ${done} of ${total} connected</span>${provChip}</h3>
        <div class="meter"><i data-w="${pct}%" data-c="${done === total ? "var(--pos)" : "var(--acc)"}"></i></div>
        <p class="small muted">${done === total ? "Your dashboard is fully connected and up to date." : `${total - done} step(s) remaining${unknown ? ` (${unknown} unverified yet)` : ""}. Complete each card and click Test.`}</p>
      </div>
      ${steps.map(s => `<div class="card span3 conn-step ${s.ok === true ? "is-ok" : ""}" data-step="${esc(s.id)}" data-noprov="connection wizard">
        <h3><span><span class="conn-num">${s.ok === true ? "✓" : s.num}</span> ${esc(s.title)}</span>${badgeFor(s)}</h3>
        <p class="small">${esc(s.desc)}</p>
        <p class="small muted conn-help">${esc(s.help)}</p>
        ${stepBody(s)}
        ${resBox(s.id)}
      </div>`).join("")}
    </div>`;
};

async function runTest(id, formEl) {
  try {
    if (id === "mail") {
      const f = formEl || $("#cnMailF");
      const user = f ? f.user.value.trim() : "";
      const password = f ? f.password.value : "";
      const host = f ? f.host.value.trim() : "";
      if (f && f.password) f.password.value = "";
      if (user || password || !st.mail?.configured) {
        const body = { action: "save", user, password };
        if (host) body.host = host;
        await M.api("/api/mail", { body });
      }
      const stRes = await M.api("/api/mail", { body: { action: "status" } });
      st.mail = stRes;
      if (stRes.configured) {
        results.mail = { ok: true, msg: `Mail connected (${stRes.user} · ${(stRes.items || []).length} messages read)` };
      } else {
        results.mail = { ok: false, msg: stRes.error || "Mail not connected: enter your email and app password" };
      }
    } else if (id === "cal") {
      const f = formEl || $("#cnCalF");
      const url = f ? f.url.value.trim() : "";
      const r = await M.api("/api/life", { body: { action: "cal_save", url } });
      await reloadData();
      results.cal = { ok: true, msg: `Calendar connected: ${r.n} events read` };
    } else if (id === "reminders") {
      const r = await M.api("/api/life", { body: { action: "reminders" } });
      await reloadData();
      results.reminders = { ok: true, msg: `Reminders connected: ${r.n} pending` };
    } else if (id === "health") {
      const f = await M.api("/api/life", { body: { action: "health_find" } });
      if (!f.file) {
        const rErr = await M.api("/api/life", { body: { action: "health_import" } });
        results.health = { ok: Boolean(rErr.ok), msg: `Imported ${rErr.days || 0} days` };
      } else {
        const r = await M.api("/api/life", { body: { action: "health_import" } });
        await reloadData();
        results.health = { ok: true, msg: `Health imported from ${f.file}: ${r.days} days` };
      }
    } else if (id === "bank") {
      const n = (D()?.ledger || []).length;
      results.bank = n > 0
        ? { ok: true, msg: `${n} transaction(s) recorded in Finances` }
        : { ok: false, msg: "No transactions yet: go to Finances and click «Import CSV statement»" };
    } else if (id === "accounts") {
      const n = (D()?.accounts || []).length;
      results.accounts = n > 0
        ? { ok: true, msg: `${n} account(s) configured with balance` }
        : { ok: false, msg: "No accounts registered: click «Add account» to create the first one" };
    } else if (id === "invest") {
      const ip = D()?.invest_profile;
      results.invest = ip?.risk
        ? { ok: true, msg: `Profile ${ip.risk} configured${ip.monthly_contribution != null ? " · contribution " + M.money(ip.monthly_contribution) + "/month" : ""}` }
        : { ok: false, msg: "Risk profile quiz not yet completed in Investment" };
    } else if (id === "blockchair") {
      const f = formEl || $("#cnBcF");
      const key = f ? f.key.value.trim() : "";
      if (f) f.key.value = "";
      const r = await M.api("/api/trading/blockchair", { body: key ? { action: "save", key } : { action: "test" } });
      st.bc = r;
      results.blockchair = r.ok === false
        ? { ok: false, msg: "Key saved, but test failed: " + r.error }
        : { ok: true, msg: `Blockchair responding (block ${r.best_block || "—"}). Today: ${r.usage?.points ?? 0} of ${r.usage?.limit ?? "?"} points` + (r.plan?.valid_until ? ` · valid until ${r.plan.valid_until}` : "") };
    } else if (id === "backup") {
      st.bk = await M.api("/api/backups");
      results.backup = st.bk?.dest
        ? { ok: true, msg: `External backup configured at ${st.bk.dest} (${st.bk.daily || 0} daily backups)` }
        : { ok: false, msg: "No destination outside this Mac: choose an external drive or iCloud Drive in Account → Backups" };
    }
  } catch (er) {
    results[id] = { ok: false, msg: er.message || "Error checking connection" };
  }
  render(true);
}

BIND.conectar = v => {
  const mf = $("#cnMailF", v);
  if (mf) mf.onsubmit = e => { e.preventDefault(); runTest("mail", mf); };
  const bf = $("#cnBcF", v);
  if (bf) bf.onsubmit = e => { e.preventDefault(); runTest("blockchair", bf); };
  $$("[data-cn-bc=forget]", v).forEach(b => {
    b.onclick = async () => {
      if (!confirm("Forget the Blockchair key on this Mac?")) return;
      st.bc = await M.api("/api/trading/blockchair", { body: { action: "forget" } }).catch(() => st.bc);
      results.blockchair = { ok: false, msg: "Key forgotten" };
      render(true);
    };
  });
  const cf = $("#cnCalF", v);
  if (cf) cf.onsubmit = e => { e.preventDefault(); runTest("cal", cf); };
  $$("[data-cn-test]", v).forEach(b => {
    b.onclick = () => {
      b.disabled = true;
      runTest(b.dataset.cnTest).finally(() => { b.disabled = false; });
    };
  });
  $$("[data-cn-act]", v).forEach(b => {
    b.onclick = () => {
      if (b.dataset.cnAct === "account" && A.account) A.account();
    };
  });
};

const prevHoy = HOOKS.hoy;
HOOKS.hoy = () => {
  ensureStatus();
  const { steps, done, total } = summaryCounts();
  const base = prevHoy();
  if (done >= total) return base;
  const missing = steps.filter(s => s.ok !== true).map(s => s.title.split(" (")[0]);
  const provChip = M.prov ? M.prov({ src: "local check", ts: Date.now(), kind: "calculo" }) : "";
  return `<div class="card span6 conn-banner">
    <h3><span>Connect your dashboard: ${done} of ${total}</span>${provChip}</h3>
    <div class="meter"><i data-w="${Math.round(100 * done / total)}%" data-c="var(--acc)"></i></div>
    <div class="row between wrap">
      <p class="small muted">Pending: ${esc(missing.join(" · "))}</p>
      <button class="btn sm acc" type="button" data-go="conectar">Connect step by step (${done}/${total})</button>
    </div>
  </div>` + base;
};

M.connect = { stepsState, summaryCounts, runTest };
})();
