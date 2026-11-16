/* Cage · SPIKE Benchmark. Single source: docs/results/specialists.json on main (read-only).
   Base vs specialist per task, with 95% confidence intervals, unparsed answers and extractor notes when it underperforms
   the base. Other models only with published comparable benchmarks (same dataset, split, subset and metric). */
(() => {
"use strict";
const M = window.Cage;
const { st, $$, esc, TABS, VIEWS, BIND, render, empty } = M;
const pc = v => v == null ? "no data" : (100 * v).toFixed(1).replace(".", ",") + " %";
const ci = c => c ? `${pc(c[0])}–${pc(c[1])}` : "";
const ST = { adapter_accepted: "specialist accepted", base_profile: "profile on base model (no specialist trained)" };
TABS.splice(Math.max(1, TABS.findIndex(t => t[0] === "memoria") + 1), 0, ["benchmark", "Benchmark"]);

async function load() {
  try { st.bench = await M.api("/api/bench"); } catch (e) { st.bench = { error: e.message }; }
  if (st.tab === "benchmark") render(true);
}

function row(label, x, cls) {
  if (!x) return "";
  return `<div class="brow"><span class="bname">${esc(label)}<small class="muted"> · ${x.correct}/${x.n} · 95% CI ${ci(x.ci95)} · unparsed ${x.unparsed}${x.truncated ? ` · truncated ${x.truncated}` : ""}</small></span>
    <span class="bbar ${cls}"><i data-w="${Math.round(100 * (x.accuracy || 0))}"></i></span><b class="num">${pc(x.accuracy)}</b></div>`;
}

function task(tid, t) {
  const b = t.bench || {};
  return `<div class="bexam"><div class="small"><b>${esc(tid)}</b> <span class="muted">· ${esc(b.dataset || "")}${b.config ? " / " + esc(b.config) : ""}${b.split ? " · " + esc(b.split) : ""}${(b.categories || []).length ? " · " + b.categories.map(esc).join(", ") : ""}</span></div>
    ${row("Qwen3.5-4B (base)", t.base, "base")}${row("SPIKE specialist", t.adapter, "spike")}
    <p class="small">Measured difference: <b>${t.delta_points > 0 ? "+" : ""}${String(t.delta_points).replace(".", ",")} points</b> (p = ${t.p_value})</p>
    ${t.warn ? `<p class="small warnbox">⚠ ${esc(t.warn)}</p>` : ""}
    ${t.peers.length ? t.peers.map(p => `<div class="brow"><span class="bname">${esc(p.model)} <a href="${esc(p.source_url)}" target="_blank" rel="noopener noreferrer" title="${esc(p.quote)}">source</a><small class="muted"> · ${esc(p.protocol)} · published ${esc(p.published)}</small></span><span class="bbar publicado"><i data-w="${Math.round(100 * p.score)}"></i></span><b class="num">${pc(p.score)}</b></div>`).join("")
      : `<div class="brow"><span class="bname">Leading models</span><span class="small muted">no comparable data</span><span></span></div>`}
    ${t.peers_rejected.length ? `<p class="small muted">Discarded as not comparable: ${t.peers_rejected.map(esc).join(" · ")}</p>` : ""}</div>`;
}

VIEWS.benchmark = () => {
  const b = st.bench;
  if (!b) { load(); return empty("Reading measured results…", ""); }
  if (b.error && !(b.specialists || []).length) return empty("Unavailable", esc(b.error));
  const prov = M.prov ? M.prov({ src: `${b.source} · ${b.commit || ""}`, ts: b.fetched, kind: "repo" }) : "";
  const S = b.specialists || [], c = b.coach || {};
  const trained = S.filter(s => s.rounds.length), rest = S.filter(s => !s.rounds.length);
  return `<div class="grid g-ov stagger">
    <div class="card span6 honest"><h3>Measured specialist results ${prov}</h3>
      <p>Base and specialist answer the same questions. ${esc(b.protocol_note)}</p>
      <p class="small">${esc(b.no_promise)}</p>
      <p class="small muted">Other models: only published benchmarks on the exact same dataset, split, subset, and metric, with link, date, and protocol. ${b.published_ok ? `${b.published_ok} published scores reviewed.` : "None comparable yet."}${(b.published_rejected || []).length ? ` ${b.published_rejected.length} discarded due to incomplete data.` : ""}</p></div>
    ${trained.map(s => `<div class="card span6"><h3>${esc(s.name)} <span class="badge m">${esc(ST[s.status] || s.status)}</span> ${M.prov({ src: "specialists.json (main)", ts: b.fetched, kind: "repo" })}</h3>
      ${s.rounds.map(r => `<details class="round" ${r === s.rounds[s.rounds.length - 1] ? "open" : ""}><summary><b>Round ${r.round}</b> · ${esc(r.verdict === "accepted" ? "accepted" : r.verdict === "rejected" ? "rejected" : r.verdict || "—")}${r.trained ? ` · trained ${esc(r.trained.slice(0, 10))}` : ""} · ${r.candidates.length} candidates</summary>
        <p class="small">${r.reasons.map(esc).join(" · ")}</p>
        ${Object.keys(r.tasks).length ? Object.entries(r.tasks).map(([tid, t]) => task(tid, t)).join("") : `<p class="small muted">No acceptance table in this round: no candidate passed selection.</p>`}
        <p class="small muted">Protocol: ${r.protocol ? esc(`${r.protocol.decoding}, reasoning ${r.protocol.thinking ? "yes" : "no"}, ${r.protocol.max_tokens} tokens, seed ${r.protocol.seed}, ${r.protocol.prompt}`) : "no data"} · Per-question breakdown: ${esc(r.questions)} · By topic: ${typeof r.topics === "string" ? esc(r.topics) : "yes"}</p></details>`).join("")}</div>`).join("")}
    ${rest.length ? `<div class="card span6"><h3>No measured round yet</h3><p class="small">${rest.map(s => `${esc(s.name)}`).join(" · ")}</p><p class="small muted">Responses are handled via base model profile. Finance tasks and per-question/topic breakdown will arrive in the SPIKE results file with milestone M16; until then, no data.</p></div>` : ""}
    <div class="card span3"><h3>Cage finance exam ${M.prov({ src: "Cage exam (~/.cage/evals)", ts: (b.local || []).map(x => x.date).sort().at(-1) || null, kind: "estudio" })}</h3>${(b.local || []).length ? `<table class="tbl"><thead><tr><th>Model</th><th>Date</th><th class="r">Score</th></tr></thead><tbody>${b.local.map(x => `<tr><td>${esc(x.model)}</td><td>${esc(x.date || "")}</td><td class="r num">${x.correct}/${x.n}</td></tr>`).join("")}</tbody></table>` : empty("No exams", "")}</div>
    <div class="card span3"><h3>Evaluator: what to study ${M.prov({ src: "Cage evaluator on latest exam", ts: (b.local || []).map(x => x.date).sort().at(-1) || null, kind: "estudio" })}</h3>${(c.plan || []).length ? `<div class="list">${c.plan.map(p => `<div class="li"><div class="t"><b>${esc(p.topic)} · ${pc(p.accuracy)}</b><small>${p.n} questions · ${esc(p.error_type)} error</small></div></div>`).join("")}</div>` : empty("No data", "")}
      <p class="small muted">Topics and error types only (exam questions never included). Sent to Memory for the SPIKE builder. ${esc(c.learning || "")}</p></div>
  </div>`;
};
BIND.benchmark = v => { $$(".bbar i[data-w]", v).forEach(i => i.style.setProperty("--w", i.dataset.w + "%")); };
})();
