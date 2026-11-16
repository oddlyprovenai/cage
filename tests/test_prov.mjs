// Procedencia (web/prov.js): estados y detección de tarjetas con cifras sin fuente. node tests/test_prov.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../web/prov.js", import.meta.url), "utf8");
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
globalThis.document = { addEventListener() {}, hidden: false };
globalThis.window = { Cage: { st: {}, $$: () => [], esc, HOOKS: { afterLoad() {} }, render() {} } };
new Function(src)();
const P = window.Cage.prov;
const H = 36e5, now = Date.now();
assert.equal(P.state({ ts: now - 1 * H, kind: "mercado" }), "ok");
assert.equal(P.state({ ts: now - 5 * H, kind: "mercado" }), "old");
assert.equal(P.state({ ts: (now - 2 * 24 * H) / 1000, kind: "diario" }), "ok");          // segundos también
assert.equal(P.state({ ts: null, kind: "mercado" }), "none");
assert.equal(P.state({ ts: now, value: null }), "none");
assert.equal(P.state({ kind: "tu" }), "ok");                                              // lo que registraste tú
assert.equal(P.state({ ts: now, compare: { a: 100, b: 103, tol: 0.01 } }), "diff");       // dos fuentes que no cuadran
assert.equal(P.state({ ts: now, compare: { a: 100, b: 100.5, tol: 0.01 } }), "ok");
const chip = P({ src: "Binance", ts: now, kind: "mercado" });
assert.match(chip, /class="prov" data-state="ok"/); assert.match(chip, /Source: Binance/);
assert.match(P({ src: "<script>", ts: now }), /&lt;script&gt;/);                          // escaped
// detector: a card with «12.50 €» and no chip counts as missing; with chip or data-noprov, no
const card = (txt, prov) => ({ closest: () => null, querySelector: q => q === ".prov" ? prov : null, innerText: txt });
const root = { querySelectorAll: () => [card("Gasto 12,50 €", null), card("Gasto 12,50 €", {}), card("Sin cifras", null)] };
assert.equal(P.missing(root).length, 1);
assert.equal(P.state({ ts: now - 30 * H, kind: "real", src: "Bóveda (health)" }), "ok");   // user data: does not expire
assert.equal(P.state({ ts: now - 30 * H, kind: "calc" }), "old");                           // alias de cálculo: 24 h
assert.equal(P.state({ ts: now - 50 * H, kind: "paper" }), "ok");                           // alias diario: 96 h
assert.equal(P.state({ ts: NaN, kind: "tu" }), "ok"); assert.doesNotMatch(P({ src: "x", ts: NaN }), /Invalid Date/);
assert.doesNotMatch(P({ src: "x", ts: {} }), /Invalid Date/);
console.log("prov ok");
