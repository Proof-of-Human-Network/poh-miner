'use strict';

/**
 * PoH Checker — embedded in the miner node.
 *
 * Exposes runFullCheck(address) and getMethods() with no Express, Redis,
 * or payment logic. Brain and profileEnrich are loaded from the miner's
 * own src/utils/ so they share the same network-synced state.
 */

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const axios  = require('axios');

const { getRpcUrl, callContract }                 = require('./utils/evm');
const { evaluate }                                = require('./eval/evaluator');
const { analyzeTransactionGraph, getCounterparties } = require('./utils/txGraph');
const { isOfacSanctioned, isSanctioned }          = require('./utils/ofac');
const { isInList }                                = require('./utils/labeledWallets');
const { checkHumanityVerified }                   = require('./utils/humanityProtocol');
const { getFarcasterData, getParagraphData }      = require('./utils/social');
const { recordMethodResult }                      = require('./utils/methodHealth');

const brain             = require('./utils/brain');
const { enrichProfile } = require('./utils/profileEnrich');

const METHODS_PATH = path.join(__dirname, '../../data/methods.json');
const DATASET_PATH = path.join(__dirname, '../../data/dataset.json');

// ── Simple in-memory scan cache (30-min TTL) ──────────────────────────────────
const _cache = new Map(); // key → { value, expiresAt }
const CACHE_TTL_MS = 30 * 60 * 1000;

function cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { _cache.delete(key); return null; }
  return entry.value;
}
function cacheSet(key, value) {
  _cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ── Methods ───────────────────────────────────────────────────────────────────

function getMethods() {
  try {
    if (!fs.existsSync(METHODS_PATH)) return [];
    const raw = fs.readFileSync(METHODS_PATH, 'utf-8');
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error('[checker] Error reading methods:', err.message);
    return [];
  }
}

function appendToDataset(record) {
  let dataset = [];
  if (fs.existsSync(DATASET_PATH)) {
    try { dataset = JSON.parse(fs.readFileSync(DATASET_PATH, 'utf-8')); } catch {}
  }
  dataset.push(record);
  const tmp = DATASET_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(dataset, null, 2));
  fs.renameSync(tmp, DATASET_PATH);
}

// ── Address detection ─────────────────────────────────────────────────────────

function isSupportedAddress(raw) {
  if (!raw || typeof raw !== 'string') return false;
  const a = raw.trim();
  return /^0x[0-9a-fA-F]{40}$/.test(a)                           // EVM
    || /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,87}$/i.test(a)          // Bitcoin
    || /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a)                     // Tron
    || /^(EQ|UQ|kQ|0Q)[a-zA-Z0-9_-]{46}$/.test(a)               // TON
    || /^G[A-Z2-7]{55}$/.test(a)                                  // XLM
    || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);                  // Solana
}

// ── ZNS domain resolution ─────────────────────────────────────────────────────

const ZNS_TLD_CHAIN = {
  ink: 57073, bnb: 56, base: 8453, blast: 81457, polygon: 137,
  zora: 7777777, scroll: 534352, taiko: 167000, bera: 80094,
  sonic: 146, kaia: 8217, abstract: 2741, defi: 1301, unichain: 1301,
  soneium: 1868, plume: 98865, hemi: 43111, xrpl: 1440002,
  coti: 7771, katana: 2020, hyper: 999,
};

async function resolveZnsDomain(name) {
  const tld    = name.split('.').pop()?.toLowerCase();
  const domain = name.split('.').slice(0, -1).join('.');
  const chains = tld && ZNS_TLD_CHAIN[tld]
    ? [ZNS_TLD_CHAIN[tld]]
    : Object.values(ZNS_TLD_CHAIN);
  for (const chain of chains) {
    try {
      const res = await axios.get('https://zns.bio/api/resolveDomain', {
        params: { chain, domain }, timeout: 5000,
      });
      if (res.data?.code === 200 && res.data?.address) return res.data.address;
    } catch { /* try next */ }
  }
  return null;
}

// ── OFAC / sanctions ──────────────────────────────────────────────────────────

async function checkOfacFull(address) {
  try {
    const result = isSanctioned(address);
    if (result.sanctioned) return result;
    const ofac = await isOfacSanctioned(address);
    return ofac;
  } catch {
    return { sanctioned: false };
  }
}

