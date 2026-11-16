/* Cage · Schedule (.ics calendar + Apple Reminders), iPhone Health, and bank statement CSV import.
   All read-only and local: Cage does not create or delete anything in your calendar, reminders, or bank. */
(() => {
"use strict";
const M = window.Cage;
const { st, $, $$, esc, TABS, VIEWS, BIND, HOOKS, toast, render, empty, uid, today, save, bars, line } = M;
const D = () => st.data;
async function call(body) { return M.api("/api/life", { body }); }
async function reload() { try { const r = await M.api("/api/data"); st.data = r.data; st.version = r.version; } catch (e) { /* keep what's there */ } render(true); }
const hhmm = s => s.slice(11, 16);
const dayLbl = s => { const d = new Date(s.slice(0, 10) + "T12:00"), t = new Date(); const diff = Math.round((d - new Date(t.toDateString() + " 12:00")) / 864e5);
  return diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" }); };

TABS.splice(Math.max(1, TABS.findIndex(t => t[0] === "correo") + 1), 0, ["agenda", "Calendar"]);

function upcoming(n = 60) {
  const now = new Date().toISOString().slice(0, 16), ev = (D().calendar?.events || []).filter(e => (e.allday ? e.start.slice(0, 10) >= now.slice(0, 10) : e.end >= now));
  return ev.slice(0, n);
}

VIEWS.agenda = () => {
  const cal = D().calendar, rem = D().reminders, ev = upcoming();
  const groups = {};
  ev.forEach(e => (groups[e.start.slice(0, 10)] ||= []).push(e));
  const due = (rem?.items || []).filter(r => r.due).sort((a, b) => a.due.localeCompare(b.due));
  const nodue = (rem?.items || []).filter(r => !r.due);
  return `<div class="grid g-ov stagger">
    <div class="card span4"><div class="row wrap"><h3 class="m0">Next 45 days ${M.prov({ src: "iCal Calendar", ts: cal?.fetched ? cal.fetched * 1000 : D().updated, kind: "real" })}</h3><span class="spacer"></span>${cal ? `<span class="small muted">updated ${new Date(cal.fetched * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span><button class="btn sm" data-lf="cal_refresh">Refresh</button><button class="btn sm ghost" data-lf="cal_forget">Disconnect</button>` : ""}</div>
      ${cal ? (ev.length ? Object.entries(groups).map(([d, xs]) => `<h4 class="dayh">${esc(dayLbl(d))}</h4><div class="list">${xs.map(e => `<div class="li"><div class="t"><b>${esc(e.title)}</b><small>${e.allday ? "all day" : hhmm(e.start) + "–" + hhmm(e.end)}${e.where ? " · " + esc(e.where) : ""}</small></div></div>`).join("")}</div>`).join("") : empty("Nothing on the calendar", "")) :
        `<p>Connect your calendar by pasting its <b>private iCal URL</b> (read-only: Cage does not create or modify events).</p>
        <form id="calF" class="row wrap"><input class="in flex1-260" name="url" placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" autocomplete="off"><button class="btn acc" type="submit">Connect</button></form>
        <p class="small muted">Google Calendar (on desktop): Settings → your calendar → “Integrate calendar” → “Secret address in iCal format”. iCloud: share calendar as public and copy the webcal link. Saved encrypted; anyone with this URL can read your calendar, so do not share it.</p>`}</div>
    <div class="card span2"><div class="row wrap"><h3 class="m0">Reminders ${M.prov({ src: "Apple Reminders", ts: rem?.fetched ? rem.fetched * 1000 : D().updated, kind: "real" })}</h3><span class="spacer"></span><button class="btn sm" data-lf="reminders">${rem ? "Refresh" : "Read from Reminders"}</button></div>
      ${rem ? `${due.length ? `<div class="list">${due.slice(0, 25).map(r => `<div class="li"><div class="t"><b>${esc(r.title)}</b><small>${esc(r.due.replace("T", " "))}${r.list ? " · " + esc(r.list) : ""}</small></div></div>`).join("")}</div>` : ""}${nodue.length ? `<p class="small muted">No date: ${nodue.slice(0, 15).map(r => esc(r.title)).join(" · ")}${nodue.length > 15 ? "…" : ""}</p>` : ""}${!due.length && !nodue.length ? empty("No pending reminders", "") : ""}`
        : `<p class="small muted">The first time macOS will ask if Cage can control “Reminders”: allow it. It only reads pending items; it does not check off or delete anything.</p>`}</div>
  </div>`;
};
BIND.agenda = v => {
  const f = $("#calF", v);
  if (f) f.onsubmit = async e => { e.preventDefault(); try { const r = await call({ action: "cal_save", url: f.url.value.trim() }); toast(`Calendar connected: ${r.n} events`); await reload(); } catch (er) { toast(er.message); } };
  $$("[data-lf]", v).forEach(b => b.onclick = async () => {
    const a = b.dataset.lf;
    if (a === "cal_forget" && !confirm("Disconnect calendar?")) return;
    b.disabled = true;
    try { const r = await call({ action: a }); toast(a === "reminders" ? `${r.n} reminders` : a === "cal_forget" ? "Disconnected" : `${r.n} events`); await reload(); } catch (er) { toast(er.message); b.disabled = false; }
  });
};

// ---------------------------------------------------------------- Hoy: agenda del día
const hoy = HOOKS.hoy;
HOOKS.hoy = () => {
  const t = today(), ev = upcoming().filter(e => e.start.slice(0, 10) <= t), rem = (D().reminders?.items || []).filter(r => r.due && r.due.slice(0, 10) <= t);
  if (!D().calendar && !D().reminders) return hoy();
  return hoy() + `<div class="card span3"><h3>Today's schedule ${M.prov({ src: "iCal + Recordatorios", ts: (D().calendar?.fetched || D().reminders?.fetched || 0) * 1000 || D().updated, kind: "real" })} <button class="btn sm ghost" data-go="agenda">Open</button></h3>${ev.length || rem.length ? `<div class="list">${ev.map(e => `<div class="li"><div class="t"><b>${esc(e.title)}</b><small>${e.allday ? "all day" : hhmm(e.start) + "–" + hhmm(e.end)}</small></div></div>`).join("")}${rem.map(r => `<div class="li"><div class="t"><b>${esc(r.title)}</b><small>reminder${r.due.slice(0, 10) < t ? " · overdue" : ""}</small></div></div>`).join("")}</div>` : `<p class="small muted">Nothing else today.</p>`}</div>`;
};

// ---------------------------------------------------------------- Salud: app Salud del iPhone
const vs = VIEWS.salud;
VIEWS.salud = () => {
  const ha = D().health_apple, base = vs();
  const days = ha ? Object.entries(ha.days).slice(-30) : [];
  const avg = k => { const xs = days.map(([, v]) => v[k]).filter(x => x != null); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; };
  const card = `<div class="card span6"><div class="row wrap"><h3 class="m0">iPhone Health App ${M.prov({ src: ha ? "Apple Health (" + ha.file + ")" : "Apple Health (export.zip)", ts: ha?.imported || D().updated, kind: "real" })}</h3><span class="spacer"></span><button class="btn sm" data-hl="import">${ha ? "Re-import" : "Import export.zip"}</button></div>
    ${ha ? `<div class="row wrap kpis"><div><div class="lbl">Steps (30-day avg)</div><b class="num">${avg("steps") ? Math.round(avg("steps")).toLocaleString("es-ES") : "—"}</b></div><div><div class="lbl">Sleep</div><b class="num">${avg("sleep_h") ? avg("sleep_h").toFixed(1).replace(".", ",") + " h" : "—"}</b></div><div><div class="lbl">Resting heart rate</div><b class="num">${avg("rhr") ? Math.round(avg("rhr")) + " bpm" : "—"}</b></div><div><div class="lbl">Active energy</div><b class="num">${avg("kcal") ? Math.round(avg("kcal")) + " kcal" : "—"}</b></div></div>
      ${days.length >= 2 ? bars(days.map(([d]) => d.slice(8)), [{ name: "Steps", color: "var(--acc)", values: days.map(([, v]) => v.steps || 0) }], { h: 150 }) : ""}
      ${days.filter(([, v]) => v.sleep_h).length >= 2 ? line(days.map(([d]) => d.slice(8)), [{ name: "Sleep (h)", color: "var(--blue)", values: days.map(([, v]) => v.sleep_h || 0) }], { h: 130, smooth: false }) : ""}
      <p class="small muted">Imported from ${esc(ha.file)} on ${esc(ha.imported.replace("T", " "))}. Daily summaries only, stored encrypted; not shared with Claude.</p>`
      : `<p>On your iPhone: Health app → your profile photo (top right) → “Export All Health Data”. Transfer <b>export.zip</b> to your Mac (AirDrop places it in Downloads) and click Import. Cage reads steps, sleep, resting heart rate, weight, and active energy.</p>`}</div>`;
  const i = base.lastIndexOf("</div>");
  return i > 0 ? base.slice(0, i) + card + base.slice(i) : base + card;
};
const bs = BIND.salud;
BIND.salud = v => {
  bs && bs(v);
  const b = $("[data-hl=import]", v);
  if (b) b.onclick = async () => {
    try {
      const f = await call({ action: "health_find" });
      if (!f.file) { toast("Could not find export.zip in Downloads"); return; }
      if (!confirm(`Import ${f.file} (${f.size_mb} MB)? This may take a minute.`)) return;
      b.disabled = true; b.textContent = "Importing…";
      const r = await call({ action: "health_import" });
      // most recent weight transfers to your weight log (if not already logged for that day)
      await reload();
      const ha = D().health_apple, W = D().health.weights;
      Object.entries(ha?.days || {}).filter(([, x]) => x.kg).slice(-90).forEach(([d, x]) => { if (!W.some(w => w.date === d)) W.push({ date: d, kg: x.kg }); });
      W.sort((a, c) => a.date.localeCompare(c.date)); save();
      toast(`Imported ${r.days} days`); render(true);
    } catch (er) { toast(er.message); b.disabled = false; b.textContent = "Import export.zip"; }
  };
};

// ---------------------------------------------------------------- Finanzas: importar extracto bancario CSV (en el navegador)
function parseCSV(text) {
  const first = text.split(/\r?\n/).find(l => l.trim()) || "";
  const sep = [";", ",", "\t"].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = [];
  let cur = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true; else if (c === sep) { cur.push(f); f = ""; } else if (c === "\n") { cur.push(f); rows.push(cur); cur = []; f = ""; } else if (c !== "\r") f += c;
  }
  if (f || cur.length) { cur.push(f); rows.push(cur); }
  return rows.filter(r => r.some(x => x.trim()));
}
const num = s => { s = String(s).replace(/[€\s]/g, ""); if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", "."); else s = s.replace(/,/g, ""); const v = parseFloat(s); return isFinite(v) ? v : null; };
const dateOf = s => { s = String(s).trim(); let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/); if (m) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[0] : null; };
function mapRows(rows) {
  const hi = rows.findIndex(r => r.some(x => /fecha|date/i.test(x)) && r.some(x => /importe|amount|cantidad|cargo|abono/i.test(x)));
  if (hi < 0) throw new Error("Could not find Date and Amount columns in the CSV");
  const h = rows[hi].map(x => x.trim().toLowerCase());
  const cd = h.findIndex(x => /fecha( valor| operaci[oó]n)?|date/.test(x)), cc = h.findIndex(x => /concepto|descripci|description|detalle|movimiento/.test(x));
  const ca = h.findIndex(x => /^importe|amount|cantidad/.test(x)), cch = h.findIndex(x => /cargo|debe|d[eé]bito/.test(x)), cab = h.findIndex(x => /abono|haber|cr[eé]dito/.test(x));
  return rows.slice(hi + 1).map(r => {
    let amt = ca >= 0 ? num(r[ca]) : null;
    if (amt === null && (cch >= 0 || cab >= 0)) amt = (num(r[cab]) || 0) - Math.abs(num(r[cch]) || 0);
    const d = dateOf(r[cd] || "");
    return d && amt !== null && amt !== 0 ? { date: d, amount: amt, note: (r[cc] || "").trim().slice(0, 120) } : null;
  }).filter(Boolean);
}
const vf = VIEWS.finanzas;
VIEWS.finanzas = () => vf().replace(/(<div class="grid[^>]*>)/, `$1<div class="card span6 row wrap" data-noprov="action"><b>Do you have your bank statement?</b><span class="small muted">Download it as CSV from your online banking and import it: parsed in your browser, never uploaded anywhere. Detects duplicates.</span><span class="spacer"></span><label class="btn sm">Import CSV statement<input type="file" accept=".csv,text/csv" id="bankCSV" hidden></label></div>`);
const bf = BIND.finanzas;
BIND.finanzas = v => {
  bf && bf(v);
  const inp = $("#bankCSV", v);
  if (!inp) return;
  inp.onchange = async () => {
    const file = inp.files[0];
    if (!file) return;
    try {
      let text = await file.text();
      if (text.includes("�")) text = new TextDecoder("windows-1252").decode(await file.arrayBuffer());
      const rows = mapRows(parseCSV(text));
      const seen = new Set(D().ledger.map(e => `${e.date}|${Math.abs(e.amount).toFixed(2)}|${(e.note || "").slice(0, 40)}`));
      const fresh = rows.filter(r => !seen.has(`${r.date}|${Math.abs(r.amount).toFixed(2)}|${r.note.slice(0, 40)}`));
      if (!fresh.length) { toast(`${rows.length} transactions read; all were already imported`); return; }
      const g = fresh.filter(r => r.amount < 0).reduce((a, r) => a - r.amount, 0), i = fresh.filter(r => r.amount > 0).reduce((a, r) => a + r.amount, 0);
      if (!confirm(`Import ${fresh.length} new transactions (${rows.length - fresh.length} duplicates skipped)?\nExpenses ${g.toFixed(2)} € · Income ${i.toFixed(2)} €\nFrom ${fresh.map(r => r.date).sort()[0]} to ${fresh.map(r => r.date).sort().at(-1)}`)) return;
      // unassigned account: statement is history and should not alter the current balance you have recorded
      fresh.forEach(r => M.life.addMove({ type: r.amount < 0 ? "expense" : "income", amount: Math.abs(r.amount), category: "Uncategorized", note: r.note, date: r.date, account: "" }));
      save(); toast(`${fresh.length} transactions imported: categorize them in Finances`); render(true);
    } catch (er) { toast(er.message); }
    inp.value = "";
  };
};
M.bank = { parseCSV, mapRows };
})();
