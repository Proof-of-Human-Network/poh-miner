// Page template for the regional landing pages.
//
// Emits a small self-contained document that links the two shared stylesheets
// (regions-fonts.css, regions-page.css) rather than inlining ~420KB of base64
// fonts per country, and carries only the per-country palette inline.

import { scene } from './scenes.mjs';
import { RTL_LANGS } from './data.mjs';

const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

// Iceland (the site display face) covers Latin only. Anything else needs a
// stack that has the script, or the browser substitutes per-glyph and the
// headline comes out visually broken.
const DISPLAY = {
  en: "'Iceland','Inter',sans-serif",
  es: "'Iceland','Inter',sans-serif",
  pt: "'Iceland','Inter',sans-serif",
  ky: "'Inter',system-ui,sans-serif",
  am: "'Noto Sans Ethiopic','Abyssinica SIL','Inter',system-ui,sans-serif",
  bn: "'Noto Sans Bengali','Hind Siliguri','Inter',system-ui,sans-serif",
  ar: "'Noto Naskh Arabic','Amiri','Segoe UI',system-ui,sans-serif",
  ur: "'Noto Nastaliq Urdu','Noto Naskh Arabic','Segoe UI',system-ui,sans-serif",
  fa: "'Vazirmatn','Noto Naskh Arabic','Segoe UI',system-ui,sans-serif",
  dz: "'Noto Serif Tibetan','Noto Sans Tibetan','Jomolhari','DDC Uchen','Inter',system-ui,sans-serif",
};

// Long compound words (Kyrgyz "Борборсуздандырылган", Amharic, German-style
// stacks) overflow at the Latin hero size, so non-Latin pages start smaller.
const HERO_FS = {
  en: 'clamp(2.75rem,1.6rem + 5.6vw,6rem)',
  es: 'clamp(2.75rem,1.6rem + 5.6vw,6rem)',
  pt: 'clamp(2.75rem,1.6rem + 5.6vw,6rem)',
};
const HERO_FS_DEFAULT = 'clamp(2rem,1.2rem + 3.4vw,3.6rem)';

const card = (t, d) => `
        <article class="card">
          <h3>${esc(t)}</h3>
          <p>${esc(d)}</p>
        </article>`;

