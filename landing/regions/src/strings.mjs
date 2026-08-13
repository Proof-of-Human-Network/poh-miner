// All copy. `L(lang, c)` returns one flat object of strings for a country.
// Deliberately free of any protocol/token branding — these documents are about
// buying local AI compute and paying for it in the local fiat-pegged stablecoin.

import { nodeHour, nodeYear, clubMonth, payback, computeCost, payTok, fmtUSD, fmtLocal, SOLD_UTIL,
         PRICE, BATCH, batchRecovery, scenariosFor, COUNTRIES, CARD } from './data.mjs';

const money = n => '$' + Math.round(n).toLocaleString('en-US');
const money2 = n => '$' + n.toFixed(2);
const money3 = n => '$' + n.toFixed(3);

export function L(lang, c) {
  const nh = nodeHour(c);
  const ny = nodeYear(c);
  const club = clubMonth(c);
  const S = c.stable;                 // e.g. KGS
  const clubTotal = club.total;
  const clubYear = clubTotal * 12;
  const labTotal = clubMonth(c, 40, 16).total;
  const gpuPrice = 1600;
  const gpuPayback = payback(c, gpuPrice);
  const utilPct = Math.round(SOLD_UTIL * 100);

  // pricing
  const priceRange = `${money2(PRICE.lo)}–${money2(PRICE.hi)}`;   // "$0.08–$0.20"
  const sellBase = money2(PRICE.sellBase);                        // "$0.15"
  const pay = payTok(c);                                          // what we pay this country's hosts
  const cost = computeCost(c).perM;                               // raw floor
  // First batch = the value of 500k GEL, matched in each country's own currency.
  const firstBatchUSD = BATCH.firstUSD;
  const firstBatchLocalNum = c.stableLive ? BATCH.firstGEL : Math.round(firstBatchUSD * c.fx / 10000) * 10000;
  const firstBatchLocal = firstBatchLocalNum.toLocaleString('en-US');

  const slow = nodeHour(c, CARD.downsideTokPerSec);
  const slowClub = clubMonth(c, c.pcsPerClub, 14, SOLD_UTIL, CARD.downsideTokPerSec);
  const recBySplit = BATCH.splits.map(([iss]) => batchRecovery(pay, PRICE.sellBase, iss));
  const fmtSplits = pairs => {
    const s = pairs.map(([iss]) => Math.round(iss * 100) + '/' + Math.round((1 - iss) * 100));
    if (s.length === 0) return '';
    if (s.length === 1) return s[0];
    return s.slice(0, -1).join(', ') + ' and ' + s[s.length - 1];
  };
  const onePassShares = fmtSplits(BATCH.splits.filter((_, i) => recBySplit[i] >= 1));
  const multiPassShares = fmtSplits(BATCH.splits.filter((_, i) => recBySplit[i] < 1));
  const pilotHostMo = 20 * clubTotal + 3 * labTotal;
  const batchMonths = Math.max(1, Math.round(firstBatchUSD / pilotHostMo));

  const V = { S, C: c.country, Cn: c.countryOf, adj: c.adjective, cur: c.currency, iso: c.iso,
              cap: c.capital };

  const M = { nh, ny, club, clubTotal, clubYear, labTotal, gpuPrice, gpuPayback, utilPct,
              priceRange, sellBase, pay, cost, firstBatchLocal, firstBatchUSD,
              slow, slowClub, recBySplit, onePassShares, multiPassShares, batchMonths };
  return lang === 'ru' ? RU(c, V, M) : EN(c, V, M);
}

// ---- chart data (language-neutral; labels added at render) --------------

// Per-country cost → provider margin → our margin, to the reference sell price.
export function priceStackRows() {
  return COUNTRIES.map(c => {
    const cost = computeCost(c).perM;
    const p = payTok(c);
    return { label: c.iso, sub: `${money3(c.power)}/kWh`,
             cost: +cost.toFixed(3), prov: +(p - cost).toFixed(3), ours: +(PRICE.sellBase - p).toFixed(3) };
  });
}

// Three scenarios with first-batch recovery, calibrated to this country's pay.
export function scenarioRows(labels, c) {
  return scenariosFor(c).map((s, i) => {
    const rec = batchRecovery(s.pay, s.sell);
    return { pay: s.pay, sell: s.sell, rec,
             label: labels.names[i],
             sub: `$${s.pay.toFixed(3)} → $${s.sell.toFixed(2)}`,
             speed: rec >= 2 ? labels.fast : rec >= 1 ? labels.ok : labels.slow };
  });
}

// Batch split ladder.
export function batchRows(sizeLabels) {
  return BATCH.splits.map((sp, i) => ({
    label: `Batch ${i + 1}`, issuer: sp[0], eco: sp[1],
    size: i + 1, size_l: sizeLabels[i],
  }));
}

/* ======================================================================= */
/*  ENGLISH                                                                */
/* ======================================================================= */

