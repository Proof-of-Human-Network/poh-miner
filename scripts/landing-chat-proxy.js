#!/usr/bin/env node
/**
 * Landing page chat proxy — signs 0.01 POH compute jobs with the local miner wallet
 * and submits them to the public miner API. Web visitors have no POH; this server pays.
 *
 * Run on hk:  node scripts/landing-chat-proxy.js
 * Nginx:     location /landing-api/ { proxy_pass http://127.0.0.1:3457/; }
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { Wallet, WalletManager } from '../src/wallet/wallet.js';

const PORT = parseInt(process.env.LANDING_CHAT_PORT || '3457', 10);
const MINER_URL = (process.env.LANDING_CHAT_MINER_URL || 'http://127.0.0.1:3456').replace(/\/$/, '');
const MAX_MESSAGES = parseInt(process.env.LANDING_CHAT_MAX_PER_IP || '10', 10);
const FEE_UPOH = parseInt(process.env.LANDING_CHAT_FEE_UPOH || String(10_000_000), 10); // 0.01 POH
const RATE_FILE = path.join(os.homedir(), '.poh-miner', 'landing-chat-ratelimit.json');
const POLL_MS = 2000;
const POLL_MAX = 45;

function computeJobPaymentHash({ jobId, requesterAddress, minerAddress, amount, nonce }) {
  return crypto.createHash('sha256')
    .update(JSON.stringify({ jobId, requesterAddress, minerAddress, amount, nonce }))
    .digest('hex');
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 64_000) reject(new Error('body too large')); });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error('invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}

function loadRateLimits() {
  try {
    if (fs.existsSync(RATE_FILE)) return JSON.parse(fs.readFileSync(RATE_FILE, 'utf8'));
  } catch { /* */ }
  return {};
}

function saveRateLimits(data) {
  const dir = path.dirname(RATE_FILE);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(RATE_FILE, JSON.stringify(data, null, 2));
}

function consumeRateSlot(ip) {
  const limits = loadRateLimits();
  const entry = limits[ip] || { count: 0, since: Date.now() };
  if (entry.count >= MAX_MESSAGES) {
    return { allowed: false, remaining: 0, used: entry.count };
  }
  entry.count += 1;
  limits[ip] = entry;
  saveRateLimits(limits);
  return { allowed: true, remaining: MAX_MESSAGES - entry.count, used: entry.count };
}

function releaseRateSlot(ip) {
  const limits = loadRateLimits();
  const entry = limits[ip];
  if (!entry || entry.count <= 0) return;
  entry.count -= 1;
  limits[ip] = entry;
  saveRateLimits(limits);
}

function corsHeaders(origin) {
  const allowed = [
    'https://miner.proofofhuman.ge',
    'http://miner.proofofhuman.ge',
    'https://proofofhuman.ge',
    'http://proofofhuman.ge',
    'http://localhost:4321',
    'http://127.0.0.1:4321',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ];
  const h = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
  if (origin && (allowed.includes(origin) || origin.includes('localhost'))) {
    h['Access-Control-Allow-Origin'] = origin;
  } else {
    h['Access-Control-Allow-Origin'] = 'https://miner.proofofhuman.ge';
  }
  return h;
}

async function minerFetch(pathname, opts = {}) {
  const url = `${MINER_URL}${pathname}`;
  const r = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    signal: AbortSignal.timeout(opts.timeout || 90_000),
  });
  const text = await r.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  return { ok: r.ok, status: r.status, json };
}

async function resolveMinerAddress(cached) {
  try {
    const info = await minerFetch('/api/miner/info', { timeout: 8000 });
    return info.json?.minerAddress || cached;
  } catch {
    return cached;
  }
}

