// Four 16:9 slide decks per country: stablecoin, gaming, hardware, schools.
// Low text, one idea per slide, figures and inline SVG carry the meaning.

import { deckCSS, FONTS_DECK, ACCENTS } from './styles.mjs';
import { mesh, contour, icon, corridor, bars, hbars, donut, dayRing, rigGrid, timeline, splitBar, priceStack, scenarioChart, batchLadder } from './svg.mjs';
import { priceStackRows, scenarioRows, batchRows } from './strings.mjs';

/* ---------- slide harness ---------- */

function shell({ title, accent, accent2, slides, footL, footR }) {
  const n = slides.length;
  return `<!DOCTYPE html>
<html lang="${footL.lang || 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
${FONTS_DECK}
<style>${deckCSS(accent, accent2)}</style>
</head>
<body>
${slides.map((s, i) => s.replace('%%PG%%', `${i + 1} / ${n}`)).join('\n')}
</body>
</html>`;
}

const S = (inner, { cls = '', bar = true, split = false, foot = '', track = '' } = {}) => `
<section class="slide ${cls}">
  ${bar ? `<div class="bar${split ? ' split' : ''}"></div>` : ''}
  ${inner}
  <div class="foot"><span>${track}</span><span>${foot}</span><span>%%PG%%</span></div>
</section>`;

const eyebrow = k => `<p class="eyebrow">${k}</p>`;
const cards = (list, cols = 3, cls = '') =>
  `<div class="cards" style="grid-template-columns:repeat(${cols},1fr)">${list.map(([h, p], i) =>
    `<div class="card ${cls}">${i === 0 ? '' : ''}<h3>${h}</h3><p>${p}</p></div>`).join('')}</div>`;

const iconCards = (list, ic, accent, cols = 3) =>
  `<div class="cards" style="grid-template-columns:repeat(${cols},1fr)">${list.map(([h, p], i) =>
    `<div class="card"><div class="ic" style="color:${accent}">${icon(ic[i] || 'spark', { size: 28, color: accent })}</div><h3>${h}</h3><p>${p}</p></div>`).join('')}</div>`;

const strip = list => `<div class="strip">${list.map(([n, l]) =>
  `<div><div class="n">${n}</div><div class="l">${l}</div></div>`).join('')}</div>`;

const steps = (list, a) => `<div style="margin-top:4mm">${timeline(list, { a })}</div>`;

const pills = list => `<div style="margin-top:4mm">${list.map(p => `<span class="pill">${p}</span>`).join('')}</div>`;

const figRow = (list, a) => `<div class="figs" style="grid-template-columns:repeat(${list.length},1fr)">${list.map(([n, l, extra]) =>
  `<div class="fig"><div class="n">${n}</div><div class="r" style="background:${a}"></div><div class="l">${l}${extra ? `<br><span style="color:${a};font-weight:700">${extra}</span>` : ''}</div></div>`).join('')}</div>`;

function cover({ track, h1, sub, a, a2, foot, seed = 5 }) {
  return S(`
  <div style="position:absolute;inset:0;opacity:.9">${mesh({ seed, stroke: a2, op: .22 })}</div>
  <div style="position:relative;flex:1;display:flex;flex-direction:column;justify-content:center">
    ${eyebrow(track)}
    <h1>${h1}</h1>
  </div>`, { cls: 'dark', bar: true, split: true, foot, track });
}

function closer({ k, h, sub, contactK, contactFill, a, foot, track, assumptions }) {
  return S(`
  <div style="position:absolute;right:-40mm;top:-30mm;width:190mm;height:190mm;opacity:.5">${contour({ color: a, op: .16, seed: 11 })}</div>
  <div class="body" style="position:relative">
    ${eyebrow(k)}
    <h2 style="max-width:200mm">${h}</h2>
    <p class="lede" style="margin-top:2mm">${sub}</p>
    <div style="margin-top:12mm;border-top:2px solid ${a};padding-top:5mm;max-width:150mm">
      <div style="font-size:8pt;font-weight:700;letter-spacing:2.4px;text-transform:uppercase;color:${a}">${contactK}</div>
      <div style="font-size:13pt;font-weight:600;margin-top:2mm;color:#26262b">${contactFill}</div>
    </div>
    <p class="small" style="margin-top:9mm;max-width:210mm;font-size:7.6pt;color:#9a9aa5;line-height:1.45">${assumptions}</p>
  </div>`, { foot, track });
}

