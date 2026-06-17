'use strict';

const axios   = require('axios');
const { ethers } = require('ethers');
const { fetchHop2, getCounterparties } = require('./txGraph');

const WEB3BIO_API   = 'https://api.web3.bio';
const ETHERSCAN_V2  = 'https://api.etherscan.io/v2/api';
const FARCASTER_API = 'https://api.farcaster.xyz';
const WARPCAST_API  = 'https://api.warpcast.com/v2';
const HUB_API       = 'https://hub.pinata.cloud/v1';
const PARA_API      = 'https://api.paragraph.com';
const ZORA_API      = 'https://api-sdk.zora.engineering';
const ZORA_KEY      = 'zora_api_6770e5a970bb4febd95deee8cda143e469a25f4b35d61cb0355646e9af83d3c1';

// ── Web3.bio — social profiles + avatar ──────────────────────────────────────

async function fetchWeb3Bio(address) {
  try {
    const res = await axios.get(`${WEB3BIO_API}/profile/${address}`, { timeout: 8000 });
    if (!Array.isArray(res.data) || !res.data.length) return null;
    return res.data; // array of { platform, identity, displayName, avatar, description, links }
  } catch { return null; }
}

// ── Etherscan: first tx, last tx, total tx count ──────────────────────────────

async function fetchTxStats(address) {
  const apikey = process.env.ETHERSCAN_API_KEY;
  if (!apikey) return null;
  try {
    const [firstRes, lastRes, countRes] = await Promise.all([
      axios.get(ETHERSCAN_V2, {
        params: { chainid: 1, module: 'account', action: 'txlist',
                  address, page: 1, offset: 1, sort: 'asc', apikey },
        timeout: 8000,
      }),
      axios.get(ETHERSCAN_V2, {
        params: { chainid: 1, module: 'account', action: 'txlist',
                  address, page: 1, offset: 1, sort: 'desc', apikey },
        timeout: 8000,
      }),
      // Use txlistinternal count=1 + Etherscan txcount RPC to get total without fetching all rows
      axios.get(ETHERSCAN_V2, {
        params: { chainid: 1, module: 'proxy', action: 'eth_getTransactionCount',
                  address, tag: 'latest', apikey },
        timeout: 8000,
      }),
    ]);
    const firstTx = firstRes.data?.result?.[0];
    const lastTx  = lastRes.data?.result?.[0];
    // eth_getTransactionCount gives outgoing nonce (sent txs), good enough for display
    const hexCount = countRes.data?.result;
    const total = hexCount ? parseInt(hexCount, 16) : null;
    return {
      firstTx: firstTx ? { hash: firstTx.hash, ts: parseInt(firstTx.timeStamp, 10) * 1000 } : null,
      lastTx:  lastTx  ? { hash: lastTx.hash,  ts: parseInt(lastTx.timeStamp,  10) * 1000 } : null,
      total,
    };
  } catch { return null; }
}

// ── Gitcoin Passport score ────────────────────────────────────────────────────

async function fetchGitcoinScore(address) {
  try {
    const scorerId = process.env.GITCOIN_SCORER_ID || '335';
    const apiKey   = process.env.GITCOIN_API_KEY;
    const headers  = apiKey ? { 'X-API-KEY': apiKey } : {};
    const res = await axios.get(
      `https://api.scorer.gitcoin.co/registry/score/${scorerId}/${address}`,
      { headers, timeout: 8000 }
    );
    if (res.data?.score == null) return null;
    return { score: parseFloat(res.data.score), passing: parseFloat(res.data.score) >= 20 };
  } catch { return null; }
}

// ── BrightID — social-graph uniqueness verification ──────────────────────────
// Uses the Gitcoin app context (largest BrightID app, links ETH addresses).
// validateStatus: true prevents axios throwing on 4xx — we parse error codes ourselves.
// errorNum 3 = not in BrightID; 4 = linked but not sponsored; 2 = not enough connections
async function fetchBrightId(address) {
  try {
    const res = await axios.get(
      `https://app.brightid.org/node/v5/verifications/Gitcoin/${address.toLowerCase()}`,
      { timeout: 6000, validateStatus: () => true }
    );
    const d = res.data;
    if (!d?.error) return { verified: true };                                  // confirmed unique
    if (d.errorNum === 4 || d.errorNum === 2) return { verified: false };     // in BrightID, not verified here
    return null;                                                               // not in BrightID at all
  } catch { return null; }
}

