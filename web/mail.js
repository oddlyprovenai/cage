/* Cage · READ-ONLY email: summarized inbox (important, invoices, subscriptions, appointments and deadlines), proposals
   for Finances/Subscriptions confirmed by you, and reply drafts from the local model sent only by you. */
(() => {
"use strict";
const M = window.Cage;
const { st, $, $$, esc, TABS, VIEWS, BIND, HOOKS, toast, render, empty, uid, today, save } = M;
const D = () => st.data;
const eur = v => v == null ? "" : new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(v);
const when = ts => { const d = new Date(ts * 1000), n = new Date(); return d.toDateString() === n.toDateString() ? d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString("en-US", { day: "numeric", month: "short" }); };
const FILT = [["imp", "Important"], ["factura", "Invoices"], ["suscripción", "Subscriptions"], ["cita/plazo", "Appointments & deadlines"], ["todo", "All"]];
async function call(body) { return M.api("/api/mail", { body }); }
async function load(force) {
  if (st.mail && !force) return;
  try { st.mail = await call({ action: "status" }); } catch (e) { st.mail = { error: e.message }; }
  if (st.tab === "correo" || st.tab === "hoy") render(true);
}

TABS.splice(Math.max(1, TABS.findIndex(t => t[0] === "hoy") + 1), 0, ["correo", "Email"]);

VIEWS.correo = () => {
  const m = st.mail;
  if (!m) { load(); return empty("Loading…", ""); }
  if (!m.configured) return `<div class="grid g-ov stagger"><div class="card span3" data-noprov="formulario"><h3>Connect your email (read-only)</h3>
      <p>Cage will read your inbox <b>without sending, deleting, moving, or marking anything as read</b>. Emails never leave this Mac: they are classified here and drafts are written by the local model.</p>
      <form id="mlF"><div class="f"><label>Your email</label><input class="in" name="user" type="email" autocomplete="username" required></div>
      <div class="f"><label>App password (not your normal password)</label><input class="in" name="password" type="password" autocomplete="off" required></div>
      <div class="f"><label>IMAP server (only if not Gmail, Outlook, iCloud, or Yahoo)</label><input class="in" name="host" placeholder="imap.yourdomain.com"></div>
      <button class="btn acc" type="submit">Connect</button></form></div>
    <div class="card span3 honest" data-noprov="ayuda"><h3>How to generate an app password (Gmail)</h3><ol class="notes"><li>Open your Google Account → Security.</li><li>Turn on 2-Step Verification if not already enabled.</li><li>Search for "App passwords", create one named "Cage", and copy the 16 characters here.</li></ol>
      <p class="small muted">Saved encrypted in your vault and never sent back to the browser. You can revoke it in Google at any time, and disconnecting here deletes Cage's copy. Apple Mail is not configured on this Mac, which is why this method is used.</p></div></div>`;
  const f = st.mlF || "imp", items = (m.items || []).filter(x => f === "todo" ? true : f === "imp" ? x.important : x.tags.includes(f));
  const props = m.proposals || [];
  const pMail = M.prov({ src: "IMAP (" + (m.user || "email") + ")", ts: m.fetched ? m.fetched * 1000 : D().updated, kind: "real" }), pProp = M.prov({ src: "Email rules", ts: m.fetched ? m.fetched * 1000 : D().updated, kind: "calc" });
  const TAG_LABELS = { factura: "invoice", suscripción: "subscription", "cita/plazo": "appointment/deadline" };
  return `<div class="grid g-ov stagger">
    <div class="card span6"><div class="row wrap"><h3 class="m0">Inbox of ${esc(m.user)} ${pMail}</h3><span class="small muted">updated ${m.fetched ? when(m.fetched) : "—"} · ${(m.items || []).length} latest · read-only</span><span class="spacer"></span><button class="btn sm" data-ml="refresh">Refresh</button><button class="btn sm ghost" data-ml="forget">Disconnect</button></div>
      <div class="seg" id="mlSeg">${FILT.map(([k, l]) => `<button data-mf="${k}" class="${k === f ? "on" : ""}">${l} <span class="muted">${(m.items || []).filter(x => k === "todo" ? true : k === "imp" ? x.important : x.tags.includes(k)).length}</span></button>`).join("")}</div></div>
    <div class="card span4"><h3>Messages ${pMail}</h3><div class="list">${items.length ? items.map(x => `<div class="li mail ${x.unread ? "unread" : ""}"><div class="t"><b>${esc(x.subject || "(no subject)")}</b><small>${esc(x.from)} · ${when(x.ts)}${x.amount ? " · " + eur(x.amount) : ""}${x.dates?.length ? " · dates: " + x.dates.map(esc).join(", ") : ""}</small><small class="muted">${esc(x.snippet.slice(0, 180))}</small>
        <span class="row wrap">${x.tags.map(t => `<span class="badge m">${esc(TAG_LABELS[t] || t)}</span>`).join("")}${x.urgent ? '<span class="badge">urgent</span>' : ""}${x.personal ? `<button class="btn sm ghost" data-draft="${esc(x.id)}">Draft reply</button>` : ""}</span><div class="draft" data-for="${esc(x.id)}"></div></div></div>`).join("") : empty("Nothing here", "")}</div></div>
    <div class="card span2"><h3>Proposals to confirm ${pProp}</h3>${props.length ? `<div class="list">${props.map((p, i) => `<div class="li"><div class="t"><b>${p.kind === "gasto" ? "Expense" : "Subscription"}: ${esc(p.name)}</b><small>${p.amount ? eur(p.amount) : "amount undetected"} · ${esc(p.subject.slice(0, 60))}</small></div><button class="btn sm" data-prop="${i}">Add</button></div>`).join("")}</div>` : `<p class="small muted">No new invoices or subscriptions detected.</p>`}
      <p class="small muted">Detected by rules in the text; verify amount before adding.</p></div>
  </div>`;
};

BIND.correo = v => {
  const f = $("#mlF", v);
  if (f) f.onsubmit = async e => { e.preventDefault(); const b = $("button", f); b.disabled = true; b.textContent = "Connecting…";
    try { const r = await call({ action: "save", user: f.user.value, password: f.password.value, host: f.host.value }); f.password.value = ""; toast(`Connected: ${r.n} emails read`); await load(true); }
    catch (er) { toast(er.message); b.disabled = false; b.textContent = "Connect"; } };
  $$("[data-mf]", v).forEach(b => b.onclick = () => { st.mlF = b.dataset.mf; render(true); });
  $$("[data-ml]", v).forEach(b => b.onclick = async () => {
    try {
      if (b.dataset.ml === "refresh") { b.disabled = true; await call({ action: "refresh" }); await load(true); toast("Email refreshed"); }
      else if (confirm("Disconnect email? The app password and stored emails in Cage will be deleted.")) { await call({ action: "forget" }); await load(true); }
    } catch (er) { toast(er.message); b.disabled = false; }
  });
  $$("[data-draft]", v).forEach(b => b.onclick = async () => {
    const box = $(`.draft[data-for="${CSS.escape(b.dataset.draft)}"]`, v), extra = prompt("What do you want to say? (optional)") || "";
    box.innerHTML = `<div class="bub typing"><i></i><i></i><i></i></div>`;
    try { const r = await call({ action: "draft", id: b.dataset.draft, extra }); box.innerHTML = `<textarea class="in" rows="6">${esc(r.draft)}</textarea><p class="small muted">Draft from local model. Copy and send it yourself from your email client.</p>`; }
    catch (er) { box.innerHTML = `<p class="small neg">${esc(er.message)}</p>`; }
  });
  $$("[data-prop]", v).forEach(b => b.onclick = () => {
    const p = st.mail.proposals[+b.dataset.prop];
    const amount = +prompt(`Amount for "${p.name}" (€)`, p.amount ?? "");
    if (!(amount > 0)) return;
    if (p.kind === "gasto") M.life.addMove({ type: "expense", amount, category: "Facturas", note: `${p.name} (email)`, date: p.date || today(), account: "" });
    else { const n = new Date(); n.setMonth(n.getMonth() + 1); D().subscriptions.push({ id: uid(), created: today(), name: p.name, amount, cycle: "monthly", next: n.toISOString().slice(0, 10), category: "Suscripciones", usage: "lo uso", account: D().accounts[0]?.id || "", active: true }); }
    save(); st.mail.proposals.splice(+b.dataset.prop, 1); toast(p.kind === "gasto" ? "Expense added in Finances" : "Subscription added: review cycle and date"); render(true);
  });
};

const hoy = HOOKS.hoy;
HOOKS.hoy = () => {
  const m = st.mail;
  if (!m) { load(); return hoy(); }
  if (!m.configured) return hoy();
  const imp = (m.items || []).filter(x => x.important && x.unread).slice(0, 4);
  return hoy() + `<div class="card span3"><h3>Important email ${M.prov({ src: "IMAP (" + (m.user || "email") + ")", ts: m.fetched ? m.fetched * 1000 : D().updated, kind: "real" })} <button class="btn sm ghost" data-go="correo">Open</button></h3>${imp.length ? `<div class="list">${imp.map(x => `<div class="li"><div class="t"><b>${esc(x.subject)}</b><small>${esc(x.from)} · ${when(x.ts)}</small></div></div>`).join("")}</div>` : `<p class="small muted">Nothing important unread.</p>`}</div>`;
};
})();