async function signJobPayment(wallet, minerAddress, jobId, amount) {
  const requesterAddress = wallet.address;
  const nonceRes = await minerFetch(`/api/wallet/nonce?address=${encodeURIComponent(requesterAddress)}`);
  const nonce = nonceRes.json?.nonce ?? wallet.nonce ?? 0;
  const txHash = computeJobPaymentHash({
    jobId,
    requesterAddress,
    minerAddress,
    amount,
    nonce,
  });
  const signature = wallet.sign(txHash);
  return { requesterAddress, txHash, signature, nonce };
}

async function pollJobResult(jobId) {
  for (let i = 0; i < POLL_MAX; i++) {
    const { status, json } = await minerFetch(`/job/${jobId}/result`, { timeout: 15_000 });
    if (status === 200 && json?.profile?.computeOutput) {
      return { message: json.profile.computeOutput, jobId, model: json.profile.model || json.evidence?.modelUsed };
    }
    if (status === 200 && json?.message) {
      return { message: json.message, jobId };
    }
    if (json?.status === 'error' || json?.verdict === 'REJECTED') {
      throw new Error(json.reason || json.error || 'Job failed');
    }
    await new Promise(r => setTimeout(r, POLL_MS));
  }
  throw new Error('Job timed out — miner is busy, try again');
}

