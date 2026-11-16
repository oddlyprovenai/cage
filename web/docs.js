/* Cage · Documents and deadlines: ID, passport, driving license, insurance, vehicle inspection, contracts and warranties,
   with warning before expiration (in Today, 30 days prior). Only dates and notes: document copies are not stored. */
(() => {
"use strict";
const M = window.Cage;
const { st, $$, esc, VIEWS, BIND, render, empty, uid, today, save, modal } = M;
const D = () => st.data;
const KINDS = [["identidad", "Identity (ID, passport, license)"], ["seguro", "Insurance"], ["vehiculo", "Vehicle (inspection, tax)"], ["contrato", "Contract"], ["garantia", "Warranty"], ["otro", "Other"]];
const days = x => Math.round((new Date(x + "T12:00") - new Date(today() + "T12:00")) / 864e5);

function edit(doc) {
  modal(doc ? "Edit document" : "New document or deadline", [
    { name: "name", label: "Name", value: doc?.name || "", req: true },
    { name: "kind", label: "Type", type: "select", options: KINDS, value: doc?.kind || "identidad" },
    { name: "expires", label: "Expires / due", type: "date", value: doc?.expires || "", req: true },
    { name: "notes", label: "Notes (location, policy number…)", value: doc?.notes || "" },
    ...(doc ? [{ name: "del", label: "Type DELETE to remove it", value: "" }] : [])], o => {
    D().documents ||= [];
    if (doc && (o.del === "DELETE" || o.del === "BORRAR")) { D().documents = D().documents.filter(x => x !== doc); save(); render(); return; }
    const v = { name: o.name.trim().slice(0, 80), kind: o.kind, expires: o.expires, notes: o.notes.trim().slice(0, 200) };
    if (doc) Object.assign(doc, v); else D().documents.push({ id: uid(), created: today(), ...v });
    save(); render();
  });
}

const va = VIEWS.agenda;
VIEWS.agenda = () => {
  const docs = (D().documents || []).slice().sort((a, b) => a.expires.localeCompare(b.expires));
  const rows = docs.map(x => {
    const n = days(x.expires);
    return `<tr><td><b>${esc(x.name)}</b>${x.notes ? `<br><small class="muted">${esc(x.notes)}</small>` : ""}</td><td>${esc((KINDS.find(k => k[0] === x.kind) || [0, x.kind])[1])}</td><td>${esc(x.expires)}</td><td class="r num ${n < 0 ? "neg" : n <= 30 ? "warn" : ""}">${n < 0 ? "expired" : n + " days"}</td><td><button class="btn sm ghost" data-doc="${esc(x.id)}">Edit</button></td></tr>`;
  }).join("");
  const card = `<div class="card span6"><div class="row wrap"><h3 class="m0">Documents and deadlines ${M.prov({ src: "Vault (documents)", ts: docs[0]?.created || D().updated, kind: "real" })}</h3><span class="spacer"></span><button class="btn sm" data-doc="new">Add</button></div>
    ${docs.length ? `<table class="tbl"><thead><tr><th>Document</th><th>Type</th><th>Due</th><th class="r">Remaining</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : empty("No documents", "Keep track of when your ID, license, insurance, inspection or warranties expire and Cage will alert you 30 days ahead in Today.")}
    <p class="small muted">Only dates and notes; document copies are not stored.</p></div>`;
  const base = va(), i = base.lastIndexOf("</div>");
  return i > 0 ? base.slice(0, i) + card + base.slice(i) : base + card;
};
const ba = BIND.agenda;
BIND.agenda = v => { if (ba) ba(v); $$("[data-doc]", v).forEach(b => { b.onclick = () => edit(b.dataset.doc === "new" ? null : (D().documents || []).find(x => x.id === b.dataset.doc)); }); };
})();
