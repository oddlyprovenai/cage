/* Cage · animated tab icons and logo with depth (SVG + CSS, no libraries, no video).
   3D look with gradients, specular shine, shadow and layers. Only animates when visible (IntersectionObserver)
   and never with "prefers-reduced-motion". Transform/opacity only: 60 fps and negligible RAM usage. */
(() => {
"use strict";
const M = window.Cage;
const { st, HOOKS } = M;

const DEFS = `<defs>
  <linearGradient id="mi-tile" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2C2D33"/><stop offset="1" stop-color="#0D0E11"/></linearGradient>
  <radialGradient id="mi-glow" cx=".7" cy=".2" r=".8"><stop offset="0" stop-color="#F0592A" stop-opacity=".35"/><stop offset="1" stop-color="#F0592A" stop-opacity="0"/></radialGradient>
  <linearGradient id="mi-or" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFB27E"/><stop offset=".5" stop-color="#F0592A"/><stop offset="1" stop-color="#B9300F"/></linearGradient>
  <linearGradient id="mi-wh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#C9CBD3"/></linearGradient>
  <linearGradient id="mi-gr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5BE39A"/><stop offset="1" stop-color="#139255"/></linearGradient>
  <linearGradient id="mi-rd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF7B6E"/><stop offset="1" stop-color="#C02A1F"/></linearGradient>
  <filter id="mi-sh" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="2.2" stdDeviation="1.6" flood-color="#000" flood-opacity=".55"/></filter>
</defs>`;
const TILE = `<rect x="2" y="2" width="60" height="60" rx="16" fill="url(#mi-tile)"/><rect x="2" y="2" width="60" height="60" rx="16" fill="url(#mi-glow)"/>
  <rect x="2.5" y="2.5" width="59" height="59" rx="15.5" fill="none" stroke="#fff" stroke-opacity=".1"/><path d="M8 14a12 12 0 0 1 12-10h24" stroke="#fff" stroke-opacity=".14" stroke-width="1.5" fill="none" stroke-linecap="round"/>`;

const G = {
  hoy: `<g class="a-spin" filter="url(#mi-sh)">${[...Array(8)].map((_, i) => `<rect x="30.5" y="11" width="3" height="7" rx="1.5" fill="url(#mi-or)" transform="rotate(${i * 45} 32 32)"/>`).join("")}</g>
        <circle cx="32" cy="32" r="10" fill="url(#mi-or)" filter="url(#mi-sh)"/><circle cx="28.5" cy="28.5" r="3.5" fill="#fff" opacity=".45"/>`,
  progreso: `<g filter="url(#mi-sh)">${[[16, 22], [28, 15], [40, 8]].map(([x, h], i) => `<rect class="a-grow d${i}" x="${x}" y="${48 - h * 1.6}" width="9" height="${h * 1.6}" rx="3" fill="${i === 2 ? "url(#mi-or)" : "url(#mi-wh)"}" opacity="${0.55 + i * 0.2}"/>`).join("")}</g>
        <path class="a-draw" d="M14 42 L26 34 L36 37 L50 20" fill="none" stroke="#FFB27E" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" pathLength="1"/>`,
  proyectos: `<g filter="url(#mi-sh)"><g class="a-bob d2"><path d="M32 40 50 31 32 22 14 31Z" fill="url(#mi-wh)" opacity=".45"/></g>
        <g class="a-bob d1"><path d="M32 34 50 25 32 16 14 25Z" fill="url(#mi-wh)" opacity=".75"/></g>
        <g class="a-bob"><path d="M32 28 50 19 32 10 14 19Z" fill="url(#mi-or)"/><path d="M32 10 50 19 46 21 32 14Z" fill="#fff" opacity=".35"/></g></g>`,
  finanzas: `<g filter="url(#mi-sh)"><ellipse cx="32" cy="46" rx="14" ry="4.5" fill="#7A2410"/><rect x="18" y="38" width="28" height="8" fill="#B9300F"/><ellipse cx="32" cy="38" rx="14" ry="4.5" fill="url(#mi-or)"/>
        <g class="a-flip"><circle cx="32" cy="24" r="11" fill="url(#mi-or)"/><circle cx="32" cy="24" r="8" fill="none" stroke="#FFD2B0" stroke-width="1.5" opacity=".8"/><text x="32" y="28.5" text-anchor="middle" font-size="12" font-weight="800" fill="#fff" font-family="-apple-system,Helvetica">€</text></g></g>`,
  suscripciones: `<g class="a-spin slow" filter="url(#mi-sh)"><path d="M32 14a18 18 0 0 1 17 12" fill="none" stroke="url(#mi-or)" stroke-width="5" stroke-linecap="round"/><path d="M52 21 49 28 43 23Z" fill="#F0592A"/>
        <path d="M32 50a18 18 0 0 1-17-12" fill="none" stroke="url(#mi-wh)" stroke-width="5" stroke-linecap="round"/><path d="M12 43 15 36 21 41Z" fill="#C9CBD3"/></g>
        <circle cx="32" cy="32" r="5" fill="url(#mi-or)"/>`,
  salud: `<g class="a-beat" filter="url(#mi-sh)"><path d="M32 49C20 40 13 33 13 25a9 9 0 0 1 19-4 9 9 0 0 1 19 4c0 8-7 15-19 24Z" fill="url(#mi-rd)"/>
        <path d="M20 22a5 5 0 0 1 8-2" stroke="#fff" stroke-width="2.4" stroke-linecap="round" fill="none" opacity=".6"/></g>
        <path class="a-draw" d="M10 34h12l3-6 4 11 3-5h22" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" opacity=".85" pathLength="1"/>`,
  inversion: `<g filter="url(#mi-sh)"><path d="M12 48 L24 36 L32 40 L50 18" fill="none" stroke="url(#mi-or)" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" class="a-draw" pathLength="1"/>
        <path class="a-pop" d="M42 16h10v10" fill="none" stroke="#FFB27E" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/></g>
        <path d="M12 52h40" stroke="#fff" stroke-opacity=".25" stroke-width="2" stroke-linecap="round"/>`,
  trading: `<g filter="url(#mi-sh)">${[[16, 30, 14, "gr"], [26, 24, 10, "rd"], [36, 20, 18, "gr"], [46, 14, 16, "gr"]].map(([x, y, h, c], i) => `<g class="a-bob d${i % 3}"><line x1="${x + 3}" x2="${x + 3}" y1="${y - 5}" y2="${y + h + 5}" stroke="#fff" stroke-opacity=".6" stroke-width="1.5"/><rect x="${x}" y="${y}" width="6" height="${h}" rx="1.5" fill="url(#mi-${c})"/></g>`).join("")}</g>`,
  ia: `<g filter="url(#mi-sh)"><circle class="a-pulse" cx="32" cy="32" r="12" fill="url(#mi-or)"/><circle cx="28" cy="28" r="4" fill="#fff" opacity=".5"/></g>
        <g class="a-orbit"><ellipse cx="32" cy="32" rx="22" ry="8" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="1.5" transform="rotate(-20 32 32)"/><circle cx="53" cy="25" r="2.8" fill="#FFB27E"/></g>`,
  correo: `<g filter="url(#mi-sh)"><rect x="13" y="19" width="38" height="26" rx="5" fill="url(#mi-wh)" opacity=".9"/><path class="a-bob" d="M14 21 32 34 50 21" fill="none" stroke="url(#mi-or)" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><circle class="a-pulse" cx="47" cy="20" r="5" fill="url(#mi-or)"/></g>`,
  agenda: `<g filter="url(#mi-sh)"><rect x="14" y="16" width="36" height="34" rx="6" fill="url(#mi-wh)" opacity=".9"/><rect x="14" y="16" width="36" height="10" rx="5" fill="url(#mi-or)"/><rect x="22" y="12" width="4" height="8" rx="2" fill="#FFB27E"/><rect x="38" y="12" width="4" height="8" rx="2" fill="#FFB27E"/><circle class="a-pulse" cx="25" cy="35" r="3.2" fill="url(#mi-or)"/><circle cx="35" cy="35" r="2.6" fill="#7A2410" opacity=".45"/><circle cx="30" cy="43" r="2.6" fill="#7A2410" opacity=".45"/></g>`,
  memoria: `<g filter="url(#mi-sh)"><circle class="a-pulse" cx="32" cy="32" r="9" fill="url(#mi-or)"/><g class="a-spin slow"><line x1="32" y1="32" x2="18" y2="18" stroke="#FFB27E" stroke-width="1.8" opacity=".7"/><line x1="32" y1="32" x2="47" y2="20" stroke="#FFB27E" stroke-width="1.8" opacity=".7"/><line x1="32" y1="32" x2="45" y2="46" stroke="#FFB27E" stroke-width="1.8" opacity=".7"/><line x1="32" y1="32" x2="17" y2="44" stroke="#FFB27E" stroke-width="1.8" opacity=".7"/><circle cx="18" cy="18" r="3.5" fill="url(#mi-wh)"/><circle cx="47" cy="20" r="3.8" fill="url(#mi-or)"/><circle cx="45" cy="46" r="3.2" fill="url(#mi-wh)"/><circle cx="17" cy="44" r="3.5" fill="url(#mi-gr)"/></g></g>`,
  documentos: `<g filter="url(#mi-sh)"><rect class="a-bob" x="17" y="13" width="30" height="38" rx="5" fill="url(#mi-wh)" opacity=".92"/><path d="M23 24h18M23 31h18M23 38h11" stroke="url(#mi-or)" stroke-width="2.6" stroke-linecap="round"/></g>`,
  informes: `<g filter="url(#mi-sh)"><rect x="15" y="14" width="34" height="36" rx="5" fill="url(#mi-wh)" opacity=".9"/><path class="a-draw" d="M21 38 L28 30 L34 34 L43 22" fill="none" stroke="url(#mi-or)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" pathLength="1"/></g>`,
  sistema: `<g filter="url(#mi-sh)"><circle class="a-spin slow" cx="32" cy="32" r="14" fill="none" stroke="url(#mi-or)" stroke-width="4" stroke-dasharray="6 4"/><circle class="a-pulse" cx="32" cy="32" r="6" fill="url(#mi-gr)"/></g>`,
  conectar: `<g filter="url(#mi-sh)"><path class="a-bob" d="M25 22l-5 5a8 8 0 0 0 11 11l4-4" fill="none" stroke="url(#mi-wh)" stroke-width="3.6" stroke-linecap="round"/><path class="a-bob d1" d="M39 42l5-5a8 8 0 0 0-11-11l-4 4" fill="none" stroke="url(#mi-or)" stroke-width="3.6" stroke-linecap="round"/><circle class="a-pulse" cx="32" cy="32" r="3.2" fill="#5BE39A"/></g>`,
};
const ALIAS = { suscripciones: "suscripciones", ia: "ia", trading: "trading" };

function svg(tab) {
  const g = G[ALIAS[tab] || tab];
  return g ? `<svg class="tab-ico" viewBox="0 0 64 64" aria-hidden="true">${DEFS}${TILE}${g}</svg>` : "";
}

// logo with depth: extrusion layers, shine and smooth rotation (login screen)
function logo3d() {
  // the user's initial (a generic «C» for Cage before the vault is unlocked), extruded in 7 layers
  const name = (st.data && st.data.profile && st.data.profile.name) || "";
  const ini = M.esc(((name.match(/[\p{L}\p{N}]/u) || ["C"])[0]).toUpperCase());
  const layers = [...Array(7)].map((_, i) => `<g transform="translate(${-i * 0.9} ${i * 1.1})" opacity="${1 - i * 0.08}"><text x="610" y="560" text-anchor="middle" dominant-baseline="middle" font-family="-apple-system, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif" font-weight="800" font-size="520" fill="${i ? "#7A2410" : "url(#lj)"}">${ini}</text></g>`).reverse().join("");
  return `<div class="logo3d" aria-label="Cage"><svg viewBox="0 0 1024 1024">
    <defs><linearGradient id="lbg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2A2B31"/><stop offset="1" stop-color="#0D0E11"/></linearGradient>
      <radialGradient id="lgl" cx=".7" cy=".2" r=".7"><stop offset="0" stop-color="#F0592A" stop-opacity=".32"/><stop offset="1" stop-color="#F0592A" stop-opacity="0"/></radialGradient>
      <linearGradient id="lj" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFA06A"/><stop offset=".5" stop-color="#F0592A"/><stop offset="1" stop-color="#C9370F"/></linearGradient>
      <linearGradient id="lsh" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
    <rect x="64" y="64" width="896" height="896" rx="200" fill="url(#lbg)"/><rect x="64" y="64" width="896" height="896" rx="200" fill="url(#lgl)"/>
    <g class="lbars"><rect x="210" y="690" width="56" height="90" rx="28" fill="#fff" fill-opacity=".28"/><rect x="290" y="620" width="56" height="160" rx="28" fill="#fff" fill-opacity=".5"/><rect x="370" y="550" width="56" height="230" rx="28" fill="#fff" fill-opacity=".85"/></g>
    <g class="lj">${layers}</g>
    <rect x="64" y="64" width="896" height="896" rx="200" fill="url(#lsh)" class="lshine"/>
    <rect x="66" y="66" width="892" height="892" rx="198" fill="none" stroke="#fff" stroke-opacity=".1" stroke-width="4"/></svg></div>`;
}

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const io = "IntersectionObserver" in window ? new IntersectionObserver(es => es.forEach(e => e.target.classList.toggle("play", e.isIntersecting && !reduced())), { threshold: 0.2 }) : null;
function watch(el) { if (io) io.observe(el); else if (!reduced()) el.classList.add("play"); }

function decorate() {
  const h1 = document.querySelector("#view .head h1") || document.querySelector("#view .card h3");
  if (h1 && !h1.querySelector(".tab-ico, .ico3d") && G[st.tab]) {
    h1.insertAdjacentHTML("afterbegin", svg(st.tab));
    watch(h1.querySelector(".tab-ico"));
  }
  document.querySelectorAll("#gate img.logo.xl:not([data-3d])").forEach(img => {
    if (st.has3d) return; // if Blender already rendered, use that
    const w = document.createElement("div"); w.innerHTML = logo3d();
    const el = w.firstChild; img.replaceWith(el); watch(el);
  });
}
const ar = HOOKS.afterRender;
HOOKS.afterRender = v => { ar(v); decorate(); };
new MutationObserver(decorate).observe(document.getElementById("gate"), { childList: true });
M.icons = { svg, logo3d };
})();
