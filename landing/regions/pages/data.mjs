// Per-country facts for the regional landing pages (landing/<slug>/index.html).
//
// `slug` is the directory name and follows the existing convention of naming the
// folder after the local compute coin (kgs, etb, btn …). `lang` drives both the
// copy in strings.mjs and the <html lang>/dir attributes — Arabic, Urdu and
// Persian pages render right-to-left.
//
// `palette` recolours the shared scene gradients in regions-page.css, so each
// country's landmark sits in light that belongs to it: Saharan dusk for Egypt,
// tropical night for Angola, high-altitude blue for Bhutan.

export const RTL_LANGS = new Set(['ar', 'ur', 'fa']);

export const COUNTRIES = [
  {
    slug: 'kgs', cc: 'kg', lang: 'ky', country: 'Kyrgyzstan', coin: 'KGST',
    landmark: 'Issyk-Kul & the Tian Shan', scene: 'lakeMountains',
    power: 0.035, fx: 87,
    palette: { skyTop:'#04060c', skyMid:'#081321', skyLow:'#0e2133', moon:'#eef4ff',
               ridgeFar:'#132234', ridgeMid:'#0d1928', accentA:'#cdd9ea', accentB:'#33465e' },
  },
  {
    slug: 'etb', cc: 'et', lang: 'am', country: 'Ethiopia', coin: 'aiETB',
    landmark: 'The Simien Mountains', scene: 'escarpment',
    power: 0.02, fx: 128,
    palette: { skyTop:'#0a0710', skyMid:'#1b1020', skyLow:'#33182a', moon:'#ffe9d6',
               ridgeFar:'#2b1a2b', ridgeMid:'#1d1220', accentA:'#e8a06a', accentB:'#6b3b2f' },
  },
  {
    slug: 'btn', cc: 'bt', lang: 'dz', country: 'Bhutan', coin: 'aiBTN',
    landmark: "Paro Taktsang — the Tiger's Nest", scene: 'cliffMonastery',
    power: 0.03, fx: 84,
    palette: { skyTop:'#04080e', skyMid:'#0a1a22', skyLow:'#12313a', moon:'#eaf7ff',
               ridgeFar:'#122a30', ridgeMid:'#0b1c22', accentA:'#bfe6dd', accentB:'#2f5a55' },
  },
  {
    slug: 'ves', cc: 've', lang: 'es', country: 'Venezuela', coin: 'aiVES',
    landmark: 'Salto Ángel y los tepuyes', scene: 'waterfallTepui',
    power: 0.01, fx: 250,
    palette: { skyTop:'#050b10', skyMid:'#0a1e24', skyLow:'#123a33', moon:'#e9fff4',
               ridgeFar:'#123029', ridgeMid:'#0b201c', accentA:'#9fe8c8', accentB:'#2c6350' },
  },
  {
    slug: 'pyg', cc: 'py', lang: 'es', country: 'Paraguay', coin: 'aiPYG',
    landmark: 'La represa de Itaipú', scene: 'dam',
    power: 0.05, fx: 7300,
    palette: { skyTop:'#04070e', skyMid:'#0b1626', skyLow:'#15304a', moon:'#e6f0ff',
               ridgeFar:'#12283c', ridgeMid:'#0b1a29', accentA:'#8fd0f0', accentB:'#2b5675' },
  },
  {
    slug: 'bdt', cc: 'bd', lang: 'bn', country: 'Bangladesh', coin: 'aiBDT',
    landmark: 'সুন্দরবন — the Sundarbans delta', scene: 'delta',
    power: 0.08, fx: 122,
    palette: { skyTop:'#05090c', skyMid:'#0d1c1e', skyLow:'#17352f', moon:'#eafff6',
               ridgeFar:'#123029', ridgeMid:'#0a1e1b', accentA:'#a8e6b8', accentB:'#2f6045' },
  },
  {
    slug: 'pkr', cc: 'pk', lang: 'ur', country: 'Pakistan', coin: 'aiPKR',
    landmark: 'بادشاہی مسجد — the Badshahi Mosque', scene: 'mosque',
    power: 0.09, fx: 282,
    palette: { skyTop:'#0a0509', skyMid:'#1e0d14', skyLow:'#3a1a1e', moon:'#ffeede',
               ridgeFar:'#2b1418', ridgeMid:'#1b0d11', accentA:'#f0c39a', accentB:'#7a3a33' },
  },
  {
    slug: 'egp', cc: 'eg', lang: 'ar', country: 'Egypt', coin: 'aiEGP',
    landmark: 'أهرامات الجيزة — the Pyramids of Giza', scene: 'pyramids',
    power: 0.05, fx: 48,
    palette: { skyTop:'#080610', skyMid:'#1c1220', skyLow:'#3c2418', moon:'#ffeccc',
               ridgeFar:'#2e1d18', ridgeMid:'#1d1210', accentA:'#f2c98a', accentB:'#7d5230' },
  },
  {
    slug: 'iqd', cc: 'iq', lang: 'ar', country: 'Iraq', coin: 'aiIQD',
    landmark: 'ملوية سامراء — the Malwiya of Samarra', scene: 'spiralMinaret',
    power: 0.03, fx: 1310,
    palette: { skyTop:'#0a0710', skyMid:'#1d1420', skyLow:'#3a2820', moon:'#ffeed9',
               ridgeFar:'#2c1f1a', ridgeMid:'#1c1411', accentA:'#e9c391', accentB:'#77543a' },
  },
  {
    slug: 'aoa', cc: 'ao', lang: 'pt', country: 'Angola', coin: 'aiAOA',
    landmark: 'As Quedas de Kalandula', scene: 'fallsWide',
    power: 0.02, fx: 915,
    palette: { skyTop:'#04090c', skyMid:'#0a1c22', skyLow:'#123a38', moon:'#e6fff9',
               ridgeFar:'#123230', ridgeMid:'#0a2020', accentA:'#9fe4d8', accentB:'#2b6058' },
  },
  {
    slug: 'cup', cc: 'cu', lang: 'es', country: 'Cuba', coin: 'aiCUP',
    landmark: 'El Capitolio y el Malecón', scene: 'havana',
    power: 0.03, fx: 400,
    palette: { skyTop:'#06070f', skyMid:'#131a2e', skyLow:'#28304a', moon:'#fff0e2',
               ridgeFar:'#1d2338', ridgeMid:'#121729', accentA:'#f3cfa0', accentB:'#455480' },
  },
  {
    slug: 'lyd', cc: 'ly', lang: 'ar', country: 'Libya', coin: 'aiLYD',
    landmark: 'لبدة الكبرى — Leptis Magna', scene: 'ruins',
    power: 0.01, fx: 5.5,
    palette: { skyTop:'#070810', skyMid:'#161826', skyLow:'#33301f', moon:'#fff3d6',
               ridgeFar:'#2a2a20', ridgeMid:'#191a15', accentA:'#e8d19a', accentB:'#6f6440' },
  },
  {
    slug: 'sdg', cc: 'sd', lang: 'ar', country: 'Sudan', coin: 'aiSDG',
    landmark: 'أهرامات مروي — the Pyramids of Meroë', scene: 'meroe',
    power: 0.02, fx: 2600,
    palette: { skyTop:'#090610', skyMid:'#1f1220', skyLow:'#402413', moon:'#ffe9c4',
               ridgeFar:'#2f1d14', ridgeMid:'#1e130e', accentA:'#f0c485', accentB:'#7d4f2a' },
  },
  {
    slug: 'irr', cc: 'ir', lang: 'fa', country: 'Iran', coin: 'aiIRR',
    landmark: 'تخت جمشید — Persepolis', scene: 'persepolis',
    power: 0.01, fx: 1000000,
    palette: { skyTop:'#08060f', skyMid:'#1a1024', skyLow:'#352038', moon:'#ffeaf0',
               ridgeFar:'#281a2c', ridgeMid:'#19101c', accentA:'#e7b7d0', accentB:'#6b4360' },
  },
];

export const bySlug = Object.fromEntries(COUNTRIES.map(c => [c.slug, c]));
