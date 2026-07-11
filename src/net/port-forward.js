/**
 * Automatic port forwarding — best-effort, dependency-free.
 *
 * Lets a home node become publicly reachable ("start the binary, done") without
 * the user touching their router, by asking the gateway to open a port via:
 *   1. UPnP-IGD  — SSDP multicast discovery + SOAP AddPortMapping (most consumer routers)
 *   2. NAT-PMP   — UDP request to the default gateway (Apple + many others)
 *
 * Neither is universal (UPnP is often disabled, and nothing works behind CGNAT),
 * so callers must still VERIFY reachability afterwards (the bootnode /probe) before
 * advertising a public address. Every function is defensive: it never throws and
 * resolves to null/false on any failure so startup is never blocked.
 *
 * Pure Node core only (dgram/http/net/os) so it bundles cleanly into the packaged
 * cross-platform binaries.
 */

import dgram from 'dgram';
import http from 'http';
import os from 'os';
import { execSync } from 'child_process';

const SSDP_ADDR = '239.255.255.250';
const SSDP_PORT = 1900;

/** Primary non-internal IPv4 of this host (the LAN address to forward to). */
export function localIPv4() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) return ni.address;
    }
  }
  return null;
}

/** Best-effort default gateway IPv4 (for NAT-PMP). Falls back to <subnet>.1. */
export function defaultGatewayIPv4() {
  try {
    if (process.platform === 'linux') {
      // /proc/net/route: gateway is little-endian hex in the row with Destination 00000000
      const rows = execSync('cat /proc/net/route', { timeout: 2000, encoding: 'utf8' }).trim().split('\n').slice(1);
      for (const r of rows) {
        const f = r.split(/\s+/);
        if (f[1] === '00000000' && f[2] && f[2] !== '00000000') {
          const h = f[2];
          return [h.slice(6, 8), h.slice(4, 6), h.slice(2, 4), h.slice(0, 2)].map(x => parseInt(x, 16)).join('.');
        }
      }
    } else {
      // macOS / BSD / Windows: parse the routing table for the default route.
      const cmd = process.platform === 'win32' ? 'route print 0.0.0.0' : 'netstat -rn';
      const out = execSync(cmd, { timeout: 3000, encoding: 'utf8' });
      const m = out.match(/(?:default|0\.0\.0\.0)\s+(\d+\.\d+\.\d+\.\d+)/);
      if (m) return m[1];
    }
  } catch { /* fall through */ }
  const ip = localIPv4();
  return ip ? ip.replace(/\.\d+$/, '.1') : null;
}

// ── UPnP-IGD ────────────────────────────────────────────────────────────────

function ssdpDiscover(timeoutMs = 3000) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    const found = [];
    const msg = Buffer.from(
      'M-SEARCH * HTTP/1.1\r\n' +
      `HOST: ${SSDP_ADDR}:${SSDP_PORT}\r\n` +
      'MAN: "ssdp:discover"\r\n' +
      'MX: 2\r\n' +
      'ST: urn:schemas-upnp-org:device:InternetGatewayDevice:1\r\n\r\n'
    );
    const done = () => { try { sock.close(); } catch {} resolve(found); };
    sock.on('message', (buf) => {
      const loc = /LOCATION:\s*(\S+)/i.exec(buf.toString());
      if (loc && !found.includes(loc[1])) found.push(loc[1]);
    });
    sock.on('error', done);
    try {
      sock.bind(() => { try { sock.send(msg, SSDP_PORT, SSDP_ADDR); } catch {} });
    } catch { return done(); }
    setTimeout(done, timeoutMs);
  });
}

