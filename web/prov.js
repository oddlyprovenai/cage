/* Cage · Provenance and freshness of each data point (model for all cards).

   Usage in a card:  `${M.prov({ src: "Binance", ts: r.ts, kind: "mercado" })}`  → chip with source, date/time and status.
   States: "up to date", "outdated", "no data" and "differs" (two sources disagreeing). Nothing is presented as
   certain without provenance: self-check (System status) counts cards with numbers but no chip.
   Maximum freshness per source type (hours): intraday market 3, daily close 96, news 6, mail 48,
   calendar 24, health 7×24, Cage calculation 24, your data ("you") no expiry (it's what you recorded).
   Refresh: on launch and periodically while Cage is visible (paused in background). */
(() => {
"use strict";
const M = window.Cage;
const { st, $$, esc, HOOKS, render } = M;
const MAX_H = { mercado: 3, diario: 96, noticias: 6, correo: 48, calendario: 24, salud: 168, calculo: 24, tu: Infinity, repo: 24, estudio: 24 * 45 };
const LABEL = { ok: "up to date", old: "outdated", none: "no data", diff: "differs" };

function toMs(ts) {
  if (ts == null || ts === "") return null;
  if (typeof ts === "number") return !isFinite(ts) || ts <= 0 ? null : ts > 1e12 ? ts : ts * 1000;
  if (typeof ts !== "string") return null;
  const t = Date.parse(ts.length === 10 ? ts + "T12:00:00" : ts);
  return isNaN(t) ? null : t;
}
function when(ms) {
  const d = new Date(ms), n = new Date(), same = d.toDateString() === n.toDateString();
  return same ? d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
// pure state (also used by tests)
function state({ ts, kind = "calculo", value, missing, compare } = {}) {
  if (missing || value === null || (value !== undefined && typeof value === "number" && !isFinite(value))) return "none";
  const ms = toMs(ts);
  if (ms === null && kind !== "tu") return "none";
  if (compare && compare.a != null && compare.b != null) {
    const a = +compare.a, b = +compare.b, tol = compare.tol ?? 0.01;
    if (Math.abs(a - b) / Math.max(1e-9, Math.abs(a)) > tol) return "diff";
  }
  if (ms !== null && (Date.now() - ms) / 36e5 > (MAX_H[kind] ?? 24)) return "old";
  return "ok";
}
const ALIAS = { calc: "calculo", paper: "diario", real: "calculo" };
function norm(o) {
  let kind = ALIAS[o.kind] || o.kind || "calculo";
  if (/^(vault|bóveda|tu |tus |tú|your |you)/i.test(o.src || "")) kind = "tu";  // what you record does not expire: it is your data
  return { ...o, kind };
}
function prov(o = {}) {
  o = norm(o);
  const s = state(o), ms = toMs(o.ts);
  const parts = [`Source: ${o.src || "—"}`];
  if (ms) parts.push(when(ms));
  parts.push(LABEL[s]);
  if (s === "diff") parts.push(`${o.compare.srcA || "A"} ${o.compare.a} vs ${o.compare.srcB || "B"} ${o.compare.b}`);
  if (o.note) parts.push(o.note);
  const t = parts.join(" · ");
  return `<span class="prov" data-state="${s}" title="${esc(t)}" aria-label="${esc(t)}"><i></i>${esc(o.short ?? (ms ? when(ms) : LABEL[s]))}</span>`;
}

// self-check: cards with figures and no provenance (data-noprov="reason" for cards without external data)
function missing(root) {
  const out = [];
  root.querySelectorAll(".card").forEach(c => {
    if (c.closest("[data-noprov]") || c.querySelector(".prov")) return;
    const txt = c.innerText || c.textContent || "";
    if (/\d[\d.,]*\s?(€|%|\$|kg|h|kcal|lpm)|\b\d{2,}[.,]\d+\b/.test(txt)) out.push((c.querySelector("h3")?.textContent || txt.slice(0, 40)).trim());
  });
  return out;
}

// periodic refresh while Cage is visible
const EVERY = [
  { min: 5, run: () => M.api("/api/trading").then(r => { st.trading = r; }) },
  { min: 10, run: () => M.system?.check?.() },
  { min: 30, run: () => st.mail?.configured ? M.api("/api/mail", { body: { action: "refresh" } }).then(() => M.api("/api/mail", { body: { action: "status" } })).then(r => { st.mail = r; }) : null },
  { min: 60, run: () => st.data?.calendar ? M.api("/api/life", { body: { action: "cal_refresh" } }) : null },
];
const last = {};
function tick() {
  if (document.hidden || !st.data) return;
  const now = Date.now();
  let changed = false;
  for (const [i, j] of EVERY.entries()) {
    if (now - (last[i] || 0) >= j.min * 6e4) {
      last[i] = now;
      const p = j.run();
      if (p && p.then) { changed = true; p.catch(() => {}); }
    }
  }
  if (changed) setTimeout(() => { const a = document.activeElement;
    if (!document.hidden && !document.querySelector(".modal, dialog[open]") && !(a && /INPUT|TEXTAREA|SELECT/.test(a.tagName))) render(true); }, 4000);
}
const after = HOOKS.afterLoad;
// st.data.updated: last time your data was saved (actual vault mtime returned by server as version)
function stamp() { if (st.data && st.updated) Object.defineProperty(st.data, "updated", { value: st.updated, configurable: true, enumerable: false, writable: true }); }
HOOKS.afterLoad = () => { stamp(); after(); Object.keys(EVERY).forEach(i => { last[i] = Date.now(); }); setInterval(tick, 60e3); };
const ar = HOOKS.afterRender;
HOOKS.afterRender = v => { stamp(); ar(v); };
document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });

M.prov = prov;
M.prov.state = o => state(norm(o));
M.prov.missing = missing;
M.prov.MAX_H = MAX_H;
})();
