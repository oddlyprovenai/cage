/* Cage · AI memory: neural orb (2D canvas, no external libraries) with REAL nodes and connections from memory.
   Grows with every data point; can be rotated, explored, and searched. Pauses when hidden and respects "reduce motion". */
(() => {
"use strict";
const M = window.Cage;
const { st, $, $$, esc, TABS, VIEWS, BIND, toast, render, empty } = M;
const COL = { root: "#F0592A", proyecto: "#3E5BDB", tarea: "#8E9BB5", hito: "#1E9E5A", objetivo: "#E0A33A", especialista: "#D94F8C",
  area: "#26A6B5", resultado: "#8E5BD9", plan: "#6B6F78", "tarea-equipo": "#A0A4AD", tema: "#F0592A", hecho: "#E8B04A" };
const KIND = { root: "you", proyecto: "Project", tarea: "Task", hito: "Milestone", objetivo: "Goal", especialista: "SPIKE Specialist",
  area: "Area", resultado: "Measured result", plan: "Plan", "tarea-equipo": "Team card", tema: "Topic", hecho: "Fact" };
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
TABS.splice(Math.max(1, TABS.findIndex(t => t[0] === "agenda") + 1), 0, ["memoria", "Memory"]);

async function load(force) {
  if (st.mem && !force) return;
  try { st.mem = await M.api("/api/memory"); } catch (e) { st.mem = { error: e.message }; }
  if (st.tab === "memoria") render(true);
}

VIEWS.memoria = () => {
  const m = st.mem;
  if (!m) { load(); return empty("Loading memory…", ""); }
  if (m.error) return empty("Not available", esc(m.error));
  const g = m.graph, facts = (m.facts || []).slice().reverse(), byK = {};
  g.nodes.forEach(n => byK[n.kind] = (byK[n.kind] || 0) + 1);
  const pMem = M.prov({ src: "Memory (/api/memory)", ts: m.exported ? m.exported * 1000 : st.data?.updated, kind: "real" });
  return `<div class="grid g-ov stagger">
    <div class="card span4 orbcard"><div class="row wrap"><h3 class="m0">AI Memory ${pMem}</h3><span class="small muted">${g.nodes.length} nodes · ${g.edges.length} connections</span><span class="spacer"></span>
      <input class="in w-auto" id="orbQ" placeholder="Search memory…" autocomplete="off"></div>
      <div class="orbwrap"><canvas id="orb" aria-label="Memory neural orb: ${g.nodes.length} nodes"></canvas><div class="orbtip" id="orbTip" hidden></div></div>
      <div class="legend">${Object.entries(byK).map(([k, n]) => `<span><i data-c="${COL[k] || "#999"}"></i>${esc(KIND[k] || k)} ${n}</span>`).join("")}</div></div>
    <div class="card span2" data-noprov="detalle"><h3>Detail</h3><div id="orbDet"><p class="small muted">Hover over a node or click to see what it is and where it comes from. Drag to rotate the orb.</p></div>
      <h3 class="mt18">Two tiers</h3><p class="small"><b>Shared</b> (read by local AIs, Claude, and Gemini): projects, tasks, goals, plans, decisions, and measured results, in <code>${esc(m.shared_dir)}</code>${m.exported ? ` · exported ${new Date(m.exported * 1000).toLocaleString("en-US")}` : ""}.</p>
      <p class="small"><b>Private</b> (encrypted in your vault, never exported): money, health, email, calendar, documents, keys, and wallet seed.</p></div>
    <div class="card span3" data-noprov="formulario"><h3>Add to memory</h3><form id="memF"><div class="f"><textarea class="in" name="text" rows="3" placeholder="A decision, a fact, how you want AIs to work…" required></textarea></div>
      <div class="row wrap"><select class="in w-auto" name="topic">${[["decisión", "Decision"], ["resultado", "Result"], ["plan", "Plan"], ["cómo trabajar", "How to work"], ["proyecto", "Project"], ["general", "General"]].map(([t, l]) => `<option value="${t}">${l}</option>`).join("")}</select>
      <select class="in w-auto" name="project"><option value="">no project</option>${st.data.projects.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}</select><button class="btn acc" type="submit">Save</button></div></form>
      <p class="small muted">What you write is marked as verified. What AIs write (Claude, Gemini, the local model) remains "unverified" until you check it.</p></div>
    <div class="card span3"><h3>Facts <span class="badge m">${facts.length}</span> ${M.prov({ src: "Memory (/api/memory)", ts: facts[0]?.ts ? facts[0].ts * 1000 : (m.exported ? m.exported * 1000 : st.data?.updated), kind: "real" })}</h3>${facts.length ? `<div class="list scrolly">${facts.slice(0, 80).map(f => `<div class="li"><div class="t"><b>${esc(f.text)}</b><small>${esc(f.source)} · ${esc(f.topic)} · ${new Date(f.ts * 1000).toLocaleDateString("en-US")} · ${f.verified ? "verified" : "<span class='warn'>unverified</span>"}</small></div>${f.verified ? "" : `<button class="btn sm ghost" data-mv="${esc(f.id)}">Verify</button>`}<button class="btn sm ghost" data-md="${esc(f.id)}">Delete</button></div>`).join("")}</div>` : empty("No facts yet", "Add the first one or let the AIs log what they learn.")}</div>
  </div>`;
};

let raf = 0, stopFn = null;
function orb(cv, g) {
  const ctx = cv.getContext("2d"), dpr = Math.min(2, devicePixelRatio || 1);
  const N = g.nodes.length, idx = new Map(g.nodes.map((n, i) => [n.id, i]));
  const R = 0.42 + 0.08 * Math.min(1, Math.log10(N + 1) / 2.5); // orb grows with memory
  // position: Fibonacci spiral ordered by group (children near parent), root at center
  const parent = {}; g.edges.forEach(([a, b]) => { if (!(b in parent)) parent[b] = a; });
  const order = g.nodes.map((n, i) => i).filter(i => g.nodes[i].kind !== "root").sort((a, b) => String(parent[g.nodes[a].id] || "").localeCompare(String(parent[g.nodes[b].id] || "")) || a - b);
  const P = g.nodes.map(() => [0, 0, 0]), born = g.nodes.map((_, i) => reduce ? 0 : performance.now() + 12 * i);
  order.forEach((i, k) => {
    const y = 1 - 2 * (k + 0.5) / order.length, r = Math.sqrt(1 - y * y), th = k * 2.39996;
    const depth = g.nodes[i].kind === "proyecto" || g.nodes[i].kind === "area" || g.nodes[i].kind === "tema" ? 0.62 : 1;
    P[i] = [Math.cos(th) * r * depth, y * depth, Math.sin(th) * r * depth];
  });
  let rotY = 0.4, rotX = -0.25, vy = reduce ? 0 : 0.0018, drag = null, hover = -1, sel = -1, q = "";
  const proj = [];
  function size() { const w = cv.clientWidth, h = cv.clientHeight; cv.width = w * dpr; cv.height = h * dpr; }
  size();
  const ro = new ResizeObserver(size); ro.observe(cv);
  function frame(t) {
    const w = cv.width, h = cv.height, s = Math.min(w, h) * R, cx = w / 2, cy = h / 2;
    ctx.clearRect(0, 0, w, h);
    const cyR = Math.cos(rotY), syR = Math.sin(rotY), cxR = Math.cos(rotX), sxR = Math.sin(rotX);
    for (let i = 0; i < N; i++) {
      const k = born[i] ? Math.min(1, Math.max(0, (t - born[i]) / 700)) : 1, e = 1 - Math.pow(1 - k, 3);
      let [x, y, z] = P[i]; x *= e; y *= e; z *= e;
      const x1 = x * cyR - z * syR, z1 = x * syR + z * cyR, y1 = y * cxR - z1 * sxR, z2 = y * sxR + z1 * cxR;
      const f = 1 / (1.9 - z2 * 0.6);
      proj[i] = [cx + x1 * s * f, cy + y1 * s * f, z2, f, e];
    }
    const match = i => q && (g.nodes[i].label + " " + g.nodes[i].detail).toLowerCase().includes(q);
    ctx.lineWidth = dpr * 0.8;
    for (const [a, b] of g.edges) {
      const i = idx.get(a), j = idx.get(b); if (i === undefined || j === undefined) continue;
      const pa = proj[i], pb = proj[j], hot = i === hover || j === hover || i === sel || j === sel;
      ctx.strokeStyle = hot ? "rgba(240,89,42,.75)" : `rgba(128,140,170,${0.08 + 0.14 * ((pa[2] + pb[2]) / 2 + 1) / 2})`;
      ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]); ctx.stroke();
    }
    const ord = proj.map((p, i) => i).sort((a, b) => proj[a][2] - proj[b][2]);
    for (const i of ord) {
      const n = g.nodes[i], [x, y, z, f, e] = proj[i];
      const pulse = reduce ? 1 : 1 + 0.08 * Math.sin(t / 600 + i);
      const r = Math.max(1.5, (3 + 2.6 * Math.sqrt(n.w)) * f * dpr * pulse) * (match(i) ? 1.8 : 1);
      ctx.globalAlpha = (0.35 + 0.65 * (z + 1) / 2) * e * (q && !match(i) ? 0.35 : 1);
      ctx.fillStyle = COL[n.kind] || "#999";
      if (n.kind === "root" || i === hover || i === sel || match(i)) { ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 14 * dpr; }
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill(); ctx.shadowBlur = 0;
      if ((n.kind === "proyecto" || n.kind === "root" || n.kind === "area" || i === hover || i === sel || match(i)) && z > -0.2) {
        ctx.globalAlpha = Math.min(1, 0.4 + (z + 1) / 2) * e; ctx.fillStyle = getComputedStyle(cv).color;
        ctx.font = `${(n.kind === "root" ? 13 : 11) * dpr}px system-ui, -apple-system, sans-serif`; ctx.fillText(n.label.slice(0, 32), x + r + 4 * dpr, y + 4 * dpr);
      }
    }
    ctx.globalAlpha = 1;
    if (!drag) rotY += vy;
    raf = document.hidden || st.tab !== "memoria" ? 0 : requestAnimationFrame(frame);
  }
  function pick(ev) {
    const r = cv.getBoundingClientRect(), x = (ev.clientX - r.left) * dpr, y = (ev.clientY - r.top) * dpr;
    let best = -1, bd = 1e9;
    proj.forEach((p, i) => { const d = (p[0] - x) ** 2 + (p[1] - y) ** 2; if (d < bd && p[2] > -0.6) { bd = d; best = i; } });
    const rad = (ev.pointerType === "touch" || ev.pointerType === "pen" ? 28 : 14) * dpr;
    return bd < rad ** 2 ? best : -1;
  }
  const tip = $("#orbTip"), det = $("#orbDet");
  const show = i => {
    if (i < 0) return;
    const n = g.nodes[i];
    det.innerHTML = `<p><span class="badge m">${esc(KIND[n.kind] || n.kind)}</span></p><p><b>${esc(n.label)}</b></p>${n.detail ? `<p class="small">${esc(n.detail)}</p>` : ""}<p class="small muted">${n.src ? "Source: " + esc(n.src) : ""}${n.updated ? ` · ${new Date((n.updated > 1e12 ? n.updated : n.updated * 1000)).toLocaleString("en-US")}` : ""}</p>`;
  };
  cv.onpointerdown = e => { drag = [e.clientX, e.clientY, rotY, rotX]; cv.setPointerCapture(e.pointerId); };
  cv.onpointerup = e => { if (drag && Math.abs(e.clientX - drag[0]) + Math.abs(e.clientY - drag[1]) < 4) { sel = pick(e); show(sel); } drag = null; };
  cv.onpointermove = e => {
    if (drag) { rotY = drag[2] + (e.clientX - drag[0]) / 180; rotX = Math.max(-1.2, Math.min(1.2, drag[3] + (e.clientY - drag[1]) / 180)); if (!raf) raf = requestAnimationFrame(frame); return; }
    hover = pick(e);
    if (hover >= 0) { const n = g.nodes[hover], r = cv.getBoundingClientRect(); tip.hidden = false; tip.textContent = n.label; tip.style.left = (e.clientX - r.left + 12) + "px"; tip.style.top = (e.clientY - r.top + 12) + "px"; }
    else tip.hidden = true;
    if (!raf) raf = requestAnimationFrame(frame);
  };
  cv.onpointerleave = () => { hover = -1; tip.hidden = true; };
  const qi = $("#orbQ");
  if (qi) qi.oninput = () => { q = qi.value.trim().toLowerCase(); const i = q ? g.nodes.findIndex(n => (n.label + " " + n.detail).toLowerCase().includes(q)) : -1; if (i >= 0) show(i); if (!raf) raf = requestAnimationFrame(frame); };
  const vis = () => { if (!document.hidden && st.tab === "memoria" && !raf) raf = requestAnimationFrame(frame); };
  document.addEventListener("visibilitychange", vis);
  raf = requestAnimationFrame(frame);
  return () => { cancelAnimationFrame(raf); raf = 0; ro.disconnect(); document.removeEventListener("visibilitychange", vis); };
}

BIND.memoria = v => {
  if (stopFn) { stopFn(); stopFn = null; }
  const cv = $("#orb", v);
  if (cv && st.mem?.graph) stopFn = orb(cv, st.mem.graph);
  const f = $("#memF", v);
  if (f) f.onsubmit = async e => { e.preventDefault(); try { await M.api("/api/memory", { body: { action: "add", text: f.text.value, topic: f.topic.value, project: f.project.value } }); toast("Saved to memory"); await load(true); } catch (er) { toast(er.message); } };
  $$("[data-mv]", v).forEach(b => b.onclick = async () => { try { await M.api("/api/memory", { body: { action: "verify", id: b.dataset.mv } }); await load(true); } catch (er) { toast(er.message); } });
  $$("[data-md]", v).forEach(b => b.onclick = async () => { if (!confirm("Delete this fact from memory?")) return; try { await M.api("/api/memory", { body: { action: "delete", id: b.dataset.md } }); await load(true); } catch (er) { toast(er.message); } });
};
})();