function httpGet(url, timeoutMs = 4000) {
  return new Promise((resolve) => {
    try {
      const req = http.get(url, { timeout: timeoutMs }, (res) => {
        let body = '';
        res.on('data', d => (body += d));
        res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    } catch { resolve(null); }
  });
}

function soap(controlUrl, serviceType, action, args, timeoutMs = 5000) {
  const body =
    '<?xml version="1.0"?>' +
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ' +
    's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
    `<s:Body><u:${action} xmlns:u="${serviceType}">` +
    Object.entries(args).map(([k, v]) => `<${k}>${v}</${k}>`).join('') +
    `</u:${action}></s:Body></s:Envelope>`;
  return new Promise((resolve) => {
    try {
      const u = new URL(controlUrl);
      const req = http.request({
        host: u.hostname, port: u.port || 80, path: u.pathname, method: 'POST', timeout: timeoutMs,
        headers: {
          'Content-Type': 'text/xml; charset="utf-8"',
          'Content-Length': Buffer.byteLength(body),
          SOAPAction: `"${serviceType}#${action}"`,
        },
      }, (res) => {
        let r = '';
        res.on('data', d => (r += d));
        res.on('end', () => resolve({ status: res.statusCode, body: r }));
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.end(body);
    } catch { resolve(null); }
  });
}

async function findIgdService() {
  const locations = await ssdpDiscover();
  for (const loc of locations) {
    const desc = await httpGet(loc);
    if (!desc?.body) continue;
    // Prefer WANIPConnection, fall back to WANPPPConnection.
    for (const st of ['urn:schemas-upnp-org:service:WANIPConnection:1',
                      'urn:schemas-upnp-org:service:WANPPPConnection:1',
                      'urn:schemas-upnp-org:service:WANIPConnection:2']) {
      const idx = desc.body.indexOf(st);
      if (idx === -1) continue;
      const seg = desc.body.slice(idx);
      const ctrl = /<controlURL>([^<]+)<\/controlURL>/i.exec(seg);
      if (!ctrl) continue;
      const base = new URL(loc);
      const controlUrl = new URL(ctrl[1], `${base.protocol}//${base.host}`).toString();
      return { controlUrl, serviceType: st };
    }
  }
  return null;
}

async function upnpMap(port, { ttlSeconds = 3600, description = 'PoH Miner' } = {}) {
  const svc = await findIgdService();
  if (!svc) return { ok: false, method: 'upnp', reason: 'no IGD found' };
  const internal = localIPv4();
  if (!internal) return { ok: false, method: 'upnp', reason: 'no LAN IP' };
  const res = await soap(svc.controlUrl, svc.serviceType, 'AddPortMapping', {
    NewRemoteHost: '',
    NewExternalPort: port,
    NewProtocol: 'TCP',
    NewInternalPort: port,
    NewInternalClient: internal,
    NewEnabled: 1,
    NewPortMappingDescription: description,
    NewLeaseDuration: ttlSeconds,
  });
  if (res && res.status === 200) return { ok: true, method: 'upnp', internal, port };
  return { ok: false, method: 'upnp', reason: `SOAP status ${res?.status ?? 'none'}` };
}

// ── NAT-PMP ───────────────────────────────────────────────────────────────────

function natpmpMap(port, { ttlSeconds = 3600 } = {}) {
  return new Promise((resolve) => {
    const gw = defaultGatewayIPv4();
    if (!gw) return resolve({ ok: false, method: 'natpmp', reason: 'no gateway' });
    const sock = dgram.createSocket('udp4');
    // Request: ver=0, op=2 (map TCP), reserved=0, internal port, external port (suggest same), lifetime
    const req = Buffer.alloc(12);
    req.writeUInt8(0, 0); req.writeUInt8(2, 1); req.writeUInt16BE(0, 2);
    req.writeUInt16BE(port, 4); req.writeUInt16BE(port, 6); req.writeUInt32BE(ttlSeconds, 8);
    const done = (v) => { try { sock.close(); } catch {} resolve(v); };
    const timer = setTimeout(() => done({ ok: false, method: 'natpmp', reason: 'timeout' }), 3000);
    sock.on('message', (msg) => {
      clearTimeout(timer);
      // Response: ver, op(=130), resultCode(2B), epoch(4B), internalPort(2B), externalPort(2B), lifetime(4B)
      const resultCode = msg.length >= 4 ? msg.readUInt16BE(2) : -1;
      if (resultCode === 0) {
        const externalPort = msg.length >= 12 ? msg.readUInt16BE(10) : port;
        done({ ok: true, method: 'natpmp', port: externalPort });
      } else {
        done({ ok: false, method: 'natpmp', reason: `result ${resultCode}` });
      }
    });
    sock.on('error', () => { clearTimeout(timer); done({ ok: false, method: 'natpmp', reason: 'socket error' }); });
    try { sock.send(req, 5351, gw); } catch { clearTimeout(timer); done({ ok: false, method: 'natpmp', reason: 'send failed' }); }
  });
}

/**
 * Try to auto-open `port` on the gateway. Attempts UPnP-IGD first, then NAT-PMP.
 * Best-effort: resolves to { ok, method, ... }; ok:false just means the caller
 * stays a follower (verified separately via the bootnode /probe). Never throws.
 */
export async function autoForwardPort(port, opts = {}) {
  try {
    const up = await upnpMap(port, opts);
    if (up.ok) return up;
    const pmp = await natpmpMap(port, opts);
    if (pmp.ok) return pmp;
    return { ok: false, method: 'none', reason: `${up.reason}; ${pmp.reason}` };
  } catch (e) {
    return { ok: false, method: 'none', reason: e.message };
  }
}
