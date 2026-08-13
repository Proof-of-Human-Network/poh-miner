// Per-country facts used by every document and deck.
// All economic figures are internal modelling estimates, not audited statistics —
// every generated page carries an assumptions footnote saying so.

export const COUNTRIES = [
  {
    cc: 'ge',
    langs: ['en'],
    domain: 'poh.ge',
    stableLive: false,  // like everywhere else, the local stablecoin is minted with a partner issuer
    country: 'Georgia',
    countryOf: 'Georgia',
    adjective: 'Georgian',
    capital: 'Tbilisi',
    currency: 'Lari',
    iso: 'GEL',
    sign: '₾',
    stable: 'αιGEL',
    stableName: 'αιGEL',
    fx: 2.7,              // local currency units per USD
    power: 0.07,          // USD / kWh, blended commercial
    population: '3.7M',
    itWorkforce: '15,000',
    students: '150,000',
    universities: '60',
    clubs: '50',
    pcsPerClub: 25,
    localHour: 7.0,       // USD, blended skilled AI-ops hour
    westHour: 45,         // USD, equivalent Western rate
    avgWage: 650,         // USD / month
    whyHere: [
      ['Crypto-friendly by statute', 'A licensed VASP regime, no capital controls, and an EU-candidate legal trajectory.'],
      ['Low, flat taxation', 'Small-business and IT-zone regimes keep contributor income intact.'],
      ['Banking that clears', 'Correspondent access to EUR and USD without CIS sanction exposure.'],
    ],
    sectorNote: 'Georgia is where the model runs first: a licensed VASP regime, a sovereign Lari stablecoin already issued, and banking that clears EUR and USD.',
  },
  {
    cc: 'am',
    langs: ['en', 'ru'],
    domain: 'poh.am',
    country: 'Armenia',
    countryOf: 'Armenia',
    adjective: 'Armenian',
    capital: 'Yerevan',
    currency: 'Dram',
    iso: 'AMD',
    sign: '֏',
    stable: 'αιAMD',
    stableName: 'αιAMD',
    fx: 385,
    power: 0.075,
    population: '3.0M',
    itWorkforce: '30,000',
    students: '90,000',
    universities: '25',
    clubs: '40',
    pcsPerClub: 22,
    localHour: 7.5,
    westHour: 45,
    avgWage: 620,
    whyHere: [
      ['The deepest engineering bench in the region', 'A mature IT sector, strong mathematics schooling, and a large returning diaspora.'],
      ['EAEU and CIS gateway', 'Payment and trade access to a market that Western rails reach only with friction.'],
      ['Established tech incentives', 'Long-standing IT tax relief and an active technology-park ecosystem.'],
    ],
    sectorNote: 'Armenia runs the machines others only own: the deepest engineering bench in the region is what keeps a distributed compute fleet online.',
  },
  {
    cc: 'kg',
    langs: ['en', 'ru'],
    domain: 'poh.kg',
    country: 'the Kyrgyzstan',
    countryOf: 'the Kyrgyzstan',
    adjective: 'Kyrgyz',
    capital: 'Bishkek',
    currency: 'Som',
    iso: 'KGS',
    sign: 'som',
    stable: 'KGST',
    stableName: 'KGST',
    fx: 87,
    power: 0.035,
    population: '7.1M',
    itWorkforce: '20,000',
    students: '230,000',
    universities: '50',
    clubs: '80',
    pcsPerClub: 20,
    localHour: 4.5,
    westHour: 45,
    avgWage: 340,
    whyHere: [
      ['Among the cheapest power in the region', 'Hydroelectric generation at roughly USD 0.03–0.04 per kWh keeps host net high. Sold hours and card class still set the yield.'],
      ['A young, fast-growing workforce', 'Median age under 27, with a state-backed digital-skills push.'],
      ['A crypto-permissive legal regime', 'Licensed virtual-asset service providers and an explicit mining framework.'],
    ],
    sectorNote: 'Kyrgyzstan is where the machines live: power price, not payroll, is the binding constraint on compute.',
  },
  {
    cc: 'et',
    langs: ['en'],
    domain: 'poh.et',
    country: 'Ethiopia',
    countryOf: 'Ethiopia',
    adjective: 'Ethiopian',
    capital: 'Addis Ababa',
    currency: 'Birr',
    iso: 'ETB',
    sign: 'Br',
    stable: 'αιETB',
    stableName: 'αιETB',
    fx: 128,
    power: 0.02,
    population: '126M',
    itWorkforce: '40,000',
    students: '1,100,000',
    universities: '50',
    clubs: '120',
    pcsPerClub: 18,
    localHour: 3.5,
    westHour: 45,
    avgWage: 190,
    whyHere: [
      ['The lowest power cost in the programme', 'Grand-scale hydroelectric supply at roughly USD 0.02 per kWh — it keeps host net high. Sold hours and card class still set the yield.'],
      ['The largest campus base in the corridor', 'Over a million tertiary students across an English-medium university system — laboratories that can host compute at scale.'],
      ['A hard-currency-scarce economy', 'A stable digital unit of account is worth more here than anywhere else on this list.'],
    ],
    sectorNote: 'Ethiopia offers compute scale where it counts: cheap power, a large installed base of machines, and a host yield that is set by sold hours and card class.',
  },
  {
    cc: 'bt',
    langs: ['en'],
    domain: 'poh.bt',
    country: 'Bhutan',
    countryOf: 'Bhutan',
    adjective: 'Bhutanese',
    capital: 'Thimphu',
    currency: 'Ngultrum',
    iso: 'BTN',
    sign: 'Nu.',
    stable: 'αιBTN',
    stableName: 'αιBTN',
    fx: 84,
    power: 0.03,
    population: '0.8M',
    itWorkforce: '2,500',
    students: '15,000',
    universities: '10',
    clubs: '8',
    pcsPerClub: 20,
    localHour: 4.0,
    westHour: 45,
    avgWage: 420,
    whyHere: [
      ['Surplus carbon-free hydro', 'Exported power that can instead be sold as compute at a far higher value per kilowatt-hour.'],
      ['A state already in digital assets', 'Sovereign experience operating and holding digital-asset infrastructure.'],
      ['Small enough to move fast', 'A single ministry can authorise a national pilot in one meeting.'],
    ],
    sectorNote: 'Bhutan is the pilot jurisdiction: small, carbon-free, and institutionally able to decide quickly.',
  },
];