function checkTetherBlacklist(results) {
  const hit = results.find(r => r.methodId?.includes('tether') && r.result === true);
  if (!hit) return { blacklisted: false };
  return { blacklisted: true, methodId: hit.methodId, description: hit.description };
}

// ── Method executor ───────────────────────────────────────────────────────────

const METHOD_TIMEOUT_MS     = 14000;
const REST_AXIOS_TIMEOUT_MS = 12000;

async function executeMethod(m, address) {
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), METHOD_TIMEOUT_MS));
  const run = (async () => {
    if (m.type === 'evm') {
      const { ethers } = require('ethers');
      const rpcUrl   = getRpcUrl(Number(m.chainId));
      const decimals = m.decimals != null ? Number(m.decimals) : 18;
      const network  = new ethers.Network(String(m.chainId), Number(m.chainId));
      let result;
      if (m.method === 'eth_getBalance') {
        const p = new ethers.JsonRpcProvider(rpcUrl, network, { staticNetwork: network });
        result = [await p.getBalance(address)];
      } else if (m.method === 'eth_getTransactionCount') {
        const p = new ethers.JsonRpcProvider(rpcUrl, network, { staticNetwork: network });
        result = [BigInt(await p.getTransactionCount(address))];
      } else if (m.method === 'eth_getCode') {
        const p = new ethers.JsonRpcProvider(rpcUrl, network, { staticNetwork: network });
        result = [await p.getCode(address)];
      } else {
        result = await callContract(rpcUrl, m.address, m.method,
          JSON.parse(m.abiTypes || '[]'), JSON.parse(m.returnTypes || '[]'),
          [address, ...(m.extraParams ? JSON.parse(m.extraParams) : [])], m.chainId);
      }
      return evaluate(m.expression, { result, decimals }, m.lang || 'js');

    } else if (m.type === 'rest') {
      const rawUrl    = m.address;
      const hasHolder = rawUrl.includes('{address}');
      const url       = hasHolder ? rawUrl.replace(/\{address\}/g, encodeURIComponent(address)) : rawUrl;
      const method    = (m.method || 'GET').toUpperCase();
      const headers   = m.headers ? JSON.parse(m.headers) : {};
      const decimals  = m.decimals != null ? Number(m.decimals) : 18;
      let response;
      if (method === 'POST') {
        const body = JSON.parse((m.body || '{}').replace(/\{address\}/g, address));
        response = await axios.post(url, body, { headers, timeout: REST_AXIOS_TIMEOUT_MS, validateStatus: s => s < 500 });
      } else {
        const params = hasHolder ? {} : { address };
        response = await axios.get(url, { params, headers, timeout: REST_AXIOS_TIMEOUT_MS, validateStatus: s => s < 500 });
      }
      return evaluate(m.expression, { data: response.data, status: response.status, decimals }, m.lang || 'js');

    } else if (m.type === 'solana') {
      const { Connection, PublicKey }                  = require('@solana/web3.js');
      const { getAssociatedTokenAddress, getAccount }  = require('@solana/spl-token');
      const conn     = new Connection(process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com', 'confirmed');
      const pubkey   = new PublicKey(address);
      const decimals = m.decimals != null ? Number(m.decimals) : 9;
      let result = null;
      if (m.method === 'getBalance') {
        result = await conn.getBalance(pubkey);
      } else if (m.method === 'getTransactionCount') {
        result = await conn.getTransactionCount(pubkey);
      } else if (m.method === 'getTokenBalance' && m.address) {
        const ata     = await getAssociatedTokenAddress(new PublicKey(m.address), pubkey);
        const account = await getAccount(conn, ata);
        result = Number(account.amount);
      } else if (m.method === 'getAccountInfo') {
        result = (await conn.getAccountInfo(pubkey))?.executable ?? false;
      } else if (m.method === 'getProgramAccounts' && m.address) {
        const accounts = await conn.getProgramAccounts(new PublicKey(m.address), {
          filters: [{ memcmp: { offset: 8, bytes: address } }],
        });
        result = accounts.length > 0;
      }
      return evaluate(m.expression, { result, decimals }, m.lang || 'js');

    } else if (m.type === 'labeled') {
      return evaluate(m.expression, { result: isInList(m.file, address) }, m.lang || 'js');

    } else if (m.type === 'ton') {
      let args = [];
      if (m.tonArgs) args = JSON.parse(m.tonArgs);
      else if (m.abiTypes) {
        const raw = JSON.parse(m.abiTypes);
        if (Array.isArray(raw)) {
          args = raw.map(val => {
            if (typeof val === 'string' && val.startsWith('EQ')) return { type: 'slice', value: val };
            if (typeof val === 'number' || /^\d+$/.test(val)) return { type: 'int', value: String(val) };
            return { type: 'slice', value: val };
          });
        }
      }
      const res = await axios.post(
        `https://tonapi.io/v2/blockchain/accounts/${m.address}/methods/${m.method}`,
        { args }, { timeout: 15000 }
      );
      return evaluate(m.expression, { result: res.data?.stack || [], decimals: m.decimals != null ? Number(m.decimals) : 9 }, m.lang || 'js');

    } else if (m.type === 'tron') {
      const { ethers } = require('ethers');
      const inputTypes = JSON.parse(m.abiTypes || '[]');
      const args = [address, ...(m.extraParams ? JSON.parse(m.extraParams) : [])];
      const iface = new ethers.Interface([`function ${m.method}(${inputTypes.join(',')})`]);
      const data = iface.encodeFunctionData(m.method, args);
      const res = await axios.post('https://api.trongrid.io/wallet/triggerconstantcontract', {
        contract_address: m.address,
        function_selector: m.method + '(' + inputTypes.join(',') + ')',
        parameter: data.slice(2),
        owner_address: address,
      }, { timeout: 15000, validateStatus: () => true });
      const constantResult = res.data?.constant_result?.[0] || '';
      const returnTypes = JSON.parse(m.returnTypes || '[]');
      let result = [];
      if (constantResult && returnTypes.length > 0) {
        result = Array.from(iface.decodeFunctionResult(m.method, '0x' + constantResult));
      }
      return evaluate(m.expression, { result, decimals: m.decimals != null ? Number(m.decimals) : 6 }, m.lang || 'js');
    }

    return false;
  })();
  return Promise.race([run, timeout]);
}