/* ======================================================================= */

export function deckStablecoin(c, L) {
  const [a, a2] = ACCENTS.stablecoin;
  const d = L.d1, foot = `${c.country} · ${L.date}`, track = d.track;
  const sl = [
    cover({ track, h1: d.cover, sub: d.coverSub, a, a2, foot, seed: 5 }),

    S(`<div class="body">${eyebrow(d.s2k)}<h2>${d.s2h}</h2>
      ${figRow(d.s2fig, a)}</div>`, { foot, track }),

    S(`<div class="body">${eyebrow(d.s3k)}<h2>${d.s3h}</h2>
      <div style="margin-top:6mm">${hbars(d.s3bars, { a, w: 1020 })}</div>
      <p class="small" style="margin-top:5mm;max-width:180mm">${d.s3note}</p></div>`, { cls: 'tint', foot, track }),

    S(`<div class="body top" style="padding-top:2mm">${eyebrow(d.s4k)}<h2 style="margin-bottom:6mm">${d.s4h}</h2>
      ${corridor(c, L, { a, a2 })}</div>`, { foot, track }),

    S(`<div class="body">${eyebrow(d.s5k)}<h2>${d.s5h}</h2>
      ${iconCards(d.s5cards, ['shield', 'globe', 'coin'], a)}</div>`, { foot, track }),

    S(`<div class="body">${eyebrow(d.s6k)}<h2>${d.s6h}</h2>
      <div class="cards" style="grid-template-columns:1fr 1fr">
        <div class="card accent"><div class="ic">${icon('chart', { size: 30, color: '#fff' })}</div>
          <div class="k">${d.s6a[0]}</div><div style="font-size:34pt;font-weight:800;letter-spacing:-1.5px;line-height:1">${d.s6a[1]}</div><p style="margin-top:3mm">${d.s6a[2]}</p></div>
        <div class="card solid"><div class="ic">${icon('cpu', { size: 30, color: a2 })}</div>
          <div class="k">${d.s6b[0]}</div><div style="font-size:34pt;font-weight:800;letter-spacing:-1.5px;line-height:1">${d.s6b[1]}</div><p style="margin-top:3mm">${d.s6b[2]}</p></div>
      </div></div>`, { foot, track }),

    // — stablecoin issuance mechanics —
    S(`<div class="body">${eyebrow(d.dMintK)}<h2>${d.dMintH}</h2>
      <div class="cards" style="grid-template-columns:repeat(4,1fr);margin-top:2mm">
        ${d.dMintSteps.map(([h, t], i) => `<div class="card"><div class="k" style="font-size:15pt;color:${a}">${i + 1}</div><h3>${h}</h3><p>${t}</p></div>`).join('')}
      </div>
      <p class="small" style="margin-top:6mm;max-width:200mm">${d.dMintNote}</p></div>`, { foot, track }),

    S(`<div class="body">${eyebrow(d.dSplitK)}<h2>${d.dSplitH}</h2>
      <div style="margin-top:6mm">${batchLadder(batchRows(d.dSplitSizes), { a, a2, issuerLabel: d.dSplitLabels.issuer, ecoLabel: d.dSplitLabels.eco })}</div>
      <p class="small" style="margin-top:5mm;max-width:205mm">${d.dSplitNote}</p></div>`, { cls: 'tint', foot, track }),

    S(`<div class="body">${eyebrow(d.dFundK)}<h2>${d.dFundH}</h2>
      <div class="cards" style="grid-template-columns:repeat(4,1fr);margin-top:2mm">
        ${d.dFundCards.map(([h, t], i) => `<div class="card"><div class="k" style="font-size:15pt;color:${a}">${i + 1}</div><h3>${h}</h3><p>${t}</p></div>`).join('')}
      </div>
      <p class="small" style="margin-top:6mm;max-width:205mm">${d.dFundNote}</p></div>`, { foot, track }),

    S(`<div class="body">${eyebrow(d.dCostK)}<h2>${d.dCostH}</h2>
      <div style="margin-top:3mm">${priceStack(priceStackRows(), { a, a2, labels: d.dCostLabels, unit: L.lang === 'ru' ? '$ / млн токенов' : '$ / million tokens' })}</div>
      <p class="small" style="margin-top:3mm;max-width:205mm">${d.dCostNote}</p></div>`, { foot, track }),

    S(`<div class="body">${eyebrow(d.dScenK)}<h2>${d.dScenH}</h2>
      <div style="margin-top:1mm">${scenarioChart(scenarioRows(d.dScenLabels), { a, a2, payLabel: L.lang === 'ru' ? 'платим' : 'we pay', sellLabel: L.lang === 'ru' ? 'продаём' : 'we sell', recLabel: L.lang === 'ru' ? 'возврат' : 'recovery' })}</div>
      <p class="small" style="margin-top:2mm;max-width:205mm">${d.dScenNote}</p></div>`, { cls: 'tint', foot, track }),

    S(`<div class="body">${eyebrow(d.s7k)}<h2>${d.s7h}</h2>${strip(d.s7strip)}</div>`, { cls: 'tint', foot, track }),

    S(`<div class="body">${eyebrow(d.s8k)}<h2>${d.s8h}</h2>${pills(d.s8pills)}
      
      </div>`, { foot, track }),

    S(`<div class="body">${eyebrow(d.s9k)}<h2>${d.s9h}</h2>${steps(d.s9steps, a)}</div>`, { foot, track }),

    closer({ k: d.s10k, h: d.s10h, sub: d.s10sub, contactK: L.contactK, contactFill: L.contactFill, a, foot, track, assumptions: L.assumptions }),
  ];
  return shell({ title: `${c.country} — ${d.track}`, accent: a, accent2: a2, slides: sl, footL: L, footR: foot });
}