export function buildPage(c, l) {
  const rtl = RTL_LANGS.has(c.lang);
  const pal = c.palette;

  return `<!DOCTYPE html>
<html lang="${c.lang}"${rtl ? ' dir="rtl"' : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(l.heroTitle)} — iamai.kg</title>
<meta name="description" content="${esc(l.heroLede)}">
<link rel="icon" type="image/svg+xml" href="../dai-miner-on-light.svg">
<link rel="stylesheet" href="../regions-fonts.css">
<link rel="stylesheet" href="../regions-page.css">
<style>
  :root{
    --sky-top:${pal.skyTop}; --sky-mid:${pal.skyMid}; --sky-low:${pal.skyLow};
    --moon:${pal.moon}; --ridge-far:${pal.ridgeFar}; --ridge-mid:${pal.ridgeMid};
    --accent-a:${pal.accentA}; --accent-b:${pal.accentB};
    --display:${DISPLAY[c.lang] || DISPLAY.en};
    --fs-hero:${HERO_FS[c.lang] || HERO_FS_DEFAULT};
  }
  /* Long words in any script must wrap rather than run off the page. */
  .headline{overflow-wrap:anywhere;hyphens:auto;max-width:22ch}
  .band h2{overflow-wrap:anywhere}
</style>
</head>
<body>

<header class="hero">
  ${scene(c.scene, 'hero')}
  <div class="veil"></div>

  <div class="topbar">
    <a class="brand" href="../index.html"><span class="dot"></span> iamai.kg</a>
    <nav class="nav">
      <a href="#compute">${esc(l.navCompute)}</a>
      <a href="#coin">${esc(l.navCoin)}</a>
      <a href="#here">${esc(l.navCountry)}</a>
      <a href="../index.html">${esc(l.navDai)}</a>
      <a href="../wallet/">${esc(l.navWallet)}</a>
      <a href="../explorer/">Explorer</a>
      <a href="../miner.html">${esc(l.navMiner)}</a>
    </nav>
  </div>

  <div class="hero-inner wrap">
    <h1 class="headline">${esc(l.heroTitle)}</h1>
    <p class="lede">${esc(l.heroLede)}</p>
    <p class="scene-cap">${esc(l.sceneCap)}</p>
  </div>
</header>

<section id="compute" class="band">
  <div class="wrap">
    <p class="eyebrow">${esc(l.s1Eyebrow)}</p>
    <h2>${esc(l.s1Title)}</h2>
    <div class="grid-3">${card(l.s1aT, l.s1aD)}${card(l.s1bT, l.s1bD)}${card(l.s1cT, l.s1cD)}</div>
  </div>
</section>

<section id="coin" class="band alt">
  <div class="wrap">
    <p class="eyebrow">${esc(l.s2Eyebrow)}</p>
    <h2>${esc(l.s2Title)}</h2>
    <div class="grid-2">${card(l.s2aT, l.s2aD)}${card(l.s2bT, l.s2bD)}</div>
  </div>
</section>

<section id="here" class="band">
  <div class="wrap">
    <p class="eyebrow">${esc(l.s3Eyebrow)}</p>
    <h2>${esc(l.s3Title)}</h2>
    <div class="grid-4">${card(l.s3aT, l.s3aD)}${card(l.s3bT, l.s3bD)}${card(l.s3cT, l.s3cD)}${card(l.s3dT, l.s3dD)}</div>
  </div>
</section>

<section id="market" class="band alt">
  <div class="wrap">
    <p class="eyebrow">${esc(l.s4Eyebrow)}</p>
    <h2>${esc(l.s4Title)}</h2>
    <p class="lede narrow">${esc(l.s4Lede)}</p>
    <div class="flow">
      <div class="flow-step"><span class="flow-k">${esc(l.s4In)}</span><span class="flow-v">USD · EUR · USDT</span></div>
      <div class="flow-arrow" aria-hidden="true">→</div>
      <div class="flow-step accent"><span class="flow-k">${esc(l.s4Rail)}</span><span class="flow-v">${esc(c.coin)}</span></div>
      <div class="flow-arrow" aria-hidden="true">→</div>
      <div class="flow-step"><span class="flow-k">${esc(l.s4Out)}</span><span class="flow-v">${esc(l.s4o1)} · ${esc(l.s4o2)} · ${esc(l.s4o3)}</span></div>
    </div>
  </div>
</section>

<section id="exchange" class="band">
  <div class="wrap">
    <p class="eyebrow">${esc(l.s5Eyebrow)}</p>
    <h2>${esc(l.s5Title)}</h2>
    <p class="lede narrow">${esc(l.s5Lede)}</p>
    <p><a class="btn" href="https://aist.exchange" target="_blank" rel="noopener">${esc(l.s5Cta)}</a></p>
  </div>
</section>

<section id="start" class="band alt">
  <div class="wrap center">
    <p class="eyebrow">${esc(l.s6Eyebrow)}</p>
    <h2>${esc(l.s6Title)}</h2>
    <p class="lede narrow">${esc(l.s6Lede)}</p>
    <p class="cta-row">
      <a class="btn primary" href="../miner.html#start">${esc(l.s6a)}</a>
      <a class="btn" href="../docs/">${esc(l.s6b)}</a>
    </p>
  </div>
</section>

<footer class="foot">
  <div class="wrap foot-inner">
    <span>${esc(l.footTag)}</span>
    <span class="foot-links">
      <a href="../index.html">iamai.kg</a>
      <a href="../explorer/">Explorer</a>
      <a href="https://t.me/iamaihub" target="_blank" rel="noopener">Telegram</a>
    </span>
  </div>
</footer>

<script>
(function () {
  'use strict';
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Starfield, drawn only in the upper sky so it never sits on the landmark.
  var g = document.querySelector('[data-stars]');
  if (g) {
    var ns = 'http://www.w3.org/2000/svg';
    for (var i = 0; i < 90; i++) {
      var s = document.createElementNS(ns, 'circle');
      s.setAttribute('cx', (Math.random() * 1440).toFixed(1));
      s.setAttribute('cy', (Math.random() * 380).toFixed(1));
      s.setAttribute('r', (Math.random() * 1.3 + 0.3).toFixed(2));
      s.setAttribute('fill', 'var(--moon)');
      s.setAttribute('opacity', (Math.random() * 0.5 + 0.15).toFixed(2));
      g.appendChild(s);
    }
  }

  // Gentle parallax on the hero scene. Skipped when the visitor asks for
  // reduced motion, and throttled to one write per frame.
  if (!reduce) {
    var el = document.querySelector('.hero .scene'), ticking = false;
    if (el) {
      var upd = function () {
        var y = Math.max(-24, Math.min(24, window.scrollY * -0.04));
        el.style.transform = 'translate3d(0,' + y.toFixed(1) + 'px,0) scale(1.06)';
        ticking = false;
      };
      addEventListener('scroll', function () {
        if (!ticking) { ticking = true; requestAnimationFrame(upd); }
      }, { passive: true });
      upd();
    }
  }
})();
</script>
</body>
</html>
`;
}