// ── Scan wallet against all applicable methods ────────────────────────────────

async function scanWallet(rawInput, { allMethods, chainFilter }) {
  const isZnsDomain = /^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(rawInput) && !/^0x/.test(rawInput);
  let address = rawInput;
  if (isZnsDomain) {
    const resolved = await resolveZnsDomain(rawInput);
    if (!resolved) return [{ input: rawInput, error: 'ZNS domain could not be resolved' }];
    address = resolved;
  }

  const isEvm     = /^0x[0-9a-fA-F]{40}$/.test(address);
  const isBitcoin = /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,87}$/i.test(address);
  const isTron    = /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address);
  const isTon     = /^(EQ|UQ|kQ|0Q)[a-zA-Z0-9_-]{46}$/.test(address);
  const isXlm     = /^G[A-Z2-7]{55}$/.test(address);
  const isSolana  = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) && !isTron && !isBitcoin && !isTon && !isXlm;

  const chain = isEvm ? 'evm' : isBitcoin ? 'bitcoin' : isTron ? 'tron' : isTon ? 'ton' : isXlm ? 'xlm' : isSolana ? 'solana' : null;
  if (!chain) return [{ input: address, error: 'Unrecognised address format' }];

  let methods = [...allMethods];
  if (isEvm) {
    methods = methods.filter(m => m.type === 'evm' || m.type === 'rest' || m.type === 'labeled');
    methods = methods.filter(m => !m.addressType || m.addressType === 'evm');
    if (chainFilter) {
      const allowed = chainFilter.split(',').map(Number);
      methods = methods.filter(m => m.type === 'rest' || allowed.includes(Number(m.chainId)));
    }
    methods = methods.filter(m => m.type !== 'rest' || !m.supportedChains?.length || m.supportedChains.includes('evm'));
  } else if (isSolana) {
    methods = methods.filter(m => m.type === 'solana' || m.type === 'rest' || m.type === 'labeled');
    methods = methods.filter(m => !m.addressType || m.addressType === 'solana');
    methods = methods.filter(m => m.type !== 'rest' || (Array.isArray(m.supportedChains) && m.supportedChains.includes('solana')));
  } else {
    methods = methods.filter(m =>
      m.type === chain ||
      (m.type === 'rest' && (!m.chain || m.chain === chain)) ||
      m.type === 'labeled'
    );
    methods = methods.filter(m => !m.addressType || m.addressType === chain);
    methods = methods.filter(m => m.type !== 'rest' || (Array.isArray(m.supportedChains) && m.supportedChains.includes(chain)));
  }
  if (methods.length === 0) return [];

  const cacheKey = `scan:${address}:${chainFilter || 'all'}`;
  const cached   = cacheGet(cacheKey);
  if (cached && cached.methodCount === methods.length) return cached.data;

  console.log(`[checker] Scanning ${methods.length} methods for ${address.slice(0, 16)}…`);

  const [settled, graphResults, humanityResult] = await Promise.all([
    Promise.allSettled(methods.map(m => executeMethod(m, address))),
    analyzeTransactionGraph(address),
    checkHumanityVerified(address),
  ]);

  const results = settled.map((s, i) => {
    const m       = methods[i];
    const isError = s.status === 'rejected';
    const outcome = s.status === 'fulfilled' ? Boolean(s.value) : false;
    if (isError) console.error(`[checker] ✗ "${m.description?.slice(0, 50)}" failed: ${s.reason?.message}`);
    if (m.type === 'rest' || m.type === 'evm') recordMethodResult(m.id, isError);
    appendToDataset({
      instruction: `Verification response for ${address} using ${m.description}`,
      input:  JSON.stringify(m),
      output: outcome ? 'Evidence of human activity' : 'No evidence of human activity',
    });
    return { input: address, methodId: m.id, description: m.description, result: outcome };
  });

  results.push(...graphResults);
  if (humanityResult) results.push(humanityResult);

  cacheSet(cacheKey, { data: results, methodCount: methods.length });
  return results;
}