// ── BAB Token — Binance Account Bound (on-chain KYC badge) ───────────────────
// SBT on BNB Chain. If balanceOf > 0, address passed Binance KYC.
async function fetchBabToken(address) {
  try {
    const BAB  = '0x2B09d47D550061f995A3b5C6F0Fd58005215D7c8'; // BSC mainnet
    const data = '0x70a08231' + address.slice(2).toLowerCase().padStart(64, '0');
    const res  = await axios.post('https://bsc-dataseed.binance.org/', {
      jsonrpc: '2.0', id: 1, method: 'eth_call',
      params: [{ to: BAB, data }, 'latest'],
    }, { timeout: 6000 });
    return parseInt(res.data?.result || '0x0', 16) > 0 ? { hasKyc: true } : null;
  } catch { return null; }
}

// ── Nomis — multi-chain reputation score ──────────────────────────────────────
async function fetchNomisScore(address) {
  try {
    // Scores are stored only after the user requests calculation via nomis.cc
    const res = await axios.get(
      `https://api.nomis.cc/api/v1/wallet/1/${address}/score`,
      { timeout: 8000, validateStatus: () => true }
    );
    if (res.status !== 200) return null;
    const val = res.data?.data?.score?.value ?? res.data?.data?.score ?? res.data?.score;
    if (val == null) return null;
    return { score: parseFloat(val) };
  } catch { return null; }
}

// ── Humanity Protocol — biometric / zkTLS proof of humanity ──────────────────
async function fetchHumanityProtocol(address) {
  try {
    const res = await axios.get(
      `https://api.humanityprotocol.com/v1/users/${address}`,
      { timeout: 6000, validateStatus: () => true }
    );
    if (res.status !== 200 || !res.data) return null;
    const d = res.data;
    if (!d.registered && !d.humanityId && !d.verified) return null;
    return { registered: true, humanityId: d.humanityId || null };
  } catch { return null; }
}

// ── Human Protocol (human.tech) — operator/worker reputation ─────────────────
async function fetchHumanTech(address) {
  try {
    const res = await axios.get(
      `https://api.humanprotocol.org/reputation/${address}`,
      { timeout: 6000, validateStatus: () => true }
    );
    if (res.status !== 200 || !res.data) return null;
    const score = res.data.reputationScore ?? res.data.score;
    if (score == null) return null;
    return { score: parseFloat(score) };
  } catch { return null; }
}

// ── Link3 / CyberConnect Profile — BSC on-chain ccProfile NFT ────────────────
// Contract 0x2723..9dA6 on BSC (chain 56). 1.3M+ holders.
// getPrimaryProfile(address) → tokenId; tokenURI(tokenId) → base64 JSON with handle + subscriber count.
const LINK3_CONTRACT = '0x2723522702093601e6360cae665518c4f63e9da6';
const LINK3_ABI = [
  'function getPrimaryProfile(address user) view returns (uint256)',
  'function tokenURI(uint256 tokenId) view returns (string)',
];
let _link3Provider = null;
let _link3Contract = null;

function getLink3Contract() {
  if (!_link3Contract) {
    _link3Provider = new ethers.JsonRpcProvider('https://bsc-dataseed.binance.org');
    _link3Contract = new ethers.Contract(LINK3_CONTRACT, LINK3_ABI, _link3Provider);
  }
  return _link3Contract;
}