function EN(c, V, m) {
  const { nh, club, clubTotal, clubYear, labTotal, gpuPrice, gpuPayback, utilPct,
          priceRange, sellBase, pay, cost, firstBatchLocal, firstBatchUSD,
          slow, slowClub, onePassShares, multiPassShares, batchMonths } = m;
  const machines = (Number(c.clubs.replace(/\D/g, '')) * c.pcsPerClub).toLocaleString('en-US');

  return {
    lang: 'en', dir: 'ltr',
    org: 'AI Compute Programme',
    confidential: 'Confidential',
    date: 'July 2026',
    page: 'Page',

    /* ---------- document ---------- */
    docTitle: `${V.C} — Compute Programme`,
    docHead: `Local Compute,<br>Local Money`,
    docSub: `A programme to buy AI compute capacity inside ${V.Cn}, and to pay for every hour of it in ${V.S} — the ${c.adjective} ${c.currency} stablecoin.`,
    docClass: 'Confidential — for discussion',
    metaFor: 'Prepared for',
    metaForV: 'Ministries, universities, operators and partners',
    metaJur: 'Jurisdiction',
    metaJurV: `${V.C} · settled locally in ${V.S}`,
    metaSub: 'Subject',
    metaSubV: `Access to ${c.adjective} compute, settled in ${V.S}`,
    docNotice: 'This document is furnished for discussion. It is not an offer of securities and not investment, legal or tax advice. All figures are internal modelling estimates on the stated assumptions.',

    toc: [
      'Executive Summary',
      'What the Programme Buys: Compute',
      `The Pay-in-${V.S} Rule`,
      `Structure: Direct Settlement in ${V.S}`,
      `Why ${V.C}`,
      'Unit Economics',
      'Supply Channels',
      'Compliance and Safeguards',
      'Plan and Next Steps',
    ],

    s1h: 'Executive Summary',
    s1lead: `The Programme purchases one thing inside ${V.Cn}: <strong>machine compute</strong> — GPU hours drawn from gaming clubs, university laboratories, offices and homes. It pays for every hour, without exception, in <strong>${V.S}</strong>, a stablecoin redeemable one-for-one for the ${c.adjective} ${c.currency}.`,
    s1p1: `The proposition to ${V.Cn} is not aid and not an export scheme. It is a demand line. AI inference that today is bought from data centres in Frankfurt, Virginia or Singapore is bought here instead — from hardware that already exists in the country — at a price competitive internationally, and the money lands in a wallet the same hour it is earned rather than in a correspondent bank three days later.`,
    s1p2: `The reason this is possible now, and was not possible three years ago, is the arrival of fiat-pegged stablecoins in local currencies. Client capital arrives in ${V.Cn} directly, in dollars or euros, is converted once into ${V.S}, and is paid out to the community — the people and institutions whose machines did the work. The payment corridor has one conversion and no intermediary token. Any reserve financing (§4.3) sits outside that corridor.`,
    s1k: [
      [money2(c.power), `Per kilowatt-hour, blended — cheap power keeps host net high; sold hours and card class set the yield.`],
      [money2(nh.nodeNet), `Net to the host per GPU-hour sold, after electricity, at the compute price the Programme pays (${money3(pay)}/M tokens).`],
      [`${machines}+`, `Consumer GPUs already installed in ${c.adjective} gaming clubs alone — before laboratories, offices and homes.`],
      ['100%', `Share of local payouts settled in ${V.S}. There is no second payment method.`],
    ],
    s1note: `<strong>The ask.</strong> A pilot: three universities, twenty gaming clubs and one hardware sponsor in ${V.Cn}, with ${V.S} payout live from week one. Everything in this document follows from that one loop working.`,

    s2h: 'What the Programme Buys: Compute',
    s2lead: `One supply line, aggregated from four sources. Each draws on hardware that is already bought, powered and online somewhere in the ${c.adjective} economy — it simply has no second shift.`,
    s2computeH: 'The unit — one GPU-hour',
    s2compute: `AI inference served from consumer graphics hardware. A single ${CARD.name} card (about ${money(gpuPrice)}) serves a small model at roughly ${nh.tokens / 1e6}M output tokens per hour under batched load — 1,500 tok/s. The Programme pays the host a compute price of about ${money3(pay)} per million tokens — ${money2(nh.gross)} per hour, against ${money2(nh.power)} of electricity at ${money2(c.power)} per kWh, leaving ${money2(nh.nodeNet)} net. Hosts are paid on metered tokens, not a nameplate hour. That same compute is resold to end clients within a band of ${priceRange} per million tokens — never below the host pay price; the spread funds the programme and is the issuer's operating return.`,
    s2sourcesH: 'Where the capacity comes from',
    s2sources: `Four channels aggregate it: gaming clubs idle outside peak play; university laboratories idle at night, on weekends and through vacations; hardware sponsors seeding prize GPUs into the community through tournaments and hackathons; and offices and homes with a spare GPU. No capacity is built for the Programme — it is drawn from what the country already owns.`,
    s2why: `The sources reinforce one another. A gaming club proves the install in a commercial room; a university turns the same install into a teaching asset; a sponsor's prize card ends up running in a club, a laboratory or a winner's home. One agent, one metering-and-payout rail, four ways to fill it.`,
    s2tblCap: 'Table 2.1 — The supply sources',
    s2tbl: [
      ['Gaming clubs', `≈ ${c.pcsPerClub} machines each, idle outside evening play`, `${money(clubTotal)}/club·mo`, 'Metered, verified'],
      ['University laboratories', 'Idle nights, weekends and vacations', `${money(labTotal)}/lab·mo`, 'Metered, verified'],
      ['Hardware sponsors', 'Prize GPUs awarded at community events', `${money(club.perPc)}/prize GPU·mo`, 'Sponsored, enrolled'],
      ['Homes & offices', 'Spare consumer GPUs, opt-in', `${money(club.perPc)}/GPU·mo`, 'Metered, verified'],
    ],
    s2tblHead: ['Source', 'What is idle', 'Indicative yield', 'Basis'],

    s3h: `The Pay-in-${V.S} Rule`,
    s3lead: `One rule governs every payment the Programme makes inside ${V.Cn}: <strong>it is denominated and settled in ${V.S}</strong>. Not in dollars with a local conversion. Not in a platform balance that later becomes money. In ${V.S}, at the moment the work is accepted.`,
    s3why: [
      ['The contributor keeps the spread', `A cross-border payout typically loses three to seven per cent to intermediary fees and the retail conversion spread. Settling natively in ${V.S} removes that leg entirely; the contributor receives what the Programme paid.`],
      ['Settlement is same-day', `Work accepted is paid the same day, typically within minutes once the contributor has a live wallet. First redemption into ${c.currency} follows the licensed off-ramp's hours.`],
      ['The unit of account is the one they live in', `A contributor prices their rent, their tuition and their groceries in ${c.currency}. Paying in ${c.currency} removes the currency risk from the person least able to hedge it.`],
      ['A bank account is not required', `A phone is enough where a licensed wallet or mobile-money off-ramp is available. This matters most for smaller operators and for hosts outside ${V.cap}.`],
      ['It is auditable end to end', `Every payout is an on-chain record against a screened identity — cleaner evidence for tax and for the regulator than a cash or card-transfer economy produces.`],
      ['It keeps value in the country', `The ${c.currency} is not converted out. It circulates: clubs pay rent, students pay tuition, and the float stays domestic.`],
    ],
    s3quote: `The rule is the product. A compute network that paid in dollars would be one more offshore hosting deal. Paying in ${V.S} is what makes it ${c.adjective} economic activity — the value settles and circulates at home rather than draining out.`,

    s4h: `Structure: Direct Settlement in ${V.S}`,
    s4lead: `The structure has three moving parts and exactly one currency conversion. International buyers of compute pay in USD or EUR to a licensed entity inside ${V.Cn}; that hard currency is converted once, at wholesale, into ${V.S}; and ${V.S} is paid out to the community that delivered the compute. The hard-currency-facing leg and the payout leg live in the same jurisdiction — there is no offshore hub in between.`,
    s4steps: [
      [`1. Capital enters in ${V.Cn}`, `An international buyer of compute pays in USD or EUR to a licensed local entity in ${V.cap}. The hard currency arrives in the economy where the work is done — not in a transit jurisdiction.`],
      [`2. One conversion, into ${V.S}`, `The dollars or euros are converted into ${V.S} once, at wholesale, through a licensed local venue. This is the only currency conversion in the chain, and the ${c.adjective} contributor never touches it.`],
      [`3. Payout to the community`, `The contributor — a student, a club owner, an engineer — receives ${V.S} the hour the work is accepted, and can hold it, spend it, or redeem it one-for-one for ${c.currency} through a licensed local off-ramp.`],
      [`4. The float stays domestic`, `${V.S} circulates inside the ${c.adjective} economy: clubs pay rent, students pay tuition, and redemption to ${c.currency} runs through licensed local off-ramps.`],
    ],
    s4back: `The return leg is symmetric. ${c.adjective} earnings that a contributor wishes to hold in hard currency move ${V.S} → USD or EUR at the same licensed wholesale venue, so the corridor is two-way rather than a one-way drain.`,
    s4whyGeo: `<strong>Why direct, and not via a hub.</strong> Three reasons: every extra hop in a payment adds a counterparty, a spread and a regulatory perimeter; the buyer's hard currency lands in the economy that did the work rather than in a transit jurisdiction; and the ${V.S} float is domestic from the first payment onward. On the payout rail: one conversion, one jurisdiction, no intermediary token.`,

    s4mintH: 'Minting in batches — a pilot first',
    s4mint: c.stableLive
      ? `The programme does not ask an issuer to mint an open-ended supply. It asks for a stablecoin to be minted in <strong>discrete batches</strong>, the first one small and treated as a pilot. In ${V.C}, ${V.S} already exists, so the first batch is a <em>proposal to the issuer</em> rather than a new instrument: mint a defined tranche against collateral, let the programme spend it into the compute economy, and review before any second tranche.`
      : `The programme does not ask an issuer to mint an open-ended supply. It asks for ${V.S} to be minted in <strong>discrete batches</strong>, the first one small and treated as a pilot. A partner issuer deposits collateral, mints one defined tranche, and the programme spends it into the ${c.adjective} compute economy — then everyone reviews the results before a second tranche is minted.`,
    s4mintSteps: [
      ['1. First batch — a pilot', `${c.stableLive ? `A minimum first batch of ${firstBatchLocal} ${c.iso} (${money(firstBatchUSD)})` : `A first batch of about ${firstBatchLocal} ${c.iso} (≈ ${money(firstBatchUSD)})`} is minted against the issuer's reserve. Small on purpose: at the pilot of twenty clubs and three laboratories that is about ${batchMonths} months of host payout — longer than the twelve-week pilot, so the batch is not spent in the pilot window.`],
      ['2. Spent on compute', `The minted ${V.S} is used to pay ${c.adjective} compute providers — clubs, laboratories, hosts — for the AI compute they deliver. This is the only thing the batch is spent on.`],
      ['3. Sold to clients for fiat', `That compute is resold to end clients, who pay in EUR, USD or GBP. This incoming hard currency is the issuer's operating return — it does not release the reserve that backs circulating coins.`],
      ['4. Review, then scale', `After the first batch the results are measured — utilisation, resale price, repayment speed — and the next, larger batch is planned on the evidence.`],
    ],
    s4splitH: 'How the issuer is paid',
    s4split: `Incoming client fiat is split between the issuer and the programme. On the <strong>first batch the split is 80 / 20</strong>: 80% is the issuer's share of operating revenue — toward documented costs plus a ${Math.round(BATCH.issuerMarkup * 100)}% target markup — and 20% funds programme operations. The reserve that backs circulating coins stays in place; this split is a coupon on that reserve, not a release of it. Collateral is released only as coins are redeemed and the batch retires. Both sides see the same cost ledger. As each batch retires, the issuer's share of later batches falls — 60/40, then 40/60, then 20/80 — while the batches themselves grow. At this country's host pay and the ${sellBase} reference sell, the ${onePassShares || 'listed'} splits recover the ${Math.round(BATCH.issuerMarkup * 100)}% target in one pass of the minted float; ${multiPassShares || 'later splits'} need more than one pass. The ${Math.round(BATCH.issuerMarkup * 100)}% is the target return on what is repaid, not a guarantee that any given split finishes in a single pass. The issuer earns most, earliest, when the risk is highest.`,
    s4splitCap: 'Figure 4.2 — Issuer vs ecosystem share of client fiat, by batch',
    s4splitCs: 'Bars widen as successive batches grow; the issuer share of operating revenue falls as their risk is retired',
    s4splitSizes: ['pilot', 'larger', 'larger still', 'at scale'],
    s4splitLabels: { issuer: 'to issuer (share of client fiat)', eco: 'to programme / ecosystem' },
    s4splitNote: `<strong>Why it is safe for the issuer.</strong> The first batch is small, the reserve stays 1:1-backed for as long as coins circulate, the issuer's share of operating revenue is front-loaded, and no second tranche is minted until the first has performed. The programme carries the execution risk; the issuer carries a short, fully reserved, marked-up claim on operating revenue.`,

    s4fundH: 'Where the reserve can come from — a privately placed note',
    s4fund: `The issuer's reserve does not have to come from its own balance sheet. It can be seeded by a privately placed note: a special-purpose vehicle in an international financial centre places notes with qualified international investors, and 100% of the proceeds are held as the batch's reserve at a custodian bank. This is reserve financing, not a hop in the payment corridor — buyers still pay the licensed entity in ${V.Cn}, and hosts are still paid in ${V.S}. ${V.S} is minted only against that reserve, so every coin in circulation remains fully redeemable at all times.`,
    s4fundSteps: [
      ['1. Notes placed privately', `A dedicated SPV issues the notes to qualified international investors by private placement only — never a public offer, in ${V.C} or anywhere else.`],
      ['2. Proceeds become the reserve', `100% of proceeds sit at a custodian bank as the batch's reserve. They are never spent on operations; ${V.S} is minted against them and stays 1:1 redeemable.`],
      ['3. Serviced by compute revenue', `The client-fiat split in 4.2 services the note coupon. Principal is repaid as coins are redeemed and reserve is released. Yield earned on the reserve can supplement the coupon.`],
      ['4. Risks never mix', `If compute sales disappoint, the reserve is intact and coin holders are unaffected; only noteholders miss the coupon. Coin risk and investor risk are structurally separated.`],
    ],
    s4fundNotice: `This section describes a financing structure, not an offer of securities. Any placement would be made only to qualified institutional investors, under the securities laws applicable to them, on the basis of full offering documentation.`,

    s5h: `Why ${V.C}`,
    s5lead: c.sectorNote,
    s5tblHead: ['Indicator', 'Value', 'Why it matters here'],
    s5tbl: [
      ['Population', c.population, 'Depth of the host base'],
      ['Gaming clubs (est.)', c.clubs, `≈ ${machines} consumer GPUs already installed`],
      ['Universities', c.universities, `${c.students} students — laboratories as the schools channel`],
      ['Electricity, blended', `${money2(c.power)}/kWh`, 'Keeps host net high; does not by itself set the yield'],
      ['Net per GPU-hour', money2(nh.nodeNet), 'Host share after electricity, at wholesale token price'],
      ['Utilisation (early net)', `${utilPct}%`, 'Share of offered idle hours actually sold'],
    ],

    s6h: 'Unit Economics',
    s6lead: 'Everything scales from one unit calculation: one hour of one machine.',
    s6t1cap: 'Table 6.1 — One compute-hour on one consumer GPU',
    s6t1: [
      ['Output tokens served', `${(nh.tokens / 1e6).toFixed(1)}M`, ''],
      ['Raw compute cost', `electricity + hardware wear`, `(${money3(cost)}/M)`],
      ['Compute price paid to host', `${money3(pay)} per million tokens`, money2(nh.gross)],
      ['Electricity (host)', `0.55 kWh × ${money2(c.power)}`, `(${money2(nh.power)})`],
      ['Host net per hour', '', money2(nh.nodeNet)],
    ],
    s6t1head: ['Line', 'Basis', 'USD'],
    s6note: `<strong>Two prices, one spread.</strong> The host is paid ${money3(pay)} per million tokens. The same tokens are sold to end clients within ${priceRange} per million (reference ${sellBase}) — the programme does not sell below the host pay price. The gap is the programme's margin and the issuer's operating return (§4). Figures assume an ${CARD.name} card at 1,500 tok/s. An older cafe GPU (${CARD.downsideName}, ~${CARD.downsideTokPerSec} tok/s) delivers about one-fifth the tokens; that hour nets ${money2(slow.nodeNet)} after electricity, and an ${club.pcs}-machine club about ${money(slowClub.total)}/month. Sold hours and card class set the yield; electricity is a thin slice of cost.`,
    s6chartH: 'Where each cent of the token price goes',
    s6chartCap: `Figure 6.1 — Cost, provider margin and our margin, per million tokens, by country`,
    s6chartCs: `United States dollars per million output tokens; reference sell price ${sellBase}; the black slice is mostly hardware wear — electricity is the thin slice that varies by country`,
    s6chartLabels: { cost: 'Compute cost (power + hardware)', prov: 'Provider margin', ours: 'Our margin' },
    s6scenH: 'Three go-to-market scenarios',
    s6scenLead: `Host pay is this country's actual price. Sell moves inside the published band. The three columns show how much of a first batch the issuer's 80% share recovers in a single pass of the minted float.`,
    s6scenCap: 'Figure 6.2 — This country’s pay, three sell prices, first-batch recovery',
    s6scenCs: 'United States dollars per million tokens; recovery = 80% issuer share of (sell ÷ pay) ÷ 1.10',
    s6scenLabels: {
      names: ['Modest', 'Reference', 'Premium'],
      subs: ['floor sell', 'reference sell', 'ceiling sell'],
      slow: 'PARTIAL — NEEDS VOLUME', ok: 'REPAYS IN ONE PASS', fast: 'REPAYS FAST, ROOM TO GROW',
    },
    s6scenNote: `Recovery above 100% means one pass of the minted stablecoin, once resold, covers the issuer's 10% target on that pass — so the next batch can be larger. Below 100%, the target is reached over additional volume. Later batches at a 40% or 20% issuer share need more than one pass at these prices.`,

    s7h: 'Supply Channels',
    s7lead: 'Capacity is not bought one machine at a time. Four channels aggregate it, and each has a dedicated proposal deck accompanying this document.',
    s7ch: [
      [`Stablecoin & institutions`, `The ${V.S} rail itself: the central-bank and licensed-issuer relationship, the on- and off-ramps, and the wholesale USD/EUR conversion.`],
      [`Gaming clubs`, `${c.clubs} clubs, roughly ${c.pcsPerClub} machines each. Play peaks in the evening; the machines are idle the rest of the day. A club of ${club.pcs} earns approximately ${money(clubTotal)} per month, or ${fmtLocal(c, clubTotal)}, at ${utilPct}% sold utilisation and with no capital expenditure.`],
      [`Hardware sponsors`, `Brands and distributors sponsor the community rather than a sales channel: $5,000 a season plus hardware awarded as prizes at tournaments, hackathons and campus events. There is no AI without GPUs — the sponsor's hardware sits at the centre of the community being built, and prize cards enrolled in the network keep earning for their winners, roughly ${money(club.perPc)} a month each.`],
      [`Schools & universities`, `${c.universities} institutions, ${c.students} students. University laboratories earn from idle hours — roughly ${money(labTotal)} per month for a forty-seat lab at ${utilPct}% sold utilisation — turning a cost centre into a funded asset, with an AI-operations curriculum supplied alongside.`],
    ],

    s8h: 'Compliance and Safeguards',
    s8lead: 'The Programme is deliberately narrow about what it is. It buys services and pays for them. It does not take deposits, does not offer investment returns to the public, and does not operate an exchange.',
    s8list: [
      ['Identity and screening', `Every contributor is identity-verified before their first payout; every fiat on- and off-ramp is operated by a locally licensed provider under its own KYC and AML obligations.`],
      ['Issuer-level controls', `The stablecoin issuer performs sanctions and OFAC screening at the instrument level and retains the ability to freeze illicit balances.`],
      ['Tax transparency', `Payouts are individually recorded and reportable. The Programme will provide contributors with annual statements in the form the ${c.adjective} tax authority requires.`],
      ['Local counsel', `Licensing and regulatory counsel is engaged in ${V.Cn} before the pilot opens, not after.`],
      ['Institutional safeguards', `Laboratory participation is opt-in and governed by an agreement: teaching load always has priority, compute yields instantly when a room is needed, no personal data leaves the country, and the institution may withdraw at any time.`],
    ],
    s8note: `<strong>What the Programme is not.</strong> It is not a money-services business, not a deposit-taker, and not a securities issuer. It is a buyer of services that happens to settle in a regulated stablecoin instead of by bank transfer.`,

    s9h: 'Plan and Next Steps',
    s9lead: 'The pilot is small on purpose. It exists to prove one loop end to end — work in, payout out, in ${S}, verifiably — before anything is scaled.',
    s9tblHead: ['Phase', 'Weeks', 'Milestone'],
    s9tbl: [
      ['Preparation', '0–4', `Local counsel engaged; ${V.S} on- and off-ramp partner appointed; USD/EUR → ${V.S} conversion tested at wholesale`],
      ['Pilot', '4–12', `Three universities, twenty gaming clubs, one hardware sponsor; first ${V.S} payouts in week five`],
      ['Measurement', '12–16', 'Contributor retention, payout latency, dispute rate and capacity delivered, all published'],
      ['Scale', '16+', 'Channel-by-channel expansion on the evidence from the pilot'],
    ],
    s9ask: [
      ['From government', `A statement of no objection for ${V.S} payouts to residents, and a named point of contact.`],
      ['From institutions', `Three universities and twenty clubs willing to run a twelve-week pilot at no cost to them.`],
      ['From partners', `One hardware sponsor and one licensed on/off-ramp.`],
    ],
    s9notice: 'This document is furnished for the purpose of discussion only. It does not constitute an offer to sell, or the solicitation of an offer to buy, any security or financial instrument. All figures are illustrative outputs of an internal model based upon the stated assumptions; they are estimates rather than audited statistics and actual results will differ. Nothing herein constitutes legal, tax, financial or investment advice. The regulatory treatment of stablecoins is evolving, and operation is contingent upon obtaining and maintaining applicable licences and upon the identity, anti-money-laundering and sanctions obligations described above.',

    /* ---------- shared deck chrome ---------- */
    contactK: 'Next step',
    contactH: 'A thirty-minute call, then a twelve-week pilot.',
    contactSub: 'Nothing in this deck requires a budget decision. It requires a room and a date.',
    contactFill: 'Telegram - @bogidotcom',

    corrTitle: 'THE CORRIDOR',
    corrAria: `Capital flows from USD and EUR directly into ${V.S} and to the ${c.adjective} community`,
    corr1t: 'USD / EUR',
    corr1s: 'International buyer of compute',
    corr2t: `${V.C}`,
    corr2s: `Licensed local entity · ${V.cap}`,
    corr3t: `${V.S}`,
    corr3s: 'Wholesale conversion, executed once',
    corr4t: 'Community payout',
    corr4s: `${c.adjective} people and machines, in ${V.S}`,
    corrBack: `Return leg — ${V.S} → USD / EUR, same wholesale venue`,

    /* ---------- deck: stablecoin ---------- */
    d1: {
      track: 'Stablecoin rail',
      cover: `Every hour of work<br>bought in ${V.Cn}<br>is paid in <span class="hl">${V.S}</span>.`,
      coverSub: `A demand line for ${c.adjective} compute, settled natively in ${c.currency} — dollars and euros in, ${V.S} out to the community.`,
      s2k: 'The rule',
      s2h: `One payment method. No exceptions.`,
      s2fig: [
        ['100%', `of local payouts settled in ${V.S}`],
        ['0', 'correspondent banks in the chain'],
        ['Same day', 'from work accepted to wallet credit'],
      ],
      s3k: 'What it replaces',
      s3h: 'The cost of getting paid across a border.',
      s3bars: [
        { l: 'Bank wire + retail FX', v: 6.5, t: '5–8% lost', strong: false },
        { l: 'Card / remittance app', v: 4.0, t: '3–5% lost', strong: false },
        { l: `Native ${V.S}`, v: 0.3, t: '≈ 0%', strong: true },
      ],
      s3note: '',
      s4k: 'Structure',
      s4h: `Dollars in. ${V.S} out. One conversion.`,
      s5k: 'Why direct',
      s5h: 'The money lands where the work is done.',
      s5cards: [
        ['One conversion', `USD/EUR converts to ${V.S} once, at wholesale, through a licensed local venue — the contributor never touches FX.`],
        ['No intermediary on the rail', `On the payout rail: no transit jurisdiction, no intermediary token. Reserve financing, if used, sits outside that rail.`],
        ['Float stays home', `Payouts are denominated in ${c.currency}; the float circulates in ${V.Cn} instead of draining out.`],
      ],
      s6k: `What ${V.S} buys`,
      s6h: `One thing, priced by the hour.`,
      s6a: ['We pay the host', `${money3(pay)}<span style="font-size:14pt">/M tok</span>`, `The compute price paid to ${c.adjective} hosts — driven by local electricity and hardware.`],
      s6b: ['We sell to clients', `${priceRange}<span style="font-size:14pt">/M tok</span>`, `The band we resell that compute for — never below host pay. The spread funds the programme and is the issuer's operating return.`],
      // batch minting
      dMintK: 'The mechanism',
      dMintH: 'Mint in batches. Start with a pilot.',
      dMintSteps: [
        ['Mint', `${c.stableLive ? `${firstBatchLocal} ${c.iso}` : `≈ ${firstBatchLocal} ${c.iso}`} (${money(firstBatchUSD)}) against the issuer's collateral.`],
        ['Pay', `Spent only on ${c.adjective} compute — clubs, labs, hosts.`],
        ['Sell', `Compute resold to clients for EUR / USD / GBP.`],
        ['Review', `Measure, then plan a larger next batch.`],
      ],
      dMintNote: c.stableLive
        ? `${V.S} already exists — so for ${V.C} this is a proposal to the issuer, not a new coin.`
        : `A partner issuer mints ${V.S} in tranches; no open-ended supply.`,
      // split ladder
      dSplitK: 'Operating return',
      dSplitH: 'Client fiat is the issuer’s coupon — the reserve stays put.',
      dSplitSizes: ['pilot', 'larger', 'larger still', 'at scale'],
      dSplitLabels: { issuer: 'to issuer (share of client fiat)', eco: 'to ecosystem' },
      dSplitNote: `First batch splits 80/20. The 80% is operating revenue toward costs plus a ${Math.round(BATCH.issuerMarkup * 100)}% target — not a release of the 1:1 reserve. The ${onePassShares} splits recover that target in one pass at the reference sell; ${multiPassShares} need more volume. Share falls as risk retires; batches grow.`,
      // offshore note funding
      dFundK: 'Reserve funding',
      dFundH: 'A privately placed note can seed the reserve.',
      dFundCards: [
        ['Placed privately', `An SPV in an international financial centre places notes with qualified international investors — never a public offer.`],
        ['100% into reserve', `Proceeds sit at a custodian bank as the batch's reserve; ${V.S} is minted against them and stays 1:1 redeemable.`],
        ['Serviced by compute', `The 4.2 client-fiat split services the coupon. Principal returns as coins are redeemed and reserve is released.`],
        ['Risks never mix', `Coin holders are backed by the intact reserve; only noteholders miss the coupon if sales disappoint.`],
      ],
      dFundNote: `A structure, not an offer — private placement to qualified institutional investors only. This finances the reserve; it is not a hop in the payment corridor.`,
      // cost vs sell chart
      dCostK: 'The two prices',
      dCostH: 'Cheap to produce. Sold for more.',
      dCostLabels: { cost: 'Compute cost (power + hardware)', prov: 'Provider margin', ours: 'Our margin' },
      dCostNote: `The black slice is mostly hardware wear; electricity is the thin country-varying slice. Sell is set by the client market and is never below host pay. The gap is the issuer's operating return.`,
      // scenarios
      dScenK: 'Three scenarios',
      dScenH: 'This country’s pay. Three sell prices.',
      dScenLabels: {
        names: ['Modest', 'Reference', 'Premium'],
        subs: ['floor sell', 'reference sell', 'ceiling sell'],
        slow: 'PARTIAL', ok: 'ONE PASS', fast: 'FAST + HEADROOM',
      },
      dScenNote: `Recovery = 80% issuer share of (sell ÷ pay) ÷ 1.10, using this country's host pay. Above 100%, the next batch can be bigger.`,
      s7k: `Value to ${V.C}`,
      s7h: 'The money is earned abroad and spent at home.',
      s7strip: [
        [money(clubTotal), `per club each month, from idle machines`],
        [`${machines}`, `consumer GPUs already installed in ${V.Cn}`],
        ['100%', `of earnings denominated in ${c.currency} — the float stays domestic`],
        [money2(c.power), `per kWh — cheap power; sold hours and card class set the yield`],
      ],
      s8k: 'Compliance',
      s8h: 'Narrow by design.',
      s8pills: ['Identity-verified contributors', 'Licensed local on/off-ramps', 'Issuer-level sanctions screening', 'Annual tax statements', 'Not a deposit-taker', 'Not an exchange', 'Local counsel before launch'],
      s9k: 'The pilot',
      s9h: 'Twelve weeks. No public money.',
      s9steps: [
        { k: 'W0', t: 'Counsel + ramp partner', s: 'Licensing confirmed' },
        { k: 'W4', t: 'Pilot opens', s: '3 universities · 20 clubs' },
        { k: 'W5', t: `First ${V.S} payouts`, s: 'The loop proven', hi: true },
        { k: 'W12', t: 'Results published', s: 'Retention · latency · capacity' },
      ],
      s10k: 'The ask',
      s10h: 'A statement of no objection, and a named contact.',
      s10sub: `Everything else — capital, hardware, engineering, counsel — is brought by the Programme.`,
    },

    /* ---------- deck: gaming clubs ---------- */
    d2: {
      track: 'Gaming clubs',
      cover: `Your club earns<br>when nobody<br>is <span class="hl">playing</span>.`,
      coverSub: `The machines are already bought, already powered and already online. Between sessions they can sell AI compute — and you are paid weekly in ${V.S}.`,
      s2k: 'The problem',
      s2h: 'You bought the machines for fourteen hours a day. You use them for five.',
      s2ring: ['5h', 'peak play per machine'],
      s2note: `Every hour outside peak is a card you have paid for, cooled and insured, producing nothing.`,
      s3k: 'What changes',
      s3h: 'Nothing you can see from the floor.',
      s3cards: [
        ['One install', 'A single agent per machine. Fifteen minutes for the room. No hardware change.'],
        ['Players always win', 'A session starts, compute stops instantly. Frame rates are never touched.'],
        ['Off any time', 'One switch, per machine or per club. No contract term, no penalty.'],
      ],
      s4k: 'The number',
      s4h: `What ${club.pcs} machines earn.`,
      s4figs: [
        [money2(nh.nodeNet), 'per machine, per idle hour actually sold'],
        [money(club.perPc), `per machine, per month`],
        [money(clubTotal), `per club, per month`, fmtLocal(c, clubTotal)],
      ],
      s4note: `Assumes ${club.pcs} machines offering ${club.hoursPerDay} idle hours a day, of which ${utilPct}% are actually sold, at ${money2(c.power)}/kWh. Electricity is already deducted. Utilisation rises as the network grows; the figures above are the early-network case.`,
      s5k: 'Over a year',
      s5h: `${money(clubYear)} — or ${fmtLocal(c, clubYear)}.`,
      s5bars: [
        { l: '1 club', v: clubTotal, t: money(clubTotal) },
        { l: '5 clubs', v: clubTotal * 5, t: money(clubTotal * 5) },
        { l: '20 clubs', v: clubTotal * 20, t: money(clubTotal * 20), strong: true },
      ],
      s5sub: 'Monthly, net of electricity. A twenty-club chain covers a manager, a refit, or the next twenty machines.',
      s6k: 'Capacity',
      s6h: `${c.clubs} clubs. ${(Number(c.clubs.replace(/\D/g, '')) * c.pcsPerClub).toLocaleString('en-US')} machines already installed in ${V.Cn}.`,
      s6sub: 'The largest pool of idle graphics hardware in the country is already built, powered and staffed. It just has no second shift.',
      s7k: 'How you are paid',
      s7h: `Weekly, in ${V.S}, to a phone.`,
      s7cards: [
        [`In ${c.currency}`, `${V.S} is redeemable one-for-one for ${c.currency}. You are not taking a currency bet.`],
        ['Weekly, automatic', 'Earnings accrue per machine per hour and settle every week. No invoice, no minimum.'],
        ['No bank required', 'A phone is enough. Spend it, hold it, or take it to a licensed off-ramp.'],
      ],
      s8k: 'Getting started',
      s8h: 'Seven days from handshake to first payout.',
      s8steps: [
        { k: 'DAY 1', t: 'Agreement', s: 'One page. No term.' },
        { k: 'DAY 2', t: 'Install', s: '15 min for the room' },
        { k: 'DAY 3', t: 'First idle hours', s: 'Overnight, automatically' },
        { k: 'DAY 7', t: 'First payout', s: `In ${V.S}`, hi: true },
      ],
      s9k: 'The ask',
      s9h: 'Five machines. One week. Then decide.',
      s9sub: 'Run it on five machines in your quietest room. If the number is not what this deck says, uninstall it and we have wasted a week of your time and none of your money.',
    },

    /* ---------- deck: hardware sponsorship ---------- */
    d3: {
      track: 'Hardware sponsorship',
      cover: `There is no AI<br>without <span class="hl">GPUs</span>.`,
      coverSub: `We are building the ${c.adjective} AI community — gaming clubs, campuses, tournaments, hackathons. A sponsorship puts your hardware at the centre of it: $5,000 a season, plus hardware as prizes.`,
      s2k: 'The community',
      s2h: 'Already installed, already playing. It just has no sponsor.',
      s2strip: [
        [c.clubs, 'gaming clubs'],
        [machines, 'machines in those clubs'],
        [c.universities, 'universities with laboratories'],
        [c.students, 'students, each a future buyer'],
      ],
      s3k: 'The package',
      s3h: 'One season. Two commitments.',
      s3a: ['Cash', `$5,000<span style="font-size:14pt">/season</span>`, `Funds venues, prize pools and production for a season of tournaments, hackathons and campus open days across the pilot cities.`],
      s3b: ['Hardware', `+ prizes`, `GPUs and gear awarded on stage, unboxed in front of the room — then enrolled in the network, where a prize card keeps earning its winner ≈ ${money(club.perPc)} a month.`],
      s4k: 'What your brand gets',
      s4h: 'On every stage, in every pair of hands.',
      s4cards: [
        ['Naming & stage', 'Title placement at every event of the season — tournaments, hackathons and open days across the pilot cities.'],
        ['Hands-on demos', 'A demo floor at each event: players and students meet your hardware first, in the room where buying decisions start.'],
        ['Winner stories', 'Prizes are unboxed on stage and streamed; a prize GPU that keeps earning in the network is a story that runs for months.'],
      ],
      s5k: 'Why it works',
      s5h: 'You are not buying impressions. You are building your market.',
      s5cards: [
        ['Future buyers', `${c.students} students and the country's club players are the next generation of GPU buyers — met at the moment they choose a brand.`],
        ['A prize that keeps paying', 'A prize card enrolled in the network earns its winner real money every month. Your brand is on that payout.'],
        ['The community runs on you', 'Every hackathon model, every club tournament, every lab session in the programme runs on sponsored hardware.'],
      ],
      s6k: 'Sponsorship formats',
      s6h: 'Three ways in.',
      s6tbl: [
        ['Title sponsor', '$5,000 a season + hardware prizes', 'Naming, stage, logo on everything'],
        ['Prize sponsor', 'GPUs and peripherals awarded on stage', 'Unboxing moment, winner content'],
        ['Demo floor', 'A hands-on zone at every event', 'First touch with future buyers'],
      ],
      s6head: ['Format', 'What it is', 'What you get'],
      s7k: 'Reach',
      s7h: 'Where your brand appears.',
      s7cards: [
        ['Clubs', `${c.clubs} venues — the room where the buying decision is actually made.`],
        ['Campuses', `${c.universities} institutions, ${c.students} students, with a taught AI curriculum attached.`],
        ['Events', 'A season of tournaments, hackathons and open days across the pilot cities.'],
      ],
      s8k: 'The ask',
      s8h: 'One season. $5,000 + hardware as prizes.',
      s8sub: 'Sponsor the first season of community events. If the community it builds is not worth the badge, walk away after one season.',
    },

    /* ---------- deck: schools ---------- */
    d4: {
      track: 'Schools & universities',
      cover: `Laboratories that<br>pay for <span class="hl">themselves</span>.`,
      coverSub: `University computer laboratories sit idle at night, on weekends and through vacations. In those hours they can sell AI compute — and the institution is paid in ${V.S}.`,
      s2k: 'The idle asset',
      s2h: 'Bought for teaching hours. Idle for most of them.',
      s2a: ['Idle compute', `${money(labTotal)} / month`, `A forty-seat laboratory offering sixteen idle hours a day at ${utilPct}% sold utilisation, net of electricity.`],
      s2b: ['Over a year', `${money(labTotal * 12)}`, `Per forty-seat laboratory, net of electricity — with no capital cost to the institution.`],
      s3k: 'The number',
      s3h: `${money(labTotal)} a month per laboratory. ${money(labTotal * 3)} across a three-campus pilot.`,
      s3bars: [
        { l: '1 laboratory', v: labTotal, t: money(labTotal) },
        { l: '3 laboratories', v: labTotal * 3, t: money(labTotal * 3), strong: true },
        { l: '10 laboratories', v: labTotal * 10, t: money(labTotal * 10), strong: true },
      ],
      s3sub: `Monthly, in ${c.currency}, net of electricity. Payout is to the institution the same hour the compute is sold — no bank account, no invoice.`,
      s4k: 'For the institution',
      s4h: 'A laboratory stops being a cost centre.',
      s4cards: [
        ['Revenue from idle hours', `Nights, weekends and vacations — roughly ${money(labTotal)} a month per forty-seat laboratory, net of electricity.`],
        ['A curriculum, supplied', 'Modules in AI operations, model evaluation and data curation — so the machines teach as well as earn.'],
        ['No capital cost', 'The hardware already exists. One agent per machine, installed in half a day of staff time.'],
      ],
      s5k: 'Safeguards',
      s5h: 'Non-negotiable, and written into the agreement.',
      s5pills: ['Opt-in only', 'Teaching load always has priority', 'Compute stops instantly when a room is needed', 'Institutional consent required', 'No personal data leaves the country', 'Withdraw at any time'],
      s6k: 'Deployment',
      s6h: 'Two weeks, one laboratory, no capital cost.',
      s6steps: [
        { k: 'WEEK 1', t: 'Agreement', s: 'One laboratory, opt-in' },
        { k: 'WEEK 2', t: 'Install', s: 'Half a day of staff time' },
        { k: 'WEEK 3', t: 'First payout', s: `In ${V.S}`, hi: true },
        { k: 'WEEK 12', t: 'Review', s: 'Expand, or stop' },
      ],
      s7k: 'At pilot scale',
      s7h: 'Three universities. Ten laboratories.',
      s7strip: [
        ['3', 'universities in the pilot'],
        ['10', 'laboratories earning'],
        [money(labTotal * 10), 'per month to the institutions'],
        [`${utilPct}%`, 'of idle hours sold — rising as the network grows'],
      ],
      s8k: 'The ask',
      s8h: 'One laboratory, for twelve weeks.',
      s8sub: 'No capital cost, no exclusivity, and the institution may end it in a week at any point.',
    },

    /* ---------- generic deck strings ---------- */
    assumptions: `Figures are internal modelling estimates on stated assumptions — an ${CARD.name} card at 1,500 output tokens per second (older cafe cards at ~${CARD.downsideTokPerSec} tok/s scale tokens and client revenue by about one-fifth), electricity at ${money2(c.power)}/kWh, a compute price paid to hosts of ${money3(pay)}, a client sell price within ${priceRange} per million output tokens (reference ${sellBase}; never below host pay), and ${utilPct}% of offered hours actually sold. They are not audited statistics and are not a forecast.`,
  };
}

