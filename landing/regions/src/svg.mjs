// Inline SVG illustration library. Everything is self-contained — no external
// images, so every page prints and archives identically offline.

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// deterministic PRNG so rebuilds are byte-identical
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/* ---------- decorative ---------- */

export function mesh({ w = 1120, h = 560, seed = 7, dots = 46, stroke = '#ffffff', op = 0.18 } = {}) {
  const r = rng(seed);
  const pts = Array.from({ length: dots }, () => [+(r() * w).toFixed(1), +(r() * h).toFixed(1)]);
  let lines = '';
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[i][0] - pts[j][0], dy = pts[i][1] - pts[j][1];
      const d = Math.hypot(dx, dy);
      if (d < 170) lines += `<line x1="${pts[i][0]}" y1="${pts[i][1]}" x2="${pts[j][0]}" y2="${pts[j][1]}" stroke="${stroke}" stroke-width="${(1 - d / 170).toFixed(2)}" opacity="${((1 - d / 170) * op).toFixed(3)}"/>`;
    }
  }
  const nodes = pts.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${(1.4 + (i % 4) * 0.9).toFixed(1)}" fill="${stroke}" opacity="${(op * 2.4).toFixed(2)}"/>`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${lines}${nodes}</svg>`;
}

export function contour({ w = 400, h = 400, seed = 3, color = '#000', op = 0.07, rings = 9 } = {}) {
  const r = rng(seed);
  let out = '';
  for (let i = 0; i < rings; i++) {
    const rad = 30 + i * ((w / 2 - 30) / rings);
    const pts = [];
    for (let a = 0; a < 360; a += 12) {
      const j = 1 + (r() - 0.5) * 0.16;
      pts.push([w / 2 + Math.cos(a * Math.PI / 180) * rad * j, h / 2 + Math.sin(a * Math.PI / 180) * rad * j * 0.86]);
    }
    out += `<polygon points="${pts.map(p => p.map(n => n.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="${color}" stroke-width="1" opacity="${op}"/>`;
  }
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="100%" aria-hidden="true">${out}</svg>`;
}

/* ---------- icons (24px grid, stroke-based) ---------- */

const I = {
  cpu: '<rect x="7" y="7" width="10" height="10" rx="1.5"/><rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M9 1.5v2M15 1.5v2M9 20.5v2M15 20.5v2M1.5 9h2M1.5 15h2M20.5 9h2M20.5 15h2"/>',
  people: '<circle cx="9" cy="8" r="3.4"/><path d="M2.5 20.5c0-3.6 2.9-6.1 6.5-6.1s6.5 2.5 6.5 6.1"/><circle cx="17.5" cy="9" r="2.6"/><path d="M17 14.6c2.6.2 4.5 2.4 4.5 5.4"/>',
  school: '<path d="M12 3 1.8 8 12 13l10.2-5z"/><path d="M5.5 10.4v6.1c0 1.9 2.9 3.4 6.5 3.4s6.5-1.5 6.5-3.4v-6.1"/><path d="M21.4 8.7v6"/>',
  gamepad: '<rect x="2" y="7" width="20" height="11" rx="4.5"/><path d="M7 10.5v4M5 12.5h4M15.5 11.5h.01M18 14h.01"/>',
  coin: '<ellipse cx="12" cy="6.5" rx="8.5" ry="3.5"/><path d="M3.5 6.5v11c0 1.9 3.8 3.5 8.5 3.5s8.5-1.6 8.5-3.5v-11"/><path d="M3.5 12c0 1.9 3.8 3.5 8.5 3.5s8.5-1.6 8.5-3.5"/>',
  bolt: '<path d="M13.5 2 4 13.5h6.5L10 22l9.5-11.5H13z"/>',
  globe: '<circle cx="12" cy="12" r="9.2"/><path d="M2.8 12h18.4M12 2.8c2.6 2.6 4 5.8 4 9.2s-1.4 6.6-4 9.2c-2.6-2.6-4-5.8-4-9.2s1.4-6.6 4-9.2z"/>',
  shield: '<path d="M12 2.2 4 5.4v6c0 5 3.4 9.1 8 10.4 4.6-1.3 8-5.4 8-10.4v-6z"/><path d="m8.6 12 2.4 2.4 4.4-4.6"/>',
  bank: '<path d="M2.6 9 12 3.4 21.4 9z"/><path d="M5 9v8M10 9v8M14 9v8M19 9v8M2.6 20.6h18.8"/>',
  clock: '<circle cx="12" cy="12" r="9.2"/><path d="M12 6.6V12l3.8 2.4"/>',
  arrow: '<path d="M3.5 12h17M14 5.5l6.5 6.5-6.5 6.5"/>',
  chart: '<path d="M3.2 20.8h17.6M6.5 17V10M11 17V4.5M15.5 17v-4M20 17V8"/>',
  wallet: '<rect x="2.5" y="5.5" width="19" height="14" rx="3"/><path d="M2.5 10h19"/><circle cx="17" cy="14.8" r="1.3"/>',
  spark: '<path d="M12 2.5 14 9l6.5 2-6.5 2-2 6.5L10 13l-6.5-2L10 9z"/>',
};

export function icon(name, { size = 26, color = 'currentColor', w = 1.6 } = {}) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[name] || I.spark}</svg>`;
}