/* ======================================================================= */

export function deckGaming(c, L) {
  const [a, a2] = ACCENTS.gaming;
  const d = L.d2, foot = `${c.country} · ${L.date}`, track = d.track;
  const busy = [17, 18, 19, 20, 21];   // peak play hours
  const sl = [
    cover({ track, h1: d.cover, sub: d.coverSub, a, a2, foot, seed: 21 }),

    S(`<div class="body"><div style="display:grid;grid-template-columns:1fr 78mm;gap:14mm;align-items:center">
        <div>${eyebrow(d.s2k)}<h2>${d.s2h}</h2>
          <p class="lede" style="margin-top:4mm">${d.s2note}</p>
          <div style="margin-top:6mm;display:flex;gap:8mm;font-size:9pt;color:#6b6b76">
            <span style="display:inline-flex;align-items:center;gap:6px"><i style="width:12px;height:12px;background:${a};display:inline-block;border-radius:2px"></i>${L.lang === 'ru' ? 'игра' : 'play'}</span>
            <span style="display:inline-flex;align-items:center;gap:6px"><i style="width:12px;height:12px;background:#e4e4ec;display:inline-block;border-radius:2px"></i>${L.lang === 'ru' ? 'простой' : 'idle'}</span>
          </div>
        </div>
        <div>${dayRing(busy, { a, centreTop: d.s2ring[0], centreBot: d.s2ring[1] })}</div>
      </div></div>`, { foot, track }),

    S(`<div class="body">${eyebrow(d.s3k)}<h2>${d.s3h}</h2>${iconCards(d.s3cards, ['cpu', 'gamepad', 'bolt'], a)}</div>`, { cls: 'tint', foot, track }),

    S(`<div class="body">${eyebrow(d.s4k)}<h2>${d.s4h}</h2>
      ${figRow(d.s4figs, a)}
      <p class="small" style="margin-top:9mm">${d.s4note}</p></div>`, { foot, track }),

    S(`<div class="body">${eyebrow(d.s5k)}<h2>${d.s5h}</h2>
      <div style="margin-top:5mm">${bars(d.s5bars.map(b => ({ ...b, l: b.l, t: b.t })), { a, w: 1020, h: 230 })}</div>
      <p class="small" style="margin-top:4mm">${d.s5sub}</p></div>`, { foot, track }),

    S(`<div style="position:absolute;inset:0;opacity:1">${mesh({ seed: 33, stroke: a2, op: .14 })}</div>
      <div class="body" style="position:relative">${eyebrow(d.s6k)}<h2>${d.s6h}</h2>
      <p class="sub">${d.s6sub}</p>
      <div style="margin-top:9mm;max-width:210mm">${rigGrid(120, 92, { a, cols: 24, size: 20, gap: 5, dark: true })}</div></div>`,
      { cls: 'dark', foot, track }),

    S(`<div class="body">${eyebrow(d.s7k)}<h2>${d.s7h}</h2>${iconCards(d.s7cards, ['coin', 'clock', 'wallet'], a)}</div>`, { foot, track }),

    S(`<div class="body">${eyebrow(d.s8k)}<h2>${d.s8h}</h2>${steps(d.s8steps, a)}</div>`, { cls: 'tint', foot, track }),

    closer({ k: d.s9k, h: d.s9h, sub: d.s9sub, contactK: L.contactK, contactFill: L.contactFill, a, foot, track, assumptions: L.assumptions }),
  ];
  return shell({ title: `${c.country} — ${d.track}`, accent: a, accent2: a2, slides: sl, footL: L, footR: foot });
}

