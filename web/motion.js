/* Cage · motion (block C + G5): subtle card depth, staggered entry, empty states,
   celebration when completing tasks/milestones and respecting "prefers-reduced-motion".
   No libraries; transform/opacity only (GPU-composited, 60 fps) and strict CSP without inline styles. */
(() => {
"use strict";
const M = window.Cage;
const { st, HOOKS } = M;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const fine = matchMedia("(pointer: fine)").matches;


/* depth: the card under the mouse tilts ≤ 2.5° towards it */
let cur = null, raf = 0, px = 0, py = 0;
function tilt() {
  raf = 0;
  if (!cur) return;
  const r = cur.getBoundingClientRect(), x = (px - r.left) / r.width - 0.5, y = (py - r.top) / r.height - 0.5;
  cur.style.setProperty("--rx", (-y * 2.5).toFixed(2) + "deg");
  cur.style.setProperty("--ry", (x * 2.5).toFixed(2) + "deg");
  cur.style.setProperty("--gx", ((x + 0.5) * 100).toFixed(1) + "%");
  cur.style.setProperty("--gy", ((y + 0.5) * 100).toFixed(1) + "%");
}
if (fine) {
  document.addEventListener("pointermove", e => {
    if (reduced()) return;
    const c = e.target.closest?.("#view .card:not(.no-tilt), #view .offer, #view .fstep, #view .step");
    if (c !== cur) { cur?.classList.remove("tilting"); cur?.style.removeProperty("--rx"); cur?.style.removeProperty("--ry"); cur = c; cur?.classList.add("tilting"); }
    px = e.clientX; py = e.clientY;
    if (cur && !raf) raf = requestAnimationFrame(tilt);
  }, { passive: true });
  document.addEventListener("pointerleave", () => { cur?.classList.remove("tilting"); cur = null; });
}

/* subtle celebration when closed tasks or milestones count increases */
let last = null;
function doneCount() { return (st.data?.projects || []).reduce((a, p) => a + p.tasks.filter(t => t.status === "done").length + p.milestones.filter(m => m.done).length * 3, 0); }
function celebrate() {
  if (reduced()) return;
  const box = document.createElement("div"); box.className = "confetti"; box.setAttribute("aria-hidden", "true");
  const colors = ["#F0592A", "#FFA06A", "#3E5BDB", "#1E9E5A", "#E0A33A"];
  for (let i = 0; i < 26; i++) {
    const s = document.createElement("i"), a = (Math.PI * 2 * i) / 26, d = 70 + Math.random() * 90;
    s.style.setProperty("--dx", (Math.cos(a) * d).toFixed(0) + "px"); s.style.setProperty("--dy", (Math.sin(a) * d - 40).toFixed(0) + "px");
    s.style.setProperty("--rot", (Math.random() * 540 - 270).toFixed(0) + "deg"); s.style.background = colors[i % colors.length];
    s.style.animationDelay = (Math.random() * 80).toFixed(0) + "ms"; box.appendChild(s);
  }
  document.body.appendChild(box); setTimeout(() => box.remove(), 1300);
}

/* observer to animate charts once when becoming visible in the current tab (G4) */
let lastTabKey = "";
const seenCharts = new Set();
const chartIO = "IntersectionObserver" in window ? new IntersectionObserver(es => {
  es.forEach(e => {
    if (!e.isIntersecting) return;
    const svg = e.target;
    chartIO.unobserve(svg);
    if (reduced()) { svg.classList.add("chart-done"); return; }
    svg.classList.add("chart-play");
    if (svg.dataset.ckey) seenCharts.add(svg.dataset.ckey);
  });
}, { rootMargin: "0px 0px 320px 0px", threshold: 0.01 }) : null;

/* tables with own scroll, chart variables and staggered entry order */
function enhanceView(v) {
  const root = v || document.getElementById("view");
  if (!root) return;
  const tk = `${st.tab}:${st.trTab || ""}:${st.invTab || ""}:${st.proj || "all"}`;
  if (tk !== lastTabKey) { lastTabKey = tk; seenCharts.clear(); }
  root.querySelectorAll(".grid > *").forEach((el, i) => el.style.setProperty("--i", i));
  root.querySelectorAll("[data-i]").forEach(e => e.style.setProperty("--i", e.dataset.i));
  root.querySelectorAll("[data-s]").forEach(e => e.style.setProperty("--s", e.dataset.s));
  root.querySelectorAll("[data-c]").forEach(e => e.style.setProperty("--c", e.dataset.c));
  root.querySelectorAll("[data-len]").forEach(e => e.style.setProperty("--len", e.dataset.len));
  root.querySelectorAll("svg.chart").forEach((svg, idx) => {
    const key = `${tk}#${idx}:${svg.getAttribute("viewBox") || ""}`;
    svg.dataset.ckey = key;
    if (reduced() || seenCharts.has(key)) {
      svg.classList.remove("chart-play");
      svg.classList.add("chart-done");
    } else if (chartIO) {
      svg.classList.add("chart-arm");  // only hidden to animate if observer exists…
      chartIO.observe(svg);
      setTimeout(() => {               // …and if not animated within 2.5s, display anyway: never an invisible chart
        if (!svg.classList.contains("chart-play")) { chartIO.unobserve(svg); svg.classList.add("chart-done"); }
      }, 2500);
    } else {
      svg.classList.add("chart-play");
      seenCharts.add(key);
    }
  });
  root.querySelectorAll("table.tbl").forEach(t => {
    const p = t.parentElement;
    if (p && !p.classList.contains("scroll") && !p.classList.contains("tbl-scroll")) {
      const w = document.createElement("div");
      w.className = "tbl-scroll";
      t.replaceWith(w);
      w.appendChild(t);
    }
  });
}

const ar = HOOKS.afterRender;
HOOKS.afterRender = v => {
  ar(v);
  enhanceView(v);
  const n = doneCount();
  if (last !== null && n > last) celebrate();
  last = n;
};
/* Blender 3D assets: only if already rendered (otherwise SVG logo remains) */
const ICONS = new Set(["hoy", "progreso", "proyectos", "finanzas", "suscripciones", "salud", "inversion", "trading", "ia"]);
function with3d() {
  if (!st.has3d) return;
  const anim = !reduced();
  document.querySelectorAll("img.logo.xl:not([data-3d])").forEach(img => { img.dataset["3d"] = 1; img.src = anim ? "/3d/logo3d.webp" : "/3d/logo3d.png"; });
  const h1 = document.querySelector("#view .head h1");
  const tab = st.tab === "ia" ? "asistente" : st.tab;
  if (h1 && ICONS.has(st.tab) && !h1.querySelector(".ico3d")) {
    const img = new Image(); img.className = "ico3d"; img.alt = ""; img.src = `/3d/icons/${tab}${anim ? "" : ".png"}.webp`;
    img.addEventListener("error", () => img.remove()); h1.prepend(img);
  }
}
new MutationObserver(() => with3d()).observe(document.getElementById("gate"), { childList: true });
const ar2 = HOOKS.afterRender;
HOOKS.afterRender = v => { ar2(v); with3d(); };
M.motion = { celebrate };
})();