export const byCc = Object.fromEntries(COUNTRIES.map(c => [c.cc, c]));

// ---- derived economics -------------------------------------------------

// A consumer-class node, per hour at full load.
export const NODE = {
  tokPerSec: 1500,
  kW: 0.55,
  utilisation: 0.35,
};

// Reference hardware: one card of the class the network harvests.
export const HW = { price: 1600, lifeHours: 20000 };   // ≈ $0.08/compute-hour amortised

// The AI-compute unit is priced per MILLION output tokens ("per AI-compute token"
// on the pages). Two independent prices move within one band:
//   • what we PAY the compute provider (cost-driven, per country)
//   • what we SELL to the client (market-driven, fiat)
// The band spans both. $0.15 is the reference sell price; the model now carries
// the full range rather than a single point.
export const PRICE = {
  lo: 0.08,            // $/M — floor of the published band; at or above host pay in every programme country
  hi: 0.20,            // $/M — ceiling of the published band
  sellBase: 0.15,      // $/M — reference sell price to the client
  payMargin: 0.106,    // leftover; payTok() is payback-anchored, not cost-plus
};

// Nameplate card the headline yields assume. Older cafe GPUs are the downside case.
export const CARD = {
  name: 'RTX 4070-class',
  downsideName: 'GTX 1650–3060-class',
  downsideTokPerSec: 300,
};

// Raw cost to produce 1M output tokens in a country: electricity + hardware wear.
export function computeCost(c) {
  const tokensPerHour = NODE.tokPerSec * 3600 / 1e6;   // 5.4 (M tokens)
  const powerPerHour = NODE.kW * c.power;              // $/h electricity
  const hwPerHour = HW.price / HW.lifeHours;           // $/h amortisation
  const perM = (powerPerHour + hwPerHour) / tokensPerHour;
  return { perM, powerPerHour, hwPerHour };
}

// How long the reference card should take to repay itself out of net earnings.
export const PAYBACK_MONTHS = 24;

// Price per M tokens we pay the provider. Rather than cost-plus, the margin is
// anchored to hardware payback: we top up the host's own electricity by exactly
// the net the reference card needs to repay itself in PAYBACK_MONTHS (at 18 h/day
// and SOLD_UTIL sold utilisation). Electricity makes the price per-country; the
// payback margin on top is uniform, so a card breaks even on the same 24-month
// schedule everywhere while cheaper-power countries still cost us less to procure.
export function payTok(c) {
  const tokM = NODE.tokPerSec * 3600 / 1e6;                 // M tokens per host-hour (5.4)
  const soldHoursPerMonth = 18 * SOLD_UTIL * 30;            // utilised hours billed per month
  // +1e-9 keeps the net a hair above the exact break-even so payback()'s ceil()
  // lands on 24 rather than 25 under floating-point rounding.
  const netPerHour = (HW.price / (PAYBACK_MONTHS * soldHoursPerMonth)) * (1 + 1e-9);
  const powerPerHour = NODE.kW * c.power;                   // the host's own electricity
  return (netPerHour + powerPerHour) / tokM;
}