async function fetchLink3Profile(address) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return null;
  try {
    const c         = getLink3Contract();
    const checksummed = ethers.getAddress(address);
    const profileId = await c.getPrimaryProfile(checksummed);
    if (!profileId || profileId === 0n) return null;
    const uri  = await c.tokenURI(profileId);
    const b64  = uri.replace('data:application/json;base64,', '');
    const meta = JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));
    const attrs = {};
    for (const a of (meta.attributes || [])) attrs[a.trait_type] = a.value;
    const handle = (attrs.handle || meta.name || '').replace('@', '');
    if (!handle) return null;
    return {
      handle,
      subscribers: parseInt(attrs.subscribers || '0'),
      url: 'https://link3.to/' + handle,
    };
  } catch { return null; }
}

// ── Gnosis Safe — find Safe multisigs where address is an owner ───────────────
async function fetchSafeWallets(address) {
  try {
    const res = await axios.get(
      `https://safe-transaction-mainnet.safe.global/api/v1/owners/${address}/safes/`,
      { timeout: 6000 }
    );
    const safes = res.data?.safes;
    return Array.isArray(safes) && safes.length ? safes.slice(0, 10) : null;
  } catch { return null; }
}

// ── Galxe (Galaxy) — on-chain credential/NFT identity ────────────────────────

async function fetchGalxeProfile(address) {
  try {
    const query = `query { addressInfo(address: "${address}") { id username avatar } }`;
    const res = await axios.post(
      'https://graphigo.prd.galaxy.eco/query',
      { query },
      { headers: { 'Content-Type': 'application/json' }, timeout: 6000 }
    );
    const info = res.data?.data?.addressInfo;
    // Skip auto-generated profiles where username === id (unclaimed Galxe accounts)
    if (!info?.username || info.username === info.id) return null;
    return {
      platform: 'galxe',
      identity: info.username,
      displayName: info.username,
      avatar: info.avatar || null,
      description: null,
      url: `https://app.galxe.com/user/${info.username}`,
    };
  } catch { return null; }
}

// ── ENS reverse lookup ────────────────────────────────────────────────────────

async function fetchEnsName(address) {
  try {
    const res = await axios.get(`https://api.ensdata.net/${address}`, { timeout: 6000 });
    if (!res.data?.ens) return null;
    return {
      name:   res.data.ens,
      avatar: res.data.avatar || null,
      url:    `https://app.ens.domains/${res.data.ens}`,
    };
  } catch { return null; }
}

// ── Tx graph nodes + edges for visualization ──────────────────────────────────
// Builds a 2-hop graph: center → hop-1 counterparties → hop-2 counterparties.
// Each node carries a `hop` property: 0 = center, 1 = direct counterparty, 2 = second-hop.

function buildGraphData(address, counterparties, hop2Map) {
  const nodes = [{ id: address, label: address, isCenter: true, hop: 0 }];
  const edges = [];
  const hop1Set = new Set();

  let i = 0;
  for (const cp of counterparties) {
    if (i >= 30) break;
    nodes.push({ id: cp, label: cp, isCenter: false, hop: 1 });
    edges.push({ source: address, target: cp });
    hop1Set.add(cp);
    i++;
  }

  // Hop-2: counterparties of counterparties
  if (hop2Map?.size) {
    const hop2Added = new Set();
    outer: for (const [hop1Addr, hop2Addrs] of hop2Map) {
      if (!hop1Set.has(hop1Addr)) continue;
      for (const h2 of hop2Addrs) {
        if (hop2Added.size >= 20) break outer;      // cap total hop-2 nodes
        if (h2 === address || hop1Set.has(h2) || hop2Added.has(h2)) continue;
        nodes.push({ id: h2, label: h2, isCenter: false, hop: 2 });
        edges.push({ source: hop1Addr, target: h2 });
        hop2Added.add(h2);
      }
    }
  }

  return { nodes, edges };
}

// ── Bitcoin enrichment (mempool.space, no key) ────────────────────────────────
// tx count, balance, total received. First-seen omitted (requires paginated tx history).

async function fetchBitcoinProfile(address) {
  try {
    const res = await axios.get(`https://mempool.space/api/address/${encodeURIComponent(address)}`, { timeout: 7000 });
    const cs = res.data?.chain_stats || {};
    const txCount = cs.tx_count || 0;
    const funded = cs.funded_txo_sum || 0;
    const spent = cs.spent_txo_sum || 0;
    const balance = funded - spent;
    return {
      txCount,
      totalReceived: funded,
      balance,
      explorer: `https://mempool.space/address/${address}`
    };
  } catch { return null; }
}

