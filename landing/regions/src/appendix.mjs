// Standalone Russian appendix: raising the first-batch collateral via an
// offshore note structure. Built only for countries with a Russian pack
// (am, kg) — sent as a follow-up to memoranda already in recipients' hands.

import { docCSS, FONTS_DOC } from './styles.mjs';
import { BATCH } from './data.mjs';

const RU_GEO = {
  am: { nom: 'Армения', gen: 'Армении', prep: 'Армении', cap: 'Ереван', cur: 'армянском драме' },
  kg: { nom: 'Кыргызстан', gen: 'Кыргызстана', prep: 'Кыргызстане', cap: 'Бишкек', cur: 'кыргызском соме' },
};

export const hasAppendix = cc => cc in RU_GEO;

export function buildAppendix(c, L) {
  const g = RU_GEO[c.cc];
  const S = c.stable;
  const money = n => '$' + Math.round(n).toLocaleString('en-US');
  const firstUSD = BATCH.firstUSD;
  const firstLocal = (Math.round(firstUSD * c.fx / 10000) * 10000).toLocaleString('en-US');
  const title = 'Приложение A — Привлечение капитала через нотную структуру';

  let pg = 1;
  const foot = () => `<div class="rf"><span>${L.confidential}</span><span class="pg">${++pg}</span><span>${L.date}</span></div>`;
  const rh = `<div class="rh"><span>${title}</span><span>${L.confidential}</span></div>`;
  const page = inner => `<section class="page">${rh}${inner}${foot()}</section>`;

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — ${g.nom}</title>
${FONTS_DOC}
<style>${docCSS}</style>
</head>
<body>

<section class="page">
  <div style="display:flex;justify-content:space-between;align-items:center">
    <div class="title-org">${L.org}</div>
    <div class="title-org" style="letter-spacing:1px;font-weight:400;color:var(--muted)">${g.nom} · ${g.cap}</div>
  </div>
  <hr class="title-rule" style="margin-top:6pt">
  <div class="title-wrap">
    <div><span class="doc-class">${L.docClass}</span></div>
    <div class="title-main">Приложение A</div>
    <div class="title-sub">Привлечение капитала: офшорная нотная структура.<br>Опция финансирования залога первой партии ${S}.</div>
    <hr class="title-rule" style="width:60mm;margin:22pt auto 0">
    <div class="title-meta">
      <div><b>Дополнение к</b>: меморандуму программы, раздел 4</div>
      <div><b>${L.metaJur}</b>: ${g.nom} &nbsp;·&nbsp; <b>${L.date}</b></div>
    </div>
  </div>
  <hr class="title-rule" style="border-top:.5pt solid var(--rule-soft)">
  <p class="tiny" style="text-align:center;margin-top:6pt">${L.docNotice}</p>
</section>

${page(`
  <h2><span class="n">A.1</span>Назначение</h2>
  <p class="lead">Меморандум (раздел 4) предполагает, что партнёр-эмитент вносит залог и выпускает ${S} дискретными партиями; первая партия — пилот объёмом около ${firstLocal} ${c.iso} (≈ ${money(firstUSD)}).</p>
  <p>Это приложение описывает опцию, при которой залог первой партии формируется <strong>не с баланса эмитента</strong>, а за счёт капитала, привлечённого нотами облигационного типа по частному размещению среди международных инвесторов. Опция дополняет, а не заменяет базовую схему: механика партий, погашение и распределение выручки 80/20 из меморандума остаются неизменными.</p>

  <h2><span class="n">A.2</span>Структура</h2>
  <p>Специальная компания (SPV) в международном финансовом центре — например, МФЦА в Астане; альтернативы — Люксембург или DIFC — выпускает ноты и размещает их по закрытой подписке среди квалифицированных международных инвесторов. <strong>100% привлечённых средств</strong> зачисляются в обособленный резерв в банке-кастодиане и никогда не расходуются. ${S} выпускается только против этого резерва, поэтому каждая монета в обращении в любой момент погашаема 1:1.</p>
  <table>
    <thead><tr><th>Роль</th><th style="text-align:left">Функция</th></tr></thead>
    <tbody>
      <tr><td>SPV-эмитент</td><td style="text-align:left">Выпускает ноты, держит резерв, несёт обязательства перед инвесторами</td></tr>
      <tr><td>Банк-кастодиан</td><td style="text-align:left">Хранит резерв; ежемесячные аттестации обеспечения</td></tr>
      <tr><td>Размещающий агент</td><td style="text-align:left">Брокер / инвестбанк: закрытая подписка среди квалифицированных инвесторов</td></tr>
      <tr><td>Локальный эмитент ${S}</td><td style="text-align:left">Выпускает монету против резерва — как в разделе 4 меморандума</td></tr>
      <tr><td>Местный юр. советник</td><td style="text-align:left">Режим размещения, налоги и уведомления по праву ${g.gen}</td></tr>
    </tbody>
  </table>
`)}

${page(`
  <h2><span class="n">A.3</span>Потоки и обслуживание</h2>
  <h4>1. Размещение</h4><p class="small">SPV размещает ноты по закрытой подписке; средства поступают в резерв у кастодиана.</p>
  <h4>2. Выпуск монеты</h4><p class="small">${S} чеканится против резерва; поставщики вычислений — клубы, лаборатории, хосты — получают оплату в ${S}, полностью обеспеченном.</p>
  <h4>3. Выручка</h4><p class="small">Вычисления перепродаются конечным клиентам за EUR, USD или USDT — тот же поток, что в разделе 4.2 меморандума.</p>
  <h4>4. Обслуживание нот</h4><p class="small">Маржа от продаж вычислений плюс доход на самом резерве (казначейские инструменты, депозиты) покрывают купон и погашение нот.</p>
  <h4>5. Погашение и цикл</h4><p class="small">При погашении монеты резерв выплачивает 1:1, монета сжигается; резерв и объём в обращении сокращаются синхронно — привязка не нарушается никогда.</p>
  <div class="note"><strong>Один капитал — одна работа.</strong> Резерв никогда не тратится; доходность инвесторов обеспечивается операционной маржой, а не резервом. Это ключевое требование любого регулятора, банка и аудитора к подобной структуре.</div>

  <h2><span class="n">A.4</span>Разделение рисков</h2>
  <p>Если продажи вычислений окажутся ниже плана, резерв остаётся целым и держатели ${S} не затронуты — бизнес-риск несут только держатели нот. Для держателей монеты структура эквивалентна полному фиатному обеспечению; для инвесторов это кредитный риск операционной программы, обеспеченный контрактами на вычисления. Риск монеты и риск инвестора структурно разделены и никогда не смешиваются.</p>
`)}

${page(`
  <h2><span class="n">A.5</span>Круг инвесторов — только международные</h2>
  <p>Ноты могут быть ограничены <strong>исключительно квалифицированными международными инвесторами</strong>. Два пути:</p>
  <h4>(а) Закрытое размещение по местному праву</h4><p class="small">Законодательство о рынке ценных бумаг различает публичное предложение и закрытое (частное) размещение: во втором случае эмитент сам определяет круг инвесторов в условиях выпуска — в том числе только нерезидентов. Регистрация выпуска у регулятора при этом сохраняется.</p>
  <h4>(б) Выпуск офшорной SPV</h4><p class="small">Бумага выпускается за пределами страны (МФЦА, Люксембург, DIFC) по привычному для международных инвесторов праву и в принципе не предлагается в ${g.prep}. Ограничение «только международные инвесторы» выполняется автоматически.</p>
  <div class="note">В обоих вариантах публичного предложения внутри страны нет и розничные инвесторы ${g.gen} не затрагиваются — это упрощает позицию регулятора. Выбор пути определяют местное право и налоги (удержание налога на купон, валютное регулирование) — совместно с местным советником и размещающим агентом.</div>

  <h2><span class="n">A.6</span>Что требуется от партнёра</h2>
  <div class="grid3">
    <div class="box"><h4 style="margin-top:0">Интро к банку / брокеру</h4><p class="small" style="margin:0">Знакомство с банком-кастодианом и размещающим агентом, готовыми работать со структурой.</p></div>
    <div class="box"><h4 style="margin-top:0">Пилотный размер</h4><p class="small" style="margin:0">Нота соразмерна первой партии: ≈ ${money(firstUSD)}. Сроки — параллельно 12-недельному пилоту программы.</p></div>
    <div class="box"><h4 style="margin-top:0">Юридическая проверка</h4><p class="small" style="margin:0">Местный советник подтверждает режим закрытого размещения, налоговые параметры и валютные вопросы.</p></div>
  </div>

  <h2 style="margin-top:14pt"><span class="n">A.7</span>Оговорка</h2>
  <p class="tiny" style="text-align:justify">${L.s4fundNotice} ${L.docNotice}</p>
`)}

</body>
</html>`;
}