/* ---------- the corridor diagram ---------- */
// USD/EUR capital -> licensed local entity -> local stablecoin -> community payout

export function corridor(c, L, { a = '#0f7361', a2 = '#5fd0b6', dark = false } = {}) {
  const ink = dark ? '#fff' : '#0b0b0c';
  const mut = dark ? '#9b9bab' : '#6b6b76';
  const line = dark ? '#33333f' : '#dcdce4';
  const boxes = [
    { x: 10, t: L.corr1t, s: L.corr1s, ic: 'bank' },
    { x: 268, t: L.corr2t, s: L.corr2s, ic: 'globe' },
    { x: 526, t: L.corr3t, s: L.corr3s, ic: 'coin' },
    { x: 784, t: L.corr4t, s: L.corr4s, ic: 'people' },
  ];
  const boxW = 226, boxH = 108, y = 40;
  let out = '';
  boxes.forEach((b, i) => {
    const hub = i === 1, local = i === 2;
    const fill = hub ? a : local ? (dark ? '#17171c' : '#fff') : (dark ? '#17171c' : '#fff');
    const stk = hub ? a : local ? a2 : line;
    const tc = hub ? '#fff' : ink;
    out += `<g>
      <rect x="${b.x}" y="${y}" width="${boxW}" height="${boxH}" rx="8" fill="${fill}" stroke="${stk}" stroke-width="${hub || local ? 2 : 1.2}"/>
      <g transform="translate(${b.x + 20},${y + 18})" stroke="${hub ? '#fff' : a}" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${I[b.ic]}</g>
      <text x="${b.x + 20}" y="${y + 66}" font-family="Inter,sans-serif" font-size="16.5" font-weight="800" fill="${tc}" letter-spacing="-.3">${esc(b.t)}</text>
      <text x="${b.x + 20}" y="${y + 88}" font-family="Inter,sans-serif" font-size="10.5" font-weight="400" fill="${hub ? 'rgba(255,255,255,.82)' : mut}">${esc(b.s)}</text>
    </g>`;
    if (i < 3) {
      const ax = b.x + boxW + 6, mid = y + boxH / 2;
      out += `<path d="M${ax} ${mid} H${ax + 20}" stroke="${a}" stroke-width="2.2" marker-end="url(#ah)"/>`;
    }
  });
  // return path
  out += `<path d="M896 ${y + boxH + 22} V${y + boxH + 40} H124 V${y + boxH + 22}" fill="none" stroke="${line}" stroke-width="1.6" stroke-dasharray="6 5" marker-end="url(#ah2)"/>
  <text x="510" y="${y + boxH + 57}" text-anchor="middle" font-family="Inter,sans-serif" font-size="11" fill="${mut}">${esc(L.corrBack)}</text>`;

  return `<svg viewBox="0 0 1020 250" width="100%" role="img" aria-label="${esc(L.corrAria)}">
    <defs>
      <marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 10 5 0 10z" fill="${a}"/></marker>
      <marker id="ah2" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 10 5 0 10z" fill="${line}"/></marker>
    </defs>
    <text x="10" y="20" font-family="Inter,sans-serif" font-size="10" font-weight="700" letter-spacing="2.2" fill="${mut}">${esc(L.corrTitle)}</text>
    ${out}</svg>`;
}