// ── Tron enrichment (TronGrid free tier) ──────────────────────────────────────
// TRX balance, USDT holdings (TRC-20), basic vote info, TronScan link.

async function fetchTronProfile(address) {
  try {
    const res = await axios.get(`https://api.trongrid.io/v1/accounts/${encodeURIComponent(address)}`, { timeout: 7000, validateStatus: () => true });
    const acc = res.data?.data?.[0] || {};
    const trxSun = acc.balance || 0;
    const trx = trxSun / 1_000_000_000;
    const trc20 = acc.trc20 || [];
    const usdtKey = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
    const usdtEntry = trc20.find(t => t && t[usdtKey] != null);
    const usdt = usdtEntry ? (parseFloat(usdtEntry[usdtKey]) / 1_000_000_000) : 0;
    const hasVotes = !!(acc.votes && acc.votes.length);
    return {
      trxBalance: trx,
      usdtBalance: usdt,
      hasVotes,
      explorer: `https://tronscan.org/#/address/${address}`
    };
  } catch { return null; }
}

// ── TON enrichment (tonapi.io) ────────────────────────────────────────────────
// Balance (TON), .ton domains, rough NFT presence.

async function fetchTonProfile(address) {
  try {
    const [acctRes, dnsRes] = await Promise.all([
      axios.get(`https://tonapi.io/v2/accounts/${encodeURIComponent(address)}`, { timeout: 7000 }),
      axios.get(`https://tonapi.io/v2/accounts/${encodeURIComponent(address)}/dns/backresolve`, { timeout: 5000, validateStatus: () => true }).catch(() => null)
    ]);
    const bal = acctRes.data?.balance || 0;
    const ton = bal / 1_000_000_000;
    const domains = dnsRes?.data?.domains || [];
    // NFT count: light check (full enumeration expensive; returns >0 if any)
    let nftCount = 0;
    try {
      const n = await axios.get(`https://tonapi.io/v2/accounts/${encodeURIComponent(address)}/nfts?limit=1`, { timeout: 5000, validateStatus: s => s < 500 });
      nftCount = (n.data?.nft_items?.length || 0) > 0 ? 1 : 0;
    } catch {}
    return {
      balance: ton,
      hasDomain: domains.length > 0,
      domains: domains.slice(0, 2),
      hasNfts: nftCount > 0,
      explorer: `https://tonscan.org/address/${address}`
    };
  } catch { return null; }
}

// ── Stellar/XLM enrichment (Horizon, no auth) ─────────────────────────────────
// Native balance, home_domain (federation hint), last activity time.

async function fetchXlmProfile(address) {
  try {
    const res = await axios.get(`https://horizon.stellar.org/accounts/${encodeURIComponent(address)}`, { timeout: 7000, validateStatus: s => s < 500 });
    if (res.status === 404 || !res.data) return null;
    const d = res.data;
    const native = (d.balances || []).find(b => b.asset_type === 'native');
    const xlmBal = native ? parseFloat(native.balance) : 0;
    return {
      xlmBalance: xlmBal,
      homeDomain: d.home_domain || null,
      lastModified: d.last_modified_time || null,
      explorer: `https://stellarchain.io/address/${address}`
    };
  } catch { return null; }
}

// ── Farcaster social data ─────────────────────────────────────────────────────