/* ======================================================================= */

export function deckHardware(c, L) {
  const [a, a2] = ACCENTS.hardware;
  const d = L.d3, foot = `${c.country} · ${L.date}`, track = d.track;
  const sl = [
    cover({ track, h1: d.cover, sub: d.coverSub, a, a2, foot, seed: 42 }),

    S(`<div class="body">${eyebrow(d.s2k)}<h2>${d.s2h}</h2>${strip(d.s2strip)}</div>`, { foot, track }),

    S(`<div class="body">${eyebrow(d.s3k)}<h2>${d.s3h}</h2>
      <div class="cards" style="grid-template-columns:1fr 1fr">
        <div class="card accent"><div class="ic">${icon('coin', { size: 30, color: '#fff' })}</div>
          <div class="k">${d.s3a[0]}</div><div style="font-size:34pt;font-weight:800;letter-spacing:-1.5px;line-height:1">${d.s3a[1]}</div><p style="margin-top:3mm">${d.s3a[2]}</p></div>
        <div class="card solid"><div class="ic">${icon('cpu', { size: 30, color: a2 })}</div>
          <div class="k">${d.s3b[0]}</div><div style="font-size:34pt;font-weight:800;letter-spacing:-1.5px;line-height:1">${d.s3b[1]}</div><p style="margin-top:3mm">${d.s3b[2]}</p></div>
      </div></div>`, { cls: 'tint', foot, track }),

    S(`<div class="body">${eyebrow(d.s4k)}<h2>${d.s4h}</h2>${iconCards(d.s4cards, ['spark', 'cpu', 'people'], a)}</div>`, { foot, track }),

    S(`<div class="body">${eyebrow(d.s5k)}<h2>${d.s5h}</h2>${iconCards(d.s5cards, ['people', 'coin', 'bolt'], a)}</div>`, { foot, track }),

    S(`<div class="body">${eyebrow(d.s6k)}<h2>${d.s6h}</h2>
      <table style="margin-top:4mm"><thead><tr>${d.s6head.map(h => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${d.s6tbl.map((r, i) => `<tr${i === 0 ? ' class="hi"' : ''}>${r.map(v => `<td style="text-align:left">${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`,
      { cls: 'tint', foot, track }),

    S(`<div style="position:absolute;inset:0">${mesh({ seed: 60, stroke: a2, op: .16 })}</div>
      <div class="body" style="position:relative">${eyebrow(d.s7k)}<h2>${d.s7h}</h2>
      ${iconCards(d.s7cards, ['gamepad', 'school', 'spark'], a2)}</div>`, { cls: 'dark', foot, track }),

    closer({ k: d.s8k, h: d.s8h, sub: d.s8sub, contactK: L.contactK, contactFill: L.contactFill, a, foot, track, assumptions: L.assumptions }),
  ];
  return shell({ title: `${c.country} — ${d.track}`, accent: a, accent2: a2, slides: sl, footL: L, footR: foot });
}

/* ======================================================================= */

export function deckSchools(c, L) {
  const [a, a2] = ACCENTS.schools;
  const d = L.d4, foot = `${c.country} · ${L.date}`, track = d.track;
  const sl = [
    cover({ track, h1: d.cover, sub: d.coverSub, a, a2, foot, seed: 77 }),

    S(`<div class="body">${eyebrow(d.s2k)}<h2>${d.s2h}</h2>
      <div class="cards" style="grid-template-columns:1fr 1fr">
        <div class="card solid"><div class="ic">${icon('cpu', { size: 30, color: a2 })}</div>
          <div class="k">${d.s2a[0]}</div><div style="font-size:34pt;font-weight:800;letter-spacing:-1.5px;line-height:1">${d.s2a[1]}</div><p style="margin-top:3mm">${d.s2a[2]}</p></div>
        <div class="card accent"><div class="ic">${icon('chart', { size: 30, color: '#fff' })}</div>
          <div class="k">${d.s2b[0]}</div><div style="font-size:34pt;font-weight:800;letter-spacing:-1.5px;line-height:1">${d.s2b[1]}</div><p style="margin-top:3mm">${d.s2b[2]}</p></div>
      </div></div>`, { foot, track }),

    S(`<div class="body">${eyebrow(d.s3k)}<h2>${d.s3h}</h2>
      <div style="margin-top:6mm">${hbars(d.s3bars, { a, w: 1020 })}</div>
      <p class="small" style="margin-top:6mm;max-width:190mm">${d.s3sub}</p></div>`, { cls: 'tint', foot, track }),

    S(`<div class="body">${eyebrow(d.s4k)}<h2>${d.s4h}</h2>${iconCards(d.s4cards, ['clock', 'school', 'shield'], a)}</div>`, { foot, track }),

    S(`<div class="body">${eyebrow(d.s5k)}<h2>${d.s5h}</h2>${pills(d.s5pills)}</div>`, { foot, track }),

    S(`<div class="body">${eyebrow(d.s6k)}<h2>${d.s6h}</h2>${steps(d.s6steps, a)}</div>`, { cls: 'tint', foot, track }),

    S(`<div style="position:absolute;inset:0">${mesh({ seed: 88, stroke: a2, op: .16 })}</div>
      <div class="body" style="position:relative">${eyebrow(d.s7k)}<h2>${d.s7h}</h2>
      <div class="strip" style="border-color:#2c2c36;color:#fff">${d.s7strip.map(([n, l]) =>
        `<div style="border-color:#2c2c36"><div class="n">${n}</div><div class="l" style="color:#a8a8b8">${l}</div></div>`).join('')}</div></div>`,
      { cls: 'dark', foot, track }),

    closer({ k: d.s8k, h: d.s8h, sub: d.s8sub, contactK: L.contactK, contactFill: L.contactFill, a, foot, track, assumptions: L.assumptions }),
  ];
  return shell({ title: `${c.country} — ${d.track}`, accent: a, accent2: a2, slides: sl, footL: L, footR: foot });
}

export const DECKS = {
  stablecoin: deckStablecoin,
  gaming: deckGaming,
  hardware: deckHardware,
  schools: deckSchools,
};