export function nodeHour(c, tokPerSec = NODE.tokPerSec) {
  const tokens = tokPerSec * 3600;                     // 5.4M at nameplate
  const pay = payTok(c);
  const gross = (tokens / 1e6) * pay;                  // paid per metered token, not per nameplate hour
  const power = NODE.kW * c.power;                     // the provider's own electricity
  return { tokens, gross, power, pay, net: gross - power, nodeNet: gross - power };
}

// ---- stablecoin issuance & payback -------------------------------------

// A batch is one minting round backed by the issuing partner's collateral.
// The first batch is a pilot; the issuer's share of incoming client fiat falls
// with each batch as their risk is retired, while batches themselves grow.
export const BATCH = {
  firstGEL: 500000,          // benchmark minimum first batch, in Georgian Lari
  firstUSD: Math.round(500000 / 2.7),   // ≈ $185k — the value each country matches in its own currency
  issuerMarkup: 0.10,        // the issuer recovers collateral + costs + 10%
  // [issuer share, ecosystem share] of client fiat, per batch
  splits: [
    [0.80, 0.20],
    [0.60, 0.40],
    [0.40, 0.60],
    [0.20, 0.80],
  ],
};

// Given a pay price and a sell price, how much of a first batch is recovered in
// one pass of the minted stablecoin: mint buys (batch/pay) M-tokens of compute,
// sold for (that × sell) in fiat, of which `issuerShare` repays the issuer, who
// needs the batch + markup back.
export function batchRecovery(payPerM, sellPerM, issuerShare = 0.80, markup = BATCH.issuerMarkup) {
  const need = 1 + markup;                             // per unit of collateral
  const fiatPerUnit = (1 / payPerM) * sellPerM;        // fiat raised per unit minted
  return (issuerShare * fiatPerUnit) / need;           // ≥1 ⇒ batch fully repaid in one pass
}

// Three go-to-market scenarios for a given country: host pay is that country's
// actual payTok(); sell moves inside the published band. Recovery is always
// computed at the first-batch 80% issuer share.
export function scenariosFor(c) {
  const pay = +payTok(c).toFixed(3);
  return [
    { key: 'modest',    pay, sell: PRICE.lo },
    { key: 'reference', pay, sell: PRICE.sellBase },
    { key: 'premium',   pay, sell: PRICE.hi },
  ];
}

export function nodeYear(c, util = NODE.utilisation) {
  const h = nodeHour(c);
  const hours = 8760 * util;
  return { hours, gross: h.gross * hours, nodeNet: h.nodeNet * hours };
}

// Share of *available* idle hours that actually get sold at full load in the
// early network. Everything downstream (clubs, labs, hardware payback) is
// discounted by this — an idle hour is capacity, not revenue.
export const SOLD_UTIL = 0.35;

// A gaming club: PCs earning only outside peak play.
export function clubMonth(c, pcs = c.pcsPerClub, hoursPerDay = 14, util = SOLD_UTIL, tokPerSec = NODE.tokPerSec) {
  const h = nodeHour(c, tokPerSec);
  const perPc = h.nodeNet * hoursPerDay * util * 30;
  return { perPc, total: perPc * pcs, pcs, hoursPerDay, util };
}

// Months for a card to repay itself out of net earnings.
export function payback(c, price = 1600, hoursPerDay = 18, util = SOLD_UTIL) {
  const h = nodeHour(c);
  return Math.ceil(price / (h.nodeNet * hoursPerDay * util * 30));
}

// Talent: what a local contributor hour costs vs. the Western equivalent.
export function talent(c) {
  const monthly = c.localHour * 6 * 22;    // 6 productive h/day, 22 days
  return {
    local: c.localHour,
    west: c.westHour,
    multiple: +(c.westHour / c.localHour).toFixed(1),
    monthly: Math.round(monthly),
    vsWage: +(monthly / c.avgWage).toFixed(1),
  };
}

export function fmtUSD(n, dp = 0) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
export function fmtLocal(c, usd, dp = 0) {
  const v = usd * c.fx;
  const r = v >= 1000 ? Math.round(v / 10) * 10 : Math.round(v);
  return r.toLocaleString('en-US', { maximumFractionDigits: dp }) + ' ' + c.iso;
}
