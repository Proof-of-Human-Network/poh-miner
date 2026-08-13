// The long-form country memorandum (A4, print-first).

import { docCSS, FONTS_DOC } from './styles.mjs';
import { corridor, priceStack, scenarioChart, batchLadder } from './svg.mjs';
import { priceStackRows, scenarioRows, batchRows } from './strings.mjs';

const row = cells => `<tr>${cells.map((v, i) => `<td${i ? ' class="num"' : ''}>${v}</td>`).join('')}</tr>`;
const head = cells => `<thead><tr>${cells.map(v => `<th>${v}</th>`).join('')}</tr></thead>`;

export function buildDoc(c, L) {
  let pg = 0;
  const foot = () => `<div class="rf"><span>${L.confidential}</span><span class="pg">${++pg + 1}</span><span>${L.date}</span></div>`;
  const rh = `<div class="rh"><span>${L.docTitle}</span><span>${L.confidential}</span></div>`;

  const page = inner => `<section class="page">${rh}${inner}${foot()}</section>`;

  // §4 and §6 each run to two pages, so the page-map is not simply i+3.
  const tocPages = [3, 4, 5, 6, 9, 10, 12, 13, 14];
  const toc = L.toc.map((tt, i) =>
    `<div><span class="num">${i + 1}.</span><span class="t">${tt}</span><span class="d"></span><span class="p">${tocPages[i]}</span></div>`).join('');

  return `<!DOCTYPE html>
<html lang="${L.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${L.docTitle.replace(/<[^>]+>/g, '')}</title>
${FONTS_DOC}
<style>${docCSS}</style>
</head>
<body>

<section class="page">
  <div style="display:flex;justify-content:space-between;align-items:center">
    <div class="title-org">${L.org}</div>
    <div class="title-org" style="letter-spacing:1px;font-weight:400;color:var(--muted)">${c.country} · ${c.capital}</div>
  </div>
  <hr class="title-rule" style="margin-top:6pt">
  <div class="title-wrap">
    <div><span class="doc-class">${L.docClass}</span></div>
    <div class="title-main">${L.docHead}</div>
    <div class="title-sub">${L.docSub}</div>
    <hr class="title-rule" style="width:60mm;margin:22pt auto 0">
    <div class="title-meta">
      <div><b>${L.metaSub}:</b> ${L.metaSubV}</div>
      <div><b>${L.metaFor}:</b> ${L.metaForV}</div>
      <div><b>${L.metaJur}:</b> ${L.metaJurV} &nbsp;·&nbsp; <b>${L.date}</b></div>
    </div>
  </div>
  <hr class="title-rule" style="border-top:.5pt solid var(--rule-soft)">
  <p class="tiny" style="text-align:center;margin-top:6pt">${L.docNotice}</p>
</section>

${page(`<h2>${L.toc[0] && ''}${L.lang === 'ru' ? 'Содержание' : 'Table of Contents'}</h2><div class="toc">${toc}</div>`)}

${page(`
  <h2><span class="n">1.</span>${L.s1h}</h2>
  <p class="lead">${L.s1lead}</p>
  <p>${L.s1p1}</p>
  <p>${L.s1p2}</p>
  <div class="grid2" style="margin-top:10pt">
    ${L.s1k.map(([n, t]) => `<div class="kpi"><div class="n">${n}</div><div class="c">${t}</div></div>`).join('')}
  </div>
  <div class="note">${L.s1note}</div>
`)}

${page(`
  <h2><span class="n">2.</span>${L.s2h}</h2>
  <p class="lead">${L.s2lead}</p>
  <h3>2.1 &nbsp;${L.s2computeH}</h3>
  <p>${L.s2compute}</p>
  <h3>2.2 &nbsp;${L.s2sourcesH}</h3>
  <p>${L.s2sources}</p>
  <table><caption>${L.s2tblCap}</caption>${head(L.s2tblHead)}<tbody>${L.s2tbl.map(row).join('')}</tbody></table>
  <h3>2.3 &nbsp;${L.lang === 'ru' ? 'Почему это агрегируется' : 'Why it aggregates'}</h3>
  <p>${L.s2why}</p>
`)}

${page(`
  <h2><span class="n">3.</span>${L.s3h}</h2>
  <p class="lead">${L.s3lead}</p>
  <div class="grid2" style="margin-top:9pt">
    ${L.s3why.map(([h, t]) => `<div class="box"><h4 style="margin-top:0">${h}</h4><p class="small" style="margin:0">${t}</p></div>`).join('')}
  </div>
  <div class="quote">${L.s3quote}</div>
`)}

${page(`
  <h2><span class="n">4.</span>${L.s4h}</h2>
  <p class="lead">${L.s4lead}</p>
  <div class="figure">
    <div class="cap">${L.lang === 'ru' ? 'Схема 4.1 — Коридор' : 'Figure 4.1 — The corridor'}</div>
    <div class="cs">${L.corrAria}</div>
    ${corridor(c, L, { a: '#000', a2: '#4a4a4a' })}
  </div>
  ${L.s4steps.map(([h, t]) => `<h4>${h}</h4><p class="small">${t}</p>`).join('')}
  <div class="note">${L.s4back}</div>
  <p class="small">${L.s4whyGeo}</p>
`)}

${page(`
  <h2><span class="n">4.</span>${L.s4h} <span class="muted" style="font-weight:400">(${L.lang === 'ru' ? 'продолжение' : 'continued'})</span></h2>
  <h3>4.1 &nbsp;${L.s4mintH}</h3>
  <p>${L.s4mint}</p>
  ${L.s4mintSteps.map(([h, t]) => `<h4>${h}</h4><p class="small">${t}</p>`).join('')}
  <h3>4.2 &nbsp;${L.s4splitH}</h3>
  <p>${L.s4split}</p>
  <div class="figure">
    <div class="cap">${L.s4splitCap}</div>
    <div class="cs">${L.s4splitCs}</div>
    ${batchLadder(batchRows(L.s4splitSizes), { a: '#000', a2: '#9a9a9a', issuerLabel: L.s4splitLabels.issuer, ecoLabel: L.s4splitLabels.eco })}
  </div>
  <div class="note">${L.s4splitNote}</div>
`)}

${page(`
  <h2><span class="n">4.</span>${L.s4h} <span class="muted" style="font-weight:400">(${L.lang === 'ru' ? 'продолжение' : 'continued'})</span></h2>
  <h3>4.3 &nbsp;${L.s4fundH}</h3>
  <p>${L.s4fund}</p>
  ${L.s4fundSteps.map(([h, t]) => `<h4>${h}</h4><p class="small">${t}</p>`).join('')}
  <p class="tiny" style="text-align:justify">${L.s4fundNotice}</p>
`)}

${page(`
  <h2><span class="n">5.</span>${L.s5h}</h2>
  <p class="lead">${L.s5lead}</p>
  <table>${head(L.s5tblHead)}<tbody>${L.s5tbl.map(([a, b, d]) => `<tr><td>${a}</td><td class="num">${b}</td><td style="text-align:left">${d}</td></tr>`).join('')}</tbody></table>
  <div class="grid3" style="margin-top:10pt">
    ${c.whyHere.map(([h, t]) => `<div class="box" style="padding:7pt 9pt"><h4 style="margin-top:0">${h}</h4><p class="small" style="margin:0">${t}</p></div>`).join('')}
  </div>
`)}

${page(`
  <h2><span class="n">6.</span>${L.s6h}</h2>
  <p class="lead">${L.s6lead}</p>
  <table><caption>${L.s6t1cap}</caption>${head(L.s6t1head)}<tbody>
    ${L.s6t1.slice(0, -1).map(row).join('')}
    <tr class="total">${L.s6t1.at(-1).map((v, i) => `<td${i ? ' class="num"' : ''}>${v}</td>`).join('')}</tr>
  </tbody></table>
  <div class="note">${L.s6note}</div>
`)}

${page(`
  <h2><span class="n">6.</span>${L.s6h} <span class="muted" style="font-weight:400">(${L.lang === 'ru' ? 'продолжение' : 'continued'})</span></h2>
  <h3>6.1 &nbsp;${L.s6chartH}</h3>
  <div class="figure">
    <div class="cap">${L.s6chartCap}</div>
    <div class="cs">${L.s6chartCs}</div>
    ${priceStack(priceStackRows(), { a: '#000', a2: '#7a7a7a', labels: L.s6chartLabels, unit: L.lang === 'ru' ? '$ / млн токенов' : '$ / million tokens' })}
  </div>
  <h3>6.2 &nbsp;${L.s6scenH}</h3>
  <p>${L.s6scenLead}</p>
  <div class="figure">
    <div class="cap">${L.s6scenCap}</div>
    <div class="cs">${L.s6scenCs}</div>
    ${scenarioChart(scenarioRows(L.s6scenLabels, c), { a: '#000', a2: '#7a7a7a', payLabel: L.lang === 'ru' ? 'платим' : 'we pay', sellLabel: L.lang === 'ru' ? 'продаём' : 'we sell', recLabel: L.lang === 'ru' ? 'возврат' : 'recovery' })}
  </div>
  <div class="note">${L.s6scenNote}</div>
  <p class="tiny">${L.assumptions}</p>
`)}

${page(`
  <h2><span class="n">7.</span>${L.s7h}</h2>
  <p class="lead">${L.s7lead}</p>
  ${L.s7ch.map(([h, t], i) => `<h3>7.${i + 1} &nbsp;${h}</h3><p>${t}</p>`).join('')}
`)}

${page(`
  <h2><span class="n">8.</span>${L.s8h}</h2>
  <p class="lead">${L.s8lead}</p>
  <ul>${L.s8list.map(([h, t]) => `<li><strong>${h}.</strong> ${t}</li>`).join('')}</ul>
  <div class="note">${L.s8note}</div>
`)}

${page(`
  <h2><span class="n">9.</span>${L.s9h}</h2>
  <p class="lead">${L.s9lead.replace('${S}', c.stable)}</p>
  <table>${head(L.s9tblHead)}<tbody>${L.s9tbl.map(([a, b, d]) => `<tr><td>${a}</td><td class="num">${b}</td><td style="text-align:left">${d}</td></tr>`).join('')}</tbody></table>
  <h3>9.1 &nbsp;${L.lang === 'ru' ? 'Что требуется' : 'What is asked'}</h3>
  <div class="grid3">
    ${L.s9ask.map(([h, t]) => `<div class="box" style="padding:7pt 9pt"><h4 style="margin-top:0">${h}</h4><p class="small" style="margin:0">${t}</p></div>`).join('')}
  </div>
  <h3>9.2 &nbsp;${L.lang === 'ru' ? 'Важное уведомление' : 'Important Notice'}</h3>
  <p class="tiny" style="text-align:justify">${L.s9notice}</p>
`)}

</body>
</html>`;
}