// ── Full check (signals + brain + profile + vibe) ────────────────────────────

async function runFullCheck(input, options = {}) {
  const allMethods = (options.methods && options.methods.length > 0) ? options.methods : getMethods();
  const scanCtx    = { allMethods, chainFilter: options.chainFilter };

  let results = await scanWallet(input, scanCtx);

  // Sanctions / special signals
  const ofac = await checkOfacFull(input);
  if (ofac.sanctioned) {
    results.unshift({
      input, methodId: 'ofac_check',
      description: `⛔ ${ofac.list || 'SANCTIONS'} — ${ofac.name}`,
      result: false, ofac,
    });
  }

  const tether = checkTetherBlacklist(results);
  if (tether.blacklisted) {
    results.unshift({
      input, methodId: tether.methodId,
      description: `⛔ ${tether.description}`,
      result: true, tetherBlacklist: true,
    });
  }

  if (isInList('cex', input)) {
    results.unshift({ input, methodId: 'cex_check', description: '🏦 CEX wallet', result: false });
  }

  // Brain verdict
  let verdict = await brain.analyzeHumanness(input, results, allMethods);
  if (results.some(r => r.tetherBlacklist)) {
    verdict = { verdict: 'AI', confidence: 0.99, reasoning: 'Address frozen by Tether USDT (blacklist)' };
  }

  // Profile enrichment
  let profile = null;
  try {
    const counterparties = await getCounterparties(input).catch(() => []);
    profile = await enrichProfile(input, counterparties);
  } catch {}

  // Social vibe (EVM only)
  let vibeData = null, farcasterData = null, paragraphData = null;
  if (/^0x[0-9a-fA-F]{40}$/.test(input)) {
    try {
      const [fc, pg] = await Promise.all([
        getFarcasterData(input).catch(() => null),
        getParagraphData(input).catch(() => null),
      ]);
      farcasterData = fc;
      paragraphData = pg;
      if (farcasterData || paragraphData) {
        vibeData = await brain.vibeCheck(input, { farcasterData, paragraphData }).catch(() => null);
      }
    } catch (e) {
      console.warn('[checker] vibe check failed:', e.message);
    }
  }

  return {
    input,
    results,
    verdict:    verdict.verdict    || 'UNCERTAIN',
    confidence: verdict.confidence || 0.5,
    reasoning:  verdict.reasoning  || '',
    profile,
    realPoh: true,
    vibeData,
    farcasterData,
    paragraphData,
  };
}

module.exports = { runFullCheck, getMethods, scanWallet, executeMethod, isSupportedAddress };