/* ======================================================================= */
/*  RUSSIAN                                                                */
/* ======================================================================= */

function RU(c, V, m) {
  const { nh, club, clubTotal, clubYear, labTotal, gpuPrice, gpuPayback, utilPct,
          priceRange, sellBase, pay, cost, firstBatchLocal, firstBatchUSD,
          slow, slowClub, onePassShares, multiPassShares, batchMonths } = m;
  const machines = (Number(c.clubs.replace(/\D/g, '')) * c.pcsPerClub).toLocaleString('ru-RU');
  const cName = c.cc === 'am' ? 'Армении' : 'Кыргызстане';
  const cNom  = c.cc === 'am' ? 'Армения' : 'Кыргызстан';
  const cGen  = c.cc === 'am' ? 'Армении' : 'Кыргызстана';
  const adjRu = c.cc === 'am' ? 'армянского' : 'кыргызского';
  const adjRuPl = c.cc === 'am' ? 'армянских' : 'кыргызских';
  const curRu = c.cc === 'am' ? 'драме' : 'соме';
  const curRuNom = c.cc === 'am' ? 'драм' : 'сом';
  const curRuGen = c.cc === 'am' ? 'драма' : 'сома';
  const capRu = c.cc === 'am' ? 'Ереване' : 'Бишкеке';
  const capRuNom = c.cc === 'am' ? 'Ереван' : 'Бишкек';

  return {
    lang: 'ru', dir: 'ltr',
    org: 'Программа ИИ-вычислений',
    confidential: 'Конфиденциально',
    date: 'Июль 2026',
    page: 'Стр.',

    docTitle: `${cNom} — программа вычислений`,
    docHead: `Местные вычисления,<br>местные деньги`,
    docSub: `Программа закупки ИИ-мощностей внутри ${cGen} с оплатой каждого часа в ${V.S} — стейблкоине, привязанном к ${curRu}.`,
    docClass: 'Конфиденциально — для обсуждения',
    metaFor: 'Подготовлено для',
    metaForV: 'Министерств, университетов, операторов и партнёров',
    metaJur: 'Юрисдикция',
    metaJurV: `${cNom} · расчёты внутри страны в ${V.S}`,
    metaSub: 'Предмет',
    metaSubV: `Доступ к ${adjRu} вычислениям с расчётами в ${V.S}`,
    docNotice: 'Документ предоставляется для обсуждения. Он не является предложением ценных бумаг и не является инвестиционной, юридической или налоговой консультацией. Все цифры — внутренние модельные оценки при указанных допущениях.',

    toc: [
      'Резюме',
      'Что закупает программа: вычисления',
      `Правило оплаты в ${V.S}`,
      `Структура: расчёты напрямую в ${V.S}`,
      `Почему ${cNom}`,
      'Юнит-экономика',
      'Каналы предложения',
      'Комплаенс и гарантии',
      'План и следующие шаги',
    ],

    s1h: 'Резюме',
    s1lead: `Программа закупает в ${cName} одну вещь: <strong>машинные вычисления</strong> — GPU-часы из компьютерных клубов, университетских лабораторий, офисов и домов. Каждый час оплачивается без исключений в <strong>${V.S}</strong> — стейблкоине, погашаемом один к одному в ${curRu}.`,
    s1p1: `Для ${cGen} это не помощь и не экспортная схема, а линия спроса. ИИ-инференс, который сегодня покупают у дата-центров во Франкфурте, Вирджинии или Сингапуре, покупается здесь — на оборудовании, которое уже есть в стране, — по цене, конкурентной на международном рынке, и деньги приходят в кошелёк в тот же час, а не в банк через три дня.`,
    s1p2: `Это стало возможно только сейчас — благодаря появлению стейблкоинов с привязкой к местной валюте. Капитал клиента приходит в ${cName} напрямую, в долларах или евро, один раз конвертируется в ${V.S} и выплачивается сообществу — людям и учреждениям, чьи машины выполнили работу. В платёжном коридоре одна конвертация и нет промежуточного токена. Любое финансирование резерва (§4.3) стоит вне этого коридора.`,
    s1k: [
      [money2(c.power), `За киловатт-час — дешёвая энергия держит чистыми хоста высокими; доход задают проданные часы и класс карты.`],
      [money2(nh.nodeNet), `Чистыми хосту за проданный GPU-час, после электроэнергии, при цене компенсации ${money3(pay)} за миллион токенов.`],
      [`${machines}+`, `Потребительских GPU уже установлено только в ${adjRuPl} компьютерных клубах — до лабораторий, офисов и домов.`],
      ['100%', `Доля местных выплат в ${V.S}. Второго способа оплаты нет.`],
    ],
    s1note: `<strong>Запрос.</strong> Пилот: три университета, двадцать компьютерных клубов и один спонсор по оборудованию в ${cName}, с выплатами в ${V.S} с первой недели. Всё остальное в этом документе следует из того, что этот контур работает.`,

    s2h: 'Что закупает программа: вычисления',
    s2lead: `Одна линия предложения, агрегируемая из четырёх источников. Каждый опирается на оборудование, которое уже куплено, запитано и в сети где-то в экономике ${cGen}, — у него просто нет второй смены.`,
    s2computeH: 'Единица — один GPU-час',
    s2compute: `ИИ-инференс на потребительских видеокартах. Одна карта класса ${CARD.name} (около ${money(gpuPrice)}) выдаёт около ${nh.tokens / 1e6} млн выходных токенов в час при пакетной нагрузке — 1 500 ток/с. Программа платит хосту около ${money3(pay)} за миллион токенов — ${money2(nh.gross)} в час против ${money2(nh.power)} на электроэнергию по ${money2(c.power)} за кВт·ч, оставляя ${money2(nh.nodeNet)} чистыми. Хосту платят по учтённым токенам, а не за номинальный час. Те же вычисления перепродаются в диапазоне ${priceRange} за миллион — никогда ниже цены хоста; спред финансирует программу и составляет операционный доход эмитента.`,
    s2sourcesH: 'Откуда берётся мощность',
    s2sources: `Её агрегируют четыре канала: компьютерные клубы, простаивающие вне пика игры; университетские лаборатории, пустующие ночами, по выходным и в каникулы; спонсоры оборудования, передающие призовые GPU сообществу через турниры и хакатоны; офисы и дома со свободной GPU. Ни одна мощность не строится под программу — она берётся из того, чем страна уже владеет.`,
    s2why: `Источники усиливают друг друга. Клуб доказывает установку в коммерческом зале; университет превращает ту же установку в учебный актив; призовая карта спонсора оказывается в клубе, лаборатории или дома у победителя. Один агент, одни рельсы учёта и выплат, четыре способа их наполнить.`,
    s2tblCap: 'Таблица 2.1 — Источники предложения',
    s2tbl: [
      ['Компьютерные клубы', `≈ ${c.pcsPerClub} машин, простой вне вечерней игры`, `${money(clubTotal)}/клуб·мес`, 'По счётчику, с верификацией'],
      ['Университетские лаборатории', 'Простой ночами, по выходным и в каникулы', `${money(labTotal)}/лаб·мес`, 'По счётчику, с верификацией'],
      ['Спонсоры оборудования', 'Призовые GPU вручаются на событиях сообщества', `${money(club.perPc)}/приз·мес`, 'Спонсорство, подключено'],
      ['Дома и офисы', 'Свободные потребительские GPU, добровольно', `${money(club.perPc)}/GPU·мес`, 'По счётчику, с верификацией'],
    ],
    s2tblHead: ['Источник', 'Что простаивает', 'Ориентировочный доход', 'Основание'],

    s3h: `Правило оплаты в ${V.S}`,
    s3lead: `Каждый платёж программы внутри ${cGen} подчиняется одному правилу: <strong>он номинирован и исполняется в ${V.S}</strong>. Не в долларах с местной конвертацией. Не балансом платформы, который когда-нибудь станет деньгами. В ${V.S}, в момент приёмки работы.`,
    s3why: [
      ['Спред остаётся у исполнителя', `Трансграничная выплата обычно теряет от трёх до семи процентов на комиссиях посредников и розничном курсе. Расчёт напрямую в ${V.S} убирает это звено целиком.`],
      ['Расчёт в тот же день', `Принятая работа оплачивается в тот же день, обычно за минуты после того, как у исполнителя есть живой кошелёк. Первое погашение в ${curRu} идёт по часам лицензированного офф-рампа.`],
      ['Единица счёта — та, в которой человек живёт', `Исполнитель считает аренду, учёбу и продукты в ${curRu}. Оплата в ${curRu} снимает валютный риск с того, кто хуже всех может его захеджировать.`],
      ['Банковский счёт не обязателен', `Достаточно телефона, если есть лицензированный кошелёк или мобильный офф-рамп. Особенно важно для небольших операторов и для тех, кто живёт не в ${capRu}.`],
      ['Полная прослеживаемость', `Каждая выплата — запись в реестре против проверенной личности. Для налоговой и регулятора это чище, чем наличная экономика.`],
      ['Стоимость остаётся в стране', `${curRuNom.charAt(0).toUpperCase() + curRuNom.slice(1)} не выводится. Он обращается: клубы платят аренду, студенты — за учёбу, а объём остаётся внутри страны.`],
    ],
    s3quote: `Правило и есть продукт. Сеть, платящая в долларах, была бы очередной офшорной сделкой по хостингу. Оплата в ${V.S} превращает это в экономическую активность ${cGen} — стоимость оседает и обращается дома, а не утекает наружу.`,

    s4h: `Структура: расчёты напрямую в ${V.S}`,
    s4lead: `В структуре три звена и ровно одна конвертация валюты. Международные покупатели вычислений платят в USD или EUR лицензированному юрлицу внутри ${cGen}; твёрдая валюта один раз, оптом, конвертируется в ${V.S}; и ${V.S} выплачивается сообществу, которое поставило вычисления. Звено твёрдой валюты и звено выплат находятся в одной юрисдикции — офшорного хаба между ними нет.`,
    s4steps: [
      ['1. Капитал входит в страну', `Международный покупатель вычислений платит в USD или EUR лицензированному местному юрлицу в ${capRu}. Твёрдая валюта приходит в ту экономику, где выполняется работа, а не в транзитную юрисдикцию.`],
      [`2. Одна конвертация — в ${V.S}`, `Доллары или евро один раз, оптом, конвертируются в ${V.S} через лицензированную местную площадку. Это единственная конвертация в цепочке, и исполнитель её не касается.`],
      ['3. Выплата сообществу', `Исполнитель — студент, владелец клуба, инженер — получает ${V.S} в тот же час, когда работа принята, и может держать его, тратить или погасить один к одному в ${curRu} через лицензированный местный офф-рамп.`],
      ['4. Объём остаётся в стране', `${V.S} обращается внутри экономики ${cGen}: клубы платят аренду, студенты — за учёбу, а погашение в местную валюту идёт через лицензированные офф-рампы.`],
    ],
    s4back: `Обратное плечо симметрично. Заработок, который исполнитель хочет держать в твёрдой валюте, идёт ${V.S} → USD или EUR на той же лицензированной оптовой площадке, поэтому коридор двусторонний, а не односторонний отток.`,
    s4whyGeo: `<strong>Почему напрямую, а не через хаб.</strong> Три причины: каждое лишнее звено платежа добавляет контрагента, спред и регуляторный периметр; твёрдая валюта покупателя оседает в экономике, которая выполнила работу, а не в транзитной юрисдикции; и объём ${V.S} остаётся внутри страны с первого платежа. На рельсах выплат: одна конвертация, одна юрисдикция, никакого промежуточного токена.`,

    s4mintH: 'Выпуск партиями — сначала пилот',
    s4mint: `Программа не просит эмитента выпускать неограниченный объём. Она просит выпускать ${V.S} <strong>дискретными партиями</strong>, первая из которых мала и считается пилотом. Партнёр-эмитент вносит залог, выпускает одну определённую партию, и программа тратит её в вычислительную экономику ${cGen} — после чего все стороны оценивают результат до выпуска следующей партии.`,
    s4mintSteps: [
      ['1. Первая партия — пилот', `Первая партия — около ${firstBatchLocal} ${c.iso} (≈ ${money(firstBatchUSD)}) — выпускается под резерв эмитента. Намеренно мало: на пилоте из двадцати клубов и трёх лабораторий это около ${batchMonths} месяцев выплат хостам — дольше двенадцатинедельного пилота, так что партия не тратится в окне пилота.`],
      ['2. Тратится на вычисления', `Выпущенный ${V.S} идёт на оплату ${adjRuPl} провайдеров вычислений — клубов, лабораторий, хостов — за поставленный ИИ-компьют. Больше партия ни на что не тратится.`],
      ['3. Продаётся клиентам за фиат', `Эти вычисления перепродаются конечным клиентам, которые платят в EUR, USD или GBP. Эта входящая твёрдая валюта — операционный доход эмитента; она не высвобождает резерв, который обеспечивает монеты в обращении.`],
      ['4. Оценка, затем масштаб', `После первой партии измеряются результаты — загрузка, цена перепродажи, скорость возврата — и следующая, большая партия планируется по фактам.`],
    ],
    s4splitH: 'Как платят эмитенту',
    s4split: `Входящий клиентский фиат делится между эмитентом и программой. На <strong>первой партии сплит 80 / 20</strong>: 80% — доля эмитента в операционной выручке (к задокументированным издержкам плюс целевая наценка ${Math.round(BATCH.issuerMarkup * 100)}%), 20% финансируют операции программы. Резерв, обеспечивающий монеты в обращении, остаётся на месте: это купон на резерв, а не его высвобождение. Залог высвобождается только по мере погашения монет и закрытия партии. Обе стороны видят один реестр издержек. По мере закрытия партий доля эмитента в следующих падает — 60/40, затем 40/60, затем 20/80 — а сами партии растут. При цене хоста этой страны и ориентире продажи ${sellBase} сплиты ${onePassShares || '—'} закрывают цель ${Math.round(BATCH.issuerMarkup * 100)}% за один проход выпущенного объёма; ${multiPassShares || '—'} требуют больше одного прохода. ${Math.round(BATCH.issuerMarkup * 100)}% — целевая доходность на погашаемое, а не гарантия, что любой сплит закроется за один проход. Эмитент зарабатывает больше и раньше, когда риск выше.`,
    s4splitCap: 'Схема 4.2 — Доля эмитента и экосистемы в клиентском фиате, по партиям',
    s4splitCs: 'Столбцы шире с ростом партий; доля эмитента в операционной выручке падает по мере снятия риска',
    s4splitSizes: ['пилот', 'больше', 'ещё больше', 'в масштабе'],
    s4splitLabels: { issuer: 'эмитенту (доля клиентского фиата)', eco: 'программе / экосистеме' },
    s4splitNote: `<strong>Почему это безопасно для эмитента.</strong> Первая партия мала, резерв остаётся обеспеченным 1:1, пока монеты в обращении, доля эмитента в операционной выручке идёт с опережением, и следующая партия не выпускается, пока не отработает первая. Риск исполнения несёт программа; у эмитента — короткое, полностью резервированное требование на операционную выручку с наценкой.`,

    s4fundH: 'Откуда может взяться резерв — частно размещаемая нота',
    s4fund: `Резерв эмитента не обязан браться с его собственного баланса. Его можно сформировать через частно размещаемую ноту: специальная компания (SPV) в международном финансовом центре размещает ноты среди квалифицированных международных инвесторов, и 100% привлечённых средств хранятся как резерв партии в банке-кастодиане. Это финансирование резерва, а не звено платёжного коридора — покупатели по-прежнему платят лицензированному юрлицу в ${cName}, хосты по-прежнему получают ${V.S}. ${V.S} выпускается только против этого резерва, поэтому каждая монета в обращении всегда полностью погашаема.`,
    s4fundSteps: [
      ['1. Частное размещение нот', `Выделенная SPV выпускает ноты только среди квалифицированных международных инвесторов по частному размещению — без публичного предложения, ни локально, ни где-либо ещё.`],
      ['2. Средства становятся резервом', `100% привлечённых средств лежат в банке-кастодиане как резерв партии. На операции они не тратятся; ${V.S} выпускается против них и остаётся погашаемым 1:1.`],
      ['3. Обслуживание за счёт выручки', `Сплит клиентского фиата из 4.2 обслуживает купон ноты. Тело гасится по мере погашения монет и высвобождения резерва. Доход на самом резерве может дополнять купон.`],
      ['4. Риски не смешиваются', `Если продажи вычислений разочаруют, резерв цел и держатели монет не затронуты; купон не получают только держатели нот. Риск монеты и риск инвестора структурно разделены.`],
    ],
    s4fundNotice: `Этот раздел описывает структуру финансирования, а не предложение ценных бумаг. Любое размещение проводилось бы только среди квалифицированных институциональных инвесторов, по применимому к ним законодательству о ценных бумагах и на основании полной документации выпуска.`,

    s5h: `Почему ${cNom}`,
    s5lead: c.cc === 'am'
      ? 'Армения запускает машины, которыми другие лишь владеют: глубочайшая инженерная скамья региона держит распределённый вычислительный флот в строю.'
      : 'Кыргызстан — там, где живут машины: ограничение задаёт цена электроэнергии, а не фонд оплаты труда.',
    s5tblHead: ['Показатель', 'Значение', 'Почему это важно'],
    s5tbl: [
      ['Население', c.population, 'Глубина базы хостов'],
      ['Компьютерные клубы (оценка)', c.clubs, `≈ ${machines} потребительских GPU уже установлено`],
      ['Университеты', c.universities, `${c.students} студентов — лаборатории как школьный канал`],
      ['Электроэнергия', `${money2(c.power)}/кВт·ч`, 'Держит чистыми хоста высокими; сама по себе доход не задаёт'],
      ['Чистыми за GPU-час', money2(nh.nodeNet), 'Доля хоста после электроэнергии, по оптовой цене токена'],
      ['Загрузка (ранняя сеть)', `${utilPct}%`, 'Доля предлагаемых часов простоя, которые продаются'],
    ],

    s6h: 'Юнит-экономика',
    s6lead: 'Всё масштабируется из одного расчёта: один час одной машины.',
    s6t1cap: 'Таблица 6.1 — Один час вычислений на одной потребительской GPU',
    s6t1: [
      ['Выдано выходных токенов', `${(nh.tokens / 1e6).toFixed(1)} млн`, ''],
      ['Себестоимость вычислений', `электроэнергия + износ железа`, `(${money3(cost)}/млн)`],
      ['Цена компенсации хосту', `${money3(pay)} за миллион токенов`, money2(nh.gross)],
      ['Электроэнергия (хост)', `0,55 кВт·ч × ${money2(c.power)}`, `(${money2(nh.power)})`],
      ['Чистыми хосту в час', '', money2(nh.nodeNet)],
    ],
    s6t1head: ['Статья', 'Основание', 'USD'],
    s6note: `<strong>Две цены, один спред.</strong> Хосту платят ${money3(pay)} за миллион токенов. Те же токены продаются в диапазоне ${priceRange} за миллион (ориентир ${sellBase}) — программа не продаёт ниже цены хоста. Разница — маржа программы и операционный доход эмитента (§4). Цифры предполагают карту ${CARD.name} на 1 500 ток/с. Более старая клубная GPU (${CARD.downsideName}, ~${CARD.downsideTokPerSec} ток/с) даёт примерно пятую часть токенов; такой час оставляет ${money2(slow.nodeNet)} после электроэнергии, а клуб из ${club.pcs} машин — около ${money(slowClub.total)}/мес. Доход задают проданные часы и класс карты; электроэнергия — тонкий слой себестоимости.`,
    s6chartH: 'Куда идёт каждый цент цены токена',
    s6chartCap: `Схема 6.1 — Себестоимость, маржа провайдера и наша маржа, за миллион токенов, по странам`,
    s6chartCs: `Доллары США за миллион выходных токенов; ориентир продажи ${sellBase}; чёрный слой — в основном износ железа, электроэнергия — тонкий слой, который меняется по странам`,
    s6chartLabels: { cost: 'Себестоимость (энергия + железо)', prov: 'Маржа провайдера', ours: 'Наша маржа' },
    s6scenH: 'Три сценария вывода на рынок',
    s6scenLead: `Цена хоста — фактическая цена этой страны. Цена продажи двигается внутри опубликованного диапазона. Три столбца показывают, какую долю первой партии возвращает 80% эмитента за один проход выпущенного объёма.`,
    s6scenCap: 'Схема 6.2 — Цена этой страны, три цены продажи, возврат первой партии',
    s6scenCs: 'Доллары США за миллион токенов; возврат = 80% доли эмитента × (продажа ÷ закупка) ÷ 1,10',
    s6scenLabels: {
      names: ['Скромный', 'Ориентир', 'Премиум'],
      subs: ['пол продажи', 'ориентир', 'потолок продажи'],
      slow: 'ЧАСТИЧНО — НУЖЕН ОБЪЁМ', ok: 'ВОЗВРАТ ЗА ОДИН ПРОХОД', fast: 'БЫСТРО, ЕСТЬ ЗАПАС',
    },
    s6scenNote: `Возврат выше 100% означает, что один проход выпущенного стейблкоина покрывает целевые 10% эмитента на этом проходе — следующая партия может быть больше. Ниже 100% цель достигается дополнительным объёмом. Поздние партии при доле эмитента 40% или 20% при этих ценах требуют больше одного прохода.`,

    s7h: 'Каналы предложения',
    s7lead: 'Мощности не набираются по одной машине. Их агрегируют четыре канала, и к каждому прилагается отдельная презентация.',
    s7ch: [
      ['Стейблкоин и институты', `Сами рельсы ${V.S}: отношения с регулятором и лицензированным эмитентом, он- и офф-рампы, оптовая конвертация USD/EUR.`],
      ['Компьютерные клубы', `${c.clubs} клубов, примерно по ${c.pcsPerClub} машин. Пик игры вечером; остальное время машины простаивают. Клуб из ${club.pcs} машин зарабатывает около ${money(clubTotal)} в месяц (${fmtLocal(c, clubTotal)}) при загрузке ${utilPct}% и без капитальных затрат.`],
      ['Спонсоры оборудования', `Бренды и дистрибьюторы спонсируют сообщество, а не канал продаж: $5,000 за сезон плюс оборудование как призы на турнирах, хакатонах и кампусных событиях. ИИ не бывает без GPU — железо спонсора оказывается в центре строящегося сообщества, а призовые карты, подключённые к сети, продолжают приносить победителям около ${money(club.perPc)} в месяц каждая.`],
      ['Школы и университеты', `${c.universities} учреждений, ${c.students} студентов. Университетские лаборатории зарабатывают на простое — около ${money(labTotal)} в месяц на 40 мест при загрузке ${utilPct}%, — превращая центр затрат в доходный актив, с прилагаемой учебной программой по ИИ-эксплуатации.`],
    ],

    s8h: 'Комплаенс и гарантии',
    s8lead: 'Программа намеренно узко определена. Она покупает услуги и платит за них. Она не принимает вклады, не предлагает публике доходность и не управляет биржей.',
    s8list: [
      ['Идентификация и скрининг', 'Каждый исполнитель проходит верификацию личности до первой выплаты; все фиатные он- и офф-рампы управляются местными лицензированными провайдерами под их собственными обязательствами KYC/AML.'],
      ['Контроль на уровне эмитента', 'Эмитент стейблкоина проводит санкционный и OFAC-скрининг на уровне инструмента и сохраняет возможность заморозки незаконных балансов.'],
      ['Налоговая прозрачность', `Выплаты учитываются индивидуально и подлежат отчётности. Программа предоставит исполнителям годовые справки в форме, требуемой налоговым органом ${cGen}.`],
      ['Местные юристы', `Лицензионные и регуляторные консультанты привлекаются в ${cName} до начала пилота, а не после.`],
      ['Защита учреждения', 'Участие лаборатории — добровольное и по соглашению: приоритет всегда у учебного процесса, вычисления мгновенно уступают, когда зал нужен, персональные данные не покидают страну, и учреждение может выйти в любой момент.'],
    ],
    s8note: '<strong>Чем программа не является.</strong> Это не платёжная организация, не депозитное учреждение и не эмитент ценных бумаг. Это покупатель услуг, который рассчитывается регулируемым стейблкоином вместо банковского перевода.',

    s9h: 'План и следующие шаги',
    s9lead: 'Пилот намеренно небольшой. Его задача — доказать один контур от начала до конца: работа внутрь, выплата наружу, в стейблкоине, проверяемо — прежде чем что-либо масштабировать.',
    s9tblHead: ['Этап', 'Недели', 'Результат'],
    s9tbl: [
      ['Подготовка', '0–4', `Привлечены юристы; назначен партнёр по он-/офф-рампу ${V.S}; оптовая конвертация USD/EUR → ${V.S} протестирована`],
      ['Пилот', '4–12', `Три университета, двадцать клубов, один спонсор по оборудованию; первые выплаты в ${V.S} на пятой неделе`],
      ['Измерение', '12–16', 'Удержание исполнителей, задержка выплат, доля споров и поставленные мощности — публикуются'],
      ['Масштабирование', '16+', 'Расширение по каналам на основании данных пилота'],
    ],
    s9ask: [
      ['От государства', `Заявление об отсутствии возражений против выплат в ${V.S} резидентам и назначенное контактное лицо.`],
      ['От учреждений', 'Три университета и двадцать клубов, готовых провести двенадцатинедельный пилот бесплатно для себя.'],
      ['От партнёров', 'Один спонсор по оборудованию и один лицензированный он-/офф-рамп.'],
    ],
    s9notice: 'Документ предоставляется исключительно для целей обсуждения. Он не является предложением о продаже или приглашением к покупке каких-либо ценных бумаг или финансовых инструментов. Все цифры — иллюстративный вывод внутренней модели при указанных допущениях; это оценки, а не аудированная статистика, и фактические результаты будут отличаться. Ничто здесь не является юридической, налоговой, финансовой или инвестиционной консультацией. Регулирование стейблкоинов развивается, и деятельность обусловлена получением и поддержанием применимых лицензий и обязательствами по идентификации, ПОД/ФТ и санкционному контролю, описанными выше.',

    contactK: 'Следующий шаг',
    contactH: 'Тридцатиминутный созвон, затем двенадцатинедельный пилот.',
    contactSub: 'Ничто в этой презентации не требует бюджетного решения. Требуется переговорная и дата.',
    contactFill: 'Контакт: Богдан<br>Telegram: @bogidotcom<br>Почта: sizov.workingbox@gmail.com',

    corrTitle: 'КОРИДОР',
    corrAria: `Капитал идёт из USD и EUR напрямую в ${V.S} и к местному сообществу`,
    corr1t: 'USD / EUR',
    corr1s: 'Международный покупатель',
    corr2t: `${cNom}`,
    corr2s: `Лицензированное местное юрлицо · ${capRuNom}`,
    corr3t: `${V.S}`,
    corr3s: 'Оптовая конвертация, один раз',
    corr4t: 'Выплата сообществу',
    corr4s: `Людям и машинам в ${cName}, в ${V.S}`,
    corrBack: `Обратное плечо — ${V.S} → USD / EUR на той же площадке`,

    d1: {
      track: 'Стейблкоин-рельсы',
      cover: `Каждый час работы,<br>купленный в ${cName},<br>оплачивается в <span class="hl">${V.S}</span>.`,
      coverSub: `Линия спроса на вычисления ${cGen} с расчётами напрямую в ${curRu} — доллары и евро на входе, ${V.S} сообществу на выходе.`,
      s2k: 'Правило',
      s2h: 'Один способ оплаты. Без исключений.',
      s2fig: [
        ['100%', `местных выплат в ${V.S}`],
        ['0', 'банков-корреспондентов в цепочке'],
        ['В тот же день', 'от приёмки работы до зачисления на кошелёк'],
      ],
      s3k: 'Что это заменяет',
      s3h: 'Цену трансграничного получения денег.',
      s3bars: [
        { l: 'Банковский перевод + FX', v: 6.5, t: '5–8% потерь' },
        { l: 'Карта / перевод-приложение', v: 4.0, t: '3–5% потерь' },
        { l: `Напрямую в ${V.S}`, v: 0.3, t: '≈ 0%', strong: true },
      ],
      s3note: 'Доля выплаты, не доходящая до заработавшего её человека. Программа убирает это звено, а не торгуется о его цене.',
      s4k: 'Структура',
      s4h: `Доллары на входе. ${V.S} на выходе. Одна конвертация.`,
      s5k: 'Почему напрямую',
      s5h: 'Деньги приходят туда, где сделана работа.',
      s5cards: [
        ['Одна конвертация', `USD/EUR один раз, оптом, конвертируются в ${V.S} через лицензированную местную площадку — исполнитель не касается FX.`],
        ['Без посредников на рельсах', 'На рельсах выплат нет транзитной юрисдикции и промежуточного токена. Финансирование резерва, если есть, стоит вне этих рельс.'],
        ['Объём остаётся дома', `Выплаты номинированы в ${curRu}; объём обращается внутри страны, а не утекает наружу.`],
      ],
      s6k: `Две цены`,
      s6h: 'Платим хосту одно, продаём клиенту другое.',
      s6a: ['Платим хосту', `${money3(pay)}<span style="font-size:14pt">/млн ток</span>`, `Цена компенсации местным хостам — её задают местная электроэнергия и железо.`],
      s6b: ['Продаём клиентам', `${priceRange}<span style="font-size:14pt">/млн ток</span>`, `Диапазон перепродажи — никогда не ниже цены хоста. Спред финансирует программу и составляет операционный доход эмитента.`],
      dMintK: 'Механизм',
      dMintH: 'Выпуск партиями. Сначала пилот.',
      dMintSteps: [
        ['Выпуск', `≈ ${firstBatchLocal} ${c.iso} (${money(firstBatchUSD)}) под залог эмитента.`],
        ['Оплата', `Тратится только на ${adjRuPl} вычисления — клубы, лаборатории, хосты.`],
        ['Продажа', `Вычисления перепродаются клиентам за EUR / USD / GBP.`],
        ['Оценка', `Измеряем, затем планируем большую следующую партию.`],
      ],
      dMintNote: `Партнёр-эмитент выпускает ${V.S} траншами; неограниченного объёма нет.`,
      dSplitK: 'Операционный доход',
      dSplitH: 'Клиентский фиат — купон эмитента; резерв остаётся на месте.',
      dSplitSizes: ['пилот', 'больше', 'ещё больше', 'в масштабе'],
      dSplitLabels: { issuer: 'эмитенту (доля клиентского фиата)', eco: 'экосистеме' },
      dSplitNote: `Первая партия делится 80/20. 80% — операционная выручка к издержкам плюс цель ${Math.round(BATCH.issuerMarkup * 100)}%, а не высвобождение резерва 1:1. ${onePassShares} закрывают цель за один проход при ориентирной продаже; ${multiPassShares} требуют большего объёма. Доля падает по мере снятия риска; партии растут.`,
      // офшорная нота
      dFundK: 'Финансирование резерва',
      dFundH: 'Резерв может дать частно размещаемая нота.',
      dFundCards: [
        ['Частное размещение', `SPV в международном финансовом центре размещает ноты среди квалифицированных международных инвесторов — без публичного предложения.`],
        ['100% в резерв', `Средства лежат в банке-кастодиане как резерв партии; ${V.S} выпускается против них и погашаем 1:1.`],
        ['Обслуживание выручкой', `Сплит клиентского фиата из 4.2 обслуживает купон. Тело возвращается по мере погашения монет и высвобождения резерва.`],
        ['Риски не смешиваются', `Держатели монеты защищены целым резервом; купон не получают только держатели нот, если продажи разочаруют.`],
      ],
      dFundNote: `Структура, а не предложение — только частное размещение среди квалифицированных институциональных инвесторов. Это финансирует резерв, а не является звеном платёжного коридора.`,
      dCostK: 'Две цены',
      dCostH: 'Дёшево произвести. Дороже продать.',
      dCostLabels: { cost: 'Себестоимость (энергия + железо)', prov: 'Маржа провайдера', ours: 'Наша маржа' },
      dCostNote: `Чёрный слой — в основном износ железа; электроэнергия — тонкий слой, который меняется по странам. Продажа никогда не ниже цены хоста. Разрыв — операционный доход эмитента.`,
      dScenK: 'Три сценария',
      dScenH: 'Цена этой страны. Три цены продажи.',
      dScenLabels: {
        names: ['Скромный', 'Ориентир', 'Премиум'],
        subs: ['пол продажи', 'ориентир', 'потолок'],
        slow: 'ЧАСТИЧНО', ok: 'ОДИН ПРОХОД', fast: 'БЫСТРО + ЗАПАС',
      },
      dScenNote: `Возврат = 80% доли эмитента × (продажа ÷ закупка) ÷ 1,10 при цене хоста этой страны. Выше 100% — следующая партия может быть больше.`,
      s7k: `Ценность для ${cGen}`,
      s7h: 'Деньги зарабатываются вовне и тратятся дома.',
      s7strip: [
        [money(clubTotal), 'на клуб в месяц, с простаивающих машин'],
        [`${machines}`, `потребительских GPU уже установлено в ${cName}`],
        ['100%', `заработка номинировано в ${curRu} — объём остаётся внутри страны`],
        [money2(c.power), 'за кВт·ч — дешёвая энергия; доход задают часы и класс карты'],
      ],
      s8k: 'Комплаенс',
      s8h: 'Узко по замыслу.',
      s8pills: ['Верификация исполнителей', 'Лицензированные местные рампы', 'Санкционный скрининг эмитента', 'Годовые налоговые справки', 'Не принимаем вклады', 'Не биржа', 'Юристы до запуска'],
      s9k: 'Пилот',
      s9h: 'Двенадцать недель. Без бюджетных денег.',
      s9steps: [
        { k: 'Н0', t: 'Юристы + рамп-партнёр', s: 'Лицензии подтверждены' },
        { k: 'Н4', t: 'Старт пилота', s: '3 вуза · 20 клубов' },
        { k: 'Н5', t: `Первые выплаты в ${V.S}`, s: 'Контур доказан', hi: true },
        { k: 'Н12', t: 'Публикация результатов', s: 'Удержание · задержки · мощности' },
      ],
      s10k: 'Запрос',
      s10h: 'Заявление об отсутствии возражений и контактное лицо.',
      s10sub: 'Всё остальное — капитал, оборудование, инженерию и юристов — приносит программа.',
    },

    d2: {
      track: 'Компьютерные клубы',
      cover: `Клуб зарабатывает,<br>когда никто<br>не <span class="hl">играет</span>.`,
      coverSub: `Машины уже куплены, запитаны и в сети. Между сессиями они могут продавать ИИ-вычисления — а вы еженедельно получаете ${V.S}.`,
      s2k: 'Проблема',
      s2h: 'Машины куплены на четырнадцать часов в день. Используются пять.',
      s2ring: ['5 ч', 'пиковой игры на машину'],
      s2note: 'Каждый час вне пика — это карта, за которую вы заплатили, которую охлаждаете и страхуете, и которая ничего не производит.',
      s3k: 'Что меняется',
      s3h: 'Ничего из того, что видно в зале.',
      s3cards: [
        ['Одна установка', 'Один агент на машину. Пятнадцать минут на зал. Железо не меняется.'],
        ['Игрок всегда прав', 'Началась сессия — вычисления мгновенно останавливаются. FPS не затрагивается.'],
        ['Выключить в любой момент', 'Один переключатель, по машине или по клубу. Без срока и штрафов.'],
      ],
      s4k: 'Цифра',
      s4h: `Сколько зарабатывают ${club.pcs} машин.`,
      s4figs: [
        [money2(nh.nodeNet), 'на машину за проданный час простоя'],
        [money(club.perPc), 'на машину в месяц'],
        [money(clubTotal), 'на клуб в месяц', fmtLocal(c, clubTotal)],
      ],
      s4note: `Расчёт при ${club.pcs} машинах, ${club.hoursPerDay} часах простоя в сутки, из которых продаётся ${utilPct}%, и ${money2(c.power)}/кВт·ч. Электроэнергия уже вычтена. По мере роста сети загрузка растёт; выше — случай ранней сети.`,
      s5k: 'За год',
      s5h: `${money(clubYear)} — или ${fmtLocal(c, clubYear)}.`,
      s5bars: [
        { l: '1 клуб', v: clubTotal, t: money(clubTotal) },
        { l: '5 клубов', v: clubTotal * 5, t: money(clubTotal * 5) },
        { l: '20 клубов', v: clubTotal * 20, t: money(clubTotal * 20), strong: true },
      ],
      s5sub: 'В месяц, за вычетом электроэнергии. Сеть из двадцати клубов покрывает управляющего, ремонт или следующие двадцать машин.',
      s6k: 'Ёмкость',
      s6h: `${c.clubs} клубов. ${machines} машин уже установлено в ${cName}.`,
      s6sub: 'Крупнейший в стране пул простаивающих видеокарт уже построен, запитан и укомплектован персоналом. У него просто нет второй смены.',
      s7k: 'Как вы получаете деньги',
      s7h: `Еженедельно, в ${V.S}, на телефон.`,
      s7cards: [
        [`В ${curRu}`, `${V.S} погашается один к одному в ${curRu}. Вы не принимаете валютный риск.`],
        ['Еженедельно, автоматически', 'Заработок начисляется по машинам и часам и выплачивается каждую неделю. Без счетов и минимумов.'],
        ['Банк не нужен', 'Достаточно телефона. Тратьте, держите или обменивайте через лицензированный офф-рамп.'],
      ],
      s8k: 'Как начать',
      s8h: 'Семь дней от рукопожатия до первой выплаты.',
      s8steps: [
        { k: 'ДЕНЬ 1', t: 'Соглашение', s: 'Одна страница, без срока' },
        { k: 'ДЕНЬ 2', t: 'Установка', s: '15 минут на зал' },
        { k: 'ДЕНЬ 3', t: 'Первые часы простоя', s: 'Ночью, автоматически' },
        { k: 'ДЕНЬ 7', t: 'Первая выплата', s: `В ${V.S}`, hi: true },
      ],
      s9k: 'Запрос',
      s9h: 'Пять машин. Одна неделя. Потом решайте.',
      s9sub: 'Запустите на пяти машинах в самом тихом зале. Если цифра не совпадёт с этой презентацией — удалите агент: вы потеряете неделю внимания и ни одной монеты.',
    },

    d3: {
      track: 'Спонсорство оборудования',
      cover: `ИИ не бывает<br>без <span class="hl">GPU</span>.`,
      coverSub: `Мы строим ИИ-сообщество ${cGen} — клубы, кампусы, турниры, хакатоны. Спонсорство ставит ваше железо в центр этого: $5,000 за сезон плюс оборудование как призы.`,
      s2k: 'Сообщество',
      s2h: 'Уже установлено, уже играет. У него просто нет спонсора.',
      s2strip: [
        [c.clubs, 'компьютерных клубов'],
        [machines, 'машин в этих клубах'],
        [c.universities, 'вузов с лабораториями'],
        [c.students, 'студентов — будущих покупателей'],
      ],
      s3k: 'Пакет',
      s3h: 'Один сезон. Два вклада.',
      s3a: ['Деньги', `$5,000<span style="font-size:14pt">/сезон</span>`, 'Финансируют площадки, призовые фонды и продакшн сезона турниров, хакатонов и дней открытых дверей в пилотных городах.'],
      s3b: ['Оборудование', `+ призы`, `GPU и устройства вручаются на сцене и распаковываются перед залом — а затем подключаются к сети, где призовая карта продолжает приносить победителю ≈ ${money(club.perPc)} в месяц.`],
      s4k: 'Что получает бренд',
      s4h: 'На каждой сцене, в каждых руках.',
      s4cards: [
        ['Название и сцена', 'Титульное размещение на каждом событии сезона — турниры, хакатоны и дни открытых дверей в пилотных городах.'],
        ['Живые демо', 'Демо-зона на каждом событии: игроки и студенты впервые знакомятся с вашим железом там, где начинается решение о покупке.'],
        ['Истории победителей', 'Призы распаковываются на сцене и попадают в стримы; призовая GPU, которая продолжает зарабатывать в сети, — это история на месяцы.'],
      ],
      s5k: 'Почему это работает',
      s5h: 'Вы не покупаете показы. Вы строите свой рынок.',
      s5cards: [
        ['Будущие покупатели', `${c.students} студентов и игроки клубов страны — следующее поколение покупателей GPU, встреченное в момент выбора бренда.`],
        ['Приз, который платит', 'Призовая карта, подключённая к сети, каждый месяц приносит победителю реальные деньги. На этой выплате — ваш бренд.'],
        ['Сообщество работает на вас', 'Каждая модель на хакатоне, каждый клубный турнир, каждая лабораторная сессия программы идёт на спонсорском железе.'],
      ],
      s6k: 'Форматы спонсорства',
      s6h: 'Три способа войти.',
      s6tbl: [
        ['Титульный спонсор', '$5,000 за сезон + призовое оборудование', 'Название, сцена, логотип везде'],
        ['Призовой спонсор', 'GPU и периферия вручаются на сцене', 'Момент распаковки, контент победителей'],
        ['Демо-зона', 'Зона живого знакомства на каждом событии', 'Первый контакт с будущими покупателями'],
      ],
      s6head: ['Формат', 'Что это', 'Что вы получаете'],
      s7k: 'Охват',
      s7h: 'Где появляется ваш бренд.',
      s7cards: [
        ['Клубы', `${c.clubs} площадок — там, где решение о покупке действительно принимается.`],
        ['Кампусы', `${c.universities} учреждений, ${c.students} студентов, с встроенной учебной программой по ИИ.`],
        ['События', 'Сезон турниров, хакатонов и дней открытых дверей в пилотных городах.'],
      ],
      s8k: 'Запрос',
      s8h: 'Один сезон. $5,000 + оборудование как призы.',
      s8sub: 'Спонсируйте первый сезон событий сообщества. Если построенное сообщество не стоит вашего логотипа — уходите после первого сезона.',
    },

    d4: {
      track: 'Школы и университеты',
      cover: `Лаборатории, которые<br>себя <span class="hl">окупают</span>.`,
      coverSub: `Университетские компьютерные лаборатории простаивают ночами, по выходным и в каникулы. В эти часы они могут продавать ИИ-вычисления — а учреждение получает выплату в ${V.S}.`,
      s2k: 'Простаивающий актив',
      s2h: 'Куплена ради учебных часов. Простаивает большую их часть.',
      s2a: ['Простой лаборатории', `${money(labTotal)} / мес.`, `Лаборатория на 40 мест, 16 часов простоя в сутки при загрузке ${utilPct}%, за вычетом электроэнергии.`],
      s2b: ['За год', `${money(labTotal * 12)}`, `На лабораторию из 40 мест, за вычетом электроэнергии — без капитальных затрат для учреждения.`],
      s3k: 'Цифра',
      s3h: `${money(labTotal)} в месяц на лабораторию. ${money(labTotal * 3)} на пилоте из трёх кампусов.`,
      s3bars: [
        { l: '1 лаборатория', v: labTotal, t: money(labTotal) },
        { l: '3 лаборатории', v: labTotal * 3, t: money(labTotal * 3), strong: true },
        { l: '10 лабораторий', v: labTotal * 10, t: money(labTotal * 10), strong: true },
      ],
      s3sub: `В месяц, в ${curRu}, за вычетом электроэнергии. Выплата учреждению в тот же час, когда вычисления проданы, — без банковского счёта и без счёта-фактуры.`,
      s4k: 'Для учреждения',
      s4h: 'Лаборатория перестаёт быть центром затрат.',
      s4cards: [
        ['Доход с простоя', `Ночи, выходные и каникулы — около ${money(labTotal)} в месяц на лабораторию из 40 мест, за вычетом электроэнергии.`],
        ['Готовая учебная программа', 'Модули по ИИ-эксплуатации, оценке моделей и курированию данных — чтобы машины не только зарабатывали, но и учили.'],
        ['Без капитальных затрат', 'Оборудование уже есть. Один агент на машину, установка за полдня времени персонала.'],
      ],
      s5k: 'Гарантии',
      s5h: 'Не обсуждаются и вписаны в соглашение.',
      s5pills: ['Только добровольно', 'Приоритет всегда у учебного процесса', 'Вычисления мгновенно уступают, когда нужен зал', 'Требуется согласие учреждения', 'Персональные данные не покидают страну', 'Выход в любой момент'],
      s6k: 'Внедрение',
      s6h: 'Две недели, одна лаборатория, без капитальных затрат.',
      s6steps: [
        { k: 'НЕД. 1', t: 'Соглашение', s: 'Одна лаборатория, добровольно' },
        { k: 'НЕД. 2', t: 'Установка', s: 'Полдня времени персонала' },
        { k: 'НЕД. 3', t: 'Первая выплата', s: `В ${V.S}`, hi: true },
        { k: 'НЕД. 12', t: 'Обзор', s: 'Расширить или остановить' },
      ],
      s7k: 'В масштабе пилота',
      s7h: 'Три университета. Десять лабораторий.',
      s7strip: [
        ['3', 'вуза в пилоте'],
        ['10', 'зарабатывающих лабораторий'],
        [money(labTotal * 10), 'в месяц учреждениям'],
        [`${utilPct}%`, 'часов простоя продаётся — доля растёт с сетью'],
      ],
      s8k: 'Запрос',
      s8h: 'Одна лаборатория на двенадцать недель.',
      s8sub: 'Без капитальных затрат, без эксклюзивности, и учреждение может прекратить участие за неделю в любой момент.',
    },

    assumptions: `Цифры — внутренние модельные оценки при указанных допущениях: карта ${CARD.name} на 1 500 выходных токенов в секунду (более старые клубные карты ~${CARD.downsideTokPerSec} ток/с масштабируют токены и клиентскую выручку примерно в пять раз вниз), электроэнергия ${money2(c.power)}/кВт·ч, цена компенсации хосту ${money3(pay)}, цена продажи клиенту в диапазоне ${priceRange} за миллион (ориентир ${sellBase}; никогда не ниже цены хоста), продаётся ${utilPct}% предлагаемых часов. Это не аудированная статистика и не прогноз.`,
  };
}
