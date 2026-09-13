/**
 * API security helpers — localhost gating and CORS policy for the wallet API server.
 */

const LOCAL_ADDRS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** POST paths reachable from remote peers (everything else is localhost-only). */
const PUBLIC_POST_PATHS = new Set(['/gossip']);

/**
 * Prefixes reachable from remote peers. Used where the path carries an id, so an
 * exact-match Set cannot express it.
 *
 * /api/pair/ is the browser↔signer rendezvous. It is intentionally open: the
 * whole point is to bootstrap a session for a caller that has no identity yet,
 * and it carries only payloads sealed to a session key the relay cannot read.
 * Abuse is bounded inside PairingRelay (topic/message/size/TTL caps) rather than
 * by an identity check that cannot exist at this stage of the handshake.
 *
 * /api/mcp/execute is NOT public. Builtin tools (including onion-search) still
 * run inside a paid /job; remote callers cannot use this node as a free proxy.
 */
const PUBLIC_POST_PREFIXES = ['/api/pair/'];

/** Origins a loopback admin UI is allowed to CORS-share with. Never https://evil. */
function isTrustedLocalOrigin(origin) {
  if (!origin || origin === 'null' || origin === 'file://') return true;
  try {
    const u = new URL(origin);
    return u.protocol === 'file:'
      || ((u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '::1')
          && (u.protocol === 'http:' || u.protocol === 'https:'));
  } catch {
    return false;
  }
}

export function isLocalRequest(req) {
  const remote = (req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  return remote === '127.0.0.1' || remote === '::1' || LOCAL_ADDRS.has(req.socket?.remoteAddress || '');
}

/**
 * True only for requests originating on this machine and NOT relayed through a
 * reverse proxy. nginx proxies to 127.0.0.1, so socket IP is loopback for every
 * external request too. A real reverse proxy stamps X-Forwarded-For / X-Real-IP;
 * a genuine local admin client does not.
 */
export function isTrulyLocalRequest(req) {
  if (!isLocalRequest(req)) return false;
  const h = req.headers || {};
  if (h['x-forwarded-for'] || h['x-real-ip'] || h['forwarded']) return false;
  return true;
}

export function isPublicPostPath(pathname) {
  if (PUBLIC_POST_PATHS.has(pathname)) return true;
  return PUBLIC_POST_PREFIXES.some(prefix => pathname.startsWith(prefix));
}

export function isStateChangingMethod(method) {
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
}

/**
 * Apply CORS headers. Wildcard origin is never used for state-changing routes.
 */
export function applyCorsHeaders(req, res) {
  const origin = req.headers.origin;
  const local = isLocalRequest(req);
  const stateChanging = isStateChangingMethod(req.method);

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');

  // Reflect Origin only for the local desktop/file UI. Reflecting an arbitrary
  // https origin on loopback lets a malicious page CSRF /api/wallet/send.
  if (local && isTrustedLocalOrigin(origin)) {
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin === 'null' ? 'null' : origin);
      res.setHeader('Vary', 'Origin');
    }
  } else if (!stateChanging) {
    // Read-only cross-origin GETs (e.g. peer discovery) — no ACAO needed for simple requests
  }
}

/** Bootnode: allow read CORS but never wildcard on writes. */
export function applyBootnodeCors(req, res) {
  const stateChanging = isStateChangingMethod(req.method);
  const origin = req.headers.origin;
  if (!stateChanging && origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

export function rejectNonLocalStateChange(req, res, pathname) {
  if (!isStateChangingMethod(req.method)) return false;
  if (isPublicPostPath(pathname)) return false;
  if (isLocalRequest(req)) return false;
  res.statusCode = 403;
  res.end(JSON.stringify({ error: 'This endpoint is restricted to localhost.' }));
  return true;
}