/* ---------- charts ---------- */

export function bars(items, { a = '#0f7361', dark = false, unit = '', h = 250, w = 1020, label = '' } = {}) {
  const ink = dark ? '#fff' : '#0b0b0c', mut = dark ? '#9b9bab' : '#6b6b76';
  const max = Math.max(...items.map(i => i.v));
  const base = h - 46, top = 30;
  const bw = Math.min(120, (w - 40) / items.length - 26);
  const gap = (w - 20 - bw * items.length) / (items.length - 1 || 1);
  let out = '';
  items.forEach((it, i) => {
    const x = 10 + i * (bw + gap);
    const bh = Math.max(3, (it.v / max) * (base - top));
    const strong = it.strong ?? (i === items.length - 1);
    out += `<rect x="${x.toFixed(1)}" y="${(base - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="${strong ? a : (dark ? '#33333f' : '#d9d9e2')}"/>
    <text x="${(x + bw / 2).toFixed(1)}" y="${(base - bh - 11).toFixed(1)}" text-anchor="middle" font-family="Inter,sans-serif" font-size="17" font-weight="800" fill="${strong ? a : ink}">${esc(it.t)}</text>
    <text x="${(x + bw / 2).toFixed(1)}" y="${base + 20}" text-anchor="middle" font-family="Inter,sans-serif" font-size="11" fill="${mut}">${esc(it.l)}</text>`;
  });
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="${esc(label || 'bar chart')}">
    <line x1="10" y1="${base}" x2="${w - 10}" y2="${base}" stroke="${dark ? '#33333f' : '#dcdce4'}" stroke-width="1.2"/>
    ${unit ? `<text x="${w - 10}" y="18" text-anchor="end" font-family="Inter,sans-serif" font-size="10" letter-spacing="1.6" fill="${mut}">${esc(unit)}</text>` : ''}
    ${out}</svg>`;
}

export function hbars(items, { a = '#0f7361', a2 = '#c9c9d4', w = 1020, label = '' } = {}) {
  const max = Math.max(...items.map(i => i.v));
  const rowH = 46, labelW = 210, valW = 110;
  const trackW = w - labelW - valW - 20;
  let out = '';
  items.forEach((it, i) => {
    const y = i * rowH + 8;
    const bw = Math.max(4, (it.v / max) * trackW);
    out += `<text x="0" y="${y + 22}" font-family="Inter,sans-serif" font-size="12.5" font-weight="600" fill="#26262b">${esc(it.l)}</text>
    <rect x="${labelW}" y="${y + 6}" width="${bw.toFixed(1)}" height="22" rx="3" fill="${it.strong ? a : a2}"/>
    <text x="${(labelW + bw + 12).toFixed(1)}" y="${y + 23}" font-family="Inter,sans-serif" font-size="14" font-weight="800" fill="${it.strong ? a : '#26262b'}">${esc(it.t)}</text>`;
  });
  return `<svg viewBox="0 0 ${w} ${items.length * rowH + 14}" width="100%" role="img" aria-label="${esc(label || 'comparison')}">${out}</svg>`;
}

export function donut(pct, { a = '#0f7361', track = '#e4e4ec', size = 210, big = '', small = '' } = {}) {
  const r = 78, cx = size / 2, cy = size / 2, C = 2 * Math.PI * r;
  return `<svg viewBox="0 0 ${size} ${size}" width="100%" role="img" aria-label="${esc(big + ' ' + small)}">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${track}" stroke-width="20"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${a}" stroke-width="20" stroke-linecap="butt"
      stroke-dasharray="${(C * pct).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>
    <text x="${cx}" y="${cy + 4}" text-anchor="middle" font-family="Inter,sans-serif" font-size="34" font-weight="800" fill="#0b0b0c">${esc(big)}</text>
    <text x="${cx}" y="${cy + 26}" text-anchor="middle" font-family="Inter,sans-serif" font-size="11" fill="#6b6b76">${esc(small)}</text>
  </svg>`;
}

// A 24-hour ring: which hours a club/lab machine is actually playing vs idle.
export function dayRing(busyHours, { a = '#5b2bd9', idle = '#e4e4ec', size = 230, centreTop = '', centreBot = '' } = {}) {
  const cx = size / 2, cy = size / 2, r = 82;
  let out = '';
  for (let hh = 0; hh < 24; hh++) {
    const a0 = (hh / 24) * 360 - 90, a1 = ((hh + 0.86) / 24) * 360 - 90;
    const p = ang => [cx + Math.cos(ang * Math.PI / 180) * r, cy + Math.sin(ang * Math.PI / 180) * r];
    const [x0, y0] = p(a0), [x1, y1] = p(a1);
    const busy = busyHours.includes(hh);
    out += `<path d="M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}" fill="none" stroke="${busy ? a : idle}" stroke-width="17" stroke-linecap="butt"/>`;
  }
  return `<svg viewBox="0 0 ${size} ${size}" width="100%" role="img" aria-label="${esc(centreTop + ' ' + centreBot)}">
    ${out}
    <text x="${cx}" y="${cy - 2}" text-anchor="middle" font-family="Inter,sans-serif" font-size="32" font-weight="800" fill="#0b0b0c">${esc(centreTop)}</text>
    <text x="${cx}" y="${cy + 20}" text-anchor="middle" font-family="Inter,sans-serif" font-size="10.5" fill="#6b6b76">${esc(centreBot)}</text>
  </svg>`;
}

// Grid of machine tiles; `lit` of them highlighted.
export function rigGrid(total, lit, { a = '#b8560f', cols = 12, size = 26, gap = 5, dark = false } = {}) {
  const rows = Math.ceil(total / cols);
  let out = '';
  for (let i = 0; i < total; i++) {
    const x = (i % cols) * (size + gap), y = Math.floor(i / cols) * (size + gap);
    const on = i < lit;
    out += `<g transform="translate(${x},${y})">
      <rect width="${size}" height="${size * 0.72}" rx="2.5" fill="${on ? a : (dark ? '#26262b' : '#e9e9f0')}"/>
      <rect x="3" y="${size * 0.72 - 5}" width="${size - 6}" height="2" rx="1" fill="${on ? 'rgba(255,255,255,.55)' : (dark ? '#3a3a46' : '#cfcfda')}"/>
      <circle cx="${size - 5}" cy="4.5" r="1.8" fill="${on ? '#fff' : (dark ? '#3a3a46' : '#cfcfda')}"/>
    </g>`;
  }
  return `<svg viewBox="0 0 ${cols * (size + gap) - gap} ${rows * (size + gap) - gap}" width="100%" role="img" aria-label="${lit} of ${total} machines contributing">${out}</svg>`;
}

// Horizontal payback / milestone rail.
export function timeline(steps, { a = '#0f7361', w = 1020 } = {}) {
  const y = 46, seg = (w - 40) / (steps.length - 1 || 1);
  let out = `<line x1="20" y1="${y}" x2="${w - 20}" y2="${y}" stroke="#dcdce4" stroke-width="2"/>`;
  steps.forEach((s, i) => {
    const x = 20 + i * seg;
    out += `<circle cx="${x.toFixed(1)}" cy="${y}" r="${s.hi ? 11 : 8}" fill="${s.hi ? a : '#fff'}" stroke="${a}" stroke-width="2.4"/>
    <text x="${x.toFixed(1)}" y="24" text-anchor="${i === 0 ? 'start' : i === steps.length - 1 ? 'end' : 'middle'}" font-family="Inter,sans-serif" font-size="10" font-weight="700" letter-spacing="1.6" fill="${a}">${esc(s.k)}</text>
    <text x="${x.toFixed(1)}" y="${y + 30}" text-anchor="${i === 0 ? 'start' : i === steps.length - 1 ? 'end' : 'middle'}" font-family="Inter,sans-serif" font-size="12.5" font-weight="600" fill="#26262b">${esc(s.t)}</text>
    ${s.s ? `<text x="${x.toFixed(1)}" y="${y + 48}" text-anchor="${i === 0 ? 'start' : i === steps.length - 1 ? 'end' : 'middle'}" font-family="Inter,sans-serif" font-size="10.5" fill="#6b6b76">${esc(s.s)}</text>` : ''}`;
  });
  return `<svg viewBox="0 0 ${w} 108" width="100%" role="img" aria-label="timeline">${out}</svg>`;
}

// Stacked value-flow: what one unit of buyer spend becomes.
export function splitBar(parts, { w = 1020, h = 84 } = {}) {
  const total = parts.reduce((s, p) => s + p.v, 0);
  let x = 0, out = '';
  parts.forEach(p => {
    const pw = (p.v / total) * w;
    out += `<rect x="${x.toFixed(1)}" y="0" width="${pw.toFixed(1)}" height="40" fill="${p.c}"/>
    <text x="${(x + 10).toFixed(1)}" y="26" font-family="Inter,sans-serif" font-size="14" font-weight="800" fill="${p.dark ? '#0b0b0c' : '#fff'}">${esc(p.t)}</text>
    <text x="${(x).toFixed(1)}" y="60" font-family="Inter,sans-serif" font-size="11" font-weight="600" fill="#26262b">${esc(p.l)}</text>
    <text x="${(x).toFixed(1)}" y="76" font-family="Inter,sans-serif" font-size="10" fill="#6b6b76">${esc(p.s || '')}</text>`;
    x += pw;
  });
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="value split">${out}</svg>`;
}