async function fetchFarcasterData(address) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return null;
  try {
    const userRes = await axios.get(`${FARCASTER_API}/v2/user-by-verification`,
      { params: { address }, timeout: 6000 });
    const user = userRes.data?.result?.user;
    if (!user?.fid) return null;
    const fid = user.fid;

    const [castsRes, hubRes] = await Promise.allSettled([
      axios.get(`${WARPCAST_API}/casts`, { params: { fid, limit: 25 }, timeout: 6000 }),
      axios.get(`${HUB_API}/userDataByFid`, { params: { fid }, timeout: 5000 }),
    ]);

    const ud = {};
    for (const m of (hubRes.value?.data?.messages || [])) {
      const b = m.data?.userDataBody;
      if (b?.type) ud[b.type] = b.value;
    }

    const rawCasts = castsRes.value?.data?.result?.casts || [];
    const casts = rawCasts.map(c => ({
      text:    c.text || '',
      ts:      c.timestamp ? new Date(c.timestamp).getTime() : null,
      channel: (c.parentUrl || c.rootParentUrl || '').match(/\/channel\/([^/?#]+)/)?.[1] || null,
      likes:   c.reactions?.likes || c.reactions?.count || 0,
      replies: c.replies?.count || 0,
    })).filter(c => c.text.length > 1).slice(0, 10);

    return {
      fid,
      username:       ud['USER_DATA_TYPE_USERNAME'] || user.username    || '',
      displayName:    ud['USER_DATA_TYPE_DISPLAY']  || user.displayName || user.username || '',
      bio:            ud['USER_DATA_TYPE_BIO']       || user.profile?.bio?.text || '',
      followerCount:  user.followerCount  || 0,
      followingCount: user.followingCount || 0,
      casts,
    };
  } catch { return null; }
}

// ── Paragraph blog data ───────────────────────────────────────────────────────

function _parseRssItems(xml) {
  const items = [];
  for (const b of (String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g) || [])) {
    const raw = b[1];
    const title     = raw.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/)?.[1]
                   || raw.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '';
    const link      = raw.match(/<link>(https?:\/\/[^\s<]+)<\/link>/)?.[1] || null;
    const pubDate   = raw.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || null;
    const publishedAt = pubDate ? Math.floor(new Date(pubDate).getTime() / 1000) : null;
    if (title.trim()) items.push({ title: title.trim(), url: link, publishedAt });
  }
  return items;
}

async function fetchParagraphData(username) {
  if (!username) return null;
  try {
    const [authorRes, rssRes] = await Promise.allSettled([
      axios.get(`${PARA_API}/blogs/@${username}`, { timeout: 5000 }),
      axios.get(`${PARA_API}/blogs/rss/@${username}`, { timeout: 5000, responseType: 'text' }),
    ]);
    const author = authorRes.value?.data || null;
    const posts  = _parseRssItems(rssRes.value?.data || '').slice(0, 10);
    if (!author && !posts.length) return null;
    return {
      author: author ? {
        handle:      (author.url || username).replace(/^@/, ''),
        displayName: author.name    || null,
        bio:         author.summary || null,
      } : { handle: username },
      posts,
    };
  } catch { return null; }
}

// ── Zora creator data ─────────────────────────────────────────────────────────

async function fetchZoraData(address) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return null;
  try {
    const hdrs = { 'X-API-Key': ZORA_KEY, 'Accept': 'application/json' };
    const [profileRes, coinsRes] = await Promise.allSettled([
      axios.get(`${ZORA_API}/profile`,      { params: { identifier: address }, headers: hdrs, timeout: 8000 }),
      axios.get(`${ZORA_API}/profileCoins`, { params: { identifier: address, count: 20 }, headers: hdrs, timeout: 8000 }),
    ]);
    const zProfile = profileRes.value?.data?.profile || null;
    const edges    = coinsRes.value?.data?.profile?.createdCoins?.edges || [];
    const coins    = edges.map(e => e.node).filter(Boolean).map(c => ({
      name:          c.name          || '',
      symbol:        c.symbol        || '',
      marketCap:     c.marketCap     || '0',
      uniqueHolders: c.uniqueHolders || 0,
      createdAt:     c.createdAt     || null,
    }));
    if (!zProfile && !coins.length) return null;
    return {
      profile: zProfile ? {
        handle:      zProfile.handle      || null,
        displayName: zProfile.displayName || null,
        bio:         zProfile.bio         || null,
      } : null,
      createdCoins: coins,
      totalCreated: coins.length,
    };
  } catch { return null; }
}

