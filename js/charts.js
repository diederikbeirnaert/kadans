// Kleine SVG-grafieken zonder bibliotheek: kolommen, gestapelde kolommen, lijnen en een band.
// Elke grafiek past zich aan de breedte aan en toont bij aanwijzen de waarden van dat punt.

const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};
const h = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids.filter((k) => k != null));
  return n;
};

function niceTicks(min, max, n = 4) {
  const span = max - min || 1;
  const mag = 10 ** Math.floor(Math.log10(span / n));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((st) => span / st <= n);
  const out = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 0.999; v += step) out.push(+v.toFixed(6));
  return out;
}

// Kolom met afgeronde bovenkant en rechte onderkant.
function column(x, y, w, hgt, color, round = true) {
  const r = round ? Math.min(4, w / 2, hgt) : 0;
  return s('path', { d: `M${x},${y + hgt}V${y + r}q0,${-r} ${r},${-r}h${w - 2 * r}q${r},0 ${r},${r}V${y + hgt}z`, fill: color });
}

/**
 * opts:
 *   labels   – tekst per punt voor de tooltip
 *   tick     – (i) => korte tekst onder de as, of '' om over te slaan
 *   bars     – { values, color, label }
 *   stacks   – { keys: [{ key, label, color }], rows: [{ [key]: waarde }] }
 *   lines    – [{ values, color, label }]
 *   band     – { low, high, label } (arrays), getekend als lichte zone
 *   fmt      – (v) => tekst in de tooltip
 *   tickFmt  – (v) => korte tekst langs de y-as (standaard gelijk aan fmt)
 *   zero     – de y-as begint bij 0 (altijd bij kolommen)
 *   invert   – lage waarden bovenaan (voor tempo: sneller is hoger)
 */