// ---- pricing charts ----------------------------------------------------

// Per-country stacked bar: cost to produce 1M tokens → provider margin → our
// margin, summing to the sell price. Shows where each cent of the token price
// goes, and how the cost slice tracks electricity across countries.
export function priceStack(rows, { a = '#0f7361', a2 = '#5fd0b6', w = 1020, h = 300, unit = '$ / million tokens', dark = false, labels = {} } = {}) {
  const ink = dark ? '#fff' : '#0b0b0c', mut = dark ? '#9b9bab' : '#6b6b76', line = dark ? '#33333f' : '#dcdce4';
  const max = 0.20;                                    // fixed axis = published ceiling
  const base = h - 46, top = 24;
  const n = rows.length, bw = Math.min(96, (w - 60) / n - 26);
  const gap = (w - 40 - bw * n) / (n - 1 || 1);
  const y = v => base - (v / max) * (base - top);
  const seg = [['cost', a], ['prov', dark ? '#3a5f57' : '#bfe4da'], ['ours', a2]];
  let out = '';
  // gridlines at 0.05,0.10,0.15,0.20
  [0.05, 0.10, 0.15, 0.20].forEach(g => {
    out += `<line x1="40" y1="${y(g).toFixed(1)}" x2="${w - 10}" y2="${y(g).toFixed(1)}" stroke="${line}" stroke-width=".6"/>
    <text x="34" y="${(y(g) + 3).toFixed(1)}" text-anchor="end" font-family="Inter,sans-serif" font-size="9.5" fill="${mut}">$${g.toFixed(2)}</text>`;
  });
  rows.forEach((r, i) => {
    const x = 40 + i * (bw + gap);
    let yc = base;
    [r.cost, r.prov, r.ours].forEach((v, k) => {
      const hgt = (v / max) * (base - top);
      out += `<rect x="${x.toFixed(1)}" y="${(yc - hgt).toFixed(1)}" width="${bw.toFixed(1)}" height="${hgt.toFixed(1)}" fill="${seg[k][1]}"/>`;
      yc -= hgt;
    });
    const sell = r.cost + r.prov + r.ours;
    out += `<text x="${(x + bw / 2).toFixed(1)}" y="${(y(sell) - 8).toFixed(1)}" text-anchor="middle" font-family="Inter,sans-serif" font-size="13" font-weight="800" fill="${ink}">$${sell.toFixed(2)}</text>
    <text x="${(x + bw / 2).toFixed(1)}" y="${base + 20}" text-anchor="middle" font-family="Inter,sans-serif" font-size="11" font-weight="600" fill="${ink}">${esc(r.label)}</text>
    <text x="${(x + bw / 2).toFixed(1)}" y="${base + 34}" text-anchor="middle" font-family="Inter,sans-serif" font-size="9" fill="${mut}">${esc(r.sub || '')}</text>`;
  });
  const leg = [[labels.cost || 'Compute cost', seg[0][1]], [labels.prov || 'Provider margin', seg[1][1]], [labels.ours || 'Our margin', seg[2][1]]];
  let lx = 40;
  const legend = leg.map(([t, c]) => { const s = `<rect x="${lx}" y="${h - 12}" width="12" height="10" fill="${c}"/><text x="${lx + 17}" y="${h - 3}" font-family="Inter,sans-serif" font-size="9.5" fill="${mut}">${esc(t)}</text>`; lx += 30 + t.length * 6.6; return s; }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="${esc(unit)}">
    <text x="${w - 10}" y="14" text-anchor="end" font-family="Inter,sans-serif" font-size="9.5" letter-spacing="1.2" fill="${mut}">${esc(unit)}</text>
    <line x1="40" y1="${base}" x2="${w - 10}" y2="${base}" stroke="${ink}" stroke-width="1"/>${out}${legend}</svg>`;
}

// Three go-to-market scenarios side by side: pay price vs sell price, the spread
// between them, and how much of a first batch that recovers in one pass.
export function scenarioChart(cols, { a = '#0f7361', a2 = '#5fd0b6', w = 1020, h = 320, dark = false, payLabel = 'We pay', sellLabel = 'We sell', recLabel = 'First-batch recovery' } = {}) {
  const ink = dark ? '#fff' : '#0b0b0c', mut = dark ? '#9b9bab' : '#6b6b76', line = dark ? '#33333f' : '#dcdce4';
  const max = 0.22, base = h - 96, top = 26;
  const n = cols.length, colW = (w - 20) / n;
  const bw = 46, y = v => base - (v / max) * (base - top);
  let out = '';
  [0.05, 0.10, 0.15, 0.20].forEach(g => {
    out += `<line x1="30" y1="${y(g).toFixed(1)}" x2="${w - 10}" y2="${y(g).toFixed(1)}" stroke="${line}" stroke-width=".6"/>
    <text x="26" y="${(y(g) + 3).toFixed(1)}" text-anchor="end" font-family="Inter,sans-serif" font-size="9" fill="${mut}">$${g.toFixed(2)}</text>`;
  });
  cols.forEach((col, i) => {
    const cx = 30 + i * ((w - 40) / n) + ((w - 40) / n) / 2;
    const px = cx - bw - 6, sx = cx + 6;
    // spread ribbon
    out += `<rect x="${px}" y="${y(col.sell).toFixed(1)}" width="${bw * 2 + 12}" height="${(y(col.pay) - y(col.sell)).toFixed(1)}" fill="${a2}" opacity=".18"/>`;
    // pay bar
    out += `<rect x="${px}" y="${y(col.pay).toFixed(1)}" width="${bw}" height="${(base - y(col.pay)).toFixed(1)}" fill="${dark ? '#3a5f57' : '#bfe4da'}"/>
    <text x="${(px + bw / 2).toFixed(1)}" y="${(y(col.pay) - 6).toFixed(1)}" text-anchor="middle" font-family="Inter,sans-serif" font-size="11" font-weight="800" fill="${ink}">$${col.pay.toFixed(2)}</text>`;
    // sell bar
    out += `<rect x="${sx}" y="${y(col.sell).toFixed(1)}" width="${bw}" height="${(base - y(col.sell)).toFixed(1)}" fill="${a}"/>
    <text x="${(sx + bw / 2).toFixed(1)}" y="${(y(col.sell) - 6).toFixed(1)}" text-anchor="middle" font-family="Inter,sans-serif" font-size="11" font-weight="800" fill="${a}">$${col.sell.toFixed(2)}</text>`;
    // title + recovery block
    out += `<text x="${cx.toFixed(1)}" y="${base + 22}" text-anchor="middle" font-family="Inter,sans-serif" font-size="12" font-weight="700" fill="${ink}">${esc(col.label)}</text>
    <text x="${cx.toFixed(1)}" y="${base + 40}" text-anchor="middle" font-family="Inter,sans-serif" font-size="9.5" fill="${mut}">${esc(col.sub || '')}</text>
    <text x="${cx.toFixed(1)}" y="${base + 68}" text-anchor="middle" font-family="Inter,sans-serif" font-size="24" font-weight="800" fill="${col.rec >= 1 ? a : (dark ? '#d98b5f' : '#b8560f')}">${Math.round(col.rec * 100)}%</text>
    <text x="${cx.toFixed(1)}" y="${base + 84}" text-anchor="middle" font-family="Inter,sans-serif" font-size="8.5" letter-spacing="1.2" fill="${mut}">${esc(col.speed || '')}</text>`;
  });
  // legend
  out += `<rect x="30" y="6" width="12" height="10" fill="${dark ? '#3a5f57' : '#bfe4da'}"/><text x="47" y="15" font-family="Inter,sans-serif" font-size="9.5" fill="${mut}">${esc(payLabel)}</text>
  <rect x="${30 + 30 + payLabel.length * 6.2}" y="6" width="12" height="10" fill="${a}"/><text x="${47 + 30 + payLabel.length * 6.2}" y="15" font-family="Inter,sans-serif" font-size="9.5" fill="${mut}">${esc(sellLabel)}</text>
  <text x="${w - 10}" y="15" text-anchor="end" font-family="Inter,sans-serif" font-size="9" letter-spacing="1.1" fill="${mut}">${esc(recLabel)} · $/M</text>`;
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="scenarios">${out}<line x1="30" y1="${base}" x2="${w - 10}" y2="${base}" stroke="${ink}" stroke-width="1"/></svg>`;
}

// Batch ladder: issuer share of client fiat falling across successive mints,
// bars widening as batch size grows.
export function batchLadder(batches, { a = '#0f7361', a2 = '#5fd0b6', w = 1020, rowH = 48, dark = false, issuerLabel = 'to issuer', ecoLabel = 'to ecosystem' } = {}) {
  const ink = dark ? '#fff' : '#0b0b0c', mut = dark ? '#9b9bab' : '#6b6b76';
  const labelW = 96, valW = 120, trackW = w - labelW - valW - 20;
  let out = '';
  const maxSize = Math.max(...batches.map(b => b.size));
  batches.forEach((b, i) => {
    const y = i * rowH + 6;
    const bwF = (b.size / maxSize) * trackW;
    const iw = bwF * b.issuer;
    out += `<text x="0" y="${y + 22}" font-family="Inter,sans-serif" font-size="12" font-weight="700" fill="${ink}">${esc(b.label)}</text>
    <rect x="${labelW}" y="${y + 6}" width="${iw.toFixed(1)}" height="26" fill="${a}"/>
    <rect x="${(labelW + iw).toFixed(1)}" y="${y + 6}" width="${(bwF - iw).toFixed(1)}" height="26" fill="${a2}"/>
    <text x="${(labelW + 8).toFixed(1)}" y="${y + 23}" font-family="Inter,sans-serif" font-size="10.5" font-weight="800" fill="#fff">${Math.round(b.issuer * 100)}</text>
    ${bwF - iw > 26 ? `<text x="${(labelW + iw + 8).toFixed(1)}" y="${y + 23}" font-family="Inter,sans-serif" font-size="10.5" font-weight="800" fill="${dark ? '#0b0b0c' : '#0b0b0c'}">${Math.round(b.eco * 100)}</text>` : ''}
    <text x="${(labelW + bwF + 10).toFixed(1)}" y="${y + 23}" font-family="Inter,sans-serif" font-size="10.5" font-weight="600" fill="${mut}">${esc(b.size_l)}</text>`;
  });
  out += `<rect x="0" y="${batches.length * rowH + 8}" width="12" height="10" fill="${a}"/><text x="17" y="${batches.length * rowH + 17}" font-family="Inter,sans-serif" font-size="9.5" fill="${mut}">${esc(issuerLabel)}</text>
  <rect x="${30 + issuerLabel.length * 6.2}" y="${batches.length * rowH + 8}" width="12" height="10" fill="${a2}"/><text x="${47 + issuerLabel.length * 6.2}" y="${batches.length * rowH + 17}" font-family="Inter,sans-serif" font-size="9.5" fill="${mut}">${esc(ecoLabel)}</text>`;
  return `<svg viewBox="0 0 ${w} ${batches.length * rowH + 26}" width="100%" role="img" aria-label="batch splits">${out}</svg>`;
}

export { esc };
