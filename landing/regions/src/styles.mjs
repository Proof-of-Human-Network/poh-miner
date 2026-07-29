// Shared stylesheets. Two families:
//   docCSS  — A4 portrait, serif, print-first (matches the existing memorandum house style)
//   deckCSS — 16:9 slides, sans, low text, big figures

export const FONTS_DOC = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=PT+Serif:ital,wght@0,400;0,700;1,400;1,700&family=PT+Sans:wght@400;700&display=swap" rel="stylesheet">`;

export const FONTS_DECK = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;800&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">`;

export const docCSS = `
:root{
  --ink:#000; --ink-2:#1a1a1a; --muted:#4a4a4a; --faint:#767676;
  --rule:#000; --rule-soft:#b7b7b7; --shade:#efefef; --shade-2:#e2e2e2;
  --serif:'PT Serif','Times New Roman',Georgia,serif;
  --sans:'PT Sans','Arial',Helvetica,sans-serif;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:#fff;color:var(--ink);font-family:var(--serif);font-size:10.6pt;line-height:1.5;
  -webkit-font-smoothing:antialiased;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
.page{width:210mm;min-height:293mm;margin:0 auto;padding:19mm 22mm 16mm;background:#fff;position:relative}
.page + .page{page-break-before:always}
.rh{position:absolute;top:10mm;left:22mm;right:22mm;display:flex;justify-content:space-between;
  font-family:var(--sans);font-size:7.6pt;letter-spacing:.4px;color:var(--faint);
  border-bottom:.5pt solid var(--rule-soft);padding-bottom:3pt;text-transform:uppercase}
.rf{position:absolute;bottom:9mm;left:22mm;right:22mm;display:flex;justify-content:space-between;
  font-family:var(--sans);font-size:7.6pt;letter-spacing:.4px;color:var(--faint);
  border-top:.5pt solid var(--rule-soft);padding-top:3pt}
.rf .pg{position:absolute;left:0;right:0;text-align:center}
h1,h2,h3,h4{font-family:var(--serif);color:var(--ink);font-weight:700;line-height:1.2}
h2{font-size:15pt;margin:0 0 6pt;padding-bottom:4pt;border-bottom:1pt solid var(--rule)}
h2 .n{font-family:var(--sans);font-weight:700;margin-right:8pt}
h3{font-size:11.5pt;margin:11pt 0 3pt}
h4{font-size:10.6pt;margin:8pt 0 2pt;font-style:italic;font-weight:700}
p{margin:0 0 6pt;text-align:justify;hyphens:auto}
.lead{font-size:11pt;line-height:1.55}
.small{font-size:9pt;line-height:1.45}
.tiny{font-size:8pt;line-height:1.4;color:var(--muted)}
ul,ol{margin:5pt 0 8pt;padding-left:18px}
li{margin:0 0 4pt;text-align:justify}
.sans{font-family:var(--sans)}
.muted{color:var(--muted)}
.title-org{font-family:var(--sans);font-size:10pt;letter-spacing:3px;text-transform:uppercase;font-weight:700}
.title-rule{border:none;border-top:1.5pt solid var(--ink);margin:0}
.title-wrap{display:flex;flex-direction:column;justify-content:center;min-height:232mm;text-align:center}
.doc-class{font-family:var(--sans);font-size:8.4pt;letter-spacing:2px;text-transform:uppercase;color:var(--muted);border:1pt solid var(--ink);display:inline-block;padding:4pt 12pt;margin:0 auto}
.title-main{font-size:29pt;line-height:1.15;margin:20pt 0 6pt;font-weight:700}
.title-sub{font-size:13pt;font-style:italic;color:var(--ink-2);max-width:150mm;margin:0 auto;line-height:1.4}
.title-meta{margin-top:26pt;font-family:var(--sans);font-size:9pt;color:var(--muted);line-height:1.9;letter-spacing:.3px}
.title-meta b{color:var(--ink);font-weight:700}
.toc{font-size:10.6pt;margin-top:6pt}
.toc div{display:flex;align-items:baseline;margin:0 0 6pt}
.toc .t{white-space:nowrap}
.toc .d{flex:1;border-bottom:.5pt dotted var(--rule-soft);margin:0 5pt 3pt}
.toc .p{font-family:var(--sans);font-size:9pt;color:var(--muted)}
.toc .num{font-family:var(--sans);font-weight:700;width:22pt;display:inline-block}
table{width:100%;border-collapse:collapse;font-size:9.2pt;margin:9pt 0}
caption{caption-side:top;text-align:left;font-family:var(--sans);font-size:8.4pt;font-weight:700;margin-bottom:4pt;letter-spacing:.3px}
th,td{text-align:right;padding:4.5pt 8pt;border:.5pt solid var(--rule-soft)}
th:first-child,td:first-child{text-align:left}
thead th{font-family:var(--sans);font-size:8pt;font-weight:700;background:var(--shade);border:.5pt solid var(--rule)}
tbody td{color:var(--ink-2)}
tr.total td{font-weight:700;background:var(--shade);border-top:1pt solid var(--rule)}
tr.sub td:first-child{padding-left:18pt;color:var(--muted);font-style:italic}
.num{font-variant-numeric:tabular-nums}
.figure{border:.5pt solid var(--rule);padding:10pt 12pt 8pt;margin:10pt 0}
.figure .cap{font-family:var(--sans);font-size:8.4pt;font-weight:700;margin-bottom:2pt}
.figure .cs{font-family:var(--sans);font-size:7.8pt;color:var(--muted);margin-bottom:7pt}
.legend{display:flex;gap:16pt;flex-wrap:wrap;font-family:var(--sans);font-size:8pt;margin-top:7pt}
.legend span{display:inline-flex;align-items:center;gap:5px}
.sw{width:11px;height:9px;display:inline-block;border:.5pt solid #000}
.note{border:.5pt solid var(--rule);border-left:3pt solid var(--ink);padding:8pt 12pt;margin:9pt 0;font-size:9.3pt;background:var(--shade)}
.quote{border-left:2.5pt solid var(--ink);padding:2pt 0 2pt 12pt;margin:9pt 0;font-style:italic;font-size:10.4pt}
.def{margin:8pt 0}
.def .box,.box{border:.5pt solid var(--rule);padding:8pt 11pt}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:11pt}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:9pt}
.kpi{border:.5pt solid var(--rule);padding:8pt 10pt}
.kpi .n{font-weight:700;font-size:17pt;line-height:1}
.kpi .c{font-family:var(--sans);font-size:7.8pt;color:var(--muted);margin-top:3pt;line-height:1.35}
@media print{.page{margin:0}@page{size:A4;margin:0}}
`;