export function chart(opts) {
  const { labels, tick = () => '', bars, stacks, lines = [], band, fmt = (v) => String(Math.round(v)), height = 200 } = opts;
  const tickFmt = opts.tickFmt || fmt;
  const host = h('div', { className: 'chart' });
  const tip = h('div', { className: 'tip', hidden: true });
  const n = labels.length;
  const M = { l: 40, r: 20, t: 10, b: 22 };

  const stackTotals = stacks ? stacks.rows.map((r) => stacks.keys.reduce((t, k) => t + (r[k.key] || 0), 0)) : [];
  const all = [...(bars?.values || []), ...stackTotals, ...lines.flatMap((l) => l.values), ...(band ? [...band.low, ...band.high] : [])].filter((v) => v != null);
  const zero = opts.zero || bars || stacks;
  let lo = zero ? 0 : Math.min(...all), hi = Math.max(...all, zero ? 1 : -Infinity);
  if (!all.length) { lo = 0; hi = 1; }
  if (!zero) { const pad = (hi - lo || 1) * 0.12; lo -= pad; hi += pad; }
  const ticks = niceTicks(lo, hi);
  lo = Math.min(lo, ticks[0]); hi = Math.max(hi, ticks.at(-1));

  const draw = () => {
    const W = host.clientWidth || 640;
    host.querySelector('svg')?.remove();
    const svg = s('svg', { width: W, height, viewBox: `0 0 ${W} ${height}`, role: 'img', 'aria-label': opts.title || 'Grafiek' });
    const pw = W - M.l - M.r, ph = height - M.t - M.b, bw = pw / n;
    const x = (i) => M.l + (i + 0.5) * bw;
    const y = (v) => (opts.invert ? M.t + ((v - lo) / (hi - lo)) * ph : M.t + ph - ((v - lo) / (hi - lo)) * ph);

    for (const t of ticks) {
      svg.append(s('line', { x1: M.l, x2: W - M.r, y1: y(t), y2: y(t), class: t === 0 ? 'axis' : 'grid' }));
      const label = s('text', { x: M.l - 8, y: y(t) + 4, class: 'tick', 'text-anchor': 'end' });
      label.textContent = tickFmt(t);
      svg.append(label);
    }
    let lastTickX = -Infinity;
    for (let i = 0; i < n; i++) {
      const text = tick(i);
      if (!text || x(i) - lastTickX < 44) continue;
      const label = s('text', { x: x(i), y: height - 5, class: 'tick', 'text-anchor': 'middle' });
      label.textContent = text;
      svg.append(label);
      lastTickX = x(i);
    }

    if (band) {
      const pts = band.low.map((v, i) => (v == null || band.high[i] == null ? null : i)).filter((i) => i != null);
      if (pts.length > 1) {
        const d = pts.map((i, k) => `${k ? 'L' : 'M'}${x(i)},${y(band.high[i])}`).join('') + pts.reverse().map((i) => `L${x(i)},${y(band.low[i])}`).join('') + 'z';
        svg.append(s('path', { d, class: 'band' }));
      }
    }

    const w = Math.max(2, Math.min(24, bw - 2));
    if (bars) bars.values.forEach((v, i) => { if (v > 0) svg.append(column(x(i) - w / 2, y(v), w, y(0) - y(v), bars.color)); });
    if (stacks) stacks.rows.forEach((row, i) => {
      let base = 0;
      const present = stacks.keys.filter((k) => row[k.key] > 0);
      present.forEach((k, j) => {
        const top = y(base + row[k.key]), bottom = y(base) - (j ? 2 : 0);
        if (bottom - top > 0.5) svg.append(column(x(i) - w / 2, top, w, bottom - top, k.color, j === present.length - 1));
        base += row[k.key];
      });
    });

    for (const line of lines) {
      let d = '', pen = false, end = null;
      line.values.forEach((v, i) => {
        if (v == null) { pen = false; return; }
        d += `${pen ? 'L' : 'M'}${x(i)},${y(v)}`;
        pen = true; end = i;
      });
      svg.append(s('path', { d, fill: 'none', stroke: line.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      if (end != null) svg.append(s('circle', { cx: x(end), cy: y(line.values[end]), r: 4, fill: line.color, class: 'dot' }));
    }

    const cross = s('line', { y1: M.t, y2: M.t + ph, class: 'cross', visibility: 'hidden' });
    svg.append(cross);
    svg.onpointermove = (e) => {
      const box = svg.getBoundingClientRect();
      const i = Math.max(0, Math.min(n - 1, Math.floor((e.clientX - box.left - M.l) / bw)));
      const rows = [];
      if (bars && bars.values[i] != null) rows.push([bars.color, bars.label, fmt(bars.values[i])]);
      if (stacks) for (const k of [...stacks.keys].reverse()) if (stacks.rows[i][k.key] > 0) rows.push([k.color, k.label, fmt(stacks.rows[i][k.key])]);
      for (const l of lines) if (l.values[i] != null) rows.push([l.color, l.label, fmt(l.values[i])]);
      if (band && band.low[i] != null) rows.push([null, band.label, `${fmt(band.low[i])} – ${fmt(band.high[i])}`]);
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
      tip.replaceChildren(h('div', { className: 'tip-title', textContent: labels[i] }),
        ...(rows.length ? rows : [[null, 'Geen meting', '']]).map(([color, label, value]) => h('div', { className: 'tip-row' },
          color ? h('i', { style: `background:${color}` }) : null, h('span', { textContent: label || '' }), h('b', { textContent: value }))));
      tip.hidden = false;
      const left = x(i) + 12 + tip.offsetWidth > W ? x(i) - 12 - tip.offsetWidth : x(i) + 12;
      tip.style.left = `${Math.max(0, left)}px`;
    };
    svg.onpointerleave = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); };
    host.prepend(svg);
  };

  host.append(tip);
  const legend = [...(stacks?.keys || []), ...(lines.length + (bars ? 1 : 0) + (band ? 1 : 0) > 1 ? [...(bars ? [bars] : []), ...lines, ...(band ? [{ label: band.label, band: true }] : [])] : [])];
  if (legend.length) {
    host.append(h('div', { className: 'legend' }, ...legend.map((k) => h('span', {}, h('i', k.band ? { className: 'band-key' } : { style: `background:${k.color}` }), k.label))));
  }
  new ResizeObserver(draw).observe(host);
  return host;
}

// Trendlijntje voor in een tegel: de reeks in grijs, het laatste punt in kleur.
export function sparkline(values, color, width = 64, height = 26) {
  const v = values.filter((x) => x != null);
  const svg = s('svg', { width, height, viewBox: `0 0 ${width} ${height}`, class: 'spark', 'aria-hidden': 'true' });
  if (v.length < 2) return svg;
  const lo = Math.min(...v), hi = Math.max(...v);
  const x = (i) => 4 + (i / (values.length - 1)) * (width - 8);
  const y = (val) => height - 4 - ((val - lo) / (hi - lo || 1)) * (height - 8);
  let d = '', pen = false, end = 0;
  values.forEach((val, i) => {
    if (val == null) return;
    d += `${pen ? 'L' : 'M'}${x(i)},${y(val)}`;
    pen = true; end = i;
  });
  svg.append(s('path', { d, class: 'spark-line' }), s('circle', { cx: x(end), cy: y(values[end]), r: 3.5, fill: color, class: 'dot' }));
  return svg;
}

// Ringen zoals in Apple Gezondheid: elke ring vult zich tot het doel bereikt is. `items`: [{ frac, color }], buitenste eerst.
export function rings(items, size = 150, stroke = 15) {
  const svg = s('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, class: 'rings', role: 'img' });
  items.forEach((it, i) => {
    const r = size / 2 - stroke / 2 - i * (stroke + 3), c = 2 * Math.PI * r;
    const frac = Math.max(0, Math.min(1, it.frac || 0));
    const common = { cx: size / 2, cy: size / 2, r, fill: 'none', 'stroke-width': stroke };
    svg.append(s('circle', { ...common, stroke: it.color, opacity: 0.18 }));
    if (frac > 0) svg.append(s('circle', { ...common, stroke: it.color, 'stroke-linecap': 'round', 'stroke-dasharray': `${Math.max(0.01, frac * c)} ${c}`, transform: `rotate(-90 ${size / 2} ${size / 2})` }));
  });
  return svg;
}

// Cirkeldiagram met een gat: aandelen van een geheel. `parts`: [{ value, color, label }]. In het midden staat `center`.
export function donut(parts, center, size = 132, stroke = 20) {
  const total = parts.reduce((t, p) => t + p.value, 0);
  const r = size / 2 - stroke / 2, c = 2 * Math.PI * r;
  const svg = s('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, class: 'donut', role: 'img' });
  svg.append(s('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', stroke: '#e5e5ea', 'stroke-width': stroke }));
  let offset = 0;
  for (const p of parts.filter((x) => x.value > 0)) {
    const len = p.value / total * c;
    const arc = s('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', stroke: p.color, 'stroke-width': stroke, 'stroke-dasharray': `${Math.max(0.01, len - 2)} ${c}`, 'stroke-dashoffset': -offset, transform: `rotate(-90 ${size / 2} ${size / 2})` });
    const title = s('title'); title.textContent = `${p.label}: ${Math.round(p.value / total * 100)}%`;
    arc.append(title);
    svg.append(arc);
    offset += len;
  }
  const wrap = h('div', { className: 'donut-wrap', style: `width:${size}px;height:${size}px` }, svg, h('div', { className: 'donut-center' }, ...[].concat(center)));
  return wrap;
}