async function handleChat(body, sponsorWallet, minerAddress, model) {
  const message = String(body.message || '').trim();
  if (!message) throw new Error('message required');
  if (message.length > 4000) throw new Error('message too long');

  const history = Array.isArray(body.history) ? body.history.slice(-12) : [];
  const requesterAddress = sponsorWallet.address;
  minerAddress = await resolveMinerAddress(minerAddress);

  // Chain history match (free, no job fee)
  try {
    const matchRes = await minerFetch(
      `/api/search/history-match?q=${encodeURIComponent(message)}&wallet=${encodeURIComponent(requesterAddress)}`,
      { timeout: 8000 },
    );
    if (matchRes.json?.match?.reply) {
      return {
        type: 'chat',
        message: matchRes.json.match.reply,
        fromChainHistory: true,
        jobId: matchRes.json.match.jobId,
      };
    }
  } catch { /* continue to paid job */ }

  const jobId = `web-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const { txHash, signature } = await signJobPayment(sponsorWallet, minerAddress, jobId, FEE_UPOH);

  const jobBody = {
    id: jobId,
    type: 'compute',
    model: body.model || model,
    payload: { prompt: message, history },
    maxBudget: FEE_UPOH,
    requesterAddress,
    paymentTx: { txHash, signature },
    source: 'landing-web',
  };

  const submit = await minerFetch('/job', { method: 'POST', body: JSON.stringify(jobBody) });
  if (!submit.ok) {
    throw new Error(submit.json?.error || `Job submit failed (HTTP ${submit.status})`);
  }

  const submittedId = submit.json?.jobId || jobId;
  const result = await pollJobResult(submittedId);
  return { type: 'chat', ...result, feeUpoh: FEE_UPOH };
}

function createServer(ctx) {
  return http.createServer(async (req, res) => {
    const origin = req.headers.origin || '';
    const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };

    if (req.method === 'OPTIONS') {
      res.writeHead(204, headers);
      return res.end();
    }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        res.writeHead(200, headers);
        return res.end(JSON.stringify({ ok: true, miner: MINER_URL, maxPerIp: MAX_MESSAGES }));
      }

      const ip = clientIp(req);

      if (req.method === 'GET' && url.pathname === '/api/search/suggest') {
        const q = url.searchParams.get('q') || '';
        const limit = url.searchParams.get('limit') || '8';
        const wallet = ctx.sponsorAddress;
        const proxy = await minerFetch(
          `/api/search/suggest?q=${encodeURIComponent(q)}&wallet=${encodeURIComponent(wallet)}&limit=${limit}`,
          { timeout: 8000 },
        );
        res.writeHead(proxy.status, headers);
        return res.end(JSON.stringify(proxy.json));
      }

      if (req.method === 'GET' && url.pathname === '/api/search/history-match') {
        const q = url.searchParams.get('q') || '';
        const wallet = ctx.sponsorAddress;
        const proxy = await minerFetch(
          `/api/search/history-match?q=${encodeURIComponent(q)}&wallet=${encodeURIComponent(wallet)}`,
          { timeout: 8000 },
        );
        res.writeHead(proxy.status, headers);
        return res.end(JSON.stringify(proxy.json));
      }

      if (req.method === 'GET' && url.pathname === '/api/rate-limit') {
        const limits = loadRateLimits();
        const entry = limits[ip] || { count: 0 };
        res.writeHead(200, headers);
        return res.end(JSON.stringify({
          used: entry.count,
          max: MAX_MESSAGES,
          remaining: Math.max(0, MAX_MESSAGES - entry.count),
        }));
      }

      if (req.method === 'POST' && url.pathname === '/api/chat') {
        const rate = consumeRateSlot(ip);
        if (!rate.allowed) {
          res.writeHead(429, headers);
          return res.end(JSON.stringify({
            error: 'Rate limit exceeded',
            code: 'RATE_LIMIT',
            used: rate.used,
            max: MAX_MESSAGES,
          }));
        }

        try {
          const body = await readJsonBody(req);
          const result = await handleChat(body, ctx.sponsorWallet, ctx.minerAddress, ctx.model);
          res.writeHead(200, headers);
          return res.end(JSON.stringify({ ...result, remaining: rate.remaining, used: rate.used }));
        } catch (e) {
          releaseRateSlot(ip);
          throw e;
        }
      }

      res.writeHead(404, headers);
      res.end(JSON.stringify({ error: 'not found' }));
    } catch (e) {
      console.error('[LandingChat]', e.message);
      res.writeHead(500, { ...headers });
      res.end(JSON.stringify({ error: e.message || 'internal error' }));
    }
  });
}

function loadSponsorConfig() {
  const globalPath = path.join(os.homedir(), '.poh-miner', 'config.json');
  if (fs.existsSync(globalPath)) {
    try { return JSON.parse(fs.readFileSync(globalPath, 'utf8')); } catch { /* */ }
  }
  return loadConfig();
}

async function main() {
  const config = loadSponsorConfig();
  const sponsorAddress = process.env.LANDING_CHAT_SPONSOR
    || config.landingChat?.sponsorWallet
    || config.landingChat?.sponsor
    || config.sponsorWallet;
  if (!sponsorAddress) {
    console.error('[LandingChat] Set landingChat.sponsorWallet in ~/.poh-miner/config.json or LANDING_CHAT_SPONSOR');
    process.exit(1);
  }

  const minerInfo = await minerFetch('/api/miner/info', { timeout: 10_000 });
  const minerAddress = minerInfo.json?.minerAddress || process.env.LANDING_CHAT_MINER_WALLET;
  if (!minerAddress) {
    console.error('[LandingChat] Could not resolve miner address from /api/miner/info');
    process.exit(1);
  }

  const wm = new WalletManager();
  let wallet = wm.loadWallet(sponsorAddress);
  if (!wallet?.signingPrivateKey) {
    console.error(`[LandingChat] Sponsor wallet ${sponsorAddress} has no signing key on this machine`);
    process.exit(1);
  }
  wallet = wm.ensureCanonicalAddress(wallet);

  const model = config.model || 'qwen2.5:1.5b';
  const ctx = {
    sponsorWallet: wallet,
    sponsorAddress: wallet.address,
    minerAddress,
    model,
  };

  const server = createServer(ctx);
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[LandingChat] Proxy listening on http://127.0.0.1:${PORT}`);
    console.log(`[LandingChat] Miner: ${MINER_URL} (${ctx.minerAddress.slice(0, 16)}…) · sponsor: ${ctx.sponsorAddress.slice(0, 16)}…`);
    console.log(`[LandingChat] Fee: ${FEE_UPOH / 1e9} POH/msg · max ${MAX_MESSAGES}/IP`);
  });
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});