export const deckCSS = (accent, accent2) => `
:root{
  --a:${accent}; --a2:${accent2};
  --ink:#0b0b0c; --ink-2:#26262b; --muted:#6b6b76; --faint:#9a9aa5;
  --line:#dcdce4; --wash:#f4f4f7;
  --sans:'Inter',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
  --mono:'JetBrains Mono',ui-monospace,Menlo,monospace;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:#5c5c66;font-family:var(--sans);color:var(--ink);
  -webkit-font-smoothing:antialiased;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.slide{position:relative;width:297mm;height:167mm;margin:0 auto 6mm;background:#fff;overflow:hidden;
  padding:16mm 18mm 13mm;display:flex;flex-direction:column}
.slide + .slide{page-break-before:always}
.slide.dark{background:var(--ink);color:#fff}
.slide.dark .eyebrow{color:var(--a2)}
.slide.dark .sub,.slide.dark .muted{color:#b4b4c0}
.slide.tint{background:var(--wash)}

/* chrome */
.eyebrow{font-size:8.5pt;font-weight:700;letter-spacing:2.6px;text-transform:uppercase;color:var(--a);margin:0 0 6mm}
.foot{position:absolute;left:18mm;right:18mm;bottom:6mm;display:flex;justify-content:space-between;
  font-size:7.5pt;letter-spacing:1.4px;text-transform:uppercase;color:var(--faint)}
.slide.dark .foot{color:#6e6e7e}
.bar{position:absolute;left:0;top:0;width:100%;height:3.2mm;background:var(--a)}
.bar.split{background:linear-gradient(90deg,var(--a) 0 55%,var(--a2) 55% 100%)}

/* type */
h1{font-size:44pt;line-height:1.02;font-weight:800;letter-spacing:-1.6px;margin:0}
h2{font-size:27pt;line-height:1.08;font-weight:800;letter-spacing:-.9px;margin:0 0 4mm;max-width:230mm}
h3{font-size:13pt;font-weight:700;margin:0 0 2mm;letter-spacing:-.2px}
.sub{font-size:13pt;font-weight:300;line-height:1.4;color:var(--ink-2);max-width:190mm;margin:4mm 0 0}
p{margin:0 0 2.5mm;font-size:10.5pt;line-height:1.45;color:var(--ink-2)}
.slide.dark p{color:#c9c9d4}
.lede{font-size:12pt;font-weight:300;line-height:1.45;max-width:195mm}
.small{font-size:9pt;line-height:1.4;color:var(--muted)}
.mono{font-family:var(--mono)}
.hl{color:var(--a)}
.body{flex:1;display:flex;flex-direction:column;justify-content:center;min-height:0}
.body.top{justify-content:flex-start}

/* big figures */
.figs{display:grid;gap:8mm}
.fig .n{font-size:40pt;font-weight:800;letter-spacing:-2px;line-height:.95;font-variant-numeric:tabular-nums}
.fig .n.sm{font-size:30pt;letter-spacing:-1.2px}
.fig .u{font-size:14pt;font-weight:600;color:var(--muted);margin-left:2px}
.fig .l{font-size:9.5pt;line-height:1.35;color:var(--muted);margin-top:2.5mm;max-width:62mm}
.fig .r{height:2px;background:var(--a);width:14mm;margin:3mm 0 0}

/* cards */
.cards{display:grid;gap:5mm}
.card{border:1px solid var(--line);border-radius:2mm;padding:6mm 6mm 5.5mm;background:#fff;display:flex;flex-direction:column}
.card.solid{background:var(--ink);color:#fff;border-color:var(--ink)}
.card.solid p,.card.solid .small{color:#c2c2ce}
.card.accent{background:var(--a);color:#fff;border-color:var(--a)}
.card.accent p,.card.accent .small{color:rgba(255,255,255,.85)}
.card .ic{margin-bottom:4mm}
.card .k{font-size:8pt;font-weight:700;letter-spacing:1.8px;text-transform:uppercase;color:var(--a);margin-bottom:2.5mm}
.card.accent .k,.card.solid .k{color:var(--a2)}
.slide.dark .card{background:#17171c;border-color:#2c2c36;color:#fff}
.slide.dark .card p{color:#b0b0bd}

/* step rail */
.steps{display:grid;gap:0;grid-auto-flow:column;grid-auto-columns:1fr;align-items:start}
.step{position:relative;padding:0 6mm 0 0}
.step .d{width:9mm;height:9mm;border-radius:50%;background:var(--a);color:#fff;display:flex;align-items:center;
  justify-content:center;font-weight:800;font-size:11pt;margin-bottom:4mm}
.step:not(:last-child):after{content:'';position:absolute;left:9mm;top:4.5mm;right:6mm;height:1px;background:var(--line)}

/* strip */
.strip{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.strip > div{padding:5mm 6mm 5mm 0;border-right:1px solid var(--line)}
.strip > div:last-child{border-right:0}
.strip .n{font-size:22pt;font-weight:800;letter-spacing:-1px;line-height:1}
.strip .l{font-size:8.5pt;color:var(--muted);margin-top:2mm;line-height:1.35}

/* plain table */
table{width:100%;border-collapse:collapse;font-size:10pt}
th,td{text-align:right;padding:3.4mm 4mm;border-bottom:1px solid var(--line)}
th:first-child,td:first-child{text-align:left}
thead th{font-size:8pt;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:var(--muted);
  border-bottom:1.5px solid var(--ink)}
tbody td{font-variant-numeric:tabular-nums}
tr.hi td{background:var(--wash);font-weight:700}

.pill{display:inline-block;border:1px solid var(--line);border-radius:20px;padding:1.6mm 4.5mm;font-size:8.5pt;
  font-weight:600;letter-spacing:.4px;color:var(--ink-2);margin:0 2mm 2mm 0}
.pill.on{background:var(--a);border-color:var(--a);color:#fff}
.quote{font-size:19pt;font-weight:300;line-height:1.32;letter-spacing:-.5px;max-width:215mm}
.quote b{font-weight:700;color:var(--a)}

@media print{body{background:#fff}.slide{margin:0}@page{size:297mm 167mm;margin:0}}
@media screen and (max-width:1180px){
  html{font-size:14px}
  .slide{width:100%;height:auto;min-height:0;padding:9mm 7mm 12mm}
  h1{font-size:30pt}h2{font-size:20pt}
}
`;

export const ACCENTS = {
  stablecoin: ['#0f7361', '#5fd0b6'],
  gaming:     ['#5b2bd9', '#a98bff'],
  hardware:   ['#b8560f', '#ffab5e'],
  schools:    ['#14509e', '#7db2f0'],
  doc:        ['#0f7361', '#5fd0b6'],
};
