/* Dependency-free SVG charts. Return strings; dynamic styles are placed in data-* (CSP without inline styles). */
(function () {
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nice = v => { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; };
  const fmtK = v => Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + "M" : Math.abs(v) >= 1e3 ? (v / 1e3).toFixed(1).replace(/\.0$/, "") + "k" : String(Math.round(v * 10) / 10);

  function axes(W, H, P, max, labels, min = 0) {
    let s = "";
    for (let i = 0; i <= 4; i++) {
      const y = P.t + (H - P.t - P.b) * (1 - i / 4);
      s += `<line class="grid-l" x1="${P.l}" x2="${W - P.r}" y1="${y}" y2="${y}"/><text x="${P.l - 8}" y="${y + 4}" text-anchor="end">${fmtK(min + (max - min) * i / 4)}</text>`;
    }
    const n = labels.length, cw = (W - P.l - P.r) / n;
    labels.forEach((l, i) => { if (n <= 12 || i % Math.ceil(n / 12) === 0) s += `<text x="${P.l + cw * i + cw / 2}" y="${H - 6}" text-anchor="middle">${esc(l)}</text>`; });
    return s;
  }

  // series: [{name,color,values:[]}]
  function bars(labels, series, opt = {}) {
    const W = opt.w || 560, H = opt.h || 230, P = { t: 10, r: 6, b: 24, l: 40 };
    const max = nice(Math.max(1, ...series.flatMap(s => s.values)));
    let s = axes(W, H, P, max, labels);
    const cw = (W - P.l - P.r) / labels.length, bw = Math.min(16, (cw * .7) / series.length);
    labels.forEach((l, i) => series.forEach((se, j) => {
      const v = se.values[i] || 0, h = (H - P.t - P.b) * v / max;
      const x = P.l + cw * i + (cw - bw * series.length) / 2 + j * bw;
      s += `<rect class="bar" data-i="${i}" data-s="${j}" data-tip="${esc(se.name)} · ${esc(l)}: ${esc(opt.fmt ? opt.fmt(v) : v)}" x="${x + 1}" y="${H - P.b - h}" width="${bw - 2}" height="${Math.max(0, h)}" rx="3" fill="${se.color}"/>`;
    }));
    return `<svg class="chart chart-bars" viewBox="0 0 ${W} ${H}" role="img">${s}</svg>`;
  }

  function path(pts, smooth = true) {
    if (!pts.length) return "";
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      if (smooth) { const cx = (x0 + x1) / 2; d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`; } else d += ` L${x1},${y1}`;
    }
    return d;
  }

  function line(labels, series, opt = {}) {
    const W = opt.w || 560, H = opt.h || 220, P = { t: 14, r: 10, b: 24, l: 40 };
    const all = series.flatMap(s => s.values);
    let max = nice(Math.max(1, ...all)), min = Math.min(0, ...all);
    if (opt.min === "auto" && all.length) { min = Math.floor(Math.min(...all) - 1); max = Math.ceil(Math.max(...all) + 1); }
    let s = axes(W, H, P, max, labels, min);
    const cw = (W - P.l - P.r) / labels.length;
    series.forEach((se, k) => {
      const pts = se.values.map((v, i) => [P.l + cw * i + cw / 2, P.t + (H - P.t - P.b) * (1 - (v - min) / (max - min || 1))]);
      const d = path(pts, opt.smooth !== false);
      if (se.area) {
        const id = "g" + Math.random().toString(36).slice(2, 8);
        s += `<defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${se.color}" stop-opacity=".35"/><stop offset="1" stop-color="${se.color}" stop-opacity="0"/></linearGradient></defs>`;
        s += `<path class="ar" data-i="${k}" d="${d} L${pts[pts.length - 1][0]},${H - P.b} L${pts[0][0]},${H - P.b} Z" fill="url(#${id})"/>`;
      }
      s += `<path class="ln" data-i="${k}" pathLength="1" d="${d}" fill="none" stroke="${se.color}" stroke-width="2.4" stroke-linecap="round"/>`;
      pts.forEach((p, i) => { s += `<circle class="pt" cx="${p[0]}" cy="${p[1]}" r="9" fill="transparent" data-tip="${esc(se.name)} · ${esc(labels[i])}: ${esc(opt.fmt ? opt.fmt(se.values[i]) : se.values[i])}"/>`; });
      if (opt.marker !== false && pts.length) { const p = pts[pts.length - 1]; s += `<circle class="ar end-dot" data-i="${k}" cx="${p[0]}" cy="${p[1]}" r="5" fill="var(--card)" stroke="${se.color}" stroke-width="2.5"/>`; }
    });
    // event markers (e.g. news): dashed vertical line and point with tooltip text on hover
    (opt.marks || []).forEach(mk => {
      if (mk.i < 0 || mk.i >= labels.length) return;
      const x = P.l + cw * mk.i + cw / 2;
      s += `<line x1="${x}" x2="${x}" y1="${P.t}" y2="${H - P.b}" stroke="${mk.color || "var(--acc)"}" stroke-width="1.2" stroke-dasharray="3 3" opacity=".8"/>`;
      s += `<circle cx="${x}" cy="${P.t + 4}" r="5" fill="${mk.color || "var(--acc)"}" data-tip="${esc(mk.tip || "")}"/>`;
    });
    return `<svg class="chart chart-line" viewBox="0 0 ${W} ${H}" role="img">${s}</svg>`;
  }

  function spark(values, color, kind = "line") {
    const W = 120, H = 54;
    if (!values.length || values.every(v => v === 0)) return `<svg class="chart chart-spark" viewBox="0 0 ${W} ${H}"><line x1="0" x2="${W}" y1="${H - 4}" y2="${H - 4}" stroke="var(--line)" stroke-width="2" stroke-dasharray="4 4"/></svg>`;
    const max = Math.max(...values), min = Math.min(0, ...values), n = values.length;
    if (kind === "bars") {
      const bw = W / n; let s = "";
      values.forEach((v, i) => { const h = (H - 4) * (v - min) / (max - min || 1); s += `<rect class="bar" data-i="${i}" x="${i * bw + 2}" y="${H - h}" width="${bw - 4}" height="${h}" rx="2" fill="${color}" opacity="${.35 + .65 * (i + 1) / n}"/>`; });
      return `<svg class="chart chart-spark" viewBox="0 0 ${W} ${H}">${s}</svg>`;
    }
    if (n === 1) return `<svg class="chart chart-spark" viewBox="0 0 ${W} ${H}"><line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" stroke="var(--line)" stroke-width="2" stroke-dasharray="4 4"/><circle cx="${W / 2}" cy="${H / 2}" r="5" fill="${color}"/></svg>`;
    const pts = values.map((v, i) => [i * W / (n - 1), H - 4 - (H - 8) * (v - min) / (max - min || 1)]);
    const d = path(pts, false);
    return `<svg class="chart chart-spark" viewBox="0 0 ${W} ${H}"><path class="ar" d="${d} L${W},${H} L0,${H} Z" fill="${color}" fill-opacity=".14"/><path class="ln" pathLength="1" d="${d}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round"/></svg>`;
  }

  // items: [{label,value,color}]
  function donut(items, opt = {}) {
    const S = opt.size || 220, R = S / 2 - 22, C = 2 * Math.PI * R, tot = items.reduce((a, b) => a + b.value, 0);
    if (!tot) return `<svg class="chart chart-donut" viewBox="0 0 ${S} ${S}"><circle cx="${S / 2}" cy="${S / 2}" r="${R}" fill="none" stroke="var(--line)" stroke-width="34"/></svg>`;
    let off = 0, s = "";
    items.forEach((it, i) => {
      const len = C * it.value / tot;
      s += `<circle class="seg dn" data-i="${i}" data-len="${len}" data-tip="${esc(it.label)}: ${(100 * it.value / tot).toFixed(1)}%" cx="${S / 2}" cy="${S / 2}" r="${R}" fill="none" stroke="${it.color}" stroke-width="34" transform="rotate(${-90 + 360 * off / C} ${S / 2} ${S / 2})"/>`;
      off += len;
    });
    return `<svg class="chart chart-donut" viewBox="0 0 ${S} ${S}">${s}</svg>`;
  }

  window.Charts = { bars, line, spark, donut, esc, fmtK };
})();