// ── Main enrichment ───────────────────────────────────────────────────────────

async function enrichProfile(address, counterparties) {
  const isEvm = /^0x[0-9a-fA-F]{40}$/.test(address);

  const isBitcoin = /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,87}$/i.test(address);
  const isTron    = /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address);
  const isTon     = /^(EQ|UQ|kQ|0Q)[a-zA-Z0-9_-]{46}$/.test(address);
  const isXlm     = /^G[A-Z2-7]{55}$/.test(address);
  const isSolana  = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) && !isTron && !isBitcoin;

  // Stage 1: web3bio + ENS — fast lookups needed to derive Farcaster handle for Paragraph
  const [web3bio, ens] = await Promise.all([
    fetchWeb3Bio(address).catch(() => null),
    isEvm ? fetchEnsName(address).catch(() => null) : Promise.resolve(null),
  ]);

  // Extract a handle for Paragraph lookup (needs username, not address)
  const socialHandle = web3bio?.find(p => p.platform === 'farcaster')?.identity
    || ens?.name?.replace(/\.eth$/i, '')
    || null;

  // Stage 2: all remaining lookups in parallel (social calls included)
  const [txStats, gitcoin, galxe,
         brightid, bab, nomis, humanity, humanTech, safeWallets, link3,
         bitcoin, tron, ton, xlm,
         farcasterData, paragraphData, zoraData] = await Promise.all([
    isEvm ? fetchTxStats(address)          : null,
    isEvm ? fetchGitcoinScore(address)     : null,
    isEvm ? fetchGalxeProfile(address)     : null,
    isEvm ? fetchBrightId(address)         : null,
    isEvm ? fetchBabToken(address)         : null,
    isEvm ? fetchNomisScore(address)       : null,
    isEvm ? fetchHumanityProtocol(address) : null,
    isEvm ? fetchHumanTech(address)        : null,
    isEvm ? fetchSafeWallets(address)      : null,
    isEvm ? fetchLink3Profile(address)     : null,
    isBitcoin ? fetchBitcoinProfile(address) : null,
    isTron    ? fetchTronProfile(address)    : null,
    isTon     ? fetchTonProfile(address)     : null,
    isXlm     ? fetchXlmProfile(address)     : null,
    isEvm ? fetchFarcasterData(address)          : null,
    socialHandle ? fetchParagraphData(socialHandle) : null,
    isEvm ? fetchZoraData(address)               : null,
  ].map(p => (p instanceof Promise ? p : Promise.resolve(p)).catch(() => null)));

  // Merge: ens overrides web3bio ENS entry if richer
  const profiles = web3bio || [];

  // Deduplicate social links across profiles
  const socialMap = {};
  for (const p of profiles) {
    const key = p.platform?.toLowerCase();
    if (!key) continue;
    if (!socialMap[key]) socialMap[key] = p;
  }

  // Pick best avatar (prefer ENS > first web3bio with avatar)
  const avatar = ens?.avatar
    || profiles.find(p => p.avatar)?.avatar
    || null;

  // Pick display name: ENS name > farcaster > lens > first available
  const displayName = ens?.name
    || profiles.find(p => p.platform === 'farcaster')?.displayName
    || profiles.find(p => p.platform === 'lens')?.displayName
    || profiles.find(p => p.displayName)?.displayName
    || null;

  // Bio: first non-empty description
  const bio = profiles.find(p => p.description)?.description || null;

  // Web3 domains: ENS + any .sol etc. from profiles
  const domains = [];
  if (ens?.name) domains.push({ name: ens.name, platform: 'ENS', url: ens.url });
  for (const p of profiles) {
    if (['ens', 'sns', 'basenames', 'uns'].includes(p.platform?.toLowerCase())) {
      const alreadyHave = domains.some(d => d.name === p.identity);
      if (!alreadyHave) domains.push({ name: p.identity, platform: p.platform, url: p.links?.website?.link });
    }
  }

  // Verified links (Twitter, GitHub, Lens, Farcaster, website, etc.)
  // ─ Domain profiles (ENS, Basenames, SNS) carry nested social links in p.links
  //   e.g. ENS.links = { github: {...}, twitter: {...}, website: {...} }
  // ─ Social profiles (Farcaster, Lens) are themselves a link + may carry extras
  // We iterate ALL link keys for ALL profiles and deduplicate by "platform:handle".
  const DOMAIN_PLATFORMS = new Set(['ens','sns','basenames','uns','unstoppabledomains']);
  const linksMap = {}; // key → link object

  for (const p of profiles) {
    const profilePlatform = p.platform?.toLowerCase();

    if (DOMAIN_PLATFORMS.has(profilePlatform)) {
      // Extract every nested social link from domain profiles (github, twitter, website, …)
      for (const [linkType, linkData] of Object.entries(p.links || {})) {
        if (!linkData?.link) continue;
        const key = `${linkType}:${linkData.handle || linkData.link}`;
        if (!linksMap[key]) {
          linksMap[key] = { platform: linkType, identity: linkData.handle || null,
            displayName: linkData.handle || null, avatar: null, description: null, url: linkData.link };
        }
      }
    } else {
      // Social platform entry — add it as a link itself
      const key = `${profilePlatform}:${p.identity}`;
      if (!linksMap[key]) {
        const selfLink = p.links?.[profilePlatform]?.link || null;
        linksMap[key] = { platform: p.platform, identity: p.identity,
          displayName: p.displayName, avatar: p.avatar, description: p.description, url: selfLink };
      }
      // Also extract any additional nested links it carries
      for (const [linkType, linkData] of Object.entries(p.links || {})) {
        if (linkType === profilePlatform || !linkData?.link) continue;
        const k2 = `${linkType}:${linkData.handle || linkData.link}`;
        if (!linksMap[k2]) {
          linksMap[k2] = { platform: linkType, identity: linkData.handle || null,
            displayName: linkData.handle || null, avatar: null, description: null, url: linkData.link };
        }
      }
    }
  }
  // Merge Galxe profile into links (if found and not already present)
  if (galxe) {
    const galxeKey = `galxe:${galxe.identity}`;
    if (!linksMap[galxeKey]) linksMap[galxeKey] = galxe;
  }

  const links = Object.values(linksMap);

  // Graph data — 2-hop: use passed counterparties or fetch directly if empty/missing
  let cpSet = (counterparties instanceof Set && counterparties.size > 0)
    ? counterparties
    : Array.isArray(counterparties) && counterparties.length > 0
      ? new Set(counterparties)
      : null;
  if (!cpSet && isEvm) {
    // Fallback: fetch counterparties directly (cache hit if scan already ran them)
    cpSet = await getCounterparties(address).catch(() => null);
    if (!cpSet?.size) cpSet = null;
  }
  let hop2Map = null;
  if (cpSet?.size > 0) {
    hop2Map = await fetchHop2(cpSet).catch(() => null);
  }
  const graph = cpSet ? buildGraphData(address, cpSet, hop2Map) : null;

  return {
    address,
    avatar,
    displayName,
    bio,
    domains,
    links,          // social platforms
    gitcoin,        // { score, passing } or null
    txStats,        // { firstTx, lastTx, total } or null
    graph,          // { nodes, edges } or null
    identityProtocols: {
      brightid:  brightid  || null,  // { verified } or { verified: false } or null
      bab:       bab       || null,  // { hasKyc: true } or null
      nomis:     nomis     || null,  // { score: 0-100 } or null
      humanity:  humanity  || null,  // { registered: true } or null
      humanTech: humanTech || null,  // { score } or null
    },
    link3Profile:      link3       || null,  // { handle, subscribers, url } or null
    associatedWallets: safeWallets || null,  // Safe multisig addresses or null
    bitcoin: bitcoin || null,
    tron:    tron    || null,
    ton:     ton     || null,
    xlm:     xlm     || null,
    farcasterData: farcasterData || null,
    paragraphData: paragraphData || null,
    zoraData:      zoraData      || null,
  };
}

module.exports = { enrichProfile };
